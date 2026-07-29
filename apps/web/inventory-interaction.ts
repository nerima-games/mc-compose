import { Effect } from 'effect'

export type InteractionStack<Item, Count extends number = number> = {
  readonly item: Item
  readonly count: Count
}

export type InteractionSlot<Item, Count extends number = number> =
  | InteractionStack<Item, Count>
  | undefined

export type InteractionInventory<Item, Count extends number = number> = {
  readonly slots: ReadonlyArray<InteractionSlot<Item, Count>>
}

export type InteractionCraftGrid<Item, Count extends number = number> = {
  readonly width: number
  readonly height: number
  readonly cells: ReadonlyArray<InteractionSlot<Item, Count>>
}

export type InteractionRecipeMatch<Item, Recipe, Count extends number = number> =
  | {
      readonly _tag: 'Match'
      readonly recipe: Recipe
      readonly output: InteractionStack<Item, Count>
    }
  | { readonly _tag: 'NoMatch' }

export type InteractionCraftResult<Item, Count extends number = number> =
  | {
      readonly _tag: 'Crafted'
      readonly recipeId: string
      readonly output: InteractionStack<Item, Count>
    }
  | { readonly _tag: 'NoMatch' }
  | {
      readonly _tag: 'MissingIngredients'
      readonly missing: ReadonlyArray<{
        readonly item: Item
        readonly short: number
      }>
    }
  | { readonly _tag: 'NoRoom' }

export type InventoryInteractionClick<Item, Count extends number = number> =
  | {
      readonly _tag: 'LeftClick'
      readonly slotIndex: number
      readonly carried: InteractionSlot<Item, Count>
    }
  | {
      readonly _tag: 'RightClick'
      readonly slotIndex: number
      readonly carried: InteractionSlot<Item, Count>
    }

export type InventoryInteractionClickResult<Item, Count extends number = number> = {
  readonly _tag:
    | 'PickedUp'
    | 'Placed'
    | 'Merged'
    | 'Swapped'
    | 'NoChange'
    | 'InvalidSlot'
    | 'InvalidCount'
  readonly carried: InteractionSlot<Item, Count>
}

export type InventoryInteractionService<Item, Recipe, Count extends number = number> = {
  readonly add: (item: Item, count: number) => Effect.Effect<number>
  readonly click: (
    click: InventoryInteractionClick<Item, Count>,
  ) => Effect.Effect<InventoryInteractionClickResult<Item, Count>>
  readonly snapshot: Effect.Effect<InteractionInventory<Item, Count>>
  readonly previewCraft: (
    grid: InteractionCraftGrid<Item, Count>,
  ) => Effect.Effect<InteractionRecipeMatch<Item, Recipe, Count>>
  readonly craft: (
    grid: InteractionCraftGrid<Item, Count>,
  ) => Effect.Effect<InteractionCraftResult<Item, Count>>
}

export type InventoryInteractionState<Item, Recipe, Count extends number = number> = {
  /** Canonical inventory stack held by the pointer. Kept separate from crafting drafts. */
  readonly inventoryCarried: InteractionSlot<Item, Count>
  readonly carried: InteractionSlot<Item, Count>
  readonly grid: InteractionCraftGrid<Item, Count>
  readonly preview: InteractionRecipeMatch<Item, Recipe, Count> | undefined
  readonly status: InteractionCraftResult<Item, Count> | undefined
}

