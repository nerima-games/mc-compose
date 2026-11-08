import { Effect } from 'effect'
import { vi, type Mock } from 'vitest'
import type { StackCount } from '@nerima-games/mc-kernel'
import {
  emptyPlayerStorage,
  itemStack,
  SPAWN_VITALS,
  type FurnaceState,
  type InventoryServiceApi,
  type ItemStack,
  type PlayerStorage,
} from '@nerima-games/mc-sim'
import type { ChestStorageSlotTarget } from '@nerima-games/mx-ui'
import type { InventoryInteractionService } from '../../apps/web/inventory-interaction'
import { initialPlayerSwimmingRuntimeState } from '../../apps/web/player-swimming-runtime'
import { TOUCH_LOOK_CONTROLLER_IDLE } from '../../apps/web/touch-input'
import {
  createPlayerUiRuntime,
  type InventoryMode,
  type PlayerUiRuntime,
  type PlayerUiRuntimeContext,
} from '../../apps/web/player-ui-runtime'

type HarnessItem = ItemStack['item']
type HarnessContext = PlayerUiRuntimeContext<HarnessItem, never>
type HarnessRuntime = PlayerUiRuntime<HarnessItem, never>

type PlayerUiRuntimeHarnessState = {
  inventoryOpen: boolean
  inventoryMode: InventoryMode
  activeChestId: string | undefined
  activeChestContainer: { readonly slots: ReadonlyArray<ItemStack | null> } | null
  selectedChest: ChestStorageSlotTarget | undefined
  chestFocus: ChestStorageSlotTarget
  chestStatus: string
  closeChestOnFacilityIdle: boolean
  furnaceFocus: 'input' | 'fuel' | 'output'
  furnaceStatus: string
  activeFurnaceKey: string | undefined
  furnaceState: FurnaceState | undefined
  selectedHotbarIndex: number
  multiplayer: boolean
  multiplayerInventorySelection: { source: number; remaining: number; mode: 'all' | 'split' } | null
  storage: PlayerStorage
  dirtyGeneration: number
  savedGeneration: number
  debounceTimer: number | undefined
}

type PlayerUiRuntimeHarness = {
  readonly state: PlayerUiRuntimeHarnessState
  readonly context: HarnessContext
  readonly runtime: HarnessRuntime
  readonly elements: {
    readonly body: FakeElement
    readonly document: {
      readonly body: FakeElement
      readonly pointerLockElement: object | null
      readonly exitPointerLock: Mock
    }
    readonly inventoryParent: FakeElement
    readonly touchControlsParent: FakeElement
    readonly swimmingHud: FakeElement
    readonly canvas: HTMLCanvasElement
    readonly requestedFrames: ReadonlyArray<FrameRequestCallback>
  }
  readonly views: {
    readonly inventoryView: PlayerUiRuntimeContext<never, never>['inventoryView']
    readonly furnaceView: PlayerUiRuntimeContext<never, never>['furnaceView']
    readonly chestView: PlayerUiRuntimeContext<never, never>['chestView']
    readonly anvilView: PlayerUiRuntimeContext<never, never>['anvilView']
    readonly enchantingView: PlayerUiRuntimeContext<never, never>['enchantingView']
    readonly renderHud: Mock
  }
  readonly calls: {
    readonly sendFacilityCommand: Mock
    readonly sendInventoryCommand: Mock
    readonly requestCrafting: Mock
  }
  readonly addPlayerStack: (slot: number, item: Parameters<typeof itemStack>[0], count: number) => void
  readonly makeSlot: (region: 'hotbar' | 'main' | 'crafting-grid', index: number) => FakeElement
  readonly makeChestSlot: (region: 'chest' | 'player', slot: number) => FakeElement
  readonly makeFurnaceSlot: (slot: 'input' | 'fuel' | 'output') => FakeElement
  readonly makeCraftingOutput: () => FakeElement
}

