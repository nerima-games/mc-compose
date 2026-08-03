import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'
import { WebSocket } from 'ws'

type WireMessage = { readonly _tag: string; readonly [key: string]: unknown }

const encodeProtocol = (message: WireMessage): string =>
  JSON.stringify({ protocolVersion: 1, message })

const encodeWither = (message: WireMessage): string => JSON.stringify(message)
const LEGACY_SECRETS = {
  'wither-alice': 'wither-alice-registration-secret',
  'wither-bob': 'wither-bob-registration-secret',
} as const

const fixture = {
  revision: 0,
  blocks: [],
  inventories: [{
    player: 'wither-alice',
    state: {
      slots: [
        { item: 'soul_sand', count: 4 },
        { item: 'wither_skeleton_skull', count: 3 },
      ],
      selectedSlot: 0,
    },
  }],
  vitals: [],
  playerPositions: [
    { player: 'wither-alice', at: { x: 0, y: 88, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 } },
    { player: 'wither-bob', at: { x: 0, y: 88, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 } },
  ],
  timeWeather: { timeOfDay: 0, weather: 'clear' },
  containers: [],
  furnaces: [],
  villagerTrades: [],
  entities: [],
}

const decodeMessage = (data: WebSocket.RawData): WireMessage => {
  const decoded = JSON.parse(data.toString()) as WireMessage & {
    readonly message?: WireMessage
  }
  return decoded.message ?? decoded
}

class MessageInbox {
  readonly #messages: WireMessage[] = []

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.#messages.push(decodeMessage(data))
    })
  }

  messages(tag: string): WireMessage[] {
    return this.#messages.filter((message) => message._tag === tag)
  }

  async next(
    tag: string,
    predicate: (message: WireMessage) => boolean = () => true,
    timeout = 5_000,
  ): Promise<WireMessage> {
    await expect.poll(() =>
      this.#messages.find((message) => message._tag === tag && predicate(message)),
    { timeout }).not.toBeUndefined()
    return this.#messages.find((message) => message._tag === tag && predicate(message)) as WireMessage
  }

}

const connect = async (
  url: string,
  player: keyof typeof LEGACY_SECRETS,
  reconnectToken?: string,
): Promise<{ socket: WebSocket; inbox: MessageInbox; reconnectToken: string }> => {
  const socket = new WebSocket(url)
  const inbox = new MessageInbox(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve)
    socket.once('error', reject)
  })
  socket.send(JSON.stringify({
    _tag: 'PlayerResume',
    player,
    token: reconnectToken,
    ...(reconnectToken === undefined ? { registrationToken: LEGACY_SECRETS[player] } : {}),
  }))
  const accepted = await inbox.next('PlayerResumeAccepted')
  const nextToken = accepted.token
  if (typeof nextToken !== 'string') throw new Error('resume response lacks a reconnect token')
  socket.send(encodeProtocol({
    _tag: 'PlayerJoin',
    player,
    name: player,
    at: { x: 0, y: 88, z: 0 },
  }))
  await inbox.next('WorldSnapshot')
  await inbox.next('WitherSnapshot')
  return { socket, inbox, reconnectToken: nextToken }
}

const withers = (message: WireMessage): ReadonlyArray<WireMessage> => {
  const snapshot = message.snapshot as { readonly withers?: ReadonlyArray<WireMessage> }
  return snapshot.withers ?? []
}

const startWitherServer = async (): Promise<{
  process: ChildProcess
  stateDirectory: string
  url: string
}> => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-wither-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  const claimsFile = join(stateDirectory, 'claims.json')
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'overworld',
    seed: 0,
    state: fixture,
  })}\n`, 'utf8')
  await writeFile(claimsFile, `${JSON.stringify({
    format: 1,
    players: Object.fromEntries(Object.entries(LEGACY_SECRETS).map(([player, secret]) => [
      player,
      createHash('sha256').update(secret).digest('hex'),
    ])),
  })}\n`, 'utf8')
  const script = [
    'const nativeSetInterval = globalThis.setInterval',
    'let multiplayerTicks = 0',
    "globalThis.setInterval = (handler, timeout, ...args) => nativeSetInterval(() => { if (timeout !== 4000 || multiplayerTicks++ < 3) handler(...args) }, timeout)",
    "const { startMultiplayerServer } = await import('./apps/multiplayer-server/main.ts')",
    `const runtime = await startMultiplayerServer({ host: '127.0.0.1', port: 0, worldId: 'overworld', seed: 0, allowedBlocks: new Set(['soul_sand', 'wither_skeleton_skull']), installSignalHandlers: true, stateFile: ${JSON.stringify(stateFile)}, legacyPlayerClaimsFile: ${JSON.stringify(claimsFile)} })`,
    "process.stdout.write('READY:' + runtime.port + '\\n')",
  ].join(';')
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    '--input-type=module',
    '-e', script,
  ], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { output += chunk })
  child.stderr?.on('data', (chunk: string) => { output += chunk })
  await expect.poll(() => /READY:(\d+)/.exec(output)?.[1], { timeout: 15_000 }).toBeDefined()
  const port = /READY:(\d+)/.exec(output)?.[1]
  if (port === undefined) throw new Error(`Wither server failed to start: ${output}`)
  return { process: child, stateDirectory, url: `ws://127.0.0.1:${port}/ws` }
}

