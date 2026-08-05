import {
  launchArrow,
  stepArrow,
  type Arrow,
  type ProjectileHit,
  type ProjectileWorld,
} from '@nerima-games/mc-sim'

export type RuntimeProjectile = Readonly<{
  id: string
  dimension: string
  arrow: Arrow
  damage: number
  knockback: number
}>

export type ProjectileRuntimeState = Readonly<{
  nextId: number
  projectiles: ReadonlyArray<RuntimeProjectile>
}>

export type ProjectileImpact = Readonly<{
  projectileId: string
  hit: ProjectileHit
  damage: number
  knockback: number
  velocity: Readonly<{ x: number; y: number; z: number }>
}>

export const initialProjectileRuntimeState = (): ProjectileRuntimeState => ({
  nextId: 0,
  projectiles: [],
})

export const launchRuntimeProjectile = (
  state: ProjectileRuntimeState,
  input: Readonly<{
    dimension: string
    position: Readonly<{ x: number; y: number; z: number }>
    yawRadians: number
    pitchRadians: number
    speed: number
    damage: number
    knockback: number
    shooterId?: string
  }>,
): ProjectileRuntimeState => {
  const nextId = state.nextId + 1
  return {
    nextId,
    projectiles: [...state.projectiles, {
      id: `arrow-${String(nextId)}`,
      dimension: input.dimension,
      damage: input.damage,
      knockback: input.knockback,
      arrow: launchArrow({
        position: input.position,
        yawRadians: input.yawRadians,
        pitchRadians: input.pitchRadians,
        speed: input.speed,
        ...(input.shooterId === undefined ? {} : { shooterId: input.shooterId }),
      }),
    }],
  }
}

export const advanceProjectileRuntime = (
  state: ProjectileRuntimeState,
  world: ProjectileWorld,
  dimension: string,
  deltaSecs: number,
): Readonly<{ state: ProjectileRuntimeState; impacts: ReadonlyArray<ProjectileImpact> }> => {
  const projectiles: RuntimeProjectile[] = []
  const impacts: ProjectileImpact[] = []
  for (const projectile of state.projectiles) {
    if (projectile.dimension !== dimension || projectile.arrow.state !== 'flying') {
      projectiles.push(projectile)
      continue
    }
    const velocity = projectile.arrow.velocity
    const result = stepArrow(projectile.arrow, world, deltaSecs)
    if (result.hit !== undefined) {
      impacts.push({
        projectileId: projectile.id,
        hit: result.hit,
        damage: projectile.damage,
        knockback: projectile.knockback,
        velocity,
      })
    }
    if (result.arrow.state !== 'despawned') {
      projectiles.push({ ...projectile, arrow: result.arrow })
    }
  }
  return { state: { ...state, projectiles }, impacts }
}

export const recoverProjectile = (
  state: ProjectileRuntimeState,
  dimension: string,
  position: Readonly<{ x: number; y: number; z: number }>,
  radius: number,
): Readonly<{ state: ProjectileRuntimeState; recovered: RuntimeProjectile | null }> => {
  const radiusSquared = radius * radius
  const candidate = state.projectiles
    .filter((projectile) => projectile.dimension === dimension && projectile.arrow.state === 'stuck' && projectile.arrow.recoverable)
    .map((projectile) => ({
      projectile,
      distanceSquared:
        (projectile.arrow.position.x - position.x) ** 2 +
        (projectile.arrow.position.y - position.y) ** 2 +
        (projectile.arrow.position.z - position.z) ** 2,
    }))
    .filter(({ distanceSquared }) => distanceSquared <= radiusSquared)
    .sort((left, right) => left.distanceSquared - right.distanceSquared || left.projectile.id.localeCompare(right.projectile.id))[0]
  if (candidate === undefined) return { state, recovered: null }
  return {
    state: {
      ...state,
      projectiles: state.projectiles.filter(({ id }) => id !== candidate.projectile.id),
    },
    recovered: candidate.projectile,
  }
}

export const projectileRenderDescriptors = (
  state: ProjectileRuntimeState,
  dimension: string,
): ReadonlyArray<Readonly<{
  id: string
  kind: 'arrow'
  category: 'item'
  feetPosition: Readonly<{ x: number; y: number; z: number }>
  facingRadians: number
}>> => state.projectiles
  .filter((projectile) => projectile.dimension === dimension)
  .map((projectile) => ({
    id: `projectile:${projectile.id}`,
    kind: 'arrow',
    category: 'item',
    feetPosition: projectile.arrow.position,
    facingRadians: Math.atan2(-projectile.arrow.velocity.x, -projectile.arrow.velocity.z),
  }))

export const projectileRuntimeSnapshot = (
  state: ProjectileRuntimeState,
): ReadonlyArray<Readonly<{
  id: string
  dimension: string
  state: Arrow['state']
  position: Readonly<{ x: number; y: number; z: number }>
  ageSeconds: number
}>> => state.projectiles.map((projectile) => ({
  id: projectile.id,
  dimension: projectile.dimension,
  state: projectile.arrow.state,
  position: projectile.arrow.position,
  ageSeconds: projectile.arrow.ageSeconds,
}))
