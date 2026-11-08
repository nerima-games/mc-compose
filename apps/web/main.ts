/**
 * The browser entry point. THE HOST.
 *
 * Current composition host boundary.
 *
 * ---------------------------------------------------------------------------
 * What this file is, under the prime directive
 * ---------------------------------------------------------------------------
 *
 * `index.ts` says the only code added to the published compose core is Layer
 * composition and the stage order table. This file is neither — it is the
 * HOST, the thing `docs/porting.md` §2 names and `domain/composition.ts` keeps
 * referring to as "the host has the type to discharge it". It is an application
 * entry point, so its runtime dependencies are checked as app code rather than
 * being part of the published core.
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
 * `mc-render`, `mx-ui`, `mx-redstone`, `mx-gameplay` and `mx-multiplayer` are
 * composed. Gameplay supplies its public production services, including the
 * generated chunk store shared with the renderer. The host constructs the
 * browser WebSocket transport and supplies it to the multiplayer module.
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
 * The wall was real at the initial package pins: registering `gameplayModule`
 * needed a `ChunkStore`, an `EntityManager` and an `InventoryService`, while
 * the only implementations visible to this host were test doubles. That is
 * historical context now. The current public `mx-gameplay` API supplies the
 * production services used below. DRAWING TERRAIN NEVER NEEDED
 * `gameplayModule`; it needed chunk geometry, and geometry is data.
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
import { Context, Effect, Either, Option, Ref } from 'effect'
import {
  BLOCK_PROPERTY_DEFAULTS,
  BlockId,
  blockIdOf,
  blockPosition,
  blockTypeOfId,
  DeltaTimeSecs,
  chunkCoord,
  isEmpty,
  MonotonicTimeSecs as KernelMonotonicTimeSecs,
  propertyOfBlockId,
  resolvedBlockOfId,
  StackCount,
  StageId,
  type BlockPosition,
  type MonotonicTimeSecs,
  type Position as Vec3,
} from '@nerima-games/mc-kernel'
import { aabbOfCollisionShape } from '@nerima-games/mc-physics'
import {
  addExperience as addVitalsExperience,
  containerIdAt,
  emptyFurnaceState,
  emptyPlayerStorage,
  itemStack,
  makeCropService,
  makeSimFrameState,
  makeTimeService,
  makeWeatherService,
  makeVehicleService,
  maxStackCountForItem,
  resetLandingImpact,
  changed,
  UNCHANGED,
  OccupantId,
  EntityId as SimEntityId,
  type CropLocation,
  type ItemStack,
  type SimPhysicsConfig,
  type WeatherState,
  type Vehicle,
} from '@nerima-games/mc-sim'
import { END_PORTAL_BLOCK } from '@nerima-games/mc-worldgen'
import {
  InputService,
  chunkKeyOf,
  makeChunkStoreLightColor,
  makeChunkStoreMesher,
  RENDER_STAGE_IDS,
  syncWorld,
  wrapHotbarSelection,
  type ChunkRef,
} from '@nerima-games/mc-render'
import { makeBudgetedDirtySource } from './chunk-sync-budget'
import { makeRedstoneContainerRuntime } from './redstone-container-runtime'
import {
  clearRenderedChunks,
  makeChunkStreaming,
  type DimensionChunkContext,
} from './chunk-streaming'
import {
  NETHER_PORTAL_BLOCK_ID,
  OBSIDIAN_BLOCK_ID,
  REDSTONE_PLACEMENT_ITEMS,
} from './qa-fixtures'
import { trackChunkLightColor } from './render-lighting'
import { excludeReservedPlacementConsumptions } from './placement-consumption'
import {
  advancePlayerSwimmingRuntime,
  initialPlayerSwimmingRuntimeState,
} from './player-swimming-runtime'
import {
  createAnvilView,
  createChestStorageView,
  createEnchantingTableView,
  createCrosshairView,
  createFurnaceView,
  createHudView,
  createInventoryView,
  makeUiFrameState,
  slotSnapshotOf,
  type ChestStorageSlotTarget,
  type FurnaceSlotId,
  type InventoryInteractionTarget,
  type InventoryDragTarget,
  type EquipmentSlotId,
} from '@nerima-games/mx-ui'
import {
  advanceFishing,
  advanceMiningProgress,
  boardVehicle,
  bowCharge,
  bowDamage,
  bowDamageWithEnchantments,
  canFireBow,
  cancelFishing,
  castFishing,
  durabilityWearWithEnchantments,
  drainBlockUseResults,
  drainBowKnockbacks,
  drainItemUseResults,
  drainMeleeAttackResults,
  drainMobDrops,
  drainMobExperience,
  drainPortalTravels,
  drainPlayerDamages,
  drainPlayerHeals,
  drainVillagerTradeResults,
  enchantmentOffers,
  enchantmentLevel,
  DEFAULT_BLOCK_REACH,
  EYE_LEVEL_OFFSET,
  fishingPhase,
  getPlayerMovementSpeedMultiplier,
  insertBrewingBottle,
  insertBrewingFuel,
  insertBrewingIngredient,
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  makeGameplayFrameState,
  makeGeneratedWorld,
  isDroppedItemBehaviour,
  isHoeItem,
  isIgnitionItem,
  isBucketItem,
  isPlaceableItem,
  PLAYER_HALF_HEIGHT,
  PLAYER_HALF_WIDTH,
  requestBlockBreak,
  requestFurnaceAdvance,
  requestBlockPlacementCommand,
  requestMeleeAttack,
  requestPotatoFoodUse,
  requestPotatoHarvest,
  requestTargetedPotatoPlanting,
  requestTargetedSoilTill,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  requestTargetedItemUse,
  resolveTargetedBlock,
  requestVillagerTrade,
  drainBlockPlacementResults,
  reelFishing,
  resolveBedSleep,
  resolveBowHits,
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
  useBucket,
  miningLootContextForItem,
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
  type FishingRod,
  type FishingSession,
} from '@nerima-games/mx-gameplay'
import {
  encodeFrame,
  WorldId,
  type AuthoritativeEntityState,
} from '@nerima-games/mx-multiplayer'
import { makeBrowserPreview } from '@nerima-games/mc-playground-kit'
import {
  advanceBowUse,
  IDLE_BOW_USE,
  type BowUseState,
} from './bow-use'
import { isDroppedItemPickupEligible } from './dropped-item-pickup'
import { droppedItemMetadataFromBehaviour } from './dropped-item-metadata'
import { createItemMetadataStore } from './item-metadata-store'
import {
  decodeProjectedEnchantedItem,
  projectEnchantedItem,
} from './enchanted-item-state'
import {
  advanceProjectileRuntime,
  initialProjectileRuntimeState,
  launchRuntimeProjectile,
  projectileRenderDescriptors,
  recoverProjectile,
} from './projectile-runtime'
import {
  advanceEyeOfEnderRuntime,
  eyeOfEnderRenderDescriptors,
  initialEyeOfEnderRuntimeState,
} from './eye-of-ender-runtime'
import {
  advanceWitherRuntime,
  damageRuntimeWither,
  matchRuntimeWitherSummon,
  restoreWitherRuntime,
  snapshotWitherRuntime,
  summonRuntimeWither,
  witherRenderDescriptors,
} from '../multiplayer-shared/wither-runtime'
import {
  composeGame,
  type StageRegistration,
} from '../../src/domain/composition'

const COMPOSE_CHUNK_SYNC_STAGE = StageId('compose:chunk-sync')
import {
  QA_GLOBAL_KEY,
} from '../../src/domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'
import {
  connectMultiplayer,
  createMultiplayerClient,
  multiplayerRegistrationTokenKey,
  type MultiplayerClientContext,
} from './multiplayer-client'
import {
  captionRenderSignature,
  horizontalListenerForward,
} from './audio-runtime'
import {
  EMPTY_BLOCK_BREAK_COUNTERS,
  observeBlockBreakCompletion,
  recordBlockBreakRequest,
  type BlockBreakCounters,
} from './mining-completion'
import {
  consumeNativeInput,
  EMPTY_NATIVE_INPUT_QUEUE,
  enqueueNativeMouseButton,
  type NativeInputQueueState,
} from './native-input-queue'
import { requestPlacementFromSelectedSlot, selectedHotbarAfterInput } from './player-experience'
import { createDroppedItemLifetimeTracker } from './dropped-item-lifetime'
import { createSessionSaveCoordinator } from './session-save-coordinator'
import { makeSurvivalHungerCoordinator } from './survival-hunger-runtime'
import {
  advanceFootstepRuntime,
  initialFootstepRuntimeState,
  surfaceForBlockType,
} from './footstep-runtime'
import { advanceFurnaceRuntime } from './furnace-runtime'
import {
  advanceSleep,
  enterSleep,
  initialSleepRuntimeState,
  isDangerNearby,
  leaveSleep,
  reconcileSleepers,
  requiredSleeperCount,
  validRespawnLocation,
  type SleepLocation,
} from './sleep-runtime'
import {
  initialSleepClientState,
  queueSleepCommand,
  type SleepClientState,
  type SleepCommand,
} from '../multiplayer-shared/sleep-network'
import {
  DEFAULT_PLAYER_SETTINGS,
  PLAYER_BINDING_ACTIONS,
  savePlayerSettings,
  type PlayerSettingsV1,
} from './settings'
import { createSettingsView } from './settings-view'
import {
  advanceTouchLook,
  consumeTouchLook,
  createTouchControlRoster,
  TOUCH_CONTROL_ACTIONS,
  TOUCH_LOOK_CONTROLLER_IDLE,
  type TouchControlAction,
} from './touch-input'
import {
  makeSessionChunkSource,
  saveSession,
  EMPTY_ENTITY_ROSTER,
  snapshotResidentChunks,
  type DimensionChunk,
  type PersistedFurnaceState,
  type PersistedLeverState,
  type PersistedPortalState,
  type PersistedEndPortalFrameState,
  type PersistedVillager,
  type SessionPosition,
  type SessionState,
} from './session-persistence'
import {
  restoreInitialWorld,
  restoreLoadedSessionServices,
} from './session-restoration'
import { initializeSessionWorld } from './session-world'
import {
  readSessionRoute,
  type SessionRoute,
} from './session-navigation'
import {
  RequestedSessionNotFoundError,
  makePlatformAdapters,
  type SettingsWriteQueue,
} from './platform-adapters'
import { makeHostModules } from './host-modules'
import { bootTitleMenu } from './title-menu'
import {
  handleLocalPlayerDeath as handleLocalPlayerDeathUi,
  installPauseControls,
  renderCrosshair as renderCrosshairUi,
  renderPlayerHud,
  respawnPlayer as respawnPlayerUi,
} from './player-ui-h4a'
import { createPlayerUiRuntime } from './player-ui-runtime'
import {
  createPlayerFramePreparation,
  createPlayerSessionRuntime,
  installPlayerLifecycle,
  installPlayerQaSurface,
} from './player-session-runtime'
import { runTickFrameInput } from './tick/frame-input'
import { mutableState, type H5aTickContext } from './tick/h5a-context'
import { runTickPlayerMovement } from './tick/player-movement'
import type { H5bPostFrameContext } from './tick/h5b-context'
import { runTickPostFrame } from './tick/post-frame'

/**
 * plan.md §3.4's measured clamp, applied by the DELTA'S PRODUCER.
 *
 * `@nerima-games/mc-kernel` contract is explicit that this is not part of the
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
 * These are host-side browser tuning values. mc-sim owns the simulation
 * contract and accepts this physics configuration; keeping the values here
 * makes this product composition's tuning explicit.
 */
const WALK_SPEED_M_PER_S = 4.3
/**
 * Jump take-off speed, m/s.
 *
 * Was 8.4 (`0.42 blocks/tick x 20 ticks/s`, vanilla Java's own tick-rate
 * conversion) until it was measured against gravity and found to send an
 * ordinary jump 3.5+ blocks into the air — real enough to trigger this
 * package's `ceil(fallDistance - 3)` fall-damage rule on every single jump.
 *
 * That is not a fall-damage bug; it is this constant. `@nerima-games/mc-physics`'s
 * `GRAVITY_Y = -9.82` is independently CITED to the reference implementation's
 * own source (`docs/public-api.md`'s constants table: `packages/game/
 * application/game-state-support.ts:10`, wired at `game-state-service.ts:104`),
 * and that doc quotes the reference's own integrator
 * (`physics-world-service.ts:39-54`) verbatim: a continuous, per-second,
 * semi-implicit-Euler stepper — `velocity.y += gravityY * deltaTime` — not
 * Minecraft Java's discrete 20-tick/`0.08 blocks/tick^2` model. The old 8.4 was
 * derived FROM that discrete tick model and never re-validated against the
 * continuous one actually running here, which is why combining a
 * correctly-cited gravity with an uncited jump speed produced an apex three
 * times too high. `8.4` has no citation anywhere in this repo's history, in
 * mc-sim's, or in mc-physics's — grepped across all three for `JUMP_SPEED`,
 * `jumpVelocity`, `0.42` and the reference paths above.
 *
 * `5.0` is chosen to reproduce the vanilla-standard ~1.25-block jump height
 * under the verified -9.82 gravity: simulated directly against
 * `@nerima-games/mc-physics`'s own `integrateBody` (not the idealized
 * no-drag parabola formula) across delta times from 60fps down to the
 * MAX_DELTA_SECS=0.05 floor, apex lands at 1.15-1.23 blocks — comfortably
 * clear of the safe-fall threshold with margin for terrain and frame-timing
 * variance, and not a number invented from scratch: it is what recovers the
 * genre's well-known jump feel once gravity is taken as given. It is still
 * PROVISIONAL: no file in this org's accessible repos cites the reference
 * implementation's own jump-velocity constant the way GRAVITY_Y is cited, so
 * this value should be superseded the moment that citation surfaces.
 */
const JUMP_SPEED_M_PER_S = 5.0
/**
 * Sprint horizontal speed, m/s.
 *
 * `@nerima-games/mc-physics` already prices sprint in its own
 * `MovementConfig`/`applyMovementInput` (`sprintMultiplier`, gated on
 * `forward > 0`, the same gate this file applies below) — but
 * `@nerima-games/mc-sim`'s stage never calls that function; its stage
 * hand-rolls movement straight off `SimPhysicsConfig.walkSpeed`
 * (`mc-sim/dist/stages/registration.js`: `vx = ... * config.walkSpeed`), and
 * that config has no sprint field at all. So sprint has to be applied here,
 * at the host, the same way an active Speed status effect already is (see
 * `getPlayerMovementSpeedMultiplier` below): by substituting the effective
 * walkSpeed sent into `SimPhysicsConfig` for the frame.
 *
 * The value is not invented. `@nerima-games/mc-physics`'s own
 * `test/resolve.test.ts` names its `REFERENCE_TOP_SPEED` as "the fastest the
 * reference's player ever moves horizontally: a sprint (5.612) times the
 * sprint-jump multiplier (1.2)", citing
 * `packages/entity/application/movement-service.ts:25-32` in the reference
 * implementation. 5.612 is the plain-sprint half of that product; the extra
 * 1.2x sprint-jump boost is a separate mechanic this change does not add.
 */
const SPRINT_SPEED_M_PER_S = 5.612
/**
 * How tall an obstacle the player climbs by walking into it, no jump needed.
 *
 * mc-physics resolves X/Z/Y sequentially, so ANY vertical overlap between the
 * player's box and a block's collision box blocks horizontal movement on that
 * axis, however thin the box is — a 1/16-tall plate reads as just as much of
 * a wall as a full cube unless the host arms step-up (`tryStepUp`,
 * resolve-support.ts). That mechanism defaults to off (stepHeight 0); mc-
 * physics's own test suite names both the mechanism and this exact value as
 * the authority: `resolve.test.ts`'s "with no step height injected, the same
 * slab is a wall" states outright that the value is mc-sim's — i.e. the
 * host's — to arm, the same way WALK_SPEED_M_PER_S above is, and 0.6 is what
 * that suite uses throughout as the vanilla-accurate reference. A full block
 * is still 1.0 tall, well past this, so ordinary one-block terrain steps
 * still require a jump, unchanged.
 */
const PLAYER_STEP_HEIGHT_M = 0.6
const LOOK_SENSITIVITY = 0.0022
const WORLD_SEED = 20260728
const AUTOSAVE_INTERVAL_MS = 5_000
const SAVE_DEBOUNCE_MS = 500
const CRAFTING_STALE_RETRY_LIMIT = 4

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
type GameplayItemType = Parameters<typeof isPlaceableItem>[0]
type GameplayHoeItemType = Parameters<typeof requestTargetedSoilTill>[4]
type GameplayIgnitionItemType = Parameters<typeof requestTargetedItemUse>[4]

const isGameplayHoeItem = (item: ItemStack['item']): item is GameplayHoeItemType =>
  isHoeItem(item)

const isGameplayIgnitionItem = (
  item: ItemStack['item'],
): item is GameplayIgnitionItemType => isIgnitionItem(item)

