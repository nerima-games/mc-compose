import {
  TransportError,
  type TransportService,
  type WireText,
} from '@nerima-games/mx-multiplayer'
import { Deferred, Effect, Queue } from 'effect'

export type WebSocketTransportState = 'connecting' | 'open' | 'closed'

export type WebSocketMessageEvent = {
  readonly data: unknown
}

export type WebSocketCloseEvent = {
  readonly code?: number
  readonly reason?: string
}

export type BrowserWebSocketEventMap = {
  readonly open: unknown
  readonly message: WebSocketMessageEvent
  readonly close: WebSocketCloseEvent
  readonly error: unknown
}

export interface BrowserWebSocketLike {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener<K extends keyof BrowserWebSocketEventMap>(
    type: K,
    listener: (event: BrowserWebSocketEventMap[K]) => void,
  ): void
  removeEventListener<K extends keyof BrowserWebSocketEventMap>(
    type: K,
    listener: (event: BrowserWebSocketEventMap[K]) => void,
  ): void
}

export interface BrowserWebSocketTransport extends TransportService {
  readonly close: Effect.Effect<void>
  readonly state: () => WebSocketTransportState
}

export type BrowserWebSocketTransportOptions = {
  readonly url: string
  readonly socketFactory?: (url: string) => BrowserWebSocketLike
  readonly inboundCapacity?: number
}

const defaultSocketFactory = (url: string): BrowserWebSocketLike => new WebSocket(url)

const closeDetail = (event: WebSocketCloseEvent): string => {
  const code = event.code === undefined ? 'unknown' : String(event.code)
  const reason = event.reason === undefined || event.reason.length === 0 ? 'no reason' : event.reason
  return `websocket closed (${code}: ${reason})`
}

export const makeBrowserWebSocketTransport = (
  options: BrowserWebSocketTransportOptions,
): Effect.Effect<BrowserWebSocketTransport, TransportError> =>
  Effect.gen(function* () {
    const capacity = options.inboundCapacity ?? 256
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return yield* Effect.fail(
        new TransportError({
          reason: 'not-connected',
          detail: `inboundCapacity must be a positive integer, received ${String(capacity)}`,
        }),
      )
    }

    // A dropping queue bounds memory without starting a suspended Effect fiber
    // from the browser's synchronous message callback. New frames are dropped
    // while the consumer is behind; protocol parsing remains the consumer's job.
    const inbound = yield* Queue.dropping<WireText>(capacity)
    const opened = yield* Deferred.make<void, TransportError>()
    const socket = yield* Effect.try({
      try: () => (options.socketFactory ?? defaultSocketFactory)(options.url),
      catch: (cause) =>
        new TransportError({
          reason: 'not-connected',
          detail: `websocket construction failed: ${String(cause)}`,
        }),
    })

    let currentState: WebSocketTransportState = 'connecting'
    let listenersAttached = true
    let disposed = false

    const detachListeners = (): void => {
      if (!listenersAttached) return
      listenersAttached = false
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      socket.removeEventListener('error', handleError)
    }

    const terminate = (error: TransportError, shutdownInbound: boolean): void => {
      if (currentState === 'closed') return
      currentState = 'closed'
      Effect.runSync(Deferred.fail(opened, error))
      detachListeners()
      if (shutdownInbound) Effect.runSync(Queue.shutdown(inbound))
    }

    function handleOpen(): void {
      if (currentState !== 'connecting') return
      currentState = 'open'
      Effect.runSync(Deferred.succeed(opened, undefined))
    }

    function handleMessage(event: WebSocketMessageEvent): void {
      if (currentState !== 'open' || typeof event.data !== 'string') return
      Queue.unsafeOffer(inbound, event.data as WireText)
    }

    function handleClose(event: WebSocketCloseEvent): void {
      terminate(
        new TransportError({ reason: 'closed', detail: closeDetail(event) }),
        false,
      )
    }

    function handleError(): void {
      terminate(
        new TransportError({ reason: 'send-failed', detail: 'websocket emitted an error event' }),
        false,
      )
    }

    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleError)

    const send = (frame: WireText): Effect.Effect<void, TransportError> =>
      Deferred.await(opened).pipe(
        Effect.flatMap(() =>
          Effect.suspend(() => {
            if (currentState !== 'open' || socket.readyState !== 1) {
              return Effect.fail(
                new TransportError({
                  reason: 'not-connected',
                  detail: 'send attempted while websocket was not open',
                }),
              )
            }
            return Effect.try({
              try: () => socket.send(frame),
              catch: (cause) => {
                const error = new TransportError({
                  reason: 'send-failed',
                  detail: `websocket send failed: ${String(cause)}`,
                })
                terminate(error, false)
                return error
              },
            })
          }),
        ),
      )

    const close = Effect.sync(() => {
      if (disposed) return
      disposed = true
      const shouldCloseSocket = socket.readyState === 0 || socket.readyState === 1
      terminate(
        new TransportError({ reason: 'closed', detail: 'websocket transport disposed locally' }),
        false,
      )
      detachListeners()
      Effect.runSync(Queue.shutdown(inbound))
      if (shouldCloseSocket) socket.close(1000, 'transport disposed')
    })

    return { send, inbound, close, state: () => currentState }
  })
