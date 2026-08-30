import {
  isItemType,
  maxStackCountOfItem,
} from '@nerima-games/mc-kernel'
import {
  durabilityForItem,
  equipmentDefinitionFor,
  isValidDurabilityForItem,
} from '@nerima-games/mc-sim'
import type {
  AuthoritativeSnapshot,
  CommandRejectionReason,
} from '@nerima-games/mx-multiplayer'

export type InventoryState = AuthoritativeSnapshot['inventories'][number]['state']
export type ItemStack = NonNullable<InventoryState['slots'][number]>
export type EquipmentState = NonNullable<InventoryState['equipment']>
export type EquipmentSlot = keyof EquipmentState
export type MutableEquipmentState = { -readonly [Slot in EquipmentSlot]: EquipmentState[Slot] }

export interface MutableInventoryState {
  readonly slots: Array<ItemStack | null>
  readonly durability: Array<{ readonly current: number; readonly max: number } | null>
  readonly equipment: MutableEquipmentState
  selectedSlot: number
}

export const cloneStack = (stack: ItemStack | null): ItemStack | null =>
  stack === null ? null : { ...stack }

export const emptyEquipmentState = (): EquipmentState => ({
  head: null,
  chest: null,
  legs: null,
  feet: null,
  offhand: null,
})

const cloneEquipmentStack = (stack: ItemStack | null, slot: EquipmentSlot): ItemStack | null => {
  if (stack === null || !isItemType(stack.item) || stack.count !== 1 || equipmentDefinitionFor(stack.item)?.slot !== slot) return null
  const durability = stack.durability ?? durabilityForItem(stack.item)
  return durability === null || !isValidDurabilityForItem(stack.item, durability)
    ? null
    : { ...stack, durability: { ...durability } }
}

const cloneEquipment = (equipment: InventoryState['equipment']): EquipmentState => ({
  head: cloneEquipmentStack(equipment?.head ?? null, 'head'),
  chest: cloneEquipmentStack(equipment?.chest ?? null, 'chest'),
  legs: cloneEquipmentStack(equipment?.legs ?? null, 'legs'),
  feet: cloneEquipmentStack(equipment?.feet ?? null, 'feet'),
  offhand: cloneEquipmentStack(equipment?.offhand ?? null, 'offhand'),
})

export const cloneInventory = (state: InventoryState): MutableInventoryState => ({
  slots: state.slots.map(cloneStack),
  durability: state.slots.map((stack, index) => {
    const durability = stack?.durability ?? state.durability?.[index]
    if (stack === null || !isItemType(stack.item)) return null
    return durability !== undefined && isValidDurabilityForItem(stack.item, durability)
      ? { ...durability }
      : durabilityForItem(stack.item)
  }),
  equipment: cloneEquipment(state.equipment),
  selectedSlot: state.selectedSlot,
})

export const inventorySnapshot = (state: MutableInventoryState): InventoryState => ({
  slots: state.slots.map((stack, index) => {
    const durability = state.durability[index]
    return stack !== null && isItemType(stack.item) && durability !== null && durability !== undefined && isValidDurabilityForItem(stack.item, durability)
      ? { ...stack, durability: { ...durability } }
      : cloneStack(stack)
  }),
  selectedSlot: state.selectedSlot,
  equipment: cloneEquipment(state.equipment),
})

export const moveStack = (
  sourceSlots: Array<ItemStack | null>,
  sourceIndex: number,
  destinationSlots: Array<ItemStack | null>,
  destinationIndex: number,
  count: number,
): CommandRejectionReason | null => {
  if (sourceSlots === destinationSlots && sourceIndex === destinationIndex) return 'invalid-command'
  if (sourceIndex >= sourceSlots.length || destinationIndex >= destinationSlots.length) return 'invalid-command'
  const source = sourceSlots[sourceIndex]
  if (source === null || source === undefined || source.count < count) return 'insufficient-items'
  const destination = destinationSlots[destinationIndex]
  if (destination !== null && destination !== undefined && destination.item !== source.item) return 'invalid-command'
  if (
    destination !== null
    && destination !== undefined
    && isItemType(source.item)
    && destination.count + count > maxStackCountOfItem(source.item)
  ) return 'invalid-command'
  sourceSlots[sourceIndex] = source.count === count ? null : { ...source, count: source.count - count }
  destinationSlots[destinationIndex] = destination === null || destination === undefined
    ? { ...source, count }
    : { ...destination, count: destination.count + count }
  return null
}