const EQUIPMENT_ONLY_ITEM_NAMES: ReadonlySet<string> = new Set(EQUIPMENT_ONLY_ITEM_TYPES)

const isGameplayUseItemType = (item: ItemStack['item']): item is GameplayUseItemType =>
  !EQUIPMENT_ONLY_ITEM_NAMES.has(item)

const isLegacyGameplayItemType = (item: ItemStack['item']): item is LegacyGameplayItemType =>
  item !== 'arrow' && item !== 'bow'

const isPlaceableGameplayItem = (item: ItemStack['item']): item is PlaceableItemType =>
  isGameplayUseItemType(item) &&
  isLegacyGameplayItemType(item) &&
  isPlaceableItem(item)

type InventoryMode = 'player' | 'craftingTable' | 'furnace' | 'chest' | 'anvil' | 'enchanting'

const INVENTORY_PRESENTATIONS = {
  player: { label: 'Inventory', width: 2, height: 2 },
  craftingTable: { label: 'Crafting Table', width: 3, height: 3 },
  furnace: { label: 'Furnace', width: 0, height: 0 },
  chest: { label: 'Chest', width: 0, height: 0 },
  anvil: { label: 'Anvil', width: 0, height: 0 },
  enchanting: { label: 'Enchanting Table', width: 0, height: 0 },
} as const

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

const bootTitle = async (): Promise<void> => bootTitleMenu({
  document,
  window,
  indexedDB,
  crypto,
  requireElement,
  enqueueSettingsWrite,
  drainSettingsWrites,
  multiplayerRegistrationTokenKey,
  hot: (import.meta as ImportMeta & {
    readonly hot?: { readonly dispose: (handler: () => void) => void }
  }).hot,
})

