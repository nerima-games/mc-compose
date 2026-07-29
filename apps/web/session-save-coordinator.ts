import { chunkSnapshotOf, type Chunk } from '@nerima-games/mc-worldgen'

export type SessionSavePublication<State> = {
  readonly state: State
  readonly chunks: ReadonlyArray<Chunk>
}

export type SessionSaveCoordinator = {
  readonly retainChunk: (chunk: Chunk) => void
  readonly requestSave: () => Promise<void>
  readonly knownChunkCount: () => number
  readonly retainedChunkCount: () => number
}

export type SessionSaveCoordinatorOptions<State> = {
  readonly initialKnownChunks: Iterable<Chunk>
  readonly snapshotResidents: () => Promise<ReadonlyArray<Chunk>>
  readonly snapshotState: () => State
  readonly publish: (publication: SessionSavePublication<State>) => Promise<void>
  readonly onPublished?: () => void
  readonly onFailure?: (error: unknown) => void
}

const coordId = (chunk: Chunk): string => `${String(chunk.coord.cx)},${String(chunk.coord.cz)}`

export const createSessionSaveCoordinator = <State>(
  options: SessionSaveCoordinatorOptions<State>,
): SessionSaveCoordinator => {
  let knownChunks = new Map(
    [...options.initialKnownChunks].map((chunk) => [coordId(chunk), chunkSnapshotOf(chunk)]),
  )
  const retainedChunks = new Map<
    string,
    { readonly chunk: Chunk; readonly version: number }
  >()
  let retainedVersion = 0
  let saveRunning = false
  let savePending = false
  let saveWaiters: Array<{ readonly resolve: () => void; readonly reject: (error: unknown) => void }> = []

  const retainChunk = (chunk: Chunk): void => {
    retainedChunks.set(coordId(chunk), {
      chunk: chunkSnapshotOf(chunk),
      version: ++retainedVersion,
    })
  }

  const publishOnce = async (): Promise<void> => {
    const retainedCapture = [...retainedChunks.entries()]
    const residents = await options.snapshotResidents()
    const merged = new Map<string, Chunk>()
    for (const [key, chunk] of knownChunks) merged.set(key, chunkSnapshotOf(chunk))
    for (const [key, retained] of retainedCapture) {
      merged.set(key, chunkSnapshotOf(retained.chunk))
    }
    for (const chunk of residents) merged.set(coordId(chunk), chunkSnapshotOf(chunk))

    await options.publish({ state: options.snapshotState(), chunks: [...merged.values()] })

    knownChunks = new Map(
      [...merged.entries()].map(([key, chunk]) => [key, chunkSnapshotOf(chunk)]),
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
