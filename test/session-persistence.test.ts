import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option } from 'effect'

import {
  SaveKey,
  StorageError,
  StoragePort,
  type SaveEnvelope,
  type StorageService,
} from '@nerima-games/mc-save'
import { INITIAL_TIME_STATE, INITIAL_WEATHER_STATE } from '@nerima-games/mc-sim'
import {
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  type Chunk,
  type ChunkSource,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import { SPAWN_PLAYER_VITALS } from '@nerima-games/mx-gameplay'

import {
  SESSION_FORMAT_NAME,
  loadSession,
  makeSessionChunkSource,
  saveSession,
  sessionChunkKey,
  sessionHeadKey,
  type DimensionChunk,
  type SessionState,
} from '../apps/web/session-persistence'

const sessionState = (seed: number): SessionState => ({
  seed,
  dimension: 'overworld',
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
  weather: { weather: 'rain', remainingSecs: 123.5 },
})

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
      const saved = yield* saveSession({
        sessionId: 'primary world',
        revision: 'r1',
        state: sessionState(42),
        chunks: [dimensionChunk('overworld', 0, 0, 3), dimensionChunk('overworld', -1, 2, 7)],
      })
      const loaded = yield* loadSession('primary world')

      expect(Option.getOrThrow(loaded)).toEqual(saved)
      expect(saved.state.vitals).toEqual(sessionState(42).vitals)
      expect(saved.state.time).toEqual(sessionState(42).time)
      expect(saved.state.weather).toEqual(sessionState(42).weather)
      expect(saved.chunks.map(({ coord }) => coord)).toEqual([chunkCoord(0, 0), chunkCoord(-1, 2)])
      expect(storage.envelope(sessionHeadKey('primary world'))).toMatchObject({
        format: SESSION_FORMAT_NAME,
        version: 5,
      })
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
          state: { ...sessionState(42), dimension: 'nether' },
          chunks: [{ coord: chunkCoord(0, 0), key: legacyChunkKey }],
        },
      })

      const loaded = Option.getOrThrow(yield* loadSession('legacy-v4'))
      expect(loaded.chunks).toEqual([
        { dimension: 'overworld', coord: chunkCoord(0, 0), key: legacyChunkKey },
      ])
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
      expect(storage.envelope(headKey)?.version).toBe(5)
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
    const legacyState = { ...sessionState(84) } as Record<string, unknown>
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
    const legacyState = { ...sessionState(91) } as Record<string, unknown>
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
        state: { ...sessionState(42), weather: undefined },
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
        state: { ...sessionState(42), vitals: undefined },
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
          ...sessionState(42),
          vitals: { ...sessionState(42).vitals, healthPoints: Number.POSITIVE_INFINITY },
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
          ...sessionState(42),
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
          ...sessionState(42),
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
          ...sessionState(42),
          vitals: { ...sessionState(42).vitals, healthPoints: 21, maxHealthPoints: 20 },
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
          ...sessionState(42),
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
