import { describe, expect, it } from 'vitest'

import {
  advanceWitherRuntime,
  damageRuntimeWither,
  initialWitherRuntimeState,
  matchRuntimeWitherSummon,
  restoreWitherRuntime,
  snapshotWitherRuntime,
  summonRuntimeWither,
} from '../apps/web/wither-runtime'

describe('wither runtime', () => {
  it('matches either horizontal summon orientation from the placed skull', () => {
    const materials = new Map([
      ['0,64,0', 'soul_sand'],
      ['0,65,0', 'soul_sand'],
      ['-1,65,0', 'soul_soil'],
      ['1,65,0', 'soul_sand'],
      ['-1,66,0', 'wither_skeleton_skull'],
      ['0,66,0', 'wither_skeleton_skull'],
      ['1,66,0', 'wither_skeleton_skull'],
    ])
    const match = matchRuntimeWitherSummon(
      { x: 1, y: 66, z: 0 },
      ({ x, y, z }) => materials.get(`${String(x)},${String(y)},${String(z)}`),
    )
    expect(match?.axis).toBe('x')
    expect(match?.consumedBlocks).toHaveLength(7)
  })

  it('charges for ten seconds, explodes, tracks, attacks, and persists', () => {
    let runtime = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', { x: 0, y: 64, z: 0 })
    const charging = advanceWitherRuntime(runtime, 'overworld', { x: 8, y: 64, z: 0 }, 9.9, () => false)
    expect(charging.explosions).toEqual([])

    const active = advanceWitherRuntime(charging.state, 'overworld', { x: 8, y: 64, z: 0 }, 0.1, () => false)
    expect(active.explosions).toContainEqual(expect.objectContaining({ power: 7 }))
    expect(active.state.withers[0]?.state.phase).toBe('airborne')

    runtime = advanceWitherRuntime(active.state, 'overworld', { x: 8, y: 64, z: 0 }, 2, () => false).state
    expect(runtime.skulls).toHaveLength(1)
    expect(restoreWitherRuntime(snapshotWitherRuntime(runtime))).toEqual(runtime)
  })

  it('ignores ranged damage after armour activates and drops a nether star on death', () => {
    let runtime = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', { x: 0, y: 64, z: 0 })
    runtime = advanceWitherRuntime(runtime, 'overworld', { x: 10, y: 64, z: 0 }, 10, () => false).state
    runtime = damageRuntimeWither(runtime, 'wither-1', 150, 'melee').state
    expect(runtime.withers[0]?.state.phase).toBe('armoured')
    const ranged = damageRuntimeWither(runtime, 'wither-1', 100, 'ranged')
    expect(ranged.state.withers[0]?.state.healthPoints).toBe(150)
    const killed = damageRuntimeWither(ranged.state, 'wither-1', 150, 'melee')
    expect(killed.death?.drop).toEqual({
      item: 'nether_star',
      count: 1,
      position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), z: expect.any(Number) }),
    })
    expect(killed.state.withers).toEqual([])
  })

  it('uses blue skull terrain semantics every third shot', () => {
    let runtime = summonRuntimeWither(initialWitherRuntimeState(), 'overworld', { x: 0, y: 64, z: 0 })
    runtime = advanceWitherRuntime(runtime, 'overworld', { x: 20, y: 64, z: 0 }, 10, () => false).state
    for (let shot = 0; shot < 3; shot += 1) {
      runtime = advanceWitherRuntime(runtime, 'overworld', { x: 20, y: 64, z: 0 }, 2, () => false).state
    }
    expect(runtime.withers[0]?.shotsFired).toBe(3)
    expect(runtime.skulls.map((skull) => skull.descriptor.variant)).toEqual(['normal', 'normal', 'blue'])
    expect(runtime.skulls.find((skull) => skull.descriptor.variant === 'blue')?.descriptor.destroysResistantBlocks).toBe(true)
  })
})
