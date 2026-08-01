export type SleepLocation = {
  readonly dimension: 'overworld'
  readonly position: Readonly<{ x: number; y: number; z: number }>
  readonly bedPosition: Readonly<{ x: number; y: number; z: number }>
}

export type SleepingPlayer = {
  readonly playerId: string
  readonly location: SleepLocation
  readonly elapsedSecs: number
}

export type SleepRuntimeState = {
  readonly sleepers: ReadonlyArray<SleepingPlayer>
}

export type SleepAdvance = {
  readonly state: SleepRuntimeState
  readonly skipToMorning: boolean
}

export const initialSleepRuntimeState = (): SleepRuntimeState => ({ sleepers: [] })

export const enterSleep = (
  state: SleepRuntimeState,
  playerId: string,
  location: SleepLocation,
): SleepRuntimeState => ({
  sleepers: [
    ...state.sleepers.filter((sleeper) => sleeper.playerId !== playerId),
    { playerId, location, elapsedSecs: 0 },
  ],
})

export const leaveSleep = (state: SleepRuntimeState, playerId: string): SleepRuntimeState => ({
  sleepers: state.sleepers.filter((sleeper) => sleeper.playerId !== playerId),
})

export const reconcileSleepers = (
  state: SleepRuntimeState,
  connectedSurvivalPlayerIds: ReadonlySet<string>,
  bedExists: (location: SleepLocation) => boolean,
): SleepRuntimeState => ({
  sleepers: state.sleepers.filter(
    (sleeper) => connectedSurvivalPlayerIds.has(sleeper.playerId) && bedExists(sleeper.location),
  ),
})

export const requiredSleeperCount = (connectedPlayers: number, ratio: number): number => {
  const normalizedRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1
  return Math.max(1, Math.ceil(connectedPlayers * normalizedRatio))
}

export const sleepRatioFromPercentage = (value: string | null): number => {
  if (value === null || value.trim() === '') return 1
  const percentage = Number(value)
  return Number.isFinite(percentage) ? Math.min(100, Math.max(0, percentage)) / 100 : 1
}

export const advanceSleep = (
  state: SleepRuntimeState,
  deltaSecs: number,
  connectedSurvivalPlayers: number,
  requiredRatio: number,
  delaySecs: number,
): SleepAdvance => {
  const sleepers = state.sleepers.map((sleeper) => ({
    ...sleeper,
    elapsedSecs: sleeper.elapsedSecs + Math.max(0, deltaSecs),
  }))
  const enoughPlayers = sleepers.length >= requiredSleeperCount(connectedSurvivalPlayers, requiredRatio)
  const waitedLongEnough = sleepers.some((sleeper) => sleeper.elapsedSecs >= delaySecs)
  return {
    state: { sleepers },
    skipToMorning: enoughPlayers && waitedLongEnough,
  }
}

export const validRespawnLocation = (
  location: SleepLocation | null,
  bedExists: (location: SleepLocation) => boolean,
): SleepLocation | null => location !== null && bedExists(location) ? location : null

export const isDangerNearby = (
  bedPosition: Readonly<{ x: number; y: number; z: number }>,
  hostiles: ReadonlyArray<Readonly<{ x: number; y: number; z: number }>>,
  horizontalRadius = 8,
  verticalRadius = 5,
): boolean => hostiles.some((hostile) =>
  Math.abs(hostile.y - bedPosition.y) <= verticalRadius
  && Math.hypot(hostile.x - bedPosition.x, hostile.z - bedPosition.z) <= horizontalRadius,
)
