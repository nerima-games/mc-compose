import {
  TransportError,
  type TransportService,
  type WireText,
} from '@nerima-games/mx-multiplayer'
import { Deferred, Effect, Queue } from 'effect'
import {
  decodePlayerDamageWireMessage,
  encodePlayerDamageCommand,
  type PlayerDamageCommand,
  type PlayerDamageWireMessage,
} from '../multiplayer-shared/player-damage-network'
import { decodeCraftingWireMessage, encodeCraftingCommand, type CraftingCommand, type CraftingWireMessage } from '../multiplayer-shared/crafting-network'
import { decodeBrewingWireMessage, encodeBrewingCommand, type BrewingCommand, type BrewingWireMessage } from '../multiplayer-shared/brewing-network'
import { decodeSleepWireMessage, type SleepWireMessage } from '../multiplayer-shared/sleep-network'
import { decodeWitherWireMessage, type WitherWireMessage } from '../multiplayer-shared/wither-network'

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
  readonly sleepInbound: Queue.Dequeue<SleepWireMessage>
  readonly witherInbound: Queue.Dequeue<WitherWireMessage>
  readonly playerDamageInbound: Queue.Dequeue<PlayerDamageWireMessage>
  readonly craftingInbound: Queue.Dequeue<CraftingWireMessage>
  readonly brewingInbound: Queue.Dequeue<BrewingWireMessage>
  readonly sendSleep: (message: SleepWireMessage) => Effect.Effect<void, TransportError>
  readonly sendPlayerDamage: (command: PlayerDamageCommand) => Effect.Effect<void, TransportError>
  readonly sendCrafting: (command: CraftingCommand) => Effect.Effect<void, TransportError>
  readonly sendBrewing: (command: BrewingCommand) => Effect.Effect<void, TransportError>
  readonly state: () => WebSocketTransportState
}

export type BrowserWebSocketTransportOptions = {
  readonly url: string
  readonly socketFactory?: (url: string) => BrowserWebSocketLike
  readonly inboundCapacity?: number
  readonly reconnectAuth?: {
    readonly playerId: string
    readonly loadToken: () => string | undefined
    readonly saveToken: (token: string) => void
    readonly loadRegistrationToken?: () => string | undefined
    readonly clearRegistrationToken?: () => void
  }
}

type PlayerResumeAccepted = {
  readonly _tag: 'PlayerResumeAccepted'
  readonly player: string
  readonly token: string
}