export const swapStacks = (
  slots: Array<ItemStack | null>,
  sourceIndex: number,
  destinationIndex: number,
): CommandRejectionReason | null => {
  if (sourceIndex === destinationIndex) return 'invalid-command'
  if (sourceIndex >= slots.length || destinationIndex >= slots.length) return 'invalid-command'
  if (slots[sourceIndex] === null || slots[sourceIndex] === undefined) return 'insufficient-items'
  const source = slots[sourceIndex]
  slots[sourceIndex] = slots[destinationIndex] ?? null
  slots[destinationIndex] = source
  return null
}

export const moveInventoryStack = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  destinationIndex: number,
  count: number,
): CommandRejectionReason | null => {
  const sourceDurability =
    inventory.durability[sourceIndex] ?? inventory.slots[sourceIndex]?.durability ?? null
  const reason = moveStack(inventory.slots, sourceIndex, inventory.slots, destinationIndex, count)
  if (reason === null && inventory.slots[sourceIndex] === null) {
    inventory.durability[sourceIndex] = null
    inventory.durability[destinationIndex] = sourceDurability
  }
  return reason
}

export const swapInventoryStacks = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  destinationIndex: number,
): CommandRejectionReason | null => {
  const reason = swapStacks(inventory.slots, sourceIndex, destinationIndex)
  if (reason === null) {
    const sourceDurability = inventory.durability[sourceIndex] ?? null
    inventory.durability[sourceIndex] = inventory.durability[destinationIndex] ?? null
    inventory.durability[destinationIndex] = sourceDurability
  }
  return reason
}

export const equipInventoryItem = (
  inventory: MutableInventoryState,
  sourceIndex: number,
  equipmentSlot: EquipmentSlot,
): CommandRejectionReason | null => {
  if (sourceIndex >= inventory.slots.length || inventory.equipment[equipmentSlot] !== null) return 'invalid-command'
  const source = inventory.slots[sourceIndex]
  if (source === null || source === undefined) return 'insufficient-items'
  if (!isItemType(source.item) || source.count !== 1 || equipmentDefinitionFor(source.item)?.slot !== equipmentSlot) return 'invalid-command'
  const durability =
    inventory.durability[sourceIndex] ?? source.durability ?? durabilityForItem(source.item)
  if (durability === null) return 'invalid-command'
  inventory.slots[sourceIndex] = null
  inventory.durability[sourceIndex] = null
  inventory.equipment[equipmentSlot] = { item: source.item, count: 1, durability: { ...durability } }
  return null
}

export const unequipInventoryItem = (
  inventory: MutableInventoryState,
  equipmentSlot: EquipmentSlot,
  destinationIndex: number | undefined,
): CommandRejectionReason | null => {
  const equipped = inventory.equipment[equipmentSlot]
  if (equipped === null) return 'insufficient-items'
  const destination = destinationIndex ?? inventory.slots.findIndex((stack) => stack === null)
  if (destination < 0 || destination >= inventory.slots.length || inventory.slots[destination] !== null) return 'invalid-command'
  if (!isItemType(equipped.item) || equipped.count !== 1 || equipmentDefinitionFor(equipped.item)?.slot !== equipmentSlot) return 'invalid-command'
  const durability = equipped.durability ?? durabilityForItem(equipped.item)
  if (durability === null) return 'invalid-command'
  inventory.equipment[equipmentSlot] = null
  inventory.slots[destination] = { item: equipped.item, count: 1 }
  inventory.durability[destination] = { ...durability }
  return null
}

/** Adds as much of a stack as possible and returns only the unplaceable remainder. */
export const addStackToInventory = (slots: Array<ItemStack | null>, stack: ItemStack): ItemStack | null => {
  if (!isItemType(stack.item)) return stack
  let remaining = stack.count
  const maxStackCount = maxStackCountOfItem(stack.item)
  for (const [index, current] of slots.entries()) {
    if (current === null || current.item !== stack.item || current.count >= maxStackCount) continue
    const added = Math.min(maxStackCount - current.count, remaining)
    slots[index] = { ...current, count: current.count + added }
    remaining -= added
    if (remaining === 0) return null
  }
  for (const [index, current] of slots.entries()) {
    if (current !== null) continue
    const added = Math.min(maxStackCount, remaining)
    slots[index] = { ...stack, count: added }
    remaining -= added
    if (remaining === 0) return null
  }
  return { ...stack, count: remaining }
}
