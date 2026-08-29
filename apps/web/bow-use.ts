export type BowUseState =
  | { readonly _tag: 'Idle' }
  | {
      readonly _tag: 'Drawing'
      readonly bowSlotIndex: number
      readonly chargeSecs: number
    }

export type BowRelease = {
  readonly bowSlotIndex: number
  readonly chargeSecs: number
}

export type AdvanceBowUseInput = {
  readonly state: BowUseState
  readonly useTriggered: boolean
  readonly useHeld: boolean
  readonly cancelled: boolean
  readonly selectedItem: string | null
  readonly selectedSlotIndex: number
  readonly arrowCount: number
  readonly elapsedSecs: number
}

export type AdvanceBowUseResult = {
  readonly state: BowUseState
  readonly release: BowRelease | null
  readonly capturedUse: boolean
}

export const IDLE_BOW_USE: BowUseState = { _tag: 'Idle' }

const elapsedCharge = (elapsedSecs: number): number =>
  Number.isFinite(elapsedSecs) ? Math.max(0, elapsedSecs) : 0

export const advanceBowUse = (input: AdvanceBowUseInput): AdvanceBowUseResult => {
  if (input.cancelled) {
    return {
      state: IDLE_BOW_USE,
      release: null,
      capturedUse: input.state._tag === 'Drawing',
    }
  }

  if (input.state._tag === 'Idle') {
    if (!input.useTriggered || input.selectedItem !== 'bow') {
      return { state: input.state, release: null, capturedUse: false }
    }
    if (input.arrowCount <= 0) {
      return { state: input.state, release: null, capturedUse: true }
    }
    if (!input.useHeld) {
      return {
        state: IDLE_BOW_USE,
        release: { bowSlotIndex: input.selectedSlotIndex, chargeSecs: 0 },
        capturedUse: true,
      }
    }
    return {
      state: {
        _tag: 'Drawing',
        bowSlotIndex: input.selectedSlotIndex,
        chargeSecs: elapsedCharge(input.elapsedSecs),
      },
      release: null,
      capturedUse: true,
    }
  }

  if (input.useHeld) {
    return {
      state: {
        ...input.state,
        chargeSecs: input.state.chargeSecs + elapsedCharge(input.elapsedSecs),
      },
      release: null,
      capturedUse: true,
    }
  }

  return {
    state: IDLE_BOW_USE,
    release: {
      bowSlotIndex: input.state.bowSlotIndex,
      chargeSecs: input.state.chargeSecs,
    },
    capturedUse: true,
  }
}

export type PendingBowShot = {
  readonly bowSlotIndex: number
}

export type CorrelatedBowShotResult = {
  readonly requestId: string
  readonly success: boolean
  readonly outcome: string
}

export type BowSettlement = {
  readonly pending: ReadonlyMap<string, PendingBowShot>
  readonly fired: PendingBowShot | null
}

export const takeBowSettlement = (
  pending: ReadonlyMap<string, PendingBowShot>,
  result: CorrelatedBowShotResult,
): BowSettlement => {
  const next = new Map(pending)
  const shot = next.get(result.requestId)
  next.delete(result.requestId)
  return {
    pending: next,
    fired: shot !== undefined && result.success && result.outcome === 'Fired' ? shot : null,
  }
}
