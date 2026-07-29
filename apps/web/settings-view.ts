import type { InputAction } from '@nerima-games/mc-render'

import {
  DEFAULT_PLAYER_SETTINGS,
  PLAYER_BINDING_ACTIONS,
  rebindPlayerSettings,
  type PlayerSettingsV1,
} from './settings'

type BindableAction = Exclude<InputAction, 'escape'>

export type SettingsView = {
  readonly open: (settings: PlayerSettingsV1, returnFocus: HTMLElement) => void
  readonly close: () => void
  readonly isOpen: () => boolean
  readonly settings: () => PlayerSettingsV1
  readonly reportPersistenceError: (message: string) => void
  readonly clearPersistenceError: () => void
  readonly dispose: () => void
}

const ACTION_LABELS: Readonly<Record<BindableAction, string>> = {
  moveForward: 'Move forward',
  moveBackward: 'Move backward',
  moveLeft: 'Move left',
  moveRight: 'Move right',
  jump: 'Jump',
  sneak: 'Sneak',
  sprint: 'Sprint',
  openInventory: 'Inventory',
  openChat: 'Chat',
  attack: 'Attack',
  use: 'Use',
  pickBlock: 'Pick block',
  hotbarSlot1: 'Hotbar 1',
  hotbarSlot2: 'Hotbar 2',
  hotbarSlot3: 'Hotbar 3',
  hotbarSlot4: 'Hotbar 4',
  hotbarSlot5: 'Hotbar 5',
  hotbarSlot6: 'Hotbar 6',
  hotbarSlot7: 'Hotbar 7',
  hotbarSlot8: 'Hotbar 8',
  hotbarSlot9: 'Hotbar 9',
}

