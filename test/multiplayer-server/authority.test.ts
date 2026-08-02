import {
  decodeFrame,
  encodeFrame,
  type CommandId,
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
  type MultiplayerServerState,
  type ReceiveResult,
} from '../../apps/multiplayer-server/core'
import { decodeSleepWireMessage } from '../../apps/web/sleep-network'
import { decodeWitherWireMessage } from '../../apps/web/wither-network'

const playerId = (value: string): PlayerId => value as PlayerId
const playerName = (value: string): PlayerName => value as PlayerName
const worldId = (value: string): WorldId => value as WorldId
const commandId = (value: string): CommandId => value as CommandId
const entityId = (value: string): EntityId => value as EntityId

const frame = (message: NetworkMessage): WireText => {
  const encoded = encodeFrame(message)
  if (Either.isLeft(encoded)) throw encoded.left
  return encoded.right
}

const messages = (frames: ReadonlyArray<WireText>): ReadonlyArray<NetworkMessage> =>
  frames.filter((wire) => decodeSleepWireMessage(wire) === undefined && decodeWitherWireMessage(wire) === undefined).map((wire) => {
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
  containers: [{ containerId: 'world-1:1,64,0', slots: [null, { item: 'apple', count: 2 }] }],
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

const makeFixture = (state: MultiplayerServerState = initialState()) => {
  const sent: Array<WireText> = []
  const persisted: Array<MultiplayerServerState> = []
  const server = makeMultiplayerServerCore({
    worldId: 'world-1',
    seed: 42,
    allowedBlocks: new Set(['stone', 'chest', 'furnace']),
    initialState: state,
    onStateChanged: (state) => persisted.push(state),
  })
  expect(server.connect('socket-a', (wire) => sent.push(wire))).toBe(true)
  const receive = (message: NetworkMessage): ReceiveResult => server.receive('socket-a', frame(message))
  expect(receive({
    _tag: 'PlayerJoin',
    player: playerId('alice'),
    name: playerName('Alice'),
    at: { x: 0, y: 64, z: 0 },
  }).accepted).toBe(true)
  persisted.length = 0
  return { sent, persisted, receive, server }
}

describe('multiplayer server authoritative state', () => {
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
    const fixture = makeFixture()
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
    ])
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
    expect(messages(fixture.sent)).toEqual([])
    fixture.server.tick(2_000)
    expect(messages(fixture.sent)).toEqual([
      expect.objectContaining({
        _tag: 'PlayerVitalsDelta',
        revision: 6,
        player: 'alice',
        state: { health: 3, hunger: 2, experience: 7 },
      }),
    ])

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

  it('authoritatively updates time, containers, furnaces, and persistent state', () => {
    const fixture = makeFixture()
    fixture.sent.length = 0

    expect(fixture.receive({
      _tag: 'WorldTimeWeatherCommand',
      commandId: commandId('weather-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 4,
      action: { _tag: 'set-weather', weather: 'rain' },
    }).accepted).toBe(true)
    expect(fixture.receive({
      _tag: 'ContainerCommand',
      commandId: commandId('container-1'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
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
      expectedRevision: 6,
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
      expectedRevision: 7,
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
      _tag: 'ContainerDelta',
      revision: 6,
      state: { containerId: 'world-1:1,64,0', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] },
    }))
    expect(output).toContainEqual(expect.objectContaining({
      _tag: 'FurnaceDelta',
      revision: 8,
      state: expect.objectContaining({ fuel: { item: 'coal', count: 1 }, output: { item: 'iron-ingot', count: 1 } }),
    }))
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 8,
      timeWeather: { timeOfDay: 6_000, weather: 'rain' },
      inventories: [{
        player: 'alice',
        state: { slots: [{ item: 'stone', count: 3 }, { item: 'coal', count: 2 }, { item: 'iron-ingot', count: 1 }] },
      }],
      containers: [{ containerId: 'world-1:1,64,0', slots: [{ item: 'stone', count: 2 }, { item: 'apple', count: 2 }] }],
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
    if (drop?._tag !== 'EntitySpawnDelta') throw new Error('missing item drop')
    send({ _tag: 'EntityPickupCommand', commandId: commandId('pickup-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 6, entityId: drop.entity.entityId })
    send({ _tag: 'VehicleCommand', commandId: commandId('mount-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 7, entityId: entityId('boat-1'), action: 'mount' })
    send({ _tag: 'VehicleCommand', commandId: commandId('move-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 8, entityId: entityId('boat-1'), action: { _tag: 'move', at: { x: 3, y: 64, z: 1 } } })
    send({ _tag: 'VehicleCommand', commandId: commandId('dismount-1'), player: playerId('alice'), world: worldId('world-1'), expectedRevision: 9, entityId: entityId('boat-1'), action: 'dismount' })
    expect(messages(observer)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ entityId: 'zombie-1', health: 4 }) }),
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: 'zombie-1' }),
      expect.objectContaining({ _tag: 'EntityDespawnDelta', entityId: drop.entity.entityId }),
      expect.objectContaining({ _tag: 'EntityUpdateDelta', entity: expect.objectContaining({ entityId: 'boat-1', at: { x: 3, y: 64, z: 1 }, occupant: null }) }),
    ]))
    fixture.server.disconnect('socket-a')
    const reconnect: Array<WireText> = []
    fixture.server.connect('socket-a2', (wire) => reconnect.push(wire))
    fixture.server.receive('socket-a2', frame({ _tag: 'PlayerJoin', player: playerId('alice'), name: playerName('Alice'), at: { x: 3, y: 64, z: 1 } }))
    expect(messages(reconnect).find((message) => message._tag === 'AuthoritativeSnapshot')).toMatchObject({ _tag: 'AuthoritativeSnapshot', revision: 10, entities: [{ entityId: 'boat-1', at: { x: 3, y: 64, z: 1 }, occupant: null }] })
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
      action: { _tag: 'move', at: { x: 2, y: 64, z: 0 } },
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
      commandId: commandId('vehicle-teleport'),
      player: playerId('alice'),
      world: worldId('world-1'),
      expectedRevision: 5,
      entityId: entityId('boat-1'),
      action: { _tag: 'move', at: { x: 7, y: 64, z: 0 } },
    })).toEqual({ accepted: false, reason: 'invalid-command' })
    expect(fixture.persisted.at(-1)).toMatchObject({
      revision: 5,
      entities: [{ entityId: 'far-zombie', health: 20 }, { entityId: 'boat-1', occupant: 'alice' }],
    })
    expect(messages(fixture.sent)).toEqual(expect.arrayContaining([
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'out-of-range', revision: 4 }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'not-mounted', revision: 4 }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', reason: 'stale-revision', revision: 4, resyncRequired: true }),
      expect.objectContaining({ _tag: 'AuthoritativeCommandRejected', commandId: 'vehicle-teleport', reason: 'out-of-range', revision: 5 }),
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
      containers: [{ containerId: 'world-1:20,64,0', slots: [] }],
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
      containers: [{ containerId: 'world-1:1,64,0', slots: [] }],
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
        containers: [{ containerId: 'world-1:1,64,0', slots: [] }],
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
