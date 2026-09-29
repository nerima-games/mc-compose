import * as THREE from 'three'
import { Context, Effect, Layer, Option, Scope } from 'effect'
import {
  createOriginalSampleManifest,
  makeEndAudioController,
  makeWeatherAudioController,
  makeWebAudioBackend,
  type EndAudioController,
  type EndAudioEvent,
  type WeatherAudioController,
  type WeatherAudioHandle,
  type WeatherLoopKind,
  type WebAudioBackend,
} from '@nerima-games/mc-audio'
import { type Position as Vec3, type StageRegistration } from '@nerima-games/mc-kernel'
import { indexedDbStorageLayer, StoragePort } from '@nerima-games/mc-save'
import {
  browserInputLayer,
  generateTerrainAtlas,
  InputService,
  makeProductionWorldRenderer,
  makeWorldRenderer,
  QUALITY_PRESETS,
  type GraphicsQuality,
  type TouchControlTarget,
  type WorldRenderer,
} from '@nerima-games/mc-render'
import {
  makeRuntimeRedstoneStages,
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type RedstoneWorldRuntimeService,
} from '@nerima-games/mx-redstone'
import { BrowserClockLayer } from './clock'
import {
  horizontalListenerForward,
  makeAudioRuntime,
  makePlacementAudioLatch,
  type AudioRuntime,
  type PlacementAudioLatch,
} from './audio-runtime'
import { DEFAULT_PLAYER_SETTINGS, loadPlayerSettings, type PlayerSettingsV1 } from './settings'
import { loadSession, type SessionHead, type SessionMetadata, type SessionState } from './session-persistence'
import type { SessionRoute } from './session-navigation'

/**
 * The boot-level constants the browser host and the platform-adapters factory
 * both need. They live here rather than in `main.ts` so that `main.ts` can
 * import the factory without the factory importing `main.ts` back (a cycle).
 */
export const DATABASE_NAME = 'nerima-games-minecraft'
export const MISSING_SESSION_ERROR = 'The requested saved world could not be found.'
export class RequestedSessionNotFoundError extends Error {}

export type SettingsWriteQueue = {
  tail: Promise<void>
  failure: { readonly error: unknown } | undefined
}

export const makeSettingsWriteQueue = (): SettingsWriteQueue => ({
  tail: Promise.resolve(),
  failure: undefined,
})

/**
 * Everything the browser host constructs to talk to a platform (storage, audio,
 * input, redstone, renderer), built once and owned by the host for the page
 * lifetime.
 *
 * The listener setters exist because the audio listener reads the player pose,
 * which is only known after the world exists. `makeAudioRuntime` is built
 * against a closure that reads the *current* binding, so the host reassigns the
 * binding later through the setters without rebuilding the runtime.
 */
export type PlatformAdapters = {
  readonly storageContext: Context.Context<StoragePort>
  readonly runStorage: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>
  readonly playerSettings: PlayerSettingsV1
  readonly settingsWrites: SettingsWriteQueue
  readonly setReadAudioListener: (listener: () => Vec3) => void
  readonly setReadAudioListenerForward: (listener: () => Vec3) => void
  readonly getReadAudioListenerForward: () => Vec3
  readonly audio: AudioRuntime
  readonly audioBackend: WebAudioBackend
  readonly endAudio: EndAudioController
  readonly weatherAudio: WeatherAudioController
  readonly drainEndAudioEvents: () => EndAudioEvent[]
  readonly clearPendingThunder: () => void
  readonly queueEndAudio: (kind: EndAudioEvent['kind'], position: Vec3) => void
  readonly placementAudio: PlacementAudioLatch
  readonly loadedSession: Option.Option<SessionHead>
  readonly sessionMetadata: SessionMetadata
  readonly isCreativeMode: boolean
  readonly initialDimension: SessionState['dimension']
  readonly inputLayer: Layer.Layer<InputService>
  readonly inputContext: Context.Context<InputService>
  readonly redstoneRuntime: RedstoneWorldRuntimeService
  readonly runtimeRedstoneStages: ReadonlyArray<StageRegistration>
  readonly atlasTexture: THREE.DataTexture
  readonly softwareRenderer: boolean
  readonly renderQuality: GraphicsQuality | undefined
  readonly worldRenderer: WorldRenderer
}

