import { chunkSnapshotOf } from '@nerima-games/mc-worldgen'

import type { DimensionChunk } from './session-persistence'

export type SessionSavePublication<State> = {
  readonly state: State
  readonly chunks: ReadonlyArray<DimensionChunk>
}

export type SessionSaveCoordinator = {
  readonly retainChunk: (chunk: DimensionChunk) => void
  readonly requestSave: () => Promise<void>
  readonly knownChunkCount: () => number
  readonly retainedChunkCount: () => number
}

export type SessionSaveCoordinatorOptions<State> = {
  readonly initialKnownChunks: Iterable<DimensionChunk>
  readonly snapshotResidents: () => Promise<ReadonlyArray<DimensionChunk>>
  readonly snapshotState: () => State
  readonly publish: (publication: SessionSavePublication<State>) => Promise<void>
  readonly onPublished?: () => void
  readonly onFailure?: (error: unknown) => void
}

const coordId = ({ dimension, chunk }: DimensionChunk): string =>
  `${dimension}:${String(chunk.coord.cx)},${String(chunk.coord.cz)}`

const dimensionChunkSnapshotOf = ({ dimension, chunk }: DimensionChunk): DimensionChunk => ({
  dimension,
  chunk: chunkSnapshotOf(chunk),
})

export const createSessionSaveCoordinator = <State>(
  options: SessionSaveCoordinatorOptions<State>,
): SessionSaveCoordinator => {
  let knownChunks = new Map(
    [...options.initialKnownChunks].map((chunk) => [coordId(chunk), dimensionChunkSnapshotOf(chunk)]),
  )
  const retainedChunks = new Map<
    string,
    { readonly chunk: DimensionChunk; readonly version: number }
  >()
  let retainedVersion = 0
  let saveRunning = false
  let savePending = false
  let saveWaiters: Array<{ readonly resolve: () => void; readonly reject: (error: unknown) => void }> = []

  const retainChunk = (chunk: DimensionChunk): void => {
    retainedChunks.set(coordId(chunk), {
      chunk: dimensionChunkSnapshotOf(chunk),
      version: ++retainedVersion,
    })
  }

  const publishOnce = async (): Promise<void> => {
    const retainedCapture = [...retainedChunks.entries()]
    const residents = await options.snapshotResidents()
    const merged = new Map<string, DimensionChunk>()
    for (const [key, chunk] of knownChunks) merged.set(key, dimensionChunkSnapshotOf(chunk))
    for (const [key, retained] of retainedCapture) {
      merged.set(key, dimensionChunkSnapshotOf(retained.chunk))
    }
    for (const chunk of residents) merged.set(coordId(chunk), dimensionChunkSnapshotOf(chunk))

    await options.publish({ state: options.snapshotState(), chunks: [...merged.values()] })

    knownChunks = new Map(
      [...merged.entries()].map(([key, chunk]) => [key, dimensionChunkSnapshotOf(chunk)]),
    )
    for (const [key, captured] of retainedCapture) {
      if (retainedChunks.get(key)?.version === captured.version) retainedChunks.delete(key)
    }
    options.onPublished?.()
  }

  const drainSaves = async (): Promise<void> => {
    if (saveRunning) return
    saveRunning = true
    try {
      while (savePending) {
        savePending = false
        const batch = saveWaiters
        saveWaiters = []
        try {
          await publishOnce()
          for (const waiter of batch) waiter.resolve()
        } catch (error: unknown) {
          options.onFailure?.(error)
          for (const waiter of batch) waiter.reject(error)
        }
      }
    } finally {
      saveRunning = false
      if (savePending) void drainSaves()
    }
  }

  const requestSave = (): Promise<void> =>
    new Promise((resolve, reject) => {
      saveWaiters.push({ resolve, reject })
      savePending = true
      void drainSaves()
    })

  return {
    retainChunk,
    requestSave,
    knownChunkCount: () => knownChunks.size,
    retainedChunkCount: () => retainedChunks.size,
  }
}
