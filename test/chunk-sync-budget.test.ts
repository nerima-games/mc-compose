import type { DirtyBatch, DirtySource } from '@nerima-games/mc-render'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makeBudgetedDirtySource } from '../apps/web/chunk-sync-budget'

const emptyBatch: DirtyBatch = { changed: [], removed: [] }
const chunk = (cx: number, cz: number) => ({ cx, cz })
const sourceFrom = (...batches: ReadonlyArray<DirtyBatch>): DirtySource => {
  let index = 0
  return {
    drain: Effect.sync(() => batches[index++] ?? emptyBatch),
  }
}

const drain = (source: DirtySource): DirtyBatch => Effect.runSync(source.drain)

describe('budgeted chunk dirty source', () => {
  it('requires a positive integer frame budget', () => {
    expect(() => makeBudgetedDirtySource(sourceFrom(), 0)).toThrow(RangeError)
    expect(() => makeBudgetedDirtySource(sourceFrom(), 1.5)).toThrow(RangeError)
  })

  it('prioritizes removals and carries the remaining changes to later frames', () => {
    const source = makeBudgetedDirtySource(sourceFrom({
      changed: [chunk(1, 0), chunk(2, 0), chunk(3, 0)],
      removed: [chunk(4, 0), chunk(5, 0)],
    }), 2)

    expect(drain(source)).toEqual({ removed: [chunk(4, 0), chunk(5, 0)], changed: [] })
    expect(drain(source)).toEqual({ removed: [], changed: [chunk(1, 0), chunk(2, 0)] })
    expect(drain(source)).toEqual({ removed: [], changed: [chunk(3, 0)] })
    expect(drain(source)).toEqual(emptyBatch)
  })

  it('coalesces updates by chunk and lets a later change replace a removal', () => {
    const target = chunk(7, -2)
    const source = makeBudgetedDirtySource(sourceFrom(
      { changed: [target, chunk(8, -2)], removed: [] },
      { changed: [target], removed: [target] },
      { changed: [], removed: [chunk(8, -2)] },
    ), 2)

    expect(drain(source)).toEqual({ removed: [], changed: [target, chunk(8, -2)] })
    expect(drain(source)).toEqual({ removed: [], changed: [target] })
    expect(drain(source)).toEqual({ removed: [chunk(8, -2)], changed: [] })
    expect(drain(source)).toEqual(emptyBatch)
  })

  it('renders chunks loaded before the first source notification', () => {
    const source = makeBudgetedDirtySource(sourceFrom({ changed: [], removed: [] }), 1)

    source.enqueue({ changed: [{ cx: 8, cz: -3 }], removed: [] })

    expect(drain(source)).toEqual({
      changed: [{ cx: 8, cz: -3 }],
      removed: [],
    })
  })
})
