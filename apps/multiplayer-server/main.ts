import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer, type Server as HttpServer } from 'node:http'
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
import { AuthoritativeSnapshot, type BlockPos, type WireText } from '@nerima-games/mx-multiplayer'
import { Either, Schema } from 'effect'
import { WebSocket, WebSocketServer } from 'ws'

import { makeMultiplayerServerCore, type MultiplayerServerState } from './core'

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
}

export interface MultiplayerRuntime {
  readonly host: string
  readonly port: number
  readonly close: () => Promise<void>
}

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
  if (port < 0 || port > 65_535) throw new Error('port must be between 0 and 65535')
  return {
    host: valueAfter(arguments_, 'host') ?? environment['MULTIPLAYER_HOST'] ?? '127.0.0.1',
    port,
    worldId: valueAfter(arguments_, 'world') ?? environment['MULTIPLAYER_WORLD'] ?? 'overworld',
    seed: integerOption(valueAfter(arguments_, 'seed') ?? environment['MULTIPLAYER_SEED'], 0, 'seed'),
    ...(stateFile === undefined ? {} : { stateFile }),
    installSignalHandlers: true,
  }
}

interface PersistedServerState {
  readonly format: 1
  readonly worldId: string
  readonly seed: number
  readonly state: MultiplayerServerState
}

const isBlockPos = (value: unknown): value is BlockPos => {
  if (typeof value !== 'object' || value === null) return false
  const position = value as Record<string, unknown>
  return Number.isInteger(position['x']) && Number.isInteger(position['y']) && Number.isInteger(position['z'])
}

const decodeServerState = (value: unknown, worldId: string): MultiplayerServerState | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const state = value as Record<string, unknown>
  if (!Number.isInteger(state['revision']) || (state['revision'] as number) < 0 || !Array.isArray(state['blocks'])) return undefined
  if (!state['blocks'].every((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false
    const mutation = entry as Record<string, unknown>
    return isBlockPos(mutation['at']) && (mutation['block'] === null || typeof mutation['block'] === 'string')
  })) return undefined

  const decoded = Schema.decodeUnknownEither(AuthoritativeSnapshot)({
    _tag: 'AuthoritativeSnapshot',
    world: worldId,
    revision: state['revision'],
    inventories: state['inventories'] ?? [],
    vitals: state['vitals'] ?? [],
    timeWeather: state['timeWeather'] ?? { timeOfDay: 6_000, weather: 'clear' },
    containers: state['containers'] ?? [],
    furnaces: state['furnaces'] ?? [],
    villagerTrades: state['villagerTrades'] ?? [],
  })
  if (Either.isLeft(decoded)) return undefined
  const snapshot = decoded.right
  return {
    revision: snapshot.revision,
    blocks: state['blocks'] as MultiplayerServerState['blocks'],
    inventories: snapshot.inventories,
    vitals: snapshot.vitals,
    timeWeather: snapshot.timeWeather,
    containers: snapshot.containers,
    furnaces: snapshot.furnaces,
    villagerTrades: snapshot.villagerTrades,
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
  if (typeof value !== 'object' || value === null) throw new Error(`invalid multiplayer state file: ${path}`)
  const persisted = value as Record<string, unknown>
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
  const initialState = options.stateFile === undefined
    ? undefined
    : await loadServerState(options.stateFile, options.worldId, options.seed)
  let persistenceQueue = Promise.resolve()
  let persistenceFailure: unknown
  const persist = options.stateFile === undefined
    ? undefined
    : (state: MultiplayerServerState): void => {
        persistenceQueue = persistenceQueue
          .then(() => writeServerState(options.stateFile as string, options.worldId, options.seed, state))
          .catch((error: unknown) => { persistenceFailure = error })
      }
  const core = makeMultiplayerServerCore({
    worldId: options.worldId,
    seed: options.seed,
    allowedBlocks: options.allowedBlocks ?? new Set(DEFAULT_BLOCKS),
    generatedBlockAt: makeGeneratedBlockAt(options.seed),
    ...(initialState === undefined ? {} : { initialState }),
    ...(persist === undefined ? {} : { onStateChanged: persist }),
    passableBlocks: new Set(['water']),
  })
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ status: 'ok', world: options.worldId }))
      return
    }
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
  })
  const sockets = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
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
    const disconnect = (): void => {
      if (disconnected) return
      disconnected = true
      core.disconnect(clientId)
    }
    core.connect(clientId, (frame) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(frame)
    })
    socket.on('message', (data, isBinary) => {
      if (!isBinary) core.receive(clientId, data.toString() as WireText)
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
      await persistenceQueue
      if (persistenceFailure !== undefined) throw persistenceFailure
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
  process.stdout.write(`multiplayer server listening on ws://${runtime.host}:${String(runtime.port)}/ws\n`)
}
