import { describe, expect, it } from '@effect/vitest'
import { EntityId, itemStack, VehicleId } from '@nerima-games/mc-sim'
import type { RenderEntity } from '@nerima-games/mc-render'
import {
  projectRenderEntities,
  type RenderEntityProjectionInput,
} from '../apps/web/render-entity-projection'

const position = (x: number, y: number, z: number) => ({ x, y, z })

const projectionInput = (
  overrides: Partial<RenderEntityProjectionInput> = {},
): RenderEntityProjectionInput => ({
  localEntities: [],
  authoritativeEntities: [],
  runtimeEntities: [],
  remotePlayers: [],
  villagers: [],
  dimension: 'overworld',
  isVillagerChunkStreamed: () => true,
  endDragon: undefined,
  vehicles: [],
  ...overrides,
})

const runtimeEntity = {
  id: 'runtime-arrow',
  kind: 'arrow',
  category: 'item',
  feetPosition: position(7, 8, 9),
} satisfies RenderEntity

describe('projectRenderEntities', () => {
  it('projects local, authoritative, runtime, remote, villager, and vehicle entities', () => {
    const projected = projectRenderEntities(projectionInput({
      localEntities: [
        { id: 'local-item', kind: 'dropped_item', feetPosition: position(1, 2, 3) },
        { id: 'local-zombie', kind: 'zombie', feetPosition: position(2, 3, 4) },
      ],
      authoritativeEntities: [
        {
          _tag: 'living',
          entityId: EntityId('living-1'),
          entityType: 'skeleton',
          at: position(3, 4, 5),
          health: 20,
          maxHealth: 20,
        },
        {
          _tag: 'vehicle',
          entityId: EntityId('vehicle-1'),
          vehicleType: 'boat',
          at: position(4, 5, 6),
          occupant: null,
        },
        {
          _tag: 'arrow',
          entityId: EntityId('arrow-1'),
          at: position(5, 6, 7),
          velocity: position(0, 0, 0),
          damage: 2,
          owner: null,
          ageTicks: 0,
        },
        {
          _tag: 'primed-tnt',
          entityId: EntityId('tnt-1'),
          at: position(6, 7, 8),
          burnedSecs: 0,
          owner: null,
        },
        {
          _tag: 'item-drop',
          entityId: EntityId('item-1'),
          at: position(7, 8, 9),
          stack: itemStack('stone', 1),
        },
      ],
      runtimeEntities: [runtimeEntity],
      remotePlayers: [
        { id: 'remote-1', world: 'overworld', at: position(8, 9, 10) },
        { id: 'remote-2', world: 'nether', at: position(9, 10, 11) },
      ],
      villagers: [
        { id: 'villager-loaded', dimension: 'overworld', feetPosition: position(10, 11, 12) },
        { id: 'villager-unloaded', dimension: 'overworld', feetPosition: position(11, 12, 13) },
        { id: 'villager-other-dimension', dimension: 'nether', feetPosition: position(10, 11, 12) },
      ],
      dimension: 'overworld',
      isVillagerChunkStreamed: (villagerPosition) => villagerPosition.x === 10,
      endDragon: { phase: 'flying', position: position(12, 13, 14) },
      vehicles: [
        {
          id: VehicleId('boat-1'),
          type: 'boat',
          dimension: 'overworld',
          position: position(13, 14, 15),
          velocity: position(0, 0, 0),
          yawRadians: 1.5,
        },
        {
          id: VehicleId('minecart-1'),
          type: 'minecart',
          dimension: 'nether',
          position: position(14, 15, 16),
          velocity: position(0, 0, 0),
          yawRadians: 2.5,
        },
      ],
    }))

    expect(projected.map(({ id }) => id)).toEqual([
      'local-item',
      'local-zombie',
      'authoritative:living-1',
      'authoritative:vehicle-1',
      'authoritative:arrow-1',
      'authoritative:tnt-1',
      'authoritative:item-1',
      'runtime-arrow',
      'multiplayer:remote-1',
      'villager-loaded',
      'boat-1',
    ])
    expect(projected[0]).toMatchObject({ category: 'item' })
    expect(projected[1]).toMatchObject({ category: 'hostile' })
    expect(projected[2]).toMatchObject({ kind: 'skeleton', category: 'hostile' })
    expect(projected[3]).toMatchObject({ kind: 'boat', category: 'hostile' })
    expect(projected[4]).toMatchObject({ kind: 'arrow', category: 'item' })
    expect(projected[5]).toMatchObject({ kind: 'primed_tnt', category: 'hostile' })
    expect(projected[6]).toMatchObject({ kind: 'dropped_item', category: 'item' })
    expect(projected[7]).toBe(runtimeEntity)
    expect(projected[9]).toMatchObject({ kind: 'villager', feetPosition: position(10, 11, 12) })
    expect(projected[10]).toMatchObject({ kind: 'boat', facingRadians: 1.5 })
    expect(projected.some(({ id }) => id === 'ender-dragon')).toBe(false)
    expect(projected.some(({ id }) => id === 'multiplayer:remote-2')).toBe(false)
    expect(projected.some(({ id }) => id === 'villager-unloaded')).toBe(false)
    expect(projected.some(({ id }) => id === 'villager-other-dimension')).toBe(false)
    expect(projected.some(({ id }) => id === 'minecart-1')).toBe(false)
  })

  it('renders an active Ender Dragon only in the End', () => {
    const active = projectRenderEntities(projectionInput({
      dimension: 'end',
      endDragon: { phase: 'flying', position: position(1, 2, 3) },
    }))
    expect(active).toEqual([{
      id: 'ender-dragon',
      kind: 'ender_dragon',
      category: 'hostile',
      feetPosition: position(1, 2, 3),
    }])

    expect(projectRenderEntities(projectionInput({
      dimension: 'end',
      endDragon: { phase: 'dead', position: position(1, 2, 3) },
    }))).toEqual([])
    expect(projectRenderEntities(projectionInput({
      dimension: 'end',
      endDragon: undefined,
    }))).toEqual([])
  })
})
