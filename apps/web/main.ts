/**
 * The browser entry point. THE HOST.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this file is, under the prime directive
 * ---------------------------------------------------------------------------
 *
 * `index.ts` says the only code added to this repository is Layer composition
 * and the stage order table. This file is neither — it is the HOST, the thing
 * `docs/porting.md` §2 names and `domain/composition.ts` keeps referring to as
 * "the host has the type to discharge it". It is not published: `package.json`
 * `files` lists `index.ts` and `domain` and does not list `apps`, and
 * `check-dependency-whitelist.ts`'s own `isToolingOrTestPath` agrees, treating
 * everything outside `index.ts` and `domain/` as tooling.
 *
 * So the rule this file lives under is not "no game rules" (it has none) but
 * "nothing here may be a rule some module should have owned". Concretely it
 * does five things:
 *
 *   1. builds the platform adapters (clock, browser input),
 *   2. registers each module, discharging what registration requires,
 *   3. calls `composeGame`,
 *   4. mounts the screens mx-ui hands back,
 *   5. drives `runFrameWith` from `requestAnimationFrame`.
 *
 * ---------------------------------------------------------------------------
 * COMPOSED MODULES AND THE REMAINING NETWORK BOUNDARY
 * ---------------------------------------------------------------------------
 *
 * `mc-render`, `mx-ui`, `mx-redstone` and `mx-gameplay` are composed. Gameplay
 * supplies its public production services, including the generated chunk
 * store shared with the renderer. `mx-multiplayer` remains outside this host
 * until a production `TransportPort` is selected; composing a test transport
 * would only verify the fake.
 *
 * ---------------------------------------------------------------------------
 * THERE IS A RENDERER NOW, AND THIS FILE STILL DOES NOT DRAW
 * ---------------------------------------------------------------------------
 *
 * This paragraph used to say "mc-render draws nothing yet", and
 * `docs/e2e-triage.md` #1 (`WebGL2 canvas is present and active`) was `fixme`
 * because of it. mc-render now has `application/world-renderer.ts`, and the
 * WebGL2 context on `#game-canvas` is created BY IT — `new WebGLRenderer({
 * canvas })`, inside mc-render, from mc-render's own transcribed parameters.
 *
 * What this file adds is item (1) of the five above and nothing else: `three`
 * is a PLATFORM LIBRARY, supplied here exactly as `window`, `document` and the
 * canvas already are. mc-render describes the seven constructors it needs as
 * structural types in `application/three-surface.ts` and imports `three`
 * nowhere; the host is the only place that can hold the real namespace, because
 * the host is the only place that knows it is in a browser.
 *
 * The line that would have been the violation is still not written. There is no
 * `canvas.getContext(...)` here, no scene, no geometry and no draw call — this
 * file cannot draw a triangle, and `domain/composition.ts` is why. Passing a
 * library to a module that decides what to do with it is wiring; deciding what
 * to draw is a rule, and rules belong to modules.
 *
 * ---------------------------------------------------------------------------
 * THERE IS A WORLD NOW. THIS PARAGRAPH USED TO SAY THE PICTURE WAS A BLUE FIELD
 * ---------------------------------------------------------------------------
 *
 * It read: "No chunk geometry reaches the renderer because no world reaches
 * this page", and it argued that mc-worldgen and mc-meshing COULD NOT be
 * resolved here, for the reason under "WHY THREE MODULES AND NOT SIX".
 *
 * HALF OF THAT WAS RIGHT AND THE HALF THAT WAS WRONG IS THE INTERESTING ONE.
 * The wall it named is real: registering `gameplayModule` needs a `ChunkStore`,
 * an `EntityManager` and an `InventoryService`, and the only implementations
 * are test doubles. But DRAWING TERRAIN NEVER NEEDED `gameplayModule`. It
 * needed chunk geometry, and geometry is data.
 *
 * The blocker was stated as a CATEGORY ("registering a module needs services")
 * over a set that included a case which registers nothing — the fourth time
 * this project has recorded that shape (§0.1 of the residual-work document
 * counts the others).
 *
 * WHAT IS ON THE SCREEN: a deterministic generated world, streamed around the
 * player through mx-gameplay's public world constructor. Gameplay collision,
 * block edits and mc-render meshing all observe the same mc-worldgen store;
 * dirty chunk notifications are the only render synchronization path.
 */
