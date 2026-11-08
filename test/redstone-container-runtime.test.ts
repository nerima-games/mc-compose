import { blockIdOf, blockPosition, chunkCoord } from '@nerima-games/mc-kernel'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import {
  CONTAINER_STORAGE_SNAPSHOT_VERSION,
  containerIdAt,
  itemStack,
  type ItemStack,
} from '@nerima-games/mc-sim'
import {
  CHUNK_SIZE_XZ,
  CHUNK_VOLUME,
  FALLBACK_BIOME,
  type ChunkSource,
  type Dimension,
} from '@nerima-games/mc-worldgen'
import {
  makeGeneratedWorld,
  type EnchantedItem,
  type GeneratedWorld,
  type MobBehaviour,
} from '@nerima-games/mx-gameplay'
import {
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type PoweredPistonTransition,
  type RedstoneWorldSnapshot,
} from '@nerima-games/mx-redstone'
import { describe, expect, it } from 'vitest'
import {
  chestStorageSlotCount,
  containerKindForStorageBlock,
  makeRedstoneContainerRuntime,
  type PressurePlateOccupancy,
  transferHopperItem,
  transferOneContainerItem,
  type ContainerTransferOperations,
  type HopperTransferOperations,
  type RedstoneBlockPosition,
  type RedstoneContainerRuntimeContext,
  type RedstoneDimensionChunkContext,
} from '../apps/web/redstone-container-runtime'
import { type DroppedItemMetadata } from '../apps/web/dropped-item-metadata'
import { type PersistedLeverState } from '../apps/web/session-persistence'

const allAirChunkSource: ChunkSource = (coord) => Effect.succeed({
  coord,
  blocks: new Uint8Array(CHUNK_VOLUME).fill(blockIdOf('air')),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => FALLBACK_BIOME),
})

const makeRuntimeHarness = async () => {
  const world = await Effect.runPromise(makeGeneratedWorld<MobBehaviour>({
    chunkSource: allAirChunkSource,
    dimension: 'overworld',
  }))
  const chunk = chunkCoord(0, 0)
  await Effect.runPromise(world.worldgenChunkStore.load(chunk))

  const scope = Effect.runSync(Scope.make())
  const redstoneContext = await Effect.runPromise(
    Effect.provideService(
      Layer.build(RedstoneWorldRuntimeLayer),
      Scope.Scope,
      scope,
    ),
  )
  const dimension: Dimension = 'overworld'
  const dimensionContext: RedstoneDimensionChunkContext = {
    dimension,
    chunkStore: world.chunkStore,
    worldgenChunkStore: world.worldgenChunkStore,
    streamLoaded: new Set<string>(),
  }
  const dimensionContexts = new Map<Dimension, RedstoneDimensionChunkContext>([
    [dimension, dimensionContext],
  ])
  const redstoneDirty: Array<boolean> = []
  let sessionDirtyCalls = 0
  const runtimeContext: RedstoneContainerRuntimeContext = {
    dimensionContexts,
    world,
    leverStates: new Map<string, PersistedLeverState>(),
    comparatorModes: new Map<string, 'compare' | 'subtract'>(),
    observerInputs: new Map<string, number>(),
    observerPulses: new Map<string, number>(),
    pressurePlateOccupancy: new Map<string, PressurePlateOccupancy>(),
    poweredRails: new Set<string>(),
    getSimulationElapsedSecs: () => 0,
    isMultiplayer: () => false,
    setRedstoneDirty: (dirty) => redstoneDirty.push(dirty),
    markSessionDirty: () => { sessionDirtyCalls += 1 },
    redstoneRuntime: Context.get(redstoneContext, RedstoneWorldRuntime),
    customNames: new Map<string, string>(),
    enchantedItems: new Map<string, EnchantedItem>(),
    droppedItemMetadata: new Map<string, DroppedItemMetadata>(),
    containerMetadataKey: (containerId, slot) => `${containerId}:${String(slot)}`,
    copyItemMetadata: () => {},
    deleteItemMetadata: () => {},
    droppedItemMetadataKey: (worldDimension, entityId) => `${worldDimension}:${entityId}`,
    getFramesTotal: () => 0,
    asBlockPosition: (position) => blockPosition(position.x, position.y, position.z),
    leverKeyOf: ({ dimension: worldDimension, position }) => JSON.stringify([
      worldDimension,
      position.x,
      position.y,
      position.z,
    ]),
  }

  return {
    world,
    dimension,
    dimensionContext,
    runtimeContext,
    runtime: makeRedstoneContainerRuntime(runtimeContext),
    redstoneDirty,
    sessionDirtyCalls: () => sessionDirtyCalls,
    close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
  }
}

