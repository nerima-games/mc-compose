import {
  createHungerAuthority,
  decodeFrame,
  encodeFrame,
  type AuthoritativeCommand,
  type AuthoritativeCommandResult,
  type AuthoritativeDelta,
  type AuthoritativeEntityState,
  type AuthoritativeSnapshot,
  type BlockMutationRejected,
  type BlockPos,
  type CommandId,
  type CommandRejectionReason,
  type EndPortalUseCommand,
  type NetherPortalUseCommand,
  type NetworkMessage,
  type Orientation,
  type PlayerId,
  type PlayerSnapshot,
  type WireText,
  type WorldId,
  type WorldSnapshot,
  type ContainerKind,
  type HungerActor,
  type HungerCommand,
  type HungerEvent,
} from '@nerima-games/mx-multiplayer'
import { blockIdOf, blockTypeOfId, isBlockType, isItemType, maxStackCountOfItem, propertyOfBlockId, StackCount } from '@nerima-games/mc-kernel'
import { pistonPositionAt, validatePistonPlan, type PistonCellRead, type PistonMovementPlan } from '@nerima-games/mx-redstone'
import { END_PORTAL_BLOCK, END_PORTAL_FRAME_OFFSETS, endPortalCenterForStronghold, nearestStrongholdSite, type Dimension } from '@nerima-games/mc-worldgen'
import { EYE_LEVEL_OFFSET, containerCapacity, craftFromGrid, craftGrid, durabilityForItem, equipmentDefinitionFor, equipmentItem, forwardVector, isValidDurabilityForItem, itemStack, levelForTotalExperience, planExplosion, raycastArrowBlock, STARTER_RECIPES, targetBlockFromPlayerPose, totalExperienceAtLevel, type FurnaceState as SimFurnaceState } from '@nerima-games/mc-sim'
import {
  BLAZE_KIND,
  BLAZE_XP_REWARD,
  advanceWeather,
  bowCharge,
  bowDamage,
  arrowHitProjection,
  castFishing,
  advanceFishing,
  canFireBow,
  CREEPER_KIND,
  CREEPER_XP_REWARD,
  DORMANT_FUSE,
  DEFAULT_ROLL_SEED,
  INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
  INITIAL_WEATHER,
  LOWEST_WEATHER_ROLLS,
  ENDER_PEARL_DAMAGE,
  ENDER_PEARL_MAX_DISTANCE,
  CHICKEN_KIND,
  COW_KIND,
  ENDERMAN_KIND,
  ENDERMAN_XP_REWARD,
  PIG_KIND,
  SKELETON_KIND,
  SPIDER_KIND,
  SHEEP_KIND,
  ZOMBIE_KIND,
  ZOMBIE_XP_REWARD,
  ZOMBIFIED_PIGLIN_KIND,
  applyFurnaceAdvance,
  applyStatusEffect,
  acceptBrewingBottle,
  acceptBrewingFuel,
  acceptBrewingIngredient,
  collectBrewingBottle,
  copyBrewingStandState,
  copyStatusEffectState,
  drinkBrewingPotion,
  emptyBrewingStandState,
  emptyStatusEffectState,
  isValidBrewingStandState,
  isValidStatusEffectState,
  POISON_DAMAGE_POINTS,
  POISON_MINIMUM_HEALTH_POINTS,
  REGENERATION_HEAL_POINTS,
  PLAYER_MAXIMUM_HEALTH_POINTS,
  tickBrewingStand,
  tickStatusEffects,
  blockLoot,
  isBucketItem,
  isWithinLightningStrikeRadius,
  dropRollsNeeded,
  explosionDamageAmount,
  explosionDamageAt,
  despawnVerdict,
  enderPearlDisplacement,
  reelFishing,
  ENDERMAN_TELEPORT_ATTEMPTS,
  ENDERMAN_TELEPORT_MAX_BLOCKS,
  endermanTeleportUrge,
  furnaceAdvanceChanged,
  FALLING_BLOCK_MOVES_PER_TICK,
  miningLootContextForItem,
  nextRoll,
  normaliseSeed,
  planFurnaceAdvance,
  planFallingBlockMoves,
  PRIMED_TNT_FUSE_SECS,
  rollDropsOfKind,
  mobXpReward,
  initialEcosystemMobState,
  repairEcosystemMobState,
  resolveEnvironmentalContactDamage,
  resolveSafeEndermanTeleport,
  stepCreeperFuse,
  stepEcosystemMob,
  TNT_EXPLOSION_POWER,
  weatherExpires,
  type CreeperFuse,
  type BucketItemType,
  type EcosystemMobState,
  type EndermanTeleportCell,
  type EnvironmentalContact,
  type EnvironmentalContactDamageState,
  type Explosion,
  type FishingSession,
  type BrewingBottle,
  type BrewingStandState,
  type StatusEffectState,
  applyEnchantmentOffer,
  advanceEnderDragonEncounter,
  decodeEnchantedItem,
  enchantmentOffers,
  decodeEnderDragonEncounterSnapshot,
  damageEnderDragonByPlayer,
  initialEnderDragonEncounter,
  type EnderDragonEncounterSnapshot,
  type EnchantedItem,
} from '@nerima-games/mx-gameplay'
import { Either, Option } from 'effect'
import { DeltaTimeSecs } from '../../src/domain/kernel-vocabulary'
import {
  SleepAuthority,
  decodeSleepWireMessage,
  type SleepWireMessage,
} from '../multiplayer-shared/sleep-network'
import {
  advanceWitherRuntime,
  damageRuntimeWither,
  matchRuntimeWitherSummon,
  restoreWitherRuntime,
  snapshotWitherRuntime,
  summonRuntimeWither,
  type WitherRuntimeSnapshot,
  type WitherRuntimeState,
} from '../multiplayer-shared/wither-runtime'
import { decodeWitherWireMessage, type WitherWireMessage } from '../multiplayer-shared/wither-network'
import { decodeEnderDragonWireMessage, type EnderDragonWireMessage } from '../multiplayer-shared/ender-dragon-network'
import {
  decodePlayerDamageWireMessage,
  PLAYER_DAMAGE_MAX_WIRE_LENGTH,
  type PlayerDamageCommand,
  type PlayerDamageCommandResult,
  type PlayerDamageWireMessage,
} from '../multiplayer-shared/player-damage-network'
import { CRAFTING_MAX_WIRE_LENGTH, decodeCraftingWireMessage, type CraftingCommand, type CraftingCommandResult } from '../multiplayer-shared/crafting-network'
import { BREWING_MAX_WIRE_LENGTH, decodeBrewingWireMessage, type BrewingCommand, type BrewingCommandResult, type BrewingWireMessage } from '../multiplayer-shared/brewing-network'
import {
  ANVIL_MAX_WIRE_LENGTH,
  decodeAnvilWireMessage,
  isValidAnvilName,
  type AnvilCommand,
  type AnvilCommandResult,
  type AnvilWireMessage,
  type PlayerAnvilNamesDelta,
} from '../multiplayer-shared/anvil-network'
import {
  decodeEnchantingWireMessage,
  ENCHANTING_MAX_WIRE_LENGTH,
  type EnchantingCommand,
  type EnchantingCommandResult,
  type EnchantingWireMessage,
  type PlayerEnchantmentsDelta,
} from '../multiplayer-shared/enchanting-network'
import { spendExperienceLevels } from '../multiplayer-shared/anvil-repair'

export type ClientId = string
export type SendFrame = (frame: WireText) => void

export const playerDamageResultKey = (player: PlayerId, commandId: string): string =>
  JSON.stringify([player, commandId])

const playerDamageFingerprint = (command: PlayerDamageCommand): string => JSON.stringify([
  command._tag,
  command.commandId,
  command.player,
  command.world,
  command.expectedRevision,
  command.amount,
  command.minimumHealthPoints,
])

export const craftingResultKey = (player: PlayerId, commandId: string): string => JSON.stringify([player, commandId])
const craftingFingerprint = (command: CraftingCommand): string => JSON.stringify(command)
export const brewingResultKey = (player: PlayerId, commandId: string): string => JSON.stringify([player, commandId])
const brewingFingerprint = (command: BrewingCommand): string => JSON.stringify(command)
export const anvilResultKey = (player: PlayerId, commandId: string): string => JSON.stringify([player, commandId])
const anvilFingerprint = (command: AnvilCommand): string => JSON.stringify(command)
export const enchantingResultKey = (player: PlayerId, commandId: string): string => JSON.stringify([player, commandId])
const enchantingFingerprint = (command: EnchantingCommand): string => JSON.stringify(command)

export interface MultiplayerServerOptions {
  readonly worldId: string
  readonly dimension?: Dimension
  readonly seed: number
  readonly allowedBlocks: ReadonlySet<string>
  readonly bounds?: Readonly<{
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
  }>
  readonly generatedBlockAt?: (position: BlockPos) => string | null
  readonly staticBlocks?: ReadonlyArray<Readonly<{ at: BlockPos; block: string | null }>>
  readonly spawnAt?: BlockPos
  readonly initialState?: MultiplayerServerState
  readonly onStateChanged?: (state: MultiplayerServerState) => void
  readonly maxMoveDistance?: number
  readonly passableBlocks?: ReadonlySet<string>
  readonly sleepPercentage?: number
  readonly now?: () => number
  readonly difficulty?: 'peaceful' | 'easy' | 'normal' | 'hard'
  readonly onEndPortalUse?: (clientId: ClientId, command: EndPortalUseCommand) => void
  readonly onNetherPortalUse?: (clientId: ClientId, command: NetherPortalUseCommand) => void
}

export interface EyeOfEnderRecoveryState {
  readonly entityId: AuthoritativeEntityState['entityId']
  readonly at: Readonly<{ x: number; y: number; z: number }>
  readonly remainingSecs: number
}

export interface WeatherClockState {
  readonly remainingSecs: number
  readonly seed: number
}

export interface MultiplayerServerState {
  readonly revision: number
  readonly blocks: ReadonlyArray<Readonly<{ at: BlockPos; block: string | null }>>
  readonly poweredRails?: ReadonlyArray<Readonly<{ at: BlockPos; powered: boolean }>>
  readonly levers?: ReadonlyArray<Readonly<{ at: BlockPos; active: boolean }>>
  readonly inventories: AuthoritativeSnapshot['inventories']
  readonly vitals: AuthoritativeSnapshot['vitals']
  readonly timeWeather: AuthoritativeSnapshot['timeWeather']
  readonly weatherClock?: WeatherClockState
  readonly containers: AuthoritativeSnapshot['containers']
  readonly furnaces: AuthoritativeSnapshot['furnaces']
  readonly villagerTrades: AuthoritativeSnapshot['villagerTrades']
  readonly entities?: ReadonlyArray<AuthoritativeEntityState>
  readonly eyeOfEnderRecoveries?: ReadonlyArray<EyeOfEnderRecoveryState>
  readonly playerPositions?: ReadonlyArray<Readonly<{
    player: PlayerId
    at: BlockPos
    facing: Orientation
  }>>
  readonly wither?: WitherRuntimeSnapshot
  readonly witherRevision?: number
  readonly enderDragon?: EnderDragonEncounterSnapshot
  readonly enderDragonRevision?: number
  readonly brewingStands?: ReadonlyArray<Readonly<{ at: BlockPos; state: BrewingStandState }>>
  readonly statusEffects?: ReadonlyArray<Readonly<{ player: PlayerId; state: StatusEffectState }>>
  readonly anvilNames?: ReadonlyArray<Readonly<{
    player: PlayerId
    names: ReadonlyArray<Readonly<{ slot: number; name: string }>>
  }>>
  readonly enchantments?: ReadonlyArray<Readonly<{
    player: PlayerId
    seed: number
    items: ReadonlyArray<Readonly<{ slot: number; item: EnchantedItem }>>
  }>>
}

export type ReceiveResult =
  | Readonly<{ accepted: true; message: NetworkMessage | SleepWireMessage | WitherWireMessage | EnderDragonWireMessage | PlayerDamageWireMessage | CraftingCommand | BrewingCommand | AnvilCommand | EnchantingCommand }>
  | Readonly<{ accepted: false; reason: 'unknown-client' | 'malformed-frame' | 'join-required' | 'duplicate-player' | 'identity-spoof' | 'wrong-world' | 'invalid-movement' | 'invalid-mutation' | 'invalid-command' }>

interface ConnectedClient {
  readonly send: SendFrame
  playerId: PlayerId | null
}

interface MutablePlayer {
  readonly player: PlayerId
  readonly name: PlayerSnapshot['name']
  readonly world: WorldId
  at: PlayerSnapshot['at']
  facing: Orientation
}

interface MovementBudget {
  readonly updatedAtMs: number
  readonly availableDistance: number
}

type InventoryState = AuthoritativeSnapshot['inventories'][number]['state']
type VitalsState = AuthoritativeSnapshot['vitals'][number]['state']
type TimeWeatherState = AuthoritativeSnapshot['timeWeather']
type ContainerState = AuthoritativeSnapshot['containers'][number]
type FurnaceState = AuthoritativeSnapshot['furnaces'][number]
type ItemStack = NonNullable<InventoryState['slots'][number]>
type EquipmentState = NonNullable<InventoryState['equipment']>
type EquipmentSlot = keyof EquipmentState
type MutableEquipmentState = { -readonly [Slot in EquipmentSlot]: EquipmentState[Slot] }
type MobWireState = NonNullable<Extract<AuthoritativeEntityState, { readonly _tag: 'living' }>['mobState']>
type UnknownRecord = Readonly<Record<string, unknown>>

const containerKindForBlock = (block: string): ContainerKind | undefined => {
  switch (block) {
    case 'chest':
    case 'shulker_box':
    case 'dispenser':
    case 'dropper':
    case 'hopper':
      return block
    default:
      return undefined
  }
}

const emptyContainerSlots = (kind: ContainerKind): Array<ItemStack | null> =>
  Array.from({ length: containerCapacity(kind) }, () => null)

const unknownRecord = (value: unknown): UnknownRecord | undefined =>
  typeof value === 'object' && value !== null ? value as UnknownRecord : undefined

export const isWeatherClockState = (value: unknown): value is WeatherClockState => {
  const record = unknownRecord(value)
  return record !== undefined
    && typeof record['remainingSecs'] === 'number'
    && Number.isFinite(record['remainingSecs'])
    && record['remainingSecs'] > 0
    && typeof record['seed'] === 'number'
    && Number.isSafeInteger(record['seed'])
    && normaliseSeed(record['seed']) === record['seed']
}

const supportedMobKind = (entityType: string) => {
  if (entityType === ZOMBIE_KIND) return ZOMBIE_KIND
  if (entityType === CREEPER_KIND) return CREEPER_KIND
  if (entityType === ENDERMAN_KIND) return ENDERMAN_KIND
  if (entityType === BLAZE_KIND) return BLAZE_KIND
  return undefined
}

const supportedPassiveMobKind = (entityType: string) => {
  if (entityType === String(COW_KIND)) return COW_KIND
  if (entityType === String(PIG_KIND)) return PIG_KIND
  if (entityType === String(SHEEP_KIND)) return SHEEP_KIND
  if (entityType === String(CHICKEN_KIND)) return CHICKEN_KIND
  return undefined
}

const supportedHostileEcosystemMobKind = (entityType: string) => {
  if (entityType === String(SKELETON_KIND)) return SKELETON_KIND
  if (entityType === String(SPIDER_KIND)) return SPIDER_KIND
  if (entityType === String(ZOMBIE_KIND)) return ZOMBIE_KIND
  if (entityType === String(ZOMBIFIED_PIGLIN_KIND)) return ZOMBIFIED_PIGLIN_KIND
  if (entityType === String(BLAZE_KIND)) return BLAZE_KIND
  return undefined
}

const isAuthoritativeHostileMob = (entityType: string): boolean =>
  entityType === CREEPER_KIND || entityType === ENDERMAN_KIND || supportedHostileEcosystemMobKind(entityType) !== undefined

const mobWireState = (value: unknown): MobWireState => {
  const state = unknownRecord(value)
  if (state === undefined) {
    return { attackCooldownSecs: 0, motionPhase: 0, provoked: false }
  }
  return {
    attackCooldownSecs: typeof state['attackCooldownSecs'] === 'number' && Number.isFinite(state['attackCooldownSecs']) && state['attackCooldownSecs'] >= 0
      ? state['attackCooldownSecs']
      : 0,
    motionPhase: typeof state['motionPhase'] === 'number' && Number.isFinite(state['motionPhase']) && state['motionPhase'] >= 0
      ? state['motionPhase']
      : 0,
    provoked: state['provoked'] === true,
    ...(typeof state['ageTicks'] === 'number' && Number.isSafeInteger(state['ageTicks']) && state['ageTicks'] >= 0 ? { ageTicks: state['ageTicks'] } : {}),
    ...(typeof state['persistent'] === 'boolean' ? { persistent: state['persistent'] } : {}),
    ...(typeof state['named'] === 'boolean' ? { named: state['named'] } : {}),
    ...(typeof state['tamed'] === 'boolean' ? { tamed: state['tamed'] } : {}),
    ...(typeof state['charged'] === 'boolean' ? { charged: state['charged'] } : {}),
  }
}

const ecosystemMobStateForSimulation = (value: unknown): EcosystemMobState | undefined => {
  const state = unknownRecord(value)
  return state === undefined ? undefined : repairEcosystemMobState({ ...state, _tag: 'EcosystemMob' })
}

const creeperFuseForSimulation = (value: unknown): CreeperFuse => {
  const state = unknownRecord(value)
  if (state === undefined) return DORMANT_FUSE
  const motionPhase = state['motionPhase']
  if (state['provoked'] !== true || typeof motionPhase !== 'number') return DORMANT_FUSE
  return Number.isFinite(motionPhase) && motionPhase >= 0
    ? { _tag: 'Lit', burnedSecs: motionPhase }
    : DORMANT_FUSE
}

const creeperWireState = (fuse: CreeperFuse, state: MobWireState): MobWireState => ({
  ...state,
  attackCooldownSecs: 0,
  motionPhase: fuse._tag === 'Lit' ? fuse.burnedSecs : 0,
  provoked: fuse._tag === 'Lit',
})

const creeperDeltaTime = (elapsedSecs: number): Parameters<typeof stepCreeperFuse>[2] =>
  elapsedSecs as Parameters<typeof stepCreeperFuse>[2]

const endermanTeleportOffset = (roll: number): number =>
  Math.max(0, Math.min(1, roll)) * ENDERMAN_TELEPORT_MAX_BLOCKS * 2 - ENDERMAN_TELEPORT_MAX_BLOCKS

const mobExperienceReward = (kind: ReturnType<typeof supportedMobKind>): number => {
  if (kind === ZOMBIE_KIND) return ZOMBIE_XP_REWARD
  if (kind === CREEPER_KIND) return CREEPER_XP_REWARD
  if (kind === ENDERMAN_KIND) return ENDERMAN_XP_REWARD
  if (kind === BLAZE_KIND) return BLAZE_XP_REWARD
  return 0
}

const deterministicRoll = (input: string): number => {
  let hash = 2_166_136_261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0) / 0x1_0000_0000
}

const EYE_OF_ENDER_FLIGHT_SECS = 2.5

const eyeOfEnderDestination = (
  origin: Readonly<{ x: number; y: number; z: number }>,
  target: Readonly<{ x: number; y: number; z: number }>,
): Readonly<{ x: number; y: number; z: number }> => {
  const dx = target.x - origin.x
  const dz = target.z - origin.z
  const horizontalDistance = Math.hypot(dx, dz)
  const scale = horizontalDistance === 0 ? 0 : Math.min(horizontalDistance, 12) / horizontalDistance
  return { x: origin.x + dx * scale, y: origin.y + 8, z: origin.z + dz * scale }
}

interface MutableInventoryState {
  readonly slots: Array<ItemStack | null>
  readonly durability: Array<{ readonly current: number; readonly max: number } | null>
  readonly equipment: MutableEquipmentState
  selectedSlot: number
}

interface MutableVitalsState {
  health: number
  hunger: number
  experience: number
}

interface MutableContainerState {
  readonly containerId: string
  readonly kind: ContainerKind
  readonly slots: Array<ItemStack | null>
}

interface MutableFurnaceState {
  readonly furnaceId: string
  input: ItemStack | null
  fuel: ItemStack | null
  output: ItemStack | null
  burnTicksRemaining: number
  cookTicks: number
}

type CommandDecision =
  | Readonly<{ accepted: false; reason: CommandRejectionReason }>
  | Readonly<{
      accepted: true
      deltas: (revision: number) => ReadonlyArray<AuthoritativeDelta>
      messages?: (revision: number) => ReadonlyArray<NetworkMessage>
      worldSnapshotRequired?: boolean
      snapshotBroadcastRequired?: boolean
    }>

const DEFAULT_BOUNDS = {
  minX: -30_000_000,
  maxX: 30_000_000,
  minY: -64,
  maxY: 319,
  minZ: -30_000_000,
  maxZ: 30_000_000,
} as const

const DEFAULT_FACING: Orientation = { yawRadians: 0, pitchRadians: 0 }
const DEFAULT_MAX_MOVE_DISTANCE = 8
const DEFAULT_MAX_VEHICLE_MOVE_DISTANCE = 4
const VEHICLE_MOVE_DISTANCE = 1
const PLAYER_MOVE_SPEED_BLOCKS_PER_SECOND = 8
const MOVEMENT_COLLISION_SAMPLE_DISTANCE = 0.25
const DEFAULT_INVENTORY_SLOTS = 36
const DEFAULT_VITALS: VitalsState = { health: 20, hunger: 20, experience: 0 }
const DEFAULT_TIME_WEATHER: TimeWeatherState = { timeOfDay: 6_000, weather: 'clear' }
const DEFAULT_WEATHER_CLOCK: WeatherClockState = {
  remainingSecs: INITIAL_WEATHER.remainingSecs,
  seed: DEFAULT_ROLL_SEED,
}
const MINECRAFT_DAY_TICKS = 24_000
const MINECRAFT_TICK_MS = 50
const THUNDER_STRIKE_INTERVAL_TICKS = 160
const ITEM_DROP_LIFESPAN_TICKS = 6_000
const ARROW_LIFESPAN_TICKS = 1_200
const ARROW_GRAVITY = 9.8
const PLAYER_HALF_WIDTH = 0.3
const PLAYER_HEIGHT = 1.8
const COLLISION_EPSILON = 1e-9
const BLOCK_INTERACTION_RANGE = 5
const WITHER_INTERACTION_RANGE = 5
const WITHER_ATTACK_DAMAGE = 4
const WITHER_ATTACK_COOLDOWN_MS = 500
const WITHER_TARGET_RANGE = 64
const ENDER_DRAGON_INTERACTION_RANGE = 8
const ENDER_DRAGON_ATTACK_DAMAGE = 4
const ENDER_DRAGON_ATTACK_COOLDOWN_MS = 500
const END_EXIT_PORTAL_BLOCK = blockTypeOfId(END_PORTAL_BLOCK.PORTAL) ?? 'end_portal'
const END_PORTAL_FRAME_EMPTY_BLOCK = blockTypeOfId(END_PORTAL_BLOCK.FRAME_EMPTY) ?? 'end_portal_frame'
const END_PORTAL_FRAME_FILLED_BLOCK = blockTypeOfId(END_PORTAL_BLOCK.FRAME_FILLED) ?? 'end_portal_frame_filled'
const positionKey = ({ x, y, z }: BlockPos): string => `${String(x)},${String(y)},${String(z)}`

const cloneStack = (stack: ItemStack | null): ItemStack | null => stack === null ? null : { ...stack }
const emptyEquipmentState = (): EquipmentState => ({ head: null, chest: null, legs: null, feet: null, offhand: null })
const cloneEquipmentStack = (stack: ItemStack | null, slot: EquipmentSlot): ItemStack | null => {
  if (stack === null || !isItemType(stack.item) || stack.count !== 1 || equipmentDefinitionFor(stack.item)?.slot !== slot) return null
  const durability = stack.durability ?? durabilityForItem(stack.item)
  return durability === null || !isValidDurabilityForItem(stack.item, durability)
    ? null
    : { ...stack, durability: { ...durability } }
}
const cloneEquipment = (equipment: InventoryState['equipment']): EquipmentState => ({
  head: cloneEquipmentStack(equipment?.head ?? null, 'head'),
  chest: cloneEquipmentStack(equipment?.chest ?? null, 'chest'),
  legs: cloneEquipmentStack(equipment?.legs ?? null, 'legs'),
  feet: cloneEquipmentStack(equipment?.feet ?? null, 'feet'),
  offhand: cloneEquipmentStack(equipment?.offhand ?? null, 'offhand'),
})
const cloneInventory = (state: InventoryState): MutableInventoryState => ({
  slots: state.slots.map(cloneStack),
  durability: state.slots.map((stack, index) => {
    const durability = stack?.durability ?? state.durability?.[index]
    if (stack === null || !isItemType(stack.item)) return null
    return durability !== undefined && isValidDurabilityForItem(stack.item, durability)
      ? { ...durability }
      : durabilityForItem(stack.item)
  }),
  equipment: cloneEquipment(state.equipment),
  selectedSlot: state.selectedSlot,
})
const inventorySnapshot = (state: MutableInventoryState): InventoryState => {
  return {
    slots: state.slots.map((stack, index) => {
      const durability = state.durability[index]
      return stack !== null && isItemType(stack.item) && durability !== null && durability !== undefined && isValidDurabilityForItem(stack.item, durability)
        ? { ...stack, durability: { ...durability } }
        : cloneStack(stack)
    }),
    selectedSlot: state.selectedSlot,
    equipment: cloneEquipment(state.equipment),
  }
}
const vitalsSnapshot = (state: MutableVitalsState): VitalsState => ({ ...state })
const containerSnapshot = (state: MutableContainerState): ContainerState => ({
  containerId: state.containerId,
  kind: state.kind,
  slots: state.slots.map(cloneStack),
})
const furnaceSnapshot = (state: MutableFurnaceState): FurnaceState => ({
  ...state,
  input: cloneStack(state.input),
  fuel: cloneStack(state.fuel),
  output: cloneStack(state.output),
})

