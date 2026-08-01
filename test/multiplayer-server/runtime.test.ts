import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decodeFrame, encodeFrame, type NetworkMessage, type PlayerId, type PlayerName } from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

import { makeGeneratedBlockAt, startMultiplayerServer, type MultiplayerRuntime } from '../../apps/multiplayer-server/main'

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
  socket.once('error', reject)
  socket.once('message', (data) => {
    const decoded = decodeFrame(data.toString() as never)
    if (Either.isLeft(decoded)) reject(decoded.left)
    else resolve(decoded.right)
  })
})

const connect = async (runtime: MultiplayerRuntime): Promise<WebSocket> => {
  const socket = new WebSocket(`ws://${runtime.host}:${String(runtime.port)}/ws`)
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.once('open', resolve)
  })
  return socket
}

describe('multiplayer WebSocket runtime', () => {
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

    const snapshot = await new Promise<NetworkMessage>((resolve, reject) => {
      const socket = new WebSocket(`ws://${runtime.host}:${String(runtime.port)}/ws`)
      socket.once('error', reject)
      socket.once('open', () => {
        socket.send(encode({
          _tag: 'PlayerJoin',
          player: 'runtime-player' as PlayerId,
          name: 'Runtime Player' as PlayerName,
          at: { x: 2, y: 64, z: 3 },
        }))
      })
      socket.once('message', (data) => {
        const decoded = decodeFrame(data.toString() as never)
        socket.close()
        if (Either.isLeft(decoded)) reject(decoded.left)
        else resolve(decoded.right)
      })
    })

    expect(snapshot).toMatchObject({
      _tag: 'WorldSnapshot',
      world: 'runtime-world',
      seed: 73,
      players: [{ player: 'runtime-player', name: 'Runtime Player', at: { x: 2, y: 64, z: 3 } }],
    })
  })

  it('uses generated terrain, rejects invalid movement, and restores overrides after restart', async () => {
    const seed = 73
    const worldId = 'persistent-world'
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-server-')), 'state.json')
    const generatedBlockAt = makeGeneratedBlockAt(seed)
    const solidY = Array.from({ length: 256 }, (_, y) => y).find((y) => generatedBlockAt({ x: 0, y, z: 0 }) !== null)
    expect(solidY).toBeDefined()
    const block = { x: 0, y: solidY as number, z: 0 }

    const first = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId, seed, stateFile, installSignalHandlers: false,
    })
    runtimes.push(first)
    const socket = await connect(first)
    const firstSnapshot = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerJoin', player: 'persistent-player' as PlayerId, name: 'Persistent Player' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await firstSnapshot

    const correction = nextMessage(socket)
    socket.send(encode({
      _tag: 'PlayerMove', player: 'persistent-player' as PlayerId,
      at: { x: 100, y: 200, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
    }))
    await expect(correction).resolves.toMatchObject({ _tag: 'PlayerMove', at: { x: 0, y: 200, z: 0 } })

    const acceptedBreak = nextMessage(socket)
    socket.send(encode({ _tag: 'BlockBreak', player: 'persistent-player' as PlayerId, world: worldId as never, at: block }))
    await expect(acceptedBreak).resolves.toMatchObject({ _tag: 'BlockBreak', at: block })
    await first.close()

    const second = await startMultiplayerServer({
      host: '127.0.0.1', port: 0, worldId, seed, stateFile, installSignalHandlers: false,
    })
    runtimes.push(second)
    const reconnect = await connect(second)
    const restoredSnapshot = nextMessage(reconnect)
    reconnect.send(encode({
      _tag: 'PlayerJoin', player: 'reconnected-player' as PlayerId, name: 'Reconnected' as PlayerName,
      at: { x: 0, y: 200, z: 0 },
    }))
    await expect(restoredSnapshot).resolves.toMatchObject({
      _tag: 'WorldSnapshot', revision: 1, blocks: [{ at: block, block: null }],
    })
    reconnect.close()
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
})