const stopServer = async (child: ChildProcess, stateDirectory: string): Promise<void> => {
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => child.once('exit', () => resolve()))
  }
  await rm(stateDirectory, { recursive: true, force: true })
}

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds))

test('serializes competing Wither damage and restores the canonical state on rejoin', async () => {
  test.setTimeout(90_000)
  const server = await startWitherServer()
  const url = server.url
  const alice = await connect(url, 'wither-alice')
  const bob = await connect(url, 'wither-bob')
  let rejoined: WebSocket | undefined

  try {
    const structure = [
      { at: { x: 0, y: 88, z: 0 }, block: 'soul_sand' },
      { at: { x: -1, y: 89, z: 0 }, block: 'soul_sand' },
      { at: { x: 0, y: 89, z: 0 }, block: 'soul_sand' },
      { at: { x: 1, y: 89, z: 0 }, block: 'soul_sand' },
      { at: { x: -1, y: 90, z: 0 }, block: 'wither_skeleton_skull' },
      { at: { x: 0, y: 90, z: 0 }, block: 'wither_skeleton_skull' },
      { at: { x: 1, y: 90, z: 0 }, block: 'wither_skeleton_skull' },
    ]
    for (const [index, placement] of structure.entries()) {
      if (index === 4) {
        alice.socket.send(encodeProtocol({
          _tag: 'PlayerInventoryCommand',
          commandId: 'select-wither-skulls',
          player: 'wither-alice',
          world: 'overworld',
          expectedRevision: 4,
          action: { _tag: 'select-slot', slot: 1 },
        }))
        await alice.inbox.next('AuthoritativeCommandAccepted', (message) =>
          message.commandId === 'select-wither-skulls')
      }
      alice.socket.send(encodeProtocol({
        _tag: 'BlockPlace', player: 'wither-alice', world: 'overworld', ...placement,
      }))
      await alice.inbox.next('BlockPlace', (_message) => alice.inbox.messages('BlockPlace').length > index)
    }
    alice.socket.send(encodeWither({
      _tag: 'WitherCommand',
      command: {
        _tag: 'SummonWither',
        actor: 'wither-alice',
        requestId: 'summon-wither',
        expectedRevision: 0,
        dimension: 'overworld',
        position: { x: 1, y: 90, z: 0 },
      },
    }))

    await expect(alice.inbox.next('WitherCommandResult', (message) =>
      message.requestId === 'summon-wither')).resolves.toMatchObject({
      accepted: true,
      revision: 1,
    })
    for (const client of [alice, bob]) {
      const snapshot = await client.inbox.next('WitherSnapshot', (message) => message.revision === 1)
      expect(withers(snapshot)).toEqual([
        expect.objectContaining({
          id: 'wither-1',
          dimension: 'overworld',
          snapshot: expect.objectContaining({
            state: expect.objectContaining({ phase: 'charging', chargeRemainingSecs: 10 }),
          }),
        }),
      ])
    }

    for (const client of [alice, bob]) {
      client.socket.send(encodeProtocol({
        _tag: 'PlayerMove', player: client === alice ? 'wither-alice' : 'wither-bob',
        at: { x: 8, y: 88, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
      }))
    }

    const consumedStructure = await alice.inbox.next('WorldSnapshot', (message) => message.revision === 9)
    expect(consumedStructure.blocks).toEqual(expect.arrayContaining(structure.map(({ at }) => ({
      world: 'overworld',
      at,
      block: null,
    }))))

    const chargingSnapshot = await alice.inbox.next('WitherSnapshot', (message) =>
      withers(message).some((wither) => {
        const snapshot = wither.snapshot as WireMessage | undefined
        const state = snapshot?.state as WireMessage | undefined
        return state?.phase === 'charging'
          && typeof state.chargeRemainingSecs === 'number'
          && state.chargeRemainingSecs < 10
      }), 10_000)
    expect(chargingSnapshot.revision).toBeGreaterThan(1)

    const activeSnapshot = await alice.inbox.next('WitherSnapshot', (message) =>
      withers(message).some((wither) => {
        const snapshot = wither.snapshot as WireMessage | undefined
        const state = snapshot?.state as WireMessage | undefined
        return state?.phase !== undefined && state.phase !== 'charging'
      }), 20_000)
    const activeRevision = activeSnapshot.revision as number

    for (const client of [alice, bob]) {
      client.socket.send(encodeProtocol({
        _tag: 'PlayerMove', player: client === alice ? 'wither-alice' : 'wither-bob',
        at: { x: 0, y: 88, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
      }))
    }

    const damage = (actor: string, requestId: string, revision: number): string => encodeWither({
      _tag: 'WitherCommand',
      command: {
        _tag: 'DamageWither',
        actor,
        requestId,
        expectedRevision: revision,
        id: 'wither-1',
        amount: 300,
        kind: 'melee',
      },
    })
    alice.socket.send(damage('wither-alice', 'forged-hit', activeRevision))
    const forgedResult = await alice.inbox.next('WitherCommandResult', (message) => message.requestId === 'forged-hit')
    expect(forgedResult).toMatchObject({ accepted: true, revision: activeRevision + 1 })
    const forgedSnapshot = await alice.inbox.next('WitherSnapshot', (message) => message.revision === activeRevision + 1)
    expect(withers(forgedSnapshot)[0]?.snapshot).toMatchObject({ state: { healthPoints: 296 } })

    alice.socket.send(damage('wither-alice', 'rapid-hit', activeRevision + 1))
    await expect(alice.inbox.next('WitherCommandResult', (message) => message.requestId === 'rapid-hit')).resolves.toMatchObject({
      accepted: false,
      revision: activeRevision + 1,
      reason: 'invalid-command',
    })

    let attackRevision = activeRevision + 1
    for (let hit = 0; hit < 73; hit += 1) {
      await delay(300)
      const requestId = `setup-hit-${String(hit)}`
      const attacker = hit % 2 === 0 ? bob : alice
      const actor = attacker === alice ? 'wither-alice' : 'wither-bob'
      const latestSnapshot = alice.inbox.messages('WitherSnapshot').at(-1) as WireMessage
      const latestWither = withers(latestSnapshot)[0]?.snapshot as WireMessage
      const position = (latestWither.state as WireMessage).position as { x: number; y: number; z: number }
      attacker.socket.send(encodeProtocol({
        _tag: 'PlayerMove', player: actor, at: position,
        facing: { yawRadians: 0, pitchRadians: 0 },
      }))
      attacker.socket.send(damage(actor, requestId, attackRevision))
      const result = await attacker.inbox.next('WitherCommandResult', (message) => message.requestId === requestId)
      expect(result).toMatchObject({ accepted: true, revision: attackRevision + 1 })
      attackRevision += 1
    }

    await delay(510)
    alice.socket.send(damage('wither-alice', 'alice-hit', attackRevision))
    bob.socket.send(damage('wither-bob', 'bob-hit', attackRevision))

    const results = await Promise.all([
      alice.inbox.next('WitherCommandResult', (message) => message.requestId === 'alice-hit'),
      bob.inbox.next('WitherCommandResult', (message) => message.requestId === 'bob-hit'),
    ])
    const deathRevision = attackRevision + 1
    expect(results.filter((result) => result.accepted === true)).toHaveLength(1)
    expect(results.filter((result) => result.accepted === false)).toEqual([
      expect.objectContaining({ revision: deathRevision, reason: 'stale-revision' }),
    ])

    for (const client of [alice, bob]) {
      const canonical = await client.inbox.next('WitherSnapshot', (message) => message.revision === deathRevision)
      expect(withers(canonical)).toEqual([])
      await client.inbox.next('EntitySpawnDelta', (message) => {
        const entity = message.entity as WireMessage | undefined
        const stack = entity?.stack as WireMessage | undefined
        return entity?._tag === 'item-drop' && stack?.item === 'nether_star' && stack.count === 1
      })
      expect(client.inbox.messages('EntitySpawnDelta').filter((message) => {
        const entity = message.entity as WireMessage | undefined
        return entity?._tag === 'item-drop'
      })).toHaveLength(1)
    }

    bob.socket.close()
    const canonical = await connect(url, 'wither-bob', bob.reconnectToken)
    rejoined = canonical.socket
    const rejoinSnapshot = await canonical.inbox.next('WitherSnapshot', (message) => message.revision === deathRevision)
    expect(withers(rejoinSnapshot)).toEqual([])
    const authoritative = await canonical.inbox.next('AuthoritativeSnapshot')
    expect(authoritative.entities).toEqual([
      expect.objectContaining({
        _tag: 'item-drop',
        stack: { item: 'nether_star', count: 1 },
      }),
    ])
  } finally {
    alice.socket.close()
    bob.socket.close()
    rejoined?.close()
    await stopServer(server.process, server.stateDirectory)
  }
})
