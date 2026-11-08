import {
  BlockId,
  blockIdOf,
  blockTypeOfId,
  capabilityOfBlockId,
  type BlockPosition,
} from '@nerima-games/mc-kernel'
import { Effect } from 'effect'
import { chunkKeyOf } from '@nerima-games/mc-render'
import {
  containerIdAt,
  maxStackCountForItem,
  type ContainerKind,
  type ItemStack,
} from '@nerima-games/mc-sim'
import { type Dimension } from '@nerima-games/mc-worldgen'
import {
  applyPistonPlan,
  pistonPositionAt,
  planPistonTransition,
  type PistonMovementPlan,
  type PoweredPistonTransition,
  type RedstoneComponentSnapshot,
  type RedstoneWorldRuntimeService,
} from '@nerima-games/mx-redstone'
import {
  spawnDroppedItems,
  type EnchantedItem,
  type GeneratedWorld,
  type MobBehaviour,
} from '@nerima-games/mx-gameplay'
import { type ChestStorageSlotCount } from '@nerima-games/mx-ui'
import {
  snapshotResidentChunks,
  type PersistedLeverState,
} from './session-persistence'
import { type DroppedItemMetadata } from './dropped-item-metadata'

export type RedstoneBlockPosition = {
  readonly x: number
  readonly y: number
  readonly z: number
}

type World = GeneratedWorld<MobBehaviour>

export type RedstoneDimensionChunkContext = {
  readonly dimension: Dimension
  readonly chunkStore: World['chunkStore']
  readonly worldgenChunkStore: World['worldgenChunkStore']
  readonly streamLoaded: Set<string>
}

export type PressurePlateOccupancy = {
  readonly dimension: Dimension
  readonly position: RedstoneBlockPosition
  readonly occupied: boolean
}

export type RedstoneContainerRuntimeContext = {
  readonly dimensionContexts: ReadonlyMap<Dimension, RedstoneDimensionChunkContext>
  readonly world: World
  readonly leverStates: Map<string, PersistedLeverState>
  readonly comparatorModes: Map<string, 'compare' | 'subtract'>
  readonly observerInputs: Map<string, number>
  readonly observerPulses: Map<string, number>
  readonly pressurePlateOccupancy: Map<string, PressurePlateOccupancy>
  readonly poweredRails: Set<string>
  readonly getSimulationElapsedSecs: () => number
  readonly isMultiplayer: () => boolean
  readonly setRedstoneDirty: (dirty: boolean) => void
  readonly markSessionDirty: () => void
  readonly redstoneRuntime: RedstoneWorldRuntimeService
  readonly customNames: Map<string, string>
  readonly enchantedItems: Map<string, EnchantedItem>
  readonly droppedItemMetadata: Map<string, DroppedItemMetadata>
  readonly containerMetadataKey: (containerId: string, slot: number) => string
  readonly copyItemMetadata: (source: string, target: string) => void
  readonly deleteItemMetadata: (key: string) => void
  readonly droppedItemMetadataKey: (dimension: Dimension, entityId: string) => string
  readonly getFramesTotal: () => number
  readonly asBlockPosition: (position: RedstoneBlockPosition) => BlockPosition
  readonly leverKeyOf: (lever: Pick<PersistedLeverState, 'dimension' | 'position'>) => string
}

export type RedstoneContainerRuntime = {
  readonly syncRedstoneSnapshot: (context: RedstoneDimensionChunkContext) => void
  readonly containerIdForStorageBlock: (
    dimension: Dimension,
    position: RedstoneBlockPosition,
  ) => string | undefined
  readonly applyHopperTransfer: (dimension: Dimension, position: RedstoneBlockPosition) => void
  readonly applyDispenserTrigger: (dimension: Dimension, position: RedstoneBlockPosition) => void
  readonly applyDropperTrigger: (dimension: Dimension, position: RedstoneBlockPosition) => void
  readonly applyPoweredPistonTransition: (transition: PoweredPistonTransition) => void
}

export const containerKindForStorageBlock = (
  type: ReturnType<typeof blockTypeOfId>,
): ContainerKind | undefined => {
  switch (type) {
    case 'chest':
      return 'chest'
    case 'shulker_box':
      return 'shulker_box'
    case 'dispenser':
      return 'dispenser'
    case 'dropper':
      return 'dropper'
    case 'hopper':
      return 'hopper'
    default:
      return undefined
  }
}

