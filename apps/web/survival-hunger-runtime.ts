import {
  makeSurvivalHungerRuntime,
  type SurvivalActivityInput,
  type SurvivalDifficulty,
  type SurvivalHungerRuntimeApi,
  type SurvivalHungerState,
  type SurvivalHungerTickOutcome,
} from '@nerima-games/mx-gameplay'
import { Effect } from 'effect'
import type { DeltaTimeSecs } from '@nerima-games/mc-kernel'

type HungerVitals = SurvivalHungerState['vitals']

export type CanonicalVitalsPort = {
  readonly snapshot: Effect.Effect<HungerVitals>
  readonly restore: (vitals: HungerVitals) => Effect.Effect<void>
}

export type SurvivalHungerCoordinator = {
  readonly submit: (activity: SurvivalActivityInput) => void
  readonly tick: (dt: DeltaTimeSecs) => SurvivalHungerTickOutcome
  readonly eat: (foodPoints: number, saturationModifier: number) => HungerVitals
  readonly respawn: () => void
}

export const makeSurvivalHungerCoordinator = (
  vitals: CanonicalVitalsPort,
  difficulty: SurvivalDifficulty = 'normal',
): SurvivalHungerCoordinator => {
  const runtime: SurvivalHungerRuntimeApi = Effect.runSync(makeSurvivalHungerRuntime())
  let pending: SurvivalActivityInput[] = []

  const restoreCanonical = (): void => {
    Effect.runSync(runtime.restore({
      version: 1,
      difficulty,
      vitals: Effect.runSync(vitals.snapshot),
    }))
  }

  return {
    submit: (activity) => {
      pending.push(activity)
    },
    tick: (dt) => {
      restoreCanonical()
      for (const activity of pending) Effect.runSync(runtime.submit(activity))
      pending = []
      const outcome = Effect.runSync(runtime.tick(dt))
      Effect.runSync(vitals.restore(outcome.vitals))
      return outcome
    },
    eat: (foodPoints, saturationModifier) => {
      restoreCanonical()
      const next = Effect.runSync(runtime.eat(foodPoints, saturationModifier))
      Effect.runSync(vitals.restore(next))
      return next
    },
    respawn: () => {
      restoreCanonical()
      Effect.runSync(runtime.respawn)
      const next = Effect.runSync(runtime.snapshot)
      Effect.runSync(vitals.restore(next.vitals))
      pending = []
    },
  }
}
