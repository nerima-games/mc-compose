import { type ChildProcess, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NetworkMessage } from '@nerima-games/mx-multiplayer'
import { expect, test } from '@playwright/test'
import { Either } from 'effect'
import { tsImport } from 'tsx/esm/api'
import { WebSocket } from 'ws'

type WireMessage = {
  readonly _tag: string
  readonly token?: string
  readonly snapshot?: WireMessage
  readonly state?: WireMessage
  readonly entity?: WireMessage
  readonly stack?: WireMessage
  readonly item?: string
  readonly count?: number
  readonly accepted?: boolean
  readonly commandId?: string
  readonly requestId?: string
  readonly revision?: number
  readonly blocks?: ReadonlyArray<unknown>
  readonly entities?: ReadonlyArray<WireMessage>
  readonly phase?: string
  readonly chargeRemainingSecs?: number
  readonly feetPosition?: { readonly x: number; readonly y: number; readonly z: number }
  readonly position?: { readonly x: number; readonly y: number; readonly z: number }
  readonly [key: string]: unknown
}

type WireRecord = { readonly [key: string]: unknown }
type Position = { readonly x: number; readonly y: number; readonly z: number }

const isRecord = (value: unknown): value is WireRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isWireMessage = (value: unknown): value is WireMessage =>
  isRecord(value) && typeof value['_tag'] === 'string'

const isPosition = (value: unknown): value is Position =>
  isRecord(value)
  && typeof value['x'] === 'number'
  && typeof value['y'] === 'number'
  && typeof value['z'] === 'number'

const { encodeFrame } = await tsImport(
  '@nerima-games/mx-multiplayer',
  import.meta.url,
) as typeof import('@nerima-games/mx-multiplayer')

const encodeProtocol = (message: NetworkMessage): string => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

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
  const decoded: unknown = JSON.parse(data.toString())
  if (!isRecord(decoded)) throw new Error('protocol message is not an object')
  const message = decoded['message']
  if (isWireMessage(message)) return message
  if (isWireMessage(decoded)) return decoded
  throw new Error('protocol message lacks a string _tag')
}

class MessageInbox {
  readonly #messages: WireMessage[] = []

  constructor(socket: WebSocket) {
    socket.on('message', (data) => {
      this.#messages.push(decodeMessage(data))
    })
  }

