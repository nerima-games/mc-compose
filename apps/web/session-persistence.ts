import { Data, Effect, Option, Schema } from 'effect'

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
  INITIAL_TIME_STATE,
  INITIAL_WEATHER_STATE,
  isValidTimeState,
  isValidWeatherState,
  type TimeState,
  type WeatherState,
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
  isValidPlayerVitals,
  SPAWN_PLAYER_VITALS,
  type isPlaceableItem,
  type PlayerVitals,
} from '@nerima-games/mx-gameplay'

export const SESSION_FORMAT_NAME = '@nerima-games/mc-compose/session'

export type SessionPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

const PositionSchema: Schema.Schema<SessionPosition> = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  z: Schema.Number,
})

type GameplayItemType = Parameters<typeof isPlaceableItem>[0]

const exhaustiveItemTypes = <const Items extends ReadonlyArray<GameplayItemType>>(
  ...items: [GameplayItemType] extends [Items[number]] ? Items : never
): Items => items

// mx-gameplay exposes the item union through its public API, but not its runtime roster.
const SESSION_ITEM_TYPES = exhaustiveItemTypes(
  'stone',
  'cobblestone',
  'dirt',
  'grass_block',
  'sand',
  'gravel',
  'oak_log',
  'oak_planks',
  'oak_leaves',
  'glass',
  'torch',
  'glowstone',
  'piston',
  'stick',
  'glowstone_dust',
  'wooden_pickaxe',
  'coal',
  'iron_ingot',
  'flint',
  'gunpowder',
  'blaze_powder',
  'flint_and_steel',
  'fire_charge',
  'granite',
  'diorite',
  'andesite',
  'deepslate',
  'obsidian',
  'smooth_basalt',
  'calcite',
  'amethyst_block',
  'sandstone',
  'prismarine',
  'soul_sand',
  'coal_block',
  'iron_block',
  'gold_block',
  'diamond_block',
  'redstone_block',
  'lapis_block',
  'emerald_block',
  'redstone_torch',
  'lever',
  'stone_button',
  'repeater',
  'redstone_lamp',
  'observer',
  'comparator',
  'dispenser',
  'hopper',
  'end_stone',
  'end_portal_frame',
  'end_portal_frame_filled',
  'chorus_flower',
  'chorus_plant',
  'dragon_egg',
  'end_crystal',
  'end_rod',
  'end_stone_bricks',
  'ender_chest',
  'purpur_block',
  'purpur_pillar',
  'purpur_slab',
  'purpur_stairs',
  'shulker_box',
  'crafting_table',
  'furnace',
  'chest',
  'door',
  'oak_stairs',
  'anvil',
  'cauldron',
  'bed',
  'enchanting_table',
  'brewing_stand',
  'tnt',
  'nether_brick',
  'netherrack',
  'raw_iron',
  'raw_gold',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone_dust',
  'amethyst_shard',
  'wheat_seeds',
  'potato',
  'nether_wart',
  'ladder',
  'kelp',
  'seagrass',
  'rail',
  'powered_rail',
  'pressure_plate',
  'stone_slab',
  'string',
  'snowball',
)

export type SessionInventorySlot =
  | {
      readonly item: GameplayItemType
      readonly count: number
    }
  | undefined

const InventoryItemSchema: Schema.Schema<GameplayItemType> = Schema.Literal(...SESSION_ITEM_TYPES)

const InventorySlotSchema: Schema.Schema<SessionInventorySlot> = Schema.Union(
  Schema.Struct({
    item: InventoryItemSchema,
    count: Schema.Number.pipe(Schema.int(), Schema.positive()),
  }),
  Schema.Undefined,
)

export type SessionState = {
  readonly seed: number
  readonly dimension: Dimension
  readonly player: {
    readonly feetPosition: SessionPosition
    readonly yawRadians: number
    readonly pitchRadians: number
  }
  readonly inventory: {
    readonly slots: ReadonlyArray<SessionInventorySlot>
  }
  readonly vitals: PlayerVitals
  readonly time: TimeState
  readonly weather: WeatherState
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

const SessionStateSchema: Schema.Schema<SessionState> = Schema.Struct({
  seed: Schema.Number,
  dimension: DimensionSchema,
  player: Schema.Struct({
    feetPosition: PositionSchema,
    yawRadians: Schema.Number,
    pitchRadians: Schema.Number,
  }),
  inventory: Schema.Struct({ slots: Schema.Array(InventorySlotSchema) }),
  vitals: PlayerVitalsSchema,
  time: TimeStateSchema,
  weather: WeatherStateSchema,
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

export type SessionHead = {
  readonly sessionId: string
  readonly revision: string
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

export const SESSION_FORMAT = defineFormat({
  name: SESSION_FORMAT_NAME,
  version: 5,
  schema: SessionHeadSchema,
  migrations: [
    migrateSessionV1ToV2,
    migrateSessionV2ToV3,
    migrateSessionV3ToV4,
    migrateSessionV4ToV5,
  ],
})

export class SessionManifestError extends Data.TaggedError('SessionManifestError')<{
  readonly reason: 'duplicate-coordinate' | 'missing-chunk'
  readonly dimension: Dimension
  readonly coord: ChunkCoord
  readonly key: string
}> {}

export type SessionPersistenceError =
  | StorageError
  | SaveDecodeError
  | MigrationError
  | SessionManifestError

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

export type SaveSessionInput = {
  readonly sessionId: string
  readonly revision: string
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
