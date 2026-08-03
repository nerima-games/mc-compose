import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeFrame, encodeFrame, type NetworkMessage, type PlayerId, type PlayerName } from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import {
  makeGeneratedBlockAt,
  resolveMultiplayerRuntimeOptions,
  startMultiplayerServer,
  type MultiplayerRuntime,
} from '../../apps/multiplayer-server/main'

const runtimes: Array<MultiplayerRuntime> = []

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()))
})

const encode = (message: NetworkMessage): string => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

const nextMessage = (socket: WebSocket): Promise<NetworkMessage> => new Promise((resolve, reject) => {
  const handleError = (error: Error): void => {
    socket.off('message', handleMessage)
    reject(error)
  }
  const handleMessage = (data: WebSocket.RawData): void => {
    const decoded = decodeFrame(data.toString() as never)
    if (Either.isLeft(decoded)) return
    socket.off('message', handleMessage)
    socket.off('error', handleError)
    resolve(decoded.right)
  }
  socket.once('error', handleError)
  socket.on('message', handleMessage)
})

const connect = async (runtime: MultiplayerRuntime): Promise<WebSocket> => {
  const socket = new WebSocket(`ws://${runtime.host}:${String(runtime.port)}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.once('open', resolve)
  })
  return socket
}

type ResumeAccepted = Readonly<{
  _tag: 'PlayerResumeAccepted'
  player: string
  token: string
}>

const authenticate = async (
  socket: WebSocket,
  player: string,
  token?: string,
  registrationToken?: string,
): Promise<ResumeAccepted> => {
  const response = new Promise<ResumeAccepted>((resolve, reject) => {
    socket.once('error', reject)
    socket.once('message', (data) => {
      const value = JSON.parse(data.toString()) as ResumeAccepted
      if (value._tag !== 'PlayerResumeAccepted') reject(new Error('resume was not accepted'))
      else resolve(value)
    })
  })
  socket.send(JSON.stringify({
    _tag: 'PlayerResume',
    player,
    ...(token === undefined ? {} : { token }),
    ...(registrationToken === undefined ? {} : { registrationToken }),
  }))
  return response
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const waitForClose = (socket: WebSocket): Promise<number> => new Promise((resolve) => {
  socket.once('close', (code) => resolve(code))
})

describe('multiplayer WebSocket runtime', () => {
  it('resolves the legacy claims file from CLI before the environment', () => {
    expect(resolveMultiplayerRuntimeOptions(
      ['--legacy-player-claims-file', 'cli-claims.json'],
      { MULTIPLAYER_LEGACY_PLAYER_CLAIMS_FILE: 'env-claims.json' },
    ).legacyPlayerClaimsFile).toBe('cli-claims.json')
    expect(resolveMultiplayerRuntimeOptions(
      [],
      { MULTIPLAYER_LEGACY_PLAYER_CLAIMS_FILE: 'env-claims.json' },
    ).legacyPlayerClaimsFile).toBe('env-claims.json')
  })

  it('fails before binding when a non-loopback host lacks secure transport settings', async () => {
    await expect(startMultiplayerServer({
      host: '0.0.0.0',
      port: 0,
      worldId: 'overworld',
      seed: 0,
    })).rejects.toThrow(/tls-cert/)
  })

  it('serves health and returns an authoritative snapshot after join', async () => {
    const runtime = await startMultiplayerServer({
      host: '127.0.0.1',
      port: 0,
      worldId: 'runtime-world',
      seed: 73,
      installSignalHandlers: false,
    })
    runtimes.push(runtime)

    const health = await fetch(`http://${runtime.host}:${String(runtime.port)}/health`)
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok', world: 'runtime-world' })

    const socket = await connect(runtime)
    await authenticate(socket, 'runtime-player')
    const snapshotPromise = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerJoin',
      player: 'runtime-player' as PlayerId,
      name: 'Runtime Player' as PlayerName,
      at: { x: 2, y: 64, z: 3 },
    }))
    const snapshot = await snapshotPromise
    socket.close()

    expect(snapshot).toMatchObject({
      _tag: 'WorldSnapshot',
      world: 'runtime-world',
      seed: 73,
      players: [{
        player: 'runtime-player',
        name: 'Runtime Player',
        at: expect.not.objectContaining({ x: 2, y: 64, z: 3 }),
      }],
    })
  })

  it('uses generated terrain, rejects invalid movement, and restores overrides after restart', async () => {
    const seed = 73
    const worldId = 'persistent-world'
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-server-')), 'state.json')
    const generatedBlockAt = makeGeneratedBlockAt(seed)
    const playerAt = { x: 0, y: 200, z: 0 }

    const first = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId, seed, stateFile, installSignalHandlers: false,
    })
    runtimes.push(first)
    const socket = await connect(first)
    const firstAuth = await authenticate(socket, 'persistent-player')
    const firstSnapshot = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerJoin', player: 'persistent-player' as PlayerId, name: 'Persistent Player' as PlayerName,
      at: playerAt,
    }))
    const joined = await firstSnapshot
    expect(joined).toMatchObject({
      _tag: 'WorldSnapshot',
      players: [expect.objectContaining({
        player: 'persistent-player',
        at: expect.not.objectContaining(playerAt),
      })],
    })
    const spawnAt = joined._tag === 'WorldSnapshot' ? joined.players[0]?.at : undefined
    expect(spawnAt).toBeDefined()
    if (spawnAt === undefined) throw new Error('authoritative spawn was not present in the snapshot')
    const block = { x: spawnAt.x, y: spawnAt.y - 1, z: spawnAt.z }
    expect(generatedBlockAt(block)).not.toBeNull()

    const correction = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerMove', player: 'persistent-player' as PlayerId,
      at: { x: 100, y: playerAt.y, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
    }))
    await expect(correction).resolves.toMatchObject({ _tag: 'PlayerMove', at: spawnAt })

    socket.close()
    await new Promise<void>((resolve) => socket.once('close', () => resolve()))
    const sameProcess = await connect(first)
    const secondAuth = await authenticate(sameProcess, 'persistent-player', firstAuth.token)
    const sameProcessSnapshot = nextMessage(sameProcess)
    sameProcess.send(encode({
      _tag: 'PlayerJoin', player: 'persistent-player' as PlayerId, name: 'Persistent Player' as PlayerName,
      at: { x: 50, y: 200, z: 50 },
    }))
    await expect(sameProcessSnapshot).resolves.toMatchObject({
      _tag: 'WorldSnapshot',
      players: [expect.objectContaining({ player: 'persistent-player', at: spawnAt })],
    })

    const fractionalAt = { x: spawnAt.x + 0.25, y: spawnAt.y, z: spawnAt.z + 0.5 }
    const acceptedMove = nextMessage(sameProcess)
    sameProcess.send(encode({
      _tag: 'PlayerMove', player: 'persistent-player' as PlayerId,
      at: fractionalAt, facing: { yawRadians: 0.5, pitchRadians: -0.25 },
    }))
    await expect(acceptedMove).resolves.toMatchObject({ _tag: 'PlayerMove', at: fractionalAt })

    const acceptedBreak = nextMessage(sameProcess)
    sameProcess.send(encode({ _tag: 'BlockBreak', player: 'persistent-player' as PlayerId, world: worldId as never, at: block }))
    await expect(acceptedBreak).resolves.toMatchObject({ _tag: 'BlockBreak', at: block })
    await first.close()

    const second = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId, seed, stateFile, installSignalHandlers: false,
    })
    runtimes.push(second)
    const reconnect = await connect(second)
    await authenticate(reconnect, 'persistent-player', secondAuth.token)
    const restoredSnapshot = nextMessage(reconnect)
    reconnect.send(encode({
      _tag: 'PlayerJoin', player: 'persistent-player' as PlayerId, name: 'Persistent Player' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await expect(restoredSnapshot).resolves.toMatchObject({
      _tag: 'WorldSnapshot',
      revision: expect.any(Number),
      blocks: [{ at: block, block: null }],
      players: [expect.objectContaining({ player: 'persistent-player', at: fractionalAt })],
    })
    reconnect.close()
  })

  it('rejects active takeover, permits one lost-response recovery, and rejects replay and cross-player tokens', async () => {
    const runtime = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId: 'auth-world', seed: 73, installSignalHandlers: false,
    })
    runtimes.push(runtime)

    const incumbent = await connect(runtime)
    const firstAlice = await authenticate(incumbent, 'alice')
    const incumbentSnapshot = nextMessage(incumbent)
    incumbent.send(encode({
      _tag: 'PlayerJoin', player: 'alice' as PlayerId, name: 'Alice' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await incumbentSnapshot

    const contender = await connect(runtime)
    const contenderClosed = waitForClose(contender)
    contender.send(JSON.stringify({ _tag: 'PlayerResume', player: 'alice', token: firstAlice.token }))
    await expect(contenderClosed).resolves.toBe(1008)

    const incumbentClosed = waitForClose(incumbent)
    incumbent.close()
    await incumbentClosed
    const replacement = await connect(runtime)
    const secondAlice = await authenticate(replacement, 'alice', firstAlice.token)
    const replacementSnapshot = nextMessage(replacement)
    replacement.send(encode({
      _tag: 'PlayerJoin', player: 'alice' as PlayerId, name: 'Alice' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await replacementSnapshot
    const replacementClosed = waitForClose(replacement)
    replacement.close()
    await replacementClosed

    const recovery = await connect(runtime)
    const recoveredAlice = await authenticate(recovery, 'alice', firstAlice.token)
    const recoveryClosed = waitForClose(recovery)
    recovery.close()
    await recoveryClosed

    for (const replayedToken of [firstAlice.token, secondAlice.token]) {
      const replay = await connect(runtime)
      const replayClosed = waitForClose(replay)
      replay.send(JSON.stringify({ _tag: 'PlayerResume', player: 'alice', token: replayedToken }))
      await expect(replayClosed).resolves.toBe(1008)
    }

    const bob = await connect(runtime)
    await authenticate(bob, 'bob')
    const bobClosed = waitForClose(bob)
    bob.close()
    await bobClosed
    const crossPlayer = await connect(runtime)
    const crossPlayerClosed = waitForClose(crossPlayer)
    crossPlayer.send(JSON.stringify({ _tag: 'PlayerResume', player: 'bob', token: recoveredAlice.token }))
    await expect(crossPlayerClosed).resolves.toBe(1008)
  })

  it('refuses to start with a corrupt persisted state file', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-server-')), 'state.json')
    await writeFile(stateFile, '{"format":1,"worldId":', 'utf8')

    await expect(startMultiplayerServer({
      host: '127.0.0.1',
      port: 0,
      worldId: 'corrupt-world',
      seed: 73,
      stateFile,
      installSignalHandlers: false,
    })).rejects.toThrow(/Failed to read multiplayer state/)
  })

  it('registers legacy players from every persisted authority collection and then rotates normally', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mc-compose-server-'))
    const stateFile = join(directory, 'state.json')
    const claimsFile = join(directory, 'claims.json')
    const claims = {
      'inventory-player': 'inventory-secret',
      'vitals-player': 'vitals-secret',
      'position-player': 'position-secret',
    } as const
    await Promise.all([
      writeFile(stateFile, JSON.stringify({
        format: 1,
        worldId: 'legacy-claims-world',
        seed: 73,
        state: {
          revision: 0,
          blocks: [],
          inventories: [{ player: 'inventory-player', state: { slots: [], selectedSlot: 0 } }],
          vitals: [{ player: 'vitals-player', state: { health: 20, hunger: 20, experience: 0 } }],
          playerPositions: [{
            player: 'position-player',
            at: { x: 0, y: 200, z: 0 },
            facing: { yawRadians: 0, pitchRadians: 0 },
          }],
        },
      }), 'utf8'),
      writeFile(claimsFile, JSON.stringify({
        format: 1,
        players: Object.fromEntries(Object.entries(claims).map(([player, secret]) => [player, sha256(secret)])),
      }), 'utf8'),
    ])

    const runtime = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId: 'legacy-claims-world', seed: 73,
      stateFile, legacyPlayerClaimsFile: claimsFile, installSignalHandlers: false,
    })
    runtimes.push(runtime)

    for (const [player, secret] of Object.entries(claims)) {
      const socket = await connect(runtime)
      const registered = await authenticate(socket, player, undefined, secret)
      const closed = waitForClose(socket)
      socket.close()
      await closed

      const reconnect = await connect(runtime)
      const rotated = await authenticate(reconnect, player, registered.token)
      expect(rotated.token).not.toBe(registered.token)
      const reconnectClosed = waitForClose(reconnect)
      reconnect.close()
      await reconnectClosed
    }
  })

  it.each([
    { name: 'claims are not configured', claims: undefined, registrationToken: 'legacy-secret' },
    { name: 'the player claim is missing', claims: {}, registrationToken: 'legacy-secret' },
    { name: 'the registration token is wrong', claims: { 'legacy-player': 'correct-secret' }, registrationToken: 'wrong-secret' },
  ])('fails closed for a legacy player when $name', async ({ claims, registrationToken }) => {
    const directory = await mkdtemp(join(tmpdir(), 'mc-compose-server-'))
    const stateFile = join(directory, 'state.json')
    const claimsFile = claims === undefined ? undefined : join(directory, 'claims.json')
    await writeFile(stateFile, JSON.stringify({
      format: 1,
      worldId: 'legacy-fail-closed-world',
      seed: 73,
      state: {
        revision: 0,
        blocks: [],
        inventories: [{ player: 'legacy-player', state: { slots: [], selectedSlot: 0 } }],
      },
    }), 'utf8')
    if (claimsFile !== undefined && claims !== undefined) {
      await writeFile(claimsFile, JSON.stringify({
        format: 1,
        players: Object.fromEntries(Object.entries(claims).map(([player, secret]) => [player, sha256(secret)])),
      }), 'utf8')
    }

    const runtime = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId: 'legacy-fail-closed-world', seed: 73,
      stateFile, ...(claimsFile === undefined ? {} : { legacyPlayerClaimsFile: claimsFile }),
      installSignalHandlers: false,
    })
    runtimes.push(runtime)
    const socket = await connect(runtime)
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ _tag: 'PlayerResume', player: 'legacy-player', registrationToken }))
    await expect(closed).resolves.toBe(1008)
  })

  it('rejects a non-string registration token during PlayerResume decoding', async () => {
    const runtime = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId: 'strict-resume-world', seed: 73, installSignalHandlers: false,
    })
    runtimes.push(runtime)
    const socket = await connect(runtime)
    const closed = waitForClose(socket)
    socket.send(JSON.stringify({ _tag: 'PlayerResume', player: 'new-player', registrationToken: 123 }))
    await expect(closed).resolves.toBe(1008)
  })

  it('restores legacy block-only persisted state with authority defaults', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-server-')), 'state.json')
    await writeFile(stateFile, JSON.stringify({
      format: 1,
      worldId: 'legacy-world',
      seed: 73,
      state: { revision: 2, blocks: [{ at: { x: 1, y: 64, z: 1 }, block: null }] },
    }), 'utf8')

    const runtime = await startMultiplayerServer({
      host: '127.0.0.1',
      port: 0,
      worldId: 'legacy-world',
      seed: 73,
      stateFile,
      installSignalHandlers: false,
    })
    runtimes.push(runtime)

    const socket = await connect(runtime)
    await authenticate(socket, 'legacy-player')
    const snapshot = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerJoin', player: 'legacy-player' as PlayerId, name: 'Legacy Player' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await expect(snapshot).resolves.toMatchObject({
      _tag: 'WorldSnapshot', revision: 2, blocks: [{ at: { x: 1, y: 64, z: 1 }, block: null }],
    })
    socket.close()
  })

  it('refuses persisted authority state with invalid nested values', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-server-')), 'state.json')
    await writeFile(stateFile, JSON.stringify({
      format: 1,
      worldId: 'invalid-authority-world',
      seed: 73,
      state: {
        revision: 0,
        blocks: [],
        inventories: [{ player: 'player', state: { slots: [], selectedSlot: -1 } }],
      },
    }), 'utf8')

    await expect(startMultiplayerServer({
      host: '127.0.0.1',
      port: 0,
      worldId: 'invalid-authority-world',
      seed: 73,
      stateFile,
      installSignalHandlers: false,
    })).rejects.toThrow(/does not match world/)
  })
})
