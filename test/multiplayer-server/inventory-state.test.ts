import { describe, expect, it } from 'vitest'

import {
  addStackToInventory,
  cloneInventory,
  cloneStack,
  emptyEquipmentState,
  equipInventoryItem,
  inventorySnapshot,
  moveInventoryStack,
  moveStack,
  swapInventoryStacks,
  swapStacks,
  unequipInventoryItem,
  type EquipmentState,
  type InventoryState,
  type ItemStack,
  type MutableInventoryState,
} from '../../apps/multiplayer-server/inventory-state'

type Durability = { readonly current: number; readonly max: number }

const stack = (item: string, count = 1, durability?: Durability | null): ItemStack => ({
  item,
  count,
  ...(durability === undefined || durability === null ? {} : { durability }),
})

const mutableInventory = (
  slots: Array<ItemStack | null>,
  options: Partial<Pick<MutableInventoryState, 'durability' | 'equipment' | 'selectedSlot'>> = {},
): MutableInventoryState => ({
  slots,
  durability: options.durability ?? slots.map(() => null),
  equipment: options.equipment ?? emptyEquipmentState(),
  selectedSlot: options.selectedSlot ?? 0,
})

const equipment = (overrides: Partial<EquipmentState> = {}): EquipmentState => ({
  ...emptyEquipmentState(),
  ...overrides,
})

