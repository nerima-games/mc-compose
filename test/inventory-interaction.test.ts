import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  emptyInventory,
  itemStack,
  makeInventoryService,
  type Inventory,
} from '@nerima-games/mc-sim'

import {
  createInventoryInteraction,
  type InventoryInteractionClick,
  type InteractionCraftGrid,
  type InteractionCraftResult,
  type InteractionInventory,
  type InteractionRecipeMatch,
} from '../apps/web/inventory-interaction'

type Item = 'oak_log' | 'oak_planks' | 'stone'

type Recipe = {
  readonly id: string
}

const logs: InteractionInventory<Item> = {
  slots: [{ item: 'oak_log', count: 4 }, undefined],
}

const noMatch: InteractionRecipeMatch<Item, Recipe> = { _tag: 'NoMatch' }

const makeService = (options: {
  readonly inventory?: InteractionInventory<Item>
  readonly preview?: InteractionRecipeMatch<Item, Recipe>
  readonly craft?: InteractionCraftResult<Item>
} = {}) => {
  const inventory = options.inventory ?? logs
  const previewCalls: Array<InteractionCraftGrid<Item>> = []
  const craftCalls: Array<InteractionCraftGrid<Item>> = []
  return {
    inventory,
    previewCalls,
    craftCalls,
    service: {
      add: (_item: Item, _count: number) => Effect.succeed(0),
      click: (click: InventoryInteractionClick<Item>) =>
        Effect.succeed({ _tag: 'NoChange' as const, carried: click.carried }),
      snapshot: Effect.succeed(inventory),
      previewCraft: (grid: InteractionCraftGrid<Item>) =>
        Effect.sync(() => {
          previewCalls.push(grid)
          return options.preview ?? noMatch
        }),
      craft: (grid: InteractionCraftGrid<Item>) =>
        Effect.sync(() => {
          craftCalls.push(grid)
          return options.craft ?? ({ _tag: 'NoMatch' } as const)
        }),
    },
  }
}

const placeLog = (
  interaction: ReturnType<typeof createInventoryInteraction<Item, Recipe>>,
  cell: number,
): void => {
  Effect.runSync(interaction.pickupInventoryItem(0))
  interaction.interactCraftingCell(cell)
}

