import { TransportError, type WireText } from '@nerima-games/mx-multiplayer'
import { Effect, Either, Fiber, Queue } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeBrowserWebSocketTransport,
  type BrowserWebSocketEventMap,
  type BrowserWebSocketLike,
} from '../apps/web/multiplayer-websocket'

class SocketDouble implements BrowserWebSocketLike {
  readyState = 0
  readonly sent: Array<string> = []
  readonly closes: Array<readonly [number | undefined, string | undefined]> = []
  readonly listeners = new Map<keyof BrowserWebSocketEventMap, Set<(event: never) => void>>()
  sendFailure: unknown | undefined

  send(data: string): void {
    if (this.sendFailure !== undefined) throw this.sendFailure
    this.sent.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = 3
    this.closes.push([code, reason])
  }

  addEventListener<K extends keyof BrowserWebSocketEventMap>(
    type: K,
    listener: (event: BrowserWebSocketEventMap[K]) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener as (event: never) => void)
    this.listeners.set(type, listeners)
  }

  removeEventListener<K extends keyof BrowserWebSocketEventMap>(
    type: K,
    listener: (event: BrowserWebSocketEventMap[K]) => void,
  ): void {
    this.listeners.get(type)?.delete(listener as (event: never) => void)
  }

  emit<K extends keyof BrowserWebSocketEventMap>(type: K, event: BrowserWebSocketEventMap[K]): void {
    if (type === 'open') this.readyState = 1
    if (type === 'close') this.readyState = 3
    for (const listener of this.listeners.get(type) ?? []) listener(event as never)
  }

  listenerCount(): number {
    return Array.from(this.listeners.values()).reduce((count, listeners) => count + listeners.size, 0)
  }
}

const makeTransport = (socket: SocketDouble, inboundCapacity = 2) =>
  Effect.runPromise(
    makeBrowserWebSocketTransport({
      url: 'ws://example.test/world',
      socketFactory: () => socket,
      inboundCapacity,
    }),
  )

describe('browser websocket transport', () => {
  it('waits for open before sending a frame', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket)
    const sending = Effect.runPromise(transport.send('hello' as WireText))

    await Promise.resolve()
    expect(socket.sent).toEqual([])

    socket.emit('open', undefined)
    await sending
    expect(socket.sent).toEqual(['hello'])
    expect(transport.state()).toBe('open')
  })

  it('does not resume an interrupted send when the socket later opens', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket)
    const sending = Effect.runFork(transport.send('cancelled' as WireText))

    await Effect.runPromise(Fiber.interrupt(sending))
    socket.emit('open', undefined)
    await Effect.runPromise(transport.send('live' as WireText))

    expect(socket.sent).toEqual(['live'])
    expect(socket.listenerCount()).toBe(4)
  })

  it('queues only string messages and drops new frames at capacity', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket, 2)
    socket.emit('open', undefined)

    socket.emit('message', { data: 'first' })
    socket.emit('message', { data: new Uint8Array([1, 2]) })
    socket.emit('message', { data: 'second' })
    socket.emit('message', { data: 'dropped' })

    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.inbound)))).toEqual([
      'first',
      'second',
    ])
  })

  it('fails a pending and subsequent send when the peer closes', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket)
    const pending = Effect.runPromise(Effect.either(transport.send('pending' as WireText)))

    socket.emit('close', { code: 1006, reason: 'peer vanished' })
    const first = await pending
    const second = await Effect.runPromise(Effect.either(transport.send('later' as WireText)))

    expect(Either.isLeft(first)).toBe(true)
    expect(Either.isLeft(second)).toBe(true)
    if (Either.isLeft(first)) expect(first.left).toMatchObject({ reason: 'closed' })
    expect(transport.state()).toBe('closed')
    expect(socket.listenerCount()).toBe(0)
  })

  it('turns socket error and send exceptions into TransportError', async () => {
    const erroredSocket = new SocketDouble()
    const errored = await makeTransport(erroredSocket)
    const pending = Effect.runPromise(Effect.either(errored.send('pending' as WireText)))
    erroredSocket.emit('error', new Error('network'))

    const errorResult = await pending
    expect(Either.isLeft(errorResult)).toBe(true)
    if (Either.isLeft(errorResult)) {
      expect(errorResult.left).toBeInstanceOf(TransportError)
      expect(errorResult.left.reason).toBe('send-failed')
    }

    const throwingSocket = new SocketDouble()
    const throwing = await makeTransport(throwingSocket)
    throwingSocket.emit('open', undefined)
    throwingSocket.sendFailure = new Error('write rejected')
    const sendResult = await Effect.runPromise(Effect.either(throwing.send('frame' as WireText)))
    expect(Either.isLeft(sendResult)).toBe(true)
    if (Either.isLeft(sendResult)) expect(sendResult.left.reason).toBe('send-failed')
    expect(throwing.state()).toBe('closed')
  })

  it('disposes idempotently, closes the socket, shuts down inbound, and removes listeners', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket)
    socket.emit('open', undefined)

    await Effect.runPromise(transport.close)
    await Effect.runPromise(transport.close)

    expect(socket.closes).toEqual([[1000, 'transport disposed']])
    expect(socket.listenerCount()).toBe(0)
    expect(transport.state()).toBe('closed')
    expect(await Effect.runPromise(Queue.isShutdown(transport.inbound))).toBe(true)
  })

  it('reports construction and invalid capacity failures as typed errors', async () => {
    const construction = await Effect.runPromise(
      Effect.either(
        makeBrowserWebSocketTransport({
          url: 'ws://example.test/world',
          socketFactory: () => {
            throw new Error('constructor rejected URL')
          },
        }),
      ),
    )
    const capacity = await Effect.runPromise(
      Effect.either(
        makeBrowserWebSocketTransport({
          url: 'ws://example.test/world',
          socketFactory: () => new SocketDouble(),
          inboundCapacity: 0,
        }),
      ),
    )

    expect(Either.isLeft(construction)).toBe(true)
    expect(Either.isLeft(capacity)).toBe(true)
    if (Either.isLeft(construction)) expect(construction.left).toBeInstanceOf(TransportError)
    if (Either.isLeft(capacity)) expect(capacity.left).toBeInstanceOf(TransportError)
  })
})
