/**
 * The QA surface, extracted out of `bootGame` so `main.ts` shrinks toward pure
 * assembly (the same job `host-modules.ts` already does for registration).
 *
 * `bootGame` still owns every piece of live state the QA commands read or
 * write. That state crosses the boundary as grouped, concretely-typed dep
 * sub-objects, and every mutable `let` the QA section mutates arrives as an
 * explicit getter/action closure rather than a snapshot, so a value reassigned
 * later in the frame loop stays visible here.
 *
 * The functions that are pure (imported module functions like `blockPosition`,
 * `surfaceHeightAt`, `snapshotVillagerTrades`) are re-imported from their
 * owning packages rather than threaded through `deps`; only what is
 * `bootGame`-local — the constructed services, the local helper closures, and
 * the live-state accessors — crosses the dep boundary.
 */
import { Effect, Either, Option, Ref } from 'effect'
import {
  BlockId,
  blockIdOf,
  blockPosition,
  type BlockPosition,
  type ClockService,
  type Position as Vec3,
} from '@nerima-games/mc-kernel'
import {
  biomeFor,
  DEFAULT_TERRAIN_LEVELS,
  END_PORTAL_BLOCK,
  END_PORTAL_FRAME_OFFSETS,
  endPortalCenterForStronghold,
  nearestStrongholdSite,
  overworldToNether,
  surfaceHeightAt,
  villageVillagerSpawnsForChunk,
  type ChunkStoreApi,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import {
  type ChunkMesher,
  type DirtySource,
  type SyncOptions,
  type WorldRenderer,
} from '@nerima-games/mc-render'
import {
  addExperience as addVitalsExperience,
  totalExperienceAtLevel,
  POTATO_MATURITY_SECS,
  type CropLocation,
  type CropServiceApi,
  type PlayerServiceApi,
  type SimFrameState,
  type Vehicle,
  type VehicleServiceApi,
  type WeatherServiceApi,
  type WeatherState,
} from '@nerima-games/mc-sim'
import {
  BLAZE_KIND,
  CREEPER_KIND,
  ENDERMAN_KIND,
  EYE_LEVEL_OFFSET,
  PLAYER_HALF_WIDTH,
  ZOMBIE_KIND,
  emptyBrewingStandState,
  emptyStatusEffectState,
  enchantmentOffers,
  initialBehaviourOfKind,
  isDroppedItemBehaviour,
  requestBowShot,
  requestItemUse,
  requestMobSpawn,
  requestPotatoHarvest,
  requestTargetedBlockBreak,
  requestTargetedBlockUse,
  restoreBrewingStand,
  restoreStatusEffects,
  snapshotBrewingStand,
  snapshotStatusEffects,
  snapshotVillagerTrades,
  weatherLightScale,
  type Damage,
  type EnchantedItem,
  type EnvironmentalContact,
  type EnvironmentalContactDamageState,
  type EnderDragonEncounterSnapshot,
  type FishingSession,
  type GameplayFrameState,
  type GeneratedWorld,
  type HoeItemType,
  type IgnitionItemType,
  type ItemUseResult,
  type MobBehaviour,
  type MobDropEvent,
} from '@nerima-games/mx-gameplay'
import {
  WorldId,
  type MultiplayerHost,
  type PlayerId,
} from '@nerima-games/mx-multiplayer'
import { type WebAudioBackend } from '@nerima-games/mc-audio'
import { type RedstoneWorldRuntimeService } from '@nerima-games/mx-redstone'
import {
  type ChestStorageSlotTarget,
  type InventoryInteractionTarget,
} from '@nerima-games/mx-ui'
import { buildQaRegistry, installQaApi, type QaApiError } from '../../src/domain/qa-api'
import {
  FARMLAND_BLOCK_ID,
  KNOWN_TARGET_BLOCK,
  OBSIDIAN_BLOCK_ID,
  POTATO_CROP_BLOCK_ID,
  QA_CACTUS_APPROACH_POSE,
  QA_ENVIRONMENT_CONTACT_CELLS,
  QA_ENVIRONMENT_FLOOR_CELLS,
  QA_ENVIRONMENT_OVERLAP_POSE,
  QA_FALL_CENTER,
  QA_FALL_FLOOR_Y,
  QA_FALL_START_Y,
  QA_FARM_CROP_BLOCK,
  QA_FARM_POSE,
  QA_IGNITION_CELL,
  QA_IGNITION_FLOOR_BLOCK,
  QA_IGNITION_HIT_BLOCK,
  QA_IGNITION_POSE,
  QA_IGNITION_PORTAL_LAYOUT,
  QA_IGNITION_SUPPORT_BLOCK,
  QA_PISTON,
  QA_PISTON_FAR,
  QA_PISTON_LEVER,
  QA_PISTON_NEAR,
  QA_PORTAL_ANCHOR,
  QA_PORTAL_LAYOUT,
  QA_PORTAL_POSE,
  QA_POSE,
  QA_RAIL_POSE,
  QA_RAIL_TRACK_CELLS,
  QA_RAIL_TRACK_HEIGHT,
  QA_RAIL_TRACK_ORIGIN,
  QA_RAIL_TRACK_WIDTH,
  QA_REDSTONE_BRANCH_BUTTON,
  QA_REDSTONE_BRANCH_WIRE,
  QA_REDSTONE_BUTTON,
  QA_REDSTONE_COMPARATOR,
  QA_REDSTONE_DISPENSER,
  QA_REDSTONE_DOOR,
  QA_REDSTONE_HOPPER,
  QA_REDSTONE_LAMP,
  QA_REDSTONE_OBSERVER,
  QA_REDSTONE_OBSERVER_INPUT,
  QA_REDSTONE_OBSERVER_LAMP,
  QA_REDSTONE_PLATE,
  QA_REDSTONE_PLATE_FLOOR,
  QA_REDSTONE_PLATE_LAMP,
  QA_REDSTONE_PLATE_WIRE,
  QA_REDSTONE_RAIL,
  QA_REDSTONE_REPEATER,
  QA_WATER_CELLS,
  QA_WATER_ORIGIN,
  QA_WATER_PLACEMENT_POSE,
  QA_WATER_SIZE,
} from './qa-fixtures'
import { type RenderLightingSnapshot } from './render-lighting'
import {
  initialPlayerSwimmingRuntimeState,
  type PlayerSwimmingRuntimeState,
} from './player-swimming-runtime'
import { projectileRuntimeSnapshot, type ProjectileRuntimeState } from './projectile-runtime'
import { eyeOfEnderRuntimeSnapshot, type EyeOfEnderRuntimeState } from './eye-of-ender-runtime'
import { snapshotWitherRuntime, type WitherRuntimeState } from '../multiplayer-shared/wither-runtime'
import {
  SESSION_FORMAT_VERSION,
  type PersistedEndPortalFrameState,
  type PersistedLeverState,
  type PersistedPortalState,
  type PersistedVillager,
  type SessionMetadata,
  type SessionPosition,
} from './session-persistence'
import { type SurvivalHungerCoordinator } from './survival-hunger-runtime'
import { type SessionSaveCoordinator } from './session-save-coordinator'
import { type AudioRuntime } from './audio-runtime'

/**
 * A QA command published by a module that owns it. Kept in sync with
 * `QaNamespace`/`QaCommand` in `src/domain/qa-api`; the host only authors the
 * namespace entries and lets compose validate and merge them.
 */
export type QaSurfaceApi = {
  readonly install: () => void
}

/** The chunk context QA helpers stream around. Structurally identical to the
 * `DimensionChunkContext` `bootGame` builds, so the `streamAround` and
 * `getOrCreateDimensionChunkContext` closures accept it without a cast. */
export type QaChunkContext = {
  readonly dimension: Dimension
  readonly chunkStore: ChunkStoreApi
  readonly worldgenChunkStore: ChunkStoreApi
  readonly dirtyChunks: DirtySource
  readonly queueLoadedChunk: (chunk: { cx: number; cz: number }) => void
  readonly meshChunkFromStore: ChunkMesher
  readonly colorForChunk: NonNullable<SyncOptions['colorForChunk']>
  readonly lightingSnapshot: () => RenderLightingSnapshot
  readonly streamLoaded: Set<string>
}

export type QaMultiplayerRuntime = {
  readonly query: { readonly player: PlayerId }
  readonly host: MultiplayerHost
}

export type QaPose = {
  readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  readonly yawRadians: number
  readonly pitchRadians: number
}

export type PendingItemUse =
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

export type PendingBlockUse = {
  readonly dimension: Dimension
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
}

export type EnvironmentalContactCell = EnvironmentalContact & {
  readonly position: { readonly x: number; readonly y: number; readonly z: number }
}

export type InventoryMode = 'player' | 'craftingTable' | 'furnace' | 'chest' | 'anvil' | 'enchanting'

export type PortalLayout = {
  readonly frame: ReadonlyArray<SessionPosition>
  readonly interior: ReadonlyArray<SessionPosition>
}

/**
 * The dependency bundle for the QA surface, grouped by namespace rather than
 * flattened. Each field is concrete: no `any`, no `unknown`, no `ReturnType`
 * over a factory. Mutable `let` bindings cross as getter/action closures.
 */
export type QaSurfaceDeps = {
  readonly render: {
    readonly weather: WeatherServiceApi
    readonly getLightingSnapshot: () => RenderLightingSnapshot
  }
  readonly gameplay: {
    readonly world: GeneratedWorld<MobBehaviour>
    readonly worldRenderer: WorldRenderer
    readonly gameplayState: GameplayFrameState
    readonly simState: SimFrameState
    readonly playerApi: PlayerServiceApi
    readonly currentChunkStore: ChunkStoreApi
    readonly crops: CropServiceApi
    readonly weather: WeatherServiceApi
    readonly vehicleService: VehicleServiceApi
    readonly saveCoordinator: SessionSaveCoordinator
    readonly multiplayer: QaMultiplayerRuntime | undefined
    readonly customNames: Map<string, string>
    readonly enchantedItems: Map<string, EnchantedItem>
    readonly villagerResidents: Map<string, PersistedVillager>
    readonly endPortalFrames: Map<string, PersistedEndPortalFrameState>
    readonly portalStates: Map<string, PersistedPortalState>
    readonly leverStates: Map<string, PersistedLeverState>
    readonly poweredRails: Set<string>
    readonly redstoneLampTransitionLog: Map<string, ReadonlyArray<{ readonly lit: boolean; readonly writtenBlock: BlockId | null }>>
    readonly pressurePlateOccupancy: Map<string, { readonly dimension: Dimension; readonly position: SessionPosition; readonly occupied: boolean }>
    readonly pendingItemUses: Map<string, PendingItemUse>
    readonly pendingBlockUses: Map<string, PendingBlockUse>
    readonly observedMobDrops: ReadonlyArray<MobDropEvent & { readonly renderId: string }>
    readonly inventoryInteraction: { readonly reset: () => void }
    readonly redstoneRuntime: RedstoneWorldRuntimeService
    readonly sessionMetadata: SessionMetadata
    readonly isCreativeMode: boolean
    readonly portalLandingSearchBlocks: number
    readonly canvas: HTMLCanvasElement

    readonly respawnPlayer: () => void
    readonly resetSimState: (physicsEnabled: boolean) => void
    readonly alignActiveDimension: (dimension: Dimension) => boolean
    readonly markSessionDirty: () => void
    readonly renderPlayerUi: () => void
    readonly applyPlayerDamage: (damage: Damage) => void
    readonly streamAround: (context: QaChunkContext, x: number, z: number) => Effect.Effect<void>
    readonly getOrCreateDimensionChunkContext: (dimension: Dimension) => QaChunkContext
    readonly materializePortal: (dimension: Dimension, layout: PortalLayout) => Effect.Effect<void>
    readonly registerPortal: (portal: PersistedPortalState) => boolean
    readonly syncPortalCandidatesFor: (dimension: Dimension) => Effect.Effect<void>
    readonly portalKeyOf: (portal: Pick<PersistedPortalState, 'dimension' | 'position'>) => string
    readonly leverKeyOf: (lever: Pick<PersistedLeverState, 'dimension' | 'position'>) => string
    readonly endPortalFrameKey: (position: SessionPosition) => string
    readonly replaceVehicle: (vehicle: Vehicle) => void
    readonly playerIsDead: () => boolean
    readonly targetedBlock: () => Effect.Effect<{
      readonly position: SessionPosition
      readonly adjacentPosition: SessionPosition
      readonly block: number
    } | undefined>
    readonly presentWeather: (state: WeatherState) => void
    readonly environmentalContactCellsForPose: (pose: { readonly feetPosition: Vec3 }) => ReadonlyArray<EnvironmentalContactCell>
    readonly endDragonSnapshot: () => EnderDragonEncounterSnapshot
    readonly endDragonPosition: () => SessionPosition
    readonly vehicleList: () => ReadonlyArray<Vehicle>
    readonly nearestVillagerForTrade: (position: SessionPosition, dimension: Dimension) => PersistedVillager | undefined
    readonly survivalHunger: SurvivalHungerCoordinator
    readonly setTradeOpen: (open: boolean, villagerId?: string) => void
    readonly setBrewingOpen: (open: boolean) => void
    readonly setInventoryOpen: (open: boolean, mode?: InventoryMode) => void
    readonly setFishingResult: (result: string) => void
    readonly deleteItemMetadata: (key: string) => void

    readonly getActiveSeed: () => number
    readonly getCurrentChunkContext: () => QaChunkContext
    readonly getSelectedHotbarIndex: () => number
    readonly setSelectedHotbarIndex: (index: number) => void
    readonly setInventoryFocus: (focus: InventoryInteractionTarget) => void
    readonly getNextBlockUseRequestId: () => number
    readonly setNextBlockUseRequestId: (id: number) => void
    readonly getNextItemUseRequestId: () => number
    readonly setNextItemUseRequestId: (id: number) => void
    readonly getLastObservedItemUse: () => ItemUseResult | undefined
    readonly setLastObservedItemUse: (result: ItemUseResult | undefined) => void
    readonly setRedstoneDirty: (dirty: boolean) => void
    readonly setFishingSession: (session: FishingSession | undefined) => void
    readonly setFishingWater: (water: { readonly dimension: Dimension; readonly position: SessionPosition } | undefined) => void
    readonly getSwimmingState: () => PlayerSwimmingRuntimeState
    readonly setSwimmingState: (state: PlayerSwimmingRuntimeState) => void
    readonly setNextEyeOfEnderBreaks: (breaks: boolean) => void
    readonly setEnchantmentSeed: (seed: number) => void
    readonly getEndPortalComplete: () => boolean
    readonly setEndPortalComplete: (complete: boolean) => void
    readonly getExitPortalMaterialized: () => boolean
    readonly getDragonEggRewarded: () => boolean
    readonly getProjectileRuntimeState: () => ProjectileRuntimeState
    readonly getEyeOfEnderRuntimeState: () => EyeOfEnderRuntimeState
    readonly getWitherRuntimeState: () => WitherRuntimeState
    readonly getEnvironmentalContactDamageState: () => EnvironmentalContactDamageState
    readonly getSimulationElapsedSecs: () => number
    readonly getInventoryOpen: () => boolean
    readonly getInventoryMode: () => InventoryMode
    readonly getTradeOpen: () => boolean
    readonly getActiveVillagerId: () => string | undefined
    readonly getTradeStatus: () => string
    readonly getChestStatus: () => string
    readonly getActiveChestId: () => string | undefined
    readonly getChestFocus: () => ChestStorageSlotTarget
    readonly getChestSelected: () => ChestStorageSlotTarget | undefined
    readonly getMultiplayerHandshakeComplete: () => boolean
  }
  readonly persistence: {
    readonly requestFlush: () => Promise<void>
  }
  readonly audio: {
    readonly audio: AudioRuntime
    readonly audioBackend: WebAudioBackend
    readonly browserClock: ClockService
  }
  readonly lifecycle: {
    readonly getStopBrowserPreview: () => (() => Promise<void>) | undefined
  }
}

export const makeQaSurface = (
  deps: QaSurfaceDeps,
): Either.Either<QaSurfaceApi, QaApiError> => {
  const { render, gameplay, persistence, audio, lifecycle } = deps
  const { weather: renderWeather, getLightingSnapshot } = render
  const {
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
    portalLandingSearchBlocks,
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
    getActiveSeed,
    getCurrentChunkContext,
    getSelectedHotbarIndex,
    setSelectedHotbarIndex,
    setInventoryFocus,
    getNextBlockUseRequestId,
    setNextBlockUseRequestId,
    getNextItemUseRequestId,
    setNextItemUseRequestId,
    getLastObservedItemUse,
    setLastObservedItemUse,
    setRedstoneDirty,
    setFishingSession,
    setFishingWater,
    getSwimmingState,
    setSwimmingState,
    setNextEyeOfEnderBreaks,
    setEnchantmentSeed,
    getEndPortalComplete,
    setEndPortalComplete,
    getExitPortalMaterialized,
    getDragonEggRewarded,
    getProjectileRuntimeState,
    getEyeOfEnderRuntimeState,
    getWitherRuntimeState,
    getEnvironmentalContactDamageState,
    getSimulationElapsedSecs,
    getInventoryOpen,
    getInventoryMode,
    getTradeOpen,
    getActiveVillagerId,
    getTradeStatus,
    getChestStatus,
    getActiveChestId,
    getChestFocus,
    getChestSelected,
    getMultiplayerHandshakeComplete,
  } = gameplay
  const { requestFlush } = persistence
  const { audio: audioRuntime, audioBackend, browserClock } = audio
  const { getStopBrowserPreview } = lifecycle

  const gameplaySnapshot = () => {
    const pose = Effect.runSync(playerApi.pose)
    const dimension = Effect.runSync(playerApi.dimension)
    const reading = Effect.runSync(currentChunkStore.getBlock(KNOWN_TARGET_BLOCK))
    const ignitionReading = Effect.runSync(currentChunkStore.getBlock(QA_IGNITION_CELL))
    const bedExplosionProbeReading = Effect.runSync(
      currentChunkStore.getBlock(QA_IGNITION_HIT_BLOCK),
    )
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
      : Effect.runSync(currentChunkStore.getBlock(blockPosition(activePortal.position.x, activePortal.position.y, activePortal.position.z)))
    const activePortalFramePosition = activePortal === undefined
      ? undefined
      : blockPosition(
          activePortal.position.x - 1,
          activePortal.position.y - 1,
          activePortal.position.z,
        )
    const activePortalFrameReading = activePortalFramePosition === undefined
      ? undefined
      : Effect.runSync(currentChunkStore.getBlock(activePortalFramePosition))
    return {
      mode: sessionMetadata.mode,
      pose,
      dimension,
      activeChunkDimension: getCurrentChunkContext().dimension,
      environmentalContact: {
        simulationElapsedSecs: getSimulationElapsedSecs(),
        lastDamageElapsedSecs: getEnvironmentalContactDamageState().lastDamageElapsedSecs ?? null,
        cells: environmentalContactCellsForPose(pose),
      },
      fall: {
        grounded: Effect.runSync(Ref.get(simState.isGrounded)),
        accumulatedDistance: Effect.runSync(Ref.get(simState.accumulatedFallDistance)),
      },
      swimming: getSwimmingState(),
      projectiles: projectileRuntimeSnapshot(getProjectileRuntimeState()),
      eyesOfEnder: eyeOfEnderRuntimeSnapshot(getEyeOfEnderRuntimeState()),
      wither: snapshotWitherRuntime(getWitherRuntimeState()),
      weather: Effect.runSync(weather.snapshot),
      vitals,
      dead: vitals.healthPoints <= 0,
      inventory: {
        slots: inventory.slots.map((slot) => slot ?? null),
        durability: storage.inventoryDurability,
        equipment: storage.equipment.slots,
      },
      containerStorage,
      itemMetadata: {
        customNames: Object.fromEntries(customNames),
        enchantedItems: Object.fromEntries(enchantedItems),
      },
      chestUi: {
        open: getInventoryOpen() && getInventoryMode() === 'chest',
        activeChestId: getActiveChestId() ?? null,
        selectedSlot: getChestSelected() ?? null,
        focusedSlot: getChestFocus(),
        status: getChestStatus(),
      },
      villagerUi: {
        open: getTradeOpen(),
        activeVillagerId: getActiveVillagerId() ?? null,
        status: getTradeStatus(),
      },
      villagers: [...villagerResidents.values()],
      villagerTrades: Effect.runSync(snapshotVillagerTrades(gameplayState)),
      brewing: Effect.runSync(snapshotBrewingStand(gameplayState)),
      statusEffects: Effect.runSync(snapshotStatusEffects(gameplayState)),
      end: {
        frames: [...endPortalFrames.values()],
        portalComplete: getEndPortalComplete(),
        dragon: endDragonSnapshot(),
        exitPortalMaterialized: getExitPortalMaterialized(),
        dragonEggRewarded: getDragonEggRewarded(),
      },
      entityCount: entities.length,
      renderedEntities: Effect.runSync(worldRenderer.entitySnapshot),
      mobDrops: observedMobDrops.map(({ renderId: _, ...drop }) => drop),
      itemUse: getLastObservedItemUse() ?? null,
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
      bedExplosionProbe: {
        reading: bedExplosionProbeReading._tag,
        block: bedExplosionProbeReading._tag === 'Block' ? bedExplosionProbeReading.block : null,
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
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    pendingItemUses.clear()
    setLastObservedItemUse(undefined)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const stickyPistonSnapshot = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const readBlock = (position: { readonly x: number; readonly y: number; readonly z: number }) => {
      const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(position.x, position.y, position.z)))
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
    // The player spawns at QA_IGNITION_POSE, which sibling fixtures pin to
    // solid ground with QA_IGNITION_FLOOR_BLOCK — this fixture omitted it, so
    // the player fell through unset terrain for the whole encounter, shifting
    // eye height enough that a right-click landed several seconds apart could
    // miss the lever's raycast (see main.ts's other QA_IGNITION_FLOOR_BLOCK
    // fixtures for the same bug already fixed once).
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_LEVER, blockIdOf('lever')))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON, blockIdOf('piston')))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_NEAR, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_PISTON_FAR, blockIdOf('air')))
    leverStates.set(leverKeyOf({ dimension, position: QA_PISTON_LEVER }), {
      dimension,
      position: QA_PISTON_LEVER,
      active: false,
    })
    pendingBlockUses.clear()
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    setRedstoneDirty(true)
    markSessionDirty()
    renderPlayerUi()
    return stickyPistonSnapshot()
  }

  const redstoneFixturesSnapshot = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const readBlock = (position: { readonly x: number; readonly y: number; readonly z: number }) => {
      const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(position.x, position.y, position.z)))
      return reading._tag === 'Block' ? reading.block : null
    }
    return {
      button: readBlock(QA_REDSTONE_BUTTON),
      repeater: readBlock(QA_REDSTONE_REPEATER),
      lamp: readBlock(QA_REDSTONE_LAMP),
      door: readBlock(QA_REDSTONE_DOOR),
      poweredRail: poweredRails.has(leverKeyOf({ dimension, position: QA_REDSTONE_RAIL })),
      dispenser: readBlock(QA_REDSTONE_DISPENSER),
      hopper: readBlock(QA_REDSTONE_HOPPER),
      observer: readBlock(QA_REDSTONE_OBSERVER),
      observerLamp: readBlock(QA_REDSTONE_OBSERVER_LAMP),
      observerLampTransitions: redstoneLampTransitionLog.get(
        leverKeyOf({ dimension, position: QA_REDSTONE_OBSERVER_LAMP }),
      ) ?? [],
      comparator: readBlock(QA_REDSTONE_COMPARATOR),
      trigger: canvas.getAttribute('data-redstone-trigger'),
      pressurePlate: pressurePlateOccupancy.get(
        leverKeyOf({ dimension, position: QA_REDSTONE_PLATE }),
      )?.occupied ?? false,
      pressurePlateLamp: readBlock(QA_REDSTONE_PLATE_LAMP),
    }
  }

  const seedRedstoneFixtures = () => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, dimension))
    resetSimState(true)
    // Every sibling seed*Encounter fixture (seedBoatWaterEncounter,
    // seedPortalEncounter, seedRailTrackEncounter, ...) streams its own
    // coordinates in before writing blocks there; this one did not. A caller
    // that teleports the player far away first (another fixture, a real
    // player wandering) evicts this area from `currentChunkContext`'s
    // `streamLoaded` set, and `currentChunkStore.setBlock` on an unloaded
    // chunk is a silent no-op — every fixture write below then does nothing,
    // and `redstoneFixturesSnapshot` reads back nulls. A real click on the
    // (never-placed) button then has nothing to act on: the input path is
    // fine, there is simply no button there.
    Effect.runSync(streamAround(getCurrentChunkContext(), QA_IGNITION_POSE.feetPosition.x, QA_IGNITION_POSE.feetPosition.z))
    // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file: fixtures
    // that restore the player to QA_IGNITION_POSE without it leave the
    // player free-falling for the whole encounter.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('stone', 1))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    const fixtures: ReadonlyArray<readonly [BlockPosition, BlockId]> = [
      [QA_REDSTONE_BUTTON, blockIdOf('stone_button')],
      [QA_REDSTONE_REPEATER, blockIdOf('repeater')],
      [QA_REDSTONE_LAMP, blockIdOf('redstone_lamp')],
      [QA_REDSTONE_BRANCH_BUTTON, blockIdOf('stone_button')],
      [QA_REDSTONE_BRANCH_WIRE, blockIdOf('redstone_wire')],
      [QA_REDSTONE_DOOR, blockIdOf('door')],
      [QA_REDSTONE_RAIL, blockIdOf('powered_rail')],
      [QA_REDSTONE_DISPENSER, blockIdOf('dispenser')],
      [QA_REDSTONE_HOPPER, blockIdOf('hopper')],
      [QA_REDSTONE_OBSERVER, blockIdOf('observer')],
      [QA_REDSTONE_OBSERVER_INPUT, blockIdOf('stone')],
      [QA_REDSTONE_OBSERVER_LAMP, blockIdOf('redstone_lamp')],
      [QA_REDSTONE_COMPARATOR, blockIdOf('comparator')],
      // Walkway and support floor for QA_REDSTONE_PLATE, in the same spirit as
      // QA_IGNITION_FLOOR_BLOCK above — real WASD input needs solid ground the
      // whole way, not just at spawn, and the plate/wire/lamp each need their
      // own floor tile now that they sit a cell above it (qa-fixtures.ts).
      ...QA_REDSTONE_PLATE_FLOOR.map((position): readonly [BlockPosition, BlockId] =>
        [position, blockIdOf('stone')]),
      [QA_REDSTONE_PLATE, blockIdOf('pressure_plate')],
      [QA_REDSTONE_PLATE_WIRE, blockIdOf('redstone_wire')],
      [QA_REDSTONE_PLATE_LAMP, blockIdOf('redstone_lamp')],
    ]
    for (const [position, block] of fixtures) {
      Effect.runSync(currentChunkStore.setBlock(position, block))
    }
    poweredRails.delete(leverKeyOf({ dimension, position: QA_REDSTONE_RAIL }))
    redstoneLampTransitionLog.clear()
    pressurePlateOccupancy.clear()
    canvas.removeAttribute('data-redstone-trigger')
    setRedstoneDirty(true)
    markSessionDirty()
    return redstoneFixturesSnapshot()
  }

  const pressRedstoneBranchButton = () => {
    Effect.runSync(redstoneRuntime.pressButton(
      Effect.runSync(playerApi.dimension),
      QA_REDSTONE_BRANCH_BUTTON,
    ))
    return redstoneFixturesSnapshot()
  }

  const mutateObserverInput = () => {
    Effect.runSync(currentChunkStore.setBlock(QA_REDSTONE_OBSERVER_INPUT, blockIdOf('dirt')))
    setRedstoneDirty(true)
    return redstoneFixturesSnapshot()
  }

  const railTrackSnapshot = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const cart = vehicleList().find(
      (vehicle) => vehicle.type === 'minecart' && vehicle.dimension === dimension,
    )
    return {
      cart: cart === undefined ? null : { position: cart.position, velocity: cart.velocity },
    }
  }

  // Closes the testability gap left by the minecart-corners fix: that fix has
  // package-level proof (mx-gameplay's own closed-rectangle regression guard)
  // but nothing reachable from the running game, since the only production
  // path that spawns a minecart is a real right-click against a rail block,
  // and a fresh session's starter kit holds neither a minecart nor rail. This
  // fixture drives the cart through the SAME vehicleService and frame stage
  // (gameplayStages, wired at this file's registerModule call) production
  // play uses — it seeds track and a moving cart, not a hand-stepped
  // position, so what the browser observes afterward is the real simulation
  // turning the corners, not a QA-only substitute for it.
  const seedRailTrackEncounter = () => {
    respawnPlayer()
    const dimension = Effect.runSync(playerApi.dimension)
    for (const vehicle of vehicleList()) {
      if (vehicle.type === 'minecart' && vehicle.dimension === dimension) {
        Effect.runSync(vehicleService.despawn(vehicle.id))
      }
    }
    Effect.runSync(streamAround(getCurrentChunkContext(), QA_RAIL_POSE.feetPosition.x, QA_RAIL_POSE.feetPosition.z))
    Effect.runSync(playerApi.restore(QA_RAIL_POSE, dimension))
    resetSimState(true)
    // Flatten the loop's bounding box into a predictable floor one block
    // below track level and open air at track level and above — the same
    // terraforming seedSmokeGroundingEncounter uses so a purpose-built
    // fixture does not depend on whatever height generated terrain happens
    // to have here.
    const margin = 2
    for (let x = -margin; x <= QA_RAIL_TRACK_WIDTH + margin; x += 1) {
      for (let z = -margin; z <= QA_RAIL_TRACK_HEIGHT + margin; z += 1) {
        Effect.runSync(currentChunkStore.setBlock(
          blockPosition(QA_RAIL_TRACK_ORIGIN.x + x, QA_RAIL_TRACK_ORIGIN.y - 1, QA_RAIL_TRACK_ORIGIN.z + z),
          blockIdOf('stone'),
        ))
        for (let y = 0; y <= 3; y += 1) {
          Effect.runSync(currentChunkStore.setBlock(
            blockPosition(QA_RAIL_TRACK_ORIGIN.x + x, QA_RAIL_TRACK_ORIGIN.y + y, QA_RAIL_TRACK_ORIGIN.z + z),
            blockIdOf('air'),
          ))
        }
      }
    }
    for (const cell of QA_RAIL_TRACK_CELLS) {
      Effect.runSync(currentChunkStore.setBlock(cell, blockIdOf('powered_rail')))
      // Powered directly, the same way seedRedstoneFixtures and
      // seedStickyPistonEncounter pre-seed an already-active circuit rather
      // than requiring the player to build a power source — isPoweredRailAt
      // (wired at this file's registerModule call) reads this same
      // poweredRails set in production.
      poweredRails.add(leverKeyOf({ dimension, position: cell }))
    }
    const spawned = Effect.runSync(vehicleService.spawn(
      'minecart',
      dimension,
      {
        x: QA_RAIL_TRACK_ORIGIN.x + 1.5,
        y: QA_RAIL_TRACK_ORIGIN.y,
        z: QA_RAIL_TRACK_ORIGIN.z + 0.5,
      },
      0,
    ))
    // A small nudge along the first leg's own direction, exactly as the real
    // placement path at this file's VehicleCommand handling gives a freshly
    // placed minecart a starting push — the powered loop takes it from there.
    replaceVehicle({ ...spawned, velocity: { x: 1, y: 0, z: 0 } })
    markSessionDirty()
    renderPlayerUi()
    // This loop is deliberately not wired into the interactive redstone
    // circuit graph — there is no lever anywhere behind it — so the resync
    // this function's own streamAround call marked pending
    // (syncRedstoneSnapshot, gated on redstoneDirty in the frame loop above)
    // would otherwise run on the very next frame, find no real power source
    // for any of these cells, and correct the poweredRails entries just
    // seeded above back to false — which is the redstone engine doing
    // exactly its job, just not the job this fixture needs it to do here.
    // Clearing the flag after seeding, rather than before, means every
    // OTHER effect of that resync (this fixture's own terraforming, any
    // unrelated component already in the loaded chunks) still ran once;
    // only the specific correction this fixture does not want is skipped.
    setRedstoneDirty(false)
    return railTrackSnapshot()
  }

  const boatWaterSnapshot = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const boat = vehicleList().find(
      (vehicle) => vehicle.type === 'boat' && vehicle.dimension === dimension,
    )
    return {
      boat: boat === undefined ? null : {
        position: boat.position,
        velocity: boat.velocity,
        yawRadians: boat.yawRadians,
        mounted: boat.occupant !== undefined,
      },
    }
  }

  // Closes the same testability gap seedRailTrackEncounter closes for
  // minecarts, for boats — but unlike that fixture, this one does NOT spawn
  // or mount the boat itself. Placement is real-click and boarding is
  // distance-gated (both in this file's VehicleCommand/`use` handling), and
  // whether a real placement onto water lands the boat where the frame
  // stage's own water check (mx-gameplay's vehicle-frame.ts `waterAt`,
  // which reads the boat's OWN cell and the one above it) actually finds
  // water is exactly the open question — a QA-only spawn at a hand-picked
  // height would silently decide that question instead of testing it. This
  // fixture only terraforms an open-water pool and equips the boat item;
  // placement, mounting and driving all go through the SAME
  // targetedBlock()-raycast placement, boarding-distance check and
  // vehicleService/frame stage (gameplayStages) production play uses.
  const seedBoatWaterEncounter = () => {
    respawnPlayer()
    for (const vehicle of vehicleList()) {
      if (vehicle.type === 'boat' && vehicle.dimension === 'overworld') {
        Effect.runSync(vehicleService.despawn(vehicle.id))
      }
    }
    Effect.runSync(streamAround(getCurrentChunkContext(), QA_WATER_ORIGIN.x, QA_WATER_ORIGIN.z))
    // A stone floor one block below the water and open air well above it —
    // the same terraforming seedRailTrackEncounter and
    // seedSmokeGroundingEncounter use so a purpose-built fixture does not
    // depend on whatever height generated terrain happens to have here.
    const margin = 1
    for (let x = -margin; x <= QA_WATER_SIZE + margin; x += 1) {
      for (let z = -margin; z <= QA_WATER_SIZE + margin; z += 1) {
        Effect.runSync(currentChunkStore.setBlock(
          blockPosition(QA_WATER_ORIGIN.x + x, QA_WATER_ORIGIN.y - 1, QA_WATER_ORIGIN.z + z),
          blockIdOf('stone'),
        ))
        for (let y = 1; y <= 5; y += 1) {
          Effect.runSync(currentChunkStore.setBlock(
            blockPosition(QA_WATER_ORIGIN.x + x, QA_WATER_ORIGIN.y + y, QA_WATER_ORIGIN.z + z),
            blockIdOf('air'),
          ))
        }
      }
    }
    for (const cell of QA_WATER_CELLS) {
      Effect.runSync(currentChunkStore.setBlock(cell, blockIdOf('water')))
    }
    Effect.runSync(playerApi.restore(QA_WATER_PLACEMENT_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('oak_boat', 1))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    markSessionDirty()
    renderPlayerUi()
    return boatWaterSnapshot()
  }

  const seedWoodenPickaxeProgression = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('oak_log', 3))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    pendingItemUses.clear()
    setLastObservedItemUse(undefined)
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
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    setNextBlockUseRequestId(getNextBlockUseRequestId() + 1)
    Effect.runSync(
      requestTargetedBlockUse(
        gameplayState,
        currentChunkStore,
        playerApi,
        `block-use-${String(getNextBlockUseRequestId())}`,
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
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    pendingItemUses.clear()
    setLastObservedItemUse(undefined)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const harvestFarmingCrop = () => {
    const dimension = Effect.runSync(playerApi.dimension)
    const location: CropLocation = { dimension, position: QA_FARM_CROP_BLOCK }
    const ripe = Effect.runSync(crops.matureYieldsAt(location)) !== null
    if (!ripe) return gameplaySnapshot()
    Effect.runSync(currentChunkStore.setBlock(QA_FARM_CROP_BLOCK, blockIdOf('air')))
    Effect.runSync(crops.remove(location))
    setNextItemUseRequestId(getNextItemUseRequestId() + 1)
    const requestId = `item-use-${String(getNextItemUseRequestId())}`
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
        getCurrentChunkContext(),
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
      Effect.runSync(currentChunkStore.setBlock(blockPosition(position.x, position.y + 1, position.z), air))
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
      streamAround(getCurrentChunkContext(), QA_FALL_CENTER.x + 0.5, QA_FALL_CENTER.z + 0.5),
    )
    const stone = blockIdOf('stone')
    const air = blockIdOf('air')
    for (let xOffset = -1; xOffset <= 1; xOffset += 1) {
      for (let zOffset = -1; zOffset <= 1; zOffset += 1) {
        const x = QA_FALL_CENTER.x + xOffset
        const z = QA_FALL_CENTER.z + zOffset
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, QA_FALL_FLOOR_Y, z), stone))
        for (let y = QA_FALL_FLOOR_Y + 1; y <= QA_FALL_START_Y.lethal + 2; y += 1) {
          Effect.runSync(currentChunkStore.setBlock(blockPosition(x, y, z), air))
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
        getCurrentChunkContext(),
        QA_PORTAL_POSE.feetPosition.x,
        QA_PORTAL_POSE.feetPosition.z,
      ),
    )
    markSessionDirty()
    return gameplaySnapshot()
  }

  // Deterministic core for ensureSafePortalLanding: a QA harness that
  // reproduces "the Nether side of the crossing is solid rock" on demand
  // rather than hoping a live trial happens to land there. Leaving the
  // Nether side undiscovered would let stepPortalTravel plan a FRESH portal
  // at the scaled destination, and building that portal's own frame already
  // guarantees footing underneath it — safe by construction, which is
  // exactly the case that does NOT exercise this defect. Registering the
  // Nether destination up front makes resolveNetherTravel REUSE it instead,
  // so no frame gets built and the arrival lands on whatever this fixture
  // put there.
  //
  // The fill is the SINGLE COLUMN ensureSafePortalLanding checks — same
  // x/z as the destination, nothing either side of it — because a wider
  // footprint check was tried and measured wrong: `e2e/persistence.e2e.ts`'s
  // portal round trip already exercises a REAL freshly built portal, whose
  // frame stands one block outside its own interior by construction, and a
  // footprint sized for open terrain reaches into that frame and reads a
  // perfectly good landing as obstructed. Two zones in the one column, not
  // one:
  //
  //   AT and ABOVE the destination: solid through the whole vertical search
  //   band. This both embeds the body (satisfying ensureSafePortalLanding's
  //   own "is the body's own space clear" test the way real solid terrain
  //   would) and blocks every candidate the search would try ABOVE the
  //   destination.
  //   BELOW the destination: air through the same band, so there is no
  //   accidental floor for the search — or for unmodified moveTo — to
  //   rest on by coincidence. This is what makes the fixture discriminate:
  //   an EARLIER version of it also filled below solid, which let a body
  //   read "resting" the instant it arrived (mc-physics's `isSupported` is a
  //   pure position check, not a step-crossing one) whether or not the
  //   correction ran, so the assertion below would have passed unfixed too.
  //
  // With both zones exhausted, the search must fall back to carving a
  // landing at the arithmetic destination itself — the one outcome this
  // fixture can pin exactly — while an unfixed arrival is left embedded
  // with open air below it, which mc-physics's resolver (component-tested
  // separately) does not push a body out of on its own.
  const seedPortalArrivalIntoSolidGround = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_PORTAL_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(materializePortal('overworld', QA_PORTAL_LAYOUT))
    registerPortal({ dimension: 'overworld', position: QA_PORTAL_ANCHOR })

    const netherDestination = overworldToNether(QA_PORTAL_ANCHOR)
    registerPortal({ dimension: 'nether', position: netherDestination })
    const netherContext = getOrCreateDimensionChunkContext('nether')
    Effect.runSync(streamAround(netherContext, netherDestination.x, netherDestination.z))
    const baseY: number = netherDestination.y
    const minY = baseY - portalLandingSearchBlocks - 2
    const maxY = baseY + portalLandingSearchBlocks + 2
    for (let y = minY; y < baseY; y += 1) {
      Effect.runSync(netherContext.chunkStore.setBlock(blockPosition(netherDestination.x, y, netherDestination.z), blockIdOf('air')))
    }
    for (let y = baseY; y <= maxY; y += 1) {
      Effect.runSync(netherContext.chunkStore.setBlock(blockPosition(netherDestination.x, y, netherDestination.z), blockIdOf('stone')))
    }

    Effect.runSync(
      streamAround(
        getCurrentChunkContext(),
        QA_PORTAL_POSE.feetPosition.x,
        QA_PORTAL_POSE.feetPosition.z,
      ),
    )
    markSessionDirty()
    return gameplaySnapshot()
  }

  const seedPortalIgnitionEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file: fixtures
    // that restore the player to QA_IGNITION_POSE without it leave the
    // player free-falling for the whole encounter.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('flint_and_steel', 1))
    portalStates.delete(portalKeyOf({
      dimension: 'overworld',
      position: QA_IGNITION_PORTAL_LAYOUT.interior[0] ?? QA_IGNITION_HIT_BLOCK,
    }))
    Effect.runSync(syncPortalCandidatesFor('overworld'))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('stone')))
    for (const position of QA_IGNITION_PORTAL_LAYOUT.frame) {
      Effect.runSync(currentChunkStore.setBlock(position, OBSIDIAN_BLOCK_ID))
    }
    for (const position of QA_IGNITION_PORTAL_LAYOUT.interior) {
      Effect.runSync(currentChunkStore.setBlock(position, blockIdOf('air')))
    }
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    pendingItemUses.clear()
    setLastObservedItemUse(undefined)
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
      streamAround(getCurrentChunkContext(), pose.feetPosition.x, pose.feetPosition.z),
    )
    markSessionDirty()
    return gameplaySnapshot()
  }

  const seedBedExplosionEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'nether'))
    alignActiveDimension('nether')
    resetSimState(true)
    Effect.runSync(
      streamAround(
        getCurrentChunkContext(),
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    Effect.runSync(world.inventory.reset)
    // The player spawns at QA_IGNITION_POSE, which sibling QA_IGNITION_POSE
    // fixtures (e.g. seedZombiePursuitEncounter) pin to solid ground with
    // QA_IGNITION_FLOOR_BLOCK — this fixture omitted it, so the player fell
    // through unset Nether terrain onto whatever natural surface was below,
    // shifting eye height enough to move the bed outside
    // targetedRightClickRoute's raycast before the QA click landed.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 65, 10), blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 66, 10), blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('bed')))
    Effect.runSync(currentChunkStore.setBlock(
      blockPosition(QA_IGNITION_HIT_BLOCK.x, QA_IGNITION_HIT_BLOCK.y - 1, QA_IGNITION_HIT_BLOCK.z),
      blockIdOf('stone'),
    ))
    document.body.removeAttribute('data-bed-explosion-request')
    document.body.removeAttribute('data-sleep-result')
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedBowProjectileEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(
      streamAround(
        getCurrentChunkContext(),
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file: fixtures
    // that restore the player to QA_IGNITION_POSE without it leave the
    // player free-falling for the whole encounter.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('bow', 1))
    Effect.runSync(world.inventory.add('arrow', 8))
    for (let x = 6; x <= 10; x += 1) {
      for (let y = 62; y <= 69; y += 1) {
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, y, 2), blockIdOf('stone')))
      }
    }
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedVillageTradingEncounter = () => {
    let villager: PersistedVillager | undefined
    // mc-worldgen 0.2.0's village placement is sparser than the org's
    // previous algorithm: for `WORLD_SEED`, the nearest village to the
    // origin is at chunk (-204, -15) — Chebyshev radius 204, confirmed by an
    // exhaustive scan out to radius 300 finding nothing closer. The old
    // bound of 64 predates that placement change and no longer reaches any
    // village at all for this seed. 256 keeps comfortable margin above the
    // measured 204 without scanning an unbounded area.
    for (let radius = 0; radius <= 256 && villager === undefined; radius += 1) {
      for (let cx = -radius; cx <= radius && villager === undefined; cx += 1) {
        for (const cz of new Set([-radius, radius])) {
          const spawn = villageVillagerSpawnsForChunk(
            getActiveSeed(),
            cx,
            cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(getActiveSeed(), x, z)
              return {
                biome: biomeFor(getActiveSeed(), x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )[0]
          if (spawn !== undefined) {
            Effect.runSync(streamAround(getCurrentChunkContext(), spawn.x, spawn.z))
            villager = villagerResidents.get(spawn.id)
            break
          }
        }
      }
      for (let cz = -radius + 1; cz < radius && villager === undefined; cz += 1) {
        for (const cx of new Set([-radius, radius])) {
          const spawn = villageVillagerSpawnsForChunk(
            getActiveSeed(),
            cx,
            cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(getActiveSeed(), x, z)
              return {
                biome: biomeFor(getActiveSeed(), x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )[0]
          if (spawn !== undefined) {
            Effect.runSync(streamAround(getCurrentChunkContext(), spawn.x, spawn.z))
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
        getCurrentChunkContext(),
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('brewing_stand')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    // The player spawns at QA_IGNITION_POSE, which sibling fixtures pin to
    // solid ground with QA_IGNITION_FLOOR_BLOCK — this fixture omitted it, so
    // the player fell through unset terrain for the whole encounter, shifting
    // eye height enough that a right-click on the brewing stand could miss
    // its raycast (same bug class already fixed once for other
    // QA_IGNITION_FLOOR_BLOCK fixtures in this file).
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('blaze_powder', 2))
    Effect.runSync(world.inventory.add('water_bottle', 1))
    Effect.runSync(world.inventory.add('nether_wart', 1))
    Effect.runSync(world.inventory.add('spider_eye', 1))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    Effect.runSync(restoreBrewingStand(gameplayState, emptyBrewingStandState()))
    Effect.runSync(restoreStatusEffects(gameplayState, emptyStatusEffectState()))
    setBrewingOpen(false)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedItemUpgradeEncounter = () => {
    respawnPlayer()
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(
      streamAround(
        getCurrentChunkContext(),
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    Effect.runSync(currentChunkStore.setBlock(
      QA_IGNITION_HIT_BLOCK,
      blockIdOf('enchanting_table'),
    ))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
    // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file: fixtures
    // that restore the player to QA_IGNITION_POSE without it leave the
    // player free-falling for the whole encounter.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('diamond_pickaxe', 1))
    Effect.runSync(world.inventory.add('lapis_lazuli', 3))
    Effect.runSync(world.inventory.add('iron_ingot', 1))
    const storage = Effect.runSync(world.inventory.storageSnapshot)
    const durability = [...storage.inventoryDurability]
    const pickaxeDurability = durability[0]
    if (pickaxeDurability === null || pickaxeDurability === undefined) {
      throw new Error('seeded diamond pickaxe has no durability')
    }
    durability[0] = { current: Math.floor(pickaxeDurability.max / 2), max: pickaxeDurability.max }
    Effect.runSync(world.inventory.restoreStorage({ ...storage, inventoryDurability: durability }))
    for (const key of [...customNames.keys(), ...enchantedItems.keys()]) {
      if (/^\d+$/.test(key)) deleteItemMetadata(key)
    }
    for (let candidate = 0; candidate < 10_000; candidate += 1) {
      const id = enchantmentOffers(candidate, 15)[0].enchantment.id
      if (id === 'efficiency' || id === 'unbreaking' || id === 'fortune') {
        setEnchantmentSeed(candidate)
        break
      }
    }
    const vitals = Effect.runSync(world.vitals.snapshot)
    Effect.runSync(world.vitals.restore(addVitalsExperience(
      vitals,
      totalExperienceAtLevel(30) - vitals.totalExperience,
    )))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    setInventoryOpen(false)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const switchItemUpgradeStationToAnvil = () => {
    Effect.runSync(playerApi.restore(QA_IGNITION_POSE, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(
      streamAround(
        getCurrentChunkContext(),
        QA_IGNITION_POSE.feetPosition.x,
        QA_IGNITION_POSE.feetPosition.z,
      ),
    )
    // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file: fixtures
    // that restore the player to QA_IGNITION_POSE without it leave the
    // player free-falling for the whole encounter.
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
    Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('anvil')))
    setInventoryOpen(false)
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const poseLookingAt = (target: SessionPosition, distance: number): QaPose => ({
    feetPosition: {
      x: target.x + 0.5,
      y: target.y + 0.5 - EYE_LEVEL_OFFSET,
      z: target.z + 0.5 + distance,
    },
    yawRadians: 0,
    pitchRadians: 0,
  })

  // poseLookingAt centers the eye on the target's own middle, which for a
  // ground-level target drops the feet below the target's surface with
  // nothing guaranteed solid underneath — fine for a block the fixture
  // already terraformed (fishing water, an end portal frame), but not for a
  // live entity's feetPosition. spawnFullHealthHostile and
  // targetNearestHostile both reposition the player next to a mob, so both
  // go through here instead of calling playerApi.restore(poseLookingAt(...))
  // directly, and both get the same floor.
  //
  // Two things measured live rule out "just place a block under the
  // computed feet and let gravity settle it":
  //
  // 1. feet.y is never block-aligned (it's target.y + 0.5 -
  //    EYE_LEVEL_OFFSET, always ~0.88 below whatever integer y the target
  //    sits at), and mc-physics's collision here only resolves a boundary
  //    the player's AABB crosses DURING a step — an AABB that starts the
  //    frame already overlapping solid ground (teleported there, not
  //    swept there) never triggers it and free-falls straight through,
  //    confirmed by placing a block exactly at floor(feet.y) in an
  //    otherwise-empty shaft and watching the player fall through it onto
  //    the real floor two blocks further down regardless.
  // 2. Leaving a real gap above a floor for gravity to close DOES resolve
  //    correctly (measured landing exactly on the placed floor's top
  //    face), but takes ~500-600ms real time to fall the ~0.88 blocks —
  //    longer than the reach cylinder's own ~0.348-block tolerance, so the
  //    player still spends the first half-second outside melee/bow range,
  //    reproducing the reported symptom instead of fixing it.
  //
  // So the fix places the player already resting flush on a block boundary
  // — zero gap, zero overlap, no physics settling required — rather than
  // trying to preserve poseLookingAt's exact fractional y. That moves the
  // eye point by less than one block from the "ideal" aim math, which is
  // still well inside reach=3, and unlike either alternative above it holds
  // from frame zero.
  //
  // A single column is not enough either: poseLookingAt's x/z are
  // target.<axis> + 0.5 (+ distance for z), and every caller's target comes
  // from another fixture's own .5-centered feetPosition, so the result
  // routinely lands exactly on a block boundary (measured: x = 1.0 for a
  // target.x of 0.5). The player's AABB extends PLAYER_HALF_WIDTH either
  // side of that point, so a boundary-aligned spawn straddles two columns
  // per axis — up to four — and filling only the one under the coordinate
  // leaves the other corners of the footprint over open air. Filling every
  // column the AABB's footprint can touch is the only way to guarantee
  // support regardless of where the fraction lands.
  //
  // The floor alone is not enough either: it is placed at a height derived
  // from the TARGET's y, but the player lands `distance` blocks away
  // horizontally, and real terrain is not flat — measured with
  // targetNearestHostile chasing a blaze across natural ground where the
  // floor this places is correct but the real surface a few blocks over
  // sits a block or two higher, embedding the player's own eye in solid
  // ground and making every attack resolve as a block hit at distance ~0
  // (mx-gameplay's own bow-shot.js: "A PLAYER WHOSE EYE IS INSIDE A
  // BLOCKING CELL CANNOT FIRE AT ALL"). Clearing the body-height column
  // above the floor — the same shape seedMeleeDropEncounter clears for its
  // own line-of-sight, just centered on the player's own footprint instead
  // of a fixed line to the target — removes whatever natural terrain might
  // otherwise be standing there regardless of its height.
  const restoreLookingAt = (
    target: SessionPosition,
    distance: number,
    dimension: Dimension,
  ) => {
    const rawPose = poseLookingAt(target, distance)
    // Rounding DOWN to the nearest block boundary costs the whole fractional
    // part (~0.88 of a block, itself already past the 0.348 reach-cylinder
    // tolerance — as bad as the original bug). Rounding UP costs only
    // 1 - 0.88 = ~0.12, comfortably inside tolerance, so the floor goes at
    // floor(feet.y) and the player rests on ITS top face rather than one
    // level below it.
    const floorY = Math.floor(rawPose.feetPosition.y)
    const pose = {
      ...rawPose,
      feetPosition: { ...rawPose.feetPosition, y: floorY + 1 },
    }
    for (
      let x = Math.floor(pose.feetPosition.x - PLAYER_HALF_WIDTH);
      x <= Math.floor(pose.feetPosition.x + PLAYER_HALF_WIDTH);
      x += 1
    ) {
      for (
        let z = Math.floor(pose.feetPosition.z - PLAYER_HALF_WIDTH);
        z <= Math.floor(pose.feetPosition.z + PLAYER_HALF_WIDTH);
        z += 1
      ) {
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, floorY, z), blockIdOf('stone')))
        // PLAYER_HALF_HEIGHT * 2 = 1.8 blocks tall, spanning at most two
        // integer cells above the feet; the eye (feet.y + EYE_LEVEL_OFFSET)
        // falls inside that same span, so two cleared cells cover both body
        // and sightline.
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, floorY + 1, z), blockIdOf('air')))
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, floorY + 2, z), blockIdOf('air')))
      }
    }
    Effect.runSync(playerApi.restore(pose, dimension))
  }

  const seedFishingEncounter = () => {
    respawnPlayer()
    const water = { x: QA_IGNITION_HIT_BLOCK.x, y: QA_IGNITION_HIT_BLOCK.y, z: QA_IGNITION_HIT_BLOCK.z }
    Effect.runSync(streamAround(getCurrentChunkContext(), water.x, water.z))
    for (let x = water.x - 2; x <= water.x + 2; x += 1) {
      for (let z = water.z - 2; z <= water.z + 2; z += 1) {
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, water.y, z), blockIdOf('water')))
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, water.y + 1, z), blockIdOf('air')))
      }
    }
    Effect.runSync(playerApi.restore(poseLookingAt(water, 3), 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('fishing_rod', 1))
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    setFishingSession(undefined)
    setFishingWater(undefined)
    setFishingResult('idle')
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedSubmergedSwimmingEncounter = () => {
    respawnPlayer()
    const pool = {
      x: QA_IGNITION_HIT_BLOCK.x,
      y: QA_IGNITION_HIT_BLOCK.y,
      z: QA_IGNITION_HIT_BLOCK.z,
    }
    Effect.runSync(streamAround(getCurrentChunkContext(), pool.x, pool.z))
    for (let x = pool.x - 2; x <= pool.x + 2; x += 1) {
      for (let z = pool.z - 2; z <= pool.z + 2; z += 1) {
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, pool.y - 1, z), blockIdOf('stone')))
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, pool.y, z), blockIdOf('water')))
        for (let y = pool.y + 1; y <= pool.y + 12; y += 1) {
          Effect.runSync(currentChunkStore.setBlock(blockPosition(x, y, z), blockIdOf('water')))
        }
        Effect.runSync(currentChunkStore.setBlock(blockPosition(x, pool.y + 13, z), blockIdOf('air')))
      }
    }
    for (let y = pool.y - 1; y <= pool.y + 13; y += 1) {
      Effect.runSync(currentChunkStore.setBlock(blockPosition(pool.x + 3, y, pool.z), blockIdOf(
        y === pool.y - 1 ? 'stone' : 'air',
      )))
    }
    Effect.runSync(playerApi.restore({
      feetPosition: { x: pool.x + 0.5, y: pool.y + 0.05, z: pool.z + 0.5 },
      yawRadians: 0,
      pitchRadians: 0,
    }, 'overworld'))
    alignActiveDimension('overworld')
    resetSimState(true)
    setSwimmingState({
      ...initialPlayerSwimmingRuntimeState(),
      oxygenSecs: 0.05,
      drowningElapsedSecs: 0.95,
    })
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const leaveSubmergedSwimmingEncounter = () => {
    const pool = QA_IGNITION_HIT_BLOCK
    Effect.runSync(playerApi.restore({
      feetPosition: { x: pool.x + 3.5, y: pool.y + 0.05, z: pool.z + 0.5 },
      yawRadians: 0,
      pitchRadians: 0,
    }, 'overworld'))
    resetSimState(true)
    return gameplaySnapshot()
  }

  const seedEndEyeCrafting = () => {
    respawnPlayer()
    Effect.runSync(world.inventory.reset)
    Effect.runSync(world.inventory.add('ender_pearl', 1))
    Effect.runSync(world.inventory.add('blaze_powder', 1))
    inventoryInteraction.reset()
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const seedEndPortalFinalFrame = () => {
    respawnPlayer()
    const currentPose = Effect.runSync(playerApi.pose)
    const site = nearestStrongholdSite(getActiveSeed(), currentPose.feetPosition.x, currentPose.feetPosition.z)
    if (Option.isNone(site)) throw new Error('no stronghold found near the QA player')
    const center = endPortalCenterForStronghold(site.value)
    const finalOffset = END_PORTAL_FRAME_OFFSETS[0]
    if (finalOffset === undefined) throw new Error('End portal frame layout is empty')
    Effect.runSync(streamAround(getCurrentChunkContext(), center.x, center.z))
    endPortalFrames.clear()
    setEndPortalComplete(false)
    for (const offset of END_PORTAL_FRAME_OFFSETS) {
      const position = blockPosition(center.x + offset.dx, center.y, center.z + offset.dz)
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
    setSelectedHotbarIndex(0)
    setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
    inventoryInteraction.reset()
    markSessionDirty()
    renderPlayerUi()
    return gameplaySnapshot()
  }

  const targetCompletedEndPortal = () => {
    const firstFrame = endPortalFrames.values().next()
    const frame: PersistedEndPortalFrameState | undefined = firstFrame.done ? undefined : firstFrame.value
    if (frame === undefined || !getEndPortalComplete()) throw new Error('End portal is not complete')
    const site = nearestStrongholdSite(getActiveSeed(), frame.position.x, frame.position.z)
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

  const spawnFullHealthHostile = (kind: typeof ENDERMAN_KIND | typeof BLAZE_KIND, healthPoints: number) => {
    respawnPlayer()
    const inventory = Effect.runSync(world.inventory.snapshot)
    let swordSlot = inventory.slots.findIndex((slot) => slot?.item === 'diamond_sword')
    if (swordSlot < 0) {
      Effect.runSync(world.inventory.add('diamond_sword', 1))
      swordSlot = Effect.runSync(world.inventory.snapshot).slots.findIndex((slot) => slot?.item === 'diamond_sword')
    }
    if (swordSlot >= 0 && swordSlot < 9) setSelectedHotbarIndex(swordSlot)
    for (const entity of Effect.runSync(world.entities.snapshot).entities) {
      if (entity.kind === kind) Effect.runSync(world.entities.despawn(entity.id))
    }
    const pose = Effect.runSync(playerApi.pose)
    const target = {
      x: pose.feetPosition.x,
      y: pose.feetPosition.y,
      z: pose.feetPosition.z - 3,
    }
    Effect.runSync(world.entities.spawn({
      kind,
      feetPosition: target,
      healthPoints,
      behaviour: initialBehaviourOfKind(kind),
    }))
    restoreLookingAt(target, 2, Effect.runSync(playerApi.dimension))
    resetSimState(true)
    markSessionDirty()
    return gameplaySnapshot()
  }

  const targetNearestHostile = () => {
    const pose = Effect.runSync(playerApi.pose)
    const hostile = Effect.runSync(world.entities.snapshot).entities
      .filter((entity) => entity.kind === ENDERMAN_KIND || entity.kind === BLAZE_KIND)
      .sort((left, right) => {
        const distance = (position: typeof left.feetPosition) => Math.hypot(
          position.x - pose.feetPosition.x,
          position.y - pose.feetPosition.y,
          position.z - pose.feetPosition.z,
        )
        return distance(left.feetPosition) - distance(right.feetPosition)
      })[0]
    if (hostile === undefined) throw new Error('no hostile found')
    restoreLookingAt(hostile.feetPosition, 2, Effect.runSync(playerApi.dimension))
    resetSimState(true)
    return gameplaySnapshot()
  }

  const targetNearestDroppedItem = () => {
    const pose = Effect.runSync(playerApi.pose)
    const dropped = Effect.runSync(world.entities.snapshot).entities
      .filter((entity) => isDroppedItemBehaviour(entity.behaviour))
      .sort((left, right) => {
        const distance = (position: typeof left.feetPosition) => Math.hypot(
          position.x - pose.feetPosition.x,
          position.y - pose.feetPosition.y,
          position.z - pose.feetPosition.z,
        )
        return distance(left.feetPosition) - distance(right.feetPosition)
      })[0]
    if (dropped === undefined) throw new Error('no dropped item found')
    Effect.runSync(playerApi.moveTo(dropped.feetPosition))
    resetSimState(true)
    return gameplaySnapshot()
  }

  const targetNearestStrongholdFrame = async () => {
    const pose = Effect.runSync(playerApi.pose)
    const site = nearestStrongholdSite(getActiveSeed(), pose.feetPosition.x, pose.feetPosition.z)
    if (Option.isNone(site)) throw new Error('no stronghold found near the QA player')
    const center = endPortalCenterForStronghold(site.value)
    alignActiveDimension('overworld')
    Effect.runSync(streamAround(getCurrentChunkContext(), center.x, center.z))
    const targetOffset = END_PORTAL_FRAME_OFFSETS.find((offset) => {
      const position = blockPosition(center.x + offset.dx, center.y, center.z + offset.dz)
      const reading = Effect.runSync(currentChunkStore.getBlock(position))
      return reading._tag === 'Block' && reading.block === END_PORTAL_BLOCK.FRAME_EMPTY
    })
    if (targetOffset === undefined) throw new Error('no empty stronghold frame found')
    const target = { x: center.x + targetOffset.dx, y: center.y, z: center.z + targetOffset.dz }
    Effect.runSync(playerApi.restore({
      feetPosition: { x: target.x + 0.5, y: target.y + 2, z: target.z + 0.5 },
      yawRadians: 0,
      pitchRadians: -Math.PI / 2 + 0.01,
    }, 'overworld'))
    resetSimState(true)
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    const normalizedPose = Effect.runSync(playerApi.pose)
    const dx = target.x + 0.5 - normalizedPose.feetPosition.x
    const dy = target.y + 0.5 - (normalizedPose.feetPosition.y + EYE_LEVEL_OFFSET)
    const dz = target.z + 0.5 - normalizedPose.feetPosition.z
    const horizontalDistance = Math.hypot(dx, dz)
    resetSimState(false)
    Effect.runSync(playerApi.restore({
      ...normalizedPose,
      yawRadians: Math.atan2(-dx, -dz),
      pitchRadians: Math.atan2(dy, horizontalDistance),
    }, 'overworld'))
    const aimedTarget = await Effect.runPromise(targetedBlock())
    if (aimedTarget?.block !== END_PORTAL_BLOCK.FRAME_EMPTY
      || aimedTarget.position.x !== target.x
      || aimedTarget.position.y !== target.y
      || aimedTarget.position.z !== target.z) {
      throw new Error(`failed to target empty stronghold frame: ${JSON.stringify(aimedTarget)}`)
    }
    return gameplaySnapshot()
  }

  const targetEndDragon = () => {
    Effect.runSync(playerApi.restore(poseLookingAt(endDragonPosition(), 5), 'end'))
    alignActiveDimension('end')
    resetSimState(true)
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
    if (!getExitPortalMaterialized()) throw new Error('End exit portal is not materialized')
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

  const registry = buildQaRegistry([
    {
      namespace: 'render',
      commands: {
        snapshotLighting: () => ({
          ...getLightingSnapshot(),
          weatherBrightness: weatherLightScale(Effect.runSync(renderWeather.snapshot).weather),
        }),
      },
    },
    {
      namespace: 'gameplay',
      commands: {
        snapshot: gameplaySnapshot,
        seedChestTransferMetadata: () => {
          Effect.runSync(world.inventory.reset)
          for (const key of [...customNames.keys(), ...enchantedItems.keys()]) {
            if (/^\d+$/.test(key)) deleteItemMetadata(key)
          }
          Effect.runSync(world.inventory.add('diamond_pickaxe', 1))
          const durability = Effect.runSync(world.inventory.storageSnapshot).inventoryDurability[0]
          if (durability === null || durability === undefined) {
            throw new Error('seeded diamond pickaxe has no durability')
          }
          customNames.set('0', 'Silk Runner')
          enchantedItems.set('0', {
            item: 'diamond_pickaxe',
            durability,
            enchantments: [{ id: 'efficiency', level: 5 }],
          })
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedChestTransferMetadataConflict: () => {
          Effect.runSync(world.inventory.add('diamond_pickaxe', 1))
          const durability = Effect.runSync(world.inventory.storageSnapshot).inventoryDurability[0]
          if (durability === null || durability === undefined) {
            throw new Error('seeded diamond pickaxe has no durability')
          }
          customNames.set('0', 'Fortune Runner')
          enchantedItems.set('0', {
            item: 'diamond_pickaxe',
            durability,
            enchantments: [{ id: 'fortune', level: 3 }],
          })
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedStaleCustomNames: () => {
          customNames.set('35', 'Stale inventory name')
          customNames.set('equipment:head', 'Stale equipment name')
          customNames.set('unknown:slot', 'Stale unknown name')
          markSessionDirty()
          return gameplaySnapshot()
        },
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
            Effect.runSync(currentChunkStore.setBlock(KNOWN_TARGET_BLOCK, BlockId(targetBlock)))
          }
          resetSimState(true)
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedSmokeGroundingEncounter: () => {
          const dimension = Effect.runSync(playerApi.dimension)
          Effect.runSync(streamAround(getCurrentChunkContext(), QA_POSE.feetPosition.x, QA_POSE.feetPosition.z))
          for (let x = -16; x <= 32; x += 1) {
            for (let z = -16; z <= 32; z += 1) {
              Effect.runSync(currentChunkStore.setBlock(blockPosition(x, 62, z), blockIdOf('stone')))
              Effect.runSync(currentChunkStore.setBlock(blockPosition(x, 63, z), blockIdOf('stone')))
              for (let y = 64; y <= 68; y += 1) {
                Effect.runSync(currentChunkStore.setBlock(blockPosition(x, y, z), blockIdOf('air')))
              }
            }
          }
          Effect.runSync(playerApi.restore({
            ...QA_POSE,
            feetPosition: { ...QA_POSE.feetPosition, y: 66 },
          }, dimension))
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
          Effect.runSync(currentChunkStore.setBlock(KNOWN_TARGET_BLOCK, blockIdOf('stone')))
          setSelectedHotbarIndex(0)
          setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
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
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_HIT_BLOCK, blockIdOf('stone')))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('air')))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_SUPPORT_BLOCK, blockIdOf('stone')))
          // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file:
          // fixtures that restore the player to QA_IGNITION_POSE without it
          // leave the player free-falling for the whole encounter.
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
          setSelectedHotbarIndex(0)
          setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        requestMultiplayerBlockPlacement: () => {
          if (multiplayer === undefined || !getMultiplayerHandshakeComplete()) return gameplaySnapshot()
          Effect.runSync(multiplayer.host.enqueueOutbound({
            _tag: 'BlockPlace',
            player: multiplayer.query.player,
            world: WorldId.make(Effect.runSync(playerApi.dimension)),
            at: QA_IGNITION_CELL,
            block: 'stone',
          }))
          return gameplaySnapshot()
        },
        requestMultiplayerBlockBreak: () => {
          if (multiplayer === undefined || !getMultiplayerHandshakeComplete()) return gameplaySnapshot()
          Effect.runSync(multiplayer.host.enqueueOutbound({
            _tag: 'BlockBreak',
            player: multiplayer.query.player,
            world: WorldId.make(Effect.runSync(playerApi.dimension)),
            at: QA_IGNITION_CELL,
          }))
          return gameplaySnapshot()
        },
        returnToCraftingTable: () => {
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file:
          // fixtures that restore the player to QA_IGNITION_POSE without it
          // leave the player free-falling for the whole encounter.
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
          markSessionDirty()
          return gameplaySnapshot()
        },
        enterNether: () => enterQaDimension('nether'),
        enterOverworld: () => enterQaDimension('overworld'),
        enterEnd: () => enterQaDimension('end'),
        seedBedExplosionEncounter,
        seedBowProjectileEncounter,
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
        seedRedstoneFixtures,
        redstoneFixturesSnapshot,
        pressRedstoneBranchButton,
        mutateObserverInput,
        seedRailTrackEncounter,
        railTrackSnapshot,
        seedBoatWaterEncounter,
        boatWaterSnapshot,
        seedFarmingEncounter,
        seedFishingEncounter,
        seedSubmergedSwimmingEncounter,
        leaveSubmergedSwimmingEncounter,
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
          // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file:
          // fixtures that restore the player to QA_IGNITION_POSE without it
          // leave the player free-falling for the whole encounter.
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
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
        seedPortalArrivalIntoSolidGround,
        seedPortalIgnitionEncounter,
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
          Effect.runSync(world.inventory.add('iron_sword', 1))
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
          survivalHunger.eat(4, 0.3)
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
            inventory: { mode: isCreativeMode ? 'creative' : 'survival', slotIndex: getSelectedHotbarIndex() },
          }))
          return gameplaySnapshot()
        },
        seedZombiePursuitEncounter: () => {
          respawnPlayer()
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
          Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 65, 10), blockIdOf('air')))
          Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 66, 10), blockIdOf('air')))
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          const currentPose = Effect.runSync(playerApi.pose)
          Effect.runSync(requestMobSpawn(gameplayState, {
            kind: ZOMBIE_KIND,
            feetPosition: {
              x: currentPose.feetPosition.x + 4,
              y: currentPose.feetPosition.y,
              z: currentPose.feetPosition.z,
            },
            candidate: {
              groundBlock: blockIdOf('stone'),
              footBlock: blockIdOf('air'),
              headBlock: blockIdOf('air'),
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
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('stone_pickaxe', 1))
          Effect.runSync(world.inventory.add('potato', 2))
          Effect.runSync(world.inventory.add('torch', 8))
          Effect.runSync(world.inventory.add('oak_planks', 4))
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
          Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 65, 10), blockIdOf('air')))
          Effect.runSync(currentChunkStore.setBlock(blockPosition(8, 66, 10), blockIdOf('air')))
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          const currentPose = Effect.runSync(playerApi.pose)
          Effect.runSync(requestMobSpawn(gameplayState, {
            kind: ZOMBIE_KIND,
            feetPosition: {
              x: currentPose.feetPosition.x + 0.5,
              y: currentPose.feetPosition.y,
              z: currentPose.feetPosition.z,
            },
            candidate: {
              groundBlock: blockIdOf('stone'),
              footBlock: blockIdOf('air'),
              headBlock: blockIdOf('air'),
              blockLight: 0,
              timeOfDay: 0,
              distanceToPlayerBlocksXZ: 16,
            },
          }))
          applyPlayerDamage({ amount: 20, cause: 'mob' })
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedFoodUseEncounter: () => {
          respawnPlayer()
          Effect.runSync(playerApi.restore(QA_IGNITION_POSE, Effect.runSync(playerApi.dimension)))
          resetSimState(true)
          // See QA_IGNITION_FLOOR_BLOCK's other call sites in this file:
          // fixtures that restore the player to QA_IGNITION_POSE without it
          // leave the player free-falling for the whole encounter.
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_FLOOR_BLOCK, blockIdOf('stone')))
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('potato', 2))
          applyPlayerDamage({ amount: 4, cause: 'generic' })
          Effect.runSync(world.vitals.addExhaustion(36))
          setSelectedHotbarIndex(0)
          setInventoryFocus({ kind: 'slot', region: 'hotbar', index: getSelectedHotbarIndex() })
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi()
          return gameplaySnapshot()
        },
        seedFireChargeIgnition: () => seedIgnitionEncounter('fire_charge'),
        seedFlintAndSteelIgnition: () => seedIgnitionEncounter('flint_and_steel'),
        seedRefusedFireChargeIgnition: () => {
          seedIgnitionEncounter('fire_charge')
          Effect.runSync(currentChunkStore.setBlock(QA_IGNITION_CELL, blockIdOf('stone')))
          setNextItemUseRequestId(getNextItemUseRequestId() + 1)
          const requestId = `item-use-${String(getNextItemUseRequestId())}`
          Effect.runSync(
            requestItemUse(gameplayState, requestId, QA_IGNITION_CELL, 'fire_charge'),
          )
          pendingItemUses.set(requestId, {
            kind: 'ignition',
            slotIndex: getSelectedHotbarIndex(),
            heldItem: 'fire_charge',
            dimension: Effect.runSync(playerApi.dimension),
          })
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedMeleeDropEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('wooden_sword', 1))
          inventoryInteraction.reset()
          setSelectedHotbarIndex(0)
          setInventoryFocus({
            kind: 'slot',
            region: 'hotbar',
            index: getSelectedHotbarIndex(),
          })
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
            Effect.runSync(currentChunkStore.setBlock(blockPosition(
              Math.floor(currentPose.feetPosition.x),
              eyeY,
              Math.floor(currentPose.feetPosition.z) + zOffset,
            ), blockIdOf('air')))
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
        seedItemUpgradeEncounter,
        switchItemUpgradeStationToAnvil,
        seedEndEyeCrafting,
        forceNextEyeOfEnderDrop: () => {
          setNextEyeOfEnderBreaks(false)
          return gameplaySnapshot()
        },
        forceNextEyeOfEnderBreak: () => {
          setNextEyeOfEnderBreaks(true)
          return gameplaySnapshot()
        },
        spawnFullHealthEnderman: () => spawnFullHealthHostile(ENDERMAN_KIND, 40),
        spawnFullHealthBlaze: () => spawnFullHealthHostile(BLAZE_KIND, 20),
        targetNearestHostile,
        targetNearestDroppedItem,
        targetNearestStrongholdFrame,
        seedEndPortalFinalFrame,
        targetCompletedEndPortal,
        seedEndDragonFinalHit,
        targetEndDragon,
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
        report: () => Effect.runSync(audioBackend.report),
        snapshot: () => audioRuntime.snapshot(Effect.runSync(browserClock.monotonicSecs)),
      },
    },
    {
      namespace: 'lifecycle',
      commands: {
        stop: () => getStopBrowserPreview()?.(),
      },
    },
  ])
  if (Either.isLeft(registry)) {
    return Either.left(registry.left)
  }
  return Either.right({
    install: () => installQaApi(globalThis as unknown as Record<string, unknown>, registry.right),
  })
}
