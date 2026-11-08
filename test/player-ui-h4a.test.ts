import { afterEach, describe, expect, it, vi } from 'vitest'
import { hudViewModel } from '@nerima-games/mx-ui'
import { emptyPlayerStorage, itemStack, type PlayerStorage } from '@nerima-games/mc-sim'
import type { EnchantedItem } from '@nerima-games/mx-gameplay'
import type { DroppedItemMetadata } from '../apps/web/dropped-item-metadata'

const mocks = vi.hoisted(() => ({ hudViewModel: vi.fn() }))

vi.mock('@nerima-games/mx-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mx-ui')>()
  return { ...actual, hudViewModel: mocks.hudViewModel }
})

import {
  handleLocalPlayerDeath,
  installPauseControls,
  renderCrosshair,
  renderPlayerHud,
  respawnPlayer,
  type H4aDeathContext,
} from '../apps/web/player-ui-h4a'

class FakeElement {
  hidden = false
  inert = false
  textContent = ''
  readonly attributes = new Map<string, string>()
  readonly listeners = new Map<string, EventListenerOrEventListenerObject>()
  private readonly focusElement: (element: FakeElement) => void

  constructor(focusElement: (element: FakeElement) => void = () => {}) {
    this.focusElement = focusElement
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  focus(): void {
    this.focusElement(this)
  }
}

const emit = (target: FakeElement, type: string, event: Event): void => {
  const listener = target.listeners.get(type)
  if (typeof listener === 'function') listener.call(target, event)
  else listener?.handleEvent(event)
}

describe('H4a player UI', () => {
  afterEach(() => vi.clearAllMocks())

  it('renders a fixed idle crosshair model with no modal open', () => {
    const rendered: Array<unknown> = []
    const getterOrder: Array<string> = []

    renderCrosshair({
      crosshair: { render: (viewModel) => rendered.push(viewModel) },
      getPaused: () => { getterOrder.push('paused'); return false },
      isInventoryOpen: () => { getterOrder.push('inventory'); return false },
      isTradeOpen: () => { getterOrder.push('trade'); return false },
      isBrewingOpen: () => { getterOrder.push('brewing'); return false },
      getMiningProgress: () => { getterOrder.push('mining'); return null },
    }, 0)

    expect(getterOrder).toEqual(['paused', 'inventory', 'trade', 'brewing', 'mining'])
    expect(rendered).toEqual([{ breakProgress: undefined, hit: false }])
  })

  it('renders status effects into the HUD DOM with fixed labels and data', () => {
    const statusEffectsHud = new FakeElement()
    const attributes = new Map<string, string>()
    const documentBody = {
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    }
    const rendered: Array<unknown> = []
    const hudInput: Parameters<typeof hudViewModel>[0] = {
      healthPoints: 17,
      maxHealthPoints: 20,
      hungerPoints: 13,
      maxHungerPoints: 20,
      experienceLevel: 2,
      experienceProgress: 0.375,
      hotbar: [{ itemId: 'stone', count: 4, durability: undefined }],
      selectedHotbarIndex: 1,
    }
    const hudModel: ReturnType<typeof hudViewModel> = {
      dead: false,
      experienceLevelLabel: '2',
      experiencePercent: 37,
      hearts: ['full', 'half'],
      hotbar: [],
      shanks: ['full', 'half'],
    }
    mocks.hudViewModel.mockReturnValue(hudModel)

    renderPlayerHud({
      render: (viewModel) => rendered.push(viewModel),
      getHudInput: () => hudInput,
      getActiveEffects: () => [
        { type: 'speed', remainingSecs: 3.01 },
        { type: 'regeneration', remainingSecs: 1 },
      ],
      statusEffectsHud: statusEffectsHud as unknown as HTMLElement,
      documentBody,
    })

    expect(mocks.hudViewModel).toHaveBeenCalledExactlyOnceWith(hudInput)
    expect(rendered).toEqual([hudModel])
    expect(statusEffectsHud.hidden).toBe(false)
    expect(statusEffectsHud.textContent).toBe('speed: 4s | regeneration: 1s')
    expect(attributes.get('data-status-effects')).toBe('speed:4,regeneration:1')
  })

  it('spawns fixed death drops, transfers metadata, clears storage metadata, restores vitals, and dirties the session', () => {
    const empty = emptyPlayerStorage()
    const inventorySlots = [...empty.inventory.slots]
    inventorySlots[0] = itemStack('diamond_pickaxe', 1)
    inventorySlots[5] = itemStack('stone', 4)
    const storage: PlayerStorage = {
      ...empty,
      inventory: { slots: inventorySlots },
      inventoryDurability: empty.inventoryDurability.map((durability, index) =>
        index === 0 ? { current: 1500, max: 1561 } : durability,
      ),
    }
    const deathPosition = { x: 4.5, y: 65, z: -2.25 }
    const vitals = {
      healthPoints: 6,
      maxHealthPoints: 20,
      hungerPoints: 13,
      maxHungerPoints: 20,
      saturation: 2,
      exhaustion: 1,
      foodTimerSecs: 3,
      totalExperience: 27,
      lastDamageCause: 'fall',
    }
    const customNames = new Map<string, string>([
      ['0', 'Fortune Miner'],
      ['5', 'Stone stash'],
      ['equipment:head', 'Stale helmet name'],
      ['unrelated', 'Keep this'],
    ])
    const enchantedItems = new Map<string, EnchantedItem>([
      ['0', {
        item: 'diamond_pickaxe',
        durability: { current: 1500, max: 1561 },
        enchantments: [{ id: 'fortune', level: 3 }],
      }],
      ['equipment:head', {
        item: 'iron_helmet',
        durability: null,
        enchantments: [{ id: 'protection', level: 2 }],
      }],
      ['unrelated', { item: 'dirt', durability: null, enchantments: [] }],
    ])
    const droppedItemMetadata = new Map<string, DroppedItemMetadata>([
      ['nether:existing-drop', { customName: 'Keep existing drop' }],
    ])
    let spawnedDrops: Parameters<H4aDeathContext['spawnDroppedItems']>[0] = []
    let restoredVitals: Parameters<H4aDeathContext['restoreVitals']>[0] | undefined
    const restoreEmptyStorage = vi.fn()
    const restoreVitals = vi.fn((next: Parameters<H4aDeathContext['restoreVitals']>[0]) => {
      restoredVitals = next
    })
    const setDeathDropDimension = vi.fn()
    const markSessionDirty = vi.fn()

    handleLocalPlayerDeath({
      getPlayerPosition: () => deathPosition,
      getStorageSnapshot: () => storage,
      customNames,
      enchantedItems,
      getFramesTotal: () => 40,
      spawnDroppedItems: (drops) => {
        spawnedDrops = drops
        return [{ id: 'drop-1' }, { id: 'drop-2' }]
      },
      getPlayerDimension: () => 'overworld',
      droppedItemMetadataKey: (dimension, entityId) => `${dimension}:${entityId}`,
      droppedItemMetadata,
      equipmentMetadataKey: (slot) => `equipment:${slot}`,
      restoreEmptyStorage,
      getVitalsSnapshot: () => vitals,
      restoreVitals,
      setDeathDropDimension,
      markSessionDirty,
    })

    expect(spawnedDrops).toStrictEqual([
      {
        item: 'diamond_pickaxe',
        count: 1,
        at: { x: 4.5, y: 65, z: -2.25 },
        durability: { current: 1500, max: 1561 },
        eligibleFromFrame: 41,
      },
      {
        item: 'stone',
        count: 4,
        at: { x: 4.5, y: 65, z: -2.25 },
        durability: null,
        eligibleFromFrame: 41,
      },
    ])
    expect([...droppedItemMetadata.entries()]).toStrictEqual([
      ['nether:existing-drop', { customName: 'Keep existing drop' }],
      ['overworld:drop-1', {
        customName: 'Fortune Miner',
        enchantedItem: {
          item: 'diamond_pickaxe',
          durability: { current: 1500, max: 1561 },
          enchantments: [{ id: 'fortune', level: 3 }],
        },
      }],
      ['overworld:drop-2', { customName: 'Stone stash' }],
    ])
    expect([...customNames.entries()]).toStrictEqual([['unrelated', 'Keep this']])
    expect([...enchantedItems.entries()]).toStrictEqual([
      ['unrelated', { item: 'dirt', durability: null, enchantments: [] }],
    ])
    expect(restoreEmptyStorage).toHaveBeenCalledOnce()
    expect(restoreVitals).toHaveBeenCalledOnce()
    expect(restoredVitals).toStrictEqual({
      healthPoints: 6,
      maxHealthPoints: 20,
      hungerPoints: 13,
      maxHungerPoints: 20,
      saturation: 2,
      exhaustion: 1,
      foodTimerSecs: 3,
      totalExperience: 0,
      lastDamageCause: 'fall',
    })
    expect(setDeathDropDimension).toHaveBeenCalledExactlyOnceWith('overworld')
    expect(markSessionDirty).toHaveBeenCalledOnce()
  })

  it('closes open modals in priority order before toggling pause and restores focus on resume', () => {
    let activeElement: FakeElement | null = null
    let pointerLockElement: HTMLElement | null = null
    let paused = false
    let inventoryOpen = true
    let tradeOpen = true
    let brewingOpen = true
    const order: Array<string> = []
    const body = new FakeElement()
    const documentListeners = new FakeElement()
    const document: {
      readonly body: FakeElement
      activeElement: HTMLElement | null
      pointerLockElement: HTMLElement | null
      readonly addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void
      readonly exitPointerLock: () => void
    } = {
      body,
      activeElement,
      pointerLockElement,
      addEventListener: documentListeners.addEventListener.bind(documentListeners),
      exitPointerLock: vi.fn(() => { pointerLockElement = null }),
    }
    const focus = (element: FakeElement): void => {
      activeElement = element
      document.activeElement = element as unknown as HTMLElement
    }
    const canvas = new FakeElement(focus)
    const gameShell = new FakeElement()
    const pauseOverlay = new FakeElement()
    const resumeButton = new FakeElement(focus)
    const settingsButton = new FakeElement(focus)
    const saveQuitButton = new FakeElement(focus)
    const pauseError = new FakeElement()
    const settingsView = { isOpen: () => false, open: vi.fn() }
    const renderCrosshair = vi.fn(() => order.push('crosshair'))
    const syncTouchControls = vi.fn(() => order.push('touch'))

    installPauseControls({
      document: document as unknown as Document,
      window: { location: { assign: vi.fn() } } as unknown as Pick<Window, 'location'>,
      canvas: canvas as unknown as HTMLCanvasElement,
      gameShell: gameShell as unknown as HTMLElement,
      pauseOverlay: pauseOverlay as unknown as HTMLElement,
      resumeButton: resumeButton as unknown as HTMLButtonElement,
      settingsButton: settingsButton as unknown as HTMLButtonElement,
      saveQuitButton: saveQuitButton as unknown as HTMLButtonElement,
      pauseError: pauseError as unknown as HTMLElement,
      settingsView,
      getPlayerSettings: () => ({}) as never,
      getPaused: () => paused,
      setPaused: (next) => { paused = next; order.push(`paused:${String(next)}`) },
      isBrewingOpen: () => brewingOpen,
      closeBrewing: () => { brewingOpen = false; order.push('close:brewing') },
      isTradeOpen: () => tradeOpen,
      closeTrade: () => { tradeOpen = false; order.push('close:trade') },
      isInventoryOpen: () => inventoryOpen,
      closeInventory: () => { inventoryOpen = false; order.push('close:inventory') },
      resetPrimaryAttackGesture: () => order.push('reset-attack'),
      resetBowUse: () => order.push('reset-bow'),
      renderCrosshair,
      syncTouchControls,
      requestFlush: async () => {},
      drainSettingsWrites: async () => {},
    })

    const sendEscape = (): void => {
      const event = {
        code: 'Escape',
        repeat: false,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Event
      emit(documentListeners, 'keydown', event)
    }

    sendEscape()
    expect(order).toEqual(['close:brewing'])
    sendEscape()
    expect(order).toEqual(['close:brewing', 'close:trade'])
    sendEscape()
    expect(order).toEqual(['close:brewing', 'close:trade', 'close:inventory'])

    pointerLockElement = canvas as unknown as HTMLElement
    document.pointerLockElement = pointerLockElement
    sendEscape()

    expect(paused).toBe(true)
    expect(gameShell.inert).toBe(true)
    expect(pauseOverlay.hidden).toBe(false)
    expect(body.attributes.get('data-session-paused')).toBe('true')
    expect(document.exitPointerLock).toHaveBeenCalledOnce()
    expect(activeElement).toBe(resumeButton)
    expect(order.slice(-5)).toEqual([
      'reset-attack',
      'reset-bow',
      'paused:true',
      'crosshair',
      'touch',
    ])

    emit(resumeButton, 'click', new Event('click'))
    expect(paused).toBe(false)
    expect(pauseOverlay.hidden).toBe(true)
    expect(body.attributes.get('data-session-paused')).toBe('false')
    expect(activeElement).toBe(canvas)
  })

  it('preserves respawn action order and clears a missing bed before restoring the player', () => {
    const order: Array<string> = []
    const record = (name: string) => () => { order.push(name) }

    respawnPlayer({
      resetPrimaryAttackGesture: record('attack'),
      resetBowUse: record('bow'),
      resetProjectileStates: record('projectiles'),
      unmountVehicle: record('vehicle'),
      cancelFishing: record('fishing'),
      resetSwimming: record('swimming'),
      respawnVitals: record('vitals'),
      clearGameplayDeathState: record('death-state'),
      validRespawnLocation: () => { order.push('validate-bed'); return null },
      clearRespawnLocation: record('clear-bed'),
      leaveSleep: record('leave-sleep'),
      restorePlayerForRespawn: (location) => order.push(`restore:${String(location)}`),
      clearDeathDropDimension: record('clear-death-dimension'),
      resetSimState: (physicsEnabled) => order.push(`physics:${String(physicsEnabled)}`),
      setInventoryOpen: (open) => order.push(`inventory:${String(open)}`),
      syncTouchControls: record('touch'),
      renderPlayerUi: record('render-ui'),
      markSessionDirty: record('dirty'),
    })

    expect(order).toEqual([
      'attack',
      'bow',
      'projectiles',
      'vehicle',
      'fishing',
      'swimming',
      'vitals',
      'death-state',
      'validate-bed',
      'clear-bed',
      'leave-sleep',
      'restore:null',
      'clear-death-dimension',
      'physics:true',
      'inventory:false',
      'touch',
      'render-ui',
      'dirty',
    ])
  })
})
