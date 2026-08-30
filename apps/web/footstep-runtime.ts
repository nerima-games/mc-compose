import type { SoundCueId } from '@nerima-games/mc-audio'
import type { Position } from '@nerima-games/mc-kernel'

export type FootstepSurface = 'default' | 'grass' | 'wood' | 'stone'

export type FootstepRuntimeState = {
  readonly distanceSinceLastStep: number
}

export type FootstepAdvanceInput = {
  readonly grounded: boolean
  readonly horizontalDistance: number
  readonly surface: FootstepSurface
  readonly sneaking: boolean
  readonly dead: boolean
  readonly dimensionChanged: boolean
  readonly position: Position
  readonly play: (cueId: SoundCueId, options: { readonly position: Position; readonly gainScale: number }) => void
}

export const initialFootstepRuntimeState = (): FootstepRuntimeState => ({
  distanceSinceLastStep: 0,
})

const FOOTSTEP_DISTANCE = 2

// The published kernel/audio dependencies predate the typed surface APIs. Keep
// this host adapter explicit until compose consumes their next package release.
const cueForSurface = (surface: FootstepSurface): SoundCueId | undefined => {
  switch (surface) {
    case 'grass': return 'footstepGrass'
    case 'wood': return 'footstepWood'
    case 'stone': return 'footstepStone'
    case 'default': return undefined
  }
}

// This mirrors the published block vocabulary only at the package boundary;
// replace it with kernel property lookup when compose consumes that release.
export const surfaceForBlockType = (blockType: string): FootstepSurface => {
  if (['dirt', 'grass_block', 'farmland'].includes(blockType)) return 'grass'
  if (['oak_log', 'oak_leaves', 'oak_planks', 'sapling', 'ladder', 'chest', 'door'].includes(blockType)) return 'wood'
  if (['stone', 'sand', 'gravel', 'cobblestone', 'end_stone_bricks'].includes(blockType)) return 'stone'
  return 'default'
}

export const advanceFootstepRuntime = (
  state: FootstepRuntimeState,
  input: FootstepAdvanceInput,
): FootstepRuntimeState => {
  if (input.dead || input.dimensionChanged || !input.grounded) return initialFootstepRuntimeState()

  const distance = state.distanceSinceLastStep + Math.max(0, input.horizontalDistance)
  const cueId = cueForSurface(input.surface)
  if (cueId === undefined || distance < FOOTSTEP_DISTANCE) {
    return { distanceSinceLastStep: distance }
  }

  const steps = Math.floor(distance / FOOTSTEP_DISTANCE)
  for (let index = 0; index < steps; index += 1) {
    input.play(cueId, {
      position: input.position,
      gainScale: input.sneaking ? 0.55 : 1,
    })
  }
  return { distanceSinceLastStep: distance - steps * FOOTSTEP_DISTANCE }
}
