import { describe, expect, it } from 'vitest'
import { frameDeltas } from '../apps/web/frame-timing'

describe('frame timing', () => {
  it('keeps normal frame time identical for simulation and interactions', () => {
    expect(frameDeltas(0.016)).toStrictEqual({ simulation: 0.016, interaction: 0.016 })
  })

  it('bounds simulation time while preserving elapsed interaction time', () => {
    expect(frameDeltas(1)).toStrictEqual({ simulation: 0.05, interaction: 1 })
  })

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('normalizes invalid or negative elapsed time: %s', (raw) => {
    expect(frameDeltas(raw)).toStrictEqual({ simulation: 0.001, interaction: 0 })
  })
})
