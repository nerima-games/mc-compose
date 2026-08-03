import { Data, Effect, Option, Schema } from 'effect'
import type { YieldableError } from 'effect/Cause'
import { isValidWitherRuntimeSnapshot, type WitherRuntimeSnapshot } from '../multiplayer-shared/wither-runtime'

import {
  loadFrom,
  SaveKey,
  saveTo,
  StoragePort,
  defineFormat,
  type Migration,
  type MigrationError,
  type SaveDecodeError,
  type StorageError,
} from '@nerima-games/mc-save'
import {
  advanceFurnace,
  INVENTORY_SLOT_COUNT,
  INITIAL_TIME_STATE,
  INITIAL_WEATHER_STATE,
  isValidTimeState,
  isValidWeatherState,
  maxStackCountForItem,
  storageFromInventory,
  validateContainerStorageSnapshot,
  validatePlayerStorageSnapshot,
  validateCropSnapshot,
  type ContainerStorageSnapshot,
  type CropSnapshot,
  type Inventory,
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
  ChunkAxis,
  chunkSnapshotOf,
  type Chunk,
  type ChunkCoord,
  type ChunkSource,
  type ChunkStoreApi,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import {
  emptyVillagerTradeState,
  emptyBrewingStandState,
  emptyStatusEffectState,
  isValidBrewingStandState,
  isValidPlayerVitals,
  isValidStatusEffectState,
  isValidVillagerTradeState,
  decodeEnchantedItem,
  SPAWN_PLAYER_VITALS,
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

const BrewingStandStateSchema = Schema.Unknown.pipe(
  Schema.filter((value): value is BrewingStandState => isValidBrewingStandState(value), {
    message: () => 'Brewing stand state violates gameplay invariants',
  }),
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

const normalizePersistedEntityBehaviour = (kind: string, behaviour: unknown): unknown => {
  if (kind !== 'dropped_item') return behaviour
  const drop = asRecord(behaviour)
  if (drop === undefined) return behaviour
  const { customName: _customName, enchantments: _enchantments, ...base } = drop
  return { ...base, ...persistedItemDropMetadata(drop) }
}

export const persistedItemDropLifetime = (behaviour: unknown): PersistedItemDropLifetime => {
  const elapsedSecs = asRecord(behaviour)?.['elapsedSecs']
  return {
    elapsedSecs: typeof elapsedSecs === 'number' && Number.isFinite(elapsedSecs)
      ? Math.max(0, elapsedSecs)
      : 0,
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
      behaviour: normalizePersistedEntityBehaviour(kind, entity['behaviour']),
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

const PlayerVitalsSchema: Schema.Schema<PlayerVitals> = Schema.Struct({
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
)

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

const PlayerStorageSchema = Schema.Unknown.pipe(
  Schema.filter(
    (value): value is PlayerStorage => validatePlayerStorageSnapshot(value)._tag === 'Valid',
    { message: () => 'Player storage violates persistence invariants' },
  ),
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

const PersistedVehiclesSchema = Schema.optional(
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
  entities: Schema.Unknown as unknown as Schema.Schema<PersistedEntityRosters>,
  villagers: PersistedVillagerStateSchema,
  brewing: BrewingStandStateSchema,
  statusEffects: StatusEffectStateSchema,
  end: PersistedEndStateSchema,
  workstations: Schema.optional(Schema.Struct({
    enchantmentSeed: Schema.Number,
    customNames: Schema.Record({ key: Schema.String, value: Schema.String }),
    enchantedItems: Schema.Record({ key: Schema.String, value: Schema.String }),
    deathDropDimension: Schema.optional(DimensionSchema),
    respawn: Schema.NullOr(Schema.Struct({
      dimension: Schema.Literal('overworld'),
      position: PositionSchema,
    })),
  })),
  wither: Schema.optional(WitherRuntimeSnapshotSchema),
  vehicles: PersistedVehiclesSchema,
  mountedVehicleId: Schema.optional(Schema.NullOr(Schema.String)),
}) as unknown as Schema.Schema<SessionState>

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

const migrateSessionV1ToV2: Migration = {
  from: 1,
  describe: 'add player vitals to the session state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v1 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'vitals')
        ? state
        : { ...state, vitals: { ...SPAWN_PLAYER_VITALS } },
    })
  },
}

const migrateSessionV2ToV3: Migration = {
  from: 2,
  describe: 'add simulation time to the session state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v2 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'time')
        ? state
        : { ...state, time: { ...INITIAL_TIME_STATE } },
    })
  },
}

const migrateSessionV3ToV4: Migration = {
  from: 3,
  describe: 'add weather to the session state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v3 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'weather')
        ? state
        : { ...state, weather: { ...INITIAL_WEATHER_STATE } },
    })
  },
}

const migrateSessionV4ToV5: Migration = {
  from: 4,
  describe: 'assign legacy chunks to the overworld dimension',
  migrate: (payload) => {
    const head = asRecord(payload)
    if (head === undefined || !Array.isArray(head['chunks'])) {
      return Effect.fail('Session v4 payload must contain a chunks array')
    }

    return Effect.succeed({
      ...head,
      chunks: head['chunks'].map((entry) => {
        const chunk = asRecord(entry)
        return chunk === undefined ? entry : { ...chunk, dimension: 'overworld' }
      }),
    })
  },
}

