import { DeltaTimeSecs } from '@nerima-games/mc-kernel'

export const FIRST_FRAME_SECS = 0.016

const MIN_FRAME_SECS = 0.001
const MAX_FRAME_SECS = 0.05

export type FrameDeltas = {
  readonly simulation: DeltaTimeSecs
  readonly interaction: DeltaTimeSecs
}

const nonNegativeFiniteSecs = (raw: number): number =>
  Number.isFinite(raw) ? Math.max(0, raw) : 0

export const frameDeltas = (raw: number): FrameDeltas => {
  const interaction = nonNegativeFiniteSecs(raw)
  return {
    simulation: DeltaTimeSecs(Math.min(Math.max(MIN_FRAME_SECS, interaction), MAX_FRAME_SECS)),
    interaction: DeltaTimeSecs(interaction),
  }
}
