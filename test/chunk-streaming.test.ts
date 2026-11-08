import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { chunkCoord, CHUNK_SIZE_XZ } from '@nerima-games/mc-kernel'
import { CHUNK_VOLUME, type Chunk } from '@nerima-games/mc-worldgen'
import { makeGameplayFrameState } from '@nerima-games/mx-gameplay'

import {
  desiredChunksAround,
  makeChunkStreaming,
  type ChunkStreamingContext,
} from '../apps/web/chunk-streaming'

const chunk = (cx: number, cz: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(CHUNK_VOLUME),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS'),
})

const chunkContext = (events: Array<string>): ChunkStreamingContext => ({
  dimension: 'nether',
  chunkStore: {
    load: (coord) => Effect.sync(() => {
      events.push(`load:${String(coord.cx)},${String(coord.cz)}`)
      return chunk(coord.cx, coord.cz)
    }),
    unload: (coord) => Effect.sync(() => {
      events.push(`unload:${String(coord.cx)},${String(coord.cz)}`)
      return true
    }),
  },
  worldgenChunkStore: {
    loadedCoords: Effect.succeed([]),
    snapshot: (coord) => Effect.sync(() => {
      events.push(`snapshot:${String(coord.cx)},${String(coord.cz)}`)
      return chunk(coord.cx, coord.cz)
    }),
  },
  queueLoadedChunk: (coord) => events.push(`queue:${String(coord.cx)},${String(coord.cz)}`),
  streamLoaded: new Set(),
})

describe('chunk streaming', () => {
  it('preserves the row-major order of chunks around a position', () => {
    expect(desiredChunksAround(1, 0, 0)).toEqual([
      { cx: -1, cz: -1 },
      { cx: -1, cz: 0 },
      { cx: -1, cz: 1 },
      { cx: 0, cz: -1 },
      { cx: 0, cz: 0 },
      { cx: 0, cz: 1 },
      { cx: 1, cz: -1 },
      { cx: 1, cz: 0 },
      { cx: 1, cz: 1 },
    ])
  })

  it('loads new chunks before snapshotting, retaining, and unloading removed chunks', async () => {
    const events: Array<string> = []
    const attributes = new Map<string, string>()
    const retained: Array<Readonly<{ dimension: string; chunk: Chunk }>> = []
    const counters = { streamed: 0, dropped: 0 }
    const gameplayState = await Effect.runPromise(makeGameplayFrameState)
    const streaming = makeChunkStreaming({
      streamRadiusChunks: 0,
      activeSeed: 71,
      canvas: { setAttribute: (name, value) => { attributes.set(name, value) } },
      gameplayState,
      villagerResidents: new Map(),
      saveCoordinator: { retainChunk: (value) => { retained.push(value) } },
      getMarkSessionDirty: () => () => { events.push('dirty') },
      markRedstoneDirty: () => { events.push('redstone-dirty') },
      getChunksStreamedIn: () => counters.streamed,
      setChunksStreamedIn: (count) => { counters.streamed = count },
      getChunksDropped: () => counters.dropped,
      setChunksDropped: (count) => { counters.dropped = count },
    })
    const context = chunkContext(events)

    await Effect.runPromise(streaming.streamAround(context, 0, 0))
    await Effect.runPromise(streaming.streamAround(context, 16, 0))

    expect(events).toEqual([
      'load:0,0',
      'queue:0,0',
      'redstone-dirty',
      'load:1,0',
      'queue:1,0',
      'snapshot:0,0',
      'dirty',
      'unload:0,0',
      'redstone-dirty',
    ])
    expect(retained).toHaveLength(1)
    expect(retained[0]).toMatchObject({ dimension: 'nether', chunk: { coord: { cx: 0, cz: 0 } } })
    expect([...context.streamLoaded]).toEqual(['1,0'])
    expect(attributes).toEqual(new Map([
      ['data-chunks-meshed', '1'],
      ['data-chunks-streamed-in', '2'],
      ['data-chunks-dropped', '1'],
    ]))
  })
})
