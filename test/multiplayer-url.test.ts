import { describe, expect, it } from 'vitest'

import { validateMultiplayerUrl } from '../apps/web/multiplayer-url'

describe('multiplayer WebSocket URL validation', () => {
  it('allows wss from HTTPS and non-HTTPS pages', () => {
    expect(validateMultiplayerUrl('wss://game.example/socket', 'https://game.example').ok).toBe(true)
    expect(validateMultiplayerUrl('wss://game.example/socket', 'http://game.example').ok).toBe(true)
  })

  it('requires wss on HTTPS pages, including loopback pages', () => {
    expect(validateMultiplayerUrl('ws://localhost:8787', 'https://localhost')).toEqual({
      ok: false,
      message: 'HTTPS pages require a secure wss:// multiplayer server.',
    })
  })

  it.each([
    ['http://localhost:5173', 'ws://localhost:8787'],
    ['http://127.0.0.1:5173', 'ws://127.0.0.1:8787'],
    ['http://[::1]:5173', 'ws://[::1]:8787'],
    ['http://localhost:5173', 'ws://127.0.0.1:8787'],
  ])('allows ws when page %s and server %s are both loopback', (pageUrl, serverUrl) => {
    expect(validateMultiplayerUrl(serverUrl, pageUrl).ok).toBe(true)
  })

  it.each([
    ['http://game.example', 'ws://localhost:8787'],
    ['http://localhost:5173', 'ws://game.example'],
    ['http://localhost.example:5173', 'ws://localhost:8787'],
    ['http://localhost:5173', 'ws://127.0.0.2:8787'],
  ])('rejects ws unless both page %s and server %s are exact loopback addresses', (pageUrl, serverUrl) => {
    expect(validateMultiplayerUrl(serverUrl, pageUrl)).toEqual({
      ok: false,
      message: 'ws:// is only allowed when both this page and the multiplayer server use a loopback address.',
    })
  })

  it('rejects invalid and non-WebSocket URLs with user-facing errors', () => {
    expect(validateMultiplayerUrl('not a URL', 'http://localhost')).toEqual({
      ok: false,
      message: 'Enter a valid multiplayer server URL.',
    })
    expect(validateMultiplayerUrl('https://game.example', 'https://game.example')).toEqual({
      ok: false,
      message: 'Multiplayer server must use ws:// or wss://.',
    })
  })
})
