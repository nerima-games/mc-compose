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

const makeAuthenticatedTransport = (
  socket: SocketDouble,
  auth: {
    readonly playerId: string
    readonly loadToken: () => string | undefined
    readonly saveToken: (token: string) => void
    readonly loadRegistrationToken?: () => string | undefined
    readonly clearRegistrationToken?: () => void
  },
) =>
  Effect.runPromise(
    makeBrowserWebSocketTransport({
      url: 'ws://example.test/world',
      socketFactory: () => socket,
      reconnectAuth: auth,
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

  it('authenticates on open and gates normal sends until resume is accepted', async () => {
    const socket = new SocketDouble()
    const saved: Array<string> = []
    const transport = await makeAuthenticatedTransport(socket, {
      playerId: 'alice',
      loadToken: () => 'old-token',
      saveToken: (token) => saved.push(token),
    })
    const sending = Effect.runPromise(transport.send('normal-frame' as WireText))

    socket.emit('open', undefined)
    await Promise.resolve()
    expect(socket.sent).toEqual([
      JSON.stringify({ _tag: 'PlayerResume', player: 'alice', token: 'old-token' }),
    ])

    socket.emit('message', {
      data: JSON.stringify({ _tag: 'PlayerResumeAccepted', player: 'alice', token: 'new-token' }),
    })
    await sending

    expect(socket.sent).toEqual([
      JSON.stringify({ _tag: 'PlayerResume', player: 'alice', token: 'old-token' }),
      'normal-frame',
    ])
    expect(saved).toEqual(['new-token'])
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.inbound)))).toEqual([])
  })

  it('omits an unavailable resume token while preserving unauthenticated compatibility', async () => {
    const authenticatedSocket = new SocketDouble()
    await makeAuthenticatedTransport(authenticatedSocket, {
      playerId: 'alice',
      loadToken: () => undefined,
      saveToken: () => undefined,
    })
    authenticatedSocket.emit('open', undefined)
    expect(authenticatedSocket.sent).toEqual([
      JSON.stringify({ _tag: 'PlayerResume', player: 'alice' }),
    ])

    const plainSocket = new SocketDouble()
    const plain = await makeTransport(plainSocket)
    const sending = Effect.runPromise(plain.send('plain' as WireText))
    plainSocket.emit('open', undefined)
    await sending
    expect(plainSocket.sent).toEqual(['plain'])
  })

  it('uses a registration token only when no reconnect token exists and clears it after acceptance', async () => {
    const registrationSocket = new SocketDouble()
    const registrationEvents: Array<string> = []
    const registrationTransport = await makeAuthenticatedTransport(registrationSocket, {
      playerId: 'legacy-alice',
      loadToken: () => undefined,
      saveToken: (token) => registrationEvents.push(`saved:${token}`),
      loadRegistrationToken: () => 'one-time-registration',
      clearRegistrationToken: () => registrationEvents.push('cleared'),
    })

    registrationSocket.emit('open', undefined)
    expect(registrationSocket.sent).toEqual([
      JSON.stringify({
        _tag: 'PlayerResume',
        player: 'legacy-alice',
        registrationToken: 'one-time-registration',
      }),
    ])
    registrationSocket.emit('message', {
      data: JSON.stringify({
        _tag: 'PlayerResumeAccepted',
        player: 'legacy-alice',
        token: 'reconnect-token',
      }),
    })

    expect(registrationEvents).toEqual(['saved:reconnect-token', 'cleared'])
    expect(registrationTransport.state()).toBe('open')

    const reconnectSocket = new SocketDouble()
    let registrationLoads = 0
    let registrationClears = 0
    await makeAuthenticatedTransport(reconnectSocket, {
      playerId: 'alice',
      loadToken: () => 'existing-reconnect-token',
      saveToken: () => undefined,
      loadRegistrationToken: () => {
        registrationLoads += 1
        return 'must-not-be-sent'
      },
      clearRegistrationToken: () => {
        registrationClears += 1
      },
    })
    reconnectSocket.emit('open', undefined)
    reconnectSocket.emit('message', {
      data: JSON.stringify({ _tag: 'PlayerResumeAccepted', player: 'alice', token: 'rotated' }),
    })

    expect(reconnectSocket.sent).toEqual([
      JSON.stringify({
        _tag: 'PlayerResume',
        player: 'alice',
        token: 'existing-reconnect-token',
      }),
    ])
    expect(registrationLoads).toBe(0)
    expect(registrationClears).toBe(0)
  })

  it('keeps the registration token when saving the accepted reconnect token fails', async () => {
    const socket = new SocketDouble()
    let cleared = false
    const transport = await makeAuthenticatedTransport(socket, {
      playerId: 'legacy-alice',
      loadToken: () => undefined,
      saveToken: () => {
        throw new Error('storage unavailable')
      },
      loadRegistrationToken: () => 'one-time-registration',
      clearRegistrationToken: () => {
        cleared = true
      },
    })
    const sending = Effect.runPromise(Effect.either(transport.send('blocked' as WireText)))

    socket.emit('open', undefined)
    socket.emit('message', {
      data: JSON.stringify({
        _tag: 'PlayerResumeAccepted',
        player: 'legacy-alice',
        token: 'reconnect-token',
      }),
    })

    expect(Either.isLeft(await sending)).toBe(true)
    expect(cleared).toBe(false)
    expect(transport.state()).toBe('closed')
  })

  it('rejects malformed or mismatched resume acceptance without saving a token', async () => {
    for (const response of [
      { _tag: 'PlayerResumeAccepted', player: 'bob', token: 'stolen' },
      { _tag: 'PlayerResumeAccepted', player: 'alice', token: 'new', extra: true },
    ]) {
      const socket = new SocketDouble()
      const saved: Array<string> = []
      const transport = await makeAuthenticatedTransport(socket, {
        playerId: 'alice',
        loadToken: () => undefined,
        saveToken: (token) => saved.push(token),
      })
      const sending = Effect.runPromise(Effect.either(transport.send('blocked' as WireText)))
      socket.emit('open', undefined)
      socket.emit('message', { data: JSON.stringify(response) })

      const result = await sending
      expect(Either.isLeft(result)).toBe(true)
      expect(saved).toEqual([])
      expect(transport.state()).toBe('closed')
      expect(socket.sent).toEqual([JSON.stringify({ _tag: 'PlayerResume', player: 'alice' })])
    }
  })

  it('consumes duplicate resume acceptance without saving or forwarding it again', async () => {
    const socket = new SocketDouble()
    const saved: Array<string> = []
    const transport = await makeAuthenticatedTransport(socket, {
      playerId: 'alice',
      loadToken: () => undefined,
      saveToken: (token) => saved.push(token),
    })
    socket.emit('open', undefined)
    socket.emit('message', {
      data: JSON.stringify({ _tag: 'PlayerResumeAccepted', player: 'alice', token: 'first' }),
    })
    socket.emit('message', {
      data: JSON.stringify({ _tag: 'PlayerResumeAccepted', player: 'alice', token: 'second' }),
    })

    expect(saved).toEqual(['first'])
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.inbound)))).toEqual([])
  })

  it('fails sends waiting for authentication on close, error, or resume setup failure', async () => {
    for (const failure of ['close', 'error', 'load-token'] as const) {
      const socket = new SocketDouble()
      const transport = await makeAuthenticatedTransport(socket, {
        playerId: 'alice',
        loadToken: () => {
          if (failure === 'load-token') throw new Error('storage unavailable')
          return undefined
        },
        saveToken: () => undefined,
      })
      const sending = Effect.runPromise(Effect.either(transport.send('blocked' as WireText)))

      socket.emit('open', undefined)
      if (failure === 'close') socket.emit('close', { code: 1006, reason: 'peer vanished' })
      if (failure === 'error') socket.emit('error', new Error('network'))

      const result = await sending
      expect(Either.isLeft(result)).toBe(true)
      expect(transport.state()).toBe('closed')
      expect(socket.listenerCount()).toBe(0)
    }
  })

  it('preserves ordered frames for every inbound queue beyond configured capacity', async () => {
    const socket = new SocketDouble()
    const transport = await makeTransport(socket, 2)
    socket.emit('open', undefined)

    const sleepFrames = [1, 2, 3].map((revision) => ({
      _tag: 'SleepEvents',
      revision,
      events: [],
    }))
    const witherFrames = [1, 2, 3].map((revision) => ({
      _tag: 'WitherCommandResult',
      requestId: `request-${revision}`,
      accepted: true,
      revision,
    }))
    const playerDamageFrames = [
      {
        _tag: 'PlayerDamageCommand',
        commandId: 'damage-1',
        player: 'alice',
        world: 'world',
        expectedRevision: 1,
        amount: 2,
      },
      {
        _tag: 'PlayerDamageCommandResult',
        commandId: 'damage-1',
        accepted: true,
        revision: 2,
      },
    ] as const
    const craftingFrames = [
      {
        _tag: 'CraftingCommand',
        commandId: 'craft-1',
        player: 'alice',
        world: 'world',
        expectedRevision: 1,
        grid: { width: 2, height: 2, cells: ['oak_log', null, null, null] },
      },
      {
        _tag: 'CraftingCommandResult',
        commandId: 'craft-1',
        accepted: true,
        revision: 2,
      },
    ] as const

    socket.emit('message', { data: 'first' })
    socket.emit('message', { data: JSON.stringify(sleepFrames[0]) })
    socket.emit('message', { data: JSON.stringify(witherFrames[0]) })
    socket.emit('message', { data: new Uint8Array([1, 2]) })
    socket.emit('message', { data: 'second' })
    socket.emit('message', { data: JSON.stringify(sleepFrames[1]) })
    socket.emit('message', { data: JSON.stringify(witherFrames[1]) })
    socket.emit('message', { data: JSON.stringify(playerDamageFrames[0]) })
    socket.emit('message', { data: 'third' })
    socket.emit('message', { data: JSON.stringify(sleepFrames[2]) })
    socket.emit('message', { data: JSON.stringify(witherFrames[2]) })
    socket.emit('message', { data: JSON.stringify(playerDamageFrames[1]) })
    socket.emit('message', { data: JSON.stringify(craftingFrames[0]) })
    socket.emit('message', { data: JSON.stringify(craftingFrames[1]) })

    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.inbound)))).toEqual([
      'first',
      'second',
      'third',
    ])
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.sleepInbound)))).toEqual(
      sleepFrames,
    )
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.witherInbound)))).toEqual(
      witherFrames,
    )
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.playerDamageInbound)))).toEqual(
      playerDamageFrames,
    )
    expect(Array.from(await Effect.runPromise(Queue.takeAll(transport.craftingInbound)))).toEqual(
      craftingFrames,
    )
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
    const command = {
      _tag: 'PlayerDamageCommand' as const,
      commandId: 'damage-send',
      player: 'alice',
      world: 'world',
      expectedRevision: 0,
      amount: 1,
    }
    await Effect.runPromise(throwing.sendPlayerDamage(command))
    expect(throwingSocket.sent).toEqual([JSON.stringify(command)])
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
    expect(await Effect.runPromise(Queue.isShutdown(transport.playerDamageInbound))).toBe(true)
    expect(await Effect.runPromise(Queue.isShutdown(transport.craftingInbound))).toBe(true)
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
