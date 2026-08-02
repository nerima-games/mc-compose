import { describe, expect, it } from '@effect/vitest'
import {
  advanceEyeOfEnderRuntime,
  eyeOfEnderRenderDescriptors,
  initialEyeOfEnderRuntimeState,
  launchRuntimeEyeOfEnder,
} from '../apps/web/eye-of-ender-runtime'

const launch = (breaks = false) => launchRuntimeEyeOfEnder(initialEyeOfEnderRuntimeState(), {
  dimension: 'overworld',
  position: { x: 0, y: 64, z: 0 },
  target: { x: 100, y: 32, z: 0 },
  breaks,
})

describe('eye of ender runtime', () => {
  it('flies visibly toward the stronghold while rising', () => {
    const result = advanceEyeOfEnderRuntime(launch(), 'overworld', 1.25)
    expect(result.settlements).toEqual([])
    expect(result.state.eyes[0]?.position.x).toBe(6)
    expect(result.state.eyes[0]?.position.y).toBeGreaterThan(64)
    expect(eyeOfEnderRenderDescriptors(result.state, 'overworld')[0]).toMatchObject({
      id: 'projectile:eye-of-ender-1',
      kind: 'eye_of_ender',
      category: 'item',
    })
  })

  it('settles after its flight and preserves the predetermined break result', () => {
    const result = advanceEyeOfEnderRuntime(launch(true), 'overworld', 3)
    expect(result.state.eyes).toEqual([])
    expect(result.settlements).toEqual([expect.objectContaining({
      eyeId: 'eye-of-ender-1',
      breaks: true,
      position: { x: 12, y: 72, z: 0 },
    })])
  })

  it('advances only eyes in the active dimension', () => {
    const state = launchRuntimeEyeOfEnder(launch(), {
      dimension: 'nether',
      position: { x: 0, y: 64, z: 0 },
      target: { x: 0, y: 64, z: 100 },
      breaks: false,
    })
    const result = advanceEyeOfEnderRuntime(state, 'overworld', 1)
    expect(result.state.eyes.find(({ dimension }) => dimension === 'nether')?.ageSeconds).toBe(0)
    expect(result.state.eyes.find(({ dimension }) => dimension === 'overworld')?.ageSeconds).toBe(1)
  })
})