export const chestStorageSlotCount = (
  slotCount: number | undefined,
): ChestStorageSlotCount => slotCount === 5 || slotCount === 9 ? slotCount : 27

type ContainerTransferSnapshot = { readonly slots: ReadonlyArray<ItemStack | null> }
type MoveContainerItemInput = {
  readonly sourceContainerId: string
  readonly sourceSlot: number
  readonly destinationContainerId: string
  readonly destinationSlot: number
  readonly count: number
}

export type ContainerTransferOperations = {
  readonly snapshot: (containerId: string) => ContainerTransferSnapshot | null
  readonly move: (input: MoveContainerItemInput) => { readonly _tag: string }
  readonly metadataKey: (containerId: string, slot: number) => string
  readonly copyMetadata: (source: string, destination: string) => void
  readonly deleteMetadata: (key: string) => void
  readonly markSessionDirty: () => void
}

export const transferOneContainerItem = (
  sourceContainerId: string,
  destinationContainerId: string,
  operations: ContainerTransferOperations,
): boolean => {
  const source = operations.snapshot(sourceContainerId)
  const destination = operations.snapshot(destinationContainerId)
  if (source === null || destination === null) return false

  const sourceSlot = source.slots.findIndex((stack) => stack !== null)
  const destinationSlot = destination.slots.findIndex((stack) => stack === null)
  if (sourceSlot < 0 || destinationSlot < 0) return false

  const sourceMetadataKey = operations.metadataKey(sourceContainerId, sourceSlot)
  const destinationMetadataKey = operations.metadataKey(destinationContainerId, destinationSlot)
  const moved = operations.move({
    sourceContainerId,
    sourceSlot,
    destinationContainerId,
    destinationSlot,
    count: 1,
  })
  if (moved._tag !== 'Moved') return false

  operations.copyMetadata(sourceMetadataKey, destinationMetadataKey)
  const updatedSource = operations.snapshot(sourceContainerId)
  if (updatedSource?.slots[sourceSlot] === null) {
    operations.deleteMetadata(sourceMetadataKey)
  }
  operations.markSessionDirty()
  return true
}

export type HopperTransferOperations = {
  readonly isMultiplayer: () => boolean
  readonly resolveContainerId: (
    dimension: Dimension,
    position: RedstoneBlockPosition,
  ) => string | undefined
  readonly moveOneContainerItem: (
    sourceContainerId: string,
    destinationContainerId: string,
  ) => boolean
}

export const transferHopperItem = (
  dimension: Dimension,
  position: RedstoneBlockPosition,
  operations: HopperTransferOperations,
): void => {
  if (operations.isMultiplayer()) return

  const hopperId = operations.resolveContainerId(dimension, position)
  if (hopperId === undefined) return

  const belowId = operations.resolveContainerId(dimension, {
    x: position.x,
    y: position.y - 1,
    z: position.z,
  })
  if (belowId !== undefined && operations.moveOneContainerItem(hopperId, belowId)) return

  const aboveId = operations.resolveContainerId(dimension, {
    x: position.x,
    y: position.y + 1,
    z: position.z,
  })
  if (aboveId !== undefined) operations.moveOneContainerItem(aboveId, hopperId)
}