export class FakeElement {
  hidden: boolean = false
  inert: boolean = false
  textContent: string = ''
  value: string = ''
  focused: boolean = false
  readonly attributes: Map<string, string> = new Map()
  readonly listeners: Map<string, Array<EventListenerOrEventListenerObject>> = new Map()
  readonly children: Array<FakeElement> = []
  parentElement: FakeElement | null = null
  readonly style: { setProperty: (name: string, value: string) => void } = { setProperty: () => {} }

  get dataset(): DOMStringMap {
    const values: Record<string, string> = {}
    for (const [attribute, value] of this.attributes) {
      if (!attribute.startsWith('data-')) continue
      const key = attribute.slice(5).replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
      values[key] = value
    }
    return values
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  append(child: FakeElement): void {
    child.parentElement = this
    this.children.push(child)
  }

  contains(target: FakeElement): boolean {
    for (let current: FakeElement | null = target; current !== null; current = current.parentElement) {
      if (current === this) return true
    }
    return false
  }

  matches(selector: string): boolean {
    const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)]
    return attributes.length > 0 && attributes.every(([, name, expected]) => {
      const value = this.attributes.get(name ?? '')
      return expected === undefined ? value !== undefined : value === expected
    })
  }

  closest<T extends FakeElement = FakeElement>(selector: string): T | null {
    for (let current: FakeElement | null = this; current !== null; current = current.parentElement) {
      if (current.matches(selector)) return current as T
    }
    return null
  }

  querySelectorAll<T extends Element = Element>(selector: string): NodeListOf<T> {
    const matches: Array<FakeElement> = []
    const visit = (element: FakeElement): void => {
      for (const child of element.children) {
        if (child.matches(selector)) matches.push(child)
        visit(child)
      }
    }
    visit(this)
    return matches as unknown as NodeListOf<T>
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    return this.querySelectorAll<T>(selector)[0] ?? null
  }

  focus(): void {
    this.focused = true
  }

  dispatch(type: string, target: FakeElement, init: Readonly<Record<string, unknown>> = {}): Event {
    const event = new Event(type, { cancelable: true })
    Object.defineProperty(event, 'target', { value: target })
    for (const [key, value] of Object.entries(init)) Object.defineProperty(event, key, { value })
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
    return event
  }
}

