import {
  decodeFrame,
  encodeFrame,
  type CommandId,
  type ContainerKind,
  type EntityId,
  type NetworkMessage,
  type PlayerId,
  type PlayerName,
  type WireText,
  type WorldId,
} from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import { describe, expect, it } from 'vitest'

import {
  makeMultiplayerServerCore,
  craftingResultKey,
  type MultiplayerServerOptions,
  playerDamageResultKey,
  type MultiplayerServerState,
  type ReceiveResult,
} from '../../apps/multiplayer-server/core'
import {
  decodePlayerDamageWireMessage,
  encodePlayerDamageCommand,
  PLAYER_DAMAGE_MAX_AMOUNT,
  PLAYER_DAMAGE_MAX_IDENTIFIER_LENGTH,
  PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS,
  PLAYER_DAMAGE_MAX_WIRE_LENGTH,
  type PlayerDamageCommand,
} from '../../apps/multiplayer-shared/player-damage-network'
import {
  decodeCraftingWireMessage,
  encodeCraftingCommand,
  type CraftingCommand,
} from '../../apps/multiplayer-shared/crafting-network'
import { decodeBrewingWireMessage } from '../../apps/multiplayer-shared/brewing-network'
import { decodeSleepWireMessage } from '../../apps/multiplayer-shared/sleep-network'
import { decodeWitherWireMessage } from '../../apps/multiplayer-shared/wither-network'

const playerId = (value: string): PlayerId => value as PlayerId
const playerName = (value: string): PlayerName => value as PlayerName
const worldId = (value: string): WorldId => value as WorldId
const commandId = (value: string): CommandId => value as CommandId
const entityId = (value: string): EntityId => value as EntityId

const sleepResult = (frames: ReadonlyArray<WireText>) =>
  frames.map(decodeSleepWireMessage).find((message) => message?._tag === 'SleepCommandResult')

const frame = (message: NetworkMessage): WireText => {
  const encoded = encodeFrame(message)
  if (Either.isLeft(encoded)) throw encoded.left
  return encoded.right
}

const messages = (frames: ReadonlyArray<WireText>): ReadonlyArray<NetworkMessage> =>
  frames.filter((wire) => decodeSleepWireMessage(wire) === undefined
    && decodeWitherWireMessage(wire) === undefined
    && decodePlayerDamageWireMessage(wire) === undefined
    && decodeCraftingWireMessage(wire) === undefined
    && decodeBrewingWireMessage(wire) === undefined).map((wire) => {
    const decoded = decodeFrame(wire)
    if (Either.isLeft(decoded)) throw decoded.left
    return decoded.right
  })

const initialState = (): MultiplayerServerState => ({
  revision: 4,
  blocks: [
    { at: { x: 1, y: 64, z: 0 }, block: 'chest' },
    { at: { x: 2, y: 64, z: 0 }, block: 'furnace' },
  ],
  inventories: [{
    player: playerId('alice'),
    state: {
      slots: [
        { item: 'stone', count: 5 },
        { item: 'coal', count: 3 },
        null,
      ],
      selectedSlot: 0,
    },
  }],
  vitals: [{ player: playerId('alice'), state: { health: 3, hunger: 2, experience: 7 } }],
  timeWeather: { timeOfDay: 6_000, weather: 'clear' },
  containers: [{ containerId: 'world-1:1,64,0', kind: 'chest', slots: [null, { item: 'apple', count: 2 }] }],
  furnaces: [{
    furnaceId: '["world-1",2,64,0]',
    input: null,
    fuel: null,
    output: { item: 'iron-ingot', count: 2 },
    burnTicksRemaining: 0,
    cookTicks: 0,
  }],
  villagerTrades: [],
})

