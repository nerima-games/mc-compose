import { addExperience as addVitalsExperience, EQUIPMENT_SLOTS } from '@nerima-games/mc-sim'
import {
  crosshairViewModel,
  hudViewModel,
} from '@nerima-games/mx-ui'
import {
  miningProgressFraction,
  spawnDroppedItems as spawnDroppedItemsForWorld,
  type EnchantedItem,
  type MiningProgressState,
} from '@nerima-games/mx-gameplay'
import { deathDropsFromPlayerStorage } from './player-death'
import { type DroppedItemMetadata } from './dropped-item-metadata'
import { type PlayerSettingsV1 } from './settings'
import { type SessionState } from './session-persistence'
import { type SleepLocation } from './sleep-runtime'

type CrosshairView = {
  readonly render: (viewModel: ReturnType<typeof crosshairViewModel>) => void
}

export type H4aCrosshairContext = {
  readonly crosshair: CrosshairView
  readonly getPaused: () => boolean
  readonly isInventoryOpen: () => boolean
  readonly isTradeOpen: () => boolean
  readonly isBrewingOpen: () => boolean
  readonly getMiningProgress: () => MiningProgressState | null
}

export const renderCrosshair = (
  context: H4aCrosshairContext,
  nowSecs: number,
): void => {
  const modals: Parameters<typeof crosshairViewModel>[0]['modals'] =
    context.getPaused() ? ['pause'] : context.isInventoryOpen() || context.isTradeOpen() || context.isBrewingOpen() ? ['inventory'] : []
  const miningProgress = context.getMiningProgress()
  context.crosshair.render(crosshairViewModel({
    modals,
    lastHitAtSecs: undefined,
    breakProgress: miningProgress === null ? undefined : miningProgressFraction(miningProgress),
  }, nowSecs))
}

type StatusEffectView = {
  readonly type: string
  readonly remainingSecs: number
}

export type H4aHudContext = {
  readonly render: (viewModel: ReturnType<typeof hudViewModel>) => void
  readonly getHudInput: () => Parameters<typeof hudViewModel>[0]
  readonly getActiveEffects: () => ReadonlyArray<StatusEffectView>
  readonly statusEffectsHud: Pick<HTMLElement, 'hidden' | 'textContent'>
  readonly documentBody: Pick<HTMLElement, 'setAttribute'>
}

export const renderPlayerHud = (context: H4aHudContext): void => {
  context.render(hudViewModel(context.getHudInput()))
  const activeEffects = context.getActiveEffects()
  context.statusEffectsHud.hidden = activeEffects.length === 0
  context.statusEffectsHud.textContent = activeEffects
    .map((effect) => `${effect.type}: ${Math.ceil(effect.remainingSecs)}s`)
    .join(' | ')
  context.documentBody.setAttribute('data-status-effects', activeEffects
    .map((effect) => `${effect.type}:${Math.ceil(effect.remainingSecs)}`)
    .join(','))
}

type SpawnDrop = Parameters<typeof spawnDroppedItemsForWorld>[1][number]
type EquipmentSlot = typeof EQUIPMENT_SLOTS[number]
type Vitals = Parameters<typeof addVitalsExperience>[0]
type Dimension = SessionState['dimension']

export type H4aDeathContext = {
  readonly getPlayerPosition: () => Parameters<typeof deathDropsFromPlayerStorage>[1]
  readonly getStorageSnapshot: () => Parameters<typeof deathDropsFromPlayerStorage>[0]
  readonly customNames: Map<string, string>
  readonly enchantedItems: Map<string, EnchantedItem>
  readonly getFramesTotal: () => number
  readonly spawnDroppedItems: (drops: ReadonlyArray<SpawnDrop>) => ReadonlyArray<{ readonly id: string }>
  readonly getPlayerDimension: () => Dimension
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly droppedItemMetadata: Map<string, DroppedItemMetadata>
  readonly equipmentMetadataKey: (slot: EquipmentSlot) => string
  readonly restoreEmptyStorage: () => void
  readonly getVitalsSnapshot: () => Vitals
  readonly restoreVitals: (vitals: Vitals) => void
  readonly setDeathDropDimension: (dimension: Dimension) => void
  readonly markSessionDirty: () => void
}

