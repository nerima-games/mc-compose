import {
  createHungerAuthority,
  decodeFrame,
  encodeFrame,
  type AuthoritativeCommand,
  type AuthoritativeCommandResult,
  type AuthoritativeDelta,
  type AuthoritativeEntityState,
  type AuthoritativeSnapshot,
  type BlockMutationRejected,
  type BlockPos,
  type CommandId,
  type CommandRejectionReason,
  type NetworkMessage,
  type Orientation,
  type PlayerId,
  type PlayerSnapshot,
  type WireText,
  type WorldId,
  type WorldSnapshot,
} from '@nerima-games/mx-multiplayer'
import type { HungerActor, HungerCommand, HungerEvent } from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'
import {
  SleepAuthority,
  decodeSleepWireMessage,
  type SleepWireMessage,
} from '../web/sleep-network'
import {
  damageRuntimeWither,
  restoreWitherRuntime,
  snapshotWitherRuntime,
  summonRuntimeWither,
  type WitherRuntimeSnapshot,
  type WitherRuntimeState,
} from '../web/wither-runtime'
import { decodeWitherWireMessage, type WitherWireMessage } from '../web/wither-network'

export type ClientId = string
export type SendFrame = (frame: WireText) => void

export interface MultiplayerServerOptions {
  readonly worldId: string
  readonly seed: number
  readonly allowedBlocks: ReadonlySet<string>
  readonly bounds?: Readonly<{
    minX: number
    maxX: number
    minY: number
    maxY: number
    minZ: number
    maxZ: number
  }>
  readonly generatedBlockAt?: (position: BlockPos) => string | null
  readonly initialState?: MultiplayerServerState
  readonly onStateChanged?: (state: MultiplayerServerState) => void
  readonly maxMoveDistance?: number
  readonly passableBlocks?: ReadonlySet<string>
  readonly sleepPercentage?: number
}

export interface MultiplayerServerState {
  readonly revision: number
  readonly blocks: ReadonlyArray<Readonly<{ at: BlockPos; block: string | null }>>
  readonly inventories: AuthoritativeSnapshot['inventories']
  readonly vitals: AuthoritativeSnapshot['vitals']
  readonly timeWeather: AuthoritativeSnapshot['timeWeather']
  readonly containers: AuthoritativeSnapshot['containers']
  readonly furnaces: AuthoritativeSnapshot['furnaces']
  readonly villagerTrades: AuthoritativeSnapshot['villagerTrades']
  readonly entities?: ReadonlyArray<AuthoritativeEntityState>
  readonly wither?: WitherRuntimeSnapshot
  readonly witherRevision?: number
}

export type ReceiveResult =
  | Readonly<{ accepted: true; message: NetworkMessage | SleepWireMessage | WitherWireMessage }>
  | Readonly<{ accepted: false; reason: 'unknown-client' | 'malformed-frame' | 'join-required' | 'duplicate-player' | 'identity-spoof' | 'wrong-world' | 'invalid-movement' | 'invalid-mutation' | 'invalid-command' }>

interface ConnectedClient {
  readonly send: SendFrame
  playerId: PlayerId | null
}

interface MutablePlayer {
  readonly player: PlayerId
  readonly name: PlayerSnapshot['name']
  readonly world: WorldId
  at: PlayerSnapshot['at']
  facing: Orientation
}

type InventoryState = AuthoritativeSnapshot['inventories'][number]['state']
type VitalsState = AuthoritativeSnapshot['vitals'][number]['state']
type TimeWeatherState = AuthoritativeSnapshot['timeWeather']
type ContainerState = AuthoritativeSnapshot['containers'][number]
type FurnaceState = AuthoritativeSnapshot['furnaces'][number]
type ItemStack = NonNullable<InventoryState['slots'][number]>

interface MutableInventoryState {
  readonly slots: Array<ItemStack | null>
  selectedSlot: number
}

interface MutableVitalsState {
  health: number
  hunger: number
  experience: number
}

interface MutableContainerState {
  readonly containerId: string
  readonly slots: Array<ItemStack | null>
}

interface MutableFurnaceState {
  readonly furnaceId: string
  input: ItemStack | null
  fuel: ItemStack | null
  output: ItemStack | null
  burnTicksRemaining: number
  cookTicks: number
}

type CommandDecision =
  | Readonly<{ accepted: false; reason: CommandRejectionReason }>
  | Readonly<{ accepted: true; deltas: (revision: number) => ReadonlyArray<AuthoritativeDelta> }>

const DEFAULT_BOUNDS = {
  minX: -30_000_000,
  maxX: 30_000_000,
  minY: -64,
  maxY: 319,
  minZ: -30_000_000,
  maxZ: 30_000_000,
} as const