export type InventoryInteractionController<Item, Recipe, Count extends number = number> = {
  readonly state: () => InventoryInteractionState<Item, Recipe, Count>
  readonly configureGrid: (
    width: number,
    height: number,
  ) => InventoryInteractionState<Item, Recipe, Count>
  readonly pickupInventoryItem: (
    inventoryIndex: number,
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly clickInventoryItem: (
    inventoryIndex: number,
    button: 'left' | 'right',
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly interactCraftingCell: (
    cellIndex: number,
  ) => InventoryInteractionState<Item, Recipe, Count>
  readonly interactCraftingCellFromInventory: (
    cellIndex: number,
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly preview: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly craftOnce: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly reset: () => InventoryInteractionState<Item, Recipe, Count>
  readonly close: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
}

export type InventoryInteractionOptions = {
  readonly onCrafted?: () => void
  readonly onInventoryChanged?: () => void
}

const emptyGrid = <Item, Count extends number>(
  width = 2,
  height = 2,
): InteractionCraftGrid<Item, Count> => ({
  width,
  height,
  cells: Array.from({ length: width * height }, () => undefined),
})

const oneItem = <Item, Count extends number>(
  stack: InteractionStack<Item, Count>,
): InteractionStack<Item, Count> => ({
  item: stack.item,
  count: 1 as Count,
})

const cloneState = <Item, Recipe, Count extends number>(
  current: InventoryInteractionState<Item, Recipe, Count>,
): InventoryInteractionState<Item, Recipe, Count> => ({
  ...current,
  grid: { ...current.grid, cells: [...current.grid.cells] },
})

export const createInventoryInteraction = <Item, Recipe, Count extends number = number>(
  service: InventoryInteractionService<Item, Recipe, Count>,
  options: InventoryInteractionOptions = {},
): InventoryInteractionController<Item, Recipe, Count> => {
  let current: InventoryInteractionState<Item, Recipe, Count> = {
    inventoryCarried: undefined,
    carried: undefined,
    grid: emptyGrid(),
    preview: undefined,
    status: undefined,
  }

  const state = (): InventoryInteractionState<Item, Recipe, Count> => cloneState(current)

  const configureGrid = (
    width: number,
    height: number,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new RangeError('Crafting grid dimensions must be positive integers')
    }
    current = {
      inventoryCarried: current.inventoryCarried,
      carried: undefined,
      grid: emptyGrid(width, height),
      preview: undefined,
      status: undefined,
    }
    return state()
  }

  const replaceDraft = (
    patch: Pick<InventoryInteractionState<Item, Recipe, Count>, 'carried' | 'grid'>,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    current = {
      inventoryCarried: current.inventoryCarried,
      ...patch,
      preview: undefined,
      status: undefined,
    }
    return state()
  }

  const reset = (): InventoryInteractionState<Item, Recipe, Count> => {
    current = {
      inventoryCarried: undefined,
      carried: undefined,
      grid: emptyGrid(),
      preview: undefined,
      status: undefined,
    }
    return state()
  }

  const pickupInventoryItem = (
    inventoryIndex: number,
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> =>
    Effect.map(service.snapshot, (inventory) => {
      const selected = inventory.slots[inventoryIndex]
      if (selected === undefined || selected.count <= 0) return state()
      return replaceDraft({ carried: oneItem(selected), grid: current.grid })
    })

  const clickInventoryItem = (
    inventoryIndex: number,
    button: 'left' | 'right',
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> =>
    Effect.map(
      service.click({
        _tag: button === 'left' ? 'LeftClick' : 'RightClick',
        slotIndex: inventoryIndex,
        carried: current.inventoryCarried,
      }),
      (result) => {
        current = {
          ...current,
          inventoryCarried: result.carried,
          preview: undefined,
          status: undefined,
        }
        if (
          result._tag === 'PickedUp' ||
          result._tag === 'Placed' ||
          result._tag === 'Merged' ||
          result._tag === 'Swapped'
        ) {
          options.onInventoryChanged?.()
        }
        return state()
      },
    )

  const interactCraftingCell = (
    cellIndex: number,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= current.grid.cells.length) {
      return state()
    }

    const cells = [...current.grid.cells]
    const occupied = cells[cellIndex]
    cells[cellIndex] = current.carried
    return replaceDraft({
      carried: occupied,
      grid: { ...current.grid, cells },
    })
  }

  const interactCraftingCellFromInventory = (
    cellIndex: number,
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => {
    const inventoryCarried = current.inventoryCarried
    if (inventoryCarried === undefined) {
      return Effect.succeed(interactCraftingCell(cellIndex))
    }
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= current.grid.cells.length) {
      return Effect.succeed(state())
    }

    return Effect.map(service.add(inventoryCarried.item, inventoryCarried.count), (leftover) => {
      if (leftover > 0) {
        current = {
          ...current,
          inventoryCarried: { ...inventoryCarried, count: leftover as Count },
        }
        return state()
      }
      current = {
        ...current,
        inventoryCarried: undefined,
        carried: oneItem(inventoryCarried),
      }
      options.onInventoryChanged?.()
      return interactCraftingCell(cellIndex)
    })
  }

  const preview = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => {
    const grid = current.grid
    return Effect.map(service.previewCraft(grid), (match) => {
      current = { ...current, preview: match, status: undefined }
      return state()
    })
  }

  const craftOnce = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => {
    const grid = current.grid
    return Effect.map(service.craft(grid), (result) => {
      if (result._tag === 'Crafted') {
        current = {
          inventoryCarried: current.inventoryCarried,
          carried: undefined,
          grid: emptyGrid(current.grid.width, current.grid.height),
          preview: undefined,
          status: result,
        }
        options.onCrafted?.()
      } else {
        current = { ...current, status: result }
      }
      return state()
    })
  }

  const close = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => {
    const inventoryCarried = current.inventoryCarried
    if (inventoryCarried === undefined) {
      return Effect.succeed(configureGrid(current.grid.width, current.grid.height))
    }
    return Effect.map(service.add(inventoryCarried.item, inventoryCarried.count), (leftover) => {
      current = {
        inventoryCarried: leftover > 0
          ? { ...inventoryCarried, count: leftover as Count }
          : undefined,
        carried: undefined,
        grid: emptyGrid(current.grid.width, current.grid.height),
        preview: undefined,
        status: undefined,
      }
      options.onInventoryChanged?.()
      return state()
    })
  }

  return {
    state,
    configureGrid,
    pickupInventoryItem,
    clickInventoryItem,
    interactCraftingCell,
    interactCraftingCellFromInventory,
    preview,
    craftOnce,
    reset,
    close,
  }
}
