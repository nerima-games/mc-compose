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
import { blockIdOf, blockTypeOfId, capabilityOfBlockId, propertyOfBlockId } from '@nerima-games/mc-kernel'
import { indexedDbStorageLayer } from '@nerima-games/mc-save'
import {
  advanceFurnace,
  containerIdAt,
  emptyFurnaceState,
  itemStack,
  makeCropService,
  makeSimFrameState,
  makeTimeService,
  makeWeatherService,
  maxStackCountForItem,
  POTATO_MATURITY_SECS,
  resetLandingImpact,
  simStages,
  STARTER_FUEL_RULES,
  STARTER_SMELTING_RECIPES,
  type FurnaceState,
  type CropLocation,
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
  makeChunkStoreLightColor,
  makeChunkStoreMesher,
  makeWorldRenderer,
  renderModule,
  syncWorld,
  wrapHotbarSelection,
  type ChunkRef,
  type RenderEntity,
} from '@nerima-games/mc-render'
import { trackChunkLightColor, type RenderLightingSnapshot } from './render-lighting'
import {
  chestStorageCloseIntent,
  chestStorageSlotClickIntent,
  chestStorageViewModel,
  createChestStorageView,
  createMainMenuView,
  createCrosshairView,
  createFurnaceView,
  createHudView,
  createInventoryView,
  crosshairViewModel,
  furnaceViewModel,
  hudViewModel,
  initialMainMenuState,
  inventoryViewModel,
  mainMenuViewModel,
  makeUiFrameState,
  slotSnapshotOf,
  uiStages,
  type CreateWorldRequest,
  type ChestStorageSlotTarget,
  type FurnaceSlotId,
  type FurnaceSnapshot,
  type InventoryInteractionTarget,
  type MainMenuState,
  type SavedWorld,
} from '@nerima-games/mx-ui'
import {
  applyPistonPlan,
  makeRuntimeRedstoneStages,
  pistonPositionAt,
  planPistonTransition,
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type PistonMovementPlan,
  type PoweredPistonTransition,
  type RedstoneComponentSnapshot,
} from '@nerima-games/mx-redstone'
import {
  advanceMiningProgress,
  applyArmorToDamage,
  armorPointsForEquipment,
  armorDurabilityWearFromPreMitigationDamage,
  CREEPER_KIND,
  drainBlockUseResults,
  drainBowShotResults,
  drainItemUseResults,
  drainMeleeAttackResults,
  drainMobDrops,
  drainPortalTravels,
  drainPlayerDamages,
  DEFAULT_BLOCK_REACH,
  EYE_LEVEL_OFFSET,
  gameplayStages,
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  makeGameplayFrameState,
  makeGeneratedWorld,
  meleeDamageForItem,
  isDroppedItemBehaviour,
  isHoeItem,
  isIgnitionItem,
  isPlaceableItem,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  requestBowShot,
  requestBlockBreak,
  requestItemUse,
  requestMeleeAttack,
  requestMobSpawn,
  requestPotatoFoodUse,
  requestPotatoHarvest,
  requestTargetedPotatoPlanting,
  requestTargetedSoilTill,
  requestTargetedBlockBreak,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  requestTargetedItemUse,
  resolveEnvironmentalContactDamage,
  resolveFallDamage,
  resolveTargetedPrimaryAttack,
  setPortalCandidates,
  solidityFromStore,
  spawnDroppedItems,
  spawnMobDrops,
  targetedRightClickRoute,
  weatherLightScale,
  miningLootContextForItem,
  miningProgressFraction,
  ZOMBIE_KIND,
  type IgnitionItemType,
  type EnvironmentalContact,
  type HoeItemType,
  type ItemUseResult,
  type MobBehaviour,
  type MobDropEvent,
  type MiningProgressState,
  type PlaceableItemType,
} from '@nerima-games/mx-gameplay'
import {
  encodeFrame,
  makeMultiplayerHost,
  PlayerId,
  PlayerName,
  TransportPort,
  WorldId,
  type MultiplayerHost,
  type NetworkMessage,
} from '@nerima-games/mx-multiplayer'
import { makeBrowserPreview } from '@nerima-games/mc-playground-kit'
import {
  advanceBowUse,
  IDLE_BOW_USE,
  takeBowSettlement,
  type BowUseState,
  type PendingBowShot,
} from './bow-use'
import {
  composeGame,
  EMPTY_MODULE_LAYER,
  registerModule,
  type GameModule,
} from '../../src/domain/composition'
import { DeltaTimeSecs, type MonotonicTimeSecs } from '../../src/domain/kernel-vocabulary'
import {
  buildQaRegistry,
  describeQaApiError,
  installQaApi,
  QA_GLOBAL_KEY,
} from '../../src/domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'
import {
  makeBrowserWebSocketTransport,
  type BrowserWebSocketTransport,
} from './multiplayer-websocket'
import {
  announceInventoryTransition,
  captionRenderSignature,
  horizontalListenerForward,
  makeAudioRuntime,
  makePlacementAudioLatch,
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
  SESSION_FORMAT_VERSION,
  snapshotResidentChunks,
  type DimensionChunk,
  type PersistedFurnaceState,
  type PersistedLeverState,
  type PersistedPortalState,
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
const FARMLAND_BLOCK_ID = 49
const POTATO_CROP_BLOCK_ID = 72
const DATABASE_NAME = 'nerima-games-minecraft'
const AUTOSAVE_INTERVAL_MS = 5_000
const SAVE_DEBOUNCE_MS = 500
const KNOWN_TARGET_BLOCK = { x: 8, y: 63, z: 8 } as const
const QA_FARM_CROP_BLOCK = { x: 8, y: 64, z: 8 } as const
const QA_IGNITION_HIT_BLOCK = { x: 8, y: 66, z: 8 } as const
const QA_IGNITION_CELL = { x: 8, y: 66, z: 9 } as const
const QA_IGNITION_SUPPORT_BLOCK = { x: 8, y: 65, z: 9 } as const
const QA_IGNITION_FLOOR_BLOCK = { x: 8, y: 64, z: 10 } as const
const QA_PISTON = { x: 8, y: 66, z: 8 } as const
const QA_PISTON_LEVER = { x: 8, y: 66, z: 9 } as const
const QA_PISTON_NEAR = { x: 8, y: 66, z: 7 } as const
const QA_PISTON_FAR = { x: 8, y: 66, z: 6 } as const
const QA_ENVIRONMENT_OVERLAP_POSE = {
  feetPosition: { x: 24.95, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
const QA_CACTUS_APPROACH_POSE = {
  feetPosition: { x: 24.2, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
const QA_ENVIRONMENT_CONTACT_CELLS = [
  { x: 24, y: 65, z: 8 },
  { x: 25, y: 65, z: 8 },
] as const
const QA_ENVIRONMENT_FLOOR_CELLS = Array.from({ length: 4 }, (_, offset) => ({
  x: 23 + offset,
  y: 64,
  z: 8,
}))
const QA_FALL_CENTER = { x: 28, z: 8 } as const
const QA_FALL_FLOOR_Y = 64
const QA_FALL_START_Y = {
  safe: 67.5,
  damaging: 72,
  lethal: 88,
} as const
const OBSIDIAN_BLOCK_ID = 40
const NETHER_PORTAL_BLOCK_ID = 118
const QA_PORTAL_ANCHOR = { x: 120, y: 65, z: 8 } as const
const QA_PORTAL_POSE = {
  feetPosition: { x: 120.5, y: 65, z: 8.5 },
  yawRadians: 0,
  pitchRadians: 0,
} as const
const QA_PORTAL_LAYOUT = {
  frame: [
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 119 + offset, y: 64, z: 8 })),
    ...Array.from({ length: 4 }, (_, offset) => ({ x: 119 + offset, y: 68, z: 8 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 119, y: 65 + offset, z: 8 })),
    ...Array.from({ length: 3 }, (_, offset) => ({ x: 122, y: 65 + offset, z: 8 })),
  ],
  interior: Array.from({ length: 6 }, (_, index) => ({
    x: 120 + (index % 2),
    y: 65 + Math.floor(index / 2),
    z: 8,
  })),
} as const
const REDSTONE_PLACEMENT_ITEMS: ReadonlySet<string> = new Set([
  'redstone_dust',
  'lever',
  'redstone_lamp',
  'piston',
])

const EQUIPMENT_ONLY_ITEM_TYPES = [
  'iron_helmet',
  'iron_chestplate',
  'iron_leggings',
  'iron_boots',
] as const satisfies ReadonlyArray<ItemStack['item']>

type EquipmentOnlyItemType = (typeof EQUIPMENT_ONLY_ITEM_TYPES)[number]

type SwordItem =
  | 'wooden_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'diamond_sword'

const SWORD_ITEM_NAMES: ReadonlySet<string> = new Set<SwordItem>([
  'wooden_sword',
  'stone_sword',
  'iron_sword',
  'diamond_sword',
])

const isSwordItem = (item: ItemStack['item']): item is SwordItem =>
  SWORD_ITEM_NAMES.has(item)

type GameplayUseItemType = Exclude<ItemStack['item'], EquipmentOnlyItemType>
type LegacyGameplayItemType = Exclude<ItemStack['item'], 'arrow' | 'bow'>
type GameplayModuleItemType = Parameters<typeof isPlaceableItem>[0]
type GameplayHoeItemType = Parameters<typeof requestTargetedSoilTill>[4]
type GameplayIgnitionItemType = Parameters<typeof requestTargetedItemUse>[4]

// mx-ui 0.2.10 and mx-gameplay 0.1.35 expose adjacent mc-sim item unions.
// Their shared runtime item identifiers remain compatible at this host boundary.
const gameplayModuleItem = (item: ItemStack['item']): GameplayModuleItemType =>
  item as GameplayModuleItemType

const isGameplayHoeItem = (item: ItemStack['item']): item is GameplayHoeItemType =>
  isHoeItem(gameplayModuleItem(item))

const isGameplayIgnitionItem = (
  item: ItemStack['item'],
): item is GameplayIgnitionItemType => isIgnitionItem(gameplayModuleItem(item))

const EQUIPMENT_ONLY_ITEM_NAMES: ReadonlySet<string> = new Set(EQUIPMENT_ONLY_ITEM_TYPES)

const isGameplayUseItemType = (item: ItemStack['item']): item is GameplayUseItemType =>
  !EQUIPMENT_ONLY_ITEM_NAMES.has(item)

const isLegacyGameplayItemType = (item: ItemStack['item']): item is LegacyGameplayItemType =>
  item !== 'arrow' && item !== 'bow'

const isPlaceableGameplayItem = (item: ItemStack['item']): item is PlaceableItemType =>
  isGameplayUseItemType(item) &&
  isLegacyGameplayItemType(item) &&
  isPlaceableItem(gameplayModuleItem(item))

type InventoryMode = 'player' | 'craftingTable' | 'furnace' | 'chest'

const INVENTORY_PRESENTATIONS = {
  player: { label: 'Inventory', width: 2, height: 2 },
  craftingTable: { label: 'Crafting Table', width: 3, height: 3 },
  furnace: { label: 'Furnace', width: 0, height: 0 },
  chest: { label: 'Chest', width: 0, height: 0 },
} as const

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
const QA_FARM_POSE = {
  feetPosition: { x: 8.5, y: 65.5, z: 8.5 },
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

type MultiplayerQuery = {
  readonly url: string
  readonly player: PlayerId
  readonly name: PlayerName
}

const readMultiplayerQuery = (search: string): MultiplayerQuery | undefined => {
  const query = new URLSearchParams(search)
  const url = query.get('multiplayer')
  const player = query.get('player')
  const name = query.get('name')
  if (url === null || player === null || name === null || player.length === 0 || name.length === 0) {
    return undefined
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return undefined
  } catch {
    return undefined
  }
  return { url, player: PlayerId.make(player), name: PlayerName.make(name) }
}

type RemotePlayer = {
  readonly name: PlayerName
  readonly world: WorldId
  readonly at: { readonly x: number; readonly y: number; readonly z: number }
  readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
}

type MultiplayerRuntime = {
  readonly query: MultiplayerQuery
  readonly host: MultiplayerHost
  readonly transport: BrowserWebSocketTransport
  readonly players: Map<PlayerId, RemotePlayer>
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
  fpsValue.setAttribute('data-fps-source', 'mx-ui-frame-dt')
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
  let readAudioListenerForward = (): Vec3 => horizontalListenerForward(0)
  const audioBackend = Effect.runSync(makeWebAudioBackend({
    global: globalThis,
    initialMasterGain: playerSettings.audioEnabled ? playerSettings.masterVolume : 0,
  }))
  const audio = Effect.runSync(makeAudioRuntime({
    backend: audioBackend,
    nowSecs: browserClock.monotonicSecs,
    listener: () => readAudioListener(),
    listenerForward: () => readAudioListenerForward(),
    settings: playerSettings,
  }))
  const placementAudio = makePlacementAudioLatch(audio)
  const loadedSession = await runStorage(
    Effect.provide(loadSession(sessionId), storageContext),
  )
  const sessionMetadata = Option.isSome(loadedSession)
    ? loadedSession.value.metadata
    : creationMetadata ?? { name: sessionId, mode: 'survival' }
  const isCreativeMode = sessionMetadata.mode === 'creative'

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
      world.inventory.restoreContainerStorage(loadedSession.value.state.containerStorage),
    )
    await Effect.runPromise(
      world.player.restore(loadedSession.value.state.player, loadedSession.value.state.dimension),
    )
    await Effect.runPromise(world.vitals.restore(loadedSession.value.state.vitals))
  } else {
    await Effect.runPromise(world.inventory.add('redstone_dust', 16))
    await Effect.runPromise(world.inventory.add('lever', 4))
    await Effect.runPromise(world.inventory.add('redstone_lamp', 8))
    await Effect.runPromise(world.inventory.add('piston', 4))
  }
  const time = await Effect.runPromise(makeTimeService())
  const weather = await Effect.runPromise(makeWeatherService())
  const crops = await Effect.runPromise(makeCropService())
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(time.restore(loadedSession.value.state.time))
    await Effect.runPromise(weather.restore(loadedSession.value.state.weather))
    await Effect.runPromise(crops.restore(loadedSession.value.state.crops))
  }

  const presentWeather = (state: WeatherState): void => {
    canvas.setAttribute('data-weather', state.weather)
    canvas.setAttribute('data-weather-remaining-secs', String(state.remainingSecs))
    canvas.style.filter = `brightness(${String(weatherLightScale(state.weather))})`
  }
  presentWeather(Effect.runSync(weather.snapshot))

  type ChunkColorFor = NonNullable<
    NonNullable<Parameters<typeof syncWorld>[3]>['colorForChunk']
  >
  type DimensionChunkContext = {
    readonly dimension: Dimension
    readonly chunkStore: typeof world.chunkStore
    readonly worldgenChunkStore: typeof world.worldgenChunkStore
    readonly dirtyChunks: Parameters<typeof syncWorld>[1]
    readonly meshChunkFromStore: Parameters<typeof syncWorld>[2]
    readonly colorForChunk: ChunkColorFor
    readonly lightingSnapshot: () => RenderLightingSnapshot
    readonly streamLoaded: Set<string>
  }
  const makeDimensionChunkContext = (
    dimension: Dimension,
    dimensionWorld: typeof world,
  ): DimensionChunkContext => {
    const lighting = trackChunkLightColor((chunk, quads) =>
      makeChunkStoreLightColor(dimensionWorld.worldgenChunkStore, chunk, quads),
    )
    return {
      dimension,
      chunkStore: dimensionWorld.chunkStore,
      worldgenChunkStore: dimensionWorld.worldgenChunkStore,
      dirtyChunks: Effect.runSync(dimensionWorld.worldgenChunkStore.subscribeDirty),
      meshChunkFromStore: makeChunkStoreMesher(dimensionWorld.worldgenChunkStore),
      colorForChunk: lighting.colorForChunk,
      lightingSnapshot: lighting.snapshot,
      streamLoaded: new Set<string>(),
    }
  }
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
  const furnaceKeyOf = (
    furnace: Pick<PersistedFurnaceState, 'dimension' | 'position'>,
  ): string => JSON.stringify([
    furnace.dimension,
    furnace.position.x,
    furnace.position.y,
    furnace.position.z,
  ])
  const furnaceStates = new Map<string, PersistedFurnaceState>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.furnaces : [])
      .map((furnace) => [furnaceKeyOf(furnace), furnace]),
  )
  const portalKeyOf = (
    portal: Pick<PersistedPortalState, 'dimension' | 'position'>,
  ): string => JSON.stringify([
    portal.dimension,
    portal.position.x,
    portal.position.y,
    portal.position.z,
  ])
  const portalStates = new Map<string, PersistedPortalState>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.portals : [])
      .map((portal) => [portalKeyOf(portal), portal]),
  )
  let activeFurnaceKey: string | undefined
  let activeChestId: string | undefined
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
      containerStorage: Effect.runSync(world.inventory.containerStorageSnapshot),
      vitals: Effect.runSync(world.vitals.snapshot),
      time: Effect.runSync(time.snapshot),
      weather: Effect.runSync(weather.snapshot),
      redstone: { levers: [...leverStates.values()] },
      furnaces: [...furnaceStates.values()],
      portals: [...portalStates.values()],
      crops: Effect.runSync(crops.snapshot),
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

      yield* syncWorld(worldRenderer, context.dirtyChunks, context.meshChunkFromStore, {
        colorForChunk: context.colorForChunk,
      })
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
                  : block === 16
                    ? 'piston'
                  : undefined
            if (kind === undefined) continue
            const position = { x: chunk.coord.cx * 16 + lx, y, z: chunk.coord.cz * 16 + lz }
            if (kind === 'lever') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              observedLevers.add(key)
              components.push({ position, kind, active: leverStates.get(key)?.active ?? false })
            } else if (kind === 'piston') {
              const head = Effect.runSync(context.chunkStore.getBlock(
                pistonPositionAt(position, 'north', 1),
              ))
              components.push({
                position,
                kind,
                pistonFacing: 'north',
                pistonKind: 'sticky',
                pistonState: head._tag === 'Block' && head.block === 85 ? 'extended' : 'retracted',
              })
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

  const applyPoweredPistonTransition = (transition: PoweredPistonTransition): void => {
    const context = dimensionContexts.get(transition.dimension as Dimension)
    if (context === undefined) return
    const outcome = planPistonTransition(
      transition,
      {
        read: (position) => {
          if (position.y < 0 || position.y >= 256) return { kind: 'out-of-world' }
          const reading = Effect.runSync(context.chunkStore.getBlock(position))
          if (reading._tag !== 'Block') return { kind: 'missing' }
          return reading.block === 0
            ? { kind: 'empty' }
            : { kind: 'block', block: String(reading.block) }
        },
      },
      {
        pistonImmovable: (block) => capabilityOfBlockId(Number(block), 'pistonImmovable'),
      },
    )
    if (outcome.kind !== 'move') return

    Effect.runSync(applyPistonPlan(outcome.plan, {
      commit: (plan: PistonMovementPlan) => Effect.gen(function* () {
        for (const move of plan.moves) {
          const source = yield* context.chunkStore.getBlock(move.from)
          if (source._tag !== 'Block' || source.block !== Number(move.block)) {
            return yield* Effect.dieMessage('piston source changed before commit')
          }
        }
        const head = pistonPositionAt(plan.piston, plan.facing, 1)
        if (plan.toState === 'retracted') yield* context.chunkStore.setBlock(head, 0)
        for (const move of plan.moves) {
          yield* context.chunkStore.setBlock(move.to, Number(move.block))
          yield* context.chunkStore.setBlock(move.from, 0)
        }
        if (plan.toState === 'extended') yield* context.chunkStore.setBlock(head, 85)
      }),
    }))
    markSessionDirty()
    redstoneDirty = true
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
  // lives in one place — and `pnpm typecheck:preview` caught this the first
  // time, which is the whole argument for that project existing.
  const uiFrameState = Effect.runSync(makeUiFrameState)
  const registeredUi = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-ui',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(uiStages(uiFrameState)),
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
  readAudioListenerForward = () => horizontalListenerForward(
    Effect.runSync(playerApi.pose).yawRadians,
  )
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
  let environmentalContactDamageState = INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE
  let simulationElapsedSecs = 0
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
  type EnvironmentalContactCell = EnvironmentalContact & {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
  }
  // Keep boundary contact behavior aligned with mc-physics collision tests.
  const physicsContactEpsilon = 1e-9
  const intervalOverlap = (
    minA: number,
    maxA: number,
    minB: number,
    maxB: number,
  ): number => Math.min(maxA, maxB) - Math.max(minA, minB)
  const intervalGap = (
    minA: number,
    maxA: number,
    minB: number,
    maxB: number,
  ): number => Math.max(minB - maxA, minA - maxB, 0)
  const overlapsUnitCell = (
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    x: number,
    y: number,
    z: number,
  ): boolean =>
    intervalOverlap(minX, maxX, x, x + 1) > 0 &&
    intervalOverlap(minY, maxY, y, y + 1) > 0 &&
    intervalOverlap(minZ, maxZ, z, z + 1) > 0
  const touchesCactusHorizontalSide = (
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    x: number,
    y: number,
    z: number,
  ): boolean => {
    if (intervalOverlap(minY, maxY, y, y + 1) <= physicsContactEpsilon) {
      return false
    }
    const overlapsX = intervalOverlap(minX, maxX, x, x + 1) > physicsContactEpsilon
    const overlapsZ = intervalOverlap(minZ, maxZ, z, z + 1) > physicsContactEpsilon
    return (
      (intervalGap(minX, maxX, x, x + 1) <= physicsContactEpsilon && overlapsZ) ||
      (intervalGap(minZ, maxZ, z, z + 1) <= physicsContactEpsilon && overlapsX)
    )
  }
  const environmentalContactCellsForPose = (
    pose: { readonly feetPosition: Vec3 },
  ): ReadonlyArray<EnvironmentalContactCell> => {
    const minX = pose.feetPosition.x - PLAYER_HALF_WIDTH
    const maxX = pose.feetPosition.x + PLAYER_HALF_WIDTH
    const minY = pose.feetPosition.y
    const maxY = pose.feetPosition.y + PLAYER_HALF_HEIGHT * 2
    const minZ = pose.feetPosition.z - PLAYER_HALF_WIDTH
    const maxZ = pose.feetPosition.z + PLAYER_HALF_WIDTH
    const contacts: Array<EnvironmentalContactCell> = []

    for (
      let x = Math.floor(minX - physicsContactEpsilon);
      x < Math.ceil(maxX + physicsContactEpsilon);
      x += 1
    ) {
      for (let y = Math.floor(minY); y < Math.ceil(maxY); y += 1) {
        for (
          let z = Math.floor(minZ - physicsContactEpsilon);
          z < Math.ceil(maxZ + physicsContactEpsilon);
          z += 1
        ) {
          const reading = Effect.runSync(currentChunkStore.getBlock({ x, y, z }))
          if (reading._tag !== 'Block') continue
          const block = blockTypeOfId(reading.block)
          if (block !== 'lava' && block !== 'cactus') continue
          const contactDamage = propertyOfBlockId(reading.block, 'contactDamage')
          if (contactDamage === undefined) continue
          if (
            block === 'lava' &&
            !overlapsUnitCell(minX, maxX, minY, maxY, minZ, maxZ, x, y, z)
          ) {
            continue
          }
          if (
            block === 'cactus' &&
            !touchesCactusHorizontalSide(
              minX,
              maxX,
              minY,
              maxY,
              minZ,
              maxZ,
              x,
              y,
              z,
            )
          ) {
            continue
          }
          contacts.push({ position: { x, y, z }, block, contactDamage })
        }
      }
    }
    return contacts
  }
  const environmentalContactsForPose = (
    pose: { readonly feetPosition: Vec3 },
  ): ReadonlyArray<EnvironmentalContact> => {
    const contactsByBlock = new Map<EnvironmentalContact['block'], EnvironmentalContact>()
    for (const { block, contactDamage } of environmentalContactCellsForPose(pose)) {
      contactsByBlock.set(block, { block, contactDamage })
    }
    return [...contactsByBlock.values()]
  }
  const resetSimState = (physicsEnabled: boolean): void => {
    resetBowUse()
    environmentalContactDamageState = INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE
    pendingMiningToolDamage.splice(0)
    pendingBlockBreakConfirmations.splice(0)
    Effect.runSync(Ref.set(simState.resolvedFeetPosition, Option.none()))
    Effect.runSync(Ref.set(simState.movementIntent, { forward: 0, strafe: 0 }))
    Effect.runSync(Ref.set(simState.jumpIntent, false))
    Effect.runSync(Ref.set(simState.velocity, { x: 0, y: 0, z: 0 }))
    Effect.runSync(Ref.set(simState.isGrounded, false))
    Effect.runSync(resetLandingImpact(simState))
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
  let nextBowShotRequestId = 0
  let nextMeleeAttackRequestId = 0

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
  const portalDimensions = ['overworld', 'nether', 'end'] as const satisfies ReadonlyArray<Dimension>
  const syncPortalCandidatesFor = (dimension: Dimension): Effect.Effect<void> =>
    setPortalCandidates(
      gameplayState,
      dimension,
      [...portalStates.values()]
        .filter((portal) => portal.dimension === dimension)
        .map((portal) => portal.position),
    )
  const syncPortalCandidateSnapshots = (): Effect.Effect<void> =>
    Effect.asVoid(Effect.all(portalDimensions.map(syncPortalCandidatesFor)))
  const registerPortal = (portal: PersistedPortalState): boolean => {
    const key = portalKeyOf(portal)
    if (portalStates.has(key)) return false
    portalStates.set(key, portal)
    Effect.runSync(syncPortalCandidatesFor(portal.dimension))
    markSessionDirty()
    return true
  }
  const materializePortal = (
    dimension: Dimension,
    layout: {
      readonly frame: ReadonlyArray<PersistedPortalState['position']>
      readonly interior: ReadonlyArray<PersistedPortalState['position']>
    },
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const context = getOrCreateDimensionChunkContext(dimension)
      const chunkRefs = new Map<string, ChunkRef>()
      for (const position of [...layout.frame, ...layout.interior]) {
        const chunk = {
          cx: Math.floor(position.x / 16),
          cz: Math.floor(position.z / 16),
        }
        chunkRefs.set(chunkKeyOf(chunk), chunk)
      }
      for (const [key, chunk] of chunkRefs) {
        if (context.streamLoaded.has(key)) continue
        yield* context.chunkStore.load(chunk)
        context.streamLoaded.add(key)
        chunksStreamedIn += 1
      }
      for (const position of layout.frame) {
        yield* context.chunkStore.setBlock(position, OBSIDIAN_BLOCK_ID)
      }
      for (const position of layout.interior) {
        yield* context.chunkStore.setBlock(position, NETHER_PORTAL_BLOCK_ID)
      }
      markSessionDirty()
    })
  const applyPortalTravels = (): Effect.Effect<void> =>
    Effect.gen(function* () {
      const travels = yield* drainPortalTravels(gameplayState)
      for (const travel of travels) {
        registerPortal({
          dimension: travel.sourceDimension,
          position: travel.sourcePosition,
        })
        const destinationAdded = registerPortal({
          dimension: travel.plan.toDimension,
          position: travel.plan.destination,
        })
        if (destinationAdded && Option.isSome(travel.plan.portalToCreate)) {
          yield* materializePortal(
            travel.plan.toDimension,
            travel.plan.portalToCreate.value,
          )
        }
      }
    })
  Effect.runSync(syncPortalCandidateSnapshots())
  const observedMobDrops: Array<MobDropEvent & { readonly renderId: string }> = []
  let nextMobDropId = 0
  let lastObservedItemUse: ItemUseResult | undefined
  type PendingItemUse =
    | { readonly kind: 'ignition'; readonly slotIndex: number; readonly heldItem: IgnitionItemType }
    | { readonly kind: 'till'; readonly slotIndex: number; readonly heldItem: HoeItemType }
    | { readonly kind: 'plant'; readonly slotIndex: number; readonly dimension: Dimension }
    | {
        readonly kind: 'harvest'
        readonly dimension: Dimension
        readonly position: { readonly x: number; readonly y: number; readonly z: number }
      }
    | { readonly kind: 'eat'; readonly slotIndex: number }
  const pendingItemUses = new Map<string, PendingItemUse>()
  let bowUseState: BowUseState = IDLE_BOW_USE
  let pendingBowShots: ReadonlyMap<string, PendingBowShot> = new Map()
  const pendingMeleeAttacks = new Map<
    string,
    { readonly slotIndex: number; readonly item: SwordItem }
  >()
  const bowInteractionLocked = (): boolean =>
    bowUseState._tag === 'Drawing' || pendingBowShots.size > 0
  const resetBowUse = (): void => {
    bowUseState = IDLE_BOW_USE
    pendingBowShots = new Map()
    Effect.runSync(Ref.set(gameplayState.pendingBowShots, []))
    Effect.runSync(Ref.set(gameplayState.bowShotResults, []))
  }
  const settleBowShotResults = (): void => {
    for (const result of Effect.runSync(drainBowShotResults(gameplayState))) {
      const settlement = takeBowSettlement(pendingBowShots, result)
      pendingBowShots = settlement.pending
      if (settlement.fired === null) continue
      Effect.runSync(world.inventory.consumeAndDamageAt({
        consume: { item: 'arrow', count: 1 },
        damage: {
          location: { _tag: 'Inventory', slotIndex: settlement.fired.bowSlotIndex },
          expectedItem: 'bow',
          amount: 1,
        },
      }))
      markSessionDirty()
    }
  }
  const settleMeleeAttackResults = (): void => {
    for (const result of Effect.runSync(drainMeleeAttackResults(gameplayState))) {
      const pending = pendingMeleeAttacks.get(result.requestId)
      if (pending === undefined) continue

      pendingMeleeAttacks.delete(result.requestId)
      if (!result.success) continue

      const currentItem = Effect.runSync(world.inventory.snapshot)
        .slots[pending.slotIndex]?.item ?? null
      if (currentItem !== pending.item) continue

      const damageResult = Effect.runSync(
        world.inventory.damageAt(
          { _tag: 'Inventory', slotIndex: pending.slotIndex },
          1,
        ),
      )
      if (damageResult._tag === 'Damaged' || damageResult._tag === 'Broken') {
        markSessionDirty()
      }
    }
  }
  const pendingBlockUses = new Map<
    string,
    { readonly dimension: Dimension; readonly position: { readonly x: number; readonly y: number; readonly z: number } }
  >()
  const pendingMiningToolDamage: Array<{
    readonly dimension: Dimension
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly blockId: number
    readonly slotIndex: number
    readonly item: 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe' | 'diamond_pickaxe'
  }> = []
  const pendingBlockBreakConfirmations: Array<{
    readonly dimension: Dimension
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly blockId: number
  }> = []

  const multiplayerQuery = readMultiplayerQuery(window.location.search)
  const multiplayer = multiplayerQuery === undefined
    ? undefined
    : await Effect.runPromise(
        Effect.gen(function* () {
          const transport = yield* makeBrowserWebSocketTransport({ url: multiplayerQuery.url })
          const host = yield* makeMultiplayerHost.pipe(
            Effect.provideService(TransportPort, transport),
          )
          yield* host.transitionConnection({ _tag: 'ConnectRequested' })
          return {
            query: multiplayerQuery,
            host,
            transport,
            players: new Map<PlayerId, RemotePlayer>(),
          } satisfies MultiplayerRuntime
        }),
      )
  let multiplayerRevision = 0
  let multiplayerRejection = ''
  let multiplayerHandshakeComplete = false
  let multiplayerClosed = false
  let lastPlayerMoveSentAt = Number.NEGATIVE_INFINITY
  const multiplayerStatus = document.createElement('output')
  multiplayerStatus.className = 'multiplayer-status'
  multiplayerStatus.hidden = true
  canvas.insertAdjacentElement('afterend', multiplayerStatus)
  canvas.setAttribute('data-multiplayer-connection', multiplayer === undefined ? 'disabled' : 'connecting')
  canvas.setAttribute('data-multiplayer-player-count', '0')
  canvas.setAttribute('data-multiplayer-revision', '0')
  canvas.setAttribute('data-multiplayer-rejection', '')

  const dimensionFromWorld = (worldId: WorldId): Dimension | undefined =>
    worldId === 'overworld' || worldId === 'nether' || worldId === 'end'
      ? (worldId as Dimension)
      : undefined
  const applyNetworkBlock = (
    worldId: WorldId,
    at: { readonly x: number; readonly y: number; readonly z: number },
    block: string | null,
  ): void => {
    const dimension = dimensionFromWorld(worldId)
    if (dimension === undefined) return
    const context = getOrCreateDimensionChunkContext(dimension)
    Effect.runSync(context.chunkStore.setBlock(at, block === null ? 0 : blockIdOf(block as Parameters<typeof blockIdOf>[0])))
    if (dimension === currentChunkContext.dimension) redstoneDirty = true
  }

  const applyNetworkMessage = (message: NetworkMessage): void => {
    if (multiplayer === undefined) return
    switch (message._tag) {
      case 'WorldSnapshot':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        multiplayer.players.clear()
        for (const player of message.players) {
          if (player.player !== multiplayer.query.player) multiplayer.players.set(player.player, player)
        }
        for (const block of message.blocks) applyNetworkBlock(block.world, block.at, block.block)
        break
      case 'PlayerJoin':
        if (message.player !== multiplayer.query.player) {
          multiplayer.players.set(message.player, {
            name: message.name,
            world: WorldId.make(currentChunkContext.dimension),
            at: message.at,
            facing: { yawRadians: 0, pitchRadians: 0 },
          })
        }
        break
      case 'PlayerMove': {
        if (message.player === multiplayer.query.player) break
        const previous = multiplayer.players.get(message.player)
        multiplayer.players.set(message.player, {
          name: previous?.name ?? PlayerName.make(String(message.player)),
          world: message.world ?? previous?.world ?? WorldId.make(currentChunkContext.dimension),
          at: message.at,
          facing: message.facing,
        })
        break
      }
      case 'PlayerLeave':
        multiplayer.players.delete(message.player)
        break
      case 'BlockPlace':
        applyNetworkBlock(message.world ?? WorldId.make(currentChunkContext.dimension), message.at, message.block)
        multiplayerRevision += 1
        break
      case 'BlockBreak':
        applyNetworkBlock(message.world ?? WorldId.make(currentChunkContext.dimension), message.at, null)
        multiplayerRevision += 1
        break
      case 'BlockMutationRejected':
        multiplayerRevision = Math.max(multiplayerRevision, message.revision)
        multiplayerRejection = `${message.operation}: ${message.reason}`
        multiplayerStatus.textContent = multiplayerRejection
        multiplayerStatus.hidden = false
        break
      default:
        break
    }
    canvas.setAttribute('data-multiplayer-player-count', String(multiplayer.players.size + 1))
    canvas.setAttribute('data-multiplayer-revision', String(multiplayerRevision))
    canvas.setAttribute('data-multiplayer-rejection', multiplayerRejection)
  }

  const registeredSim = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mc-sim',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(simStages(simState, time, playerApi, crops)),
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
    ...(multiplayer === undefined
      ? []
      : [{
          name: 'mx-multiplayer',
          layers: EMPTY_MODULE_LAYER,
          frameStages: multiplayer.host.stages,
        }]),
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
  const furnaceView = createFurnaceView(document, inventoryParent)
  const chestView = createChestStorageView(document, inventoryParent)
  const crosshair = createCrosshairView(document, hudParent, motion)

  inventoryParent.setAttribute('role', 'dialog')
  inventoryParent.setAttribute('aria-label', 'Inventory')
  inventoryParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-inventory-open', 'false')

  let selectedHotbarIndex = 0
  let miningProgress: MiningProgressState | null = null
  let primaryAttackGestureConsumed = false
  const resetPrimaryAttackGesture = (): void => {
    miningProgress = null
    primaryAttackGestureConsumed = false
  }
  const renderCrosshair = (
    nowSecs = Effect.runSync(browserClock.monotonicSecs),
  ): void => {
    crosshair.render(crosshairViewModel({
      modals: paused ? ['pause'] : inventoryOpen ? ['inventory'] : [],
      lastHitAtSecs: undefined,
      breakProgress:
        miningProgress === null ? undefined : miningProgressFraction(miningProgress),
    }, nowSecs))
  }
  let inventoryFocus: InventoryInteractionTarget = {
    kind: 'slot',
    region: 'hotbar',
    index: selectedHotbarIndex,
  }
  let furnaceFocus: FurnaceSlotId = 'input'
  let furnaceStatus = ''
  let chestFocus: ChestStorageSlotTarget = { region: 'chest', slot: 0 }
  let chestSelected: ChestStorageSlotTarget | undefined
  let chestStatus = ''
  const inventoryInteraction = createInventoryInteraction(world.inventory, {
    onCrafted: () => markSessionDirty(),
    onInventoryChanged: () => markSessionDirty(),
  })
  const playerIsDead = (): boolean => Effect.runSync(world.vitals.view).healthPoints <= 0
  let touchControlsVisible = false
  const resetTouchInput = (
    reason: Parameters<typeof resetTouchLook>[1],
  ): void => {
    resetPrimaryAttackGesture()
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
    if (isCreativeMode) return
    const equipment = Effect.runSync(world.inventory.equipmentSnapshot)
    const reducedDamage = applyArmorToDamage(damage, armorPointsForEquipment(equipment))
    const healthBefore = Effect.runSync(world.vitals.view).healthPoints
    Effect.runSync(world.vitals.damage(reducedDamage))
    const healthAfter = Effect.runSync(world.vitals.view).healthPoints
    if (healthAfter < healthBefore) {
      const wear = armorDurabilityWearFromPreMitigationDamage(damage)
      if (wear > 0) {
        for (const slot of ['head', 'chest', 'legs', 'feet'] as const) {
          if (equipment.slots[slot] !== null) {
            Effect.runSync(
              world.inventory.damageAt({ _tag: 'Equipment', slot }, wear),
            )
          }
        }
      }
      audio.play('playerHurt')
    }
    if (playerIsDead()) {
      resetPrimaryAttackGesture()
      resetSimState(false)
    }
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
    inventoryView.root.style.setProperty(
      'display', inventoryMode === 'furnace' || inventoryMode === 'chest' ? 'none' : '',
    )
    furnaceView.root.style.setProperty('display', inventoryMode === 'furnace' ? '' : 'none')
    chestView.root.style.setProperty('display', inventoryMode === 'chest' ? '' : 'none')
    if (inventoryMode === 'chest') {
      const container = activeChestId === undefined
        ? null
        : Effect.runSync(world.inventory.containerSnapshot(activeChestId))
      const slotSnapshot = (
        stack: ItemStack | null | undefined,
        durability: { readonly current: number; readonly max: number } | null | undefined,
      ) => stack == null
        ? undefined
        : {
            item: stack.item,
            count: stack.count,
            durability: durability == null ? undefined : durability.current / durability.max,
          }
      const chestSlots = container?.slots.map((slot) =>
        slotSnapshot(slot, slot?.durability)) ?? Array.from({ length: 27 }, () => undefined)
      const playerSlots = storage.inventory.slots.map((slot, index) =>
        slotSnapshot(slot, storage.inventoryDurability[index]))
      const selectedStack = chestSelected === undefined
        ? undefined
        : chestSelected.region === 'chest'
          ? chestSlots[chestSelected.slot]
          : playerSlots[chestSelected.slot]
      chestView.render(chestStorageViewModel({
        chest: chestSlots,
        playerInventory: playerSlots,
        cursor: selectedStack,
        selectedSlot: chestSelected,
      }), { focusedSlot: chestFocus, status: chestStatus })
      return
    }
    if (inventoryMode === 'furnace') {
      const furnace = activeFurnaceKey === undefined
        ? undefined
        : furnaceStates.get(activeFurnaceKey)
      const state = furnace?.state ?? emptyFurnaceState()
      const recipe = STARTER_SMELTING_RECIPES.find(
        (candidate) => candidate.input === state.input?.item,
      )
      const fuelRule = STARTER_FUEL_RULES.find(
        (candidate) => candidate.item === state.fuel?.item,
      ) ?? STARTER_FUEL_RULES[0]
      const canCook = recipe !== undefined && (
        state.burnRemainingSecs > 0
        || STARTER_FUEL_RULES.some((candidate) => candidate.item === state.fuel?.item)
      )
      const slot = (stack: ItemStack | null): FurnaceSnapshot['input'] =>
        stack === null ? undefined : { itemId: stack.item, count: stack.count }
      furnaceView.render(furnaceViewModel({
        input: slot(state.input),
        fuel: slot(state.fuel),
        output: slot(state.output),
        cookProgress: canCook && recipe !== undefined
          ? state.cookElapsedSecs / recipe.cookDurationSecs
          : 0,
        burnProgress: state.burnRemainingSecs > 0 && fuelRule !== undefined
          ? state.burnRemainingSecs / fuelRule.burnDurationSecs
          : 0,
      }), { focusedSlot: furnaceFocus, status: furnaceStatus })
      return
    }
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

  const furnaceTargetOf = (source: EventTarget | null): FurnaceSlotId | undefined => {
    if (!(source instanceof Element)) return undefined
    const interactive = source.closest<HTMLElement>(
      '[data-interaction-target="furnace-slot"]',
    )
    if (interactive === null || !inventoryParent.contains(interactive)) return undefined
    const slot = interactive.dataset['interactionSlot']
    return slot === 'input' || slot === 'fuel' || slot === 'output' ? slot : undefined
  }

  const chestTargetOf = (source: EventTarget | null): ChestStorageSlotTarget | undefined => {
    if (!(source instanceof Element)) return undefined
    const interactive = source.closest<HTMLElement>(
      '[data-interaction-target="chest-storage-slot"]',
    )
    if (interactive === null || !inventoryParent.contains(interactive)) return undefined
    const region = interactive.dataset['interactionRegion']
    const slot = Number(interactive.dataset['interactionSlot'])
    if ((region !== 'chest' && region !== 'player') || !Number.isInteger(slot)) return undefined
    const intent = chestStorageSlotClickIntent({ region, slot })
    return intent?._tag === 'SlotClicked' ? intent.target : undefined
  }

  const sameChestTarget = (
    left: ChestStorageSlotTarget,
    right: ChestStorageSlotTarget,
  ): boolean => left.region === right.region && left.slot === right.slot

  const activateChestSlot = (target: ChestStorageSlotTarget): void => {
    if (playerIsDead() || bowInteractionLocked() || activeChestId === undefined) return
    chestFocus = target
    if (chestSelected === undefined) {
      const container = Effect.runSync(world.inventory.containerSnapshot(activeChestId))
      const stack = target.region === 'chest'
        ? container?.slots[target.slot]
        : Effect.runSync(world.inventory.storageSnapshot).inventory.slots[target.slot]
      if (stack == null) {
        chestStatus = 'Slot is empty'
      } else {
        chestSelected = target
        chestStatus = `Selected ${stack.item}`
      }
      renderPlayerUi()
      return
    }
    if (sameChestTarget(chestSelected, target)) {
      chestSelected = undefined
      chestStatus = 'Selection cleared'
      renderPlayerUi()
      return
    }
    if (chestSelected.region === target.region) {
      chestStatus = 'Choose a slot in the other inventory'
      renderPlayerUi()
      return
    }
    const source = chestSelected
    const container = Effect.runSync(world.inventory.containerSnapshot(activeChestId))
    const sourceStack = source.region === 'chest'
      ? container?.slots[source.slot]
      : Effect.runSync(world.inventory.storageSnapshot).inventory.slots[source.slot]
    if (sourceStack == null) {
      chestSelected = undefined
      chestStatus = 'Source slot is empty'
      renderPlayerUi()
      return
    }
    const result = Effect.runSync(world.inventory.transferContainerItem({
      direction: source.region === 'chest' ? 'ContainerToPlayer' : 'PlayerToContainer',
      containerId: activeChestId,
      playerSlot: source.region === 'player' ? source.slot : target.slot,
      containerSlot: source.region === 'chest' ? source.slot : target.slot,
      count: sourceStack.count,
    }))
    if (result._tag === 'Transferred') {
      chestSelected = undefined
      chestStatus = `Moved ${String(result.count)} ${result.item}`
      markSessionDirty()
    } else if (result._tag === 'ContainerNotFound') {
      activeChestId = undefined
      chestSelected = undefined
      setInventoryOpen(false)
      return
    } else {
      chestStatus = result._tag === 'DestinationFull'
        ? 'Destination slot is full'
        : result._tag === 'DestinationMismatch'
          ? 'Destination contains another item'
          : 'Transfer unavailable'
    }
    renderPlayerUi()
  }

  const updateActiveFurnace = (state: FurnaceState): void => {
    if (activeFurnaceKey === undefined) return
    const current = furnaceStates.get(activeFurnaceKey)
    if (current === undefined) return
    furnaceStates.set(activeFurnaceKey, { ...current, state })
    markSessionDirty()
  }

  const activateFurnaceSlot = (slot: FurnaceSlotId): void => {
    if (playerIsDead() || bowInteractionLocked() || activeFurnaceKey === undefined) return
    furnaceFocus = slot
    furnaceStatus = ''
    const furnace = furnaceStates.get(activeFurnaceKey)
    if (furnace === undefined) return
    if (slot === 'output') {
      const output = furnace.state.output
      if (output !== null) {
        const leftover = Effect.runSync(world.inventory.add(output.item, output.count))
        const accepted = output.count - leftover
        if (accepted > 0) {
          updateActiveFurnace({
            ...furnace.state,
            output: accepted === output.count
              ? null
              : itemStack(output.item, output.count - accepted),
          })
        } else {
          furnaceStatus = 'Inventory is full'
        }
      }
      renderPlayerUi()
      return
    }

    const selected = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]
    const expected = slot === 'input' ? 'raw_iron' : 'coal'
    const current = furnace.state[slot]
    if (selected?.item !== expected) {
      furnaceStatus = slot === 'input' ? 'Requires raw iron' : 'Requires coal'
      renderPlayerUi()
      return
    }
    if (current !== null && (current.item !== selected.item
      || current.count >= maxStackCountForItem(current.item))) {
      furnaceStatus = 'Furnace slot is full'
      renderPlayerUi()
      return
    }
    const removal = Effect.runSync(
      world.inventory.removeAt(selectedHotbarIndex, selected.item, 1),
    )
    if (removal._tag === 'Removed' && removal.removed > 0) {
      updateActiveFurnace({
        ...furnace.state,
        [slot]: { item: selected.item, count: (current?.count ?? 0) + removal.removed },
      })
    }
    renderPlayerUi()
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
    const activeScreen = inventoryMode === 'furnace'
      ? 'furnace'
      : inventoryMode === 'chest'
        ? 'chest-storage'
        : 'inventory'
    inventoryParent.querySelector<HTMLElement>(
      `[data-mx-ui="${activeScreen}"] [role="button"][tabindex="0"]`,
    )?.focus()
  }

  const activateInventoryTarget = (
    target: InventoryInteractionTarget,
    button: 'left' | 'right' = 'left',
  ): void => {
    if (playerIsDead() || bowInteractionLocked()) return
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
    if (inventoryMode === 'chest') {
      if (event.target instanceof Element && event.target.closest(
        '[data-interaction-target="chest-storage-close"]',
      ) !== null) {
        if (chestStorageCloseIntent()._tag === 'CloseRequested') setInventoryOpen(false)
        return
      }
      const chestTarget = chestTargetOf(event.target)
      if (chestTarget !== undefined) activateChestSlot(chestTarget)
      return
    }
    if (inventoryMode === 'furnace') {
      const furnaceTarget = furnaceTargetOf(event.target)
      if (furnaceTarget !== undefined) activateFurnaceSlot(furnaceTarget)
      return
    }
    const target = targetOf(event.target)
    if (target !== undefined) activateInventoryTarget(target)
  })
  inventoryParent.addEventListener('contextmenu', (event) => {
    if (playerIsDead()) return
    if (inventoryMode === 'furnace' || inventoryMode === 'chest') return
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    if (target.kind !== 'slot' || target.region === 'crafting-grid') return
    activateInventoryTarget(target, 'right')
  })
  inventoryParent.addEventListener('keydown', (event) => {
    if (playerIsDead()) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (inventoryMode === 'chest') {
      if (event.target instanceof Element && event.target.closest(
        '[data-interaction-target="chest-storage-close"]',
      ) !== null) {
        event.preventDefault()
        if (chestStorageCloseIntent()._tag === 'CloseRequested') setInventoryOpen(false)
        return
      }
      const chestTarget = chestTargetOf(event.target)
      if (chestTarget === undefined) return
      event.preventDefault()
      activateChestSlot(chestTarget)
      focusRenderedTarget()
      return
    }
    if (inventoryMode === 'furnace') {
      const furnaceTarget = furnaceTargetOf(event.target)
      if (furnaceTarget === undefined) return
      event.preventDefault()
      activateFurnaceSlot(furnaceTarget)
      focusRenderedTarget()
      return
    }
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    activateInventoryTarget(target)
    focusRenderedTarget()
  })

  const setInventoryOpen = (open: boolean, mode: InventoryMode = 'player'): void => {
    if (open && playerIsDead()) return
    if (open && bowInteractionLocked()) return
    const previousOpen = inventoryOpen
    const switchingMode = open && previousOpen && inventoryMode !== mode
    if (previousOpen === open && !switchingMode) return
    resetPrimaryAttackGesture()

    if (
      previousOpen
      && (inventoryMode === 'player' || inventoryMode === 'craftingTable')
      && (!open || switchingMode)
    ) {
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
      if (mode === 'player' || mode === 'craftingTable') {
        inventoryInteraction.configureGrid(presentation.width, presentation.height)
      }
      inventoryParent.setAttribute('aria-label', presentation.label)
      if (mode === 'furnace') {
        furnaceFocus = 'input'
        furnaceStatus = ''
      } else if (mode === 'chest') {
        chestFocus = { region: 'chest', slot: 0 }
        chestSelected = undefined
        chestStatus = ''
      } else {
        inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
      }
    }
    if (!open && inventoryMode === 'chest') {
      activeChestId = undefined
      chestSelected = undefined
      chestStatus = ''
    }
    renderPlayerUi()
    renderCrosshair()
    syncTouchControls()
    if (open) window.requestAnimationFrame(focusRenderedTarget)
    if (open && document.pointerLockElement === canvas) {
      document.exitPointerLock()
    }
  }

  const respawnPlayer = (): void => {
    resetPrimaryAttackGesture()
    resetBowUse()
    Effect.runSync(world.vitals.respawn)
    Effect.runSync(world.entities.reset)
    Effect.runSync(Ref.set(gameplayState.hostileContactCooldowns, new Map()))
    Effect.runSync(Ref.set(gameplayState.playerDamages, []))
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
  renderCrosshair()
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
    resetPrimaryAttackGesture()
    if (next) resetBowUse()
    paused = next
    gameShell.inert = next
    pauseOverlay.hidden = !next
    document.body.setAttribute('data-session-paused', String(next))
    renderCrosshair()
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

  const entityRenderProjection = (): ReadonlyArray<RenderEntity> => [
    ...Effect.runSync(world.entities.snapshot).entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      category: entity.kind === 'dropped_item' ? 'item' : 'hostile',
    } satisfies RenderEntity)),
    ...[...(multiplayer?.players.entries() ?? [])]
      .filter(([, player]) => player.world === currentChunkContext.dimension)
      .map(([playerId, player]) => ({
        id: `multiplayer:${String(playerId)}`,
        kind: 'remote_player',
        feetPosition: player.at,
      } satisfies RenderEntity)),
  ]

  const gameplaySnapshot = () => {
    const pose = Effect.runSync(playerApi.pose)
    const dimension = Effect.runSync(playerApi.dimension)
    const reading = Effect.runSync(currentChunkStore.getBlock(KNOWN_TARGET_BLOCK))
    const ignitionReading = Effect.runSync(currentChunkStore.getBlock(QA_IGNITION_CELL))
    const farmSoilReading = Effect.runSync(currentChunkStore.getBlock(KNOWN_TARGET_BLOCK))
    const farmCropReading = Effect.runSync(currentChunkStore.getBlock(QA_FARM_CROP_BLOCK))
    const cropSnapshot = Effect.runSync(crops.snapshot)
    const storage = Effect.runSync(world.inventory.storageSnapshot)
    const containerStorage = Effect.runSync(world.inventory.containerStorageSnapshot)
    const inventory = storage.inventory
    const vitals = Effect.runSync(world.vitals.snapshot)
    const entities = Effect.runSync(world.entities.snapshot).entities
    const activePortal = [...portalStates.values()].find(
      (portal) => portal.dimension === dimension,
    )
    const activePortalReading = activePortal === undefined
      ? undefined
      : Effect.runSync(currentChunkStore.getBlock(activePortal.position))
    const activePortalFramePosition = activePortal === undefined
      ? undefined
      : {
          x: activePortal.position.x - 1,
          y: activePortal.position.y - 1,
          z: activePortal.position.z,
        }
    const activePortalFrameReading = activePortalFramePosition === undefined
      ? undefined
      : Effect.runSync(currentChunkStore.getBlock(activePortalFramePosition))
    return {
      mode: sessionMetadata.mode,
      pose,
      dimension,
      activeChunkDimension: currentChunkContext.dimension,
      environmentalContact: {
        simulationElapsedSecs,
        lastDamageElapsedSecs: environmentalContactDamageState.lastDamageElapsedSecs ?? null,
        cells: environmentalContactCellsForPose(pose),
      },
      fall: {
        grounded: Effect.runSync(Ref.get(simState.isGrounded)),
        accumulatedDistance: Effect.runSync(Ref.get(simState.accumulatedFallDistance)),
      },
      weather: Effect.runSync(weather.snapshot),
      vitals,
      dead: vitals.healthPoints <= 0,
      inventory: {
        slots: inventory.slots.map((slot) => slot ?? null),
        durability: storage.inventoryDurability,
        equipment: storage.equipment.slots,
      },
      containerStorage,
      chestUi: {
        open: inventoryOpen && inventoryMode === 'chest',
        activeChestId: activeChestId ?? null,
        selectedSlot: chestSelected ?? null,
        focusedSlot: chestFocus,
        status: chestStatus,
      },
      entityCount: entities.length,
      renderedEntities: entityRenderProjection(),
      mobDrops: observedMobDrops.map(({ renderId: _, ...drop }) => drop),
      itemUse: lastObservedItemUse ?? null,
      entities: entities.map((entity) => {
        const dropped = isDroppedItemBehaviour(entity.behaviour) ? entity.behaviour : undefined
        return {
          id: entity.id,
          kind: entity.kind,
          feetPosition: entity.feetPosition,
          healthPoints: entity.healthPoints,
          ...(dropped === undefined ? {} : {
            item: dropped.item,
            count: dropped.count,
            durability: dropped.durability,
          }),
        }
      }),
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
      farming: {
        soilBlock: farmSoilReading._tag === 'Block' ? farmSoilReading.block : null,
        cropBlock: farmCropReading._tag === 'Block' ? farmCropReading.block : null,
        crops: cropSnapshot.crops,
        cropStage: cropSnapshot.crops.some(
          (crop) => crop.dimension === dimension
            && crop.position.x === QA_FARM_CROP_BLOCK.x
            && crop.position.y === QA_FARM_CROP_BLOCK.y
            && crop.position.z === QA_FARM_CROP_BLOCK.z
            && crop.growthSecs >= POTATO_MATURITY_SECS,
        ) ? 'mature' : cropSnapshot.crops.length > 0 ? 'growing' : 'empty',
      },
      portals: [...portalStates.values()],
      activePortal: activePortal === undefined
        || activePortalReading === undefined
        || activePortalFramePosition === undefined
        || activePortalFrameReading === undefined
        ? null
        : {
            anchor: activePortal.position,
            interiorBlock: activePortalReading._tag === 'Block'
              ? activePortalReading.block
              : null,
            framePosition: activePortalFramePosition,
            frameBlock: activePortalFrameReading._tag === 'Block'
              ? activePortalFrameReading.block
              : null,
          },
      persistence: {
        formatVersion: SESSION_FORMAT_VERSION,
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

  const stickyPistonSnapshot = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const readBlock = (position: { readonly x: number; readonly y: number; readonly z: number }) => {
      const reading = Effect.runSync(currentChunkStore.getBlock(position))
      return reading._tag === 'Block' ? reading.block : null
    }
    return {
      active: leverStates.get(leverKeyOf({ dimension, position: QA_PISTON_LEVER }))?.active ?? false,
      lever: readBlock(QA_PISTON_LEVER),
      piston: readBlock(QA_PISTON),
      near: readBlock(QA_PISTON_NEAR),
      far: readBlock(QA_PISTON_FAR),
    }
  }

  const seedStickyPistonEncounter = () => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, dimension))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('stone', 1))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_LEVER, 76))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON, 16))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_NEAR, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_FAR, 0))
    leverStates.set(leverKeyOf({ dimension, position: QA_PISTON_LEVER }), {
      dimension,
      position: QA_PISTON_LEVER,
      active: false,
    })
    pendingBlockUses.clear()
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    redstoneDirty = true
    markSessionDirty()
    renderPlayerUi()
    return stickyPistonSnapshot()
  }

  const seedWoodenPickaxeProgression = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('oak_log', 3))
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

  const seedFarmingEncounter = () => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    Effect.runSync(playerApi.restore(QA_FARM_POSE, dimension))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('potato', 1))
    Effect.runSync(currentChunkStore.setBlock(KNOWN_TARGET_BLOCK, FARMLAND_BLOCK_ID))
    Effect.runSync(currentChunkStore.setBlock(QA_FARM_CROP_BLOCK, POTATO_CROP_BLOCK_ID))
    Effect.runSync(crops.restore({
      crops: [{
        dimension,
        position: QA_FARM_CROP_BLOCK,
        crop: 'potato_crop',
        growthSecs: POTATO_MATURITY_SECS - 0.1,
      }],
    }))
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    pendingItemUses.clear()
    lastObservedItemUse = undefined
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const harvestFarmingCrop = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const location = { dimension, position: QA_FARM_CROP_BLOCK } as CropLocation
    const ripe = Effect.runSync(crops.matureYieldAt(location)) !== null
    if (!ripe) return gameplaySnapshot()
    Effect.runSync(currentChunkStore.setBlock(QA_FARM_CROP_BLOCK, 0))
    Effect.runSync(crops.remove(location))
    nextItemUseRequestId += 1
    const requestId = `item-use-${String(nextItemUseRequestId)}`
    Effect.runSync(
      requestPotatoHarvest(gameplayState, requestId, QA_FARM_CROP_BLOCK, true, Math.random()),
    )
    pendingItemUses.set(requestId, {
      kind: 'harvest',
      dimension,
      position: QA_FARM_CROP_BLOCK,
    })
    markSessionDirty()
    return gameplaySnapshot()
  }

  const seedEnvironmentalContactEncounter = (
    kind: 'cactus' | 'duplicateLava' | 'lethalMixed',
  ) => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    const encounterPose =
      kind === 'cactus' ? QA_CACTUS_APPROACH_POSE : QA_ENVIRONMENT_OVERLAP_POSE
    Effect.runSync(playerApi.restore(encounterPose, dimension))
    Effect.runSync(
      streamAround(
        currentChunkContext,
        encounterPose.feetPosition.x,
        encounterPose.feetPosition.z,
      ),
    )
    const stone = blockIdOf('stone')
    const air = blockIdOf('air')
    for (const position of QA_ENVIRONMENT_FLOOR_CELLS) {
      Effect.runSync(currentChunkStore.setBlock(position, stone))
    }
    for (const position of QA_ENVIRONMENT_CONTACT_CELLS) {
      Effect.runSync(currentChunkStore.setBlock(position, air))
      Effect.runSync(currentChunkStore.setBlock({ ...position, y: position.y + 1 }, air))
    }

    if (kind === 'cactus') {
      Effect.runSync(
        currentChunkStore.setBlock(QA_ENVIRONMENT_CONTACT_CELLS[1], blockIdOf('cactus')),
      )
    } else if (kind === 'duplicateLava') {
      for (const position of QA_ENVIRONMENT_CONTACT_CELLS) {
        Effect.runSync(currentChunkStore.setBlock(position, blockIdOf('lava')))
      }
    } else {
      Effect.runSync(
        currentChunkStore.setBlock(QA_ENVIRONMENT_CONTACT_CELLS[0], blockIdOf('lava')),
      )
      Effect.runSync(
        currentChunkStore.setBlock(QA_ENVIRONMENT_CONTACT_CELLS[1], blockIdOf('cactus')),
      )
      applyPlayerDamage({ amount: 16, cause: 'generic' })
    }

    resetSimState(true)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedFallEncounter = (kind: keyof typeof QA_FALL_START_Y) => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    Effect.runSync(
      streamAround(currentChunkContext, QA_FALL_CENTER.x + 0.5, QA_FALL_CENTER.z + 0.5),
    )
    const stone = blockIdOf('stone')
    const air = blockIdOf('air')
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
        const x = QA_FALL_CENTER.x + xOffset
        const z = QA_FALL_CENTER.z + zOffset
        Effect.runSync(currentChunkStore.setBlock({ x, y: QA_FALL_FLOOR_Y, z }, stone))
        for (let y = QA_FALL_FLOOR_Y + 1; y <= QA_FALL_START_Y.lethal + 2; y += 1) {
          Effect.runSync(currentChunkStore.setBlock({ x, y, z }, air))
        }
      }
    }
    Effect.runSync(playerApi.restore({
      feetPosition: {
        x: QA_FALL_CENTER.x + 0.5,
        y: QA_FALL_START_Y[kind],
        z: QA_FALL_CENTER.z + 0.5,
      },
      yawRadians: 0,
      pitchRadians: 0,
    }, dimension))
    resetSimState(true)
    markSessionDirty()
    return gameplaySnapshot()
  }

  const seedPortalEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_PORTAL_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(materializePortal('overworld', QA_PORTAL_LAYOUT))
    registerPortal({ dimension: 'overworld', position: QA_PORTAL_ANCHOR })
    Effect.runSync(
      streamAround(
        currentChunkContext,
        QA_PORTAL_POSE.feetPosition.x,
        QA_PORTAL_POSE.feetPosition.z,
      ),
    )
    markSessionDirty()
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

  let stopBrowserPreview: (() => Promise<void>) | undefined
  const registry = buildQaRegistry([
    {
      namespace: 'render',
      commands: {
        snapshotLighting: () => ({
          ...currentChunkContext.lightingSnapshot(),
          weatherBrightness: weatherLightScale(Effect.runSync(weather.snapshot).weather),
        }),
      },
    },
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
        setPose: (targetBlock?: number) => {
          Effect.runSync(playerApi.restore(QA_POSE, Effect.runSync(playerApi.dimension)))
          if (targetBlock !== undefined) {
            Effect.runSync(currentChunkStore.setBlock(KNOWN_TARGET_BLOCK, targetBlock))
          }
          resetSimState(true)
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedCreativeBreakEncounter: () => {
          Effect.runSync(playerApi.restore(QA_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('stone', 2))
          Effect.runSync(currentChunkStore.setBlock(KNOWN_TARGET_BLOCK, 2))
          selectedHotbarIndex = 0
          inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedCreativePlacementEncounter: () => {
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('stone', 2))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, 2))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, 0))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, 2))
          selectedHotbarIndex = 0
          inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        returnToCraftingTable: () => {
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
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
        seedStickyPistonEncounter,
        stickyPistonSnapshot,
        seedFarmingEncounter,
        harvestFarmingCrop,
        seedCactusApproach: () => seedEnvironmentalContactEncounter('cactus'),
        seedDuplicateLavaContact: () => seedEnvironmentalContactEncounter('duplicateLava'),
        seedLethalMixedContact: () => seedEnvironmentalContactEncounter('lethalMixed'),
        seedSafeFall: () => seedFallEncounter('safe'),
        seedDamagingFall: () => seedFallEncounter('damaging'),
        seedLethalFall: () => seedFallEncounter('lethal'),
        preparePotatoEating: () => {
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          Effect.runSync(world.vitals.addExhaustion(36))
          markSessionDirty()
          return gameplaySnapshot()
        },
        returnToFarmingPlot: () => {
          Effect.runSync(playerApi.restore(QA_FARM_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedPortalEncounter,
        seedWoodenPickaxeProgression,
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
        seedZombiePursuitEncounter: () => {
          respawnPlayer()
          const currentPose = Effect.runSync(playerApi.pose)
          Effect.runSync(requestMobSpawn(gameplayState, {
            kind: ZOMBIE_KIND,
            feetPosition: {
              x: currentPose.feetPosition.x + 4,
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
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
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
            kind: 'ignition',
            slotIndex: selectedHotbarIndex,
            heldItem: 'fire_charge',
          })
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedMeleeDropEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('wooden_sword', 1))
          inventoryInteraction.reset()
          selectedHotbarIndex = 0
          inventoryFocus = {
            kind: 'slot',
            region: 'hotbar',
            index: selectedHotbarIndex,
          }
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
    {
      namespace: 'lifecycle',
      commands: {
        stop: () => stopBrowserPreview?.(),
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
  let multiplayerDisposeStarted = false
  const disposeMultiplayer = (): void => {
    if (multiplayer === undefined || multiplayerDisposeStarted) return
    multiplayerDisposeStarted = true
    const leave = encodeFrame({
      _tag: 'PlayerLeave',
      player: multiplayer.query.player,
    })
    const close = multiplayer.transport.state() === 'open' && Either.isRight(leave)
      ? multiplayer.transport.send(leave.right).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.zipRight(multiplayer.transport.close),
        )
      : multiplayer.transport.close
    void Effect.runPromise(close)
  }
  // IndexedDB cannot be made synchronous during pagehide; this is best-effort.
  // Periodic publication persists advancing time and weather without gameplay mutations.
  window.addEventListener('pagehide', (event) => {
    requestBackgroundFlush()
    void stopBrowserPreview?.()
    disposeMultiplayer()
    if (!event.persisted) {
      settingsView.dispose()
      audio.close()
    }
  })
  const hot = (import.meta as ImportMeta & {
    readonly hot?: { readonly dispose: (handler: () => void) => void }
  }).hot
  hot?.dispose(() => {
    void stopBrowserPreview?.()
    disposeMultiplayer()
    settingsView.dispose()
    audio.close()
  })

  // -------------------------------------------------------------------------
  // 6. The frame
  // -------------------------------------------------------------------------

  const runFrame = game.runFrameWith(BrowserClockLayer)

  // Time is read through the Port, not from `performance`. `apps/web/clock.ts`
  // is the only file allowed the raw reading and `pnpm check:deps` enforces it.
  const readNow = (): MonotonicTimeSecs => Effect.runSync(browserClock.monotonicSecs)

  let previousSecs: MonotonicTimeSecs | undefined
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
      renderCrosshair(nowSecs)
      Effect.runSync(inputApi.endFrame(frameInput))
      previousSecs = nowSecs
      return
    }
    if (paused) {
      renderCrosshair(nowSecs)
      Effect.runSync(inputApi.endFrame(frameInput))
      previousSecs = nowSecs
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
    const foodOutcome = isCreativeMode
      ? { signal: 'none' as const }
      : Effect.runSync(world.vitals.advanceFoodTimer(deltaSecs))
    if (foodOutcome.signal !== 'none') markSessionDirty()
    simulationElapsedSecs += deltaSecs

    const dead = playerIsDead()
    syncTouchControls()
    if (dead) {
      if (inventoryOpen) setInventoryOpen(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }

    if (
      !dead &&
      !bowInteractionLocked() &&
      Effect.runSync(inputApi.wasActionJustTriggered('openInventory'))
    ) {
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
    const attackHeld = held('attack') > 0
    if (!attackHeld) resetPrimaryAttackGesture()
    const useTriggered =
      !dead && !inventoryOpen && Effect.runSync(inputApi.wasActionJustTriggered('use'))
    const useHeld = held('use') > 0
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
    Effect.runSync(syncPortalCandidateSnapshots())

    if (multiplayer !== undefined && !multiplayerHandshakeComplete && multiplayer.transport.state() === 'open') {
      const pose = Effect.runSync(playerApi.pose)
      const worldId = WorldId.make(Effect.runSync(playerApi.dimension))
      Effect.runSync(multiplayer.host.transitionConnection({
        _tag: 'HandshakeSucceeded',
        player: multiplayer.query.player,
        world: worldId,
      }))
      Effect.runSync(multiplayer.host.enqueueOutbound({
        _tag: 'PlayerJoin',
        player: multiplayer.query.player,
        name: multiplayer.query.name,
        at: pose.feetPosition,
      }))
      multiplayerHandshakeComplete = true
      canvas.setAttribute('data-multiplayer-connection', 'connected')
      canvas.setAttribute('data-multiplayer-player-count', String(multiplayer.players.size + 1))
    } else if (
      multiplayer !== undefined &&
      !multiplayerClosed &&
      multiplayer.transport.state() === 'closed'
    ) {
      Effect.runSync(multiplayer.host.transitionConnection({ _tag: 'PeerClosed' }))
      multiplayerClosed = true
      canvas.setAttribute('data-multiplayer-connection', 'closed')
    }

    const outcome = Effect.runSyncExit(runFrame(deltaSecs))

    if (Exit.isFailure(outcome)) {
      // A stage's error channel is `never`, so reaching here means a DEFECT.
      // Stopping the loop is deliberate: a defect that repeats sixty times a
      // second buries its own first occurrence in the console.
      failBoot('a frame stage defected', outcome.cause)
      return
    }

    if (multiplayer !== undefined) {
      for (const message of Effect.runSync(multiplayer.host.drainInbound)) {
        applyNetworkMessage(message)
      }
      if (multiplayerHandshakeComplete && nowSecs - lastPlayerMoveSentAt >= 0.1) {
        const pose = Effect.runSync(playerApi.pose)
        Effect.runSync(multiplayer.host.enqueueOutbound({
          _tag: 'PlayerMove',
          player: multiplayer.query.player,
          world: WorldId.make(Effect.runSync(playerApi.dimension)),
          at: pose.feetPosition,
          facing: { yawRadians: pose.yawRadians, pitchRadians: pose.pitchRadians },
        }))
        lastPlayerMoveSentAt = nowSecs
      }
    }

    // Portal travel has already updated the player. Make its destination world
    // concrete before dimension alignment streams or renders that world.
    Effect.runSync(applyPortalTravels())

    let furnaceStateChanged = false
    for (const [key, furnace] of furnaceStates) {
      const next = advanceFurnace(furnace.state, deltaSecs).state
      if (JSON.stringify(next) !== JSON.stringify(furnace.state)) {
        furnaceStates.set(key, { ...furnace, state: next })
        furnaceStateChanged = true
      }
    }
    if (furnaceStateChanged) {
      markSessionDirty()
      if (inventoryOpen && inventoryMode === 'furnace') renderPlayerUi()
    }

    for (const pending of pendingBlockBreakConfirmations.splice(0)) {
      const context = dimensionContexts.get(pending.dimension)
      if (context === undefined) continue
      const reading = Effect.runSync(context.chunkStore.getBlock(pending.position))
      if (reading._tag !== 'Block' || reading.block === pending.blockId) continue
      if (pending.blockId === blockIdOf('chest')) {
        const id = containerIdAt(pending.dimension, pending.position)
        const drained = Effect.runSync(world.inventory.drainContainer(id))
        if (drained._tag === 'Drained') {
          const at = {
            x: pending.position.x + 0.5,
            y: pending.position.y + 0.5,
            z: pending.position.z + 0.5,
          }
          if (drained.items.length > 0) {
            Effect.runSync(spawnDroppedItems(
              world.entities,
              drained.items.map((stack) => ({ ...stack, at })),
            ))
          }
          markSessionDirty()
        }
        if (activeChestId === id && inventoryOpen && inventoryMode === 'chest') {
          activeChestId = undefined
          setInventoryOpen(false)
        }
        continue
      }
      if (pending.blockId !== 104) continue
      const key = furnaceKeyOf(pending)
      const furnace = furnaceStates.get(key)
      if (furnace !== undefined) {
        const at = {
          x: pending.position.x + 0.5,
          y: pending.position.y + 0.5,
          z: pending.position.z + 0.5,
        }
        const contents = [furnace.state.input, furnace.state.fuel, furnace.state.output]
          .filter(
            (stack): stack is ItemStack & { readonly item: LegacyGameplayItemType } =>
              stack !== null && isLegacyGameplayItemType(stack.item),
          )
          .map((stack) => ({ ...stack, at }))
        if (contents.length > 0) {
          Effect.runSync(spawnDroppedItems(world.entities, contents))
        }
        furnaceStates.delete(key)
        markSessionDirty()
      }
      if (activeFurnaceKey === key && inventoryOpen && inventoryMode === 'furnace') {
        activeFurnaceKey = undefined
        setInventoryOpen(false)
      }
    }

    for (const pending of pendingMiningToolDamage.splice(0)) {
      const context = dimensionContexts.get(pending.dimension)
      if (context === undefined) continue
      const reading = Effect.runSync(context.chunkStore.getBlock(pending.position))
      if (reading._tag !== 'Block' || reading.block === pending.blockId) continue

      const selected = Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]
      if (selected?.item !== pending.item) continue

      Effect.runSync(
        world.inventory.damageAt(
          { _tag: 'Inventory', slotIndex: pending.slotIndex },
          1,
        ),
      )
      markSessionDirty()
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
    let deadAfterFrame = playerIsDead()

    // A portal may change dimension in the same frame that gameplay confirms a
    // attack. Settle confirmations before dimension reset clears the outboxes.
    settleBowShotResults()
    settleMeleeAttackResults()

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
      resetPrimaryAttackGesture()
      resetBowUse()
      alignActiveDimension(dimensionAfterFrame)
      resetSimState(!deadAfterFrame)
      markSessionDirty()
    }

    const landingImpact = Effect.runSync(Ref.get(simState.landingImpact))
    if (!deadAfterFrame && !dimensionChanged && Option.isSome(landingImpact)) {
      const fallDamage = resolveFallDamage(landingImpact.value.fallDistance)
      if (fallDamage !== undefined) {
        applyPlayerDamage(fallDamage)
        markSessionDirty()
        if (playerIsDead()) {
          setInventoryOpen(false)
          if (document.pointerLockElement === canvas) document.exitPointerLock()
        }
      }
    }
    deadAfterFrame = playerIsDead()

    // Landing damage resolves before block contact in the same frame.
    if (!deadAfterFrame && !dimensionChanged) {
      const environmentalDamage = resolveEnvironmentalContactDamage(
        environmentalContactDamageState,
        environmentalContactsForPose(postFramePose),
        simulationElapsedSecs,
      )
      environmentalContactDamageState = environmentalDamage.state
      for (const damage of environmentalDamage.damages) applyPlayerDamage(damage)
      if (environmentalDamage.damages.length > 0) {
        markSessionDirty()
        if (playerIsDead()) {
          setInventoryOpen(false)
          if (document.pointerLockElement === canvas) document.exitPointerLock()
        }
      }
    } else if (deadAfterFrame) {
      environmentalContactDamageState = INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE
    }
    deadAfterFrame = playerIsDead()
    syncTouchControls()

    const bowInventory = Effect.runSync(world.inventory.snapshot)
    const selectedBowItem = bowInventory.slots[selectedHotbarIndex]?.item ?? null
    const bowAdvance = advanceBowUse({
      state: bowUseState,
      useTriggered,
      useHeld,
      cancelled: deadAfterFrame || dimensionChanged || inventoryOpen || pendingBowShots.size > 0,
      selectedItem: selectedBowItem,
      selectedSlotIndex: selectedHotbarIndex,
      arrowCount: bowInventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'arrow' ? slot.count : 0),
        0,
      ),
      deltaSecs,
    })
    bowUseState = bowAdvance.state
    if (bowAdvance.release !== null) {
      nextBowShotRequestId += 1
      const requestId = `bow-shot-${String(nextBowShotRequestId)}`
      pendingBowShots = new Map(pendingBowShots).set(requestId, {
        bowSlotIndex: bowAdvance.release.bowSlotIndex,
      })
      const horizontal = Math.cos(postFramePose.pitchRadians)
      Effect.runSync(requestBowShot(gameplayState, requestId, {
        origin: {
          x: postFramePose.feetPosition.x,
          y: postFramePose.feetPosition.y + EYE_LEVEL_OFFSET,
          z: postFramePose.feetPosition.z,
        },
        dirX: -Math.sin(postFramePose.yawRadians) * horizontal,
        dirY: Math.sin(postFramePose.pitchRadians),
        dirZ: -Math.cos(postFramePose.yawRadians) * horizontal,
        chargeSecs: bowAdvance.release.chargeSecs,
      }))
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
      if (!isCreativeMode && horizontalDistance > 0) {
        Effect.runSync(world.vitals.addExhaustion(horizontalDistance * WALK_EXHAUSTION_PER_METRE))
      }
    }
    if (looked || moved) markSessionDirty()
    Effect.runSync(Ref.set(gameplayState.targetPosition, postFramePose.feetPosition))

    // Resolve click rays from the authoritative post-simulation pose. Requests
    // enter gameplay's inbox and are consumed by the next frame.
    if (!deadAfterFrame && !dimensionChanged && attackHeld) {
      if (primaryAttackGestureConsumed) {
        miningProgress = null
      } else {
        const inventorySnapshot = Effect.runSync(world.inventory.snapshot)
        const selectedSlotIndex = selectedHotbarIndex
        const selectedItem = inventorySnapshot.slots[selectedSlotIndex]?.item ?? null
        const resolution = Effect.runSync(
          resolveTargetedPrimaryAttack(
            currentChunkStore,
            world.entities,
            playerApi,
            {
              meleeDamage: meleeDamageForItem(
                selectedItem === null ? null : gameplayModuleItem(selectedItem),
              ),
            },
          ),
        )
        if (resolution._tag === 'Melee') {
          miningProgress = null
          if (attackTriggered) {
            nextMeleeAttackRequestId += 1
            const requestId = `melee-attack-${String(nextMeleeAttackRequestId)}`
            Effect.runSync(
              requestMeleeAttack(gameplayState, {
                ...resolution.request,
                requestId,
              }),
            )
            if (selectedItem !== null && isSwordItem(selectedItem)) {
              pendingMeleeAttacks.set(requestId, {
                slotIndex: selectedSlotIndex,
                item: selectedItem,
              })
            }
            primaryAttackGestureConsumed = true
            markSessionDirty()
          }
        } else {
          const miningItem = selectedItem !== null && isLegacyGameplayItemType(selectedItem)
            ? selectedItem
            : null
          let target: Parameters<typeof advanceMiningProgress>[0]['target'] = null
          if (resolution._tag === 'Block') {
            const reading = Effect.runSync(currentChunkStore.getBlock(resolution.target.position))
            if (reading._tag === 'Block') {
              const position = {
                x: Math.floor(resolution.target.position.x),
                y: Math.floor(resolution.target.position.y),
                z: Math.floor(resolution.target.position.z),
              } as NonNullable<Parameters<typeof advanceMiningProgress>[0]['target']>['position']
              target = { position, blockId: reading.block }
            }
          }
          const advancement = advanceMiningProgress({
            current: miningProgress,
            target,
            isMining: true,
            selectedItem: miningItem,
            deltaSecs,
          })
          miningProgress = isCreativeMode ? null : advancement.nextProgress
          const shouldBreak = isCreativeMode ? attackTriggered : advancement.shouldBreak
          if (shouldBreak && target !== null) {
            const dimension = Effect.runSync(playerApi.dimension)
            if (multiplayer !== undefined) {
              Effect.runSync(multiplayer.host.enqueueOutbound({
                _tag: 'BlockBreak',
                player: multiplayer.query.player,
                world: WorldId.make(dimension),
                at: target.position,
              }))
            } else if (target.blockId === POTATO_CROP_BLOCK_ID) {
              const location = { dimension, position: target.position }
              const ripe = Effect.runSync(crops.matureYieldAt(location)) !== null
              Effect.runSync(currentChunkStore.setBlock(target.position, 0))
              Effect.runSync(crops.remove(location))
              nextItemUseRequestId += 1
              const requestId = `item-use-${String(nextItemUseRequestId)}`
              Effect.runSync(
                requestPotatoHarvest(gameplayState, requestId, target.position, ripe, Math.random()),
              )
              pendingItemUses.set(requestId, {
                kind: 'harvest',
                dimension,
                position: target.position,
              })
            } else {
              Effect.runSync(
                requestBlockBreak(
                  gameplayState,
                  target.position,
                  miningLootContextForItem(miningItem),
                ),
              )
              pendingBlockBreakConfirmations.push({
                dimension,
                position: target.position,
                blockId: target.blockId,
              })
              if (
                !isCreativeMode && (
                  selectedItem === 'wooden_pickaxe' ||
                  selectedItem === 'stone_pickaxe' ||
                  selectedItem === 'iron_pickaxe' ||
                  selectedItem === 'diamond_pickaxe'
                )
              ) {
                pendingMiningToolDamage.push({
                  dimension,
                  position: target.position,
                  blockId: target.blockId,
                  slotIndex: selectedHotbarIndex,
                  item: selectedItem,
                })
              }
            }
            breaksRequested += 1
            canvas.setAttribute('data-breaks-requested', String(breaksRequested))
            primaryAttackGestureConsumed = true
            if (multiplayer === undefined) {
              redstoneDirty = true
              markSessionDirty()
            }
          }
        }
      }
    } else if (deadAfterFrame || dimensionChanged) {
      resetPrimaryAttackGesture()
    }

    if (!deadAfterFrame && useTriggered && !bowAdvance.capturedUse && pendingBowShots.size === 0) {
      const route = Effect.runSync(
        targetedRightClickRoute(currentChunkStore, playerApi, DEFAULT_BLOCK_REACH),
      )
      if (route?.kind === 'craftingTable') {
        setInventoryOpen(true, 'craftingTable')
      } else if (route?.kind === 'furnace') {
        const dimension = Effect.runSync(playerApi.dimension)
        const position = {
          x: Math.floor(route.at.x),
          y: Math.floor(route.at.y),
          z: Math.floor(route.at.z),
        }
        const key = furnaceKeyOf({ dimension, position })
        if (!furnaceStates.has(key)) {
          furnaceStates.set(key, { dimension, position, state: emptyFurnaceState() })
          markSessionDirty()
        }
        activeFurnaceKey = key
        setInventoryOpen(true, 'furnace')
      } else if (route?.kind === 'storage') {
        const dimension = Effect.runSync(playerApi.dimension)
        const position = {
          x: Math.floor(route.at.x),
          y: Math.floor(route.at.y),
          z: Math.floor(route.at.z),
        }
        const id = containerIdAt(dimension, position)
        const created = Effect.runSync(world.inventory.createContainer(id))
        if (created._tag === 'Created') markSessionDirty()
        if (created._tag !== 'InvalidContainerId') {
          activeChestId = id
          setInventoryOpen(true, 'chest')
        }
      } else {
        const inventoryBeforeUse = Effect.runSync(world.inventory.snapshot)
        const selected = inventoryBeforeUse.slots[selectedHotbarIndex]
        let shouldAttemptPlacement = selected === undefined

        if (selected !== undefined && isGameplayUseItemType(selected.item)) {
          nextItemUseRequestId += 1
          const requestId = `item-use-${String(nextItemUseRequestId)}`
          if (selected.item === 'potato') {
            const target = Effect.runSync(
              requestTargetedPotatoPlanting(
                gameplayState,
                currentChunkStore,
                playerApi,
                requestId,
              ),
            )
            if (Option.isSome(target)) {
              pendingItemUses.set(requestId, {
                kind: 'plant',
                slotIndex: selectedHotbarIndex,
                dimension: Effect.runSync(playerApi.dimension),
              })
            } else {
              Effect.runSync(
                requestPotatoFoodUse(
                  gameplayState,
                  requestId,
                  Effect.runSync(world.vitals.snapshot),
                ),
              )
              pendingItemUses.set(requestId, { kind: 'eat', slotIndex: selectedHotbarIndex })
            }
          } else if (
            isLegacyGameplayItemType(selected.item) &&
            isGameplayHoeItem(selected.item)
          ) {
            const target = Effect.runSync(
              requestTargetedSoilTill(
                gameplayState,
                currentChunkStore,
                playerApi,
                requestId,
                selected.item,
              ),
            )
            if (Option.isSome(target)) {
              pendingItemUses.set(requestId, {
                kind: 'till',
                slotIndex: selectedHotbarIndex,
                heldItem: selected.item,
              })
            }
          } else if (
            isLegacyGameplayItemType(selected.item) &&
            isGameplayIgnitionItem(selected.item)
          ) {
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
                kind: 'ignition',
                slotIndex: selectedHotbarIndex,
                heldItem: selected.item,
              })
            }
          } else {
            shouldAttemptPlacement = true
          }
        }

        if (shouldAttemptPlacement) {
          placementAudio.request()
          requestPlacementFromSelectedSlot(
            inventoryBeforeUse.slots,
            selectedHotbarIndex,
            isPlaceableGameplayItem,
            (heldItem) => {
              if (multiplayer !== undefined) {
                const target = Effect.runSync(
                  requestTargetedBlockPlacement(
                    gameplayState,
                    currentChunkStore,
                    playerApi,
                    heldItem,
                  ),
                )
                Effect.runSync(Ref.set(gameplayState.pendingPlacements, []))
                if (Option.isSome(target)) {
                  Effect.runSync(multiplayer.host.enqueueOutbound({
                    _tag: 'BlockPlace',
                    player: multiplayer.query.player,
                    world: WorldId.make(Effect.runSync(playerApi.dimension)),
                    at: target.value.adjacentPosition,
                    block: heldItem,
                  }))
                  placementsRequested += 1
                  placementAudio.request(target.value.adjacentPosition)
                  canvas.setAttribute('data-placements-requested', String(placementsRequested))
                }
                return
              }
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
                  placementAudio.request(target.value.adjacentPosition)
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
    for (const item of consumedPlacements) {
      if (isCreativeMode) {
        Effect.runSync(world.inventory.add(item, 1))
      } else {
        const selected = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]
        if (selected?.item === item) {
          Effect.runSync(world.inventory.removeAt(selectedHotbarIndex, item, 1))
        }
      }
    }
    placementAudio.confirm(consumedPlacements)
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
    for (const transition of Effect.runSync(redstoneRuntime.drainPistonTransitions)) {
      applyPoweredPistonTransition(transition)
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
      if (pending === undefined || !result.success) continue

      if (!('action' in result) && pending.kind === 'ignition' && pending.heldItem === result.heldItem) {
        if (result.heldItem === 'fire_charge') {
          Effect.runSync(world.inventory.removeAt(pending.slotIndex, pending.heldItem, 1))
        } else if (Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]?.item === 'flint_and_steel') {
          Effect.runSync(world.inventory.damageAt({ _tag: 'Inventory', slotIndex: pending.slotIndex }, 1))
        }
      } else if ('action' in result) {
        switch (result.action) {
          case 'TillSoil':
            if (
              pending.kind === 'till'
              && pending.heldItem === result.heldItem
              && Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]?.item === result.heldItem
            ) {
              Effect.runSync(
                world.inventory.damageAt(
                  { _tag: 'Inventory', slotIndex: pending.slotIndex },
                  result.durabilityDamage,
                ),
              )
            }
            break
          case 'PlantPotato':
            if (pending.kind === 'plant' && result.outcome._tag === 'planted') {
              const planted = Effect.runSync(crops.plant({
                dimension: pending.dimension,
                position: result.outcome.at as CropLocation['position'],
              }))
              if (planted) {
                Effect.runSync(
                  world.inventory.removeAt(pending.slotIndex, 'potato', result.consumedCount),
                )
              }
            }
            break
          case 'HarvestPotato':
            if (pending.kind === 'harvest' && result.outcome._tag === 'drops') {
              const at = {
                x: pending.position.x + 0.5,
                y: pending.position.y + 0.5,
                z: pending.position.z + 0.5,
              }
              const leftovers = result.outcome.drops.flatMap((drop) => {
                const leftover = Effect.runSync(world.inventory.add(drop.item, drop.count))
                return leftover > 0 ? [{ item: drop.item, count: leftover }] : []
              })
              if (leftovers.length > 0) {
                Effect.runSync(spawnDroppedItems(world.entities, leftovers.map((stack) => ({ ...stack, at }))))
              }
            }
            break
          case 'EatPotato':
            if (pending.kind === 'eat' && result.outcome._tag === 'consume') {
              const removal = Effect.runSync(
                world.inventory.removeAt(pending.slotIndex, 'potato', result.consumedCount),
              )
              if (removal._tag === 'Removed') {
                Effect.runSync(
                  world.vitals.eat(
                    result.outcome.foodPoints,
                    result.outcome.saturationModifier,
                  ),
                )
              }
            }
            break
        }
      }
      markSessionDirty()
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
    renderCrosshair(nowSecs)
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
    fpsValue.textContent = String(Math.round(Effect.runSync(Ref.get(uiFrameState.fpsCounter)).fps))

    // Readable by a test without a QA command: the frame count IS the claim
    // that the loop is running, and docs/e2e-triage.md #4 is exactly that claim.
    document.body.setAttribute('data-frames', String(framesTotal))

  }

  const preview = Effect.runSync(makeBrowserPreview({
    container: gameShell,
    canvas,
    startRuntime: (surface) => Effect.sync(() => {
      surface.onCleanup(() => {
        Reflect.deleteProperty(globalThis, QA_GLOBAL_KEY)
        document.body.setAttribute('data-mc-compose-boot', 'stopped')
      })
      return {
        frame: () => Effect.sync(tick),
        stop: Effect.sync(() => {
          requestBackgroundFlush()
          disposeMultiplayer()
          settingsView.dispose()
          audio.close()
        }),
      }
    }),
  }))
  const previewHandle = await Effect.runPromise(preview.start)
  stopBrowserPreview = () => Effect.runPromise(previewHandle.stop)
}

const boot = (): Promise<void> => {
  const route = readSessionRoute(window.location.search)
  if (route === undefined) return bootTitle()
  return bootGame(route.sessionId, route.kind === 'create' ? route.metadata : undefined)
}

boot().catch((error: unknown) => {
  failBoot('boot threw', error)
})