export const makeRedstoneContainerRuntime = (
  deps: RedstoneContainerRuntimeContext,
): RedstoneContainerRuntime => {
  const {
    dimensionContexts,
    world,
    leverStates,
    comparatorModes,
    observerInputs,
    observerPulses,
    pressurePlateOccupancy,
    poweredRails,
    getSimulationElapsedSecs,
    isMultiplayer,
    setRedstoneDirty,
    markSessionDirty,
    redstoneRuntime,
    customNames,
    enchantedItems,
    droppedItemMetadata,
    containerMetadataKey,
    copyItemMetadata,
    deleteItemMetadata,
    droppedItemMetadataKey,
    getFramesTotal,
    asBlockPosition,
    leverKeyOf,
  } = deps

  const syncRedstoneSnapshot = (context: RedstoneDimensionChunkContext): void => {
    const residents = Effect.runSync(snapshotResidentChunks(context.worldgenChunkStore))
    const components: Array<RedstoneComponentSnapshot> = []
    const observedLevers = new Set<string>()
    const observedPlates = new Set<string>()
    for (const chunk of residents) {
      for (let lx = 0; lx < 16; lx += 1) {
        for (let lz = 0; lz < 16; lz += 1) {
          for (let y = 0; y < 256; y += 1) {
            const block = chunk.blocks[y + lz * 256 + lx * 4096]
            const kind = block === blockIdOf('redstone_wire')
              ? 'wire'
              : block === blockIdOf('redstone_torch')
                ? 'torch'
              : block === blockIdOf('lever')
                ? 'lever'
                : block === blockIdOf('stone_button')
                  ? 'button'
                  : block === blockIdOf('repeater')
                    ? 'repeater'
                : block === blockIdOf('redstone_lamp') || block === blockIdOf('redstone_lamp_lit')
                  ? 'lamp'
                  : block === blockIdOf('observer')
                    ? 'observer'
                    : block === blockIdOf('comparator')
                      ? 'comparator'
                      : block === blockIdOf('dispenser')
                        ? 'dispenser'
                        : block === blockIdOf('dropper')
                          ? 'dropper'
                        : block === blockIdOf('hopper')
                          ? 'hopper'
                          : block === blockIdOf('pressure_plate')
                            ? 'pressure-plate'
                  : block === blockIdOf('piston')
                    ? 'piston'
                    : block === blockIdOf('powered_rail')
                      ? 'powered-rail'
                      : block === blockIdOf('door') || block === blockIdOf('door_open')
                        ? 'door'
                  : undefined
            if (kind === undefined) continue
            const position = { x: chunk.coord.cx * 16 + lx, y, z: chunk.coord.cz * 16 + lz }
            if (kind === 'lever') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              observedLevers.add(key)
              components.push({ position, kind, active: leverStates.get(key)?.active ?? false })
            } else if (kind === 'piston') {
              const head = Effect.runSync(context.chunkStore.getBlock(
                asBlockPosition(pistonPositionAt(position, 'north', 1)),
              ))
              components.push({
                position,
                kind,
                pistonFacing: 'north',
                pistonKind: 'sticky',
                pistonState: head._tag === 'Block' && head.block === blockIdOf('piston_head') ? 'extended' : 'retracted',
              })
            } else if (kind === 'repeater') {
              components.push({
                position,
                kind,
                inputFrom: { x: position.x, y, z: position.z + 1 },
                outputTo: { x: position.x, y, z: position.z - 1 },
                delayTicks: 1,
              })
            } else if (kind === 'comparator') {
              const container = Effect.runSync(world.inventory.containerSnapshotAt(
                context.dimension,
                { x: position.x, y, z: position.z + 1 },
              ))
              components.push({
                position,
                kind,
                inputFrom: { x: position.x, y, z: position.z + 1 },
                outputTo: { x: position.x, y, z: position.z - 1 },
                sideInputs: [
                  { x: position.x - 1, y, z: position.z },
                  { x: position.x + 1, y, z: position.z },
                ],
                mode: comparatorModes.get(leverKeyOf({ dimension: context.dimension, position })) ?? 'compare',
                ...(container === null ? {} : {
                  containerSlots: container.slots.map((slot) => slot === null
                    ? { count: 0, maxStack: 64 }
                    : { count: slot.count, maxStack: maxStackCountForItem(slot.item) }),
                }),
              })
            } else if (kind === 'observer') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              const watched = Effect.runSync(context.chunkStore.getBlock(asBlockPosition({
                x: position.x,
                y,
                z: position.z + 1,
              })))
              const watchedBlock = watched._tag === 'Block' ? watched.block : 0
              const previous = observerInputs.get(key)
              if (previous !== undefined && previous !== watchedBlock) {
                observerPulses.set(key, getSimulationElapsedSecs() + 0.2)
              }
              observerInputs.set(key, watchedBlock)
              components.push({
                position,
                kind,
                active: (observerPulses.get(key) ?? 0) > getSimulationElapsedSecs(),
                outputTo: { x: position.x, y, z: position.z - 1 },
                pulseTicks: 2,
              })
            } else if (kind === 'pressure-plate') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              observedPlates.add(key)
              // Occupancy is set by the per-frame check below, keyed off the
              // player's AABB rather than recomputed from this scan's stale
              // pose — a resync can run mid-frame relative to movement, and
              // this map is the single source of truth for "who is on it".
              const occupied = pressurePlateOccupancy.get(key)?.occupied ?? false
              pressurePlateOccupancy.set(key, { dimension: context.dimension, position, occupied })
              components.push({ position, kind, active: occupied })
            } else if (kind === 'door') {
              components.push({ position, kind, powered: block === blockIdOf('door_open') })
            } else if (kind === 'powered-rail') {
              const key = leverKeyOf({ dimension: context.dimension, position })
              components.push({ position, kind, powered: poweredRails.has(key) })
            } else {
              components.push({ position, kind })
            }
          }
        }
      }
    }

    for (const [key, lever] of leverStates) {
      if (lever.dimension !== context.dimension) continue
      const residentKey = chunkKeyOf({
        cx: Math.floor(lever.position.x / 16),
        cz: Math.floor(lever.position.z / 16),
      })
      if (context.streamLoaded.has(residentKey) && !observedLevers.has(key)) {
        leverStates.delete(key)
        markSessionDirty()
      }
    }
    for (const [key, plate] of pressurePlateOccupancy) {
      if (plate.dimension !== context.dimension) continue
      const residentKey = chunkKeyOf({
        cx: Math.floor(plate.position.x / 16),
        cz: Math.floor(plate.position.z / 16),
      })
      // Unlike leverStates this cache is not persisted — it is a derived read of
      // "who is standing where" recomputed every time the plate is rescanned —
      // so dropping a stale entry is not a session-dirtying change.
      if (context.streamLoaded.has(residentKey) && !observedPlates.has(key)) {
        pressurePlateOccupancy.delete(key)
      }
    }
    Effect.runSync(redstoneRuntime.syncSnapshot({ dimension: context.dimension, components }))
    setRedstoneDirty(false)
  }

  const containerIdForStorageBlock = (
    dimension: Dimension,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): string | undefined => {
    const context = dimensionContexts.get(dimension)
    if (context === undefined) return undefined

    const reading = Effect.runSync(context.chunkStore.getBlock(asBlockPosition(position)))
    if (reading._tag !== 'Block') return undefined

    const kind = containerKindForStorageBlock(blockTypeOfId(reading.block))
    if (kind === undefined) {
      return undefined
    }

    const id = containerIdAt(dimension, position)
    const created = Effect.runSync(world.inventory.createContainer(id, kind))
    if (created._tag === 'Created') markSessionDirty()
    return created._tag === 'InvalidContainerId' ? undefined : id
  }

  const moveOneContainerItem = (
    sourceContainerId: string,
    destinationContainerId: string,
  ): boolean => transferOneContainerItem(sourceContainerId, destinationContainerId, {
    snapshot: (containerId) => Effect.runSync(world.inventory.containerSnapshot(containerId)),
    move: (input) => Effect.runSync(world.inventory.moveContainerItem(input)),
    metadataKey: containerMetadataKey,
    copyMetadata: copyItemMetadata,
    deleteMetadata: deleteItemMetadata,
    markSessionDirty,
  })

  const applyHopperTransfer = (
    dimension: Dimension,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void => transferHopperItem(dimension, position, {
    isMultiplayer,
    resolveContainerId: containerIdForStorageBlock,
    moveOneContainerItem,
  })

  const applyItemDropperTrigger = (
    dimension: Dimension,
    position: { readonly x: number; readonly y: number; readonly z: number },
    kind: 'dispenser' | 'dropper',
  ): void => {
    if (isMultiplayer()) return

    const context = dimensionContexts.get(dimension)
    if (context === undefined) return
    const reading = Effect.runSync(context.chunkStore.getBlock(asBlockPosition(position)))
    if (reading._tag !== 'Block' || blockTypeOfId(reading.block) !== kind) return

    const containerId = containerIdForStorageBlock(dimension, position)
    if (containerId === undefined) return

    const container = Effect.runSync(world.inventory.containerSnapshot(containerId))
    if (container?.kind !== kind) return
    const slot = container?.slots.findIndex((stack) => stack !== null) ?? -1
    if (slot < 0) return

    const metadataKey = containerMetadataKey(containerId, slot)
    const extracted = Effect.runSync(
      world.inventory.extractContainerItem({
        containerId,
        containerSlot: slot,
        count: 1,
      }),
    )
    if (extracted._tag !== 'Extracted') return

    const metadata = {
      customName: customNames.get(metadataKey),
      enchantedItem: enchantedItems.get(metadataKey),
    }
    const spawned = Effect.runSync(
      spawnDroppedItems(world.entities, [
        {
          ...extracted.stack,
          at: {
            x: position.x + 0.5,
            y: position.y + 0.5,
            z: position.z - 0.25,
          },
          ...(metadata.customName === undefined &&
          metadata.enchantedItem === undefined
            ? {}
            : { eligibleFromFrame: getFramesTotal() + 1 }),
        },
      ]),
    )
    const entity = spawned[0]
    if (entity !== undefined) {
      const itemMetadataKey = droppedItemMetadataKey(dimension, String(entity.id))
      droppedItemMetadata.set(itemMetadataKey, {
        ...(metadata.customName === undefined ? {} : { customName: metadata.customName }),
        ...(metadata.enchantedItem === undefined
          ? {}
          : { enchantedItem: metadata.enchantedItem }),
      })
    }

    const updated = Effect.runSync(world.inventory.containerSnapshot(containerId))
    if (updated?.slots[slot] === null) deleteItemMetadata(metadataKey)
    markSessionDirty()
  }

  const applyDispenserTrigger = (
    dimension: Dimension,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void => applyItemDropperTrigger(dimension, position, 'dispenser')

  const applyDropperTrigger = (
    dimension: Dimension,
    position: { readonly x: number; readonly y: number; readonly z: number },
  ): void => applyItemDropperTrigger(dimension, position, 'dropper')

  const applyPoweredPistonTransition = (transition: PoweredPistonTransition): void => {
    const context = dimensionContexts.get(transition.dimension as Dimension)
    if (context === undefined) return
    const outcome = planPistonTransition(
      transition,
      {
        read: (position) => {
          if (position.y < 0 || position.y >= 256) return { kind: 'out-of-world' }
          const reading = Effect.runSync(context.chunkStore.getBlock(asBlockPosition(position)))
          if (reading._tag !== 'Block') return { kind: 'missing' }
          return reading.block === blockIdOf('air')
            ? { kind: 'empty' }
            : { kind: 'block', block: String(reading.block) }
        },
      },
      {
        pistonImmovable: (block) => capabilityOfBlockId(BlockId(Number(block)), 'pistonImmovable'),
      },
    )
    if (outcome.kind !== 'move') return

    Effect.runSync(applyPistonPlan(outcome.plan, {
      commit: (plan: PistonMovementPlan) => Effect.gen(function* () {
        for (const move of plan.moves) {
          const source = yield* context.chunkStore.getBlock(asBlockPosition(move.from))
          if (source._tag !== 'Block' || source.block !== BlockId(Number(move.block))) {
            return yield* Effect.dieMessage('piston source changed before commit')
          }
        }
        const head = pistonPositionAt(plan.piston, plan.facing, 1)
        if (plan.toState === 'retracted') yield* context.chunkStore.setBlock(asBlockPosition(head), blockIdOf('air'))
        for (const move of plan.moves) {
          yield* context.chunkStore.setBlock(asBlockPosition(move.to), BlockId(Number(move.block)))
          yield* context.chunkStore.setBlock(asBlockPosition(move.from), blockIdOf('air'))
        }
        if (plan.toState === 'extended') yield* context.chunkStore.setBlock(asBlockPosition(head), blockIdOf('piston_head'))
      }),
    }))
    markSessionDirty()
    setRedstoneDirty(true)
  }

  return {
    syncRedstoneSnapshot,
    containerIdForStorageBlock,
    applyHopperTransfer,
    applyDispenserTrigger,
    applyDropperTrigger,
    applyPoweredPistonTransition,
  }
}
