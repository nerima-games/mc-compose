import {
  makeRuntimeRedstoneStages,
  pistonPositionAt,
  planPistonTransition,
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type RedstoneComponentSnapshot,
  type RedstonePosition,
} from '@nerima-games/mx-redstone'
import { blockIdOf, capabilityOfBlockId, isBlockType } from '@nerima-games/mc-kernel'
import { Context, Effect, Layer, Scope } from 'effect'

import type { MultiplayerServerCore } from './core'

const lampBlocks = new Set(['redstone_lamp', 'redstone_lamp_lit'] as const)
const doorBlocks = new Set(['door', 'door_open'] as const)
const pistonCapabilities = {
  pistonImmovable: (block: string): boolean =>
    isBlockType(block) && capabilityOfBlockId(blockIdOf(block), 'pistonImmovable'),
}

export interface MultiplayerRedstoneRealm {
  readonly dimension: string
  readonly core: MultiplayerServerCore
}

export interface MultiplayerRedstoneRuntime {
  readonly tick: (elapsedMs: number) => void
}

const componentForBlock = (
  core: MultiplayerServerCore,
  block: string | null,
  position: RedstonePosition,
): RedstoneComponentSnapshot | undefined => {
  switch (block) {
    case 'hopper':
      return { position, kind: 'hopper' }
    case 'dispenser':
      return { position, kind: 'dispenser' }
    case 'dropper':
      return { position, kind: 'dropper' }
    case 'redstone_torch':
      return { position, kind: 'torch' }
    case 'redstone_wire':
      return { position, kind: 'wire' }
    case 'powered_rail':
      return { position, kind: 'powered-rail', powered: core.isPoweredRailPowered(position) }
    case 'redstone_lamp':
    case 'redstone_lamp_lit':
      return { position, kind: 'lamp' }
    case 'door':
    case 'door_open':
      return { position, kind: 'door' }
    case 'piston': {
      const head = core.readPistonCell(pistonPositionAt(position, 'north', 1))
      return {
        position,
        kind: 'piston',
        pistonFacing: 'north',
        pistonKind: 'sticky',
        pistonState: head.kind === 'block' && head.block === 'piston_head' ? 'extended' : 'retracted',
      }
    }
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
          const component = componentForBlock(realm.core, block, at)
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
        } else if (event.kind === 'dropper') {
          realmsByDimension.get(event.dimension)?.core.applyDropperTrigger(event.position)
        }
      }
      for (const event of Effect.runSync(runtime.drainLampTransitions)) {
        realmsByDimension.get(event.dimension)?.core.applyRedstoneBlockState(
          event.position,
          lampBlocks,
          event.lit ? 'redstone_lamp_lit' : 'redstone_lamp',
        )
      }
      for (const event of Effect.runSync(runtime.drainPoweredComponentTransitions)) {
        const core = realmsByDimension.get(event.dimension)?.core
        if (event.kind === 'door') {
          core?.applyRedstoneBlockState(event.position, doorBlocks, event.powered ? 'door_open' : 'door')
        } else if (event.kind === 'powered-rail') {
          core?.applyPoweredRailState(event.position, event.powered)
        }
      }
      for (const event of Effect.runSync(runtime.drainPistonTransitions)) {
        const realm = realmsByDimension.get(event.dimension)
        if (realm === undefined) continue
        const outcome = planPistonTransition(event, { read: realm.core.readPistonCell }, pistonCapabilities)
        if (outcome.kind === 'move') realm.core.applyPistonPlan(outcome.plan)
      }
    },
  }
}
