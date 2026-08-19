import { describe, expect, it } from 'vitest'
import {
  emptyPlayerStorage,
  itemStack,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import {
  applyAnvilOperation,
  planAnvilOperation,
  spendExperienceLevels,
} from '../apps/multiplayer-shared/anvil-repair'

const storageWith = (
  entries: ReadonlyArray<readonly [number, Parameters<typeof itemStack>[0], number, PlayerStorage['inventoryDurability'][number]]>,
): PlayerStorage => {
  const storage = emptyPlayerStorage()
  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  for (const [slotIndex, item, count, durability] of entries) {
    slots[slotIndex] = itemStack(item, count)
    inventoryDurability[slotIndex] = durability
  }
  return { ...storage, inventory: { slots }, inventoryDurability }
}

describe('planAnvilOperation', () => {
  it('uses the kernel repair plan and reports its material and level costs', () => {
    const plan = planAnvilOperation({
      item: 'diamond_pickaxe',
      durability: { current: 17, max: 1561 },
      material: { item: 'iron_ingot', count: 2 },
      name: '',
      currentName: null,
    })

    expect(plan).toMatchObject({ ok: true, levelCost: 1, materialCost: 1 })
    if (!plan.ok) return
    expect(plan.output.durability).toEqual({ current: 1561, max: 1561 })
  })

  it('supports rename-only operations without a repair material', () => {
    const plan = planAnvilOperation({
      item: 'stone',
      durability: null,
      name: 'Polished Stone',
      currentName: null,
    })

    expect(plan).toMatchObject({ ok: true, levelCost: 1, materialCost: 0 })
    if (!plan.ok) return
    expect(String(plan.output.customName)).toBe('Polished Stone')
  })
})

describe('applyAnvilOperation', () => {
  it('consumes one iron and restores the selected item to its catalog maximum', () => {
    const storage = storageWith([
      [3, 'diamond_pickaxe', 1, { current: 17, max: 1561 }],
      [8, 'iron_ingot', 2, null],
    ])

    const repaired = applyAnvilOperation(storage, 3, { name: '', currentName: null })

    expect(repaired?.storage.inventory.slots[8]).toEqual(itemStack('iron_ingot', 1))
    expect(repaired?.storage.inventoryDurability[3]).toEqual({ current: 1561, max: 1561 })
    expect(storage.inventoryDurability[3]).toEqual({ current: 17, max: 1561 })
  })

  it('supports renaming a non-damageable item without consuming repair material', () => {
    const storage = storageWith([
      [0, 'stone', 1, null],
      [1, 'iron_ingot', 1, null],
    ])

    const result = applyAnvilOperation(storage, 0, { name: 'Polished Stone', currentName: null })

    expect(result?.storage.inventory.slots[0]).toEqual(itemStack('stone', 1))
    expect(String(result?.output.customName)).toBe('Polished Stone')
    expect(result?.storage.inventory.slots[1]).toEqual(itemStack('iron_ingot', 1))
  })

  it('does not consume the selected iron stack when renaming it', () => {
    const onlyIron = storageWith([[0, 'iron_ingot', 2, null]])

    expect(
      applyAnvilOperation(onlyIron, 0, { name: 'Named Iron', currentName: null })
        ?.storage.inventory.slots[0],
    ).toEqual(itemStack('iron_ingot', 2))
  })

  it('rejects missing inputs without changing storage', () => {
    const empty = emptyPlayerStorage()
    const noIron = storageWith([[0, 'iron_sword', 1, { current: 10, max: 250 }]])

    expect(applyAnvilOperation(empty, 0, { name: 'New Name', currentName: null })).toBeUndefined()
    expect(applyAnvilOperation(noIron, 0, { name: '', currentName: null })).toBeUndefined()
    expect(noIron.inventoryDurability[0]).toEqual({ current: 10, max: 250 })
  })

  it('does not consume iron when repair and rename are both no-ops', () => {
    const storage = storageWith([
      [0, 'stone', 1, null],
      [1, 'iron_ingot', 1, null],
    ])

    expect(applyAnvilOperation(storage, 0, { name: '', currentName: null })).toBeUndefined()
    expect(storage.inventory.slots[1]).toEqual(itemStack('iron_ingot', 1))
  })
})

describe('spendExperienceLevels', () => {
  it('spends one level while retaining progress within the level', () => {
    expect(spendExperienceLevels(11, 1)).toBe(3)
  })

  it('spends exactly the boundary level and floors at level zero', () => {
    expect(spendExperienceLevels(7, 1)).toBe(0)
  })

  it('rejects a cost above the current level', () => {
    expect(spendExperienceLevels(6, 1)).toBeUndefined()
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1])(
    'rejects invalid total experience %s',
    (totalExperience) => {
      expect(spendExperienceLevels(totalExperience, 1)).toBeUndefined()
    },
  )

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0.5])(
    'rejects invalid level cost %s',
    (levels) => {
      expect(spendExperienceLevels(7, levels)).toBeUndefined()
    },
  )
})