const witherState = (
  dimension: string,
  phase: 'charging' | 'airborne',
): NonNullable<MultiplayerServerState['wither']> => ({
  nextWitherId: 1,
  nextSkullId: 0,
  withers: [{
    id: 'wither-1',
    dimension,
    snapshot: {
      kind: 'wither',
      version: 1,
      state: {
        phase,
        healthPoints: 300,
        chargeRemainingSecs: phase === 'charging' ? 0.1 : 0,
        feetPosition: { x: 0, y: 64, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
    rangedCooldownSecs: 100,
    meleeCooldownSecs: 0,
    shotsFired: 0,
  }],
  skulls: [],
})

const makeFixture = (
  state: MultiplayerServerState = initialState(),
  joinAt: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: 64, z: 0 },
  difficulty: 'peaceful' | 'easy' | 'normal' | 'hard' = 'normal',
  serverOptions: Partial<Pick<MultiplayerServerOptions, 'allowedBlocks' | 'generatedBlockAt' | 'now' | 'passableBlocks' | 'spawnAt'>> = {},
) => {
  const sent: Array<WireText> = []
  const persisted: Array<MultiplayerServerState> = []
  const timeline: Array<'persist' | 'send'> = []
  const server = makeMultiplayerServerCore({
    worldId: 'world-1',
    seed: 42,
    allowedBlocks: new Set(['stone', 'sand', 'gravel', 'chest', 'furnace', 'tnt']),
    initialState: state,
    difficulty,
    ...serverOptions,
    onStateChanged: (state) => {
      timeline.push('persist')
      persisted.push(state)
    },
  })
  expect(server.connect('socket-a', (wire) => {
    timeline.push('send')
    sent.push(wire)
  })).toBe(true)
  const receive = (message: NetworkMessage): ReceiveResult => server.receive('socket-a', frame(message))
  const receiveDamage = (command: PlayerDamageCommand): ReceiveResult =>
    server.receive('socket-a', encodePlayerDamageCommand(command))
  const receiveCrafting = (command: CraftingCommand): ReceiveResult =>
    server.receive('socket-a', encodeCraftingCommand(command))
  expect(receive({
    _tag: 'PlayerJoin',
    player: playerId('alice'),
    name: playerName('Alice'),
    at: joinAt,
  }).accepted).toBe(true)
  persisted.length = 0
  timeline.length = 0
  return { sent, persisted, timeline, receive, receiveDamage, receiveCrafting, server }
}

describe('multiplayer server authoritative state', () => {
  it('resolves bow charge, arrow consumption, and projectile damage on the server', () => {
    let now = 0
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'bow', count: 1 }, { item: 'arrow', count: 2 }, null], selectedSlot: 0 },
      }],
      entities: [{
        _tag: 'living', entityId: entityId('bow-target'), entityType: 'zombie',
        at: { x: 0, y: 64, z: -3.2 }, health: 20, maxHealth: 20,
      }],
    }, undefined, 'normal', {
      now: () => now,
      generatedBlockAt: (position) => position.y === 63 ? 'stone' : null,
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('bow-start'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'start',
    }).accepted).toBe(true)
    now = 1_000
    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('bow-release'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'release',
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'bow-start', revision: 4 }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'bow-release', revision: 5 }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        state: {
          slots: [{ item: 'bow', count: 1, durability: { current: 383, max: 384 } }, { item: 'arrow', count: 1 }, null],
          selectedSlot: 0,
        },
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        entity: expect.objectContaining({ _tag: 'arrow', owner: 'alice', damage: expect.any(Number) }),
      }),
    ]))
    fixture.sent.length = 0

    fixture.server.tick(100)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'bow-release:arrow' }),
      expect.objectContaining({
        _tag: 'EntityUpdateDelta',
        entity: expect.objectContaining({ entityId: 'bow-target', health: expect.any(Number) }),
      }),
    ]))
    expect(fixture.persisted.at(-1)?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'bow-target', health: expect.any(Number) }),
    ]))
  })

  it('breaks a bow on its final authoritative shot', () => {
    let now = 0
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: {
          slots: [{ item: 'bow', count: 1, durability: { current: 1, max: 384 } }, { item: 'arrow', count: 1 }, null],
          selectedSlot: 0,
        },
      }],
    }, undefined, 'normal', { now: () => now })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('final-bow-start'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'start',
    }).accepted).toBe(true)
    now = 1_000
    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('final-bow-release'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'release',
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        state: { slots: [null, null, null], selectedSlot: 0 },
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        entity: expect.objectContaining({ _tag: 'arrow', owner: 'alice' }),
      }),
    ]))
  })

  it('turns a block-hit arrow into an authoritative pickup', () => {
    let now = 0
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'bow', count: 1 }, { item: 'arrow', count: 1 }, null], selectedSlot: 0 },
      }],
    }, undefined, 'normal', {
      now: () => now,
      generatedBlockAt: (position) => position.y === 63 || (position.x === 0 && position.y === 65 && position.z === -4) ? 'stone' : null,
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('embedded-arrow-start'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'start',
    }).accepted).toBe(true)
    now = 1_000
    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('embedded-arrow-release'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'release',
    }).accepted).toBe(true)
    fixture.sent.length = 0

    fixture.server.tick(100)

    const pickupSpawn = messages(fixture.sent).find((message) => message._tag === 'EntitySpawnDelta'
      && message.entity._tag === 'item-drop' && message.entity.stack.item === 'arrow')
    expect(pickupSpawn).toMatchObject({
      _tag: 'EntitySpawnDelta', revision: 6,
      entity: { _tag: 'item-drop', at: { x: 0, y: 65.5, z: -3.2 }, stack: { item: 'arrow', count: 1 } },
    })
    if (pickupSpawn?._tag !== 'EntitySpawnDelta' || pickupSpawn.entity._tag !== 'item-drop') {
      throw new Error('missing embedded arrow pickup')
    }
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityPickupCommand', commandId: commandId('pickup-embedded-arrow'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 6, entityId: pickupSpawn.entity.entityId,
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'pickup-embedded-arrow', revision: 7 }),
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: pickupSpawn.entity.entityId, revision: 7 }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta', revision: 7,
        state: expect.objectContaining({
          slots: [{ item: 'bow', count: 1, durability: { current: 383, max: 384 } }, { item: 'arrow', count: 1 }, null],
        }),
      }),
    ]))
    expect(fixture.persisted.at(-1)).toMatchObject({ revision: 7, entities: [] })
  })

  it('applies a bow arrow to the nearest opposing player and synchronizes their vitals', () => {
    let now = 0
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'bow', count: 1 }, { item: 'arrow', count: 2 }, null], selectedSlot: 0 },
      }],
      vitals: [
        { player: playerId('alice'), state: { health: 20, hunger: 20, experience: 0 } },
        { player: playerId('bob'), state: { health: 20, hunger: 20, experience: 0 } },
      ],
    }, undefined, 'normal', {
      now: () => now,
      generatedBlockAt: (position) => position.y === 63 ? 'stone' : null,
    })
    const bobSent: WireText[] = []
    expect(fixture.server.connect('socket-b', (wire) => bobSent.push(wire))).toBe(true)
    expect(fixture.server.receive('socket-b', frame({
      _tag: 'PlayerJoin', player: playerId('bob'), name: playerName('Bob'), at: { x: 0, y: 64, z: -3.2 },
    })).accepted).toBe(true)
    fixture.sent.length = 0
    fixture.persisted.length = 0

    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('player-bow-start'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'start',
    }).accepted).toBe(true)
    now = 1_000
    expect(fixture.receive({
      _tag: 'BowUseCommand', commandId: commandId('player-bow-release'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, action: 'release',
    }).accepted).toBe(true)
    fixture.sent.length = 0

    fixture.server.tick(100)

    const vitalsDelta = messages(fixture.sent).find((message) =>
      message._tag === 'PlayerVitalsDelta' && message.player === playerId('bob'),
    )
    expect(vitalsDelta).toEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta', player: 'bob', state: expect.objectContaining({ health: expect.any(Number) }),
    }))
    if (vitalsDelta?._tag !== 'PlayerVitalsDelta') throw new Error('missing opposing-player vitals delta')
    expect(vitalsDelta.state.health).toBeLessThan(20)
    expect(messages(fixture.sent)).not.toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta', player: 'alice',
    }))
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityDespawnDelta', entityId: 'player-bow-release:arrow',
    }))
    expect(fixture.persisted.at(-1)?.vitals).toEqual(expect.arrayContaining([
      expect.objectContaining({ player: 'alice', state: expect.objectContaining({ health: 20 }) }),
      expect.objectContaining({ player: 'bob', state: expect.objectContaining({ health: vitalsDelta.state.health }) }),
    ]))
  })

  it('ignites TNT and resolves its explosion on the server', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { selectedSlot: 0, slots: [{ item: 'fire_charge', count: 1 }, null, null] },
      }],
      blocks: [...state.blocks, { at: { x: 1, y: 64, z: 0 }, block: 'tnt' }],
      vitals: [{ player: playerId('alice'), state: { health: 20, hunger: 20, experience: 0 } }],
    }, { x: -2, y: 64, z: 0 })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'IgniteTntCommand', commandId: commandId('ignite-tnt'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, at: { x: 1, y: 64, z: 0 },
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        player: playerId('alice'),
        state: { selectedSlot: 0, slots: [null, null, null] },
      }),
      expect.objectContaining({ _tag: 'EntitySpawnDelta', revision: 5, entity: expect.objectContaining({ _tag: 'primed-tnt', burnedSecs: 0 }) }),
      expect.objectContaining({
        _tag: 'AuthoritativeSnapshot',
        revision: 5,
        entities: [expect.objectContaining({ _tag: 'primed-tnt', entityId: 'ignite-tnt:tnt' })],
      }),
    ]))
    expect(fixture.persisted.at(-1)?.blocks).not.toContainEqual(expect.objectContaining({
      at: { x: 1, y: 64, z: 0 }, block: 'tnt',
    }))
    fixture.sent.length = 0

    fixture.server.tick(1_000)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ _tag: 'primed-tnt', burnedSecs: 1 }),
    }))
    fixture.sent.length = 0

    fixture.server.tick(3_000)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'ignite-tnt:tnt' }),
      expect.objectContaining({ _tag: 'WorldSnapshot' }),
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        player: playerId('alice'),
        state: { health: 0, hunger: 20, experience: 0 },
      }),
    ]))
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta',
      player: playerId('alice'),
      state: { selectedSlot: 0, slots: [null, null, null] },
    }))
    expect(fixture.persisted.at(-1)?.entities).not.toContainEqual(expect.objectContaining({
      entityId: 'ignite-tnt:tnt',
    }))
  })

  it('rejects TNT ignition without an ignition item', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 1, y: 64, z: 0 }, block: 'tnt' }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'IgniteTntCommand', commandId: commandId('ignite-tnt-without-item'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4, at: { x: 1, y: 64, z: 0 },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'ignite-tnt-without-item',
        reason: 'invalid-command',
        revision: 4,
      }),
    ])
    expect(fixture.persisted).toEqual([])
  })

  it('resolves ender pearl movement, consumption, and damage on the server', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { selectedSlot: 0, slots: [{ item: 'ender_pearl', count: 2 }, null, null] },
      }],
      vitals: [{ player: playerId('alice'), state: { health: 20, hunger: 20, experience: 7 } }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EnderPearlCommand', commandId: commandId('throw-ender-pearl'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        player: playerId('alice'),
        state: { selectedSlot: 0, slots: [{ item: 'ender_pearl', count: 1 }, null, null] },
      }),
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 5,
        player: playerId('alice'),
        state: { health: 15, hunger: 20, experience: 7 },
      }),
      expect.objectContaining({
        _tag: 'PlayerMove',
        player: playerId('alice'),
        world: worldId('world-1'),
        at: { x: 0, y: 64, z: -24 },
      }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'throw-ender-pearl', revision: 5 }),
    ]))
    expect(fixture.persisted.at(-1)?.playerPositions).toContainEqual(expect.objectContaining({
      player: playerId('alice'), at: { x: 0, y: 64, z: -24 },
    }))
  })

  it('rejects ender pearl use without a selected pearl', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EnderPearlCommand', commandId: commandId('throw-ender-pearl-without-item'),
      player: playerId('alice'), world: worldId('world-1'), expectedRevision: 4,
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'throw-ender-pearl-without-item',
        reason: 'invalid-command',
        revision: 4,
      }),
    ])
    expect(fixture.persisted).toEqual([])
  })

  it('resolves bucket collection and placement from the authoritative player pose', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [
        ...state.blocks,
        { at: { x: 0, y: 65, z: -1 }, block: 'water' },
        { at: { x: 0, y: 65, z: -2 }, block: 'stone' },
      ],
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'bucket', count: 1 }, null, null], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BucketUseCommand', commandId: commandId('collect-water'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta', revision: 5, player: playerId('alice'),
        state: expect.objectContaining({ slots: [{ item: 'water_bucket', count: 1 }, null, null] }),
      }),
      expect.objectContaining({ _tag: 'BlockBreak', at: { x: 0, y: 65, z: -1 } }),
    ]))

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'BucketUseCommand', commandId: commandId('place-water'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 5,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta', revision: 6, player: playerId('alice'),
        state: expect.objectContaining({ slots: [{ item: 'bucket', count: 1 }, null, null] }),
      }),
      expect.objectContaining({ _tag: 'BlockPlace', at: { x: 0, y: 65, z: -1 }, block: 'water' }),
    ]))
  })

  it('places vehicles and consumes the selected vehicle item from the authoritative player pose', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 0, y: 65, z: -1 }, block: 'stone' }],
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'oak_boat', count: 1 }, null, null], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'VehicleUseCommand', commandId: commandId('place-boat'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta', revision: 5, player: playerId('alice'),
        state: expect.objectContaining({ slots: [null, null, null], selectedSlot: 0 }),
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta', revision: 5,
        entity: expect.objectContaining({
          _tag: 'vehicle', vehicleType: 'boat', at: { x: 0.5, y: 65, z: 0.5 }, occupant: null,
        }),
      }),
    ]))
  })

  it('places minecarts on the targeted rail', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 0, y: 65, z: -1 }, block: 'rail' }],
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'minecart', count: 2 }, null, null], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'VehicleUseCommand', commandId: commandId('place-minecart'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta', revision: 5,
        state: expect.objectContaining({ slots: [{ item: 'minecart', count: 1 }, null, null], selectedSlot: 0 }),
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        entity: expect.objectContaining({
          _tag: 'vehicle', vehicleType: 'minecart', at: { x: 0.5, y: 65, z: -0.5 },
        }),
      }),
    ]))
  })

  it('keeps fishing, rod wear, and full-inventory loot drops authoritative', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: {
          selectedSlot: 0,
          slots: [{ item: 'fishing_rod', count: 1, durability: { current: 64, max: 64 } }, { item: 'stone', count: 64 }, { item: 'coal', count: 64 }],
        },
      }],
    }, undefined, 'normal', {
      generatedBlockAt: (at) => at.x === 0 && at.y === 65 && at.z < 0 && at.z >= -5 ? 'water' : null,
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'FishingCommand', action: 'cast', commandId: commandId('cast-fishing'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerFishingDelta', revision: 5, player: playerId('alice'), state: { phase: 'waiting', result: 'cast' },
    }))

    let biteObserved = false
    for (let second = 0; second < 30 && !biteObserved; second += 1) {
      fixture.server.tick(1_000)
      biteObserved = messages(fixture.sent).some((message) =>
        message._tag === 'PlayerFishingDelta' && message.state.phase === 'bite')
    }
    expect(biteObserved).toBe(true)
    const currentRevision = messages(fixture.sent).reduce(
      (latest, message) => 'revision' in message && typeof message.revision === 'number'
        ? Math.max(latest, message.revision)
        : latest,
      0,
    )
    expect(currentRevision).toBeGreaterThan(5)

    expect(fixture.receive({
      _tag: 'FishingCommand', action: 'reel', commandId: commandId('reel-fishing'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: currentRevision,
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        player: playerId('alice'),
        state: expect.objectContaining({
          slots: expect.arrayContaining([
            expect.objectContaining({ item: 'fishing_rod', count: 1, durability: { current: 63, max: 64 } }),
          ]),
        }),
      }),
      expect.objectContaining({
        _tag: 'PlayerFishingDelta', player: playerId('alice'), state: { phase: 'idle', result: 'caught' },
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        entity: expect.objectContaining({ _tag: 'item-drop', at: { x: 0, y: 64, z: 0 } }),
      }),
    ]))
  })

  it('rejects stacked fishing rods before simulation', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: {
          selectedSlot: 0,
          slots: [{ item: 'fishing_rod', count: 2, durability: { current: 64, max: 64 } }],
        },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'FishingCommand', action: 'cast', commandId: commandId('stacked-fishing-rod'), player: playerId('alice'),
      world: worldId('world-1'), expectedRevision: 4,
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerFishingDelta', revision: 5, player: playerId('alice'), state: { phase: 'idle', result: 'invalid-rod' },
    }))
  })

  it('moves unsupported sand through the server snapshot after its support is broken', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [
        ...state.blocks,
        { at: { x: 1, y: 65, z: 0 }, block: 'sand' },
        { at: { x: 1, y: 64, z: 0 }, block: 'stone' },
      ],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BlockBreak', player: playerId('alice'), world: worldId('world-1'), at: { x: 1, y: 64, z: 0 },
    }).accepted).toBe(true)
    fixture.sent.length = 0

    fixture.server.tick(50)

    const emitted = messages(fixture.sent)
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'WorldSnapshot',
        blocks: expect.arrayContaining([
          expect.objectContaining({ at: { x: 1, y: 65, z: 0 }, block: null }),
          expect.objectContaining({ at: { x: 1, y: 64, z: 0 }, block: 'sand' }),
        ]),
      }),
    ]))
    expect(emitted.at(-1)).toEqual(expect.objectContaining({ _tag: 'WorldSnapshot', revision: 6 }))
  })

  it.each([
    ['horizontal boundary', 'zombie', { x: 8, y: 64, z: 8 }],
    ['vertical boundary', 'blaze', { x: 0, y: 69, z: 0 }],
    ['overworld ranged hostile', 'skeleton', { x: 0, y: 64, z: 0 }],
    ['overworld melee hostile', 'spider', { x: 0, y: 64, z: 0 }],
    ['nether melee hostile', 'zombified_piglin', { x: 0, y: 64, z: 0 }],
  ] as const)('rejects sleep when a hostile mob is at the %s', (_case, entityType, at) => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 0, y: 64, z: 0 }, block: 'bed' }],
      timeWeather: { timeOfDay: 13_000, weather: 'clear' },
      entities: [{
        _tag: 'living', entityId: entityId(`hostile-${_case}`), entityType,
        at, health: 20, maxHealth: 20,
      }],
    })
    fixture.sent.length = 0

    fixture.server.receive('socket-a', JSON.stringify({
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: 'alice', session: 'alice', requestId: `sleep-${_case}`,
        expectedRevision: 0, clientTick: 20, bed: { x: 0, y: 64, z: 0 },
      },
    }) as WireText)

    expect(sleepResult(fixture.sent)).toMatchObject({
      _tag: 'SleepCommandResult', result: { accepted: false, reason: 'sleep-unsafe' },
    })
  })

  it.each([
    ['horizontal outside', 'creeper', { x: 8.01, y: 64, z: 0 }, 20],
    ['vertical outside', 'enderman', { x: 0, y: 69.01, z: 0 }, 20],
    ['nearby but dead', 'zombie', { x: 0, y: 64, z: 0 }, 0],
    ['nearby with invalid negative health', 'zombie', { x: 0, y: 64, z: 0 }, -1],
  ] as const)('allows sleep when a hostile mob is %s', (_case, entityType, at, health) => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 0, y: 64, z: 0 }, block: 'bed' }],
      timeWeather: { timeOfDay: 13_000, weather: 'clear' },
      entities: [{
        _tag: 'living', entityId: entityId(`hostile-${_case}`), entityType,
        at, health, maxHealth: 20,
      }],
    })
    fixture.sent.length = 0

    fixture.server.receive('socket-a', JSON.stringify({
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: 'alice', session: 'alice', requestId: `sleep-${_case}`,
        expectedRevision: 0, clientTick: 20, bed: { x: 0, y: 64, z: 0 },
      },
    }) as WireText)

    expect(sleepResult(fixture.sent)).toMatchObject({
      _tag: 'SleepCommandResult', result: { accepted: true },
    })
  })

  it('allows sleep near dropped items and non-hostile living entities', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [...state.blocks, { at: { x: 0, y: 64, z: 0 }, block: 'bed' }],
      timeWeather: { timeOfDay: 13_000, weather: 'clear' },
      entities: [
        {
          _tag: 'item-drop', entityId: entityId('drop-1'), at: { x: 0, y: 64, z: 0 },
          stack: { item: 'stone', count: 1 },
        },
        {
          _tag: 'living', entityId: entityId('cow-1'), entityType: 'cow', at: { x: 0, y: 64, z: 0 },
          health: 10, maxHealth: 10,
        },
      ],
    })
    fixture.sent.length = 0

    fixture.server.receive('socket-a', JSON.stringify({
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: 'alice', session: 'alice', requestId: 'sleep-non-hostile',
        expectedRevision: 0, clientTick: 20, bed: { x: 0, y: 64, z: 0 },
      },
    }) as WireText)

    expect(sleepResult(fixture.sent)).toMatchObject({
      _tag: 'SleepCommandResult', result: { accepted: true },
    })
  })

  it('sends authoritative state on join and explicit resync', () => {
    const fixture = makeFixture()
    expect(messages(fixture.sent).find((message) => message._tag === 'AuthoritativeSnapshot')).toMatchObject({
      _tag: 'AuthoritativeSnapshot',
      world: 'world-1',
      revision: 4,
      inventories: [{ player: 'alice', state: { selectedSlot: 0 } }],
      vitals: [{ player: 'alice', state: { health: 3, hunger: 2, experience: 7 } }],
      timeWeather: { timeOfDay: 6_000, weather: 'clear' },
      containers: [{ containerId: 'world-1:1,64,0' }],
      furnaces: [{ furnaceId: '["world-1",2,64,0]' }],
    })

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'AuthoritativeResyncRequest',
      world: worldId('world-1'),
      lastKnownRevision: 1,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeSnapshot', revision: 4 }),
    ])
  })

  it('applies inventory and vitals commands once and rejects stale revisions', () => {
    const spawnAt = { x: 6, y: 70, z: -4 }
    const fixture = makeFixture(undefined, undefined, 'normal', { spawnAt })
    fixture.sent.length = 0
    const inventoryCommand: NetworkMessage = {
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'move-item', source: 0, destination: 2, count: 2 },
    }

    expect(fixture.receive(inventoryCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'inventory-1', revision: 5 }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({
          slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 3 }, { item: 'stone', count: 2 }],
        }),
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    expect(fixture.receive(inventoryCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'inventory-1', revision: 5 }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    expect(fixture.receive({
      ...inventoryCommand,
      action: { _tag: 'move-item', source: 2, destination: 0, count: 1 },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'inventory-1',
        revision: 5,
        reason: 'invalid-command',
        resyncRequired: false,
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    const staleCommand: NetworkMessage = {
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('vitals-stale'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: 'respawn',
    }
    expect(fixture.receive(staleCommand)).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'vitals-stale',
        revision: 5,
        reason: 'stale-revision',
        resyncRequired: true,
      }),
    ])

    fixture.sent.length = 0
    const vitalsCommand: NetworkMessage = { ...staleCommand, commandId: commandId('vitals-1'), expectedRevision: 5 }
    expect(fixture.receive(vitalsCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', revision: 6 }),
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 6,
        state: { health: 20, hunger: 20, experience: 0 },
      }),
      expect.objectContaining({
        _tag: 'PlayerMove',
        player: 'alice',
        world: 'world-1',
        at: spawnAt,
        facing: { yawRadians: 0, pitchRadians: 0 },
      }),
    ])
    expect(fixture.persisted.at(-1)).toEqual(expect.objectContaining({
      playerPositions: [expect.objectContaining({ player: 'alice', at: spawnAt })],
    }))
  })

  it('swaps inventory stacks while enforcing stack capacity for moves', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('swap-inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'swap-items', source: 0, destination: 1 },
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta',
      state: expect.objectContaining({
        slots: expect.arrayContaining([{ item: 'coal', count: 3 }, { item: 'stone', count: 5 }]),
      }),
    }))

    const splitState = initialState()
    const splitFixture = makeFixture({
      ...splitState,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'stone', count: 5 }, null], selectedSlot: 0 },
      }],
    })
    splitFixture.sent.length = 0
    expect(splitFixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('split-inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'move-item', source: 0, destination: 1, count: 1 },
    }).accepted).toBe(true)
    expect(messages(splitFixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta',
      state: expect.objectContaining({
        slots: [{ item: 'stone', count: 4 }, { item: 'stone', count: 1 }],
      }),
    }))

    const overflowState = initialState()
    const overflowFixture = makeFixture({
      ...overflowState,
      inventories: [{
        player: playerId('alice'),
        state: {
          slots: [{ item: 'stone', count: 1 }, { item: 'stone', count: 64 }, null],
          selectedSlot: 0,
        },
      }],
    })
    overflowFixture.sent.length = 0
    expect(overflowFixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('overflow-inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'move-item', source: 0, destination: 1, count: 1 },
    }).accepted).toBe(false)
  })

  it('drops inventory items at the authoritative player position exactly once', () => {
    const fixture = makeFixture(initialState(), { x: 7, y: 70, z: -3 })
    fixture.sent.length = 0
    const command: NetworkMessage = {
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('drop-inventory-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'drop-item', source: 0, destination: 'world', count: 2 },
    }

    expect(fixture.receive(command).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'drop-inventory-1', revision: 5 }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({ slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 3 }, null] }),
      }),
      expect.objectContaining({
        _tag: 'EntitySpawnDelta',
        revision: 5,
        entity: expect.objectContaining({
          _tag: 'item-drop',
          at: { x: 7, y: 70, z: -3 },
          stack: { item: 'stone', count: 2 },
        }),
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    fixture.sent.length = 0
    expect(fixture.receive(command).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'drop-inventory-1', revision: 5 }),
    ])
    expect(fixture.persisted).toHaveLength(1)
  })

  it('splits a partial entity pickup across stacks and keeps the remainder in the world', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'stone', count: 63 }, null], selectedSlot: 0 },
      }],
      entities: [{
        _tag: 'item-drop', entityId: entityId('large-drop'), at: { x: 1, y: 64, z: 0 },
        stack: { item: 'stone', count: 66 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityPickupCommand',
      commandId: commandId('partial-pickup'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('large-drop'),
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', commandId: 'partial-pickup', revision: 5 }),
      expect.objectContaining({
        _tag: 'EntityUpdateDelta',
        revision: 5,
        entity: expect.objectContaining({ entityId: 'large-drop', stack: { item: 'stone', count: 1 } }),
      }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({ slots: [{ item: 'stone', count: 64 }, { item: 'stone', count: 64 }] }),
      }),
    ])
    expect(fixture.persisted[0]).toMatchObject({
      revision: 5,
      entities: [expect.objectContaining({ entityId: 'large-drop', stack: { item: 'stone', count: 1 } })],
    })
  })

  it('rejects an entity pickup when the inventory has no capacity and preserves the entity', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'stone', count: 64 }, { item: 'coal', count: 64 }], selectedSlot: 0 },
      }],
      entities: [{
        _tag: 'item-drop', entityId: entityId('blocked-drop'), at: { x: 1, y: 64, z: 0 },
        stack: { item: 'stone', count: 2 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityPickupCommand',
      commandId: commandId('blocked-pickup'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('blocked-drop'),
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'blocked-pickup',
        reason: 'invalid-command',
        revision: 4,
      }),
    ])
    expect(fixture.persisted).toEqual([])

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'EntityPickupCommand',
      commandId: commandId('blocked-pickup-retry'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('blocked-drop'),
    })).toEqual({ accepted: false, reason: 'invalid-command' })
  })

  it('evicts the oldest command result when the FIFO cache reaches its limit', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    const oldestCommand: NetworkMessage = {
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('cache-oldest'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'select-slot', slot: 1 },
    }

    expect(fixture.receive(oldestCommand).accepted).toBe(true)
    fixture.sent.length = 0
    expect(fixture.receive(oldestCommand).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandAccepted',
        commandId: 'cache-oldest',
        revision: 5,
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)

    for (let index = 0; index < 1_024; index += 1) {
      expect(fixture.receive({
        _tag: 'PlayerInventoryCommand',
        commandId: commandId(`cache-filler-${index}`),
        player: playerId('alice'),
        world: worldId('world-1'),
        expectedRevision: 4,
        action: { _tag: 'select-slot', slot: 1 },
      })).toEqual({ accepted: false, reason: 'invalid-command' })
    }

    fixture.sent.length = 0
    expect(fixture.receive(oldestCommand)).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'cache-oldest',
        revision: 5,
        reason: 'stale-revision',
      }),
    ])

    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('cache-advance'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      action: { _tag: 'select-slot', slot: 2 },
    }).accepted).toBe(true)

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('cache-filler-1023'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'select-slot', slot: 1 },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        commandId: 'cache-filler-1023',
        revision: 5,
        reason: 'stale-revision',
      }),
    ])
  })

  it('scopes duplicate command ids to each player', () => {
    const fixture = makeFixture()
    const bobSent: WireText[] = []
    expect(fixture.server.connect('socket-b', (wire) => bobSent.push(wire))).toBe(true)
    expect(fixture.server.receive('socket-b', frame({
      _tag: 'PlayerJoin',
      player: playerId('bob'),
      name: playerName('Bob'),
      at: { x: 0, y: 64, z: 0 },
    })).accepted).toBe(true)

    const sharedCommandId = commandId('entity-1')
    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: sharedCommandId,
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'select-slot', slot: 1 },
    }).accepted).toBe(true)
    expect(fixture.server.receive('socket-b', frame({
      _tag: 'PlayerInventoryCommand',
      commandId: sharedCommandId,
      player: playerId('bob'),
      world: worldId('world-1'),
      expectedRevision: 5,
      action: { _tag: 'select-slot', slot: 1 },
    }))).toEqual(expect.objectContaining({ accepted: true }))
    expect(messages(bobSent)).toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeCommandAccepted', commandId: 'entity-1', revision: 6,
    }))
  })

  it('uses hunger authority for activity ticks and preserves state across rejoin', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('activity-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'activity', activity: 'jump', amount: 100 },
    }).accepted).toBe(true)
    fixture.sent.length = 0
    fixture.server.tick(2_000)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'WorldTimeWeatherDelta',
        revision: 5,
        state: { timeOfDay: 6_040, weather: 'clear' },
      }),
    ])
    fixture.server.tick(2_000)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'WorldTimeWeatherDelta',
        revision: 5,
        state: { timeOfDay: 6_080, weather: 'clear' },
      }),
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 6,
        player: 'alice',
        state: { health: 3, hunger: 2, experience: 7 },
      }),
    ]))

    fixture.server.disconnect('socket-a')
    fixture.sent.length = 0
    expect(fixture.server.connect('socket-b', (wire) => fixture.sent.push(wire))).toBe(true)
    expect(fixture.server.receive('socket-b', frame({
      _tag: 'PlayerJoin',
      player: playerId('alice'),
      name: playerName('Alice'),
      at: { x: 0, y: 64, z: 0 },
    })).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeSnapshot',
      revision: 6,
      vitals: [{ player: 'alice', state: { health: 3, hunger: 2, experience: 7 } }],
    }))
  })

  it('drops and clears inventory exactly once when starvation kills a player', () => {
    const fixture = makeFixture({
      ...initialState(),
      vitals: [{ player: playerId('alice'), state: { health: 1, hunger: 0, experience: 7 } }],
    }, { x: 7, y: 70, z: -3 }, 'hard')
    fixture.sent.length = 0

    for (let tick = 0; tick < 100; tick += 1) {
      fixture.server.tick(4_000)
      if (messages(fixture.sent).some((message) => message._tag === 'PlayerVitalsDelta' && message.state.health === 0)) break
    }

    const output = messages(fixture.sent)
    const deathVitals = output.find((message) => message._tag === 'PlayerVitalsDelta' && message.state.health === 0)
    expect(deathVitals).toBeDefined()
    if (deathVitals?._tag !== 'PlayerVitalsDelta') throw new Error('missing death vitals')
    expect(output.filter((message) => message._tag === 'EntitySpawnDelta')).toEqual([
      expect.objectContaining({ revision: deathVitals.revision, entity: expect.objectContaining({ at: { x: 7, y: 70, z: -3 }, stack: { item: 'stone', count: 5 } }) }),
      expect.objectContaining({ revision: deathVitals.revision, entity: expect.objectContaining({ at: { x: 7, y: 70, z: -3 }, stack: { item: 'coal', count: 3 } }) }),
    ])
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta',
      revision: deathVitals.revision,
      state: expect.objectContaining({ slots: [null, null, null] }),
    }))
    expect(deathVitals.state.experience).toBe(0)
    expect(fixture.timeline[0]).toBe('persist')
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: deathVitals.revision,
      inventories: [{ player: 'alice', state: { slots: [null, null, null], selectedSlot: 0 } }],
      vitals: [{ player: 'alice', state: { health: 0, hunger: 0, experience: 0 } }],
      entities: [
        { _tag: 'item-drop', at: { x: 7, y: 70, z: -3 }, stack: { item: 'stone', count: 5 } },
        { _tag: 'item-drop', at: { x: 7, y: 70, z: -3 }, stack: { item: 'coal', count: 3 } },
      ],
    })

    fixture.sent.length = 0
    fixture.server.tick(40_000)
    expect(messages(fixture.sent).some((message) => message._tag === 'EntitySpawnDelta')).toBe(false)
  })

  it('applies self damage and reuses atomic player death handling exactly once', () => {
    const fixture = makeFixture(initialState(), { x: 7, y: 70, z: -3 })
    fixture.sent.length = 0

    const first: PlayerDamageCommand = {
      _tag: 'PlayerDamageCommand',
      commandId: 'damage-1',
      player: 'alice',
      world: 'world-1',
      expectedRevision: 4,
      amount: 2,
    }
    expect(fixture.receiveDamage(first).accepted).toBe(true)
    expect(decodePlayerDamageWireMessage(fixture.sent[0]!)).toEqual({
      _tag: 'PlayerDamageCommandResult',
      commandId: 'damage-1',
      accepted: true,
      revision: 5,
    })
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 5,
        player: 'alice',
        state: { health: 1, hunger: 2, experience: 7 },
      }),
    ])

    fixture.sent.length = 0
    const lethal: PlayerDamageCommand = { ...first, commandId: 'damage-2', expectedRevision: 5, amount: 1 }
    expect(fixture.receiveDamage(lethal).accepted).toBe(true)
    const output = messages(fixture.sent)
    expect(output.filter((message) => message._tag === 'EntitySpawnDelta')).toEqual([
      expect.objectContaining({ revision: 6, entity: expect.objectContaining({ at: { x: 7, y: 70, z: -3 }, stack: { item: 'stone', count: 5 } }) }),
      expect.objectContaining({ revision: 6, entity: expect.objectContaining({ at: { x: 7, y: 70, z: -3 }, stack: { item: 'coal', count: 3 } }) }),
    ])
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta',
      revision: 6,
      state: expect.objectContaining({ slots: [null, null, null] }),
    }))
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta',
      revision: 6,
      state: { health: 0, hunger: 2, experience: 0 },
    }))
    expect(fixture.timeline[0]).toBe('persist')

    fixture.sent.length = 0
    expect(fixture.receiveDamage(lethal).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([])
    expect(decodePlayerDamageWireMessage(fixture.sent[0]!)).toMatchObject({
      _tag: 'PlayerDamageCommandResult', accepted: true, revision: 6,
    })
  })

  it('rejects player damage targeting another identity', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receiveDamage({
      _tag: 'PlayerDamageCommand',
      commandId: 'damage-spoof',
      player: 'bob',
      world: 'world-1',
      expectedRevision: 4,
      amount: 1,
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(decodePlayerDamageWireMessage(fixture.sent[0]!)).toMatchObject({
      _tag: 'PlayerDamageCommandResult',
      accepted: false,
      revision: 4,
      reason: 'unauthorized-player',
    })
    expect(fixture.persisted).toEqual([])
  })

  it.each([
    ['wrong world', { world: 'world-2' }, 'wrong-world'],
    ['stale revision', { expectedRevision: 3 }, 'stale-revision'],
  ] as const)('rejects player damage with %s', (_case, override, resultReason) => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    const result = fixture.receiveDamage({
      _tag: 'PlayerDamageCommand', commandId: `damage-${resultReason}`, player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1, ...override,
    })
    expect(result.accepted).toBe(false)
    expect(decodePlayerDamageWireMessage(fixture.sent[0]!)).toMatchObject({
      _tag: 'PlayerDamageCommandResult', accepted: false, revision: 4, reason: resultReason,
    })
    expect(fixture.persisted).toEqual([])
  })

  it('applies an idempotent player damage command only once', () => {
    const fixture = makeFixture()
    const command: PlayerDamageCommand = {
      _tag: 'PlayerDamageCommand', commandId: 'damage-idempotent', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1,
    }
    expect(fixture.receiveDamage(command).accepted).toBe(true)
    expect(fixture.receiveDamage(command).accepted).toBe(true)
    expect(fixture.persisted).toHaveLength(1)
    expect(fixture.persisted[0]).toMatchObject({
      revision: 5, vitals: [{ player: 'alice', state: { health: 2 } }],
    })
  })

  it('uses canonical player damage fingerprints across wire key order', () => {
    const fixture = makeFixture()
    const first = JSON.stringify({
      _tag: 'PlayerDamageCommand', commandId: 'damage-canonical', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1,
    }) as WireText
    const reordered = JSON.stringify({
      amount: 1, expectedRevision: 4, world: 'world-1', player: 'alice',
      commandId: 'damage-canonical', _tag: 'PlayerDamageCommand',
    }) as WireText

    expect(fixture.server.receive('socket-a', first).accepted).toBe(true)
    expect(fixture.server.receive('socket-a', reordered).accepted).toBe(true)
    expect(fixture.persisted).toHaveLength(1)
    expect(fixture.persisted[0]).toMatchObject({
      revision: 5, vitals: [{ player: 'alice', state: { health: 2 } }],
    })

    const changed = JSON.stringify({
      amount: 2, expectedRevision: 4, world: 'world-1', player: 'alice',
      commandId: 'damage-canonical', _tag: 'PlayerDamageCommand',
    }) as WireText
    expect(fixture.server.receive('socket-a', changed)).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.persisted).toHaveLength(1)
  })

  it('keeps NUL-boundary player damage cache keys distinct', () => {
    expect(playerDamageResultKey(playerId('alice'), commandId('part\u0000tail')))
      .not.toBe(playerDamageResultKey(playerId('alice\u0000part'), commandId('tail')))
  })

  it('crafts from server inventory and caches the accepted result', () => {
    const fixture = makeFixture({
      ...initialState(),
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'oak_log', count: 1 }, null], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0
    const command: CraftingCommand = {
      _tag: 'CraftingCommand', commandId: 'craft-1', player: 'alice', world: 'world-1', expectedRevision: 4,
      grid: { width: 2, height: 2, cells: ['oak_log', null, null, null] },
    }

    expect(fixture.receiveCrafting(command).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta', revision: 5, player: 'alice',
      state: expect.objectContaining({ slots: [{ item: 'oak_planks', count: 4 }, null] }),
    }))
    expect(fixture.sent.map(decodeCraftingWireMessage)).toContainEqual({
      _tag: 'CraftingCommandResult', commandId: 'craft-1', accepted: true, revision: 5,
    })
    expect(fixture.receiveCrafting(command).accepted).toBe(true)
    expect(fixture.persisted).toHaveLength(1)
  })

  it('rejects a crafting grid not backed by server inventory', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    expect(fixture.receiveCrafting({
      _tag: 'CraftingCommand', commandId: 'craft-missing', player: 'alice', world: 'world-1', expectedRevision: 4,
      grid: { width: 2, height: 2, cells: ['oak_log', null, null, null] },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.sent.map(decodeCraftingWireMessage)).toContainEqual({
      _tag: 'CraftingCommandResult', commandId: 'craft-missing', accepted: false, revision: 4, reason: 'missing-ingredients',
    })
    expect(fixture.persisted).toEqual([])
  })

  it('keeps NUL-boundary crafting cache keys distinct', () => {
    expect(craftingResultKey(playerId('alice'), commandId('part\u0000tail')))
      .not.toBe(craftingResultKey(playerId('alice\u0000part'), commandId('tail')))
  })

  it('accepts fractional player damage produced by armor mitigation', () => {
    const wire = JSON.stringify({
      _tag: 'PlayerDamageCommand', commandId: 'damage-fractional', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 0.5,
    }) as WireText
    expect(decodePlayerDamageWireMessage(wire)).toMatchObject({ amount: 0.5 })
  })

  it('preserves the requested minimum health point floor when applying damage', () => {
    const fixture = makeFixture()
    expect(fixture.receiveDamage({
      _tag: 'PlayerDamageCommand', commandId: 'damage-floor', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 3, minimumHealthPoints: 1,
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta',
      revision: 5,
      player: 'alice',
      state: { health: 1, hunger: 2, experience: 7 },
    }))
    expect(fixture.persisted).toHaveLength(1)
  })

  it.each([
    ['negative', -0.1],
    ['too large', PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS + 0.1],
  ] as const)('rejects %s minimum health point floor at the codec boundary', (_case, minimumHealthPoints) => {
    const wire = JSON.stringify({
      _tag: 'PlayerDamageCommand', commandId: 'damage-invalid-floor', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1, minimumHealthPoints,
    }) as WireText
    expect(decodePlayerDamageWireMessage(wire)).toBeUndefined()
    const fixture = makeFixture()
    expect(fixture.server.receive('socket-a', wire)).toEqual({ accepted: false, reason: 'malformed-frame' })
    expect(fixture.persisted).toEqual([])
  })

  it('includes minimum health point floors in the idempotency fingerprint', () => {
    const fixture = makeFixture()
    const first: PlayerDamageCommand = {
      _tag: 'PlayerDamageCommand', commandId: 'damage-floor-fingerprint', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1, minimumHealthPoints: 1,
    }
    expect(fixture.receiveDamage(first).accepted).toBe(true)
    expect(fixture.receiveDamage({ ...first, minimumHealthPoints: 0 })).toEqual({
      accepted: false, reason: 'invalid-command',
    })
    expect(fixture.persisted).toHaveLength(1)
  })

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['out of range', PLAYER_DAMAGE_MAX_AMOUNT + 1],
  ] as const)('rejects %s player damage amounts at the codec boundary', (_case, amount) => {
    const wire = JSON.stringify({
      _tag: 'PlayerDamageCommand', commandId: 'damage-invalid', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount,
    }) as WireText
    expect(decodePlayerDamageWireMessage(wire)).toBeUndefined()
    const fixture = makeFixture()
    expect(fixture.server.receive('socket-a', wire)).toEqual({ accepted: false, reason: 'malformed-frame' })
    expect(fixture.persisted).toEqual([])
  })

  it('rejects oversized player damage wires and identifiers', () => {
    const base = {
      _tag: 'PlayerDamageCommand', commandId: 'damage-size', player: 'alice',
      world: 'world-1', expectedRevision: 4, amount: 1,
    }
    for (const key of ['commandId', 'player', 'world'] as const) {
      const wire = JSON.stringify({ ...base, [key]: 'x'.repeat(PLAYER_DAMAGE_MAX_IDENTIFIER_LENGTH + 1) }) as WireText
      expect(decodePlayerDamageWireMessage(wire)).toBeUndefined()
    }
    const oversized = JSON.stringify({ ...base, padding: 'x'.repeat(PLAYER_DAMAGE_MAX_WIRE_LENGTH) }) as WireText
    expect(oversized.length).toBeGreaterThan(PLAYER_DAMAGE_MAX_WIRE_LENGTH)
    expect(decodePlayerDamageWireMessage(oversized)).toBeUndefined()
    const fixture = makeFixture()
    expect(fixture.server.receive('socket-a', oversized)).toEqual({ accepted: false, reason: 'malformed-frame' })
    expect(fixture.persisted).toEqual([])
  })

  it.each([
    ['melee', witherState('world-1', 'airborne'), 1_000],
    ['explosion', witherState('world-1', 'charging'), 100],
  ] as const)('applies atomic player death handling to Wither %s damage', (_kind, wither, elapsedMs) => {
    const fixture = makeFixture({ ...initialState(), wither })
    fixture.sent.length = 0

    fixture.server.tick(elapsedMs)

    const output = messages(fixture.sent)
    const deathVitals = output.find((message) => message._tag === 'PlayerVitalsDelta' && message.state.health === 0)
    expect(deathVitals).toBeDefined()
    if (deathVitals?._tag !== 'PlayerVitalsDelta') throw new Error('missing death vitals')
    expect(output.filter((message) => message._tag === 'EntitySpawnDelta')).toHaveLength(2)
    expect(output.filter((message) => message._tag === 'EntitySpawnDelta').every((message) => message.revision === deathVitals.revision)).toBe(true)
    expect(output.filter((message) => message._tag === 'EntitySpawnDelta').every((message) => message.world === 'world-1')).toBe(true)
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'PlayerInventoryDelta', revision: deathVitals.revision, state: expect.objectContaining({ slots: [null, null, null] }),
    }))
    expect(deathVitals.state.experience).toBe(0)
    fixture.sent.length = 0
    fixture.server.tick(elapsedMs)
    expect(messages(fixture.sent).some((message) => message._tag === 'EntitySpawnDelta')).toBe(false)
    expect(fixture.persisted.at(-1)?.entities).toHaveLength(2)
  })

  it('filters Wither explosion player damage by dimension', () => {
    const fixture = makeFixture({ ...initialState(), wither: witherState('nether', 'charging') })
    fixture.sent.length = 0

    fixture.server.tick(100)

    expect(messages(fixture.sent).some((message) => message._tag === 'PlayerVitalsDelta' || message._tag === 'EntitySpawnDelta')).toBe(false)
  })

  it('applies Wither explosion damage across the full gameplay blast diameter', () => {
    const state = initialState()
    const position = { x: 13, y: 64, z: 0 }
    const fixture = makeFixture({
      ...state,
      vitals: [{ player: playerId('alice'), state: { health: 10, hunger: 20, experience: 0 } }],
      playerPositions: [{
        player: playerId('alice'),
        at: position,
        facing: { yawRadians: 0, pitchRadians: 0 },
      }],
      wither: witherState('world-1', 'charging'),
    }, position)
    fixture.sent.length = 0

    fixture.server.tick(100)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta',
      player: playerId('alice'),
      state: expect.objectContaining({ health: 6 }),
    }))
  })

  it('consumes food and broadcasts inventory and vitals deltas atomically', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      inventories: [{
        player: playerId('alice'),
        state: { slots: [...state.inventories[0]!.state.slots, { item: 'potato', count: 2 }], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerVitalsCommand',
      commandId: commandId('eat-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'eat', item: 'potato' },
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandAccepted', revision: 5 }),
      expect.objectContaining({ _tag: 'PlayerVitalsDelta', revision: 5, state: { health: 3, hunger: 3, experience: 7 } }),
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({ slots: expect.arrayContaining([{ item: 'potato', count: 1 }]) }),
      }),
    ])
  })

  it('rejects client world changes while updating containers, furnaces, and persistent state', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'WorldTimeWeatherCommand',
      commandId: commandId('weather-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'set-weather', weather: 'rain' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('container-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      containerId: 'world-1:1,64,0',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 0 },
        destination: { _tag: 'container-slot', slot: 0 },
        count: 2,
      },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('furnace-fuel-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      furnaceId: '["world-1",2,64,0]',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 1 },
        destination: { _tag: 'furnace-slot', slot: 'fuel' },
        count: 1,
      },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('furnace-output-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 6,
      furnaceId: '["world-1",2,64,0]',
      action: {
        _tag: 'take-output',
        source: { _tag: 'furnace-slot', slot: 'output' },
        destination: { _tag: 'player-slot', slot: 2 },
        count: 1,
      },
    }).accepted).toBe(true)

    const output = messages(fixture.sent)
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeCommandRejected',
      commandId: 'weather-1',
      reason: 'invalid-command',
      revision: 4,
      resyncRequired: false,
    }))
    expect(output).not.toContainEqual(expect.objectContaining({
      _tag: 'AuthoritativeCommandAccepted',
      commandId: 'weather-1',
    }))
    expect(output).not.toContainEqual(expect.objectContaining({ _tag: 'WorldTimeWeatherDelta' }))
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'ContainerDelta',
      revision: 5,
      state: { containerId: 'world-1:1,64,0', kind: 'chest', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] },
    }))
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'FurnaceDelta',
      revision: 7,
      state: expect.objectContaining({ fuel: { item: 'coal', count: 1 }, output: { item: 'iron-ingot', count: 1 } }),
    }))
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 7,
      timeWeather: { timeOfDay: 6_000, weather: 'clear' },
      inventories: [{
        player: 'alice',
        state: { slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 2 }, { item: 'iron-ingot', count: 1 }] },
      }],
      containers: [{ containerId: 'world-1:1,64,0', kind: 'chest', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] }],
      furnaces: [{ furnaceId: '["world-1",2,64,0]', fuel: { item: 'coal', count: 1 }, output: { item: 'iron-ingot', count: 1 } }],
    })
  })

  it('authoritatively advances and persists furnace smelting on server ticks', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      furnaces: [{
        furnaceId: '["world-1",2,64,0]',
        input: { item: 'raw_iron', count: 1 },
        fuel: { item: 'coal', count: 1 },
        output: null,
        burnTicksRemaining: 0,
        cookTicks: 0,
      }],
    })
    fixture.sent.length = 0

    fixture.server.tick(10_000)

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'FurnaceDelta',
        revision: 5,
        state: expect.objectContaining({
          input: null,
          fuel: null,
          output: { item: 'iron_ingot', count: 1 },
          burnTicksRemaining: 1_400,
          cookTicks: 0,
        }),
      }),
      expect.objectContaining({
        _tag: 'WorldTimeWeatherDelta',
        revision: 5,
        state: { timeOfDay: 6_200, weather: 'clear' },
      }),
    ])
    expect(fixture.persisted).toHaveLength(1)
    expect(fixture.persisted[0]).toMatchObject({
      revision: 5,
      furnaces: [{
        input: null,
        fuel: null,
        output: { item: 'iron_ingot', count: 1 },
        burnTicksRemaining: 1_400,
        cookTicks: 0,
      }],
    })
  })

  it('advances world time at 50ms per game tick, preserves remainder, and wraps a day', () => {
    const fixture = makeFixture({
      ...initialState(),
      timeWeather: { timeOfDay: 23_999, weather: 'clear' },
    })
    fixture.sent.length = 0

    fixture.server.tick(25)
    expect(messages(fixture.sent)).not.toContainEqual(expect.objectContaining({ _tag: 'WorldTimeWeatherDelta' }))

    fixture.server.tick(25)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'WorldTimeWeatherDelta',
      state: { timeOfDay: 0, weather: 'clear' },
    }))

    fixture.sent.length = 0
    fixture.server.tick(50)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'WorldTimeWeatherDelta',
      state: { timeOfDay: 1, weather: 'clear' },
    }))
  })

  it('ages item drops authoritatively and despawns them after five minutes', () => {
    const fixture = makeFixture(initialState())
    fixture.sent.length = 0
    expect(fixture.server.spawnEntity({
      _tag: 'item-drop',
      entityId: entityId('expiring-drop'),
      at: { x: 2, y: 65, z: 3 },
      stack: { item: 'stone', count: 1 },
    })).toBe(true)
    fixture.sent.length = 0
    fixture.persisted.length = 0

    fixture.server.tick(100)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      revision: 5,
      entity: expect.objectContaining({
        _tag: 'item-drop', entityId: 'expiring-drop', ageTicks: 2,
      }),
    }))
    expect(fixture.persisted.at(-1)?.entities).toContainEqual(expect.objectContaining({
      _tag: 'item-drop', entityId: 'expiring-drop', ageTicks: 2,
    }))

    fixture.sent.length = 0
    fixture.persisted.length = 0
    fixture.server.tick(299_900)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityDespawnDelta', entityId: 'expiring-drop',
    }))
    expect(fixture.persisted.at(-1)?.entities).not.toContainEqual(expect.objectContaining({
      entityId: 'expiring-drop',
    }))
  })

  it('advances passive mob movement and persists its AI state authoritatively', () => {
    const fixture = makeFixture({
      ...initialState(),
      entities: [{
        _tag: 'living', entityId: entityId('cow-1'), entityType: 'cow',
        at: { x: 0, y: 64, z: 0 }, health: 10, maxHealth: 10,
      }],
    })
    fixture.sent.length = 0
    fixture.persisted.length = 0

    fixture.server.tick(1_000)

    const update = messages(fixture.sent).find((message) => message._tag === 'EntityUpdateDelta')
    expect(update).toMatchObject({
      entity: {
        entityId: 'cow-1',
        at: { x: expect.closeTo(Math.cos(1) * 1, 10), z: expect.closeTo(Math.sin(1) * 1, 10) },
        mobState: expect.objectContaining({ motionPhase: 1, attackCooldownSecs: 0, provoked: false }),
      },
    })
    expect(fixture.persisted.at(-1)?.entities).toContainEqual(expect.objectContaining({
      entityId: 'cow-1',
      mobState: { motionPhase: 1, attackCooldownSecs: 0, provoked: false },
    }))
  })

  it('applies hostile mob attacks to the nearest player and preserves cooldown state', () => {
    const fixture = makeFixture({
      ...initialState(),
      vitals: [{ player: playerId('alice'), state: { health: 20, hunger: 20, experience: 7 } }],
      entities: [{
        _tag: 'living', entityId: entityId('skeleton-1'), entityType: 'skeleton',
        at: { x: 10, y: 64, z: 0 }, health: 20, maxHealth: 20,
      }],
    })
    fixture.sent.length = 0
    fixture.persisted.length = 0

    fixture.server.tick(1_000)
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'EntityUpdateDelta',
        entity: expect.objectContaining({
          entityId: 'skeleton-1',
          mobState: expect.objectContaining({ motionPhase: 1, attackCooldownSecs: 2, provoked: false }),
        }),
      }),
      expect.objectContaining({ _tag: 'PlayerVitalsDelta', player: 'alice', state: expect.objectContaining({ health: 16 }) }),
    ]))

    fixture.sent.length = 0
    fixture.server.tick(1_000)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      entity: expect.objectContaining({ mobState: expect.objectContaining({ attackCooldownSecs: 1 }) }),
    }))
    expect(messages(fixture.sent).some((message) => message._tag === 'PlayerVitalsDelta')).toBe(false)

    fixture.sent.length = 0
    fixture.server.tick(1_000)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta', player: 'alice', state: expect.objectContaining({ health: 12 }),
    }))
  })

  it('despawns distant hostile mobs while retaining named, tamed, and persistent mobs', () => {
    const fixture = makeFixture({
      ...initialState(),
      entities: [
        {
          _tag: 'living', entityId: entityId('distant-zombie'), entityType: 'zombie',
          at: { x: 129, y: 64, z: 0 }, health: 20, maxHealth: 20,
        },
        {
          _tag: 'living', entityId: entityId('named-zombie'), entityType: 'zombie',
          at: { x: 130, y: 64, z: 0 }, health: 20, maxHealth: 20,
          mobState: { attackCooldownSecs: 0, motionPhase: 0, provoked: false, named: true, tamed: true, persistent: true },
        },
      ],
    })
    fixture.sent.length = 0
    fixture.persisted.length = 0

    fixture.server.tick(50)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityDespawnDelta', entityId: 'distant-zombie',
    }))
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      entity: expect.objectContaining({
        entityId: 'named-zombie',
        mobState: expect.objectContaining({ ageTicks: 1, named: true, tamed: true, persistent: true }),
      }),
    }))
    expect(fixture.persisted.at(-1)?.entities).not.toContainEqual(expect.objectContaining({ entityId: 'distant-zombie' }))
  })

  it('despawns hostile mobs in peaceful mode without removing passive mobs', () => {
    const fixture = makeFixture({
      ...initialState(),
      entities: [
        {
          _tag: 'living', entityId: entityId('peaceful-zombie'), entityType: 'zombie',
          at: { x: 4, y: 64, z: 0 }, health: 20, maxHealth: 20,
        },
        {
          _tag: 'living', entityId: entityId('peaceful-cow'), entityType: 'cow',
          at: { x: 5, y: 64, z: 0 }, health: 10, maxHealth: 10,
        },
      ],
    }, undefined, 'peaceful')
    fixture.sent.length = 0

    fixture.server.tick(50)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityDespawnDelta', entityId: 'peaceful-zombie',
    }))
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ entityId: 'peaceful-cow' }),
    }))
  })

  it('applies zombie melee damage through the authoritative entity loop', () => {
    const fixture = makeFixture({
      ...initialState(),
      vitals: [{ player: playerId('alice'), state: { health: 20, hunger: 20, experience: 0 } }],
      entities: [{
        _tag: 'living', entityId: entityId('zombie-1'), entityType: 'zombie',
        at: { x: 1, y: 64, z: 0 }, health: 20, maxHealth: 20,
      }],
    })
    fixture.sent.length = 0

    fixture.server.tick(1_000)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'PlayerVitalsDelta', player: 'alice', state: expect.objectContaining({ health: 17 }),
    }))
  })

  it('rejects unauthorized and missing-resource commands without advancing revision', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('spoof-1'),
      player: playerId('bob'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'select-slot', slot: 0 },
    })).toEqual({ accepted: false, reason: 'identity-spoof' })
    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('missing-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      containerId: 'missing',
      action: { _tag: 'open' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        reason: 'unauthorized-player',
        revision: 4,
        resyncRequired: false,
      }),
      expect.objectContaining({
        _tag: 'AuthoritativeCommandRejected',
        reason: 'invalid-command',
        revision: 4,
        resyncRequired: false,
      }),
    ])
    expect(fixture.persisted).toEqual([])
  })

  it('advances creeper fuses and resolves their explosion on the server', () => {
    const fixture = makeFixture({
      ...initialState(),
      entities: [{
        _tag: 'living',
        entityId: entityId('creeper-1'),
        entityType: 'creeper',
        at: { x: 1, y: 64, z: 0 },
        health: 20,
        maxHealth: 20,
      }],
    })
    fixture.sent.length = 0

    fixture.server.tick(1_000)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      entity: expect.objectContaining({
        entityId: 'creeper-1',
        mobState: expect.objectContaining({ attackCooldownSecs: 0, motionPhase: 1, provoked: true }),
      }),
    }))
    fixture.sent.length = 0

    fixture.server.tick(600)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'creeper-1' }),
      expect.objectContaining({ _tag: 'PlayerVitalsDelta', player: 'alice', state: expect.objectContaining({ health: 0 }) }),
    ]))
    expect(fixture.persisted.at(-1)?.entities).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ entityId: 'creeper-1' }),
    ]))
  })

  it('records enderman damage and resolves its teleport on the server', () => {
    const fixture = makeFixture({
      ...initialState(),
      entities: [{
        _tag: 'living',
        entityId: entityId('enderman-2'),
        entityType: 'enderman',
        at: { x: 1, y: 64, z: 0 },
        health: 20,
        maxHealth: 20,
      }],
    }, undefined, 'normal', {
      generatedBlockAt: (position) => position.y === 63 ? 'stone' : null,
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityAttackCommand',
      commandId: commandId('enderman-hit'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('enderman-2'),
    }).accepted).toBe(true)
    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      entity: expect.objectContaining({
        entityId: 'enderman-2',
        health: 16,
        mobState: expect.objectContaining({ provoked: true }),
      }),
    }))
    fixture.sent.length = 0

    fixture.server.tick(50)

    expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
      _tag: 'EntityUpdateDelta',
      entity: expect.objectContaining({
        entityId: 'enderman-2',
        at: expect.not.objectContaining({ x: 1, z: 0 }),
        mobState: expect.objectContaining({ provoked: false }),
      }),
    }))
    expect(fixture.persisted.at(-1)?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entityId: 'enderman-2',
        mobState: expect.objectContaining({ provoked: false }),
      }),
    ]))
  })

  it('synchronizes entities and restores their canonical state on reconnect', () => {
    const fixture = makeFixture({ ...initialState(), entities: [
      { _tag: 'living', entityId: entityId('zombie-1'), entityType: 'zombie', at: { x: 1, y: 64, z: 0 }, health: 8, maxHealth: 20 },
      { _tag: 'vehicle', entityId: entityId('boat-1'), vehicleType: 'boat', at: { x: 1, y: 64, z: 1 }, occupant: null },
    ] })
    const observer: Array<WireText> = []
    expect(fixture.server.connect('socket-b', (wire) => observer.push(wire))).toBe(true)
    expect(fixture.server.receive('socket-b', frame({ _tag: 'PlayerJoin', player: playerId('bob'), name: playerName('Bob'), at: { x: 0, y: 64, z: 0 } })).accepted).toBe(true)
    const send = (message: NetworkMessage): void => { expect(fixture.receive(message).accepted).toBe(true) }
    send({ _tag: 'EntityAttackCommand', commandId: commandId('attack-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 4, entityId: entityId('zombie-1') })
    send({ _tag: 'EntityAttackCommand', commandId: commandId('attack-2'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 5, entityId: entityId('zombie-1') })
    const drop = messages(observer).find((message) => message._tag === 'EntitySpawnDelta')
    expect(drop).toMatchObject({ _tag: 'EntitySpawnDelta', entity: { _tag: 'item-drop', stack: { item: 'rotten_flesh', count: 1 } } })
    expect(messages(observer)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'PlayerVitalsDelta', player: 'alice', state: { health: 3, hunger: 2, experience: 12 } }),
    ]))
    if (drop?._tag !== 'EntitySpawnDelta') throw new Error('missing item drop')
    send({ _tag: 'EntityPickupCommand', commandId: commandId('pickup-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 6, entityId: drop.entity.entityId })
    send({ _tag: 'VehicleCommand', commandId: commandId('mount-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 7, entityId: entityId('boat-1'), action: 'mount' })
    send({ _tag: 'VehicleCommand', commandId: commandId('move-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 8, entityId: entityId('boat-1'), action: { _tag: 'move', direction: 'backward' } })
    send({ _tag: 'VehicleCommand', commandId: commandId('dismount-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 9, entityId: entityId('boat-1'), action: 'dismount' })
    expect(messages(observer)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ entityId: 'zombie-1', health: 4 }) }),
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'zombie-1' }),
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: drop.entity.entityId }),
      expect.objectContaining({ _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ entityId: 'boat-1', at: { x: 1, y: 64, z: 2 }, occupant: null }) }),
    ]))
    fixture.server.disconnect('socket-a')
    const reconnect: Array<WireText> = []
    fixture.server.connect('socket-a2', (wire) => reconnect.push(wire))
    fixture.server.receive('socket-a2', frame({ _tag: 'PlayerJoin', player: playerId('alice'), name: playerName('Alice'), at: { x: 1, y: 64, z: 2 } }))
    expect(messages(reconnect).find((message) => message._tag === 'AuthoritativeSnapshot')).toMatchObject({ _tag: 'AuthoritativeSnapshot', revision: 10, entities: [{ entityId: 'boat-1', at: { x: 1, y: 64, z: 2 }, occupant: null }] })
  })

  it('does not turn an unknown living entity type into an invalid inventory item', () => {
    const fixture = makeFixture({ ...initialState(), entities: [
      { _tag: 'living', entityId: entityId('unknown-1'), entityType: 'custom-mob', at: { x: 1, y: 64, z: 0 }, health: 4, maxHealth: 4 },
    ] })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityAttackCommand',
      commandId: commandId('unknown-kill'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('unknown-1'),
    }).accepted).toBe(true)

    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'unknown-1' }),
    ]))
    expect(messages(fixture.sent).some((message) => message._tag === 'EntitySpawnDelta')).toBe(false)
    expect(messages(fixture.sent).some((message) => message._tag === 'PlayerVitalsDelta')).toBe(false)
  })

  it('rejects invalid entity authority requests and deduplicates accepted commands', () => {
    const fixture = makeFixture({ ...initialState(), entities: [
      { _tag: 'living', entityId: entityId('far-zombie'), entityType: 'zombie', at: { x: 20, y: 64, z: 0 }, health: 20, maxHealth: 20 },
      { _tag: 'vehicle', entityId: entityId('boat-1'), vehicleType: 'boat', at: { x: 1, y: 64, z: 0 }, occupant: null },
    ] })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'EntityAttackCommand',
      commandId: commandId('far-attack'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('far-zombie'),
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.receive({
      _tag: 'VehicleCommand',
      commandId: commandId('unmounted-move'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('boat-1'),
      action: { _tag: 'move', direction: 'forward' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.receive({
      _tag: 'VehicleCommand',
      commandId: commandId('stale-mount'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 3,
      entityId: entityId('boat-1'),
      action: 'mount',
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    const mount = {
      _tag: 'VehicleCommand' as const,
      commandId: commandId('mount-once'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      entityId: entityId('boat-1'),
      action: 'mount' as const,
    }
    expect(fixture.receive(mount).accepted).toBe(true)
    expect(fixture.receive(mount).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'VehicleCommand',
      commandId: commandId('vehicle-move'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      entityId: entityId('boat-1'),
      action: { _tag: 'move', direction: 'forward' },
    }).accepted).toBe(true)
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 6,
      entities: [{ entityId: 'far-zombie', health: 20 }, { entityId: 'boat-1', at: { x: 1, y: 64, z: -1 }, occupant: 'alice' }],
    })
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'out-of-range', revision: 4 }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'not-mounted', revision: 4 }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'stale-revision', revision: 4, resyncRequired: true }),
    ]))
  })

  it('rejects facility commands beyond authoritative reach', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [
        { at: { x: 20, y: 64, z: 0 }, block: 'chest' },
        { at: { x: 21, y: 64, z: 0 }, block: 'furnace' },
      ],
      containers: [{ containerId: 'world-1:20,64,0', kind: 'chest', slots: [] }],
      furnaces: [{
        furnaceId: '["world-1",21,64,0]',
        input: null,
        fuel: null,
        output: null,
        burnTicksRemaining: 0,
        cookTicks: 0,
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('far-container'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      containerId: 'world-1:20,64,0',
      action: { _tag: 'open' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('far-furnace'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      furnaceId: '["world-1",21,64,0]',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 1 },
        destination: { _tag: 'furnace-slot', slot: 'fuel' },
        count: 1,
      },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', commandId: 'far-container', reason: 'out-of-range' }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', commandId: 'far-furnace', reason: 'out-of-range' }),
    ])
  })

  it('rejects malformed, noncanonical, wrong-world, unsafe, and out-of-bounds facility ids', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0
    const containerIds = [
      'legacy-container',
      'world-1:01,64,0',
      'world-2:1,64,0',
      'world-1:9007199254740992,64,0',
      'world-1:999999999,64,0',
    ]
    const furnaceIds = [
      'legacy-furnace',
      ' ["world-1",2,64,0]',
      '["world-2",2,64,0]',
      '["world-1",2e0,64,0]',
      '["world-1",9007199254740992,64,0]',
      '["world-1",999999999,64,0]',
    ]

    for (const [index, containerId] of containerIds.entries()) {
      expect(fixture.receive({
        _tag: 'ContainerCommand',
        commandId: commandId(`invalid-container-${String(index)}`),
        player: playerId('alice'),
        world: worldId('world-1'),
        expectedRevision: 4,
        containerId,
        action: { _tag: 'open' },
      })).toEqual({ accepted: false, reason: 'invalid-command' })
    }
    for (const [index, furnaceId] of furnaceIds.entries()) {
      expect(fixture.receive({
        _tag: 'FurnaceCommand',
        commandId: commandId(`invalid-furnace-${String(index)}`),
        player: playerId('alice'),
        world: worldId('world-1'),
        expectedRevision: 4,
        furnaceId,
        action: {
          _tag: 'move-item',
          source: { _tag: 'player-slot', slot: 1 },
          destination: { _tag: 'furnace-slot', slot: 'fuel' },
          count: 1,
        },
      })).toEqual({ accepted: false, reason: 'invalid-command' })
    }

    expect(messages(fixture.sent)).toHaveLength(containerIds.length + furnaceIds.length)
    expect(messages(fixture.sent).every((message) =>
      message._tag === 'AuthoritativeCommandRejected' && message.reason === 'invalid-command',
    )).toBe(true)
    expect(fixture.persisted).toEqual([])
  })

  it('rejects facility commands when the authoritative block has the wrong type', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [
        { at: { x: 1, y: 64, z: 0 }, block: 'stone' },
        { at: { x: 2, y: 64, z: 0 }, block: 'stone' },
      ],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('wrong-container-block'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      containerId: 'world-1:1,64,0',
      action: { _tag: 'open' },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.receive({
      _tag: 'FurnaceCommand',
      commandId: commandId('wrong-furnace-block'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      furnaceId: '["world-1",2,64,0]',
      action: {
        _tag: 'move-item',
        source: { _tag: 'player-slot', slot: 1 },
        destination: { _tag: 'furnace-slot', slot: 'fuel' },
        count: 1,
      },
    })).toEqual({ accepted: false, reason: 'invalid-command' })

    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', commandId: 'wrong-container-block', reason: 'invalid-command' }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', commandId: 'wrong-furnace-block', reason: 'invalid-command' }),
    ])
  })

  it('registers and removes facility state across block placement and break', () => {
    const state = initialState()
    const fixture = makeFixture({
      ...state,
      blocks: [],
      containers: [],
      furnaces: [],
      inventories: [{
        player: playerId('alice'),
        state: { slots: [{ item: 'chest', count: 1 }, { item: 'furnace', count: 1 }], selectedSlot: 0 },
      }],
    })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 1, y: 64, z: 0 },
      block: 'chest',
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'PlayerInventoryCommand',
      commandId: commandId('select-furnace'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      action: { _tag: 'select-slot', slot: 1 },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 2, y: 64, z: 0 },
      block: 'furnace',
    }).accepted).toBe(true)

    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 7,
      inventories: [{ player: 'alice', state: { slots: [null, null] } }],
      containers: [{ containerId: 'world-1:1,64,0', kind: 'chest', slots: Array.from({ length: 27 }, () => null) }],
      furnaces: [{
        furnaceId: '["world-1",2,64,0]',
        input: null,
        fuel: null,
        output: null,
        burnTicksRemaining: 0,
        cookTicks: 0,
      }],
    })
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'PlayerInventoryDelta', revision: 5, state: expect.objectContaining({ slots: expect.arrayContaining([null]) }) }),
      expect.objectContaining({
        _tag: 'AuthoritativeSnapshot',
        revision: 5,
        containers: [{ containerId: 'world-1:1,64,0', kind: 'chest', slots: Array.from({ length: 27 }, () => null) }],
      }),
      expect.objectContaining({
        _tag: 'AuthoritativeSnapshot',
        revision: 7,
        furnaces: [expect.objectContaining({ furnaceId: '["world-1",2,64,0]' })],
      }),
    ]))

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'BlockBreak',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 1, y: 64, z: 0 },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockBreak',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 2, y: 64, z: 0 },
    }).accepted).toBe(true)

    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 9,
      containers: [],
      furnaces: [],
    })
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntitySpawnDelta', revision: 8, entity: expect.objectContaining({ _tag: 'item-drop', stack: { item: 'chest', count: 1 } }) }),
      expect.objectContaining({ _tag: 'EntitySpawnDelta', revision: 9, entity: expect.objectContaining({ _tag: 'item-drop', stack: { item: 'furnace', count: 1 } }) }),
      expect.objectContaining({ _tag: 'AuthoritativeSnapshot', revision: 8, containers: [] }),
      expect.objectContaining({ _tag: 'AuthoritativeSnapshot', revision: 9, containers: [], furnaces: [] }),
    ]))
  })

  it('creates each storage block with its typed capacity', () => {
    const storageCases: ReadonlyArray<readonly [ContainerKind, number]> = [
      ['chest', 27],
      ['shulker_box', 27],
      ['dispenser', 9],
      ['hopper', 5],
    ]

    for (const [kind, capacity] of storageCases) {
      const fixture = makeFixture({
        ...initialState(),
        blocks: [],
        containers: [],
        furnaces: [],
        inventories: [{
          player: playerId('alice'),
          state: { slots: [{ item: kind, count: 1 }], selectedSlot: 0 },
        }],
      }, undefined, 'normal', { allowedBlocks: new Set([kind]) })
      fixture.sent.length = 0

      expect(fixture.receive({
        _tag: 'BlockPlace',
        player: playerId('alice'),
        world: worldId('world-1'),
        at: { x: 1, y: 64, z: 0 },
        block: kind,
      }).accepted).toBe(true)
      expect(messages(fixture.sent)).toContainEqual(expect.objectContaining({
        _tag: 'AuthoritativeSnapshot',
        containers: [{
          containerId: 'world-1:1,64,0',
          kind,
          slots: Array.from({ length: capacity }, () => null),
        }],
      }))
    }
  })

  it('consumes placed blocks and rejects placement without inventory', () => {
    const fixture = makeFixture({ ...initialState(), blocks: [], containers: [], furnaces: [] })
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 1, y: 64, z: 0 },
      block: 'stone',
    })).toEqual({
      accepted: true,
      message: expect.objectContaining({ _tag: 'BlockPlace', block: 'stone' }),
    })
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        _tag: 'PlayerInventoryDelta',
        revision: 5,
        state: expect.objectContaining({ slots: expect.arrayContaining([{ item: 'stone', count: 4 }]) }),
      }),
    ]))

    fixture.sent.length = 0
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 2, y: 64, z: 0 },
      block: 'stone',
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 0, y: 64, z: 1 },
      block: 'stone',
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 3, y: 64, z: 0 },
      block: 'stone',
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 4, y: 64, z: 0 },
      block: 'stone',
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'BlockPlace',
      player: playerId('alice'),
      world: worldId('world-1'),
      at: { x: 0, y: 64, z: 2 },
      block: 'stone',
    })).toEqual({ accepted: false, reason: 'invalid-mutation' })
    expect(fixture.persisted.at(-1)).toMatchObject({ revision: 9 })
  })
})
