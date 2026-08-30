import { Data, Effect, Option, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { isValidWitherRuntimeSnapshot, type WitherRuntimeSnapshot } from '../multiplayer-shared/wither-runtime'

import { ChunkAxis, isItemType, type ChunkCoord } from '@nerima-games/mc-kernel'
import {
  loadFrom,
  SaveKey,
  saveTo,
  StoragePort,
  defineFormat,
  type SaveDecodeError,
  type SaveFormat,
  type StorageError,
} from '@nerima-games/mc-save'
import {
  advanceFurnace,
  isValidTimeState,
  isValidWeatherState,
  durabilityForItem,
  maxStackCountForItem,
  validateContainerStorageSnapshot,
  validatePlayerStorageSnapshot,
  validateCropSnapshot,
  type ContainerStorageSnapshot,
  type CropSnapshot,
  type FurnaceState,
  type ItemStack,
  type PlayerStorage,
  type TimeState,
  type WeatherState,
  type Vehicle,
  validateVehicleSnapshot,
} from '@nerima-games/mc-sim'
import {
  CHUNK_FORMAT,
  chunkSnapshotOf,
  type Chunk,
  type ChunkSource,
  type ChunkStoreApi,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import {
  emptyVillagerTradeState,
  isValidBrewingStandState,
  isValidPlayerVitals,
  isValidStatusEffectState,
  isValidVillagerTradeState,
  decodeEnchantedItem,
  EnderDragonEncounterSnapshotSchema,
  initialEnderDragonEncounter,
  type EnderDragonEncounterSnapshot,
  type Enchantment,
  type PlayerVitals,
  type BrewingStandState,
  type StatusEffectState,
  type VillagerProfession,
  type VillagerTradeState,
} from '@nerima-games/mx-gameplay'

export const SESSION_FORMAT_NAME = '@nerima-games/mc-compose/session'
export const SESSION_FORMAT_VERSION = 17

const WitherRuntimeSnapshotSchema = Schema.Unknown.pipe(
  Schema.filter((value): value is WitherRuntimeSnapshot => isValidWitherRuntimeSnapshot(value), {
    message: () => 'Wither runtime snapshot violates persistence invariants',
  }),
) as unknown as Schema.Schema<WitherRuntimeSnapshot>

// mx-gameplay's `BrewingStandState.{bottle,ingredient,brewing}` are `X |
// undefined` (never `null` — see `node_modules/@nerima-games/mx-gameplay/dist/
// domain/brewing.d.ts`), and mc-save 0.3.0's integrity checksum rejects a bare
// `undefined` anywhere in the encoded payload (`integrity-canonical.ts`'s
// `canonicalize`; see the longer `exact: true` comment further down in this
// file for the same gap on `Schema.optionalWith` fields). Swapping
// `undefined` for `null` on encode and back on decode is unambiguous here
// because these three fields never use `null` for anything else.
const restoreBrewingUndefined = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    bottle: record['bottle'] === null ? undefined : record['bottle'],
    ingredient: record['ingredient'] === null ? undefined : record['ingredient'],
    brewing: record['brewing'] === null ? undefined : record['brewing'],
  }
}

// Untyped rather than `(state: BrewingStandState) => unknown`: this also runs,
// via `toStoredSessionState`, over the deliberately-malformed fixtures the
// test suite's decode-rejection tests seed directly into `StoragePort`
// (bypassing `saveSession`/this schema's own encode). A malformed fixture is
// exactly a `BrewingStandState`-shaped value with an invalid VALUE at one of
// its fields, never a differently-SHAPED value, so a defensive property read
// here is enough — it mirrors `restoreBrewingUndefined`'s decode-side
// looseness rather than trusting the nominal type.
const encodeBrewingUndefined = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    bottle: record['bottle'] ?? null,
    ingredient: record['ingredient'] ?? null,
    brewing: record['brewing'] ?? null,
  }
}

const BrewingStandStateSchema = Schema.transform(
  Schema.Unknown,
  Schema.Unknown.pipe(
    Schema.filter((value): value is BrewingStandState => isValidBrewingStandState(value), {
      message: () => 'Brewing stand state violates gameplay invariants',
    }),
  ) as unknown as Schema.Schema<BrewingStandState>,
  {
    strict: false,
    decode: restoreBrewingUndefined,
    encode: encodeBrewingUndefined,
  },
) as unknown as Schema.Schema<BrewingStandState>

const StatusEffectStateSchema = Schema.Unknown.pipe(
  Schema.filter((value): value is StatusEffectState => isValidStatusEffectState(value), {
    message: () => 'Status effects violate gameplay invariants',
  }),
) as unknown as Schema.Schema<StatusEffectState>

const VillagerTradeStateSchema = Schema.Unknown.pipe(
  Schema.filter((value): value is VillagerTradeState => isValidVillagerTradeState(value), {
    message: () => 'Villager trades violate gameplay invariants',
  }),
) as unknown as Schema.Schema<VillagerTradeState>

export type SessionPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type PersistedEntity = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: SessionPosition
  readonly healthPoints: number
  readonly behaviour: unknown
}

export type PersistedItemDropLifetime = {
  readonly elapsedSecs: number
}

export type PersistedItemDropMetadata = {
  readonly customName?: string
  readonly enchantments?: ReadonlyArray<Enchantment>
}

