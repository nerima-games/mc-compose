import { describe, expect, it } from 'vitest'
import {
  advanceBowUse,
  IDLE_BOW_USE,
  takeBowSettlement,
  type BowUseState,
} from '../apps/web/bow-use'

const advance = (state: BowUseState, overrides: Partial<Parameters<typeof advanceBowUse>[0]> = {}) =>
  advanceBowUse({
    state,
    useTriggered: false,
    useHeld: false,
    cancelled: false,
    selectedItem: 'bow',
    selectedSlotIndex: 2,
    arrowCount: 1,
    elapsedSecs: 0.1,
    ...overrides,
  })

describe('advanceBowUse', () => {
  it('starts only from a triggered bow use with an available arrow', () => {
    expect(advance(IDLE_BOW_USE, { useTriggered: true, useHeld: true }).state).toEqual({
      _tag: 'Drawing',
      bowSlotIndex: 2,
      chargeSecs: 0.1,
    })
    expect(advance(IDLE_BOW_USE, {
      useTriggered: true,
      useHeld: true,
      selectedItem: 'stone',
    }).state).toEqual(IDLE_BOW_USE)
    expect(advance(IDLE_BOW_USE, {
      useTriggered: true,
      useHeld: true,
      arrowCount: 0,
    })).toEqual({ state: IDLE_BOW_USE, release: null, capturedUse: true })
  })

  it('captures a trigger that is released before the frame and emits a zero-charge shot', () => {
    expect(advance(IDLE_BOW_USE, {
      useTriggered: true,
      useHeld: false,
    })).toEqual({
      state: IDLE_BOW_USE,
      release: { bowSlotIndex: 2, chargeSecs: 0 },
      capturedUse: true,
    })
  })

  it('accumulates held time while retaining the captured bow slot', () => {
    const drawing: BowUseState = { _tag: 'Drawing', bowSlotIndex: 2, chargeSecs: 0.4 }
    expect(advance(drawing, {
      useHeld: true,
      selectedSlotIndex: 7,
      elapsedSecs: 0.25,
    }).state).toEqual({ _tag: 'Drawing', bowSlotIndex: 2, chargeSecs: 0.65 })
  })

  it('emits one release on the held-to-released transition', () => {
    const drawing: BowUseState = { _tag: 'Drawing', bowSlotIndex: 4, chargeSecs: 0.8 }
    const released = advance(drawing)
    expect(released.release).toEqual({ bowSlotIndex: 4, chargeSecs: 0.8 })
    expect(advance(released.state).release).toBeNull()
  })

  it('cancels without releasing', () => {
    const drawing: BowUseState = { _tag: 'Drawing', bowSlotIndex: 1, chargeSecs: 1 }
    expect(advance(drawing, { cancelled: true })).toEqual({
      state: IDLE_BOW_USE,
      release: null,
      capturedUse: true,
    })
  })
})

describe('takeBowSettlement', () => {
  it('settles a fired request and removes it before returning', () => {
    const result = takeBowSettlement(
      new Map([['bow-1', { bowSlotIndex: 3 }]]),
      { requestId: 'bow-1', success: true, outcome: 'Fired' },
    )
    expect(result.fired).toEqual({ bowSlotIndex: 3 })
    expect(result.pending.size).toBe(0)
  })

  it.each(['Undercharged', 'DuplicateRequest'])('%s removes the request without settlement', (outcome) => {
    const result = takeBowSettlement(
      new Map([['bow-1', { bowSlotIndex: 3 }]]),
      { requestId: 'bow-1', success: false, outcome },
    )
    expect(result.fired).toBeNull()
    expect(result.pending.size).toBe(0)
  })

  it('ignores unknown and already-taken request ids', () => {
    const first = takeBowSettlement(
      new Map([['bow-1', { bowSlotIndex: 3 }]]),
      { requestId: 'bow-1', success: true, outcome: 'Fired' },
    )
    const duplicate = takeBowSettlement(
      first.pending,
      { requestId: 'bow-1', success: true, outcome: 'Fired' },
    )
    expect(duplicate.fired).toBeNull()
    expect(duplicate.pending.size).toBe(0)
  })
})
