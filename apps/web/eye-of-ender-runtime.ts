type Position = Readonly<{ x: number; y: number; z: number }>

export type RuntimeEyeOfEnder = Readonly<{
  id: string
  dimension: string
  position: Position
  start: Position
  destination: Position
  ageSeconds: number
  flightSeconds: number
  breaks: boolean
}>

export type EyeOfEnderRuntimeState = Readonly<{
  nextId: number
  eyes: ReadonlyArray<RuntimeEyeOfEnder>
}>

export type EyeOfEnderSettlement = Readonly<{
  eyeId: string
  dimension: string
  position: Position
  breaks: boolean
}>

export const initialEyeOfEnderRuntimeState = (): EyeOfEnderRuntimeState => ({
  nextId: 0,
  eyes: [],
})

export const launchRuntimeEyeOfEnder = (
  state: EyeOfEnderRuntimeState,
  input: Readonly<{
    dimension: string
    position: Position
    target: Position
    breaks: boolean
  }>,
): EyeOfEnderRuntimeState => {
  const dx = input.target.x - input.position.x
  const dz = input.target.z - input.position.z
  const horizontalDistance = Math.hypot(dx, dz)
  const travelDistance = Math.min(horizontalDistance, 12)
  const scale = horizontalDistance === 0 ? 0 : travelDistance / horizontalDistance
  const nextId = state.nextId + 1
  return {
    nextId,
    eyes: [...state.eyes, {
      id: `eye-of-ender-${String(nextId)}`,
      dimension: input.dimension,
      position: input.position,
      start: input.position,
      destination: {
        x: input.position.x + dx * scale,
        y: input.position.y + 8,
        z: input.position.z + dz * scale,
      },
      ageSeconds: 0,
      flightSeconds: 2.5,
      breaks: input.breaks,
    }],
  }
}

export const advanceEyeOfEnderRuntime = (
  state: EyeOfEnderRuntimeState,
  dimension: string,
  deltaSeconds: number,
): Readonly<{
  state: EyeOfEnderRuntimeState
  settlements: ReadonlyArray<EyeOfEnderSettlement>
}> => {
  const eyes: RuntimeEyeOfEnder[] = []
  const settlements: EyeOfEnderSettlement[] = []
  for (const eye of state.eyes) {
    if (eye.dimension !== dimension) {
      eyes.push(eye)
      continue
    }
    const ageSeconds = Math.min(eye.flightSeconds, eye.ageSeconds + Math.max(0, deltaSeconds))
    const progress = ageSeconds / eye.flightSeconds
    const position = {
      x: eye.start.x + (eye.destination.x - eye.start.x) * progress,
      y: eye.start.y + (eye.destination.y - eye.start.y) * Math.sin(progress * Math.PI / 2),
      z: eye.start.z + (eye.destination.z - eye.start.z) * progress,
    }
    if (ageSeconds >= eye.flightSeconds) {
      settlements.push({ eyeId: eye.id, dimension: eye.dimension, position, breaks: eye.breaks })
    } else {
      eyes.push({ ...eye, ageSeconds, position })
    }
  }
  return { state: { ...state, eyes }, settlements }
}

export const eyeOfEnderRenderDescriptors = (
  state: EyeOfEnderRuntimeState,
  dimension: string,
): ReadonlyArray<Readonly<{
  id: string
  kind: 'eye_of_ender'
  category: 'item'
  feetPosition: Position
  facingRadians: number
}>> => state.eyes
  .filter((eye) => eye.dimension === dimension)
  .map((eye) => ({
    id: `projectile:${eye.id}`,
    kind: 'eye_of_ender',
    category: 'item',
    feetPosition: eye.position,
    facingRadians: Math.atan2(
      -(eye.destination.x - eye.start.x),
      -(eye.destination.z - eye.start.z),
    ),
  }))

export const eyeOfEnderRuntimeSnapshot = (state: EyeOfEnderRuntimeState): ReadonlyArray<RuntimeEyeOfEnder> =>
  state.eyes