describe('inventory state operations', () => {
  it('clones stacks and normalizes inventory durability and equipment', () => {
    const state: InventoryState = {
      slots: [
        stack('stone', 2),
        stack('iron_helmet', 1, { current: 100, max: 165 }),
        stack('iron_chestplate'),
        stack('iron_boots', 1, { current: 999, max: 195 }),
        null,
        stack('not-an-item'),
      ],
      durability: [
        null,
        { current: 1, max: 165 },
        { current: 200, max: 240 },
        null,
        { current: 1, max: 1 },
        null,
      ],
      equipment: {
        head: stack('iron_helmet', 1, { current: 100, max: 165 }),
        chest: stack('iron_chestplate', 2),
        legs: stack('stone'),
        feet: stack('iron_boots', 1, { current: 1, max: 195 }),
        offhand: stack('iron_sword', 1, { current: 0, max: 250 }),
      },
      selectedSlot: 2,
    }

    expect(cloneStack(null)).toBeNull()
    expect(cloneStack(state.slots[0]!)).toEqual(state.slots[0])
    expect(cloneStack(state.slots[0]!)).not.toBe(state.slots[0])

    const cloned = cloneInventory(state)
    expect(cloned.selectedSlot).toBe(2)
    expect(cloned.slots).toEqual([
      stack('stone', 2),
      stack('iron_helmet', 1, { current: 100, max: 165 }),
      stack('iron_chestplate'),
      stack('iron_boots', 1, { current: 999, max: 195 }),
      null,
      stack('not-an-item'),
    ])
    expect(cloned.durability).toEqual([
      null,
      { current: 100, max: 165 },
      { current: 200, max: 240 },
      { current: 195, max: 195 },
      null,
      null,
    ])
    expect(cloned.equipment).toEqual({
      head: stack('iron_helmet', 1, { current: 100, max: 165 }),
      chest: null,
      legs: null,
      feet: stack('iron_boots', 1, { current: 1, max: 195 }),
      offhand: null,
    })

    const noOptionalState = cloneInventory({
      slots: [stack('iron_leggings')],
      selectedSlot: 0,
    } as InventoryState)
    expect(noOptionalState.slots).toEqual([stack('iron_leggings')])
    expect(noOptionalState.durability).toEqual([{ current: 225, max: 225 }])
    expect(noOptionalState.equipment).toEqual(emptyEquipmentState())

    const snapshot = inventorySnapshot(mutableInventory([
      stack('stone'),
      stack('iron_helmet'),
      stack('not-an-item'),
      null,
    ], {
      durability: [
        { current: 1, max: 1 },
        null,
        null,
        null,
      ],
      equipment: equipment({ head: stack('iron_helmet', 1, { current: 5, max: 165 }) }),
    }))
    expect(snapshot.slots).toEqual([
      stack('stone'),
      stack('iron_helmet'),
      stack('not-an-item'),
      null,
    ])
    expect(snapshot.equipment).toEqual(equipment({ head: stack('iron_helmet', 1, { current: 5, max: 165 }) }))
  })

  it('moves stacks only when source, destination, and capacity are valid', () => {
    const sameSlots = [stack('stone')]
    expect(moveStack(sameSlots, 0, sameSlots, 0, 1)).toBe('invalid-command')
    expect(moveStack([stack('stone')], 1, [null], 0, 1)).toBe('invalid-command')
    expect(moveStack([stack('stone')], 0, [null], 1, 1)).toBe('invalid-command')
    expect(moveStack([null], 0, [null], 0, 1)).toBe('insufficient-items')
    expect(moveStack([undefined as unknown as ItemStack], 0, [null], 0, 1)).toBe('insufficient-items')
    expect(moveStack([stack('stone')], 0, [stack('dirt')], 0, 1)).toBe('invalid-command')
    expect(moveStack([stack('stone', 2)], 0, [stack('stone', 63)], 0, 2)).toBe('invalid-command')
    expect(moveStack([stack('not-an-item')], 0, [stack('not-an-item')], 0, 1)).toBeNull()

    const fullSource = [stack('stone', 2)]
    const emptyDestination = [null]
    expect(moveStack(fullSource, 0, emptyDestination, 0, 2)).toBeNull()
    expect(fullSource).toEqual([null])
    expect(emptyDestination).toEqual([stack('stone', 2)])

    const partialSource = [stack('stone', 4)]
    const existingDestination = [stack('stone', 3)]
    expect(moveStack(partialSource, 0, existingDestination, 0, 2)).toBeNull()
    expect(partialSource).toEqual([stack('stone', 2)])
    expect(existingDestination).toEqual([stack('stone', 5)])

    const undefinedDestination = [undefined as unknown as ItemStack]
    expect(moveStack([stack('stone')], 0, undefinedDestination, 0, 1)).toBeNull()
    expect(undefinedDestination).toEqual([stack('stone')])
  })

  it('swaps stacks and preserves inventory durability alignment', () => {
    expect(swapStacks([stack('stone')], 0, 0)).toBe('invalid-command')
    expect(swapStacks([], 0, 0)).toBe('invalid-command')
    expect(swapStacks([stack('stone')], 1, 0)).toBe('invalid-command')
    expect(swapStacks([stack('stone')], 0, 1)).toBe('invalid-command')
    expect(swapStacks([null, stack('stone')], 0, 1)).toBe('insufficient-items')
    expect(swapStacks([undefined as unknown as ItemStack, stack('stone')], 0, 1)).toBe('insufficient-items')

    const slots = [stack('stone'), undefined as unknown as ItemStack]
    expect(swapStacks(slots, 0, 1)).toBeNull()
    expect(slots).toEqual([null, stack('stone')])

    const moved = mutableInventory([stack('stone', 2), stack('dirt')], {
      durability: [null, { current: 1, max: 1 }],
    })
    expect(swapInventoryStacks(moved, 0, 1)).toBeNull()
    expect(moved.slots).toEqual([stack('dirt'), stack('stone', 2)])
    expect(moved.durability).toEqual([{ current: 1, max: 1 }, null])
    expect(swapInventoryStacks(moved, 0, 0)).toBe('invalid-command')
  })

  it('moves inventory durability with the whole stack and leaves it on failed moves', () => {
    const directDurability = mutableInventory([stack('stone', 2), null], {
      durability: [{ current: 1, max: 1 }, null],
    })
    expect(moveInventoryStack(directDurability, 0, 1, 2)).toBeNull()
    expect(directDurability.durability).toEqual([null, { current: 1, max: 1 }])

    const stackDurability = mutableInventory([
      stack('iron_helmet', 2, { current: 100, max: 165 }),
      stack('stone', 1),
    ], { durability: [null, null] })
    expect(moveInventoryStack(stackDurability, 0, 1, 1)).toBe('invalid-command')
    expect(stackDurability.slots).toEqual([
      stack('iron_helmet', 2, { current: 100, max: 165 }),
      stack('stone'),
    ])

    const partial = mutableInventory([stack('stone', 2), stack('stone', 1)], {
      durability: [null, null],
    })
    expect(moveInventoryStack(partial, 0, 1, 1)).toBeNull()
    expect(partial.durability).toEqual([null, null])

    const failed = mutableInventory([null, null])
    expect(moveInventoryStack(failed, 0, 1, 1)).toBe('insufficient-items')
  })

  it('equips and unequips compatible durable items', () => {
    expect(equipInventoryItem(mutableInventory([stack('iron_helmet')]), 1, 'head')).toBe('invalid-command')
    expect(equipInventoryItem(mutableInventory([stack('iron_helmet')], { equipment: equipment({ head: stack('iron_helmet') }) }), 0, 'head')).toBe('invalid-command')
    expect(equipInventoryItem(mutableInventory([null]), 0, 'head')).toBe('insufficient-items')
    expect(equipInventoryItem(mutableInventory([undefined as unknown as ItemStack]), 0, 'head')).toBe('insufficient-items')
    expect(equipInventoryItem(mutableInventory([stack('stone')]), 0, 'head')).toBe('invalid-command')
    expect(equipInventoryItem(mutableInventory([stack('iron_helmet', 2)]), 0, 'head')).toBe('invalid-command')
    expect(equipInventoryItem(mutableInventory([stack('iron_helmet')]), 0, 'chest')).toBe('invalid-command')

    const fromInventoryDurability = mutableInventory([stack('iron_helmet')], {
      durability: [{ current: 5, max: 165 }],
    })
    expect(equipInventoryItem(fromInventoryDurability, 0, 'head')).toBeNull()
    expect(fromInventoryDurability.slots).toEqual([null])
    expect(fromInventoryDurability.durability).toEqual([null])
    expect(fromInventoryDurability.equipment.head).toEqual(stack('iron_helmet', 1, { current: 5, max: 165 }))

    const fromStackDurability = mutableInventory([stack('iron_helmet', 1, { current: 4, max: 165 })], {
      durability: [null],
    })
    expect(equipInventoryItem(fromStackDurability, 0, 'head')).toBeNull()
    expect(fromStackDurability.equipment.head).toEqual(stack('iron_helmet', 1, { current: 4, max: 165 }))

    const fromCatalog = mutableInventory([stack('iron_helmet')], { durability: [undefined as unknown as Durability] })
    expect(equipInventoryItem(fromCatalog, 0, 'head')).toBeNull()
    expect(fromCatalog.equipment.head).toEqual(stack('iron_helmet', 1, { current: 165, max: 165 }))

    const missingDurability = mutableInventory([stack('iron_helmet', 1, null)], { durability: [null] })
    expect(equipInventoryItem(missingDurability, 0, 'head')).toBeNull()
    expect(missingDurability.equipment.head).toEqual(stack('iron_helmet', 1, { current: 165, max: 165 }))

    expect(unequipInventoryItem(mutableInventory([null]), 'head', undefined)).toBe('insufficient-items')
    expect(unequipInventoryItem(mutableInventory([stack('stone')], { equipment: equipment({ head: stack('iron_helmet') }) }), 'head', undefined)).toBe('invalid-command')
    expect(unequipInventoryItem(mutableInventory([null], { equipment: equipment({ head: stack('iron_helmet') }) }), 'head', 1)).toBe('invalid-command')
    expect(unequipInventoryItem(mutableInventory([stack('stone')], { equipment: equipment({ head: stack('iron_helmet') }) }), 'head', 0)).toBe('invalid-command')

    const noSpace = mutableInventory([stack('stone')], { equipment: equipment({ head: stack('iron_helmet') }) })
    expect(unequipInventoryItem(noSpace, 'head', undefined)).toBe('invalid-command')

    const invalidEquipped = mutableInventory([null], { equipment: equipment({ head: stack('stone') }) })
    expect(unequipInventoryItem(invalidEquipped, 'head', 0)).toBe('invalid-command')
    const invalidCount = mutableInventory([null], { equipment: equipment({ head: stack('iron_helmet', 2) }) })
    expect(unequipInventoryItem(invalidCount, 'head', 0)).toBe('invalid-command')
    const invalidSlot = mutableInventory([null], { equipment: equipment({ head: stack('iron_chestplate') }) })
    expect(unequipInventoryItem(invalidSlot, 'head', 0)).toBe('invalid-command')
    const missingEquippedDurability = mutableInventory([null], { equipment: equipment({ head: stack('iron_helmet', 1, null) }) })
    expect(unequipInventoryItem(missingEquippedDurability, 'head', 0)).toBeNull()
    expect(missingEquippedDurability.durability).toEqual([{ current: 165, max: 165 }])

    const explicitDestination = mutableInventory([null, null], {
      equipment: equipment({ head: stack('iron_helmet', 1, { current: 4, max: 165 }) }),
    })
    expect(unequipInventoryItem(explicitDestination, 'head', 1)).toBeNull()
    expect(explicitDestination.equipment.head).toBeNull()
    expect(explicitDestination.slots).toEqual([null, stack('iron_helmet')])
    expect(explicitDestination.durability).toEqual([null, { current: 4, max: 165 }])

    const implicitDestination = mutableInventory([null], {
      equipment: equipment({ head: stack('iron_helmet') }),
    })
    expect(unequipInventoryItem(implicitDestination, 'head', undefined)).toBeNull()
    expect(implicitDestination.slots).toEqual([stack('iron_helmet')])
    expect(implicitDestination.durability).toEqual([{ current: 165, max: 165 }])
  })

  it('adds stack counts to existing and empty slots and returns overflow', () => {
    const invalid = stack('not-an-item', 2)
    expect(addStackToInventory([null], invalid)).toBe(invalid)

    const merged = [null, stack('dirt', 1), stack('stone', 64), stack('stone', 60), null]
    expect(addStackToInventory(merged, stack('stone', 4))).toBeNull()
    expect(merged).toEqual([null, stack('dirt'), stack('stone', 64), stack('stone', 64), null])

    const spread = [stack('stone', 60), null]
    expect(addStackToInventory(spread, stack('stone', 10))).toBeNull()
    expect(spread).toEqual([stack('stone', 64), stack('stone', 6)])

    const exactEmpty = [null]
    expect(addStackToInventory(exactEmpty, stack('stone', 64))).toBeNull()
    expect(exactEmpty).toEqual([stack('stone', 64)])

    const overflow = [stack('stone', 64)]
    expect(addStackToInventory(overflow, stack('stone'))).toEqual(stack('stone'))
  })
})
