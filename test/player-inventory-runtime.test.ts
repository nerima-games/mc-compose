import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import type { StackCount } from '@nerima-games/mc-kernel'
import { emptyPlayerStorage, SPAWN_VITALS, type InventoryServiceApi, type PlayerStorage } from '@nerima-games/mc-sim'
import type { ChestStorageSlotTarget } from '@nerima-games/mx-ui'
import type { InventoryInteractionService } from '../apps/web/inventory-interaction'
import { initialPlayerSwimmingRuntimeState } from '../apps/web/player-swimming-runtime'
import { TOUCH_LOOK_CONTROLLER_IDLE } from '../apps/web/touch-input'
import {
  createPlayerUiRuntime,
  type InventoryMode,
  type PlayerUiRuntimeContext,
} from '../apps/web/player-ui-runtime'

class FakeElement {
  hidden = false
  inert = false
  readonly attributes = new Map<string, string>()
  private readonly listeners = new Map<string, EventListener[]>()

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  closest(selector: string): FakeElement | null {
    return selector === '[data-interaction-target="chest-storage-close"]'
      && this.attributes.get('data-interaction-target') === 'chest-storage-close'
      ? this
      : null
  }

  dispatch(type: string, target: FakeElement): void {
    const event = new Event(type)
    Object.defineProperty(event, 'target', { value: target })
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('player inventory runtime', () => {
  it('routes chest close input through the facility command and preserves open state on rejection', () => {
    const body = new FakeElement()
    let pointerLockElement: object | null = null
    const document = {
      body,
      get pointerLockElement() { return pointerLockElement },
      exitPointerLock: vi.fn(() => { pointerLockElement = null }),
    }
    const inventoryParent = new FakeElement()
    const touchControlsParent = new FakeElement()
    const swimmingHud = new FakeElement()
    const canvas = {} as HTMLCanvasElement
    pointerLockElement = canvas
    const requestedFrames: Array<FrameRequestCallback> = []
    const window = {
      requestAnimationFrame: (callback: FrameRequestCallback): number => {
        requestedFrames.push(callback)
        return requestedFrames.length
      },
    }
    let inventoryOpen = false
    let inventoryMode: InventoryMode = 'player'
    let activeChestId: string | undefined = 'chest-42'
    let selectedChest: ChestStorageSlotTarget | undefined
    let facilityCloseAccepted = false
    let closeChestOnFacilityIdle = false
    let chestStatus = ''
    const sendFacilityCommand = vi.fn(() => facilityCloseAccepted)
    const renderCrosshair = vi.fn()
    const resetPrimaryAttackGesture = vi.fn()
    const clearMultiplayerInventorySelection = vi.fn()
    const setFurnaceFocus = vi.fn()
    const setFurnaceStatus = vi.fn()
    const setAnvilName = vi.fn()
    const setAnvilStatus = vi.fn()
    const setEnchantingStatus = vi.fn()
    const makeView = () => ({ root: { style: { setProperty: vi.fn() } }, render: vi.fn() })
    const inventoryView = makeView() as unknown as PlayerUiRuntimeContext<never, never>['inventoryView']
    const furnaceView = makeView() as unknown as PlayerUiRuntimeContext<never, never>['furnaceView']
    const chestView = makeView() as unknown as PlayerUiRuntimeContext<never, never>['chestView']
    const anvilView = makeView() as unknown as PlayerUiRuntimeContext<never, never>['anvilView']
    const enchantingView = makeView() as unknown as PlayerUiRuntimeContext<never, never>['enchantingView']
    const renderHud = vi.fn()
    const inventoryService = {} as InventoryInteractionService<never, never, StackCount>
    const context: PlayerUiRuntimeContext<never, never> = {
      document: document as unknown as Document,
      window,
      canvas,
      inventoryParent: inventoryParent as unknown as HTMLElement,
      touchControlsParent: touchControlsParent as unknown as HTMLElement,
      swimmingHud: swimmingHud as unknown as HTMLElement,
      documentBody: body,
      touchAvailable: false,
      inventoryPresentations: {
        player: { label: 'Player inventory', width: 2, height: 2 },
        craftingTable: { label: 'Crafting', width: 3, height: 3 },
        furnace: { label: 'Furnace', width: 3, height: 1 },
        chest: { label: 'Chest', width: 9, height: 3 },
        anvil: { label: 'Anvil', width: 3, height: 1 },
        enchanting: { label: 'Enchanting', width: 3, height: 1 },
      },
      inventoryView,
      furnaceView,
      chestView,
      anvilView,
      enchantingView,
      inventoryService,
      worldInventory: {} as InventoryServiceApi,
      inventoryStorageSnapshot: Effect.succeed(emptyPlayerStorage() satisfies PlayerStorage),
      getPlayerDimension: () => Effect.succeed('overworld'),
      restorePlayerForDimension: () => Effect.succeed(undefined),
      getOrCreateDimensionChunkContext: (() => ({})) as unknown as PlayerUiRuntimeContext<never, never>['getOrCreateDimensionChunkContext'],
      getPlayerPose: () => Effect.succeed({
        feetPosition: { x: 0, y: 64, z: 0 },
        yawRadians: 0,
        pitchRadians: 0,
      }),
      readBlockAt: () => Effect.succeed({ _tag: 'Unavailable' }),
      getEntitiesForExplosion: () => [],
      setBlockAt: vi.fn(),
      setBlockEffect: () => Effect.succeed(undefined),
      resolveExplosionEffects: vi.fn(),
      getActiveSeed: () => 0,
      endPortalFrames: new Map(),
      endPortalFrameKey: (position) => `${String(position.x)},${String(position.y)},${String(position.z)}`,
      getEndPortalComplete: () => false,
      setEndPortalComplete: vi.fn(),
      getExitPortalMaterialized: () => false,
      getEyeOfEnderRuntimeState: () => ({ nextId: 0, eyes: [] }),
      setEyeOfEnderRuntimeState: vi.fn(),
      getNextEyeOfEnderBreaks: () => undefined,
      setNextEyeOfEnderBreaks: vi.fn(),
      sendEndProgressCommand: vi.fn(() => true),
      alignActiveDimension: vi.fn(),
      queueEndAudio: vi.fn(),
      customNames: new Map(),
      enchantedItems: new Map(),
      audio: { play: vi.fn() },
      getMultiplayer: () => true,
      getPlayerHealthPoints: () => 20,
      getVitalsDamageSnapshot: () => SPAWN_VITALS,
      applyVitalsDamage: vi.fn(),
      restoreVitalsDamage: vi.fn(),
      isCreativeMode: false,
      queuePlayerDamage: vi.fn(),
      handleLocalPlayerDeath: vi.fn(),
      setSwimmingState: vi.fn(),
      resetSimState: vi.fn(),
      getBowInteractionLocked: () => false,
      getPaused: () => false,
      getTouchLookState: () => TOUCH_LOOK_CONTROLLER_IDLE,
      setTouchLookState: vi.fn(),
      clearHeldInput: vi.fn(),
      getSwimmingState: initialPlayerSwimmingRuntimeState,
      getFishingSession: () => undefined,
      setFishingResultState: vi.fn(),
      getInventoryOpen: () => inventoryOpen,
      setInventoryOpenState: (open) => { inventoryOpen = open },
      getInventoryMode: () => inventoryMode,
      setInventoryMode: (mode) => { inventoryMode = mode },
      getActiveChestId: () => activeChestId,
      setActiveChestId: (id) => { activeChestId = id },
      setChestSelected: (target) => { selectedChest = target },
      setChestFocus: vi.fn(),
      setChestStatus: (status) => { chestStatus = status },
      setCloseChestOnFacilityIdle: (close) => { closeChestOnFacilityIdle = close },
      setInventoryFocus: vi.fn(),
      setFurnaceFocus,
      setFurnaceStatus,
      getEquipmentActionStatus: () => '',
      setEquipmentActionStatus: vi.fn(),
      getInventoryDragSource: () => undefined,
      setInventoryDragSource: vi.fn(),
      getMultiplayerInventorySelection: () => null,
      setMultiplayerInventorySelection: vi.fn(),
      hasPendingCrafting: () => false,
      sendInventoryCommand: vi.fn(() => true),
      requestCrafting: vi.fn(),
      requestAnvil: vi.fn(() => true),
      requestEnchanting: vi.fn(() => true),
      moveItemMetadata: vi.fn(),
      equipmentMetadataKey: (slot) => `equipment:${slot}`,
      setEnchantmentSeed: vi.fn(),
      getVitalsSnapshot: () => ({ totalExperience: 0 }),
      getInventorySnapshot: () => Effect.succeed({ slots: [] }),
      restoreVitalsAtExperience: vi.fn(),
      renderHud,
      getTotalExperience: () => 0,
      getExperienceLevel: () => 0,
      getEnchantmentSeed: () => 0,
      getAnvilName: () => '',
      getAnvilStatus: () => '',
      getEnchantingStatus: () => '',
      getChestSelected: () => selectedChest,
      getChestFocus: () => ({ region: 'chest', slot: 0 }),
      getChestStatus: () => chestStatus,
      getFurnaceFocus: () => 'input',
      getFurnaceStatus: () => '',
      getInventoryFocus: () => ({ kind: 'slot', region: 'hotbar', index: 0 }),
      getActiveChestContainer: () => null,
      getActiveFurnaceState: () => undefined,
      getActiveFurnaceKey: () => undefined,
      updateActiveFurnaceState: () => false,
      removeInventoryAt: () => Effect.succeed({ _tag: 'Unavailable' }),
      addInventoryItem: () => Effect.succeed(0),
      transferContainerItem: () => Effect.succeed({ _tag: 'ContainerNotFound' }),
      containerMetadataKey: (containerId, slot) => `${containerId}:${String(slot)}`,
      sameItemMetadata: () => true,
      copyItemMetadata: vi.fn(),
      deleteItemMetadata: vi.fn(),
      setAnvilName,
      setAnvilStatus,
      setEnchantingStatus,
      getSelectedHotbarIndex: () => 0,
      sendFacilityCommand,
      closeTrade: vi.fn(),
      isTradeOpen: () => false,
      closeBrewing: vi.fn(),
      isBrewingOpen: () => false,
      resetPrimaryAttackGesture,
      clearMultiplayerInventorySelection,
      markSessionDirty: vi.fn(),
      getDirtyGeneration: () => 0,
      setDirtyGeneration: vi.fn(),
      getSavedGeneration: () => 0,
      getDebounceTimer: () => undefined,
      setDebounceTimer: vi.fn(),
      scheduleDebounce: vi.fn(() => 1),
      clearDebounce: vi.fn(),
      saveSession: async () => {},
      saveDebounceMs: 1,
      renderCrosshair,
    }

    vi.stubGlobal('Element', FakeElement)
    const runtime = createPlayerUiRuntime(context)
    runtime.installInventoryListeners()
    runtime.setInventoryOpen(true, 'chest')

    expect(inventoryOpen).toBe(true)
    expect(inventoryMode).toBe('chest')
    expect(inventoryParent.hidden).toBe(false)
    expect(inventoryParent.attributes.get('aria-hidden')).toBe('false')
    expect(inventoryParent.attributes.get('aria-label')).toBe('Chest')
    expect(body.attributes.get('data-inventory-open')).toBe('true')
    expect(requestedFrames).toHaveLength(1)
    expect(document.exitPointerLock).toHaveBeenCalledOnce()

    const closeButton = new FakeElement()
    closeButton.setAttribute('data-interaction-target', 'chest-storage-close')
    inventoryParent.dispatch('click', closeButton)

    expect(sendFacilityCommand).toHaveBeenCalledExactlyOnceWith({
      _tag: 'ContainerCommand',
      containerId: 'chest-42',
      action: { _tag: 'close' },
    })
    expect(chestStatus).toBe('Wait for the pending facility action before closing')
    expect(closeChestOnFacilityIdle).toBe(true)
    expect(inventoryOpen).toBe(true)
    expect(inventoryParent.hidden).toBe(false)
    expect(body.attributes.get('data-inventory-open')).toBe('true')

    facilityCloseAccepted = true
    inventoryParent.dispatch('click', closeButton)

    expect(sendFacilityCommand).toHaveBeenNthCalledWith(2, {
      _tag: 'ContainerCommand',
      containerId: 'chest-42',
      action: { _tag: 'close' },
    })
    expect(inventoryOpen).toBe(false)
    expect(inventoryParent.hidden).toBe(true)
    expect(inventoryParent.attributes.get('aria-hidden')).toBe('true')
    expect(body.attributes.get('data-inventory-open')).toBe('false')
    expect(touchControlsParent.hidden).toBe(true)
    expect(touchControlsParent.inert).toBe(true)
    expect(touchControlsParent.attributes.get('aria-hidden')).toBe('true')
    expect(activeChestId).toBeUndefined()
    expect(selectedChest).toBeUndefined()
    expect(clearMultiplayerInventorySelection).toHaveBeenCalledOnce()
    expect(renderHud).toHaveBeenCalledTimes(3)
    expect(chestView.render).toHaveBeenCalledTimes(3)
    expect(renderCrosshair).toHaveBeenCalledTimes(2)
  })
})
