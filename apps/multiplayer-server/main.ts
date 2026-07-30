import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import { pathToFileURL } from 'node:url'

import type { WireText } from '@nerima-games/mx-multiplayer'
import { WebSocket, WebSocketServer } from 'ws'

import { makeMultiplayerServerCore } from './core'

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
  if (port < 0 || port > 65_535) throw new Error('port must be between 0 and 65535')
  return {
    host: valueAfter(arguments_, 'host') ?? environment['MULTIPLAYER_HOST'] ?? '127.0.0.1',
    port,
    worldId: valueAfter(arguments_, 'world') ?? environment['MULTIPLAYER_WORLD'] ?? 'overworld',
    seed: integerOption(valueAfter(arguments_, 'seed') ?? environment['MULTIPLAYER_SEED'], 0, 'seed'),
    installSignalHandlers: true,
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
  const core = makeMultiplayerServerCore({
    worldId: options.worldId,
    seed: options.seed,
    allowedBlocks: options.allowedBlocks ?? new Set(DEFAULT_BLOCKS),
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
  let closing: Promise<void> | undefined
  const signalHandlers = new Map<NodeJS.Signals, () => void>()
  const close = (): Promise<void> => {
    if (closing !== undefined) return closing
    closing = new Promise((resolve, reject) => {
      for (const [signal, handler] of signalHandlers) process.off(signal, handler)
      for (const socket of sockets.clients) socket.close(1001, 'server shutting down')
      sockets.close()
      server.close((error) => error === undefined ? resolve() : reject(error))
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
