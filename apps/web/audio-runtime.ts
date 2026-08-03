import {
  AudioBackendPort,
  CAPTION_DISPLAY_SECS,
  DEFAULT_VOLUME_SETTINGS,
  makeSoundCueService,
  makeGameAudioHost,
  recordingCaptionLayer,
  visibleCaptions,
  type AudioBackend,
  type CaptionEvent,
  type CuePlayOptions,
  type SoundCueId,
  type Vec3,
  type WebAudioBackend,
  type GameAudioHost,
} from '@nerima-games/mc-audio'
import { Effect, Layer, Ref } from 'effect'

type RuntimeBackend = AudioBackend & Pick<WebAudioBackend, 'unlock' | 'close'>

export type AudioRuntimeSnapshot = {
  readonly cueIds: ReadonlyArray<SoundCueId>
  readonly captions: ReadonlyArray<CaptionEvent>
  readonly listener: Vec3
  readonly listenerForward?: Vec3
  readonly closed: boolean
  readonly unlockPending: boolean
}

export const horizontalListenerForward = (yawRadians: number): Vec3 => ({
  x: -Math.sin(yawRadians),
  y: 0,
  z: -Math.cos(yawRadians),
})

export type AudioRuntimeSettings = {
  readonly masterVolume: number
  readonly sfxVolume: number
  readonly audioEnabled: boolean
}

export type AudioRuntime = {
  readonly game: GameAudioHost
  readonly play: (cueId: SoundCueId, options?: CuePlayOptions) => void
  readonly unlock: () => void
  readonly visible: (nowSecs: number) => ReadonlyArray<CaptionEvent>
  readonly snapshot: (nowSecs: number) => AudioRuntimeSnapshot
  readonly configure: (settings: AudioRuntimeSettings) => void
  readonly close: () => void
}

export type PlacementAudioLatch = {
  readonly request: (position?: Vec3) => void
  readonly confirm: (consumedPlacements: ReadonlyArray<unknown>) => boolean
}

export const makePlacementAudioLatch = (
  audio: Pick<AudioRuntime, 'play'>,
): PlacementAudioLatch => {
  // Gameplay exposes no placement correlation id. Keep exactly one target and
  // replace or clear it at the start of every browser placement attempt.
  let pendingPosition: Vec3 | undefined
  return {
    request: (position) => {
      pendingPosition = position
    },
    confirm: (consumedPlacements) => {
      if (consumedPlacements.length === 0) return false
      const position = pendingPosition
      pendingPosition = undefined
      return announceConfirmedPlacements(audio, consumedPlacements, position)
    },
  }
}

export const makeAudioRuntime = (input: {
  readonly backend: RuntimeBackend
  readonly nowSecs: Effect.Effect<number>
  readonly listener: () => Vec3
  readonly listenerForward?: () => Vec3
  readonly settings?: AudioRuntimeSettings
}): Effect.Effect<AudioRuntime> =>
  Effect.gen(function* () {
    const captionEvents = yield* Ref.make<ReadonlyArray<CaptionEvent>>([])
    const layer = Layer.merge(
      Layer.succeed(AudioBackendPort, input.backend),
      recordingCaptionLayer((event) => Ref.update(captionEvents, (events) => [...events, event])),
    )
    let settings: AudioRuntimeSettings = input.settings ?? {
      masterVolume: DEFAULT_VOLUME_SETTINGS.master,
      sfxVolume: DEFAULT_VOLUME_SETTINGS.sfx,
      audioEnabled: true,
    }
    const service = yield* makeSoundCueService({
      context: Effect.map(input.backend.availability, (availability) => ({
        settings: {
          master: settings.masterVolume,
          sfx: settings.sfxVolume,
          music: 0,
        },
        enabled: settings.audioEnabled,
        availability,
        listener: input.listener(),
        ...(input.listenerForward === undefined
          ? {}
          : { listenerForward: input.listenerForward() }),
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
      game: makeGameAudioHost(service),
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
        listener: input.listener(),
        ...(input.listenerForward === undefined
          ? {}
          : { listenerForward: input.listenerForward() }),
        closed,
        unlockPending: unlockPending !== undefined,
      }),
      configure: (nextSettings) => {
        if (closed) return
        settings = nextSettings
        Effect.runSyncExit(input.backend.setMasterGain(
          nextSettings.audioEnabled ? nextSettings.masterVolume : 0,
        ))
      },
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
  position?: Vec3,
): boolean => {
  if (consumedPlacements.length === 0) return false
  audio.play('blockPlace', position === undefined ? undefined : { position })
  return true
}
