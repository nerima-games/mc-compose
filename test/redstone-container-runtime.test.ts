import { blockIdOf, blockPosition, chunkCoord } from '@nerima-games/mc-kernel'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { itemStack, type ItemStack } from '@nerima-games/mc-sim'
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
  type MobBehaviour,
} from '@nerima-games/mx-gameplay'
import {
  RedstoneWorldRuntime,
  RedstoneWorldRuntimeLayer,
  type PoweredPistonTransition,
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

  it('extends a piston and commits the moved block and piston head to the world store', async () => {
    const world = await Effect.runPromise(makeGeneratedWorld<MobBehaviour>({
      chunkSource: allAirChunkSource,
      dimension: 'overworld',
    }))
    const chunk = chunkCoord(0, 0)
    await Effect.runPromise(world.worldgenChunkStore.load(chunk))

    const piston = { x: 8, y: 64, z: 8 }
    const source = { x: 8, y: 64, z: 7 }
    const destination = { x: 8, y: 64, z: 6 }
    await Effect.runPromise(world.chunkStore.setBlock(
      blockPosition(piston.x, piston.y, piston.z),
      blockIdOf('piston'),
    ))
    await Effect.runPromise(world.chunkStore.setBlock(
      blockPosition(source.x, source.y, source.z),
      blockIdOf('stone'),
    ))

    const scope = Effect.runSync(Scope.make())
    try {
      const redstoneContext = await Effect.runPromise(
        Effect.provideService(
          Layer.build(RedstoneWorldRuntimeLayer),
          Scope.Scope,
          scope,
        ),
      )
      const dimension = 'overworld' satisfies Dimension
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
      const runtime = makeRedstoneContainerRuntime(runtimeContext)
      const transition: PoweredPistonTransition = {
        dimension,
        piston,
        facing: 'north',
        kind: 'normal',
        state: 'retracted',
        powered: true,
      }

      runtime.applyPoweredPistonTransition(transition)

      const destinationBlock = await Effect.runPromise(world.chunkStore.getBlock(
        blockPosition(destination.x, destination.y, destination.z),
      ))
      const sourceBlock = await Effect.runPromise(world.chunkStore.getBlock(
        blockPosition(source.x, source.y, source.z),
      ))
      expect(destinationBlock).toEqual({ _tag: 'Block', block: blockIdOf('stone') })
      expect(sourceBlock).toEqual({ _tag: 'Block', block: blockIdOf('piston_head') })
      expect(sourceBlock._tag === 'Block' && sourceBlock.block).not.toBe(blockIdOf('stone'))
      expect(redstoneDirty).toEqual([true])
      expect(sessionDirtyCalls).toBe(1)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void))
    }
  })
})
