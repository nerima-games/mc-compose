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
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  type Chunk,
  type ChunkSource,
} from '@nerima-games/mc-worldgen'

import {
  SESSION_FORMAT_NAME,
  loadSession,
  makeSessionChunkSource,
  saveSession,
  sessionChunkKey,
  sessionHeadKey,
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
})

const chunk = (cx: number, cz: number, marker: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(CHUNK_VOLUME).fill(marker),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS'),
})

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
        chunks: [chunk(0, 0, 3), chunk(-1, 2, 7)],
      })
      const loaded = yield* loadSession('primary world')

      expect(Option.getOrThrow(loaded)).toEqual(saved)
      expect(saved.chunks.map(({ coord }) => coord)).toEqual([chunkCoord(0, 0), chunkCoord(-1, 2)])
    }).pipe(Effect.provide(storage.layer))
  })

  it.effect('rejects a saved session containing an unknown inventory item id', () => {
    const storage = controlledStorage()
    const key = sessionHeadKey('unknown-item')
    storage.setEnvelope(key, {
      format: SESSION_FORMAT_NAME,
      version: 1,
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
        version: 1,
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
        chunks: [chunk(0, 0, 4)],
      })
      const loaded = yield* makeSessionChunkSource(head, fallback)
      loaded.chunks[0]!.blocks[0] = 8
      const persisted = Effect.runSync(loaded.source(chunkCoord(0, 0)))
      expect(persisted.blocks[0]).toBe(4)
      persisted.blocks[0] = 6
      const persistedAgain = Effect.runSync(loaded.source(chunkCoord(0, 0)))
      const missing = Effect.runSync(loaded.source(chunkCoord(1, 0)))

      expect(persistedAgain.blocks[0]).toBe(4)
      expect(loaded.chunks[0]!.blocks[0]).toBe(8)
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
        chunks: [{ coord, key: sessionChunkKey(head.sessionId, head.revision, coord) }],
      }
      const error = yield* Effect.flip(
        makeSessionChunkSource(invalidHead, (missingCoord) =>
          Effect.succeed(chunk(missingCoord.cx, missingCoord.cz, 9)),
        ),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'missing-chunk',
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
        chunks: [chunk(0, 0, 4)],
      })
      const duplicateHead = { ...head, chunks: [head.chunks[0]!, head.chunks[0]!] }
      const error = yield* Effect.flip(
        makeSessionChunkSource(duplicateHead, (coord) =>
          Effect.succeed(chunk(coord.cx, coord.cz, 9)),
        ),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'duplicate-coordinate',
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
          chunks: [chunk(coord.cx, coord.cz, 4), chunk(coord.cx, coord.cz, 7)],
        }),
      )

      expect(error).toMatchObject({
        _tag: 'SessionManifestError',
        reason: 'duplicate-coordinate',
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
        chunks: [chunk(0, 0, 1)],
      })
      const failedKey = sessionChunkKey('chunk-failure', 'r2', chunkCoord(1, 0))
      storage.failChunkKey = failedKey
      const error = yield* Effect.flip(
        saveSession({
          sessionId: 'chunk-failure',
          revision: 'r2',
          state: sessionState(2),
          chunks: [chunk(0, 0, 2), chunk(1, 0, 3)],
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
        chunks: [chunk(0, 0, 1)],
      })
      storage.failNextHeadWrite = true
      const error = yield* Effect.flip(
        saveSession({
          sessionId: 'head-failure',
          revision: 'r2',
          state: sessionState(2),
          chunks: [chunk(0, 0, 2)],
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
        chunks: [chunk(0, 0, 1)],
      })
      storage.failChunkKey = sessionChunkKey('same-revision-failure', 'r1', chunkCoord(1, 0))
      yield* Effect.flip(
        saveSession({
          sessionId: 'same-revision-failure',
          revision: 'r1',
          state: sessionState(2),
          chunks: [chunk(0, 0, 8), chunk(1, 0, 9)],
        }),
      )

      const head = Option.getOrThrow(yield* loadSession('same-revision-failure'))
      const loaded = yield* makeSessionChunkSource(head, (coord) =>
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
        chunks: [chunk(0, 0, 1), chunk(1, 0, 1)],
      })
      yield* saveSession({
        sessionId: 'bounded',
        revision: 'r2',
        state: sessionState(2),
        chunks: [chunk(2, 0, 2)],
      })

      expect(storage.keys.filter((key) => key.includes('/chunk/'))).toEqual([
        sessionChunkKey('bounded', 'r2', chunkCoord(2, 0)),
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
        chunks: [chunk(0, 0, 1)],
      })
      storage.failChunkRemoves = true
      const saved = yield* saveSession({
        sessionId: 'cleanup-failure',
        revision: 'r2',
        state: sessionState(2),
        chunks: [chunk(1, 0, 2)],
      })

      expect(saved.revision).toBe('r2')
      expect(Option.getOrThrow(yield* loadSession('cleanup-failure')).revision).toBe('r2')
      expect(storage.keys.filter((key) => key.includes('/chunk/'))).toHaveLength(2)
    }).pipe(Effect.provide(storage.layer))
  })
})
