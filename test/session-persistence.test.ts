import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'

import {
  SaveKey,
  StorageError,
  StoragePort,
  type SaveEnvelope,
  type StorageService,
} from '@nerima-games/mc-save'
import {
  FLINT_AND_STEEL_MAX_DURABILITY,
  INITIAL_TIME_STATE,
  INITIAL_WEATHER_STATE,
  INVENTORY_SLOT_COUNT,
  emptyFurnaceState,
  equipFromInventory,
  itemStack,
  storageFromInventory,
  OccupantId,
  VehicleId,
  type CropLocation,
  type Inventory,
} from '@nerima-games/mc-sim'
import {
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  type Chunk,
  type ChunkSource,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import {
  SPAWN_PLAYER_VITALS,
  emptyBrewingStandState,
  emptyStatusEffectState,
} from '@nerima-games/mx-gameplay'

import {
  EMPTY_END_STATE,
  EMPTY_ENTITY_ROSTER,
  EMPTY_ENTITY_ROSTERS,
  EMPTY_VILLAGER_STATE,
  SESSION_FORMAT_NAME,
  SESSION_FORMAT_VERSION,
  deleteSession,
  listSessions,
  loadSession,
  makeSessionChunkSource,
  normalizePersistedEntityRoster,
  normalizePersistedEntityRosters,
  persistedItemDropLifetime,
  persistedItemDropMetadata,
  saveSession as persistSession,
  sessionChunkKey,
  sessionHeadKey,
  type DimensionChunk,
  type SaveSessionInput,
  type SessionMetadata,
  type SessionState,
} from '../apps/web/session-persistence'

const legacySessionState = (seed: number) => ({
  seed,
  dimension: 'overworld' as const,
  player: {
    feetPosition: { x: 1.5, y: 64, z: -2.5 },
    yawRadians: 0.25,
    pitchRadians: -0.1,
  },
  inventory: { slots: [{ item: 'stone', count: 12 }, undefined] },
  vitals: {
    ...SPAWN_PLAYER_VITALS,
    healthPoints: 13,
    hungerPoints: 17,
    saturation: 3,
    exhaustion: 0.5,
    totalExperience: 37,
    lastDamageCause: 'fall',
  },
  time: { ticks: 12_345, dayLengthTicks: 24_000 },
  weather: { weather: 'rain' as const, remainingSecs: 123.5 },
})

const sessionState = (seed: number): SessionState => {
  const { inventory, ...state } = legacySessionState(seed)
  return {
    ...state,
    storage: storageFromInventory({
      slots: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => inventory.slots[index]),
    } as Inventory),
    containerStorage: {
      version: 2,
      containers: [{
        id: 'overworld:4,65,-2',
        kind: 'chest',
        slots: Array.from(
          { length: 27 },
          (_, index) => index === 0
          ? { ...itemStack('stone', 12), durability: null }
            : null,
        ),
      }],
    },
    redstone: {
      levers: [{
        dimension: 'nether',
        position: { x: -3, y: 71, z: 12 },
        active: true,
      }],
    },
    furnaces: [],
    portals: [{
      dimension: 'overworld',
      position: { x: 10, y: 64, z: -7 },
    }],
    crops: {
      crops: [{
        dimension: 'overworld',
        position: { x: 4, y: 65, z: -2 } as CropLocation['position'],
        crop: 'potato_crop',
        growthSecs: 123,
      }],
    },
    entities: EMPTY_ENTITY_ROSTERS,
    villagers: EMPTY_VILLAGER_STATE,
    brewing: emptyBrewingStandState(),
    statusEffects: emptyStatusEffectState(),
    end: EMPTY_END_STATE,
    wither: {
      nextWitherId: 1,
      nextSkullId: 0,
      withers: [{
        id: 'wither-1',
        dimension: 'overworld',
        snapshot: {
          kind: 'wither',
          version: 1,
          state: {
            phase: 'charging',
            healthPoints: 300,
            chargeRemainingSecs: 4,
            feetPosition: { x: 2.5, y: 66, z: -3.5 },
            velocity: { x: 0, y: 0, z: 0 },
          },
        },
        rangedCooldownSecs: 2,
        meleeCooldownSecs: 1,
        shotsFired: 0,
      }],
      skulls: [],
    },
  }
}

const chunk = (cx: number, cz: number, marker: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(CHUNK_VOLUME).fill(marker),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS'),
})

const dimensionChunk = (
  dimension: Dimension,
  cx: number,
  cz: number,
  marker: number,
): DimensionChunk => ({ dimension, chunk: chunk(cx, cz, marker) })

describe('dynamic entity persistence', () => {
  it('reads item-drop elapsed time and defaults legacy saves to zero', () => {
    const roster = normalizePersistedEntityRoster({
      entities: [{
        id: 'drop-3',
        kind: 'dropped_item',
        feetPosition: { x: 1.5, y: 64, z: -2.5 },
        healthPoints: 1,
        behaviour: { item: 'stone', count: 2, elapsedSecs: 123.5 },
      }],
      nextSerial: 4,
    })

    expect(persistedItemDropLifetime(roster.entities[0]?.behaviour)).toEqual({
      elapsedSecs: 123.5,
    })
    expect(persistedItemDropLifetime({ item: 'stone', count: 2 })).toEqual({ elapsedSecs: 0 })
    expect(persistedItemDropLifetime({ elapsedSecs: Number.POSITIVE_INFINITY })).toEqual({
      elapsedSecs: 0,
    })
  })

  it('validates item-drop metadata and omits malformed persisted values', () => {
    expect(persistedItemDropMetadata({
      item: 'diamond_pickaxe',
      durability: { current: 1500, max: 1561 },
      customName: 'Fortune Miner',
      enchantments: [{ id: 'fortune', level: 3 }],
    })).toEqual({
      customName: 'Fortune Miner',
      enchantments: [{ id: 'fortune', level: 3 }],
    })
    expect(persistedItemDropMetadata({
      item: 'stone',
      durability: null,
      customName: ' ',
      enchantments: [{ id: 'fortune', level: 99 }],
    })).toEqual({})
    expect(persistedItemDropMetadata({ item: 'stone', durability: null })).toEqual({})
  })

  it('keeps valid entity rows and sanitizes invalid roster data', () => {
    expect(normalizePersistedEntityRoster({
      entities: [
        {
          id: 'creeper-7',
          kind: 'creeper',
          feetPosition: { x: 1.5, y: 64, z: -2.5 },
          healthPoints: 13,
          behaviour: { fuse: 'dormant' },
        },
        {
          id: 'broken',
          kind: 'creeper',
          feetPosition: { x: Number.POSITIVE_INFINITY, y: 64, z: 0 },
          healthPoints: 20,
          behaviour: null,
        },
        {
          id: 'blank-kind',
          kind: ' ',
          feetPosition: { x: 0, y: 64, z: 0 },
          healthPoints: 20,
          behaviour: null,
        },
      ],
      nextSerial: 8.9,
    })).toEqual({
      entities: [{
        id: 'creeper-7',
        kind: 'creeper',
        feetPosition: { x: 1.5, y: 64, z: -2.5 },
        healthPoints: 13,
        behaviour: { fuse: 'dormant' },
      }],
      nextSerial: 8,
    })
    expect(normalizePersistedEntityRoster(null)).toEqual(EMPTY_ENTITY_ROSTER)
  })

  it('normalizes each dimension roster independently', () => {
    expect(normalizePersistedEntityRosters({
      overworld: { entities: [], nextSerial: 3 },
      nether: { entities: [], nextSerial: 7.8 },
      end: null,
    })).toEqual({
      overworld: { entities: [], nextSerial: 3 },
      nether: { entities: [], nextSerial: 7 },
      end: EMPTY_ENTITY_ROSTER,
    })
  })
})