describe('inventory interaction', () => {
  it('drafts four logs and previews a match without mutating canonical inventory', () => {
    const match: InteractionRecipeMatch<Item, Recipe> = {
      _tag: 'Match',
      recipe: { id: 'oak_planks' },
      output: { item: 'oak_planks', count: 4 },
    }
    const fixture = makeService({ preview: match })
    const interaction = createInventoryInteraction(fixture.service)

    for (let cell = 0; cell < 4; cell += 1) placeLog(interaction, cell)
    const previewed = Effect.runSync(interaction.preview())

    expect(previewed.grid.cells).toEqual(
      Array.from({ length: 4 }, () => ({ item: 'oak_log', count: 1 })),
    )
    expect(previewed.preview).toEqual(match)
    expect(fixture.previewCalls).toHaveLength(1)
    expect(fixture.inventory).toEqual(logs)
  })

  it('clears the draft and marks dirty once after a successful craft', () => {
    let dirtyCount = 0
    const crafted: InteractionCraftResult<Item> = {
      _tag: 'Crafted',
      recipeId: 'oak_planks',
      output: { item: 'oak_planks', count: 4 },
    }
    const fixture = makeService({ craft: crafted })
    const interaction = createInventoryInteraction(fixture.service, {
      onCrafted: () => { dirtyCount += 1 },
    })
    placeLog(interaction, 0)

    const result = Effect.runSync(interaction.craftOnce())

    expect(fixture.craftCalls).toHaveLength(1)
    expect(result.grid.cells).toEqual([undefined, undefined, undefined, undefined])
    expect(result.carried).toBeUndefined()
    expect(result.status).toEqual(crafted)
    expect(dirtyCount).toBe(1)
  })

  it.each<InteractionCraftResult<Item>>([
    { _tag: 'NoMatch' },
    { _tag: 'MissingIngredients', missing: [{ item: 'oak_log', short: 1 }] },
    { _tag: 'NoRoom' },
  ])('retains the draft after $_tag', (failure) => {
    const fixture = makeService({ craft: failure })
    const interaction = createInventoryInteraction(fixture.service)
    placeLog(interaction, 0)
    Effect.runSync(interaction.pickupInventoryItem(0))
    const before = interaction.state()

    const result = Effect.runSync(interaction.craftOnce())

    expect(fixture.craftCalls).toHaveLength(1)
    expect(result.grid).toEqual(before.grid)
    expect(result.carried).toEqual(before.carried)
    expect(result.status).toEqual(failure)
  })

  it('resets all transient state on close', () => {
    const fixture = makeService({ preview: noMatch })
    const interaction = createInventoryInteraction(fixture.service)
    placeLog(interaction, 0)
    Effect.runSync(interaction.pickupInventoryItem(0))
    Effect.runSync(interaction.preview())

    const closed = Effect.runSync(interaction.close())

    expect(closed).toEqual({
      inventoryCarried: undefined,
      carried: undefined,
      grid: {
        width: 2,
        height: 2,
        cells: [undefined, undefined, undefined, undefined],
      },
      preview: undefined,
      status: undefined,
    })
  })

  it('uses canonical left-click pickup, placement, merging, and swapping', () => {
    const initial: Inventory = {
      slots: [
        itemStack('stone', 60),
        itemStack('stone', 10),
        itemStack('dirt', 7),
        ...emptyInventory().slots.slice(3),
      ],
    }
    const service = Effect.runSync(makeInventoryService(initial))
    const interaction = createInventoryInteraction(service)

    expect(Effect.runSync(interaction.clickInventoryItem(1, 'left')).inventoryCarried)
      .toEqual(itemStack('stone', 10))
    expect(Effect.runSync(interaction.clickInventoryItem(0, 'left')).inventoryCarried)
      .toEqual(itemStack('stone', 6))
    expect(Effect.runSync(service.snapshot).slots[0]).toEqual(itemStack('stone', 64))

    expect(Effect.runSync(interaction.clickInventoryItem(2, 'left')).inventoryCarried)
      .toEqual(itemStack('dirt', 7))
    expect(Effect.runSync(service.snapshot).slots[2]).toEqual(itemStack('stone', 6))

    expect(Effect.runSync(interaction.clickInventoryItem(3, 'left')).inventoryCarried)
      .toBeUndefined()
    expect(Effect.runSync(service.snapshot).slots[3]).toEqual(itemStack('dirt', 7))
  })

  it('uses canonical right-click half pickup and one-item placement', () => {
    const initial: Inventory = {
      slots: [itemStack('stone', 5), ...emptyInventory().slots.slice(1)],
    }
    const service = Effect.runSync(makeInventoryService(initial))
    const interaction = createInventoryInteraction(service)

    expect(Effect.runSync(interaction.clickInventoryItem(0, 'right')).inventoryCarried)
      .toEqual(itemStack('stone', 3))
    expect(Effect.runSync(service.snapshot).slots[0]).toEqual(itemStack('stone', 2))

    expect(Effect.runSync(interaction.clickInventoryItem(1, 'right')).inventoryCarried)
      .toEqual(itemStack('stone', 2))
    expect(Effect.runSync(service.snapshot).slots[1]).toEqual(itemStack('stone', 1))
  })

  it('returns a real carried stack before creating a one-item crafting draft', () => {
    const initial: Inventory = {
      slots: [itemStack('oak_log', 4), ...emptyInventory().slots.slice(1)],
    }
    const service = Effect.runSync(makeInventoryService(initial))
    const interaction = createInventoryInteraction(service)

    Effect.runSync(interaction.clickInventoryItem(0, 'left'))
    const drafted = Effect.runSync(interaction.interactCraftingCellFromInventory(0))

    expect(drafted.inventoryCarried).toBeUndefined()
    expect(drafted.grid.cells[0]).toEqual(itemStack('oak_log', 1))
    expect(Effect.runSync(service.snapshot).slots[0]).toEqual(itemStack('oak_log', 4))
  })

  it('returns a real carried stack to canonical inventory on close', () => {
    const initial: Inventory = {
      slots: [itemStack('stone', 3), ...emptyInventory().slots.slice(1)],
    }
    const service = Effect.runSync(makeInventoryService(initial))
    const interaction = createInventoryInteraction(service)

    Effect.runSync(interaction.clickInventoryItem(0, 'left'))
    const closed = Effect.runSync(interaction.close())

    expect(closed.inventoryCarried).toBeUndefined()
    expect(Effect.runSync(service.snapshot).slots[0]).toEqual(itemStack('stone', 3))
  })

  it('picks up an occupied cell and swaps it with a carried item', () => {
    const fixture = makeService({
      inventory: {
        slots: [
          { item: 'oak_log', count: 4 },
          { item: 'stone', count: 2 },
        ],
      },
    })
    const interaction = createInventoryInteraction(fixture.service)
    placeLog(interaction, 0)

    const pickedUp = interaction.interactCraftingCell(0)
    expect(pickedUp.carried).toEqual({ item: 'oak_log', count: 1 })
    expect(pickedUp.grid.cells[0]).toBeUndefined()

    interaction.interactCraftingCell(0)
    Effect.runSync(interaction.pickupInventoryItem(1))
    const swapped = interaction.interactCraftingCell(0)
    expect(swapped.grid.cells[0]).toEqual({ item: 'stone', count: 1 })
    expect(swapped.carried).toEqual({ item: 'oak_log', count: 1 })
  })
})
