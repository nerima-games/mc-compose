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

export type InventoryInteractionTransition<Item, Count extends number = number> = {
  readonly slotIndex: number
  readonly slotBefore: InteractionSlot<Item, Count>
  readonly carriedBefore: InteractionSlot<Item, Count>
  readonly result: InventoryInteractionClickResult<Item, Count>
}

export type InventoryInteractionOptions<Item, Count extends number = number> = {
  readonly canInventoryClick?: (
    transition: Omit<InventoryInteractionTransition<Item, Count>, 'result'>,
  ) => boolean
  readonly onCrafted?: () => void
  readonly onInventoryChanged?: () => void
  readonly onInventoryReset?: () => void
  readonly onInventoryTransition?: (
    transition: InventoryInteractionTransition<Item, Count>,
  ) => void
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
  options: InventoryInteractionOptions<Item, Count> = {},
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
    options.onInventoryReset?.()
    return state()
  }

  const applyInventoryClickResult = (
    slotIndex: number,
    slotBefore: InteractionSlot<Item, Count>,
    carriedBefore: InteractionSlot<Item, Count>,
    result: InventoryInteractionClickResult<Item, Count>,
  ): void => {
    if (
      result._tag !== 'PickedUp' &&
      result._tag !== 'Placed' &&
      result._tag !== 'Merged' &&
      result._tag !== 'Swapped'
    ) return

    current = {
      ...current,
      inventoryCarried: result.carried,
      preview: undefined,
      status: undefined,
    }
    options.onInventoryTransition?.({ slotIndex, slotBefore, carriedBefore, result })
    options.onInventoryChanged?.()
  }

  const returnInventoryCarried = (): Effect.Effect<void> => {
    const carriedBefore = current.inventoryCarried
    if (carriedBefore === undefined) return Effect.void

    return Effect.flatMap(service.snapshot, (inventory) => {
      const matchingSlots: number[] = []
      const emptySlots: number[] = []
      for (let slotIndex = 0; slotIndex < inventory.slots.length; slotIndex += 1) {
        const slot = inventory.slots[slotIndex]
        if (slot === undefined) emptySlots.push(slotIndex)
        else if (slot.item === carriedBefore.item) matchingSlots.push(slotIndex)
      }

      const candidates = [...matchingSlots, ...emptySlots]
      const tryCandidate = (candidateIndex: number): Effect.Effect<void> => {
        if (candidateIndex >= candidates.length) return Effect.void

        const slotIndex = candidates[candidateIndex]!
        const slotBefore = inventory.slots[slotIndex]
        if (options.canInventoryClick?.({ slotIndex, slotBefore, carriedBefore }) === false) {
          return tryCandidate(candidateIndex + 1)
        }

        return Effect.flatMap(service.click({
          _tag: 'LeftClick',
          slotIndex,
          carried: carriedBefore,
        }), (result) => {
          if (result._tag !== 'Placed' && result._tag !== 'Merged') {
            return tryCandidate(candidateIndex + 1)
          }
          applyInventoryClickResult(slotIndex, slotBefore, carriedBefore, result)
          return returnInventoryCarried()
        })
      }

      return tryCandidate(0)
    })
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
    Effect.flatMap(service.snapshot, (inventory) => {
      const carriedBefore = current.inventoryCarried
      const slotBefore = inventory.slots[inventoryIndex]
      if (options.canInventoryClick?.({
        slotIndex: inventoryIndex,
        slotBefore,
        carriedBefore,
      }) === false) return Effect.succeed(state())
      return Effect.map(
        service.click({
          _tag: button === 'left' ? 'LeftClick' : 'RightClick',
          slotIndex: inventoryIndex,
          carried: carriedBefore,
        }),
        (result) => {
          applyInventoryClickResult(inventoryIndex, slotBefore, carriedBefore, result)
          return state()
        },
      )
    })

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

    return Effect.map(returnInventoryCarried(), () => {
      if (current.inventoryCarried !== undefined) return state()
      current = { ...current, carried: oneItem(inventoryCarried) }
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
    return Effect.map(returnInventoryCarried(), () => {
      current = {
        ...current,
        carried: undefined,
        grid: emptyGrid(current.grid.width, current.grid.height),
        preview: undefined,
        status: undefined,
      }
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
