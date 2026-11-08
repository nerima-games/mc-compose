import { chunkCoord } from '@nerima-games/mc-kernel'
import { chunkKeyOf, type ChunkRef, syncWorld } from '@nerima-games/mc-render'
import {
  biomeFor,
  DEFAULT_TERRAIN_LEVELS,
  surfaceHeightAt,
  type ChunkStoreApi,
  type Dimension,
  villageVillagerSpawnsForChunk,
} from '@nerima-games/mc-worldgen'
import {
  addVillager,
  makeVillager,
  restoreVillagerTrades,
  snapshotVillagerTrades,
  type GameplayFrameState,
} from '@nerima-games/mx-gameplay'
import { Effect } from 'effect'

import { snapshotResidentChunks, type PersistedVillager } from './session-persistence'
import type { SessionSaveCoordinator } from './session-save-coordinator'
import type { RenderLightingSnapshot } from './render-lighting'

export type ChunkStreamingContext<
  ChunkStore extends Pick<ChunkStoreApi, 'load' | 'unload'> = Pick<ChunkStoreApi, 'load' | 'unload'>,
  WorldgenChunkStore extends Pick<ChunkStoreApi, 'loadedCoords' | 'snapshot'> = Pick<
    ChunkStoreApi,
    'loadedCoords' | 'snapshot'
  >,
> = {
  readonly dimension: Dimension
  readonly chunkStore: ChunkStore
  readonly worldgenChunkStore: WorldgenChunkStore
  readonly queueLoadedChunk: (chunk: { cx: number; cz: number }) => void
  readonly streamLoaded: Set<string>
}

export type DimensionChunkContext = ChunkStreamingContext<ChunkStoreApi, ChunkStoreApi> & {
  readonly dirtyChunks: Parameters<typeof syncWorld>[1]
  readonly meshChunkFromStore: Parameters<typeof syncWorld>[2]
  readonly colorForChunk: NonNullable<NonNullable<Parameters<typeof syncWorld>[3]>['colorForChunk']>
  readonly lightingSnapshot: () => RenderLightingSnapshot
}

export type ChunkStreamingDependencies = {
  readonly streamRadiusChunks: number
  readonly activeSeed: number
  readonly canvas: Pick<HTMLCanvasElement, 'setAttribute'>
  readonly gameplayState: GameplayFrameState
  readonly villagerResidents: Map<string, PersistedVillager>
  readonly saveCoordinator: Pick<SessionSaveCoordinator, 'retainChunk'>
  readonly getMarkSessionDirty: () => () => void
  readonly markRedstoneDirty: () => void
  readonly getChunksStreamedIn: () => number
  readonly setChunksStreamedIn: (count: number) => void
  readonly getChunksDropped: () => number
  readonly setChunksDropped: (count: number) => void
}

export type ChunkStreamingRuntime = {
  readonly streamAround: (
    context: ChunkStreamingContext,
    x: number,
    z: number,
  ) => Effect.Effect<void>
  readonly retainDimensionResidents: (context: ChunkStreamingContext) => Effect.Effect<void>
}

export const desiredChunksAround = (
  radius: number,
  x: number,
  z: number,
): ReadonlyArray<ChunkRef> => {
  const cx0 = Math.floor(x / 16)
  const cz0 = Math.floor(z / 16)
  const wanted: Array<ChunkRef> = []
  for (let cx = cx0 - radius; cx <= cx0 + radius; cx += 1) {
    for (let cz = cz0 - radius; cz <= cz0 + radius; cz += 1) {
      wanted.push({ cx, cz })
    }
  }
  return wanted
}

