import { DEFAULT_BINDINGS } from '@nerima-games/mc-render'
import { InMemoryStorageLayer } from '@nerima-games/mc-save'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import {
  DEFAULT_PLAYER_SETTINGS,
  loadPlayerSettings,
  normalizePlayerSettings,
  rebindPlayerSettings,
  savePlayerSettings,
} from '../apps/web/settings'

describe('player settings', () => {
  it('normalizes malformed fields independently and clamps numeric values', () => {
    expect(normalizePlayerSettings({
      sensitivity: 99,
      masterVolume: -2,
      sfxVolume: Number.NaN,
      audioEnabled: 'yes',
      captionsEnabled: false,
      bindings: { moveForward: 'Escape', jump: 'KeyJ' },
    })).toMatchObject({
      sensitivity: 3,
      masterVolume: 0,
      sfxVolume: 1,
      audioEnabled: true,
      captionsEnabled: false,
      bindings: { moveForward: DEFAULT_BINDINGS.moveForward, jump: 'KeyJ' },
    })
  })

  it('uses fresh defaults for absent or non-object payloads', () => {
    const first = normalizePlayerSettings(undefined)
    const second = normalizePlayerSettings('corrupt')

    expect(first).toEqual(DEFAULT_PLAYER_SETTINGS)
    expect(second).toEqual(DEFAULT_PLAYER_SETTINGS)
    expect(first.bindings).not.toBe(second.bindings)
  })

  it('swaps a duplicate binding deterministically', () => {
    const remapped = rebindPlayerSettings(DEFAULT_BINDINGS, 'moveForward', 'KeyS')

    expect(remapped['moveForward']).toBe('KeyS')
    expect(remapped['moveBackward']).toBe('KeyW')
    expect(new Set(Object.values(remapped)).size).toBe(Object.values(remapped).length)
  })

  it('preserves swapped bindings while normalizing persisted settings', () => {
    const bindings = rebindPlayerSettings(DEFAULT_BINDINGS, 'moveForward', 'KeyS')

    expect(normalizePlayerSettings({ ...DEFAULT_PLAYER_SETTINGS, bindings }).bindings).toEqual(bindings)
  })

  it.effect('persists independently under the player settings format', () =>
    Effect.gen(function* () {
      const expected = normalizePlayerSettings({
        ...DEFAULT_PLAYER_SETTINGS,
        sensitivity: 1.75,
        audioEnabled: false,
      })

      yield* savePlayerSettings(expected)
      expect(yield* loadPlayerSettings()).toEqual(expected)
    }).pipe(Effect.provide(InMemoryStorageLayer)))

  it.effect('round-trips swapped bindings through player settings storage', () =>
    Effect.gen(function* () {
      const bindings = rebindPlayerSettings(DEFAULT_BINDINGS, 'moveForward', 'KeyS')
      const expected = { ...DEFAULT_PLAYER_SETTINGS, bindings }

      yield* savePlayerSettings(expected)
      expect((yield* loadPlayerSettings()).bindings).toEqual(bindings)
    }).pipe(Effect.provide(InMemoryStorageLayer)))
})
