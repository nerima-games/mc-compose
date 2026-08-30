import { chunkKeyOf, type ChunkRef, type DirtyBatch, type DirtySource } from '@nerima-games/mc-render'
import { Effect } from 'effect'

export type BudgetedDirtySource = DirtySource & {
  readonly enqueue: (batch: DirtyBatch) => void
}

export const makeBudgetedDirtySource = (
  source: DirtySource,
  maxUpdatesPerFrame: number,
): BudgetedDirtySource => {
  if (!Number.isInteger(maxUpdatesPerFrame) || maxUpdatesPerFrame < 1) {
    throw new RangeError('maxUpdatesPerFrame must be a positive integer')
  }

  const pendingChanged = new Map<string, ChunkRef>()
  const pendingRemoved = new Map<string, ChunkRef>()
  const merge = (batch: DirtyBatch): void => {
    for (const chunk of batch.removed) {
      const key = chunkKeyOf(chunk)
      pendingChanged.delete(key)
      pendingRemoved.set(key, chunk)
    }
    for (const chunk of batch.changed) {
      const key = chunkKeyOf(chunk)
      pendingRemoved.delete(key)
      pendingChanged.set(key, chunk)
    }
  }

  return {
    drain: Effect.gen(function* () {
      merge(yield* source.drain)
      const removed = [...pendingRemoved.values()].slice(0, maxUpdatesPerFrame)
      for (const chunk of removed) pendingRemoved.delete(chunkKeyOf(chunk))
      const changed = [...pendingChanged.values()].slice(0, maxUpdatesPerFrame - removed.length)
      for (const chunk of changed) pendingChanged.delete(chunkKeyOf(chunk))
      return { changed, removed }
    }),
    enqueue: merge,
  }
}