const decodePlayerResumeAccepted = (frame: string): PlayerResumeAccepted | undefined => {
  let value: unknown
  try {
    value = JSON.parse(frame)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== 3 ||
    !keys.includes('_tag') ||
    !keys.includes('player') ||
    !keys.includes('token') ||
    record['_tag'] !== 'PlayerResumeAccepted' ||
    typeof record['player'] !== 'string' ||
    typeof record['token'] !== 'string'
  ) {
    return undefined
  }
  return {
    _tag: 'PlayerResumeAccepted',
    player: record['player'],
    token: record['token'],
  }
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

    // Browser message events cannot be backpressured. Unbounded queues preserve every
    // frame in arrival order until the consumer drains its inbound stream.
    const inbound = yield* Queue.unbounded<WireText>()
    const sleepInbound = yield* Queue.unbounded<SleepWireMessage>()
    const witherInbound = yield* Queue.unbounded<WitherWireMessage>()
    const playerDamageInbound = yield* Queue.unbounded<PlayerDamageWireMessage>()
    const craftingInbound = yield* Queue.unbounded<CraftingWireMessage>()
    const brewingInbound = yield* Queue.unbounded<BrewingWireMessage>()
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
    let awaitingResume = options.reconnectAuth !== undefined
    let sentRegistrationToken = false

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
      if (shutdownInbound) Effect.runSync(Queue.shutdown(sleepInbound))
      if (shutdownInbound) Effect.runSync(Queue.shutdown(witherInbound))
      if (shutdownInbound) Effect.runSync(Queue.shutdown(playerDamageInbound))
      if (shutdownInbound) Effect.runSync(Queue.shutdown(craftingInbound))
      if (shutdownInbound) Effect.runSync(Queue.shutdown(brewingInbound))
    }

    function handleOpen(): void {
      if (currentState !== 'connecting') return
      currentState = 'open'
      if (options.reconnectAuth === undefined) {
        Effect.runSync(Deferred.succeed(opened, undefined))
        return
      }
      try {
        const token = options.reconnectAuth.loadToken()
        const registrationToken =
          token === undefined ? options.reconnectAuth.loadRegistrationToken?.() : undefined
        sentRegistrationToken = registrationToken !== undefined
        socket.send(
          JSON.stringify({
            _tag: 'PlayerResume',
            player: options.reconnectAuth.playerId,
            token,
            registrationToken,
          }),
        )
      } catch (cause) {
        terminate(
          new TransportError({
            reason: 'send-failed',
            detail: `websocket resume authentication failed: ${String(cause)}`,
          }),
          false,
        )
      }
    }

    function handleMessage(event: WebSocketMessageEvent): void {
      if (currentState !== 'open' || typeof event.data !== 'string') return
      if (options.reconnectAuth !== undefined) {
        let parsed: unknown
        try {
          parsed = JSON.parse(event.data)
        } catch {
          parsed = undefined
        }
        if (
          typeof parsed === 'object' &&
          parsed !== null &&
          !Array.isArray(parsed) &&
          (parsed as Record<string, unknown>)['_tag'] === 'PlayerResumeAccepted'
        ) {
          if (!awaitingResume) return
          const accepted = decodePlayerResumeAccepted(event.data)
          if (accepted === undefined || accepted.player !== options.reconnectAuth.playerId) {
            terminate(
              new TransportError({
                reason: 'not-connected',
                detail: 'invalid websocket resume authentication response',
              }),
              false,
            )
            return
          }
          try {
            options.reconnectAuth.saveToken(accepted.token)
            if (sentRegistrationToken) options.reconnectAuth.clearRegistrationToken?.()
          } catch (cause) {
            terminate(
              new TransportError({
                reason: 'not-connected',
                detail: `failed to persist websocket resume token: ${String(cause)}`,
              }),
              false,
            )
            return
          }
          awaitingResume = false
          Effect.runSync(Deferred.succeed(opened, undefined))
          return
        }
      }
      const sleepMessage = decodeSleepWireMessage(event.data)
      if (sleepMessage !== undefined) {
        Queue.unsafeOffer(sleepInbound, sleepMessage)
        return
      }
      const witherMessage = decodeWitherWireMessage(event.data as WireText)
      if (witherMessage !== undefined) {
        Queue.unsafeOffer(witherInbound, witherMessage)
        return
      }
      const playerDamageMessage = decodePlayerDamageWireMessage(event.data as WireText)
      if (playerDamageMessage !== undefined) {
        Queue.unsafeOffer(playerDamageInbound, playerDamageMessage)
        return
      }
      const craftingMessage = decodeCraftingWireMessage(event.data as WireText)
      if (craftingMessage !== undefined) {
        Queue.unsafeOffer(craftingInbound, craftingMessage)
        return
      }
      const brewingMessage = decodeBrewingWireMessage(event.data as WireText)
      if (brewingMessage !== undefined) {
        Queue.unsafeOffer(brewingInbound, brewingMessage)
        return
      }
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
      Effect.runSync(Queue.shutdown(sleepInbound))
      Effect.runSync(Queue.shutdown(witherInbound))
      Effect.runSync(Queue.shutdown(playerDamageInbound))
      Effect.runSync(Queue.shutdown(craftingInbound))
      Effect.runSync(Queue.shutdown(brewingInbound))
      if (shouldCloseSocket) socket.close(1000, 'transport disposed')
    })

    const sendSleep = (message: SleepWireMessage): Effect.Effect<void, TransportError> =>
      send(JSON.stringify(message) as WireText)
    const sendPlayerDamage = (command: PlayerDamageCommand): Effect.Effect<void, TransportError> =>
      send(encodePlayerDamageCommand(command))
    const sendCrafting = (command: CraftingCommand): Effect.Effect<void, TransportError> =>
      send(encodeCraftingCommand(command))
    const sendBrewing = (command: BrewingCommand): Effect.Effect<void, TransportError> =>
      send(encodeBrewingCommand(command))
    return {
      send,
      inbound,
      sleepInbound,
      witherInbound,
      playerDamageInbound,
      craftingInbound,
      brewingInbound,
      sendSleep,
      sendPlayerDamage,
      sendCrafting,
      sendBrewing,
      close,
      state: () => currentState,
    }
  })
