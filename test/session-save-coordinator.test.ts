import { describe, expect, it } from 'vitest'
import {
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  chunkCoord,
  type Chunk,
} from '@nerima-games/mc-worldgen'

import {
  createSessionSaveCoordinator,
  type SessionSavePublication,
} from '../apps/web/session-save-coordinator'

const chunk = (cx: number, cz: number, marker: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(CHUNK_VOLUME).fill(marker),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS'),
})

const markerOf = (publication: SessionSavePublication<number>, cx: number, cz: number): number =>
  publication.chunks.find((candidate) => candidate.coord.cx === cx && candidate.coord.cz === cz)!
    .blocks[0]!

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
      initialKnownChunks: [chunk(0, 0, 1)],
      snapshotResidents: async () => [],
      snapshotState: () => 1,
      publish: async (publication) => {
        publications.push(publication)
        if (shouldFail) throw new Error('storage unavailable')
      },
    })
    coordinator.retainChunk(chunk(4, -3, 2))

    await expect(coordinator.requestSave()).rejects.toThrow('storage unavailable')
    expect(coordinator.knownChunkCount()).toBe(1)
    expect(coordinator.retainedChunkCount()).toBe(1)

    shouldFail = false
    await coordinator.requestSave()
    expect(publications[1]!.chunks).toHaveLength(2)
    expect(markerOf(publications[1]!, 0, 0)).toBe(1)
    expect(markerOf(publications[1]!, 4, -3)).toBe(2)
  })

  it('does not clear a retained chunk replaced while its older version saves', async () => {
    const firstSave = deferred<void>()
    const publications: Array<SessionSavePublication<number>> = []
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      snapshotState: () => 1,
      publish: (publication) => {
        publications.push(publication)
        return publications.length === 1 ? firstSave.promise : Promise.resolve()
      },
    })
    coordinator.retainChunk(chunk(7, 2, 3))
    const first = coordinator.requestSave()
    await Promise.resolve()
    coordinator.retainChunk(chunk(7, 2, 9))
    firstSave.resolve()
    await first

    expect(coordinator.retainedChunkCount()).toBe(1)
    await coordinator.requestSave()
    expect(markerOf(publications[1]!, 7, 2)).toBe(9)
    expect(coordinator.retainedChunkCount()).toBe(0)
  })

  it('carries an unloaded far chunk into the next save', async () => {
    const publications: Array<SessionSavePublication<number>> = []
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [],
      snapshotResidents: async () => [],
      snapshotState: () => 1,
      publish: async (publication) => { publications.push(publication) },
    })
    coordinator.retainChunk(chunk(120, -80, 6))

    await coordinator.requestSave()

    expect(markerOf(publications[0]!, 120, -80)).toBe(6)
  })

  it('merges known, retained, then resident chunks with resident priority', async () => {
    let publication: SessionSavePublication<number> | undefined
    const coordinator = createSessionSaveCoordinator({
      initialKnownChunks: [chunk(1, 1, 1)],
      snapshotResidents: async () => [chunk(1, 1, 8), chunk(2, 2, 7)],
      snapshotState: () => 1,
      publish: async (saved) => { publication = saved },
    })
    coordinator.retainChunk(chunk(1, 1, 4))

    await coordinator.requestSave()

    expect(markerOf(publication!, 1, 1)).toBe(8)
    expect(markerOf(publication!, 2, 2)).toBe(7)
  })
})
