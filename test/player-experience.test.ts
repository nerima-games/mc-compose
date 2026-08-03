import { describe, expect, it } from '@effect/vitest'
import {
  requestPlacementFromSelectedSlot,
  selectedHotbarAfterInput,
  type HotbarAction,
} from '../apps/web/player-experience'

const triggeredBy = (...triggered: ReadonlyArray<HotbarAction>) =>
  (action: HotbarAction): boolean => triggered.includes(action)

const wrap = (current: number, steps: number, size: number): number =>
  ((current + steps) % size + size) % size

describe('hotbar selection adapter', () => {
  it('maps digit actions to their zero-based slots', () => {
    expect(selectedHotbarAfterInput(7, 0, triggeredBy('hotbarSlot1'), wrap)).toBe(0)
    expect(selectedHotbarAfterInput(0, 0, triggeredBy('hotbarSlot9'), wrap)).toBe(8)
  })

  it('wraps multi-step wheel input in either direction', () => {
    expect(selectedHotbarAfterInput(8, 2, triggeredBy(), wrap)).toBe(1)
    expect(selectedHotbarAfterInput(0, -2, triggeredBy(), wrap)).toBe(7)
  })

  it('gives an explicit digit edge priority over wheel input in the same frame', () => {
    expect(selectedHotbarAfterInput(8, 4, triggeredBy('hotbarSlot3'), wrap)).toBe(2)
  })
})

describe('selected slot placement adapter', () => {
  const placeable = (item: string): item is 'stone' => item === 'stone'

  it('does nothing for an empty selected slot', () => {
    const requested: Array<string> = []
    expect(requestPlacementFromSelectedSlot([undefined], 0, placeable, (item) => requested.push(item))).toBe(false)
    expect(requested).toEqual([])
  })

  it('does nothing for an exhausted or non-placeable selected slot', () => {
    const requested: Array<string> = []
    const slots = [
      { item: 'stone', count: 0 },
      { item: 'pickaxe', count: 1 },
    ]

    expect(requestPlacementFromSelectedSlot(slots, 0, placeable, (item) => requested.push(item))).toBe(false)
    expect(requestPlacementFromSelectedSlot(slots, 1, placeable, (item) => requested.push(item))).toBe(false)
    expect(requested).toEqual([])
  })

  it('forwards a placeable item without changing the inventory itself', () => {
    const slots = [{ item: 'stone' as const, count: 2 }]
    const requested: Array<string> = []

    expect(requestPlacementFromSelectedSlot(slots, 0, placeable, (item) => requested.push(item))).toBe(true)
    expect(requested).toEqual(['stone'])
    expect(slots[0]?.count).toBe(2)
  })
})
