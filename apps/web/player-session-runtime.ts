import { Effect } from 'effect'
import type { Position, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import type { Vehicle } from '@nerima-games/mc-sim'
import type { Dimension } from '@nerima-games/mc-worldgen'
import type { RenderEntity } from '@nerima-games/mc-render'
import type { AuthoritativeEntityState } from '@nerima-games/mx-multiplayer'
import type { RemotePlayer } from './multiplayer-client'
import type { PersistedVillager, SessionPosition } from './session-persistence'
import { makeQaSurface } from './qa-surface'
import { describeQaApiError } from '../../src/domain/qa-api'
import type { TouchLookResetReason } from './touch-input'

type LocalEntityProjection = Readonly<{
  id: string
  kind: string
  feetPosition: Position
}>

export type PlayerSessionRuntimeContext = {
  readonly getCurrentDimension: () => Dimension
  readonly getLocalEntities: () => ReadonlyArray<LocalEntityProjection>
  readonly getAuthoritativeEntities: () => ReadonlyArray<readonly [string, AuthoritativeEntityState]>
  readonly getProjectileEntities: () => ReadonlyArray<RenderEntity>
  readonly getEyeOfEnderEntities: () => ReadonlyArray<RenderEntity>
  readonly getWitherEntities: () => ReadonlyArray<RenderEntity>
  readonly getRemotePlayers: () => ReadonlyArray<readonly [string, RemotePlayer]>
  readonly getVillagerResidents: () => ReadonlyArray<PersistedVillager>
  readonly isCurrentChunkLoaded: (position: Position) => boolean
  readonly getEndDragonPhase: () => string
  readonly getEndDragonPosition: () => Position
  readonly getVehicles: () => ReadonlyArray<Vehicle>
  readonly syncEntities: (entities: ReadonlyArray<RenderEntity>) => Effect.Effect<void>
}

export type PlayerLifecycleContext = {
  readonly document: Document
  readonly window: Pick<Window, 'setInterval' | 'addEventListener'>
  readonly autosaveIntervalMs: number
  readonly requestBackgroundFlush: () => void
  readonly resetTouchInput: (reason: TouchLookResetReason) => void
  readonly getStopBrowserPreview: () => (() => Promise<void>) | undefined
  readonly hasMultiplayer: () => boolean
  readonly leaveMultiplayer: () => void
  readonly settingsView: { readonly dispose: () => void }
  readonly endAudio: { readonly dispose: () => void }
  readonly weatherAudio: { readonly dispose: () => void }
  readonly clearPendingThunder: () => void
  readonly removeNativeMouseDown: () => void
  readonly disposeWorldRenderer: () => void
  readonly disposeAtlasTexture: () => void
  readonly closeAudio: () => void
  readonly registerHotDispose: (callback: () => void) => void
}

export type PlayerSessionRuntime = {
  readonly entityRenderProjection: () => ReadonlyArray<RenderEntity>
  readonly syncRenderedEntities: () => void
  readonly nearestVillagerForTrade: (
    position: SessionPosition,
    dimension: Dimension,
  ) => PersistedVillager | undefined
}

export type PlayerLifecycleRuntime = {
  readonly disposeMultiplayer: () => void
  readonly disposeRuntime: () => void
}

export const createPlayerSessionRuntime = (
  context: PlayerSessionRuntimeContext,
): PlayerSessionRuntime => {
  const entityRenderProjection = (): ReadonlyArray<RenderEntity> => [
    ...context.getLocalEntities().map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      category: entity.kind === 'dropped_item' ? 'item' : 'hostile',
    } satisfies RenderEntity)),
    ...context.getAuthoritativeEntities().map(([, entity]) => ({
      id: `authoritative:${String(entity.entityId)}`,
      kind: entity._tag === 'living'
        ? entity.entityType
        : entity._tag === 'vehicle'
          ? entity.vehicleType
          : entity._tag === 'arrow'
            ? 'arrow'
            : entity._tag === 'primed-tnt'
              ? 'primed_tnt'
              : 'dropped_item',
      feetPosition: entity.at,
      category: entity._tag === 'item-drop' || entity._tag === 'arrow' ? 'item' as const : 'hostile' as const,
    } satisfies RenderEntity)),
    ...context.getProjectileEntities(),
    ...context.getEyeOfEnderEntities(),
    ...context.getWitherEntities(),
    ...context.getRemotePlayers()
      .filter(([, player]) => player.world === context.getCurrentDimension())
      .map(([playerId, player]) => ({
        id: `multiplayer:${String(playerId)}`,
        kind: 'remote_player',
        feetPosition: player.at,
      } satisfies RenderEntity)),
    ...context.getVillagerResidents()
      .filter((villager) => villager.dimension === context.getCurrentDimension())
      .filter((villager) => context.isCurrentChunkLoaded(villager.feetPosition))
      .map((villager) => ({
        id: villager.id,
        kind: 'villager',
        feetPosition: villager.feetPosition,
      } satisfies RenderEntity)),
    ...(context.getCurrentDimension() === 'end' && context.getEndDragonPhase() !== 'dead'
      ? [{
          id: 'ender-dragon',
          kind: 'ender_dragon',
          category: 'hostile' as const,
          feetPosition: context.getEndDragonPosition(),
        } satisfies RenderEntity]
      : []),
    ...context.getVehicles()
      .filter((vehicle) => vehicle.dimension === context.getCurrentDimension())
      .map((vehicle) => ({
        id: String(vehicle.id),
        kind: vehicle.type,
        feetPosition: vehicle.position,
        facingRadians: vehicle.yawRadians,
      } satisfies RenderEntity)),
  ]
  const syncRenderedEntities = (): void => {
    Effect.runSync(context.syncEntities(entityRenderProjection()))
  }
  const nearestVillagerForTrade = (
    position: SessionPosition,
    dimension: Dimension,
  ): PersistedVillager | undefined => {
    let nearest: PersistedVillager | undefined
    let nearestDistanceSquared = 16
    for (const villager of context.getVillagerResidents()) {
      if (villager.dimension !== dimension) continue
      const dx = villager.feetPosition.x - position.x
      const dy = villager.feetPosition.y - position.y
      const dz = villager.feetPosition.z - position.z
      const distanceSquared = dx * dx + dy * dy + dz * dz
      if (
        distanceSquared < nearestDistanceSquared
        || (distanceSquared === nearestDistanceSquared && villager.id < (nearest?.id ?? ''))
      ) {
        nearest = villager
        nearestDistanceSquared = distanceSquared
      }
    }
    return nearest
  }
  return { entityRenderProjection, syncRenderedEntities, nearestVillagerForTrade }
}