const defaultMetadata: SessionMetadata = { name: 'Test World', mode: 'survival' }
const saveSession = (
  input: Omit<SaveSessionInput, 'metadata'> & { readonly metadata?: SessionMetadata },
) => persistSession({ ...input, metadata: input.metadata ?? defaultMetadata })

type ControlledStorage = {
  readonly layer: Layer.Layer<StoragePort>
  failChunkKey: string | undefined
  failNextHeadWrite: boolean
  failChunkRemoves: boolean
  chunkWriteCount: number
  readonly keys: ReadonlyArray<string>
  readonly envelope: (key: string) => SaveEnvelope | undefined
  readonly setEnvelope: (key: string, envelope: SaveEnvelope) => void
}

const controlledStorage = (): ControlledStorage => {
  const entries = new Map<string, SaveEnvelope>()
  const state = {
    failChunkKey: undefined as string | undefined,
    failNextHeadWrite: false,
    failChunkRemoves: false,
    chunkWriteCount: 0,
  }
  const storage: StorageService = {
    get: (key) => Effect.succeed(Option.fromNullable(entries.get(key))),
    put: (key, envelope) =>
      Effect.suspend(() => {
        if (String(key).includes('/chunk/')) state.chunkWriteCount += 1
        if (state.failChunkKey === String(key)) {
          return Effect.fail(new StorageError({ operation: 'put', key }))
        }
        if (state.failNextHeadWrite && String(key).endsWith('/head')) {
          state.failNextHeadWrite = false
          // Model an adapter that reports failure after partially mutating its backing store.
          entries.set(key, envelope)
          return Effect.fail(new StorageError({ operation: 'put', key }))
        }
        entries.set(key, envelope)
        return Effect.void
      }),
    remove: (key) =>
      Effect.suspend(() => {
        if (state.failChunkRemoves && String(key).includes('/chunk/')) {
          return Effect.fail(new StorageError({ operation: 'remove', key }))
        }
        entries.delete(key)
        return Effect.void
      }),
    commitBatch: (mutations) =>
      Effect.suspend(() => {
        const next = new Map(entries)
        for (const mutation of mutations) {
          const key = mutation.key
          if (mutation._tag === 'Put') {
            if (String(key).includes('/chunk/')) state.chunkWriteCount += 1
            if (state.failChunkKey === String(key)) {
              return Effect.fail(new StorageError({ operation: 'commitBatch', key }))
            }
            if (state.failNextHeadWrite && String(key).endsWith('/head')) {
              state.failNextHeadWrite = false
              return Effect.fail(new StorageError({ operation: 'commitBatch', key }))
            }
            next.set(key, mutation.envelope)
          } else {
            if (state.failChunkRemoves && String(key).includes('/chunk/')) {
              return Effect.fail(new StorageError({ operation: 'commitBatch', key }))
            }
            next.delete(key)
          }
        }
        entries.clear()
        for (const [key, envelope] of next) entries.set(key, envelope)
        return Effect.void
      }),
    readBatch: (keys) =>
      Effect.sync(() => keys.map((key) => Option.fromNullable(entries.get(key)))),
    keys: Effect.sync(() => [...entries.keys()].map(SaveKey)),
  }
  return {
    layer: Layer.succeed(StoragePort, storage),
    get failChunkKey() {
      return state.failChunkKey
    },
    set failChunkKey(value) {
      state.failChunkKey = value
    },
    get failNextHeadWrite() {
      return state.failNextHeadWrite
    },
    set failNextHeadWrite(value) {
      state.failNextHeadWrite = value
    },
    get failChunkRemoves() {
      return state.failChunkRemoves
    },
    set failChunkRemoves(value) {
      state.failChunkRemoves = value
    },
    get chunkWriteCount() {
      return state.chunkWriteCount
    },
    set chunkWriteCount(value) {
      state.chunkWriteCount = value
    },
    get keys() {
      return [...entries.keys()]
    },
    envelope: (key) => entries.get(key),
    setEnvelope: (key, envelope) => entries.set(key, envelope),
  }
}