import * as THREE from 'three'
import { Context, Effect, Either, Exit, Layer, Option, Ref, Scope } from 'effect'
import {
  makeWebAudioBackend,
  type Vec3,
} from '@nerima-games/mc-audio'
import { indexedDbStorageLayer } from '@nerima-games/mc-save'
import {
  makeSimFrameState,
  makeTimeService,
  makeWeatherService,
  simStages,
  type ItemStack,
  type SimPhysicsConfig,
  type WeatherState,
} from '@nerima-games/mc-sim'
import {
  chunkCoord,
  chunkSnapshotOf,
  generatedChunkSource,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'
import {
  browserInputLayer,
  ESCAPE_KEY_CODE,
  InputService,
  chunkKeyOf,
  makeChunkStoreMesher,
  makeWorldRenderer,
  renderModule,
  syncWorld,
  wrapHotbarSelection,
  type ChunkRef,
  type RenderEntity,
} from '@nerima-games/mc-render'
import {
  createMainMenuView,
  createCrosshairView,
  createHudView,
  createInventoryView,
  hudViewModel,
  initialMainMenuState,
  inventoryViewModel,
  mainMenuViewModel,
  slotSnapshotOf,
  uiModule,
  type CreateWorldRequest,
  type InventoryInteractionTarget,
  type MainMenuState,
  type SavedWorld,
} from '@nerima-games/mx-ui'
import {
  makeRuntimeRedstoneStages,
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type RedstoneComponentSnapshot,
} from '@nerima-games/mx-redstone'
import {
  applyArmorToDamage,
  armorPointsForEquipment,
  CREEPER_KIND,
  drainBlockUseResults,
  drainItemUseResults,
  drainMobDrops,
  drainPlayerDamages,
  DEFAULT_BLOCK_REACH,
  EYE_LEVEL_OFFSET,
  gameplayStages,
  makeGameplayFrameState,
  makeGeneratedWorld,
  isIgnitionItem,
  isPlaceableItem,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  requestBowShot,
  requestItemUse,
  requestMobSpawn,
  resolveFoodUse,
  requestTargetedBlockBreak,
  requestTargetedBlockUse,
  requestTargetedItemUse,
  requestTargetedPrimaryAttack,
  solidityFromStore,
  spawnMobDrops,
  targetedRightClickRoute,
  weatherLightScale,
  ZOMBIE_KIND,
  type IgnitionItemType,
  type ItemUseResult,
  type MobBehaviour,
  type MobDropEvent,
  type PlaceableItemType,
} from '@nerima-games/mx-gameplay'
import {
  composeGame,
  EMPTY_MODULE_LAYER,
  registerModule,
  type GameModule,
} from '../../domain/composition'
import { DeltaTimeSecs } from '../../domain/kernel-vocabulary'
import { buildQaRegistry, describeQaApiError, installQaApi } from '../../domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'
import {
  announceConfirmedPlacements,
  announceInventoryTransition,
  captionRenderSignature,
  makeAudioRuntime,
} from './audio-runtime'
import { createInventoryInteraction } from './inventory-interaction'
import { requestPlacementFromSelectedSlot, selectedHotbarAfterInput } from './player-experience'
import { createSessionSaveCoordinator } from './session-save-coordinator'
import {
  DEFAULT_PLAYER_SETTINGS,
  PLAYER_BINDING_ACTIONS,
  loadPlayerSettings,
  savePlayerSettings,
  type PlayerSettingsV1,
} from './settings'
import { createSettingsView } from './settings-view'
import {
  advanceTouchLook,
  consumeTouchLook,
  createTouchControlRoster,
  resetTouchLook,
  TOUCH_CONTROL_ACTIONS,
  TOUCH_LOOK_CONTROLLER_IDLE,
  touchControlsPresentation,
  type TouchControlAction,
} from './touch-input'
import {
  listSessions,
  loadSession,
  makeSessionChunkSource,
  saveSession,
  snapshotResidentChunks,
  type DimensionChunk,
  type PersistedLeverState,
  type SessionMetadata,
  type SessionState,
} from './session-persistence'
import {
  createSessionHref,
  createUniqueSessionId,
  readSessionRoute,
  sessionHref,
} from './session-navigation'

/**
 * plan.md §3.4's measured clamp, applied by the DELTA'S PRODUCER.
 *
 * `domain/kernel-vocabulary.ts` is explicit that this is not part of the
 * `DeltaTimeSecs` brand and is not applied by mc-compose: "It is a simulation
 * invariant belonging to whoever produces the delta". The host produces it, so
 * the host clamps it — and without the clamp a backgrounded tab returns for its
 * first frame with a delta of several seconds, which every integrator in the
 * roster would step straight through a wall.
 */
const FIRST_FRAME_SECS = 0.016
const MIN_FRAME_SECS = 0.001
const MAX_FRAME_SECS = 0.05

const clampDelta = (raw: number): DeltaTimeSecs =>
  DeltaTimeSecs(Math.min(Math.max(MIN_FRAME_SECS, raw), MAX_FRAME_SECS))

/** How often the FPS readout is recomputed. Long enough to be a rate, short enough to watch. */
const FPS_WINDOW_SECS = 0.5

/**
 * How fast the player walks, jumps and turns.
 *
 * THESE ARE HOST CONSTANTS AND SHOULD NOT BE. Walk speed and jump impulse are
 * player TUNING, which mc-sim owns — `mc-render/docs/responsibility.md` puts the
 * same class of value there for step height, and `domain/composition.ts` would
 * rather this file held none of them. They are here because mc-sim is not
 * composed and a player with no speed does not move at all.
 *
 * They are the first thing to delete when mc-sim publishes, and they are
 * grouped and labelled so that deletion is one block rather than a search.
 */
const WALK_SPEED_M_PER_S = 4.3
const WALK_EXHAUSTION_PER_METRE = 0.01
const JUMP_SPEED_M_PER_S = 8.4
const LOOK_SENSITIVITY = 0.0022
const WORLD_SEED = 20260728
const DATABASE_NAME = 'nerima-games-minecraft'
const AUTOSAVE_INTERVAL_MS = 5_000
const SAVE_DEBOUNCE_MS = 500
const KNOWN_TARGET_BLOCK = { x: 8, y: 63, z: 8 } as const
const QA_IGNITION_HIT_BLOCK = { x: 8, y: 66, z: 8 } as const
const QA_IGNITION_CELL = { x: 8, y: 66, z: 9 } as const
const QA_IGNITION_SUPPORT_BLOCK = { x: 8, y: 65, z: 9 } as const
const QA_IGNITION_FLOOR_BLOCK = { x: 8, y: 64, z: 10 } as const
const REDSTONE_PLACEMENT_ITEMS: ReadonlySet<string> = new Set([
  'redstone_dust',
  'lever',
  'redstone_lamp',
])

const EQUIPMENT_ONLY_ITEM_TYPES = [
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
] as const satisfies ReadonlyArray<ItemStack['item']>

type EquipmentOnlyItemType = (typeof EQUIPMENT_ONLY_ITEM_TYPES)[number]
type GameplayUseItemType = Exclude<ItemStack['item'], EquipmentOnlyItemType>

const EQUIPMENT_ONLY_ITEM_NAMES: ReadonlySet<string> = new Set(EQUIPMENT_ONLY_ITEM_TYPES)

const isGameplayUseItemType = (item: ItemStack['item']): item is GameplayUseItemType =>
  !EQUIPMENT_ONLY_ITEM_NAMES.has(item)

const isPlaceableGameplayItem = (item: ItemStack['item']): item is PlaceableItemType =>
  isGameplayUseItemType(item) && isPlaceableItem(item)

type InventoryMode = 'player' | 'craftingTable'

const INVENTORY_PRESENTATIONS = {
  player: { label: 'Inventory', width: 2, height: 2 },
  craftingTable: { label: 'Crafting Table', width: 3, height: 3 },
} as const satisfies Record<
  InventoryMode,
  { readonly label: string; readonly width: number; readonly height: number }
>

type SettingsWriteQueue = {
  tail: Promise<void>
  failure: { readonly error: unknown } | undefined
}

const makeSettingsWriteQueue = (): SettingsWriteQueue => ({
  tail: Promise.resolve(),
  failure: undefined,
})

const enqueueSettingsWrite = (
  queue: SettingsWriteQueue,
  write: () => Promise<void>,
  onSuccess: () => void,
  onFailure: (error: unknown) => void,
): void => {
  queue.tail = queue.tail
    .then(write)
    .then(() => {
      queue.failure = undefined
      onSuccess()
    })
    .catch((error: unknown) => {
      queue.failure = { error }
      onFailure(error)
    })
}

const drainSettingsWrites = async (queue: SettingsWriteQueue): Promise<void> => {
  await queue.tail
  if (queue.failure !== undefined) throw queue.failure.error
}

const QA_POSE = {
  feetPosition: { x: 8.5, y: 64.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
} as const
const QA_IGNITION_POSE = {
  feetPosition: { x: 8.5, y: 65, z: 10.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const

const requireElement = (id: string): HTMLElement => {
  const element = document.getElementById(id)
  if (element === null) {
    throw new Error(`index.html is missing #${id}`)
  }
  return element
}

/**
 * The same, narrowed to a canvas.
 *
 * `instanceof` and not a cast. `makeWorldRenderer` is generic in the canvas
 * type — mc-render cannot name `HTMLCanvasElement` — so THIS call site is where
 * the real type is supplied and where a `<div id="game-canvas">` would
 * otherwise sail through into `new WebGLRenderer` and fail somewhere inside
 * three with a message about a null context.
 */
const requireCanvas = (id: string): HTMLCanvasElement => {
  const element = requireElement(id)
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`#${id} is a ${element.tagName}, not a <canvas>`)
  }
  return element
}

/**
 * Report a boot failure where BOTH a human and Playwright can see it.
 *
 * `data-mc-compose-boot` is the machine-readable half. docs/e2e-triage.md #3
 * and #7 ask "no fatal startup errors", and a page that failed to boot silently
 * looks exactly like a page that booted and drew nothing — which is precisely
 * the confusion a smoke test exists to remove.
 */
const failBoot = (reason: string, detail?: unknown): void => {
  document.body.setAttribute('data-mc-compose-boot', 'failed')
  const banner = requireElement('boot-status')
  banner.textContent = `boot failed: ${reason}`
  banner.setAttribute('data-boot-error', reason)
  console.error(`[mc-compose] boot failed: ${reason}`, detail)
}

const bootTitle = async (): Promise<void> => {
  const titleScreen = requireElement('title-screen')
  const menuParent = requireElement('main-menu-root')
  const titleStatus = requireElement('title-status')
  const settingsRoot = requireElement('settings-root')
  titleScreen.hidden = false
  document.body.setAttribute('data-mc-compose-route', 'title')

  const scope = Effect.runSync(Scope.make())
  const storageContext = await Effect.runPromise(
    Effect.provideService(
      Layer.build(indexedDbStorageLayer({ factory: indexedDB, databaseName: DATABASE_NAME })),
      Scope.Scope,
      scope,
    ),
  )
  const sessions = await Effect.runPromise(Effect.provide(listSessions(), storageContext))
  let playerSettings = await Effect.runPromise(
    Effect.provide(loadPlayerSettings(), storageContext),
  ).catch(() => DEFAULT_PLAYER_SETTINGS)
  const settingsWrites = makeSettingsWriteQueue()
  let settingsView: ReturnType<typeof createSettingsView>
  const persistPlayerSettings = (next: PlayerSettingsV1): void => {
    document.body.setAttribute('data-player-settings-persistence', 'dirty')
    settingsView.clearPersistenceError()
    enqueueSettingsWrite(
      settingsWrites,
      () => Effect.runPromise(Effect.provide(savePlayerSettings(next), storageContext)),
      () => {
        if (playerSettings === next) {
          document.body.setAttribute('data-player-settings-persistence', 'saved')
        }
      },
      (error) => {
        document.body.setAttribute('data-player-settings-persistence', 'error')
        const message = 'Settings could not be saved.'
        titleStatus.textContent = message
        settingsView.reportPersistenceError(message)
        console.error('[mc-compose] player settings persistence failed', error)
      },
    )
  }
  const savedWorlds: ReadonlyArray<SavedWorld> = sessions.map(({ sessionId, metadata }) => ({
    sessionId,
    name: metadata.name,
  }))
  const existingIds = savedWorlds.map(({ sessionId }) => sessionId)
  let menuState: MainMenuState = initialMainMenuState
  let menuView: ReturnType<typeof createMainMenuView>
  settingsView = createSettingsView(document, settingsRoot, {
    onChange: (next) => {
      playerSettings = next
      persistPlayerSettings(next)
    },
    onClose: () => {
      titleScreen.inert = false
    },
  })

  let titleNavigationPending = false
  const setTitleNavigationPending = (pending: boolean): void => {
    titleNavigationPending = pending
    if (pending) menuParent.setAttribute('aria-busy', 'true')
    else menuParent.removeAttribute('aria-busy')
    for (const control of menuParent.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
      control.disabled = pending
    }
  }

  const navigateAfterSettingsSaved = async (href: string): Promise<void> => {
    if (titleNavigationPending) return
    setTitleNavigationPending(true)
    try {
      await drainSettingsWrites(settingsWrites)
      window.location.assign(href)
    } catch (error: unknown) {
      setTitleNavigationPending(false)
      titleStatus.textContent = 'Could not finish saving settings. Please try again.'
      console.error('[mc-compose] navigation blocked by settings persistence failure', error)
    }
  }
  const openSession = async (sessionId: string): Promise<void> => {
    await navigateAfterSettingsSaved(sessionHref(sessionId))
  }
  const createWorld = async ({ name, mode }: CreateWorldRequest): Promise<void> => {
    if (mode === 'creative') {
      titleStatus.textContent = 'Creative is not available yet.'
      return
    }
    titleStatus.textContent = ''
    const sessionId = createUniqueSessionId(name, existingIds)
    await navigateAfterSettingsSaved(createSessionHref(sessionId, { name, mode }))
  }

  menuView = createMainMenuView(document, menuParent, {
    onStateChange: (state) => {
      menuState = state
      menuView.render(mainMenuViewModel(menuState, savedWorlds))
    },
    onCreateWorld: (request) => {
      void createWorld(request)
    },
    onLoadWorld: ({ sessionId }) => {
      void openSession(sessionId)
    },
    onOpenSettings: () => {
      const returnFocus = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : menuParent
      titleStatus.textContent = ''
      titleScreen.inert = true
      settingsView.open(playerSettings, returnFocus)
    },
  })
  menuView.render(mainMenuViewModel(menuState, savedWorlds))
  const handleTitlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) settingsView.dispose()
  }
  window.addEventListener('pagehide', handleTitlePageHide)
  const hot = (import.meta as ImportMeta & {
    readonly hot?: { readonly dispose: (handler: () => void) => void }
  }).hot
  hot?.dispose(() => {
    window.removeEventListener('pagehide', handleTitlePageHide)
    settingsView.dispose()
  })
  document.body.setAttribute('data-mc-compose-boot', 'running')
}