export const handleLocalPlayerDeath = (context: H4aDeathContext): void => {
  const deathPosition = context.getPlayerPosition()
  const storage = context.getStorageSnapshot()
  const drops = deathDropsFromPlayerStorage(storage, deathPosition, {
    customNames: Object.fromEntries(context.customNames),
    enchantedItems: Object.fromEntries(context.enchantedItems),
  })
  if (drops.length > 0) {
    const dropped = context.spawnDroppedItems(drops.map(({ customName: _customName, enchantments: _enchantments, ...drop }) => ({
      ...drop,
      eligibleFromFrame: context.getFramesTotal() + 1,
    })))
    const dimension = context.getPlayerDimension()
    dropped.forEach((entity, index) => {
      const drop = drops[index]
      if (drop === undefined) return
      context.droppedItemMetadata.set(context.droppedItemMetadataKey(dimension, String(entity.id)), {
        ...(drop.customName === undefined ? {} : { customName: drop.customName }),
        ...(drop.enchantments === undefined
          ? {}
          : {
              enchantedItem: {
                item: drop.item,
                durability: drop.durability ?? null,
                enchantments: drop.enchantments,
              },
            }),
      })
    })
  }
  storage.inventory.slots.forEach((_stack, index) => {
    context.customNames.delete(String(index))
    context.enchantedItems.delete(String(index))
  })
  for (const slot of EQUIPMENT_SLOTS) {
    context.customNames.delete(context.equipmentMetadataKey(slot))
    context.enchantedItems.delete(context.equipmentMetadataKey(slot))
  }
  context.restoreEmptyStorage()
  const vitals = context.getVitalsSnapshot()
  context.restoreVitals(addVitalsExperience(vitals, -vitals.totalExperience))
  context.setDeathDropDimension(context.getPlayerDimension())
  context.markSessionDirty()
}

export type H4aRespawnContext = {
  readonly resetPrimaryAttackGesture: () => void
  readonly resetBowUse: () => void
  readonly resetProjectileStates: () => void
  readonly unmountVehicle: () => void
  readonly cancelFishing: () => void
  readonly resetSwimming: () => void
  readonly respawnVitals: () => void
  readonly clearGameplayDeathState: () => void
  readonly validRespawnLocation: () => SleepLocation | null
  readonly clearRespawnLocation: () => void
  readonly leaveSleep: () => void
  readonly restorePlayerForRespawn: (location: SleepLocation | null) => void
  readonly clearDeathDropDimension: () => void
  readonly resetSimState: (physicsEnabled: boolean) => void
  readonly setInventoryOpen: (open: boolean) => void
  readonly syncTouchControls: () => void
  readonly renderPlayerUi: () => void
  readonly markSessionDirty: () => void
}

export const respawnPlayer = (context: H4aRespawnContext): void => {
  context.resetPrimaryAttackGesture()
  context.resetBowUse()
  context.resetProjectileStates()
  context.unmountVehicle()
  context.cancelFishing()
  context.resetSwimming()
  context.respawnVitals()
  context.clearGameplayDeathState()
  const validRespawn = context.validRespawnLocation()
  if (validRespawn === null) context.clearRespawnLocation()
  context.leaveSleep()
  context.restorePlayerForRespawn(validRespawn)
  context.clearDeathDropDimension()
  context.resetSimState(true)
  context.setInventoryOpen(false)
  context.syncTouchControls()
  context.renderPlayerUi()
  context.markSessionDirty()
}

type PauseSettingsView = {
  readonly isOpen: () => boolean
  readonly open: (settings: PlayerSettingsV1, returnFocusTo: HTMLElement) => void
}

