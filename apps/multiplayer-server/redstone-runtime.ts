import {
  makeRuntimeRedstoneStages,
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type RedstoneComponentSnapshot,
  type RedstonePosition,
} from '@nerima-games/mx-redstone'
import { Context, Effect, Layer, Scope } from 'effect'

import type { MultiplayerServerCore } from './core'

export interface MultiplayerRedstoneRealm {
  readonly dimension: string
  readonly core: MultiplayerServerCore
}

export interface MultiplayerRedstoneRuntime {
  readonly tick: (elapsedMs: number) => void
}

const componentForBlock = (
  block: string | null,
  position: RedstonePosition,
): RedstoneComponentSnapshot | undefined => {
  switch (block) {
    case 'hopper':
      return { position, kind: 'hopper' }
    case 'dispenser':
      return { position, kind: 'dispenser' }
    case 'redstone_torch':
      return { position, kind: 'torch' }
    case 'redstone_wire':
      return { position, kind: 'wire' }
    default:
      return undefined
  }
}

/** Bridges mx-redstone events into server-owned gameplay authority. */
export const makeMultiplayerRedstoneRuntime = async (
  realms: ReadonlyArray<MultiplayerRedstoneRealm>,
): Promise<MultiplayerRedstoneRuntime> => {
  const scope = Effect.runSync(Scope.make())
  const context = await Effect.runPromise(
    Effect.provideService(Layer.build(RedstoneWorldRuntimeLayer), Scope.Scope, scope),
  )
  const runtime = Context.get(context, RedstoneWorldRuntime)
  const stages = await Effect.runPromise(Effect.provide(makeRuntimeRedstoneStages, context))
  const realmsByDimension = new Map(realms.map((realm) => [realm.dimension, realm]))

  return {
    tick: (elapsedMs) => {
      for (const realm of realms) {
        const components = realm.core.snapshot().blocks.flatMap(({ at, block }) => {
          const component = componentForBlock(block, at)
          return component === undefined ? [] : [component]
        })
        Effect.runSync(runtime.syncSnapshot({ dimension: realm.dimension, components }))
      }
      const elapsedSecs = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs / 1_000 : 0
      for (const stage of stages) {
        Effect.runSync(stage.run(elapsedSecs as Parameters<typeof stage.run>[0]))
      }
      for (const event of Effect.runSync(runtime.drainHopperTransferEvents)) {
        realmsByDimension.get(event.dimension)?.core.applyHopperTransfer(event.position)
      }
      for (const event of Effect.runSync(runtime.drainTriggerEvents)) {
        if (event.kind === 'dispenser') {
          realmsByDimension.get(event.dimension)?.core.applyDispenserTrigger(event.position)
        }
      }
    },
  }
}
