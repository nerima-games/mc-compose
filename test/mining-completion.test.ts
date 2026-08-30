import { describe, expect, it } from 'vitest'

import {
  EMPTY_BLOCK_BREAK_COUNTERS,
  observeBlockBreakCompletion,
  recordBlockBreakRequest,
} from '../apps/web/mining-completion'

describe('block break counters', () => {
  it('records requests without changing completion observations', () => {
    const requested = recordBlockBreakRequest(EMPTY_BLOCK_BREAK_COUNTERS)

    expect(requested).toEqual({ requested: 1, completed: 0 })
  })

  it('waits while the expected block remains or cannot be observed', () => {
    const requested = recordBlockBreakRequest(EMPTY_BLOCK_BREAK_COUNTERS)

    expect(observeBlockBreakCompletion(requested, 17, 17)).toBe(requested)
    expect(observeBlockBreakCompletion(requested, 17, undefined)).toBe(requested)
  })

  it('records one completion when the observed block changes', () => {
    const requested = recordBlockBreakRequest(EMPTY_BLOCK_BREAK_COUNTERS)

    expect(observeBlockBreakCompletion(requested, 17, 0))
      .toEqual({ requested: 1, completed: 1 })
  })
})