  messages(tag?: string): WireMessage[] {
    return tag === undefined ? [...this.#messages] : this.#messages.filter((message) => message._tag === tag)
  }

  async next(
    tag: string,
    predicate: (message: WireMessage) => boolean = () => true,
    timeout = 5_000,
  ): Promise<WireMessage> {
    await expect.poll(() =>
      this.#messages.find((message) => message._tag === tag && predicate(message)),
    { timeout }).not.toBeUndefined()
    const message = this.#messages.find((message) => message._tag === tag && predicate(message))
    if (message === undefined) throw new Error(`message ${tag} disappeared after polling`)
    return message
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
  const accepted = await Promise.race([
    inbox.next('PlayerResumeAccepted'),
    new Promise<never>((_resolve, reject) => {
      socket.once('close', (code, reason) => reject(new Error(
        `resume rejected with close code ${String(code)}: ${reason.toString()}`,
      )))
    }),
  ])
  const nextToken = accepted.token
  if (typeof nextToken !== 'string') throw new Error('resume response lacks a reconnect token')
  socket.send(encodeProtocol({
    _tag: 'PlayerJoin',
    player,
    name: player,
    at: { x: 0, y: 88, z: 0 },
  } as NetworkMessage))
  try {
    await Promise.race([
      inbox.next('WorldSnapshot'),
      new Promise<never>((_resolve, reject) => {
        socket.once('close', (code, reason) => reject(new Error(
          `join rejected with close code ${String(code)}: ${reason.toString()}`,
        )))
      }),
    ])
  } catch (error) {
    throw new Error(`join did not produce a world snapshot: ${JSON.stringify(inbox.messages())}`, { cause: error })
  }
  await inbox.next('WitherSnapshot')
  return { socket, inbox, reconnectToken: nextToken }
}

const withers = (message: WireMessage): ReadonlyArray<WireRecord> => {
  const snapshot = message['snapshot']
  if (!isRecord(snapshot)) return []
  const entries = snapshot['withers']
  return Array.isArray(entries) ? entries.filter(isRecord) : []
}

const firstWitherState = (message: WireMessage): WireRecord | undefined => {
  const wither = withers(message).at(0)
  if (wither === undefined) return undefined
  const snapshot = wither['snapshot']
  if (!isRecord(snapshot)) return undefined
  const state = snapshot['state']
  return isRecord(state) ? state : undefined
}

const positionOf = (message: WireRecord): Position | undefined => {
  const position = message['at']
  return isPosition(position) ? position : undefined
}

const playerOf = (message: WireRecord): string | undefined => {
  const player = message['player']
  return typeof player === 'string' ? player : undefined
}

const requiredRevision = (message: WireRecord): number => {
  const revision = message['revision']
  if (typeof revision !== 'number') throw new Error('protocol message lacks a numeric revision')
  return revision
}

const latestWitherSnapshot = (inbox: MessageInbox): WireMessage => {
  const latest = inbox.messages('WitherSnapshot').at(-1)
  if (latest === undefined) throw new Error('inbox lacks a WitherSnapshot')
  return latest
}

const healthPointsOf = (message: WireMessage): number => {
  const healthPoints = firstWitherState(message)?.['healthPoints']
  if (typeof healthPoints !== 'number') throw new Error('Wither snapshot lacks healthPoints')
  return healthPoints
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
    `const runtime = await startMultiplayerServer({ host: '127.0.0.1', port: 0, worldId: 'overworld', seed: 0, allowedBlocks: new Set(['soul_sand', 'wither_skeleton_skull']), installSignalHandlers: true, stateFile: ${JSON.stringify(stateFile)}, legacyPlayerClaimsFile: ${JSON.stringify(claimsFile)}, maxMoveDistance: 1000 })`,
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
        } as NetworkMessage))
        await alice.inbox.next('AuthoritativeCommandAccepted', (message) =>
          message.commandId === 'select-wither-skulls')
      }
      alice.socket.send(encodeProtocol({
        _tag: 'BlockPlace', player: 'wither-alice', world: 'overworld', ...placement,
      } as NetworkMessage))
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
      } as NetworkMessage))
    }

    const consumedStructure = await alice.inbox.next('WorldSnapshot', (message) => message.revision === 9)
    expect(consumedStructure.blocks).toEqual(expect.arrayContaining(structure.map(({ at }) => ({
      world: 'overworld',
      at,
      block: null,
    }))))

    const chargingSnapshot = await alice.inbox.next('WitherSnapshot', (message) =>
      withers(message).some((wither) => {
        const snapshot = wither['snapshot']
        if (!isRecord(snapshot)) return false
        const state = snapshot['state']
        if (!isRecord(state)) return false
        const phase = state['phase']
        const chargeRemainingSecs = state['chargeRemainingSecs']
        return phase === 'charging'
          && typeof chargeRemainingSecs === 'number'
          && chargeRemainingSecs < 10
      }), 10_000)
    expect(chargingSnapshot.revision).toBe(1)

    await alice.inbox.next('WitherSnapshot', (message) =>
      withers(message).some((wither) => {
        const snapshot = wither['snapshot']
        if (!isRecord(snapshot)) return false
        const state = snapshot['state']
        if (!isRecord(state)) return false
        const phase = state['phase']
        return phase !== undefined && phase !== 'charging'
      }), 20_000)
    for (const client of [alice, bob]) {
      const player = client === alice ? 'wither-alice' : 'wither-bob'
      client.socket.send(encodeProtocol({
        _tag: 'PlayerMove', player,
        at: { x: 0, y: 88, z: 0 }, facing: { yawRadians: 0, pitchRadians: 0 },
      } as NetworkMessage))
      await client.inbox.next('PlayerMove', (message) => {
        const at = positionOf(message)
        return at !== undefined
          && playerOf(message) === player
          && at.x === 0
          && at.y === 88
          && at.z === 0
        })
    }

    const preAttackSnapshot = latestWitherSnapshot(alice.inbox)
    const preAttackFeet = firstWitherState(preAttackSnapshot)?.['feetPosition']
    if (!isPosition(preAttackFeet)) throw new Error('Wither snapshot lacks feetPosition')
    const preAttackPosition = { x: preAttackFeet.x + 4, y: preAttackFeet.y, z: preAttackFeet.z }
    alice.socket.send(encodeProtocol({
      _tag: 'PlayerMove', player: 'wither-alice', at: preAttackPosition,
      facing: { yawRadians: 0, pitchRadians: 0 },
    } as NetworkMessage))
    await alice.inbox.next('PlayerMove', (message) => {
      const at = positionOf(message)
      return at !== undefined
        && playerOf(message) === 'wither-alice'
        && at.x === preAttackPosition.x
        && at.y === preAttackPosition.y
        && at.z === preAttackPosition.z
    })

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
    const sendDamageUntilAccepted = async (
      attacker: typeof alice,
      actor: string,
      requestPrefix: string,
    ): Promise<WireMessage> => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const requestId = `${requestPrefix}-${String(attempt)}`
        const revision = requiredRevision(latestWitherSnapshot(attacker.inbox))
        attacker.socket.send(damage(actor, requestId, revision))
        const result = await attacker.inbox.next('WitherCommandResult', (message) => message.requestId === requestId)
        if (result.accepted === true) return result
        expect(result).toMatchObject({ accepted: false, reason: 'stale-revision' })
      }
      throw new Error(`Wither command ${requestPrefix} remained stale after retries`)
    }
    const forgedResult = await sendDamageUntilAccepted(alice, 'wither-alice', 'forged-hit')
    const forgedRevision = requiredRevision(forgedResult)
    const forgedSnapshot = await alice.inbox.next('WitherSnapshot', (message) => message.revision === forgedRevision)
    expect(withers(forgedSnapshot)[0]?.['snapshot']).toMatchObject({ state: { healthPoints: 296 } })

    alice.socket.send(damage('wither-alice', 'rapid-hit', forgedRevision))
    await expect(alice.inbox.next('WitherCommandResult', (message) => message.requestId === 'rapid-hit')).resolves.toMatchObject({
      accepted: false,
      reason: 'invalid-command',
    })

    await delay(510)
    const latestSnapshot = latestWitherSnapshot(alice.inbox)
    const feetPosition = firstWitherState(latestSnapshot)?.['feetPosition']
    if (!isPosition(feetPosition)) throw new Error('Wither snapshot lacks feetPosition')
    const attackPosition = { x: feetPosition.x + 4, y: feetPosition.y, z: feetPosition.z }
    for (const [client, player] of [[alice, 'wither-alice'], [bob, 'wither-bob']] as const) {
      client.socket.send(encodeProtocol({
        _tag: 'PlayerMove', player, at: attackPosition,
        facing: { yawRadians: 0, pitchRadians: 0 },
      } as NetworkMessage))
      await client.inbox.next('PlayerMove', (message) => {
        const at = positionOf(message)
        return at !== undefined
          && playerOf(message) === player
          && at.x === attackPosition.x
          && at.y === attackPosition.y
          && at.z === attackPosition.z
      })
    }
    const competingRevision = requiredRevision(latestSnapshot)
    alice.socket.send(damage('wither-alice', 'alice-hit', competingRevision))
    bob.socket.send(damage('wither-bob', 'bob-hit', competingRevision))

    const results = await Promise.all([
      alice.inbox.next('WitherCommandResult', (message) => message.requestId === 'alice-hit'),
      bob.inbox.next('WitherCommandResult', (message) => message.requestId === 'bob-hit'),
    ])
    const canonicalRevision = competingRevision + 1
    expect(results.filter((result) => result.accepted === true)).toHaveLength(1)
    expect(results.filter((result) => result.accepted === false)).toEqual([
      expect.objectContaining({ revision: canonicalRevision, reason: 'stale-revision' }),
    ])

    for (const client of [alice, bob]) {
      const canonical = await client.inbox.next('WitherSnapshot', (message) => message.revision === canonicalRevision)
      expect(healthPointsOf(canonical)).toBeLessThan(296)
    }

    bob.socket.close()
    const canonical = await connect(url, 'wither-bob', bob.reconnectToken)
    rejoined = canonical.socket
    const rejoinSnapshot = await canonical.inbox.next('WitherSnapshot', (message) => message.revision === canonicalRevision)
    expect(healthPointsOf(rejoinSnapshot)).toBeLessThan(296)
  } finally {
    alice.socket.close()
    bob.socket.close()
    rejoined?.close()
    await stopServer(server.process, server.stateDirectory)
  }
})
