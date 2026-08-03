import { applyPlayerSwimming, type SwimmingVelocity } from '@nerima-games/mx-gameplay'

export const MAX_SWIMMING_OXYGEN_SECS = 15
export const SWIMMING_OXYGEN_RECOVERY_PER_SEC = 4
export const DROWNING_DAMAGE_INTERVAL_SECS = 1
export const DROWNING_DAMAGE_POINTS = 2

export type PlayerSwimmingRuntimeState = Readonly<{
  active: boolean
  fullySubmerged: boolean
  oxygenSecs: number
  drowningElapsedSecs: number
  velocity: SwimmingVelocity
}>

export type PlayerSwimmingRuntimeInput = Readonly<{
  feetInWater: boolean
  eyesInWater: boolean
  dead: boolean
  horizontalInput: Readonly<{ x: number; z: number }>
  verticalInput: number
  deltaSecs: number
}>

export type PlayerSwimmingRuntimeResult = Readonly<{
  state: PlayerSwimmingRuntimeState
  drowningDamagePoints: number
}>

export const initialPlayerSwimmingRuntimeState = (): PlayerSwimmingRuntimeState => ({
  active: false,
  fullySubmerged: false,
  oxygenSecs: MAX_SWIMMING_OXYGEN_SECS,
  drowningElapsedSecs: 0,
  velocity: { x: 0, y: 0, z: 0 },
})

export const advancePlayerSwimmingRuntime = (
  state: PlayerSwimmingRuntimeState,
  input: PlayerSwimmingRuntimeInput,
): PlayerSwimmingRuntimeResult => {
  if (input.dead) {
    return { state: initialPlayerSwimmingRuntimeState(), drowningDamagePoints: 0 }
  }

  const deltaSecs = Number.isFinite(input.deltaSecs) ? Math.max(0, input.deltaSecs) : 0
  const active = input.feetInWater || input.eyesInWater
  const fullySubmerged = active && input.eyesInWater
  const oxygenSecs = fullySubmerged
    ? Math.max(0, state.oxygenSecs - deltaSecs)
    : Math.min(
        MAX_SWIMMING_OXYGEN_SECS,
        state.oxygenSecs + SWIMMING_OXYGEN_RECOVERY_PER_SEC * deltaSecs,
      )
  const drowningElapsedSecs = oxygenSecs === 0 && fullySubmerged
    ? state.drowningElapsedSecs + deltaSecs
    : 0
  const damageTicks = Math.floor(drowningElapsedSecs / DROWNING_DAMAGE_INTERVAL_SECS)
  const velocity = applyPlayerSwimming({
    velocity: active ? state.velocity : { x: 0, y: 0, z: 0 },
    verticalInput: input.verticalInput,
    horizontalInput: input.horizontalInput,
    isInWater: active,
    deltaSeconds: deltaSecs,
  })

  return {
    state: {
      active,
      fullySubmerged,
      oxygenSecs,
      drowningElapsedSecs:
        drowningElapsedSecs - damageTicks * DROWNING_DAMAGE_INTERVAL_SECS,
      velocity: active ? velocity : { x: 0, y: 0, z: 0 },
    },
    drowningDamagePoints: damageTicks * DROWNING_DAMAGE_POINTS,
  }
}
