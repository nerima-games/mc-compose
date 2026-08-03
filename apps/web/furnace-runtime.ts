import {
  applyFurnaceAdvance,
  furnaceAdvanceChanged,
  type FurnaceAdvancePlan,
} from '@nerima-games/mx-gameplay'
import type { FurnaceState } from '@nerima-games/mc-sim'

export type FurnaceRuntimeOutcome = {
  readonly _tag: 'Applied' | 'Stale'
  readonly state: FurnaceState
  readonly changed: boolean
  readonly advancedSecs: number
  readonly deferredSecs: number
}

export const advanceFurnaceRuntime = (
  current: FurnaceState,
  plan: FurnaceAdvancePlan,
): FurnaceRuntimeOutcome => {
  const applied = applyFurnaceAdvance(current, plan)

  return {
    _tag: applied._tag === 'Applied' ? 'Applied' : 'Stale',
    state: applied.state,
    changed: applied._tag === 'Applied' && furnaceAdvanceChanged(plan),
    advancedSecs: applied._tag === 'Applied' ? plan.advancedSecs : 0,
    deferredSecs: applied._tag === 'Applied'
      ? plan.deferredSecs
      : plan.advancedSecs + plan.deferredSecs,
  }
}