export const persistedItemDropMetadata = (behaviour: unknown): PersistedItemDropMetadata => {
  const drop = asRecord(behaviour)
  if (drop === undefined) return {}

  const customName = drop['customName']
  const enchantedItem = decodeEnchantedItem({
    item: drop['item'],
    durability: drop['durability'] ?? null,
    enchantments: drop['enchantments'],
  })
  return {
    ...(typeof customName === 'string' && customName.trim().length > 0 ? { customName } : {}),
    ...(enchantedItem.ok
      ? { enchantments: enchantedItem.value.enchantments.map((enchantment) => ({ ...enchantment })) }
      : {}),
  }
}

export const persistedItemDropLifetime = (behaviour: unknown): PersistedItemDropLifetime => {
  const elapsedSecs = asRecord(behaviour)?.['elapsedSecs']
  return {
    elapsedSecs: typeof elapsedSecs === 'number' && Number.isFinite(elapsedSecs)
      ? Math.max(0, elapsedSecs)
      : 0,
  }
}

// Same undefined-vs-null gap as `normalizePersistedEntityRoster`'s own
// entity-level swap below, one object deeper: mx-gameplay's
// `HostileMobSnapshot.behaviour: CreeperFuse | EndermanFlinch |
// EcosystemMobState | undefined` (`mob-frame.d.ts`) names a mob this
// repository has no fuse/flinch/ecosystem state for yet, and a zombie is
// exactly that mob — only `OVERWORLD_ECOSYSTEM_HOSTILE_KINDS` and
// `NETHER_HOSTILE_KINDS` are ecosystem-governed, so a zombie's nested
// `behaviour` stays `undefined` for its whole lifetime. mc-save's integrity
// checksum rejects that `undefined` exactly as it rejects the entity-level
// one, but it sits a `MobBehaviour` union member two objects deep, so the
// shallow entity-level swap never reaches it. Restrict the swap to
// `HostileMobSnapshot`'s own nested field — other `MobBehaviour` members
// (`CreeperFuse`, `DroppedItemBehaviour`, ...) use `null`/absence for
// unrelated reasons and must not be touched here.
const restoreHostileMobBehaviour = (behaviour: unknown): unknown => {
  const record = asRecord(behaviour)
  if (record === undefined || record['_tag'] !== 'HostileMob') return behaviour
  return { ...record, behaviour: record['behaviour'] === null ? undefined : record['behaviour'] }
}

const normalizePersistedEntityBehaviour = (kind: string, behaviour: unknown): unknown => {
  if (kind !== 'dropped_item') return behaviour
  const drop = asRecord(behaviour)
  if (drop === undefined) return behaviour

  const item = drop['item']
  const count = drop['count']
  if (
    typeof item !== 'string'
    || !isItemType(item)
    || typeof count !== 'number'
    || !Number.isInteger(count)
    || count <= 0
    || count > maxStackCountForItem(item)
  ) return behaviour

  const enchantedItem = decodeEnchantedItem({
    item,
    durability: Object.hasOwn(drop, 'durability') ? drop['durability'] : durabilityForItem(item),
    enchantments: Object.hasOwn(drop, 'enchantments') ? drop['enchantments'] : [],
  })
  if (!enchantedItem.ok || (enchantedItem.value.durability !== null && count !== 1)) return behaviour

  const eligibleFromFrame = drop['eligibleFromFrame']
  const customName = drop['customName']
  return {
    _tag: 'DroppedItem',
    item: enchantedItem.value.item,
    count,
    durability: enchantedItem.value.durability,
    ...(typeof eligibleFromFrame === 'number'
      && Number.isInteger(eligibleFromFrame)
      && eligibleFromFrame >= 0
      ? { eligibleFromFrame }
      : {}),
    ...(typeof customName === 'string' && customName.trim().length > 0 ? { customName } : {}),
    enchantments: enchantedItem.value.enchantments.map((enchantment) => ({ ...enchantment })),
    elapsedSecs: persistedItemDropLifetime(drop).elapsedSecs,
  }
}

export type PersistedEntityRoster = {
  readonly entities: ReadonlyArray<PersistedEntity>
  readonly nextSerial: number
}

export type PersistedEntityRosters = Readonly<Record<Dimension, PersistedEntityRoster>>

export const EMPTY_ENTITY_ROSTER: PersistedEntityRoster = { entities: [], nextSerial: 0 }

export const EMPTY_ENTITY_ROSTERS: PersistedEntityRosters = {
  overworld: EMPTY_ENTITY_ROSTER,
  nether: EMPTY_ENTITY_ROSTER,
  end: EMPTY_ENTITY_ROSTER,
}

export type PersistedVillager = {
  readonly id: string
  readonly profession: VillagerProfession
  readonly dimension: Dimension
  readonly feetPosition: SessionPosition
}

export type PersistedVillagerState = {
  readonly residents: ReadonlyArray<PersistedVillager>
  readonly trades: VillagerTradeState
}

export const EMPTY_VILLAGER_STATE: PersistedVillagerState = {
  residents: [],
  trades: emptyVillagerTradeState(),
}

