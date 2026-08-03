export const DROPPED_ITEM_LIFETIME_SECS = 300

export type DroppedItemLifetimeTracker = {
  readonly elapsed: (dimension: string, entityId: string) => number
  readonly restore: (
    dimension: string,
    entries: ReadonlyArray<{ readonly entityId: string; readonly elapsedSecs: number }>,
  ) => void
  readonly advance: (
    dimension: string,
    deltaSecs: number,
    entityIds: ReadonlyArray<string>,
  ) => ReadonlyArray<string>
}

export const createDroppedItemLifetimeTracker = (
  lifetimeSecs = DROPPED_ITEM_LIFETIME_SECS,
): DroppedItemLifetimeTracker => {
  const elapsedByDimension = new Map<string, Map<string, number>>()

  return {
    elapsed: (dimension, entityId) => elapsedByDimension.get(dimension)?.get(entityId) ?? 0,
    restore: (dimension, entries) => {
      elapsedByDimension.set(
        dimension,
        new Map(entries.map(({ entityId, elapsedSecs }) => [entityId, Math.max(0, elapsedSecs)])),
      )
    },
    advance: (dimension, deltaSecs, entityIds) => {
      const elapsedByEntity = elapsedByDimension.get(dimension) ?? new Map<string, number>()
      elapsedByDimension.set(dimension, elapsedByEntity)
      const present = new Set(entityIds)
      for (const entityId of elapsedByEntity.keys()) {
        if (!present.has(entityId)) elapsedByEntity.delete(entityId)
      }

      const expired: string[] = []
      for (const entityId of present) {
        const elapsedSecs = (elapsedByEntity.get(entityId) ?? 0) + deltaSecs
        if (elapsedSecs >= lifetimeSecs) {
          elapsedByEntity.delete(entityId)
          expired.push(entityId)
        } else {
          elapsedByEntity.set(entityId, elapsedSecs)
        }
      }
      return expired
    },
  }
}