type SimItemStack = NonNullable<SimFurnaceState['input']>

const toSimulationStack = (stack: ItemStack | null): SimItemStack | null | undefined => {
  if (stack === null) return null
  if (!isItemType(stack.item)) return undefined
  return { item: stack.item, count: StackCount(stack.count) }
}

const fromSimulationStack = (stack: SimItemStack | null): ItemStack | null =>
  stack === null ? null : { item: stack.item, count: stack.count }

const furnaceSimulationState = (state: MutableFurnaceState): SimFurnaceState | null => {
  const input = toSimulationStack(state.input)
  const fuel = toSimulationStack(state.fuel)
  const output = toSimulationStack(state.output)
  if (input === undefined || fuel === undefined || output === undefined) return null
  return {
    input,
    fuel,
    output,
    burnRemainingSecs: state.burnTicksRemaining / 20,
    cookElapsedSecs: state.cookTicks / 20,
  }
}

const applyFurnaceSimulationState = (target: MutableFurnaceState, state: SimFurnaceState): void => {
  target.input = fromSimulationStack(state.input)
  target.fuel = fromSimulationStack(state.fuel)
  target.output = fromSimulationStack(state.output)
  target.burnTicksRemaining = Math.round(state.burnRemainingSecs * 20)
  target.cookTicks = Math.round(state.cookElapsedSecs * 20)
}

const isAuthoritativeCommand = (message: NetworkMessage): message is AuthoritativeCommand =>
  message._tag === 'PlayerInventoryCommand' ||
  message._tag === 'PlayerVitalsCommand' ||
  message._tag === 'WorldTimeWeatherCommand' ||
  message._tag === 'ContainerCommand' ||
  message._tag === 'FurnaceCommand' ||
  message._tag === 'VillagerTradeCommand' ||
  message._tag === 'EntityAttackCommand' ||
  message._tag === 'EntityPickupCommand' ||
    message._tag === 'BowUseCommand' ||
    message._tag === 'ThrowEyeOfEnderCommand' ||
    message._tag === 'InsertEyeIntoEndPortalFrameCommand' ||
    message._tag === 'EndPortalUseCommand' ||
    message._tag === 'NetherPortalUseCommand' ||
    message._tag === 'ToggleLeverCommand' ||
    message._tag === 'IgniteTntCommand' ||
    message._tag === 'EnderPearlCommand' ||
    message._tag === 'BucketUseCommand' ||
    message._tag === 'VehicleUseCommand' ||
    message._tag === 'FishingCommand' ||
  message._tag === 'VehicleCommand'

const moveStack = (
  sourceSlots: Array<ItemStack | null>,
  sourceIndex: number,
  destinationSlots: Array<ItemStack | null>,
  destinationIndex: number,
  count: number,
): CommandRejectionReason | null => {
  if (sourceSlots === destinationSlots && sourceIndex === destinationIndex) return 'invalid-command'
  if (sourceIndex >= sourceSlots.length || destinationIndex >= destinationSlots.length) return 'invalid-command'
  const source = sourceSlots[sourceIndex]
  if (source === null || source === undefined || source.count < count) return 'insufficient-items'
  const destination = destinationSlots[destinationIndex]
  if (destination !== null && destination !== undefined && destination.item !== source.item) return 'invalid-command'
  if (
    destination !== null
    && destination !== undefined
    && isItemType(source.item)
    && destination.count + count > maxStackCountOfItem(source.item)
  ) return 'invalid-command'
  sourceSlots[sourceIndex] = source.count === count ? null : { ...source, count: source.count - count }
  destinationSlots[destinationIndex] = destination === null || destination === undefined
    ? { ...source, count }
    : { ...destination, count: destination.count + count }
  return null
}

const swapStacks = (
  slots: Array<ItemStack | null>,
  sourceIndex: number,
  destinationIndex: number,
): CommandRejectionReason | null => {
  if (sourceIndex === destinationIndex) return 'invalid-command'
  if (sourceIndex >= slots.length || destinationIndex >= slots.length) return 'invalid-command'
  if (slots[sourceIndex] === null || slots[sourceIndex] === undefined) return 'insufficient-items'
  const source = slots[sourceIndex]
  slots[sourceIndex] = slots[destinationIndex] ?? null
  slots[destinationIndex] = source
  return null
}

const moveInventoryStack = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  destinationIndex: number,
  count: number,
): CommandRejectionReason | null => {
  const sourceDurability =
    inventory.durability[sourceIndex] ?? inventory.slots[sourceIndex]?.durability ?? null
  const reason = moveStack(inventory.slots, sourceIndex, inventory.slots, destinationIndex, count)
  if (reason === null && inventory.slots[sourceIndex] === null) {
    inventory.durability[sourceIndex] = null
    inventory.durability[destinationIndex] = sourceDurability
  }
  return reason
}

const swapInventoryStacks = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  destinationIndex: number,
): CommandRejectionReason | null => {
  const reason = swapStacks(inventory.slots, sourceIndex, destinationIndex)
  if (reason === null) {
    const sourceDurability = inventory.durability[sourceIndex] ?? null
    inventory.durability[sourceIndex] = inventory.durability[destinationIndex] ?? null
    inventory.durability[destinationIndex] = sourceDurability
  }
  return reason
}

const equipInventoryItem = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  equipmentSlot: EquipmentSlot,
): CommandRejectionReason | null => {
  if (sourceIndex >= inventory.slots.length || inventory.equipment[equipmentSlot] !== null) return 'invalid-command'
  const source = inventory.slots[sourceIndex]
  if (source === null || source === undefined) return 'insufficient-items'
  if (!isItemType(source.item) || source.count !== 1 || equipmentDefinitionFor(source.item)?.slot !== equipmentSlot) return 'invalid-command'
  const durability =
    inventory.durability[sourceIndex] ?? source.durability ?? durabilityForItem(source.item)
  if (durability === null) return 'invalid-command'
  inventory.slots[sourceIndex] = null
  inventory.durability[sourceIndex] = null
  inventory.equipment[equipmentSlot] = { item: source.item, count: 1, durability: { ...durability } }
  return null
}

const unequipInventoryItem = (
  inventory: MutableInventoryState,
  equipmentSlot: EquipmentSlot,
  destinationIndex: number | undefined,
): CommandRejectionReason | null => {
  const equipped = inventory.equipment[equipmentSlot]
  if (equipped === null) return 'insufficient-items'
  const destination = destinationIndex ?? inventory.slots.findIndex((stack) => stack === null)
  if (destination < 0 || destination >= inventory.slots.length || inventory.slots[destination] !== null) return 'invalid-command'
  if (!isItemType(equipped.item) || equipped.count !== 1 || equipmentDefinitionFor(equipped.item)?.slot !== equipmentSlot) return 'invalid-command'
  const durability = equipped.durability ?? durabilityForItem(equipped.item)
  if (durability === null) return 'invalid-command'
  inventory.equipment[equipmentSlot] = null
  inventory.slots[destination] = { item: equipped.item, count: 1 }
  inventory.durability[destination] = { ...durability }
  return null
}

/** Adds as much of a stack as possible and returns only the unplaceable remainder. */
const addStackToInventory = (slots: Array<ItemStack | null>, stack: ItemStack): ItemStack | null => {
  if (!isItemType(stack.item)) return stack
  let remaining = stack.count
  const maxStackCount = maxStackCountOfItem(stack.item)
  for (const [index, current] of slots.entries()) {
    if (current === null || current.item !== stack.item || current.count >= maxStackCount) continue
    const added = Math.min(maxStackCount - current.count, remaining)
    slots[index] = { ...current, count: current.count + added }
    remaining -= added
    if (remaining === 0) return null
  }
  for (const [index, current] of slots.entries()) {
    if (current !== null) continue
    const added = Math.min(maxStackCount, remaining)
    slots[index] = { ...stack, count: added }
    remaining -= added
    if (remaining === 0) return null
  }
  return { ...stack, count: remaining }
}

export type RedstoneStatefulBlock =
  | 'door'
  | 'door_open'
  | 'redstone_lamp'
  | 'redstone_lamp_lit'

const isRedstoneStatefulBlock = (block: string | null): block is RedstoneStatefulBlock =>
  block === 'door' ||
  block === 'door_open' ||
  block === 'redstone_lamp' ||
  block === 'redstone_lamp_lit'

export interface ContainerSlotSnapshot {
  readonly count: number
  readonly maxStack: number
}

export interface MultiplayerServerCore {
  readonly connect: (clientId: ClientId, send: SendFrame) => boolean
  readonly receive: (clientId: ClientId, frame: WireText) => ReceiveResult
  readonly disconnect: (clientId: ClientId) => void
  readonly detachPlayer: (clientId: ClientId) => RealmTransferPlayer | undefined
  readonly acceptRealmTransfer: (clientId: ClientId, transfer: RealmTransferPlayer, arrival: RealmTransferArrival) => boolean
  readonly snapshot: () => WorldSnapshot
  readonly applyHopperTransfer: (at: BlockPos) => boolean
  readonly applyDispenserTrigger: (at: BlockPos) => boolean
  readonly applyDropperTrigger: (at: BlockPos) => boolean
  readonly applyRedstoneBlockState: (
    at: BlockPos,
    expectedBlocks: ReadonlySet<RedstoneStatefulBlock>,
    nextBlock: RedstoneStatefulBlock,
  ) => boolean
  readonly isPoweredRailPowered: (at: BlockPos) => boolean
  readonly applyPoweredRailState: (at: BlockPos, powered: boolean) => boolean
  readonly isLeverActive: (at: BlockPos) => boolean
  readonly readContainerSlots: (at: BlockPos) => ReadonlyArray<ContainerSlotSnapshot> | undefined
  readonly readPistonCell: (at: BlockPos) => PistonCellRead
  readonly applyPistonPlan: (plan: PistonMovementPlan) => boolean
  readonly tick: (elapsedMs: number) => void
  readonly spawnEntity: (entity: AuthoritativeEntityState) => boolean
}

export interface RealmTransferPlayer {
  readonly player: PlayerId
  readonly name: PlayerSnapshot['name']
  readonly facing: Orientation
  readonly inventory: InventoryState
  readonly vitals: VitalsState
  readonly statusEffects: StatusEffectState
  readonly anvilNames: ReadonlyArray<Readonly<{ readonly slot: number; readonly name: string }>>
  readonly enchantments: Readonly<{
    readonly seed: number
    readonly items: ReadonlyArray<Readonly<{ readonly slot: number; readonly item: EnchantedItem }>>
  }>
}

export interface RealmTransferArrival {
  readonly commandId: CommandId
  readonly fromWorld: WorldId
  readonly at: BlockPos
  readonly facing: Orientation
}