export const normalizePersistedEntityRoster = (value: unknown): PersistedEntityRoster => {
  const roster = asRecord(value)
  if (roster === undefined || !Array.isArray(roster['entities'])) return EMPTY_ENTITY_ROSTER

  const entities: Array<PersistedEntity> = []
  for (const value of roster['entities']) {
    const entity = asRecord(value)
    const feetPosition = asRecord(entity?.['feetPosition'])
    const kind = entity?.['kind']
    const id = entity?.['id']
    const x = feetPosition?.['x']
    const y = feetPosition?.['y']
    const z = feetPosition?.['z']
    const healthPoints = entity?.['healthPoints']
    if (
      entity === undefined
      || typeof kind !== 'string'
      || kind.trim().length === 0
      || typeof id !== 'string'
      || typeof x !== 'number'
      || !Number.isFinite(x)
      || typeof y !== 'number'
      || !Number.isFinite(y)
      || typeof z !== 'number'
      || !Number.isFinite(z)
      || typeof healthPoints !== 'number'
      || !Number.isFinite(healthPoints)
    ) continue
    entities.push({
      id,
      kind,
      feetPosition: { x, y, z },
      healthPoints,
      // mx-gameplay's `MobBehaviour` union includes `undefined` itself — "a
      // pig keeps its `undefined`" is how an ordinary passive mob with no
      // active behaviour is represented, not an edge case — and JSON has no
      // way to write a literal `undefined`, so the wire form of "no
      // behaviour" is `null`. Swap it back before `normalizePersistedEntityBehaviour`
      // sees it; see `PersistedEntityRostersSchema`'s `encode` below for the
      // opposite direction.
      behaviour: normalizePersistedEntityBehaviour(
        kind,
        restoreHostileMobBehaviour(entity['behaviour'] === null ? undefined : entity['behaviour']),
      ),
    })
  }

  const nextSerial = roster['nextSerial']
  return {
    entities,
    nextSerial: typeof nextSerial === 'number' && Number.isFinite(nextSerial)
      ? Math.max(0, Math.floor(nextSerial))
      : 0,
  }
}

export const normalizePersistedEntityRosters = (value: unknown): PersistedEntityRosters => {
  const rosters = asRecord(value)
  return {
    overworld: normalizePersistedEntityRoster(rosters?.['overworld']),
    nether: normalizePersistedEntityRoster(rosters?.['nether']),
    end: normalizePersistedEntityRoster(rosters?.['end']),
  }
}

export type PersistedLeverState = {
  readonly dimension: Dimension
  readonly position: SessionPosition
  readonly active: boolean
}

export type PersistedFurnaceState = {
  readonly dimension: Dimension
  readonly position: SessionPosition
  readonly state: FurnaceState
}

export type PersistedPortalState = {
  readonly dimension: Dimension
  readonly position: SessionPosition
}

export type PersistedEndPortalFrameState = {
  readonly position: SessionPosition
  readonly facing: 'north' | 'south' | 'east' | 'west'
  readonly eye: boolean
}

export type PersistedEndState = {
  readonly frames: ReadonlyArray<PersistedEndPortalFrameState>
  readonly portalComplete: boolean
  readonly dragon: EnderDragonEncounterSnapshot
  readonly exitPortalMaterialized: boolean
  readonly dragonEggRewarded: boolean
}

export const EMPTY_END_STATE: PersistedEndState = {
  frames: [],
  portalComplete: false,
  dragon: initialEnderDragonEncounter(),
  exitPortalMaterialized: false,
  dragonEggRewarded: false,
}

const PositionSchema: Schema.Schema<SessionPosition> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
})

const BlockCoordinateSchema = Schema.Number.pipe(
  Schema.finite(),
  Schema.filter(Number.isInteger, { message: () => 'Block coordinate must be an integer' }),
)

const BlockPositionSchema: Schema.Schema<SessionPosition> = Schema.Struct({
  x: BlockCoordinateSchema,
  y: BlockCoordinateSchema,
  z: BlockCoordinateSchema,
})

export type SessionState = {
  readonly seed: number
  readonly dimension: Dimension
  readonly player: {
    readonly feetPosition: SessionPosition
    readonly yawRadians: number
    readonly pitchRadians: number
  }
  readonly storage: PlayerStorage
  readonly containerStorage: ContainerStorageSnapshot
  readonly vitals: PlayerVitals
  readonly time: TimeState
  readonly weather: WeatherState
  readonly redstone: {
    readonly levers: ReadonlyArray<PersistedLeverState>
  }
  readonly furnaces: ReadonlyArray<PersistedFurnaceState>
  readonly portals: ReadonlyArray<PersistedPortalState>
  readonly crops: CropSnapshot
  readonly entities: PersistedEntityRosters
  readonly villagers: PersistedVillagerState
  readonly brewing: BrewingStandState
  readonly statusEffects: StatusEffectState
  readonly end: PersistedEndState
  readonly workstations?: {
    readonly enchantmentSeed: number
    readonly customNames: Readonly<Record<string, string>>
    readonly enchantedItems: Readonly<Record<string, string>>
    readonly deathDropDimension?: Dimension | undefined
    readonly respawn: {
      readonly dimension: 'overworld'
      readonly position: SessionPosition
    } | null
  } | undefined
  readonly wither?: WitherRuntimeSnapshot | undefined
  readonly vehicles?: ReadonlyArray<Vehicle> | undefined
  readonly mountedVehicleId?: string | null | undefined
}

const FiniteNumberSchema = Schema.Number.pipe(Schema.finite())

// Same undefined-vs-null gap as `PlayerStorageSchema`/`BrewingStandStateSchema`/
// `PersistedEntityRostersSchema` above, but on a REQUIRED field rather than an
// absent one: `PlayerVitals.lastDamageCause: DamageCause | undefined` is
// always present (there is no death cause yet, not an omitted property), so
// `Schema.optionalWith(..., { exact: true })` — which is about KEY absence —
// does not apply here. `Schema.UndefinedOr` lets a present `undefined` VALUE
// through validation (that is the whole point of the field's type), which is
// exactly what mc-save's integrity checksum then rejects. The struct/filter
// stays untouched; only the `lastDamageCause` value is swapped at the
// boundary, same as the other three fixes above.
const restoreVitalsLastDamageCause = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return {
    ...record,
    lastDamageCause: record['lastDamageCause'] === null ? undefined : record['lastDamageCause'],
  }
}

