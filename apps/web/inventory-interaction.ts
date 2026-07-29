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

export type InventoryInteractionService<Item, Recipe, Count extends number = number> = {
  readonly snapshot: Effect.Effect<InteractionInventory<Item, Count>>
  readonly previewCraft: (
    grid: InteractionCraftGrid<Item, Count>,
  ) => Effect.Effect<InteractionRecipeMatch<Item, Recipe, Count>>
  readonly craft: (
    grid: InteractionCraftGrid<Item, Count>,
  ) => Effect.Effect<InteractionCraftResult<Item, Count>>
}

export type InventoryInteractionState<Item, Recipe, Count extends number = number> = {
  readonly carried: InteractionSlot<Item, Count>
  readonly grid: InteractionCraftGrid<Item, Count>
  readonly preview: InteractionRecipeMatch<Item, Recipe, Count> | undefined
  readonly status: InteractionCraftResult<Item, Count> | undefined
}

export type InventoryInteractionController<Item, Recipe, Count extends number = number> = {
  readonly state: () => InventoryInteractionState<Item, Recipe, Count>
  readonly pickupInventoryItem: (
    inventoryIndex: number,
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly interactCraftingCell: (
    cellIndex: number,
  ) => InventoryInteractionState<Item, Recipe, Count>
  readonly preview: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly craftOnce: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly reset: () => InventoryInteractionState<Item, Recipe, Count>
  readonly close: () => InventoryInteractionState<Item, Recipe, Count>
}

export type InventoryInteractionOptions = {
  readonly onCrafted?: () => void
}

const EMPTY_CELLS = 4

const emptyGrid = <Item, Count extends number>(): InteractionCraftGrid<Item, Count> => ({
  width: 2,
  height: 2,
  cells: Array.from({ length: EMPTY_CELLS }, () => undefined),
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
    carried: undefined,
    grid: emptyGrid(),
    preview: undefined,
    status: undefined,
  }

  const state = (): InventoryInteractionState<Item, Recipe, Count> => cloneState(current)

  const replaceDraft = (
    patch: Pick<InventoryInteractionState<Item, Recipe, Count>, 'carried' | 'grid'>,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    current = {
      ...patch,
      preview: undefined,
      status: undefined,
    }
    return state()
  }

  const reset = (): InventoryInteractionState<Item, Recipe, Count> => {
    current = {
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

  const interactCraftingCell = (
    cellIndex: number,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= EMPTY_CELLS) {
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
          carried: undefined,
          grid: emptyGrid(),
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

  return {
    state,
    pickupInventoryItem,
    interactCraftingCell,
    preview,
    craftOnce,
    reset,
    close: reset,
  }
}