const DEFAULT_FACING: Orientation = { yawRadians: 0, pitchRadians: 0 }
const DEFAULT_MAX_MOVE_DISTANCE = 8
const DEFAULT_INVENTORY_SLOTS = 36
const DEFAULT_VITALS: VitalsState = { health: 20, hunger: 20, experience: 0 }
const DEFAULT_TIME_WEATHER: TimeWeatherState = { timeOfDay: 6_000, weather: 'clear' }
const PLAYER_HALF_WIDTH = 0.3
const PLAYER_HEIGHT = 1.8
const COLLISION_EPSILON = 1e-9
const positionKey = ({ x, y, z }: BlockPos): string => `${String(x)},${String(y)},${String(z)}`

const cloneStack = (stack: ItemStack | null): ItemStack | null => stack === null ? null : { ...stack }
const cloneInventory = (state: InventoryState): MutableInventoryState => ({
  slots: state.slots.map(cloneStack),
  selectedSlot: state.selectedSlot,
})
const inventorySnapshot = (state: MutableInventoryState): InventoryState => ({
  slots: state.slots.map(cloneStack),
  selectedSlot: state.selectedSlot,
})
const vitalsSnapshot = (state: MutableVitalsState): VitalsState => ({ ...state })
const containerSnapshot = (state: MutableContainerState): ContainerState => ({
  containerId: state.containerId,
  slots: state.slots.map(cloneStack),
})
const furnaceSnapshot = (state: MutableFurnaceState): FurnaceState => ({
  ...state,
  input: cloneStack(state.input),
  fuel: cloneStack(state.fuel),
  output: cloneStack(state.output),
})

const isAuthoritativeCommand = (message: NetworkMessage): message is AuthoritativeCommand =>
  message._tag === 'PlayerInventoryCommand' ||
  message._tag === 'PlayerVitalsCommand' ||
  message._tag === 'WorldTimeWeatherCommand' ||
  message._tag === 'ContainerCommand' ||
  message._tag === 'FurnaceCommand' ||
  message._tag === 'VillagerTradeCommand' ||
  message._tag === 'EntityAttackCommand' ||
  message._tag === 'EntityPickupCommand' ||
  message._tag === 'VehicleCommand'

const moveStack = (
  sourceSlots: Array<ItemStack | null>,
  sourceIndex: number,
  destinationSlots: Array<ItemStack | null>,
  destinationIndex: number,
  count: number,
): CommandRejectionReason | null => {
  if (sourceSlots === destinationSlots && sourceIndex === destinationIndex) return 'invalid-command'
  if (sourceIndex >= sourceSlots.length || destinationIndex >= destinationSlots.length) return 'invalid-command'
  const source = sourceSlots[sourceIndex]
  if (source === null || source === undefined || source.count < count) return 'insufficient-items'
  const destination = destinationSlots[destinationIndex]
  if (destination !== null && destination !== undefined && destination.item !== source.item) return 'invalid-command'
  sourceSlots[sourceIndex] = source.count === count ? null : { ...source, count: source.count - count }
  destinationSlots[destinationIndex] = destination === null || destination === undefined
    ? { item: source.item, count }
    : { ...destination, count: destination.count + count }
  return null
}

export interface MultiplayerServerCore {
  readonly connect: (clientId: ClientId, send: SendFrame) => boolean
  readonly receive: (clientId: ClientId, frame: WireText) => ReceiveResult
  readonly disconnect: (clientId: ClientId) => void
  readonly snapshot: () => WorldSnapshot
  readonly tick: (elapsedMs: number) => void
  readonly spawnEntity: (entity: AuthoritativeEntityState) => boolean
}

