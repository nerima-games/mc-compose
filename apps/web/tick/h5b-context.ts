import type { BlockPosition, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import type { ItemStack } from '@nerima-games/mc-sim'
import type { GameplayFrameState } from '@nerima-games/mx-gameplay'
import type { Effect } from 'effect'

import type { H5aFrameInputResult, H5aMovementResult, H5aTickContext, MutableState } from './h5a-context'

type EffectValue<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type LegacyGameplayItemType = Exclude<ItemStack['item'], 'arrow' | 'bow'>

export type H5bPostFrameInput = Readonly<{
  readonly frame: H5aFrameInputResult
  readonly movement: H5aMovementResult
  readonly framesTotal: number
}>

export type H5bPostFrameResult = Readonly<{
  readonly deadAfterFrame: boolean
  readonly dimensionChanged: boolean
  readonly postFramePose: H5aMovementResult['poseBeforeFrame']
  readonly dimensionAfterFrame: H5aMovementResult['dimensionBeforeFrame']
  readonly bowAdvance: ReturnType<typeof import('../bow-use').advanceBowUse>
  readonly groundedAfterFrame: boolean
  readonly playerHeals: EffectValue<ReturnType<typeof import('@nerima-games/mx-gameplay').drainPlayerHeals>>
}>

export type H5bPostFrameContext = {
  readonly h5a: Omit<Pick<
    H5aTickContext,
    | 'world'
    | 'playerApi'
    | 'simState'
    | 'currentChunkContext'
    | 'currentChunkStore'
    | 'blockPosition'
    | 'blockTypeOfId'
    | 'gameplayState'
    | 'multiplayer'
    | 'isCreativeMode'
    | 'survivalHunger'
    | 'playerIsDead'
    | 'setInventoryOpen'
    | 'markSessionDirty'
    | 'syncTouchControls'
    | 'droppedItemMetadata'
    | 'droppedItemMetadataKey'
    | 'isDroppedItemBehaviour'
    | 'resetPrimaryAttackGesture'
    | 'eyeLevelOffset'
    | 'furnaceStates'
    | 'pendingFurnaceAdvances'
  >, 'state' | 'droppedItemMetadata'> & {
    readonly droppedItemMetadata: Map<string, import('../dropped-item-metadata').DroppedItemMetadata>
    readonly canvas: Pick<HTMLCanvasElement, 'setAttribute'>
    readonly state: Pick<H5aTickContext['state'],
      | 'simulationElapsedSecs'
      | 'redstoneDirty'
      | 'inventoryOpen'
      | 'selectedHotbarIndex'
      | 'multiplayerHandshakeComplete'
      | 'nextItemUseRequestId'
      | 'swimmingState'
    >
  }
  readonly state: {
    readonly blockBreakCounters: MutableState<import('../mining-completion').BlockBreakCounters>
    readonly environmentalContactDamageState: MutableState<ReturnType<typeof import('@nerima-games/mx-gameplay').resolveEnvironmentalContactDamage>['state']>
    readonly witherRuntimeState: MutableState<ReturnType<typeof import('../../multiplayer-shared/wither-runtime').restoreWitherRuntime>>
    readonly projectileRuntimeState: MutableState<ReturnType<typeof import('../projectile-runtime').initialProjectileRuntimeState>>
    readonly eyeOfEnderRuntimeState: MutableState<ReturnType<typeof import('../eye-of-ender-runtime').initialEyeOfEnderRuntimeState>>
    readonly bowUseState: MutableState<import('../bow-use').BowUseState>
    readonly footstepRuntimeState: MutableState<ReturnType<typeof import('../footstep-runtime').initialFootstepRuntimeState>>
    readonly nextWitherCommand: MutableState<number>
    readonly nextEnderDragonCommand: MutableState<number>
    readonly nextMeleeAttackRequestId: MutableState<number>
    readonly miningProgress: MutableState<import('@nerima-games/mx-gameplay').MiningProgressState | null>
    readonly primaryAttackGestureConsumed: MutableState<boolean>
    readonly activeChestId: MutableState<string | undefined>
    readonly activeFurnaceKey: MutableState<string | undefined>
    readonly tradeStatus: MutableState<string>
  }
  readonly inventoryMode: () => string
  readonly activeVillagerId: () => string | undefined
  readonly sendVitalsCommand: (command: {
    readonly _tag: 'activity'
    readonly activity: 'attack' | 'mine' | 'swim' | 'walk' | 'jump'
    readonly amount: number
  }) => void
  readonly multiplayerEntities: ReadonlyMap<string, import('@nerima-games/mx-multiplayer').AuthoritativeEntityState>
  readonly dimensionContexts: Map<import('../session-persistence').SessionState['dimension'], import('../chunk-streaming').DimensionChunkContext>
  readonly pendingBlockBreakConfirmations: Array<{
    readonly dimension: import('../session-persistence').SessionState['dimension']
    readonly position: import('../session-persistence').SessionPosition
    readonly blockId: number
  }>
  readonly pendingMiningToolDamage: Array<{
    readonly dimension: import('../session-persistence').SessionState['dimension']
    readonly position: import('../session-persistence').SessionPosition
    readonly blockId: number
    readonly slotIndex: number
    readonly item: 'wooden_pickaxe' | 'stone_pickaxe' | 'iron_pickaxe' | 'diamond_pickaxe'
  }>
  readonly customNames: Map<string, string>
  readonly enchantedItems: Map<string, import('@nerima-games/mx-gameplay').EnchantedItem>
  readonly containerMetadataKey: (containerId: string, slot: number) => string
  readonly deleteContainerMetadata: (containerId: string) => void
  readonly containerIdAt: (dimension: import('../session-persistence').SessionState['dimension'], position: import('../session-persistence').SessionPosition) => string
  readonly furnaceKeyOf: (input: { readonly dimension: import('../session-persistence').SessionState['dimension']; readonly position: import('../session-persistence').SessionPosition }) => string
  readonly isDroppedItemPickupEligible: typeof import('../dropped-item-pickup').isDroppedItemPickupEligible
  readonly droppedItemMetadataFromBehaviour: typeof import('../dropped-item-metadata').droppedItemMetadataFromBehaviour
  readonly maxStackCountForItem: typeof import('@nerima-games/mc-sim').maxStackCountForItem
  readonly itemStack: typeof import('@nerima-games/mc-sim').itemStack
  readonly observeBlockBreakCompletion: typeof import('../mining-completion').observeBlockBreakCompletion
  readonly recordBlockBreakRequest: typeof import('../mining-completion').recordBlockBreakRequest
  readonly drainVillagerTradeResults: (state: GameplayFrameState) => Effect.Effect<ReadonlyArray<import('@nerima-games/mx-gameplay').VillagerTradeResult>>
  readonly drainPlayerDamages: typeof import('@nerima-games/mx-gameplay').drainPlayerDamages
  readonly drainPlayerHeals: typeof import('@nerima-games/mx-gameplay').drainPlayerHeals
  readonly villagerTradeStatus: (result: import('@nerima-games/mx-gameplay').VillagerTradeResult) => string
  readonly renderPlayerUi: () => void
  readonly renderTradeUi: () => void
  readonly enqueueMultiplayerPlayerMove: (nowSecs: MonotonicTimeSecs) => void
  readonly sendEntityCommand: import('../multiplayer-client').MultiplayerClientApi['sendEntityCommand']
  readonly applyPortalTravels: () => Effect.Effect<void>
  readonly applyPlayerDamage: (
    damage: Parameters<H5aTickContext['world']['vitals']['damage']>[0],
    minimumHealthPoints?: number,
  ) => void
  readonly settleMeleeAttackResults: () => void
  readonly alignActiveDimension: (dimension: import('../session-persistence').SessionState['dimension']) => boolean
  readonly resetSimState: (physicsEnabled: boolean) => void
  readonly resolveFallDamage: typeof import('@nerima-games/mx-gameplay').resolveFallDamage
  readonly isStandingOnCell: (
    feetPosition: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
    x: number,
    y: number,
    z: number,
  ) => boolean
  readonly pressurePlateOccupancy: Map<string, {
    readonly dimension: import('../session-persistence').SessionState['dimension']
    readonly position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>
    readonly occupied: boolean
  }>
  readonly environmentalContactsForPose: (
    pose: Readonly<{ readonly feetPosition: Readonly<{ readonly x: number; readonly y: number; readonly z: number }> }>,
  ) => ReadonlyArray<import('@nerima-games/mx-gameplay').EnvironmentalContact>
  readonly isGameplayBlockSolid: (position: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>) => boolean
  readonly applyWorldExplosion: (
    center: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
    radius: number,
    seed: number,
    destroysResistantBlocks: boolean,
  ) => void
  readonly resetBowUse: () => void
  readonly projectileHud: Pick<HTMLElement, 'textContent' | 'hidden'>
  readonly projectedInventoryEnchantedItem: (slotIndex: number) => import('@nerima-games/mx-gameplay').EnchantedItem | null
  readonly durabilityWearWithEnchantments: typeof import('@nerima-games/mx-gameplay').durabilityWearWithEnchantments
  readonly witherRevision: () => number
  readonly enderDragonRevision: () => number
  readonly endDragonPosition: () => Readonly<{ readonly x: number; readonly y: number; readonly z: number }>
  readonly inventoryMeleeDamage: (slotIndex: number) => number
  readonly requestIdFor: (scope: string, sequence: number) => string
  readonly canFireBow: typeof import('@nerima-games/mx-gameplay').canFireBow
  readonly bowCharge: typeof import('@nerima-games/mx-gameplay').bowCharge
  readonly bowDamage: typeof import('@nerima-games/mx-gameplay').bowDamage
  readonly bowDamageWithEnchantments: typeof import('@nerima-games/mx-gameplay').bowDamageWithEnchantments
  readonly advanceFootstepRuntime: typeof import('../footstep-runtime').advanceFootstepRuntime
  readonly surfaceForBlockType: typeof import('../footstep-runtime').surfaceForBlockType
  readonly audio: Pick<import('../audio-runtime').AudioRuntime, 'play'>
  readonly advanceWitherRuntime: typeof import('../../multiplayer-shared/wither-runtime').advanceWitherRuntime
  readonly damageRuntimeWither: typeof import('../../multiplayer-shared/wither-runtime').damageRuntimeWither
  readonly advanceProjectileRuntime: typeof import('../projectile-runtime').advanceProjectileRuntime
  readonly initialProjectileRuntimeState: typeof import('../projectile-runtime').initialProjectileRuntimeState
  readonly launchRuntimeProjectile: typeof import('../projectile-runtime').launchRuntimeProjectile
  readonly recoverProjectile: typeof import('../projectile-runtime').recoverProjectile
  readonly advanceEyeOfEnderRuntime: typeof import('../eye-of-ender-runtime').advanceEyeOfEnderRuntime
  readonly initialEyeOfEnderRuntimeState: typeof import('../eye-of-ender-runtime').initialEyeOfEnderRuntimeState
  readonly advanceBowUse: typeof import('../bow-use').advanceBowUse
  readonly resolveBowHits: typeof import('@nerima-games/mx-gameplay').resolveBowHits
  readonly resolveTargetedPrimaryAttack: typeof import('@nerima-games/mx-gameplay').resolveTargetedPrimaryAttack
  readonly advanceMiningProgress: typeof import('@nerima-games/mx-gameplay').advanceMiningProgress
  readonly isLegacyGameplayItemType: (item: ItemStack['item']) => item is LegacyGameplayItemType
  readonly isSwordItem: (item: import('@nerima-games/mc-sim').ItemStack['item']) => item is 'wooden_sword' | 'stone_sword' | 'iron_sword' | 'diamond_sword'
  readonly pendingMeleeAttacks: Map<string, { readonly slotIndex: number; readonly item: 'wooden_sword' | 'stone_sword' | 'iron_sword' | 'diamond_sword' }>
  readonly projectEnchantedItem: typeof import('../enchanted-item-state').projectEnchantedItem
  readonly miningLootContextForItem: typeof import('@nerima-games/mx-gameplay').miningLootContextForItem
  readonly requestMeleeAttack: typeof import('@nerima-games/mx-gameplay').requestMeleeAttack
  readonly requestBlockBreak: typeof import('@nerima-games/mx-gameplay').requestBlockBreak
  readonly requestPotatoHarvest: typeof import('@nerima-games/mx-gameplay').requestPotatoHarvest
  readonly crops: {
    readonly matureYieldsAt: (location: { readonly dimension: import('../session-persistence').SessionState['dimension']; readonly position: BlockPosition }) => Effect.Effect<unknown>
    readonly remove: (location: { readonly dimension: import('../session-persistence').SessionState['dimension']; readonly position: BlockPosition }) => Effect.Effect<void>
  }
  readonly pendingItemUses: {
    readonly set: (
      requestId: string,
      pending: {
        readonly kind: 'harvest'
        readonly dimension: import('../session-persistence').SessionState['dimension']
        readonly position: import('../session-persistence').SessionPosition
      },
    ) => void
  }
  readonly spawnDroppedItems: typeof import('@nerima-games/mx-gameplay').spawnDroppedItems
}
