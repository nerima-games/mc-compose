import { describe, expect, it, vi } from 'vitest'
import {
  advanceFootstepRuntime,
  initialFootstepRuntimeState,
  surfaceForBlockType,
} from '../apps/web/footstep-runtime'

describe('footstep runtime', () => {
  it('classifies surfaces at the host compatibility boundary', () => {
    expect(surfaceForBlockType('grass_block')).toBe('grass')
    expect(surfaceForBlockType('oak_planks')).toBe('wood')
    expect(surfaceForBlockType('cobblestone')).toBe('stone')
    expect(surfaceForBlockType('air')).toBe('default')
  })

  it('emits one spatial cue per walking interval and preserves remainder', () => {
    const play = vi.fn()
    const state = advanceFootstepRuntime(initialFootstepRuntimeState(), {
      grounded: true,
      horizontalDistance: 4.5,
      surface: 'grass',
      sneaking: true,
      dead: false,
      dimensionChanged: false,
      position: { x: 1, y: 2, z: 3 },
      play,
    })

    expect(play).toHaveBeenCalledTimes(2)
    expect(play).toHaveBeenNthCalledWith(1, 'footstepGrass', {
      position: { x: 1, y: 2, z: 3 },
      gainScale: 0.55,
    })
    expect(state.distanceSinceLastStep).toBeCloseTo(0.5)
  })

  it('does not accumulate airborne or unknown-surface movement', () => {
    const play = vi.fn()
    const airborne = advanceFootstepRuntime(initialFootstepRuntimeState(), {
      grounded: false,
      horizontalDistance: 4,
      surface: 'stone',
      sneaking: false,
      dead: false,
      dimensionChanged: false,
      position: { x: 0, y: 0, z: 0 },
      play,
    })
    const unknown = advanceFootstepRuntime({ distanceSinceLastStep: 1.5 }, {
      grounded: true,
      horizontalDistance: 1,
      surface: 'default',
      sneaking: false,
      dead: false,
      dimensionChanged: false,
      position: { x: 0, y: 0, z: 0 },
      play,
    })

    expect(airborne).toEqual(initialFootstepRuntimeState())
    expect(unknown.distanceSinceLastStep).toBe(2.5)
    expect(play).not.toHaveBeenCalled()
  })
})
