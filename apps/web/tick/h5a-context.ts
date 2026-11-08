import type { BlockPosition, DeltaTimeSecs, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import type {
  FurnaceState,
  SimFrameState,
  SimPhysicsConfig,
  Vehicle,
  WeatherState,
} from '@nerima-games/mc-sim'
import type {
  GeneratedWorld,
  GameplayFrameState,
  MobBehaviour,
  FishingSession,
} from '@nerima-games/mx-gameplay'
import type { InputAction, InputServiceApi, InputSnapshot } from '@nerima-games/mc-render'
import type { Effect } from 'effect'

import type { DimensionChunkContext } from '../chunk-streaming'
import type { MultiplayerRuntime } from '../multiplayer-client'
import type { PlayerSettingsV1 } from '../settings'
import type { SurvivalHungerCoordinator } from '../survival-hunger-runtime'
import type { NativeInputQueueState } from '../native-input-queue'
import type { PlayerSwimmingRuntimeState } from '../player-swimming-runtime'
import type { TouchLookControllerState, ConsumedTouchLook } from '../touch-input'
import type { SessionState } from '../session-persistence'

type Dimension = SessionState['dimension']
type WorldId = ReturnType<typeof import('@nerima-games/mx-multiplayer').WorldId.make>
type EffectValue<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

export type MutableState<T> = {
  readonly get: () => T
  readonly set: (value: T) => void
}

export const mutableState = <T>(get: () => T, set: (value: T) => void): MutableState<T> => ({ get, set })

export type H5aFrameInputResult = {
  readonly nowSecs: MonotonicTimeSecs
  readonly raw: number
  readonly deltaSecs: DeltaTimeSecs
  readonly walk: InputSnapshot
  readonly dead: boolean
  readonly held: (action: InputAction) => number
  readonly attackTriggered: boolean
  readonly attackHeld: boolean
  readonly canUse: boolean
  readonly useTriggered: boolean
  readonly useHeld: boolean
  readonly looked: boolean
}

export type H5aMovementResult = {
  readonly poseBeforeFrame: EffectValue<GeneratedWorld<MobBehaviour>['player']['pose']>
  readonly groundedBeforeFrame: boolean
  readonly dimensionBeforeFrame: Dimension
  readonly weatherBeforeFrame: WeatherState
  readonly sprinting: boolean
}

export type H5aLastPlayerMove = {
  readonly world: WorldId
  readonly at: { readonly x: number; readonly y: number; readonly z: number }
  readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
}

export type H5aFishingWater = {
  readonly dimension: Dimension
  readonly position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>
}

export type H5aTickContext = {
  readonly firstFrameSecs: number
  readonly clampDelta: (raw: number) => DeltaTimeSecs
  readonly inputApi: InputServiceApi
  readonly state: {
    readonly touchLookState: MutableState<TouchLookControllerState>
    readonly previousSecs: MutableState<MonotonicTimeSecs | undefined>
    readonly simulationElapsedSecs: MutableState<number>
    readonly redstoneDirty: MutableState<boolean>
    readonly inventoryOpen: MutableState<boolean>
    readonly tradeOpen: MutableState<boolean>
    readonly brewingOpen: MutableState<boolean>
    readonly selectedHotbarIndex: MutableState<number>
    readonly vehicleControls: MutableState<{ readonly throttle: number; readonly steering: number }>
    readonly nativeInputQueue: MutableState<NativeInputQueueState>
    readonly swimmingState: MutableState<PlayerSwimmingRuntimeState>
    readonly fishingSession: MutableState<FishingSession | undefined>
    readonly fishingWater: MutableState<H5aFishingWater | undefined>
    readonly multiplayerHandshakeComplete: MutableState<boolean>
    readonly multiplayerClosed: MutableState<boolean>
    readonly lastPlayerMoveSent: MutableState<H5aLastPlayerMove | undefined>
    readonly lastPlayerMoveSentAt: MutableState<number>
    readonly nextItemUseRequestId: MutableState<number>
  }
  readonly touchLook: {
    readonly consume: (state: TouchLookControllerState) => ConsumedTouchLook
  }
  readonly handlePauseRequest: () => void
  readonly renderCrosshair: (nowSecs: MonotonicTimeSecs) => void
  readonly pointerLock: {
    readonly isLockedToCanvas: () => boolean
    readonly exit: () => void
  }
  readonly paused: () => boolean
  readonly observerPulses: Map<string, number>
  readonly multiplayer: MultiplayerRuntime | undefined
  readonly syncRedstoneSnapshot: () => void
  readonly currentChunkContext: () => DimensionChunkContext
  readonly world: GeneratedWorld<MobBehaviour>
  readonly isCreativeMode: boolean
  readonly survivalHunger: SurvivalHungerCoordinator
  readonly playerIsDead: () => boolean
  readonly handleLocalPlayerDeath: () => void
  readonly markSessionDirty: () => void
  readonly syncTouchControls: () => void
  readonly setInventoryOpen: (open: boolean, mode?: 'player') => void
  readonly setBrewingOpen: (open: boolean) => void
  readonly canvas: HTMLCanvasElement
  readonly bowInteractionLocked: () => boolean
  readonly selectedHotbarAfterInput: typeof import('../player-experience').selectedHotbarAfterInput
  readonly wrapHotbarSelection: typeof import('@nerima-games/mc-render').wrapHotbarSelection
  readonly sendInventorySelection: (index: number) => void
  readonly resetPrimaryAttackGesture: () => void
  readonly sendVitalsCommand: (command: {
    readonly _tag: 'activity'
    readonly activity: 'attack'
    readonly amount: 1
  }) => void
  readonly consumeNativeInput: (
    state: NativeInputQueueState,
    action: 'attack' | 'use',
  ) => {
    readonly triggered: boolean
    readonly state: NativeInputQueueState
  }
  readonly playerSettings: PlayerSettingsV1
  readonly lookSensitivity: number
  readonly playerApi: GeneratedWorld<MobBehaviour>['player']
  readonly simState: SimFrameState
  readonly currentChunkStore: GeneratedWorld<MobBehaviour>['chunkStore']
  readonly blockPosition: (x: number, y: number, z: number) => BlockPosition
  readonly eyeLevelOffset: number
  readonly blockTypeOfId: typeof import('@nerima-games/mc-kernel').blockTypeOfId
  readonly mountedVehicleId: () => string | undefined
  readonly vehicleById: (id: string) => Vehicle | undefined
  readonly advanceSwimming: typeof import('../player-swimming-runtime').advancePlayerSwimmingRuntime
  readonly presentSwimmingState: () => void
  readonly simPhysicsConfig: SimPhysicsConfig
  readonly sprintSpeedMPerSec: number
  readonly getPlayerMovementSpeedMultiplier: (state: GameplayFrameState) => Effect.Effect<number>
  readonly gameplayState: GameplayFrameState
  readonly time: { readonly timeOfDay: Effect.Effect<number> }
  readonly weather: { readonly snapshot: Effect.Effect<WeatherState> }
  readonly syncPortalCandidateSnapshots: () => Effect.Effect<void>
  readonly setFishingResult: (result: string) => void
  readonly getOrCreateDimensionChunkContext: (dimension: Dimension) => DimensionChunkContext
  readonly advanceFishing: typeof import('@nerima-games/mx-gameplay').advanceFishing
  readonly cancelFishing: typeof import('@nerima-games/mx-gameplay').cancelFishing
  readonly multiplayerStatus: HTMLOutputElement
  readonly pumpPlayerDamage: () => void
  readonly furnaceStates: Map<string, {
    readonly dimension: Dimension
    readonly position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>
    readonly state: FurnaceState
  }>
  readonly deferredFurnaceAdvanceSecs: Map<string, number>
  readonly pendingFurnaceAdvances: Map<string, string>
  readonly requestFurnaceAdvance: (
    state: GameplayFrameState,
    requestId: string,
    furnace: FurnaceState,
    deltaSecs: number,
  ) => Effect.Effect<void>
  readonly drainMultiplayerInbound: () => void
  readonly drainCraftingInbound: () => void
  readonly drainBrewingInbound: () => void
  readonly drainAnvilInbound: () => void
  readonly drainEnchantingInbound: () => void
  readonly drainPlayerDamageInbound: () => void
  readonly runFrame: (deltaSecs: DeltaTimeSecs) => Effect.Effect<void>
  readonly applyPlayerDamage: (damage: { readonly amount: number; readonly cause: 'generic' }) => void
  readonly failBoot: (message: string, error: unknown) => void
  readonly droppedItemLifetime: {
    readonly advance: (
      dimension: Dimension,
      deltaSecs: number,
      entityIds: ReadonlyArray<string>,
    ) => ReadonlyArray<string>
  }
  readonly droppedItemMetadata: { readonly delete: (key: string) => boolean }
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly isDroppedItemBehaviour: typeof import('@nerima-games/mx-gameplay').isDroppedItemBehaviour
}

type H5aHungerOutcome = Pick<
  ReturnType<SurvivalHungerCoordinator['tick']>,
  'exhaustionAdded' | 'foodTicks' | 'regeneratedHealth' | 'starvationDamage'
>

export type H5aFrameInputContext = {
  readonly firstFrameSecs: number
  readonly clampDelta: (raw: number) => DeltaTimeSecs
  readonly inputApi: Pick<InputServiceApi, 'wasActionJustTriggered' | 'isActionActive'>
  readonly state: Pick<H5aTickContext['state'],
    | 'touchLookState'
    | 'previousSecs'
    | 'simulationElapsedSecs'
    | 'redstoneDirty'
    | 'inventoryOpen'
    | 'tradeOpen'
    | 'brewingOpen'
    | 'selectedHotbarIndex'
    | 'vehicleControls'
    | 'nativeInputQueue'
  >
  readonly touchLook: H5aTickContext['touchLook']
  readonly handlePauseRequest: H5aTickContext['handlePauseRequest']
  readonly renderCrosshair: H5aTickContext['renderCrosshair']
  readonly pointerLock: {
    readonly isLockedToCanvas: () => boolean
    readonly exit: () => void
  }
  readonly paused: H5aTickContext['paused']
  readonly observerPulses: H5aTickContext['observerPulses']
  readonly multiplayer: H5aTickContext['multiplayer']
  readonly syncRedstoneSnapshot: () => void
  readonly world: { readonly vitals: { readonly view: Effect.Effect<{ readonly healthPoints: number }> } }
  readonly isCreativeMode: H5aTickContext['isCreativeMode']
  readonly survivalHunger: Pick<SurvivalHungerCoordinator, 'submit'> & {
    readonly tick: (deltaSecs: DeltaTimeSecs) => H5aHungerOutcome
  }
  readonly playerIsDead: H5aTickContext['playerIsDead']
  readonly handleLocalPlayerDeath: H5aTickContext['handleLocalPlayerDeath']
  readonly markSessionDirty: H5aTickContext['markSessionDirty']
  readonly syncTouchControls: H5aTickContext['syncTouchControls']
  readonly setInventoryOpen: H5aTickContext['setInventoryOpen']
  readonly setBrewingOpen: H5aTickContext['setBrewingOpen']
  readonly canvas: Pick<HTMLCanvasElement, 'setAttribute'>
  readonly bowInteractionLocked: H5aTickContext['bowInteractionLocked']
  readonly selectedHotbarAfterInput: H5aTickContext['selectedHotbarAfterInput']
  readonly wrapHotbarSelection: H5aTickContext['wrapHotbarSelection']
  readonly sendInventorySelection: H5aTickContext['sendInventorySelection']
  readonly resetPrimaryAttackGesture: H5aTickContext['resetPrimaryAttackGesture']
  readonly sendVitalsCommand: H5aTickContext['sendVitalsCommand']
  readonly consumeNativeInput: H5aTickContext['consumeNativeInput']
  readonly playerSettings: Pick<PlayerSettingsV1, 'sensitivity'>
  readonly lookSensitivity: number
  readonly playerApi: Pick<GeneratedWorld<MobBehaviour>['player'], 'look'>
}

export type H5aMovementContext = {
  readonly state: Pick<H5aTickContext['state'],
    | 'swimmingState'
    | 'fishingSession'
    | 'fishingWater'
    | 'selectedHotbarIndex'
    | 'multiplayerHandshakeComplete'
    | 'multiplayerClosed'
    | 'lastPlayerMoveSent'
    | 'lastPlayerMoveSentAt'
    | 'nextItemUseRequestId'
  >
  readonly playerApi: Pick<GeneratedWorld<MobBehaviour>['player'], 'pose' | 'dimension' | 'moveTo'>
  readonly simState: Pick<SimFrameState, 'isGrounded' | 'movementIntent' | 'jumpIntent' | 'physicsConfig' | 'velocity'>
  readonly currentChunkStore: Pick<GeneratedWorld<MobBehaviour>['chunkStore'], 'getBlock'>
  readonly blockPosition: H5aTickContext['blockPosition']
  readonly eyeLevelOffset: H5aTickContext['eyeLevelOffset']
  readonly blockTypeOfId: H5aTickContext['blockTypeOfId']
  readonly mountedVehicleId: H5aTickContext['mountedVehicleId']
  readonly vehicleById: H5aTickContext['vehicleById']
  readonly advanceSwimming: H5aTickContext['advanceSwimming']
  readonly presentSwimmingState: H5aTickContext['presentSwimmingState']
  readonly simPhysicsConfig: H5aTickContext['simPhysicsConfig']
  readonly sprintSpeedMPerSec: H5aTickContext['sprintSpeedMPerSec']
  readonly getPlayerMovementSpeedMultiplier: H5aTickContext['getPlayerMovementSpeedMultiplier']
  readonly gameplayState: GameplayFrameState
  readonly time: H5aTickContext['time']
  readonly weather: H5aTickContext['weather']
  readonly syncPortalCandidateSnapshots: H5aTickContext['syncPortalCandidateSnapshots']
  readonly setFishingResult: H5aTickContext['setFishingResult']
  readonly getOrCreateDimensionChunkContext: (
    dimension: Dimension,
  ) => {
    readonly chunkStore: Pick<GeneratedWorld<MobBehaviour>['chunkStore'], 'getBlock'>
  }
  readonly advanceFishing: H5aTickContext['advanceFishing']
  readonly cancelFishing: H5aTickContext['cancelFishing']
  readonly multiplayer: H5aTickContext['multiplayer']
  readonly multiplayerStatus: Pick<HTMLOutputElement, 'textContent' | 'hidden'>
  readonly pumpPlayerDamage: H5aTickContext['pumpPlayerDamage']
  readonly furnaceStates: H5aTickContext['furnaceStates']
  readonly deferredFurnaceAdvanceSecs: H5aTickContext['deferredFurnaceAdvanceSecs']
  readonly pendingFurnaceAdvances: H5aTickContext['pendingFurnaceAdvances']
  readonly requestFurnaceAdvance: H5aTickContext['requestFurnaceAdvance']
  readonly drainMultiplayerInbound: H5aTickContext['drainMultiplayerInbound']
  readonly drainCraftingInbound: H5aTickContext['drainCraftingInbound']
  readonly drainBrewingInbound: H5aTickContext['drainBrewingInbound']
  readonly drainAnvilInbound: H5aTickContext['drainAnvilInbound']
  readonly drainEnchantingInbound: H5aTickContext['drainEnchantingInbound']
  readonly drainPlayerDamageInbound: H5aTickContext['drainPlayerDamageInbound']
  readonly runFrame: H5aTickContext['runFrame']
  readonly applyPlayerDamage: H5aTickContext['applyPlayerDamage']
  readonly failBoot: H5aTickContext['failBoot']
  readonly markSessionDirty: H5aTickContext['markSessionDirty']
  readonly canvas: Pick<HTMLCanvasElement, 'setAttribute'>
  readonly world: {
    readonly inventory: {
      readonly storageSnapshot: Effect.Effect<{
        readonly inventory: {
          readonly slots: ReadonlyArray<Readonly<{ readonly item: string; readonly count: number }> | undefined>
        }
      }>
    }
    readonly entities: Pick<GeneratedWorld<MobBehaviour>['entities'], 'entities' | 'despawn'>
  }
  readonly currentChunkContext: () => Pick<DimensionChunkContext, 'dimension'>
  readonly droppedItemLifetime: H5aTickContext['droppedItemLifetime']
  readonly droppedItemMetadata: H5aTickContext['droppedItemMetadata']
  readonly droppedItemMetadataKey: H5aTickContext['droppedItemMetadataKey']
  readonly isDroppedItemBehaviour: H5aTickContext['isDroppedItemBehaviour']
}

export type H5aMovementFrameInput = Pick<H5aFrameInputResult, 'nowSecs' | 'deltaSecs' | 'dead' | 'held'>