const migrateSessionV5ToV6: Migration = {
  from: 5,
  describe: 'replace the legacy inventory with complete player storage',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    const inventory = asRecord(state?.['inventory'])
    const legacySlots = inventory?.['slots']
    if (
      head === undefined
      || state === undefined
      || !Array.isArray(legacySlots)
      || legacySlots.length > INVENTORY_SLOT_COUNT
    ) {
      return Effect.fail(
        `Session v5 payload must contain an inventory with at most ${String(INVENTORY_SLOT_COUNT)} slots`,
      )
    }

    const slots = Array.from(
      { length: INVENTORY_SLOT_COUNT },
      (_, index) => legacySlots[index],
    )
    const { inventory: _legacyInventory, ...currentState } = state
    return Effect.succeed({
      ...head,
      state: {
        ...currentState,
        storage: storageFromInventory({ slots } as Inventory),
      },
    })
  },
}

const migrateSessionV6ToV7: Migration = {
  from: 6,
  describe: 'add host-owned lever state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v6 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'redstone')
        ? state
        : { ...state, redstone: { levers: [] } },
    })
  },
}

const migrateSessionV7ToV8: Migration = {
  from: 7,
  describe: 'add the world name and game mode',
  migrate: (payload) => {
    const head = asRecord(payload)
    const sessionId = head?.['sessionId']
    const name = typeof sessionId === 'string' ? normalizeWorldName(sessionId) : undefined
    if (head === undefined || typeof sessionId !== 'string' || name === undefined) {
      return Effect.fail('Session v7 payload must contain a valid session id for its world name')
    }

    return Effect.succeed({
      ...head,
      metadata: { name, mode: 'survival' },
    })
  },
}

const migrateSessionV8ToV9: Migration = {
  from: 8,
  describe: 'add host-owned furnace state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v8 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'furnaces')
        ? state
        : { ...state, furnaces: [] },
    })
  },
}

const migrateSessionV9ToV10: Migration = {
  from: 9,
  describe: 'add the portal registry',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v9 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'portals')
        ? state
        : { ...state, portals: [] },
    })
  },
}

const migrateSessionV10ToV11: Migration = {
  from: 10,
  describe: 'add crop simulation state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v10 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'crops')
        ? state
        : { ...state, crops: { crops: [] } },
    })
  },
}

const migrateSessionV11ToV12: Migration = {
  from: 11,
  describe: 'add container storage state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v11 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'containerStorage')
        ? state
        : { ...state, containerStorage: { version: 1, containers: [] } },
    })
  },
}

const migrateSessionV12ToV13: Migration = {
  from: 12,
  describe: 'add dynamic entity roster',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v12 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'entities')
        ? state
        : { ...state, entities: EMPTY_ENTITY_ROSTER },
    })
  },
}

const migrateSessionV13ToV14: Migration = {
  from: 13,
  describe: 'add village residents and trade state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v13 payload must contain an object state')
    }

    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'villagers')
        ? state
        : { ...state, villagers: EMPTY_VILLAGER_STATE },
    })
  },
}

const migrateSessionV14ToV15: Migration = {
  from: 14,
  describe: 'add brewing stand and player status effects',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v14 payload must contain an object state')
    }
    return Effect.succeed({
      ...head,
      state: {
        ...state,
        brewing: Object.prototype.hasOwnProperty.call(state, 'brewing')
          ? state['brewing']
          : emptyBrewingStandState(),
        statusEffects: Object.prototype.hasOwnProperty.call(state, 'statusEffects')
          ? state['statusEffects']
          : emptyStatusEffectState(),
      },
    })
  },
}

const migrateSessionV15ToV16: Migration = {
  from: 15,
  describe: 'add End portal and dragon encounter state',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v15 payload must contain an object state')
    }
    return Effect.succeed({
      ...head,
      state: Object.prototype.hasOwnProperty.call(state, 'end')
        ? state
        : { ...state, end: EMPTY_END_STATE },
    })
  },
}

const migrateSessionV16ToV17: Migration = {
  from: 16,
  describe: 'scope dynamic entity rosters by dimension',
  migrate: (payload) => {
    const head = asRecord(payload)
    const state = asRecord(head?.['state'])
    if (head === undefined || state === undefined) {
      return Effect.fail('Session v16 payload must contain an object state')
    }
    const dimension = state['dimension']
    const activeDimension: Dimension = dimension === 'nether' || dimension === 'end'
      ? dimension
      : 'overworld'
    return Effect.succeed({
      ...head,
      state: {
        ...state,
        entities: {
          ...EMPTY_ENTITY_ROSTERS,
          [activeDimension]: normalizePersistedEntityRoster(state['entities']),
        },
      },
    })
  },
}

export const SESSION_FORMAT = defineFormat({
  name: SESSION_FORMAT_NAME,
  version: SESSION_FORMAT_VERSION,
  schema: SessionHeadSchema,
  migrations: [
    migrateSessionV1ToV2,
    migrateSessionV2ToV3,
    migrateSessionV3ToV4,
    migrateSessionV4ToV5,
    migrateSessionV5ToV6,
    migrateSessionV6ToV7,
    migrateSessionV7ToV8,
    migrateSessionV8ToV9,
    migrateSessionV9ToV10,
    migrateSessionV10ToV11,
    migrateSessionV11ToV12,
    migrateSessionV12ToV13,
    migrateSessionV13ToV14,
    migrateSessionV14ToV15,
    migrateSessionV15ToV16,
    migrateSessionV16ToV17,
  ],
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
  | MigrationError
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
  loadFrom(SESSION_FORMAT, sessionHeadKey(sessionId)).pipe(
    Effect.map(Option.map((head) => ({
      ...head,
      state: {
        ...head.state,
        entities: normalizePersistedEntityRosters(head.state.entities),
      },
    }))),
  )

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