const encodeVitalsLastDamageCause = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return { ...record, lastDamageCause: record['lastDamageCause'] ?? null }
}

const PlayerVitalsSchema = Schema.transform(
  Schema.Unknown,
  Schema.Struct({
    healthPoints: FiniteNumberSchema,
    maxHealthPoints: FiniteNumberSchema,
    hungerPoints: FiniteNumberSchema,
    maxHungerPoints: FiniteNumberSchema,
    saturation: FiniteNumberSchema,
    exhaustion: FiniteNumberSchema,
    foodTimerSecs: FiniteNumberSchema,
    totalExperience: FiniteNumberSchema,
    lastDamageCause: Schema.UndefinedOr(Schema.String),
  }).pipe(
    Schema.filter(isValidPlayerVitals, {
      message: () => 'Player vitals violate gameplay invariants',
    }),
  ),
  {
    strict: false,
    decode: restoreVitalsLastDamageCause,
    encode: encodeVitalsLastDamageCause,
  },
) as unknown as Schema.Schema<PlayerVitals>

const TimeStateSchema: Schema.Schema<TimeState> = Schema.Struct({
  ticks: FiniteNumberSchema,
  dayLengthTicks: FiniteNumberSchema,
}).pipe(
  Schema.filter(isValidTimeState, {
    message: () => 'Time state violates simulation invariants',
  }),
)

const WeatherStateSchema: Schema.Schema<WeatherState> = Schema.Struct({
  weather: Schema.Literal('clear', 'rain', 'thunder'),
  remainingSecs: FiniteNumberSchema,
}).pipe(
  Schema.filter(isValidWeatherState, {
    message: () => 'Weather state violates simulation invariants',
  }),
)

const DimensionSchema: Schema.Schema<Dimension> = Schema.Literal('overworld', 'nether', 'end')

const PersistedEntitySchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.String,
  feetPosition: PositionSchema,
  healthPoints: FiniteNumberSchema,
  behaviour: Schema.Unknown,
})

const PersistedEntityRosterSchema = Schema.Struct({
  entities: Schema.Array(PersistedEntitySchema),
  nextSerial: Schema.Number,
})

// Same undefined-vs-null gap as `PlayerStorageSchema`/`BrewingStandStateSchema`
// above, one level further down: an entity's `behaviour` is `unknown` here
// (there is no shared schema for the whole `MobBehaviour` union across every
// mx-gameplay mob kind), so nothing upstream catches a passive mob's
// `behaviour: undefined` — "a pig keeps its `undefined`" — before mc-save's
// integrity checksum does. `normalizePersistedEntityRoster` already restores
// `null` back to `undefined` on decode (see its comment); this is the
// opposite direction.
//
// `encodeHostileMobBehaviour` is the same swap again, one object further in:
// see `restoreHostileMobBehaviour`'s comment above for why a zombie's own
// nested `behaviour` field is `undefined` for its whole lifetime and why the
// swap is restricted to `HostileMobSnapshot`.
const encodeHostileMobBehaviour = (behaviour: unknown): unknown => {
  const record = asRecord(behaviour)
  if (record === undefined || record['_tag'] !== 'HostileMob') return behaviour
  return { ...record, behaviour: record['behaviour'] ?? null }
}

const encodePersistedEntityRosters = (rosters: unknown): unknown => {
  if (rosters === null || typeof rosters !== 'object') return rosters
  const encodeRoster = (roster: unknown): unknown => {
    if (roster === null || typeof roster !== 'object') return roster
    const record = roster as Record<string, unknown>
    const entities = record['entities']
    if (!Array.isArray(entities)) return roster
    return {
      ...record,
      entities: entities.map((entity: unknown) => {
        if (entity === null || typeof entity !== 'object') return entity
        const entityRecord = entity as Record<string, unknown>
        return { ...entityRecord, behaviour: encodeHostileMobBehaviour(entityRecord['behaviour']) ?? null }
      }),
    }
  }
  const record = rosters as Record<string, unknown>
  return {
    overworld: encodeRoster(record['overworld']),
    nether: encodeRoster(record['nether']),
    end: encodeRoster(record['end']),
  }
}

const PersistedEntityRostersSchema = Schema.transform(
  Schema.Unknown,
  Schema.Struct({
    overworld: PersistedEntityRosterSchema,
    nether: PersistedEntityRosterSchema,
    end: PersistedEntityRosterSchema,
  }),
  {
    strict: false,
    decode: normalizePersistedEntityRosters,
    encode: encodePersistedEntityRosters,
  },
)

// Same undefined-vs-null gap as `BrewingStandStateSchema` above: mc-sim's
// `Inventory.slots: ReadonlyArray<Slot>` models an empty slot as `undefined`
// (`Slot = ItemStack | undefined`), never `null`, so the swap is unambiguous
// for this one field.
const restorePlayerStorageSlots = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const inventory = record['inventory']
  if (inventory === null || typeof inventory !== 'object') return value
  const inventoryRecord = inventory as Record<string, unknown>
  const slots = inventoryRecord['slots']
  if (!Array.isArray(slots)) return value
  return {
    ...record,
    inventory: {
      ...inventoryRecord,
      slots: slots.map((slot) => (slot === null ? undefined : slot)),
    },
  }
}