export const makePlatformAdapters = async (deps: {
  readonly route: SessionRoute
  readonly canvas: HTMLCanvasElement
  readonly touchControls: ReadonlyArray<TouchControlTarget>
  readonly allowsPointerLock: () => boolean
  readonly uiModalOpen: () => boolean
}): Promise<PlatformAdapters> => {
  const { route, canvas, touchControls, allowsPointerLock, uiModalOpen } = deps
  const { sessionId } = route
  const creationMetadata = route.kind === 'create' ? route.metadata : undefined

  // The scope stays open for the life of the page ON PURPOSE. `browserInputLayer`
  // is `Layer.scoped` and removes its listeners when the scope closes; closing
  // it here would install the listeners and immediately take them away.
  const scope = Effect.runSync(Scope.make())
  const storageContext = await Effect.runPromise(
    Effect.provideService(
      Layer.build(indexedDbStorageLayer({ factory: indexedDB, databaseName: DATABASE_NAME })),
      Scope.Scope,
      scope,
    ),
  )
  const runStorage = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    Effect.runPromise(effect)
  let playerSettings: PlayerSettingsV1 = await runStorage(
    Effect.provide(loadPlayerSettings(), storageContext),
  ).catch(() => DEFAULT_PLAYER_SETTINGS)
  const settingsWrites = makeSettingsWriteQueue()
  let readAudioListener = (): Vec3 => ({ x: 0, y: 0, z: 0 })
  let readAudioListenerForward = (): Vec3 => horizontalListenerForward(0)
  const sampleManifest = createOriginalSampleManifest()
  const audioBackend = Effect.runSync(makeWebAudioBackend({
    global: globalThis,
    initialMasterGain: playerSettings.audioEnabled ? playerSettings.masterVolume : 0,
    sampleManifest,
  }))
  canvas.setAttribute('data-audio-samples', String(Object.keys(sampleManifest).length))
  const audio = Effect.runSync(makeAudioRuntime({
    backend: audioBackend,
    clockLayer: BrowserClockLayer,
    listener: () => readAudioListener(),
    listenerForward: () => readAudioListenerForward(),
    settings: playerSettings,
  }))
  const endAudio = makeEndAudioController({
    createLoop: (_kind, initialGain) => Effect.runSync(audioBackend.playTone({
      durationSecs: 3600,
      frequency: 42,
      gain: initialGain,
      loop: true,
      pan: 0,
      wave: 'sine',
    })),
    setLoopGain: () => {},
    stopLoop: (handle) => Effect.runSync(audioBackend.stopTone(handle)),
    playEvent: () => null,
    playFallback: (request) => Effect.runSync(audioBackend.playTone({ ...request, loop: false })),
    release: () => {},
  })
  let nextWeatherAudioHandleId = -1
  const pendingThunder = new Map<number, number>()
  const weatherAudio = makeWeatherAudioController({
    createLoop: (kind: WeatherLoopKind, initialGain: number) => Effect.runSync(
      audioBackend.playTone({
        durationSecs: 3600,
        frequency: kind === 'rain' ? 180 : 72,
        gain: initialGain,
        loop: true,
        pan: 0,
        wave: kind === 'rain' ? 'sawtooth' : 'triangle',
      }),
    ),
    setLoopGain: () => {},
    stopLoop: (handle) => Effect.runSync(audioBackend.stopTone(handle)),
    playThunder: ({ delaySecs, gain, pan }): WeatherAudioHandle => {
      const handle = { id: nextWeatherAudioHandleId-- }
      const timeout = window.setTimeout(() => {
        pendingThunder.delete(handle.id)
        Effect.runSync(audioBackend.playTone({
          durationSecs: 1.8,
          frequency: 46,
          gain,
          loop: false,
          pan,
          wave: 'sawtooth',
        }))
      }, delaySecs * 1_000)
      pendingThunder.set(handle.id, timeout)
      return handle
    },
    release: (handle) => {
      const timeout = pendingThunder.get(handle.id)
      if (timeout !== undefined) {
        window.clearTimeout(timeout)
        pendingThunder.delete(handle.id)
      }
    },
  })
  let nextEndAudioEventId = 0
  const pendingEndAudioEvents: EndAudioEvent[] = []
  const queueEndAudio = (kind: EndAudioEvent['kind'], position: Vec3): void => {
    pendingEndAudioEvents.push({
      id: `end-${String(nextEndAudioEventId++)}`,
      kind,
      position,
    })
  }
  const placementAudio = makePlacementAudioLatch(audio)
  const loadedSession = await runStorage(
    Effect.provide(loadSession(sessionId), storageContext),
  )
  if (route.kind === 'load' && Option.isNone(loadedSession)) {
    throw new RequestedSessionNotFoundError(MISSING_SESSION_ERROR)
  }
  if (route.kind === 'create') {
    const canonicalUrl = new URL(window.location.href)
    canonicalUrl.search = new URLSearchParams({ session: sessionId }).toString()
    window.history.replaceState(null, '', canonicalUrl)
  }
  const sessionMetadata = Option.isSome(loadedSession)
    ? loadedSession.value.metadata
    : creationMetadata ?? { name: sessionId, mode: 'survival' }
  const isCreativeMode = sessionMetadata.mode === 'creative'

  // Computed here, ahead of renderer construction below, so the renderer's
  // initial sky matches a restored session's dimension on the very first
  // frame instead of only from the second frame onward (once the per-frame
  // weather snapshot has run once).
  const initialDimension: SessionState['dimension'] = Option.isSome(loadedSession)
    ? loadedSession.value.state.dimension
    : 'overworld'

  // POINTER LOCK IS THE HOST'S TO ASK FOR. mc-render's `InputService` treats a
  // click as a GAME action only while the pointer is locked, and as a UI click
  // otherwise. Without this, `attack` never fires and no block can be broken.
  const inputLayer = browserInputLayer({
    targets: { window, document },
    canvas,
    bindings: playerSettings.bindings,
    allowsPointerLock,
    touchControls,
  })

  // The gesture the browser requires: pointer lock can only be requested from a
  // user activation, so the canvas asks on click.
  //
  // A REFUSAL IS NOT AN ERROR. Some environments decline pointer lock outright
  // — Playwright on SwiftShader is one, and answers `WrongDocumentError` — and
  // a host that let that reach the console would make every automated run
  // report a failure it cannot do anything about.
  canvas.addEventListener('click', (event) => {
    if (event.isTrusted) audio.unlock()
    if (uiModalOpen() || document.pointerLockElement === canvas) {
      return
    }
    try {
      const requested: unknown = canvas.requestPointerLock()
      if (requested instanceof Promise) {
        requested.catch(() => {
          canvas.setAttribute('data-pointer-lock', 'refused')
        })
      }
    } catch {
      // The attribute IS the record. A boolean nobody reads would be the
      // unread-field shape this project keeps finding; a test can see this.
      canvas.setAttribute('data-pointer-lock', 'refused')
    }
  })
  canvas.addEventListener('keydown', (event) => {
    if (event.isTrusted) audio.unlock()
  })

  // Built ONCE, into a Context, and then provided as a Context rather than as a
  // Layer. `mx-multiplayer/stages/registration.ts` records why this matters:
  // "providing `Layer.effect` twice builds two services" — and two
  // `InputService`s means the stage clears the edges on one of them while the
  // DOM listeners write to the other, so every key would appear stuck down.
  const inputContext = await Effect.runPromise(
    Effect.provideService(Layer.build(inputLayer), Scope.Scope, scope),
  )
  const redstoneContext = await Effect.runPromise(
    Effect.provideService(Layer.build(RedstoneWorldRuntimeLayer), Scope.Scope, scope),
  )
  const redstoneRuntime = Context.get(redstoneContext, RedstoneWorldRuntime)
  const runtimeRedstoneStages = await Effect.runPromise(
    Effect.provide(makeRuntimeRedstoneStages, redstoneContext),
  )

  // The renderer. mc-render builds it; this file supplies only the two things
  // it cannot reach — the `three` namespace and the element to draw on.
  //
  // `clientWidth`/`clientHeight` and not `width`/`height`: the canvas has the
  // host's CSS 100vw/100vh rule on it and no width attribute, so the attribute
  // pair is three's default 300x150 and the layout pair is the viewport. That
  // distinction is also why mc-render passes `updateStyle: false` to `setSize`.
  //
  // THE THREE TYPE ARGUMENTS ARE NOT OPTIONAL, and mc-render's
  // `application/three-surface.ts` records why at length: `typeof
  // THREE.BufferGeometry` is itself generic and defaults to
  // `BufferGeometry<NormalOrGLBufferAttributes>`, while `typeof THREE.Mesh`
  // wants the narrower `BufferGeometry<NormalBufferAttributes>` — so inference
  // draws incompatible conclusions from the same namespace and fails four
  // levels down, naming `GLBufferAttribute`. mc-render cannot pin either from
  // its side without naming a `three` type, which is the one thing that seam
  // exists not to do. The host has `three` in scope and pins them here.
  const terrainAtlas = generateTerrainAtlas()
  const atlasData = new Uint8Array(new ArrayBuffer(terrainAtlas.data.byteLength))
  atlasData.set(terrainAtlas.data)
  const atlasTexture = new THREE.DataTexture(
    atlasData,
    terrainAtlas.width,
    terrainAtlas.height,
    THREE.RGBAFormat,
  )
  atlasTexture.magFilter = THREE.NearestFilter
  atlasTexture.minFilter = THREE.NearestFilter
  atlasTexture.needsUpdate = true
  canvas.setAttribute('data-atlas-size', `${String(terrainAtlas.width)}x${String(terrainAtlas.height)}`)
  const glContext = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  const webGlAvailable = glContext !== null
  // mc-render 0.3.0's post-processing chain (GTAO/SSAO, bloom via the
  // composite pass, SMAA) is newly wired into `makeProductionWorldRenderer`,
  // which defaults to `QUALITY_PRESETS.high` whenever the caller does not pass
  // a `quality`. Those passes are calibrated for a hardware rasterizer; on
  // SwiftShader (this repository's headless CI target), measured with
  // `QUALITY_PRESETS.low` instead, per-frame GPU command-processing time drops
  // by roughly 15% at an identical chunk/geometry count. That is a real but
  // PARTIAL fix for the SwiftShader sub-8-FPS failures — so this is necessary
  // but not sufficient. `WEBGL_debug_renderer_info` is the standard way to tell
  // a software rasterizer from a real GPU; fall back to `QUALITY_PRESETS.low`
  // there, and leave real hardware-accelerated players on the default `high`
  // preset untouched.
  const isSoftwareRenderer = (context: WebGL2RenderingContext | WebGLRenderingContext | null): boolean => {
    if (context === null) return false
    const info = context.getExtension('WEBGL_debug_renderer_info')
    if (info === null) return false
    const renderer = String(context.getParameter(info.UNMASKED_RENDERER_WEBGL))
    return /swiftshader|software|llvmpipe|softpipe/iu.test(renderer)
  }
  // Read once and reused below for the streamed chunk radius: both fall back
  // together on the same software-rasterizer signal.
  const softwareRenderer = isSoftwareRenderer(glContext)
  const renderQuality = softwareRenderer ? QUALITY_PRESETS.low : undefined
  canvas.setAttribute('data-render-quality', renderQuality === undefined ? 'high' : 'low')
  const worldRenderer = webGlAvailable
    ? await Effect.runPromise(makeProductionWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >(
      THREE,
      canvas,
      { width: canvas.clientWidth, height: canvas.clientHeight },
      atlasTexture,
      { dimension: initialDimension },
    ))
    : await Effect.runPromise(
        makeWorldRenderer<HTMLCanvasElement, THREE.BufferGeometry, THREE.MeshBasicMaterial>(
          THREE,
          canvas,
          { width: canvas.clientWidth, height: canvas.clientHeight },
          { dimension: initialDimension },
        ),
      )

  // The canvas is the host's element and its SIZE is the host's business, so
  // the resize listener is here rather than in mc-render — mc-render ships no
  // `lib.DOM` and could not add one.
  window.addEventListener('resize', () => {
    Effect.runSync(worldRenderer.resize(canvas.clientWidth, canvas.clientHeight))
  })

  return {
    storageContext,
    runStorage,
    playerSettings,
    settingsWrites,
    setReadAudioListener: (listener: () => Vec3): void => { readAudioListener = listener },
    setReadAudioListenerForward: (listener: () => Vec3): void => { readAudioListenerForward = listener },
    getReadAudioListenerForward: (): Vec3 => readAudioListenerForward(),
    audio,
    audioBackend,
    endAudio,
    weatherAudio,
    drainEndAudioEvents: (): EndAudioEvent[] => pendingEndAudioEvents.splice(0),
    clearPendingThunder: (): void => {
      for (const timeout of pendingThunder.values()) window.clearTimeout(timeout)
      pendingThunder.clear()
    },
    queueEndAudio,
    placementAudio,
    loadedSession,
    sessionMetadata,
    isCreativeMode,
    initialDimension,
    inputLayer,
    inputContext,
    redstoneRuntime,
    runtimeRedstoneStages,
    atlasTexture,
    softwareRenderer,
    renderQuality,
    worldRenderer,
  }
}