const bootGame = async (
  sessionId: string,
  creationMetadata?: SessionMetadata,
): Promise<void> => {
  const gameShell = requireElement('game-shell')
  const pauseOverlay = requireElement('pause-overlay')
  const resumeButton = requireElement('resume-button')
  const settingsButton = requireElement('settings-button')
  const saveQuitButton = requireElement('save-quit-button')
  const pauseError = requireElement('pause-error')
  const settingsRoot = requireElement('settings-root')
  gameShell.hidden = false
  document.body.setAttribute('data-mc-compose-route', 'session')
  document.body.setAttribute('data-session-id', sessionId)
  const canvas = requireCanvas('game-canvas')
  const hudParent = requireElement('hud-root')
  const captionsParent = requireElement('sound-captions')
  const inventoryParent = requireElement('inventory-root')
  const touchControlsParent = requireElement('touch-controls')
  const touchLookSurface = requireElement('touch-look-surface')
  const fpsValue = requireElement('fps-value')
  const stageList = requireElement('stage-order')
  let inventoryOpen = false
  let inventoryMode: InventoryMode = 'player'
  let paused = false

  const touchControlTargets = Object.fromEntries(TOUCH_CONTROL_ACTIONS.map((action) => {
    const target = gameShell.querySelector<HTMLElement>(`[data-touch-action="${action}"]`)
    if (target === null) throw new Error(`Missing touch control: ${action}`)
    return [action, target]
  })) as Record<TouchControlAction, HTMLElement>
  const touchControls = createTouchControlRoster(touchControlTargets)
  const touchAvailable = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  let touchLookState = TOUCH_LOOK_CONTROLLER_IDLE

  const contactFrom = (touch: Touch) => ({
    identifier: touch.identifier,
    clientX: touch.clientX,
    clientY: touch.clientY,
  })
  const matchingLookContact = (event: TouchEvent): Touch | undefined =>
    Array.from(event.changedTouches).find(
      (touch) => touch.identifier === touchLookState.activeIdentifier,
    )

  touchLookSurface.addEventListener('touchstart', (event) => {
    const touch = event.changedTouches.item(0)
    if (touch === null) return
    event.preventDefault()
    touchLookState = advanceTouchLook(touchLookState, 'start', contactFrom(touch))
  }, { passive: false })
  touchLookSurface.addEventListener('touchmove', (event) => {
    const touch = matchingLookContact(event)
    if (touch === undefined) return
    event.preventDefault()
    touchLookState = advanceTouchLook(touchLookState, 'move', contactFrom(touch))
  }, { passive: false })
  touchLookSurface.addEventListener('touchend', (event) => {
    const touch = matchingLookContact(event)
    if (touch === undefined) return
    event.preventDefault()
    touchLookState = advanceTouchLook(touchLookState, 'end', contactFrom(touch))
  }, { passive: false })
  touchLookSurface.addEventListener('touchcancel', (event) => {
    const touch = matchingLookContact(event)
    if (touch === undefined) return
    event.preventDefault()
    touchLookState = advanceTouchLook(touchLookState, 'cancel', contactFrom(touch))
  }, { passive: false })

  // -------------------------------------------------------------------------
  // 1. Platform adapters
  // -------------------------------------------------------------------------

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
  const audioBackend = Effect.runSync(makeWebAudioBackend({
    global: globalThis,
    initialMasterGain: playerSettings.audioEnabled ? playerSettings.masterVolume : 0,
  }))
  const audio = Effect.runSync(makeAudioRuntime({
    backend: audioBackend,
    nowSecs: browserClock.monotonicSecs,
    listener: () => readAudioListener(),
    settings: playerSettings,
  }))
  const loadedSession = await runStorage(
    Effect.provide(loadSession(sessionId), storageContext),
  )
  const sessionMetadata = Option.isSome(loadedSession)
    ? loadedSession.value.metadata
    : creationMetadata ?? { name: sessionId, mode: 'survival' }

  // POINTER LOCK IS THE HOST'S TO ASK FOR. mc-render's `InputService` treats a
  // click as a GAME action only while the pointer is locked, and as a UI click
  // otherwise — the closed-world predicate `domain/input-bindings.ts` describes,
  // and the reason a HUD click cannot steal the pointer. Without this, `attack`
  // never fires and no block can be broken.
  const inputLayer = browserInputLayer({
    targets: { window, document },
    canvas,
    bindings: playerSettings.bindings,
    allowsPointerLock: () => !inventoryOpen && !paused,
    touchControls,
  })

  // The gesture the browser requires: pointer lock can only be requested from a
  // user activation, so the canvas asks on click.
  //
  // A REFUSAL IS NOT AN ERROR. Some environments decline pointer lock outright
  // — Playwright on SwiftShader is one, and answers `WrongDocumentError` — and
  // a host that let that reach the console would make every automated run
  // report a failure it cannot do anything about. The game degrades exactly as
  // mc-render's `UNAVAILABLE_POINTER_LOCK` describes: keyboard still works,
  // clicks stay UI clicks, and `attack` does not fire.
  canvas.addEventListener('click', (event) => {
    if (event.isTrusted) audio.unlock()
    if (inventoryOpen || document.pointerLockElement === canvas) {
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

  // -------------------------------------------------------------------------
  // 2. Registration
  // -------------------------------------------------------------------------

  // The renderer. mc-render builds it; this file supplies only the two things
  // it cannot reach — the `three` namespace and the element to draw on.
  //
  // `clientWidth`/`clientHeight` and not `width`/`height`: the canvas has the
  // host's CSS 100vw/100vh rule on it and no width attribute, so the attribute
  // pair is three's default 300x150 and the layout pair is the viewport. That
  // distinction is also why mc-render passes `updateStyle: false` to `setSize`
  // — see `application/world-renderer.ts`.
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
  const worldRenderer = await Effect.runPromise(
    makeWorldRenderer<HTMLCanvasElement, THREE.BufferGeometry, THREE.MeshBasicMaterial>(
      THREE,
      canvas,
      { width: canvas.clientWidth, height: canvas.clientHeight },
    ),
  )

  // The canvas is the host's element and its SIZE is the host's business, so
  // the resize listener is here rather than in mc-render — mc-render ships no
  // `lib.DOM` and could not add one. It tells the renderer; the renderer
  // decides what that means for the projection.
  window.addEventListener('resize', () => {
    Effect.runSync(worldRenderer.resize(canvas.clientWidth, canvas.clientHeight))
  })

  // -------------------------------------------------------------------------
  // 2a. The generated world, shared by gameplay and rendering
  // -------------------------------------------------------------------------
  //
  // ONE CONSTRUCTION. The gameplay adapter and the renderer-facing worldgen
  // store returned here wrap the same store instance, so a mined block cannot
  // disappear from collision while remaining visible (or vice versa).
  let activeSeed = WORLD_SEED
  let initialKnownChunks: ReadonlyArray<DimensionChunk> = []
  type Dimension = SessionState['dimension']
  const initialDimension: Dimension = Option.isSome(loadedSession)
    ? loadedSession.value.state.dimension
    : 'overworld'

  const generatedSource = generatedChunkSource(
    Option.isSome(loadedSession) ? loadedSession.value.state.seed : WORLD_SEED,
  )
  const restored = Option.isSome(loadedSession)
    ? await runStorage(
        Effect.provide(
          makeSessionChunkSource(loadedSession.value, initialDimension, generatedSource),
          storageContext,
        ),
      )
    : undefined
  if (Option.isSome(loadedSession)) {
    activeSeed = loadedSession.value.state.seed
    initialKnownChunks = (restored?.chunks ?? []).map(({ dimension, chunk }) => ({
      dimension,
      chunk: chunkSnapshotOf(chunk),
    }))
  }

  const persistedChunks = new Map(
    (restored?.chunks ?? []).map(({ dimension, chunk }) => [
      `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`,
      chunk,
    ]),
  )
  const chunkSourceFor = (dimension: Dimension): ChunkSource => (coord) => {
    const persisted = persistedChunks.get(
      `${dimension}:${String(coord.cx)},${String(coord.cz)}`,
    )
    return persisted === undefined
      ? generatedSource(coord)
      : Effect.sync(() => chunkSnapshotOf(persisted))
  }

  const world = await Effect.runPromise(
    makeGeneratedWorld<MobBehaviour>({
      seed: activeSeed,
      chunkSource: chunkSourceFor(initialDimension),
      dimension: initialDimension,
    }),
  )
  const initialSpawnPose = await Effect.runPromise(world.player.pose)
  const initialSpawnDimension = await Effect.runPromise(world.player.dimension)
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(world.inventory.restoreStorage(loadedSession.value.state.storage))
    await Effect.runPromise(
      world.player.restore(loadedSession.value.state.player, loadedSession.value.state.dimension),
    )
    await Effect.runPromise(world.vitals.restore(loadedSession.value.state.vitals))
  } else {
    await Effect.runPromise(world.inventory.add('redstone_dust', 16))
    await Effect.runPromise(world.inventory.add('lever', 4))
    await Effect.runPromise(world.inventory.add('redstone_lamp', 8))
  }
  const time = await Effect.runPromise(makeTimeService())
  const weather = await Effect.runPromise(makeWeatherService())
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(time.restore(loadedSession.value.state.time))
    await Effect.runPromise(weather.restore(loadedSession.value.state.weather))
  }

  const presentWeather = (state: WeatherState): void => {
    canvas.setAttribute('data-weather', state.weather)
    canvas.setAttribute('data-weather-remaining-secs', String(state.remainingSecs))
    canvas.style.filter = `brightness(${String(weatherLightScale(state.weather))})`
  }
  presentWeather(Effect.runSync(weather.snapshot))

  type DimensionChunkContext = {
    readonly dimension: Dimension
    readonly chunkStore: typeof world.chunkStore
    readonly worldgenChunkStore: typeof world.worldgenChunkStore
    readonly dirtyChunks: Parameters<typeof syncWorld>[1]
    readonly meshChunkFromStore: Parameters<typeof syncWorld>[2]
    readonly streamLoaded: Set<string>
  }
  const makeDimensionChunkContext = (
    dimension: Dimension,
    dimensionWorld: typeof world,
  ): DimensionChunkContext => ({
    dimension,
    chunkStore: dimensionWorld.chunkStore,
    worldgenChunkStore: dimensionWorld.worldgenChunkStore,
    dirtyChunks: Effect.runSync(dimensionWorld.worldgenChunkStore.subscribeDirty),
    meshChunkFromStore: makeChunkStoreMesher(dimensionWorld.worldgenChunkStore),
    streamLoaded: new Set<string>(),
  })
  const dimensionContexts = new Map<Dimension, DimensionChunkContext>()
  const initialChunkContext = makeDimensionChunkContext(initialDimension, world)
  dimensionContexts.set(initialDimension, initialChunkContext)
  let currentChunkContext = initialChunkContext
  const leverKeyOf = (lever: Pick<PersistedLeverState, 'dimension' | 'position'>): string =>
    JSON.stringify([lever.dimension, lever.position.x, lever.position.y, lever.position.z])
  const leverStates = new Map<string, PersistedLeverState>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.redstone.levers : [])
      .map((lever) => [leverKeyOf(lever), lever]),
  )
  let redstoneDirty = true

  const getOrCreateDimensionChunkContext = (
    dimension: Dimension,
  ): DimensionChunkContext => {
    const existing = dimensionContexts.get(dimension)
    if (existing !== undefined) return existing
    const dimensionWorld = Effect.runSync(
      makeGeneratedWorld<MobBehaviour>({
        seed: activeSeed,
        chunkSource: chunkSourceFor(dimension),
        dimension,
      }),
    )
    const created = makeDimensionChunkContext(dimension, dimensionWorld)
    dimensionContexts.set(dimension, created)
    return created
  }

  // Gameplay stages keep one stable service reference while every operation is
  // dispatched to the currently active dimension's backing store.
  const currentChunkStore = new Proxy(world.chunkStore, {
    get: (_target, property) => Reflect.get(currentChunkContext.chunkStore, property),
  }) as typeof world.chunkStore

  const reportPersistenceFailure = (error: unknown): void => {
    document.body.setAttribute('data-session-persistence', 'failed')
    console.error('[mc-compose] session persistence failed', error)
  }
  const saveCoordinator = createSessionSaveCoordinator<SessionState>({
    initialKnownChunks,
    snapshotResidents: async () => {
      const residents = await Promise.all(
        [...dimensionContexts.values()].map(async (context) =>
          (await Effect.runPromise(snapshotResidentChunks(context.worldgenChunkStore))).map(
            (chunk): DimensionChunk => ({ dimension: context.dimension, chunk }),
          ),
        ),
      )
      return residents.flat()
    },
    snapshotState: () => ({
      seed: activeSeed,
      dimension: Effect.runSync(world.player.dimension),
      player: Effect.runSync(world.player.pose),
      storage: Effect.runSync(world.inventory.storageSnapshot),
      vitals: Effect.runSync(world.vitals.snapshot),
      time: Effect.runSync(time.snapshot),
      weather: Effect.runSync(weather.snapshot),
      redstone: { levers: [...leverStates.values()] },
    }),
    publish: ({ state, chunks }) =>
      runStorage(
        Effect.provide(
          saveSession({
            sessionId,
            revision: crypto.randomUUID(),
            metadata: sessionMetadata,
            state,
            chunks,
          }),
          storageContext,
        ),
      ).then(() => undefined),
    onFailure: reportPersistenceFailure,
  })
  let markSessionDirty = (): void => {}
  const spawnPose = await Effect.runPromise(world.player.pose)
  canvas.setAttribute('data-world-source', restored === undefined ? 'generated' : 'persisted')
  canvas.setAttribute('data-world-seed', String(activeSeed))

  // STREAMING, keyed to where the player is — not a one-shot load at boot.
  //
  // A fixed radius bounds memory while still exercising both add and removal.
  const STREAM_RADIUS_CHUNKS = 2
  let chunksStreamedIn = 0
  let chunksDropped = 0

  /**
   * Which chunks should be resident around a world position.
   *
   * The world is unbounded horizontally, so every coordinate in the radius is
   * loadable and no fixture-edge filtering is needed.
   */
  const desiredAround = (x: number, z: number): ReadonlyArray<ChunkRef> => {
    const cx0 = Math.floor(x / 16)
    const cz0 = Math.floor(z / 16)
    const wanted: Array<ChunkRef> = []
    for (let cx = cx0 - STREAM_RADIUS_CHUNKS; cx <= cx0 + STREAM_RADIUS_CHUNKS; cx += 1) {
      for (let cz = cz0 - STREAM_RADIUS_CHUNKS; cz <= cz0 + STREAM_RADIUS_CHUNKS; cz += 1) {
        wanted.push({ cx, cz })
      }
    }
    return wanted
  }

  const streamAround = (
    context: DimensionChunkContext,
    x: number,
    z: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const wanted = desiredAround(x, z)
      const wantedKeys = new Set(wanted.map(chunkKeyOf))
      const changed = wanted.filter((chunk) => !context.streamLoaded.has(chunkKeyOf(chunk)))
      const removed = [...context.streamLoaded]
        .filter((key) => !wantedKeys.has(key))
        .map((key) => {
          const [cx, cz] = key.split(',')
          return { cx: Number(cx), cz: Number(cz) }
      })

      for (const chunk of changed) {
        yield* context.chunkStore.load(chunk)
        context.streamLoaded.add(chunkKeyOf(chunk))
      }
      for (const chunk of removed) {
        const snapshot = yield* context.worldgenChunkStore.snapshot(chunkCoord(chunk.cx, chunk.cz))
        if (snapshot !== undefined) {
          saveCoordinator.retainChunk({ dimension: context.dimension, chunk: snapshot })
          markSessionDirty()
        }
        yield* context.chunkStore.unload(chunk)
        context.streamLoaded.delete(chunkKeyOf(chunk))
      }

      if (changed.length > 0 || removed.length > 0) redstoneDirty = true

      yield* syncWorld(worldRenderer, context.dirtyChunks, context.meshChunkFromStore)
      chunksStreamedIn += changed.length
      chunksDropped += removed.length
      canvas.setAttribute('data-chunks-meshed', String(context.streamLoaded.size))
      canvas.setAttribute('data-chunks-streamed-in', String(chunksStreamedIn))
      canvas.setAttribute('data-chunks-dropped', String(chunksDropped))
    })

  const retainDimensionResidents = (context: DimensionChunkContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const residents = yield* snapshotResidentChunks(context.worldgenChunkStore)
      for (const chunk of residents) {
        saveCoordinator.retainChunk({ dimension: context.dimension, chunk })
      }
    })

  const clearRenderedChunks: Effect.Effect<void> = Effect.gen(function* () {
    const rendered = yield* worldRenderer.chunkKeys
    for (const key of rendered) yield* worldRenderer.removeChunk(key)
  })

  const syncRedstoneSnapshot = (context: DimensionChunkContext): void => {
    const residents = Effect.runSync(snapshotResidentChunks(context.worldgenChunkStore))
    const components: Array<RedstoneComponentSnapshot> = []
    const observedLevers = new Set<string>()
    for (const chunk of residents) {
      for (let lx = 0; lx < 16; lx += 1) {
        for (let lz = 0; lz < 16; lz += 1) {
          for (let y = 0; y < 256; y += 1) {
            const block = chunk.blocks[y + lz * 256 + lx * 4096]
            const kind = block === 74
              ? 'wire'
              : block === 76
                ? 'lever'
                : block === 79 || block === 80
                  ? 'lamp'
                  : undefined
            if (kind === undefined) continue
            const position = { x: chunk.coord.cx * 16 + lx, y, z: chunk.coord.cz * 16 + lz }
            if (kind === 'lever') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              observedLevers.add(key)
              components.push({ position, kind, active: leverStates.get(key)?.active ?? false })
            } else {
              components.push({ position, kind })
            }
          }
        }
      }
    }

    for (const [key, lever] of leverStates) {
      if (lever.dimension !== context.dimension) continue
      const residentKey = chunkKeyOf({
        cx: Math.floor(lever.position.x / 16),
        cz: Math.floor(lever.position.z / 16),
      })
      if (context.streamLoaded.has(residentKey) && !observedLevers.has(key)) {
        leverStates.delete(key)
        markSessionDirty()
      }
    }
    Effect.runSync(redstoneRuntime.syncSnapshot({ dimension: context.dimension, components }))
    redstoneDirty = false
  }

  await Effect.runPromise(
    streamAround(currentChunkContext, spawnPose.feetPosition.x, spawnPose.feetPosition.z),
  )

  // `renderModule()` is called for its `frameStages` only; its `layers` field
  // is replaced by the browser adapter. The module's own header sanctions
  // exactly this: "Pass it where `InputServiceLayer()` would go — `renderModule`'s
  // `layers` is the same tag."
  //
  // The third argument is the `DrawPort` that `render:draw` calls. Its default
  // is `NO_DRAW_TARGET`, which is what every Node consumer gets and what this
  // page got until the renderer existed.
  /**
   * The starting pose, derived from the generated surface height.
   *
   * The TYPE IS DERIVED FROM THE FUNCTION rather than named, because
   * `CameraPoseSnapshot` lives in mc-render's kernel-vocabulary MIRROR and
   * `index.ts` deliberately keeps that out of the barrel — consumers take
   * kernel's vocabulary from `@nerima-games/mc-kernel`, which is not published.
   * `Parameters<typeof renderModule>[3]` follows the signature instead, so a
   * change to it fails here rather than drifting.
   *
   * The cast inside is for the brands: `position` is a branded `Position` and
   * `capturedAtSecs` a branded `MonotonicTimeSecs`. Neither has a runtime
   * representation and the renderer reads five numbers off this.
   *
   * The camera is eye-level above the player service's feet position.
   */
  const initialPose = ({
    position: {
      x: spawnPose.feetPosition.x,
      y: spawnPose.feetPosition.y + EYE_LEVEL_OFFSET,
      z: spawnPose.feetPosition.z,
    },
    yawRadians: spawnPose.yawRadians,
    pitchRadians: spawnPose.pitchRadians,
    capturedAtSecs: 0,
  } as unknown as NonNullable<Parameters<typeof renderModule>[3]>)

  const render = renderModule(undefined, undefined, worldRenderer, initialPose)

  const registeredRender = await Effect.runPromise(
    Effect.provide(
      registerModule({
        name: '@nerima-games/mc-render',
        layers: inputLayer,
        frameStages: render.frameStages,
      }),
      inputContext,
    ),
  )

  // `EMPTY_MODULE_LAYER` and not `uiModule.layers`, even though the two are the
  // same value. `Layer.empty` is typed `Layer<never, never, never>` and does NOT
  // assign to `ModuleLayer`: `Layer` declares `in ROut` contravariantly, so the
  // empty Layer is the single case where `any` would have to assign to `never`.
  // `domain/composition.ts` exports the constant precisely so that the cast
  // lives in one place — and `pnpm typecheck:app` caught this the first time,
  // which is the whole argument for that project existing.
  const registeredUi = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-ui',
      layers: EMPTY_MODULE_LAYER,
      frameStages: uiModule.frameStages,
    }),
  )

  const registeredRedstone = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-redstone',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(runtimeRedstoneStages),
    }),
  )

  // -------------------------------------------------------------------------
  // 2c. gameplayModule, and the four services it requires
  // -------------------------------------------------------------------------
  //
  // `gameplayModule` is `GameModule<..., ChunkStore | EntityManager |
  // InventoryService | PlayerService>`. Until mx-gameplay shipped complete
  // in-memory implementations of all four, this file's own header recorded the
  // wall correctly: the only implementations in the organisation were
  // `test/support/*-double.ts`, none exported, and composing them would be
  // 「偽物のモジュールを4つ作って合成すれば、検証されるのは偽物である」.
  //
  // WHAT CHANGED IS NOT THAT RULE. Those four are now real services on
  // mx-gameplay's PUBLIC API — every member implemented, no `dieMessage`, and
  // mc-compose is allowed to import mx-gameplay. Nothing here reaches past it.
  //
  const playerApi = world.player
  readAudioListener = () => Effect.runSync(playerApi.pose).feetPosition
  const inputApi = Context.get(inputContext, InputService)
  const applyBindings = (bindings: PlayerSettingsV1['bindings']): void => {
    for (const action of PLAYER_BINDING_ACTIONS) {
      Effect.runSync(inputApi.rebind(action, `PlayerSettingsTemporary:${action}`))
    }
    for (const action of PLAYER_BINDING_ACTIONS) {
      const code = bindings[action] ?? DEFAULT_PLAYER_SETTINGS.bindings[action]
      if (code === undefined) throw new Error(`Missing default binding for ${action}`)
      Effect.runSync(inputApi.rebind(action, code))
    }
  }
  const simState = await Effect.runPromise(makeSimFrameState)
  const isGameplayBlockSolid = solidityFromStore(currentChunkStore)
  const simPhysicsConfig: SimPhysicsConfig = {
    resolve: {
      halfWidth: PLAYER_HALF_WIDTH,
      // mc-sim exposes this branded field but not the brand constructor.
      halfHeight: PLAYER_HALF_HEIGHT as SimPhysicsConfig['resolve']['halfHeight'],
      isBlockSolid: (blockX, blockY, blockZ) =>
        isGameplayBlockSolid({ x: blockX, y: blockY, z: blockZ }),
    },
    walkSpeed: WALK_SPEED_M_PER_S,
    jumpSpeed: JUMP_SPEED_M_PER_S,
  }
  const resetSimState = (physicsEnabled: boolean): void => {
    Effect.runSync(Ref.set(simState.resolvedFeetPosition, Option.none()))
    Effect.runSync(Ref.set(simState.movementIntent, { forward: 0, strafe: 0 }))
    Effect.runSync(Ref.set(simState.jumpIntent, false))
    Effect.runSync(Ref.set(simState.velocity, { x: 0, y: 0, z: 0 }))
    Effect.runSync(Ref.set(simState.isGrounded, false))
    Effect.runSync(
      Ref.set(
        simState.physicsConfig,
        physicsEnabled ? Option.some(simPhysicsConfig) : Option.none(),
      ),
    )
  }
  const alignActiveDimension = (dimension: Dimension): boolean => {
    if (currentChunkContext.dimension === dimension) return false
    Effect.runSync(retainDimensionResidents(currentChunkContext))
    currentChunkContext = getOrCreateDimensionChunkContext(dimension)
    Effect.runSync(clearRenderedChunks)
    redstoneDirty = true
    return true
  }
  let breaksRequested = 0
  let placementsRequested = 0
  let nextItemUseRequestId = 0
  let nextBlockUseRequestId = 0

  // THE FRAME STATE IS BUILT HERE, not inside `gameplayModule`, and that is the
  // whole reason breaking works. `gameplayStages` takes the state as an
  // argument — `makeGameplayStages` builds a private one — and `pendingBreaks`
  // is an INBOX the host fills. mx-gameplay's own header says so: "Input
  // belongs to mc-render and reaches the rules as a request to act on a
  // position."
  //
  // A host that used `gameplayModule` directly would get stages that drain an
  // inbox nobody can reach, which is the 「callable but unreachable」 state that
  // repository has had to correct more than once.
  const gameplayState = await Effect.runPromise(makeGameplayFrameState)
  const observedMobDrops: Array<MobDropEvent & { readonly renderId: string }> = []
  let nextMobDropId = 0
  let lastObservedItemUse: ItemUseResult | undefined
  const pendingItemUses = new Map<
    string,
    { readonly slotIndex: number; readonly heldItem: IgnitionItemType }
  >()
  const pendingBlockUses = new Map<
    string,
    { readonly dimension: Dimension; readonly position: { readonly x: number; readonly y: number; readonly z: number } }
  >()

  const registeredSim = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mc-sim',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(simStages(simState, time, playerApi)),
    }),
  )

  const registeredGameplay = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-gameplay',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(
        gameplayStages(
          gameplayState,
          currentChunkStore,
          world.entities,
          world.inventory,
          world.player,
          time,
        ),
      ),
    }),
  )

  const modules: ReadonlyArray<GameModule> = [
    registeredRender,
    registeredUi,
    registeredRedstone,
    registeredSim,
    registeredGameplay,
  ]

  // -------------------------------------------------------------------------
  // 3. Composition
  // -------------------------------------------------------------------------

  const composed = composeGame(modules)

  if (Either.isLeft(composed)) {
    failBoot('composeGame rejected the stage set', composed.left)
    return
  }

  const game = composed.right

  // Reported, never enforced — `domain/composition.ts` on why a dangling `after`
  // is legal and still worth printing.
  for (const warning of game.warnings) {
    console.warn(`[mc-compose] ${warning}`)
  }

  // The resolved total order, in the DOM. This is (a) of docs/testing.md §3.4
  // made visible in the browser: `test/e2e/roster-frame-order.test.ts` proves it
  // headless from a transcript, and this is the same claim about the modules
  // actually loaded.
  stageList.textContent = game.plan.order.join(' ')
  stageList.setAttribute('data-stage-count', String(game.plan.order.length))

  // -------------------------------------------------------------------------
  // 4. Screens
  // -------------------------------------------------------------------------

  // `document` satisfies mx-ui's `DomElementFactory` without a cast — that is
  // the property `mx-ui/application/dom-surface.ts` was designed around, and
  // the parent is an argument because mx-ui never goes looking for a document
  // (docs/public-api.md §4-1).
  //
  // NOTE: mx-ui's tidy `UiMount` facade in §4-1 is still unimplemented, so the
  // host calls the per-screen constructors directly. That is a smaller surface
  // than it looks: both take (factory, parent, motion) and hand back a handle.
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
  const hud = createHudView(document, hudParent, motion)
  const inventoryView = createInventoryView(document, inventoryParent)
  createCrosshairView(document, hudParent, motion)

  inventoryParent.setAttribute('role', 'dialog')
  inventoryParent.setAttribute('aria-label', 'Inventory')
  inventoryParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-inventory-open', 'false')

  let selectedHotbarIndex = 0
  let inventoryFocus: InventoryInteractionTarget = {
    kind: 'slot',
    region: 'hotbar',
    index: selectedHotbarIndex,
  }
  const inventoryInteraction = createInventoryInteraction(world.inventory, {
    onCrafted: () => markSessionDirty(),
    onInventoryChanged: () => markSessionDirty(),
  })
  const playerIsDead = (): boolean => Effect.runSync(world.vitals.view).healthPoints <= 0
  let touchControlsVisible = false
  const resetTouchInput = (
    reason: Parameters<typeof resetTouchLook>[1],
  ): void => {
    touchLookState = resetTouchLook(touchLookState, reason)
    Effect.runSync(inputApi.clearHeld)
  }
  const syncTouchControls = (): void => {
    const presentation = touchControlsPresentation({
      touchAvailable,
      playing: true,
      dead: playerIsDead(),
      inventoryOpen,
      paused,
    })
    const wasVisible = touchControlsVisible
    touchControlsVisible = presentation.visible
    touchControlsParent.hidden = !presentation.visible
    touchControlsParent.inert = presentation.inert
    touchControlsParent.setAttribute('aria-hidden', String(!presentation.visible))
    if (wasVisible && !presentation.visible) resetTouchInput('state-transition')
  }
  const applyPlayerDamage = (
    damage: Parameters<typeof world.vitals.damage>[0],
  ): void => {
    const equipment = Effect.runSync(world.inventory.equipmentSnapshot)
    const reducedDamage = applyArmorToDamage(damage, armorPointsForEquipment(equipment))
    const healthBefore = Effect.runSync(world.vitals.view).healthPoints
    Effect.runSync(world.vitals.damage(reducedDamage))
    if (Effect.runSync(world.vitals.view).healthPoints < healthBefore) {
      audio.play('playerHurt')
    }
    if (playerIsDead()) resetSimState(false)
    syncTouchControls()
  }

  const interactionStatus = (): string => {
    const status = inventoryInteraction.state().status
    if (status === undefined) return ''
    switch (status._tag) {
      case 'Crafted':
        return `Crafted ${String(status.output.count)} ${status.output.item}`
      case 'MissingIngredients':
        return 'Missing ingredients'
      case 'NoRoom':
        return 'Inventory is full'
      case 'NoMatch':
        return 'No matching recipe'
    }
  }

  const renderPlayerUi = (): void => {
    const storage = Effect.runSync(world.inventory.storageSnapshot)
    const durabilityBySlot = new Map<number, number>()
    storage.inventoryDurability.forEach((durability, slotIndex) => {
      if (durability !== null) {
        durabilityBySlot.set(slotIndex, durability.current / durability.max)
      }
    })
    const equipment = storage.equipment.slots
    const equipmentSlot = (slot: typeof equipment.head) =>
      slot === null ? undefined : { item: slot.item, count: slot.count }
    const draft = inventoryInteraction.state()
    hud.render(hudViewModel({
      ...Effect.runSync(world.vitals.view),
      hotbar: storage.inventory.slots
        .slice(0, 9)
        .map((slot, slotIndex) => slotSnapshotOf(slot, durabilityBySlot.get(slotIndex))),
      selectedHotbarIndex,
    }))
    inventoryView.render(inventoryViewModel({
      inventory: storage.inventory,
      selectedHotbarIndex,
      durabilityBySlot,
      carried: draft.inventoryCarried ?? draft.carried,
      armour: [
        equipmentSlot(equipment.head),
        equipmentSlot(equipment.chest),
        equipmentSlot(equipment.legs),
        equipmentSlot(equipment.feet),
      ],
      offhand: equipmentSlot(equipment.offhand),
      crafting: {
        gridWidth: draft.grid.width,
        grid: draft.grid.cells,
        result: draft.preview,
      },
      mergeableSlotIndices: undefined,
    }), {
      focused: inventoryFocus,
      status: interactionStatus(),
    })
  }

  const targetOf = (source: EventTarget | null): InventoryInteractionTarget | undefined => {
    if (!(source instanceof Element)) return undefined
    const interactive = source.closest<HTMLElement>('[role="button"]')
    if (interactive === null || !inventoryParent.contains(interactive)) return undefined
    if (interactive.matches('[data-mx-ui="crafting-output"]')) {
      return { kind: 'crafting-output' }
    }
    if (!interactive.matches('[data-mx-ui="slot"]')) return undefined
    const region = interactive.closest<HTMLElement>('[data-region]')?.dataset['region']
    const index = Number(interactive.dataset['slotIndex'])
    if (
      !Number.isInteger(index) ||
      (region !== 'hotbar' && region !== 'main' && region !== 'crafting-grid')
    ) {
      return undefined
    }
    return { kind: 'slot', region, index }
  }

  const focusRenderedTarget = (): void => {
    inventoryParent.querySelector<HTMLElement>('[role="button"][tabindex="0"]')?.focus()
  }

  const activateInventoryTarget = (
    target: InventoryInteractionTarget,
    button: 'left' | 'right' = 'left',
  ): void => {
    if (playerIsDead()) return
    inventoryFocus = target
    if (target.kind === 'crafting-output') {
      Effect.runSync(inventoryInteraction.craftOnce())
    } else if (target.region === 'crafting-grid') {
      Effect.runSync(inventoryInteraction.interactCraftingCellFromInventory(target.index))
      Effect.runSync(inventoryInteraction.preview())
    } else if (target.region === 'hotbar') {
      Effect.runSync(inventoryInteraction.clickInventoryItem(target.index, button))
    } else if (target.region === 'main') {
      Effect.runSync(inventoryInteraction.clickInventoryItem(9 + target.index, button))
    }
    renderPlayerUi()
  }

  inventoryParent.addEventListener('click', (event) => {
    if (playerIsDead()) return
    const target = targetOf(event.target)
    if (target !== undefined) activateInventoryTarget(target)
  })
  inventoryParent.addEventListener('contextmenu', (event) => {
    if (playerIsDead()) return
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    if (target.kind !== 'slot' || target.region === 'crafting-grid') return
    activateInventoryTarget(target, 'right')
  })
  inventoryParent.addEventListener('keydown', (event) => {
    if (playerIsDead()) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    activateInventoryTarget(target)
    focusRenderedTarget()
  })

  const setInventoryOpen = (open: boolean, mode: InventoryMode = 'player'): void => {
    if (open && playerIsDead()) return
    const previousOpen = inventoryOpen
    const switchingMode = open && previousOpen && inventoryMode !== mode
    if (previousOpen === open && !switchingMode) return

    if (previousOpen && (!open || switchingMode)) {
      Effect.runSync(inventoryInteraction.close())
    }

    inventoryOpen = open
    if (previousOpen !== open) announceInventoryTransition(audio, previousOpen, open)
    inventoryParent.hidden = !open
    inventoryParent.setAttribute('aria-hidden', String(!open))
    document.body.setAttribute('data-inventory-open', String(open))
    if (open) {
      inventoryMode = mode
      const presentation = INVENTORY_PRESENTATIONS[mode]
      inventoryInteraction.configureGrid(presentation.width, presentation.height)
      inventoryParent.setAttribute('aria-label', presentation.label)
      inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    }
    renderPlayerUi()
    syncTouchControls()
    if (open) window.requestAnimationFrame(focusRenderedTarget)
    if (open && document.pointerLockElement === canvas) {
      document.exitPointerLock()
    }
  }

  const respawnPlayer = (): void => {
    Effect.runSync(world.vitals.respawn)
    Effect.runSync(world.entities.reset)
    Effect.runSync(Ref.set(gameplayState.hostileContactCooldowns, new Map()))
    Effect.runSync(Ref.set(gameplayState.playerDamages, []))
    Effect.runSync(Ref.set(gameplayState.pendingBowShots, []))
    Effect.runSync(Ref.set(gameplayState.spawnAttempts, []))
    Effect.runSync(Ref.set(gameplayState.mobDrops, []))
    observedMobDrops.splice(0)
    Effect.runSync(world.player.restore(initialSpawnPose, initialSpawnDimension))
    alignActiveDimension(initialSpawnDimension)
    resetSimState(true)
    setInventoryOpen(false)
    syncTouchControls()
    markSessionDirty()
  }

  hudParent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const control = event.target.closest('[data-mx-ui="respawn"]')
    if (control === null || !hudParent.contains(control)) return
    respawnPlayer()
  })

  renderPlayerUi()
  syncTouchControls()

  // -------------------------------------------------------------------------
  // 4a. Durable session publication
  // -------------------------------------------------------------------------

  let dirtyGeneration = 0
  let savedGeneration = 0
  let debounceTimer: number | undefined

  const requestFlush = (): Promise<void> => {
    const requestedGeneration = dirtyGeneration
    return saveCoordinator.requestSave().then(() => {
      savedGeneration = Math.max(savedGeneration, requestedGeneration)
      if (savedGeneration === dirtyGeneration) {
        document.body.setAttribute('data-session-persistence', 'saved')
      }
    })
  }

  const requestBackgroundFlush = (): void => {
    void requestFlush().catch(() => {
      // The coordinator already made the failure visible; background callers consume it.
    })
  }

  const flushDirty = (): void => {
    if (dirtyGeneration !== savedGeneration) requestBackgroundFlush()
  }

  markSessionDirty = () => {
    dirtyGeneration += 1
    document.body.setAttribute('data-session-persistence', 'dirty')
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(flushDirty, SAVE_DEBOUNCE_MS)
  }

  let settingsView: ReturnType<typeof createSettingsView>
  settingsView = createSettingsView(document, settingsRoot, {
    onChange: (next) => {
      playerSettings = next
      applyBindings(next.bindings)
      audio.configure(next)
      document.body.setAttribute('data-player-settings-persistence', 'dirty')
      pauseError.textContent = ''
      settingsView.clearPersistenceError()
      enqueueSettingsWrite(
        settingsWrites,
        () => runStorage(Effect.provide(savePlayerSettings(next), storageContext)),
        () => {
          if (playerSettings === next) {
            document.body.setAttribute('data-player-settings-persistence', 'saved')
          }
        },
        (error) => {
          document.body.setAttribute('data-player-settings-persistence', 'error')
          const message = 'Settings could not be saved.'
          pauseError.textContent = message
          settingsView.reportPersistenceError(message)
          console.error('[mc-compose] player settings persistence failed', error)
        },
      )
    },
    onClose: () => {
      pauseOverlay.inert = false
    },
  })

  const setPaused = (next: boolean): void => {
    paused = next
    gameShell.inert = next
    pauseOverlay.hidden = !next
    document.body.setAttribute('data-session-paused', String(next))
    syncTouchControls()
    if (next) {
      if (document.pointerLockElement === canvas) document.exitPointerLock()
      resumeButton.focus()
      return
    }
    pauseError.textContent = ''
    canvas.focus()
  }

  const handlePauseRequest = (): void => {
    if (inventoryOpen) {
      setInventoryOpen(false)
      return
    }
    setPaused(!paused)
  }

  document.addEventListener('keydown', (event) => {
    if (settingsView.isOpen()) return
    if (event.code === 'Escape' && !event.repeat) {
      event.preventDefault()
      event.stopPropagation()
      handlePauseRequest()
      return
    }

    if (!paused || event.code !== 'Tab') return
    const pauseActions = [resumeButton, settingsButton, saveQuitButton].filter(
      (button) => !button.hasAttribute('disabled'),
    )
    const firstAction = pauseActions[0]
    const lastAction = pauseActions.at(-1)
    if (firstAction === undefined || lastAction === undefined) return

    const activeElement = document.activeElement
    const activeIsPauseAction = pauseActions.some((button) => button === activeElement)
    const allowsNativeFocusMove = event.shiftKey
      ? activeElement !== firstAction && activeIsPauseAction
      : activeElement !== lastAction && activeIsPauseAction
    if (allowsNativeFocusMove) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    ;(event.shiftKey ? lastAction : firstAction).focus()
  })
  resumeButton.addEventListener('click', () => setPaused(false))
  settingsButton.addEventListener('click', () => {
    pauseOverlay.inert = true
    settingsView.open(playerSettings, settingsButton)
  })
  saveQuitButton.addEventListener('click', () => {
    if (saveQuitButton.getAttribute('aria-busy') === 'true') return
    saveQuitButton.setAttribute('aria-busy', 'true')
    saveQuitButton.setAttribute('disabled', '')
    pauseError.textContent = ''
    void Promise.all([requestFlush(), drainSettingsWrites(settingsWrites)])
      .then(() => window.location.assign('/'))
      .catch((error: unknown) => {
        pauseError.textContent = 'Save failed. Your world is still open; please try again.'
        console.error('[mc-compose] Save & Quit failed', error)
      })
      .finally(() => {
        saveQuitButton.removeAttribute('aria-busy')
        saveQuitButton.removeAttribute('disabled')
      })
  })

  // -------------------------------------------------------------------------
  // 5. QA surface
  // -------------------------------------------------------------------------

  const entityRenderProjection = (): ReadonlyArray<RenderEntity> =>
    Effect.runSync(world.entities.snapshot).entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      category: entity.kind === 'dropped_item' ? 'item' : 'hostile',
    }))

  const gameplaySnapshot = () => {
    const reading = Effect.runSync(currentChunkStore.getBlock(KNOWN_TARGET_BLOCK))
    const ignitionReading = Effect.runSync(currentChunkStore.getBlock(QA_IGNITION_CELL))
    const storage = Effect.runSync(world.inventory.storageSnapshot)
    const inventory = storage.inventory
    const vitals = Effect.runSync(world.vitals.snapshot)
    const entities = Effect.runSync(world.entities.snapshot).entities
    return {
      pose: Effect.runSync(playerApi.pose),
      dimension: Effect.runSync(playerApi.dimension),
      activeChunkDimension: currentChunkContext.dimension,
      weather: Effect.runSync(weather.snapshot),
      vitals,
      dead: vitals.healthPoints <= 0,
      inventory: {
        slots: inventory.slots.map((slot) => slot ?? null),
        durability: storage.inventoryDurability,
        equipment: storage.equipment.slots,
      },
      entityCount: entities.length,
      renderedEntities: entityRenderProjection(),
      mobDrops: observedMobDrops.map(({ renderId: _, ...drop }) => drop),
      itemUse: lastObservedItemUse ?? null,
      entities: entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        feetPosition: entity.feetPosition,
        healthPoints: entity.healthPoints,
      })),
      target: {
        position: KNOWN_TARGET_BLOCK,
        reading: reading._tag,
        block: reading._tag === 'Block' ? reading.block : null,
      },
      ignitionTarget: {
        position: QA_IGNITION_CELL,
        reading: ignitionReading._tag,
        block: ignitionReading._tag === 'Block' ? ignitionReading.block : null,
      },
      persistence: {
        knownChunks: saveCoordinator.knownChunkCount(),
        retainedChunks: saveCoordinator.retainedChunkCount(),
      },
    }
  }

  const seedIgnitionEncounter = (heldItem: IgnitionItemType) => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add(heldItem, 2))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, 2))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, 0))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, 2))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, 2))
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    pendingItemUses.clear()
    lastObservedItemUse = undefined
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedCraftingTableEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('crafting_table', 1))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, 2))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, 0))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, 2))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, 2))
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    nextBlockUseRequestId += 1
    Effect.runSync(
      requestTargetedBlockUse(
        gameplayState,
        currentChunkStore,
        playerApi,
        `block-use-${String(nextBlockUseRequestId)}`,
        'crafting_table',
      ),
    )
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const enterQaDimension = (dimension: Dimension) => {
    const pose = Effect.runSync(playerApi.pose)
    Effect.runSync(playerApi.restore(pose, dimension))
    alignActiveDimension(dimension)
    resetSimState(true)
    Effect.runSync(
      streamAround(currentChunkContext, pose.feetPosition.x, pose.feetPosition.z),
    )
    markSessionDirty()
    return gameplaySnapshot()
  }

  const registry = buildQaRegistry([
    {
      namespace: 'gameplay',
      commands: {
        snapshot: gameplaySnapshot,
        setWeather: () => {
          const qaWeather: WeatherState = { weather: 'thunder', remainingSecs: 300 }
          Effect.runSync(weather.applyTransition(qaWeather))
          presentWeather(qaWeather)
          markSessionDirty()
          return gameplaySnapshot()
        },
        setPose: () => {
          Effect.runSync(playerApi.restore(QA_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          markSessionDirty()
          return gameplaySnapshot()
        },
        enterNether: () => enterQaDimension('nether'),
        enterOverworld: () => enterQaDimension('overworld'),
        breakTarget: () => {
          if (playerIsDead()) return null
          const target = Effect.runSync(
            requestTargetedBlockBreak(gameplayState, currentChunkStore, playerApi),
          )
          if (Option.isSome(target)) markSessionDirty()
          return Option.isSome(target) ? target.value : null
        },
        seedCraftingLog: () => {
          if (playerIsDead()) return gameplaySnapshot()
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('oak_log', 1))
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedCraftingTableEncounter,
        seedIronArmor: () => {
          Effect.runSync(world.inventory.reset)
          const equipment = [
            ['iron_helmet', 'head'],
            ['iron_chestplate', 'chest'],
            ['iron_leggings', 'legs'],
            ['iron_boots', 'feet'],
          ] as const
          equipment.forEach(([item]) => Effect.runSync(world.inventory.add(item, 1)))
          equipment.forEach(([, slot], inventorySlot) => {
            const result = Effect.runSync(world.inventory.equipFromInventory(inventorySlot, slot))
            if (result._tag !== 'Equipped') {
              throw new Error(`failed to equip ${slot}: ${result._tag}`)
            }
          })
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        damage: () => {
          applyPlayerDamage({ amount: 4, cause: 'generic' })
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        heal: () => {
          Effect.runSync(world.vitals.heal(4))
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        eat: () => {
          Effect.runSync(world.vitals.eat(4, 0.3))
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        respawn: () => {
          respawnPlayer()
          return gameplaySnapshot()
        },
        shoot: () => {
          if (playerIsDead()) return gameplaySnapshot()
          const currentPose = Effect.runSync(playerApi.pose)
          const horizontal = Math.cos(currentPose.pitchRadians)
          Effect.runSync(requestBowShot(gameplayState, {
            origin: {
              x: currentPose.feetPosition.x,
              y: currentPose.feetPosition.y + EYE_LEVEL_OFFSET,
              z: currentPose.feetPosition.z,
            },
            dirX: -Math.sin(currentPose.yawRadians) * horizontal,
            dirY: Math.sin(currentPose.pitchRadians),
            dirZ: -Math.cos(currentPose.yawRadians) * horizontal,
            chargeSecs: 1,
          }))
          return gameplaySnapshot()
        },
        seedLethalZombieEncounter: () => {
          respawnPlayer()
          applyPlayerDamage({ amount: 18, cause: 'generic' })
          const currentPose = Effect.runSync(playerApi.pose)
          Effect.runSync(requestMobSpawn(gameplayState, {
            kind: ZOMBIE_KIND,
            feetPosition: {
              x: currentPose.feetPosition.x + 0.5,
              y: currentPose.feetPosition.y,
              z: currentPose.feetPosition.z,
            },
            candidate: {
              groundBlock: 2,
              footBlock: 0,
              headBlock: 0,
              blockLight: 0,
              timeOfDay: 0,
              distanceToPlayerBlocksXZ: 16,
            },
          }))
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedFoodUseEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('potato', 2))
          applyPlayerDamage({ amount: 4, cause: 'generic' })
          Effect.runSync(world.vitals.addExhaustion(36))
          selectedHotbarIndex = 0
          inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedFireChargeIgnition: () => seedIgnitionEncounter('fire_charge'),
        seedFlintAndSteelIgnition: () => seedIgnitionEncounter('flint_and_steel'),
        seedRefusedFireChargeIgnition: () => {
          seedIgnitionEncounter('fire_charge')
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, 2))
          nextItemUseRequestId += 1
          const requestId = `item-use-${String(nextItemUseRequestId)}`
          Effect.runSync(
            requestItemUse(gameplayState, requestId, QA_IGNITION_CELL, 'fire_charge'),
          )
          pendingItemUses.set(requestId, {
            slotIndex: selectedHotbarIndex,
            heldItem: 'fire_charge',
          })
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedMeleeDropEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.inventory.reset)
          inventoryInteraction.reset()
          const spawnPose = Effect.runSync(playerApi.pose)
          Effect.runSync(playerApi.look(-spawnPose.yawRadians, -spawnPose.pitchRadians))
          const currentPose = Effect.runSync(playerApi.pose)
          const distance = 2
          const horizontal = Math.cos(currentPose.pitchRadians)
          const direction = {
            x: -Math.sin(currentPose.yawRadians) * horizontal,
            y: Math.sin(currentPose.pitchRadians),
            z: -Math.cos(currentPose.yawRadians) * horizontal,
          }
          const eyeY = Math.floor(currentPose.feetPosition.y + EYE_LEVEL_OFFSET)
          for (let zOffset = 0; zOffset >= -3; zOffset -= 1) {
            Effect.runSync(currentChunkStore.setBlock({
              x: Math.floor(currentPose.feetPosition.x),
              y: eyeY,
              z: Math.floor(currentPose.feetPosition.z) + zOffset,
            }, 0))
          }
          Effect.runSync(
            world.entities.spawn({
              kind: CREEPER_KIND,
              feetPosition: {
                x: currentPose.feetPosition.x + direction.x * distance,
                y: currentPose.feetPosition.y
                  + EYE_LEVEL_OFFSET
                  + direction.y * distance
                  - 0.9,
                z: currentPose.feetPosition.z + direction.z * distance,
              },
              healthPoints: 1,
              behaviour: undefined,
            }),
          )
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
      },
    },
    {
      namespace: 'persistence',
      commands: { flush: requestFlush },
    },
    {
      namespace: 'audio',
      commands: {
        snapshot: () => audio.snapshot(Effect.runSync(browserClock.monotonicSecs)),
      },
    },
  ])
  if (Either.isLeft(registry)) {
    failBoot('QA registry rejected', describeQaApiError(registry.left))
    return
  }
  installQaApi(globalThis as unknown as Record<string, unknown>, registry.right)

  window.setInterval(requestBackgroundFlush, AUTOSAVE_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      resetTouchInput('visibility-hidden')
      requestBackgroundFlush()
    }
  })
  window.addEventListener('blur', () => resetTouchInput('blur'))
  // IndexedDB cannot be made synchronous during pagehide; this is best-effort.
  // Periodic publication persists advancing time and weather without gameplay mutations.
  window.addEventListener('pagehide', (event) => {
    requestBackgroundFlush()
    if (!event.persisted) {
      settingsView.dispose()
      audio.close()
    }
  })
  const hot = (import.meta as ImportMeta & {
    readonly hot?: { readonly dispose: (handler: () => void) => void }
  }).hot
  hot?.dispose(() => {
    settingsView.dispose()
    audio.close()
  })

  // -------------------------------------------------------------------------
  // 6. The frame
  // -------------------------------------------------------------------------

  const runFrame = game.runFrameWith(BrowserClockLayer)

  // Time is read through the Port, not from `performance`. `apps/web/clock.ts`
  // is the only file allowed the raw reading and `pnpm check:deps` enforces it.
  const readNow = (): number => Effect.runSync(browserClock.monotonicSecs)

  let previousSecs: number | undefined
  let framesThisWindow = 0
  let windowStartedAtSecs = readNow()
  let framesTotal = 0
  let renderedCaptionSignature: string | undefined

  document.body.setAttribute('data-mc-compose-boot', 'running')

  const tick = (): void => {
    const nowSecs = readNow()
    const frameInput = Effect.runSync(inputApi.snapshot)
    const consumedTouchLook = consumeTouchLook(touchLookState)
    touchLookState = consumedTouchLook.state
    if (frameInput.justPressed.has(ESCAPE_KEY_CODE)) {
      handlePauseRequest()
      Effect.runSync(inputApi.endFrame(frameInput))
      previousSecs = nowSecs
      requestAnimationFrame(tick)
      return
    }
    if (paused) {
      Effect.runSync(inputApi.endFrame(frameInput))
      previousSecs = nowSecs
      requestAnimationFrame(tick)
      return
    }
    const raw = previousSecs === undefined ? FIRST_FRAME_SECS : nowSecs - previousSecs
    previousSecs = nowSecs
    const deltaSecs = clampDelta(raw)
    if (redstoneDirty) syncRedstoneSnapshot(currentChunkContext)

    // -----------------------------------------------------------------------
    // The player, moved and stopped by the world
    // -----------------------------------------------------------------------
    //
    // WIRING, NOT A RULE. mc-sim owns motion and collision; this loop supplies
    // input intent before the frame and mirrors its authoritative state after.
    //
    // THE DELTA IS ALREADY CLAMPED to `MAX_FRAME_SECS` above, which keeps a
    // backgrounded tab from returning with a multi-second physics step.
    const walk = frameInput
    const foodOutcome = Effect.runSync(world.vitals.advanceFoodTimer(deltaSecs))
    if (foodOutcome.signal !== 'none') markSessionDirty()

    const dead = playerIsDead()
    syncTouchControls()
    if (dead) {
      if (inventoryOpen) setInventoryOpen(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }

    if (!dead && Effect.runSync(inputApi.wasActionJustTriggered('openInventory'))) {
      setInventoryOpen(!inventoryOpen, 'player')
    }

    if (!dead && !inventoryOpen) {
      selectedHotbarIndex = selectedHotbarAfterInput(
        selectedHotbarIndex,
        walk.wheelSteps,
        (action) => Effect.runSync(inputApi.wasActionJustTriggered(action)),
        wrapHotbarSelection,
      )
    }

    const held = (action: Parameters<typeof inputApi.isActionActive>[0]): number =>
      !dead && !inventoryOpen && Effect.runSync(inputApi.isActionActive(action)) ? 1 : 0

    const attackTriggered =
      !dead && !inventoryOpen && Effect.runSync(inputApi.wasActionJustTriggered('attack'))
    const useTriggered =
      !dead && !inventoryOpen && Effect.runSync(inputApi.wasActionJustTriggered('use'))
    const lookDelta = {
      x: walk.pointerDelta.x + consumedTouchLook.delta.x,
      y: walk.pointerDelta.y + consumedTouchLook.delta.y,
    }
    const looked = !dead && !inventoryOpen && (lookDelta.x !== 0 || lookDelta.y !== 0)
    if (!dead && !inventoryOpen) {
      Effect.runSync(playerApi.look(
        -lookDelta.x * LOOK_SENSITIVITY * playerSettings.sensitivity,
        -lookDelta.y * LOOK_SENSITIVITY * playerSettings.sensitivity,
      ))
    }
    const poseBeforeFrame = Effect.runSync(playerApi.pose)
    const dimensionBeforeFrame = Effect.runSync(playerApi.dimension)
    Effect.runSync(Ref.set(simState.movementIntent, {
      forward: held('moveForward') - held('moveBackward'),
      strafe: held('moveRight') - held('moveLeft'),
    }))
    Effect.runSync(Ref.set(simState.jumpIntent, held('jump') > 0))
    Effect.runSync(
      Ref.set(simState.physicsConfig, dead ? Option.none() : Option.some(simPhysicsConfig)),
    )
    Effect.runSync(Ref.set(gameplayState.timeOfDay, Effect.runSync(time.timeOfDay)))
    const weatherBeforeFrame = Effect.runSync(weather.snapshot)
    Effect.runSync(Ref.set(gameplayState.weather, weatherBeforeFrame))
    Effect.runSync(Ref.set(gameplayState.weatherAdvanced, undefined))

    const outcome = Effect.runSyncExit(runFrame(deltaSecs))

    if (Exit.isFailure(outcome)) {
      // A stage's error channel is `never`, so reaching here means a DEFECT.
      // Stopping the loop is deliberate: a defect that repeats sixty times a
      // second buries its own first occurrence in the console.
      failBoot('a frame stage defected', outcome.cause)
      return
    }

    const playerDamages = Effect.runSync(drainPlayerDamages(gameplayState))
    for (const event of playerDamages) {
      applyPlayerDamage(event.damage)
    }
    if (playerDamages.length > 0) {
      markSessionDirty()
      if (playerIsDead()) {
        setInventoryOpen(false)
        if (document.pointerLockElement === canvas) document.exitPointerLock()
      }
    }
    const deadAfterFrame = playerIsDead()
    syncTouchControls()

    let postFramePose = Effect.runSync(playerApi.pose)
    let dimensionAfterFrame = Effect.runSync(playerApi.dimension)
    if (
      dead &&
      (dimensionAfterFrame !== dimensionBeforeFrame ||
        postFramePose.feetPosition.x !== poseBeforeFrame.feetPosition.x ||
        postFramePose.feetPosition.y !== poseBeforeFrame.feetPosition.y ||
        postFramePose.feetPosition.z !== poseBeforeFrame.feetPosition.z)
    ) {
      Effect.runSync(playerApi.restore(poseBeforeFrame, dimensionBeforeFrame))
      postFramePose = poseBeforeFrame
      dimensionAfterFrame = dimensionBeforeFrame
    }

    const dimensionChanged =
      dimensionAfterFrame !== dimensionBeforeFrame ||
      dimensionAfterFrame !== currentChunkContext.dimension
    if (dimensionChanged) {
      alignActiveDimension(dimensionAfterFrame)
      resetSimState(!deadAfterFrame)
      markSessionDirty()
    }

    const groundedAfterFrame = Effect.runSync(Ref.get(simState.isGrounded))
    const moved =
      dimensionChanged ||
      postFramePose.feetPosition.x !== poseBeforeFrame.feetPosition.x ||
      postFramePose.feetPosition.y !== poseBeforeFrame.feetPosition.y ||
      postFramePose.feetPosition.z !== poseBeforeFrame.feetPosition.z
    if (!deadAfterFrame && !dimensionChanged) {
      const horizontalDistance = Math.hypot(
        postFramePose.feetPosition.x - poseBeforeFrame.feetPosition.x,
        postFramePose.feetPosition.z - poseBeforeFrame.feetPosition.z,
      )
      if (horizontalDistance > 0) {
        Effect.runSync(world.vitals.addExhaustion(horizontalDistance * WALK_EXHAUSTION_PER_METRE))
      }
    }
    if (looked || moved) markSessionDirty()
    Effect.runSync(Ref.set(gameplayState.targetPosition, postFramePose.feetPosition))

    // Resolve click rays from the authoritative post-simulation pose. Requests
    // enter gameplay's inbox and are consumed by the next frame.
    if (!deadAfterFrame && attackTriggered) {
      const result = Effect.runSync(
        requestTargetedPrimaryAttack(
          gameplayState,
          currentChunkStore,
          world.entities,
          playerApi,
        ),
      )
      if (result._tag === 'Block') {
        breaksRequested += 1
        canvas.setAttribute('data-breaks-requested', String(breaksRequested))
        redstoneDirty = true
        markSessionDirty()
      } else if (result._tag === 'Melee') {
        markSessionDirty()
      }
    }

    if (!deadAfterFrame && useTriggered) {
      const route = Effect.runSync(
        targetedRightClickRoute(currentChunkStore, playerApi, DEFAULT_BLOCK_REACH),
      )
      if (route?.kind === 'craftingTable') {
        setInventoryOpen(true, 'craftingTable')
      } else {
        const inventoryBeforeUse = Effect.runSync(world.inventory.snapshot)
        const selected = inventoryBeforeUse.slots[selectedHotbarIndex]
        let shouldAttemptPlacement = selected === undefined

        if (selected !== undefined && isGameplayUseItemType(selected.item)) {
          const foodUse = resolveFoodUse({
            held: selected.item,
            vitals: Effect.runSync(world.vitals.snapshot),
          })

          if (foodUse._tag === 'consume') {
            const removal = Effect.runSync(
              world.inventory.removeAt(selectedHotbarIndex, selected.item, foodUse.count),
            )
            if (removal._tag === 'Removed') {
              Effect.runSync(world.vitals.eat(foodUse.foodPoints, foodUse.saturationModifier))
              markSessionDirty()
            }
          } else if (foodUse._tag !== 'dead') {
            if (isIgnitionItem(selected.item)) {
              nextItemUseRequestId += 1
              const requestId = `item-use-${String(nextItemUseRequestId)}`
              const target = Effect.runSync(
                requestTargetedItemUse(
                  gameplayState,
                  currentChunkStore,
                  playerApi,
                  requestId,
                  selected.item,
                ),
              )
              if (Option.isSome(target)) {
                pendingItemUses.set(requestId, {
                  slotIndex: selectedHotbarIndex,
                  heldItem: selected.item,
                })
              }
            } else {
              shouldAttemptPlacement = true
            }
          }
        }

        if (shouldAttemptPlacement) {
          requestPlacementFromSelectedSlot(
            inventoryBeforeUse.slots,
            selectedHotbarIndex,
            isPlaceableGameplayItem,
            (heldItem) => {
              nextBlockUseRequestId += 1
              const requestId = `block-use-${String(nextBlockUseRequestId)}`
              const target = Effect.runSync(
                requestTargetedBlockUse(
                  gameplayState,
                  currentChunkStore,
                  playerApi,
                  requestId,
                  heldItem,
                ),
              )
              if (Option.isSome(target)) {
                const reading = Effect.runSync(currentChunkStore.getBlock(target.value.position))
                if (reading._tag === 'Block' && reading.block === 76) {
                  pendingBlockUses.set(requestId, {
                    dimension: currentChunkContext.dimension,
                    position: target.value.position,
                  })
                } else {
                  placementsRequested += 1
                  canvas.setAttribute('data-placements-requested', String(placementsRequested))
                }
                markSessionDirty()
              }
            },
          )
        }
      }
    }

    // Placement requests are serviced after the frame-start redstone sync.
    // Only the success outbox proves that a component now exists in the store.
    const consumedPlacements = Effect.runSync(
      Ref.getAndSet(gameplayState.consumedItems, []),
    )
    announceConfirmedPlacements(audio, consumedPlacements)
    if (consumedPlacements.some((item) => REDSTONE_PLACEMENT_ITEMS.has(item))) {
      redstoneDirty = true
    }

    for (const result of Effect.runSync(drainBlockUseResults(gameplayState))) {
      const pending = pendingBlockUses.get(result.requestId)
      pendingBlockUses.delete(result.requestId)
      if (
        pending !== undefined &&
        result.success &&
        result.outcome._tag === 'ToggleLever' &&
        result.outcome.position.x === pending.position.x &&
        result.outcome.position.y === pending.position.y &&
        result.outcome.position.z === pending.position.z
      ) {
        const key = leverKeyOf(pending)
        leverStates.set(key, {
          dimension: pending.dimension,
          position: pending.position,
          active: !(leverStates.get(key)?.active ?? false),
        })
        redstoneDirty = true
        markSessionDirty()
      }
    }

    for (const transition of Effect.runSync(redstoneRuntime.drainLampTransitions)) {
      const context = dimensionContexts.get(transition.dimension as Dimension)
      if (context === undefined) continue
      Effect.runSync(context.chunkStore.setBlock(transition.position, transition.lit ? 80 : 79))
      markSessionDirty()
    }

    // Portal stages can replace both dimension and pose. Stream and present
    // only after the frame so the renderer never meshes the destination pose
    // against the source dimension's store.
    Effect.runSync(
      streamAround(
        currentChunkContext,
        postFramePose.feetPosition.x,
        postFramePose.feetPosition.z,
      ),
    )
    canvas.setAttribute(
      'data-player-feet',
      `${postFramePose.feetPosition.x.toFixed(2)},${postFramePose.feetPosition.y.toFixed(2)},${postFramePose.feetPosition.z.toFixed(2)}`,
    )
    canvas.setAttribute('data-player-grounded', String(groundedAfterFrame))

    const weatherAdvanced = Effect.runSync(Ref.get(gameplayState.weatherAdvanced))
    if (weatherAdvanced !== undefined) {
      Effect.runSync(weather.applyTransition(weatherAdvanced))
      presentWeather(weatherAdvanced)
      if (weatherAdvanced.weather !== weatherBeforeFrame.weather) markSessionDirty()
    }

    const itemUseResults = Effect.runSync(drainItemUseResults(gameplayState))
    for (const result of itemUseResults) {
      lastObservedItemUse = result
      const pending = pendingItemUses.get(result.requestId)
      pendingItemUses.delete(result.requestId)
      if (result.success && pending?.heldItem === result.heldItem) {
        if (result.heldItem === 'fire_charge') {
          Effect.runSync(world.inventory.removeAt(pending.slotIndex, pending.heldItem, 1))
        } else if (
          Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]?.item
          === 'flint_and_steel'
        ) {
          Effect.runSync(
            world.inventory.damageAt({ _tag: 'Inventory', slotIndex: pending.slotIndex }, 1),
          )
        }
      }
      if (result.success) markSessionDirty()
    }

    const mobDrops = Effect.runSync(drainMobDrops(gameplayState))
    if (mobDrops.length > 0) {
      Effect.runSync(spawnMobDrops(world.entities, mobDrops))
      markSessionDirty()
    }
    for (const drop of mobDrops) {
      nextMobDropId += 1
      observedMobDrops.push({ ...drop, renderId: `mob-drop-${nextMobDropId}` })
    }

    Effect.runSync(worldRenderer.syncEntities(entityRenderProjection()))
    renderPlayerUi()
    const captions = playerSettings.captionsEnabled ? audio.visible(nowSecs) : []
    const nextCaptionSignature = captionRenderSignature(captions)
    if (nextCaptionSignature !== renderedCaptionSignature) {
      captionsParent.replaceChildren(...captions.map((caption) => {
        const row = document.createElement('div')
        row.className = 'sound-caption'
        row.dataset['cueId'] = caption.cueId
        row.setAttribute('data-testid', 'sound-caption')
        row.textContent = caption.text
        return row
      }))
      renderedCaptionSignature = nextCaptionSignature
    }

    framesTotal += 1
    framesThisWindow += 1

    const windowSecs = nowSecs - windowStartedAtSecs
    if (windowSecs >= FPS_WINDOW_SECS) {
      fpsValue.textContent = String(Math.round(framesThisWindow / windowSecs))
      framesThisWindow = 0
      windowStartedAtSecs = nowSecs
    }

    // Readable by a test without a QA command: the frame count IS the claim
    // that the loop is running, and docs/e2e-triage.md #4 is exactly that claim.
    document.body.setAttribute('data-frames', String(framesTotal))

    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

const boot = (): Promise<void> => {
  const route = readSessionRoute(window.location.search)
  if (route === undefined) return bootTitle()
  return bootGame(route.sessionId, route.kind === 'create' ? route.metadata : undefined)
}

boot().catch((error: unknown) => {
  failBoot('boot threw', error)
})