const focusableElements = (root: HTMLElement): ReadonlyArray<HTMLElement> =>
  [...root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')]

export const createSettingsView = (
  document: Document,
  root: HTMLElement,
  options: {
    readonly onChange: (settings: PlayerSettingsV1) => void
    readonly onClose: () => void
  },
): SettingsView => {
  root.innerHTML = `
    <section class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header class="settings-header">
        <div><p class="settings-eyebrow">Player preferences</p><h1 id="settings-title">Settings</h1></div>
        <button type="button" data-settings-close aria-label="Close settings">Close</button>
      </header>
      <div class="settings-grid">
        <fieldset><legend>Controls</legend>
          <label class="settings-range">Look sensitivity <output data-sensitivity-output></output>
            <input data-sensitivity type="range" min="10" max="300" step="5" />
          </label>
          <div class="binding-list" data-binding-list></div>
          <button type="button" data-reset-bindings>Reset key bindings</button>
        </fieldset>
        <fieldset><legend>Audio &amp; captions</legend>
          <label class="settings-toggle"><input data-audio-enabled type="checkbox" /> Audio enabled</label>
          <label class="settings-range">Master volume <output data-master-output></output>
            <input data-master type="range" min="0" max="100" step="1" />
          </label>
          <label class="settings-range">SFX volume <output data-sfx-output></output>
            <input data-sfx type="range" min="0" max="100" step="1" />
          </label>
          <label class="settings-toggle"><input data-captions-enabled type="checkbox" /> Sound captions</label>
        </fieldset>
      </div>
      <p class="settings-status" data-settings-status role="status" aria-live="polite"></p>
      <p class="settings-error" data-settings-error role="alert" aria-live="assertive"></p>
    </section>`
  root.hidden = true

  const required = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector)
    if (element === null) throw new Error(`settings view missing ${selector}`)
    return element
  }
  const sensitivity = required<HTMLInputElement>('[data-sensitivity]')
  const sensitivityOutput = required<HTMLOutputElement>('[data-sensitivity-output]')
  const master = required<HTMLInputElement>('[data-master]')
  const masterOutput = required<HTMLOutputElement>('[data-master-output]')
  const sfx = required<HTMLInputElement>('[data-sfx]')
  const sfxOutput = required<HTMLOutputElement>('[data-sfx-output]')
  const audioEnabled = required<HTMLInputElement>('[data-audio-enabled]')
  const captionsEnabled = required<HTMLInputElement>('[data-captions-enabled]')
  const bindingList = required<HTMLElement>('[data-binding-list]')
  const status = required<HTMLElement>('[data-settings-status]')
  const persistenceError = required<HTMLElement>('[data-settings-error]')
  const closeButton = required<HTMLButtonElement>('[data-settings-close]')
  let current = DEFAULT_PLAYER_SETTINGS
  let returnFocus: HTMLElement | undefined
  let capturing: BindableAction | undefined

  const publish = (next: PlayerSettingsV1): void => {
    current = next
    render()
    options.onChange(next)
  }

  const renderBindings = (): void => {
    bindingList.replaceChildren(...PLAYER_BINDING_ACTIONS.map((action) => {
      const row = document.createElement('div')
      row.className = 'binding-row'
      const label = document.createElement('span')
      label.textContent = ACTION_LABELS[action]
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset['bindingAction'] = action
      button.setAttribute('aria-label', `Change ${ACTION_LABELS[action]} key`)
      button.setAttribute('aria-pressed', String(capturing === action))
      button.textContent = capturing === action ? 'Press a key...' : current.bindings[action] ?? 'Unbound'
      row.append(label, button)
      return row
    }))
  }

  const focusBinding = (action: BindableAction): void => {
    required<HTMLButtonElement>(`[data-binding-action="${action}"]`).focus()
  }

  const render = (): void => {
    sensitivity.value = String(Math.round(current.sensitivity * 100))
    sensitivityOutput.value = `${Math.round(current.sensitivity * 100)}%`
    master.value = String(Math.round(current.masterVolume * 100))
    masterOutput.value = `${Math.round(current.masterVolume * 100)}%`
    sfx.value = String(Math.round(current.sfxVolume * 100))
    sfxOutput.value = `${Math.round(current.sfxVolume * 100)}%`
    audioEnabled.checked = current.audioEnabled
    captionsEnabled.checked = current.captionsEnabled
    renderBindings()
  }

  bindingList.addEventListener('click', (event) => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    const button = target.closest<HTMLButtonElement>('[data-binding-action]')
    const action = button?.dataset['bindingAction'] as BindableAction | undefined
    if (action === undefined) return
    capturing = action
    status.textContent = `Press a key for ${ACTION_LABELS[action]}. Escape cancels.`
    renderBindings()
    focusBinding(action)
  })

  sensitivity.addEventListener('input', () => publish({ ...current, sensitivity: Number(sensitivity.value) / 100 }))
  master.addEventListener('input', () => publish({ ...current, masterVolume: Number(master.value) / 100 }))
  sfx.addEventListener('input', () => publish({ ...current, sfxVolume: Number(sfx.value) / 100 }))
  audioEnabled.addEventListener('change', () => publish({ ...current, audioEnabled: audioEnabled.checked }))
  captionsEnabled.addEventListener('change', () => publish({ ...current, captionsEnabled: captionsEnabled.checked }))
  required('[data-reset-bindings]').addEventListener('click', () => {
    capturing = undefined
    status.textContent = 'Key bindings reset.'
    publish({ ...current, bindings: { ...DEFAULT_PLAYER_SETTINGS.bindings } })
  })

  const close = (): void => {
    if (root.hidden) return
    capturing = undefined
    root.hidden = true
    options.onClose()
    returnFocus?.focus()
  }
  closeButton.addEventListener('click', close)

  const handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (root.hidden) return
    if (capturing !== undefined) {
      if (event.code === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        const action = capturing
        capturing = undefined
        status.textContent = 'Key capture cancelled.'
        renderBindings()
        focusBinding(action)
        return
      }
      if (event.code === 'Tab') return
      event.preventDefault()
      event.stopImmediatePropagation()
      const action = capturing
      capturing = undefined
      const conflicting = PLAYER_BINDING_ACTIONS.find(
        (candidate) => candidate !== action && current.bindings[candidate] === event.code,
      )
      status.textContent = conflicting === undefined
        ? `${ACTION_LABELS[action]} set to ${event.code}.`
        : `${ACTION_LABELS[action]} and ${ACTION_LABELS[conflicting]} swapped.`
      publish({ ...current, bindings: rebindPlayerSettings(current.bindings, action, event.code) })
      focusBinding(action)
      return
    }
    if (event.code === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      close()
      return
    }
    if (event.code !== 'Tab') return
    const focusable = focusableElements(root)
    const first = focusable[0]
    const last = focusable.at(-1)
    if (first === undefined || last === undefined) return
    if ((!event.shiftKey && document.activeElement === last)
      || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }
  document.addEventListener('keydown', handleDocumentKeydown, true)

  return {
    open: (settings, nextReturnFocus) => {
      current = settings
      returnFocus = nextReturnFocus
      capturing = undefined
      status.textContent = ''
      persistenceError.textContent = ''
      render()
      root.hidden = false
      closeButton.focus()
    },
    close,
    isOpen: () => !root.hidden,
    settings: () => current,
    reportPersistenceError: (message) => {
      persistenceError.textContent = message
    },
    clearPersistenceError: () => {
      persistenceError.textContent = ''
    },
    dispose: () => {
      document.removeEventListener('keydown', handleDocumentKeydown, true)
    },
  }
}