export const installPlayerQaSurface = (
  context: Parameters<typeof makeQaSurface>[0],
  failBoot: (title: string, reason: string) => void,
): boolean => {
  const result = makeQaSurface(context)
  if (result._tag === 'Left') {
    failBoot('QA registry rejected', describeQaApiError(result.left))
    return false
  }
  result.right.install()
  return true
}

export const installPlayerLifecycle = (context: PlayerLifecycleContext): PlayerLifecycleRuntime => {
  context.window.setInterval(context.requestBackgroundFlush, context.autosaveIntervalMs)
  let multiplayerDisposeStarted = false
  const disposeMultiplayer = (): void => {
    if (!context.hasMultiplayer() || multiplayerDisposeStarted) return
    multiplayerDisposeStarted = true
    context.leaveMultiplayer()
  }
  let runtimeDisposed = false
  const disposeRuntime = (): void => {
    if (runtimeDisposed) return
    runtimeDisposed = true
    context.settingsView.dispose()
    context.endAudio.dispose()
    context.weatherAudio.dispose()
    context.clearPendingThunder()
    context.removeNativeMouseDown()
    context.disposeWorldRenderer()
    context.disposeAtlasTexture()
    context.closeAudio()
  }
  context.document.addEventListener('visibilitychange', () => {
    if (context.document.visibilityState === 'hidden') {
      context.resetTouchInput('visibility-hidden')
      context.requestBackgroundFlush()
    }
  })
  context.window.addEventListener('blur', () => context.resetTouchInput('blur'))
  // IndexedDB cannot be made synchronous during pagehide; this is best-effort.
  // Periodic publication persists advancing time and weather without gameplay mutations.
  context.window.addEventListener('pagehide', (event) => {
    context.requestBackgroundFlush()
    void context.getStopBrowserPreview()?.()
    disposeMultiplayer()
    if (!event.persisted) disposeRuntime()
  })
  context.registerHotDispose(() => {
    void context.getStopBrowserPreview()?.()
    disposeMultiplayer()
    disposeRuntime()
  })
  return { disposeMultiplayer, disposeRuntime }
}

export type PlayerFramePreparationContext<Frame> = {
  readonly makeRunFrame: () => Frame
  readonly readNow: () => MonotonicTimeSecs
}

export const createPlayerFramePreparation = <Frame>(
  context: PlayerFramePreparationContext<Frame>,
): Readonly<{ readonly runFrame: Frame; readonly readNow: () => MonotonicTimeSecs }> => ({
  runFrame: context.makeRunFrame(),
  readNow: context.readNow,
})