export const makeMultiplayerServerCore = (options: MultiplayerServerOptions): MultiplayerServerCore => {
  const worldId = options.worldId as WorldId
  const dimension = options.dimension ?? 'overworld'
  const bounds = options.bounds ?? DEFAULT_BOUNDS
  const clients = new Map<ClientId, ConnectedClient>()
  const players = new Map<PlayerId, MutablePlayer>()
  const playerPositions = new Map<PlayerId, Readonly<{ at: BlockPos; facing: Orientation }>>(
    (options.initialState?.playerPositions ?? []).map(({ player, at, facing }) => [player, {
      at: { ...at },
      facing: { ...facing },
    }]),
  )
  const playerClients = new Map<PlayerId, ClientId>()
  const movementBudgets = new Map<PlayerId, MovementBudget>()
  const blocks = new Map<string, Readonly<{ at: BlockPos; block: string | null }>>(
    [...(options.initialState?.blocks ?? []), ...(options.staticBlocks ?? [])]
      .map((mutation) => [positionKey(mutation.at), mutation]),
  )
  const poweredRails = new Map<string, Readonly<{ at: BlockPos; powered: boolean }>>(
    (options.initialState?.poweredRails ?? []).map(({ at, powered }) => [positionKey(at), {
      at: { ...at },
      powered,
    }]),
  )
  const poweredRailSnapshot = (): ReadonlyArray<Readonly<{ at: BlockPos; powered: boolean }>> =>
    [...poweredRails.values()]
      .filter(({ at }) => blocks.get(positionKey(at))?.block === 'powered_rail')
      .map(({ at, powered }) => ({ at: { ...at }, powered }))
  const levers = new Map<string, Readonly<{ at: BlockPos; active: boolean }>>(
    (options.initialState?.levers ?? []).map(({ at, active }) => [positionKey(at), {
      at: { ...at },
      active,
    }]),
  )
  const leverSnapshot = (): ReadonlyArray<Readonly<{ at: BlockPos; active: boolean }>> =>
    [...levers.values()]
      .filter(({ at }) => blocks.get(positionKey(at))?.block === 'lever')
      .map(({ at, active }) => ({ at: { ...at }, active }))
  const entities = new Map<string, AuthoritativeEntityState>(
    (options.initialState?.entities ?? []).map((entity) => [entity.entityId, entity]),
  )
  const eyeOfEnderRecoveries = new Map<string, EyeOfEnderRecoveryState>(
    (options.initialState?.eyeOfEnderRecoveries ?? []).map((recovery) => [
      recovery.entityId,
      { entityId: recovery.entityId, at: { ...recovery.at }, remainingSecs: recovery.remainingSecs },
    ]),
  )
  const fallingPending = new Map<string, BlockPos>()
  const bowDrawStartedAt = new Map<PlayerId, number>()
  const fishingSessions = new Map<PlayerId, { session: FishingSession; slot: number; water: BlockPos }>()
  const inventories = new Map<PlayerId, MutableInventoryState>(
    (options.initialState?.inventories ?? []).map(({ player, state }) => [player, cloneInventory(state)]),
  )
  const vitals = new Map<PlayerId, MutableVitalsState>(
    (options.initialState?.vitals ?? []).map(({ player, state }) => [player, { ...state }]),
  )
  let timeWeather: TimeWeatherState = { ...(options.initialState?.timeWeather ?? DEFAULT_TIME_WEATHER) }
  let weatherClock: WeatherClockState = isWeatherClockState(options.initialState?.weatherClock)
    ? { ...options.initialState.weatherClock }
    : { ...DEFAULT_WEATHER_CLOCK }
  let thunderStrikeSequence = Math.floor(timeWeather.timeOfDay / THUNDER_STRIKE_INTERVAL_TICKS)
  const containers = new Map<string, MutableContainerState>(
    (options.initialState?.containers ?? []).map((state) => [state.containerId, {
      containerId: state.containerId,
      kind: state.kind,
      slots: state.slots.map(cloneStack),
    }]),
  )
  const furnaces = new Map<string, MutableFurnaceState>(
    (options.initialState?.furnaces ?? []).map((state) => [state.furnaceId, {
      ...state,
      input: cloneStack(state.input),
      fuel: cloneStack(state.fuel),
      output: cloneStack(state.output),
    }]),
  )
  const brewingStands = new Map<string, Readonly<{ at: BlockPos; state: BrewingStandState }>>(
    (options.initialState?.brewingStands ?? [])
      .filter(({ state }) => isValidBrewingStandState(state))
      .map(({ at, state }) => [positionKey(at), { at: { ...at }, state: copyBrewingStandState(state) }]),
  )
  const statusEffects = new Map<PlayerId, StatusEffectState>(
    (options.initialState?.statusEffects ?? [])
      .filter(({ state }) => isValidStatusEffectState(state))
      .map(({ player, state }) => [player, copyStatusEffectState(state)]),
  )
  const anvilNames = new Map<PlayerId, Map<number, string>>(
    (options.initialState?.anvilNames ?? []).map(({ player, names }) => [player, new Map(
      names
        .filter(({ slot, name }) => Number.isSafeInteger(slot) && slot >= 0 && slot < DEFAULT_INVENTORY_SLOTS && name.length > 0 && isValidAnvilName(name))
        .map(({ slot, name }) => [slot, name]),
    )]),
  )
  const enchantments = new Map<PlayerId, { seed: number; items: Map<number, EnchantedItem> }>(
    (options.initialState?.enchantments ?? []).flatMap(({ player, seed, items }) => {
      if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) return []
      const decodedItems = items.flatMap(({ slot, item }) => {
        const decoded = decodeEnchantedItem(item)
        return Number.isSafeInteger(slot) && slot >= 0 && slot < DEFAULT_INVENTORY_SLOTS && decoded.ok
          ? [[slot, decoded.value] as const]
          : []
      })
      return [[player, { seed, items: new Map(decodedItems) }] as const]
    }),
  )
  const droppedItemMetadata = new Map<AuthoritativeEntityState['entityId'], Readonly<{ name: string | null; enchantment: EnchantedItem | null }>>()
  let villagerTrades: AuthoritativeSnapshot['villagerTrades'] = (options.initialState?.villagerTrades ?? []).map((state) => ({
    ...state,
    offers: state.offers.map((offer) => ({
      ...offer,
      input: offer.input.map((stack) => ({ ...stack })),
      output: { ...offer.output },
    })),
  }))
  const commandResults = new Map<string, {
    readonly fingerprint: string
    readonly result: AuthoritativeCommandResult
  }>()
  const commandResultLimit = 1_024
  const commandResultKey = (message: AuthoritativeCommand): string =>
    `${String(message.player)}\0${String(message.commandId)}`
  const commandFingerprint = (message: AuthoritativeCommand): string => JSON.stringify(message)
  const cacheCommandResult = (message: AuthoritativeCommand, result: AuthoritativeCommandResult): void => {
    commandResults.set(commandResultKey(message), { fingerprint: commandFingerprint(message), result })
    if (commandResults.size <= commandResultLimit) return
    const oldestKey = commandResults.keys().next().value
    if (oldestKey !== undefined) commandResults.delete(oldestKey)
  }
  let revision = options.initialState?.revision ?? 0
  let timeTickRemainderMs = 0
  let simulationElapsedSecs = 0
  const environmentalContactDamageStates = new Map<PlayerId, EnvironmentalContactDamageState>()
  let witherRevision = options.initialState?.witherRevision ?? 0
  let witherState: WitherRuntimeState = restoreWitherRuntime(options.initialState?.wither)
  const witherCommandResults = new Map<string, Extract<WitherWireMessage, { readonly _tag: 'WitherCommandResult' }>>()
  let enderDragonRevision = options.initialState?.enderDragonRevision ?? 0
  let enderDragonState = decodeEnderDragonEncounterSnapshot(options.initialState?.enderDragon) ?? initialEnderDragonEncounter()
  const enderDragonCommandResults = new Map<string, Extract<EnderDragonWireMessage, { readonly _tag: 'EnderDragonCommandResult' }>>()
  const playerDamageResults = new Map<string, Readonly<{
    fingerprint: string
    result: PlayerDamageCommandResult
  }>>()
  const craftingResults = new Map<string, Readonly<{ fingerprint: string; result: CraftingCommandResult }>>()
  const brewingResults = new Map<string, Readonly<{ fingerprint: string; result: BrewingCommandResult }>>()
  const anvilResults = new Map<string, Readonly<{ fingerprint: string; result: AnvilCommandResult }>>()
  const enchantingResults = new Map<string, Readonly<{ fingerprint: string; result: EnchantingCommandResult }>>()
  const cachePlayerDamageResult = (
    key: string,
    fingerprint: string,
    result: PlayerDamageCommandResult,
  ): void => {
    playerDamageResults.set(key, { fingerprint, result })
    if (playerDamageResults.size <= commandResultLimit) return
    const oldestKey = playerDamageResults.keys().next().value
    if (oldestKey !== undefined) playerDamageResults.delete(oldestKey)
  }
  const cacheCraftingResult = (key: string, fingerprint: string, result: CraftingCommandResult): void => {
    craftingResults.set(key, { fingerprint, result })
    if (craftingResults.size <= commandResultLimit) return
    const oldestKey = craftingResults.keys().next().value
    if (oldestKey !== undefined) craftingResults.delete(oldestKey)
  }
  const cacheBrewingResult = (key: string, fingerprint: string, result: BrewingCommandResult): void => {
    brewingResults.set(key, { fingerprint, result })
    if (brewingResults.size <= commandResultLimit) return
    const oldestKey = brewingResults.keys().next().value
    if (oldestKey !== undefined) brewingResults.delete(oldestKey)
  }
  const cacheAnvilResult = (key: string, fingerprint: string, result: AnvilCommandResult): void => {
    anvilResults.set(key, { fingerprint, result })
    if (anvilResults.size <= commandResultLimit) return
    const oldestKey = anvilResults.keys().next().value
    if (oldestKey !== undefined) anvilResults.delete(oldestKey)
  }
  const cacheEnchantingResult = (key: string, fingerprint: string, result: EnchantingCommandResult): void => {
    enchantingResults.set(key, { fingerprint, result })
    if (enchantingResults.size <= commandResultLimit) return
    const oldestKey = enchantingResults.keys().next().value
    if (oldestKey !== undefined) enchantingResults.delete(oldestKey)
  }
  const lastWitherAttackMs = new Map<PlayerId, number>()
  const lastEnderDragonAttackMs = new Map<PlayerId, number>()
  const hungerActors = new Map<PlayerId, HungerActor>()
  let hungerTickRemainderMs = 0
  const sleepAuthority = new SleepAuthority({
    world: worldId,
    revision: 0,
    actors: [],
    blocks: {},
    drops: [],
  }, {
    reach: Number.MAX_SAFE_INTEGER,
    sleepPercentage: options.sleepPercentage ?? 100,
    validateSleep: ({ actor, bed }) => {
      const at = players.get(actor.player)?.at
      const withinReach = at !== undefined
        && (at.x - bed.x) ** 2 + (at.y - bed.y) ** 2 + (at.z - bed.z) ** 2 <= 5 ** 2
      const hostileNearby = [...entities.values()].some((entity) => entity._tag === 'living'
        && entity.health > 0
        && (supportedMobKind(entity.entityType) !== undefined
          || supportedHostileEcosystemMobKind(entity.entityType) !== undefined)
        && Math.abs(entity.at.x - bed.x) <= 8
        && Math.abs(entity.at.y - bed.y) <= 5
        && Math.abs(entity.at.z - bed.z) <= 8)
      return {
        dimension: worldId,
        bedValid: dimension === 'overworld' && withinReach && blockAt(bed) === 'bed',
        nightOrThunder: timeWeather.weather === 'thunder' || timeWeather.timeOfDay >= 12_542,
        safe: !hostileNearby,
      }
    },
  })

  const sendMessage = (client: ConnectedClient, message: NetworkMessage): void => {
    const encoded = encodeFrame(message)
    if (Either.isRight(encoded)) client.send(encoded.right)
  }

  const broadcast = (message: NetworkMessage, except?: ClientId): void => {
    for (const [clientId, client] of clients) {
      if (clientId !== except && client.playerId !== null) sendMessage(client, message)
    }
  }

  const sendSleep = (client: ConnectedClient, message: SleepWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const broadcastSleep = (message: SleepWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendSleep(client, message)
  }

  const sendWither = (client: ConnectedClient, message: WitherWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const sendEnderDragon = (client: ConnectedClient, message: EnderDragonWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const sendPlayerDamage = (client: ConnectedClient, message: PlayerDamageCommandResult): void => {
    client.send(JSON.stringify(message) as WireText)
  }
  const sendCrafting = (client: ConnectedClient, message: CraftingCommandResult): void => {
    client.send(JSON.stringify(message) as WireText)
  }
  const sendBrewing = (client: ConnectedClient, message: BrewingWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }
  const sendAnvil = (client: ConnectedClient, message: AnvilWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }
  const sendEnchanting = (client: ConnectedClient, message: EnchantingWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const broadcastWither = (message: WitherWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendWither(client, message)
  }
  const broadcastEnderDragon = (message: EnderDragonWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendEnderDragon(client, message)
  }
  const broadcastBrewing = (message: BrewingWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendBrewing(client, message)
  }
  const anvilNamesDelta = (player: PlayerId): PlayerAnvilNamesDelta => {
    return {
      _tag: 'PlayerAnvilNamesDelta',
      world: worldId,
      revision,
      player,
      names: transferAnvilNames(player),
    }
  }
  const enchantmentsDelta = (player: PlayerId): PlayerEnchantmentsDelta => {
    const state = transferEnchantments(player)
    return {
      _tag: 'PlayerEnchantmentsDelta',
      world: worldId,
      revision,
      player,
      seed: state.seed,
      items: state.items,
    }
  }
  const transferAnvilNames = (player: PlayerId): RealmTransferPlayer['anvilNames'] => {
    const names = anvilNames.get(player)
    return names === undefined
      ? []
      : [...names].sort(([left], [right]) => left - right).map(([slot, name]) => ({ slot, name }))
  }
  const transferEnchantments = (player: PlayerId): RealmTransferPlayer['enchantments'] => {
    const state = enchantments.get(player)
    return {
      seed: state?.seed ?? (options.seed >>> 0),
      items: state === undefined
        ? []
        : [...state.items].sort(([left], [right]) => left - right).map(([slot, item]) => ({ slot, item })),
    }
  }
  const inventorySlotMetadata = (player: PlayerId, slot: number): Readonly<{ name: string | null; enchantment: EnchantedItem | null }> => ({
    name: anvilNames.get(player)?.get(slot) ?? null,
    enchantment: enchantments.get(player)?.items.get(slot) ?? null,
  })
  const hasInventorySlotMetadata = (player: PlayerId, slot: number): boolean => {
    const metadata = inventorySlotMetadata(player, slot)
    return metadata.name !== null || metadata.enchantment !== null
  }
  const sameInventorySlotMetadata = (
    left: Readonly<{ name: string | null; enchantment: EnchantedItem | null }>,
    right: Readonly<{ name: string | null; enchantment: EnchantedItem | null }>,
  ): boolean => JSON.stringify(left) === JSON.stringify(right)
  const setInventorySlotMetadata = (
    player: PlayerId,
    slot: number,
    metadata: Readonly<{ name: string | null; enchantment: EnchantedItem | null }>,
  ): void => {
    let names = anvilNames.get(player)
    if (names === undefined) {
      names = new Map()
      anvilNames.set(player, names)
    }
    let playerEnchantments = enchantments.get(player)
    if (playerEnchantments === undefined) {
      playerEnchantments = { seed: options.seed >>> 0, items: new Map() }
      enchantments.set(player, playerEnchantments)
    }
    if (metadata.name === null) names.delete(slot)
    else names.set(slot, metadata.name)
    if (metadata.enchantment === null) playerEnchantments.items.delete(slot)
    else playerEnchantments.items.set(slot, metadata.enchantment)
  }
  const validateInventorySlotMetadataMove = (
    player: PlayerId,
    source: number,
    destination: number,
    count: number,
    sourceStack: ItemStack,
    destinationStack: ItemStack | null | undefined,
  ): CommandRejectionReason | null => {
    const sourceMetadata = inventorySlotMetadata(player, source)
    const destinationMetadata = inventorySlotMetadata(player, destination)
    if (count < sourceStack.count && hasInventorySlotMetadata(player, source)) return 'invalid-command'
    if (destinationStack !== null && destinationStack !== undefined && !sameInventorySlotMetadata(sourceMetadata, destinationMetadata)) return 'invalid-command'
    return null
  }
  const transferInventorySlotMetadata = (player: PlayerId, source: number, destination: number): void => {
    const sourceMetadata = inventorySlotMetadata(player, source)
    setInventorySlotMetadata(player, source, { name: null, enchantment: null })
    setInventorySlotMetadata(player, destination, sourceMetadata)
  }
  const swapInventorySlotMetadata = (player: PlayerId, source: number, destination: number): void => {
    const sourceMetadata = inventorySlotMetadata(player, source)
    setInventorySlotMetadata(player, source, inventorySlotMetadata(player, destination))
    setInventorySlotMetadata(player, destination, sourceMetadata)
  }

  const witherSnapshot = (): WitherWireMessage => ({
    _tag: 'WitherSnapshot',
    revision: witherRevision,
    snapshot: snapshotWitherRuntime(witherState),
  })

  const enderDragonSnapshot = (): EnderDragonWireMessage => ({
    _tag: 'EnderDragonSnapshot',
    revision: enderDragonRevision,
    snapshot: enderDragonState,
  })

  const snapshot = (): WorldSnapshot => ({
    _tag: 'WorldSnapshot',
    world: worldId,
    seed: options.seed,
    revision,
    players: [...players.values()].map((player) => ({ ...player })),
    blocks: [...blocks.values()].map((mutation) => ({ world: worldId, ...mutation })),
    poweredRails: poweredRailSnapshot(),
    levers: leverSnapshot(),
  })

  const authoritativeSnapshot = (): AuthoritativeSnapshot => ({
    _tag: 'AuthoritativeSnapshot',
    world: worldId,
    revision,
    inventories: [...inventories].map(([player, state]) => ({ player, state: inventorySnapshot(state) })),
    vitals: [...vitals].map(([player, state]) => ({ player, state: vitalsSnapshot(state) })),
    timeWeather: { ...timeWeather },
    containers: [...containers.values()].map(containerSnapshot),
    furnaces: [...furnaces.values()].map(furnaceSnapshot),
    villagerTrades,
    entities: [...entities.values()],
  })

  const isInBounds = ({ x, y, z }: BlockPos): boolean =>
    x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY &&
    z >= bounds.minZ && z <= bounds.maxZ

  const isBlockWithinReach = (player: MutablePlayer, at: BlockPos): boolean => {
    const distance = Math.hypot(
      player.at.x - (at.x + 0.5),
      player.at.y - (at.y + 0.5),
      player.at.z - (at.z + 0.5),
    )
    return Number.isFinite(distance) && distance <= BLOCK_INTERACTION_RANGE
  }

  const blockAt = (at: BlockPos): string | null => {
    const override = blocks.get(positionKey(at))
    return override === undefined ? (options.generatedBlockAt?.(at) ?? null) : override.block
  }

  const environmentalContactsAt = (at: PlayerSnapshot['at']): ReadonlyArray<EnvironmentalContact> => {
    const minX = at.x - PLAYER_HALF_WIDTH
    const maxX = at.x + PLAYER_HALF_WIDTH
    const minY = at.y
    const maxY = at.y + PLAYER_HEIGHT
    const minZ = at.z - PLAYER_HALF_WIDTH
    const maxZ = at.z + PLAYER_HALF_WIDTH
    const contacts = new Map<'lava' | 'cactus', EnvironmentalContact>()
    const overlaps = (minimum: number, maximum: number, cell: number): boolean =>
      minimum < cell + 1 - COLLISION_EPSILON && maximum > cell + COLLISION_EPSILON
    const gap = (minimum: number, maximum: number, cell: number): number => {
      if (maximum < cell) return cell - maximum
      if (minimum > cell + 1) return minimum - (cell + 1)
      return 0
    }

    for (let x = Math.floor(minX); x < Math.ceil(maxX); x += 1) {
      for (let y = Math.floor(minY); y < Math.ceil(maxY); y += 1) {
        for (let z = Math.floor(minZ); z < Math.ceil(maxZ); z += 1) {
          const block = blockAt({ x, y, z })
          if (block !== 'lava' && block !== 'cactus') continue
          const contactDamage = propertyOfBlockId(blockIdOf(block), 'contactDamage')
          if (contactDamage === undefined) continue
          const touches = block === 'lava'
            ? overlaps(minX, maxX, x) && overlaps(minY, maxY, y) && overlaps(minZ, maxZ, z)
            : overlaps(minY, maxY, y)
              && ((gap(minX, maxX, x) <= COLLISION_EPSILON && overlaps(minZ, maxZ, z))
                || (gap(minZ, maxZ, z) <= COLLISION_EPSILON && overlaps(minX, maxX, x)))
          if (touches) contacts.set(block, { block, contactDamage })
        }
      }
    }
    return [...contacts.values()]
  }

  const readPistonCell = (at: BlockPos): PistonCellRead => {
    if (!isInBounds(at)) return { kind: 'out-of-world' }
    const block = blockAt(at)
    return block === null ? { kind: 'empty' } : { kind: 'block', block }
  }

  const fishingEnvironmentAt = (water: BlockPos) => {
    let hasSkyAccess = true
    for (let y = water.y + 1; y <= bounds.maxY; y += 1) {
      if (blockAt({ x: water.x, y, z: water.z }) !== null) {
        hasSkyAccess = false
        break
      }
    }
    return {
      hasWater: blockAt(water) === 'water',
      hasSkyAccess,
      isRaining: timeWeather.weather === 'rain' || timeWeather.weather === 'thunder',
      isOpenWater: false,
    }
  }

  const disturbFallingBlocks = (positions: Iterable<BlockPos>): void => {
    for (const at of positions) {
      if (!isInBounds(at)) continue
      const key = positionKey(at)
      if (!fallingPending.has(key)) fallingPending.set(key, { ...at })
    }
  }

  const applyPendingFallingBlocks = (): boolean => {
    const targets = Array.from(fallingPending.values()).slice(0, FALLING_BLOCK_MOVES_PER_TICK)
    for (const target of targets) fallingPending.delete(positionKey(target))
    const moves = planFallingBlockMoves(targets, (at) => {
      if (!isInBounds(at)) return undefined
      const block = blockAt(at)
      return block === null ? blockIdOf('air') : isBlockType(block) ? blockIdOf(block) : undefined
    })
    for (const move of moves) {
      const block = blockTypeOfId(move.blockId)
      if (block === undefined) continue
      blocks.set(positionKey(move.source), { at: move.source, block: null })
      blocks.set(positionKey(move.target), { at: move.target, block })
      disturbFallingBlocks([
        { x: move.target.x, y: move.target.y - 1, z: move.target.z },
        move.source,
      ])
    }
    return moves.length > 0
  }

  const containerIdAt = (at: BlockPos): string =>
    `${String(worldId)}:${String(at.x)},${String(at.y)},${String(at.z)}`

  const furnaceIdAt = (at: BlockPos): string =>
    JSON.stringify([worldId, at.x, at.y, at.z])

  const parseContainerId = (containerId: string): BlockPos | null => {
    const match = /^([^:]+):(-?\d+),(-?\d+),(-?\d+)$/.exec(containerId)
    if (match === null || match[1] !== worldId) return null
    const at = { x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) }
    if (!Number.isSafeInteger(at.x) || !Number.isSafeInteger(at.y) || !Number.isSafeInteger(at.z)) return null
    return isInBounds(at) && containerIdAt(at) === containerId ? at : null
  }

  const parseFurnaceId = (furnaceId: string): BlockPos | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(furnaceId)
    } catch {
      return null
    }
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 4 ||
      parsed[0] !== worldId ||
      !Number.isSafeInteger(parsed[1]) ||
      !Number.isSafeInteger(parsed[2]) ||
      !Number.isSafeInteger(parsed[3])
    ) return null
    const at = { x: parsed[1] as number, y: parsed[2] as number, z: parsed[3] as number }
    return isInBounds(at) && furnaceIdAt(at) === furnaceId ? at : null
  }

  const facilityIsAccessible = (
    player: PlayerId,
    at: BlockPos,
    expectedBlock: ContainerKind | 'furnace' | 'brewing_stand',
  ): CommandRejectionReason | null => {
    const actor = players.get(player)
    if (actor === undefined) return 'resource-not-found'
    if (actor.world !== worldId || blockAt(at) !== expectedBlock) return 'invalid-command'
    return isBlockWithinReach(actor, at) ? null : 'out-of-range'
  }

  const brewingBottleFromItem = (item: string): BrewingBottle | undefined => {
    if (item === 'water_bottle') return item
    if (item === 'awkward_potion') return { potion: 'awkward' }
    if (item === 'potion_of_swiftness') return { potion: 'speed' }
    if (item === 'potion_of_poison') return { potion: 'poison' }
    if (item === 'potion_of_regeneration') return { potion: 'regeneration' }
    return undefined
  }

  const persistentState = (): MultiplayerServerState => ({
    revision,
    blocks: [...blocks.values()].map((mutation) => ({ ...mutation, at: { ...mutation.at } })),
    poweredRails: poweredRailSnapshot(),
    levers: leverSnapshot(),
    inventories: [...inventories].map(([player, state]) => ({ player, state: inventorySnapshot(state) })),
    vitals: [...vitals].map(([player, state]) => ({ player, state: vitalsSnapshot(state) })),
    timeWeather: { ...timeWeather },
    weatherClock: { ...weatherClock },
    containers: [...containers.values()].map(containerSnapshot),
    furnaces: [...furnaces.values()].map(furnaceSnapshot),
    villagerTrades,
    entities: [...entities.values()],
    eyeOfEnderRecoveries: [...eyeOfEnderRecoveries.values()].map((recovery) => ({
      entityId: recovery.entityId,
      at: { ...recovery.at },
      remainingSecs: recovery.remainingSecs,
    })),
    playerPositions: [...playerPositions].map(([player, position]) => ({
      player,
      at: { ...position.at },
      facing: { ...position.facing },
    })),
    wither: snapshotWitherRuntime(witherState),
    witherRevision,
    enderDragon: enderDragonState,
    enderDragonRevision,
    brewingStands: [...brewingStands.values()].map(({ at, state }) => ({ at: { ...at }, state: copyBrewingStandState(state) })),
    statusEffects: [...statusEffects].map(([player, state]) => ({ player, state: copyStatusEffectState(state) })),
    anvilNames: [...anvilNames].map(([player, names]) => ({
      player,
      names: [...names].sort(([left], [right]) => left - right).map(([slot, name]) => ({ slot, name })),
    })),
    enchantments: [...enchantments].map(([player, state]) => ({
      player,
      seed: state.seed,
      items: [...state.items].sort(([left], [right]) => left - right).map(([slot, item]) => ({ slot, item })),
    })),
  })

  const notifyStateChanged = (): void => options.onStateChanged?.(persistentState())

  const containerAt = (position: BlockPos): MutableContainerState | undefined => {
    if (!isInBounds(position)) return undefined
    const expectedKind = containerKindForBlock(blockAt(position) ?? '')
    const container = containers.get(containerIdAt(position))
    return expectedKind === undefined || container?.kind !== expectedKind ? undefined : container
  }

  const readContainerSlots = (at: BlockPos): ReadonlyArray<ContainerSlotSnapshot> | undefined => {
    const container = containerAt(at)
    return container?.slots.map((stack) => stack === null || stack === undefined
      ? { count: 0, maxStack: 64 }
      : { count: stack.count, maxStack: isItemType(stack.item) ? maxStackCountOfItem(stack.item) : 64 })
  }

  const applyHopperTransfer = (at: BlockPos): boolean => {
    const moveFirstStack = (source: MutableContainerState, destination: MutableContainerState): boolean => {
      for (let sourceIndex = 0; sourceIndex < source.slots.length; sourceIndex += 1) {
        if (source.slots[sourceIndex] === null || source.slots[sourceIndex] === undefined) continue
        for (let destinationIndex = 0; destinationIndex < destination.slots.length; destinationIndex += 1) {
          if (moveStack(source.slots, sourceIndex, destination.slots, destinationIndex, 1) !== null) continue
          revision += 1
          notifyStateChanged()
          broadcast({ _tag: 'ContainerDelta', world: worldId, revision, state: containerSnapshot(source) })
          broadcast({ _tag: 'ContainerDelta', world: worldId, revision, state: containerSnapshot(destination) })
          return true
        }
      }
      return false
    }

    const hopper = containerAt(at)
    if (hopper?.kind !== 'hopper') return false
    const below = containerAt({ x: at.x, y: at.y - 1, z: at.z })
    if (below !== undefined && hopper.slots.some((stack) => stack !== null && stack !== undefined)) return moveFirstStack(hopper, below)
    const above = containerAt({ x: at.x, y: at.y + 1, z: at.z })
    return above === undefined ? false : moveFirstStack(above, hopper)
  }

  const applyItemDropperTrigger = (at: BlockPos, kind: 'dispenser' | 'dropper'): boolean => {
    if (!isInBounds(at) || blockAt(at) !== kind) return false
    const container = containers.get(containerIdAt(at))
    if (container?.kind !== kind) return false
    const slot = container.slots.findIndex((stack) => stack !== null && stack !== undefined)
    if (slot < 0) return false

    const source = container.slots[slot]
    if (source === null || source === undefined) return false
    const entity: AuthoritativeEntityState = {
      _tag: 'item-drop',
      entityId: `${kind}:${positionKey(at)}:drop:${String(revision + 1)}:${String(slot)}` as AuthoritativeEntityState['entityId'],
      at: { x: at.x + 0.5, y: at.y + 0.5, z: at.z - 0.25 },
      stack: { ...source, count: 1 },
    }
    container.slots[slot] = source.count === 1 ? null : { ...source, count: source.count - 1 }
    entities.set(entity.entityId, entity)
    revision += 1
    notifyStateChanged()
    broadcast({ _tag: 'ContainerDelta', world: worldId, revision, state: containerSnapshot(container) })
    broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity })
    return true
  }

  const applyDispenserTrigger = (at: BlockPos): boolean => applyItemDropperTrigger(at, 'dispenser')

  const applyDropperTrigger = (at: BlockPos): boolean => applyItemDropperTrigger(at, 'dropper')

  const applyRedstoneBlockState = (
    at: BlockPos,
    expectedBlocks: ReadonlySet<RedstoneStatefulBlock>,
    nextBlock: RedstoneStatefulBlock,
  ): boolean => {
    if (!isInBounds(at)) return false
    const currentBlock = blockAt(at)
    if (!isRedstoneStatefulBlock(currentBlock) || !expectedBlocks.has(currentBlock) || currentBlock === nextBlock) return false

    blocks.set(positionKey(at), { at: { ...at }, block: nextBlock })
    revision += 1
    notifyStateChanged()
    broadcast(snapshot())
    return true
  }

  const isPoweredRailPowered = (at: BlockPos): boolean =>
    blockAt(at) === 'powered_rail' && (poweredRails.get(positionKey(at))?.powered ?? false)

  const isLeverActive = (at: BlockPos): boolean =>
    blockAt(at) === 'lever' && (levers.get(positionKey(at))?.active ?? false)

  const applyPoweredRailState = (at: BlockPos, powered: boolean): boolean => {
    if (!isInBounds(at) || blockAt(at) !== 'powered_rail') return false
    const key = positionKey(at)
    if ((poweredRails.get(key)?.powered ?? false) === powered) return false
    poweredRails.set(key, { at: { ...at }, powered })
    revision += 1
    notifyStateChanged()
    broadcast(snapshot())
    return true
  }

  /** Commits a validated piston plan as one authoritative world revision. */
  const applyPistonPlan = (plan: PistonMovementPlan): boolean => {
    if (validatePistonPlan(plan) !== undefined || !isInBounds(plan.piston) || blockAt(plan.piston) !== 'piston') return false

    const head = pistonPositionAt(plan.piston, plan.facing, 1)
    if (!isInBounds(head) || (plan.fromState === 'extended' && blockAt(head) !== 'piston_head')) return false
    if (plan.moves.some((move) => !isInBounds(move.from) || !isInBounds(move.to) || blockAt(move.from) !== move.block)) return false

    if (plan.toState === 'extended') {
      const finalTarget = plan.moves[0]?.to ?? head
      if (blockAt(finalTarget) !== null) return false
    }

    for (const move of plan.moves) {
      blocks.set(positionKey(move.to), { at: { ...move.to }, block: move.block })
    }
    for (const move of plan.moves) {
      blocks.set(positionKey(move.from), { at: { ...move.from }, block: null })
    }
    if (plan.toState === 'extended') {
      blocks.set(positionKey(head), { at: { ...head }, block: 'piston_head' })
    } else if (plan.moves.length === 0) {
      blocks.set(positionKey(head), { at: { ...head }, block: null })
    }

    revision += 1
    notifyStateChanged()
    broadcast(snapshot())
    return true
  }

  const ensurePlayerState = (player: PlayerId): void => {
    if (!inventories.has(player)) {
      inventories.set(player, { slots: Array.from({ length: DEFAULT_INVENTORY_SLOTS }, () => null), durability: Array.from({ length: DEFAULT_INVENTORY_SLOTS }, () => null), equipment: emptyEquipmentState(), selectedSlot: 0 })
    }
    if (!anvilNames.has(player)) anvilNames.set(player, new Map())
    if (!enchantments.has(player)) enchantments.set(player, { seed: options.seed >>> 0, items: new Map() })
    if (!vitals.has(player)) vitals.set(player, { ...DEFAULT_VITALS })
    if (!statusEffects.has(player)) statusEffects.set(player, emptyStatusEffectState())
    const playerVitals = vitals.get(player) as MutableVitalsState
    const inventory = inventories.get(player) as MutableInventoryState
    const food: Record<string, number> = {}
    for (const stack of inventory.slots) {
      if (stack !== null) food[stack.item] = (food[stack.item] ?? 0) + stack.count
    }
    const previous = hungerActors.get(player)
    hungerActors.set(player, {
      player,
      session: String(player),
      state: previous?.state ?? { food: playerVitals.hunger, saturation: 5, exhaustion: 0, health: playerVitals.health },
      food,
    })
  }

  const applyHungerEvents = (events: ReadonlyArray<HungerEvent>): Readonly<{
    changed: ReadonlyArray<PlayerId>
    deaths: ReadonlyArray<PlayerId>
  }> => {
    const changed = new Set<PlayerId>()
    const deaths = new Set<PlayerId>()
    for (const event of events) {
      if (event._tag !== 'HungerChanged') continue
      const playerVitals = vitals.get(event.player)
      const actor = hungerActors.get(event.player)
      if (playerVitals === undefined || actor === undefined) continue
      const wasAlive = playerVitals.health > 0
      playerVitals.health = event.state.health
      playerVitals.hunger = event.state.food
      hungerActors.set(event.player, { ...actor, state: event.state })
      changed.add(event.player)
      if (wasAlive && playerVitals.health <= 0) deaths.add(event.player)
    }
    return { changed: [...changed], deaths: [...deaths] }
  }

  const applyPlayerDeaths = (
    deaths: ReadonlyArray<PlayerId>,
    nextRevision: number,
  ): ReadonlyArray<AuthoritativeDelta> => {
    const deltas: AuthoritativeDelta[] = []
    for (const player of deaths) {
      const presence = players.get(player)
      const inventory = inventories.get(player)
      const playerVitals = vitals.get(player)
      if (presence === undefined || inventory === undefined || playerVitals === undefined) continue
      for (const [slot, stack] of inventory.slots.entries()) {
        if (stack === null) continue
        const entity: AuthoritativeEntityState = {
          _tag: 'item-drop',
          entityId: `player:${String(player)}:death:${String(nextRevision)}:${String(slot)}` as AuthoritativeEntityState['entityId'],
          at: { ...presence.at },
          stack: { ...stack },
        }
        entities.set(entity.entityId, entity)
        if (hasInventorySlotMetadata(player, slot)) {
          droppedItemMetadata.set(entity.entityId, inventorySlotMetadata(player, slot))
          setInventorySlotMetadata(player, slot, { name: null, enchantment: null })
        }
        deltas.push({ _tag: 'EntitySpawnDelta', world: presence.world, revision: nextRevision, entity })
      }
      inventory.slots.fill(null)
      inventory.durability.fill(null)
      playerVitals.experience = 0
      deltas.push({
        _tag: 'PlayerInventoryDelta',
        world: presence.world,
        revision: nextRevision,
        player,
        state: inventorySnapshot(inventory),
      })
    }
    return deltas
  }

  const executeHungerCommand = (message: Extract<AuthoritativeCommand, { readonly _tag: 'PlayerVitalsCommand' }>): CommandDecision => {
    ensurePlayerState(message.player)
    const authority = createHungerAuthority({
      world: worldId,
      revision,
      difficulty: options.difficulty ?? 'normal',
      actors: [...hungerActors.values()],
      tickRemainderMs: hungerTickRemainderMs,
    })
    const action: HungerCommand = message.action === 'respawn'
      ? { _tag: 'Respawn', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision }
      : message.action._tag === 'eat'
        ? { _tag: 'Eat', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision, item: message.action.item }
        : { _tag: 'Activity', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision, activity: message.action.activity, amount: message.action.amount }
    const result = authority.execute(action)
    if (!result.accepted) {
      const reason: CommandRejectionReason = result.reason === 'insufficient-items' || result.reason === 'stale-revision'
        ? result.reason
        : result.reason === 'unauthorized-player' ? 'unauthorized-player' : 'invalid-command'
      return { accepted: false, reason }
    }
    hungerActors.clear()
    const nextSnapshot = authority.snapshot()
    hungerTickRemainderMs = nextSnapshot.tickRemainderMs
    for (const actor of nextSnapshot.actors) hungerActors.set(actor.player, actor)
    const { changed, deaths } = applyHungerEvents(result.events)
    const respawnedPlayer = message.action === 'respawn' ? players.get(message.player) : undefined
    if (message.action === 'respawn') {
      const playerVitals = vitals.get(message.player)
      if (playerVitals !== undefined) playerVitals.experience = 0
      if (respawnedPlayer !== undefined && options.spawnAt !== undefined) {
        respawnedPlayer.at = { ...options.spawnAt }
        playerPositions.set(message.player, {
          at: { ...respawnedPlayer.at },
          facing: { ...respawnedPlayer.facing },
        })
      }
    }
    const consumed = result.events.find((event) => event._tag === 'FoodConsumed')
    if (consumed !== undefined) {
      const inventory = inventories.get(consumed.player)
      const slot = inventory?.slots.findIndex((stack) => stack?.item === consumed.item) ?? -1
      const stack = slot >= 0 ? inventory?.slots[slot] : undefined
      if (inventory !== undefined && stack != null) inventory.slots[slot] = stack.count === 1 ? null : { ...stack, count: stack.count - 1 }
    }
    return { accepted: true, deltas: (nextRevision) => [
      ...applyPlayerDeaths(deaths, nextRevision),
      ...changed.flatMap((player) => {
        const presence = players.get(player)
        return presence === undefined ? [] : [{ _tag: 'PlayerVitalsDelta' as const, world: presence.world, revision: nextRevision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) }]
      }),
      ...(consumed === undefined || players.get(consumed.player) === undefined ? [] : [{ _tag: 'PlayerInventoryDelta' as const, world: (players.get(consumed.player) as MutablePlayer).world, revision: nextRevision, player: consumed.player, state: inventorySnapshot(inventories.get(consumed.player) as MutableInventoryState) }]),
    ],
    ...(respawnedPlayer === undefined ? {} : {
      messages: () => [{
        _tag: 'PlayerMove' as const,
        player: respawnedPlayer.player,
        world: respawnedPlayer.world,
        at: { ...respawnedPlayer.at },
        facing: { ...respawnedPlayer.facing },
      }],
    }),
    }
  }

  const decideCommand = (message: AuthoritativeCommand): CommandDecision => {
    const inventory = inventories.get(message.player)
    if (inventory === undefined) return { accepted: false, reason: 'resource-not-found' }

    switch (message._tag) {
      case 'ToggleLeverCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (!isInBounds(message.lever) || !isBlockWithinReach(actor, message.lever)) {
          return { accepted: false, reason: 'out-of-range' }
        }
        if (blockAt(message.lever) !== 'lever') return { accepted: false, reason: 'invalid-command' }
        const key = positionKey(message.lever)
        levers.set(key, { at: { ...message.lever }, active: !isLeverActive(message.lever) })
        return { accepted: true, deltas: () => [], snapshotBroadcastRequired: true }
      }
      case 'ThrowEyeOfEnderCommand': {
        const actor = players.get(message.player)
        if (actor === undefined || dimension !== 'overworld') {
          return { accepted: false, reason: 'invalid-command' }
        }
        const inventory = inventories.get(message.player)
        if (inventory === undefined) return { accepted: false, reason: 'invalid-command' }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected?.item !== 'eye_of_ender') {
          return { accepted: false, reason: 'insufficient-items' }
        }

        const site = nearestStrongholdSite(options.seed, actor.at.x, actor.at.z)
        if (Option.isNone(site)) return { accepted: false, reason: 'invalid-command' }
        const origin = { x: actor.at.x, y: actor.at.y + EYE_LEVEL_OFFSET, z: actor.at.z }
        const target = endPortalCenterForStronghold(site.value)
        const breaks = deterministicRoll(`${String(options.seed)}:${String(message.player)}:${String(message.commandId)}:eye-break`) < 0.2
        const recoveryEntityId = `${String(message.player)}:eye:${String(message.commandId)}:recovery` as AuthoritativeEntityState['entityId']
        if (!breaks) {
          eyeOfEnderRecoveries.set(String(recoveryEntityId), {
            entityId: recoveryEntityId,
            at: eyeOfEnderDestination(origin, target),
            remainingSecs: EYE_OF_ENDER_FLIGHT_SECS,
          })
        }

        inventory.slots[inventory.selectedSlot] = selected.count === 1
          ? null
          : { ...selected, count: selected.count - 1 }
        if (selected.count === 1) inventory.durability[inventory.selectedSlot] = null
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'PlayerInventoryDelta',
            world: actor.world,
            revision: nextRevision,
            player: message.player,
            state: inventorySnapshot(inventory),
          }],
          messages: (nextRevision) => [{
            _tag: 'EyeOfEnderThrown',
            world: actor.world,
            revision: nextRevision,
            player: message.player,
            origin,
            target,
            breaks,
          }],
        }
      }
      case 'InsertEyeIntoEndPortalFrameCommand': {
        const actor = players.get(message.player)
        if (
          actor === undefined ||
          dimension !== 'overworld' ||
          !isInBounds(message.frame) ||
          !isBlockWithinReach(actor, message.frame)
        ) {
          return { accepted: false, reason: 'out-of-range' }
        }
        const site = nearestStrongholdSite(options.seed, message.frame.x, message.frame.z)
        if (Option.isNone(site)) return { accepted: false, reason: 'invalid-command' }
        const center = endPortalCenterForStronghold(site.value)
        const isPortalFrame = END_PORTAL_FRAME_OFFSETS.some(
          ({ dx, dz }) =>
            message.frame.x === center.x + dx &&
            message.frame.y === center.y &&
            message.frame.z === center.z + dz,
        )
        if (!isPortalFrame || blockAt(message.frame) !== END_PORTAL_FRAME_EMPTY_BLOCK) {
          return { accepted: false, reason: 'invalid-command' }
        }

        const inventory = inventories.get(message.player)
        if (inventory === undefined) return { accepted: false, reason: 'invalid-command' }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected?.item !== 'eye_of_ender') {
          return { accepted: false, reason: 'insufficient-items' }
        }
        inventory.slots[inventory.selectedSlot] = selected.count === 1
          ? null
          : { ...selected, count: selected.count - 1 }
        if (selected.count === 1) inventory.durability[inventory.selectedSlot] = null
        blocks.set(positionKey(message.frame), {
          at: { ...message.frame },
          block: END_PORTAL_FRAME_FILLED_BLOCK,
        })

        const completed = END_PORTAL_FRAME_OFFSETS.every(({ dx, dz }) =>
          blockAt({ x: center.x + dx, y: center.y, z: center.z + dz }) ===
          END_PORTAL_FRAME_FILLED_BLOCK,
        )
        if (completed) {
          for (let x = -1; x <= 1; x += 1) {
            for (let z = -1; z <= 1; z += 1) {
              const at = { x: center.x + x, y: center.y, z: center.z + z }
              blocks.set(positionKey(at), { at, block: END_EXIT_PORTAL_BLOCK })
            }
          }
        }
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'PlayerInventoryDelta',
            world: actor.world,
            revision: nextRevision,
            player: message.player,
            state: inventorySnapshot(inventory),
          }],
          snapshotBroadcastRequired: true,
        }
      }
      case 'EndPortalUseCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (!isInBounds(message.portal) || !isBlockWithinReach(actor, message.portal)) {
          return { accepted: false, reason: 'out-of-range' }
        }
        if (blockAt(message.portal) !== 'end_portal' || options.onEndPortalUse === undefined) {
          return { accepted: false, reason: 'invalid-command' }
        }
        return { accepted: true, deltas: () => [] }
      }
      case 'NetherPortalUseCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (!isInBounds(message.portal) || !isBlockWithinReach(actor, message.portal)) {
          return { accepted: false, reason: 'out-of-range' }
        }
        if (blockAt(message.portal) !== 'nether_portal' || options.onNetherPortalUse === undefined) {
          return { accepted: false, reason: 'invalid-command' }
        }
        return { accepted: true, deltas: () => [] }
      }
      case 'BowUseCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected?.item !== 'bow') return { accepted: false, reason: 'invalid-command' }
        if (message.action === 'start') {
          bowDrawStartedAt.set(message.player, options.now?.() ?? Date.now())
          return { accepted: true, deltas: () => [] }
        }
        const startedAt = bowDrawStartedAt.get(message.player)
        bowDrawStartedAt.delete(message.player)
        if (startedAt === undefined) return { accepted: false, reason: 'invalid-command' }
        const heldSecs = Math.max(0, (options.now?.() ?? Date.now()) - startedAt) / 1_000
        const charge = bowCharge(heldSecs)
        if (!canFireBow(heldSecs)) {
          return { accepted: true, deltas: () => [] }
        }
        const arrowSlot = inventory.slots.findIndex((stack) => stack?.item === 'arrow')
        const arrowStack = arrowSlot < 0 ? undefined : inventory.slots[arrowSlot]
        if (arrowStack?.item !== 'arrow') return { accepted: false, reason: 'insufficient-items' }
        const selectedSlot = inventory.selectedSlot
        const selectedMetadata = inventorySlotMetadata(message.player, selectedSlot)
        const bowDurability = inventory.durability[selectedSlot]
        if (!isValidDurabilityForItem('bow', bowDurability)) return { accepted: false, reason: 'invalid-command' }
        inventory.slots[arrowSlot] = arrowStack.count === 1 ? null : { ...arrowStack, count: arrowStack.count - 1 }
        const nextBowDurability = bowDurability.current === 1
          ? null
          : { ...bowDurability, current: bowDurability.current - 1 }
        if (nextBowDurability === null) inventory.slots[selectedSlot] = null
        inventory.durability[selectedSlot] = nextBowDurability
        if (selectedMetadata.enchantment !== null) {
          setInventorySlotMetadata(message.player, selectedSlot, {
            ...selectedMetadata,
            enchantment: nextBowDurability === null
              ? null
              : { ...selectedMetadata.enchantment, durability: { ...nextBowDurability } },
          })
        }
        const horizontal = Math.cos(actor.facing.pitchRadians)
        const speed = 8 + 24 * charge
        const powerLevel = selectedMetadata.enchantment?.enchantments.find((enchantment) => enchantment.id === 'power')?.level
        const arrow: AuthoritativeEntityState = {
          _tag: 'arrow',
          entityId: `${message.commandId}:arrow` as AuthoritativeEntityState['entityId'],
          at: { x: actor.at.x, y: actor.at.y + 1.5, z: actor.at.z },
          velocity: {
            x: -Math.sin(actor.facing.yawRadians) * horizontal * speed,
            y: -Math.sin(actor.facing.pitchRadians) * speed,
            z: -Math.cos(actor.facing.yawRadians) * horizontal * speed,
          },
          damage: bowDamage(charge, powerLevel === undefined ? {} : { powerLevel }),
          owner: message.player,
          ageTicks: 0,
        }
        entities.set(arrow.entityId, arrow)
        return { accepted: true, deltas: (nextRevision) => [
          { _tag: 'PlayerInventoryDelta', world: actor.world, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) },
          { _tag: 'EntitySpawnDelta', world: worldId, revision: nextRevision, entity: arrow },
        ] }
      }
      case 'IgniteTntCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (!isInBounds(message.at) || !isBlockWithinReach(actor, message.at)) {
          return { accepted: false, reason: 'out-of-range' }
        }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected?.item !== 'flint_and_steel' && selected?.item !== 'fire_charge') {
          return { accepted: false, reason: 'invalid-command' }
        }
        if (blockAt(message.at) !== 'tnt') return { accepted: false, reason: 'invalid-command' }
        if (selected.item === 'fire_charge') {
          inventory.slots[inventory.selectedSlot] = selected.count === 1
            ? null
            : { ...selected, count: selected.count - 1 }
        }
        blocks.set(positionKey(message.at), { at: message.at, block: null })
        disturbFallingBlocks([message.at])
        const tnt: AuthoritativeEntityState = {
          _tag: 'primed-tnt',
          entityId: `${message.commandId}:tnt` as AuthoritativeEntityState['entityId'],
          at: { x: message.at.x + 0.5, y: message.at.y + 0.5, z: message.at.z + 0.5 },
          burnedSecs: 0,
          owner: message.player,
        }
        entities.set(tnt.entityId, tnt)
        return {
          accepted: true,
          worldSnapshotRequired: true,
          deltas: (nextRevision) => [
            ...(selected.item === 'fire_charge'
              ? [{ _tag: 'PlayerInventoryDelta' as const, world: actor.world, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) }]
              : []),
            { _tag: 'EntitySpawnDelta', world: worldId, revision: nextRevision, entity: tnt },
          ],
        }
      }
      case 'EnderPearlCommand': {
        const actor = players.get(message.player)
        const playerVitals = vitals.get(message.player)
        if (actor === undefined || playerVitals === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (playerVitals.health <= 0) return { accepted: false, reason: 'invalid-command' }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected?.item !== 'ender_pearl') return { accepted: false, reason: 'invalid-command' }

        const target = Option.getOrUndefined(targetBlockFromPlayerPose({
          feetPosition: actor.at,
          yawRadians: actor.facing.yawRadians,
          pitchRadians: actor.facing.pitchRadians,
        }, ENDER_PEARL_MAX_DISTANCE, (x, y, z) => blockAt({ x, y, z }) !== null))
        const origin = { x: actor.at.x, y: actor.at.y + EYE_LEVEL_OFFSET, z: actor.at.z }
        const hitDistance = target === undefined
          ? undefined
          : Math.hypot(
              target.position.x + 0.5 - origin.x,
              target.position.y + 0.5 - origin.y,
              target.position.z + 0.5 - origin.z,
            )
        const direction = forwardVector(actor.facing)
        const displacement = enderPearlDisplacement(direction.x, direction.y, direction.z, hitDistance)
        if (displacement === undefined) return { accepted: false, reason: 'invalid-command' }

        inventory.slots[inventory.selectedSlot] = selected.count === 1
          ? null
          : { ...selected, count: selected.count - 1 }
        actor.at = {
          x: actor.at.x + displacement.x,
          y: actor.at.y + displacement.y,
          z: actor.at.z + displacement.z,
        }
        playerPositions.set(message.player, { at: { ...actor.at }, facing: { ...actor.facing } })
        const wasAlive = playerVitals.health > 0
        playerVitals.health = Math.max(0, playerVitals.health - ENDER_PEARL_DAMAGE)
        const hungerActor = hungerActors.get(message.player)
        if (hungerActor !== undefined) {
          hungerActors.set(message.player, { ...hungerActor, state: { ...hungerActor.state, health: playerVitals.health } })
        }
        const died = wasAlive && playerVitals.health <= 0

        return {
          accepted: true,
          deltas: (nextRevision) => [
            ...applyPlayerDeaths(died ? [message.player] : [], nextRevision),
            ...(died ? [] : [{
              _tag: 'PlayerInventoryDelta' as const,
              world: actor.world,
              revision: nextRevision,
              player: message.player,
              state: inventorySnapshot(inventory),
            }]),
            {
              _tag: 'PlayerVitalsDelta' as const,
              world: actor.world,
              revision: nextRevision,
              player: message.player,
              state: vitalsSnapshot(playerVitals),
            },
          ],
          messages: () => [{
            _tag: 'PlayerMove',
            player: message.player,
            world: actor.world,
            at: { ...actor.at },
            facing: { ...actor.facing },
          }],
        }
      }
      case 'BucketUseCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        const selected = inventory.slots[inventory.selectedSlot]
        if (selected === null || selected === undefined || !isItemType(selected.item) || !isBucketItem(selected.item)) {
          return { accepted: false, reason: 'invalid-command' }
        }

        const target = Option.getOrUndefined(targetBlockFromPlayerPose({
          feetPosition: actor.at,
          yawRadians: actor.facing.yawRadians,
          pitchRadians: actor.facing.pitchRadians,
        }, BLOCK_INTERACTION_RANGE, (x, y, z) => {
          const block = blockAt({ x, y, z })
          return selected.item === 'bucket'
            ? block === 'water' || block === 'lava'
            : block !== null
        }))
        if (target === undefined) return { accepted: false, reason: 'invalid-command' }

        let at: BlockPos
        let block: 'water' | 'lava' | null
        let replacement: BucketItemType
        if (selected.item === 'bucket') {
          const source = blockAt(target.position)
          if (source !== 'water' && source !== 'lava') return { accepted: false, reason: 'invalid-command' }
          at = target.position
          block = null
          replacement = source === 'water' ? 'water_bucket' : 'lava_bucket'
        } else {
          if (!isInBounds(target.adjacentPosition) || blockAt(target.adjacentPosition) !== null) {
            return { accepted: false, reason: 'invalid-command' }
          }
          at = target.adjacentPosition
          block = selected.item === 'water_bucket' ? 'water' : 'lava'
          replacement = 'bucket'
        }

        const nextSlots = inventory.slots.map((stack) => stack === null ? null : { ...stack })
        const nextDurability = inventory.durability.map((state) => state === null ? null : { ...state })
        if (selected.count === 1) {
          nextSlots[inventory.selectedSlot] = { item: replacement, count: 1 }
          nextDurability[inventory.selectedSlot] = null
        } else {
          nextSlots[inventory.selectedSlot] = { ...selected, count: selected.count - 1 }
          if (addStackToInventory(nextSlots, { item: replacement, count: 1 }) !== null) {
            return { accepted: false, reason: 'invalid-command' }
          }
        }

        inventory.slots.splice(0, inventory.slots.length, ...nextSlots)
        inventory.durability.splice(0, inventory.durability.length, ...nextDurability)
        blocks.set(positionKey(at), { at, block })
        disturbFallingBlocks([at])
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'PlayerInventoryDelta' as const,
            world: actor.world,
            revision: nextRevision,
            player: message.player,
            state: inventorySnapshot(inventory),
          }],
          messages: () => [block === null
            ? { _tag: 'BlockBreak' as const, player: message.player, world: actor.world, at }
            : { _tag: 'BlockPlace' as const, player: message.player, world: actor.world, at, block }],
        }
      }
      case 'FishingCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        const active = fishingSessions.get(message.player)
        if (message.action === 'cast') {
          if (active !== undefined) return { accepted: false, reason: 'invalid-command' }
          const selected = inventory.slots[inventory.selectedSlot]
          const durability = inventory.durability[inventory.selectedSlot]
          if (selected?.item !== 'fishing_rod' || selected.count !== 1 || durability === null || !isValidDurabilityForItem('fishing_rod', durability)) {
            return { accepted: true, deltas: (nextRevision) => [{ _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'idle', result: 'invalid-rod' } }] }
          }
          const target = Option.getOrUndefined(targetBlockFromPlayerPose({
            feetPosition: actor.at,
            yawRadians: actor.facing.yawRadians,
            pitchRadians: actor.facing.pitchRadians,
          }, BLOCK_INTERACTION_RANGE, (x, y, z) => blockAt({ x, y, z }) === 'water'))
          if (target === undefined) {
            return { accepted: true, deltas: (nextRevision) => [{ _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'idle', result: 'no-water' } }] }
          }
          const rod = equipmentItem(itemStack('fishing_rod', selected.count), durability)
          const cast = castFishing(rod, fishingEnvironmentAt(target.position), {
            wait: deterministicRoll(`${String(message.player)}:${String(message.commandId)}:wait`),
            category: deterministicRoll(`${String(message.player)}:${String(message.commandId)}:category`),
            item: deterministicRoll(`${String(message.player)}:${String(message.commandId)}:item`),
          })
          if (cast._tag !== 'Cast') {
            const result = cast._tag === 'NoWater' ? 'no-water' : 'invalid-rod'
            return { accepted: true, deltas: (nextRevision) => [{ _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'idle', result } }] }
          }
          fishingSessions.set(message.player, { session: cast.session, slot: inventory.selectedSlot, water: target.position })
          return { accepted: true, deltas: (nextRevision) => [{ _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'waiting', result: 'cast' } }] }
        }
        if (active === undefined) return { accepted: false, reason: 'invalid-command' }
        fishingSessions.delete(message.player)
        const result = reelFishing(active.session)
        const current = inventory.slots[active.slot]
        if (current?.item !== 'fishing_rod') {
          return { accepted: true, deltas: (nextRevision) => [{ _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'idle', result: 'cancelled' } }] }
        }
        if (result.rod === null) {
          inventory.slots[active.slot] = null
          inventory.durability[active.slot] = null
        } else inventory.durability[active.slot] = { ...result.rod.durability }
        const overflow = result._tag === 'Caught'
          ? addStackToInventory(inventory.slots, { item: result.loot.item, count: result.loot.count })
          : null
        const overflowDrop: AuthoritativeEntityState | null = overflow === null
          ? null
          : {
              _tag: 'item-drop',
              entityId: `${String(message.player)}:fishing:${String(message.commandId)}` as AuthoritativeEntityState['entityId'],
              at: { ...actor.at },
              stack: overflow,
            }
        if (overflowDrop !== null) entities.set(overflowDrop.entityId, overflowDrop)
        const fishingResult = result._tag === 'Caught' ? 'caught' : result._tag === 'ReeledTooEarly' ? 'too-early' : 'too-late'
        return { accepted: true, deltas: (nextRevision) => [
          { _tag: 'PlayerInventoryDelta', world: actor.world, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) },
          { _tag: 'PlayerFishingDelta', world: actor.world, revision: nextRevision, player: message.player, state: { phase: 'idle', result: fishingResult } },
          ...(overflowDrop === null ? [] : [{ _tag: 'EntitySpawnDelta' as const, world: actor.world, revision: nextRevision, entity: overflowDrop }]),
        ] }
      }
      case 'EntityAttackCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'living') return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined || (actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) {
          return { accepted: false, reason: 'out-of-range' }
        }
        const health = entity.health - 4
        if (health > 0) {
          const updated = {
            ...entity,
            health,
            ...(entity.entityType === ENDERMAN_KIND
              ? { mobState: { ...mobWireState(entity.mobState), provoked: true } }
              : {}),
          }
          entities.set(entity.entityId, updated)
          return { accepted: true, deltas: (nextRevision) => [{ _tag: 'EntityUpdateDelta', world: worldId, revision: nextRevision, entity: updated }] }
        }
        entities.delete(entity.entityId)
        const kind = supportedMobKind(entity.entityType)
        const experienceReward = kind === undefined
          ? 0
          : mobXpReward({ _tag: 'Slain', lootingLevel: 0 }, mobExperienceReward(kind))
        const playerVitals = vitals.get(message.player)
        const player = players.get(message.player)
        if (experienceReward > 0 && playerVitals !== undefined) playerVitals.experience += experienceReward
        const loot = kind === undefined ? [] : rollDropsOfKind(
          kind,
          { _tag: 'Slain', lootingLevel: 0 },
          Array.from({ length: dropRollsNeeded(kind) }, (_, index) => deterministicRoll(
            `${String(options.seed)}:${String(message.player)}:${String(message.commandId)}:${String(entity.entityId)}:${String(index)}`,
          )),
        )
        const drops: ReadonlyArray<AuthoritativeEntityState> = loot.map((stack, index) => ({
          _tag: 'item-drop',
          entityId: `${entity.entityId}:drop:${String(revision + 1)}:${String(index)}` as AuthoritativeEntityState['entityId'],
          at: entity.at,
          stack,
        }))
        for (const drop of drops) entities.set(drop.entityId, drop)
        return { accepted: true, deltas: (nextRevision) => [
          { _tag: 'EntityDespawnDelta', world: worldId, revision: nextRevision, entityId: entity.entityId },
          ...drops.map((entity) => ({ _tag: 'EntitySpawnDelta' as const, world: worldId, revision: nextRevision, entity })),
          ...(experienceReward > 0 && player !== undefined && playerVitals !== undefined ? [{
            _tag: 'PlayerVitalsDelta' as const,
            world: player.world,
            revision: nextRevision,
            player: message.player,
            state: vitalsSnapshot(playerVitals),
          }] : []),
        ] }
      }
      case 'EntityPickupCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'item-drop') {
          return { accepted: false, reason: 'invalid-command' }
        }
        const droppedItem = entity.stack.item
        if (!isItemType(droppedItem)) return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined || (actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) {
          return { accepted: false, reason: 'out-of-range' }
        }

        const dropMetadata = droppedItemMetadata.get(entity.entityId)
        if (dropMetadata !== undefined) {
          const matchingSlot = inventory.slots.findIndex((current, slot) => current !== null
            && current !== undefined
            && current.item === droppedItem
            && current.count + entity.stack.count <= maxStackCountOfItem(droppedItem)
            && sameInventorySlotMetadata(inventorySlotMetadata(message.player, slot), dropMetadata))
          const emptySlot = inventory.slots.findIndex((current) => current === null
            && entity.stack.count <= maxStackCountOfItem(droppedItem))
          const slot = matchingSlot >= 0 ? matchingSlot : emptySlot
          if (slot < 0) return { accepted: false, reason: 'invalid-command' }
          const current = inventory.slots[slot]
          inventory.slots[slot] = current === null || current === undefined
            ? { item: droppedItem, count: entity.stack.count, ...(entity.stack.durability === undefined ? {} : { durability: { ...entity.stack.durability } }) }
            : { ...current, count: current.count + entity.stack.count }
          setInventorySlotMetadata(message.player, slot, dropMetadata)
          entities.delete(entity.entityId)
          droppedItemMetadata.delete(entity.entityId)
          return { accepted: true, deltas: (nextRevision) => [
            { _tag: 'EntityDespawnDelta', world: worldId, revision: nextRevision, entityId: entity.entityId },
            { _tag: 'PlayerInventoryDelta', world: worldId, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) },
          ] }
        }

        const maxStackCount = maxStackCountOfItem(droppedItem)
        let remaining = entity.stack.count
        for (let slot = 0; slot < inventory.slots.length && remaining > 0; slot += 1) {
          const current = inventory.slots[slot]
          if (current === null || current === undefined || current.item !== droppedItem || current.count >= maxStackCount) continue
          const moved = Math.min(maxStackCount - current.count, remaining)
          inventory.slots[slot] = { ...current, count: current.count + moved }
          remaining -= moved
        }
        for (let slot = 0; slot < inventory.slots.length && remaining > 0; slot += 1) {
          if (inventory.slots[slot] !== null && inventory.slots[slot] !== undefined) continue
          const moved = Math.min(maxStackCount, remaining)
          inventory.slots[slot] = { item: droppedItem, count: moved, ...(entity.stack.durability === undefined ? {} : { durability: { ...entity.stack.durability } }) }
          remaining -= moved
        }
        if (remaining === entity.stack.count) return { accepted: false, reason: 'invalid-command' }

        const entityDelta: AuthoritativeDelta = remaining === 0
          ? { _tag: 'EntityDespawnDelta', world: worldId, revision: revision + 1, entityId: entity.entityId }
          : {
              _tag: 'EntityUpdateDelta',
              world: worldId,
              revision: revision + 1,
              entity: { ...entity, stack: { ...entity.stack, count: remaining } },
            }
        if (remaining === 0) {
          entities.delete(entity.entityId)
          droppedItemMetadata.delete(entity.entityId)
        } else if (entityDelta._tag === 'EntityUpdateDelta') {
          entities.set(entity.entityId, entityDelta.entity)
        }
        return { accepted: true, deltas: (nextRevision) => [
          { ...entityDelta, revision: nextRevision },
          { _tag: 'PlayerInventoryDelta', world: worldId, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) },
        ] }
      }
      case 'VehicleUseCommand': {
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }

        const selected = inventory.slots[inventory.selectedSlot]
        const vehicleType = selected?.item === 'oak_boat'
          ? 'boat'
          : selected?.item === 'minecart'
            ? 'minecart'
            : undefined
        if (selected === null || selected === undefined || vehicleType === undefined) {
          return { accepted: false, reason: 'invalid-command' }
        }

        const target = Option.getOrUndefined(targetBlockFromPlayerPose({
          feetPosition: actor.at,
          yawRadians: actor.facing.yawRadians,
          pitchRadians: actor.facing.pitchRadians,
        }, BLOCK_INTERACTION_RANGE, (x, y, z) => blockAt({ x, y, z }) !== null))
        if (target === undefined) return { accepted: false, reason: 'invalid-command' }

        const targetBlock = blockAt(target.position)
        const placedOnRail = vehicleType === 'minecart' &&
          (targetBlock === 'rail' || targetBlock === 'powered_rail')
        const at = placedOnRail ? target.position : target.adjacentPosition
        if (!isInBounds(at) || (!placedOnRail && blockAt(at) !== null)) {
          return { accepted: false, reason: 'invalid-command' }
        }

        inventory.slots[inventory.selectedSlot] = selected.count === 1
          ? null
          : { ...selected, count: selected.count - 1 }
        if (selected.count === 1) inventory.durability[inventory.selectedSlot] = null

        const entity: AuthoritativeEntityState = {
          _tag: 'vehicle',
          entityId: `${String(message.player)}:vehicle:${String(message.commandId)}` as AuthoritativeEntityState['entityId'],
          vehicleType,
          at: { x: at.x + 0.5, y: at.y, z: at.z + 0.5 },
          occupant: null,
        }
        entities.set(entity.entityId, entity)
        return {
          accepted: true,
          deltas: (nextRevision) => [
            {
              _tag: 'PlayerInventoryDelta',
              world: actor.world,
              revision: nextRevision,
              player: message.player,
              state: inventorySnapshot(inventory),
            },
            {
              _tag: 'EntitySpawnDelta',
              world: actor.world,
              revision: nextRevision,
              entity,
            },
          ],
        }
      }
      case 'VehicleCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'vehicle') return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        let updated: AuthoritativeEntityState
        if (message.action === 'mount') {
          if ((actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) return { accepted: false, reason: 'out-of-range' }
          if (entity.occupant !== null) return { accepted: false, reason: 'vehicle-occupied' }
          updated = { ...entity, occupant: message.player }
        } else if (message.action === 'dismount') {
          if (entity.occupant !== message.player) return { accepted: false, reason: 'not-mounted' }
          updated = { ...entity, occupant: null }
        } else {
          if (entity.occupant !== message.player) return { accepted: false, reason: 'not-mounted' }
          const forward = forwardVector(actor.facing)
          const horizontalLength = Math.hypot(forward.x, forward.z)
          if (horizontalLength === 0) return { accepted: false, reason: 'invalid-command' }
          const direction = message.action.direction === 'forward' ? 1 : -1
          const at = {
            x: entity.at.x + direction * VEHICLE_MOVE_DISTANCE * forward.x / horizontalLength,
            y: entity.at.y,
            z: entity.at.z + direction * VEHICLE_MOVE_DISTANCE * forward.z / horizontalLength,
          }
          if (!isValidVehicleMovement(entity.at, at)) return { accepted: false, reason: 'out-of-range' }
          if (!tryConsumeMovementBudget(message.player, movementDistance(entity.at, at))) return { accepted: false, reason: 'out-of-range' }
          updated = { ...entity, at }
          actor.at = at
          playerPositions.set(message.player, { at: { ...at }, facing: { ...actor.facing } })
        }
        entities.set(entity.entityId, updated)
        return { accepted: true, deltas: (nextRevision) => [{ _tag: 'EntityUpdateDelta', world: worldId, revision: nextRevision, entity: updated }] }
      }
      case 'PlayerInventoryCommand': {
        if (message.action._tag === 'select-slot') {
          if (message.action.slot >= inventory.slots.length) return { accepted: false, reason: 'invalid-command' }
          inventory.selectedSlot = message.action.slot
        } else if (message.action._tag === 'drop-item') {
          const source = inventory.slots[message.action.source]
          const actor = players.get(message.player)
          if (source === undefined || source === null || source.count < message.action.count) {
            return { accepted: false, reason: 'insufficient-items' }
          }
          if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
          if (message.action.count < source.count && hasInventorySlotMetadata(message.player, message.action.source)) {
            return { accepted: false, reason: 'invalid-command' }
          }
          const durability = inventory.durability[message.action.source] ?? source.durability ?? null
          inventory.slots[message.action.source] = source.count === message.action.count
            ? null
            : { ...source, count: source.count - message.action.count }
          if (inventory.slots[message.action.source] === null) inventory.durability[message.action.source] = null
          const entity: AuthoritativeEntityState = {
            _tag: 'item-drop',
            entityId: `${String(message.player)}:drop:${String(message.commandId)}` as AuthoritativeEntityState['entityId'],
            at: { ...actor.at },
            stack: durability === null
              ? { ...source, count: message.action.count }
              : { ...source, count: message.action.count, durability: { ...durability } },
          }
          entities.set(entity.entityId, entity)
          if (source.count === message.action.count && hasInventorySlotMetadata(message.player, message.action.source)) {
            droppedItemMetadata.set(entity.entityId, inventorySlotMetadata(message.player, message.action.source))
            setInventorySlotMetadata(message.player, message.action.source, { name: null, enchantment: null })
          }
          return {
            accepted: true,
            deltas: (nextRevision) => [
              {
                _tag: 'PlayerInventoryDelta',
                world: worldId,
                revision: nextRevision,
                player: message.player,
                state: inventorySnapshot(inventory),
              },
              { _tag: 'EntitySpawnDelta', world: worldId, revision: nextRevision, entity },
            ],
          }
        } else if (message.action._tag === 'swap-items') {
          const reason = swapInventoryStacks(
            inventory,
            message.action.source,
            message.action.destination,
          )
          if (reason !== null) return { accepted: false, reason }
          swapInventorySlotMetadata(message.player, message.action.source, message.action.destination)
        } else if (message.action._tag === 'equip-item') {
          if (hasInventorySlotMetadata(message.player, message.action.source)) return { accepted: false, reason: 'invalid-command' }
          const reason = equipInventoryItem(inventory, message.action.source, message.action.equipmentSlot)
          if (reason !== null) return { accepted: false, reason }
        } else if (message.action._tag === 'unequip-item') {
          const reason = unequipInventoryItem(inventory, message.action.equipmentSlot, message.action.destination)
          if (reason !== null) return { accepted: false, reason }
        } else {
          const source = inventory.slots[message.action.source]
          if (source === null || source === undefined) return { accepted: false, reason: 'insufficient-items' }
          const metadataReason = validateInventorySlotMetadataMove(
            message.player,
            message.action.source,
            message.action.destination,
            message.action.count,
            source,
            inventory.slots[message.action.destination],
          )
          if (metadataReason !== null) return { accepted: false, reason: metadataReason }
          const reason = moveInventoryStack(
            inventory,
            message.action.source,
            message.action.destination,
            message.action.count,
          )
          if (reason !== null) return { accepted: false, reason }
          if (message.action.count === source.count) {
            transferInventorySlotMetadata(message.player, message.action.source, message.action.destination)
          }
        }
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'PlayerInventoryDelta',
            world: worldId,
            revision: nextRevision,
            player: message.player,
            state: inventorySnapshot(inventory),
          }],
        }
      }
      case 'PlayerVitalsCommand': {
        return executeHungerCommand(message)
      }
      case 'WorldTimeWeatherCommand': {
        return { accepted: false, reason: 'invalid-command' }
      }
      case 'ContainerCommand': {
        const at = parseContainerId(message.containerId)
        if (at === null) return { accepted: false, reason: 'invalid-command' }
        const container = containers.get(message.containerId)
        if (container === undefined) return { accepted: false, reason: 'resource-not-found' }
        const inaccessibleReason = facilityIsAccessible(message.player, at, container.kind)
        if (inaccessibleReason !== null) return { accepted: false, reason: inaccessibleReason }
        if (message.action._tag === 'move-item') {
          const playerIsSource = message.action.source._tag === 'player-slot'
          const playerSlot = playerIsSource ? message.action.source.slot : message.action.destination.slot
          if (hasInventorySlotMetadata(message.player, playerSlot)) return { accepted: false, reason: 'invalid-command' }
          const sourceSlots = playerIsSource ? inventory.slots : container.slots
          const destinationSlots = playerIsSource ? container.slots : inventory.slots
          const reason = moveStack(
            sourceSlots,
            message.action.source.slot,
            destinationSlots,
            message.action.destination.slot,
            message.action.count,
          )
          if (reason !== null) return { accepted: false, reason }
        }
        return {
          accepted: true,
          deltas: (nextRevision) => message.action._tag === 'move-item'
            ? [
                { _tag: 'ContainerDelta', world: worldId, revision: nextRevision, state: containerSnapshot(container) },
                {
                  _tag: 'PlayerInventoryDelta',
                  world: worldId,
                  revision: nextRevision,
                  player: message.player,
                  state: inventorySnapshot(inventory),
                },
              ]
            : [],
        }
      }
      case 'FurnaceCommand': {
        const at = parseFurnaceId(message.furnaceId)
        if (at === null) return { accepted: false, reason: 'invalid-command' }
        const inaccessibleReason = facilityIsAccessible(message.player, at, 'furnace')
        if (inaccessibleReason !== null) return { accepted: false, reason: inaccessibleReason }
        const furnace = furnaces.get(message.furnaceId)
        if (furnace === undefined) return { accepted: false, reason: 'resource-not-found' }
        const source = message.action.source
        const destination = message.action.destination
        if (source._tag === 'player-slot') {
          if (hasInventorySlotMetadata(message.player, source.slot)) return { accepted: false, reason: 'invalid-command' }
          if (destination._tag !== 'furnace-slot') return { accepted: false, reason: 'invalid-command' }
          const furnaceSlot = destination.slot
          const temporaryFurnaceSlot = [furnace[furnaceSlot]]
          const reason = moveStack(inventory.slots, source.slot, temporaryFurnaceSlot, 0, message.action.count)
          if (reason !== null) return { accepted: false, reason }
          furnace[furnaceSlot] = temporaryFurnaceSlot[0] ?? null
        } else {
          if (destination._tag !== 'player-slot') return { accepted: false, reason: 'invalid-command' }
          if (hasInventorySlotMetadata(message.player, destination.slot)) return { accepted: false, reason: 'invalid-command' }
          const furnaceSlot = source.slot
          const temporaryFurnaceSlot = [furnace[furnaceSlot]]
          const reason = moveStack(temporaryFurnaceSlot, 0, inventory.slots, destination.slot, message.action.count)
          if (reason !== null) return { accepted: false, reason }
          furnace[furnaceSlot] = temporaryFurnaceSlot[0] ?? null
        }
        return {
          accepted: true,
          deltas: (nextRevision) => [
            {
              _tag: 'FurnaceDelta',
              world: worldId,
              revision: nextRevision,
              state: furnaceSnapshot(furnace),
            },
            {
              _tag: 'PlayerInventoryDelta',
              world: worldId,
              revision: nextRevision,
              player: message.player,
              state: inventorySnapshot(inventory),
            },
          ],
        }
      }
      case 'VillagerTradeCommand': {
        const villager = villagerTrades.find((candidate) => candidate.villagerId === message.villagerId)
        if (villager === undefined) return { accepted: false, reason: 'resource-not-found' }
        const offer = villager.offers.find((candidate) => candidate.offerId === message.offerId)
        if (offer === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (offer.uses >= offer.maxUses) return { accepted: false, reason: 'offer-exhausted' }
        const input = offer.input[0]
        if (input === undefined || offer.input.length !== 1 || !isItemType(input.item) || !isItemType(offer.output.item)) {
          return { accepted: false, reason: 'invalid-command' }
        }
        const output = { ...offer.output, item: offer.output.item as ItemStack['item'] }
        const nextSlots = inventory.slots.map(cloneStack)
        let remainingInput = input.count
        for (let slot = 0; slot < nextSlots.length && remainingInput > 0; slot += 1) {
          const current = nextSlots[slot]
          if (current == null || current.item !== input.item) continue
          const moved = Math.min(current.count, remainingInput)
          nextSlots[slot] = current.count === moved ? null : { ...current, count: current.count - moved }
          remainingInput -= moved
        }
        if (remainingInput > 0) return { accepted: false, reason: 'insufficient-items' }
        let remainingOutput = output.count
        const maxStackCount = maxStackCountOfItem(output.item as Parameters<typeof maxStackCountOfItem>[0])
        for (let slot = 0; slot < nextSlots.length && remainingOutput > 0; slot += 1) {
          const current = nextSlots[slot]
          if (current == null || current.item !== output.item || current.count >= maxStackCount) continue
          const moved = Math.min(maxStackCount - current.count, remainingOutput)
          nextSlots[slot] = { ...current, count: current.count + moved }
          remainingOutput -= moved
        }
        for (let slot = 0; slot < nextSlots.length && remainingOutput > 0; slot += 1) {
          if (nextSlots[slot] != null) continue
          const moved = Math.min(maxStackCount, remainingOutput)
          nextSlots[slot] = { item: output.item, count: moved }
          remainingOutput -= moved
        }
        if (remainingOutput > 0) return { accepted: false, reason: 'invalid-command' }
        inventory.slots.splice(0, inventory.slots.length, ...nextSlots)
        const updatedVillager = {
          ...villager,
          offers: villager.offers.map((candidate) => candidate.offerId === offer.offerId
            ? { ...candidate, uses: candidate.uses + 1 }
            : candidate),
        }
        villagerTrades = villagerTrades.map((candidate) => candidate.villagerId === villager.villagerId ? updatedVillager : candidate)
        return {
          accepted: true,
          deltas: (nextRevision) => [
            {
              _tag: 'PlayerInventoryDelta',
              world: worldId,
              revision: nextRevision,
              player: message.player,
              state: inventorySnapshot(inventory),
            },
            {
              _tag: 'VillagerTradeDelta',
              world: worldId,
              revision: nextRevision,
              state: updatedVillager,
            },
          ],
        }
      }
    }
  }

  const rejectCommand = (
    client: ConnectedClient,
    message: AuthoritativeCommand,
    reason: CommandRejectionReason,
    cache = true,
  ): ReceiveResult => {
    const result: AuthoritativeCommandResult = {
      _tag: 'AuthoritativeCommandRejected',
      commandId: message.commandId,
      world: worldId,
      revision,
      reason,
      resyncRequired: reason === 'stale-revision' || reason === 'snapshot-required',
    }
    if (cache) cacheCommandResult(message, result)
    sendMessage(client, result)
    return { accepted: false, reason: reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-command' }
  }

  const handleCommand = (clientId: ClientId, client: ConnectedClient, message: AuthoritativeCommand): ReceiveResult => {
    const cached = commandResults.get(commandResultKey(message))
    if (cached !== undefined) {
      if (cached.fingerprint !== commandFingerprint(message)) {
        return rejectCommand(client, message, 'invalid-command', false)
      }
      sendMessage(client, cached.result)
      return cached.result._tag === 'AuthoritativeCommandAccepted'
        ? { accepted: true, message }
        : { accepted: false, reason: 'invalid-command' }
    }
    if (message.player !== client.playerId || message.world !== worldId) {
      return rejectCommand(client, message, 'unauthorized-player')
    }
    if (message.expectedRevision !== revision) return rejectCommand(client, message, 'stale-revision')

    const decision = decideCommand(message)
    if (!decision.accepted) return rejectCommand(client, message, decision.reason)
    const nextRevision = revision + 1
    const deltas = decision.deltas(nextRevision)
    const outboundMessages = decision.messages?.(nextRevision) ?? []
    if (deltas.length > 0 || outboundMessages.length > 0 || decision.snapshotBroadcastRequired === true) revision += 1
    const result: AuthoritativeCommandResult = {
      _tag: 'AuthoritativeCommandAccepted',
      commandId: message.commandId,
      world: worldId,
      revision,
    }
    cacheCommandResult(message, result)
    notifyStateChanged()
    sendMessage(client, result)
    if (message._tag === 'EndPortalUseCommand') {
      options.onEndPortalUse?.(clientId, message)
      return { accepted: true, message }
    }
    if (message._tag === 'NetherPortalUseCommand') {
      options.onNetherPortalUse?.(clientId, message)
      return { accepted: true, message }
    }
    for (const delta of deltas) broadcast(delta)
    if (message._tag === 'PlayerInventoryCommand' || message._tag === 'EntityPickupCommand') {
      sendAnvil(client, anvilNamesDelta(message.player))
      sendEnchanting(client, enchantmentsDelta(message.player))
    }
    for (const outboundMessage of outboundMessages) broadcast(outboundMessage)
    if (decision.worldSnapshotRequired === true) broadcast(authoritativeSnapshot())
    if (decision.snapshotBroadcastRequired === true) broadcast(snapshot())
    return { accepted: true, message }
  }

  const movementDistance = (from: PlayerSnapshot['at'], at: PlayerSnapshot['at']): number =>
    Math.hypot(at.x - from.x, at.y - from.y, at.z - from.z)

  const isPlayerPositionPassable = (at: PlayerSnapshot['at']): boolean => {
    const minX = Math.floor(at.x - PLAYER_HALF_WIDTH)
    const maxX = Math.floor(at.x + PLAYER_HALF_WIDTH - COLLISION_EPSILON)
    const minY = Math.floor(at.y)
    const maxY = Math.floor(at.y + PLAYER_HEIGHT - COLLISION_EPSILON)
    const minZ = Math.floor(at.z - PLAYER_HALF_WIDTH)
    const maxZ = Math.floor(at.z + PLAYER_HALF_WIDTH - COLLISION_EPSILON)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const position = { x, y, z }
          if (!isInBounds(position)) return false
          const block = blockAt(position)
          if (block !== null && !options.passableBlocks?.has(block)) return false
        }
      }
    }
    return true
  }

  const isVehiclePositionPassable = (at: PlayerSnapshot['at']): boolean => {
    const position = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) }
    if (!isInBounds(position)) return false
    const block = blockAt(position)
    return block === null || options.passableBlocks?.has(block) === true
  }

  const isMovementPathPassable = (
    from: PlayerSnapshot['at'],
    at: PlayerSnapshot['at'],
    isPositionPassable: (position: PlayerSnapshot['at']) => boolean,
  ): boolean => {
    const samples = Math.max(1, Math.ceil(movementDistance(from, at) / MOVEMENT_COLLISION_SAMPLE_DISTANCE))
    for (let sample = 1; sample <= samples; sample += 1) {
      const ratio = sample / samples
      if (!isPositionPassable({
        x: from.x + (at.x - from.x) * ratio,
        y: from.y + (at.y - from.y) * ratio,
        z: from.z + (at.z - from.z) * ratio,
      })) return false
    }
    return true
  }

  const isValidMovement = (player: MutablePlayer, at: PlayerSnapshot['at']): boolean => {
    if (![at.x, at.y, at.z].every(Number.isFinite)) return false
    const maximum = options.maxMoveDistance ?? DEFAULT_MAX_MOVE_DISTANCE
    if (movementDistance(player.at, at) > maximum) return false
    return isMovementPathPassable(player.at, at, isPlayerPositionPassable)
  }

  const isValidVehicleMovement = (
    from: PlayerSnapshot['at'],
    at: PlayerSnapshot['at'],
  ): boolean => {
    if (![at.x, at.y, at.z].every(Number.isFinite)) return false
    const maximum = Math.min(options.maxMoveDistance ?? DEFAULT_MAX_MOVE_DISTANCE, DEFAULT_MAX_VEHICLE_MOVE_DISTANCE)
    if (movementDistance(from, at) > maximum) return false
    return isMovementPathPassable(from, at, isVehiclePositionPassable)
  }

  const tryConsumeMovementBudget = (player: PlayerId, distance: number): boolean => {
    const nowMs = options.now?.() ?? Date.now()
    const maximum = options.maxMoveDistance ?? DEFAULT_MAX_MOVE_DISTANCE
    const previous = movementBudgets.get(player) ?? { updatedAtMs: nowMs, availableDistance: maximum }
    const elapsedSeconds = Math.max(0, nowMs - previous.updatedAtMs) / 1_000
    const effects = statusEffects.get(player) ?? emptyStatusEffectState()
    const speedMultiplier = tickStatusEffects(effects, DeltaTimeSecs(0)).movementSpeedMultiplier
    const availableDistance = Math.min(maximum, previous.availableDistance + elapsedSeconds * PLAYER_MOVE_SPEED_BLOCKS_PER_SECOND * speedMultiplier)
    movementBudgets.set(player, { updatedAtMs: nowMs, availableDistance })
    if (distance > availableDistance + COLLISION_EPSILON) return false
    movementBudgets.set(player, { updatedAtMs: nowMs, availableDistance: availableDistance - distance })
    return true
  }

  const rejectMutation = (
    client: ConnectedClient,
    message: Extract<NetworkMessage, { _tag: 'BlockPlace' | 'BlockBreak' }>,
    reason: BlockMutationRejected['reason'],
  ): ReceiveResult => {
    sendMessage(client, {
      _tag: 'BlockMutationRejected',
      player: message.player,
      world: worldId,
      at: message.at,
      operation: message._tag === 'BlockPlace' ? 'place' : 'break',
      reason,
      revision,
    })
    return { accepted: false, reason: reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-mutation' }
  }

  const removePlayer = (clientId: ClientId, client: ConnectedClient): void => {
    const playerId = client.playerId
    if (playerId === null) return
    client.playerId = null
    fishingSessions.delete(playerId)
    movementBudgets.delete(playerId)
    players.delete(playerId)
    playerClients.delete(playerId)
    broadcast({ _tag: 'PlayerLeave', player: playerId }, clientId)
  }

  const connect = (clientId: ClientId, send: SendFrame): boolean => {
    if (clients.has(clientId)) return false
    clients.set(clientId, { send, playerId: null })
    return true
  }

  const receive = (clientId: ClientId, frame: WireText): ReceiveResult => {
    const client = clients.get(clientId)
    if (client === undefined) return { accepted: false, reason: 'unknown-client' }
    if ((frame.length > PLAYER_DAMAGE_MAX_WIRE_LENGTH && frame.includes('"_tag":"PlayerDamageCommand"'))
      || (frame.length > CRAFTING_MAX_WIRE_LENGTH && frame.includes('"_tag":"CraftingCommand"'))
      || (frame.length > BREWING_MAX_WIRE_LENGTH && frame.includes('"_tag":"BrewingCommand"'))
      || (frame.length > ANVIL_MAX_WIRE_LENGTH && frame.includes('"_tag":"AnvilCommand"'))
      || (frame.length > ENCHANTING_MAX_WIRE_LENGTH && frame.includes('"_tag":"EnchantingCommand"'))) {
      return { accepted: false, reason: 'malformed-frame' }
    }
    const craftingMessage = decodeCraftingWireMessage(frame)
    if (craftingMessage?._tag === 'CraftingCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = craftingMessage
      const resultKey = craftingResultKey(client.playerId, command.commandId)
      const fingerprint = craftingFingerprint(command)
      const cached = craftingResults.get(resultKey)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) return { accepted: false, reason: 'invalid-command' }
        sendCrafting(client, cached.result)
        return cached.result.accepted ? { accepted: true, message: craftingMessage } : { accepted: false, reason: cached.result.reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-command' }
      }
      const rejectCrafting = (reason: NonNullable<CraftingCommandResult['reason']>, receiveReason: Extract<ReceiveResult, { accepted: false }>['reason'] = 'invalid-command'): ReceiveResult => {
        const result: CraftingCommandResult = { _tag: 'CraftingCommandResult', commandId: command.commandId, accepted: false, revision, reason }
        cacheCraftingResult(resultKey, fingerprint, result)
        sendCrafting(client, result)
        return { accepted: false, reason: receiveReason }
      }
      if (command.player !== client.playerId) return rejectCrafting('unauthorized-player', 'identity-spoof')
      if (command.world !== worldId) return rejectCrafting('wrong-world', 'wrong-world')
      if (command.expectedRevision !== revision) return rejectCrafting('stale-revision')
      const inventory = inventories.get(client.playerId)
      const presence = players.get(client.playerId)
      const playerVitals = vitals.get(client.playerId)
      if (inventory === undefined || presence === undefined || playerVitals === undefined || playerVitals.health <= 0) return rejectCrafting('invalid-command')
      const craftingSlots: Array<Parameters<typeof craftFromGrid>[0]['slots'][number]> = []
      for (const slot of inventory.slots) {
        if (slot === null) {
          craftingSlots.push(undefined)
          continue
        }
        if (!isItemType(slot.item)
          || !Number.isSafeInteger(slot.count)
          || slot.count <= 0
          || slot.count > maxStackCountOfItem(slot.item)) return rejectCrafting('invalid-command')
        craftingSlots.push({ item: slot.item, count: StackCount(slot.count) })
      }
      const outcome = craftFromGrid({
        slots: craftingSlots,
      }, STARTER_RECIPES, craftGrid(command.grid.width, command.grid.height, command.grid.cells.map((cell) => cell ?? undefined)))
      if (outcome.result._tag !== 'Crafted') return rejectCrafting(outcome.result._tag === 'NoMatch' ? 'no-match' : outcome.result._tag === 'MissingIngredients' ? 'missing-ingredients' : 'no-room')
      const oldSlots = [...inventory.slots]
      const oldDurability = [...inventory.durability]
      inventory.slots.splice(0, inventory.slots.length, ...outcome.inventory.slots.map((slot) => slot === undefined ? null : { item: slot.item, count: slot.count }))
      inventory.durability.splice(0, inventory.durability.length, ...outcome.inventory.slots.map((slot, index) => slot !== undefined && oldSlots[index]?.item === slot.item ? oldDurability[index] ?? null : null))
      revision += 1
      const result: CraftingCommandResult = { _tag: 'CraftingCommandResult', commandId: command.commandId, accepted: true, revision }
      cacheCraftingResult(resultKey, fingerprint, result)
      notifyStateChanged()
      broadcast({ _tag: 'PlayerInventoryDelta', world: presence.world, revision, player: client.playerId, state: inventorySnapshot(inventory) })
      sendCrafting(client, result)
      return { accepted: true, message: craftingMessage }
    }
    const anvilMessage = decodeAnvilWireMessage(frame)
    if (anvilMessage?._tag === 'AnvilCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = anvilMessage
      const playerId = client.playerId
      const resultKey = anvilResultKey(playerId, command.commandId)
      const fingerprint = anvilFingerprint(command)
      const cached = anvilResults.get(resultKey)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) return { accepted: false, reason: 'invalid-command' }
        sendAnvil(client, cached.result)
        return cached.result.accepted
          ? { accepted: true, message: anvilMessage }
          : { accepted: false, reason: cached.result.reason === 'unauthorized-player' ? 'identity-spoof' : cached.result.reason === 'wrong-world' ? 'wrong-world' : 'invalid-command' }
      }
      const rejectAnvil = (
        reason: Extract<AnvilCommandResult, { accepted: false }>['reason'],
        receiveReason: Extract<ReceiveResult, { accepted: false }>['reason'] = 'invalid-command',
      ): ReceiveResult => {
        const result: AnvilCommandResult = { _tag: 'AnvilCommandResult', commandId: command.commandId, accepted: false, revision, reason }
        cacheAnvilResult(resultKey, fingerprint, result)
        sendAnvil(client, result)
        return { accepted: false, reason: receiveReason }
      }
      if (command.player !== playerId) return rejectAnvil('unauthorized-player', 'identity-spoof')
      if (command.world !== worldId) return rejectAnvil('wrong-world', 'wrong-world')
      if (command.expectedRevision !== revision) return rejectAnvil('stale-revision')
      const inventory = inventories.get(playerId)
      const presence = players.get(playerId)
      const playerVitals = vitals.get(playerId)
      if (inventory === undefined || presence === undefined || playerVitals === undefined || playerVitals.health <= 0) return rejectAnvil('invalid-command')
      const stack = inventory.slots[command.slot]
      if (stack === null || stack === undefined) return rejectAnvil('no-item')
      const names = anvilNames.get(playerId) ?? new Map<number, string>()
      const currentName = names.get(command.slot) ?? ''
      const currentDurability = inventory.durability[command.slot]
      const canRepair = currentDurability !== null && currentDurability !== undefined && currentDurability.current < currentDurability.max
      if (currentName === command.name && !canRepair) return rejectAnvil('no-change')
      const remainingExperience = spendExperienceLevels(playerVitals.experience, 1)
      if (remainingExperience === undefined) return rejectAnvil('insufficient-experience')
      const ironSlot = inventory.slots.findIndex((candidate, slot) =>
        slot !== command.slot && candidate?.item === 'iron_ingot' && candidate.count > 0,
      )
      if (ironSlot < 0) return rejectAnvil('missing-iron')
      const iron = inventory.slots[ironSlot]
      if (iron === null || iron === undefined) return rejectAnvil('missing-iron')
      inventory.slots[ironSlot] = iron.count === 1 ? null : { ...iron, count: iron.count - 1 }
      if (iron.count === 1) inventory.durability[ironSlot] = null
      const repairedDurability = isItemType(stack.item) ? durabilityForItem(stack.item) : null
      if (repairedDurability !== null) inventory.durability[command.slot] = repairedDurability
      playerVitals.experience = remainingExperience
      if (command.name.length === 0) names.delete(command.slot)
      else names.set(command.slot, command.name)
      anvilNames.set(playerId, names)
      revision += 1
      const result: AnvilCommandResult = { _tag: 'AnvilCommandResult', commandId: command.commandId, accepted: true, revision }
      cacheAnvilResult(resultKey, fingerprint, result)
      notifyStateChanged()
      broadcast({ _tag: 'PlayerInventoryDelta', world: presence.world, revision, player: playerId, state: inventorySnapshot(inventory) })
      broadcast({ _tag: 'PlayerVitalsDelta', world: presence.world, revision, player: playerId, state: vitalsSnapshot(playerVitals) })
      sendAnvil(client, anvilNamesDelta(playerId))
      sendAnvil(client, result)
      return { accepted: true, message: anvilMessage }
    }
    const enchantingMessage = decodeEnchantingWireMessage(frame)
    if (enchantingMessage?._tag === 'EnchantingCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = enchantingMessage
      const playerId = client.playerId
      const resultKey = enchantingResultKey(playerId, command.commandId)
      const fingerprint = enchantingFingerprint(command)
      const cached = enchantingResults.get(resultKey)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) return { accepted: false, reason: 'invalid-command' }
        sendEnchanting(client, cached.result)
        return cached.result.accepted
          ? { accepted: true, message: enchantingMessage }
          : { accepted: false, reason: cached.result.reason === 'unauthorized-player' ? 'identity-spoof' : cached.result.reason === 'wrong-world' ? 'wrong-world' : 'invalid-command' }
      }
      const rejectEnchanting = (
        reason: Extract<EnchantingCommandResult, { accepted: false }>['reason'],
        receiveReason: Extract<ReceiveResult, { accepted: false }>['reason'] = 'invalid-command',
      ): ReceiveResult => {
        const result: EnchantingCommandResult = { _tag: 'EnchantingCommandResult', commandId: command.commandId, accepted: false, revision, reason }
        cacheEnchantingResult(resultKey, fingerprint, result)
        sendEnchanting(client, result)
        return { accepted: false, reason: receiveReason }
      }
      if (command.player !== playerId) return rejectEnchanting('unauthorized-player', 'identity-spoof')
      if (command.world !== worldId) return rejectEnchanting('wrong-world', 'wrong-world')
      if (command.expectedRevision !== revision) return rejectEnchanting('stale-revision')
      const inventory = inventories.get(playerId)
      const presence = players.get(playerId)
      const playerVitals = vitals.get(playerId)
      if (inventory === undefined || presence === undefined || playerVitals === undefined || playerVitals.health <= 0) return rejectEnchanting('invalid-command')
      const stack = inventory.slots[command.slot]
      if (stack === null || stack === undefined) return rejectEnchanting('no-item')
      if (!isItemType(stack.item)) return rejectEnchanting('invalid-item')
      const current = enchantments.get(playerId) ?? { seed: options.seed >>> 0, items: new Map<number, EnchantedItem>() }
      const item = decodeEnchantedItem({
        item: stack.item,
        durability: inventory.durability[command.slot] ?? null,
        enchantments: current.items.get(command.slot)?.enchantments ?? [],
      })
      if (!item.ok) return rejectEnchanting('invalid-item')
      const lapis = inventory.slots.reduce(
        (total, candidate) => total + (candidate?.item === 'lapis_lazuli' ? candidate.count : 0),
        0,
      )
      const outcome = applyEnchantmentOffer({
        seed: current.seed,
        bookshelfCount: 15,
        playerLevel: levelForTotalExperience(playerVitals.experience),
        lapis,
        item: item.value,
      }, enchantmentOffers(current.seed, 15)[command.offer])
      if (!outcome.ok) {
        const reason: Extract<EnchantingCommandResult, { accepted: false }>['reason'] =
          outcome.reason === 'invalid_state' || outcome.reason === 'invalid_offer'
            ? 'invalid-command'
            : outcome.reason === 'no_item'
              ? 'no-item'
              : outcome.reason === 'invalid_item'
                ? 'invalid-item'
                : outcome.reason === 'incompatible_item'
                  ? 'incompatible-item'
                  : outcome.reason === 'conflicting_enchantment'
                    ? 'conflicting-enchantment'
                    : outcome.reason === 'insufficient_level'
                      ? 'insufficient-level'
                      : 'insufficient-lapis'
        return rejectEnchanting(reason)
      }
      if (outcome.state.item === null) return rejectEnchanting('no-item')
      let remainingLapis = lapis - outcome.state.lapis
      for (let slot = 0; slot < inventory.slots.length && remainingLapis > 0; slot += 1) {
        const candidate = inventory.slots[slot]
        if (candidate?.item !== 'lapis_lazuli') continue
        const consumed = Math.min(candidate.count, remainingLapis)
        inventory.slots[slot] = consumed === candidate.count ? null : { ...candidate, count: candidate.count - consumed }
        if (consumed === candidate.count) inventory.durability[slot] = null
        remainingLapis -= consumed
      }
      if (remainingLapis !== 0) return rejectEnchanting('insufficient-lapis')
      current.seed = outcome.state.seed
      current.items.set(command.slot, outcome.state.item)
      enchantments.set(playerId, current)
      playerVitals.experience = totalExperienceAtLevel(outcome.state.playerLevel)
      revision += 1
      const result: EnchantingCommandResult = { _tag: 'EnchantingCommandResult', commandId: command.commandId, accepted: true, revision }
      cacheEnchantingResult(resultKey, fingerprint, result)
      notifyStateChanged()
      broadcast({ _tag: 'PlayerInventoryDelta', world: presence.world, revision, player: playerId, state: inventorySnapshot(inventory) })
      broadcast({ _tag: 'PlayerVitalsDelta', world: presence.world, revision, player: playerId, state: vitalsSnapshot(playerVitals) })
      sendEnchanting(client, enchantmentsDelta(playerId))
      sendEnchanting(client, result)
      return { accepted: true, message: enchantingMessage }
    }
    const brewingMessage = decodeBrewingWireMessage(frame)
    if (brewingMessage?._tag === 'BrewingCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = brewingMessage
      const resultKey = brewingResultKey(client.playerId, command.commandId)
      const fingerprint = brewingFingerprint(command)
      const cached = brewingResults.get(resultKey)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) return { accepted: false, reason: 'invalid-command' }
        sendBrewing(client, cached.result)
        return cached.result.accepted ? { accepted: true, message: brewingMessage } : { accepted: false, reason: 'invalid-command' }
      }
      const rejectBrewing = (reason: Extract<BrewingCommandResult, { accepted: false }>['reason'], receiveReason: Extract<ReceiveResult, { accepted: false }>['reason'] = 'invalid-command'): ReceiveResult => {
        const result: BrewingCommandResult = { _tag: 'BrewingCommandResult', commandId: command.commandId, accepted: false, revision, reason }
        cacheBrewingResult(resultKey, fingerprint, result)
        sendBrewing(client, result)
        return { accepted: false, reason: receiveReason }
      }
      if (command.player !== client.playerId) return rejectBrewing('unauthorized-player', 'identity-spoof')
      if (command.world !== worldId) return rejectBrewing('wrong-world', 'wrong-world')
      if (command.expectedRevision !== revision) return rejectBrewing('stale-revision')
      const playerId = client.playerId
      const inventory = inventories.get(playerId)
      const presence = players.get(playerId)
      const playerVitals = vitals.get(playerId)
      if (inventory === undefined || presence === undefined || playerVitals === undefined || playerVitals.health <= 0) return rejectBrewing('invalid-command')
      const at = { ...command.at }
      const inaccessibleReason = facilityIsAccessible(playerId, at, 'brewing_stand')
      if (inaccessibleReason !== null) return rejectBrewing('invalid-command')
      const current = brewingStands.get(positionKey(at))?.state
      if (current === undefined) return rejectBrewing('invalid-command')
      if (command.action._tag === 'open') {
        const result: BrewingCommandResult = { _tag: 'BrewingCommandResult', commandId: command.commandId, accepted: true, revision }
        cacheBrewingResult(resultKey, fingerprint, result)
        sendBrewing(client, { _tag: 'BrewingStandDelta', world: worldId, revision, at, state: copyBrewingStandState(current) })
        sendBrewing(client, result)
        return { accepted: true, message: brewingMessage }
      }
      let next = copyBrewingStandState(current)
      let inventoryChanged = false
      let effectsChanged = false
      if (command.action._tag === 'insert') {
        const source = inventory.slots[command.action.slot]
        if (source === null || source === undefined || source.count < 1) return rejectBrewing('missing-ingredients')
        const bottle = brewingBottleFromItem(source.item)
        if (source.item === 'blaze_powder') {
          const outcome = acceptBrewingFuel(next)
          if (outcome[1]._tag !== 'Accepted') return rejectBrewing('invalid-command')
          next = outcome[0]
        } else if (bottle !== undefined) {
          const outcome = acceptBrewingBottle(next, bottle)
          if (outcome[1]._tag !== 'Accepted') return rejectBrewing('invalid-command')
          next = outcome[0]
        } else if (source.item === 'nether_wart' || source.item === 'sugar' || source.item === 'spider_eye' || source.item === 'ghast_tear') {
          const outcome = acceptBrewingIngredient(next, source.item)
          if (outcome[1]._tag !== 'Accepted') return rejectBrewing('invalid-command')
          next = outcome[0]
        } else return rejectBrewing('invalid-command')
        inventory.slots[command.action.slot] = source.count === 1 ? null : { ...source, count: source.count - 1 }
        inventoryChanged = true
      } else if (command.action._tag === 'collect') {
        const outcome = collectBrewingBottle(next)
        if (outcome[1]._tag !== 'Collected') return rejectBrewing('invalid-command')
        const nextSlots = inventory.slots.map(cloneStack)
        if (addStackToInventory(nextSlots, outcome[1].returned) !== null) return rejectBrewing('no-room')
        inventory.slots.splice(0, inventory.slots.length, ...nextSlots)
        next = outcome[0]
        inventoryChanged = true
      } else {
        const outcome = drinkBrewingPotion(next)
        if (outcome[1]._tag !== 'Consumed') return rejectBrewing('invalid-command')
        next = outcome[0]
        statusEffects.set(playerId, applyStatusEffect(statusEffects.get(playerId) ?? emptyStatusEffectState(), outcome[1].effect))
        effectsChanged = true
      }
      brewingStands.set(positionKey(at), { at, state: next })
      revision += 1
      const result: BrewingCommandResult = { _tag: 'BrewingCommandResult', commandId: command.commandId, accepted: true, revision }
      cacheBrewingResult(resultKey, fingerprint, result)
      notifyStateChanged()
      broadcastBrewing({ _tag: 'BrewingStandDelta', world: worldId, revision, at, state: copyBrewingStandState(next) })
      if (inventoryChanged) broadcast({ _tag: 'PlayerInventoryDelta', world: worldId, revision, player: playerId, state: inventorySnapshot(inventory) })
      if (effectsChanged) broadcastBrewing({ _tag: 'PlayerStatusEffectsDelta', world: worldId, revision, player: playerId, state: copyStatusEffectState(statusEffects.get(playerId) as StatusEffectState) })
      sendBrewing(client, result)
      return { accepted: true, message: brewingMessage }
    }
    const playerDamageMessage = decodePlayerDamageWireMessage(frame)
    if (playerDamageMessage?._tag === 'PlayerDamageCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command: PlayerDamageCommand = playerDamageMessage
      const resultKey = playerDamageResultKey(client.playerId, command.commandId)
      const fingerprint = playerDamageFingerprint(command)
      const cached = playerDamageResults.get(resultKey)
      if (cached !== undefined) {
        if (cached.fingerprint !== fingerprint) return { accepted: false, reason: 'invalid-command' }
        sendPlayerDamage(client, cached.result)
        return cached.result.accepted
          ? { accepted: true, message: playerDamageMessage }
          : { accepted: false, reason: cached.result.reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-command' }
      }
      const rejectDamage = (
        reason: NonNullable<PlayerDamageCommandResult['reason']>,
        receiveReason: Extract<ReceiveResult, { accepted: false }>['reason'] = 'invalid-command',
      ): ReceiveResult => {
        const result: PlayerDamageCommandResult = {
          _tag: 'PlayerDamageCommandResult',
          commandId: command.commandId,
          accepted: false,
          revision,
          reason,
        }
        cachePlayerDamageResult(resultKey, fingerprint, result)
        sendPlayerDamage(client, result)
        return { accepted: false, reason: receiveReason }
      }
      if (command.player !== client.playerId) return rejectDamage('unauthorized-player', 'identity-spoof')
      if (command.world !== worldId) return rejectDamage('wrong-world', 'wrong-world')
      if (command.expectedRevision !== revision) return rejectDamage('stale-revision')
      const playerVitals = vitals.get(client.playerId)
      const presence = players.get(client.playerId)
      if (playerVitals === undefined || presence === undefined || playerVitals.health <= 0) {
        return rejectDamage('invalid-command')
      }

      const wasAlive = playerVitals.health > 0
      playerVitals.health = Math.max(
        0,
        playerVitals.health - command.amount,
        command.minimumHealthPoints ?? 0,
      )
      const hungerActor = hungerActors.get(client.playerId)
      if (hungerActor !== undefined) {
        hungerActors.set(client.playerId, {
          ...hungerActor,
          state: { ...hungerActor.state, health: playerVitals.health },
        })
      }
      revision += 1
      const result: PlayerDamageCommandResult = {
        _tag: 'PlayerDamageCommandResult',
        commandId: command.commandId,
        accepted: true,
        revision,
      }
      cachePlayerDamageResult(resultKey, fingerprint, result)
      const deltas = [
        ...applyPlayerDeaths(wasAlive && playerVitals.health <= 0 ? [client.playerId] : [], revision),
        {
          _tag: 'PlayerVitalsDelta' as const,
          world: presence.world,
          revision,
          player: client.playerId,
          state: vitalsSnapshot(playerVitals),
        },
      ]
      notifyStateChanged()
      sendPlayerDamage(client, result)
      for (const delta of deltas) broadcast(delta)
      return { accepted: true, message: playerDamageMessage }
    }
    const witherMessage = decodeWitherWireMessage(frame)
    if (witherMessage?._tag === 'WitherCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = witherMessage.command
      if (command.actor !== client.playerId) return { accepted: false, reason: 'identity-spoof' }
      const resultKey = `${String(command.actor)}\u0000${command.requestId}`
      const cachedResult = witherCommandResults.get(resultKey)
      if (cachedResult !== undefined) {
        sendWither(client, cachedResult)
        return cachedResult.accepted
          ? { accepted: true, message: witherMessage }
          : { accepted: false, reason: 'invalid-command' }
      }
      const rejectWither = (reason: 'stale-revision' | 'invalid-command'): ReceiveResult => {
        const result = { _tag: 'WitherCommandResult', requestId: command.requestId, accepted: false, revision: witherRevision, reason } as const
        witherCommandResults.set(resultKey, result)
        sendWither(client, result)
        return { accepted: false, reason: 'invalid-command' }
      }
      if (command.expectedRevision !== witherRevision) {
        return rejectWither('stale-revision')
      }
      if (command._tag === 'SummonWither') {
        if (command.dimension !== worldId) return { accepted: false, reason: 'wrong-world' }
        const actor = players.get(command.actor as PlayerId)
        const hasIntegerPosition = Number.isInteger(command.position.x)
          && Number.isInteger(command.position.y)
          && Number.isInteger(command.position.z)
        const summon = matchRuntimeWitherSummon(
          { x: Math.floor(command.position.x), y: Math.floor(command.position.y), z: Math.floor(command.position.z) },
          (position) => blockAt(position) ?? undefined,
        )
        if (!hasIntegerPosition || actor === undefined || summon === undefined || Math.hypot(
          actor.at.x - command.position.x,
          actor.at.y - command.position.y,
          actor.at.z - command.position.z,
        ) > WITHER_INTERACTION_RANGE) {
          return rejectWither('invalid-command')
        }
        for (const position of summon.consumedBlocks) blocks.set(positionKey(position), { at: position, block: null })
        disturbFallingBlocks(summon.consumedBlocks)
        revision += 1
        broadcast(snapshot())
        witherState = summonRuntimeWither(witherState, command.dimension, summon.spawnPosition)
      } else {
        const actor = players.get(command.actor as PlayerId)
        const actorVitals = vitals.get(command.actor as PlayerId)
        const target = witherState.withers.find(({ id }) => id === command.id)
        const lastAttackMs = lastWitherAttackMs.get(command.actor as PlayerId)
        if (command.kind !== 'melee' || command.amount <= 0 || actor === undefined || actorVitals === undefined
          || actorVitals.health <= 0 || target === undefined || actor.world !== target.dimension
          || target.dimension !== worldId || (lastAttackMs !== undefined && (options.now?.() ?? Date.now()) - lastAttackMs < WITHER_ATTACK_COOLDOWN_MS) || Math.hypot(
          actor.at.x - target.state.feetPosition.x,
          actor.at.y - target.state.feetPosition.y,
          actor.at.z - target.state.feetPosition.z,
        ) > WITHER_INTERACTION_RANGE) {
          return rejectWither('invalid-command')
        }
        lastWitherAttackMs.set(command.actor as PlayerId, options.now?.() ?? Date.now())
        const damage = damageRuntimeWither(witherState, command.id, WITHER_ATTACK_DAMAGE, 'melee')
        witherState = damage.state
        if (damage.death !== undefined) {
          const drop: AuthoritativeEntityState = {
            _tag: 'item-drop',
            entityId: `${command.id}:drop:${String(witherRevision + 1)}` as AuthoritativeEntityState['entityId'],
            at: damage.death.drop.position,
            stack: { item: damage.death.drop.item, count: damage.death.drop.count },
          }
          entities.set(drop.entityId, drop)
          revision += 1
          broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity: drop })
        }
      }
      witherRevision += 1
      notifyStateChanged()
      const acceptedResult = { _tag: 'WitherCommandResult', requestId: command.requestId, accepted: true, revision: witherRevision } as const
      witherCommandResults.set(resultKey, acceptedResult)
      sendWither(client, acceptedResult)
      broadcastWither(witherSnapshot())
      return { accepted: true, message: witherMessage }
    }
    const enderDragonMessage = decodeEnderDragonWireMessage(frame)
    if (enderDragonMessage?._tag === 'EnderDragonCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = enderDragonMessage.command
      if (command.actor !== client.playerId) return { accepted: false, reason: 'identity-spoof' }
      if (dimension !== 'end') return { accepted: false, reason: 'wrong-world' }
      const resultKey = `${String(command.actor)}\u0000${command.requestId}`
      const cachedResult = enderDragonCommandResults.get(resultKey)
      if (cachedResult !== undefined) {
        sendEnderDragon(client, cachedResult)
        return cachedResult.accepted
          ? { accepted: true, message: enderDragonMessage }
          : { accepted: false, reason: 'invalid-command' }
      }
      const rejectEnderDragon = (reason: 'stale-revision' | 'invalid-command'): ReceiveResult => {
        const result = { _tag: 'EnderDragonCommandResult', requestId: command.requestId, accepted: false, revision: enderDragonRevision, reason } as const
        enderDragonCommandResults.set(resultKey, result)
        sendEnderDragon(client, result)
        return { accepted: false, reason: 'invalid-command' }
      }
      if (command.expectedRevision !== enderDragonRevision) return rejectEnderDragon('stale-revision')
      const actor = players.get(command.actor as PlayerId)
      const actorVitals = vitals.get(command.actor as PlayerId)
      const lastAttackMs = lastEnderDragonAttackMs.get(command.actor as PlayerId)
      const angle = enderDragonState.phaseTimerSecs * (enderDragonState.phase === 'charging' ? 1.4 : 0.35)
      const radius = enderDragonState.phase === 'perching' ? 4 : enderDragonState.phase === 'charging' ? 8 : 20
      const dragonAt = { x: Math.cos(angle) * radius, y: 72 + Math.sin(angle * 0.5) * 8, z: Math.sin(angle) * radius }
      if (actor === undefined || actorVitals === undefined || actor.world !== worldId || actorVitals.health <= 0
        || enderDragonState.phase === 'dead' || (lastAttackMs !== undefined && (options.now?.() ?? Date.now()) - lastAttackMs < ENDER_DRAGON_ATTACK_COOLDOWN_MS)
        || Math.hypot(actor.at.x - dragonAt.x, actor.at.y - dragonAt.y, actor.at.z - dragonAt.z) > ENDER_DRAGON_INTERACTION_RANGE) {
        return rejectEnderDragon('invalid-command')
      }
      lastEnderDragonAttackMs.set(command.actor as PlayerId, options.now?.() ?? Date.now())
      const damage = damageEnderDragonByPlayer(enderDragonState, ENDER_DRAGON_ATTACK_DAMAGE)
      if (damage._tag === 'Rejected') return rejectEnderDragon('invalid-command')
      enderDragonState = damage.state
      for (const event of damage.events) {
        if (event._tag === 'ExperienceRewarded') {
          actorVitals.experience += event.amount
          revision += 1
          broadcast({ _tag: 'PlayerVitalsDelta', world: actor.world, revision, player: command.actor as PlayerId, state: vitalsSnapshot(actorVitals) })
        }
        if (event._tag === 'DragonEggRewarded') {
          const drop: AuthoritativeEntityState = {
            _tag: 'item-drop',
            entityId: `ender-dragon:egg:${String(enderDragonRevision + 1)}` as AuthoritativeEntityState['entityId'],
            at: { x: 0, y: 65, z: 0 },
            stack: { item: event.item, count: event.count },
          }
          entities.set(drop.entityId, drop)
          revision += 1
          broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity: drop })
        }
        if (event._tag === 'ExitPortalMaterializationRequested') {
          for (let x = -1; x <= 1; x += 1) {
            for (let z = -1; z <= 1; z += 1) {
              const at = { x, y: 64, z }
              blocks.set(positionKey(at), { at, block: END_EXIT_PORTAL_BLOCK })
            }
          }
          revision += 1
          broadcast(snapshot())
        }
      }
      enderDragonRevision += 1
      notifyStateChanged()
      const acceptedResult = { _tag: 'EnderDragonCommandResult', requestId: command.requestId, accepted: true, revision: enderDragonRevision } as const
      enderDragonCommandResults.set(resultKey, acceptedResult)
      sendEnderDragon(client, acceptedResult)
      broadcastEnderDragon(enderDragonSnapshot())
      return { accepted: true, message: enderDragonMessage }
    }
    const sleepMessage = decodeSleepWireMessage(frame)
    if (sleepMessage?._tag === 'SleepCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      if (sleepMessage.command.actor !== client.playerId) return { accepted: false, reason: 'identity-spoof' }
      const result = sleepAuthority.execute(sleepMessage.command)
      sendSleep(client, { _tag: 'SleepCommandResult', result })
      if (result.accepted) {
        broadcastSleep({ _tag: 'SleepEvents', revision: result.revision, events: result.events })
        if (result.events.some((event) => event._tag === 'NightSkipped')) {
          timeWeather = { timeOfDay: 6_000, weather: 'clear' }
          revision += 1
          notifyStateChanged()
          broadcast({
            _tag: 'WorldTimeWeatherDelta',
            world: worldId,
            revision,
            state: { ...timeWeather },
          })
        }
      }
      return result.accepted
        ? { accepted: true, message: sleepMessage }
        : { accepted: false, reason: 'invalid-command' }
    }
    const decoded = decodeFrame(frame)
    if (Either.isLeft(decoded)) return { accepted: false, reason: 'malformed-frame' }
    const message = decoded.right

    if (message._tag === 'PlayerJoin') {
      if (client.playerId !== null) {
        return { accepted: false, reason: 'identity-spoof' }
      }
      if (playerClients.has(message.player)) return { accepted: false, reason: 'duplicate-player' }
      const persistedPosition = playerPositions.get(message.player)
      const authoritativeAt = persistedPosition?.at ?? options.spawnAt ?? message.at
      const authoritativeFacing = persistedPosition?.facing ?? DEFAULT_FACING
      client.playerId = message.player
      players.set(message.player, {
        player: message.player,
        name: message.name,
        world: worldId,
        at: { ...authoritativeAt },
        facing: { ...authoritativeFacing },
      })
      playerPositions.set(message.player, {
        at: { ...authoritativeAt },
        facing: { ...authoritativeFacing },
      })
      playerClients.set(message.player, clientId)
      const sleepSnapshot = sleepAuthority.addActor({
        player: message.player,
        session: String(message.player),
        position: authoritativeAt,
        gameMode: 'survival',
        inventory: [],
        health: 20,
        spawn: authoritativeAt,
        lastActionTick: 0,
      })
      ensurePlayerState(message.player)
      notifyStateChanged()
      sendMessage(client, snapshot())
      sendMessage(client, {
        _tag: 'PlayerMove',
        player: message.player,
        world: worldId,
        at: authoritativeAt,
        facing: authoritativeFacing,
      })
      sendMessage(client, authoritativeSnapshot())
      sendAnvil(client, anvilNamesDelta(message.player))
      sendEnchanting(client, enchantmentsDelta(message.player))
      for (const { at, state } of brewingStands.values()) {
        sendBrewing(client, { _tag: 'BrewingStandDelta', world: worldId, revision, at: { ...at }, state: copyBrewingStandState(state) })
      }
      sendBrewing(client, {
        _tag: 'PlayerStatusEffectsDelta',
        world: worldId,
        revision,
        player: message.player,
        state: copyStatusEffectState(statusEffects.get(message.player) ?? emptyStatusEffectState()),
      })
      sendSleep(client, { _tag: 'SleepSnapshot', snapshot: sleepSnapshot })
      const authoritativeJoin = { ...message, at: authoritativeAt }
      broadcast(authoritativeJoin, clientId)
      sendWither(client, witherSnapshot())
      sendEnderDragon(client, enderDragonSnapshot())
      return { accepted: true, message: authoritativeJoin }
    }

    if (message._tag === 'Ping') {
      sendMessage(client, { _tag: 'Pong', nonce: message.nonce })
      return { accepted: true, message }
    }

    if (client.playerId === null) return { accepted: false, reason: 'join-required' }

    if (isAuthoritativeCommand(message)) return handleCommand(clientId, client, message)

    if ('player' in message && message.player !== client.playerId) {
      if (message._tag === 'BlockPlace' || message._tag === 'BlockBreak') {
        return rejectMutation(client, message, 'unauthorized-player')
      }
      return { accepted: false, reason: 'identity-spoof' }
    }

    switch (message._tag) {
      case 'PlayerLeave':
        {
          const events = sleepAuthority.disconnect(message.player)
          if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
        }
        removePlayer(clientId, client)
        return { accepted: true, message }
      case 'PlayerMove': {
        if (message.world !== undefined && message.world !== worldId) return { accepted: false, reason: 'wrong-world' }
        const player = players.get(message.player)
        if (player === undefined) return { accepted: false, reason: 'join-required' }
        if (!isValidMovement(player, message.at)) {
          sendMessage(client, {
            _tag: 'PlayerMove',
            player: player.player,
            world: worldId,
            at: player.at,
            facing: player.facing,
          })
          return { accepted: false, reason: 'invalid-movement' }
        }
        if (!tryConsumeMovementBudget(message.player, movementDistance(player.at, message.at))) {
          sendMessage(client, {
            _tag: 'PlayerMove',
            player: player.player,
            world: worldId,
            at: player.at,
            facing: player.facing,
          })
          return { accepted: false, reason: 'invalid-movement' }
        }
        player.at = message.at
        player.facing = message.facing
        playerPositions.set(message.player, {
          at: { ...message.at },
          facing: { ...message.facing },
        })
        notifyStateChanged()
        broadcast({ ...message, world: worldId })
        return { accepted: true, message }
      }
      case 'Chat':
        broadcast(message)
        return { accepted: true, message }
      case 'BlockPlace': {
        if (message.world !== undefined && message.world !== worldId) return rejectMutation(client, message, 'unauthorized-player')
        if (!isInBounds(message.at)) return rejectMutation(client, message, 'out-of-bounds')
        const player = players.get(message.player)
        if (player === undefined || !isBlockWithinReach(player, message.at)) return rejectMutation(client, message, 'unauthorized-player')
        if (message.block === 'air' || !options.allowedBlocks.has(message.block)) return rejectMutation(client, message, 'unknown-block')
        if (blockAt(message.at) !== null) return rejectMutation(client, message, 'occupied')
        const inventory = inventories.get(message.player)
        const sourceSlot = inventory?.selectedSlot ?? -1
        const sourceStack = sourceSlot >= 0 ? inventory?.slots[sourceSlot] : undefined
        if (inventory === undefined || sourceStack == null || sourceStack.item !== message.block) {
          return rejectMutation(client, message, 'unknown-block')
        }
        inventory.slots[sourceSlot] = sourceStack.count === 1
          ? null
          : { ...sourceStack, count: sourceStack.count - 1 }
        blocks.set(positionKey(message.at), { at: message.at, block: message.block })
        disturbFallingBlocks([message.at])
        const containerKind = containerKindForBlock(message.block)
        if (containerKind !== undefined) {
          const containerId = containerIdAt(message.at)
          containers.set(containerId, { containerId, kind: containerKind, slots: emptyContainerSlots(containerKind) })
        } else if (message.block === 'furnace') {
          const furnaceId = furnaceIdAt(message.at)
          furnaces.set(furnaceId, {
            furnaceId,
            input: null,
            fuel: null,
            output: null,
            burnTicksRemaining: 0,
            cookTicks: 0,
          })
        } else if (message.block === 'brewing_stand') {
          brewingStands.set(positionKey(message.at), { at: { ...message.at }, state: emptyBrewingStandState() })
        }
        revision += 1
        notifyStateChanged()
        broadcast({ ...message, world: worldId })
        broadcast({
          _tag: 'PlayerInventoryDelta',
          world: worldId,
          revision,
          player: message.player,
          state: inventorySnapshot(inventory),
        })
        if (message.block === 'brewing_stand') {
          broadcastBrewing({ _tag: 'BrewingStandDelta', world: worldId, revision, at: { ...message.at }, state: emptyBrewingStandState() })
        }
        if (containerKind !== undefined || message.block === 'furnace' || message.block === 'brewing_stand') broadcast(authoritativeSnapshot())
        return { accepted: true, message }
      }
      case 'BlockBreak': {
        if (message.world !== undefined && message.world !== worldId) return rejectMutation(client, message, 'unauthorized-player')
        if (!isInBounds(message.at)) return rejectMutation(client, message, 'out-of-bounds')
        const player = players.get(message.player)
        if (player === undefined || !isBlockWithinReach(player, message.at)) return rejectMutation(client, message, 'unauthorized-player')
        const brokenBlock = blockAt(message.at)
        if (brokenBlock === null) return rejectMutation(client, message, 'missing-block')
        blocks.set(positionKey(message.at), { at: message.at, block: null })
        poweredRails.delete(positionKey(message.at))
        levers.delete(positionKey(message.at))
        disturbFallingBlocks([message.at])
        if (containerKindForBlock(brokenBlock) !== undefined) containers.delete(containerIdAt(message.at))
        else if (brokenBlock === 'furnace') furnaces.delete(furnaceIdAt(message.at))
        else if (brokenBlock === 'brewing_stand') brewingStands.delete(positionKey(message.at))
        revision += 1
        const inventory = inventories.get(message.player)
        const heldItem = inventory?.slots[inventory.selectedSlot]?.item
        const drops = isBlockType(brokenBlock)
          ? blockLoot(
              blockIdOf(brokenBlock),
              miningLootContextForItem(typeof heldItem === 'string' && isItemType(heldItem) ? heldItem : null),
              Array.from({ length: 4 }, (_, index) => deterministicRoll(
                `block:${positionKey(message.at)}:${String(revision)}:${String(index)}`,
              )),
            ).map((stack, index): AuthoritativeEntityState => ({
              _tag: 'item-drop',
              entityId: `block:${positionKey(message.at)}:drop:${String(revision)}:${String(index)}` as AuthoritativeEntityState['entityId'],
              at: { x: message.at.x + 0.5, y: message.at.y + 0.5, z: message.at.z + 0.5 },
              stack,
            }))
          : []
        for (const drop of drops) entities.set(drop.entityId, drop)
        notifyStateChanged()
        broadcast({ ...message, world: worldId })
        for (const drop of drops) broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity: drop })
        if (brokenBlock === 'brewing_stand') {
          broadcastBrewing({ _tag: 'BrewingStandDelta', world: worldId, revision, at: { ...message.at }, state: emptyBrewingStandState() })
        }
        if (containerKindForBlock(brokenBlock) !== undefined || brokenBlock === 'furnace' || brokenBlock === 'brewing_stand') broadcast(authoritativeSnapshot())
        {
          const events = sleepAuthority.reconcile()
          if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
        }
        return { accepted: true, message }
      }
      case 'Pong':
        return { accepted: true, message }
      case 'AuthoritativeResyncRequest':
        if (message.world !== worldId) return { accepted: false, reason: 'wrong-world' }
        sendMessage(client, authoritativeSnapshot())
        return { accepted: true, message }
      case 'WorldInfo':
      case 'WorldSnapshot':
      case 'RealmTransferSnapshot':
      case 'BlockMutationRejected':
      case 'AuthoritativeSnapshot':
      case 'PlayerInventoryDelta':
      case 'PlayerVitalsDelta':
      case 'PlayerFishingDelta':
      case 'WorldTimeWeatherDelta':
      case 'LightningStrikeDelta':
      case 'ContainerDelta':
      case 'FurnaceDelta':
      case 'VillagerTradeDelta':
      case 'EntitySpawnDelta':
      case 'EntityUpdateDelta':
      case 'EntityDespawnDelta':
      case 'EyeOfEnderThrown':
      case 'AuthoritativeCommandAccepted':
      case 'AuthoritativeCommandRejected':
        return { accepted: false, reason: 'identity-spoof' }
    }
  }

  const disconnect = (clientId: ClientId): void => {
    const client = clients.get(clientId)
    if (client === undefined) return
    const playerId = client.playerId
    removePlayer(clientId, client)
    if (playerId !== null) {
      bowDrawStartedAt.delete(playerId)
      const events = sleepAuthority.disconnect(playerId)
      if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
    }
    clients.delete(clientId)
  }

  const detachPlayer = (clientId: ClientId): RealmTransferPlayer | undefined => {
    const client = clients.get(clientId)
    if (client === undefined || client.playerId === null) return undefined
    const playerId = client.playerId
    const player = players.get(playerId)
    const inventory = inventories.get(playerId)
    const playerVitals = vitals.get(playerId)
    if (player === undefined || inventory === undefined || playerVitals === undefined) return undefined
    const transfer: RealmTransferPlayer = {
      player: player.player,
      name: player.name,
      facing: { ...player.facing },
      inventory: inventorySnapshot(inventory),
      vitals: vitalsSnapshot(playerVitals),
      statusEffects: copyStatusEffectState(statusEffects.get(playerId) ?? emptyStatusEffectState()),
      anvilNames: transferAnvilNames(playerId),
      enchantments: transferEnchantments(playerId),
    }
    removePlayer(clientId, client)
    bowDrawStartedAt.delete(playerId)
    const sleepEvents = sleepAuthority.disconnect(playerId)
    if (sleepEvents.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events: sleepEvents })
    inventories.delete(playerId)
    vitals.delete(playerId)
    statusEffects.delete(playerId)
    anvilNames.delete(playerId)
    enchantments.delete(playerId)
    hungerActors.delete(playerId)
    playerPositions.delete(playerId)
    notifyStateChanged()
    return transfer
  }

  const acceptRealmTransfer = (clientId: ClientId, transfer: RealmTransferPlayer, arrival: RealmTransferArrival): boolean => {
    const client = clients.get(clientId)
    if (client === undefined || client.playerId !== null || playerClients.has(transfer.player)) return false
    const player: MutablePlayer = {
      player: transfer.player,
      name: transfer.name,
      world: worldId,
      at: { ...arrival.at },
      facing: { ...arrival.facing },
    }
    client.playerId = transfer.player
    players.set(transfer.player, player)
    playerClients.set(transfer.player, clientId)
    playerPositions.set(transfer.player, { at: { ...arrival.at }, facing: { ...arrival.facing } })
    inventories.set(transfer.player, cloneInventory(transfer.inventory))
    vitals.set(transfer.player, { ...transfer.vitals })
    statusEffects.set(transfer.player, copyStatusEffectState(transfer.statusEffects))
    anvilNames.set(transfer.player, new Map(transfer.anvilNames.map(({ slot, name }) => [slot, name])))
    enchantments.set(transfer.player, {
      seed: transfer.enchantments.seed,
      items: new Map(transfer.enchantments.items.map(({ slot, item }) => [slot, item])),
    })
    ensurePlayerState(transfer.player)
    sleepAuthority.addActor({
      player: transfer.player,
      session: String(transfer.player),
      position: { ...arrival.at },
      gameMode: 'survival',
      inventory: [],
      health: 20,
      spawn: { ...arrival.at },
      lastActionTick: 0,
    })
    notifyStateChanged()
    sendMessage(client, {
      _tag: 'RealmTransferSnapshot',
      commandId: arrival.commandId,
      player: transfer.player,
      fromWorld: arrival.fromWorld,
      destinationWorld: worldId,
      at: { ...arrival.at },
      facing: { ...arrival.facing },
      worldSnapshot: snapshot(),
      authoritativeSnapshot: authoritativeSnapshot(),
    })
    sendAnvil(client, anvilNamesDelta(transfer.player))
    sendEnchanting(client, enchantmentsDelta(transfer.player))
    sendBrewing(client, {
      _tag: 'PlayerStatusEffectsDelta',
      world: worldId,
      revision,
      player: transfer.player,
      state: copyStatusEffectState(statusEffects.get(transfer.player) ?? emptyStatusEffectState()),
    })
    sendSleep(client, { _tag: 'SleepSnapshot', snapshot: sleepAuthority.snapshot() })
    sendWither(client, witherSnapshot())
    sendEnderDragon(client, enderDragonSnapshot())
    return true
  }

  const tick = (elapsedMs: number): void => {
    let stateChanged = false
    let worldSnapshotRequired = false
    const postPersistenceDeltas: AuthoritativeDelta[] = []
    const changedFurnaces: MutableFurnaceState[] = []
    const elapsedSecs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1_000 : 0
    const validElapsedMs = elapsedSecs * 1_000
    const elapsedTicks = Math.floor((timeTickRemainderMs + validElapsedMs) / MINECRAFT_TICK_MS)
    timeTickRemainderMs = timeTickRemainderMs + validElapsedMs - elapsedTicks * MINECRAFT_TICK_MS
    const timeChanged = elapsedTicks > 0
    if (elapsedSecs > 0) {
      const fishingDeltas: Array<Omit<Extract<AuthoritativeDelta, { readonly _tag: 'PlayerFishingDelta' }>, 'revision'>> = []
      for (const [player, active] of fishingSessions) {
        const actor = players.get(player)
        const inventory = inventories.get(player)
        if (actor === undefined || inventory?.slots[active.slot]?.item !== 'fishing_rod') {
          fishingSessions.delete(player)
          if (actor !== undefined) fishingDeltas.push({ _tag: 'PlayerFishingDelta', world: actor.world, player, state: { phase: 'idle', result: 'cancelled' } })
          continue
        }
        const advanced = advanceFishing(active.session, elapsedSecs, { hasWater: blockAt(active.water) === 'water' })
        if (advanced._tag === 'Cancelled') {
          fishingSessions.delete(player)
          fishingDeltas.push({ _tag: 'PlayerFishingDelta', world: actor.world, player, state: { phase: 'idle', result: 'lost-water' } })
        } else if (advanced._tag === 'Bite') {
          active.session = advanced.session
          fishingDeltas.push({ _tag: 'PlayerFishingDelta', world: actor.world, player, state: { phase: 'bite', result: 'bite' } })
        } else if (advanced._tag === 'Escaped') {
          active.session = advanced.session
          fishingDeltas.push({ _tag: 'PlayerFishingDelta', world: actor.world, player, state: { phase: 'escaped', result: 'escaped' } })
        } else if (advanced._tag === 'Waiting') active.session = advanced.session
      }
      if (fishingDeltas.length > 0) {
        revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...fishingDeltas.map((delta) => ({ ...delta, revision })))
      }
    }
    if (timeChanged) {
      const elapsedGameSecs = (elapsedTicks * MINECRAFT_TICK_MS) / 1_000
      const weatherState = { weather: timeWeather.weather, remainingSecs: weatherClock.remainingSecs }
      const transitionDraw = weatherExpires(weatherState, elapsedGameSecs)
        ? nextRoll(weatherClock.seed)
        : undefined
      const durationDraw = transitionDraw === undefined ? undefined : nextRoll(transitionDraw.seed)
      const nextWeather = advanceWeather(
        weatherState,
        elapsedGameSecs,
        transitionDraw === undefined || durationDraw === undefined
          ? LOWEST_WEATHER_ROLLS
          : { transition: transitionDraw.roll, duration: durationDraw.roll },
      )
      timeWeather = {
        timeOfDay: (timeWeather.timeOfDay + elapsedTicks) % MINECRAFT_DAY_TICKS,
        weather: nextWeather.weather,
      }
      weatherClock = {
        remainingSecs: nextWeather.remainingSecs,
        seed: durationDraw?.seed ?? weatherClock.seed,
      }
      const nextThunderStrikeSequence = Math.floor(timeWeather.timeOfDay / THUNDER_STRIKE_INTERVAL_TICKS)
      if (
        timeWeather.weather === 'thunder'
        && nextThunderStrikeSequence !== thunderStrikeSequence
      ) {
        revision += 1
        stateChanged = true
        const target = [...players.values()][0]
        const at = target === undefined
          ? { x: 0, y: bounds.maxY, z: 0 }
          : { x: target.at.x, y: target.at.y, z: target.at.z }
        postPersistenceDeltas.push({
          _tag: 'LightningStrikeDelta',
          world: worldId,
          revision,
          at,
        })
        for (const entity of entities.values()) {
          if (
            entity._tag !== 'living'
            || entity.entityType !== CREEPER_KIND
            || entity.mobState?.charged === true
            || !isWithinLightningStrikeRadius(entity.at, at)
          ) continue
          entities.set(entity.entityId, {
            ...entity,
            mobState: { ...mobWireState(entity.mobState), charged: true },
          })
        }
      }
      thunderStrikeSequence = nextThunderStrikeSequence
    }
    if (elapsedSecs > 0) {
      for (const furnace of furnaces.values()) {
        let current = furnaceSimulationState(furnace)
        if (current === null) continue
        let remainingSecs = elapsedSecs
        let changed = false
        while (remainingSecs > 0) {
          const plan = planFurnaceAdvance(current, remainingSecs)
          const applied = applyFurnaceAdvance(current, plan)
          if (applied._tag !== 'Applied') break
          changed ||= furnaceAdvanceChanged(plan)
          current = applied.state
          remainingSecs = plan.deferredSecs
        }
        if (!changed) continue
        applyFurnaceSimulationState(furnace, current)
        changedFurnaces.push(furnace)
      }
      if (timeChanged || changedFurnaces.length > 0) {
        // Time is replicated state but does not invalidate gameplay commands.
        if (changedFurnaces.length > 0) revision += 1
        stateChanged = true
        if (timeChanged) postPersistenceDeltas.push({ _tag: 'WorldTimeWeatherDelta', world: worldId, revision, state: { ...timeWeather } })
        for (const furnace of changedFurnaces) {
          broadcast({ _tag: 'FurnaceDelta', world: worldId, revision, state: furnaceSnapshot(furnace) })
        }
      }
    }

    if (elapsedSecs > 0) {
      const changedBrewingStands: Array<Readonly<{ at: BlockPos; state: BrewingStandState }>> = []
      const changedEffects = new Set<PlayerId>()
      const changedVitals = new Set<PlayerId>()

      for (const [key, stand] of brewingStands) {
        const next = tickBrewingStand(stand.state, DeltaTimeSecs(elapsedSecs))
        if (JSON.stringify(next) === JSON.stringify(stand.state)) continue
        brewingStands.set(key, { at: stand.at, state: next })
        changedBrewingStands.push({ at: stand.at, state: next })
      }

      for (const [player, effects] of statusEffects) {
        const advanced = tickStatusEffects(effects, DeltaTimeSecs(elapsedSecs))
        if (JSON.stringify(advanced.state) !== JSON.stringify(effects)) {
          statusEffects.set(player, advanced.state)
          changedEffects.add(player)
        }

        const playerVitals = vitals.get(player)
        if (playerVitals === undefined) continue
        const nextHealth = Math.min(
          PLAYER_MAXIMUM_HEALTH_POINTS,
          Math.max(
            POISON_MINIMUM_HEALTH_POINTS,
            playerVitals.health - advanced.poisonPulses * POISON_DAMAGE_POINTS + advanced.regenerationPulses * REGENERATION_HEAL_POINTS,
          ),
        )
        if (nextHealth === playerVitals.health) continue
        playerVitals.health = nextHealth
        const hungerActor = hungerActors.get(player)
        if (hungerActor !== undefined) hungerActors.set(player, {
          ...hungerActor,
          state: { ...hungerActor.state, health: playerVitals.health },
        })
        changedVitals.add(player)
      }

      if (changedBrewingStands.length > 0 || changedEffects.size > 0 || changedVitals.size > 0) {
        revision += 1
        stateChanged = true
        for (const stand of changedBrewingStands) {
          broadcastBrewing({ _tag: 'BrewingStandDelta', world: worldId, revision, at: stand.at, state: copyBrewingStandState(stand.state) })
        }
        for (const player of changedEffects) {
          broadcastBrewing({ _tag: 'PlayerStatusEffectsDelta', world: worldId, revision, player, state: copyStatusEffectState(statusEffects.get(player) as StatusEffectState) })
        }
        for (const player of changedVitals) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({
            _tag: 'PlayerVitalsDelta',
            world: presence.world,
            revision,
            player,
            state: vitalsSnapshot(vitals.get(player) as MutableVitalsState),
          })
        }
      }
    }

    if (elapsedSecs > 0) {
      simulationElapsedSecs += elapsedSecs
      const damagedPlayers = new Set<PlayerId>()
      const deadPlayers = new Set<PlayerId>()

      for (const [player, presence] of players) {
        const playerVitals = vitals.get(player)
        if (playerVitals === undefined || playerVitals.health <= 0) {
          environmentalContactDamageStates.delete(player)
          continue
        }
        const resolution = resolveEnvironmentalContactDamage(
          environmentalContactDamageStates.get(player) ?? INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE,
          environmentalContactsAt(presence.at),
          simulationElapsedSecs,
        )
        environmentalContactDamageStates.set(player, resolution.state)
        const damage = resolution.damages.reduce((total, entry) => total + entry.amount, 0)
        if (damage <= 0) continue

        const wasAlive = playerVitals.health > 0
        playerVitals.health = Math.max(0, playerVitals.health - damage)
        const hungerActor = hungerActors.get(player)
        if (hungerActor !== undefined) hungerActors.set(player, {
          ...hungerActor,
          state: { ...hungerActor.state, health: playerVitals.health },
        })
        damagedPlayers.add(player)
        if (wasAlive && playerVitals.health <= 0) deadPlayers.add(player)
      }

      if (damagedPlayers.size > 0) {
        revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...applyPlayerDeaths([...deadPlayers], revision))
        for (const player of damagedPlayers) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({
            _tag: 'PlayerVitalsDelta',
            world: presence.world,
            revision,
            player,
            state: vitalsSnapshot(vitals.get(player) as MutableVitalsState),
          })
        }
      }
    }

    if (elapsedTicks > 0) {
      if (applyPendingFallingBlocks()) {
        revision += 1
        stateChanged = true
        worldSnapshotRequired = true
      }

      const agedEntities: AuthoritativeDelta[] = []
      for (const entity of entities.values()) {
        if (entity._tag !== 'item-drop') continue
        const ageTicks = (entity.ageTicks ?? 0) + elapsedTicks
        if (ageTicks >= ITEM_DROP_LIFESPAN_TICKS) {
          entities.delete(entity.entityId)
          droppedItemMetadata.delete(entity.entityId)
          agedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: entity.entityId })
          continue
        }
        if (ageTicks === entity.ageTicks) continue
        const updated = { ...entity, ageTicks }
        entities.set(entity.entityId, updated)
        agedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
      }
      if (agedEntities.length > 0) {
        // Age updates are replicated visual state; only a despawn invalidates commands.
        if (agedEntities.some((delta) => delta._tag === 'EntityDespawnDelta')) revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...agedEntities.map((delta) => ({ ...delta, revision })))
      }
    }

    if (elapsedSecs > 0) {
      const movedEntities: AuthoritativeDelta[] = []
      const damagedPlayers = new Set<PlayerId>()
      const deadPlayers = new Set<PlayerId>()
      let worldChanged = false
      for (const [key, recovery] of eyeOfEnderRecoveries) {
        const remainingSecs = recovery.remainingSecs - elapsedSecs
        if (remainingSecs > 0) {
          eyeOfEnderRecoveries.set(key, { ...recovery, remainingSecs })
          worldChanged = true
          continue
        }
        eyeOfEnderRecoveries.delete(key)
        const drop: AuthoritativeEntityState = {
          _tag: 'item-drop',
          entityId: recovery.entityId,
          at: recovery.at,
          stack: { item: 'eye_of_ender', count: 1 },
        }
        entities.set(drop.entityId, drop)
        movedEntities.push({ _tag: 'EntitySpawnDelta', world: worldId, revision: 0, entity: drop })
        worldChanged = true
      }
      const applyExplosion = (
        center: Readonly<{ x: number; y: number; z: number }>,
        explosion: Explosion,
      ): void => {
        // Explosion resolution always needs a snapshot, including an empty crater.
        worldChanged = true
        const blockReader = (position: BlockPos) => {
          if (!isInBounds(position)) return undefined
          const block = blockAt(position)
          return block === null ? { resistance: 0, destructible: false } : {
            resistance: 1,
            destructible: block !== 'bedrock',
          }
        }
        const plan = planExplosion({
          center,
          radius: explosion.power,
          seed: revision,
          blocks: blockReader,
          entities: [],
        })
        for (const position of plan.destroyedBlocks) {
          blocks.set(positionKey(position), { at: position, block: null })
          disturbFallingBlocks([position])
          worldChanged = true
        }
        for (const [player, presence] of players) {
          if (presence.world !== worldId) continue
          const distance = Math.hypot(
            presence.at.x - center.x,
            presence.at.y + 0.9 - center.y,
            presence.at.z - center.z,
          )
          const damage = explosionDamageAt(explosion, distance)
          if (damage.amount <= 0) continue
          const playerVitals = vitals.get(player)
          if (playerVitals === undefined) continue
          const wasAlive = playerVitals.health > 0
          playerVitals.health = Math.max(0, playerVitals.health - damage.amount)
          const hungerActor = hungerActors.get(player)
          if (hungerActor !== undefined) hungerActors.set(player, {
            ...hungerActor,
            state: { ...hungerActor.state, health: playerVitals.health },
          })
          damagedPlayers.add(player)
          if (wasAlive && playerVitals.health <= 0) deadPlayers.add(player)
        }
      }
      for (const entity of entities.values()) {
        if (entity._tag === 'arrow') {
          const ageTicks = entity.ageTicks + elapsedTicks
          const at = {
            x: entity.at.x + entity.velocity.x * elapsedSecs,
            y: entity.at.y + entity.velocity.y * elapsedSecs,
            z: entity.at.z + entity.velocity.z * elapsedSecs,
          }
          const velocity = { ...entity.velocity, y: entity.velocity.y - ARROW_GRAVITY * elapsedSecs }
          const travel = {
            x: at.x - entity.at.x,
            y: at.y - entity.at.y,
            z: at.z - entity.at.z,
          }
          const blockImpact = raycastArrowBlock(entity.at, at, (x, y, z) => {
            const position: BlockPos = { x, y, z }
            if (!isInBounds(position)) return true
            const block = blockAt(position)
            return block !== null && options.passableBlocks?.has(block) !== true
          })
          const travelDistance = Math.hypot(travel.x, travel.y, travel.z)
          const blockProjection = Option.isNone(blockImpact) ? undefined : blockImpact.value.distance / travelDistance
          const blockWasHit = Option.isSome(blockImpact)
          const livingHit = [...entities.values()]
            .filter((candidate): candidate is Extract<AuthoritativeEntityState, { readonly _tag: 'living' }> => candidate._tag === 'living')
            .map((candidate) => ({
              candidate,
              projection: arrowHitProjection(entity.at, at, { ...candidate.at, y: candidate.at.y + 0.9 }),
            }))
            .filter((candidate): candidate is { candidate: Extract<AuthoritativeEntityState, { readonly _tag: 'living' }>; projection: number } => candidate.projection !== undefined)
            .sort((left, right) => left.projection - right.projection)[0]
          const playerHit = [...players.entries()]
            .filter(([player, presence]) =>
              player !== entity.owner
              && presence.world === worldId
              && (vitals.get(player)?.health ?? 0) > 0,
            )
            .map(([player, presence]) => ({
              player,
              projection: arrowHitProjection(entity.at, at, { ...presence.at, y: presence.at.y + 0.9 }),
            }))
            .filter((candidate): candidate is { player: PlayerId; projection: number } => candidate.projection !== undefined)
            .sort((left, right) => left.projection - right.projection)[0]
          const livingWasHit = livingHit !== undefined
            && (blockProjection === undefined || livingHit.projection < blockProjection)
          const playerWasHit = playerHit !== undefined
            && (blockProjection === undefined || playerHit.projection < blockProjection)
            && (livingHit === undefined || playerHit.projection < livingHit.projection)
          if (ageTicks >= ARROW_LIFESPAN_TICKS || blockWasHit || livingWasHit || playerWasHit) {
            entities.delete(entity.entityId)
            movedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: entity.entityId })
            if (Option.isSome(blockImpact) && !livingWasHit && !playerWasHit) {
              const drop: AuthoritativeEntityState = {
                _tag: 'item-drop',
                entityId: `${entity.entityId}:pickup:${String(revision + 1)}` as AuthoritativeEntityState['entityId'],
                at: blockImpact.value.point,
                stack: { item: 'arrow', count: 1 },
              }
              entities.set(drop.entityId, drop)
              movedEntities.push({ _tag: 'EntitySpawnDelta', world: worldId, revision: 0, entity: drop })
            }
            if (playerWasHit) {
              const playerVitals = vitals.get(playerHit.player)
              if (playerVitals !== undefined) {
                const wasAlive = playerVitals.health > 0
                playerVitals.health = Math.max(0, playerVitals.health - entity.damage)
                const hungerActor = hungerActors.get(playerHit.player)
                if (hungerActor !== undefined) {
                  hungerActors.set(playerHit.player, { ...hungerActor, state: { ...hungerActor.state, health: playerVitals.health } })
                }
                damagedPlayers.add(playerHit.player)
                if (wasAlive && playerVitals.health <= 0) deadPlayers.add(playerHit.player)
              }
            } else if (livingWasHit && livingHit !== undefined) {
              const hit = livingHit.candidate
              const health = hit.health - entity.damage
              if (health > 0) {
                const updated = { ...hit, health }
                entities.set(updated.entityId, updated)
                movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
              } else {
                entities.delete(hit.entityId)
                movedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: hit.entityId })
                const kind = supportedMobKind(hit.entityType)
                const experienceReward = kind === undefined ? 0 : mobXpReward({ _tag: 'Slain', lootingLevel: 0 }, mobExperienceReward(kind))
                if (entity.owner !== null) {
                  const ownerVitals = vitals.get(entity.owner)
                  const owner = players.get(entity.owner)
                  if (experienceReward > 0 && ownerVitals !== undefined) {
                    ownerVitals.experience += experienceReward
                    if (owner !== undefined) movedEntities.push({
                      _tag: 'PlayerVitalsDelta', world: owner.world, revision: 0, player: entity.owner, state: vitalsSnapshot(ownerVitals),
                    })
                  }
                }
                const loot = kind === undefined ? [] : rollDropsOfKind(kind, { _tag: 'Slain', lootingLevel: 0 }, Array.from(
                  { length: dropRollsNeeded(kind) },
                  (_, index) => deterministicRoll(`${String(options.seed)}:${String(entity.owner)}:${String(entity.entityId)}:${String(hit.entityId)}:${String(index)}`),
                ))
                for (const [index, stack] of loot.entries()) {
                  const drop: AuthoritativeEntityState = {
                    _tag: 'item-drop',
                    entityId: `${hit.entityId}:drop:${String(revision + 1)}:${String(index)}` as AuthoritativeEntityState['entityId'],
                    at: hit.at,
                    stack,
                  }
                  entities.set(drop.entityId, drop)
                  movedEntities.push({ _tag: 'EntitySpawnDelta', world: worldId, revision: 0, entity: drop })
                }
              }
            }
            continue
          }
          const updated = { ...entity, at, velocity, ageTicks }
          entities.set(updated.entityId, updated)
          movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
          continue
        }
        if (entity._tag === 'primed-tnt') {
          const burnedSecs = entity.burnedSecs + elapsedSecs
          if (burnedSecs >= PRIMED_TNT_FUSE_SECS) {
            entities.delete(entity.entityId)
            movedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: entity.entityId })
            applyExplosion(entity.at, { source: 'tnt', power: TNT_EXPLOSION_POWER })
            continue
          }
          const updated = { ...entity, burnedSecs }
          entities.set(updated.entityId, updated)
          movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
          continue
        }
        if (entity._tag !== 'living') continue
        const targetEntry = [...players.entries()]
          .filter(([player, presence]) => presence.world === worldId && (vitals.get(player)?.health ?? 0) > 0)
          .map(([player, presence]) => [player, presence, Math.hypot(
            presence.at.x - entity.at.x,
            presence.at.y - entity.at.y,
            presence.at.z - entity.at.z,
          )] as const)
          .sort((left, right) => left[2] - right[2])[0]
        const initialMobState = mobWireState(entity.mobState)
        const hostileMobState = isAuthoritativeHostileMob(entity.entityType)
          ? { ...initialMobState, ageTicks: (initialMobState.ageTicks ?? 0) + elapsedTicks }
          : initialMobState
        if (isAuthoritativeHostileMob(entity.entityType)) {
          const verdict = despawnVerdict({
            distanceToPlayerBlocks: targetEntry?.[2],
            persistent: hostileMobState.persistent === true,
            ...(hostileMobState.named === undefined ? {} : { named: hostileMobState.named }),
            ...(hostileMobState.tamed === undefined ? {} : { tamed: hostileMobState.tamed }),
            ...(hostileMobState.ageTicks === undefined ? {} : { ageTicks: hostileMobState.ageTicks }),
            randomRoll: deterministicRoll(`${String(options.seed)}:${String(revision)}:${String(entity.entityId)}:despawn:${String(hostileMobState.ageTicks)}`),
            difficulty: options.difficulty ?? 'normal',
          })
          if (verdict._tag === 'Despawn') {
            entities.delete(entity.entityId)
            movedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: entity.entityId })
            continue
          }
        }
        if (entity.entityType === CREEPER_KIND) {
          const step = stepCreeperFuse(
            creeperFuseForSimulation(hostileMobState),
            {
              distanceToTargetBlocks: targetEntry?.[2],
              charged: hostileMobState.charged === true,
            },
            creeperDeltaTime(elapsedSecs),
          )
          if (step.explosion !== undefined) {
            entities.delete(entity.entityId)
            movedEntities.push({ _tag: 'EntityDespawnDelta', world: worldId, revision: 0, entityId: entity.entityId })
            applyExplosion(entity.at, step.explosion)
            continue
          }
          const mobState = creeperWireState(step.fuse, hostileMobState)
          const updated = { ...entity, mobState }
          entities.set(entity.entityId, updated)
          movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
          continue
        }
        if (entity.entityType === ENDERMAN_KIND) {
          const mobState = hostileMobState
          const urge = endermanTeleportUrge({
            damagedThisStep: mobState.provoked,
            stuckTicks: mobState.motionPhase,
            roll: deterministicRoll(`${String(options.seed)}:${String(revision)}:${String(entity.entityId)}:enderman:urge`),
          })
          let at = entity.at
          if (urge._tag === 'Teleport') {
            const anchor = urge.anchor === 'self' ? entity.at : targetEntry?.[1].at
            if (anchor !== undefined) {
              const rolls = Array.from(
                { length: ENDERMAN_TELEPORT_ATTEMPTS * 2 },
                (_, index) => deterministicRoll(`${String(options.seed)}:${String(revision)}:${String(entity.entityId)}:enderman:teleport:${String(index)}`),
              )
              const cells: EndermanTeleportCell[] = []
              for (let attempt = 0; attempt < ENDERMAN_TELEPORT_ATTEMPTS; attempt += 1) {
                const xRoll = rolls[attempt * 2]
                const zRoll = rolls[attempt * 2 + 1]
                if (xRoll === undefined || zRoll === undefined) continue
                const destination = {
                  x: anchor.x + endermanTeleportOffset(xRoll),
                  y: entity.at.y,
                  z: anchor.z + endermanTeleportOffset(zRoll),
                }
                for (const position of [
                  { ...destination, y: destination.y - 1 },
                  destination,
                  { ...destination, y: destination.y + 1 },
                ]) {
                  const blockPosition = {
                    x: Math.floor(position.x),
                    y: Math.floor(position.y),
                    z: Math.floor(position.z),
                  }
                  if (!isInBounds(blockPosition)) continue
                  const block = blockAt(blockPosition)
                  cells.push({
                    position,
                    block: block ?? 'air',
                    solid: block !== null && options.passableBlocks?.has(block) !== true,
                  })
                }
              }
              at = resolveSafeEndermanTeleport(entity.at, anchor, rolls, cells)
            }
          }
          const updated = { ...entity, at, mobState: { ...mobState, provoked: false } }
          entities.set(entity.entityId, updated)
          movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
          continue
        }
        const passiveKind = supportedPassiveMobKind(entity.entityType)
        const hostileKind = supportedHostileEcosystemMobKind(entity.entityType)
        const kind = passiveKind ?? hostileKind
        if (kind === undefined) continue
        const target = hostileKind === undefined ? undefined : targetEntry?.[1].at
        const state = ecosystemMobStateForSimulation(entity.mobState) ?? initialEcosystemMobState()
        const step = stepEcosystemMob(kind, state, entity.at, target, elapsedSecs)
        const at = {
          ...step.feetPosition,
          x: Math.min(bounds.maxX, Math.max(bounds.minX, step.feetPosition.x)),
          z: Math.min(bounds.maxZ, Math.max(bounds.minZ, step.feetPosition.z)),
        }
        const mobState = {
          ...(hostileKind === undefined ? initialMobState : hostileMobState),
          attackCooldownSecs: step.state.attackCooldownSecs,
          motionPhase: step.state.motionPhase,
          provoked: step.state.provoked,
        }
        const updated = { ...entity, at, mobState }
        entities.set(entity.entityId, updated)
        movedEntities.push({ _tag: 'EntityUpdateDelta', world: worldId, revision: 0, entity: updated })
        if (step.attack !== undefined && targetEntry !== undefined) {
          const playerVitals = vitals.get(targetEntry[0])
          if (playerVitals !== undefined) {
            const wasAlive = playerVitals.health > 0
            playerVitals.health = Math.max(0, playerVitals.health - step.attack.damage)
            const hungerActor = hungerActors.get(targetEntry[0])
            if (hungerActor !== undefined) hungerActors.set(targetEntry[0], {
              ...hungerActor,
              state: { ...hungerActor.state, health: playerVitals.health },
            })
            damagedPlayers.add(targetEntry[0])
            if (wasAlive && playerVitals.health <= 0) deadPlayers.add(targetEntry[0])
          }
        }
      }
      if (movedEntities.length > 0 || damagedPlayers.size > 0 || worldChanged) {
        revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...movedEntities.map((delta) => ({ ...delta, revision })))
        postPersistenceDeltas.push(...applyPlayerDeaths([...deadPlayers], revision))
        if (worldChanged) worldSnapshotRequired = true
        for (const player of damagedPlayers) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({
            _tag: 'PlayerVitalsDelta',
            world: presence.world,
            revision,
            player,
            state: vitalsSnapshot(vitals.get(player) as MutableVitalsState),
          })
        }
      }
    }

    if (hungerActors.size > 0) {
      const authority = createHungerAuthority({ world: worldId, revision, difficulty: options.difficulty ?? 'normal', actors: [...hungerActors.values()], tickRemainderMs: hungerTickRemainderMs })
      const events = authority.tick(elapsedMs)
      hungerTickRemainderMs = authority.snapshot().tickRemainderMs
      hungerActors.clear()
      for (const actor of authority.snapshot().actors) hungerActors.set(actor.player, actor)
      const { changed, deaths } = applyHungerEvents(events)
      if (changed.length > 0) {
        revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...applyPlayerDeaths(deaths, revision))
        for (const player of changed) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({ _tag: 'PlayerVitalsDelta', world: presence.world, revision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) })
        }
      }
    }

    if (witherState.withers.length > 0 || witherState.skulls.length > 0) {
      const previousSnapshot = snapshotWitherRuntime(witherState)
      const dimensions = new Set([
        ...witherState.withers.map((wither) => wither.dimension),
        ...witherState.skulls.map((skull) => skull.dimension),
      ])
      let advanced = witherState
      const damagedPlayers = new Set<PlayerId>()
      const deadPlayers = new Set<PlayerId>()
      let worldChanged = false
      for (const dimension of dimensions) {
        const dimensionWithers = advanced.withers.filter((wither) => wither.dimension === dimension)
        const targetEntry = [...players.entries()]
          .filter(([player, presence]) => presence.world === dimension && (vitals.get(player)?.health ?? 0) > 0)
          .map(([player, presence]) => [player, presence, Math.min(...dimensionWithers.map((wither) => Math.hypot(
            presence.at.x - wither.state.feetPosition.x,
            presence.at.y - wither.state.feetPosition.y,
            presence.at.z - wither.state.feetPosition.z,
          )))] as const)
          .filter((entry) => entry[2] <= WITHER_TARGET_RANGE)
          .sort((left, right) => left[2] - right[2])[0]
        const target = targetEntry?.[1].at ?? dimensionWithers[0]?.state.feetPosition ?? { x: 0, y: 64, z: 0 }
        const result = advanceWitherRuntime(
          advanced,
          dimension,
          target,
          elapsedMs / 1_000,
          (_skull, position) => blockAt({ x: Math.floor(position.x), y: Math.floor(position.y), z: Math.floor(position.z) }) !== null,
        )
        advanced = result.state
        if (result.meleeDamage > 0 && targetEntry !== undefined) {
          const playerVitals = vitals.get(targetEntry[0])
          if (playerVitals !== undefined) {
            const wasAlive = playerVitals.health > 0
            playerVitals.health = Math.max(0, playerVitals.health - result.meleeDamage)
            const hungerActor = hungerActors.get(targetEntry[0])
            if (hungerActor !== undefined) hungerActors.set(targetEntry[0], {
              ...hungerActor,
              state: { ...hungerActor.state, health: playerVitals.health },
            })
            damagedPlayers.add(targetEntry[0])
            if (wasAlive && playerVitals.health <= 0) deadPlayers.add(targetEntry[0])
          }
        }
        for (const explosion of result.explosions) {
          const blockReader = (position: BlockPos) => {
            if (!isInBounds(position)) return undefined
            const block = blockAt(position)
            return block === null ? { resistance: 0, destructible: false } : {
              resistance: explosion.destroysResistantBlocks ? 0 : 1,
              destructible: block !== 'bedrock',
            }
          }
          const plan = planExplosion({ center: explosion.position, radius: explosion.power, seed: revision + witherRevision, blocks: blockReader, entities: [] })
          for (const position of plan.destroyedBlocks) {
            blocks.set(positionKey(position), { at: position, block: null })
            disturbFallingBlocks([position])
            worldChanged = true
          }
          for (const [player, presence] of players) {
            if (presence.world !== dimension) continue
            const distance = Math.hypot(
              presence.at.x - explosion.position.x,
              presence.at.y + 0.9 - explosion.position.y,
              presence.at.z - explosion.position.z,
            )
            const damageAmount = explosionDamageAmount(explosion.power, distance)
            if (damageAmount <= 0) continue
            const playerVitals = vitals.get(player)
            if (playerVitals === undefined) continue
            const wasAlive = playerVitals.health > 0
            playerVitals.health = Math.max(0, playerVitals.health - damageAmount)
            const hungerActor = hungerActors.get(player)
            if (hungerActor !== undefined) hungerActors.set(player, {
              ...hungerActor,
              state: { ...hungerActor.state, health: playerVitals.health },
            })
            damagedPlayers.add(player)
            if (wasAlive && playerVitals.health <= 0) deadPlayers.add(player)
          }
        }
      }
      if (worldChanged || damagedPlayers.size > 0) {
        revision += 1
        stateChanged = true
        const deathDeltas = applyPlayerDeaths([...deadPlayers], revision)
        if (worldChanged) worldSnapshotRequired = true
        postPersistenceDeltas.push(...deathDeltas)
        for (const player of damagedPlayers) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({ _tag: 'PlayerVitalsDelta', world: presence.world, revision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) })
        }
      }
      const nextSnapshot = snapshotWitherRuntime(advanced)
    if (JSON.stringify(nextSnapshot) !== JSON.stringify(previousSnapshot)) {
      witherState = advanced
      stateChanged = true
      broadcastWither(witherSnapshot())
    }
    }

    if (dimension === 'end') {
      const [advancedDragon, dragonEvents] = advanceEnderDragonEncounter(enderDragonState, elapsedMs / 1_000)
      if (JSON.stringify(advancedDragon) !== JSON.stringify(enderDragonState)) {
        enderDragonState = advancedDragon
        enderDragonRevision += 1
        stateChanged = true
        broadcastEnderDragon(enderDragonSnapshot())
      }
      for (const event of dragonEvents) {
        if (event._tag !== 'PlayerDamaged') continue
        const angle = advancedDragon.phaseTimerSecs * (advancedDragon.phase === 'charging' ? 1.4 : 0.35)
        const radius = advancedDragon.phase === 'perching' ? 4 : advancedDragon.phase === 'charging' ? 8 : 20
        const dragonAt = { x: Math.cos(angle) * radius, y: 72 + Math.sin(angle * 0.5) * 8, z: Math.sin(angle) * radius }
        const damagedPlayers = [...players].flatMap(([player, presence]) => {
          if (presence.world !== worldId || Math.hypot(
            presence.at.x - dragonAt.x,
            presence.at.y - dragonAt.y,
            presence.at.z - dragonAt.z,
          ) > 6) return []
          const playerVitals = vitals.get(player)
          if (playerVitals === undefined || playerVitals.health <= 0) return []
          const wasAlive = playerVitals.health > 0
          playerVitals.health = Math.max(0, playerVitals.health - event.amount)
          const hungerActor = hungerActors.get(player)
          if (hungerActor !== undefined) hungerActors.set(player, {
            ...hungerActor,
            state: { ...hungerActor.state, health: playerVitals.health },
          })
          return [{ player, died: wasAlive && playerVitals.health <= 0 }] as const
        })
        if (damagedPlayers.length === 0) continue
        revision += 1
        stateChanged = true
        postPersistenceDeltas.push(...applyPlayerDeaths(damagedPlayers.filter((entry) => entry.died).map((entry) => entry.player), revision))
        for (const { player } of damagedPlayers) {
          const presence = players.get(player)
          if (presence !== undefined) postPersistenceDeltas.push({ _tag: 'PlayerVitalsDelta', world: presence.world, revision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) })
        }
      }
    }

    if (stateChanged) notifyStateChanged()
    for (const delta of postPersistenceDeltas) broadcast(delta)
    if (worldSnapshotRequired) broadcast(snapshot())
  }

  const spawnEntity = (entity: AuthoritativeEntityState): boolean => {
    if (entities.has(entity.entityId)) return false
    entities.set(entity.entityId, entity)
    revision += 1
    notifyStateChanged()
    broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity })
    return true
  }

  return { connect, receive, disconnect, detachPlayer, acceptRealmTransfer, snapshot, applyHopperTransfer, applyDispenserTrigger, applyDropperTrigger, applyRedstoneBlockState, isPoweredRailPowered, applyPoweredRailState, isLeverActive, readContainerSlots, readPistonCell, applyPistonPlan, tick, spawnEntity }
}
