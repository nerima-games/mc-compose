import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server as HttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

import { blockTypeOfId } from '@nerima-games/mc-kernel'
import {
  blockPosition,
  CHUNK_HEIGHT,
  chunkCoordOfBlock,
  generateChunkAt,
  getBlockAt,
  localCoordOfBlock,
  type Chunk,
} from '@nerima-games/mc-worldgen'
import {
  AuthoritativeSnapshot,
  PlayerId as PlayerIdSchema,
  decodeFrame,
  type BlockPos,
  type Orientation,
  type PlayerId,
  type WireText,
} from '@nerima-games/mx-multiplayer'
import { Either, Schema } from 'effect'
import { WebSocket, WebSocketServer } from 'ws'

import { makeMultiplayerServerCore, type MultiplayerServerState } from './core'
import { loadLegacyPlayerClaims } from './legacy-player-claims'
import { createReconnectAuth } from './reconnect-auth'
import { isAllowedWebSocketOrigin, resolveTransportSecurity } from './transport-security'

const DEFAULT_BLOCKS = [
  'bedrock',
  'coal_ore',
  'cobblestone',
  'dirt',
  'grass_block',
  'gravel',
  'iron_ore',
  'oak_leaves',
  'oak_log',
  'oak_planks',
  'sand',
  'stone',
] as const

export interface MultiplayerRuntimeOptions {
  readonly host: string
  readonly port: number
  readonly worldId: string
  readonly seed: number
  readonly allowedBlocks?: ReadonlySet<string>
  readonly installSignalHandlers?: boolean
  readonly stateFile?: string
  readonly tlsCert?: string
  readonly tlsKey?: string
  readonly allowedOrigins?: string
  readonly legacyPlayerClaimsFile?: string
}

export interface MultiplayerRuntime {
  readonly host: string
  readonly port: number
  readonly close: () => Promise<void>
}