export const createPlayerUiRuntimeHarness = (): PlayerUiRuntimeHarness => {
  const state = {
    inventoryOpen: false,
    inventoryMode: 'player' as InventoryMode,
    activeChestId: 'chest-42' as string | undefined,
    activeChestContainer: null as { readonly slots: ReadonlyArray<ReturnType<typeof itemStack> | null> } | null,
    selectedChest: undefined as ChestStorageSlotTarget | undefined,
    chestFocus: { region: 'chest', slot: 0 } as ChestStorageSlotTarget,
    chestStatus: '',
    closeChestOnFacilityIdle: false,
    furnaceFocus: 'input' as 'input' | 'fuel' | 'output',
    furnaceStatus: '',
    activeFurnaceKey: undefined as string | undefined,
    furnaceState: undefined as FurnaceState | undefined,
    selectedHotbarIndex: 0,
    multiplayer: true,
    multiplayerInventorySelection: null as { source: number; remaining: number; mode: 'all' | 'split' } | null,
    storage: emptyPlayerStorage(),
    dirtyGeneration: 0,
    savedGeneration: 0,
    debounceTimer: undefined as number | undefined,
  }
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
  const requestedFrames: Array<FrameRequestCallback> = []
  const window = {
    requestAnimationFrame: (callback: FrameRequestCallback): number => {
      requestedFrames.push(callback)
      return requestedFrames.length
    },
  }
  const makeView = () => ({
    root: { style: { setProperty: vi.fn() } },
    render: vi.fn(),
  })
  const inventoryView = makeView() as unknown as HarnessContext['inventoryView']
  const furnaceView = makeView() as unknown as HarnessContext['furnaceView']
  const chestView = makeView() as unknown as HarnessContext['chestView']
  const anvilView = makeView() as unknown as HarnessContext['anvilView']
  const enchantingView = makeView() as unknown as HarnessContext['enchantingView']
  const renderHud = vi.fn()
  const sendFacilityCommand = vi.fn(() => true)
  const sendInventoryCommand = vi.fn(() => true)
  const requestCrafting = vi.fn()
  const inventoryService: InventoryInteractionService<HarnessItem, never, StackCount> = {
    add: () => Effect.succeed(0),
    click: () => Effect.succeed({ _tag: 'NoChange', carried: undefined }),
    snapshot: Effect.sync(() => ({
      slots: state.storage.inventory.slots.map((stack) => stack ?? undefined),
    })),
    previewCraft: () => Effect.succeed({ _tag: 'NoMatch' }),
    craft: () => Effect.succeed({ _tag: 'NoMatch' }),
  }
  const context: HarnessContext = {
    document: document as unknown as Document,
    window,
    canvas,
    inventoryParent: inventoryParent as unknown as HTMLElement,
    touchControlsParent: touchControlsParent as unknown as HTMLElement,
    swimmingHud: swimmingHud as unknown as HTMLElement,
    documentBody: body as unknown as HTMLElement,
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
    get inventoryStorageSnapshot() { return Effect.sync(() => state.storage) },
    getPlayerDimension: () => Effect.succeed('overworld'),
    restorePlayerForDimension: () => Effect.succeed(undefined),
    getOrCreateDimensionChunkContext: (() => ({})) as unknown as HarnessContext['getOrCreateDimensionChunkContext'],
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
    getMultiplayer: () => state.multiplayer,
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
    getInventoryOpen: () => state.inventoryOpen,
    setInventoryOpenState: (open) => { state.inventoryOpen = open },
    getInventoryMode: () => state.inventoryMode,
    setInventoryMode: (mode) => { state.inventoryMode = mode },
    getActiveChestId: () => state.activeChestId,
    setActiveChestId: (id) => { state.activeChestId = id },
    setChestSelected: (target) => { state.selectedChest = target },
    setChestFocus: (target) => { state.chestFocus = target },
    setChestStatus: (status) => { state.chestStatus = status },
    setCloseChestOnFacilityIdle: (close) => { state.closeChestOnFacilityIdle = close },
    setInventoryFocus: vi.fn(),
    setFurnaceFocus: (slot) => { state.furnaceFocus = slot },
    setFurnaceStatus: (status) => { state.furnaceStatus = status },
    getEquipmentActionStatus: () => '',
    setEquipmentActionStatus: vi.fn(),
    getInventoryDragSource: () => undefined,
    setInventoryDragSource: vi.fn(),
    getMultiplayerInventorySelection: () => state.multiplayerInventorySelection,
    setMultiplayerInventorySelection: (selection) => { state.multiplayerInventorySelection = selection },
    hasPendingCrafting: () => false,
    sendInventoryCommand,
    requestCrafting,
    requestAnvil: vi.fn(() => true),
    requestEnchanting: vi.fn(() => true),
    moveItemMetadata: vi.fn(),
    equipmentMetadataKey: (slot) => `equipment:${slot}`,
    setEnchantmentSeed: vi.fn(),
    getVitalsSnapshot: () => ({ totalExperience: 0 }),
    getInventorySnapshot: () => Effect.sync(() => state.storage.inventory),
    restoreVitalsAtExperience: vi.fn(),
    setAnvilName: vi.fn(),
    setAnvilStatus: vi.fn(),
    setEnchantingStatus: vi.fn(),
    getSelectedHotbarIndex: () => state.selectedHotbarIndex,
    renderHud,
    getTotalExperience: () => 0,
    getExperienceLevel: () => 0,
    getEnchantmentSeed: () => 0,
    getAnvilName: () => '',
    getAnvilStatus: () => '',
    getEnchantingStatus: () => '',
    getChestSelected: () => state.selectedChest,
    getChestFocus: () => state.chestFocus,
    getChestStatus: () => state.chestStatus,
    getFurnaceFocus: () => state.furnaceFocus,
    getFurnaceStatus: () => state.furnaceStatus,
    getInventoryFocus: () => ({ kind: 'slot', region: 'hotbar', index: 0 }),
    getActiveChestContainer: () => state.activeChestContainer,
    transferContainerItem: () => Effect.succeed({ _tag: 'ContainerNotFound' }),
    containerMetadataKey: (containerId, slot) => `${containerId}:${String(slot)}`,
    sameItemMetadata: () => true,
    copyItemMetadata: vi.fn(),
    deleteItemMetadata: vi.fn(),
    getActiveFurnaceState: () => state.furnaceState,
    getActiveFurnaceKey: () => state.activeFurnaceKey,
    removeInventoryAt: () => Effect.succeed({ _tag: 'Unavailable' }),
    addInventoryItem: () => Effect.succeed(0),
    updateActiveFurnaceState: (furnace) => {
      if (state.activeFurnaceKey === undefined) return false
      state.furnaceState = furnace
      return true
    },
    sendFacilityCommand,
    closeTrade: vi.fn(),
    isTradeOpen: () => false,
    closeBrewing: vi.fn(),
    isBrewingOpen: () => false,
    resetPrimaryAttackGesture: vi.fn(),
    clearMultiplayerInventorySelection: () => { state.multiplayerInventorySelection = null },
    markSessionDirty: vi.fn(),
    getDirtyGeneration: () => state.dirtyGeneration,
    setDirtyGeneration: (generation) => { state.dirtyGeneration = generation },
    getSavedGeneration: () => state.savedGeneration,
    getDebounceTimer: () => state.debounceTimer,
    setDebounceTimer: (timer) => { state.debounceTimer = timer },
    scheduleDebounce: vi.fn(() => 1),
    clearDebounce: vi.fn(),
    saveSession: async () => {},
    saveDebounceMs: 1,
    renderCrosshair: vi.fn(),
  }

  vi.stubGlobal('Element', FakeElement)
  const runtime = createPlayerUiRuntime(context)
  const addPlayerStack = (slot: number, item: Parameters<typeof itemStack>[0], count: number): void => {
    const inventory = [...state.storage.inventory.slots]
    inventory[slot] = itemStack(item, count)
    state.storage = { ...state.storage, inventory: { ...state.storage.inventory, slots: inventory } }
  }
  const makeSlot = (region: 'hotbar' | 'main' | 'crafting-grid', index: number): FakeElement => {
    const group = new FakeElement()
    group.setAttribute('data-region', region)
    inventoryParent.append(group)
    const slot = new FakeElement()
    slot.setAttribute('role', 'button')
    slot.setAttribute('data-mx-ui', 'slot')
    slot.setAttribute('data-slot-index', String(index))
    group.append(slot)
    return slot
  }
  const makeChestSlot = (region: 'chest' | 'player', slot: number): FakeElement => {
    const target = new FakeElement()
    target.setAttribute('data-interaction-target', 'chest-storage-slot')
    target.setAttribute('data-interaction-region', region)
    target.setAttribute('data-interaction-slot', String(slot))
    inventoryParent.append(target)
    return target
  }
  const makeFurnaceSlot = (slot: 'input' | 'fuel' | 'output'): FakeElement => {
    const target = new FakeElement()
    target.setAttribute('data-interaction-target', 'furnace-slot')
    target.setAttribute('data-interaction-slot', slot)
    inventoryParent.append(target)
    return target
  }
  const makeCraftingOutput = (): FakeElement => {
    const target = new FakeElement()
    target.setAttribute('role', 'button')
    target.setAttribute('data-mx-ui', 'crafting-output')
    inventoryParent.append(target)
    return target
  }

  return {
    state,
    context,
    runtime,
    elements: { body, document, inventoryParent, touchControlsParent, swimmingHud, canvas, requestedFrames },
    views: { inventoryView, furnaceView, chestView, anvilView, enchantingView, renderHud },
    calls: { sendFacilityCommand, sendInventoryCommand, requestCrafting },
    addPlayerStack,
    makeSlot,
    makeChestSlot,
    makeFurnaceSlot,
    makeCraftingOutput,
  }
}

export const makeChestCloseButton = (): FakeElement => {
  const closeButton = new FakeElement()
  closeButton.setAttribute('data-interaction-target', 'chest-storage-close')
  return closeButton
}
