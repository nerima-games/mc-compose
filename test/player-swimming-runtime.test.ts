import { describe, expect, it } from 'vitest'
import {
  advancePlayerSwimmingRuntime,
  DROWNING_DAMAGE_POINTS,
  initialPlayerSwimmingRuntimeState,
  MAX_SWIMMING_OXYGEN_SECS,
} from '../apps/web/player-swimming-runtime'

const tick = (
  state = initialPlayerSwimmingRuntimeState(),
  overrides: Partial<Parameters<typeof advancePlayerSwimmingRuntime>[1]> = {},
) => advancePlayerSwimmingRuntime(state, {
  feetInWater: true,
  eyesInWater: false,
  dead: false,
  horizontalInput: { x: 0, z: 0 },
  verticalInput: 0,
  deltaSecs: 1,
  ...overrides,
})

describe('player swimming runtime', () => {
  it('starts swimming at the surface without consuming oxygen', () => {
    const result = tick(undefined, {
      horizontalInput: { x: 1, z: 0 },
      deltaSecs: 0.1,
    })

    expect(result.state.active).toBe(true)
    expect(result.state.fullySubmerged).toBe(false)
    expect(result.state.oxygenSecs).toBe(MAX_SWIMMING_OXYGEN_SECS)
    expect(result.state.velocity.x).toBeGreaterThan(0)
  })

  it('consumes oxygen only while the eyes are submerged', () => {
    const result = tick(undefined, { eyesInWater: true, deltaSecs: 2.5 })

    expect(result.state.fullySubmerged).toBe(true)
    expect(result.state.oxygenSecs).toBe(MAX_SWIMMING_OXYGEN_SECS - 2.5)
  })

  it('ends swimming and recovers oxygen after leaving water', () => {
    const submerged = tick(undefined, { eyesInWater: true, deltaSecs: 10 }).state
    const result = tick(submerged, { feetInWater: false, eyesInWater: false, deltaSecs: 1 })

    expect(result.state.active).toBe(false)
    expect(result.state.oxygenSecs).toBe(9)
    expect(result.state.velocity).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('emits deterministic drowning damage after oxygen is exhausted', () => {
    const exhausted = tick(undefined, {
      eyesInWater: true,
      deltaSecs: MAX_SWIMMING_OXYGEN_SECS,
    }).state
    const result = tick(exhausted, { eyesInWater: true, deltaSecs: 1 })

    expect(result.drowningDamagePoints).toBe(DROWNING_DAMAGE_POINTS)
    expect(result.state.drowningElapsedSecs).toBe(0)
  })

  it('clears swimming and restores oxygen on death or respawn reset', () => {
    const submerged = tick(undefined, { eyesInWater: true, deltaSecs: 10 }).state
    const dead = tick(submerged, { eyesInWater: true, dead: true }).state

    expect(dead).toEqual(initialPlayerSwimmingRuntimeState())
    expect(initialPlayerSwimmingRuntimeState().oxygenSecs).toBe(MAX_SWIMMING_OXYGEN_SECS)
  })
})
