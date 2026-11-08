import { PlayerId } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import {
  connectMultiplayer,
  makeMultiplayerChatCommand,
  makeMultiplayerCommandIds,
} from '../apps/web/multiplayer-client'

describe('multiplayer client', () => {
  it('keeps singleplayer connection setup inert', async () => {
    const storageEvents: Array<string> = []
    const bootErrors: Array<string> = []
    const result = await connectMultiplayer({
      sessionId: 'singleplayer-session',
      search: '?sleepPercentage=50',
      href: 'https://game.example.test/',
      getSessionStorage: () => {
        storageEvents.push('session:access')
        return {
          getItem: (key) => {
            storageEvents.push(`session:get:${key}`)
            return null
          },
          removeItem: (key) => storageEvents.push(`session:remove:${key}`),
        }
      },
      getLocalStorage: () => {
        storageEvents.push('local:access')
        return {
          getItem: (key) => {
            storageEvents.push(`local:get:${key}`)
            return null
          },
          setItem: (key, value) => storageEvents.push(`local:set:${key}:${value}`),
        }
      },
      failBoot: (message) => bootErrors.push(message),
    })

    expect(result.status).toBe('started')
    if (result.status !== 'started') return
    expect(result.multiplayer).toBeUndefined()
    expect(result.multiplayerInboundStage).toBeUndefined()
    expect(result.multiplayerOutboundStage).toBeUndefined()
    expect(storageEvents).toEqual([])
    expect(bootErrors).toEqual([])
  })

  it('builds bounded chat commands only after the multiplayer handshake', () => {
    const player = PlayerId.make('alice')
    const multiplayer = { query: { player } }

    expect(makeMultiplayerChatCommand(multiplayer, false, 'hello')).toBeUndefined()
    expect(makeMultiplayerChatCommand(undefined, true, 'hello')).toBeUndefined()
    expect(makeMultiplayerChatCommand(multiplayer, true, '   ')).toBeUndefined()
    expect(makeMultiplayerChatCommand(multiplayer, true, '  hello  ')).toEqual({
      _tag: 'Chat',
      player,
      text: 'hello',
    })
    expect(makeMultiplayerChatCommand(multiplayer, true, ` ${'x'.repeat(300)} `)).toEqual({
      _tag: 'Chat',
      player,
      text: 'x'.repeat(256),
    })
  })

  it('keeps command ids scoped to the page session and request kind', () => {
    const ids = makeMultiplayerCommandIds('session-1', (value) => value)

    expect(ids.commandIdFor('facility', 4)).toBe('facility-session-1-4')
    expect(ids.requestIdFor('craft', 9)).toBe('craft-session-1-9')
  })
})