type PlayerResume = Readonly<{
  _tag: 'PlayerResume'
  player: PlayerId
  token?: string
  registrationToken?: string
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodePlayerResume = (frame: string): PlayerResume | undefined => {
  let value: unknown
  try {
    value = JSON.parse(frame)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const resume = value
  if (
    resume['_tag'] !== 'PlayerResume'
    || typeof resume['player'] !== 'string'
    || resume['player'].length === 0
    || (resume['token'] !== undefined && typeof resume['token'] !== 'string')
    || (resume['registrationToken'] !== undefined && typeof resume['registrationToken'] !== 'string')
  ) return undefined
  const player = Schema.decodeUnknownEither(PlayerIdSchema)(resume['player'])
  if (Either.isLeft(player)) return undefined
  return {
    _tag: 'PlayerResume',
    player: player.right,
    ...(resume['token'] === undefined ? {} : { token: resume['token'] }),
    ...(resume['registrationToken'] === undefined ? {} : { registrationToken: resume['registrationToken'] }),
  }
}

const encodePlayerResumeAccepted = (player: PlayerId, token: string): string => JSON.stringify({
  _tag: 'PlayerResumeAccepted',
  player,
  token,
})

const valueAfter = (arguments_: ReadonlyArray<string>, name: string): string | undefined => {
  const equalsPrefix = `--${name}=`
  const equalsValue = arguments_.find((argument) => argument.startsWith(equalsPrefix))
  if (equalsValue !== undefined) return equalsValue.slice(equalsPrefix.length)
  const index = arguments_.indexOf(`--${name}`)
  return index >= 0 ? arguments_[index + 1] : undefined
}

const integerOption = (value: string | undefined, fallback: number, name: string): number => {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`)
  return parsed
}

export const resolveMultiplayerRuntimeOptions = (
  arguments_: ReadonlyArray<string> = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
): MultiplayerRuntimeOptions => {
  const port = integerOption(valueAfter(arguments_, 'port') ?? environment['MULTIPLAYER_PORT'], 5182, 'port')
  const stateFile = valueAfter(arguments_, 'state-file') ?? environment['MULTIPLAYER_STATE_FILE']
  const tlsCert = valueAfter(arguments_, 'tls-cert') ?? environment['MULTIPLAYER_TLS_CERT']
  const tlsKey = valueAfter(arguments_, 'tls-key') ?? environment['MULTIPLAYER_TLS_KEY']
  const allowedOrigins = valueAfter(arguments_, 'allowed-origins') ?? environment['MULTIPLAYER_ALLOWED_ORIGINS']
  const legacyPlayerClaimsFile = valueAfter(arguments_, 'legacy-player-claims-file')
    ?? environment['MULTIPLAYER_LEGACY_PLAYER_CLAIMS_FILE']
  if (port < 0 || port > 65_535) throw new Error('port must be between 0 and 65535')
  const options: MultiplayerRuntimeOptions = {
    host: valueAfter(arguments_, 'host') ?? environment['MULTIPLAYER_HOST'] ?? '127.0.0.1',
    port,
    worldId: valueAfter(arguments_, 'world') ?? environment['MULTIPLAYER_WORLD'] ?? 'overworld',
    seed: integerOption(valueAfter(arguments_, 'seed') ?? environment['MULTIPLAYER_SEED'], 0, 'seed'),
    ...(stateFile === undefined ? {} : { stateFile }),
    ...(tlsCert === undefined ? {} : { tlsCert }),
    ...(tlsKey === undefined ? {} : { tlsKey }),
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    ...(legacyPlayerClaimsFile === undefined ? {} : { legacyPlayerClaimsFile }),
    installSignalHandlers: true,
  }
  resolveTransportSecurity(options)
  return options
}

interface PersistedServerState {
  readonly format: 1
  readonly worldId: string
  readonly seed: number
  readonly state: MultiplayerServerState
}

const isBlockPos = (value: unknown): value is BlockPos => {
  if (!isRecord(value)) return false
  const position = value
  return Number.isInteger(position['x']) && Number.isInteger(position['y']) && Number.isInteger(position['z'])
}

const isPlayerPosition = (value: unknown): value is BlockPos => {
  if (!isRecord(value)) return false
  const position = value
  return typeof position['x'] === 'number' && Number.isFinite(position['x'])
    && typeof position['y'] === 'number' && Number.isFinite(position['y'])
    && typeof position['z'] === 'number' && Number.isFinite(position['z'])
}

const isOrientation = (value: unknown): value is Orientation => {
  if (!isRecord(value)) return false
  const orientation = value
  return typeof orientation['yawRadians'] === 'number' && Number.isFinite(orientation['yawRadians'])
    && typeof orientation['pitchRadians'] === 'number' && Number.isFinite(orientation['pitchRadians'])
}

const decodeServerState = (value: unknown, worldId: string): MultiplayerServerState | undefined => {
  if (!isRecord(value)) return undefined
  const state = value
  const revision = state['revision']
  const blocksValue = state['blocks']
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0 || !Array.isArray(blocksValue)) return undefined
  const blocks = blocksValue.flatMap((entry: unknown) => {
    if (!isRecord(entry) || !isBlockPos(entry['at']) || (entry['block'] !== null && typeof entry['block'] !== 'string')) return []
    return [{ at: entry['at'], block: entry['block'] }]
  })
  if (blocks.length !== blocksValue.length) return undefined

  const playerPositionsValue = state['playerPositions']
  if (playerPositionsValue !== undefined && !Array.isArray(playerPositionsValue)) return undefined
  const playerPositions = playerPositionsValue === undefined
    ? []
    : playerPositionsValue.flatMap((entry: unknown) => {
        if (!isRecord(entry) || !isPlayerPosition(entry['at']) || !isOrientation(entry['facing'])) return []
        const player = Schema.decodeUnknownEither(PlayerIdSchema)(entry['player'])
        return Either.isLeft(player) ? [] : [{ player: player.right, at: entry['at'], facing: entry['facing'] }]
      })
  if (playerPositionsValue !== undefined && playerPositions.length !== playerPositionsValue.length) return undefined

  const decoded = Schema.decodeUnknownEither(AuthoritativeSnapshot)({
    _tag: 'AuthoritativeSnapshot',
    world: worldId,
    revision,
    inventories: state['inventories'] ?? [],
    vitals: state['vitals'] ?? [],
    timeWeather: state['timeWeather'] ?? { timeOfDay: 6_000, weather: 'clear' },
    containers: state['containers'] ?? [],
    furnaces: state['furnaces'] ?? [],
    villagerTrades: state['villagerTrades'] ?? [],
    entities: state['entities'] ?? [],
  })
  if (Either.isLeft(decoded)) return undefined
  const snapshot = decoded.right
  return {
    revision: snapshot.revision,
    blocks,
    inventories: snapshot.inventories,
    vitals: snapshot.vitals,
    timeWeather: snapshot.timeWeather,
    containers: snapshot.containers,
    furnaces: snapshot.furnaces,
    villagerTrades: snapshot.villagerTrades,
    entities: snapshot.entities ?? [],
    playerPositions,
    ...(state['wither'] === undefined ? {} : { wither: state['wither'] as NonNullable<MultiplayerServerState['wither']> }),
    ...(Number.isInteger(state['witherRevision']) ? { witherRevision: state['witherRevision'] as number } : {}),
  }
}

const loadServerState = async (
  path: string,
  worldId: string,
  seed: number,
): Promise<MultiplayerServerState | undefined> => {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`Failed to read multiplayer state: ${path}`, { cause: error })
  }
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`Failed to read multiplayer state: ${path}`, { cause: error })
  }
  if (!isRecord(value)) throw new Error(`invalid multiplayer state file: ${path}`)
  const persisted = value
  if (persisted['format'] !== 1 || persisted['worldId'] !== worldId || persisted['seed'] !== seed) {
    throw new Error(`multiplayer state file does not match world ${worldId} and seed ${String(seed)}: ${path}`)
  }
  const state = decodeServerState(persisted['state'], worldId)
  if (state === undefined) {
    throw new Error(`multiplayer state file does not match world ${worldId} and seed ${String(seed)}: ${path}`)
  }
  return state
}

const writeServerState = async (
  path: string,
  worldId: string,
  seed: number,
  state: MultiplayerServerState,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
  const persisted: PersistedServerState = { format: 1, worldId, seed, state }
  await writeFile(temporaryPath, `${JSON.stringify(persisted)}\n`, 'utf8')
  await rename(temporaryPath, path)
}

export type LatestStatePersistence<State> = {
  readonly request: (state: State) => void
  readonly drain: () => Promise<void>
}

export const createLatestStatePersistence = <State>(
  write: (state: State) => Promise<void>,
): LatestStatePersistence<State> => {
  let pending!: State
  let hasPending = false
  let running: Promise<void> | undefined
  let failure: unknown

  const start = (): void => {
    if (running !== undefined || !hasPending) return
    let complete!: () => void
    running = new Promise<void>((resolve) => { complete = resolve })
    void (async () => {
      while (hasPending) {
        const state = pending
        hasPending = false
        try {
          await write(state)
          failure = undefined
        } catch (error: unknown) {
          if (!hasPending) {
            pending = state
            hasPending = true
          }
          failure = error
          return
        }
      }
    })().finally(() => {
      running = undefined
      if (hasPending && failure === undefined) start()
      complete()
    })
  }

  return {
    request: (state) => {
      pending = state
      hasPending = true
      start()
    },
    drain: async () => {
      while (running !== undefined || hasPending) {
        start()
        await running
        if (failure !== undefined) throw failure
      }
    },
  }
}

export const makeGeneratedBlockAt = (seed: number): ((position: BlockPos) => string | null) => {
  const chunks = new Map<string, Chunk>()
  return (at) => {
    if (!Number.isInteger(at.x) || !Number.isInteger(at.y) || !Number.isInteger(at.z) || at.y < 0 || at.y >= CHUNK_HEIGHT) return null
    const position = blockPosition(at.x, at.y, at.z)
    const coordinate = chunkCoordOfBlock(position)
    const key = `${String(coordinate.cx)},${String(coordinate.cz)}`
    let chunk = chunks.get(key)
    if (chunk === undefined) {
      chunk = generateChunkAt(seed, coordinate.cx, coordinate.cz)
      chunks.set(key, chunk)
    }
    const local = localCoordOfBlock(position)
    const block = blockTypeOfId(getBlockAt(chunk, local.lx, local.ly, local.lz))
    return block === undefined || block === 'air' ? null : block
  }
}

const findSpawnAt = (generatedBlockAt: (position: BlockPos) => string | null): BlockPos => {
  for (let y = CHUNK_HEIGHT - 2; y >= 0; y -= 1) {
    if (
      generatedBlockAt({ x: 0, y, z: 0 }) !== null
      && generatedBlockAt({ x: 0, y: y + 1, z: 0 }) === null
      && generatedBlockAt({ x: 0, y: y + 2, z: 0 }) === null
    ) return { x: 0, y: y + 1, z: 0 }
  }
  return { x: 0, y: 64, z: 0 }
}

const listen = (server: HttpServer, port: number, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('multiplayer server did not bind a TCP address'))
        return
      }
      resolve(address.port)
    })
  })

export const startMultiplayerServer = async (options: MultiplayerRuntimeOptions): Promise<MultiplayerRuntime> => {
  const transportSecurity = resolveTransportSecurity(options)
  const initialState = options.stateFile === undefined
    ? undefined
    : await loadServerState(options.stateFile, options.worldId, options.seed)
  const legacyPlayers = new Set([
    ...(initialState?.inventories.map(({ player }) => player) ?? []),
    ...(initialState?.vitals.map(({ player }) => player) ?? []),
    ...(initialState?.playerPositions?.map(({ player }) => player) ?? []),
  ])
  const legacyPlayerClaims = options.legacyPlayerClaimsFile === undefined
    ? undefined
    : await loadLegacyPlayerClaims(options.legacyPlayerClaimsFile)
  const reconnectAuth = await createReconnectAuth(options.stateFile)
  const persistence = options.stateFile === undefined
    ? undefined
    : createLatestStatePersistence((state: MultiplayerServerState) =>
        writeServerState(options.stateFile as string, options.worldId, options.seed, state),
      )
  const generatedBlockAt = makeGeneratedBlockAt(options.seed)
  const core = makeMultiplayerServerCore({
    worldId: options.worldId,
    seed: options.seed,
    allowedBlocks: options.allowedBlocks ?? new Set(DEFAULT_BLOCKS),
    generatedBlockAt,
    spawnAt: findSpawnAt(generatedBlockAt),
    ...(initialState === undefined ? {} : { initialState }),
    ...(persistence === undefined ? {} : { onStateChanged: persistence.request }),
    passableBlocks: new Set(['water']),
  })
  const requestHandler: RequestListener = (request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ status: 'ok', world: options.worldId }))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  }
  const server: HttpServer = transportSecurity.secure
    ? createHttpsServer({
        cert: await readFile(transportSecurity.tlsCert as string),
        key: await readFile(transportSecurity.tlsKey as string),
      }, requestHandler)
    : createServer(requestHandler)
  const sockets = new WebSocketServer({ noServer: true })
  const activePlayers = new Map<string, string>()
  const reservedPlayers = new Set<string>()

  server.on('upgrade', (request, socket, head) => {
    if (!isAllowedWebSocketOrigin(request.headers.origin, transportSecurity)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
    if (path !== '/ws') {
      socket.destroy()
      return
    }
    sockets.handleUpgrade(request, socket, head, (webSocket) => sockets.emit('connection', webSocket, request))
  })

  sockets.on('connection', (socket) => {
    const clientId = randomUUID()
    let disconnected = false
    let authenticatedPlayer: PlayerId | undefined
    let activePlayer: PlayerId | undefined
    let _messageQueue = Promise.resolve()
    const disconnect = (): void => {
      if (disconnected) return
      disconnected = true
      if (authenticatedPlayer !== undefined) reservedPlayers.delete(authenticatedPlayer)
      if (activePlayer !== undefined && activePlayers.get(activePlayer) === clientId) {
        activePlayers.delete(activePlayer)
      }
      core.disconnect(clientId)
    }
    const rejectHandshake = (): void => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1008, 'reconnect authentication failed')
    }
    const authenticate = async (resume: PlayerResume): Promise<void> => {
      const player = resume.player
      if (activePlayers.has(player) || reservedPlayers.has(player)) {
        rejectHandshake()
        return
      }
      reservedPlayers.add(player)
      try {
        let token: string | undefined
        if (reconnectAuth.has(player)) {
          token = resume.token === undefined ? undefined : await reconnectAuth.rotate(player, resume.token)
        } else if (legacyPlayers.has(player)) {
          token = resume.registrationToken !== undefined
            && legacyPlayerClaims?.has(player) === true
            && legacyPlayerClaims.verify(player, resume.registrationToken)
            ? await reconnectAuth.issue(player)
            : undefined
        } else {
          token = await reconnectAuth.issue(player)
        }
        if (token === undefined || disconnected) {
          reservedPlayers.delete(player)
          rejectHandshake()
          return
        }
        authenticatedPlayer = player
        socket.send(encodePlayerResumeAccepted(player, token))
      } catch {
        reservedPlayers.delete(player)
        rejectHandshake()
      }
    }
    core.connect(clientId, (frame) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame)
    })
    socket.on('message', (data, isBinary) => {
      if (isBinary) return
      const frame = data.toString() as WireText
      _messageQueue = _messageQueue.then(async () => {
        if (disconnected) return
        if (activePlayer !== undefined) {
          core.receive(clientId, frame)
          return
        }
        if (authenticatedPlayer === undefined) {
          const resume = decodePlayerResume(frame)
          if (resume === undefined) {
            rejectHandshake()
            return
          }
          await authenticate(resume)
          return
        }
        const decoded = decodeFrame(frame)
        if (
          Either.isLeft(decoded)
          || decoded.right._tag !== 'PlayerJoin'
          || decoded.right.player !== authenticatedPlayer
        ) {
          reservedPlayers.delete(authenticatedPlayer)
          rejectHandshake()
          return
        }
        const result = core.receive(clientId, frame)
        if (!result.accepted) {
          reservedPlayers.delete(authenticatedPlayer)
          rejectHandshake()
          return
        }
        activePlayer = authenticatedPlayer
        activePlayers.set(activePlayer, clientId)
        reservedPlayers.delete(activePlayer)
      }).catch(() => rejectHandshake())
    })
    socket.once('close', disconnect)
    socket.once('error', disconnect)
  })

  const port = await listen(server, options.port, options.host)
  const hungerTimer = setInterval(() => core.tick(4_000), 4_000)
  let closing: Promise<void> | undefined
  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing
    closing = new Promise<void>((resolve, reject) => {
      clearInterval(hungerTimer)
      for (const [signal, handler] of signalHandlers) process.off(signal, handler)
      for (const socket of sockets.clients) socket.close(1001, 'server shutting down')
      sockets.close()
      server.close((error) => error === undefined ? resolve() : reject(error))
    }).then(async () => {
      await persistence?.drain()
    })
    return closing
  }

  if (options.installSignalHandlers === true) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const handler = (): void => {
        void close().then(() => process.exit(0), () => process.exit(1))
      }
      signalHandlers.set(signal, handler)
      process.once(signal, handler)
    }
  }

  return { host: options.host, port, close }
}

const entryPoint = process.argv[1]
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  const options = resolveMultiplayerRuntimeOptions()
  const runtime = await startMultiplayerServer(options)
  const scheme = options.tlsCert === undefined ? 'ws' : 'wss'
  process.stdout.write(`multiplayer server listening on ${scheme}://${runtime.host}:${String(runtime.port)}/ws\n`)
}
