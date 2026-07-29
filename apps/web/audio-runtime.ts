import {
  AudioBackendPort,
  CAPTION_DISPLAY_SECS,
  DEFAULT_VOLUME_SETTINGS,
  makeSoundCueService,
  recordingCaptionLayer,
  visibleCaptions,
  type AudioBackend,
  type CaptionEvent,
  type CuePlayOptions,
  type SoundCueId,
  type Vec3,
  type WebAudioBackend,
} from '@nerima-games/mc-audio'
import { Effect, Layer, Ref } from 'effect'

type RuntimeBackend = AudioBackend & Pick<WebAudioBackend, 'unlock' | 'close'>

export type AudioRuntimeSnapshot = {
  readonly cueIds: ReadonlyArray<SoundCueId>
  readonly captions: ReadonlyArray<CaptionEvent>
  readonly closed: boolean
  readonly unlockPending: boolean
}

export type AudioRuntime = {
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => void
  readonly unlock: () => void
  readonly visible: (nowSecs: number) => ReadonlyArray<CaptionEvent>
  readonly snapshot: (nowSecs: number) => AudioRuntimeSnapshot
  readonly close: () => void
}

export const makeAudioRuntime = (input: {
  readonly backend: RuntimeBackend
  readonly nowSecs: Effect.Effect<number>
  readonly listener: () => Vec3
}): Effect.Effect<AudioRuntime> =>
  Effect.gen(function* () {
    const captionEvents = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
    const layer = Layer.merge(
      Layer.succeed(AudioBackendPort, input.backend),
      recordingCaptionLayer((event) => Ref.update(captionEvents, (events) => [...events, event])),
    )
    const service = yield* makeSoundCueService({
      context: Effect.map(input.backend.availability, (availability) => ({
        settings: DEFAULT_VOLUME_SETTINGS,
        enabled: true,
        availability,
        listener: input.listener(),
      })),
      nowSecs: input.nowSecs,
    }).pipe(Effect.provide(layer))

    const cueIds: Array<SoundCueId> = []
    let closed = false
    let unlocked = false
    let unlockPending: Promise<unknown> | undefined

    const currentCaptions = (nowSecs: number): ReadonlyArray<CaptionEvent> =>
      Effect.runSync(Ref.modify(captionEvents, (events) => {
        const retained = pruneExpiredCaptionEvents(events, nowSecs)
        return [visibleCaptions(retained, nowSecs), retained]
      }))

    return {
      play: (cueId, options) => {
        if (closed) return
        cueIds.push(cueId)
        Effect.runSyncExit(service.play(cueId, options))
      },
      unlock: () => {
        if (closed || unlocked || unlockPending !== undefined) return
        const pending = Effect.runPromise(input.backend.unlock)
          .then((availability) => {
            if (availability === 'ready') unlocked = true
          })
          .catch(() => undefined)
        unlockPending = pending
        void pending.finally(() => {
          if (unlockPending === pending) unlockPending = undefined
        })
      },
      visible: currentCaptions,
      snapshot: (nowSecs) => ({
        cueIds: [...cueIds],
        captions: currentCaptions(nowSecs),
        closed,
        unlockPending: unlockPending !== undefined,
      }),
      close: () => {
        if (closed) return
        closed = true
        void Effect.runPromise(input.backend.close).catch(() => undefined)
      },
    }
  })

export const pruneExpiredCaptionEvents = (
  captions: ReadonlyArray<CaptionEvent>,
  nowSecs: number,
): ReadonlyArray<CaptionEvent> => captions.filter(
  (caption) => nowSecs < caption.atSecs || nowSecs - caption.atSecs < CAPTION_DISPLAY_SECS,
)

export const captionRenderSignature = (
  captions: ReadonlyArray<CaptionEvent>,
): string => JSON.stringify(
  captions.map(({ cueId, text, reason, atSecs }) => [cueId, text, reason, atSecs]),
)

export const announceInventoryTransition = (
  audio: Pick<AudioRuntime, 'play'>,
  previousOpen: boolean,
  nextOpen: boolean,
): boolean => {
  if (previousOpen === nextOpen) return false
  audio.play(nextOpen ? 'inventoryOpen' : 'inventoryClose')
  return true
}

export const announceConfirmedPlacements = (
  audio: Pick<AudioRuntime, 'play'>,
  consumedPlacements: ReadonlyArray<unknown>,
): boolean => {
  if (consumedPlacements.length === 0) return false
  audio.play('blockPlace')
  return true
}
