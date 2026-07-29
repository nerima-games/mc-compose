import {
  defaultBindings,
  TOUCH_LOOK_IDLE,
  touchLookStep,
  unboundTouchActions,
  type InputAction,
  type TouchControlTarget,
  type TouchLookState,
  type TouchPoint,
} from '@nerima-games/mc-render'

export const TOUCH_CONTROL_ACTIONS = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'attack',
  'use',
  'openInventory',
  'escape',
] as const satisfies ReadonlyArray<InputAction>

export type TouchControlAction = (typeof TOUCH_CONTROL_ACTIONS)[number]

export type TouchControlTargets<Target = unknown> = Readonly<
  Record<TouchControlAction, Target>
>

export const createTouchControlRoster = <Target>(
  targets: TouchControlTargets<Target>,
): ReadonlyArray<TouchControlTarget> => {
  const unavailable = unboundTouchActions(defaultBindings(), TOUCH_CONTROL_ACTIONS)
  if (unavailable.length > 0) {
    throw new Error(`Touch controls have no input binding: ${unavailable.join(', ')}`)
  }

  const owners = new Map<unknown, TouchControlAction>()
  return TOUCH_CONTROL_ACTIONS.map((action) => {
    const target = targets[action]
    if (target === null || target === undefined) {
      throw new Error(`Touch control target is missing: ${action}`)
    }
    const owner = owners.get(target)
    if (owner !== undefined) {
      throw new Error(`Touch control target is shared by ${owner} and ${action}`)
    }
    owners.set(target, action)
    return { action, target }
  })
}

export type TouchContact = {
  readonly identifier: number
  readonly clientX: number
  readonly clientY: number
}

export type TouchLookControllerState = {
  readonly activeIdentifier: number | null
  readonly gesture: TouchLookState
  readonly pending: TouchPoint
}

const ZERO_TOUCH_DELTA: TouchPoint = { x: 0, y: 0 }

export const TOUCH_LOOK_CONTROLLER_IDLE: TouchLookControllerState = {
  activeIdentifier: null,
  gesture: TOUCH_LOOK_IDLE,
  pending: ZERO_TOUCH_DELTA,
}

export type TouchLookContactPhase = 'start' | 'move' | 'end' | 'cancel'

const pointOf = (contact: TouchContact): TouchPoint => ({
  x: contact.clientX,
  y: contact.clientY,
})

const accumulate = (pending: TouchPoint, delta: TouchPoint): TouchPoint => ({
  x: pending.x + delta.x,
  y: pending.y + delta.y,
})

export const advanceTouchLook = (
  state: TouchLookControllerState,
  phase: TouchLookContactPhase,
  contact: TouchContact,
): TouchLookControllerState => {
  if (phase === 'start') {
    if (state.activeIdentifier !== null) return state
    const next = touchLookStep(state.gesture, 'press', pointOf(contact))
    return {
      activeIdentifier: contact.identifier,
      gesture: next.state,
      pending: accumulate(state.pending, next.delta),
    }
  }

  if (contact.identifier !== state.activeIdentifier) return state
  if (phase === 'end' || phase === 'cancel') {
    touchLookStep(state.gesture, 'release', pointOf(contact))
    return {
      activeIdentifier: null,
      gesture: TOUCH_LOOK_IDLE,
      pending: state.pending,
    }
  }

  const next = touchLookStep(state.gesture, 'move', pointOf(contact))
  return {
    activeIdentifier: state.activeIdentifier,
    gesture: next.state,
    pending: accumulate(state.pending, next.delta),
  }
}

export type ConsumedTouchLook = {
  readonly state: TouchLookControllerState
  readonly delta: TouchPoint
}

export const consumeTouchLook = (state: TouchLookControllerState): ConsumedTouchLook => ({
  state: { ...state, pending: ZERO_TOUCH_DELTA },
  delta: state.pending,
})

export type TouchLookResetReason = 'blur' | 'visibility-hidden' | 'state-transition'

export const resetTouchLook = (
  _state: TouchLookControllerState,
  reason: TouchLookResetReason,
): TouchLookControllerState => {
  switch (reason) {
    case 'blur':
    case 'visibility-hidden':
    case 'state-transition':
      return TOUCH_LOOK_CONTROLLER_IDLE
  }
}

export type TouchControlsUiState = {
  readonly touchAvailable: boolean
  readonly playing: boolean
  readonly dead: boolean
  readonly inventoryOpen: boolean
  readonly paused: boolean
}

export type TouchControlsPresentation = {
  readonly visible: boolean
  readonly inert: boolean
}

export const touchControlsPresentation = (
  state: TouchControlsUiState,
): TouchControlsPresentation => {
  const visible =
    state.touchAvailable &&
    state.playing &&
    !state.dead &&
    !state.inventoryOpen &&
    !state.paused
  return { visible, inert: !visible }
}
