import { Option } from 'effect'
import {
  chunkSnapshotOf,
  generatedChunkSource,
  type Chunk,
  type ChunkSource,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import { isDroppedItemBehaviour } from '@nerima-games/mx-gameplay'

import type { DroppedItemLifetimeTracker } from './dropped-item-lifetime'
import type { DroppedItemMetadata } from './dropped-item-metadata'
import {
  EMPTY_ENTITY_ROSTER,
  normalizePersistedEntityRosters,
  persistedItemDropLifetime,
  type DimensionChunk,
  type PersistedEntityRoster,
  type SessionHead,
  type SessionState,
} from './session-persistence'
import { makeSessionChunkSourceFor } from './session-restoration'

export type SessionWorldInitialization<World> = {
  readonly activeSeed: number
  readonly initialKnownChunks: ReadonlyArray<DimensionChunk>
  readonly restored: { readonly chunks: ReadonlyArray<DimensionChunk> } | undefined
  readonly world: World
  readonly chunkSourceFor: (dimension: Dimension) => ChunkSource
  readonly entityRosters: Map<Dimension, PersistedEntityRoster>
  readonly rosterWithDroppedItemLifetimes: (
    dimension: Dimension,
    roster: PersistedEntityRoster,
  ) => PersistedEntityRoster
  readonly snapshotEntityRosters: (
    dimension: Dimension,
    snapshot: PersistedEntityRoster,
  ) => SessionState['entities']
}

export const initializeSessionWorld = async <World>(context: {
  readonly loadedSession: Option.Option<SessionHead>
  readonly initialDimension: Dimension
  readonly worldSeed: number
  readonly loadSavedChunks: (
    session: SessionHead,
    dimension: Dimension,
    fallback: ChunkSource,
  ) => Promise<{ readonly chunks: ReadonlyArray<DimensionChunk> }>
  readonly makeWorld: (input: {
    readonly seed: number
    readonly chunkSource: ChunkSource
    readonly dimension: Dimension
  }) => Promise<World>
  readonly restoreEntities: (world: World, roster: PersistedEntityRoster) => void
  readonly snapshotEntities: (world: World) => PersistedEntityRoster
  readonly droppedItemLifetime: DroppedItemLifetimeTracker
  readonly droppedItemMetadata: Map<string, DroppedItemMetadata>
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly droppedItemMetadataFromBehaviour: (behaviour: unknown) => DroppedItemMetadata
}): Promise<SessionWorldInitialization<World>> => {
  const activeSeed = Option.isSome(context.loadedSession)
    ? context.loadedSession.value.state.seed
    : context.worldSeed
  const generatedSource = generatedChunkSource(activeSeed)
  const restored = Option.isSome(context.loadedSession)
    ? await context.loadSavedChunks(context.loadedSession.value, context.initialDimension, generatedSource)
    : undefined
  const initialKnownChunks = (restored?.chunks ?? []).map(({ dimension, chunk }) => ({
    dimension,
    chunk: chunkSnapshotOf(chunk),
  }))
  const persistedChunks = new Map<string, Chunk>(
    (restored?.chunks ?? []).map(({ dimension, chunk }) => [
      `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`,
      chunk,
    ]),
  )
  const chunkSourceFor = (dimension: Dimension): ChunkSource =>
    makeSessionChunkSourceFor(dimension, persistedChunks, generatedSource)
  const world = await context.makeWorld({
    seed: activeSeed,
    chunkSource: chunkSourceFor(context.initialDimension),
    dimension: context.initialDimension,
  })
  const restoredEntityRosters = normalizePersistedEntityRosters(
    Option.isSome(context.loadedSession) ? context.loadedSession.value.state.entities : undefined,
  )
  const entityRosters = new Map<Dimension, PersistedEntityRoster>([
    ['overworld', restoredEntityRosters.overworld],
    ['nether', restoredEntityRosters.nether],
    ['end', restoredEntityRosters.end],
  ])
  for (const [dimension, roster] of entityRosters) {
    context.restoreEntities(world, roster)
    const canonicalRoster = context.snapshotEntities(world)
    entityRosters.set(dimension, canonicalRoster)
    context.droppedItemLifetime.restore(
      dimension,
      canonicalRoster.entities
        .filter((entity) => isDroppedItemBehaviour(entity.behaviour))
        .map((entity) => ({
          entityId: entity.id,
          elapsedSecs: persistedItemDropLifetime(entity.behaviour).elapsedSecs,
        })),
    )
    for (const entity of canonicalRoster.entities) {
      if (!isDroppedItemBehaviour(entity.behaviour)) continue
      context.droppedItemMetadata.set(
        context.droppedItemMetadataKey(dimension, entity.id),
        context.droppedItemMetadataFromBehaviour(entity.behaviour),
      )
    }
  }
  const rosterWithDroppedItemLifetimes = (
    dimension: Dimension,
    roster: PersistedEntityRoster,
  ): PersistedEntityRoster => ({
    ...roster,
    entities: roster.entities.map((entity) => {
      if (!isDroppedItemBehaviour(entity.behaviour)) return entity
      const metadata = context.droppedItemMetadata.get(
        context.droppedItemMetadataKey(dimension, entity.id),
      )
      return {
        ...entity,
        behaviour: {
          ...entity.behaviour,
          elapsedSecs: context.droppedItemLifetime.elapsed(dimension, entity.id),
          ...(metadata?.customName === undefined ? {} : { customName: metadata.customName }),
          ...(metadata?.enchantedItem === undefined
            ? {}
            : { enchantments: metadata.enchantedItem.enchantments }),
        },
      }
    }),
  })
  const snapshotEntityRosters = (
    dimension: Dimension,
    snapshot: PersistedEntityRoster,
  ): SessionState['entities'] => {
    entityRosters.set(dimension, rosterWithDroppedItemLifetimes(dimension, snapshot))
    return {
      overworld: entityRosters.get('overworld') ?? EMPTY_ENTITY_ROSTER,
      nether: entityRosters.get('nether') ?? EMPTY_ENTITY_ROSTER,
      end: entityRosters.get('end') ?? EMPTY_ENTITY_ROSTER,
    }
  }

  return {
    activeSeed,
    initialKnownChunks,
    restored,
    world,
    chunkSourceFor,
    entityRosters,
    rosterWithDroppedItemLifetimes,
    snapshotEntityRosters,
  }
}
