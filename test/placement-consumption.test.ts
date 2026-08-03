import { describe, expect, it } from 'vitest'

import { excludeReservedPlacementConsumptions } from '../apps/web/placement-consumption'

describe('excludeReservedPlacementConsumptions', () => {
  it('does not charge a successful atomic placement twice', () => {
    expect(excludeReservedPlacementConsumptions(['stone'], ['stone'])).toEqual([])
  })

  it('subtracts reservations as a multiset while preserving legacy charges', () => {
    expect(
      excludeReservedPlacementConsumptions(
        ['stone', 'dirt', 'stone'],
        ['stone'],
      ),
    ).toEqual(['dirt', 'stone'])
  })

  it('does not suppress unrelated placement charges', () => {
    expect(excludeReservedPlacementConsumptions(['dirt'], ['stone'])).toEqual(['dirt'])
  })
})
