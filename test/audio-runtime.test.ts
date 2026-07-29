import {
  makeRecordingBackend,
  type AudioBackend,
  type WebAudioBackend,
} from '@nerima-games/mc-audio'
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import {
  announceConfirmedPlacements,
  announceInventoryTransition,
  captionRenderSignature,
  makeAudioRuntime,
  pruneExpiredCaptionEvents,
} from '../apps/web/audio-runtime'

const makeBackend = (
  backend: AudioBackend,
  lifecycle: { unlocks: number; closes: number },
): AudioBackend & Pick<WebAudioBackend, 'unlock' | 'close'> => ({
  ...backend,
  unlock: Effect.sync(() => {
    lifecycle.unlocks += 1
    return 'ready' as const
  }),
  close: Effect.sync(() => {
    lifecycle.closes += 1
  }),
})

describe('web audio runtime', () => {
  it('emits the damage caption while autoplay remains locked', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('locked'))
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend(recording.backend, { unlocks: 0, closes: 0 }),
        nowSecs: Effect.succeed(12),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    runtime.play('playerHurt')

    expect(runtime.visible(12)).toMatchObject([
      { cueId: 'playerHurt', atSecs: 12, reason: 'gate-blocked' },
    ])
    expect(await Effect.runPromise(recording.played)).toEqual([])
  })

  it('does not announce an inventory state that is already active', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('ready'))
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend(recording.backend, { unlocks: 0, closes: 0 }),
        nowSecs: Effect.succeed(0),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    expect(announceInventoryTransition(runtime, false, true)).toBe(true)
    expect(announceInventoryTransition(runtime, true, true)).toBe(false)
    expect(runtime.snapshot(0).cueIds).toEqual(['inventoryOpen'])
  })

  it('applies volume and mute changes immediately', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('ready'))
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend(recording.backend, { unlocks: 0, closes: 0 }),
        nowSecs: Effect.succeed(0),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    runtime.configure({ masterVolume: 0.4, sfxVolume: 0.25, audioEnabled: true })
    runtime.play('playerHurt')
    runtime.configure({ masterVolume: 0.9, sfxVolume: 1, audioEnabled: false })
    runtime.play('inventoryOpen')

    expect(await Effect.runPromise(recording.masterGains)).toEqual([0.4, 0])
    expect((await Effect.runPromise(recording.played))[0]).toMatchObject({ gain: 0.125 })
    expect(await Effect.runPromise(recording.played)).toHaveLength(1)
  })

  it('announces placement only after the success outbox contains a result', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('ready'))
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend(recording.backend, { unlocks: 0, closes: 0 }),
        nowSecs: Effect.succeed(0),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    expect(announceConfirmedPlacements(runtime, [])).toBe(false)
    expect(runtime.snapshot(0).cueIds).toEqual([])
    expect(announceConfirmedPlacements(runtime, ['oak_planks'])).toBe(true)
    expect(runtime.snapshot(0).cueIds).toEqual(['blockPlace'])
  })

  it('unlocks and closes at most once while their work is active', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('locked'))
    const lifecycle = { unlocks: 0, closes: 0 }
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend(recording.backend, lifecycle),
        nowSecs: Effect.succeed(0),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    runtime.unlock()
    runtime.unlock()
    runtime.close()
    runtime.close()
    await Promise.resolve()
    runtime.play('playerHurt')
    runtime.unlock()
    await Promise.resolve()

    expect(lifecycle).toEqual({ unlocks: 1, closes: 1 })
    expect(runtime.snapshot(0).cueIds).toEqual([])
  })

  it('retries unlock after rejection and stops retrying after ready', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('locked'))
    const lifecycle = { unlocks: 0, closes: 0 }
    const backend = makeBackend(recording.backend, lifecycle)
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: {
          ...backend,
          unlock: Effect.sync(() => {
            lifecycle.unlocks += 1
            if (lifecycle.unlocks === 1) throw new Error('unlock rejected')
            return 'ready' as const
          }),
        },
        nowSecs: Effect.succeed(0),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    runtime.unlock()
    await Promise.resolve()
    await Promise.resolve()
    runtime.unlock()
    await Promise.resolve()
    await Promise.resolve()
    runtime.unlock()
    await Promise.resolve()

    expect(lifecycle.unlocks).toBe(2)
  })

  it('uses all rendered caption fields in a stable signature', () => {
    const caption = {
      cueId: 'playerHurt' as const,
      text: 'Player hurt',
      reason: 'gate-blocked' as const,
      atSecs: 12,
    }

    expect(captionRenderSignature([caption])).toBe(captionRenderSignature([{ ...caption }]))
    expect(captionRenderSignature([caption])).not.toBe(
      captionRenderSignature([{ ...caption, atSecs: 13 }]),
    )
    expect(captionRenderSignature([])).not.toBe(captionRenderSignature([caption]))
  })

  it('keeps the cue request when the audio backend defects', async () => {
    const recording = await Effect.runPromise(makeRecordingBackend('ready'))
    const runtime = await Effect.runPromise(
      makeAudioRuntime({
        backend: makeBackend({
          ...recording.backend,
          playTone: () => Effect.die(new Error('backend defect')),
        }, { unlocks: 0, closes: 0 }),
        nowSecs: Effect.succeed(4),
        listener: () => ({ x: 0, y: 0, z: 0 }),
      }),
    )

    expect(() => runtime.play('playerHurt')).not.toThrow()
    expect(runtime.snapshot(4).cueIds).toEqual(['playerHurt'])
  })

  it('prunes only expired caption history across read times', () => {
    const captions = [
      { cueId: 'playerHurt' as const, text: 'Expired', reason: 'audible' as const, atSecs: 0 },
      { cueId: 'inventoryOpen' as const, text: 'Current', reason: 'audible' as const, atSecs: 2 },
      { cueId: 'inventoryClose' as const, text: 'Future', reason: 'audible' as const, atSecs: 8 },
    ]

    const atFour = pruneExpiredCaptionEvents(captions, 4)
    expect(atFour.map((caption) => caption.text)).toEqual(['Current', 'Future'])
    expect(pruneExpiredCaptionEvents(atFour, 8).map((caption) => caption.text)).toEqual(['Future'])
  })
})
