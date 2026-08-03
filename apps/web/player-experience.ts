export const HOTBAR_ACTIONS = [
  'hotbarSlot1',
  'hotbarSlot2',
  'hotbarSlot3',
  'hotbarSlot4',
  'hotbarSlot5',
  'hotbarSlot6',
  'hotbarSlot7',
  'hotbarSlot8',
  'hotbarSlot9',
] as const

export type HotbarAction = (typeof HOTBAR_ACTIONS)[number]

export const selectedHotbarAfterInput = (
  current: number,
  wheelSteps: number,
  wasTriggered: (action: HotbarAction) => boolean,
  wrapSelection: (current: number, steps: number, size: number) => number,
): number => {
  const directSelection = HOTBAR_ACTIONS.findIndex(wasTriggered)
  return directSelection >= 0
    ? directSelection
    : wrapSelection(current, wheelSteps, HOTBAR_ACTIONS.length)
}

type Slot<Item> =
  | {
      readonly item: Item
      readonly count: number
    }
  | undefined

export const requestPlacementFromSelectedSlot = <Item, PlaceableItem extends Item>(
  slots: ReadonlyArray<Slot<Item>>,
  selectedHotbarIndex: number,
  isPlaceable: (item: Item) => item is PlaceableItem,
  requestPlacement: (item: PlaceableItem) => void,
): boolean => {
  const selected = slots[selectedHotbarIndex]
  if (selected === undefined || selected.count <= 0 || !isPlaceable(selected.item)) {
    return false
  }

  requestPlacement(selected.item)
  return true
}
