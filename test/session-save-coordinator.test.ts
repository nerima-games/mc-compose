import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  type Chunk,
  type Dimension,
} from '@nerima-games/mc-worldgen'

import type { DimensionChunk } from '../apps/web/session-persistence'

import {
  createSessionSaveCoordinator,
  type SessionSavePublication,
} from '../apps/web/session-save-coordinator'

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

const markerOf = (
  publication: SessionSavePublication<number>,
  dimension: Dimension,
  cx: number,
  cz: number,
): number =>
  publication.chunks.find(
    (candidate) =>
      candidate.dimension === dimension &&
      candidate.chunk.coord.cx === cx &&
      candidate.chunk.coord.cz === cz,
  )!.chunk.blocks[0]!

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('session save coordinator', () => {
  it('settles requests made during a save from the following publication batch', async () => {
    const saves = [deferred<void>(), deferred<void>()]
    const publications: Array<SessionSavePublication<number>> = []
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      currentGeneration: () => 0,
      snapshotState: () => publications.length,
      publish: (publication) => {
        publications.push(publication)
        return saves[publications.length - 1]!.promise
      },
    })

    let firstSettled = false
    let secondSettled = false
    const first = coordinator.requestSave().then(() => { firstSettled = true })
    await Promise.resolve()
    const second = coordinator.requestSave().then(() => { secondSettled = true })
    saves[0]!.resolve()
    await first

    expect(firstSettled).toBe(true)
    expect(secondSettled).toBe(false)
    expect(publications).toHaveLength(2)

    saves[1]!.resolve()
    await second
    expect(secondSettled).toBe(true)
  })

  it('keeps known and retained chunks after a failed publication', async () => {
    const publications: Array<SessionSavePublication<number>> = []
    let shouldFail = true
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [dimensionChunk('overworld', 0, 0, 1)],
      snapshotResidents: async () => [],
      currentGeneration: () => 0,
      snapshotState: () => 1,
      publish: async (publication) => {
        publications.push(publication)
        if (shouldFail) throw new Error('storage unavailable')
      },
    })
    coordinator.retainChunk(dimensionChunk('overworld', 4, -3, 2))

    await expect(coordinator.requestSave()).rejects.toThrow('storage unavailable')
    expect(coordinator.knownChunkCount()).toBe(1)
    expect(coordinator.retainedChunkCount()).toBe(1)

    shouldFail = false
    await coordinator.requestSave()
    expect(publications[1]!.chunks).toHaveLength(2)
    expect(markerOf(publications[1]!, 'overworld', 0, 0)).toBe(1)
    expect(markerOf(publications[1]!, 'overworld', 4, -3)).toBe(2)
  })

  it('does not clear a retained chunk replaced while its older version saves', async () => {
    const firstSave = deferred<void>()
    const publications: Array<SessionSavePublication<number>> = []
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      currentGeneration: () => 0,
      snapshotState: () => 1,
      publish: (publication) => {
        publications.push(publication)
        return publications.length === 1 ? firstSave.promise : Promise.resolve()
      },
    })
    coordinator.retainChunk(dimensionChunk('overworld', 7, 2, 3))
    const first = coordinator.requestSave()
    await Promise.resolve()
    coordinator.retainChunk(dimensionChunk('overworld', 7, 2, 9))
    firstSave.resolve()
    await first

    expect(coordinator.retainedChunkCount()).toBe(1)
    await coordinator.requestSave()
    expect(markerOf(publications[1]!, 'overworld', 7, 2)).toBe(9)
    expect(coordinator.retainedChunkCount()).toBe(0)
  })

  it('retries instead of publishing a mixed cut when mutation occurs during resident snapshot', async () => {
    const firstResidents = deferred<ReadonlyArray<DimensionChunk>>()
    const publications: Array<SessionSavePublication<number>> = []
    let state = 1
    let residentMarker = 1
    let snapshotCount = 0
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: () => {
        snapshotCount += 1
        return snapshotCount === 1
          ? firstResidents.promise
          : Promise.resolve([dimensionChunk('overworld', 0, 0, residentMarker)])
      },
      currentGeneration: () => state,
      snapshotState: () => state,
      publish: async (publication) => { publications.push(publication) },
    })

    const save = coordinator.requestSave()
    await Promise.resolve()
    state = 2
    residentMarker = 2
    coordinator.retainChunk(dimensionChunk('overworld', 1, 0, 2))
    firstResidents.resolve([dimensionChunk('overworld', 0, 0, 1)])
    await save

    expect(snapshotCount).toBe(2)
    expect(publications).toHaveLength(1)
    expect(publications[0]!.state).toBe(2)
    expect(markerOf(publications[0]!, 'overworld', 0, 0)).toBe(2)
    expect(markerOf(publications[0]!, 'overworld', 1, 0)).toBe(2)
  })

  it('retries when only state changes during resident snapshot', async () => {
    const firstResidents = deferred<ReadonlyArray<DimensionChunk>>()
    const publications: Array<SessionSavePublication<number>> = []
    const publishedGenerations: number[] = []
    let state = 1
    let generation = 1
    let snapshotCount = 0
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: () => {
        snapshotCount += 1
        return snapshotCount === 1 ? firstResidents.promise : Promise.resolve([])
      },
      currentGeneration: () => generation,
      snapshotState: () => state,
      publish: async (publication) => { publications.push(publication) },
      onPublished: (publishedGeneration) => { publishedGenerations.push(publishedGeneration) },
    })

    const save = coordinator.requestSave()
    await Promise.resolve()
    state = 2
    generation += 1
    firstResidents.resolve([])
    await save

    expect(snapshotCount).toBe(2)
    expect(publications).toEqual([{ state: 2, chunks: [] }])
    expect(publishedGenerations).toEqual([2])
  })

  it('rejects after bounded snapshot retries and allows a later save', async () => {
    const publications: Array<SessionSavePublication<number>> = []
    let generation = 0
    let keepMutating = true
    let snapshotCount = 0
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => {
        snapshotCount += 1
        if (keepMutating) generation += 1
        return []
      },
      currentGeneration: () => generation,
      snapshotState: () => generation,
      publish: async (publication) => { publications.push(publication) },
    })

    await expect(coordinator.requestSave()).rejects.toThrow(
      'Unable to capture a consistent save snapshot after 8 attempts',
    )
    expect(snapshotCount).toBe(8)
    expect(publications).toHaveLength(0)

    keepMutating = false
    await coordinator.requestSave()

    expect(snapshotCount).toBe(9)
    expect(publications).toEqual([{ state: 8, chunks: [] }])
  })

  it('publishes the validated state without snapshotting it again', async () => {
    const publications: Array<SessionSavePublication<number>> = []
    let stateSnapshotCount = 0
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      currentGeneration: () => 4,
      snapshotState: () => ++stateSnapshotCount,
      publish: async (publication) => { publications.push(publication) },
    })

    await coordinator.requestSave()

    expect(stateSnapshotCount).toBe(1)
    expect(publications).toEqual([{ state: 1, chunks: [] }])
  })

  it('carries an unloaded far chunk into the next save', async () => {
    const publications: Array<SessionSavePublication<number>> = []
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      currentGeneration: () => 0,
      snapshotState: () => 1,
      publish: async (publication) => { publications.push(publication) },
    })
    coordinator.retainChunk(dimensionChunk('overworld', 120, -80, 6))

    await coordinator.requestSave()

    expect(markerOf(publications[0]!, 'overworld', 120, -80)).toBe(6)
  })

  it('merges known, retained, then resident chunks with resident priority', async () => {
    let publication: SessionSavePublication<number> | undefined
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [dimensionChunk('overworld', 1, 1, 1)],
      snapshotResidents: async () => [
        dimensionChunk('overworld', 1, 1, 8),
        dimensionChunk('overworld', 2, 2, 7),
      ],
      currentGeneration: () => 0,
      snapshotState: () => 1,
      publish: async (saved) => { publication = saved },
    })
    coordinator.retainChunk(dimensionChunk('overworld', 1, 1, 4))

    await coordinator.requestSave()

    expect(markerOf(publication!, 'overworld', 1, 1)).toBe(8)
    expect(markerOf(publication!, 'overworld', 2, 2)).toBe(7)
  })

  it('retains equal coordinates independently across dimensions', async () => {
    let publication: SessionSavePublication<number> | undefined
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [dimensionChunk('overworld', 3, -4, 2)],
      snapshotResidents: async () => [dimensionChunk('nether', 3, -4, 8)],
      currentGeneration: () => 0,
      snapshotState: () => 1,
      publish: async (saved) => { publication = saved },
    })

    await coordinator.requestSave()

    expect(publication!.chunks).toHaveLength(2)
    expect(markerOf(publication!, 'overworld', 3, -4)).toBe(2)
    expect(markerOf(publication!, 'nether', 3, -4)).toBe(8)
  })
})
