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
  readonly moveCraftingCell: (
    sourceIndex: number,
    targetIndex: number,
  ) => InventoryInteractionState<Item, Recipe, Count>
  readonly interactCraftingCellFromInventory: (
    cellIndex: number,
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly moveCraftingCellToInventory: (
    sourceIndex: number,
    inventoryIndex: number,
  ) => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly preview: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly craftOnce: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
  readonly confirmCraftOnce: () => Effect.Effect<InventoryInteractionState<Item, Recipe, Count>>
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
  readonly consumeCraftingGrid?: boolean
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
  let crafting = false
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
    if (crafting) return state()
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
    if (crafting) return state()
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
      if (crafting) return state()
      const selected = inventory.slots[inventoryIndex]
      if (selected === undefined || selected.count <= 0) return state()
      return replaceDraft({ carried: oneItem(selected), grid: current.grid })
    })

  const clickInventoryItem = (
    inventoryIndex: number,
    button: 'left' | 'right',
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> =>
    Effect.suspend(() => {
      if (crafting) return Effect.succeed(state())
      return Effect.flatMap(service.snapshot, (inventory) => {
        if (crafting) return Effect.succeed(state())
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
            if (crafting) return state()
            applyInventoryClickResult(inventoryIndex, slotBefore, carriedBefore, result)
            return state()
          },
        )
      })
    })

  const interactCraftingCell = (
    cellIndex: number,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    if (crafting) return state()
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

  const moveCraftingCell = (
    sourceIndex: number,
    targetIndex: number,
  ): InventoryInteractionState<Item, Recipe, Count> => {
    if (crafting || current.carried !== undefined || current.inventoryCarried !== undefined) {
      return state()
    }
    if (
      !Number.isInteger(sourceIndex)
      || !Number.isInteger(targetIndex)
      || sourceIndex < 0
      || targetIndex < 0
      || sourceIndex >= current.grid.cells.length
      || targetIndex >= current.grid.cells.length
      || sourceIndex === targetIndex
      || current.grid.cells[sourceIndex] === undefined
    ) return state()

    interactCraftingCell(sourceIndex)
    interactCraftingCell(targetIndex)
    if (current.carried !== undefined) interactCraftingCell(sourceIndex)
    return state()
  }

  const interactCraftingCellFromInventory = (
    cellIndex: number,
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => Effect.suspend(() => {
    if (crafting) return Effect.succeed(state())
    const inventoryCarried = current.inventoryCarried
    if (inventoryCarried === undefined) {
      return Effect.succeed(interactCraftingCell(cellIndex))
    }
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= current.grid.cells.length) {
      return Effect.succeed(state())
    }

    return Effect.map(returnInventoryCarried(), () => {
      if (crafting || current.inventoryCarried !== undefined) return state()
      current = { ...current, carried: oneItem(inventoryCarried) }
      options.onInventoryChanged?.()
      return interactCraftingCell(cellIndex)
    })
  })

  const moveCraftingCellToInventory = (
    sourceIndex: number,
    inventoryIndex: number,
  ): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => Effect.suspend(() => {
    if (crafting || current.carried !== undefined || current.inventoryCarried !== undefined) {
      return Effect.succeed(state())
    }
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= current.grid.cells.length) {
      return Effect.succeed(state())
    }
    const source = current.grid.cells[sourceIndex]
    if (source === undefined) return Effect.succeed(state())

    return Effect.flatMap(service.snapshot, (inventory) => {
      if (crafting || current.carried !== undefined || current.inventoryCarried !== undefined) {
        return Effect.succeed(state())
      }
      const slotBefore = inventory.slots[inventoryIndex]
      if (options.canInventoryClick?.({
        slotIndex: inventoryIndex,
        slotBefore,
        carriedBefore: undefined,
      }) === false) return Effect.succeed(state())

      return Effect.map(service.click({
        _tag: 'LeftClick',
        slotIndex: inventoryIndex,
        carried: source,
      }), (result) => {
        if (
          result._tag !== 'Placed'
          && result._tag !== 'Merged'
          && result._tag !== 'Swapped'
        ) return state()

        current = {
          ...current,
          grid: {
            ...current.grid,
            cells: current.grid.cells.map((cell, index) => index === sourceIndex ? result.carried : cell),
          },
          preview: undefined,
          status: undefined,
        }
        options.onInventoryChanged?.()
        return state()
      })
    })
  })

  const preview = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => Effect.suspend(() => {
    if (crafting) return Effect.succeed(state())
    const grid = current.grid
    return Effect.map(service.previewCraft(grid), (match) => {
      if (crafting) return state()
      current = { ...current, preview: match, status: undefined }
      return state()
    })
  })

  const craftOnce = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> =>
    Effect.suspend(() => {
      if (crafting) return Effect.succeed(state())

      crafting = true
      const grid = current.grid
      return Effect.ensuring(
        Effect.flatMap(service.craft(grid), (result) => {
          if (result._tag !== 'Crafted') {
            current = { ...current, preview: undefined, status: result }
            return Effect.succeed(state())
          }

          current = {
            inventoryCarried: current.inventoryCarried,
            carried: undefined,
            grid: options.consumeCraftingGrid === true
              ? {
                  ...grid,
                  cells: grid.cells.map((cell) => {
                    if (cell === undefined || cell.count <= 1) return undefined
                    return { ...cell, count: (cell.count - 1) as Count }
                  }),
                }
              : grid,
            preview: undefined,
            status: result,
          }
          options.onCrafted?.()

          return Effect.matchCauseEffect(service.previewCraft(current.grid), {
            onFailure: () => Effect.succeed(state()),
            onSuccess: (match) => {
              current = { ...current, preview: match }
              return Effect.succeed(state())
            },
          })
        }),
        Effect.sync(() => {
          crafting = false
        }),
      )
    })

  const confirmCraftOnce = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> =>
    Effect.suspend(() => {
      if (crafting) return Effect.succeed(state())
      crafting = true
      const grid = current.grid
      current = {
        inventoryCarried: current.inventoryCarried,
        carried: undefined,
        grid: options.consumeCraftingGrid === true
          ? { ...grid, cells: grid.cells.map((cell) => cell === undefined || cell.count <= 1 ? undefined : { ...cell, count: (cell.count - 1) as Count }) }
          : grid,
        preview: undefined,
        status: undefined,
      }
      options.onCrafted?.()
      return Effect.ensuring(
        Effect.matchCauseEffect(service.previewCraft(current.grid), {
          onFailure: () => Effect.succeed(state()),
          onSuccess: (match) => Effect.sync(() => {
            current = { ...current, preview: match }
            return state()
          }),
        }),
        Effect.sync(() => { crafting = false }),
      )
    })

  const close = (): Effect.Effect<InventoryInteractionState<Item, Recipe, Count>> => Effect.suspend(() => {
    if (crafting) return Effect.succeed(state())
    const inventoryCarried = current.inventoryCarried
    if (inventoryCarried === undefined) {
      return Effect.succeed(configureGrid(current.grid.width, current.grid.height))
    }
    return Effect.map(returnInventoryCarried(), () => {
      if (crafting) return state()
      current = {
        ...current,
        carried: undefined,
        grid: emptyGrid(current.grid.width, current.grid.height),
        preview: undefined,
        status: undefined,
      }
      return state()
    })
  })

  return {
    state,
    configureGrid,
    pickupInventoryItem,
    clickInventoryItem,
    interactCraftingCell,
    moveCraftingCell,
    interactCraftingCellFromInventory,
    moveCraftingCellToInventory,
    preview,
    craftOnce,
    confirmCraftOnce,
    reset,
    close,
  }
}
