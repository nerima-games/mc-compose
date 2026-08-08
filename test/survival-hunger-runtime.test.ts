import {
  makeInMemoryVitals,
  SPAWN_PLAYER_VITALS,
  type SurvivalHungerState,
} from '@nerima-games/mx-gameplay'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeSurvivalHungerCoordinator } from '../apps/web/survival-hunger-runtime'
import type { DeltaTimeSecs } from '../src/domain/kernel-vocabulary'

type HungerVitals = SurvivalHungerState['vitals']

const initialVitals = (overrides: Partial<HungerVitals> = {}): HungerVitals => ({
  ...SPAWN_PLAYER_VITALS,
  ...overrides,
})

const setup = (vitals: HungerVitals = initialVitals()) => {
  const canonical = Effect.runSync(makeInMemoryVitals(vitals))
  return { canonical, hunger: makeSurvivalHungerCoordinator(canonical) }
}

describe('survival hunger web coordinator', () => {
  it('applies queued activity and four-second food ticks to canonical vitals', () => {
    const { canonical, hunger } = setup(initialVitals({ healthPoints: 18 }))
    hunger.submit({ _tag: 'walk', distance: 10 })

    const outcome = hunger.tick(4 as DeltaTimeSecs)

    expect(outcome.exhaustionAdded).toBe(0.1)
    expect(outcome.foodTicks).toBe(1)
    expect(Effect.runSync(canonical.snapshot)).toEqual(outcome.vitals)
  })

  it('resynchronizes external damage before eating and respawning', () => {
    const { canonical, hunger } = setup()
    Effect.runSync(canonical.damage({ amount: 20, cause: 'generic' }))

    hunger.respawn()
    expect(Effect.runSync(canonical.snapshot).healthPoints).toBe(20)
    Effect.runSync(canonical.restore(initialVitals({ hungerPoints: 10 })))
    const eaten = hunger.eat(4, 0.3)
    expect(eaten.hungerPoints).toBe(14)
    expect(Effect.runSync(canonical.snapshot)).toEqual(eaten)
  })

  it('keeps starvation at the configured difficulty floor', () => {
    const canonical = Effect.runSync(makeInMemoryVitals(initialVitals({
      healthPoints: 10,
      hungerPoints: 0,
      saturation: 0,
      foodTimerSecs: 0,
    })))
    const hunger = makeSurvivalHungerCoordinator(canonical, 'easy')

    hunger.tick(40 as DeltaTimeSecs)

    expect(Effect.runSync(canonical.snapshot).healthPoints).toBe(10)
  })
})