export const makeChunkStreaming = (
  dependencies: ChunkStreamingDependencies,
): ChunkStreamingRuntime => {
  const streamAround = (
    context: ChunkStreamingContext,
    x: number,
    z: number,
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      const wanted = desiredChunksAround(dependencies.streamRadiusChunks, x, z)
      const wantedKeys = new Set(wanted.map(chunkKeyOf))
      const changed = wanted.filter((chunk) => !context.streamLoaded.has(chunkKeyOf(chunk)))
      const removed = [...context.streamLoaded]
        .filter((key) => !wantedKeys.has(key))
        .map((key) => {
          const [cx, cz] = key.split(',')
          return { cx: Number(cx), cz: Number(cz) }
        })

      for (const chunk of changed) {
        yield* context.chunkStore.load(chunkCoord(chunk.cx, chunk.cz)).pipe(Effect.catchAll(() => Effect.void))
        context.queueLoadedChunk(chunk)
        context.streamLoaded.add(chunkKeyOf(chunk))
        if (context.dimension === 'overworld') {
          let trades = yield* snapshotVillagerTrades(dependencies.gameplayState)
          let discovered = false
          for (const spawn of villageVillagerSpawnsForChunk(
            dependencies.activeSeed,
            chunk.cx,
            chunk.cz,
            (x, z) => {
              const surfaceY = surfaceHeightAt(dependencies.activeSeed, x, z)
              return {
                biome: biomeFor(dependencies.activeSeed, x, z, surfaceY, DEFAULT_TERRAIN_LEVELS),
                surfaceY,
                seaLevel: DEFAULT_TERRAIN_LEVELS.seaLevel,
              }
            },
          )) {
            if (!dependencies.villagerResidents.has(spawn.id)) {
              dependencies.villagerResidents.set(spawn.id, {
                id: spawn.id,
                profession: spawn.profession,
                dimension: 'overworld',
                feetPosition: { x: spawn.x + 0.5, y: spawn.y, z: spawn.z + 0.5 },
              })
              discovered = true
            }
            if (!trades.villagers.some((villager) => villager.id === spawn.id)) {
              trades = addVillager(trades, makeVillager(spawn.id, spawn.profession))
              discovered = true
            }
          }
          if (discovered) {
            yield* restoreVillagerTrades(dependencies.gameplayState, trades)
            dependencies.getMarkSessionDirty()()
          }
        }
      }
      for (const chunk of removed) {
        const snapshot = yield* context.worldgenChunkStore.snapshot(chunkCoord(chunk.cx, chunk.cz))
        if (snapshot !== undefined) {
          dependencies.saveCoordinator.retainChunk({ dimension: context.dimension, chunk: snapshot })
          dependencies.getMarkSessionDirty()()
        }
        yield* context.chunkStore.unload(chunkCoord(chunk.cx, chunk.cz)).pipe(Effect.catchAll(() => Effect.void))
        context.streamLoaded.delete(chunkKeyOf(chunk))
      }

      if (changed.length > 0 || removed.length > 0) dependencies.markRedstoneDirty()

      dependencies.setChunksStreamedIn(dependencies.getChunksStreamedIn() + changed.length)
      dependencies.setChunksDropped(dependencies.getChunksDropped() + removed.length)
      dependencies.canvas.setAttribute('data-chunks-meshed', String(context.streamLoaded.size))
      dependencies.canvas.setAttribute('data-chunks-streamed-in', String(dependencies.getChunksStreamedIn()))
      dependencies.canvas.setAttribute('data-chunks-dropped', String(dependencies.getChunksDropped()))
    })

  const retainDimensionResidents = (context: ChunkStreamingContext): Effect.Effect<void> =>
    Effect.gen(function* () {
      const residents = yield* snapshotResidentChunks(context.worldgenChunkStore)
      for (const chunk of residents) {
        dependencies.saveCoordinator.retainChunk({ dimension: context.dimension, chunk })
      }
    })

  return { streamAround, retainDimensionResidents }
}

export const clearRenderedChunks = <Key extends string, KeyError, KeyRequirements, RemoveError, RemoveRequirements>(
  worldRenderer: {
    readonly chunkKeys: Effect.Effect<ReadonlyArray<Key>, KeyError, KeyRequirements>
    readonly removeChunk: (key: Key) => Effect.Effect<unknown, RemoveError, RemoveRequirements>
  },
): Effect.Effect<void, KeyError | RemoveError, KeyRequirements | RemoveRequirements> =>
  Effect.gen(function* () {
    const rendered = yield* worldRenderer.chunkKeys
    for (const key of rendered) yield* worldRenderer.removeChunk(key)
  })
