import { describe, expect, it } from 'vitest'

import {
  createDroppedItemLifetimeTracker,
  DROPPED_ITEM_LIFETIME_SECS,
} from '../apps/web/dropped-item-lifetime'

describe('dropped item lifetime', () => {
  it('expires an item after 300 cumulative active seconds', () => {
    const tracker = createDroppedItemLifetimeTracker()

    expect(tracker.advance('overworld', 299, ['drop'])).toStrictEqual([])
    expect(tracker.advance('overworld', 1, ['drop'])).toStrictEqual(['drop'])
  })

  it('does not advance a dimension while another dimension is active', () => {
    const tracker = createDroppedItemLifetimeTracker()

    expect(tracker.advance('overworld', 299, ['drop'])).toStrictEqual([])
    expect(tracker.advance('the_nether', DROPPED_ITEM_LIFETIME_SECS, ['drop'])).toStrictEqual([
      'drop',
    ])
    expect(tracker.advance('overworld', 1, ['drop'])).toStrictEqual(['drop'])
  })

  it('forgets removed entities instead of carrying their age to a reused id', () => {
    const tracker = createDroppedItemLifetimeTracker(10)

    expect(tracker.advance('overworld', 9, ['drop'])).toStrictEqual([])
    expect(tracker.advance('overworld', 1, [])).toStrictEqual([])
    expect(tracker.advance('overworld', 1, ['drop'])).toStrictEqual([])
  })

  it('restores and exposes elapsed time for session persistence', () => {
    const tracker = createDroppedItemLifetimeTracker(10)

    tracker.restore('overworld', [{ entityId: 'drop', elapsedSecs: 8 }])

    expect(tracker.elapsed('overworld', 'drop')).toBe(8)
    expect(tracker.advance('overworld', 2, ['drop'])).toStrictEqual(['drop'])
  })
})
