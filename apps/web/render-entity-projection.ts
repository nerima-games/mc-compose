import type { Vehicle } from '@nerima-games/mc-sim'
import type { RenderEntity } from '@nerima-games/mc-render'
import type { AuthoritativeEntityState } from '@nerima-games/mx-multiplayer'

export type RenderPosition = RenderEntity['feetPosition']

export type LocalEntityForRender = Readonly<Pick<RenderEntity, 'id' | 'kind' | 'feetPosition'>>

export type AuthoritativeEntityForRender = AuthoritativeEntityState

export type RemotePlayerForRender = Readonly<{
  readonly id: string
  readonly world: string
  readonly at: RenderPosition
}>

export type VillagerForRender = Readonly<{
  readonly id: string
  readonly dimension: string
  readonly feetPosition: RenderPosition
}>

export type VehicleForRender = Vehicle

export type RenderEntityProjectionInput = Readonly<{
  readonly localEntities: ReadonlyArray<LocalEntityForRender>
  readonly authoritativeEntities: ReadonlyArray<AuthoritativeEntityForRender>
  readonly runtimeEntities: ReadonlyArray<RenderEntity>
  readonly remotePlayers: ReadonlyArray<RemotePlayerForRender>
  readonly villagers: ReadonlyArray<VillagerForRender>
  readonly dimension: string
  readonly isVillagerChunkStreamed: (position: RenderPosition) => boolean
  readonly endDragon:
    | Readonly<{
        readonly phase: string
        readonly position: RenderPosition
      }>
    | undefined
  readonly vehicles: ReadonlyArray<VehicleForRender>
}>

const authoritativeEntityKind = (entity: AuthoritativeEntityForRender): string => {
  switch (entity._tag) {
    case 'living':
      return entity.entityType
    case 'vehicle':
      return entity.vehicleType
    case 'arrow':
      return 'arrow'
    case 'primed-tnt':
      return 'primed_tnt'
    case 'item-drop':
      return 'dropped_item'
  }
}

export const projectRenderEntities = (
  input: RenderEntityProjectionInput,
): ReadonlyArray<RenderEntity> => {
  const endDragon = input.endDragon

  return [
    ...input.localEntities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      category: entity.kind === 'dropped_item' ? 'item' : 'hostile',
    } satisfies RenderEntity)),
    ...input.authoritativeEntities.map((entity) => ({
      id: `authoritative:${String(entity.entityId)}`,
      kind: authoritativeEntityKind(entity),
      feetPosition: entity.at,
      category: entity._tag === 'item-drop' || entity._tag === 'arrow' ? 'item' as const : 'hostile' as const,
    } satisfies RenderEntity)),
    ...input.runtimeEntities,
    ...input.remotePlayers
      .filter((player) => player.world === input.dimension)
      .map((player) => ({
        id: `multiplayer:${player.id}`,
        kind: 'remote_player',
        feetPosition: player.at,
      } satisfies RenderEntity)),
    ...input.villagers
      .filter((villager) => villager.dimension === input.dimension)
      .filter((villager) => input.isVillagerChunkStreamed(villager.feetPosition))
      .map((villager) => ({
        id: villager.id,
        kind: 'villager',
        feetPosition: villager.feetPosition,
      } satisfies RenderEntity)),
    ...(input.dimension === 'end' && endDragon !== undefined && endDragon.phase !== 'dead'
      ? [{
          id: 'ender-dragon',
          kind: 'ender_dragon',
          category: 'hostile' as const,
          feetPosition: endDragon.position,
        } satisfies RenderEntity]
      : []),
    ...input.vehicles
      .filter((vehicle) => vehicle.dimension === input.dimension)
      .map((vehicle) => ({
        id: String(vehicle.id),
        kind: vehicle.type,
        feetPosition: vehicle.position,
        facingRadians: vehicle.yawRadians,
      } satisfies RenderEntity)),
  ]
}