const bootGame = async (
  route: SessionRoute,
): Promise<void> => {
  const { sessionId } = route
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
  const {
    customNames,
    enchantedItems,
    droppedItemMetadata,
    droppedItemMetadataKey,
    equipmentMetadataKey,
    containerMetadataKey,
    containerMetadataLocation,
    sameItemMetadata,
    copyItemMetadata,
    deleteItemMetadata,
    deleteContainerMetadata,
    moveItemMetadata,
  } = createItemMetadataStore()
  const droppedItemLifetime = createDroppedItemLifetimeTracker()
  let respawnLocation: SleepLocation | null = null
  let sleepRuntimeState = initialSleepRuntimeState()
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
  //
  // Storage, audio, input, redstone, and renderer are constructed in
  // `./platform-adapters` and returned as one typed struct. The two closures
  // keep the adapters' pointer-lock / modal predicates reading this host's
  // live UI state instead of a stale copy of it.
  const adapters = await makePlatformAdapters({
    route,
    canvas,
    touchControls,
    allowsPointerLock: () => !inventoryOpen && !tradeOpen && !brewingOpen && !paused,
    uiModalOpen: () => inventoryOpen || tradeOpen || brewingOpen,
  })
  const {
    storageContext,
    runStorage,
    settingsWrites,
    audio,
    endAudio,
    weatherAudio,
    queueEndAudio,
    placementAudio,
    loadedSession,
    sessionMetadata,
    isCreativeMode,
    initialDimension,
    inputContext,
    redstoneRuntime,
    atlasTexture,
    softwareRenderer,
    worldRenderer,
  } = adapters
  let playerSettings = adapters.playerSettings

  type Dimension = SessionState['dimension']

  // -------------------------------------------------------------------------
  // 2a. The generated world, shared by gameplay and rendering
  // -------------------------------------------------------------------------
  //
  // ONE CONSTRUCTION. The gameplay adapter and the renderer-facing worldgen
  // store returned here wrap the same store instance, so a mined block cannot
  // disappear from collision while remaining visible (or vice versa).
  const restoredWorkstations = Option.isSome(loadedSession)
    ? loadedSession.value.state.workstations
    : undefined
  const resolveMetadataStack = (key: string) => {
    if (!Option.isSome(loadedSession)) return undefined
    const storage = loadedSession.value.state.storage
    if (/^\d+$/.test(key)) {
      const slot = Number(key)
      const stack = storage.inventory.slots[slot]
      if (stack === undefined) return undefined
      return { stack, durability: storage.inventoryDurability[slot] ?? undefined }
    }
    if (key.startsWith('equipment:')) {
      const slot = key.slice('equipment:'.length)
      if (!(slot in storage.equipment.slots)) return undefined
      const item = storage.equipment.slots[slot as EquipmentSlotId]
      if (item === null || item === undefined) return undefined
      return { stack: itemStack(item.item, item.count), durability: item.durability }
    }
    const location = containerMetadataLocation(key)
    if (location === undefined) return undefined
    const stack = loadedSession.value.state.containerStorage.containers
      .find((container) => container.id === location.containerId)
      ?.slots[location.slot]
    return stack === null || stack === undefined
      ? undefined
      : { stack: itemStack(stack.item, stack.count), durability: stack.durability ?? undefined }
  }
  for (const [slot, name] of Object.entries(restoredWorkstations?.customNames ?? {})) {
    if (resolveMetadataStack(slot) === undefined) continue
    customNames.set(slot, name)
  }
  for (const [slot, encoded] of Object.entries(restoredWorkstations?.enchantedItems ?? {})) {
    const resolved = resolveMetadataStack(slot)
    if (resolved === undefined) continue
    const restored = decodeProjectedEnchantedItem(encoded, resolved.stack, resolved.durability)
    if (restored !== null) enchantedItems.set(slot, restored)
  }
  const restoredRespawn = restoredWorkstations?.respawn
  respawnLocation = restoredRespawn == null
    ? null
    : {
        dimension: 'overworld',
        position: restoredRespawn.position,
        bedPosition: {
          x: Math.floor(restoredRespawn.position.x),
          y: Math.floor(restoredRespawn.position.y) - 1,
          z: Math.floor(restoredRespawn.position.z),
        },
      }
  const sessionWorld = await initializeSessionWorld({
    loadedSession,
    initialDimension,
    worldSeed: WORLD_SEED,
    loadSavedChunks: (session, dimension, fallback) => runStorage(
      Effect.provide(makeSessionChunkSource(session, dimension, fallback), storageContext),
    ),
    makeWorld: ({ seed, chunkSource, dimension }) => Effect.runPromise(
      makeGeneratedWorld<MobBehaviour>({ seed, chunkSource, dimension }),
    ),
    restoreEntities: (targetWorld, roster) => Effect.runSync(
      targetWorld.entities.restore(roster as Parameters<typeof targetWorld.entities.restore>[0]),
    ),
    snapshotEntities: (targetWorld) => Effect.runSync(targetWorld.entities.snapshot),
    droppedItemLifetime,
    droppedItemMetadata,
    droppedItemMetadataKey,
    droppedItemMetadataFromBehaviour,
  })
  const {
    activeSeed,
    initialKnownChunks,
    restored,
    world,
    chunkSourceFor,
    entityRosters,
    rosterWithDroppedItemLifetimes,
    snapshotEntityRosters: snapshotEntityRostersFor,
  } = sessionWorld
  enchantmentSeed = restoredWorkstations?.enchantmentSeed ?? activeSeed
  const snapshotEntityRosters = (): SessionState['entities'] =>
    snapshotEntityRostersFor(
      currentChunkContext.dimension,
      Effect.runSync(world.entities.snapshot),
    )
  const survivalHunger = makeSurvivalHungerCoordinator(world.vitals)
  const initialSpawnPose = await Effect.runPromise(world.player.pose)
  const initialSpawnDimension = await Effect.runPromise(world.player.dimension)
  const loadedSessionState = Option.isSome(loadedSession) ? loadedSession.value.state : undefined
  await restoreInitialWorld(loadedSessionState, isCreativeMode, {
    restoreEntities: () => Effect.runPromise(
      world.entities.restore(
        (entityRosters.get(initialDimension) ?? EMPTY_ENTITY_ROSTER) as Parameters<
          typeof world.entities.restore
        >[0],
      ),
    ),
    restoreStorage: (state) => Effect.runPromise(world.inventory.restoreStorage(state.storage)),
    restoreContainerStorage: (state) =>
      Effect.runPromise(world.inventory.restoreContainerStorage(state.containerStorage)),
    restorePlayer: (state) =>
      Effect.runPromise(world.player.restore(state.player, state.dimension)),
    restoreVitals: (state) => Effect.runPromise(world.vitals.restore(state.vitals)),
    addCreativeStartingItems: async () => {
      await Effect.runPromise(world.inventory.add('redstone_dust', 16))
      await Effect.runPromise(world.inventory.add('lever', 4))
      await Effect.runPromise(world.inventory.add('redstone_lamp', 8))
      await Effect.runPromise(world.inventory.add('piston', 4))
    },
  })
  const time = await Effect.runPromise(makeTimeService())
  const weather = await Effect.runPromise(makeWeatherService())
  const crops = await Effect.runPromise(makeCropService())
  const gameplayState = await Effect.runPromise(makeGameplayFrameState)
  const villagerResidents = new Map<string, PersistedVillager>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.villagers.residents : [])
      .map((villager) => [villager.id, villager]),
  )
  await restoreLoadedSessionServices(loadedSessionState, {
    restoreTime: (state) => Effect.runPromise(time.restore(state.time)),
    restoreWeather: (state) => Effect.runPromise(weather.restore(state.weather)),
    restoreCrops: (state) => Effect.runPromise(crops.restore(state.crops)),
    restoreVillagerTrades: (state) =>
      Effect.runPromise(restoreVillagerTrades(gameplayState, state.villagers.trades)),
    restoreBrewingStand: (state) =>
      Effect.runPromise(restoreBrewingStand(gameplayState, state.brewing)),
    restoreStatusEffects: (state) =>
      Effect.runPromise(restoreStatusEffects(gameplayState, state.statusEffects)),
    restoreEnderDragon: (state) =>
      Effect.runPromise(gameplayState.enderDragonEncounter.restore(state.end.dragon)),
  })
  const loadedEndState = Option.isSome(loadedSession) ? loadedSession.value.state.end : undefined
  const endPortalFrameKey = (position: SessionPosition): string =>
    `${String(position.x)},${String(position.y)},${String(position.z)}`
  const endPortalFrames = new Map<string, PersistedEndPortalFrameState>(
    (loadedEndState?.frames ?? []).map((frame) => [endPortalFrameKey(frame.position), frame]),
  )
  let endPortalComplete = loadedEndState?.portalComplete ?? false
  let exitPortalMaterialized = loadedEndState?.exitPortalMaterialized ?? false
  let dragonEggRewarded = loadedEndState?.dragonEggRewarded ?? false
  let witherRuntimeState = restoreWitherRuntime(
    Option.isSome(loadedSession) ? loadedSession.value.state.wither : undefined,
  )
  let witherRevision = 0
  let nextWitherCommand = 0
  let authoritativeEnderDragonSnapshot = Effect.runSync(gameplayState.enderDragonEncounter.snapshot)
  let enderDragonRevision = 0
  let nextEnderDragonCommand = 0
  const endDragonSnapshot = () => multiplayer === undefined
    ? Effect.runSync(gameplayState.enderDragonEncounter.snapshot)
    : authoritativeEnderDragonSnapshot
  const endDragonPosition = (): SessionPosition => {
    const dragon = endDragonSnapshot()
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
    const receivedLightning = authoritativeLightning !== undefined && authoritativeLightning.expiresAtSecs >= nowSecs
      ? authoritativeLightning
      : undefined
    const lightningSequence = receivedLightning?.sequence ?? (state.weather === 'thunder'
      ? Math.floor(timeState.ticks / (60 * 8))
      : undefined)
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
      // The renderer plans sky, sun and fog from this every frame — see
      // application/world-renderer.ts's setEnvironment. currentChunkContext
      // is the same per-frame source alignActiveDimension keeps current for
      // chunk streaming and entity rosters; this is that value read for
      // render, not a second notion of where the player is.
      dimension: currentChunkContext.dimension,
      ...(lightningSequence === undefined ? {} : { lightningSequence }),
    }, camera))
    const thunder = lightningSequence === undefined
      ? undefined
      : {
          id: `weather-thunder-${String(lightningSequence)}`,
          occurredAtSecs: nowSecs,
          position: receivedLightning?.at ?? { x: camera.x + 24, y: camera.y + 12, z: camera.z + 12 },
        }
    weatherAudio.update({
      mode: state.weather,
      intensity,
      listener: camera,
      listenerForward: adapters.getReadAudioListenerForward(),
      occlusion: 0,
      ...(thunder === undefined ? {} : { thunder }),
    })
    canvas.setAttribute('data-weather-particles', String(renderPlan.particles.length))
    canvas.setAttribute('data-weather-lightning', String(renderPlan.lightningFlash > 0))
    canvas.setAttribute('data-weather-audio-mode', weatherAudio.state().mode)
  }

  const MAX_CHUNK_UPDATES_PER_FRAME = 4
  const makeDimensionChunkContext = (
    dimension: Dimension,
    dimensionWorld: typeof world,
  ): DimensionChunkContext => {
    const lighting = trackChunkLightColor((chunk, quads) =>
      makeChunkStoreLightColor(dimensionWorld.worldgenChunkStore, chunk, quads),
    )
    const dirtyChunks = makeBudgetedDirtySource(
      Effect.runSync(dimensionWorld.worldgenChunkStore.subscribeDirty),
      MAX_CHUNK_UPDATES_PER_FRAME,
    )
    return {
      dimension,
      chunkStore: dimensionWorld.chunkStore,
      worldgenChunkStore: dimensionWorld.worldgenChunkStore,
      dirtyChunks,
      queueLoadedChunk: (chunk) => dirtyChunks.enqueue({ changed: [chunk], removed: [] }),
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
  const chunkSyncStage: StageRegistration = {
    id: COMPOSE_CHUNK_SYNC_STAGE,
    after: [RENDER_STAGE_IDS.cameraMirror],
    run: () => Effect.asVoid(Effect.suspend(() =>
      syncWorld(worldRenderer, currentChunkContext.dirtyChunks, currentChunkContext.meshChunkFromStore, {
        colorForChunk: currentChunkContext.colorForChunk,
      }),
    )),
  }
  // mx-redstone's PistonPosition/RedstonePosition stayed plain {x,y,z}; the kernel's
  // BlockPosition now brands each axis, so every redstone-domain position needs this
  // conversion before it can address a chunkStore read or write.
  const asBlockPosition = (position: { readonly x: number; readonly y: number; readonly z: number }): BlockPosition =>
    blockPosition(position.x, position.y, position.z)
  const leverKeyOf = (lever: Pick<PersistedLeverState, 'dimension' | 'position'>): string =>
    JSON.stringify([lever.dimension, lever.position.x, lever.position.y, lever.position.z])
  const leverStates = new Map<string, PersistedLeverState>(
    (Option.isSome(loadedSession) ? loadedSession.value.state.redstone.levers : [])
      .map((lever) => [leverKeyOf(lever), lever]),
  )
  const comparatorModes = new Map<string, 'compare' | 'subtract'>()
  const observerInputs = new Map<string, number>()
  const observerPulses = new Map<string, number>()
  const poweredRails = new Set<string>()
  // A plate's occupancy is a fact about entities, which mx-redstone deliberately
  // does not own (see @nerima-games/mx-redstone's domain/pressure-plate.ts) —
  // this host computes it from the player's AABB and hands the graph only the
  // `active` bit a lever's own player-driven flag would carry. Cached here
  // rather than recomputed inside syncRedstoneSnapshot because that scan only
  // runs when `redstoneDirty`, and the player walking onto a plate does not by
  // itself dirty anything; the per-frame check below is what notices the edge
  // and requests the resync.
  const pressurePlateOccupancy = new Map<string, {
    readonly dimension: Dimension
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly occupied: boolean
  }>()
  // A drained lamp transition is a one-shot event; the QA surface needs a durable
  // record of it, not another live read of block state, because some pulses
  // (the observer's 2-tick / 0.2s window) are shorter than a single QA round trip.
  // `writtenBlock` is a read-after-write confirmation, kept separate from `lit`
  // so "the event fired" and "the write landed" stay two distinguishable claims.
  const redstoneLampTransitionLog = new Map<string, Array<{ readonly lit: boolean; readonly writtenBlock: BlockId | null }>>()
  const restoredVehicles = Option.isSome(loadedSession) ? loadedSession.value.state.vehicles ?? [] : []
  const vehicleNextSerial = restoredVehicles.reduce((nextSerial, vehicle) => {
    const match = /^v:(\d+)$/.exec(String(vehicle.id))
    return match === null ? nextSerial : Math.max(nextSerial, Number(match[1]) + 1)
  }, 0)
  const vehicleService = Effect.runSync(makeVehicleService({
    vehicles: restoredVehicles,
    nextSerial: vehicleNextSerial,
  }))
  const vehicleList = (): ReadonlyArray<Vehicle> => Effect.runSync(vehicleService.vehicles)
  const vehicleById = (id: string): Vehicle | undefined => vehicleList().find((vehicle) => String(vehicle.id) === id)
  const replaceVehicle = (vehicle: Vehicle): void => {
    Effect.runSync(vehicleService.updateState(vehicle.id, {
      dimension: vehicle.dimension,
      position: vehicle.position,
      velocity: vehicle.velocity,
      yawRadians: vehicle.yawRadians,
    }))
}
  const applyAuthoritativeVehicle = (
    entity: Extract<AuthoritativeEntityState, { readonly _tag: 'vehicle' }>,
  ): void => {
    const current = vehicleById(String(entity.entityId))
    if (current === undefined) return
    const occupant = entity.occupant === null
      ? undefined
      : OccupantId(String(entity.occupant))
    Effect.runSync(vehicleService.updateState(current.id, {
      dimension: current.dimension,
      position: entity.at,
      velocity: current.velocity,
      yawRadians: current.yawRadians,
      occupant,
    }))
    if (entity.occupant === null && mountedVehicleId === String(current.id)) {
      mountedVehicleId = undefined
    }
    if (entity.occupant === multiplayer?.query.player) mountedVehicleId = String(current.id)
  }
  const localVehicleOccupant = OccupantId('local-player')
  let mountedVehicleId: string | undefined = Option.isSome(loadedSession)
    ? loadedSession.value.state.mountedVehicleId ?? undefined
    : undefined
  let vehicleControls = { throttle: 0, steering: 0 }
  let fishingSession: FishingSession | undefined
  let fishingWater: { readonly dimension: Dimension; readonly position: SessionPosition } | undefined
  let fishingResult = 'idle'
  let networkFishingState: { readonly phase: 'idle' | 'waiting' | 'bite' | 'escaped'; readonly result: string } = { phase: 'idle', result: 'idle' }
  let nextFishingRoll = 1
  let swimmingState = initialPlayerSwimmingRuntimeState()
  let footstepRuntimeState = initialFootstepRuntimeState()
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

  let dirtyGeneration = 0
  let savedGeneration = 0
  let debounceTimer: number | undefined

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
    currentGeneration: () => dirtyGeneration,
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
      entities: snapshotEntityRosters(),
      villagers: {
        residents: [...villagerResidents.values()],
        trades: Effect.runSync(snapshotVillagerTrades(gameplayState)),
      },
      brewing: Effect.runSync(snapshotBrewingStand(gameplayState)),
      statusEffects: Effect.runSync(snapshotStatusEffects(gameplayState)),
      wither: snapshotWitherRuntime(witherRuntimeState),
      fishing: {
        result: fishingResult,
        phase: multiplayer === undefined ? (fishingSession === undefined ? 'idle' : fishingPhase(fishingSession)) : networkFishingState.phase,
        water: fishingWater ?? null,
      },
      // An unoccupied vehicle's `occupant` is `undefined` (see
      // vehicleById/boardVehicle call sites in this file), not an absent
      // key — object literals in this codebase set it explicitly rather
      // than omitting it. session-persistence.ts's PersistedVehiclesSchema
      // validates this array as Schema.Unknown, so nothing schema-side ever
      // strips that key the way this file's own exact:true optional fields
      // do; an explicit `undefined` reaching mc-save's integrity
      // canonicalizer is a hard encode failure there (see that file's
      // comment on PersistedVehiclesSchema for the same failure mode on a
      // different field). Stripped here, at the one place a Vehicle enters
      // the persisted snapshot, the same way vehicle-motion.ts's own
      // withoutOccupant already represents "no occupant" everywhere else.
      vehicles: vehicleList().map((vehicle) => {
        if (vehicle.occupant !== undefined) return vehicle
        const { occupant: _occupant, ...withoutOccupant } = vehicle
        return withoutOccupant
      }),
      mountedVehicleId: mountedVehicleId ?? null,
      end: {
        frames: [...endPortalFrames.values()],
        portalComplete: endPortalComplete,
        dragon: endDragonSnapshot(),
        exitPortalMaterialized,
        dragonEggRewarded,
      },
      workstations: {
        enchantmentSeed,
        customNames: Object.fromEntries(customNames),
        enchantedItems: Object.fromEntries(
          [...enchantedItems].map(([slot, item]) => [slot, JSON.stringify(item)]),
        ),
        // `SessionStateSchema`'s `deathDropDimension` is `optionalWith(...,
        // { exact: true })`: it requires the key to be OMITTED, not merely
        // `undefined`-valued, or mc-save's integrity checksum rejects the
        // encoded save (a present `undefined` key is not one of canonicalize's
        // supported value kinds). `deathDropDimension` here is `undefined`
        // whenever no death is pending, which is most saves, so this must be
        // conditional rather than a bare shorthand property.
        ...(deathDropDimension === undefined ? {} : { deathDropDimension }),
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
    onPublished: (publishedGeneration) => {
      savedGeneration = Math.max(savedGeneration, publishedGeneration)
    },
    onFailure: reportPersistenceFailure,
  })
  let markSessionDirty = (): void => {}
  const spawnPose = await Effect.runPromise(world.player.pose)
  canvas.setAttribute('data-world-source', restored === undefined ? 'generated' : 'persisted')
  canvas.setAttribute('data-world-seed', String(activeSeed))

  // STREAMING, keyed to where the player is — not a one-shot load at boot.
  //
  // A fixed radius bounds memory while still exercising both add and removal.
  //
  // Software-rasterizer-conditional, using the same `softwareRenderer` signal
  // as the render-quality fallback above.
  //
  // mc-worldgen 0.2.0 added a deepslate layer at depth, absent from the
  // pre-0.2.0 terrain this budget was originally calibrated against. Verified
  // by isolating mc-worldgen alone (pnpm-workspace.yaml override, everything
  // else held at the current pins): the same 25-chunk sample has nearly
  // identical exposed-face and air-pocket counts either version, but 0.2.0
  // splits the underground surface across two solid block ids (stone +
  // deepslate) plus more ore variety — 20 distinct block ids in the sample
  // versus 11 pre-0.2.0 — instead of one. Greedy meshing only merges runs of
  // the SAME block id, so the same exposed surface now meshes into roughly
  // 4x the indices at an unchanged face count — this is a merge-key
  // diversity problem, not a "SwiftShader draws more chunks" problem.
  //
  // Measured (real SwiftShader, unthrottled, this 25-chunk scene):
  //   radius 2: 153,426 indices/frame (25 chunks)
  //   radius 1:  70,842 indices/frame (9 chunks) — a 2.17x cut, not a full
  //     return to the pre-0.2.0 terrain's ~38,826 at radius 2; a residual
  //     gap remains and is not explained by this fix.
  // The software-rasterizer perf floor is 8 FPS
  // (e2e/performance-budget.e2e.ts's MINIMUM_AVERAGE_FPS). Real
  // hardware-accelerated players keep radius 2.
  const STREAM_RADIUS_CHUNKS = softwareRenderer ? 1 : 2
  canvas.setAttribute('data-stream-radius', String(STREAM_RADIUS_CHUNKS))
  let chunksStreamedIn = 0
  let chunksDropped = 0
  const { streamAround, retainDimensionResidents } = makeChunkStreaming({
    streamRadiusChunks: STREAM_RADIUS_CHUNKS,
    activeSeed,
    canvas,
    gameplayState,
    villagerResidents,
    saveCoordinator,
    getMarkSessionDirty: () => markSessionDirty,
    markRedstoneDirty: () => { redstoneDirty = true },
    getChunksStreamedIn: () => chunksStreamedIn,
    setChunksStreamedIn: (count) => { chunksStreamedIn = count },
    getChunksDropped: () => chunksDropped,
    setChunksDropped: (count) => { chunksDropped = count },
  })

  const redstoneContainerRuntime = makeRedstoneContainerRuntime({
    dimensionContexts,
    world,
    leverStates,
    comparatorModes,
    observerInputs,
    observerPulses,
    pressurePlateOccupancy,
    poweredRails,
    getSimulationElapsedSecs: () => simulationElapsedSecs,
    isMultiplayer: () => multiplayer !== undefined,
    setRedstoneDirty: (dirty) => { redstoneDirty = dirty },
    markSessionDirty,
    redstoneRuntime,
    customNames,
    enchantedItems,
    droppedItemMetadata,
    containerMetadataKey,
    copyItemMetadata,
    deleteItemMetadata,
    droppedItemMetadataKey,
    getFramesTotal: () => framesTotal,
    asBlockPosition,
    leverKeyOf,
  })
  const {
    syncRedstoneSnapshot,
    containerIdForStorageBlock,
    applyHopperTransfer,
    applyDispenserTrigger,
    applyDropperTrigger,
    applyPoweredPistonTransition,
  } = redstoneContainerRuntime

  await Effect.runPromise(
    streamAround(currentChunkContext, spawnPose.feetPosition.x, spawnPose.feetPosition.z),
  )

  const uiFrameState = Effect.runSync(makeUiFrameState)

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
  adapters.setReadAudioListener(() => Effect.runSync(playerApi.pose).feetPosition)
  adapters.setReadAudioListenerForward(() => horizontalListenerForward(
    Effect.runSync(playerApi.pose).yawRadians,
  ))
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
  // mc-physics 0.2.1 replaced ResolveOptions.isBlockSolid (a boolean predicate)
  // with blockPropertiesAt (the kernel's BlockProperties or null), and
  // resolve-shapes.ts reads exactly one field off it for collision,
  // `properties.collisionShape` — so returning the block's REAL resolved
  // properties (not a synthetic default) is what turns on per-shape collision
  // (cactus inset, slabs, the pressure-plate box) without touching mc-physics
  // itself. This must still keep solidityFromStore's three-valued semantics:
  // an unloaded chunk and out-of-world both read as SOLID (air there lets a
  // player walk off a chunk edge and fall forever — see mx-gameplay's
  // in-memory-world docstring), so both sentinel readings fall back to
  // BLOCK_PROPERTY_DEFAULTS, kernel's "ordinary opaque solid cube"
  // (collisionShape: 'full') — exactly the box the pre-migration code used
  // for every solid cell. A loaded, non-air block resolves to its own
  // registry row via resolvedBlockOfId, the same accessor mc-physics's own
  // kernel-world.ts adapter uses.
  const blockPropertiesAt: SimPhysicsConfig['resolve']['blockPropertiesAt'] = (blockX, blockY, blockZ) => {
    const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(blockX, blockY, blockZ)))
    if (reading._tag !== 'Block') return BLOCK_PROPERTY_DEFAULTS
    return isEmpty(reading.block) ? null : (resolvedBlockOfId(reading.block)?.properties ?? null)
  }
  const simPhysicsConfig: SimPhysicsConfig = {
    resolve: {
      blockPropertiesAt,
      halfWidth: PLAYER_HALF_WIDTH,
      // mc-sim exposes this branded field but not the brand constructor.
      halfHeight: PLAYER_HALF_HEIGHT as SimPhysicsConfig['resolve']['halfHeight'],
      stepHeight: PLAYER_STEP_HEIGHT_M,
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
  // "Standing on" is contact with a cell's TOP FACE, not volume overlap —
  // unlike lava/cactus, which a player is immersed IN, a grounded player's
  // feet rest exactly at the surface of whatever supports them, never inside
  // it. Now that simPhysicsConfig resolves each block's real registry
  // collisionShape (a plate included), that surface is no longer always
  // `cell.y + 1` — a plate's is `cell.y + PRESSURE_PLATE_SHAPE.maxY` — so the
  // top height is read from the same shape table mc-physics's own resolver
  // consults, rather than assumed.
  const restingContactEpsilon = 1e-3
  const isStandingOnCell = (
    feetPosition: { readonly x: number; readonly y: number; readonly z: number },
    x: number,
    y: number,
    z: number,
  ): boolean => {
    const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(x, y, z)))
    if (reading._tag !== 'Block') return false
    const shape = aabbOfCollisionShape(propertyOfBlockId(reading.block, 'collisionShape'))
    if (shape === null) return false
    return (
      intervalOverlap(
        feetPosition.x - PLAYER_HALF_WIDTH,
        feetPosition.x + PLAYER_HALF_WIDTH,
        x,
        x + 1,
      ) > 0 &&
      intervalOverlap(
        feetPosition.z - PLAYER_HALF_WIDTH,
        feetPosition.z + PLAYER_HALF_WIDTH,
        z,
        z + 1,
      ) > 0 &&
      Math.abs(feetPosition.y - (y + shape.maxY)) < restingContactEpsilon
    )
  }
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
          const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(x, y, z)))
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
    entityRosters.set(
      currentChunkContext.dimension,
      rosterWithDroppedItemLifetimes(
        currentChunkContext.dimension,
        Effect.runSync(world.entities.snapshot),
      ),
    )
    Effect.runSync(
      world.entities.restore(
        (entityRosters.get(dimension) ?? EMPTY_ENTITY_ROSTER) as Parameters<
          typeof world.entities.restore
        >[0],
      ),
    )
    entityRosters.set(dimension, Effect.runSync(world.entities.snapshot))
    currentChunkContext = getOrCreateDimensionChunkContext(dimension)
    Effect.runSync(clearRenderedChunks(worldRenderer))
    redstoneDirty = true
    return true
  }
  let blockBreakCounters: BlockBreakCounters = EMPTY_BLOCK_BREAK_COUNTERS
  let placementsRequested = 0
  let nativeInputQueue: NativeInputQueueState = EMPTY_NATIVE_INPUT_QUEUE
  const handleNativeMouseDown = (event: MouseEvent): void => {
    const bounds = canvas.getBoundingClientRect()
    const isOverCanvas = event.clientX >= bounds.left
      && event.clientX <= bounds.right
      && event.clientY >= bounds.top
      && event.clientY <= bounds.bottom
    if (!isOverCanvas && document.pointerLockElement !== canvas) return
    nativeInputQueue = enqueueNativeMouseButton(nativeInputQueue, event.button)
  }
  window.addEventListener('mousedown', handleNativeMouseDown, true)
  let nextItemUseRequestId = 0
  const pendingFurnaceAdvances = new Map<string, string>()
  const deferredFurnaceAdvanceSecs = new Map<string, number>()
  let nextBlockUseRequestId = 0
  let nextBlockPlacementRequestId = 0
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
        .map((portal) => blockPosition(portal.position.x, portal.position.y, portal.position.z)),
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
        yield* context.chunkStore.load(chunkCoord(chunk.cx, chunk.cz)).pipe(Effect.catchAll(() => Effect.void))
        context.streamLoaded.add(key)
        chunksStreamedIn += 1
      }
      for (const position of layout.frame) {
        yield* context.chunkStore.setBlock(blockPosition(position.x, position.y, position.z), OBSIDIAN_BLOCK_ID)
      }
      for (const position of layout.interior) {
        yield* context.chunkStore.setBlock(blockPosition(position.x, position.y, position.z), NETHER_PORTAL_BLOCK_ID)
      }
      markSessionDirty()
    })
  // mc-worldgen's resolveNetherTravel computes `destination` from pure 8:1
  // arithmetic with no knowledge of what occupies it, and mx-gameplay's
  // applyPortalTravel already `moveTo`'d the player there earlier this
  // frame — see the comment above the `applyPortalTravels()` call site.
  // That destination lands inside solid terrain roughly as often as it
  // lands in the open, since it is just wherever the scaled coordinate
  // happens to fall on generated ground. An arrival inside solid terrain
  // starts the frame already overlapping it (teleported there, not swept
  // there), and mc-physics's resolver only resolves a boundary the
  // player's box CROSSES during a step — the same fact `restoreLookingAt`
  // above measured for QA-spawned hostiles — so it never gets pushed out:
  // ungrounded, unfalling, and blocked in every direction by the same rock
  // it is standing inside.
  //
  // This searches the arrival COLUMN ONLY — same x/z as the arithmetic
  // destination, the one axis vanilla itself searches — for the nearest
  // existing open pocket with solid footing, checked nearest-Y-first so a
  // correction never drifts further than it has to from where the portal
  // math actually pointed. ONLY the one column, not every column the
  // player's half-width footprint might straddle: a live round-trip test
  // caught the wider check reading a portal's own frame as "the body isn't
  // clear here", because a frame stands immediately adjacent to its
  // interior by construction and a footprint sized for open terrain
  // reaches straight into it. The player is TELEPORTED into that partial
  // overlap the same as every arrival here, so it is the same harmless
  // coexistence the header above describes, not a defect to correct.
  //
  // If the destination cell and the one above it are already clear,
  // nothing was overlapping in the first place and ordinary physics —
  // falling through real open space, resting on real ground — is left to
  // handle it untouched; this is what keeps the other, already-working
  // half of arrivals unchanged. Only when no open pocket exists within the
  // search bound (solid rock the whole way) does this carve one at the
  // arithmetic destination itself, the same flush-floor-plus-cleared-column
  // shape `restoreLookingAt` already proves out for the identical
  // underlying defect.
  const PORTAL_LANDING_SEARCH_BLOCKS = 32
  const ensureSafePortalLanding = (
    dimension: Dimension,
    destination: PersistedPortalState['position'],
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const context = getOrCreateDimensionChunkContext(dimension)
      const chunk = { cx: Math.floor(destination.x / 16), cz: Math.floor(destination.z / 16) }
      const key = chunkKeyOf(chunk)
      if (!context.streamLoaded.has(key)) {
        yield* context.chunkStore.load(chunkCoord(chunk.cx, chunk.cz)).pipe(Effect.catchAll(() => Effect.void))
        context.streamLoaded.add(key)
        chunksStreamedIn += 1
      }

      // The SAME notion of "does this cell obstruct a body" the real
      // resolver uses — collisionShape, via blockPropertiesAt's own
      // accessor above — and deliberately not solidityFromStore's
      // `passable` capability check, which a first version of this fix
      // used: nether_portal carries no `passable: true` capability (only
      // `suffocates: false` and `validSpawnSurface: false`), so that check
      // read a portal's own interior as solid ground and "corrected" a
      // player already standing safely inside a freshly built one, dropping
      // them out of it and stranding the return trip.
      //
      // ONE EXPLICIT EXEMPTION REMAINS EVEN AFTER SWITCHING TO
      // collisionShape, and it also needed the live round-trip test to
      // surface: nether_portal's registry row sets no collisionShape of its
      // own either, so it defaults to kernel's ordinary "full solid cube"
      // the same as any other undeclared block. Nothing in mc-physics ever
      // pushes a body OUT of a cell it is already standing in when the body
      // did not cross into it during a step — the identical fact this
      // fix's whole header is about — so a player TELEPORTED into a portal
      // interior (every arrival here, and every QA restore) simply
      // coexists with that "solid" cell harmlessly, which is how dwelling
      // has ever worked at all. Treating it as an obstruction this fix
      // must correct fights that coexistence instead of relying on it, so
      // nether_portal is read as clear here regardless of its shape — the
      // same block-type test stepPortalTravel's own `inPortal` uses.
      const isObstructed = (y: number): boolean => {
        const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(destination.x, y, destination.z)))
        if (reading._tag !== 'Block') return true
        if (isEmpty(reading.block)) return false
        if (blockTypeOfId(reading.block) === 'nether_portal') return false
        return aabbOfCollisionShape(propertyOfBlockId(reading.block, 'collisionShape')) !== null
      }
      const clearAt = (y: number): boolean => !isObstructed(y)
      const solidAt = (y: number): boolean => isObstructed(y)

      if (clearAt(destination.y) && clearAt(destination.y + 1)) return

      let floorY: number | undefined
      for (
        let offset = 0;
        offset <= PORTAL_LANDING_SEARCH_BLOCKS && floorY === undefined;
        offset += 1
      ) {
        const candidates =
          offset === 0
            ? [destination.y - 1]
            : [destination.y - 1 + offset, destination.y - 1 - offset]
        for (const candidate of candidates) {
          if (solidAt(candidate) && clearAt(candidate + 1) && clearAt(candidate + 2)) {
            floorY = candidate
            break
          }
        }
      }
      const carved = floorY === undefined
      const resolvedFloorY = floorY ?? destination.y - 1

      if (carved) {
        yield* context.chunkStore.setBlock(blockPosition(destination.x, resolvedFloorY, destination.z), blockIdOf('stone'))
      }
      yield* context.chunkStore.setBlock(blockPosition(destination.x, resolvedFloorY + 1, destination.z), blockIdOf('air'))
      yield* context.chunkStore.setBlock(blockPosition(destination.x, resolvedFloorY + 2, destination.z), blockIdOf('air'))
      if (carved) markSessionDirty()

      const pose = yield* playerApi.pose
      yield* playerApi.moveTo({ ...pose.feetPosition, y: resolvedFloorY + 1 })
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
        yield* ensureSafePortalLanding(travel.plan.toDimension, travel.plan.destination)
      }
    })
  Effect.runSync(syncPortalCandidateSnapshots())
  const observedMobDrops: Array<MobDropEvent & { readonly renderId: string }> = []
  let nextMobDropId = 0
  let lastObservedItemUse: ItemUseResult | undefined
  type PendingItemUse =
    | {
        readonly kind: 'ignition'
        readonly slotIndex: number
        readonly heldItem: IgnitionItemType
        readonly dimension: Dimension
      }
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
  let projectileRuntimeState = initialProjectileRuntimeState()
  let eyeOfEnderRuntimeState = initialEyeOfEnderRuntimeState()
  let nextEyeOfEnderBreaks: boolean | undefined
  const pendingMeleeAttacks = new Map<
    string,
    { readonly slotIndex: number; readonly item: SwordItem }
  >()
  const bowInteractionLocked = (): boolean =>
    bowUseState._tag === 'Drawing'
  const resetBowUse = (): void => {
    bowUseState = IDLE_BOW_USE
    Effect.runSync(Ref.set(gameplayState.pendingBowShots, []))
    Effect.runSync(Ref.set(gameplayState.bowShotResults, []))
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

      const enchantedItem = projectedInventoryEnchantedItem(pending.slotIndex)
      const appliedWear = enchantedItem === null
        ? 1
        : durabilityWearWithEnchantments(1, enchantedItem, [Math.random()])
      if (appliedWear === 0) continue
      const damageResult = Effect.runSync(
        world.inventory.damageAt(
          { _tag: 'Inventory', slotIndex: pending.slotIndex },
          appliedWear,
        ),
      )
      if (damageResult._tag === 'Broken') {
        enchantedItems.delete(String(pending.slotIndex))
        customNames.delete(String(pending.slotIndex))
      }
      if (damageResult._tag === 'Damaged' || damageResult._tag === 'Broken') {
        markSessionDirty()
      }
    }
  }
  const pendingBlockUses = new Map<
    string,
    { readonly dimension: Dimension; readonly position: { readonly x: number; readonly y: number; readonly z: number } }
  >()
  const pendingBlockPlacements = new Map<
    string,
    {
      readonly dimension: Dimension
      readonly item: GameplayItemType
      readonly position: { readonly x: number; readonly y: number; readonly z: number }
    }
  >()
  const pendingWitherSummonChecks: Array<{
    readonly dimension: Dimension
    readonly item: 'wither_skeleton_skull'
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
  }> = []
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

  const multiplayerConnection = await connectMultiplayer({
    sessionId,
    search: window.location.search,
    href: window.location.href,
    getSessionStorage: () => window.sessionStorage,
    getLocalStorage: () => window.localStorage,
    failBoot,
  })
  if (multiplayerConnection.status === 'failed') return
  const {
    multiplayer,
    multiplayerInboundStage,
    multiplayerOutboundStage,
    requiredSleepRatio,
  } = multiplayerConnection
  let authoritativeLightning: Readonly<{ sequence: number; at: Vec3; expiresAtSecs: number }> | undefined
  const multiplayerEntities = new Map<string, AuthoritativeEntityState>()
  type MultiplayerInventorySelection = Readonly<{
    source: number
    remaining: number
    mode: 'all' | 'split'
  }>
  let multiplayerInventorySelection: MultiplayerInventorySelection | null = null
  type QueuedPlayerDamage = Readonly<{
    readonly amount: number
    readonly minimumHealthPoints: number
  }>
  let queuedPlayerDamages: QueuedPlayerDamage[] = []
  let pendingCrafting: {
    readonly commandId: string
    readonly acceptedRevision: number | null
  } | null = null
  let pendingBrewingCommand: { readonly commandId: string } | null = null
  let activeBrewingStandAt: { readonly x: number; readonly y: number; readonly z: number } | undefined
  let closeChestOnFacilityIdle = false
  let networkSleepState: SleepClientState = initialSleepClientState()
  let nextSleepRequest = 1
  let appliedNightSkipRevision: number | null = null
  let multiplayerRejection = ''
  let multiplayerHandshakeComplete = false
  let multiplayerClosed = false
  let lastPlayerMoveSentAt = Number.NEGATIVE_INFINITY
  let lastPlayerMoveSent: {
    readonly world: WorldId
    readonly at: { readonly x: number; readonly y: number; readonly z: number }
    readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
  } | undefined

  const multiplayerClientContext: MultiplayerClientContext = {
    multiplayer,
    ui: {
      canvas,
      multiplayerStatus,
      multiplayerChat,
      multiplayerChatLog,
      multiplayerChatForm,
      multiplayerChatInput,
    },
    state: {
      get inventoryOpen() { return inventoryOpen },
      set inventoryOpen(value) { inventoryOpen = value },
      get inventoryMode() { return inventoryMode },
      set inventoryMode(value) { inventoryMode = value },
      get tradeOpen() { return tradeOpen },
      set tradeOpen(value) { tradeOpen = value },
      get activeVillagerId() { return activeVillagerId },
      set activeVillagerId(value) { activeVillagerId = value },
      get brewingOpen() { return brewingOpen },
      set brewingOpen(value) { brewingOpen = value },
      get brewingStatus() { return brewingStatus },
      set brewingStatus(value) { brewingStatus = value },
      get tradeStatus() { return tradeStatus },
      set tradeStatus(value) { tradeStatus = value },
      get enchantmentSeed() { return enchantmentSeed },
      set enchantmentSeed(value) { enchantmentSeed = value },
      get anvilName() { return anvilName },
      set anvilName(value) { anvilName = value },
      get anvilStatus() { return anvilStatus },
      set anvilStatus(value) { anvilStatus = value },
      get enchantingStatus() { return enchantingStatus },
      set enchantingStatus(value) { enchantingStatus = value },
      get customNames() { return customNames },
      get enchantedItems() { return enchantedItems },
      get eyeOfEnderRuntimeState() { return eyeOfEnderRuntimeState },
      set eyeOfEnderRuntimeState(value) { eyeOfEnderRuntimeState = value },
      get sleepRuntimeState() { return sleepRuntimeState },
      set sleepRuntimeState(value) { sleepRuntimeState = value },
      get witherRevision() { return witherRevision },
      set witherRevision(value) { witherRevision = value },
      get witherRuntimeState() { return witherRuntimeState },
      set witherRuntimeState(value) { witherRuntimeState = value },
      get authoritativeEnderDragonSnapshot() { return authoritativeEnderDragonSnapshot },
      set authoritativeEnderDragonSnapshot(value) { authoritativeEnderDragonSnapshot = value },
      get enderDragonRevision() { return enderDragonRevision },
      set enderDragonRevision(value) { enderDragonRevision = value },
      get redstoneDirty() { return redstoneDirty },
      set redstoneDirty(value) { redstoneDirty = value },
      get leverStates() { return leverStates },
      get poweredRails() { return poweredRails },
      get fishingResult() { return fishingResult },
      set fishingResult(value) { fishingResult = value },
      get networkFishingState() { return networkFishingState },
      set networkFishingState(value) { networkFishingState = value },
      get furnaceStates() { return furnaceStates },
      get activeFurnaceKey() { return activeFurnaceKey },
      set activeFurnaceKey(value) { activeFurnaceKey = value },
      get activeChestId() { return activeChestId },
      set activeChestId(value) { activeChestId = value },
      get selectedHotbarIndex() { return selectedHotbarIndex },
      set selectedHotbarIndex(value) { selectedHotbarIndex = value },
      get chestStatus() { return chestStatus },
      set chestStatus(value) { chestStatus = value },
      get furnaceStatus() { return furnaceStatus },
      set furnaceStatus(value) { furnaceStatus = value },
      get authoritativeLightning() { return authoritativeLightning },
      set authoritativeLightning(value) { authoritativeLightning = value },
      get multiplayerEntities() { return multiplayerEntities },
      get multiplayerInventorySelection() { return multiplayerInventorySelection },
      set multiplayerInventorySelection(value) { multiplayerInventorySelection = value },
      get queuedPlayerDamages() { return queuedPlayerDamages },
      set queuedPlayerDamages(value) { queuedPlayerDamages = value },
      get pendingCrafting() { return pendingCrafting },
      set pendingCrafting(value) { pendingCrafting = value },
      get pendingBrewingCommand() { return pendingBrewingCommand },
      set pendingBrewingCommand(value) { pendingBrewingCommand = value },
      get activeBrewingStandAt() { return activeBrewingStandAt },
      set activeBrewingStandAt(value) { activeBrewingStandAt = value },
      get closeChestOnFacilityIdle() { return closeChestOnFacilityIdle },
      set closeChestOnFacilityIdle(value) { closeChestOnFacilityIdle = value },
      get networkSleepState() { return networkSleepState },
      set networkSleepState(value) { networkSleepState = value },
      get nextSleepRequest() { return nextSleepRequest },
      set nextSleepRequest(value) { nextSleepRequest = value },
      get appliedNightSkipRevision() { return appliedNightSkipRevision },
      set appliedNightSkipRevision(value) { appliedNightSkipRevision = value },
      get multiplayerRejection() { return multiplayerRejection },
      set multiplayerRejection(value) { multiplayerRejection = value },
      get multiplayerHandshakeComplete() { return multiplayerHandshakeComplete },
      set multiplayerHandshakeComplete(value) { multiplayerHandshakeComplete = value },
      get multiplayerClosed() { return multiplayerClosed },
      set multiplayerClosed(value) { multiplayerClosed = value },
      get lastPlayerMoveSentAt() { return lastPlayerMoveSentAt },
      set lastPlayerMoveSentAt(value) { lastPlayerMoveSentAt = value },
      get lastPlayerMoveSent() { return lastPlayerMoveSent },
      set lastPlayerMoveSent(value) { lastPlayerMoveSent = value },
    },
    services: {
      world,
      gameplayState,
      playerApi,
      time,
      weather,
      currentChunkContext: () => currentChunkContext,
      getOrCreateDimensionChunkContext,
      leverKeyOf,
      vehicleById,
      vehicleService,
      applyAuthoritativeVehicle,
      alignActiveDimension: (dimension) => { alignActiveDimension(dimension) },
      resetSimState,
      presentWeather,
      queueEndAudio,
      craftingStaleRetryLimit: CRAFTING_STALE_RETRY_LIMIT,
    },
    callbacks: {
      getInventoryInteraction: () => inventoryInteraction,
      renderPlayerUi: () => renderPlayerUi(),
      renderTradeUi: () => renderTradeUi(),
      renderBrewingUi: () => renderBrewingUi(),
      setInventoryOpen: (open) => setInventoryOpen(open),
    },
  }
  const {
    enqueueMultiplayerPlayerMove,
    drainMultiplayerInbound,
    sendVitalsCommand,
    sendPortalUseCommand,
    sendEndProgressCommand,
    sendToggleLeverCommand,
    sendInventoryCommand,
    sendInventorySelection,
    sendVillagerTradeCommand,
    sendEntityCommand,
    sendFacilityCommand,
    pumpPlayerDamage,
    drainPlayerDamageInbound,
    requestCrafting,
    drainCraftingInbound,
    requestBrewing,
    drainBrewingInbound,
    requestAnvil,
    drainAnvilInbound,
    requestEnchanting,
    drainEnchantingInbound,
    requestIdFor,
  } = createMultiplayerClient(multiplayerClientContext)

  const modules = await makeHostModules({
    adapters,
    spawnPose,
    chunkSyncStage,
    uiFrameState,
    simState,
    time,
    playerApi,
    crops,
    gameplayState,
    currentChunkStore,
    world,
    vehicleService,
    isActiveDimension: (dimension) => dimension === currentChunkContext.dimension,
    poweredRails,
    leverKeyOf,
    getMountedVehicleId: () => mountedVehicleId,
    setMountedVehicleId: (id) => {
      mountedVehicleId = id
    },
    getVehicleControls: () => vehicleControls,
    multiplayer,
  })

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
  // mx-ui exposes UiMount, but this host also owns specialized furnace, chest,
  // anvil, enchanting, and trade overlays, so it composes those screens here.
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
  const swimmingHud = document.createElement('div')
  swimmingHud.id = 'swimming-hud'
  swimmingHud.dataset['testid'] = 'swimming'
  swimmingHud.hidden = true
  hudParent.append(swimmingHud)
  const projectileHud = document.createElement('div')
  projectileHud.id = 'projectile-hud'
  projectileHud.dataset['testid'] = 'projectiles'
  hudParent.append(projectileHud)
  const sleepHud = document.createElement('div')
  sleepHud.id = 'sleep-hud'
  sleepHud.dataset['testid'] = 'sleep'
  sleepHud.hidden = true
  hudParent.append(sleepHud)

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
      default: return 'Trade rejected'
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
    if (multiplayer !== undefined && multiplayerHandshakeComplete) {
      if (sendVillagerTradeCommand(activeVillagerId, offerId)) {
        tradeStatus = 'Trading...'
        renderTradeUi()
      }
      return
    }
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
    if (!open) {
      activeBrewingStandAt = undefined
      pendingBrewingCommand = null
    }
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
      if (multiplayer !== undefined) {
        if (requestBrewing({ _tag: 'insert', slot: selectedHotbarIndex })) {
          brewingStatus = `Submitting ${selected.item}...`
        } else {
          brewingStatus = 'Brewing action is unavailable'
        }
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
      if (multiplayer !== undefined) {
        if (requestBrewing({ _tag: 'collect' })) {
          brewingStatus = 'Collecting bottle...'
        } else {
          brewingStatus = 'Brewing action is unavailable'
        }
        renderBrewingUi()
        return
      }
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
      if (multiplayer !== undefined) {
        if (requestBrewing({ _tag: 'drink' })) {
          brewingStatus = 'Drinking potion...'
        } else {
          brewingStatus = 'Brewing action is unavailable'
        }
        renderBrewingUi()
        return
      }
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
  const crosshairContext = {
    crosshair,
    getPaused: () => paused,
    isInventoryOpen: () => inventoryOpen,
    isTradeOpen: () => tradeOpen,
    isBrewingOpen: () => brewingOpen,
    getMiningProgress: () => miningProgress,
  }
  const renderCrosshair = (
    nowSecs = Effect.runSync(browserClock.monotonicSecs),
  ): void => {
    renderCrosshairUi(crosshairContext, nowSecs)
  }
  let inventoryFocus: InventoryInteractionTarget = {
    kind: 'slot',
    region: 'hotbar',
    index: selectedHotbarIndex,
  }
  let equipmentActionStatus = ''
  let inventoryDragSource: InventoryDragTarget | undefined
  let furnaceFocus: FurnaceSlotId = 'input'
  let furnaceStatus = ''
  let chestFocus: ChestStorageSlotTarget = { region: 'chest', slot: 0 }
  let chestSelected: ChestStorageSlotTarget | undefined
  let chestStatus = ''
  const inventoryRuntime = createPlayerUiRuntime({
    document,
    window,
    canvas,
    inventoryParent,
    touchControlsParent,
    swimmingHud,
    documentBody: document.body,
    touchAvailable,
    inventoryPresentations: INVENTORY_PRESENTATIONS,
    inventoryView,
    furnaceView,
    chestView,
    anvilView,
    enchantingView,
    inventoryService: world.inventory,
    worldInventory: world.inventory,
    inventoryStorageSnapshot: world.inventory.storageSnapshot,
    getPlayerPose: () => playerApi.pose,
    getPlayerDimension: () => playerApi.dimension,
    restorePlayerForDimension: (pose, dimension) => playerApi.restore(pose, dimension),
    getOrCreateDimensionChunkContext,
    readBlockAt: (position) => Effect.map(currentChunkStore.getBlock(position), (reading) =>
      reading._tag === 'Block'
        ? { _tag: 'Block', block: reading.block }
        : { _tag: 'Unavailable' }),
    customNames,
    enchantedItems,
    audio,
    getMultiplayer: () => multiplayer !== undefined,
    getPlayerHealthPoints: () => Effect.runSync(world.vitals.view).healthPoints,
    getVitalsDamageSnapshot: () => Effect.runSync(world.vitals.snapshot),
    applyVitalsDamage: (damage) => { Effect.runSync(world.vitals.damage(damage)) },
    restoreVitalsDamage: (vitals) => { Effect.runSync(world.vitals.restore(vitals)) },
    isCreativeMode,
    queuePlayerDamage: (amount, minimumHealthPoints) => {
      queuedPlayerDamages = [...queuedPlayerDamages, { amount, minimumHealthPoints }]
      pumpPlayerDamage()
    },
    handleLocalPlayerDeath: () => handleLocalPlayerDeath(),
    setSwimmingState: (state) => { swimmingState = state },
    resetSimState,
    getEntitiesForExplosion: () => Effect.runSync(world.entities.entities),
    setBlockAt: (position, block) => { Effect.runSync(currentChunkStore.setBlock(position, block)) },
    setBlockEffect: (position, block) => currentChunkStore.setBlock(position, block),
    resolveExplosionEffects: (effects) => {
      for (const effect of effects) {
        Effect.runSync(resolveBowHits(world.entities, [{
          id: SimEntityId(effect.id),
          damage: effect.damage,
        }]))
      }
    },
    getActiveSeed: () => activeSeed,
    endPortalFrames,
    endPortalFrameKey,
    getEndPortalComplete: () => endPortalComplete,
    setEndPortalComplete: (complete) => { endPortalComplete = complete },
    getExitPortalMaterialized: () => exitPortalMaterialized,
    getEyeOfEnderRuntimeState: () => eyeOfEnderRuntimeState,
    setEyeOfEnderRuntimeState: (state) => { eyeOfEnderRuntimeState = state },
    getNextEyeOfEnderBreaks: () => nextEyeOfEnderBreaks,
    setNextEyeOfEnderBreaks: (breaks) => { nextEyeOfEnderBreaks = breaks },
    sendEndProgressCommand,
    alignActiveDimension: (dimension) => { alignActiveDimension(dimension) },
    queueEndAudio,
    getBowInteractionLocked: () => bowInteractionLocked(),
    getPaused: () => paused,
    getTouchLookState: () => touchLookState,
    setTouchLookState: (state) => { touchLookState = state },
    clearHeldInput: () => Effect.runSync(inputApi.clearHeld),
    getSwimmingState: () => swimmingState,
    getFishingSession: () => fishingSession,
    setFishingResultState: (result) => { fishingResult = result },
    getInventoryOpen: () => inventoryOpen,
    setInventoryOpenState: (open) => { inventoryOpen = open },
    getInventoryMode: () => inventoryMode,
    setInventoryMode: (mode) => { inventoryMode = mode },
    getActiveChestId: () => activeChestId,
    setActiveChestId: (id) => { activeChestId = id },
    setChestSelected: (target) => { chestSelected = target },
    setChestFocus: (target) => { chestFocus = target },
    setChestStatus: (status) => { chestStatus = status },
    setCloseChestOnFacilityIdle: (close) => { closeChestOnFacilityIdle = close },
    setInventoryFocus: (target) => { inventoryFocus = target },
    setFurnaceFocus: (slot) => { furnaceFocus = slot },
    setFurnaceStatus: (status) => { furnaceStatus = status },
    getEquipmentActionStatus: () => equipmentActionStatus,
    setEquipmentActionStatus: (status) => { equipmentActionStatus = status },
    getInventoryDragSource: () => inventoryDragSource,
    setInventoryDragSource: (source) => { inventoryDragSource = source },
    getMultiplayerInventorySelection: () => multiplayerInventorySelection,
    setMultiplayerInventorySelection: (selection) => { multiplayerInventorySelection = selection },
    hasPendingCrafting: () => pendingCrafting !== null,
    sendInventoryCommand,
    requestCrafting,
    requestAnvil,
    requestEnchanting,
    moveItemMetadata,
    equipmentMetadataKey,
    setEnchantmentSeed: (seed) => { enchantmentSeed = seed },
    getVitalsSnapshot: () => ({ totalExperience: Effect.runSync(world.vitals.snapshot).totalExperience }),
    getInventorySnapshot: () => world.inventory.snapshot,
    restoreVitalsAtExperience: (totalExperience) => {
      const vitals = Effect.runSync(world.vitals.snapshot)
      Effect.runSync(world.vitals.restore(addVitalsExperience(
        vitals,
        totalExperience - vitals.totalExperience,
      )))
    },
    setAnvilName: (name) => { anvilName = name },
    setAnvilStatus: (status) => { anvilStatus = status },
    setEnchantingStatus: (status) => { enchantingStatus = status },
    getSelectedHotbarIndex: () => selectedHotbarIndex,
    renderHud: (storage, durabilityBySlot) => renderPlayerHud({
      render: (viewModel) => hud.render(viewModel),
      getHudInput: () => ({
        ...Effect.runSync(world.vitals.view),
        hotbar: storage.inventory.slots
          .slice(0, 9)
          .map((slot, slotIndex) => slotSnapshotOf(slot, durabilityBySlot.get(slotIndex))),
        selectedHotbarIndex,
      }),
      getActiveEffects: () => Effect.runSync(snapshotStatusEffects(gameplayState)).effects,
      statusEffectsHud,
      documentBody: document.body,
    }),
    getTotalExperience: () => Effect.runSync(world.vitals.snapshot).totalExperience,
    getExperienceLevel: () => Effect.runSync(world.vitals.view).experienceLevel,
    getEnchantmentSeed: () => enchantmentSeed,
    getAnvilName: () => anvilName,
    getAnvilStatus: () => anvilStatus,
    getEnchantingStatus: () => enchantingStatus,
    getChestSelected: () => chestSelected,
    getChestFocus: () => chestFocus,
    getChestStatus: () => chestStatus,
    getFurnaceFocus: () => furnaceFocus,
    getFurnaceStatus: () => furnaceStatus,
    getInventoryFocus: () => inventoryFocus,
    getActiveChestContainer: (containerId) => Effect.runSync(world.inventory.containerSnapshot(containerId)),
    transferContainerItem: (request) => world.inventory.transferContainerItem(request),
    containerMetadataKey,
    sameItemMetadata,
    copyItemMetadata,
    deleteItemMetadata,
    getActiveFurnaceState: () => activeFurnaceKey === undefined
      ? undefined
      : furnaceStates.get(activeFurnaceKey)?.state,
    getActiveFurnaceKey: () => activeFurnaceKey,
    removeInventoryAt: (slot, item, count) => Effect.map(
      world.inventory.removeAt(slot, item, count),
      (result) => result._tag === 'Removed'
        ? { _tag: 'Removed', removed: result.removed }
        : { _tag: 'Unavailable' },
    ),
    addInventoryItem: (item, count) => world.inventory.add(item, count),
    updateActiveFurnaceState: (state) => {
      if (activeFurnaceKey === undefined) return false
      const current = furnaceStates.get(activeFurnaceKey)
      if (current === undefined) return false
      furnaceStates.set(activeFurnaceKey, { ...current, state })
      return true
    },
    sendFacilityCommand,
    closeTrade: () => setTradeOpen(false),
    isTradeOpen: () => tradeOpen,
    closeBrewing: () => setBrewingOpen(false),
    isBrewingOpen: () => brewingOpen,
    resetPrimaryAttackGesture,
    clearMultiplayerInventorySelection: () => { multiplayerInventorySelection = null },
    markSessionDirty: () => markSessionDirty(),
    getDirtyGeneration: () => dirtyGeneration,
    setDirtyGeneration: (generation) => { dirtyGeneration = generation },
    getSavedGeneration: () => savedGeneration,
    getDebounceTimer: () => debounceTimer,
    setDebounceTimer: (timer) => { debounceTimer = timer },
    scheduleDebounce: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearDebounce: (timer) => window.clearTimeout(timer),
    saveSession: () => saveCoordinator.requestSave(),
    saveDebounceMs: SAVE_DEBOUNCE_MS,
    renderCrosshair: () => renderCrosshair(),
  })
  const {
    inventoryInteraction,
    setInventoryOpen,
    projectedInventoryEnchantedItem,
    inventoryMeleeDamage,
    playerIsDead,
    resetTouchInput,
    syncTouchControls,
    presentSwimmingState,
    setFishingResult,
    targetedBlock,
    fishingEnvironmentAt,
    useEndFeature,
    installInventoryListeners,
    applyPlayerDamage,
    applyWorldExplosion,
  } = inventoryRuntime
  const renderPlayerUi = inventoryRuntime.renderPlayerUi
  let deathDropDimension: SessionState['dimension'] | undefined =
    restoredWorkstations?.deathDropDimension
  const handleLocalPlayerDeath = (): void => handleLocalPlayerDeathUi({
    getPlayerPosition: () => Effect.runSync(world.player.pose).feetPosition,
    getStorageSnapshot: () => Effect.runSync(world.inventory.storageSnapshot),
    customNames,
    enchantedItems,
    getFramesTotal: () => framesTotal,
    spawnDroppedItems: (drops) => Effect.runSync(spawnDroppedItems(world.entities, drops)),
    getPlayerDimension: () => Effect.runSync(world.player.dimension),
    droppedItemMetadataKey,
    droppedItemMetadata,
    equipmentMetadataKey,
    restoreEmptyStorage: () => Effect.runSync(world.inventory.restoreStorage(emptyPlayerStorage())),
    getVitalsSnapshot: () => Effect.runSync(world.vitals.snapshot),
    restoreVitals: (vitals) => Effect.runSync(world.vitals.restore(vitals)),
    setDeathDropDimension: (dimension) => {
      deathDropDimension = dimension
    },
    markSessionDirty,
  })

  installInventoryListeners()

  const respawnPlayer = (): void => respawnPlayerUi({
    resetPrimaryAttackGesture,
    resetBowUse,
    resetProjectileStates: () => {
      projectileRuntimeState = initialProjectileRuntimeState()
      eyeOfEnderRuntimeState = initialEyeOfEnderRuntimeState()
    },
    unmountVehicle: () => {
      if (mountedVehicleId !== undefined) {
        const vehicle = vehicleById(mountedVehicleId)
        if (vehicle !== undefined) Effect.runSync(vehicleService.dismount(vehicle.id, localVehicleOccupant))
        mountedVehicleId = undefined
      }
    },
    cancelFishing: () => {
      if (fishingSession !== undefined) cancelFishing(fishingSession)
      fishingSession = undefined
      fishingWater = undefined
      setFishingResult('idle')
    },
    resetSwimming: () => {
      swimmingState = initialPlayerSwimmingRuntimeState()
      presentSwimmingState()
    },
    respawnVitals: () => {
      if (multiplayer === undefined) survivalHunger.respawn()
      else sendVitalsCommand('respawn')
    },
    clearGameplayDeathState: () => {
      Effect.runSync(Ref.set(gameplayState.hostileContactCooldowns, new Map()))
      Effect.runSync(Ref.set(gameplayState.playerDamages, []))
      Effect.runSync(Ref.set(gameplayState.spawnAttempts, []))
      Effect.runSync(Ref.set(gameplayState.mobDrops, []))
      observedMobDrops.splice(0)
    },
    validRespawnLocation: () => validRespawnLocation(respawnLocation, (location) => {
      const context = getOrCreateDimensionChunkContext(location.dimension)
      const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(location.bedPosition.x, location.bedPosition.y, location.bedPosition.z)))
      return reading._tag === 'Block' && blockTypeOfId(reading.block) === 'bed'
    }),
    clearRespawnLocation: () => {
      respawnLocation = null
    },
    leaveSleep: () => {
      sleepRuntimeState = leaveSleep(sleepRuntimeState, multiplayer?.query.player ?? 'local')
    },
    restorePlayerForRespawn: (validRespawn) => {
      const respawnDimension = validRespawn?.dimension ?? initialSpawnDimension
      const respawnPose = validRespawn === null
        ? initialSpawnPose
        : { ...initialSpawnPose, feetPosition: validRespawn.position }
      Effect.runSync(world.player.restore(respawnPose, respawnDimension))
      alignActiveDimension(respawnDimension)
    },
    clearDeathDropDimension: () => {
      deathDropDimension = undefined
    },
    resetSimState,
    setInventoryOpen: (open) => setInventoryOpen(open),
    syncTouchControls,
    renderPlayerUi,
    markSessionDirty,
  })

  inventoryRuntime.installRespawnListener(hudParent, respawnPlayer)

  renderPlayerUi()
  renderCrosshair()
  syncTouchControls()

  // -------------------------------------------------------------------------
  // 4a. Durable session publication
  // -------------------------------------------------------------------------

  const { requestFlush, requestBackgroundFlush, markSessionDirty: runtimeMarkSessionDirty } = inventoryRuntime
  markSessionDirty = runtimeMarkSessionDirty

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

  const handlePauseRequest = installPauseControls({
    document,
    window,
    canvas,
    gameShell,
    pauseOverlay,
    resumeButton,
    settingsButton,
    saveQuitButton,
    pauseError,
    settingsView,
    getPlayerSettings: () => playerSettings,
    getPaused: () => paused,
    setPaused: (next) => {
      paused = next
    },
    isBrewingOpen: () => brewingOpen,
    closeBrewing: () => setBrewingOpen(false),
    isTradeOpen: () => tradeOpen,
    closeTrade: () => setTradeOpen(false),
    isInventoryOpen: () => inventoryOpen,
    closeInventory: () => setInventoryOpen(false),
    resetPrimaryAttackGesture,
    resetBowUse,
    renderCrosshair: () => renderCrosshair(),
    syncTouchControls,
    requestFlush,
    drainSettingsWrites: () => drainSettingsWrites(settingsWrites),
  })

  // -------------------------------------------------------------------------
  // 5. QA surface
  // -------------------------------------------------------------------------

  const playerSessionRuntime = createPlayerSessionRuntime({
    getCurrentDimension: () => currentChunkContext.dimension,
    getLocalEntities: () => Effect.runSync(world.entities.snapshot).entities,
    getAuthoritativeEntities: () => [...multiplayerEntities.entries()],
    getProjectileEntities: () => projectileRenderDescriptors(projectileRuntimeState, currentChunkContext.dimension),
    getEyeOfEnderEntities: () => eyeOfEnderRenderDescriptors(eyeOfEnderRuntimeState, currentChunkContext.dimension),
    getWitherEntities: () => witherRenderDescriptors(witherRuntimeState, currentChunkContext.dimension),
    getRemotePlayers: () => [...(multiplayer?.players.entries() ?? [])],
    getVillagerResidents: () => [...villagerResidents.values()],
    isCurrentChunkLoaded: (position) => currentChunkContext.streamLoaded.has(chunkKeyOf({
      cx: Math.floor(position.x / 16),
      cz: Math.floor(position.z / 16),
    })),
    getEndDragonPhase: () => endDragonSnapshot().phase,
    getEndDragonPosition: endDragonPosition,
    getVehicles: vehicleList,
    syncEntities: (entities) => worldRenderer.syncEntities(entities),
  })
  const { syncRenderedEntities, nearestVillagerForTrade } = playerSessionRuntime

  let stopBrowserPreview: (() => Promise<void>) | undefined
  const qaInstalled = installPlayerQaSurface({
    render: {
      weather,
      getLightingSnapshot: () => currentChunkContext.lightingSnapshot(),
    },
    gameplay: {
      world,
      worldRenderer,
      gameplayState,
      simState,
      playerApi,
      currentChunkStore,
      crops,
      weather,
      vehicleService,
      saveCoordinator,
      multiplayer,
      customNames,
      enchantedItems,
      villagerResidents,
      endPortalFrames,
      portalStates,
      leverStates,
      poweredRails,
      redstoneLampTransitionLog,
      pressurePlateOccupancy,
      pendingItemUses,
      pendingBlockUses,
      observedMobDrops,
      inventoryInteraction,
      redstoneRuntime,
      sessionMetadata,
      isCreativeMode,
      portalLandingSearchBlocks: PORTAL_LANDING_SEARCH_BLOCKS,
      canvas,
      respawnPlayer,
      resetSimState,
      alignActiveDimension,
      markSessionDirty,
      renderPlayerUi,
      applyPlayerDamage,
      streamAround,
      getOrCreateDimensionChunkContext,
      materializePortal,
      registerPortal,
      syncPortalCandidatesFor,
      portalKeyOf,
      leverKeyOf,
      endPortalFrameKey,
      replaceVehicle,
      playerIsDead,
      targetedBlock,
      presentWeather,
      environmentalContactCellsForPose,
      endDragonSnapshot,
      endDragonPosition,
      vehicleList,
      nearestVillagerForTrade,
      survivalHunger,
      setTradeOpen,
      setBrewingOpen,
      setInventoryOpen,
      setFishingResult,
      deleteItemMetadata,
      getActiveSeed: () => activeSeed,
      getCurrentChunkContext: () => currentChunkContext,
      getSelectedHotbarIndex: () => selectedHotbarIndex,
      setSelectedHotbarIndex: (index) => { selectedHotbarIndex = index },
      setInventoryFocus: (focus) => { inventoryFocus = focus },
      getNextBlockUseRequestId: () => nextBlockUseRequestId,
      setNextBlockUseRequestId: (id) => { nextBlockUseRequestId = id },
      getNextItemUseRequestId: () => nextItemUseRequestId,
      setNextItemUseRequestId: (id) => { nextItemUseRequestId = id },
      getLastObservedItemUse: () => lastObservedItemUse,
      setLastObservedItemUse: (result) => { lastObservedItemUse = result },
      setRedstoneDirty: (dirty) => { redstoneDirty = dirty },
      setFishingSession: (session) => { fishingSession = session },
      setFishingWater: (water) => { fishingWater = water },
      getSwimmingState: () => swimmingState,
      setSwimmingState: (state) => { swimmingState = state },
      setNextEyeOfEnderBreaks: (breaks) => { nextEyeOfEnderBreaks = breaks },
      setEnchantmentSeed: (seed) => { enchantmentSeed = seed },
      getEndPortalComplete: () => endPortalComplete,
      setEndPortalComplete: (complete) => { endPortalComplete = complete },
      getExitPortalMaterialized: () => exitPortalMaterialized,
      getDragonEggRewarded: () => dragonEggRewarded,
      getProjectileRuntimeState: () => projectileRuntimeState,
      getEyeOfEnderRuntimeState: () => eyeOfEnderRuntimeState,
      getWitherRuntimeState: () => witherRuntimeState,
      getEnvironmentalContactDamageState: () => environmentalContactDamageState,
      getSimulationElapsedSecs: () => simulationElapsedSecs,
      getInventoryOpen: () => inventoryOpen,
      getInventoryMode: () => inventoryMode,
      getTradeOpen: () => tradeOpen,
      getActiveVillagerId: () => activeVillagerId,
      getTradeStatus: () => tradeStatus,
      getChestStatus: () => chestStatus,
      getActiveChestId: () => activeChestId,
      getChestFocus: () => chestFocus,
      getChestSelected: () => chestSelected,
      getMultiplayerHandshakeComplete: () => multiplayerHandshakeComplete,
    },
    persistence: {
      requestFlush,
    },
    audio: {
      audio,
      audioBackend: adapters.audioBackend,
      browserClock,
    },
    lifecycle: {
      getStopBrowserPreview: () => stopBrowserPreview,
    },
  }, failBoot)
  if (!qaInstalled) return

  const { disposeMultiplayer, disposeRuntime } = installPlayerLifecycle({
    document,
    window,
    autosaveIntervalMs: AUTOSAVE_INTERVAL_MS,
    requestBackgroundFlush,
    resetTouchInput,
    getStopBrowserPreview: () => stopBrowserPreview,
    hasMultiplayer: () => multiplayer !== undefined,
    leaveMultiplayer: () => {
      if (multiplayer === undefined) return
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
    },
    settingsView,
    endAudio,
    weatherAudio,
    clearPendingThunder: adapters.clearPendingThunder,
    removeNativeMouseDown: () => window.removeEventListener('mousedown', handleNativeMouseDown, true),
    disposeWorldRenderer: () => { Effect.runSync(worldRenderer.dispose) },
    disposeAtlasTexture: () => { atlasTexture.dispose() },
    closeAudio: () => { audio.close() },
    registerHotDispose: (callback) => {
      const hot = (import.meta as ImportMeta & {
        readonly hot?: { readonly dispose: (handler: () => void) => void }
      }).hot
      hot?.dispose(callback)
    },
  })

  // -------------------------------------------------------------------------
  // 6. The frame
  // -------------------------------------------------------------------------

  const { runFrame, readNow } = createPlayerFramePreparation({
    makeRunFrame: () => game.runFrameWith(BrowserClockLayer),
    readNow: () => Effect.runSync(browserClock.monotonicSecs),
  })

  let previousSecs: MonotonicTimeSecs | undefined
  let framesTotal = 0
  let renderedCaptionSignature: string | undefined

  document.body.setAttribute('data-mc-compose-boot', 'running')

  const tick = (() => {
    const h5aTickContext: H5aTickContext = {
      firstFrameSecs: FIRST_FRAME_SECS,
      clampDelta,
      inputApi,
      state: {
        touchLookState: mutableState(() => touchLookState, (value) => { touchLookState = value }),
        previousSecs: mutableState(() => previousSecs, (value) => { previousSecs = value }),
        simulationElapsedSecs: mutableState(() => simulationElapsedSecs, (value) => { simulationElapsedSecs = value }),
        redstoneDirty: mutableState(() => redstoneDirty, (value) => { redstoneDirty = value }),
        inventoryOpen: mutableState(() => inventoryOpen, (value) => { inventoryOpen = value }),
        tradeOpen: mutableState(() => tradeOpen, (value) => { tradeOpen = value }),
        brewingOpen: mutableState(() => brewingOpen, (value) => { brewingOpen = value }),
        selectedHotbarIndex: mutableState(() => selectedHotbarIndex, (value) => { selectedHotbarIndex = value }),
        vehicleControls: mutableState(() => vehicleControls, (value) => { vehicleControls = value }),
        nativeInputQueue: mutableState(() => nativeInputQueue, (value) => { nativeInputQueue = value }),
        swimmingState: mutableState(() => swimmingState, (value) => { swimmingState = value }),
        fishingSession: mutableState(() => fishingSession, (value) => { fishingSession = value }),
        fishingWater: mutableState(() => fishingWater, (value) => { fishingWater = value }),
        multiplayerHandshakeComplete: mutableState(() => multiplayerHandshakeComplete, (value) => { multiplayerHandshakeComplete = value }),
        multiplayerClosed: mutableState(() => multiplayerClosed, (value) => { multiplayerClosed = value }),
        lastPlayerMoveSent: mutableState(() => lastPlayerMoveSent, (value) => { lastPlayerMoveSent = value }),
        lastPlayerMoveSentAt: mutableState(() => lastPlayerMoveSentAt, (value) => { lastPlayerMoveSentAt = value }),
        nextItemUseRequestId: mutableState(() => nextItemUseRequestId, (value) => { nextItemUseRequestId = value }),
      },
      touchLook: { consume: consumeTouchLook },
      handlePauseRequest,
      renderCrosshair,
      pointerLock: {
        isLockedToCanvas: () => document.pointerLockElement === canvas,
        exit: () => document.exitPointerLock(),
      },
      paused: () => paused,
      observerPulses,
      multiplayer,
      syncRedstoneSnapshot: () => syncRedstoneSnapshot(currentChunkContext),
      currentChunkContext: () => currentChunkContext,
      world,
      isCreativeMode,
      survivalHunger,
      playerIsDead,
      handleLocalPlayerDeath,
      markSessionDirty,
      syncTouchControls,
      setInventoryOpen,
      setBrewingOpen,
      canvas,
      bowInteractionLocked,
      selectedHotbarAfterInput,
      wrapHotbarSelection,
      sendInventorySelection,
      resetPrimaryAttackGesture,
      sendVitalsCommand,
      consumeNativeInput,
      playerSettings,
      lookSensitivity: LOOK_SENSITIVITY,
      playerApi,
      simState,
      currentChunkStore,
      blockPosition,
      eyeLevelOffset: EYE_LEVEL_OFFSET,
      blockTypeOfId,
      mountedVehicleId: () => mountedVehicleId,
      vehicleById,
      advanceSwimming: advancePlayerSwimmingRuntime,
      presentSwimmingState,
      simPhysicsConfig,
      sprintSpeedMPerSec: SPRINT_SPEED_M_PER_S,
      getPlayerMovementSpeedMultiplier,
      gameplayState,
      time,
      weather,
      syncPortalCandidateSnapshots,
      setFishingResult,
      getOrCreateDimensionChunkContext,
      advanceFishing,
      cancelFishing,
      multiplayerStatus,
      pumpPlayerDamage,
      furnaceStates,
      deferredFurnaceAdvanceSecs,
      pendingFurnaceAdvances,
      requestFurnaceAdvance,
      drainMultiplayerInbound,
      drainCraftingInbound,
      drainBrewingInbound,
      drainAnvilInbound,
      drainEnchantingInbound,
      drainPlayerDamageInbound,
      runFrame,
      applyPlayerDamage,
      failBoot,
      droppedItemLifetime,
      droppedItemMetadata,
      droppedItemMetadataKey,
      isDroppedItemBehaviour,
    }
    const h5bTickContext: H5bPostFrameContext = {
      h5a: { ...h5aTickContext, droppedItemMetadata },
      state: {
        blockBreakCounters: mutableState(() => blockBreakCounters, (value) => { blockBreakCounters = value }),
        environmentalContactDamageState: mutableState(
          () => environmentalContactDamageState,
          (value) => { environmentalContactDamageState = value },
        ),
        witherRuntimeState: mutableState(() => witherRuntimeState, (value) => { witherRuntimeState = value }),
        projectileRuntimeState: mutableState(() => projectileRuntimeState, (value) => { projectileRuntimeState = value }),
        eyeOfEnderRuntimeState: mutableState(() => eyeOfEnderRuntimeState, (value) => { eyeOfEnderRuntimeState = value }),
        bowUseState: mutableState(() => bowUseState, (value) => { bowUseState = value }),
        footstepRuntimeState: mutableState(() => footstepRuntimeState, (value) => { footstepRuntimeState = value }),
        nextWitherCommand: mutableState(() => nextWitherCommand, (value) => { nextWitherCommand = value }),
        nextEnderDragonCommand: mutableState(() => nextEnderDragonCommand, (value) => { nextEnderDragonCommand = value }),
        nextMeleeAttackRequestId: mutableState(() => nextMeleeAttackRequestId, (value) => { nextMeleeAttackRequestId = value }),
        miningProgress: mutableState(() => miningProgress, (value) => { miningProgress = value }),
        primaryAttackGestureConsumed: mutableState(
          () => primaryAttackGestureConsumed,
          (value) => { primaryAttackGestureConsumed = value },
        ),
        activeChestId: mutableState(() => activeChestId, (value) => { activeChestId = value }),
        activeFurnaceKey: mutableState(() => activeFurnaceKey, (value) => { activeFurnaceKey = value }),
        tradeStatus: mutableState(() => tradeStatus, (value) => { tradeStatus = value }),
      },
      inventoryMode: () => inventoryMode,
      activeVillagerId: () => activeVillagerId,
      sendVitalsCommand,
      multiplayerEntities,
      dimensionContexts,
      pendingBlockBreakConfirmations,
      pendingMiningToolDamage,
      customNames,
      enchantedItems,
      containerMetadataKey,
      deleteContainerMetadata,
      containerIdAt,
      furnaceKeyOf,
      isDroppedItemPickupEligible,
      droppedItemMetadataFromBehaviour,
      maxStackCountForItem,
      itemStack,
      observeBlockBreakCompletion,
      recordBlockBreakRequest,
      drainVillagerTradeResults,
      drainPlayerDamages,
      drainPlayerHeals,
      villagerTradeStatus,
      renderPlayerUi,
      renderTradeUi,
      enqueueMultiplayerPlayerMove,
      sendEntityCommand,
      applyPortalTravels,
      applyPlayerDamage,
      settleMeleeAttackResults,
      alignActiveDimension,
      resetSimState,
      resolveFallDamage,
      isStandingOnCell,
      pressurePlateOccupancy,
      environmentalContactsForPose,
      isGameplayBlockSolid,
      applyWorldExplosion,
      resetBowUse,
      projectileHud,
      projectedInventoryEnchantedItem,
      durabilityWearWithEnchantments,
      witherRevision: () => witherRevision,
      enderDragonRevision: () => enderDragonRevision,
      endDragonPosition,
      inventoryMeleeDamage,
      requestIdFor,
      canFireBow,
      bowCharge,
      bowDamage,
      bowDamageWithEnchantments,
      advanceFootstepRuntime,
      surfaceForBlockType,
      audio,
      advanceWitherRuntime,
      damageRuntimeWither,
      advanceProjectileRuntime,
      initialProjectileRuntimeState,
      launchRuntimeProjectile,
      recoverProjectile,
      advanceEyeOfEnderRuntime,
      initialEyeOfEnderRuntimeState,
      advanceBowUse,
      resolveBowHits,
      resolveTargetedPrimaryAttack,
      advanceMiningProgress,
      isLegacyGameplayItemType,
      isSwordItem,
      pendingMeleeAttacks,
      projectEnchantedItem,
      miningLootContextForItem,
      requestMeleeAttack,
      requestBlockBreak,
      requestPotatoHarvest,
      crops,
      pendingItemUses: {
        set: (requestId, pending) => { pendingItemUses.set(requestId, pending) },
      },
      spawnDroppedItems,
    }

    return (): void => {
    const nowSecs = readNow()
    const frameInput = Effect.runSync(inputApi.snapshot)
    try {
      const frame = runTickFrameInput(h5aTickContext, nowSecs, frameInput)
      if (frame === undefined) return
      const movement = runTickPlayerMovement(h5aTickContext, frame)
      if (movement === undefined) return
      const {
        deltaSecs,
        useTriggered,
      } = frame
      const {
        poseBeforeFrame,
        weatherBeforeFrame,
      } = movement
      const {
        deadAfterFrame,
        dimensionChanged,
        postFramePose,
        dimensionAfterFrame,
        bowAdvance,
        groundedAfterFrame,
        playerHeals,
      } = runTickPostFrame(h5bTickContext, { frame, movement, framesTotal })
      let nearbyVillager: PersistedVillager | undefined
      try {
        nearbyVillager = !deadAfterFrame && !dimensionChanged && useTriggered
          ? nearestVillagerForTrade(postFramePose.feetPosition, currentChunkContext.dimension)
          : undefined
      } catch (error) {
        console.warn('Unable to resolve nearby villager for interaction', error)
      }
      if (nearbyVillager !== undefined && !bowAdvance.capturedUse) {
        setTradeOpen(true, nearbyVillager.id)
      }

      if (
        nearbyVillager === undefined
        && !deadAfterFrame
        && useTriggered
        && !bowAdvance.capturedUse
      ) {
        let usedSpecialItem = false
        const fishingStorage = Effect.runSync(world.inventory.storageSnapshot)
        const fishingHeld = fishingStorage.inventory.slots[selectedHotbarIndex]
        const fishingDurability = fishingStorage.inventoryDurability[selectedHotbarIndex]
        if (multiplayer !== undefined && multiplayerHandshakeComplete && (fishingSession !== undefined || fishingHeld?.item === 'fishing_rod')) {
          sendEntityCommand({ _tag: 'FishingCommand', action: networkFishingState.phase === 'idle' ? 'cast' : 'reel' })
          usedSpecialItem = true
        } else if (fishingSession !== undefined) {
          const result = reelFishing(fishingSession)
          Effect.runSync(world.inventory.damageAt(
            { _tag: 'Inventory', slotIndex: selectedHotbarIndex },
            1,
          ))
          if (result._tag === 'Caught') {
            Effect.runSync(world.inventory.add(result.loot.item, result.loot.count))
            setFishingResult(`caught-${result.loot.item}`)
          } else {
            setFishingResult(result._tag === 'ReeledTooEarly' ? 'too-early' : 'too-late')
          }
          fishingSession = undefined
          fishingWater = undefined
          document.body.setAttribute('data-fishing-phase', 'idle')
          markSessionDirty()
          renderPlayerUi()
          usedSpecialItem = true
        } else if (
          fishingHeld?.item === 'fishing_rod' &&
          fishingDurability !== null &&
          fishingDurability !== undefined
        ) {
          const target = Effect.runSync(targetedBlock())
          const dimension = Effect.runSync(playerApi.dimension)
          const environment = target === undefined
            ? { hasWater: false, hasSkyAccess: false, isRaining: false, isOpenWater: false }
            : Effect.runSync(fishingEnvironmentAt(
                target.position,
                weatherBeforeFrame.weather === 'rain' || weatherBeforeFrame.weather === 'thunder',
              ))
          const serial = nextFishingRoll++
          const cast = castFishing({
            item: 'fishing_rod',
            count: StackCount(1),
            durability: fishingDurability,
          } satisfies FishingRod, environment, {
            wait: ((serial * 37) % 997) / 997,
            category: ((serial * 101) % 997) / 997,
            item: ((serial * 211) % 997) / 997,
          })
          if (cast._tag === 'Cast' && target !== undefined) {
            fishingSession = cast.session
            fishingWater = { dimension, position: target.position }
            setFishingResult('cast')
          } else {
            setFishingResult(cast._tag === 'NoWater' ? 'no-water' : 'invalid-rod')
          }
          usedSpecialItem = true
        }
        if (!usedSpecialItem && mountedVehicleId !== undefined) {
          const vehicle = vehicleById(mountedVehicleId)
          if (vehicle !== undefined) Effect.runSync(vehicleService.dismount(vehicle.id, localVehicleOccupant))
          mountedVehicleId = undefined
          usedSpecialItem = true
        } else if (!usedSpecialItem) {
          const pose = Effect.runSync(playerApi.pose)
          const nearbyVehicle = vehicleList()
            .filter((vehicle) => vehicle.dimension === currentChunkContext.dimension && vehicle.occupant === undefined)
            .map((vehicle) => ({ vehicle, distance: Math.hypot(
              vehicle.position.x - pose.feetPosition.x,
              vehicle.position.y - pose.feetPosition.y,
              vehicle.position.z - pose.feetPosition.z,
            ) }))
            .filter(({ distance }) => distance <= 2)
            .sort((left, right) => left.distance - right.distance)[0]
          if (nearbyVehicle !== undefined) {
            const boarded = boardVehicle(nearbyVehicle.vehicle, localVehicleOccupant, nearbyVehicle.distance)
            if (boarded.occupant !== undefined) Effect.runSync(vehicleService.mount(boarded.id, localVehicleOccupant))
            mountedVehicleId = String(boarded.id)
            usedSpecialItem = true
          }
        }
        const specialInventory = Effect.runSync(world.inventory.snapshot)
        const specialSelected = specialInventory.slots[selectedHotbarIndex]
        if (!usedSpecialItem && specialSelected?.item === 'ender_pearl') {
          if (multiplayer !== undefined) {
            sendEntityCommand({ _tag: 'EnderPearlCommand' })
          } else {
            const pose = Effect.runSync(playerApi.pose)
            const horizontal = Math.cos(pose.pitchRadians)
            const origin = {
              x: pose.feetPosition.x,
              y: pose.feetPosition.y + EYE_LEVEL_OFFSET,
              z: pose.feetPosition.z,
            }
            const target = Effect.runSync(targetedBlock())
            const hitDistance = target === undefined
              ? undefined
              : Math.hypot(
                  target.position.x + 0.5 - origin.x,
                  target.position.y + 0.5 - origin.y,
                  target.position.z + 0.5 - origin.z,
                )
            Effect.runSync(Ref.update(gameplayState.pendingPearlThrows, (requests) => [
              ...requests,
              {
                origin,
                inventory: {
                  mode: isCreativeMode ? 'creative' as const : 'survival' as const,
                  slotIndex: selectedHotbarIndex,
                },
                dirX: -Math.sin(pose.yawRadians) * horizontal,
                dirY: Math.sin(pose.pitchRadians),
                dirZ: -Math.cos(pose.yawRadians) * horizontal,
                ...(hitDistance === undefined ? {} : { hitDistance }),
              },
            ]))
            if (!isCreativeMode) {
              Effect.runSync(world.inventory.removeAt(selectedHotbarIndex, 'ender_pearl', 1))
            }
            markSessionDirty()
            renderPlayerUi()
          }
          usedSpecialItem = true
        }
        if (!usedSpecialItem && specialSelected !== undefined && isBucketItem(specialSelected.item)) {
          if (multiplayer !== undefined && multiplayerHandshakeComplete) {
            sendEntityCommand({ _tag: 'BucketUseCommand' })
            usedSpecialItem = true
          } else {
            const target = Effect.runSync(targetedBlock())
            if (target !== undefined) {
              const dimension = Effect.runSync(playerApi.dimension)
              const result = Effect.runSync(useBucket(
                currentChunkStore,
                world.inventory,
                gameplayState.fluidFrontier,
                {
                  activeDimension: dimension,
                  targetDimension: dimension,
                  position: (specialSelected.item === 'bucket'
                    ? blockPosition(target.position.x, target.position.y, target.position.z)
                    : blockPosition(target.adjacentPosition.x, target.adjacentPosition.y, target.adjacentPosition.z)),
                  heldItem: specialSelected.item,
                },
              ))
              document.body.setAttribute('data-bucket-result', result._tag)
              usedSpecialItem = true
              if (result._tag === 'Collected' || result._tag === 'Placed') {
                markSessionDirty()
                renderPlayerUi()
              }
            }
          }
        }
        if (!usedSpecialItem && specialSelected !== undefined
          && (specialSelected.item === 'oak_boat' || specialSelected.item === 'minecart')) {
          if (multiplayer !== undefined && multiplayerHandshakeComplete) {
            sendEntityCommand({ _tag: 'VehicleUseCommand' })
          } else {
            const target = Effect.runSync(targetedBlock())
            if (target !== undefined) {
              const type = specialSelected.item === 'oak_boat' ? 'boat' : 'minecart'
              const item = specialSelected.item
              // A boat aimed at open water must land AT the water block's
              // own cell, not the empty cell adjacent to whichever face was
              // hit — the same reason a minecart lands at the rail's own
              // cell rather than beside it. mx-gameplay's vehicle-frame.ts
              // (`waterAt`) reads whether the BOAT'S OWN cell (or the one
              // above it) is water to decide propulsion; a boat commonly
              // gets placed by aiming down at open water, which hits the
              // water block's TOP face, and `target.adjacentPosition` for a
              // top-face hit is one cell ABOVE the water — never detected as
              // in-water, so the boat only ever gets stepBoat's 15% off-water
              // crawl (~0.05 blocks/sec measured) no matter how it is
              // driven. Landed via a QA-seeded pool and the SAME real
              // right-click placement path in e2e/boat-water.e2e.ts before
              // this fix: placed at water's own y+1, terminal speed 0.048.
              const at = (
                (type === 'minecart' && (blockTypeOfId(target.block) === 'rail' || blockTypeOfId(target.block) === 'powered_rail'))
                || (type === 'boat' && blockTypeOfId(target.block) === 'water')
              )
                ? target.position
                : target.adjacentPosition
              const removed = Effect.runSync(world.inventory.removeAt(selectedHotbarIndex, item, 1))
              if (removed._tag === 'Removed') {
                const spawned = Effect.runSync(vehicleService.spawn(
                  type,
                  Effect.runSync(playerApi.dimension),
                  { x: at.x + 0.5, y: at.y, z: at.z + 0.5 },
                  poseBeforeFrame.yawRadians,
                ))
                replaceVehicle({
                  ...spawned,
                  velocity: type === 'minecart' ? { x: 0, y: 0, z: -0.25 } : { x: 0, y: 0, z: 0 },
                })
                document.body.setAttribute('data-vehicle-result', `placed-${type}`)
                markSessionDirty()
                renderPlayerUi()
              }
            }
          }
          usedSpecialItem = true
        }
        const portalTarget = !usedSpecialItem && multiplayer !== undefined && multiplayerHandshakeComplete
          ? Effect.runSync(targetedBlock())
          : undefined
        const portalBlock = portalTarget === undefined ? undefined : blockTypeOfId(portalTarget.block)
        const usedMultiplayerPortal = portalTarget !== undefined
          && (portalBlock === 'end_portal' || portalBlock === 'nether_portal')
          && sendPortalUseCommand(
            portalTarget.position,
            portalBlock === 'end_portal' ? 'EndPortalUseCommand' : 'NetherPortalUseCommand',
          )
        const usedMultiplayerLever = portalTarget !== undefined
          && blockTypeOfId(portalTarget.block) === 'lever'
        if (usedMultiplayerLever) sendToggleLeverCommand(portalTarget.position)
        const shouldAttemptEndFeature = currentChunkContext.dimension === 'end'
          || endPortalComplete
          || specialSelected?.item === 'eye_of_ender'
        const usedEndFeature = usedSpecialItem
          || usedMultiplayerPortal
          || (shouldAttemptEndFeature && Effect.runSync(useEndFeature()))
        const brewingTarget = usedEndFeature || usedMultiplayerLever ? undefined : Effect.runSync(targetedBlock())
        const opensBrewing = brewingTarget !== undefined && blockTypeOfId(brewingTarget.block) === 'brewing_stand'
        const route = usedEndFeature || usedMultiplayerLever || opensBrewing
          ? undefined
          : Effect.runSync(targetedRightClickRoute(currentChunkStore, playerApi, DEFAULT_BLOCK_REACH))
        if (usedEndFeature || usedMultiplayerLever) {
          renderPlayerUi()
        } else if (opensBrewing) {
          setBrewingOpen(true)
          if (multiplayer !== undefined && brewingTarget !== undefined) {
            activeBrewingStandAt = { ...brewingTarget.position }
            if (!requestBrewing({ _tag: 'open' })) brewingStatus = 'Brewing stand is unavailable'
            renderBrewingUi()
          }
        } else if (route?.kind === 'craftingTable') {
          setInventoryOpen(true, 'craftingTable')
        } else if (route?.kind === 'anvil') {
          setInventoryOpen(true, 'anvil')
        } else if (route?.kind === 'enchantingTable') {
          setInventoryOpen(true, 'enchanting')
        } else if (route?.kind === 'bed') {
          const bedPosition = blockPosition(
            Math.floor(route.at.x),
            Math.floor(route.at.y),
            Math.floor(route.at.z),
          )
          const currentDimension = Effect.runSync(playerApi.dimension)
          if (currentDimension !== 'overworld' && multiplayer !== undefined) {
            document.body.setAttribute('data-sleep-result', 'unavailable')
          } else if (currentDimension !== 'overworld') {
            sleepRuntimeState = leaveSleep(sleepRuntimeState, multiplayer?.query.player ?? 'local')
            Effect.runSync(currentChunkStore.setBlock(bedPosition, blockIdOf('air')))
            applyWorldExplosion(
              { x: bedPosition.x + 0.5, y: bedPosition.y + 0.5, z: bedPosition.z + 0.5 },
              5,
              Math.floor(simulationElapsedSecs * 20),
              false,
            )
            document.body.setAttribute(
              'data-bed-explosion-request',
              `${currentDimension}:${bedPosition.x},${bedPosition.y},${bedPosition.z}`,
            )
            document.body.setAttribute('data-sleep-result', 'exploded')
          } else {
            const hostilePositions = Effect.runSync(world.entities.snapshot).entities
              .filter((entity) => entity.kind !== 'dropped_item')
              .map((entity) => entity.feetPosition)
            const decision = resolveBedSleep({
              bedPosition,
              dangerNearby: isDangerNearby(bedPosition, hostilePositions),
              dimension: currentDimension,
              timeOfDay: Effect.runSync(time.timeOfDay),
              weather: Effect.runSync(weather.snapshot).weather,
            })
            if (decision._tag === 'SleepAccepted') {
              respawnLocation = { ...decision.respawnLocation, bedPosition }
              if (multiplayer === undefined) {
                sleepRuntimeState = enterSleep(sleepRuntimeState, 'local', respawnLocation)
                document.body.setAttribute('data-sleep-result', 'accepted')
              } else {
                const command: SleepCommand = {
                  _tag: 'EnterSleep',
                  actor: multiplayer.query.player,
                  session: String(multiplayer.query.player),
                  requestId: `sleep-${String(nextSleepRequest++)}`,
                  expectedRevision: networkSleepState.revision,
                  clientTick: Math.floor(performance.now()),
                  bed: bedPosition,
                }
                networkSleepState = queueSleepCommand(networkSleepState, command)
                Effect.runFork(multiplayer.transport.sendSleep({ _tag: 'SleepCommand', command }))
                document.body.setAttribute('data-sleep-result', 'pending')
              }
              markSessionDirty()
            } else {
              document.body.setAttribute('data-sleep-result', decision.reason)
            }
          }
        } else if (route?.kind === 'furnace') {
          const dimension = Effect.runSync(playerApi.dimension)
          const position = {
            x: Math.floor(route.at.x),
            y: Math.floor(route.at.y),
            z: Math.floor(route.at.z),
          }
          const key = furnaceKeyOf({ dimension, position })
          if (multiplayer === undefined && !furnaceStates.has(key)) {
            furnaceStates.set(key, { dimension, position, state: emptyFurnaceState() })
            markSessionDirty()
          }
          if (multiplayer === undefined || furnaceStates.has(key)) {
            activeFurnaceKey = key
            setInventoryOpen(true, 'furnace')
          } else {
            multiplayerRejection = 'Furnace is not present in the authoritative snapshot.'
          }
        } else if (route?.kind === 'storage') {
          const dimension = Effect.runSync(playerApi.dimension)
          const position = {
            x: Math.floor(route.at.x),
            y: Math.floor(route.at.y),
            z: Math.floor(route.at.z),
          }
          const id = containerIdAt(dimension, position)
          if (multiplayer !== undefined) {
            const container = Effect.runSync(world.inventory.containerSnapshot(id))
            if (container !== undefined && sendFacilityCommand({
              _tag: 'ContainerCommand',
              containerId: id,
              action: { _tag: 'open' },
            })) {
              activeChestId = id
              setInventoryOpen(true, 'chest')
            }
          } else {
            const localContainerId = containerIdForStorageBlock(dimension, position)
            if (localContainerId !== undefined) {
              activeChestId = localContainerId
              setInventoryOpen(true, 'chest')
            }
          }
        } else {
          const inventoryBeforeUse = Effect.runSync(world.inventory.snapshot)
          const selected = inventoryBeforeUse.slots[selectedHotbarIndex]
          let shouldAttemptPlacement = selected !== undefined
            && !isGameplayUseItemType(selected.item)

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
              const blockTarget = Effect.runSync(resolveTargetedBlock(currentChunkStore, playerApi))
              const blockReading = Option.isSome(blockTarget)
                ? Effect.runSync(currentChunkStore.getBlock(blockPosition(blockTarget.value.position.x, blockTarget.value.position.y, blockTarget.value.position.z)))
                : undefined
              if (
                multiplayer !== undefined &&
                Option.isSome(blockTarget) &&
                blockReading?._tag === 'Block' &&
                blockTypeOfId(blockReading.block) === 'tnt'
              ) {
                sendEntityCommand({ _tag: 'IgniteTntCommand', at: blockTarget.value.position })
              } else {
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
                    dimension: Effect.runSync(playerApi.dimension),
                  })
                }
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
                  const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(target.value.position.x, target.value.position.y, target.value.position.z)))
                  if (reading._tag === 'Block' && reading.block === 76) {
                    pendingBlockUses.set(requestId, {
                      dimension: currentChunkContext.dimension,
                      position: target.value.position,
                    })
                  } else if (reading._tag === 'Block' && reading.block === 77) {
                    Effect.runSync(redstoneRuntime.pressButton(
                      currentChunkContext.dimension,
                      target.value.position,
                    ))
                  } else if (reading._tag === 'Block' && reading.block === 82) {
                    const key = leverKeyOf({
                      dimension: currentChunkContext.dimension,
                      position: target.value.position,
                    })
                    comparatorModes.set(
                      key,
                      comparatorModes.get(key) === 'subtract' ? 'compare' : 'subtract',
                    )
                    redstoneDirty = true
                  } else {
                    Effect.runSync(Ref.set(gameplayState.pendingPlacements, []))
                    nextBlockPlacementRequestId += 1
                    const placementRequestId = `block-placement-${String(nextBlockPlacementRequestId)}`
                    Effect.runSync(requestBlockPlacementCommand(gameplayState, {
                      requestId: placementRequestId,
                      positionKey: `${target.value.adjacentPosition.x},${target.value.adjacentPosition.y},${target.value.adjacentPosition.z}` as Parameters<typeof requestBlockPlacementCommand>[1]['positionKey'],
                      heldItem,
                      mode: isCreativeMode ? 'creative' : 'survival',
                    }))
                    pendingBlockPlacements.set(placementRequestId, {
                      dimension: currentChunkContext.dimension,
                      item: heldItem,
                      position: target.value.adjacentPosition,
                    })
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
      if (multiplayer === undefined) {
        for (const outcome of Effect.runSync(Ref.getAndSet(gameplayState.enderPearlOutcomes, []))) {
          const pose = Effect.runSync(playerApi.pose)
          Effect.runSync(playerApi.moveTo({
            x: pose.feetPosition.x + outcome.displacement.x,
            y: pose.feetPosition.y + outcome.displacement.y,
            z: pose.feetPosition.z + outcome.displacement.z,
          }))
          if (outcome.damage !== undefined) applyPlayerDamage(outcome.damage)
          markSessionDirty()
        }
        for (const knockback of Effect.runSync(drainBowKnockbacks(gameplayState))) {
          let applied = false
          Effect.runSync(world.entities.sweep((entity) => {
            if (entity.id !== knockback.id || entity.healthPoints <= 0) {
              return { transition: UNCHANGED, emit: undefined }
            }
            applied = true
            return {
              transition: changed({
                feetPosition: knockback.direction._tag === 'Away'
                  ? {
                    x: entity.feetPosition.x + knockback.direction.x * 0.35,
                    y: entity.feetPosition.y,
                    z: entity.feetPosition.z + knockback.direction.z * 0.35,
                  }
                  : {
                    x: entity.feetPosition.x,
                    y: entity.feetPosition.y + 0.35,
                    z: entity.feetPosition.z,
                  },
                healthPoints: entity.healthPoints,
                behaviour: entity.behaviour,
              }),
              emit: undefined,
            }
          }))
          if (applied) markSessionDirty()
        }
      }
      const confirmedPlacementItems: GameplayItemType[] = []
      const reservedPlacementItems: GameplayItemType[] = []
      for (const result of Effect.runSync(drainBlockPlacementResults(gameplayState))) {
        const pending = pendingBlockPlacements.get(result.requestId)
        pendingBlockPlacements.delete(result.requestId)
        if (pending === undefined || !result.success) continue
        confirmedPlacementItems.push(pending.item)
        if (result.consumed) reservedPlacementItems.push(pending.item)
        markSessionDirty()
        if (REDSTONE_PLACEMENT_ITEMS.has(pending.item)) redstoneDirty = true
        if (pending.item === 'wither_skeleton_skull') {
          pendingWitherSummonChecks.push(pending as {
            readonly dimension: Dimension
            readonly item: 'wither_skeleton_skull'
            readonly position: { readonly x: number; readonly y: number; readonly z: number }
          })
        }
      }

      // Placement requests are serviced after the frame-start redstone sync.
      // Only the success outbox proves that a component now exists in the store.
      const consumedPlacements = excludeReservedPlacementConsumptions(
        Effect.runSync(Ref.getAndSet(gameplayState.consumedItems, [])),
        reservedPlacementItems,
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
        let summonCheckIndex = -1
        for (let index = pendingWitherSummonChecks.length - 1; index >= 0; index -= 1) {
          if (pendingWitherSummonChecks[index]?.item === item) {
            summonCheckIndex = index
            break
          }
        }
        if (summonCheckIndex >= 0) {
          const [pending] = pendingWitherSummonChecks.splice(summonCheckIndex, 1)
          for (let index = pendingWitherSummonChecks.length - 1; index >= 0; index -= 1) {
            if (pendingWitherSummonChecks[index]?.item === item) {
              pendingWitherSummonChecks.splice(index, 1)
            }
          }
          if (pending !== undefined) {
            const context = dimensionContexts.get(pending.dimension)
            const match = context === undefined ? undefined : matchRuntimeWitherSummon(
              pending.position,
              (cell) => {
                const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(cell.x, cell.y, cell.z)))
                return reading._tag === 'Block' ? blockTypeOfId(reading.block) : undefined
              },
            )
            if (match !== undefined && context !== undefined) {
              for (const position of match.consumedBlocks) {
                Effect.runSync(context.chunkStore.setBlock(blockPosition(position.x, position.y, position.z), blockIdOf('air')))
              }
              witherRuntimeState = summonRuntimeWither(
                witherRuntimeState,
                pending.dimension,
                match.spawnPosition,
              )
              markSessionDirty()
            }
          }
        }
      }
      placementAudio.confirm([...consumedPlacements, ...confirmedPlacementItems])
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

      if (multiplayer === undefined) {
        for (const transition of Effect.runSync(redstoneRuntime.drainLampTransitions)) {
          const context = dimensionContexts.get(transition.dimension as Dimension)
          if (context === undefined) continue
          const lampPosition = asBlockPosition(transition.position)
          Effect.runSync(context.chunkStore.setBlock(lampPosition, transition.lit ? blockIdOf('redstone_lamp_lit') : blockIdOf('redstone_lamp')))
          const confirmedRead = Effect.runSync(context.chunkStore.getBlock(lampPosition))
          const transitionKey = leverKeyOf({ dimension: transition.dimension as Dimension, position: transition.position })
          redstoneLampTransitionLog.set(transitionKey, [
            ...(redstoneLampTransitionLog.get(transitionKey) ?? []),
            { lit: transition.lit, writtenBlock: confirmedRead._tag === 'Block' ? confirmedRead.block : null },
          ])
          markSessionDirty()
        }
        for (const transition of Effect.runSync(redstoneRuntime.drainPistonTransitions)) {
          applyPoweredPistonTransition(transition)
        }
        for (const event of Effect.runSync(redstoneRuntime.drainTriggerEvents)) {
          canvas.setAttribute(
            'data-redstone-trigger',
            `${event.kind}:${event.dimension}:${event.position.x},${event.position.y},${event.position.z}`,
          )
          if (event.kind === 'dispenser') {
            applyDispenserTrigger(event.dimension as Dimension, event.position)
          } else if (event.kind === 'dropper') {
            applyDropperTrigger(event.dimension as Dimension, event.position)
          }
          markSessionDirty()
        }
        for (const event of Effect.runSync(redstoneRuntime.drainHopperTransferEvents)) {
          applyHopperTransfer(event.dimension as Dimension, event.position)
        }
        for (const transition of Effect.runSync(redstoneRuntime.drainPoweredComponentTransitions)) {
          const context = dimensionContexts.get(transition.dimension as Dimension)
          if (context === undefined) continue
          const key = leverKeyOf({
            dimension: transition.dimension as Dimension,
            position: transition.position,
          })
          if (transition.kind === 'door') {
            Effect.runSync(context.chunkStore.setBlock(asBlockPosition(transition.position), transition.powered ? blockIdOf('door_open') : blockIdOf('door')))
          } else if (transition.kind === 'powered-rail') {
            if (transition.powered) poweredRails.add(key)
            else poweredRails.delete(key)
            canvas.setAttribute('data-powered-rail', `${key}:${String(transition.powered)}`)
          }
          markSessionDirty()
        }
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
      const localSleepPlayerId = String(multiplayer?.query.player ?? 'local')
      const connectedSurvivalPlayers = new Set<string>([
        localSleepPlayerId,
        ...[...(multiplayer?.players.keys() ?? [])].map(String),
      ])
      if (multiplayer === undefined && (deadAfterFrame || dimensionChanged)) {
        sleepRuntimeState = leaveSleep(sleepRuntimeState, localSleepPlayerId)
      } else if (multiplayer !== undefined && (deadAfterFrame || dimensionChanged) && networkSleepState.sleepers.has(multiplayer.query.player)) {
        const command: SleepCommand = {
          _tag: 'LeaveSleep',
          actor: multiplayer.query.player,
          session: String(multiplayer.query.player),
          requestId: `sleep-${String(nextSleepRequest++)}`,
          expectedRevision: networkSleepState.revision,
          clientTick: Math.floor(performance.now()),
        }
        networkSleepState = queueSleepCommand(networkSleepState, command)
        Effect.runFork(multiplayer.transport.sendSleep({ _tag: 'SleepCommand', command }))
      }
      if (multiplayer === undefined) sleepRuntimeState = reconcileSleepers(
        sleepRuntimeState,
        connectedSurvivalPlayers,
        (location) => {
          const context = getOrCreateDimensionChunkContext(location.dimension)
          const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(location.bedPosition.x, location.bedPosition.y, location.bedPosition.z)))
          return reading._tag === 'Block' && blockTypeOfId(reading.block) === 'bed'
        },
      )
      const sleepAdvance = multiplayer === undefined ? advanceSleep(
        sleepRuntimeState,
        deltaSecs,
        connectedSurvivalPlayers.size,
        requiredSleepRatio,
        2,
      ) : {
        state: sleepRuntimeState,
        skipToMorning: networkSleepState.skippedRevision === networkSleepState.revision
          && appliedNightSkipRevision !== networkSleepState.revision,
      }
      sleepRuntimeState = sleepAdvance.state
      const requiredSleepers = requiredSleeperCount(connectedSurvivalPlayers.size, requiredSleepRatio)
      sleepHud.textContent = `Sleeping ${String(sleepRuntimeState.sleepers.length)}/${String(requiredSleepers)}`
      sleepHud.hidden = sleepRuntimeState.sleepers.length === 0
      document.body.setAttribute('data-sleeping-players', String(sleepRuntimeState.sleepers.length))
      document.body.setAttribute('data-sleep-required', String(requiredSleepers))
      if (sleepAdvance.skipToMorning) {
        appliedNightSkipRevision = multiplayer === undefined ? null : networkSleepState.revision
        if (multiplayer === undefined) {
          const clearWeather: WeatherState = { weather: 'clear', remainingSecs: 300 }
          Effect.runSync(time.setTimeOfDay(0.25))
          Effect.runSync(weather.applyTransition(clearWeather))
          presentWeather(clearWeather)
          markSessionDirty()
        }
        sleepRuntimeState = initialSleepRuntimeState()
        sleepHud.hidden = true
        document.body.setAttribute('data-sleep-result', 'morning-skipped')
      }
      presentWeatherRuntime(
        weatherAdvanced ?? Effect.runSync(weather.snapshot),
        postFramePose,
        nowSecs,
      )

      const itemUseResults = Effect.runSync(drainItemUseResults(gameplayState))
      for (const result of itemUseResults) {
        if ('action' in result && result.action === 'AdvanceFurnace') {
          const key = pendingFurnaceAdvances.get(result.requestId)
          pendingFurnaceAdvances.delete(result.requestId)
          const furnace = key === undefined ? undefined : furnaceStates.get(key)
          if (key !== undefined && furnace !== undefined) {
            const applied = advanceFurnaceRuntime(furnace.state, result.plan)
            if (applied.deferredSecs > 0) {
              deferredFurnaceAdvanceSecs.set(
                key,
                (deferredFurnaceAdvanceSecs.get(key) ?? 0) + applied.deferredSecs,
              )
            }
            if (applied.changed) {
              furnaceStates.set(key, { ...furnace, state: applied.state })
              markSessionDirty()
              if (inventoryOpen && inventoryMode === 'furnace') renderPlayerUi()
            }
          }
          continue
        }
        lastObservedItemUse = result
        const pending = pendingItemUses.get(result.requestId)
        pendingItemUses.delete(result.requestId)
        if (pending === undefined || !result.success) continue

        if (!('action' in result) && pending.kind === 'ignition' && pending.heldItem === result.heldItem) {
          if (
            result.outcome._tag === 'Portal'
            && result.outcome.outcome._tag === 'Lit'
            && result.outcome.outcome.cells.length === result.outcome.outcome.frame.interior.length
            && result.outcome.outcome.cells.length > 0
          ) {
            const anchor = [...result.outcome.outcome.cells].sort((left, right) =>
              left.y - right.y || left.x - right.x || left.z - right.z
            )[0]
            if (anchor !== undefined) {
              registerPortal({ dimension: pending.dimension, position: anchor })
            }
          }
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
                if (multiplayer !== undefined) {
                  sendVitalsCommand({ _tag: 'eat', item: 'potato' })
                  break
                }
                const removal = Effect.runSync(
                  world.inventory.removeAt(pending.slotIndex, 'potato', result.consumedCount),
                )
                if (removal._tag === 'Removed') {
                  survivalHunger.eat(
                    result.outcome.foodPoints,
                    result.outcome.saturationModifier,
                  )
                }
              }
              break
          }
        }
        markSessionDirty()
      }

      const mobDrops = multiplayer === undefined
        ? Effect.runSync(drainMobDrops(gameplayState))
        : []
      if (mobDrops.length > 0) {
        Effect.runSync(spawnMobDrops(world.entities, mobDrops))
        markSessionDirty()
      }
      for (const drop of mobDrops) {
        nextMobDropId += 1
        observedMobDrops.push({ ...drop, renderId: `mob-drop-${nextMobDropId}` })
      }
      const mobExperience = multiplayer === undefined
        ? Effect.runSync(drainMobExperience(gameplayState))
        : []
      for (const event of mobExperience) {
        const currentVitals = Effect.runSync(world.vitals.snapshot)
        Effect.runSync(world.vitals.restore(addVitalsExperience(currentVitals, event.amount)))
      }
      if (mobExperience.length > 0 || (multiplayer === undefined && playerHeals.length > 0)) markSessionDirty()

      const dragonEvents = multiplayer === undefined
        ? Effect.runSync(gameplayState.enderDragonEncounter.drainEvents)
        : []
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
              Effect.runSync(spawnDroppedItems(world.entities, [{
                item: event.item,
                count: event.count,
                at: endDragonPosition(),
              }]))
              dragonEggRewarded = true
            }
            break
          case 'ExitPortalMaterializationRequested':
            if (!exitPortalMaterialized) {
              const portalY = 64
              for (let x = -1; x <= 1; x += 1) {
                for (let z = -1; z <= 1; z += 1) {
                  Effect.runSync(currentChunkStore.setBlock(blockPosition(x, portalY, z), END_PORTAL_BLOCK.PORTAL))
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
      const dragonSnapshot = endDragonSnapshot()
      canvas.setAttribute('data-end-dragon-phase', dragonSnapshot.phase)
      canvas.setAttribute('data-end-dragon-health', String(dragonSnapshot.health))
      endAudio.update({
        dimension: dimensionAfterFrame,
        phase: dragonSnapshot.phase === 'dead' ? 'defeated' : 'active',
        nowSecs,
        listener: postFramePose.feetPosition,
        listenerForward: adapters.getReadAudioListenerForward(),
        events: adapters.drainEndAudioEvents(),
      })

      syncRenderedEntities()
      if (brewingOpen) renderBrewingUi()
      renderPlayerUi()
      renderCrosshair(nowSecs)
      const captions = playerSettings.captionsEnabled ? audio.visible(KernelMonotonicTimeSecs(nowSecs)) : []
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
    } finally {
      Effect.runSync(inputApi.endFrame(frameInput))
    }
    }
  })()

  const preview = Effect.runSync(makeBrowserPreview({
    container: gameShell,
    canvas,
    startRuntime: (surface) => Effect.sync(() => {
      const hiddenNetworkPump = window.setInterval(() => {
        if (
          document.visibilityState !== 'hidden'
          || multiplayerInboundStage === undefined
          || multiplayerOutboundStage === undefined
        ) return
        Effect.runSync(multiplayerInboundStage.run(DeltaTimeSecs(0)).pipe(Effect.provide(BrowserClockLayer)))
        drainMultiplayerInbound()
        drainCraftingInbound()
        drainBrewingInbound()
        drainAnvilInbound()
        drainEnchantingInbound()
        drainPlayerDamageInbound()
        syncRenderedEntities()
        enqueueMultiplayerPlayerMove(performance.now() / 1_000)
        Effect.runSync(multiplayerOutboundStage.run(DeltaTimeSecs(0)).pipe(Effect.provide(BrowserClockLayer)))
      }, 100)
      surface.onCleanup(() => {
        window.clearInterval(hiddenNetworkPump)
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
  return bootGame(route)
}

boot().catch((error: unknown) => {
  if (error instanceof RequestedSessionNotFoundError) {
    window.location.replace('/?loadError=missing-session')
    return
  }
  failBoot('boot threw', error)
})
