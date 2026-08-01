import { describe, expect, it } from '@effect/vitest'
import type { ProjectileWorld } from '@nerima-games/mc-physics'
import {
  advanceProjectileRuntime,
  initialProjectileRuntimeState,
  launchRuntimeProjectile,
  projectileRenderDescriptors,
  recoverProjectile,
} from '../apps/web/projectile-runtime'

const world = (overrides: Partial<ProjectileWorld> = {}): ProjectileWorld => ({
  blockBounds: () => [],
  bounds: { minX: -100, minY: -100, minZ: -100, maxX: 100, maxY: 100, maxZ: 100 },
  entities: [],
  isInWater: () => false,
  ...overrides,
})

const launched = () => launchRuntimeProjectile(initialProjectileRuntimeState(), {
  dimension: 'overworld',
  position: { x: 0, y: 1, z: 0 },
  yawRadians: -Math.PI / 2,
  pitchRadians: 0,
  speed: 100,
  damage: 7,
  knockback: 1,
  shooterId: 'player',
})

describe('projectile runtime', () => {
  it('integrates gravity and drag and emits an existing renderer descriptor', () => {
    const result = advanceProjectileRuntime(launched(), world(), 'overworld', 0.05)
    expect(result.state.projectiles[0]?.arrow.velocity.y).toBeLessThan(0)
    expect(projectileRenderDescriptors(result.state, 'overworld')[0]).toMatchObject({
      id: 'projectile:arrow-1', category: 'item', kind: 'arrow',
    })
  })

  it('continuously collides with a block, remains stuck, and can be recovered', () => {
    const result = advanceProjectileRuntime(launched(), world({
      blockBounds: () => [{ minX: 2, minY: 0, minZ: -1, maxX: 3, maxY: 2, maxZ: 1 }],
    }), 'overworld', 0.05)
    expect(result.impacts[0]?.hit).toMatchObject({ kind: 'block', point: { x: 2 } })
    expect(result.state.projectiles[0]?.arrow.state).toBe('stuck')
    const recovered = recoverProjectile(result.state, 'overworld', { x: 2, y: 1, z: 0 }, 1)
    expect(recovered.recovered?.id).toBe('arrow-1')
    expect(recovered.state.projectiles).toHaveLength(0)
  })

  it('damages through entity impacts, despawns, and observes shooter grace', () => {
    const target = { id: 'mob', bounds: { minX: 2, minY: 0, minZ: -1, maxX: 3, maxY: 2, maxZ: 1 } }
    const hit = advanceProjectileRuntime(launched(), world({ entities: [target] }), 'overworld', 0.05)
    expect(hit.impacts[0]).toMatchObject({ damage: 7, knockback: 1, hit: { kind: 'entity', entityId: 'mob' } })
    expect(hit.state.projectiles).toHaveLength(0)

    const shooter = { id: 'player', bounds: { minX: 0, minY: 0, minZ: -1, maxX: 1, maxY: 2, maxZ: 1 } }
    expect(advanceProjectileRuntime(launched(), world({ entities: [shooter] }), 'overworld', 0.01).impacts).toHaveLength(0)
  })

  it('removes projectiles that expire or leave the world and resets deterministically', () => {
    const out = advanceProjectileRuntime(launched(), world({
      bounds: { minX: -1, minY: -1, minZ: -1, maxX: 0.1, maxY: 2, maxZ: 1 },
    }), 'overworld', 0.05)
    expect(out.state.projectiles).toHaveLength(0)
    expect(initialProjectileRuntimeState()).toStrictEqual({ nextId: 0, projectiles: [] })
  })
})