export type H4aPauseContext = {
  readonly document: Document
  readonly window: Pick<Window, 'location'>
  readonly canvas: HTMLCanvasElement
  readonly gameShell: HTMLElement
  readonly pauseOverlay: HTMLElement
  readonly resumeButton: HTMLElement
  readonly settingsButton: HTMLElement
  readonly saveQuitButton: HTMLElement
  readonly pauseError: HTMLElement
  readonly settingsView: PauseSettingsView
  readonly getPlayerSettings: () => PlayerSettingsV1
  readonly getPaused: () => boolean
  readonly setPaused: (paused: boolean) => void
  readonly isBrewingOpen: () => boolean
  readonly closeBrewing: () => void
  readonly isTradeOpen: () => boolean
  readonly closeTrade: () => void
  readonly isInventoryOpen: () => boolean
  readonly closeInventory: () => void
  readonly resetPrimaryAttackGesture: () => void
  readonly resetBowUse: () => void
  readonly renderCrosshair: () => void
  readonly syncTouchControls: () => void
  readonly requestFlush: () => Promise<void>
  readonly drainSettingsWrites: () => Promise<void>
}

export const installPauseControls = (context: H4aPauseContext): (() => void) => {
  const setPaused = (next: boolean): void => {
    context.resetPrimaryAttackGesture()
    if (next) context.resetBowUse()
    context.setPaused(next)
    context.gameShell.inert = next
    context.pauseOverlay.hidden = !next
    context.document.body.setAttribute('data-session-paused', String(next))
    context.renderCrosshair()
    context.syncTouchControls()
    if (next) {
      if (context.document.pointerLockElement === context.canvas) context.document.exitPointerLock()
      context.resumeButton.focus()
      return
    }
    context.pauseError.textContent = ''
    context.canvas.focus()
  }

  const handlePauseRequest = (): void => {
    if (context.isBrewingOpen()) {
      context.closeBrewing()
      return
    }
    if (context.isTradeOpen()) {
      context.closeTrade()
      return
    }
    if (context.isInventoryOpen()) {
      context.closeInventory()
      return
    }
    setPaused(!context.getPaused())
  }

  context.document.addEventListener('keydown', (event) => {
    if (context.settingsView.isOpen()) return
    if (event.code === 'Escape' && !event.repeat) {
      event.preventDefault()
      event.stopPropagation()
      handlePauseRequest()
      return
    }

    if (!context.getPaused() || event.code !== 'Tab') return
    const pauseActions = [context.resumeButton, context.settingsButton, context.saveQuitButton].filter(
      (button) => !button.hasAttribute('disabled'),
    )
    const firstAction = pauseActions[0]
    const lastAction = pauseActions.at(-1)
    if (firstAction === undefined || lastAction === undefined) return

    const activeElement = context.document.activeElement
    const activeIsPauseAction = pauseActions.some((button) => button === activeElement)
    const allowsNativeFocusMove = event.shiftKey
      ? activeElement !== firstAction && activeIsPauseAction
      : activeElement !== lastAction && activeIsPauseAction
    if (allowsNativeFocusMove) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    ;(event.shiftKey ? lastAction : firstAction).focus()
  })
  context.resumeButton.addEventListener('click', () => setPaused(false))
  context.settingsButton.addEventListener('click', () => {
    context.pauseOverlay.inert = true
    context.settingsView.open(context.getPlayerSettings(), context.settingsButton)
  })
  context.saveQuitButton.addEventListener('click', () => {
    if (context.saveQuitButton.getAttribute('aria-busy') === 'true') return
    context.saveQuitButton.setAttribute('aria-busy', 'true')
    context.saveQuitButton.setAttribute('disabled', '')
    context.pauseError.textContent = ''
    void Promise.all([context.requestFlush(), context.drainSettingsWrites()])
      .then(() => context.window.location.assign('/'))
      .catch((error: unknown) => {
        context.pauseError.textContent = 'Save failed. Your world is still open; please try again.'
        console.error('[mc-compose] Save & Quit failed', error)
      })
      .finally(() => {
        context.saveQuitButton.removeAttribute('aria-busy')
        context.saveQuitButton.removeAttribute('disabled')
      })
  })

  return handlePauseRequest
}