// Untyped for the same reason as `encodeBrewingUndefined` above: it also runs
// over the test suite's deliberately-malformed `PlayerStorage`-shaped
// fixtures via `toStoredSessionState`, which never differ in SHAPE from a
// real `PlayerStorage`, only in the values a real one would reject.
const encodePlayerStorageSlots = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const inventory = record['inventory']
  if (inventory === null || typeof inventory !== 'object') return value
  const inventoryRecord = inventory as Record<string, unknown>
  const slots = inventoryRecord['slots']
  if (!Array.isArray(slots)) return value
  return {
    ...record,
    inventory: {
      ...inventoryRecord,
      slots: slots.map((slot: unknown) => slot ?? null),
    },
  }
}

const PlayerStorageSchema = Schema.transform(
  Schema.Unknown,
  Schema.Unknown.pipe(
    Schema.filter(
      (value): value is PlayerStorage => validatePlayerStorageSnapshot(value)._tag === 'Valid',
      { message: () => 'Player storage violates persistence invariants' },
    ),
  ) as unknown as Schema.Schema<PlayerStorage>,
  {
    strict: false,
    decode: restorePlayerStorageSlots,
    encode: encodePlayerStorageSlots,
  },
) as unknown as Schema.Schema<PlayerStorage>

const ContainerStorageSchema = Schema.Unknown.pipe(
  Schema.filter(
    (value): value is ContainerStorageSnapshot =>
      validateContainerStorageSnapshot(value)._tag === 'Valid',
    { message: () => 'Container storage violates persistence invariants' },
  ),
) as unknown as Schema.Schema<ContainerStorageSnapshot>

const CropSnapshotSchema = Schema.Unknown.pipe(
  Schema.filter(
    (value): value is CropSnapshot => validateCropSnapshot(value)._tag === 'Valid',
    { message: () => 'Crop snapshot violates persistence invariants' },
  ),
) as unknown as Schema.Schema<CropSnapshot>

const FurnaceStackCountSchema = FiniteNumberSchema.pipe(
  Schema.filter(Number.isInteger, { message: () => 'Furnace stack count must be an integer' }),
  Schema.filter((count) => count > 0, { message: () => 'Furnace stack count must be positive' }),
)

const FurnaceItemStackSchema = Schema.Struct({
  item: Schema.String,
  count: FurnaceStackCountSchema,
}).pipe(
  Schema.filter((stack): stack is ItemStack => {
    try {
      const candidate = stack as ItemStack
      advanceFurnace({
        input: candidate,
        fuel: null,
        output: null,
        cookElapsedSecs: 0,
        burnRemainingSecs: 0,
      }, Number.MIN_VALUE)
      return stack.count <= maxStackCountForItem(candidate.item)
    } catch {
      return false
    }
  }, { message: () => 'Furnace slot violates item stack invariants' }),
) as unknown as Schema.Schema<ItemStack>

const FurnaceElapsedSchema = FiniteNumberSchema.pipe(
  Schema.filter((seconds) => seconds >= 0, {
    message: () => 'Furnace elapsed time must be non-negative',
  }),
)

const FurnaceStateSchema = Schema.Struct({
  input: Schema.NullOr(FurnaceItemStackSchema),
  fuel: Schema.NullOr(FurnaceItemStackSchema),
  output: Schema.NullOr(FurnaceItemStackSchema),
  cookElapsedSecs: FurnaceElapsedSchema,
  burnRemainingSecs: FurnaceElapsedSchema,
}).pipe(
  Schema.filter((value) => {
    try {
      advanceFurnace(value, Number.MIN_VALUE)
      return true
    } catch {
      return false
    }
  }, { message: () => 'Furnace state violates simulation invariants' }),
) as unknown as Schema.Schema<FurnaceState>

const PersistedFurnacesSchema = Schema.Array(Schema.Struct({
  dimension: DimensionSchema,
  position: BlockPositionSchema,
  state: FurnaceStateSchema,
})).pipe(
  Schema.filter((furnaces) => {
    const keys = new Set<string>()
    for (const furnace of furnaces) {
      const key = JSON.stringify([
        furnace.dimension,
        furnace.position.x,
        furnace.position.y,
        furnace.position.z,
      ])
      if (keys.has(key)) return false
      keys.add(key)
    }
    return true
  }, { message: () => 'Furnace positions must be unique within each dimension' }),
)

const PersistedPortalsSchema: Schema.Schema<ReadonlyArray<PersistedPortalState>> = Schema.Array(
  Schema.Struct({
    dimension: DimensionSchema,
    position: BlockPositionSchema,
  }),
)

const PersistedVillagerStateSchema: Schema.Schema<PersistedVillagerState> = Schema.Struct({
  residents: Schema.Array(Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    profession: Schema.Literal('farmer', 'toolsmith'),
    dimension: DimensionSchema,
    feetPosition: PositionSchema,
  })),
  trades: VillagerTradeStateSchema,
})

const PersistedEndStateSchema: Schema.Schema<PersistedEndState> = Schema.Struct({
  frames: Schema.Array(Schema.Struct({
    position: BlockPositionSchema,
    facing: Schema.Literal('north', 'south', 'east', 'west'),
    eye: Schema.Boolean,
  })),
  portalComplete: Schema.Boolean,
  dragon: EnderDragonEncounterSnapshotSchema,
  exitPortalMaterialized: Schema.Boolean,
  dragonEggRewarded: Schema.Boolean,
})

