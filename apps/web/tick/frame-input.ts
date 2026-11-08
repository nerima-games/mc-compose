import { ESCAPE_KEY_CODE, type InputAction, type InputSnapshot } from '@nerima-games/mc-render'
import type { DeltaTimeSecs, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { Effect } from 'effect'

import type { H5aFrameInputContext, H5aFrameInputResult } from './h5a-context'

export type FrameTiming = {
  readonly raw: number
  readonly deltaSecs: DeltaTimeSecs
}

export const readFrameTiming = (
  nowSecs: MonotonicTimeSecs,
  previousSecs: MonotonicTimeSecs | undefined,
  firstFrameSecs: number,
  storePreviousSecs: (nowSecs: MonotonicTimeSecs) => void,
  clampDelta: (raw: number) => DeltaTimeSecs,
): FrameTiming => {
  const raw = previousSecs === undefined ? firstFrameSecs : nowSecs - previousSecs
  storePreviousSecs(nowSecs)
  return { raw, deltaSecs: clampDelta(raw) }
}

export const runTickFrameInput = (
  context: H5aFrameInputContext,
  nowSecs: MonotonicTimeSecs,
  frameInput: InputSnapshot,
): H5aFrameInputResult | undefined => {
  const { inputApi, state } = context
  const consumedTouchLook = context.touchLook.consume(state.touchLookState.get())
  state.touchLookState.set(consumedTouchLook.state)

  if (frameInput.justPressed.has(ESCAPE_KEY_CODE)) {
    context.handlePauseRequest()
    context.renderCrosshair(nowSecs)
    state.previousSecs.set(nowSecs)
    return undefined
  }
  if (context.paused()) {
    context.renderCrosshair(nowSecs)
    state.previousSecs.set(nowSecs)
    return undefined
  }

  const timing = readFrameTiming(
    nowSecs,
    state.previousSecs.get(),
    context.firstFrameSecs,
    state.previousSecs.set,
    context.clampDelta,
  )
  // THE DELTA IS ALREADY CLAMPED to `MAX_FRAME_SECS` above, which keeps a
  // backgrounded tab from returning with a multi-second physics step.
  if (context.multiplayer === undefined) {
    for (const [key, expiresAt] of context.observerPulses) {
      if (expiresAt <= state.simulationElapsedSecs.get()) {
        context.observerPulses.delete(key)
        state.redstoneDirty.set(true)
      }
    }
    if (state.redstoneDirty.get()) context.syncRedstoneSnapshot()
  }

  const walk = frameInput
  const healthBeforeHungerTick = Effect.runSync(context.world.vitals.view).healthPoints
  const hungerOutcome = context.isCreativeMode || context.multiplayer !== undefined
    ? undefined
    : context.survivalHunger.tick(timing.deltaSecs)
  if (healthBeforeHungerTick > 0 && context.playerIsDead() && context.multiplayer === undefined) {
    context.handleLocalPlayerDeath()
  }
  if (
    hungerOutcome !== undefined && (
      hungerOutcome.exhaustionAdded > 0 ||
      hungerOutcome.foodTicks > 0 ||
      hungerOutcome.regeneratedHealth > 0 ||
      hungerOutcome.starvationDamage > 0
    )
  ) context.markSessionDirty()
  state.simulationElapsedSecs.set(state.simulationElapsedSecs.get() + timing.deltaSecs)

  const dead = context.playerIsDead()
  context.syncTouchControls()
  if (dead) {
    if (state.inventoryOpen.get()) context.setInventoryOpen(false)
    if (state.brewingOpen.get()) context.setBrewingOpen(false)
    if (context.pointerLock.isLockedToCanvas()) context.pointerLock.exit()
  }

  if (
    !dead &&
    !context.bowInteractionLocked() &&
    Effect.runSync(inputApi.wasActionJustTriggered('openInventory'))
  ) {
    context.setInventoryOpen(!state.inventoryOpen.get(), 'player')
  }

  if (!dead && !state.inventoryOpen.get() && !state.tradeOpen.get()) {
    const nextHotbarIndex = context.selectedHotbarAfterInput(
      state.selectedHotbarIndex.get(),
      walk.wheelSteps,
      (action) => Effect.runSync(inputApi.wasActionJustTriggered(action)),
      context.wrapHotbarSelection,
    )
    if (nextHotbarIndex !== state.selectedHotbarIndex.get()) {
      // Optimistic: the selection is purely local UI focus (which slot
      // this client is pointing at), not authoritative game state, so it
      // updates immediately regardless of connection mode — matching
      // single-player exactly — while the network command still carries
      // it to the server for reconciliation. Without this, a right-click
      // or "use" landing before the server's echo (`applyNetworkInventory`
      // at `selectedHotbarIndex = state.selectedSlot`) read the OLD
      // slot for the whole round trip.
      state.selectedHotbarIndex.set(nextHotbarIndex)
      if (context.multiplayer !== undefined) context.sendInventorySelection(nextHotbarIndex)
    }
  }

  const held = (action: InputAction): number =>
    !dead && !state.inventoryOpen.get() && !state.tradeOpen.get() && !state.brewingOpen.get()
      && Effect.runSync(inputApi.isActionActive(action)) ? 1 : 0
  state.vehicleControls.set({
    throttle: held('moveForward') - held('moveBackward'),
    steering: held('moveRight') - held('moveLeft'),
  })

  const queuedNativeAttack = state.nativeInputQueue.get().attack > 0
  if (queuedNativeAttack) context.resetPrimaryAttackGesture()
  const attackTriggered =
    !dead && !state.inventoryOpen.get() && !state.tradeOpen.get() && !state.brewingOpen.get()
    && (Effect.runSync(inputApi.wasActionJustTriggered('attack')) || queuedNativeAttack)
  if (attackTriggered && !context.isCreativeMode) {
    if (context.multiplayer === undefined) context.survivalHunger.submit({ _tag: 'attack', count: 1 })
    else context.sendVitalsCommand({ _tag: 'activity', activity: 'attack', amount: 1 })
  }
  const attackHeld = held('attack') > 0 || queuedNativeAttack
  if (queuedNativeAttack) {
    state.nativeInputQueue.set(context.consumeNativeInput(state.nativeInputQueue.get(), 'attack').state)
  }
  if (!attackHeld) context.resetPrimaryAttackGesture()
  const canUse = !dead && !state.inventoryOpen.get() && !state.tradeOpen.get() && !state.brewingOpen.get()
  const nativeUse = canUse
    ? context.consumeNativeInput(state.nativeInputQueue.get(), 'use')
    : { triggered: false, state: state.nativeInputQueue.get() }
  state.nativeInputQueue.set(nativeUse.state)
  const useTriggered = canUse
    && (Effect.runSync(inputApi.wasActionJustTriggered('use')) || nativeUse.triggered)
  const useHeld = held('use') > 0
  const lookDelta = {
    x: walk.pointerDelta.x + consumedTouchLook.delta.positionX,
    y: walk.pointerDelta.y + consumedTouchLook.delta.positionY,
  }
  const looked = !dead && !state.inventoryOpen.get() && !state.tradeOpen.get() && !state.brewingOpen.get()
    && (lookDelta.x !== 0 || lookDelta.y !== 0)
  if (!dead && !state.inventoryOpen.get() && !state.tradeOpen.get() && !state.brewingOpen.get()) {
    Effect.runSync(context.playerApi.look(
      -lookDelta.x * context.lookSensitivity * context.playerSettings.sensitivity,
      -lookDelta.y * context.lookSensitivity * context.playerSettings.sensitivity,
    ))
  }

  return {
    nowSecs,
    ...timing,
    walk,
    dead,
    held,
    attackTriggered,
    attackHeld,
    canUse,
    useTriggered,
    useHeld,
    looked,
  }
}
