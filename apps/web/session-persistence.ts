import { Data, Effect, Option, Schema } from 'effect'

import {
  loadFrom,
  SaveKey,
  saveTo,
  StoragePort,
  defineFormat,
  type MigrationError,
  type SaveDecodeError,
  type StorageError,
} from '@nerima-games/mc-save'
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

const InventorySlotSchema = Schema.Union(
  Schema.Struct({
    item: Schema.String.pipe(Schema.minLength(1)),
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
    readonly slots: ReadonlyArray<
      | {
          readonly item: string
          readonly count: number
        }
      | undefined
    >
  }
}

const SessionStateSchema: Schema.Schema<SessionState> = Schema.Struct({
  seed: Schema.Number,
  dimension: Schema.Literal('overworld', 'nether', 'end'),
  player: Schema.Struct({
    feetPosition: PositionSchema,
    yawRadians: Schema.Number,
    pitchRadians: Schema.Number,
  }),
  inventory: Schema.Struct({ slots: Schema.Array(InventorySlotSchema) }),
})

export type SessionChunkManifestEntry = {
  readonly coord: ChunkCoord
  readonly key: string
}

export type SessionHead = {
  readonly sessionId: string
  readonly revision: string
  readonly state: SessionState
  readonly chunks: ReadonlyArray<SessionChunkManifestEntry>
}

type SessionHeadEncoded = Omit<SessionHead, 'chunks'> & {
  readonly chunks: ReadonlyArray<{
    readonly coord: { readonly cx: number; readonly cz: number }
    readonly key: string
  }>
}

const ChunkManifestEntrySchema = Schema.Struct({
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

export const SESSION_FORMAT = defineFormat({
  name: SESSION_FORMAT_NAME,
  version: 1,
  schema: SessionHeadSchema,
})

export class SessionManifestError extends Data.TaggedError('SessionManifestError')<{
  readonly reason: 'duplicate-coordinate' | 'missing-chunk'
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

export const sessionChunkKey = (sessionId: string, revision: string, coord: ChunkCoord): SaveKey =>
  SaveKey(
    `mc-compose/session/${encodeURIComponent(sessionId)}/revision/${encodeURIComponent(revision)}/chunk/${String(coord.cx)}/${String(coord.cz)}`,
  )

export const loadSession = (
  sessionId: string,
): Effect.Effect<Option.Option<SessionHead>, SessionPersistenceError, StoragePort> =>
  loadFrom(SESSION_FORMAT, sessionHeadKey(sessionId))

export type SaveSessionInput = {
  readonly sessionId: string
  readonly revision: string
  readonly state: SessionState
  readonly chunks: ReadonlyArray<Chunk>
}

/** Write revision chunks first, atomically publish their manifest, then collect the old revision. */
export const saveSession = (
  input: SaveSessionInput,
): Effect.Effect<SessionHead, SessionPersistenceError, StoragePort> =>
  Effect.gen(function* () {
    const manifest = input.chunks.map(
      (chunk): SessionChunkManifestEntry => ({
        coord: chunk.coord,
        key: sessionChunkKey(input.sessionId, input.revision, chunk.coord),
      }),
    )
    const duplicate = duplicateManifestEntry(manifest)
    if (duplicate !== undefined) {
      return yield* new SessionManifestError({
        reason: 'duplicate-coordinate',
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
      yield* Effect.forEach(input.chunks, (chunk, index) =>
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

const coordId = (coord: ChunkCoord): string => `${String(coord.cx)},${String(coord.cz)}`

const duplicateManifestEntry = (
  entries: ReadonlyArray<SessionChunkManifestEntry>,
): SessionChunkManifestEntry | undefined => {
  const coords = new Set<string>()
  for (const entry of entries) {
    const id = coordId(entry.coord)
    if (coords.has(id)) return entry
    coords.add(id)
  }
  return undefined
}

export type LoadedSessionChunks = {
  readonly source: ChunkSource
  readonly chunks: ReadonlyArray<Chunk>
}

/** Validate and preload the manifest so streaming never reaches asynchronous storage. */
export const makeSessionChunkSource = (
  head: SessionHead,
  fallback: ChunkSource,
): Effect.Effect<LoadedSessionChunks, SessionPersistenceError, StoragePort> =>
  Effect.gen(function* () {
    const duplicate = duplicateManifestEntry(head.chunks)
    if (duplicate !== undefined) {
      return yield* new SessionManifestError({
        reason: 'duplicate-coordinate',
        coord: duplicate.coord,
        key: duplicate.key,
      })
    }

    const savedChunks = new Map<string, Chunk>()
    for (const entry of head.chunks) {
      const loaded = yield* loadFrom(CHUNK_FORMAT, SaveKey(entry.key))
      if (Option.isNone(loaded)) {
        return yield* new SessionManifestError({
          reason: 'missing-chunk',
          coord: entry.coord,
          key: entry.key,
        })
      }
      savedChunks.set(coordId(entry.coord), chunkSnapshotOf(loaded.value))
    }

    return {
      source: (coord) => {
        const saved = savedChunks.get(coordId(coord))
        return saved === undefined ? fallback(coord) : Effect.sync(() => chunkSnapshotOf(saved))
      },
      chunks: [...savedChunks.values()].map(chunkSnapshotOf),
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