export const makeMultiplayerServerCore = (options: MultiplayerServerOptions): MultiplayerServerCore => {
  const worldId = options.worldId as WorldId
  const bounds = options.bounds ?? DEFAULT_BOUNDS
  const clients = new Map<ClientId, ConnectedClient>()
  const players = new Map<PlayerId, MutablePlayer>()
  const playerClients = new Map<PlayerId, ClientId>()
  const blocks = new Map<string, Readonly<{ at: BlockPos; block: string | null }>>(
    (options.initialState?.blocks ?? []).map((mutation) => [positionKey(mutation.at), mutation]),
  )
  const entities = new Map<string, AuthoritativeEntityState>(
    (options.initialState?.entities ?? []).map((entity) => [entity.entityId, entity]),
  )
  const inventories = new Map<PlayerId, MutableInventoryState>(
    (options.initialState?.inventories ?? []).map(({ player, state }) => [player, cloneInventory(state)]),
  )
  const vitals = new Map<PlayerId, MutableVitalsState>(
    (options.initialState?.vitals ?? []).map(({ player, state }) => [player, { ...state }]),
  )
  let timeWeather: TimeWeatherState = { ...(options.initialState?.timeWeather ?? DEFAULT_TIME_WEATHER) }
  const containers = new Map<string, MutableContainerState>(
    (options.initialState?.containers ?? []).map((state) => [state.containerId, {
      containerId: state.containerId,
      slots: state.slots.map(cloneStack),
    }]),
  )
  const furnaces = new Map<string, MutableFurnaceState>(
    (options.initialState?.furnaces ?? []).map((state) => [state.furnaceId, {
      ...state,
      input: cloneStack(state.input),
      fuel: cloneStack(state.fuel),
      output: cloneStack(state.output),
    }]),
  )
  const villagerTrades = (options.initialState?.villagerTrades ?? []).map((state) => ({
    ...state,
    offers: state.offers.map((offer) => ({
      ...offer,
      input: offer.input.map((stack) => ({ ...stack })),
      output: { ...offer.output },
    })),
  }))
  const commandResults = new Map<CommandId, AuthoritativeCommandResult>()
  let revision = options.initialState?.revision ?? 0
  let witherRevision = options.initialState?.witherRevision ?? 0
  let witherState: WitherRuntimeState = restoreWitherRuntime(options.initialState?.wither)
  const hungerActors = new Map<PlayerId, HungerActor>()
  let hungerTickRemainderMs = 0
  const sleepAuthority = new SleepAuthority({
    world: worldId,
    revision: 0,
    actors: [],
    blocks: {},
    drops: [],
  }, {
    reach: Number.MAX_SAFE_INTEGER,
    sleepPercentage: options.sleepPercentage ?? 100,
    validateSleep: ({ actor, bed }) => {
      const at = players.get(actor.player)?.at
      const withinReach = at !== undefined
        && (at.x - bed.x) ** 2 + (at.y - bed.y) ** 2 + (at.z - bed.z) ** 2 <= 5 ** 2
      return {
        dimension: worldId,
        bedValid: withinReach && blockAt(bed) === 'bed',
        nightOrThunder: timeWeather.weather === 'thunder' || timeWeather.timeOfDay >= 12_542,
        safe: true,
      }
    },
  })

  const sendMessage = (client: ConnectedClient, message: NetworkMessage): void => {
    const encoded = encodeFrame(message)
    if (Either.isRight(encoded)) client.send(encoded.right)
  }

  const broadcast = (message: NetworkMessage, except?: ClientId): void => {
    for (const [clientId, client] of clients) {
      if (clientId !== except && client.playerId !== null) sendMessage(client, message)
    }
  }

  const sendSleep = (client: ConnectedClient, message: SleepWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const broadcastSleep = (message: SleepWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendSleep(client, message)
  }

  const sendWither = (client: ConnectedClient, message: WitherWireMessage): void => {
    client.send(JSON.stringify(message) as WireText)
  }

  const broadcastWither = (message: WitherWireMessage): void => {
    for (const client of clients.values()) if (client.playerId !== null) sendWither(client, message)
  }

  const witherSnapshot = (): WitherWireMessage => ({
    _tag: 'WitherSnapshot',
    revision: witherRevision,
    snapshot: snapshotWitherRuntime(witherState),
  })

  const snapshot = (): WorldSnapshot => ({
    _tag: 'WorldSnapshot',
    world: worldId,
    seed: options.seed,
    revision,
    players: [...players.values()].map((player) => ({ ...player })),
    blocks: [...blocks.values()].map((mutation) => ({ world: worldId, ...mutation })),
  })

  const authoritativeSnapshot = (): AuthoritativeSnapshot => ({
    _tag: 'AuthoritativeSnapshot',
    world: worldId,
    revision,
    inventories: [...inventories].map(([player, state]) => ({ player, state: inventorySnapshot(state) })),
    vitals: [...vitals].map(([player, state]) => ({ player, state: vitalsSnapshot(state) })),
    timeWeather: { ...timeWeather },
    containers: [...containers.values()].map(containerSnapshot),
    furnaces: [...furnaces.values()].map(furnaceSnapshot),
    villagerTrades,
    entities: [...entities.values()],
  })

  const isInBounds = ({ x, y, z }: BlockPos): boolean =>
    x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY &&
    z >= bounds.minZ && z <= bounds.maxZ

  const blockAt = (at: BlockPos): string | null => {
    const override = blocks.get(positionKey(at))
    return override === undefined ? (options.generatedBlockAt?.(at) ?? null) : override.block
  }

  const persistentState = (): MultiplayerServerState => ({
    revision,
    blocks: [...blocks.values()].map((mutation) => ({ ...mutation, at: { ...mutation.at } })),
    inventories: [...inventories].map(([player, state]) => ({ player, state: inventorySnapshot(state) })),
    vitals: [...vitals].map(([player, state]) => ({ player, state: vitalsSnapshot(state) })),
    timeWeather: { ...timeWeather },
    containers: [...containers.values()].map(containerSnapshot),
    furnaces: [...furnaces.values()].map(furnaceSnapshot),
    villagerTrades,
    entities: [...entities.values()],
  })

  const notifyStateChanged = (): void => options.onStateChanged?.(persistentState())

  const ensurePlayerState = (player: PlayerId): void => {
    if (!inventories.has(player)) {
      inventories.set(player, { slots: Array.from({ length: DEFAULT_INVENTORY_SLOTS }, () => null), selectedSlot: 0 })
    }
    if (!vitals.has(player)) vitals.set(player, { ...DEFAULT_VITALS })
    const playerVitals = vitals.get(player) as MutableVitalsState
    const inventory = inventories.get(player) as MutableInventoryState
    const food: Record<string, number> = {}
    for (const stack of inventory.slots) {
      if (stack !== null) food[stack.item] = (food[stack.item] ?? 0) + stack.count
    }
    const previous = hungerActors.get(player)
    hungerActors.set(player, {
      player,
      session: String(player),
      state: previous?.state ?? { food: playerVitals.hunger, saturation: 5, exhaustion: 0, health: playerVitals.health },
      food,
    })
  }

  const applyHungerEvents = (events: ReadonlyArray<HungerEvent>): ReadonlyArray<PlayerId> => {
    const changed = new Set<PlayerId>()
    for (const event of events) {
      if (event._tag !== 'HungerChanged') continue
      const playerVitals = vitals.get(event.player)
      const actor = hungerActors.get(event.player)
      if (playerVitals === undefined || actor === undefined) continue
      playerVitals.health = event.state.health
      playerVitals.hunger = event.state.food
      hungerActors.set(event.player, { ...actor, state: event.state })
      changed.add(event.player)
    }
    return [...changed]
  }

  const executeHungerCommand = (message: Extract<AuthoritativeCommand, { readonly _tag: 'PlayerVitalsCommand' }>): CommandDecision => {
    ensurePlayerState(message.player)
    const authority = createHungerAuthority({
      world: worldId,
      revision,
      difficulty: 'normal',
      actors: [...hungerActors.values()],
      tickRemainderMs: hungerTickRemainderMs,
    })
    const action: HungerCommand = message.action === 'respawn'
      ? { _tag: 'Respawn', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision }
      : message.action._tag === 'eat'
        ? { _tag: 'Eat', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision, item: message.action.item }
        : { _tag: 'Activity', player: message.player, session: String(message.player), commandId: message.commandId, expectedRevision: revision, activity: message.action.activity, amount: message.action.amount }
    const result = authority.execute(action)
    if (!result.accepted) {
      const reason: CommandRejectionReason = result.reason === 'insufficient-items' || result.reason === 'stale-revision'
        ? result.reason
        : result.reason === 'unauthorized-player' ? 'unauthorized-player' : 'invalid-command'
      return { accepted: false, reason }
    }
    hungerActors.clear()
    const nextSnapshot = authority.snapshot()
    hungerTickRemainderMs = nextSnapshot.tickRemainderMs
    for (const actor of nextSnapshot.actors) hungerActors.set(actor.player, actor)
    const changed = applyHungerEvents(result.events)
    if (message.action === 'respawn') {
      const playerVitals = vitals.get(message.player)
      if (playerVitals !== undefined) playerVitals.experience = 0
    }
    const consumed = result.events.find((event) => event._tag === 'FoodConsumed')
    if (consumed !== undefined) {
      const inventory = inventories.get(consumed.player)
      const slot = inventory?.slots.findIndex((stack) => stack?.item === consumed.item) ?? -1
      const stack = slot >= 0 ? inventory?.slots[slot] : undefined
      if (inventory !== undefined && stack != null) inventory.slots[slot] = stack.count === 1 ? null : { ...stack, count: stack.count - 1 }
    }
    return { accepted: true, deltas: (nextRevision) => [
      ...changed.map((player) => ({ _tag: 'PlayerVitalsDelta' as const, world: worldId, revision: nextRevision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) })),
      ...(consumed === undefined ? [] : [{ _tag: 'PlayerInventoryDelta' as const, world: worldId, revision: nextRevision, player: consumed.player, state: inventorySnapshot(inventories.get(consumed.player) as MutableInventoryState) }]),
    ] }
  }

  const decideCommand = (message: AuthoritativeCommand): CommandDecision => {
    const inventory = inventories.get(message.player)
    if (inventory === undefined) return { accepted: false, reason: 'resource-not-found' }

    switch (message._tag) {
      case 'EntityAttackCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'living') return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined || (actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) {
          return { accepted: false, reason: 'out-of-range' }
        }
        const health = entity.health - 4
        if (health > 0) {
          const updated = { ...entity, health }
          entities.set(entity.entityId, updated)
          return { accepted: true, deltas: (nextRevision) => [{ _tag: 'EntityUpdateDelta', world: worldId, revision: nextRevision, entity: updated }] }
        }
        entities.delete(entity.entityId)
        const drop: AuthoritativeEntityState = {
          _tag: 'item-drop',
          entityId: `${entity.entityId}:drop:${String(revision + 1)}` as AuthoritativeEntityState['entityId'],
          at: entity.at,
          stack: { item: entity.entityType, count: 1 },
        }
        entities.set(drop.entityId, drop)
        return { accepted: true, deltas: (nextRevision) => [
          { _tag: 'EntityDespawnDelta', world: worldId, revision: nextRevision, entityId: entity.entityId },
          { _tag: 'EntitySpawnDelta', world: worldId, revision: nextRevision, entity: drop },
        ] }
      }
      case 'EntityPickupCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'item-drop') return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined || (actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) {
          return { accepted: false, reason: 'out-of-range' }
        }
        const slot = inventory.slots.findIndex((stack) => stack === null || stack.item === entity.stack.item)
        if (slot < 0) return { accepted: false, reason: 'invalid-command' }
        const current = inventory.slots[slot]
        inventory.slots[slot] = current === null || current === undefined
          ? { ...entity.stack }
          : { ...current, count: current.count + entity.stack.count }
        entities.delete(entity.entityId)
        return { accepted: true, deltas: (nextRevision) => [
          { _tag: 'EntityDespawnDelta', world: worldId, revision: nextRevision, entityId: entity.entityId },
          { _tag: 'PlayerInventoryDelta', world: worldId, revision: nextRevision, player: message.player, state: inventorySnapshot(inventory) },
        ] }
      }
      case 'VehicleCommand': {
        const entity = entities.get(message.entityId)
        if (entity === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (entity._tag !== 'vehicle') return { accepted: false, reason: 'invalid-command' }
        const actor = players.get(message.player)
        if (actor === undefined) return { accepted: false, reason: 'resource-not-found' }
        let updated: AuthoritativeEntityState
        if (message.action === 'mount') {
          if ((actor.at.x - entity.at.x) ** 2 + (actor.at.y - entity.at.y) ** 2 + (actor.at.z - entity.at.z) ** 2 > 25) return { accepted: false, reason: 'out-of-range' }
          if (entity.occupant !== null) return { accepted: false, reason: 'vehicle-occupied' }
          updated = { ...entity, occupant: message.player }
        } else if (message.action === 'dismount') {
          if (entity.occupant !== message.player) return { accepted: false, reason: 'not-mounted' }
          updated = { ...entity, occupant: null }
        } else {
          if (entity.occupant !== message.player) return { accepted: false, reason: 'not-mounted' }
          if ((message.action.at.x - entity.at.x) ** 2 + (message.action.at.y - entity.at.y) ** 2 + (message.action.at.z - entity.at.z) ** 2 > 64) return { accepted: false, reason: 'out-of-range' }
          updated = { ...entity, at: message.action.at }
          actor.at = message.action.at
        }
        entities.set(entity.entityId, updated)
        return { accepted: true, deltas: (nextRevision) => [{ _tag: 'EntityUpdateDelta', world: worldId, revision: nextRevision, entity: updated }] }
      }
      case 'PlayerInventoryCommand': {
        if (message.action._tag === 'select-slot') {
          if (message.action.slot >= inventory.slots.length) return { accepted: false, reason: 'invalid-command' }
          inventory.selectedSlot = message.action.slot
        } else if (message.action._tag === 'drop-item') {
          const source = inventory.slots[message.action.source]
          if (source === undefined || source === null || source.count < message.action.count) {
            return { accepted: false, reason: 'insufficient-items' }
          }
          inventory.slots[message.action.source] = source.count === message.action.count
            ? null
            : { ...source, count: source.count - message.action.count }
        } else {
          const reason = moveStack(
            inventory.slots,
            message.action.source,
            inventory.slots,
            message.action.destination,
            message.action.count,
          )
          if (reason !== null) return { accepted: false, reason }
        }
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'PlayerInventoryDelta',
            world: worldId,
            revision: nextRevision,
            player: message.player,
            state: inventorySnapshot(inventory),
          }],
        }
      }
      case 'PlayerVitalsCommand': {
        return executeHungerCommand(message)
      }
      case 'WorldTimeWeatherCommand': {
        timeWeather = message.action._tag === 'set-time'
          ? { ...timeWeather, timeOfDay: message.action.timeOfDay }
          : { ...timeWeather, weather: message.action.weather }
        return {
          accepted: true,
          deltas: (nextRevision) => [{
            _tag: 'WorldTimeWeatherDelta',
            world: worldId,
            revision: nextRevision,
            state: { ...timeWeather },
          }],
        }
      }
      case 'ContainerCommand': {
        const container = containers.get(message.containerId)
        if (container === undefined) return { accepted: false, reason: 'resource-not-found' }
        if (message.action._tag === 'move-item') {
          const playerIsSource = message.action.source._tag === 'player-slot'
          const sourceSlots = playerIsSource ? inventory.slots : container.slots
          const destinationSlots = playerIsSource ? container.slots : inventory.slots
          const reason = moveStack(
            sourceSlots,
            message.action.source.slot,
            destinationSlots,
            message.action.destination.slot,
            message.action.count,
          )
          if (reason !== null) return { accepted: false, reason }
        }
        return {
          accepted: true,
          deltas: (nextRevision) => message.action._tag === 'move-item'
            ? [
                { _tag: 'ContainerDelta', world: worldId, revision: nextRevision, state: containerSnapshot(container) },
                {
                  _tag: 'PlayerInventoryDelta',
                  world: worldId,
                  revision: nextRevision,
                  player: message.player,
                  state: inventorySnapshot(inventory),
                },
              ]
            : [],
        }
      }
      case 'FurnaceCommand': {
        const furnace = furnaces.get(message.furnaceId)
        if (furnace === undefined) return { accepted: false, reason: 'resource-not-found' }
        const source = message.action.source
        const destination = message.action.destination
        const sourceIsPlayer = source._tag === 'player-slot'
        if (sourceIsPlayer && destination._tag !== 'furnace-slot') {
          return { accepted: false, reason: 'invalid-command' }
        }
        if (!sourceIsPlayer && destination._tag !== 'player-slot') {
          return { accepted: false, reason: 'invalid-command' }
        }
        const furnaceSlot: 'input' | 'fuel' | 'output' = sourceIsPlayer
          ? destination.slot as 'input' | 'fuel'
          : source.slot as 'input' | 'fuel' | 'output'
        const temporaryFurnaceSlot = [furnace[furnaceSlot]]
        const reason = sourceIsPlayer
          ? moveStack(inventory.slots, source.slot, temporaryFurnaceSlot, 0, message.action.count)
          : moveStack(temporaryFurnaceSlot, 0, inventory.slots, destination.slot as number, message.action.count)
        if (reason !== null) return { accepted: false, reason }
        furnace[furnaceSlot] = temporaryFurnaceSlot[0] ?? null
        return {
          accepted: true,
          deltas: (nextRevision) => [
            {
              _tag: 'FurnaceDelta',
              world: worldId,
              revision: nextRevision,
              state: furnaceSnapshot(furnace),
            },
            {
              _tag: 'PlayerInventoryDelta',
              world: worldId,
              revision: nextRevision,
              player: message.player,
              state: inventorySnapshot(inventory),
            },
          ],
        }
      }
      case 'VillagerTradeCommand':
        return { accepted: false, reason: 'invalid-command' }
    }
  }

  const rejectCommand = (
    client: ConnectedClient,
    message: AuthoritativeCommand,
    reason: CommandRejectionReason,
  ): ReceiveResult => {
    const result: AuthoritativeCommandResult = {
      _tag: 'AuthoritativeCommandRejected',
      commandId: message.commandId,
      world: worldId,
      revision,
      reason,
      resyncRequired: reason === 'stale-revision' || reason === 'snapshot-required',
    }
    commandResults.set(message.commandId, result)
    sendMessage(client, result)
    return { accepted: false, reason: reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-command' }
  }

  const handleCommand = (client: ConnectedClient, message: AuthoritativeCommand): ReceiveResult => {
    const cached = commandResults.get(message.commandId)
    if (cached !== undefined) {
      sendMessage(client, cached)
      return cached._tag === 'AuthoritativeCommandAccepted'
        ? { accepted: true, message }
        : { accepted: false, reason: 'invalid-command' }
    }
    if (message.player !== client.playerId || message.world !== worldId) {
      return rejectCommand(client, message, 'unauthorized-player')
    }
    if (message.expectedRevision !== revision) return rejectCommand(client, message, 'stale-revision')

    const decision = decideCommand(message)
    if (!decision.accepted) return rejectCommand(client, message, decision.reason)
    revision += 1
    const result: AuthoritativeCommandResult = {
      _tag: 'AuthoritativeCommandAccepted',
      commandId: message.commandId,
      world: worldId,
      revision,
    }
    commandResults.set(message.commandId, result)
    notifyStateChanged()
    sendMessage(client, result)
    for (const delta of decision.deltas(revision)) broadcast(delta)
    return { accepted: true, message }
  }

  const isValidMovement = (player: MutablePlayer, at: PlayerSnapshot['at']): boolean => {
    if (![at.x, at.y, at.z].every(Number.isFinite)) return false
    const dx = at.x - player.at.x
    const dy = at.y - player.at.y
    const dz = at.z - player.at.z
    const maximum = options.maxMoveDistance ?? DEFAULT_MAX_MOVE_DISTANCE
    if (dx * dx + dy * dy + dz * dz > maximum * maximum) return false

    const minX = Math.floor(at.x - PLAYER_HALF_WIDTH)
    const maxX = Math.floor(at.x + PLAYER_HALF_WIDTH - COLLISION_EPSILON)
    const minY = Math.floor(at.y)
    const maxY = Math.floor(at.y + PLAYER_HEIGHT - COLLISION_EPSILON)
    const minZ = Math.floor(at.z - PLAYER_HALF_WIDTH)
    const maxZ = Math.floor(at.z + PLAYER_HALF_WIDTH - COLLISION_EPSILON)
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          const position = { x, y, z }
          if (!isInBounds(position)) return false
          const block = blockAt(position)
          if (block !== null && !options.passableBlocks?.has(block)) return false
        }
      }
    }
    return true
  }

  const rejectMutation = (
    client: ConnectedClient,
    message: Extract<NetworkMessage, { _tag: 'BlockPlace' | 'BlockBreak' }>,
    reason: BlockMutationRejected['reason'],
  ): ReceiveResult => {
    sendMessage(client, {
      _tag: 'BlockMutationRejected',
      player: message.player,
      world: worldId,
      at: message.at,
      operation: message._tag === 'BlockPlace' ? 'place' : 'break',
      reason,
      revision,
    })
    return { accepted: false, reason: reason === 'unauthorized-player' ? 'identity-spoof' : 'invalid-mutation' }
  }

  const removePlayer = (clientId: ClientId, client: ConnectedClient): void => {
    const playerId = client.playerId
    if (playerId === null) return
    client.playerId = null
    players.delete(playerId)
    playerClients.delete(playerId)
    broadcast({ _tag: 'PlayerLeave', player: playerId }, clientId)
  }

  const connect = (clientId: ClientId, send: SendFrame): boolean => {
    if (clients.has(clientId)) return false
    clients.set(clientId, { send, playerId: null })
    return true
  }

  const receive = (clientId: ClientId, frame: WireText): ReceiveResult => {
    const client = clients.get(clientId)
    if (client === undefined) return { accepted: false, reason: 'unknown-client' }
    const witherMessage = decodeWitherWireMessage(frame)
    if (witherMessage?._tag === 'WitherCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      const command = witherMessage.command
      if (command.actor !== client.playerId) return { accepted: false, reason: 'identity-spoof' }
      if (command.expectedRevision !== witherRevision) {
        sendWither(client, { _tag: 'WitherCommandResult', requestId: command.requestId, accepted: false, revision: witherRevision, reason: 'stale-revision' })
        return { accepted: false, reason: 'invalid-command' }
      }
      if (command._tag === 'SummonWither') {
        if (command.dimension !== worldId) return { accepted: false, reason: 'wrong-world' }
        witherState = summonRuntimeWither(witherState, command.dimension, command.position)
      } else {
        if (command.amount <= 0 || !witherState.withers.some(({ id }) => id === command.id)) {
          sendWither(client, { _tag: 'WitherCommandResult', requestId: command.requestId, accepted: false, revision: witherRevision, reason: 'invalid-command' })
          return { accepted: false, reason: 'invalid-command' }
        }
        witherState = damageRuntimeWither(witherState, command.id, command.amount, command.kind).state
      }
      witherRevision += 1
      notifyStateChanged()
      sendWither(client, { _tag: 'WitherCommandResult', requestId: command.requestId, accepted: true, revision: witherRevision })
      broadcastWither(witherSnapshot())
      return { accepted: true, message: witherMessage }
    }
    const sleepMessage = decodeSleepWireMessage(frame)
    if (sleepMessage?._tag === 'SleepCommand') {
      if (client.playerId === null) return { accepted: false, reason: 'join-required' }
      if (sleepMessage.command.actor !== client.playerId) return { accepted: false, reason: 'identity-spoof' }
      const result = sleepAuthority.execute(sleepMessage.command)
      sendSleep(client, { _tag: 'SleepCommandResult', result })
      if (result.accepted) broadcastSleep({ _tag: 'SleepEvents', revision: result.revision, events: result.events })
      return result.accepted
        ? { accepted: true, message: sleepMessage }
        : { accepted: false, reason: 'invalid-command' }
    }
    const decoded = decodeFrame(frame)
    if (Either.isLeft(decoded)) return { accepted: false, reason: 'malformed-frame' }
    const message = decoded.right

    if (message._tag === 'PlayerJoin') {
      if (client.playerId !== null) {
        return { accepted: false, reason: 'identity-spoof' }
      }
      if (playerClients.has(message.player)) return { accepted: false, reason: 'duplicate-player' }
      client.playerId = message.player
      players.set(message.player, {
        player: message.player,
        name: message.name,
        world: worldId,
        at: message.at,
        facing: DEFAULT_FACING,
      })
      playerClients.set(message.player, clientId)
      const sleepSnapshot = sleepAuthority.addActor({
        player: message.player,
        session: String(message.player),
        position: message.at,
        gameMode: 'survival',
        inventory: [],
        health: 20,
        spawn: message.at,
        lastActionTick: 0,
      })
      ensurePlayerState(message.player)
      sendMessage(client, snapshot())
      sendMessage(client, authoritativeSnapshot())
      sendSleep(client, { _tag: 'SleepSnapshot', snapshot: sleepSnapshot })
      broadcast(message, clientId)
      sendWither(client, witherSnapshot())
      return { accepted: true, message }
    }

    if (message._tag === 'Ping') {
      sendMessage(client, { _tag: 'Pong', nonce: message.nonce })
      return { accepted: true, message }
    }

    if (client.playerId === null) return { accepted: false, reason: 'join-required' }

    if (isAuthoritativeCommand(message)) return handleCommand(client, message)

    if ('player' in message && message.player !== client.playerId) {
      if (message._tag === 'BlockPlace' || message._tag === 'BlockBreak') {
        return rejectMutation(client, message, 'unauthorized-player')
      }
      return { accepted: false, reason: 'identity-spoof' }
    }

    switch (message._tag) {
      case 'PlayerLeave':
        {
          const events = sleepAuthority.disconnect(message.player)
          if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
        }
        removePlayer(clientId, client)
        return { accepted: true, message }
      case 'PlayerMove': {
        if (message.world !== undefined && message.world !== worldId) return { accepted: false, reason: 'wrong-world' }
        const player = players.get(message.player)
        if (player === undefined) return { accepted: false, reason: 'join-required' }
        if (!isValidMovement(player, message.at)) {
          sendMessage(client, {
            _tag: 'PlayerMove',
            player: player.player,
            world: worldId,
            at: player.at,
            facing: player.facing,
          })
          return { accepted: false, reason: 'invalid-movement' }
        }
        player.at = message.at
        player.facing = message.facing
        broadcast({ ...message, world: worldId })
        return { accepted: true, message }
      }
      case 'Chat':
        broadcast(message)
        return { accepted: true, message }
      case 'BlockPlace': {
        if (message.world !== undefined && message.world !== worldId) return rejectMutation(client, message, 'unauthorized-player')
        if (!isInBounds(message.at)) return rejectMutation(client, message, 'out-of-bounds')
        if (message.block === 'air' || !options.allowedBlocks.has(message.block)) return rejectMutation(client, message, 'unknown-block')
        if (blockAt(message.at) !== null) return rejectMutation(client, message, 'occupied')
        blocks.set(positionKey(message.at), { at: message.at, block: message.block })
        revision += 1
        notifyStateChanged()
        broadcast({ ...message, world: worldId })
        return { accepted: true, message }
      }
      case 'BlockBreak': {
        if (message.world !== undefined && message.world !== worldId) return rejectMutation(client, message, 'unauthorized-player')
        if (!isInBounds(message.at)) return rejectMutation(client, message, 'out-of-bounds')
        if (blockAt(message.at) === null) return rejectMutation(client, message, 'missing-block')
        blocks.set(positionKey(message.at), { at: message.at, block: null })
        revision += 1
        notifyStateChanged()
        broadcast({ ...message, world: worldId })
        {
          const events = sleepAuthority.reconcile()
          if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
        }
        return { accepted: true, message }
      }
      case 'Pong':
        return { accepted: true, message }
      case 'AuthoritativeResyncRequest':
        if (message.world !== worldId) return { accepted: false, reason: 'wrong-world' }
        sendMessage(client, authoritativeSnapshot())
        return { accepted: true, message }
      case 'WorldInfo':
      case 'WorldSnapshot':
      case 'BlockMutationRejected':
      case 'AuthoritativeSnapshot':
      case 'PlayerInventoryDelta':
      case 'PlayerVitalsDelta':
      case 'WorldTimeWeatherDelta':
      case 'ContainerDelta':
      case 'FurnaceDelta':
      case 'VillagerTradeDelta':
      case 'EntitySpawnDelta':
      case 'EntityUpdateDelta':
      case 'EntityDespawnDelta':
      case 'AuthoritativeCommandAccepted':
      case 'AuthoritativeCommandRejected':
        return { accepted: false, reason: 'identity-spoof' }
    }
  }

  const disconnect = (clientId: ClientId): void => {
    const client = clients.get(clientId)
    if (client === undefined) return
    const playerId = client.playerId
    removePlayer(clientId, client)
    if (playerId !== null) {
      const events = sleepAuthority.disconnect(playerId)
      if (events.length > 0) broadcastSleep({ _tag: 'SleepEvents', revision: sleepAuthority.snapshot().revision, events })
    }
    clients.delete(clientId)
  }

  const tick = (elapsedMs: number): void => {
    if (hungerActors.size === 0) return
    const authority = createHungerAuthority({ world: worldId, revision, difficulty: 'normal', actors: [...hungerActors.values()], tickRemainderMs: hungerTickRemainderMs })
    const events = authority.tick(elapsedMs)
    hungerTickRemainderMs = authority.snapshot().tickRemainderMs
    if (events.length === 0) return
    hungerActors.clear()
    for (const actor of authority.snapshot().actors) hungerActors.set(actor.player, actor)
    const changed = applyHungerEvents(events)
    if (changed.length === 0) return
    revision += 1
    notifyStateChanged()
    for (const player of changed) broadcast({ _tag: 'PlayerVitalsDelta', world: worldId, revision, player, state: vitalsSnapshot(vitals.get(player) as MutableVitalsState) })
  }

  const spawnEntity = (entity: AuthoritativeEntityState): boolean => {
    if (entities.has(entity.entityId)) return false
    entities.set(entity.entityId, entity)
    revision += 1
    notifyStateChanged()
    broadcast({ _tag: 'EntitySpawnDelta', world: worldId, revision, entity })
    return true
  }

  return { connect, receive, disconnect, snapshot, tick, spawnEntity }
}
