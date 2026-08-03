import { describe, expect, it } from 'vitest'
import {
  advanceSleep,
  enterSleep,
  initialSleepRuntimeState,
  isDangerNearby,
  leaveSleep,
  reconcileSleepers,
  requiredSleeperCount,
  sleepRatioFromPercentage,
  validRespawnLocation,
  type SleepLocation,
} from '../apps/web/sleep-runtime'

const bed: SleepLocation = {
  dimension: 'overworld',
  bedPosition: { x: 4, y: 64, z: 8 },
  position: { x: 4, y: 65, z: 8 },
}

describe('sleep runtime', () => {
  it('waits for the configured delay and connected-player threshold', () => {
    const one = enterSleep(initialSleepRuntimeState(), 'local', bed)
    expect(advanceSleep(one, 2, 2, 1, 2).skipToMorning).toBe(false)
    const two = enterSleep(one, 'remote', bed)
    expect(advanceSleep(two, 1.9, 2, 1, 2).skipToMorning).toBe(false)
    expect(advanceSleep(two, 2, 2, 1, 2).skipToMorning).toBe(true)
    expect(requiredSleeperCount(3, 0.5)).toBe(2)
    expect(sleepRatioFromPercentage(null)).toBe(1)
    expect(sleepRatioFromPercentage('50')).toBe(0.5)
    expect(sleepRatioFromPercentage('250')).toBe(1)
  })

  it('recounts on disconnect, death, or destroyed beds', () => {
    const state = enterSleep(enterSleep(initialSleepRuntimeState(), 'local', bed), 'remote', bed)
    expect(leaveSleep(state, 'local').sleepers.map(({ playerId }) => playerId)).toEqual(['remote'])
    expect(reconcileSleepers(state, new Set(['local']), () => true).sleepers).toHaveLength(1)
    expect(reconcileSleepers(state, new Set(['local', 'remote']), () => false).sleepers).toHaveLength(0)
  })

  it('validates hostile safety distance and respawn beds deterministically', () => {
    expect(isDangerNearby(bed.bedPosition, [{ x: 11, y: 68, z: 8 }])).toBe(true)
    expect(isDangerNearby(bed.bedPosition, [{ x: 13, y: 64, z: 8 }])).toBe(false)
    expect(validRespawnLocation(bed, () => true)).toEqual(bed)
    expect(validRespawnLocation(bed, () => false)).toBeNull()
  })
})
