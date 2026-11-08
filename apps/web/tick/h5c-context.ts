import type { BlockId, BlockPosition, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import type { ItemStack, Vehicle } from '@nerima-games/mc-sim'
import type { Effect } from 'effect'
import type { GameplayFrameState, ItemUseResult, MobDropEvent } from '@nerima-games/mx-gameplay'

import type {
  H5aFrameInputResult,
  H5aMovementResult,
  H5aTickContext,
  MutableState,
} from './h5a-context'
import type { H5bPostFrameContext, H5bPostFrameResult } from './h5b-context'
import type { MultiplayerClientApi } from '../multiplayer-client'
import type { PersistedLeverState, PersistedPortalState, PersistedVillager, SessionPosition, SessionState } from '../session-persistence'
import type { SleepLocation } from '../sleep-runtime'
import type { SleepClientState } from '../../multiplayer-shared/sleep-network'
import type { PlatformAdapters } from '../platform-adapters'
import type { RedstoneContainerRuntime } from '../redstone-container-runtime'
import type { PlayerSettingsV1 } from '../settings'

type Dimension = SessionState['dimension']
type EffectValue<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type GameplayUseItemType = Exclude<ItemStack['item'], 'iron_helmet' | 'iron_chestplate' | 'iron_leggings' | 'iron_boots'>
type GameplayHoeItemType = Parameters<typeof import('@nerima-games/mx-gameplay').requestTargetedSoilTill>[4]
type GameplayIgnitionItemType = Parameters<typeof import('@nerima-games/mx-gameplay').requestTargetedItemUse>[4]
type GameplayItemType = Parameters<typeof import('@nerima-games/mx-gameplay').isPlaceableItem>[0]
type H5cInventoryMode = 'player' | 'craftingTable' | 'furnace' | 'chest' | 'anvil' | 'enchanting'

type PendingItemUse =
  | { readonly kind: 'ignition'; readonly slotIndex: number; readonly heldItem: GameplayIgnitionItemType; readonly dimension: Dimension }
  | { readonly kind: 'till'; readonly slotIndex: number; readonly heldItem: GameplayHoeItemType }
  | { readonly kind: 'plant'; readonly slotIndex: number; readonly dimension: Dimension }
  | { readonly kind: 'harvest'; readonly dimension: Dimension; readonly position: SessionPosition }
  | { readonly kind: 'eat'; readonly slotIndex: number }

export type H5cPostFrameInput = Readonly<{
  frame: H5aFrameInputResult
  movement: H5aMovementResult
  postFrame: H5bPostFrameResult
  nowSecs: MonotonicTimeSecs
}>

export type H5cTickContext = {
  readonly h5a: H5aTickContext
  readonly h5b: H5bPostFrameContext
  readonly state: {
    readonly framesTotal: MutableState<number>
    readonly renderedCaptionSignature: MutableState<string | undefined>
    readonly nextFishingRoll: MutableState<number>
    readonly mountedVehicleId: MutableState<string | undefined>
    readonly activeBrewingStandAt: MutableState<SessionPosition | undefined>
    readonly brewingStatus: MutableState<string>
    readonly sleepRuntimeState: MutableState<ReturnType<typeof import('../sleep-runtime').initialSleepRuntimeState>>
    readonly respawnLocation: MutableState<SleepLocation | null>
    readonly networkSleepState: MutableState<SleepClientState>
    readonly nextSleepRequest: MutableState<number>
    readonly appliedNightSkipRevision: MutableState<number | null>
    readonly multiplayerRejection: MutableState<string>
    readonly nextBlockUseRequestId: MutableState<number>
    readonly nextBlockPlacementRequestId: MutableState<number>
    readonly placementsRequested: MutableState<number>
    readonly dragonEggRewarded: MutableState<boolean>
    readonly exitPortalMaterialized: MutableState<boolean>
    readonly nextMobDropId: MutableState<number>
    readonly lastObservedItemUse: MutableState<ItemUseResult | undefined>
  }
  readonly services: {
    readonly nearestVillagerForTrade: (position: SessionPosition, dimension: Dimension) => PersistedVillager | undefined
    readonly setTradeOpen: (open: boolean, villagerId?: string) => void
    readonly targetedBlock: () => Effect.Effect<{
      readonly position: SessionPosition
      readonly adjacentPosition: SessionPosition
      readonly block: number
    } | undefined>
    readonly fishingEnvironmentAt: (position: SessionPosition, isRaining: boolean) => Effect.Effect<{
      readonly hasWater: boolean
      readonly hasSkyAccess: boolean
      readonly isRaining: boolean
      readonly isOpenWater: boolean
    }>
    readonly networkFishingPhase: () => 'idle' | 'waiting' | 'bite' | 'escaped'
    readonly playerSettings: () => PlayerSettingsV1
    readonly vehicleService: EffectValue<ReturnType<typeof import('@nerima-games/mc-sim').makeVehicleService>>
    readonly vehicleList: () => ReadonlyArray<Vehicle>
    readonly localVehicleOccupant: Parameters<typeof import('@nerima-games/mx-gameplay').boardVehicle>[1]
    readonly replaceVehicle: (vehicle: Vehicle) => void
    readonly multiplayerClient: Pick<
      MultiplayerClientApi,
      'sendVitalsCommand' | 'sendPortalUseCommand' | 'sendToggleLeverCommand' | 'sendEntityCommand' | 'sendFacilityCommand' | 'requestBrewing'
    >
    readonly endPortalComplete: () => boolean
    readonly useEndFeature: () => Effect.Effect<boolean>
    readonly renderBrewingUi: () => void
    readonly time: EffectValue<ReturnType<typeof import('@nerima-games/mc-sim').makeTimeService>>
    readonly weather: EffectValue<ReturnType<typeof import('@nerima-games/mc-sim').makeWeatherService>>
    readonly redstoneContainerRuntime: RedstoneContainerRuntime
    readonly redstoneRuntime: PlatformAdapters['redstoneRuntime']
    readonly leverKeyOf: (lever: Pick<PersistedLeverState, 'dimension' | 'position'>) => string
    readonly asBlockPosition: (position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>) => BlockPosition
    readonly streamAround: ReturnType<typeof import('../chunk-streaming').makeChunkStreaming>['streamAround']
    readonly presentWeather: (state: import('@nerima-games/mc-sim').WeatherState) => void
    readonly presentWeatherRuntime: (
      state: import('@nerima-games/mc-sim').WeatherState,
      pose: Readonly<{ readonly feetPosition: Readonly<{ readonly x: number; readonly y: number; readonly z: number }> }>,
      nowSecs: number,
    ) => void
    readonly syncRenderedEntities: () => void
    readonly registerPortal: (portal: PersistedPortalState) => boolean
    readonly requiredSleepRatio: number
    readonly sleepHud: Pick<HTMLOutputElement, 'textContent' | 'hidden'>
    readonly endDragonSnapshot: () => EffectValue<GameplayFrameState['enderDragonEncounter']['snapshot']>
    readonly adapters: Pick<
      PlatformAdapters,
      'audio' | 'endAudio' | 'getReadAudioListenerForward' | 'drainEndAudioEvents' | 'queueEndAudio' | 'placementAudio'
    >
    readonly uiFrameState: EffectValue<typeof import('@nerima-games/mx-ui').makeUiFrameState>
    readonly fpsValue: Pick<HTMLElement, 'textContent'>
    readonly captionsParent: Pick<HTMLElement, 'replaceChildren'>
    readonly observedMobDrops: Array<MobDropEvent & { readonly renderId: string }>
    readonly pendingItemUses: Map<string, PendingItemUse>
    readonly pendingBlockUses: Map<string, { readonly dimension: Dimension; readonly position: SessionPosition }>
    readonly pendingBlockPlacements: Map<string, {
      readonly dimension: Dimension
      readonly item: GameplayItemType
      readonly position: SessionPosition
    }>
    readonly pendingWitherSummonChecks: Array<{
      readonly dimension: Dimension
      readonly item: 'wither_skeleton_skull'
      readonly position: SessionPosition
    }>
    readonly leverStates: Map<string, PersistedLeverState>
    readonly comparatorModes: Map<string, 'compare' | 'subtract'>
    readonly poweredRails: Set<string>
    readonly redstoneLampTransitionLog: Map<string, Array<{ readonly lit: boolean; readonly writtenBlock: BlockId | null }>>
    readonly crops: EffectValue<ReturnType<typeof import('@nerima-games/mc-sim').makeCropService>>
    readonly setInventoryOpen: (open: boolean, mode?: H5cInventoryMode) => void
    readonly isGameplayUseItemType: (item: ItemStack['item']) => item is GameplayUseItemType
    readonly isGameplayHoeItem: (item: ItemStack['item']) => item is GameplayHoeItemType
    readonly isGameplayIgnitionItem: (item: ItemStack['item']) => item is GameplayIgnitionItemType
    readonly isPlaceableGameplayItem: (item: ItemStack['item']) => item is import('@nerima-games/mx-gameplay').PlaceableItemType
  }
}
