import { readFileSync } from 'node:fs'
import { Effect } from 'effect'
import { PlayerId } from '@nerima-games/mx-multiplayer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installMultiplayerChatInputListeners,
  setMultiplayerChatVisibility,
  type MultiplayerChatInputContext,
} from '../apps/web/multiplayer-client'
import { FakeElement } from './helpers/player-ui-runtime-harness'

const multiplayerClientSource = readFileSync(new URL('../apps/web/multiplayer-client.ts', import.meta.url), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('H4b multiplayer chat input path', () => {
  it('shows chat only when multiplayer is configured', () => {
    const chat = new FakeElement()
    const player = PlayerId.make('player-17')
    const multiplayer = {
      query: { player },
      host: { enqueueOutbound: () => Effect.succeed(undefined) },
    } as unknown as NonNullable<MultiplayerChatInputContext['multiplayer']>

    setMultiplayerChatVisibility(chat as unknown as HTMLElement, undefined)
    expect(chat.hidden).toBe(true)

    setMultiplayerChatVisibility(chat as unknown as HTMLElement, multiplayer)
    expect(chat.hidden).toBe(false)
  })

  it('sends the trimmed message, prevents form submission, and clears the input', () => {
    const player = PlayerId.make('player-17')
    const enqueueOutbound = vi.fn(() => Effect.succeed(undefined))
    const multiplayer = {
      query: { player },
      host: { enqueueOutbound },
    } as unknown as NonNullable<MultiplayerChatInputContext['multiplayer']>
    const chat = new FakeElement()
    const form = new FakeElement()
    const input = new FakeElement()
    input.value = '  hello from the cave  '
    const context: MultiplayerChatInputContext = {
      multiplayer,
      ui: {
        multiplayerChat: chat as unknown as HTMLElement,
        multiplayerChatForm: form as unknown as HTMLFormElement,
        multiplayerChatInput: input as unknown as HTMLInputElement,
      },
      state: { multiplayerHandshakeComplete: true },
    }

    setMultiplayerChatVisibility(chat as unknown as HTMLElement, multiplayer)
    installMultiplayerChatInputListeners(context)
    const event = form.dispatch('submit', form)

    expect(event.defaultPrevented).toBe(true)
    expect(enqueueOutbound).toHaveBeenCalledExactlyOnceWith({
      _tag: 'Chat',
      player: 'player-17',
      text: 'hello from the cave',
    })
    expect(input.value).toBe('')
  })

  it('stops Escape key propagation while preserving the current chat visibility', () => {
    const chat = new FakeElement()
    const input = new FakeElement()
    const context: MultiplayerChatInputContext = {
      multiplayer: undefined,
      ui: {
        multiplayerChat: chat as unknown as HTMLElement,
        multiplayerChatForm: new FakeElement() as unknown as HTMLFormElement,
        multiplayerChatInput: input as unknown as HTMLInputElement,
      },
      state: { multiplayerHandshakeComplete: false },
    }
    chat.hidden = false
    installMultiplayerChatInputListeners(context)
    const stopEscapePropagation = vi.fn()

    input.dispatch('keydown', input, { key: 'Escape', stopPropagation: stopEscapePropagation })

    expect(stopEscapePropagation).toHaveBeenCalledOnce()
    expect(chat.hidden).toBe(false)
  })

  it('registers the tested chat visibility and input helpers in multiplayer client startup order', () => {
    const clientFactory = multiplayerClientSource.indexOf('export const createMultiplayerClient =')
    const setVisibility = multiplayerClientSource.indexOf(
      'setMultiplayerChatVisibility(clientContext.ui.multiplayerChat, clientContext.multiplayer)',
      clientFactory,
    )
    const installListeners = multiplayerClientSource.indexOf(
      'installMultiplayerChatInputListeners(clientContext)',
      clientFactory,
    )
    const factoryReturn = multiplayerClientSource.indexOf('\n  return {', installListeners)

    expect(clientFactory).toBeGreaterThanOrEqual(0)
    expect(setVisibility).toBeGreaterThan(clientFactory)
    expect(installListeners).toBeGreaterThan(setVisibility)
    expect(factoryReturn).toBeGreaterThan(installListeners)
  })
})