// `exact: true` on every `Schema.optionalWith` below (in place of the plain
// `Schema.optional` this file used before): mc-save 0.3.0's integrity
// checksum canonicalizes the encoded payload and rejects a bare `undefined`
// anywhere in it — it is not one of the supported value kinds (see
// `integrity-canonical.ts`'s `canonicalize`, which throws for anything that
// is not a string/boolean/finite-or-non-finite number/null/plain
// object/array/Uint8Array). Plain `Schema.optional` encodes an ABSENT
// property as an explicit `undefined` key; `exact: true` omits the key
// instead, which is also what `exactOptionalPropertyTypes` already expects
// of every `?:` field in `SessionState`.
const PersistedVehiclesSchema = Schema.optionalWith(
  Schema.Unknown.pipe(
    Schema.filter((value): value is ReadonlyArray<Vehicle> => {
      if (!Array.isArray(value)) return false
      const highestSerial = value.reduce((highest, vehicle) => {
        if (typeof vehicle !== 'object' || vehicle === null) return highest
        const candidate = vehicle as { readonly id?: unknown }
        if (typeof candidate.id !== 'string') return highest
        const match = /^v:(\d+)$/.exec(candidate.id)
        return match === null ? highest : Math.max(highest, Number(match[1]))
      }, -1)
      return validateVehicleSnapshot({ vehicles: value, nextSerial: highestSerial + 1 })._tag === 'Valid'
    }, { message: () => 'Vehicles violate simulation invariants' }),
  ) as unknown as Schema.Schema<ReadonlyArray<Vehicle>>,
  { exact: true },
) as unknown as Schema.Schema<ReadonlyArray<Vehicle> | undefined>

const SessionStateSchema = Schema.Struct({
  seed: Schema.Number,
  dimension: DimensionSchema,
  player: Schema.Struct({
    feetPosition: PositionSchema,
    yawRadians: Schema.Number,
    pitchRadians: Schema.Number,
  }),
  storage: PlayerStorageSchema,
  containerStorage: ContainerStorageSchema,
  vitals: PlayerVitalsSchema,
  time: TimeStateSchema,
  weather: WeatherStateSchema,
  redstone: Schema.Struct({
    levers: Schema.Array(Schema.Struct({
      dimension: DimensionSchema,
      position: PositionSchema,
      active: Schema.Boolean,
    })),
  }),
  furnaces: PersistedFurnacesSchema,
  portals: PersistedPortalsSchema,
  crops: CropSnapshotSchema,
  entities: PersistedEntityRostersSchema,
  villagers: PersistedVillagerStateSchema,
  brewing: BrewingStandStateSchema,
  statusEffects: StatusEffectStateSchema,
  end: PersistedEndStateSchema,
  workstations: Schema.optionalWith(Schema.Struct({
    enchantmentSeed: Schema.Number,
    customNames: Schema.Record({ key: Schema.String, value: Schema.String }),
    enchantedItems: Schema.Record({ key: Schema.String, value: Schema.String }),
    deathDropDimension: Schema.optionalWith(DimensionSchema, { exact: true }),
    respawn: Schema.NullOr(Schema.Struct({
      dimension: Schema.Literal('overworld'),
      position: PositionSchema,
    })),
  }), { exact: true }),
  wither: Schema.optionalWith(WitherRuntimeSnapshotSchema, { exact: true }),
  vehicles: PersistedVehiclesSchema,
  mountedVehicleId: Schema.optionalWith(Schema.NullOr(Schema.String), { exact: true }),
}) as unknown as Schema.Schema<SessionState>

/**
 * The on-disk shape of a `SessionState`, exactly as `SessionStateSchema`'s own
 * encode step produces it (`storage.inventory.slots` and `brewing`'s three
 * optional fields have `undefined` swapped for `null` — see the comments on
 * `PlayerStorageSchema`/`BrewingStandStateSchema` above). Tests that seed a
 * `StoragePort` directly with a hand-built envelope (bypassing `saveSession`,
 * to exercise `loadSession`'s rejection paths in isolation) need this rather
 * than a bare `SessionState`, since `sealSaveEnvelope`'s own integrity
 * checksum rejects raw `undefined` exactly as `saveSession` would have.
 */
export const toStoredSessionState = (state: SessionState): unknown => ({
  ...state,
  storage: encodePlayerStorageSlots(state.storage),
  brewing: encodeBrewingUndefined(state.brewing),
})

export type SessionChunkManifestEntry = {
  readonly dimension: Dimension
  readonly coord: ChunkCoord
  readonly key: string
}

export type DimensionChunk = {
  readonly dimension: Dimension
  readonly chunk: Chunk
}

export type SessionMode = 'survival' | 'creative'

export const MAX_WORLD_NAME_LENGTH = 128

export const normalizeWorldName = (name: string): string | undefined => {
  const normalized = name.trim()
  return normalized.length > 0 && normalized.length <= MAX_WORLD_NAME_LENGTH
    ? normalized
    : undefined
}

export type SessionMetadata = {
  readonly name: string
  readonly mode: SessionMode
}

export type SessionHead = {
  readonly sessionId: string
  readonly revision: string
  readonly metadata: SessionMetadata
  readonly state: SessionState
  readonly chunks: ReadonlyArray<SessionChunkManifestEntry>
}

type SessionHeadEncoded = Omit<SessionHead, 'chunks'> & {
  readonly chunks: ReadonlyArray<{
    readonly dimension: Dimension
    readonly coord: { readonly cx: number; readonly cz: number }
    readonly key: string
  }>
}