const readWorldBlock = (
  world: GeneratedWorld<MobBehaviour>,
  position: RedstoneBlockPosition,
) => Effect.runPromise(world.chunkStore.getBlock(blockPosition(position.x, position.y, position.z)))

describe('redstone container runtime', () => {
  it('maps storage blocks to their container kinds', () => {
    expect(containerKindForStorageBlock('chest')).toBe('chest')
    expect(containerKindForStorageBlock('shulker_box')).toBe('shulker_box')
    expect(containerKindForStorageBlock('dispenser')).toBe('dispenser')
    expect(containerKindForStorageBlock('dropper')).toBe('dropper')
    expect(containerKindForStorageBlock('hopper')).toBe('hopper')
    expect(containerKindForStorageBlock('stone')).toBeUndefined()
  })

  it('keeps the supported chest slot counts and defaults other sizes to 27', () => {
    expect(chestStorageSlotCount(5)).toBe(5)
    expect(chestStorageSlotCount(9)).toBe(9)
    expect(chestStorageSlotCount(undefined)).toBe(27)
    expect(chestStorageSlotCount(54)).toBe(27)
  })

  it('moves one item from the first occupied slot and transfers metadata in order', () => {
    const stack = itemStack('dirt', 1)
    const containers = new Map<string, { readonly slots: Array<ItemStack | null> }>([
      ['hopper', { slots: [null, stack] }],
      ['chest', { slots: [null] }],
    ])
    const events: Array<string> = []
    const operations: ContainerTransferOperations = {
      snapshot: (containerId) => {
        events.push(`snapshot:${containerId}`)
        return containers.get(containerId) ?? null
      },
      move: (input) => {
        events.push([
          'move',
          input.sourceContainerId,
          String(input.sourceSlot),
          input.destinationContainerId,
          String(input.destinationSlot),
          String(input.count),
        ].join(':'))
        const source = containers.get(input.sourceContainerId)
        const destination = containers.get(input.destinationContainerId)
        if (source === undefined || destination === undefined) return { _tag: 'MissingContainer' }
        const moved = source.slots[input.sourceSlot]
        if (moved == null) return { _tag: 'EmptySource' }
        source.slots[input.sourceSlot] = null
        destination.slots[input.destinationSlot] = moved
        return { _tag: 'Moved' }
      },
      metadataKey: (containerId, slot) => `container:${containerId}:${String(slot)}`,
      copyMetadata: (source, destination) => events.push(`copy:${source}:${destination}`),
      deleteMetadata: (key) => events.push(`delete:${key}`),
      markSessionDirty: () => events.push('dirty'),
    }

    expect(transferOneContainerItem('hopper', 'chest', operations)).toBe(true)
    expect(containers.get('chest')?.slots).toEqual([stack])
    expect(events).toEqual([
      'snapshot:hopper',
      'snapshot:chest',
      'move:hopper:1:chest:0:1',
      'copy:container:hopper:1:container:chest:0',
      'snapshot:hopper',
      'delete:container:hopper:1',
      'dirty',
    ])
  })

  it('does not update metadata or dirty the session when a container move fails', () => {
    const stack = itemStack('dirt', 1)
    const events: Array<string> = []
    const operations: ContainerTransferOperations = {
      snapshot: (containerId) => ({ slots: containerId === 'hopper' ? [stack] : [null] }),
      move: () => {
        events.push('move')
        return { _tag: 'Rejected' }
      },
      metadataKey: (containerId, slot) => `${containerId}:${String(slot)}`,
      copyMetadata: () => events.push('copy'),
      deleteMetadata: () => events.push('delete'),
      markSessionDirty: () => events.push('dirty'),
    }

    expect(transferOneContainerItem('hopper', 'chest', operations)).toBe(false)
    expect(events).toEqual(['move'])
  })

  it('checks the hopper output below before considering the container above', () => {
    const positions: Array<RedstoneBlockPosition> = []
    const transfers: Array<[string, string]> = []
    const operations: HopperTransferOperations = {
      isMultiplayer: () => false,
      resolveContainerId: (_dimension, position) => {
        positions.push(position)
        if (position.y === 64) return 'hopper'
        if (position.y === 63) return 'below'
        return 'above'
      },
      moveOneContainerItem: (source, destination) => {
        transfers.push([source, destination])
        return true
      },
    }

    transferHopperItem('overworld', { x: 1, y: 64, z: 2 }, operations)

    expect(positions.map(({ y }) => y)).toEqual([64, 63])
    expect(transfers).toEqual([['hopper', 'below']])
  })

  it('falls back from a failed lower transfer to the container above', () => {
    const positions: Array<RedstoneBlockPosition> = []
    const transfers: Array<[string, string]> = []
    const operations: HopperTransferOperations = {
      isMultiplayer: () => false,
      resolveContainerId: (_dimension, position) => {
        positions.push(position)
        if (position.y === 64) return 'hopper'
        if (position.y === 63) return 'below'
        return 'above'
      },
      moveOneContainerItem: (source, destination) => {
        transfers.push([source, destination])
        return false
      },
    }

    transferHopperItem('overworld', { x: 1, y: 64, z: 2 }, operations)

    expect(positions.map(({ y }) => y)).toEqual([64, 63, 65])
    expect(transfers).toEqual([['hopper', 'below'], ['above', 'hopper']])
  })

  it('does not inspect containers for multiplayer hopper events', () => {
    const events: Array<string> = []
    const operations: HopperTransferOperations = {
      isMultiplayer: () => true,
      resolveContainerId: () => {
        events.push('resolve')
        return 'hopper'
      },
      moveOneContainerItem: () => {
        events.push('move')
        return true
      },
    }

    transferHopperItem('overworld', { x: 1, y: 64, z: 2 }, operations)

    expect(events).toEqual([])
  })

  it('installs the redstone components found in resident chunks', async () => {
    const harness = await makeRuntimeHarness()
    try {
      const wire = { x: 8, y: 64, z: 8 }
      const lamp = { x: 8, y: 64, z: 9 }
      const blocks = [
        [wire, blockIdOf('redstone_wire')],
        [lamp, blockIdOf('redstone_lamp')],
      ] as const
      for (const [position, block] of blocks) {
        const blockPos = blockPosition(position.x, position.y, position.z)
        await Effect.runPromise(harness.world.worldgenChunkStore.setBlock(blockPos, block))
        await Effect.runPromise(harness.world.chunkStore.setBlock(blockPos, block))
      }

      const realRuntime = harness.runtimeContext.redstoneRuntime
      const installedSnapshots: Array<RedstoneWorldSnapshot> = []
      const runtime = makeRedstoneContainerRuntime({
        ...harness.runtimeContext,
        redstoneRuntime: {
          ...realRuntime,
          syncSnapshot: (snapshot) => {
            installedSnapshots.push(snapshot)
            return realRuntime.syncSnapshot(snapshot)
          },
        },
      })

      runtime.syncRedstoneSnapshot(harness.dimensionContext)

      expect(installedSnapshots).toHaveLength(1)
      expect(installedSnapshots[0]).toMatchObject({
        dimension: harness.dimension,
        components: expect.arrayContaining([
          { position: wire, kind: 'wire' },
          { position: lamp, kind: 'lamp' },
        ]),
      })
      expect(harness.redstoneDirty).toEqual([false])
    } finally {
      await harness.close()
    }
  })

  it.each(['dispenser', 'dropper'] as const)('%s consumes one item and spawns its dropped state', async (kind) => {
    const harness = await makeRuntimeHarness()
    try {
      const position = { x: 8, y: 64, z: 8 }
      const containerId = containerIdAt(harness.dimension, position)
      const customName = `Named ${kind} item`
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(position.x, position.y, position.z),
        blockIdOf(kind),
      ))
      await Effect.runPromise(harness.world.inventory.restoreContainerStorage({
        version: CONTAINER_STORAGE_SNAPSHOT_VERSION,
        containers: [{
          id: containerId,
          kind,
          slots: [
            { ...itemStack('dirt', 2), durability: null },
            ...Array.from({ length: 8 }, () => null),
          ],
        }],
      }))
      harness.runtimeContext.customNames.set(
        harness.runtimeContext.containerMetadataKey(containerId, 0),
        customName,
      )

      if (kind === 'dispenser') {
        harness.runtime.applyDispenserTrigger(harness.dimension, position)
      } else {
        harness.runtime.applyDropperTrigger(harness.dimension, position)
      }

      const container = await Effect.runPromise(harness.world.inventory.containerSnapshot(containerId))
      expect(container?.kind).toBe(kind)
      expect(container?.slots[0]).toMatchObject({ item: 'dirt', count: 1 })
      expect(container?.slots.slice(1)).toEqual(Array.from({ length: 8 }, () => null))

      const roster = await Effect.runPromise(harness.world.entities.snapshot)
      expect(roster.entities).toHaveLength(1)
      const dropped = roster.entities[0]
      expect(dropped).toMatchObject({
        feetPosition: { x: 8.5, y: 64.5, z: 7.75 },
        behaviour: {
          _tag: 'DroppedItem',
          item: 'dirt',
          count: 1,
          eligibleFromFrame: 1,
        },
      })
      expect(harness.runtimeContext.droppedItemMetadata.get(
        harness.runtimeContext.droppedItemMetadataKey(harness.dimension, String(dropped?.id)),
      )).toEqual({ customName })
      expect(harness.sessionDirtyCalls()).toBe(1)
    } finally {
      await harness.close()
    }
  })

  it('extends a piston and commits the moved block and piston head to the world store', async () => {
    const harness = await makeRuntimeHarness()
    try {
      const piston = { x: 8, y: 64, z: 8 }
      const source = { x: 8, y: 64, z: 7 }
      const destination = { x: 8, y: 64, z: 6 }
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(piston.x, piston.y, piston.z),
        blockIdOf('piston'),
      ))
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(source.x, source.y, source.z),
        blockIdOf('stone'),
      ))

      const transition: PoweredPistonTransition = {
        dimension: harness.dimension,
        piston,
        facing: 'north',
        kind: 'normal',
        state: 'retracted',
        powered: true,
      }
      harness.runtime.applyPoweredPistonTransition(transition)

      expect(await readWorldBlock(harness.world, destination)).toEqual({
        _tag: 'Block',
        block: blockIdOf('stone'),
      })
      expect(await readWorldBlock(harness.world, source)).toEqual({
        _tag: 'Block',
        block: blockIdOf('piston_head'),
      })
      expect(harness.redstoneDirty).toEqual([true])
      expect(harness.sessionDirtyCalls()).toBe(1)
    } finally {
      await harness.close()
    }
  })

  it('leaves an immovable block and retracted piston unchanged when extension is blocked', async () => {
    const harness = await makeRuntimeHarness()
    try {
      const piston = { x: 8, y: 64, z: 8 }
      const source = { x: 8, y: 64, z: 7 }
      const head = { x: 8, y: 64, z: 7 }
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(piston.x, piston.y, piston.z),
        blockIdOf('piston'),
      ))
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(source.x, source.y, source.z),
        blockIdOf('bedrock'),
      ))

      harness.runtime.applyPoweredPistonTransition({
        dimension: harness.dimension,
        piston,
        facing: 'north',
        kind: 'normal',
        state: 'retracted',
        powered: true,
      })

      expect(await readWorldBlock(harness.world, piston)).toEqual({
        _tag: 'Block',
        block: blockIdOf('piston'),
      })
      expect(await readWorldBlock(harness.world, source)).toEqual({
        _tag: 'Block',
        block: blockIdOf('bedrock'),
      })
      expect(await readWorldBlock(harness.world, head)).toEqual({
        _tag: 'Block',
        block: blockIdOf('bedrock'),
      })
      expect(harness.redstoneDirty).toEqual([])
      expect(harness.sessionDirtyCalls()).toBe(0)
    } finally {
      await harness.close()
    }
  })

  it('does not commit a piston plan when its source changes before commit', async () => {
    const harness = await makeRuntimeHarness()
    try {
      const piston = { x: 8, y: 64, z: 8 }
      const source = { x: 8, y: 64, z: 7 }
      const destination = { x: 8, y: 64, z: 6 }
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(piston.x, piston.y, piston.z),
        blockIdOf('piston'),
      ))
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(source.x, source.y, source.z),
        blockIdOf('stone'),
      ))

      let sourceReadCount = 0
      const originalChunkStore = harness.dimensionContext.chunkStore
      const sourceChangingChunkStore = new Proxy(originalChunkStore, {
        get: (target, property, receiver) => {
          if (property !== 'getBlock') return Reflect.get(target, property, receiver)
          return (position: Parameters<typeof originalChunkStore.getBlock>[0]) => {
            if (position.x === source.x && position.y === source.y && position.z === source.z) {
              sourceReadCount += 1
              if (sourceReadCount === 2) {
                return Effect.succeed({ _tag: 'Block' as const, block: blockIdOf('air') })
              }
            }
            return originalChunkStore.getBlock(position)
          }
        },
      })
      const dimensionContext: RedstoneDimensionChunkContext = {
        ...harness.dimensionContext,
        chunkStore: sourceChangingChunkStore,
      }
      const runtime = makeRedstoneContainerRuntime({
        ...harness.runtimeContext,
        dimensionContexts: new Map([[harness.dimension, dimensionContext]]),
      })

      expect(() => runtime.applyPoweredPistonTransition({
        dimension: harness.dimension,
        piston,
        facing: 'north',
        kind: 'normal',
        state: 'retracted',
        powered: true,
      })).toThrow('piston source changed before commit')

      expect(sourceReadCount).toBe(2)
      expect(await readWorldBlock(harness.world, piston)).toEqual({
        _tag: 'Block',
        block: blockIdOf('piston'),
      })
      expect(await readWorldBlock(harness.world, source)).toEqual({
        _tag: 'Block',
        block: blockIdOf('stone'),
      })
      expect(await readWorldBlock(harness.world, destination)).toEqual({
        _tag: 'Block',
        block: blockIdOf('air'),
      })
      expect(harness.redstoneDirty).toEqual([])
      expect(harness.sessionDirtyCalls()).toBe(0)
    } finally {
      await harness.close()
    }
  })

  it('pulls the sticky piston block back when the piston retracts', async () => {
    const harness = await makeRuntimeHarness()
    try {
      const piston = { x: 8, y: 64, z: 8 }
      const head = { x: 8, y: 64, z: 7 }
      const pulledBlock = { x: 8, y: 64, z: 6 }
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(piston.x, piston.y, piston.z),
        blockIdOf('piston'),
      ))
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(head.x, head.y, head.z),
        blockIdOf('piston_head'),
      ))
      await Effect.runPromise(harness.world.chunkStore.setBlock(
        blockPosition(pulledBlock.x, pulledBlock.y, pulledBlock.z),
        blockIdOf('stone'),
      ))

      harness.runtime.applyPoweredPistonTransition({
        dimension: harness.dimension,
        piston,
        facing: 'north',
        kind: 'sticky',
        state: 'extended',
        powered: false,
      })

      expect(await readWorldBlock(harness.world, piston)).toEqual({
        _tag: 'Block',
        block: blockIdOf('piston'),
      })
      expect(await readWorldBlock(harness.world, head)).toEqual({
        _tag: 'Block',
        block: blockIdOf('stone'),
      })
      expect(await readWorldBlock(harness.world, pulledBlock)).toEqual({
        _tag: 'Block',
        block: blockIdOf('air'),
      })
      expect(harness.redstoneDirty).toEqual([true])
      expect(harness.sessionDirtyCalls()).toBe(1)
    } finally {
      await harness.close()
    }
  })
})
