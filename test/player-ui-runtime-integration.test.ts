import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyFurnaceState, itemStack } from '@nerima-games/mc-sim'
import {
  createPlayerUiRuntimeHarness,
} from './helpers/player-ui-runtime-harness'

afterEach(() => vi.unstubAllGlobals())

describe('H4b player UI runtime input paths', () => {
  it('opens and closes the player inventory through the main-owned state callbacks', () => {
    const harness = createPlayerUiRuntimeHarness()

    harness.runtime.setInventoryOpen(true, 'player')

    expect(harness.state.inventoryOpen).toBe(true)
    expect(harness.state.inventoryMode).toBe('player')
    expect(harness.elements.inventoryParent.hidden).toBe(false)
    expect(harness.elements.inventoryParent.getAttribute('aria-hidden')).toBe('false')
    expect(harness.elements.inventoryParent.getAttribute('aria-label')).toBe('Player inventory')
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('true')

    harness.runtime.setInventoryOpen(false)

    expect(harness.state.inventoryOpen).toBe(false)
    expect(harness.elements.inventoryParent.hidden).toBe(true)
    expect(harness.elements.inventoryParent.getAttribute('aria-hidden')).toBe('true')
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('false')
    expect(harness.views.inventoryView.render).toHaveBeenCalledTimes(2)
  })

  it('moves a fixed stack between slots from click input and emits the inventory command', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.addPlayerStack(0, 'iron_ingot', 2)
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'player')
    const source = harness.makeSlot('hotbar', 0)
    const destination = harness.makeSlot('main', 0)

    harness.elements.inventoryParent.dispatch('click', source)

    expect(harness.state.multiplayerInventorySelection).toEqual({ source: 0, remaining: 2, mode: 'all' })
    expect(harness.elements.body.getAttribute('data-equipment-action')).toBe('selecting')
    expect(harness.calls.sendInventoryCommand).not.toHaveBeenCalled()

    harness.elements.inventoryParent.dispatch('click', destination)

    expect(harness.calls.sendInventoryCommand).toHaveBeenCalledExactlyOnceWith({
      _tag: 'move-item',
      source: 0,
      destination: 9,
      count: 2,
    })
    expect(harness.state.multiplayerInventorySelection).toBeNull()
    expect(harness.elements.body.getAttribute('data-equipment-action')).toBe('pending')
  })

  it('routes a shift-click on an armour stack to an equip command', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.addPlayerStack(0, 'iron_helmet', 1)
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'player')
    const helmet = harness.makeSlot('hotbar', 0)

    harness.elements.inventoryParent.dispatch('click', helmet, { shiftKey: true })

    expect(harness.calls.sendInventoryCommand).toHaveBeenCalledExactlyOnceWith({
      _tag: 'equip-item',
      source: 0,
      equipmentSlot: 'head',
    })
    expect(harness.elements.body.getAttribute('data-equipment-action')).toBe('pending')
  })

  it('moves a selected chest stack to the player inventory through the facility command', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.state.activeChestContainer = { slots: [itemStack('diamond', 2)] }
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'chest')
    const chestSlot = harness.makeChestSlot('chest', 0)
    const playerSlot = harness.makeChestSlot('player', 0)

    harness.elements.inventoryParent.dispatch('click', chestSlot)

    expect(harness.state.selectedChest).toEqual({ region: 'chest', slot: 0 })
    expect(harness.state.chestStatus).toBe('Selected diamond')

    harness.elements.inventoryParent.dispatch('click', playerSlot)

    expect(harness.calls.sendFacilityCommand).toHaveBeenCalledExactlyOnceWith({
      _tag: 'ContainerCommand',
      containerId: 'chest-42',
      action: {
        _tag: 'move-item',
        source: { _tag: 'container-slot', slot: 0 },
        destination: { _tag: 'player-slot', slot: 0 },
        count: 2,
      },
    })
    expect(harness.state.selectedChest).toBeUndefined()
    expect(harness.state.chestStatus).toBe('Move pending server approval')
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('true')
  })

  it('closes a chest through the facility command and clears its main-owned state', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'chest')

    harness.runtime.setInventoryOpen(false)

    expect(harness.calls.sendFacilityCommand).toHaveBeenCalledExactlyOnceWith({
      _tag: 'ContainerCommand',
      containerId: 'chest-42',
      action: { _tag: 'close' },
    })
    expect(harness.state.inventoryOpen).toBe(false)
    expect(harness.state.activeChestId).toBeUndefined()
    expect(harness.elements.inventoryParent.hidden).toBe(true)
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('false')
  })

  it('sends furnace input, fuel, and output transfers from their corresponding slots', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.state.activeFurnaceKey = 'furnace-42'
    harness.state.furnaceState = { ...emptyFurnaceState(), output: itemStack('iron_ingot', 2) }
    harness.addPlayerStack(0, 'raw_iron', 2)
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'furnace')

    harness.elements.inventoryParent.dispatch('click', harness.makeFurnaceSlot('input'))
    harness.addPlayerStack(0, 'coal', 2)
    harness.elements.inventoryParent.dispatch('click', harness.makeFurnaceSlot('fuel'))
    harness.elements.inventoryParent.dispatch('click', harness.makeFurnaceSlot('output'))

    expect(harness.calls.sendFacilityCommand.mock.calls).toEqual([
      [{
        _tag: 'FurnaceCommand',
        furnaceId: 'furnace-42',
        action: {
          _tag: 'move-item',
          source: { _tag: 'player-slot', slot: 0 },
          destination: { _tag: 'furnace-slot', slot: 'input' },
          count: 1,
        },
      }],
      [{
        _tag: 'FurnaceCommand',
        furnaceId: 'furnace-42',
        action: {
          _tag: 'move-item',
          source: { _tag: 'player-slot', slot: 0 },
          destination: { _tag: 'furnace-slot', slot: 'fuel' },
          count: 1,
        },
      }],
      [{
        _tag: 'FurnaceCommand',
        furnaceId: 'furnace-42',
        action: {
          _tag: 'take-output',
          source: { _tag: 'furnace-slot', slot: 'output' },
          destination: { _tag: 'player-slot', slot: 0 },
          count: 2,
        },
      }],
    ])
    expect(harness.state.inventoryMode).toBe('furnace')
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('true')
  })

  it('opens the crafting table and routes output activation to the crafting request', () => {
    const harness = createPlayerUiRuntimeHarness()
    harness.addPlayerStack(0, 'oak_planks', 4)
    harness.runtime.installInventoryListeners()
    harness.runtime.setInventoryOpen(true, 'craftingTable')
    const output = harness.makeCraftingOutput()

    harness.elements.inventoryParent.dispatch('click', output)

    expect(harness.state.inventoryOpen).toBe(true)
    expect(harness.state.inventoryMode).toBe('craftingTable')
    expect(harness.elements.inventoryParent.getAttribute('aria-label')).toBe('Crafting')
    expect(harness.elements.body.getAttribute('data-inventory-open')).toBe('true')
    expect(harness.calls.requestCrafting).toHaveBeenCalledOnce()
  })
})