const ChunkManifestEntrySchema = Schema.Struct({
  dimension: DimensionSchema,
  coord: Schema.Struct({
    cx: Schema.Number.pipe(Schema.fromBrand(ChunkAxis)),
    cz: Schema.Number.pipe(Schema.fromBrand(ChunkAxis)),
  }),
  key: Schema.String.pipe(Schema.minLength(1)),
})

const SessionHeadSchema: Schema.Schema<SessionHead, SessionHeadEncoded> = Schema.Struct({
  sessionId: Schema.String.pipe(Schema.minLength(1)),
  revision: Schema.String.pipe(Schema.minLength(1)),
  metadata: Schema.Struct({
    name: Schema.String.pipe(
      Schema.filter((name) => normalizeWorldName(name) === name, {
        message: () => `World name must be normalized and at most ${String(MAX_WORLD_NAME_LENGTH)} characters`,
      }),
    ),
    mode: Schema.Literal('survival', 'creative'),
  }),
  state: SessionStateSchema,
  chunks: Schema.Array(ChunkManifestEntrySchema),
})

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : undefined

// mc-save 0.3.0 removed format migrations (org decision, Wave 0: consumers
// require the current format version; no migration shims). A session saved by
// an older build now fails `loadSession` with `SaveDecodeError` instead of
// being transformed forward — see the "rejects a legacy session version"
// coverage below, which replaces the sixteen per-transition migration tests
// this format used to carry (v1 through v16, one per SESSION_FORMAT_VERSION
// bump).
export const SESSION_FORMAT: SaveFormat<SessionHead, SessionHeadEncoded> = defineFormat({
  name: SESSION_FORMAT_NAME,
  version: SESSION_FORMAT_VERSION,
  schema: SessionHeadSchema,
})

type SessionManifestErrorFields = {
  readonly reason: 'duplicate-coordinate' | 'missing-chunk'
  readonly dimension: Dimension
  readonly coord: ChunkCoord
  readonly key: string
}

export type SessionManifestError = YieldableError &
  SessionManifestErrorFields & { readonly _tag: 'SessionManifestError' }

export const SessionManifestError: new (fields: SessionManifestErrorFields) => SessionManifestError =
  Data.TaggedError('SessionManifestError')

export type SessionPersistenceError =
  | StorageError
  | SaveDecodeError
  | InstanceType<typeof SessionManifestError>

export const sessionHeadKey = (sessionId: string): SaveKey =>
  SaveKey(`mc-compose/session/${encodeURIComponent(sessionId)}/head`)

export const sessionChunkKey = (
  sessionId: string,
  revision: string,
  dimension: Dimension,
  coord: ChunkCoord,
): SaveKey =>
  SaveKey(
    `mc-compose/session/${encodeURIComponent(sessionId)}/revision/${encodeURIComponent(revision)}/dimension/${encodeURIComponent(dimension)}/chunk/${String(coord.cx)}/${String(coord.cz)}`,
  )

export const loadSession = (
  sessionId: string,
): Effect.Effect<Option.Option<SessionHead>, SessionPersistenceError, StoragePort> =>
  loadFrom(SESSION_FORMAT, sessionHeadKey(sessionId))

const SESSION_KEY_PREFIX = 'mc-compose/session/'
const SESSION_HEAD_KEY_PATTERN = /^mc-compose\/session\/([^/]+)\/head$/u

const sessionIdFromHeadKey = (key: SaveKey): string | undefined => {
  const match = SESSION_HEAD_KEY_PATTERN.exec(key)
  if (match === null) return undefined

  try {
    const sessionId = decodeURIComponent(match[1]!)
    return sessionHeadKey(sessionId) === key ? sessionId : undefined
  } catch {
    return undefined
  }
}

/** Enumerate valid session heads, ignoring malformed keys and independently corrupted sessions. */
export const listSessions = (): Effect.Effect<
  ReadonlyArray<SessionHead>,
  StorageError,
  StoragePort
> =>
  Effect.gen(function* () {
    const storage = yield* StoragePort
    const keys = yield* storage.keys
    const sessionIds = keys
      .map(sessionIdFromHeadKey)
      .filter((sessionId): sessionId is string => sessionId !== undefined)
      .sort()

    const sessions = yield* Effect.forEach(sessionIds, (sessionId) =>
      loadSession(sessionId).pipe(
        Effect.map(Option.filter((head) => head.sessionId === sessionId)),
        Effect.catchAll(() => Effect.succeed(Option.none<SessionHead>())),
      ),
    )
    return sessions.flatMap(Option.toArray)
  })

/** Remove every record belonging to one encoded session key prefix. */
export const deleteSession = (
  sessionId: string,
): Effect.Effect<void, StorageError, StoragePort> =>
  Effect.gen(function* () {
    const storage = yield* StoragePort
    const prefix = `${SESSION_KEY_PREFIX}${encodeURIComponent(sessionId)}/`
    const keys = yield* storage.keys
    yield* Effect.forEach(
      keys.filter((key) => key.startsWith(prefix)),
      (key) => storage.remove(key),
      { discard: true },
    )
  })

export type SaveSessionInput = {
  readonly sessionId: string
  readonly revision: string
  readonly metadata: SessionMetadata
  readonly state: SessionState
  readonly chunks: ReadonlyArray<DimensionChunk>
}

