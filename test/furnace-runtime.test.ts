import { emptyFurnaceState, itemStack, type FurnaceState } from '@nerima-games/mc-sim'
import { planFurnaceAdvance } from '@nerima-games/mx-gameplay'
import { describe, expect, it } from 'vitest'
import { advanceFurnaceRuntime } from '../apps/web/furnace-runtime'
import type { DeltaTimeSecs } from '../src/domain/kernel-vocabulary'

const fueledFurnace = (): FurnaceState => ({
  input: itemStack('raw_iron', 1),
  fuel: itemStack('coal', 1),
  output: null,
  cookElapsedSecs: 0,
  burnRemainingSecs: 0,
})

describe('furnace web runtime', () => {
  it('leaves an empty furnace unchanged', () => {
    const state = emptyFurnaceState()

    const outcome = advanceFurnaceRuntime(state, planFurnaceAdvance(state, 1 as DeltaTimeSecs))

    expect(outcome.state).toEqual(state)
    expect(outcome._tag).toBe('Applied')
    expect(outcome.changed).toBe(false)
  })

  it('advances a fueled furnace through the gameplay plan boundary', () => {
    const state = fueledFurnace()
    const outcome = advanceFurnaceRuntime(state, planFurnaceAdvance(state, 10 as DeltaTimeSecs))

    expect(outcome._tag).toBe('Applied')
    expect(outcome.changed).toBe(true)
    expect(outcome.state.input).toBeNull()
    expect(outcome.state.fuel).toBeNull()
    expect(outcome.state.output).toEqual(itemStack('iron_ingot', 1))
  })

  it('reports time deferred by the bounded gameplay plan', () => {
    const state = fueledFurnace()
    const outcome = advanceFurnaceRuntime(state, planFurnaceAdvance(state, 12 as DeltaTimeSecs))

    expect(outcome.advancedSecs).toBe(10)
    expect(outcome.deferredSecs).toBe(2)
  })

  it('rejects a plan when the host-owned snapshot changed before apply', () => {
    const state = fueledFurnace()
    const plan = planFurnaceAdvance(state, 1 as DeltaTimeSecs)
    const changed = { ...state, fuel: null }

    const outcome = advanceFurnaceRuntime(changed, plan)

    expect(outcome.state).toEqual(changed)
    expect(outcome._tag).toBe('Stale')
    expect(outcome.changed).toBe(false)
    expect(outcome.advancedSecs).toBe(0)
    expect(outcome.deferredSecs).toBe(1)
  })
})
