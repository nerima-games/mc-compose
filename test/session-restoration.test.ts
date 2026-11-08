import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'

import { chunkCoord, CHUNK_SIZE_XZ } from '@nerima-games/mc-kernel'
import { CHUNK_VOLUME, type Chunk, type ChunkSource } from '@nerima-games/mc-worldgen'

import {
  makeSessionChunkSourceFor,
  restoreInitialWorld,
  restoreLoadedSessionServices,
} from '../apps/web/session-restoration'
import { createDroppedItemLifetimeTracker } from '../apps/web/dropped-item-lifetime'
import { initializeSessionWorld } from '../apps/web/session-world'

const chunk = (cx: number, cz: number, marker: number): Chunk => ({
  coord: chunkCoord(cx, cz),
  blocks: new Uint8Array(CHUNK_VOLUME).fill(marker),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => 'PLAINS'),
})

describe('session restoration', () => {
  it('uses persisted chunks for the selected dimension and generated chunks otherwise', async () => {
    const persisted = chunk(-1, 2, 7)
    const generatedCalls: Array<{ cx: number; cz: number }> = []
    const generatedSource: ChunkSource = (coord) => Effect.sync(() => {
      generatedCalls.push({ cx: coord.cx, cz: coord.cz })
      return chunk(coord.cx, coord.cz, 3)
    })
    const source = makeSessionChunkSourceFor(
      'overworld',
      new Map([['overworld:-1,2', persisted]]),
      generatedSource,
    )

    const restored = await Effect.runPromise(source(chunkCoord(-1, 2)))
    const generated = await Effect.runPromise(source(chunkCoord(4, -3)))

    expect(restored).toEqual(persisted)
    expect(restored).not.toBe(persisted)
    expect(generated.blocks[0]).toBe(3)
    expect(generatedCalls).toEqual([{ cx: 4, cz: -3 }])
  })

  it('builds a new world from its generated source and restores each dimension roster', async () => {
    const calls: Array<string> = []
    const initialized = await initializeSessionWorld({
      loadedSession: Option.none(),
      initialDimension: 'overworld',
      worldSeed: 42,
      loadSavedChunks: async () => { throw new Error('new worlds do not load session chunks') },
      makeWorld: async ({ seed, dimension, chunkSource }) => {
        calls.push(`world:${String(seed)}:${dimension}`)
        return { chunkSource }
      },
      restoreEntities: (_world, roster) => {
        calls.push(`restore:${String(roster.entities.length)}`)
      },
      snapshotEntities: () => ({ entities: [], nextSerial: 0 }),
      droppedItemLifetime: createDroppedItemLifetimeTracker(),
      droppedItemMetadata: new Map(),
      droppedItemMetadataKey: (dimension, entityId) => `${dimension}:${entityId}`,
      droppedItemMetadataFromBehaviour: () => ({}),
    })

    const generated = await Effect.runPromise(initialized.chunkSourceFor('nether')(chunkCoord(2, -1)))

    expect(initialized.activeSeed).toBe(42)
    expect(generated.coord).toEqual(chunkCoord(2, -1))
    expect(calls).toEqual(['world:42:overworld', 'restore:0', 'restore:0', 'restore:0'])
    expect(initialized.snapshotEntityRosters('nether', { entities: [], nextSerial: 0 })).toEqual({
      overworld: { entities: [], nextSerial: 0 },
      nether: { entities: [], nextSerial: 0 },
      end: { entities: [], nextSerial: 0 },
    })
  })

  it('restores loaded world state in order and leaves new survival worlds untouched', async () => {
    const state = { seed: 81 }
    const calls: Array<string> = []
    const actions = {
      restoreEntities: async () => { calls.push('entities') },
      restoreStorage: async (value: typeof state) => {
        expect(value).toBe(state)
        calls.push('storage')
      },
      restoreContainerStorage: async () => { calls.push('containers') },
      restorePlayer: async () => { calls.push('player') },
      restoreVitals: async () => { calls.push('vitals') },
      addCreativeStartingItems: async () => { calls.push('creative-items') },
    }

    await restoreInitialWorld(state, false, actions)
    expect(calls).toEqual(['entities', 'storage', 'containers', 'player', 'vitals'])

    calls.length = 0
    await restoreInitialWorld(undefined, false, actions)
    expect(calls).toEqual([])
  })

  it('adds creative starting items only for a new creative world', async () => {
    const calls: Array<string> = []
    const actions = {
      restoreEntities: async () => { calls.push('entities') },
      restoreStorage: async () => { calls.push('storage') },
      restoreContainerStorage: async () => { calls.push('containers') },
      restorePlayer: async () => { calls.push('player') },
      restoreVitals: async () => { calls.push('vitals') },
      addCreativeStartingItems: async () => { calls.push('creative-items') },
    }

    await restoreInitialWorld(undefined, true, actions)

    expect(calls).toEqual(['creative-items'])
  })

  it('restores services in order and stops after the first failed restore', async () => {
    const state = { seed: 12 }
    const calls: Array<string> = []
    const actions = {
      restoreTime: async () => { calls.push('time') },
      restoreWeather: async () => {
        calls.push('weather')
        throw new Error('weather restore failed')
      },
      restoreCrops: async () => { calls.push('crops') },
      restoreVillagerTrades: async () => { calls.push('trades') },
      restoreBrewingStand: async () => { calls.push('brewing') },
      restoreStatusEffects: async () => { calls.push('status-effects') },
      restoreEnderDragon: async () => { calls.push('ender-dragon') },
    }

    await restoreLoadedSessionServices(undefined, actions)
    expect(calls).toEqual([])

    await expect(restoreLoadedSessionServices(state, actions)).rejects.toThrow('weather restore failed')
    expect(calls).toEqual(['time', 'weather'])
  })

  it('restores every loaded service in its existing order', async () => {
    const state = { seed: 12 }
    const calls: Array<string> = []
    const actions = {
      restoreTime: async () => { calls.push('time') },
      restoreWeather: async () => { calls.push('weather') },
      restoreCrops: async () => { calls.push('crops') },
      restoreVillagerTrades: async () => { calls.push('trades') },
      restoreBrewingStand: async () => { calls.push('brewing') },
      restoreStatusEffects: async () => { calls.push('status-effects') },
      restoreEnderDragon: async () => { calls.push('ender-dragon') },
    }

    await restoreLoadedSessionServices(state, actions)

    expect(calls).toEqual([
      'time',
      'weather',
      'crops',
      'trades',
      'brewing',
      'status-effects',
      'ender-dragon',
    ])
  })
})