/** Write revision chunks first, atomically publish their manifest, then collect the old revision. */
export const saveSession = (
  input: SaveSessionInput,
): Effect.Effect<SessionHead, SessionPersistenceError, StoragePort> =>
  Effect.gen(function* () {
    const manifest = input.chunks.map(
      ({ dimension, chunk }): SessionChunkManifestEntry => ({
        dimension,
        coord: chunk.coord,
        key: sessionChunkKey(input.sessionId, input.revision, dimension, chunk.coord),
      }),
    )
    const duplicate = duplicateManifestEntry(manifest)
    if (duplicate !== undefined) {
      return yield* new SessionManifestError({
        reason: 'duplicate-coordinate',
        dimension: duplicate.dimension,
        coord: duplicate.coord,
        key: duplicate.key,
      })
    }

    const storage = yield* StoragePort
    const headKey = sessionHeadKey(input.sessionId)
    const previousSession = yield* loadSession(input.sessionId)
    const previousHeadEnvelope = yield* storage.get(headKey)
    const previousChunkEnvelopes = yield* Effect.forEach(manifest, (entry) =>
      storage.get(SaveKey(entry.key)).pipe(
        Effect.map((envelope) => ({ key: SaveKey(entry.key), envelope })),
      ),
    )

    const nextHead: SessionHead = {
      sessionId: input.sessionId,
      revision: input.revision,
      metadata: input.metadata,
      state: input.state,
      chunks: manifest,
    }

    yield* Effect.gen(function* () {
      yield* Effect.forEach(input.chunks, ({ chunk }, index) =>
        saveTo(CHUNK_FORMAT, SaveKey(manifest[index]!.key), chunk),
      )
      yield* saveTo(SESSION_FORMAT, headKey, nextHead)
    }).pipe(
      Effect.catchAll((saveError) =>
        Effect.gen(function* () {
          yield* (Option.isSome(previousHeadEnvelope)
            ? storage.put(headKey, previousHeadEnvelope.value)
            : storage.remove(headKey)
          ).pipe(Effect.catchAll(() => Effect.void))
          yield* Effect.forEach(
            previousChunkEnvelopes,
            ({ key, envelope }) =>
              (Option.isSome(envelope)
                ? storage.put(key, envelope.value)
                : storage.remove(key)
              ).pipe(Effect.catchAll(() => Effect.void)),
            { discard: true },
          )
          return yield* Effect.fail(saveError)
        }),
      ),
    )

    if (Option.isSome(previousSession)) {
      const retainedKeys = new Set(manifest.map(({ key }) => key))
      yield* Effect.forEach(
        previousSession.value.chunks,
        ({ key }) =>
          retainedKeys.has(key)
            ? Effect.void
            : storage.remove(SaveKey(key)).pipe(Effect.catchAll(() => Effect.void)),
        { discard: true },
      )
    }
    return nextHead
  })

const coordId = (dimension: Dimension, coord: ChunkCoord): string =>
  `${dimension}:${String(coord.cx)},${String(coord.cz)}`

const duplicateManifestEntry = (
  entries: ReadonlyArray<SessionChunkManifestEntry>,
): SessionChunkManifestEntry | undefined => {
  const coords = new Set<string>()
  for (const entry of entries) {
    const id = coordId(entry.dimension, entry.coord)
    if (coords.has(id)) return entry
    coords.add(id)
  }
  return undefined
}

export type LoadedSessionChunks = {
  readonly source: ChunkSource
  readonly chunks: ReadonlyArray<DimensionChunk>
}

/** Validate and preload the manifest so streaming never reaches asynchronous storage. */
export const makeSessionChunkSource = (
  head: SessionHead,
  dimension: Dimension,
  fallback: ChunkSource,
): Effect.Effect<LoadedSessionChunks, SessionPersistenceError, StoragePort> =>
  Effect.gen(function* () {
    const duplicate = duplicateManifestEntry(head.chunks)
    if (duplicate !== undefined) {
      return yield* new SessionManifestError({
        reason: 'duplicate-coordinate',
        dimension: duplicate.dimension,
        coord: duplicate.coord,
        key: duplicate.key,
      })
    }

    const savedChunks = new Map<string, DimensionChunk>()
    for (const entry of head.chunks) {
      const loaded = yield* loadFrom(CHUNK_FORMAT, SaveKey(entry.key))
      if (Option.isNone(loaded)) {
        return yield* new SessionManifestError({
          reason: 'missing-chunk',
          dimension: entry.dimension,
          coord: entry.coord,
          key: entry.key,
        })
      }
      savedChunks.set(coordId(entry.dimension, entry.coord), {
        dimension: entry.dimension,
        chunk: chunkSnapshotOf(loaded.value),
      })
    }

    return {
      source: (coord) => {
        const saved = savedChunks.get(coordId(dimension, coord))
        return saved === undefined
          ? fallback(coord)
          : Effect.sync(() => chunkSnapshotOf(saved.chunk))
      },
      chunks: [...savedChunks.values()].map(({ dimension: savedDimension, chunk }) => ({
        dimension: savedDimension,
        chunk: chunkSnapshotOf(chunk),
      })),
    }
  })

export const snapshotResidentChunks = (
  store: Pick<ChunkStoreApi, 'loadedCoords' | 'snapshot'>,
): Effect.Effect<ReadonlyArray<Chunk>> =>
  Effect.gen(function* () {
    const coords = yield* store.loadedCoords
    const snapshots = yield* Effect.forEach(coords, store.snapshot)
    return snapshots.filter((chunk): chunk is Chunk => chunk !== undefined)
  })
