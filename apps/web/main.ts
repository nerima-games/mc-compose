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
  makeEndAudioController,
  makeWeatherAudioController,
  makeWebAudioBackend,
  type EndAudioEvent,
  type WeatherAudioHandle,
  type WeatherLoopKind,
  type Vec3,
} from '@nerima-games/mc-audio'
import { blockIdOf, blockTypeOfId, capabilityOfBlockId, propertyOfBlockId } from '@nerima-games/mc-kernel'
import { indexedDbStorageLayer } from '@nerima-games/mc-save'
import {
  addExperience as addVitalsExperience,
  advanceFurnace,
  containerIdAt,
  emptyFurnaceState,
  itemStack,
  makeCropService,
  makeSimFrameState,
  makeTimeService,
  makeWeatherService,
  maxStackCountForItem,
  totalExperienceAtLevel,
  POTATO_MATURITY_SECS,
  resetLandingImpact,
  simStages,
  STARTER_FUEL_RULES,
  STARTER_SMELTING_RECIPES,
  targetBlockFromPlayerPose,
  type FurnaceState,
  type CropLocation,
  type ItemStack,
  type SimPhysicsConfig,
  type WeatherState,
} from '@nerima-games/mc-sim'
import {
  biomeFor,
  blockPosition,
  chunkCoord,
  chunkSnapshotOf,
  DEFAULT_TERRAIN_LEVELS,
  detectCompletedEndPortal,
  END_PORTAL_BLOCK,
  END_PORTAL_FRAME_OFFSETS,
  endArrivalDescriptor,
  endPortalCenterForStronghold,
  generatedChunkSource,
  nearestStrongholdSite,
  surfaceHeightAt,
  villageVillagerSpawnsForChunk,
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
  createAnvilView,
  createChestStorageView,
  createEnchantingTableView,
  createMainMenuView,
  createCrosshairView,
  createFurnaceView,
  createHudView,
  createInventoryView,
  crosshairViewModel,
  furnaceViewModel,
  anvilViewModel,
  enchantingTableViewModel,
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
  addVillager,
  advanceMiningProgress,
  applyEnchantmentOffer,
  applyArmorToDamage,
  armorPointsForEquipment,
  armorDurabilityWearFromPreMitigationDamage,
  CREEPER_KIND,
  drainBlockUseResults,
  drainBowShotResults,
  drainItemUseResults,
  drainMeleeAttackResults,
  drainMobDrops,
  drainMobExperience,
  drainPortalTravels,
  drainPlayerDamages,
  drainPlayerHeals,
  drainVillagerTradeResults,
  enchantmentOffers,
  DEFAULT_BLOCK_REACH,
  EYE_LEVEL_OFFSET,
  emptyBrewingStandState,
  emptyStatusEffectState,
  gameplayStages,
  getPlayerMovementSpeedMultiplier,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  makeGameplayFrameState,
  makeVillager,
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
  requestVillagerTrade,
  resolveBedSleep,
  resolveEnvironmentalContactDamage,
  resolveFallDamage,
  resolveTargetedPrimaryAttack,
  restoreVillagerTrades,
  restoreBrewingStand,
  restoreStatusEffects,
  setPortalCandidates,
  solidityFromStore,
  spawnDroppedItems,
  spawnMobDrops,
  snapshotVillagerTrades,
  snapshotBrewingStand,
  snapshotStatusEffects,
  collectBrewingPotion,
  targetedRightClickRoute,
  useBrewingPotion,
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
  type VillagerTradeResult,
  type BrewingBottle,
  type BrewingIngredient,
  type EnchantedItem,
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
  normalizePersistedEntityRoster,
  SESSION_FORMAT_VERSION,
  snapshotResidentChunks,
  type DimensionChunk,
  type PersistedFurnaceState,
  type PersistedLeverState,
  type PersistedPortalState,
  type PersistedEndPortalFrameState,
  type PersistedVillager,
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

type InventoryMode = 'player' | 'craftingTable' | 'furnace' | 'chest' | 'anvil' | 'enchanting'

const INVENTORY_PRESENTATIONS = {
  player: { label: 'Inventory', width: 2, height: 2 },
  craftingTable: { label: 'Crafting Table', width: 3, height: 3 },
  furnace: { label: 'Furnace', width: 0, height: 0 },
  chest: { label: 'Chest', width: 0, height: 0 },
  anvil: { label: 'Anvil', width: 0, height: 0 },
  enchanting: { label: 'Enchanting Table', width: 0, height: 0 },
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
  const multiplayerJoin = requireElement('multiplayer-join')
  const multiplayerWorld = requireElement('multiplayer-world')
  const multiplayerName = requireElement('multiplayer-name')
  const multiplayerPlayer = requireElement('multiplayer-player')
  const multiplayerUrl = requireElement('multiplayer-url')
  const multiplayerJoinButton = requireElement('multiplayer-join-button')
  if (!(multiplayerJoin instanceof HTMLFormElement)
    || !(multiplayerWorld instanceof HTMLSelectElement)
    || !(multiplayerName instanceof HTMLInputElement)
    || !(multiplayerPlayer instanceof HTMLInputElement)
    || !(multiplayerUrl instanceof HTMLInputElement)
    || !(multiplayerJoinButton instanceof HTMLButtonElement)) {
    throw new Error('index.html has invalid multiplayer join controls')
  }
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
  multiplayerWorld.replaceChildren(...savedWorlds.map(({ sessionId, name }) => {
    const option = document.createElement('option')
    option.value = sessionId
    option.textContent = name
    return option
  }))
  multiplayerPlayer.value = `player-${crypto.randomUUID().slice(0, 8)}`
  multiplayerJoinButton.disabled = savedWorlds.length === 0
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
  multiplayerJoin.addEventListener('submit', (event) => {
    event.preventDefault()
    if (titleNavigationPending || !multiplayerJoin.reportValidity()) return
    const player = multiplayerPlayer.value.trim()
    const name = multiplayerName.value.trim()
    if (player.length === 0 || name.length === 0) {
      titleStatus.textContent = 'Player name and ID cannot be blank.'
      return
    }
    let url: URL
    try {
      url = new URL(multiplayerUrl.value)
    } catch {
      titleStatus.textContent = 'Enter a valid multiplayer server URL.'
      return
    }
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
      titleStatus.textContent = 'Multiplayer server must use ws:// or wss://.'
      return
    }
    const href = new URL(sessionHref(multiplayerWorld.value), window.location.origin)
    href.searchParams.set('multiplayer', url.href)
    href.searchParams.set('player', player)
    href.searchParams.set('multiplayerName', name)
    void navigateAfterSettingsSaved(`${href.pathname}${href.search}`)
  })
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
  const name = query.get('multiplayerName')
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
  const tradeParent = requireElement('trade-root')
  const brewingParent = requireElement('brewing-root')
  const touchControlsParent = requireElement('touch-controls')
  const touchLookSurface = requireElement('touch-look-surface')
  const fpsValue = requireElement('fps-value')
  const multiplayerStatus = requireElement('multiplayer-status')
  const multiplayerChat = requireElement('multiplayer-chat')
  const multiplayerChatLog = requireElement('multiplayer-chat-log')
  const multiplayerChatForm = requireElement('multiplayer-chat-form')
  const multiplayerChatInput = requireElement('multiplayer-chat-input')
  if (!(multiplayerStatus instanceof HTMLOutputElement)
    || !(multiplayerChat instanceof HTMLElement)
    || !(multiplayerChatLog instanceof HTMLOListElement)
    || !(multiplayerChatForm instanceof HTMLFormElement)
    || !(multiplayerChatInput instanceof HTMLInputElement)) {
    throw new Error('index.html has invalid multiplayer game controls')
  }
  fpsValue.setAttribute('data-fps-source', 'mx-ui-frame-dt')
  const stageList = requireElement('stage-order')
  let inventoryOpen = false
  let tradeOpen = false
  let brewingOpen = false
  let brewingStatus = ''
  let activeVillagerId: string | undefined
  let tradeStatus = ''
  let nextVillagerTradeRequestId = 0
  let inventoryMode: InventoryMode = 'player'
  let enchantmentSeed = WORLD_SEED
  const customNames = new Map<string, string>()
  const enchantedItems = new Map<string, EnchantedItem>()
  let respawnLocation: Vec3 | null = null
  let anvilName = ''
  let anvilStatus = ''
  let enchantingStatus = ''
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
    allowsPointerLock: () => !inventoryOpen && !tradeOpen && !brewingOpen && !paused,
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
    if (inventoryOpen || tradeOpen || brewingOpen || document.pointerLockElement === canvas) {
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
  const restoredWorkstations = Option.isSome(loadedSession)
    ? loadedSession.value.state.workstations
    : undefined
  for (const [slot, name] of Object.entries(restoredWorkstations?.customNames ?? {})) {
    customNames.set(slot, name)
  }
  for (const [slot, encoded] of Object.entries(restoredWorkstations?.enchantedItems ?? {})) {
    try {
      enchantedItems.set(slot, JSON.parse(encoded) as EnchantedItem)
    } catch {
      // Ignore a malformed optional workstation entry without losing the world save.
    }
  }
  respawnLocation = restoredWorkstations?.respawn ?? null
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
  enchantmentSeed = restoredWorkstations?.enchantmentSeed ?? activeSeed

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
    await Effect.runPromise(
      world.entities.restore(
        normalizePersistedEntityRoster(loadedSession.value.state.entities) as Parameters<
          typeof world.entities.restore
        >[0],
      ),
    )
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
  const gameplayState = await Effect.runPromise(makeGameplayFrameState)
  const villagerResidents = new Map<string, PersistedVillager>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.villagers.residents : [])
      .map((villager) => [villager.id, villager]),
  )
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(time.restore(loadedSession.value.state.time))
    await Effect.runPromise(weather.restore(loadedSession.value.state.weather))
    await Effect.runPromise(crops.restore(loadedSession.value.state.crops))
    await Effect.runPromise(restoreVillagerTrades(
      gameplayState,
      loadedSession.value.state.villagers.trades,
    ))
    await Effect.runPromise(restoreBrewingStand(gameplayState, loadedSession.value.state.brewing))
    await Effect.runPromise(restoreStatusEffects(gameplayState, loadedSession.value.state.statusEffects))
    await Effect.runPromise(gameplayState.enderDragonEncounter.restore(loadedSession.value.state.end.dragon))
  }
  const loadedEndState = Option.isSome(loadedSession) ? loadedSession.value.state.end : undefined
  const endPortalFrameKey = (position: SessionPosition): string =>
    `${String(position.x)},${String(position.y)},${String(position.z)}`
  const endPortalFrames = new Map<string, PersistedEndPortalFrameState>(
    (loadedEndState?.frames ?? []).map((frame) => [endPortalFrameKey(frame.position), frame]),
  )
  let endPortalComplete = loadedEndState?.portalComplete ?? false
  let exitPortalMaterialized = loadedEndState?.exitPortalMaterialized ?? false
  let dragonEggRewarded = loadedEndState?.dragonEggRewarded ?? false
  const endDragonPosition = (): SessionPosition => {
    const dragon = Effect.runSync(gameplayState.enderDragonEncounter.snapshot)
    const angle = dragon.phaseTimerSecs * (dragon.phase === 'charging' ? 1.4 : 0.35)
    const radius = dragon.phase === 'perching' ? 4 : dragon.phase === 'charging' ? 8 : 20
    return {
      x: Math.cos(angle) * radius,
      y: dragon.phase === 'perching' ? 68 : 76,
      z: Math.sin(angle) * radius,
    }
  }

  const presentWeather = (state: WeatherState): void => {
    canvas.setAttribute('data-weather', state.weather)
    canvas.setAttribute('data-weather-remaining-secs', String(state.remainingSecs))
  }
  presentWeather(Effect.runSync(weather.snapshot))

  const weatherDaylight = (timeOfDay: number): number =>
    Math.max(0.08, Math.sin(Math.PI * 2 * (timeOfDay - 0.25)))

  const presentWeatherRuntime = (
    state: WeatherState,
    pose: { readonly feetPosition: Vec3 },
    nowSecs: number,
  ): void => {
    const timeState = Effect.runSync(time.snapshot)
    const lightningSequence = state.weather === 'thunder'
      ? Math.floor(timeState.ticks / (60 * 8))
      : undefined
    const intensity = state.weather === 'clear' ? 0 : 1
    const camera = {
      x: pose.feetPosition.x,
      y: pose.feetPosition.y + EYE_LEVEL_OFFSET,
      z: pose.feetPosition.z,
    }
    const renderPlan = Effect.runSync(worldRenderer.weather.frame({
      mode: state.weather,
      intensity,
      daylight: weatherDaylight(Effect.runSync(time.timeOfDay)),
      temperature: 1,
      seed: activeSeed,
      lightningSequence,
    }, camera))
    const thunder = lightningSequence === undefined
      ? undefined
      : {
          id: `weather-thunder-${String(lightningSequence)}`,
          occurredAtSecs: nowSecs,
          position: { x: camera.x + 24, y: camera.y + 12, z: camera.z + 12 },
        }
    weatherAudio.update({
      mode: state.weather,
      intensity,
      listener: camera,
      listenerForward: readAudioListenerForward(),
      occlusion: 0,
      thunder,
    })
    canvas.setAttribute('data-weather-particles', String(renderPlan.particles.length))
    canvas.setAttribute('data-weather-lightning', String(renderPlan.lightningFlash > 0))
    canvas.setAttribute('data-weather-audio-mode', weatherAudio.state().mode)
  }

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
      entities: Effect.runSync(world.entities.snapshot),
      villagers: {
        residents: [...villagerResidents.values()],
        trades: Effect.runSync(snapshotVillagerTrades(gameplayState)),
      },
      brewing: Effect.runSync(snapshotBrewingStand(gameplayState)),
      statusEffects: Effect.runSync(snapshotStatusEffects(gameplayState)),
      end: {
        frames: [...endPortalFrames.values()],
        portalComplete: endPortalComplete,
        dragon: Effect.runSync(gameplayState.enderDragonEncounter.snapshot),
        exitPortalMaterialized,
        dragonEggRewarded,
      },
      workstations: {
        enchantmentSeed,
        customNames: Object.fromEntries(customNames),
        enchantedItems: Object.fromEntries(
          [...enchantedItems].map(([slot, item]) => [slot, JSON.stringify(item)]),
        ),
        respawn: respawnLocation,
      },
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
        if (context.dimension === 'overworld') {
          let trades = yield* snapshotVillagerTrades(gameplayState)
          let discovered = false
          for (const spawn of villageVillagerSpawnsForChunk(
            activeSeed,
            chunk.cx,
            chunk.cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(activeSeed, x, z)
              return {
                biome: biomeFor(activeSeed, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )) {
            if (!villagerResidents.has(spawn.id)) {
              villagerResidents.set(spawn.id, {
                id: spawn.id,
                profession: spawn.profession,
                dimension: 'overworld',
                feetPosition: { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 },
              })
              discovered = true
            }
            if (!trades.villagers.some((villager) => villager.id === spawn.id)) {
              trades = addVillager(trades, makeVillager(spawn.id, spawn.profession))
              discovered = true
            }
          }
          if (discovered) {
            yield* restoreVillagerTrades(gameplayState, trades)
            markSessionDirty()
          }
        }
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
  let lastPlayerMoveSent: {
    readonly world: WorldId
    readonly at: { readonly x: number; readonly y: number; readonly z: number }
    readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
  } | undefined
  multiplayerStatus.hidden = multiplayer === undefined
  multiplayerStatus.textContent = multiplayer === undefined ? '' : 'Connecting to multiplayer server...'
  multiplayerChat.hidden = multiplayer === undefined
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
        if (message.player === multiplayer.query.player) {
          const world = message.world ?? WorldId.make(Effect.runSync(playerApi.dimension))
          const dimension = dimensionFromWorld(world)
          if (dimension !== undefined) {
            Effect.runSync(playerApi.restore({
              feetPosition: message.at,
              yawRadians: message.facing.yawRadians,
              pitchRadians: message.facing.pitchRadians,
            }, dimension))
            lastPlayerMoveSent = { world, at: message.at, facing: message.facing }
            lastPlayerMoveSentAt = performance.now() / 1_000
            multiplayerStatus.textContent = 'Movement corrected by server.'
            multiplayerStatus.hidden = false
          }
          break
        }
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
      case 'Chat': {
        const row = document.createElement('li')
        const sender = message.player === multiplayer.query.player
          ? multiplayer.query.name
          : multiplayer.players.get(message.player)?.name ?? message.player
        row.textContent = `<${String(sender)}> ${message.text}`
        multiplayerChatLog.append(row)
        while (multiplayerChatLog.childElementCount > 50) {
          multiplayerChatLog.firstElementChild?.remove()
        }
        break
      }
      default:
        break
    }
    canvas.setAttribute('data-multiplayer-player-count', String(multiplayer.players.size + 1))
    canvas.setAttribute('data-multiplayer-revision', String(multiplayerRevision))
    canvas.setAttribute('data-multiplayer-rejection', multiplayerRejection)
  }

  multiplayerChatForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = multiplayerChatInput.value.trim()
    if (multiplayer === undefined || !multiplayerHandshakeComplete || text.length === 0) return
    Effect.runSync(multiplayer.host.enqueueOutbound({
      _tag: 'Chat',
      player: multiplayer.query.player,
      text: text.slice(0, 256),
    }))
    multiplayerChatInput.value = ''
  })
  for (const eventName of ['keydown', 'keyup'] as const) {
    multiplayerChatInput.addEventListener(eventName, (event) => event.stopPropagation())
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
  const anvilView = createAnvilView(document, inventoryParent)
  const enchantingView = createEnchantingTableView(document, inventoryParent)
  const crosshair = createCrosshairView(document, hudParent, motion)
  const statusEffectsHud = document.createElement('div')
  statusEffectsHud.id = 'status-effects-hud'
  statusEffectsHud.dataset['testid'] = 'status-effects'
  hudParent.append(statusEffectsHud)

  inventoryParent.setAttribute('role', 'dialog')
  inventoryParent.setAttribute('aria-label', 'Inventory')
  inventoryParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-inventory-open', 'false')
  tradeParent.setAttribute('role', 'dialog')
  tradeParent.setAttribute('aria-label', 'Villager trading')
  tradeParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-trade-open', 'false')
  brewingParent.setAttribute('role', 'dialog')
  brewingParent.setAttribute('aria-label', 'Brewing stand')
  brewingParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-brewing-open', 'false')

  const renderTradeUi = (): void => {
    const trades = Effect.runSync(snapshotVillagerTrades(gameplayState))
    const villager = trades.villagers.find((candidate) => candidate.id === activeVillagerId)
    if (!tradeOpen || villager === undefined) {
      tradeParent.replaceChildren()
      return
    }
    const title = document.createElement('h2')
    title.textContent = villager.profession === 'farmer' ? 'Farmer' : 'Toolsmith'
    const offers = document.createElement('div')
    offers.className = 'trade-offers'
    for (const offer of villager.offers) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset['tradeOfferId'] = offer.id
      button.disabled = offer.uses >= offer.maxUses
      button.textContent = `${String(offer.input.count)} ${offer.input.item} -> ${String(offer.output.count)} ${offer.output.item} (${String(offer.uses)}/${String(offer.maxUses)})`
      offers.append(button)
    }
    const status = document.createElement('p')
    status.className = 'trade-status'
    status.setAttribute('role', 'status')
    status.textContent = tradeStatus
    const close = document.createElement('button')
    close.type = 'button'
    close.dataset['tradeClose'] = 'true'
    close.textContent = 'Close'
    tradeParent.replaceChildren(title, offers, status, close)
  }

  const villagerTradeStatus = (result: VillagerTradeResult): string => {
    if (result._tag === 'Traded') return 'Trade complete'
    switch (result.reason) {
      case 'UnknownOffer': return 'That offer is no longer available'
      case 'OutOfStock': return 'This offer is out of stock'
      case 'InsufficientItems': return 'You do not have the required items'
      case 'InventoryFull': return 'Your inventory is full'
    }
  }

  const setTradeOpen = (open: boolean, villagerId?: string): void => {
    if (open && (playerIsDead() || villagerId === undefined)) return
    if (open && brewingOpen) setBrewingOpen(false)
    tradeOpen = open
    activeVillagerId = open ? villagerId : undefined
    tradeStatus = ''
    tradeParent.hidden = !open
    tradeParent.setAttribute('aria-hidden', String(!open))
    document.body.setAttribute('data-trade-open', String(open))
    renderTradeUi()
    renderCrosshair()
    syncTouchControls()
    if (open && document.pointerLockElement === canvas) document.exitPointerLock()
  }

  tradeParent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest('[data-trade-close]') !== null) {
      setTradeOpen(false)
      return
    }
    const button = event.target.closest<HTMLElement>('[data-trade-offer-id]')
    const offerId = button?.dataset['tradeOfferId']
    if (activeVillagerId === undefined || offerId === undefined) return
    nextVillagerTradeRequestId += 1
    Effect.runSync(requestVillagerTrade(gameplayState, {
      requestId: `villager-trade-${String(nextVillagerTradeRequestId)}`,
      villagerId: activeVillagerId,
      offerId,
    }))
    tradeStatus = 'Trading...'
    renderTradeUi()
  })

  const brewingBottleFromItem = (item: string): BrewingBottle | undefined => {
    if (item === 'water_bottle') return item
    if (item === 'awkward_potion') return { potion: 'awkward' }
    if (item === 'potion_of_swiftness') return { potion: 'speed' }
    if (item === 'potion_of_poison') return { potion: 'poison' }
    if (item === 'potion_of_regeneration') return { potion: 'regeneration' }
    return undefined
  }

  const brewingBottleLabel = (bottle: BrewingBottle | undefined): string => {
    if (bottle === undefined) return 'Empty'
    if (bottle === 'water_bottle') return 'Water bottle'
    return bottle.potion === 'speed' ? 'Potion of swiftness' : `${bottle.potion} potion`
  }

  const renderBrewingUi = (): void => {
    if (!brewingOpen) {
      brewingParent.replaceChildren()
      return
    }
    const state = Effect.runSync(snapshotBrewingStand(gameplayState))
    let summary = brewingParent.querySelector<HTMLElement>('[data-testid="brewing-state"]')
    let progress = brewingParent.querySelector<HTMLElement>('[data-testid="brewing-progress"]')
    let status = brewingParent.querySelector<HTMLElement>('.brewing-status')
    if (summary === null || progress === null || status === null) {
      const title = document.createElement('h2')
      title.textContent = 'Brewing Stand'
      summary = document.createElement('p')
      summary.dataset['testid'] = 'brewing-state'
      progress = document.createElement('p')
      progress.dataset['testid'] = 'brewing-progress'
      const insert = document.createElement('button')
      insert.type = 'button'
      insert.dataset['brewingAction'] = 'insert'
      insert.textContent = 'Insert selected item'
      const collect = document.createElement('button')
      collect.type = 'button'
      collect.dataset['brewingAction'] = 'collect'
      collect.textContent = 'Collect bottle'
      const drink = document.createElement('button')
      drink.type = 'button'
      drink.dataset['brewingAction'] = 'drink'
      drink.textContent = 'Drink potion'
      const close = document.createElement('button')
      close.type = 'button'
      close.dataset['brewingAction'] = 'close'
      close.textContent = 'Close'
      status = document.createElement('p')
      status.className = 'brewing-status'
      status.setAttribute('role', 'status')
      brewingParent.replaceChildren(title, summary, progress, insert, collect, drink, close, status)
    }
    summary.textContent = `Fuel: ${String(state.fuelUnits)} | Bottle: ${brewingBottleLabel(state.bottle)} | Ingredient: ${state.ingredient ?? 'Empty'}`
    progress.textContent = state.brewing === undefined
      ? 'Idle'
      : `Brewing ${state.brewing.output}: ${state.brewing.remainingSecs.toFixed(1)}s`
    status.textContent = brewingStatus
  }

  const setBrewingOpen = (open: boolean): void => {
    if (open && playerIsDead()) return
    if (open && tradeOpen) setTradeOpen(false)
    if (open && inventoryOpen) setInventoryOpen(false)
    brewingOpen = open
    brewingStatus = ''
    brewingParent.hidden = !open
    brewingParent.setAttribute('aria-hidden', String(!open))
    document.body.setAttribute('data-brewing-open', String(open))
    renderBrewingUi()
    renderCrosshair()
    syncTouchControls()
    if (open && document.pointerLockElement === canvas) document.exitPointerLock()
  }

  brewingParent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const action = event.target.closest<HTMLElement>('[data-brewing-action]')
      ?.dataset['brewingAction']
    if (action === undefined) return
    if (action === 'close') {
      setBrewingOpen(false)
      return
    }
    if (action === 'insert') {
      const selected = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]
      if (selected === undefined) {
        brewingStatus = 'Select brewing fuel, a bottle, or an ingredient'
        renderBrewingUi()
        return
      }
      const bottle = brewingBottleFromItem(selected.item)
      const ingredients: ReadonlySet<string> = new Set([
        'nether_wart', 'sugar', 'spider_eye', 'ghast_tear',
      ])
      if (selected.item !== 'blaze_powder' && bottle === undefined && !ingredients.has(selected.item)) {
        brewingStatus = 'That item cannot be used for brewing'
        renderBrewingUi()
        return
      }
      const removal = Effect.runSync(
        world.inventory.removeAt(selectedHotbarIndex, selected.item, 1),
      )
      if (removal._tag !== 'Removed' || removal.removed !== 1) {
        brewingStatus = 'The selected item is no longer available'
        renderBrewingUi()
        return
      }
      const result = selected.item === 'blaze_powder'
        ? Effect.runSync(insertBrewingFuel(gameplayState))
        : bottle !== undefined
          ? Effect.runSync(insertBrewingBottle(gameplayState, bottle))
          : Effect.runSync(insertBrewingIngredient(gameplayState, selected.item as BrewingIngredient))
      if (result._tag === 'Rejected') {
        const leftover = Effect.runSync(world.inventory.add(selected.item, 1))
        if (leftover !== 0) throw new Error('Failed to restore rejected brewing item')
        brewingStatus = `Cannot insert item: ${result.reason}`
      } else {
        brewingStatus = `Inserted ${selected.item}`
        markSessionDirty()
      }
      renderBrewingUi()
      renderPlayerUi()
      return
    }
    if (action === 'collect') {
      const result = Effect.runSync(collectBrewingPotion(gameplayState))
      if (result._tag === 'Rejected') {
        brewingStatus = `Cannot collect bottle: ${result.reason}`
      } else {
        const leftover = Effect.runSync(world.inventory.add(result.returned.item, 1))
        if (leftover === 0) {
          brewingStatus = `Collected ${result.returned.item}`
          markSessionDirty()
        } else {
          const bottle = brewingBottleFromItem(result.returned.item)
          if (bottle === undefined) throw new Error('Collected an invalid brewing bottle')
          const restored = Effect.runSync(insertBrewingBottle(gameplayState, bottle))
          if (restored._tag !== 'Accepted') throw new Error('Failed to restore uncollected potion')
          brewingStatus = 'Inventory is full'
        }
      }
      renderBrewingUi()
      renderPlayerUi()
      return
    }
    if (action === 'drink') {
      const result = Effect.runSync(useBrewingPotion(gameplayState))
      brewingStatus = result._tag === 'Consumed'
        ? `Drank ${result.consumed.item}`
        : `Cannot drink bottle: ${result.reason}`
      if (result._tag === 'Consumed') markSessionDirty()
      renderBrewingUi()
      renderPlayerUi()
    }
  })

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
      modals: paused ? ['pause'] : inventoryOpen || tradeOpen || brewingOpen ? ['inventory'] : [],
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
  const targetedBrewingStand = (): Effect.Effect<boolean> => Effect.gen(function* () {
    const pose = yield* playerApi.pose
    const candidates: Array<{ x: number; y: number; z: number }> = []
    const visited = new Set<string>()
    const coordinateKey = (x: number, y: number, z: number): string => `${x},${y},${z}`
    targetBlockFromPlayerPose(pose, DEFAULT_BLOCK_REACH, (x, y, z) => {
      const key = coordinateKey(x, y, z)
      if (!visited.has(key)) {
        visited.add(key)
        candidates.push({ x, y, z })
      }
      return false
    })
    const targetable = new Set<string>()
    for (const position of candidates) {
      const reading = yield* currentChunkStore.getBlock(position)
      if (reading._tag === 'Block' && reading.block !== 0) {
        targetable.add(coordinateKey(position.x, position.y, position.z))
        break
      }
    }
    const target = targetBlockFromPlayerPose(
      pose,
      DEFAULT_BLOCK_REACH,
      (x, y, z) => targetable.has(coordinateKey(x, y, z)),
    )
    if (Option.isNone(target)) return false
    const reading = yield* currentChunkStore.getBlock(target.value.position)
    return reading._tag === 'Block' && blockTypeOfId(reading.block) === 'brewing_stand'
  })
  const targetedBlock = (): Effect.Effect<{
    readonly position: SessionPosition
    readonly block: number
  } | undefined> => Effect.gen(function* () {
    const pose = yield* playerApi.pose
    const candidates: SessionPosition[] = []
    const visited = new Set<string>()
    targetBlockFromPlayerPose(pose, DEFAULT_BLOCK_REACH, (x, y, z) => {
      const key = `${String(x)},${String(y)},${String(z)}`
      if (!visited.has(key)) {
        visited.add(key)
        candidates.push({ x, y, z })
      }
      return false
    })
    for (const position of candidates) {
      const reading = yield* currentChunkStore.getBlock(position)
      if (reading._tag === 'Block' && reading.block !== 0) return { position, block: reading.block }
    }
    return undefined
  })

  const materializeEndArrival = (): Effect.Effect<void> => Effect.gen(function* () {
    const arrival = endArrivalDescriptor(blockPosition(0, 64, 0))
    const context = getOrCreateDimensionChunkContext('end')
    const mutations = [...arrival.platform, ...arrival.clear.map((at) => ({ at, block: 0 }))]
    const chunks = new Map<string, ChunkRef>()
    for (const mutation of mutations) {
      const chunk = { cx: Math.floor(mutation.at.x / 16), cz: Math.floor(mutation.at.z / 16) }
      chunks.set(chunkKeyOf(chunk), chunk)
    }
    for (const [key, chunk] of chunks) {
      if (!context.streamLoaded.has(key)) {
        yield* context.chunkStore.load(chunk)
        context.streamLoaded.add(key)
      }
    }
    for (const mutation of mutations) yield* context.chunkStore.setBlock(mutation.at, mutation.block)
    const pose = yield* playerApi.pose
    yield* playerApi.restore({ ...pose, feetPosition: arrival.spawn, yawRadians: Math.PI }, 'end')
    alignActiveDimension('end')
    resetSimState(true)
    markSessionDirty()
  })

  const useEndFeature = (): Effect.Effect<boolean> => Effect.gen(function* () {
    const dimension = yield* playerApi.dimension
    const pose = yield* playerApi.pose
    const target = yield* targetedBlock()
    if (dimension === 'end' && exitPortalMaterialized && target?.block === END_PORTAL_BLOCK.PORTAL) {
      yield* playerApi.restore({ ...pose, feetPosition: { x: 0.5, y: 80, z: 0.5 } }, 'overworld')
      alignActiveDimension('overworld')
      resetSimState(true)
      queueEndAudio('exitPortal', pose.feetPosition)
      markSessionDirty()
      return true
    }
    if (dimension === 'overworld' && endPortalComplete && target?.block === END_PORTAL_BLOCK.PORTAL) {
      yield* materializeEndArrival()
      queueEndAudio('portalActivate', target.position)
      return true
    }
    const inventory = yield* world.inventory.snapshot
    const selected = inventory.slots[selectedHotbarIndex]
    if (dimension !== 'overworld' || selected?.item !== 'eye_of_ender') return false
    const site = nearestStrongholdSite(activeSeed, pose.feetPosition.x, pose.feetPosition.z)
    if (Option.isNone(site)) return false
    const center = endPortalCenterForStronghold(site.value)
    const offset = target === undefined ? undefined : END_PORTAL_FRAME_OFFSETS.find((candidate) =>
      center.x + candidate.dx === target.position.x
      && center.y === target.position.y
      && center.z + candidate.dz === target.position.z)
    if (target?.block === END_PORTAL_BLOCK.FRAME_EMPTY && offset !== undefined) {
      yield* currentChunkStore.setBlock(target.position, END_PORTAL_BLOCK.FRAME_FILLED)
      endPortalFrames.set(endPortalFrameKey(target.position), {
        position: target.position,
        facing: offset.facing,
        eye: true,
      })
      if (!isCreativeMode) yield* world.inventory.removeAt(selectedHotbarIndex, 'eye_of_ender', 1)
      queueEndAudio('frameInsert', target.position)
      canvas.setAttribute('data-end-portal-progress', String(endPortalFrames.size))
      const completed = detectCompletedEndPortal((x, y, z) => {
        const frame = endPortalFrames.get(endPortalFrameKey({ x, y, z }))
        return frame === undefined ? undefined : { block: END_PORTAL_BLOCK.FRAME_FILLED, facing: frame.facing }
      }, dimension, center)
      if (Option.isSome(completed)) {
        for (const mutation of completed.value.materialization) {
          yield* currentChunkStore.setBlock(mutation.at, mutation.block)
        }
        endPortalComplete = true
        queueEndAudio('portalActivate', center)
      }
      markSessionDirty()
      return true
    }
    const dx = site.value.x - pose.feetPosition.x
    const dz = site.value.z - pose.feetPosition.z
    canvas.setAttribute('data-stronghold-direction', String(Math.atan2(dx, -dz)))
    canvas.setAttribute('data-stronghold-distance', String(Math.round(Math.hypot(dx, dz))))
    if (!isCreativeMode) yield* world.inventory.removeAt(selectedHotbarIndex, 'eye_of_ender', 1)
    queueEndAudio('eyeThrow', pose.feetPosition)
    markSessionDirty()
    return true
  })
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
      inventoryOpen: inventoryOpen || tradeOpen || brewingOpen,
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
    minimumHealthPoints = 0,
  ): void => {
    if (isCreativeMode) return
    const equipment = Effect.runSync(world.inventory.equipmentSnapshot)
    const reducedDamage = applyArmorToDamage(damage, armorPointsForEquipment(equipment))
    const healthBefore = Effect.runSync(world.vitals.view).healthPoints
    Effect.runSync(world.vitals.damage(reducedDamage))
    const damagedVitals = Effect.runSync(world.vitals.snapshot)
    if (damagedVitals.healthPoints < minimumHealthPoints) {
      Effect.runSync(world.vitals.restore({
        ...damagedVitals,
        healthPoints: minimumHealthPoints,
      }))
    }
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
    const activeEffects = Effect.runSync(snapshotStatusEffects(gameplayState)).effects
    statusEffectsHud.hidden = activeEffects.length === 0
    statusEffectsHud.textContent = activeEffects
      .map((effect) => `${effect.type}: ${Math.ceil(effect.remainingSecs)}s`)
      .join(' | ')
    document.body.setAttribute('data-status-effects', activeEffects
      .map((effect) => `${effect.type}:${Math.ceil(effect.remainingSecs)}`)
      .join(','))
    inventoryView.root.style.setProperty(
      'display', ['furnace', 'chest', 'anvil', 'enchanting'].includes(inventoryMode) ? 'none' : '',
    )
    furnaceView.root.style.setProperty('display', inventoryMode === 'furnace' ? '' : 'none')
    chestView.root.style.setProperty('display', inventoryMode === 'chest' ? '' : 'none')
    anvilView.root.style.setProperty('display', inventoryMode === 'anvil' ? '' : 'none')
    enchantingView.root.style.setProperty('display', inventoryMode === 'enchanting' ? '' : 'none')
    const selectedStack = storage.inventory.slots[selectedHotbarIndex]
    const selectedSlotKey = String(selectedHotbarIndex)
    const selectedSlot = selectedStack == null
      ? undefined
      : { itemId: selectedStack.item, count: selectedStack.count }
    if (inventoryMode === 'anvil') {
      const hasIron = storage.inventory.slots.some(
        (slot) => slot?.item === 'iron_ingot' && slot.count > 0,
      )
      const level = Effect.runSync(world.vitals.view).experienceLevel
      anvilView.render(anvilViewModel({
        primaryInput: selectedSlot,
        secondaryInput: hasIron ? { itemId: 'iron_ingot', count: 1 } : undefined,
        output: selectedStack != null && hasIron && level >= 1 ? selectedSlot : undefined,
        name: anvilName,
        levelCost: 1,
        rejectionReason: selectedStack == null
          ? 'Select an item in the hotbar'
          : !hasIron
            ? 'Requires one iron ingot'
            : level < 1
              ? 'Requires level 1'
              : undefined,
      }), { focusedTarget: 'name', status: anvilStatus })
      return
    }
    if (inventoryMode === 'enchanting') {
      const lapis = storage.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === 'lapis_lazuli' ? slot.count : 0),
        0,
      )
      const item = selectedStack == null
        ? null
        : enchantedItems.get(selectedSlotKey) ?? {
            item: selectedStack.item,
            durability: null,
            enchantments: [],
          }
      const playerLevel = Effect.runSync(world.vitals.view).experienceLevel
      const offers = enchantmentOffers(enchantmentSeed, 15)
      enchantingView.render(enchantingTableViewModel({
        item: selectedSlot,
        lapis: lapis > 0 ? { itemId: 'lapis_lazuli', count: lapis } : undefined,
        offers: offers.map((offer) => {
          const result = applyEnchantmentOffer({
            seed: enchantmentSeed,
            bookshelfCount: 15,
            playerLevel,
            lapis,
            item,
          }, offer)
          return {
            enchantmentId: offer.enchantment.id,
            enchantmentLevel: offer.enchantment.level,
            levelCost: offer.requiredPlayerLevel,
            lapisCost: offer.lapisCost,
            rejectionReason: result.ok ? undefined : result.reason,
          }
        }) as [NonNullable<Parameters<typeof enchantingTableViewModel>[0]['offers'][0]>, NonNullable<Parameters<typeof enchantingTableViewModel>[0]['offers'][1]>, NonNullable<Parameters<typeof enchantingTableViewModel>[0]['offers'][2]>],
      }), { focusedTarget: 'offer-1', status: enchantingStatus })
      return
    }
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

  const removeInventoryItem = (item: ItemStack['item'], count: number): boolean => {
    let remaining = count
    const slots = Effect.runSync(world.inventory.snapshot).slots
    for (let index = 0; index < slots.length && remaining > 0; index += 1) {
      const stack = slots[index]
      if (stack?.item !== item) continue
      const removed = Math.min(stack.count, remaining)
      Effect.runSync(world.inventory.removeAt(index, item, removed))
      remaining -= removed
    }
    return remaining === 0
  }

  const activateAnvilOutput = (): void => {
    const selected = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]
    const vitals = Effect.runSync(world.vitals.snapshot)
    const level = Effect.runSync(world.vitals.view).experienceLevel
    if (selected === undefined || level < 1 || !removeInventoryItem('iron_ingot', 1)) {
      anvilStatus = 'Repair or rename requirements are not met'
      renderPlayerUi()
      return
    }
    const normalizedName = anvilName.trim()
    if (normalizedName.length > 0) customNames.set(String(selectedHotbarIndex), normalizedName)
    else customNames.delete(String(selectedHotbarIndex))
    Effect.runSync(world.vitals.restore(
      addVitalsExperience(vitals, totalExperienceAtLevel(level - 1) - vitals.totalExperience),
    ))
    anvilStatus = normalizedName.length > 0 ? `Renamed to ${normalizedName}` : 'Item repaired'
    document.body.setAttribute('data-anvil-result', anvilStatus)
    markSessionDirty()
    renderPlayerUi()
  }

  const activateEnchantingOffer = (slot: 0 | 1 | 2): void => {
    const selected = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]
    if (selected === undefined) return
    const storage = Effect.runSync(world.inventory.storageSnapshot)
    const lapis = storage.inventory.slots.reduce(
      (count, stack) => count + (stack?.item === 'lapis_lazuli' ? stack.count : 0),
      0,
    )
    const vitals = Effect.runSync(world.vitals.snapshot)
    const playerLevel = Effect.runSync(world.vitals.view).experienceLevel
    const key = String(selectedHotbarIndex)
    const result = applyEnchantmentOffer({
      seed: enchantmentSeed,
      bookshelfCount: 15,
      playerLevel,
      lapis,
      item: enchantedItems.get(key) ?? { item: selected.item, durability: null, enchantments: [] },
    }, enchantmentOffers(enchantmentSeed, 15)[slot])
    if (!result.ok || result.state.item === null) {
      enchantingStatus = result.ok ? 'No item selected' : result.reason
      renderPlayerUi()
      return
    }
    removeInventoryItem('lapis_lazuli', lapis - result.state.lapis)
    enchantedItems.set(key, result.state.item)
    enchantmentSeed = result.state.seed
    Effect.runSync(world.vitals.restore(addVitalsExperience(
      vitals,
      totalExperienceAtLevel(result.state.playerLevel) - vitals.totalExperience,
    )))
    enchantingStatus = `Applied ${result.state.item.enchantments.at(-1)?.id ?? 'enchantment'}`
    document.body.setAttribute('data-enchanting-result', enchantingStatus)
    markSessionDirty()
    renderPlayerUi()
  }

  inventoryParent.addEventListener('input', (event) => {
    if (inventoryMode !== 'anvil' || !(event.target instanceof HTMLInputElement)) return
    if (event.target.matches('[data-operation-target="name"]')) {
      anvilName = event.target.value.slice(0, 50)
      renderPlayerUi()
    }
  })

  inventoryParent.addEventListener('click', (event) => {
    if (playerIsDead()) return
    if (inventoryMode === 'anvil') {
      const target = event.target instanceof Element
        ? event.target.closest('[data-operation-target]')?.getAttribute('data-operation-target')
        : null
      if (target === 'output') activateAnvilOutput()
      return
    }
    if (inventoryMode === 'enchanting') {
      const target = event.target instanceof Element
        ? event.target.closest('[data-operation-target]')?.getAttribute('data-operation-target')
        : null
      const slot = target === 'offer-1' ? 0 : target === 'offer-2' ? 1 : target === 'offer-3' ? 2 : undefined
      if (slot !== undefined) activateEnchantingOffer(slot)
      return
    }
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
    if (['furnace', 'chest', 'anvil', 'enchanting'].includes(inventoryMode)) return
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    if (target.kind !== 'slot' || target.region === 'crafting-grid') return
    activateInventoryTarget(target, 'right')
  })
  inventoryParent.addEventListener('keydown', (event) => {
    if (playerIsDead()) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (inventoryMode === 'anvil' || inventoryMode === 'enchanting') return
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
    if (open && tradeOpen) setTradeOpen(false)
    if (open && brewingOpen) setBrewingOpen(false)
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
      } else if (mode === 'anvil') {
        anvilName = customNames.get(String(selectedHotbarIndex)) ?? ''
        anvilStatus = ''
      } else if (mode === 'enchanting') {
        enchantingStatus = ''
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
    const respawnDimension = respawnLocation?.dimension ?? initialSpawnDimension
    const respawnPose = respawnLocation === null
      ? initialSpawnPose
      : { ...initialSpawnPose, feetPosition: respawnLocation.position }
    Effect.runSync(world.player.restore(respawnPose, respawnDimension))
    alignActiveDimension(respawnDimension)
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
    if (brewingOpen) {
      setBrewingOpen(false)
      return
    }
    if (tradeOpen) {
      setTradeOpen(false)
      return
    }
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
    ...[...villagerResidents.values()]
      .filter((villager) => villager.dimension === currentChunkContext.dimension)
      .filter((villager) => currentChunkContext.streamLoaded.has(chunkKeyOf({
        cx: Math.floor(villager.feetPosition.x / 16),
        cz: Math.floor(villager.feetPosition.z / 16),
      })))
      .map((villager) => ({
        id: villager.id,
        kind: 'villager',
        feetPosition: villager.feetPosition,
      } satisfies RenderEntity)),
    ...(currentChunkContext.dimension === 'end'
      && Effect.runSync(gameplayState.enderDragonEncounter.snapshot).phase !== 'dead'
      ? [{
          id: 'ender-dragon',
          kind: 'ender_dragon',
          category: 'hostile' as const,
          feetPosition: endDragonPosition(),
        } satisfies RenderEntity]
      : []),
  ]

  const nearestVillagerForTrade = (
    position: SessionPosition,
    dimension: Dimension,
  ): PersistedVillager | undefined => {
    let nearest: PersistedVillager | undefined
    let nearestDistanceSquared = 16
    for (const villager of villagerResidents.values()) {
      if (villager.dimension !== dimension) continue
      const dx = villager.feetPosition.x - position.x
      const dy = villager.feetPosition.y - position.y
      const dz = villager.feetPosition.z - position.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (
        distanceSquared < nearestDistanceSquared
        || (distanceSquared === nearestDistanceSquared && villager.id < (nearest?.id ?? ''))
      ) {
        nearest = villager
        nearestDistanceSquared = distanceSquared
      }
    }
    return nearest
  }

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
      villagerUi: {
        open: tradeOpen,
        activeVillagerId: activeVillagerId ?? null,
        status: tradeStatus,
      },
      villagers: [...villagerResidents.values()],
      villagerTrades: Effect.runSync(snapshotVillagerTrades(gameplayState)),
      brewing: Effect.runSync(snapshotBrewingStand(gameplayState)),
      statusEffects: Effect.runSync(snapshotStatusEffects(gameplayState)),
      end: {
        frames: [...endPortalFrames.values()],
        portalComplete: endPortalComplete,
        dragon: Effect.runSync(gameplayState.enderDragonEncounter.snapshot),
        exitPortalMaterialized,
        dragonEggRewarded,
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
          behaviour: entity.behaviour,
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

  const seedVillageTradingEncounter = () => {
    let villager: PersistedVillager | undefined
    for (let radius = 0; radius <= 64 && villager === undefined; radius += 1) {
      for (let cx = -radius; cx <= radius && villager === undefined; cx += 1) {
        for (const cz of new Set([-radius, radius])) {
          const spawn = villageVillagerSpawnsForChunk(
            activeSeed,
            cx,
            cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(activeSeed, x, z)
              return {
                biome: biomeFor(activeSeed, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )[0]
          if (spawn !== undefined) {
            Effect.runSync(streamAround(currentChunkContext, spawn.x, spawn.z))
            villager = villagerResidents.get(spawn.id)
            break
          }
        }
      }
      for (let cz = -radius + 1; cz < radius && villager === undefined; cz += 1) {
        for (const cx of new Set([-radius, radius])) {
          const spawn = villageVillagerSpawnsForChunk(
            activeSeed,
            cx,
            cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(activeSeed, x, z)
              return {
                biome: biomeFor(activeSeed, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )[0]
          if (spawn !== undefined) {
            Effect.runSync(streamAround(currentChunkContext, spawn.x, spawn.z))
            villager = villagerResidents.get(spawn.id)
            break
          }
        }
      }
    }
    if (villager === undefined) throw new Error('no village villager found near the QA origin')
    Effect.runSync(playerApi.restore({
      feetPosition: {
        x: villager.feetPosition.x + 1.5,
        y: villager.feetPosition.y,
        z: villager.feetPosition.z,
      },
      yawRadians: Math.PI / 2,
      pitchRadians: 0,
    }, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    setTradeOpen(false)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedBrewingEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(
      streamAround(
        currentChunkContext,
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('brewing_stand')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('blaze_powder', 2))
    Effect.runSync(world.inventory.add('water_bottle', 1))
    Effect.runSync(world.inventory.add('nether_wart', 1))
    Effect.runSync(world.inventory.add('spider_eye', 1))
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    Effect.runSync(restoreBrewingStand(gameplayState, emptyBrewingStandState()))
    Effect.runSync(restoreStatusEffects(gameplayState, emptyStatusEffectState()))
    setBrewingOpen(false)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const poseLookingAt = (target: SessionPosition, distance: number): typeof QA_POSE => ({
    feetPosition: {
      x: target.x + 0.5,
      y: target.y + 0.5 - EYE_LEVEL_OFFSET,
      z: target.z + 0.5 + distance,
    },
    yawRadians: 0,
    pitchRadians: 0,
  })

  const seedEndEyeCrafting = () => {
    respawnPlayer()
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('ender_pearl', 1))
    Effect.runSync(world.inventory.add('blaze_powder', 1))
    inventoryInteraction.reset()
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedEndPortalFinalFrame = () => {
    respawnPlayer()
    const currentPose = Effect.runSync(playerApi.pose)
    const site = nearestStrongholdSite(activeSeed, currentPose.feetPosition.x, currentPose.feetPosition.z)
    if (Option.isNone(site)) throw new Error('no stronghold found near the QA player')
    const center = endPortalCenterForStronghold(site.value)
    const finalOffset = END_PORTAL_FRAME_OFFSETS[0]
    if (finalOffset === undefined) throw new Error('End portal frame layout is empty')
    Effect.runSync(streamAround(currentChunkContext, center.x, center.z))
    endPortalFrames.clear()
    endPortalComplete = false
    for (const offset of END_PORTAL_FRAME_OFFSETS) {
      const position = { x: center.x + offset.dx, y: center.y, z: center.z + offset.dz }
      const isFinal = offset === finalOffset
      Effect.runSync(currentChunkStore.setBlock(
        position,
        isFinal ? END_PORTAL_BLOCK.FRAME_EMPTY : END_PORTAL_BLOCK.FRAME_FILLED,
      ))
      if (!isFinal) {
        endPortalFrames.set(endPortalFrameKey(position), {
          position,
          facing: offset.facing,
          eye: true,
        })
      }
    }
    const finalPosition = {
      x: center.x + finalOffset.dx,
      y: center.y,
      z: center.z + finalOffset.dz,
    }
    Effect.runSync(playerApi.restore(poseLookingAt(finalPosition, 3), 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('eye_of_ender', 1))
    selectedHotbarIndex = 0
    inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    inventoryInteraction.reset()
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const targetCompletedEndPortal = () => {
    const frame = endPortalFrames.values().next().value as PersistedEndPortalFrameState | undefined
    if (frame === undefined || !endPortalComplete) throw new Error('End portal is not complete')
    const site = nearestStrongholdSite(activeSeed, frame.position.x, frame.position.z)
    if (Option.isNone(site)) throw new Error('no stronghold found for the completed portal')
    const center = endPortalCenterForStronghold(site.value)
    Effect.runSync(playerApi.restore({
      feetPosition: {
        x: center.x + 0.5,
        y: center.y + 3 - EYE_LEVEL_OFFSET,
        z: center.z + 0.5,
      },
      yawRadians: 0,
      pitchRadians: -Math.PI / 2 + 0.01,
    }, 'overworld'))
    resetSimState(true)
    markSessionDirty()
    return gameplaySnapshot()
  }

  const seedEndDragonFinalHit = () => {
    Effect.runSync(gameplayState.enderDragonEncounter.restore({
      phase: 'circling',
      phaseTimerSecs: 0,
      health: 1,
      rewardEmitted: false,
    }))
    const dragon = endDragonPosition()
    Effect.runSync(playerApi.restore(poseLookingAt(dragon, 5), 'end'))
    alignActiveDimension('end')
    resetSimState(true)
    markSessionDirty()
    return gameplaySnapshot()
  }

  const targetEndExitPortal = () => {
    if (!exitPortalMaterialized) throw new Error('End exit portal is not materialized')
    Effect.runSync(playerApi.restore(poseLookingAt({ x: 0, y: 64, z: 0 }, 3), 'end'))
    resetSimState(true)
    markSessionDirty()
    return gameplaySnapshot()
  }

  const grantNearestVillagerTradeInput = () => {
    const pose = Effect.runSync(playerApi.pose)
    const villager = nearestVillagerForTrade(pose.feetPosition, 'overworld')
    const trade = Effect.runSync(snapshotVillagerTrades(gameplayState)).villagers
      .find((candidate) => candidate.id === villager?.id)
    const offer = trade?.offers[0]
    if (offer === undefined) throw new Error('no nearby villager trade offer')
    Effect.runSync(world.inventory.add(offer.input.item, offer.input.count))
    markSessionDirty()
    renderPlayerUi()
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
        setMultiplayerInvalidPose: () => {
          const pose = Effect.runSync(playerApi.pose)
          Effect.runSync(playerApi.restore({
            ...pose,
            feetPosition: { ...pose.feetPosition, x: pose.feetPosition.x + 100 },
          }, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
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
        requestMultiplayerBlockPlacement: () => {
          if (multiplayer === undefined || !multiplayerHandshakeComplete) return gameplaySnapshot()
          Effect.runSync(multiplayer.host.enqueueOutbound({
            _tag: 'BlockPlace',
            player: multiplayer.query.player,
            world: WorldId.make(Effect.runSync(playerApi.dimension)),
            at: QA_IGNITION_CELL,
            block: 'stone',
          }))
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
        seedVillageTradingEncounter,
        grantNearestVillagerTradeInput,
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
        seedBrewingEncounter,
        seedEndEyeCrafting,
        seedEndPortalFinalFrame,
        targetCompletedEndPortal,
        seedEndDragonFinalHit,
        targetEndExitPortal,
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
  let runtimeDisposed = false
  const disposeRuntime = (): void => {
    if (runtimeDisposed) return
    runtimeDisposed = true
    settingsView.dispose()
    endAudio.dispose()
    weatherAudio.dispose()
    for (const timeout of pendingThunder.values()) window.clearTimeout(timeout)
    pendingThunder.clear()
    Effect.runSync(worldRenderer.dispose)
    audio.close()
  }
  // IndexedDB cannot be made synchronous during pagehide; this is best-effort.
  // Periodic publication persists advancing time and weather without gameplay mutations.
  window.addEventListener('pagehide', (event) => {
    requestBackgroundFlush()
    void stopBrowserPreview?.()
    disposeMultiplayer()
    if (!event.persisted) {
      disposeRuntime()
    }
  })
  const hot = (import.meta as ImportMeta & {
    readonly hot?: { readonly dispose: (handler: () => void) => void }
  }).hot
  hot?.dispose(() => {
    void stopBrowserPreview?.()
    disposeMultiplayer()
    disposeRuntime()
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
      if (brewingOpen) setBrewingOpen(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }

    if (
      !dead &&
      !bowInteractionLocked() &&
      Effect.runSync(inputApi.wasActionJustTriggered('openInventory'))
    ) {
      setInventoryOpen(!inventoryOpen, 'player')
    }

    if (!dead && !inventoryOpen && !tradeOpen) {
      selectedHotbarIndex = selectedHotbarAfterInput(
        selectedHotbarIndex,
        walk.wheelSteps,
        (action) => Effect.runSync(inputApi.wasActionJustTriggered(action)),
        wrapHotbarSelection,
      )
    }

    const held = (action: Parameters<typeof inputApi.isActionActive>[0]): number =>
      !dead && !inventoryOpen && !tradeOpen && !brewingOpen
        && Effect.runSync(inputApi.isActionActive(action)) ? 1 : 0

    const attackTriggered =
      !dead && !inventoryOpen && !tradeOpen && !brewingOpen
      && Effect.runSync(inputApi.wasActionJustTriggered('attack'))
    const attackHeld = held('attack') > 0
    if (!attackHeld) resetPrimaryAttackGesture()
    const useTriggered =
      !dead && !inventoryOpen && !tradeOpen && !brewingOpen
      && Effect.runSync(inputApi.wasActionJustTriggered('use'))
    const useHeld = held('use') > 0
    const lookDelta = {
      x: walk.pointerDelta.x + consumedTouchLook.delta.x,
      y: walk.pointerDelta.y + consumedTouchLook.delta.y,
    }
    const looked = !dead && !inventoryOpen && !tradeOpen && !brewingOpen
      && (lookDelta.x !== 0 || lookDelta.y !== 0)
    if (!dead && !inventoryOpen && !tradeOpen && !brewingOpen) {
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
      Ref.set(simState.physicsConfig, dead
        ? Option.none()
        : Option.some({
            ...simPhysicsConfig,
            walkSpeed: simPhysicsConfig.walkSpeed
              * Effect.runSync(getPlayerMovementSpeedMultiplier(gameplayState)),
          })),
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
      lastPlayerMoveSent = {
        world: worldId,
        at: pose.feetPosition,
        facing: { yawRadians: pose.yawRadians, pitchRadians: pose.pitchRadians },
      }
      lastPlayerMoveSentAt = nowSecs
      canvas.setAttribute('data-multiplayer-connection', 'connected')
      canvas.setAttribute('data-multiplayer-player-count', String(multiplayer.players.size + 1))
      multiplayerStatus.textContent = `Connected as ${String(multiplayer.query.name)}`
      multiplayerStatus.hidden = false
    } else if (
      multiplayer !== undefined &&
      !multiplayerClosed &&
      multiplayer.transport.state() === 'closed'
    ) {
      Effect.runSync(multiplayer.host.transitionConnection({ _tag: 'PeerClosed' }))
      multiplayerClosed = true
      canvas.setAttribute('data-multiplayer-connection', 'closed')
      multiplayerStatus.textContent = 'Multiplayer connection closed.'
      multiplayerStatus.hidden = false
    }

    const outcome = Effect.runSyncExit(runFrame(deltaSecs))

    if (Exit.isFailure(outcome)) {
      // A stage's error channel is `never`, so reaching here means a DEFECT.
      // Stopping the loop is deliberate: a defect that repeats sixty times a
      // second buries its own first occurrence in the console.
      failBoot('a frame stage defected', outcome.cause)
      return
    }

    const villagerTradeResults = Effect.runSync(drainVillagerTradeResults(gameplayState))
    for (const result of villagerTradeResults) {
      if (result.villagerId !== activeVillagerId) continue
      tradeStatus = villagerTradeStatus(result)
      if (result._tag === 'Traded') markSessionDirty()
    }
    if (villagerTradeResults.length > 0) renderTradeUi()

    if (multiplayer !== undefined) {
      for (const message of Effect.runSync(multiplayer.host.drainInbound)) {
        applyNetworkMessage(message)
      }
      if (multiplayerHandshakeComplete && nowSecs - lastPlayerMoveSentAt >= 0.1) {
        const pose = Effect.runSync(playerApi.pose)
        const world = WorldId.make(Effect.runSync(playerApi.dimension))
        const facing = { yawRadians: pose.yawRadians, pitchRadians: pose.pitchRadians }
        const changed = lastPlayerMoveSent === undefined
          || lastPlayerMoveSent.world !== world
          || lastPlayerMoveSent.at.x !== pose.feetPosition.x
          || lastPlayerMoveSent.at.y !== pose.feetPosition.y
          || lastPlayerMoveSent.at.z !== pose.feetPosition.z
          || lastPlayerMoveSent.facing.yawRadians !== facing.yawRadians
          || lastPlayerMoveSent.facing.pitchRadians !== facing.pitchRadians
        if (changed || nowSecs - lastPlayerMoveSentAt >= 1) {
          Effect.runSync(multiplayer.host.enqueueOutbound({
            _tag: 'PlayerMove',
            player: multiplayer.query.player,
            world,
            at: pose.feetPosition,
            facing,
          }))
          lastPlayerMoveSent = { world, at: pose.feetPosition, facing }
          lastPlayerMoveSentAt = nowSecs
        }
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
      applyPlayerDamage(
        event.damage,
        event._tag === 'StatusEffect' ? event.minimumHealthPoints : 0,
      )
    }
    const playerHeals = Effect.runSync(drainPlayerHeals(gameplayState))
    for (const event of playerHeals) {
      const vitals = Effect.runSync(world.vitals.view)
      const allowed = Math.max(
        0,
        Math.min(event.maximumHealthPoints, vitals.maxHealthPoints) - vitals.healthPoints,
      )
      if (allowed > 0) Effect.runSync(world.vitals.heal(Math.min(event.amount, allowed)))
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

    if (
      attackTriggered
      && dimensionAfterFrame === 'end'
      && !primaryAttackGestureConsumed
    ) {
      const dragonPosition = endDragonPosition()
      const dx = dragonPosition.x - postFramePose.feetPosition.x
      const dy = dragonPosition.y - (postFramePose.feetPosition.y + EYE_LEVEL_OFFSET)
      const dz = dragonPosition.z - postFramePose.feetPosition.z
      const distance = Math.hypot(dx, dy, dz)
      const horizontal = Math.cos(postFramePose.pitchRadians)
      const forward = {
        x: -Math.sin(postFramePose.yawRadians) * horizontal,
        y: Math.sin(postFramePose.pitchRadians),
        z: -Math.cos(postFramePose.yawRadians) * horizontal,
      }
      const alignment = distance === 0 ? 1 : (dx * forward.x + dy * forward.y + dz * forward.z) / distance
      if (distance <= DEFAULT_BLOCK_REACH + 3 && alignment >= 0.8) {
        const selectedItem = Effect.runSync(world.inventory.snapshot).slots[selectedHotbarIndex]?.item ?? null
        const damage = meleeDamageForItem(
          selectedItem === null ? null : gameplayModuleItem(selectedItem),
        )
        Effect.runSync(gameplayState.enderDragonEncounter.damageByPlayer(Math.max(1, damage)))
        primaryAttackGestureConsumed = true
        markSessionDirty()
      }
    }

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

    const nearbyVillager = !deadAfterFrame && !dimensionChanged && useTriggered
      ? nearestVillagerForTrade(postFramePose.feetPosition, currentChunkContext.dimension)
      : undefined
    if (nearbyVillager !== undefined && !bowAdvance.capturedUse && pendingBowShots.size === 0) {
      setTradeOpen(true, nearbyVillager.id)
    }

    if (
      nearbyVillager === undefined
      && !deadAfterFrame
      && useTriggered
      && !bowAdvance.capturedUse
      && pendingBowShots.size === 0
    ) {
      const usedEndFeature = Effect.runSync(useEndFeature())
      const opensBrewing = usedEndFeature ? false : Effect.runSync(targetedBrewingStand())
      const route = usedEndFeature || opensBrewing
        ? undefined
        : Effect.runSync(targetedRightClickRoute(currentChunkStore, playerApi, DEFAULT_BLOCK_REACH))
      if (usedEndFeature) {
        renderPlayerUi()
      } else if (opensBrewing) {
        setBrewingOpen(true)
      } else if (route?.kind === 'craftingTable') {
        setInventoryOpen(true, 'craftingTable')
      } else if (route?.kind === 'anvil') {
        setInventoryOpen(true, 'anvil')
      } else if (route?.kind === 'enchantingTable') {
        setInventoryOpen(true, 'enchanting')
      } else if (route?.kind === 'bed') {
        const decision = resolveBedSleep({
          bedPosition: {
            x: Math.floor(route.at.x),
            y: Math.floor(route.at.y),
            z: Math.floor(route.at.z),
          },
          dangerNearby: false,
          dimension: Effect.runSync(playerApi.dimension),
          timeOfDay: Effect.runSync(time.timeOfDay),
          weather: Effect.runSync(weather.snapshot).weather,
        })
        if (decision._tag === 'SleepAccepted') {
          Effect.runSync(time.setTimeOfDay(decision.morningTimeOfDay))
          respawnLocation = decision.respawnLocation
          document.body.setAttribute('data-sleep-result', 'accepted')
          markSessionDirty()
        } else {
          document.body.setAttribute('data-sleep-result', decision.reason)
        }
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
    presentWeatherRuntime(
      weatherAdvanced ?? Effect.runSync(weather.snapshot),
      postFramePose,
      nowSecs,
    )

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
    const mobExperience = Effect.runSync(drainMobExperience(gameplayState))
    for (const event of mobExperience) {
      const currentVitals = Effect.runSync(world.vitals.snapshot)
      Effect.runSync(world.vitals.restore(addVitalsExperience(currentVitals, event.amount)))
    }
    if (mobExperience.length > 0 || playerHeals.length > 0) markSessionDirty()

    const dragonEvents = Effect.runSync(gameplayState.enderDragonEncounter.drainEvents)
    for (const event of dragonEvents) {
      switch (event._tag) {
        case 'PlayerDamaged': {
          if (dimensionAfterFrame !== 'end') break
          const dragon = endDragonPosition()
          const player = Effect.runSync(playerApi.pose).feetPosition
          if (Math.hypot(dragon.x - player.x, dragon.y - player.y, dragon.z - player.z) <= 6) {
            applyPlayerDamage({ amount: event.amount, cause: 'generic' })
            queueEndAudio('playerHit', player)
          }
          break
        }
        case 'ExperienceRewarded': {
          const currentVitals = Effect.runSync(world.vitals.snapshot)
          Effect.runSync(world.vitals.restore(addVitalsExperience(currentVitals, event.amount)))
          queueEndAudio('dragonReward', endDragonPosition())
          break
        }
        case 'DragonEggRewarded':
          if (!dragonEggRewarded) {
            Effect.runSync(world.inventory.add(event.item, event.count))
            dragonEggRewarded = true
          }
          break
        case 'ExitPortalMaterializationRequested':
          if (!exitPortalMaterialized) {
            const portalY = 64
            for (let x = -1; x <= 1; x += 1) {
              for (let z = -1; z <= 1; z += 1) {
                Effect.runSync(currentChunkStore.setBlock({ x, y: portalY, z }, END_PORTAL_BLOCK.PORTAL))
              }
            }
            exitPortalMaterialized = true
            queueEndAudio('exitPortal', { x: 0, y: portalY, z: 0 })
          }
          break
        case 'DragonDamagedByPlayer':
          queueEndAudio('dragonHurt', endDragonPosition())
          break
      }
    }
    if (dragonEvents.length > 0) markSessionDirty()
    const dragonSnapshot = Effect.runSync(gameplayState.enderDragonEncounter.snapshot)
    canvas.setAttribute('data-end-dragon-phase', dragonSnapshot.phase)
    canvas.setAttribute('data-end-dragon-health', String(dragonSnapshot.health))
    endAudio.update({
      dimension: dimensionAfterFrame,
      phase: dragonSnapshot.phase === 'dead' ? 'defeated' : 'active',
      nowSecs,
      listener: postFramePose.feetPosition,
      listenerForward: readAudioListenerForward(),
      events: pendingEndAudioEvents.splice(0),
    })

    Effect.runSync(worldRenderer.syncEntities(entityRenderProjection()))
    if (brewingOpen) renderBrewingUi()
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
          disposeRuntime()
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