describe('session persistence', () => {
  it.effect('round-trips session state and its revision manifest', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      const state = {
        ...sessionState(42),
        entities: {
          ...EMPTY_ENTITY_ROSTERS,
          overworld: {
            entities: [{
              id: 'drop-3',
              kind: 'dropped_item',
              feetPosition: { x: 1.5, y: 64, z: -2.5 },
              healthPoints: 1,
              behaviour: {
                item: 'diamond_pickaxe',
                count: 1,
                durability: { current: 1500, max: 1561 },
                elapsedSecs: 123.5,
                customName: 'Fortune Miner',
                enchantments: [{ id: 'fortune', level: 3 }],
              },
            }],
            nextSerial: 4,
          },
        },
        workstations: {
          enchantmentSeed: 7,
          customNames: {},
          enchantedItems: {},
          deathDropDimension: 'nether' as const,
          respawn: null,
        },
        vehicles: [{
          id: VehicleId('v:7'),
          type: 'boat' as const,
          dimension: 'overworld' as const,
          position: { x: 4.5, y: 65, z: -2.5 },
          velocity: { x: 0.25, y: 0, z: -0.5 },
          yawRadians: 1.25,
          occupant: OccupantId('local-player'),
        }],
        mountedVehicleId: 'v:7',
      }
      const saved = yield* saveSession({
        sessionId: 'primary world',
        revision: 'r1',
        metadata: { name: 'Primary / 世界', mode: 'creative' },
        state,
        chunks: [dimensionChunk('overworld', 0, 0, 3), dimensionChunk('overworld', -1, 2, 7)],
      })
      const loaded = yield* loadSession('primary world')

      expect(Option.getOrThrow(loaded)).toEqual(saved)
      expect(saved.metadata).toEqual({ name: 'Primary / 世界', mode: 'creative' })
      expect(saved.state.vitals).toEqual(sessionState(42).vitals)
      expect(saved.state.time).toEqual(sessionState(42).time)
      expect(saved.state.weather).toEqual(sessionState(42).weather)
      expect(saved.state.redstone).toEqual(sessionState(42).redstone)
      expect(saved.state.containerStorage).toEqual(sessionState(42).containerStorage)
      expect(saved.state.portals).toEqual(sessionState(42).portals)
      expect(saved.state.crops).toEqual(sessionState(42).crops)
      expect(persistedItemDropLifetime(
        Option.getOrThrow(loaded).state.entities.overworld.entities[0]?.behaviour,
      )).toEqual({ elapsedSecs: 123.5 })
      expect(saved.state.workstations?.deathDropDimension).toBe('nether')
      expect(saved.state.vehicles?.[0]?.occupant).toBe(OccupantId('local-player'))
      expect(saved.state.mountedVehicleId).toBe('v:7')
      expect(saved.chunks.map(({ coord }) => coord)).toEqual([chunkCoord(0, 0), chunkCoord(-1, 2)])
      expect(storage.envelope(sessionHeadKey('primary world'))).toMatchObject({
        format: SESSION_FORMAT_NAME,
        version: 17,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects malformed persisted Wither snapshots', () => {
    const storage = controlledStorage()
    const sessionId = 'invalid-wither-snapshot'
    const state = sessionState(42)
    const wither = state.wither
    if (wither === undefined) throw new Error('Session fixture must include a Wither runtime snapshot')

    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 17,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: {
          ...state,
          wither: {
            ...wither,
            withers: [{ ...wither.withers[0]!, rangedCooldownSecs: -1 }],
          },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 17,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects malformed direct gameplay snapshots', () => {
    const storage = controlledStorage()
    const state = sessionState(42)
    const invalidStates = [
      { ...state, brewing: { ...state.brewing, fuelUnits: -1 } },
      {
        ...state,
        statusEffects: {
          effects: [{ type: 'speed', remainingSecs: Number.POSITIVE_INFINITY, pulseClockSecs: 0 }],
        },
      },
      {
        ...state,
        villagers: {
          ...state.villagers,
          residents: [{
            id: '',
            profession: 'farmer',
            dimension: 'overworld',
            feetPosition: { x: 0, y: 64, z: 0 },
          }],
        },
      },
    ]

    for (const [index, invalidState] of invalidStates.entries()) {
      const sessionId = `invalid-gameplay-snapshot-${String(index)}`
      storage.setEnvelope(sessionHeadKey(sessionId), {
        format: SESSION_FORMAT_NAME,
        version: 17,
        payload: {
          sessionId,
          revision: 'r1',
          metadata: defaultMetadata,
          state: invalidState,
          chunks: [],
        },
      })
    }

    return Effect.gen(function* () {
      for (const index of invalidStates.keys()) {
        const error = yield* Effect.flip(loadSession(`invalid-gameplay-snapshot-${String(index)}`))
        expect(error).toMatchObject({ _tag: 'SaveDecodeError' })
      }
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v8 session with an absent furnace registry', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v8')
    const { furnaces: _furnaces, ...v8State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 8,
      payload: {
        sessionId: 'legacy-v8',
        revision: 'r1',
        metadata: defaultMetadata,
        state: v8State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v8'))

      expect(loaded.state.furnaces).toEqual([])
      expect(storage.envelope(key)?.version).toBe(8)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v9 session with an absent portal registry', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v9')
    const { portals: _portals, ...v9State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 9,
      payload: {
        sessionId: 'legacy-v9',
        revision: 'r1',
        metadata: defaultMetadata,
        state: v9State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v9'))

      expect(loaded.state.portals).toEqual([])
      expect(storage.envelope(key)?.version).toBe(9)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v10 session with an absent crop registry', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v10')
    const { crops: _crops, ...v10State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 10,
      payload: {
        sessionId: 'legacy-v10',
        revision: 'r1',
        metadata: defaultMetadata,
        state: v10State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v10'))

      expect(loaded.state.crops).toEqual({ crops: [] })
      expect(storage.envelope(key)?.version).toBe(10)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v11 session with absent container storage', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v11')
    const { containerStorage: _containerStorage, ...v11State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 11,
      payload: {
        sessionId: 'legacy-v11',
        revision: 'r1',
        metadata: defaultMetadata,
        state: v11State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v11'))

      expect(loaded.state.containerStorage).toEqual({ version: 2, containers: [] })
      expect(storage.envelope(key)?.version).toBe(11)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v12 session with an absent dynamic entity roster', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v12')
    const { entities: _entities, ...v12State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 12,
      payload: {
        sessionId: 'legacy-v12',
        revision: 'r1',
        metadata: defaultMetadata,
        state: v12State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v12'))

      expect(loaded.state.entities).toEqual(EMPTY_ENTITY_ROSTERS)
      expect(storage.envelope(key)?.version).toBe(12)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a v16 entity roster into its active dimension', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v16-entities')
    const entityRoster = {
      entities: [{
        id: 'blaze-3',
        kind: 'blaze',
        feetPosition: { x: 2.5, y: 70, z: -4.5 },
        healthPoints: 20,
        behaviour: { phase: 'idle' },
      }],
      nextSerial: 4,
    }
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 16,
      payload: {
        sessionId: 'legacy-v16-entities',
        revision: 'r1',
        metadata: defaultMetadata,
        state: { ...sessionState(42), dimension: 'nether', entities: entityRoster },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v16-entities'))

      expect(loaded.state.entities).toEqual({
        overworld: EMPTY_ENTITY_ROSTER,
        nether: entityRoster,
        end: EMPTY_ENTITY_ROSTER,
      })
      expect(storage.envelope(key)?.version).toBe(16)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('normalizes malformed entity rosters during current session decode', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('current-entity-roster')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: SESSION_FORMAT_VERSION,
      payload: {
        sessionId: 'current-entity-roster',
        revision: 'r1',
        metadata: defaultMetadata,
        state: {
          ...sessionState(42),
          entities: {
            overworld: {
              entities: [
                {
                  id: 'zombie-1',
                  kind: 'zombie',
                  feetPosition: { x: 1, y: 65, z: -2 },
                  healthPoints: 20,
                  behaviour: { target: 'local-player' },
                },
                { id: 'broken', kind: 'zombie' },
              ],
              nextSerial: 3.7,
            },
            nether: null,
            end: { entities: [], nextSerial: -4 },
          },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('current-entity-roster'))

      expect(loaded.state.entities).toEqual({
        overworld: {
          entities: [{
            id: 'zombie-1',
            kind: 'zombie',
            feetPosition: { x: 1, y: 65, z: -2 },
            healthPoints: 20,
            behaviour: { target: 'local-player' },
          }],
          nextSerial: 3,
        },
        nether: EMPTY_ENTITY_ROSTER,
        end: { entities: [], nextSerial: 0 },
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects v11 container storage explicitly set to undefined', () => {
    const storage = controlledStorage()
    const sessionId = 'undefined-v11-container-storage'
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 11,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: { ...sessionState(42), containerStorage: undefined },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 11,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects invalid persisted container storage', () => {
    const storage = controlledStorage()
    const sessionId = 'invalid-container-storage'
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 11,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: {
          ...sessionState(42),
          containerStorage: {
            version: 2,
            containers: [{ id: '', kind: 'chest', slots: [] }],
          },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 11,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a v9 portal registry explicitly set to undefined', () => {
    const storage = controlledStorage()
    const sessionId = 'undefined-v9-portals'
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 9,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: { ...sessionState(42), portals: undefined },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 9,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects invalid persisted portal dimensions and coordinates', () => {
    const storage = controlledStorage()
    const invalidPortals = [
      { dimension: 'moon', position: { x: 1, y: 64, z: 2 } },
      { dimension: 'overworld', position: { x: 1.5, y: 64, z: 2 } },
      { dimension: 'overworld', position: { x: 1, y: Number.POSITIVE_INFINITY, z: 2 } },
    ]

    for (const [index, portal] of invalidPortals.entries()) {
      const sessionId = `invalid-portal-${String(index)}`
      storage.setEnvelope(sessionHeadKey(sessionId), {
        format: SESSION_FORMAT_NAME,
        version: 10,
        payload: {
          sessionId,
          revision: 'r1',
          metadata: defaultMetadata,
          state: { ...sessionState(index), portals: [portal] },
          chunks: [],
        },
      })
    }

    return Effect.gen(function* () {
      for (const index of invalidPortals.keys()) {
        const error = yield* Effect.flip(loadSession(`invalid-portal-${String(index)}`))
        expect(error).toMatchObject({
          _tag: 'SaveDecodeError',
          format: SESSION_FORMAT_NAME,
          version: 10,
        })
      }
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects invalid persisted crop snapshots', () => {
    const storage = controlledStorage()
    const invalidCrops = [
      [{
        dimension: 'moon',
        position: { x: 1, y: 64, z: 2 },
        crop: 'potato_crop',
        growthSecs: 1,
      }],
      [{
        dimension: 'overworld',
        position: { x: 1.5, y: 64, z: 2 },
        crop: 'potato_crop',
        growthSecs: 1,
      }],
      [{
        dimension: 'overworld',
        position: { x: 1, y: 64, z: 2 },
        crop: 'potato_crop',
        growthSecs: -1,
      }],
    ]

    for (const [index, crops] of invalidCrops.entries()) {
      const sessionId = `invalid-crops-${String(index)}`
      storage.setEnvelope(sessionHeadKey(sessionId), {
        format: SESSION_FORMAT_NAME,
        version: 11,
        payload: {
          sessionId,
          revision: 'r1',
          metadata: defaultMetadata,
          state: { ...sessionState(index), crops: { crops } },
          chunks: [],
        },
      })
    }

    return Effect.gen(function* () {
      for (const index of invalidCrops.keys()) {
        const error = yield* Effect.flip(loadSession(`invalid-crops-${String(index)}`))
        expect(error).toMatchObject({
          _tag: 'SaveDecodeError',
          format: SESSION_FORMAT_NAME,
          version: 11,
        })
      }
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects session envelopes from a future format version', () => {
    const storage = controlledStorage()
    const sessionId = 'future-version'
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 18,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: sessionState(42),
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 18,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects invalid persisted furnace states', () => {
    const storage = controlledStorage()
    const invalidStates = [
      {
        input: { item: 'raw_iron', count: 0 },
        fuel: null,
        output: null,
        cookElapsedSecs: 0,
        burnRemainingSecs: 0,
      },
      {
        input: { item: 'item_from_an_unknown_build', count: 1 },
        fuel: null,
        output: null,
        cookElapsedSecs: 0,
        burnRemainingSecs: 0,
      },
      {
        input: null,
        fuel: null,
        output: null,
        cookElapsedSecs: Number.POSITIVE_INFINITY,
        burnRemainingSecs: 0,
      },
      {
        input: null,
        fuel: null,
        output: null,
        cookElapsedSecs: 0,
        burnRemainingSecs: -1,
      },
    ]

    for (const [index, state] of invalidStates.entries()) {
      const sessionId = `invalid-furnace-${String(index)}`
      storage.setEnvelope(sessionHeadKey(sessionId), {
        format: SESSION_FORMAT_NAME,
        version: 9,
        payload: {
          sessionId,
          revision: 'r1',
          metadata: defaultMetadata,
          state: {
            ...sessionState(index),
            furnaces: [{
              dimension: 'overworld',
              position: { x: 1, y: 64, z: 2 },
              state,
            }],
          },
          chunks: [],
        },
      })
    }

    return Effect.gen(function* () {
      for (const index of invalidStates.keys()) {
        const error = yield* Effect.flip(loadSession(`invalid-furnace-${String(index)}`))
        expect(error).toMatchObject({
          _tag: 'SaveDecodeError',
          format: SESSION_FORMAT_NAME,
          version: 9,
        })
      }
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects fractional persisted furnace coordinates', () => {
    const storage = controlledStorage()
    const sessionId = 'fractional-furnace-coordinate'
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 9,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: {
          ...sessionState(42),
          furnaces: [{
            dimension: 'overworld',
            position: { x: 1.5, y: 64, z: 2 },
            state: emptyFurnaceState(),
          }],
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 9,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects duplicate persisted furnace positions within a dimension', () => {
    const storage = controlledStorage()
    const sessionId = 'duplicate-furnace-position'
    const furnace = {
      dimension: 'overworld' as const,
      position: { x: 1, y: 64, z: 2 },
      state: emptyFurnaceState(),
    }
    storage.setEnvelope(sessionHeadKey(sessionId), {
      format: SESSION_FORMAT_NAME,
      version: 9,
      payload: {
        sessionId,
        revision: 'r1',
        metadata: defaultMetadata,
        state: { ...sessionState(42), furnaces: [furnace, furnace] },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession(sessionId))
      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 9,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects v8 session metadata with a non-normalized world name', () => {
    const storage = controlledStorage()
    const invalidNames = ['', '   ', ' World ', 'w'.repeat(129)]

    for (const [index, name] of invalidNames.entries()) {
      const sessionId = `invalid-metadata-${String(index)}`
      storage.setEnvelope(sessionHeadKey(sessionId), {
        format: SESSION_FORMAT_NAME,
        version: 8,
        payload: {
          sessionId,
          revision: 'r1',
          metadata: { name, mode: 'survival' },
          state: sessionState(index),
          chunks: [],
        },
      })
    }

    return Effect.gen(function* () {
      for (const index of invalidNames.keys()) {
        const error = yield* Effect.flip(loadSession(`invalid-metadata-${String(index)}`))
        expect(error).toMatchObject({
          _tag: 'SaveDecodeError',
          format: SESSION_FORMAT_NAME,
          version: 8,
        })
      }
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('lists only valid canonical session heads in lexical session id order', () => {
    const storage = controlledStorage()
    const specialSessionId = 'world / %?'
    const oversizedLegacySessionId = 'w'.repeat(129)

    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: specialSessionId,
        revision: 'r1',
        state: sessionState(3),
        chunks: [],
      })
      yield* saveSession({
        sessionId: 'alpha',
        revision: 'r2',
        metadata: { name: 'Alpha Display', mode: 'creative' },
        state: sessionState(1),
        chunks: [],
      })
      storage.setEnvelope(sessionHeadKey('legacy-v7'), {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: {
          sessionId: 'legacy-v7',
          revision: 'legacy',
          state: sessionState(7),
          chunks: [],
        },
      })
      storage.setEnvelope(sessionHeadKey('corrupted'), {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: { invalid: true },
      })
      storage.setEnvelope(sessionHeadKey(oversizedLegacySessionId), {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: {
          sessionId: oversizedLegacySessionId,
          revision: 'legacy-oversized',
          state: sessionState(8),
          chunks: [],
        },
      })
      storage.setEnvelope('unrelated/head', {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: {},
      })
      storage.setEnvelope('mc-compose/session/%61lpha/head', storage.envelope(sessionHeadKey('alpha'))!)
      storage.setEnvelope('mc-compose/session/%E0%A4%A/head', storage.envelope(sessionHeadKey('alpha'))!)
      storage.setEnvelope('mc-compose/session/alpha/revision/orphan/head', {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: {},
      })

      const sessions = yield* listSessions()

      expect(sessions.map(({ sessionId }) => sessionId)).toEqual([
        'alpha',
        'legacy-v7',
        specialSessionId,
      ])
      expect(sessions.map(({ revision }) => revision)).toEqual(['r2', 'legacy', 'r1'])
      expect(sessions.map(({ metadata }) => metadata)).toEqual([
        { name: 'Alpha Display', mode: 'creative' },
        { name: 'legacy-v7', mode: 'survival' },
        defaultMetadata,
      ])
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('deletes a session including orphan revisions without touching another session', () => {
    const storage = controlledStorage()
    const deletedSessionId = 'world / one'
    const headlessSessionId = 'headless'
    const retainedSessionId = 'world / one-more'

    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: deletedSessionId,
        revision: 'current',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 4)],
      })
      yield* saveSession({
        sessionId: retainedSessionId,
        revision: 'current',
        state: sessionState(2),
        chunks: [dimensionChunk('overworld', 1, 0, 7)],
      })
      const orphanKey = sessionChunkKey(
        deletedSessionId,
        'orphan',
        'nether',
        chunkCoord(-2, 3),
      )
      storage.setEnvelope(orphanKey, storage.envelope(
        sessionChunkKey(deletedSessionId, 'current', 'overworld', chunkCoord(0, 0)),
      )!)
      storage.setEnvelope(sessionHeadKey(deletedSessionId), {
        format: SESSION_FORMAT_NAME,
        version: 7,
        payload: { invalid: true },
      })
      const headlessOrphanKey = sessionChunkKey(
        headlessSessionId,
        'orphan',
        'end',
        chunkCoord(4, -1),
      )
      storage.setEnvelope(headlessOrphanKey, storage.envelope(orphanKey)!)

      yield* deleteSession(deletedSessionId)
      yield* deleteSession(headlessSessionId)

      expect(storage.keys.some((key) =>
        key.startsWith(`mc-compose/session/${encodeURIComponent(deletedSessionId)}/`),
      )).toBe(false)
      expect(storage.keys).not.toContain(headlessOrphanKey)
      expect(storage.keys).toContain(sessionHeadKey(retainedSessionId))
      expect(storage.keys).toContain(
        sessionChunkKey(retainedSessionId, 'current', 'overworld', chunkCoord(1, 0)),
      )
      expect(Option.isSome(yield* loadSession(retainedSessionId))).toBe(true)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates v6 sessions with an empty lever state', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v6')
    const { redstone: _redstone, ...v6State } = sessionState(42)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 6,
      payload: {
        sessionId: 'legacy-v6',
        revision: 'r1',
        state: v6State,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v6'))
      expect(loaded.state.redstone).toEqual({ levers: [] })
      expect(loaded.metadata).toEqual({ name: 'legacy-v6', mode: 'survival' })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('round-trips partially damaged equipped tools', () => {
    const storage = controlledStorage()
    const inventory = {
      slots: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) =>
        index === 0 ? { item: 'flint_and_steel' as const, count: 1 } : undefined,
      ),
    } as Inventory
    const initialStorage = storageFromInventory(inventory)
    const damagedStorage = {
      ...initialStorage,
      inventoryDurability: initialStorage.inventoryDurability.map((durability, index) =>
        index === 0 ? { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY } : durability,
      ),
    }
    const equippedStorage = equipFromInventory(damagedStorage, 0, 'offhand').storage

    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'durable-equipment',
        revision: 'r1',
        state: { ...sessionState(42), storage: equippedStorage },
        chunks: [],
      })

      const loaded = Option.getOrThrow(yield* loadSession('durable-equipment'))
      expect(loaded.state.storage).toEqual(equippedStorage)
      expect(loaded.state.storage.equipment.slots.offhand).toMatchObject({
        item: 'flint_and_steel',
        count: 1,
        durability: { current: 17, max: FLINT_AND_STEEL_MAX_DURABILITY },
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a literal v5 inventory to complete player storage', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v5')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 5,
      payload: {
        sessionId: 'legacy-v5',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          inventory: { slots: [{ item: 'flint_and_steel', count: 1 }] },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v5'))

      expect(loaded.state.storage.inventory.slots).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(loaded.state.storage.inventoryDurability).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(loaded.state.storage.inventoryDurability[0]).toEqual({
        current: FLINT_AND_STEEL_MAX_DURABILITY,
        max: FLINT_AND_STEEL_MAX_DURABILITY,
      })
      expect(loaded.state.storage.equipment.slots).toEqual({
        head: null,
        chest: null,
        legs: null,
        feet: null,
        offhand: null,
      })
      expect(storage.envelope(key)?.version).toBe(5)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a v6 player storage that violates durability invariants', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('invalid-v6-storage')
    const validStorage = storageFromInventory({
      slots: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) =>
        index === 0 ? { item: 'flint_and_steel' as const, count: 1 } : undefined,
      ),
    } as Inventory)
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 6,
      payload: {
        sessionId: 'invalid-v6-storage',
        revision: 'r1',
        state: {
          ...sessionState(42),
          storage: {
            ...validStorage,
            inventoryDurability: Array.from({ length: INVENTORY_SLOT_COUNT }, () => null),
          },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('invalid-v6-storage'))

      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 6,
      })
      expect(storage.envelope(key)?.version).toBe(6)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('keeps equal chunk coordinates distinct across dimensions', () => {
    const storage = controlledStorage()
    const fallback: ChunkSource = (coord) => Effect.succeed(chunk(coord.cx, coord.cz, 9))

    return Effect.gen(function* () {
      const head = yield* saveSession({
        sessionId: 'dimension-coordinates',
        revision: 'r1',
        state: sessionState(42),
        chunks: [dimensionChunk('overworld', 0, 0, 3), dimensionChunk('nether', 0, 0, 7)],
      })
      const overworld = yield* makeSessionChunkSource(head, 'overworld', fallback)
      const nether = yield* makeSessionChunkSource(head, 'nether', fallback)

      expect(head.chunks.map(({ dimension }) => dimension)).toEqual(['overworld', 'nether'])
      expect(head.chunks[0]!.key).toContain('/dimension/overworld/chunk/0/0')
      expect(head.chunks[1]!.key).toContain('/dimension/nether/chunk/0/0')
      expect(Effect.runSync(overworld.source(chunkCoord(0, 0))).blocks[0]).toBe(3)
      expect(Effect.runSync(nether.source(chunkCoord(0, 0))).blocks[0]).toBe(7)
      expect(overworld.chunks).toHaveLength(2)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('loads literal v4 chunks as overworld without rewriting and collects legacy keys', () => {
    const storage = controlledStorage()
    const headKey = sessionHeadKey('legacy-v4')
    const legacyChunkKey = 'mc-compose/session/legacy-v4/revision/r1/chunk/0/0'

    return Effect.gen(function* () {
      const seed = yield* saveSession({
        sessionId: 'legacy-v4',
        revision: 'seed',
        state: sessionState(42),
        chunks: [dimensionChunk('overworld', 0, 0, 5)],
      })
      storage.setEnvelope(legacyChunkKey, storage.envelope(seed.chunks[0]!.key)!)
      storage.setEnvelope(headKey, {
        format: SESSION_FORMAT_NAME,
        version: 4,
        payload: {
          sessionId: 'legacy-v4',
          revision: 'r1',
          state: { ...legacySessionState(42), dimension: 'nether' },
          chunks: [{ coord: chunkCoord(0, 0), key: legacyChunkKey }],
        },
      })

      const loaded = Option.getOrThrow(yield* loadSession('legacy-v4'))
      expect(loaded.chunks).toEqual([
        { dimension: 'overworld', coord: chunkCoord(0, 0), key: legacyChunkKey },
      ])
      expect(loaded.state.storage.inventory.slots).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(loaded.state.storage.inventoryDurability).toHaveLength(INVENTORY_SLOT_COUNT)
      expect(storage.envelope(headKey)?.version).toBe(4)

      const loadedChunks = yield* makeSessionChunkSource(
        loaded,
        'overworld',
        (coord) => Effect.succeed(chunk(coord.cx, coord.cz, 9)),
      )
      yield* saveSession({
        sessionId: 'legacy-v4',
        revision: 'r2',
        state: loaded.state,
        chunks: loadedChunks.chunks,
      })

      expect(storage.envelope(legacyChunkKey)).toBeUndefined()
      expect(storage.envelope(headKey)?.version).toBe(17)
      expect(storage.keys).toContain(
        sessionChunkKey('legacy-v4', 'r2', 'overworld', chunkCoord(0, 0)),
      )
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a literal v1 session to spawn vitals', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v1')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 1,
      payload: {
        sessionId: 'legacy-v1',
        revision: 'r1',
        state: {
          seed: 73,
          dimension: 'overworld',
          player: {
            feetPosition: { x: 1.5, y: 64, z: -2.5 },
            yawRadians: 0.25,
            pitchRadians: -0.1,
          },
          inventory: { slots: [{ item: 'stone', count: 12 }, undefined] },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v1'))

      expect(loaded.state.vitals).toEqual(SPAWN_PLAYER_VITALS)
      expect(loaded.state.time).toEqual(INITIAL_TIME_STATE)
      expect(loaded.state.weather).toEqual(INITIAL_WEATHER_STATE)
      expect(storage.envelope(key)?.version).toBe(1)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a literal v2 session to the initial simulation time', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v2')
    const legacyState = { ...legacySessionState(84) } as Record<string, unknown>
    delete legacyState['time']
    delete legacyState['weather']
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 2,
      payload: {
        sessionId: 'legacy-v2',
        revision: 'r1',
        state: legacyState,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v2'))

      expect(loaded.state.time).toEqual(INITIAL_TIME_STATE)
      expect(loaded.state.weather).toEqual(INITIAL_WEATHER_STATE)
      expect(storage.envelope(key)?.version).toBe(2)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('migrates a literal v3 session to the initial weather', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-v3')
    const legacyState = { ...legacySessionState(91) } as Record<string, unknown>
    delete legacyState['weather']
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 3,
      payload: {
        sessionId: 'legacy-v3',
        revision: 'r1',
        state: legacyState,
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const loaded = Option.getOrThrow(yield* loadSession('legacy-v3'))

      expect(loaded.state.weather).toEqual(INITIAL_WEATHER_STATE)
      expect(storage.envelope(key)?.version).toBe(3)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('does not repair an explicitly undefined v3 weather property', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-invalid-weather')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 3,
      payload: {
        sessionId: 'legacy-invalid-weather',
        revision: 'r1',
        state: { ...legacySessionState(42), weather: undefined },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('legacy-invalid-weather'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 3 })
      expect(storage.envelope(key)?.version).toBe(3)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('does not repair an explicitly undefined v1 vitals property', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('legacy-invalid-vitals')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 1,
      payload: {
        sessionId: 'legacy-invalid-vitals',
        revision: 'r1',
        state: { ...legacySessionState(42), vitals: undefined },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('legacy-invalid-vitals'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 1 })
      expect(storage.envelope(key)?.version).toBe(1)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a v2 session whose vitals property is missing', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('missing-vitals')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 2,
      payload: {
        sessionId: 'missing-vitals',
        revision: 'r1',
        state: {
          seed: 42,
          dimension: 'overworld',
          player: {
            feetPosition: { x: 1.5, y: 64, z: -2.5 },
            yawRadians: 0.25,
            pitchRadians: -0.1,
          },
          inventory: { slots: [] },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('missing-vitals'))

      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 2,
      })
      expect(storage.envelope(key)).toBeDefined()
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects non-finite persisted vitals', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('non-finite-vitals')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 2,
      payload: {
        sessionId: 'non-finite-vitals',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          vitals: {
            ...legacySessionState(42).vitals,
            healthPoints: Number.POSITIVE_INFINITY,
          },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('non-finite-vitals'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 2 })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects persisted simulation time that violates invariants', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('invalid-time')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 3,
      payload: {
        sessionId: 'invalid-time',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          time: { ticks: Number.POSITIVE_INFINITY, dayLengthTicks: 24_000 },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('invalid-time'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 3 })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects persisted weather that violates simulation invariants', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('invalid-weather')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 4,
      payload: {
        sessionId: 'invalid-weather',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          weather: { weather: 'rain', remainingSecs: 0 },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('invalid-weather'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 4 })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects persisted vitals that violate gameplay invariants', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('invalid-vitals')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 2,
      payload: {
        sessionId: 'invalid-vitals',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          vitals: { ...legacySessionState(42).vitals, healthPoints: 21, maxHealthPoints: 20 },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('invalid-vitals'))

      expect(error).toMatchObject({ _tag: 'SaveDecodeError', version: 2 })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a saved session containing an unknown inventory item id', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('unknown-item')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 2,
      payload: {
        sessionId: 'unknown-item',
        revision: 'r1',
        state: {
          ...legacySessionState(42),
          inventory: { slots: [{ item: 'item_from_an_unknown_build', count: 1 }] },
        },
        chunks: [],
      },
    })

    return Effect.gen(function* () {
      const error = yield* Effect.flip(loadSession('unknown-item'))

      expect(error).toMatchObject({
        _tag: 'SaveDecodeError',
        format: SESSION_FORMAT_NAME,
        version: 2,
      })
      expect(storage.envelope(key)).toBeDefined()
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('prefers saved chunks and falls back only for absent coordinates', () => {
    const storage = controlledStorage()
    const generated: Array<string> = []
    const fallback: ChunkSource = (coord) =>
      Effect.sync(() => {
        generated.push(`${String(coord.cx)},${String(coord.cz)}`)
        return chunk(coord.cx, coord.cz, 9)
      })

    return Effect.gen(function* () {
      const head = yield* saveSession({
        sessionId: 'source-order',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 4)],
      })
      const loaded = yield* makeSessionChunkSource(head, 'overworld', fallback)
      loaded.chunks[0]!.chunk.blocks[0] = 8
      const persisted = Effect.runSync(loaded.source(chunkCoord(0, 0)))
      expect(persisted.blocks[0]).toBe(4)
      persisted.blocks[0] = 6
      const persistedAgain = Effect.runSync(loaded.source(chunkCoord(0, 0)))
      const missing = Effect.runSync(loaded.source(chunkCoord(1, 0)))

      expect(persistedAgain.blocks[0]).toBe(4)
      expect(loaded.chunks[0]!.chunk.blocks[0]).toBe(8)
      expect(missing.blocks[0]).toBe(9)
      expect(generated).toEqual(['1,0'])
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a manifest whose saved chunk key is missing', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      const head = yield* saveSession({
        sessionId: 'missing-chunk',
        revision: 'r1',
        state: sessionState(1),
        chunks: [],
      })
      const coord = chunkCoord(3, -2)
      const invalidHead = {
        ...head,
        chunks: [
          {
            dimension: 'overworld' as const,
            coord,
            key: sessionChunkKey(head.sessionId, head.revision, 'overworld', coord),
          },
        ],
      }
      const error = yield* Effect.flip(
        makeSessionChunkSource(invalidHead, 'overworld', (missingCoord) =>
          Effect.succeed(chunk(missingCoord.cx, missingCoord.cz, 9)),
        ),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'missing-chunk',
        dimension: 'overworld',
        coord,
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects duplicate coordinates in the manifest', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      const head = yield* saveSession({
        sessionId: 'duplicate-coordinate',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 4)],
      })
      const duplicateHead = { ...head, chunks: [head.chunks[0]!, head.chunks[0]!] }
      const error = yield* Effect.flip(
        makeSessionChunkSource(duplicateHead, 'overworld', (coord) =>
          Effect.succeed(chunk(coord.cx, coord.cz, 9)),
        ),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'duplicate-coordinate',
        dimension: 'overworld',
        coord: chunkCoord(0, 0),
      })
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects duplicate save coordinates before writing chunks', () => {
    const storage = controlledStorage()
    const coord = chunkCoord(2, -1)
    return Effect.gen(function* () {
      const error = yield* Effect.flip(
        saveSession({
          sessionId: 'duplicate-save',
          revision: 'r1',
          state: sessionState(1),
          chunks: [
            dimensionChunk('overworld', coord.cx, coord.cz, 4),
            dimensionChunk('overworld', coord.cx, coord.cz, 7),
          ],
        }),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'duplicate-coordinate',
        dimension: 'overworld',
        coord,
      })
      expect(storage.chunkWriteCount).toBe(0)
      expect(Option.isNone(yield* loadSession('duplicate-save'))).toBe(true)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('does not publish a new head when a chunk write fails', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'chunk-failure',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 1)],
      })
      const failedKey = sessionChunkKey('chunk-failure', 'r2', 'overworld', chunkCoord(1, 0))
      storage.failChunkKey = failedKey
      const error = yield* Effect.flip(
        saveSession({
          sessionId: 'chunk-failure',
          revision: 'r2',
          state: sessionState(2),
          chunks: [
            dimensionChunk('overworld', 0, 0, 2),
            dimensionChunk('overworld', 1, 0, 3),
          ],
        }),
      )

      const loaded = Option.getOrThrow(yield* loadSession('chunk-failure'))
      expect(error).toMatchObject({ _tag: 'StorageError', operation: 'put', key: failedKey })
      expect(loaded.revision).toBe('r1')
      expect(loaded.state.seed).toBe(1)
      expect(storage.keys.filter((key) => key.includes('/revision/r2/'))).toEqual([])
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('restores the previous head when publishing the new head fails', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'head-failure',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 1)],
      })
      storage.failNextHeadWrite = true
      const error = yield* Effect.flip(
        saveSession({
          sessionId: 'head-failure',
          revision: 'r2',
          state: sessionState(2),
          chunks: [dimensionChunk('overworld', 0, 0, 2)],
        }),
      )

      const loaded = Option.getOrThrow(yield* loadSession('head-failure'))
      expect(error).toMatchObject({
        _tag: 'StorageError',
        operation: 'put',
        key: sessionHeadKey('head-failure'),
      })
      expect(loaded.revision).toBe('r1')
      expect(loaded.state.seed).toBe(1)
      expect(storage.keys.filter((key) => key.includes('/revision/r2/'))).toEqual([])
      expect(sessionHeadKey('head-failure')).toContain('/head')
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('restores overwritten chunk records when a same-revision save fails', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'same-revision-failure',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 1)],
      })
      storage.failChunkKey = sessionChunkKey(
        'same-revision-failure',
        'r1',
        'overworld',
        chunkCoord(1, 0),
      )
      yield* Effect.flip(
        saveSession({
          sessionId: 'same-revision-failure',
          revision: 'r1',
          state: sessionState(2),
          chunks: [
            dimensionChunk('overworld', 0, 0, 8),
            dimensionChunk('overworld', 1, 0, 9),
          ],
        }),
      )

      const head = Option.getOrThrow(yield* loadSession('same-revision-failure'))
      const loaded = yield* makeSessionChunkSource(head, 'overworld', (coord) =>
        Effect.succeed(chunk(coord.cx, coord.cz, 7)),
      )
      expect(head.state.seed).toBe(1)
      expect(Effect.runSync(loaded.source(chunkCoord(0, 0))).blocks[0]).toBe(1)
      expect(storage.keys.filter((key) => key.includes('/chunk/'))).toHaveLength(1)
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('keeps storage bounded across revisions and collects chunks for an empty manifest', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'bounded',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 1), dimensionChunk('overworld', 1, 0, 1)],
      })
      yield* saveSession({
        sessionId: 'bounded',
        revision: 'r2',
        state: sessionState(2),
        chunks: [dimensionChunk('overworld', 2, 0, 2)],
      })

      expect(storage.keys.filter((key) => key.includes('/chunk/'))).toEqual([
        sessionChunkKey('bounded', 'r2', 'overworld', chunkCoord(2, 0)),
      ])

      yield* saveSession({
        sessionId: 'bounded',
        revision: 'r3',
        state: sessionState(3),
        chunks: [],
      })
      expect(storage.keys).toEqual([sessionHeadKey('bounded')])
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('does not fail a published save when old-revision cleanup fails', () => {
    const storage = controlledStorage()
    return Effect.gen(function* () {
      yield* saveSession({
        sessionId: 'cleanup-failure',
        revision: 'r1',
        state: sessionState(1),
        chunks: [dimensionChunk('overworld', 0, 0, 1)],
      })
      storage.failChunkRemoves = true
      const saved = yield* saveSession({
        sessionId: 'cleanup-failure',
        revision: 'r2',
        state: sessionState(2),
        chunks: [dimensionChunk('overworld', 1, 0, 2)],
      })

      expect(saved.revision).toBe('r2')
      expect(Option.getOrThrow(yield* loadSession('cleanup-failure')).revision).toBe('r2')
      expect(storage.keys.filter((key) => key.includes('/chunk/'))).toHaveLength(2)
    }).pipe(Effect.provide(storage.layer))
  })
})
