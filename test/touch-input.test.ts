import {
  defaultBindings,
  resolveTouchControl,
  unboundTouchActions,
} from '@nerima-games/mc-render'
import { describe, expect, it } from 'vitest'

import {
  advanceTouchLook,
  consumeTouchLook,
  createTouchControlRoster,
  resetTouchLook,
  TOUCH_CONTROL_ACTIONS,
  TOUCH_LOOK_CONTROLLER_IDLE,
  touchControlsPresentation,
  type TouchControlAction,
  type TouchControlTargets,
  type TouchLookResetReason,
} from '../apps/web/touch-input'

const controlTargets = (): TouchControlTargets<object> =>
  Object.fromEntries(TOUCH_CONTROL_ACTIONS.map((action) => [action, { action }])) as Record<
    TouchControlAction,
    object
  >

const contact = (identifier: number, clientX: number, clientY: number) => ({
  identifier,
  clientX,
  clientY,
})

describe('touch control roster', () => {
  it('declares all nine live actions and preserves each target identity', () => {
    const targets = controlTargets()
    const roster = createTouchControlRoster(targets)

    expect(roster.map(({ action }) => action)).toStrictEqual(TOUCH_CONTROL_ACTIONS)
    expect(unboundTouchActions(defaultBindings(), roster.map(({ action }) => action))).toStrictEqual(
      [],
    )
    for (const entry of roster) expect(entry.target).toBe(targets[entry.action as TouchControlAction])
  })

  it('resolves only the exact registered target object', () => {
    const targets = controlTargets()
    const roster = createTouchControlRoster(targets)

    expect(resolveTouchControl(roster, targets.jump)).toBe('jump')
    expect(resolveTouchControl(roster, { action: 'jump' })).toBeUndefined()
  })

  it('rejects target reuse because identity resolution would shadow an action', () => {
    const targets = controlTargets()
    const sharedTarget = targets.jump

    expect(() => createTouchControlRoster({ ...targets, attack: sharedTarget })).toThrowError(
      'Touch control target is shared by jump and attack',
    )
  })
})

describe('touch look controller', () => {
  it('tracks one identifier and ignores every other finger', () => {
    const started = advanceTouchLook(TOUCH_LOOK_CONTROLLER_IDLE, 'start', contact(7, 100, 80))
    const ignoredStart = advanceTouchLook(started, 'start', contact(8, 500, 500))
    const ignoredMove = advanceTouchLook(ignoredStart, 'move', contact(8, 510, 490))
    const moved = advanceTouchLook(ignoredMove, 'move', contact(7, 112, 75))

    expect(ignoredStart).toBe(started)
    expect(ignoredMove).toBe(started)
    expect(moved.activeIdentifier).toBe(7)
    expect(moved.pending).toStrictEqual({ x: 12, y: -5 })
  })

  it('accumulates movement and consumes it exactly once', () => {
    const started = advanceTouchLook(TOUCH_LOOK_CONTROLLER_IDLE, 'start', contact(3, 10, 10))
    const firstMove = advanceTouchLook(started, 'move', contact(3, 14, 8))
    const secondMove = advanceTouchLook(firstMove, 'move', contact(3, 20, 11))
    const first = consumeTouchLook(secondMove)
    const second = consumeTouchLook(first.state)

    expect(first.delta).toStrictEqual({ x: 10, y: 1 })
    expect(second.delta).toStrictEqual({ x: 0, y: 0 })
    expect(second.state.activeIdentifier).toBe(3)
  })

  it.each(['end', 'cancel'] as const)(
    '%s releases the active touch without losing its unconsumed delta',
    (phase) => {
      const started = advanceTouchLook(TOUCH_LOOK_CONTROLLER_IDLE, 'start', contact(4, 20, 30))
      const moved = advanceTouchLook(started, 'move', contact(4, 28, 25))
      const released = advanceTouchLook(moved, phase, contact(4, 28, 25))

      expect(released.activeIdentifier).toBeNull()
      expect(released.pending).toStrictEqual({ x: 8, y: -5 })
      expect(consumeTouchLook(released).delta).toStrictEqual({ x: 8, y: -5 })
    },
  )

  it.each<TouchLookResetReason>(['blur', 'visibility-hidden', 'state-transition'])(
    '%s discards active and pending look state',
    (reason) => {
      const started = advanceTouchLook(TOUCH_LOOK_CONTROLLER_IDLE, 'start', contact(2, 5, 5))
      const moved = advanceTouchLook(started, 'move', contact(2, 15, 12))

      expect(resetTouchLook(moved, reason)).toBe(TOUCH_LOOK_CONTROLLER_IDLE)
    },
  )
})

describe('touch controls presentation', () => {
  const playable = {
    touchAvailable: true,
    playing: true,
    dead: false,
    inventoryOpen: false,
    paused: false,
  }

  it('is visible and interactive only during unobstructed touch gameplay', () => {
    expect(touchControlsPresentation(playable)).toStrictEqual({ visible: true, inert: false })
  })

  it.each([
    { touchAvailable: false },
    { playing: false },
    { dead: true },
    { inventoryOpen: true },
    { paused: true },
  ])('is hidden and inert for $key', (override) => {
    expect(touchControlsPresentation({ ...playable, ...override })).toStrictEqual({
      visible: false,
      inert: true,
    })
  })
})
