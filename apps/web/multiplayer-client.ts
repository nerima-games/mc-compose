import { Effect, Queue } from 'effect'
import {
  blockIdOf,
  blockPosition,
  StackCount,
  type Position as Vec3,
} from '@nerima-games/mc-kernel'
import {
  durabilityForItem,
  equipmentItem,
  EQUIPMENT_SLOTS,
  itemStack,
  makeTimeService,
  makeVehicleService,
  makeWeatherService,
  type ItemStack,
  type Vehicle,
} from '@nerima-games/mc-sim'
import {
  CommandId,
  EntityId,
  makeMultiplayerHost,
  PlayerId,
  PlayerName,
  TransportPort,
  WorldId,
  type AuthoritativeEntityState,
  type MultiplayerHost,
  type NetworkMessage,
} from '@nerima-games/mx-multiplayer'
import {
  type GeneratedWorld,
  restoreBrewingStand,
  restoreStatusEffects,
  restoreVillagerTrades,
  snapshotVillagerTrades,
  type EnchantedItem,
  type GameplayFrameState,
  type MobBehaviour,
  type WeatherState,
} from '@nerima-games/mx-gameplay'
import { validateMultiplayerUrl } from './multiplayer-url'
import {
  initialSleepRuntimeState,
  enterSleep,
  sleepRatioFromPercentage,
} from './sleep-runtime'
import {
  applySleepCommandResult,
  applySleepEvents,
  sleepClientFromSnapshot,
  type SleepClientState,
} from '../multiplayer-shared/sleep-network'
import {
  type PlayerDamageCommand,
  type PlayerDamageCommandResult,
} from '../multiplayer-shared/player-damage-network'
import {
  type CraftingCommand,
  type CraftingCommandResult,
} from '../multiplayer-shared/crafting-network'
import {
  type BrewingCommand,
  type BrewingCommandResult,
} from '../multiplayer-shared/brewing-network'
import {
  type AnvilCommand,
  type AnvilCommandResult,
} from '../multiplayer-shared/anvil-network'
import {
  type EnchantingCommand,
  type EnchantingCommandResult,
} from '../multiplayer-shared/enchanting-network'
import {
  launchRuntimeEyeOfEnder,
  initialEyeOfEnderRuntimeState,
} from './eye-of-ender-runtime'
import {
  restoreWitherRuntime,
} from '../multiplayer-shared/wither-runtime'
import {
  type PersistedFurnaceState,
  type PersistedLeverState,
  type SessionState,
} from './session-persistence'

import {
  makeBrowserWebSocketTransport,
  type BrowserWebSocketTransport,
} from './multiplayer-websocket'

export type MultiplayerQuery = {
  readonly url: string
  readonly player: PlayerId
  readonly name: PlayerName
}

export type RemotePlayer = {
  readonly name: PlayerName
  readonly world: WorldId
  readonly at: { readonly x: number; readonly y: number; readonly z: number }
  readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
}

export type MultiplayerRuntime = {
  readonly query: MultiplayerQuery
  readonly host: MultiplayerHost
  readonly transport: BrowserWebSocketTransport
  readonly players: Map<PlayerId, RemotePlayer>
}

export type WithoutAuthority<T> = T extends unknown
  ? Omit<T, 'commandId' | 'player' | 'world' | 'expectedRevision'>
  : never

export const readMultiplayerQuery = (search: string): MultiplayerQuery | undefined => {
  const query = new URLSearchParams(search)
  const url = query.get('multiplayer')
  const player = query.get('player')
  const name = query.get('multiplayerName')
  if (url === null || player === null || name === null || player.length === 0 || name.length === 0) {
    return undefined
  }
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return undefined
  } catch {
    return undefined
  }
  return { url, player: PlayerId.make(player), name: PlayerName.make(name) }
}

export const multiplayerReconnectTokenKey = (
  url: string,
  worldId: string,
  player: PlayerId,
): string => `mc-compose:multiplayer-reconnect:${JSON.stringify([url, worldId, String(player)])}`

export const multiplayerRegistrationTokenKey = (
  url: string,
  worldId: string,
  player: string,
): string => `mc-compose:multiplayer-registration:${JSON.stringify([url, worldId, player])}`

export type MultiplayerCommandIds<CommandIdValue> = Readonly<{
  commandIdFor: (scope: string, sequence: number) => CommandIdValue
  requestIdFor: (scope: string, sequence: number) => string
}>

export const makeMultiplayerCommandIds = <CommandIdValue>(
  sessionId: string,
  makeCommandId: (value: string) => CommandIdValue,
): MultiplayerCommandIds<CommandIdValue> => ({
  commandIdFor: (scope: string, sequence: number) =>
    makeCommandId(`${scope}-${sessionId}-${String(sequence)}`),
  requestIdFor: (scope: string, sequence: number) => `${scope}-${sessionId}-${String(sequence)}`,
})

export const makeMultiplayerChatCommand = (
  multiplayer: { readonly query: { readonly player: PlayerId } } | undefined,
  handshakeComplete: boolean,
  input: string,
): Extract<NetworkMessage, { readonly _tag: 'Chat' }> | undefined => {
  const text = input.trim()
  if (multiplayer === undefined || !handshakeComplete || text.length === 0) return undefined
  return {
    _tag: 'Chat',
    player: multiplayer.query.player,
    text: text.slice(0, 256),
  }
}

type EffectValue<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never
type Dimension = SessionState['dimension']
type World = GeneratedWorld<MobBehaviour>
type TimeService = EffectValue<ReturnType<typeof makeTimeService>>
type WeatherService = EffectValue<ReturnType<typeof makeWeatherService>>
type VehicleService = EffectValue<ReturnType<typeof makeVehicleService>>
type EnderDragonSnapshot = EffectValue<GameplayFrameState['enderDragonEncounter']['snapshot']>
type ClientChunkContext = Readonly<{
  dimension: Dimension
  chunkStore: World['chunkStore']
}>

export type MultiplayerInventorySelection = Readonly<{
  source: number
  remaining: number
  mode: 'all' | 'split'
}>

export type QueuedPlayerDamage = Readonly<{
  readonly amount: number
  readonly minimumHealthPoints: number
}>

export type MultiplayerConnectionContext = {
  readonly sessionId: string
  readonly search: string
  readonly href: string
  readonly getSessionStorage: () => Pick<Storage, 'getItem' | 'removeItem'>
  readonly getLocalStorage: () => Pick<Storage, 'getItem' | 'setItem'>
  readonly failBoot: (message: string) => void
}

export type MultiplayerClientContext = {
  readonly multiplayer: MultiplayerRuntime | undefined
  readonly ui: {
    readonly canvas: HTMLCanvasElement
    readonly multiplayerStatus: HTMLOutputElement
    readonly multiplayerChat: HTMLElement
    readonly multiplayerChatLog: HTMLOListElement
    readonly multiplayerChatForm: HTMLFormElement
    readonly multiplayerChatInput: HTMLInputElement
  }
  readonly state: {
    inventoryOpen: boolean
    inventoryMode: 'player' | 'craftingTable' | 'furnace' | 'chest' | 'anvil' | 'enchanting'
    tradeOpen: boolean
    activeVillagerId: string | undefined
    brewingOpen: boolean
    brewingStatus: string
    tradeStatus: string
    enchantmentSeed: number
    anvilName: string
    anvilStatus: string
    enchantingStatus: string
    readonly customNames: Map<string, string>
    readonly enchantedItems: Map<string, EnchantedItem>
    eyeOfEnderRuntimeState: ReturnType<typeof initialEyeOfEnderRuntimeState>
    sleepRuntimeState: ReturnType<typeof initialSleepRuntimeState>
    witherRevision: number
    witherRuntimeState: ReturnType<typeof restoreWitherRuntime>
    authoritativeEnderDragonSnapshot: EnderDragonSnapshot
    enderDragonRevision: number
    redstoneDirty: boolean
    readonly leverStates: Map<string, PersistedLeverState>
    readonly poweredRails: Set<string>
    fishingResult: string
    networkFishingState: { readonly phase: 'idle' | 'waiting' | 'bite' | 'escaped'; readonly result: string }
    readonly furnaceStates: Map<string, PersistedFurnaceState>
    activeFurnaceKey: string | undefined
    activeChestId: string | undefined
    selectedHotbarIndex: number
    chestStatus: string
    furnaceStatus: string
    authoritativeLightning: Readonly<{ sequence: number; at: Vec3; expiresAtSecs: number }> | undefined
    readonly multiplayerEntities: Map<string, AuthoritativeEntityState>
    multiplayerInventorySelection: MultiplayerInventorySelection | null
    queuedPlayerDamages: QueuedPlayerDamage[]
    pendingCrafting: { readonly commandId: string; readonly acceptedRevision: number | null } | null
    pendingBrewingCommand: { readonly commandId: string } | null
    activeBrewingStandAt: { readonly x: number; readonly y: number; readonly z: number } | undefined
    closeChestOnFacilityIdle: boolean
    networkSleepState: SleepClientState
    nextSleepRequest: number
    appliedNightSkipRevision: number | null
    multiplayerRejection: string
    multiplayerHandshakeComplete: boolean
    multiplayerClosed: boolean
    lastPlayerMoveSentAt: number
    lastPlayerMoveSent: {
      readonly world: WorldId
      readonly at: { readonly x: number; readonly y: number; readonly z: number }
      readonly facing: { readonly yawRadians: number; readonly pitchRadians: number }
    } | undefined
  }
  readonly services: {
    readonly world: World
    readonly gameplayState: GameplayFrameState
    readonly playerApi: World['player']
    readonly time: TimeService
    readonly weather: WeatherService
    readonly currentChunkContext: () => ClientChunkContext
    readonly getOrCreateDimensionChunkContext: (dimension: Dimension) => ClientChunkContext
    readonly leverKeyOf: (lever: Pick<PersistedLeverState, 'dimension' | 'position'>) => string
    readonly vehicleById: (id: string) => Vehicle | undefined
    readonly vehicleService: VehicleService
    readonly applyAuthoritativeVehicle: (entity: Extract<AuthoritativeEntityState, { readonly _tag: 'vehicle' }>) => void
    readonly alignActiveDimension: (dimension: Dimension) => void
    readonly resetSimState: (reset: boolean) => void
    readonly presentWeather: (state: WeatherState) => void
    readonly queueEndAudio: (cue: 'eyeThrow', position: Vec3) => void
    readonly craftingStaleRetryLimit: number
  }
  readonly callbacks: {
    readonly getInventoryInteraction: () => {
      readonly state: () => {
        readonly grid: {
          readonly width: number
          readonly height: number
          readonly cells: ReadonlyArray<{ readonly item: ItemStack['item'] } | undefined>
        }
      }
      readonly confirmCraftOnce: () => Effect.Effect<unknown>
    }
    readonly renderPlayerUi: () => void
    readonly renderTradeUi: () => void
    readonly renderBrewingUi: () => void
    readonly setInventoryOpen: (open: boolean) => void
  }
}

type MultiplayerPosition = Readonly<{ x: number; y: number; z: number }>

export type MultiplayerClientApi = Readonly<{
  enqueueMultiplayerPlayerMove: (nowSecs: number) => void
  drainMultiplayerInbound: () => void
  sendVitalsCommand: (action: Extract<NetworkMessage, { readonly _tag: 'PlayerVitalsCommand' }>['action']) => void
  sendPortalUseCommand: (portal: MultiplayerPosition, tag: 'EndPortalUseCommand' | 'NetherPortalUseCommand') => boolean
  sendEndProgressCommand: (
    command: { readonly _tag: 'ThrowEyeOfEnderCommand' }
      | { readonly _tag: 'InsertEyeIntoEndPortalFrameCommand'; readonly frame: MultiplayerPosition },
  ) => boolean
  sendToggleLeverCommand: (lever: MultiplayerPosition) => boolean
  sendInventoryCommand: (action: Extract<NetworkMessage, { readonly _tag: 'PlayerInventoryCommand' }>['action']) => boolean
  sendInventorySelection: (slot: number) => boolean
  sendVillagerTradeCommand: (villagerId: string, offerId: string) => boolean
  sendEntityCommand: (
    command: WithoutAuthority<Extract<NetworkMessage, {
      readonly _tag: 'EntityAttackCommand' | 'EntityPickupCommand' | 'BowUseCommand' | 'IgniteTntCommand' | 'EnderPearlCommand' | 'BucketUseCommand' | 'VehicleUseCommand' | 'FishingCommand' | 'VehicleCommand'
    }>>,
  ) => void
  sendFacilityCommand: (
    command: WithoutAuthority<Extract<NetworkMessage, { readonly _tag: 'ContainerCommand' | 'FurnaceCommand' }>>,
  ) => boolean
  pumpPlayerDamage: () => void
  drainPlayerDamageInbound: () => void
  requestCrafting: () => void
  drainCraftingInbound: () => void
  requestBrewing: (action: BrewingCommand['action']) => boolean
  drainBrewingInbound: () => void
  requestAnvil: () => boolean
  drainAnvilInbound: () => void
  requestEnchanting: (offer: 0 | 1 | 2) => boolean
  drainEnchantingInbound: () => void
  requestIdFor: (scope: string, sequence: number) => string
}>

export type MultiplayerConnectionResult =
  | {
      readonly status: 'started'
      readonly multiplayer: MultiplayerRuntime | undefined
      readonly multiplayerInboundStage: MultiplayerHost['stages'][number] | undefined
      readonly multiplayerOutboundStage: MultiplayerHost['stages'][number] | undefined
      readonly requiredSleepRatio: number
    }
  | { readonly status: 'failed' }

export const connectMultiplayer = async (
  context: MultiplayerConnectionContext,
): Promise<MultiplayerConnectionResult> => {
  const multiplayerQuery = readMultiplayerQuery(context.search)
  const multiplayerUrlValidation = multiplayerQuery === undefined
    ? undefined
    : validateMultiplayerUrl(multiplayerQuery.url, context.href)
  if (multiplayerUrlValidation?.ok === false) {
    context.failBoot(multiplayerUrlValidation.message)
    return { status: 'failed' }
  }
  let registrationToken: string | undefined
  if (multiplayerQuery !== undefined && multiplayerUrlValidation?.ok === true) {
    const registrationTokenKey = multiplayerRegistrationTokenKey(
      multiplayerUrlValidation.url.href,
      context.sessionId,
      String(multiplayerQuery.player),
    )
    try {
      const sessionStorage = context.getSessionStorage()
      registrationToken = sessionStorage.getItem(registrationTokenKey) ?? undefined
      sessionStorage.removeItem(registrationTokenKey)
    } catch (error: unknown) {
      context.failBoot('Legacy registration token could not be read securely. Return to the title screen and try again.')
      console.error('[mc-compose] multiplayer registration token retrieval failed', error)
      return { status: 'failed' }
    }
  }
  const requiredSleepRatio = sleepRatioFromPercentage(
    new URLSearchParams(context.search).get('sleepPercentage'),
  )
  const multiplayer = multiplayerQuery === undefined
    ? undefined
    : await Effect.runPromise(
        Effect.gen(function* () {
          const reconnectTokenKey = multiplayerReconnectTokenKey(
            multiplayerQuery.url,
            context.sessionId,
            multiplayerQuery.player,
          )
          let reconnectToken: string | undefined
          const transport = yield* makeBrowserWebSocketTransport({
            url: multiplayerUrlValidation?.url.href ?? multiplayerQuery.url,
            reconnectAuth: {
              playerId: String(multiplayerQuery.player),
              loadToken: () => {
                if (reconnectToken !== undefined) return reconnectToken
                try {
                  reconnectToken = context.getLocalStorage().getItem(reconnectTokenKey) ?? undefined
                } catch {
                  // Fall back to the latest token retained for this page lifetime.
                }
                return reconnectToken
              },
              saveToken: (token) => {
                reconnectToken = token
                context.getLocalStorage().setItem(reconnectTokenKey, token)
              },
              loadRegistrationToken: () => registrationToken,
              clearRegistrationToken: () => {
                registrationToken = undefined
              },
            },
          })
          const host = yield* makeMultiplayerHost.pipe(
            Effect.provideService(TransportPort, transport),
          )
          yield* host.transitionConnection({ _tag: 'ConnectRequested' })
          return {
            query: multiplayerQuery,
            host,
            transport,
            players: new Map<PlayerId, RemotePlayer>(),
          } satisfies MultiplayerRuntime
        }),
      )
  return {
    status: 'started',
    multiplayer,
    multiplayerInboundStage: multiplayer?.host.stages.find(
      (stage) => stage.id === 'multiplayer:inbound',
    ),
    multiplayerOutboundStage: multiplayer?.host.stages.find(
      (stage) => stage.id === 'multiplayer:outbound',
    ),
    requiredSleepRatio,
  }
}


export const createMultiplayerClient = (clientContext: MultiplayerClientContext): MultiplayerClientApi => {
  // The server deduplicates commands across reconnects, so a fresh page must not reuse its counters.
  const multiplayerCommandSessionId = crypto.randomUUID()
  const { commandIdFor, requestIdFor } = makeMultiplayerCommandIds(multiplayerCommandSessionId, CommandId.make)

  let multiplayerRevision = 0
  let nextVitalsCommand = 0
  let nextEntityCommand = 0
  let nextFacilityCommand = 0
  let nextInventoryCommand = 0
  let nextPlayerDamageCommand = 0
  let nextCraftingCommand = 0
  let nextBrewingCommand = 0
  let nextAnvilCommand = 0
  let nextEnchantingCommand = 0
  let nextVillagerTradeCommand = 0
  let pendingVitalsCommand: CommandId | null = null
  let pendingInventoryCommand: {
    readonly commandId: CommandId
    readonly action: Extract<NetworkMessage, { readonly _tag: 'PlayerInventoryCommand' }>['action']
    acceptedRevision: number | null
  } | null = null
  type RetryableEntityCommand = WithoutAuthority<Extract<NetworkMessage, {
    readonly _tag: 'EntityAttackCommand' | 'EntityPickupCommand' | 'VehicleCommand'
  }>>
  let pendingEntityCommand: { readonly commandId: CommandId; readonly command: RetryableEntityCommand } | null = null
  let queuedEntityCommands: ReadonlyArray<RetryableEntityCommand> = []
  let pendingInventoryRetry: Extract<NetworkMessage, { readonly _tag: 'PlayerInventoryCommand' }>['action'] | null = null
  let pendingVillagerTradeCommand: CommandId | null = null
  let queuedHotbarSelection: number | null = null
  let pendingPlayerDamage: {
    readonly commandId: string
    readonly acceptedRevision: number | null
  } | null = null
  let playerDamageResyncPending = false
  let lastPlayerVitalsRevision = -1
  let lastCraftingInventoryRevision = -1
  let craftingStaleRetries = 0
  let pendingAnvilCommand: {
    readonly commandId: string
  } | null = null
  let pendingEnchantingCommand: {
    readonly commandId: string
  } | null = null
  let pendingFacilityCommand: {
    readonly commandId: CommandId
    readonly facility: 'container' | 'furnace'
    readonly facilityId: string
    readonly expectsDelta: boolean
    acceptedRevision: number | null
    facilityDeltaRevision: number | null
    inventoryDeltaRevision: number | null
  } | null = null
  // Set when a chest close was requested while a facility command was
  // already in flight (`setInventoryOpen`'s guard below) — the close never
  // got sent, so it must be retried once that command clears rather than
  // silently dropped. See `clearPendingFacilityCommand`.
  let nextPortalCommand = 1
  let pendingPortalCommand: CommandId | null = null
  let nextLeverCommand = 1
  let pendingLeverCommand: CommandId | null = null

  const enqueueMultiplayerPlayerMove = (nowSecs: number): void => {
    if (
      clientContext.multiplayer === undefined
      || !clientContext.state.multiplayerHandshakeComplete
      || nowSecs - clientContext.state.lastPlayerMoveSentAt < 0.1
    ) return
    const pose = Effect.runSync(clientContext.services.playerApi.pose)
    const worldId = WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))
    const facing = { yawRadians: pose.yawRadians, pitchRadians: pose.pitchRadians }
    const changed = clientContext.state.lastPlayerMoveSent === undefined
      || clientContext.state.lastPlayerMoveSent.world !== worldId
      || clientContext.state.lastPlayerMoveSent.at.x !== pose.feetPosition.x
      || clientContext.state.lastPlayerMoveSent.at.y !== pose.feetPosition.y
      || clientContext.state.lastPlayerMoveSent.at.z !== pose.feetPosition.z
      || clientContext.state.lastPlayerMoveSent.facing.yawRadians !== facing.yawRadians
      || clientContext.state.lastPlayerMoveSent.facing.pitchRadians !== facing.pitchRadians
    if (!changed && nowSecs - clientContext.state.lastPlayerMoveSentAt < 1) return
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'PlayerMove',
      player: clientContext.multiplayer.query.player,
      world: worldId,
      at: pose.feetPosition,
      facing,
    }))
    clientContext.state.lastPlayerMoveSent = { world: worldId, at: pose.feetPosition, facing }
    clientContext.state.lastPlayerMoveSentAt = nowSecs
  }

  const drainMultiplayerInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.sleepInbound))) {
      if (message._tag === 'SleepSnapshot') clientContext.state.networkSleepState = sleepClientFromSnapshot(message.snapshot)
      else if (message._tag === 'SleepCommandResult') clientContext.state.networkSleepState = applySleepCommandResult(clientContext.state.networkSleepState, message.result)
      else if (message._tag === 'SleepEvents') clientContext.state.networkSleepState = applySleepEvents(clientContext.state.networkSleepState, message.revision, message.events)
      clientContext.state.sleepRuntimeState = initialSleepRuntimeState()
      for (const [player, location] of clientContext.state.networkSleepState.sleepers) {
        clientContext.state.sleepRuntimeState = enterSleep(clientContext.state.sleepRuntimeState, String(player), {
          dimension: 'overworld',
          position: location.bed,
          bedPosition: location.bed,
        })
      }
    }
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.witherInbound))) {
      if (message._tag === 'WitherSnapshot') {
        clientContext.state.witherRevision = message.revision
        clientContext.state.witherRuntimeState = restoreWitherRuntime(message.snapshot)
      }
    }
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.enderDragonInbound))) {
      if (message._tag === 'EnderDragonSnapshot' && message.revision >= clientContext.state.enderDragonRevision) {
        clientContext.state.enderDragonRevision = message.revision
        clientContext.state.authoritativeEnderDragonSnapshot = message.snapshot
      }
    }
    for (const message of Effect.runSync(clientContext.multiplayer.host.drainInbound)) {
      applyNetworkMessage(message)
    }
  }
  clientContext.ui.multiplayerStatus.hidden = clientContext.multiplayer === undefined
  clientContext.ui.multiplayerStatus.textContent = clientContext.multiplayer === undefined ? '' : 'Connecting to multiplayer server...'
  clientContext.ui.multiplayerChat.hidden = clientContext.multiplayer === undefined
  clientContext.ui.canvas.setAttribute('data-multiplayer-connection', clientContext.multiplayer === undefined ? 'disabled' : 'connecting')
  clientContext.ui.canvas.setAttribute('data-multiplayer-player-count', '0')
  clientContext.ui.canvas.setAttribute('data-multiplayer-revision', '0')
  clientContext.ui.canvas.setAttribute('data-multiplayer-rejection', '')

  const dimensionFromWorld = (worldId: WorldId): Dimension | undefined =>
    worldId === 'overworld' || worldId === 'nether' || worldId === 'end'
      ? (worldId as Dimension)
      : undefined
  const applyNetworkBlock = (
    worldId: WorldId,
    at: { readonly x: number; readonly y: number; readonly z: number },
    block: string | null,
  ): void => {
    const dimension = dimensionFromWorld(worldId)
    if (dimension === undefined) return
    const context = clientContext.services.getOrCreateDimensionChunkContext(dimension)
    Effect.runSync(context.chunkStore.setBlock(blockPosition(at.x, at.y, at.z), block === null ? blockIdOf('air') : blockIdOf(block as Parameters<typeof blockIdOf>[0])))
    if (dimension === clientContext.services.currentChunkContext().dimension) clientContext.state.redstoneDirty = true
  }

  const sendVitalsCommand = (action: Extract<NetworkMessage, { readonly _tag: 'PlayerVitalsCommand' }>['action']): void => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingVitalsCommand !== null) return
    nextVitalsCommand += 1
    const commandId = commandIdFor('vitals', nextVitalsCommand)
    pendingVitalsCommand = commandId
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'PlayerVitalsCommand',
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
      action,
    }))
  }

  const sendPortalUseCommand = (
    portal: { readonly x: number; readonly y: number; readonly z: number },
    tag: 'EndPortalUseCommand' | 'NetherPortalUseCommand',
  ): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingPortalCommand !== null) return false
    nextPortalCommand += 1
    const commandId = commandIdFor(`${tag === 'EndPortalUseCommand' ? 'end' : 'nether'}-portal`, nextPortalCommand)
    pendingPortalCommand = commandId
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: tag,
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
      portal,
    }))
    return true
  }

  const sendEndProgressCommand = (
    command: { readonly _tag: 'ThrowEyeOfEnderCommand' }
      | { readonly _tag: 'InsertEyeIntoEndPortalFrameCommand'; readonly frame: { readonly x: number; readonly y: number; readonly z: number } },
  ): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingPortalCommand !== null) return false
    nextPortalCommand += 1
    const commandId = commandIdFor('end-eye', nextPortalCommand)
    pendingPortalCommand = commandId
    const header = {
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
    }
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound(
      command._tag === 'ThrowEyeOfEnderCommand'
        ? { _tag: command._tag, ...header }
        : { _tag: command._tag, ...header, frame: command.frame },
    ))
    return true
  }

  const sendToggleLeverCommand = (lever: { readonly x: number; readonly y: number; readonly z: number }): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingLeverCommand !== null) return false
    nextLeverCommand += 1
    const commandId = commandIdFor('lever', nextLeverCommand)
    pendingLeverCommand = commandId
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'ToggleLeverCommand',
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
      lever,
    }))
    return true
  }

  const sendInventoryCommand = (
    action: Extract<NetworkMessage, { readonly _tag: 'PlayerInventoryCommand' }>['action'],
  ): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingInventoryCommand !== null) return false
    nextInventoryCommand += 1
    const commandId = commandIdFor('inventory', nextInventoryCommand)
    pendingInventoryCommand = { commandId, action, acceptedRevision: null }
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'PlayerInventoryCommand',
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
      action,
    }))
    return true
  }

  const sendInventorySelection = (slot: number): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete) return false
    if (pendingInventoryCommand !== null) {
      queuedHotbarSelection = slot
      return true
    }
    return sendInventoryCommand({ _tag: 'select-slot', slot })
  }

  const sendVillagerTradeCommand = (villagerId: string, offerId: string): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingVillagerTradeCommand !== null) return false
    nextVillagerTradeCommand += 1
    const commandId = commandIdFor('villager-trade', nextVillagerTradeCommand)
    pendingVillagerTradeCommand = commandId
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'VillagerTradeCommand',
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
      villagerId,
      offerId,
      action: 'execute-trade',
    }))
    return true
  }

  const flushQueuedHotbarSelection = (): void => {
    if (pendingInventoryCommand !== null || queuedHotbarSelection === null) return
    const slot = queuedHotbarSelection
    queuedHotbarSelection = null
    sendInventorySelection(slot)
  }

  const replayPendingInventoryCommand = (): void => {
    if (pendingInventoryRetry === null || pendingInventoryCommand !== null) return
    const action = pendingInventoryRetry
    pendingInventoryRetry = null
    sendInventoryCommand(action)
  }

  const sendEntityCommand = (
    command: WithoutAuthority<Extract<NetworkMessage, { readonly _tag: 'EntityAttackCommand' | 'EntityPickupCommand' | 'BowUseCommand' | 'IgniteTntCommand' | 'EnderPearlCommand' | 'BucketUseCommand' | 'VehicleUseCommand' | 'FishingCommand' | 'VehicleCommand' }>>,
  ): void => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete) return
    if (command._tag === 'EntityAttackCommand' || command._tag === 'EntityPickupCommand' || command._tag === 'VehicleCommand') {
      const pickupIsPendingOrQueued = command._tag === 'EntityPickupCommand'
        && (
          (pendingEntityCommand?.command._tag === 'EntityPickupCommand'
            && pendingEntityCommand.command.entityId === command.entityId)
          || queuedEntityCommands.some((queued) =>
            queued._tag === 'EntityPickupCommand' && queued.entityId === command.entityId)
        )
      if (pickupIsPendingOrQueued) return
      if (pendingEntityCommand !== null) {
        queuedEntityCommands = [...queuedEntityCommands, command]
        return
      }
      nextEntityCommand += 1
      const commandId = commandIdFor('entity', nextEntityCommand)
      pendingEntityCommand = { commandId, command }
      Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
        ...command,
        commandId,
        player: clientContext.multiplayer.query.player,
        world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
        expectedRevision: multiplayerRevision,
      } as NetworkMessage))
      return
    }
    nextEntityCommand += 1
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      ...command,
      commandId: commandIdFor('entity', nextEntityCommand),
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
    } as NetworkMessage))
  }

  const pumpEntityCommands = (): void => {
    if (pendingEntityCommand !== null) return
    const [next, ...remaining] = queuedEntityCommands
    if (next === undefined) return
    queuedEntityCommands = remaining
    sendEntityCommand(next)
  }

  const resumeCommandsAfterResync = (): void => {
    replayPendingInventoryCommand()
    flushQueuedHotbarSelection()
    pumpEntityCommands()
  }

  const sendFacilityCommand = (
    command: WithoutAuthority<Extract<NetworkMessage, { readonly _tag: 'ContainerCommand' | 'FurnaceCommand' }>>,
  ): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingFacilityCommand !== null) return false
    nextFacilityCommand += 1
    const commandId = commandIdFor('facility', nextFacilityCommand)
    pendingFacilityCommand = {
      commandId,
      facility: command._tag === 'ContainerCommand' ? 'container' : 'furnace',
      facilityId: command._tag === 'ContainerCommand' ? command.containerId : command.furnaceId,
      expectsDelta: command.action._tag !== 'open' && command.action._tag !== 'close',
      acceptedRevision: null,
      facilityDeltaRevision: null,
      inventoryDeltaRevision: null,
    }
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      ...command,
      commandId,
      player: clientContext.multiplayer.query.player,
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      expectedRevision: multiplayerRevision,
    } as NetworkMessage))
    return true
  }

  // Every site that clears `pendingFacilityCommand` must go through here,
  // so a close that was blocked by an in-flight command (the guard in
  // `setInventoryOpen`) gets retried the moment that command resolves,
  // instead of leaving the dialog open until the player notices and
  // presses again. `setInventoryOpen(false)` is itself a safe no-op if
  // the inventory already closed some other way in the meantime.
  const clearPendingFacilityCommand = (): void => {
    pendingFacilityCommand = null
    if (clientContext.state.closeChestOnFacilityIdle) {
      clientContext.state.closeChestOnFacilityIdle = false
      clientContext.callbacks.setInventoryOpen(false)
    }
  }

  const pumpPlayerDamage = (): void => {
    if (
      clientContext.multiplayer === undefined
      || !clientContext.state.multiplayerHandshakeComplete
      || playerDamageResyncPending
      || pendingPlayerDamage !== null
    ) return
    const next = clientContext.state.queuedPlayerDamages[0]
    if (next === undefined) return
    clientContext.state.queuedPlayerDamages = clientContext.state.queuedPlayerDamages.slice(1)
    nextPlayerDamageCommand += 1
    const commandId = requestIdFor('damage', nextPlayerDamageCommand)
    pendingPlayerDamage = { commandId, acceptedRevision: null }
    const command = {
      _tag: 'PlayerDamageCommand' as const,
      commandId,
      player: String(clientContext.multiplayer.query.player),
      world: String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))),
      expectedRevision: multiplayerRevision,
      amount: next.amount,
      minimumHealthPoints: next.minimumHealthPoints,
    } as PlayerDamageCommand & Readonly<{ minimumHealthPoints: number }>
    Effect.runSync(clientContext.multiplayer.transport.sendPlayerDamage(command))
  }

  const settlePlayerDamageAfterVitals = (revision: number): void => {
    lastPlayerVitalsRevision = Math.max(lastPlayerVitalsRevision, revision)
    const pending = pendingPlayerDamage
    if (
      pending !== null
      && pending.acceptedRevision !== null
      && revision >= pending.acceptedRevision
    ) {
      pendingPlayerDamage = null
      pumpPlayerDamage()
    }
  }

  const applyPlayerDamageResult = (message: PlayerDamageCommandResult): void => {
    if (clientContext.multiplayer === undefined || pendingPlayerDamage?.commandId !== message.commandId) return
    multiplayerRevision = Math.max(multiplayerRevision, message.revision)
    if (message.accepted) {
      pendingPlayerDamage = { ...pendingPlayerDamage, acceptedRevision: message.revision }
      if (lastPlayerVitalsRevision >= message.revision) {
        pendingPlayerDamage = null
        pumpPlayerDamage()
      }
      return
    }
    pendingPlayerDamage = null
    playerDamageResyncPending = true
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'AuthoritativeResyncRequest',
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      lastKnownRevision: multiplayerRevision,
    }))
  }

  const drainPlayerDamageInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.playerDamageInbound))) {
      if (message._tag === 'PlayerDamageCommandResult') applyPlayerDamageResult(message)
    }
  }

  const requestCrafting = (): void => {
    if (
      clientContext.multiplayer === undefined
      || !clientContext.state.multiplayerHandshakeComplete
      || clientContext.state.pendingCrafting !== null
    ) return
    const grid = clientContext.callbacks.getInventoryInteraction().state().grid
    const dimensions = grid.width === 2 && grid.height === 2
      ? { width: 2 as const, height: 2 as const }
      : grid.width === 3 && grid.height === 3
        ? { width: 3 as const, height: 3 as const }
        : undefined
    if (dimensions === undefined) return
    nextCraftingCommand += 1
    const commandId = requestIdFor('craft', nextCraftingCommand)
    clientContext.state.pendingCrafting = { commandId, acceptedRevision: null }
    const command: CraftingCommand = {
      _tag: 'CraftingCommand',
      commandId,
      player: String(clientContext.multiplayer.query.player),
      world: String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))),
      expectedRevision: multiplayerRevision,
      grid: {
        ...dimensions,
        cells: grid.cells.map((cell) => cell?.item ?? null),
      },
    }
    Effect.runSync(clientContext.multiplayer.transport.sendCrafting(command))
  }

  const settleCraftingAfterInventory = (revision: number): void => {
    lastCraftingInventoryRevision = Math.max(lastCraftingInventoryRevision, revision)
    const pending = clientContext.state.pendingCrafting
    if (
      pending !== null
      && pending.acceptedRevision !== null
      && revision >= pending.acceptedRevision
    ) {
      clientContext.state.pendingCrafting = null
      Effect.runSync(clientContext.callbacks.getInventoryInteraction().confirmCraftOnce())
    }
  }

  const applyCraftingResult = (message: CraftingCommandResult): void => {
    const pending = clientContext.state.pendingCrafting
    if (clientContext.multiplayer === undefined || pending?.commandId !== message.commandId) return
    multiplayerRevision = Math.max(multiplayerRevision, message.revision)
    if (!message.accepted) {
      clientContext.state.pendingCrafting = null
      Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
        _tag: 'AuthoritativeResyncRequest',
        world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
        lastKnownRevision: multiplayerRevision,
      }))
      // The server compares revisions for strict equality and advances its own
      // on any world activity, so a perfectly valid craft loses this race
      // whenever anything at all happens between reading the revision and the
      // server handling the command — another player, an entity tick, the
      // clock. The rejection carries the server's current revision, adopted
      // just above, so re-issuing sends a fresh one. Bounded, because a craft
      // rejected for any other reason must not spin.
      if (message.reason === 'stale-revision' && craftingStaleRetries < clientContext.services.craftingStaleRetryLimit) {
        craftingStaleRetries += 1
        requestCrafting()
        return
      }
      craftingStaleRetries = 0
      document.body.setAttribute('data-crafting-rejection', message.reason ?? 'unknown')
      return
    }
    craftingStaleRetries = 0
    document.body.removeAttribute('data-crafting-rejection')
    clientContext.state.pendingCrafting = { ...pending, acceptedRevision: message.revision }
    if (lastCraftingInventoryRevision >= message.revision) {
      clientContext.state.pendingCrafting = null
      Effect.runSync(clientContext.callbacks.getInventoryInteraction().confirmCraftOnce())
    }
  }

  const drainCraftingInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.craftingInbound))) {
      if (message._tag === 'CraftingCommandResult') applyCraftingResult(message)
    }
  }

  const requestBrewing = (action: BrewingCommand['action']): boolean => {
    if (
      clientContext.multiplayer === undefined
      || !clientContext.state.multiplayerHandshakeComplete
      || clientContext.state.pendingBrewingCommand !== null
      || clientContext.state.activeBrewingStandAt === undefined
    ) return false
    nextBrewingCommand += 1
    const commandId = requestIdFor('brewing', nextBrewingCommand)
    clientContext.state.pendingBrewingCommand = { commandId }
    const command: BrewingCommand = {
      _tag: 'BrewingCommand',
      commandId,
      player: String(clientContext.multiplayer.query.player),
      world: String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))),
      expectedRevision: multiplayerRevision,
      at: clientContext.state.activeBrewingStandAt,
      action,
    }
    Effect.runSync(clientContext.multiplayer.transport.sendBrewing(command))
    return true
  }

  const resyncBrewing = (): void => {
    if (clientContext.multiplayer === undefined) return
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'AuthoritativeResyncRequest',
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      lastKnownRevision: multiplayerRevision,
    }))
  }

  const applyBrewingResult = (message: BrewingCommandResult): void => {
    if (clientContext.multiplayer === undefined || clientContext.state.pendingBrewingCommand?.commandId !== message.commandId) return
    multiplayerRevision = Math.max(multiplayerRevision, message.revision)
    clientContext.state.pendingBrewingCommand = null
    if (message.accepted) return
    clientContext.state.brewingStatus = `Cannot brew: ${message.reason ?? 'rejected'}`
    resyncBrewing()
    clientContext.callbacks.renderBrewingUi()
  }

  const sameBrewingPosition = (
    left: { readonly x: number; readonly y: number; readonly z: number },
    right: { readonly x: number; readonly y: number; readonly z: number },
  ): boolean => left.x === right.x && left.y === right.y && left.z === right.z

  const drainBrewingInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    const currentWorld = String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)))
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.brewingInbound))) {
      if (message._tag === 'BrewingCommandResult') {
        applyBrewingResult(message)
        continue
      }
      if (message._tag !== 'BrewingStandDelta' && message._tag !== 'PlayerStatusEffectsDelta') continue
      if (message.world !== currentWorld || message.revision < multiplayerRevision) continue
      multiplayerRevision = Math.max(multiplayerRevision, message.revision)
      if (message._tag === 'BrewingStandDelta') {
        if (clientContext.state.activeBrewingStandAt !== undefined && sameBrewingPosition(clientContext.state.activeBrewingStandAt, message.at)) {
          Effect.runSync(restoreBrewingStand(clientContext.services.gameplayState, message.state))
          if (clientContext.state.brewingOpen) clientContext.callbacks.renderBrewingUi()
        }
        continue
      }
      if (message.player === String(clientContext.multiplayer.query.player)) {
        Effect.runSync(restoreStatusEffects(clientContext.services.gameplayState, message.state))
      }
    }
  }

  const requestAnvil = (): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingAnvilCommand !== null) return false
    nextAnvilCommand += 1
    const commandId = requestIdFor('anvil', nextAnvilCommand)
    pendingAnvilCommand = { commandId }
    const command: AnvilCommand = {
      _tag: 'AnvilCommand',
      commandId,
      player: String(clientContext.multiplayer.query.player),
      world: String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))),
      expectedRevision: multiplayerRevision,
      slot: clientContext.state.selectedHotbarIndex,
      name: clientContext.state.anvilName.trim(),
    }
    Effect.runSync(clientContext.multiplayer.transport.sendAnvil(command))
    return true
  }

  const requestEnchanting = (offer: 0 | 1 | 2): boolean => {
    if (clientContext.multiplayer === undefined || !clientContext.state.multiplayerHandshakeComplete || pendingEnchantingCommand !== null) return false
    nextEnchantingCommand += 1
    const commandId = requestIdFor('enchanting', nextEnchantingCommand)
    pendingEnchantingCommand = { commandId }
    const command: EnchantingCommand = {
      _tag: 'EnchantingCommand',
      commandId,
      player: String(clientContext.multiplayer.query.player),
      world: String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))),
      expectedRevision: multiplayerRevision,
      slot: clientContext.state.selectedHotbarIndex,
      offer,
    }
    Effect.runSync(clientContext.multiplayer.transport.sendEnchanting(command))
    return true
  }

  const resyncAnvil = (): void => {
    if (clientContext.multiplayer === undefined) return
    Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({
      _tag: 'AuthoritativeResyncRequest',
      world: WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)),
      lastKnownRevision: multiplayerRevision,
    }))
  }

  const applyAnvilResult = (message: AnvilCommandResult): void => {
    if (clientContext.multiplayer === undefined || pendingAnvilCommand?.commandId !== message.commandId) return
    multiplayerRevision = Math.max(multiplayerRevision, message.revision)
    pendingAnvilCommand = null
    if (message.accepted) return
    clientContext.state.anvilStatus = `Cannot use anvil: ${message.reason}`
    resyncAnvil()
    clientContext.callbacks.renderPlayerUi()
  }

  const drainAnvilInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    const currentWorld = String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)))
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.anvilInbound))) {
      if (message._tag === 'AnvilCommandResult') {
        applyAnvilResult(message)
        continue
      }
      if (message._tag !== 'PlayerAnvilNamesDelta') continue
      if (
        message.world !== currentWorld
        || message.revision < multiplayerRevision
        || message.player !== String(clientContext.multiplayer.query.player)
      ) continue
      multiplayerRevision = Math.max(multiplayerRevision, message.revision)
      for (const key of [...clientContext.state.customNames.keys()]) if (/^\d+$/u.test(key)) clientContext.state.customNames.delete(key)
      for (const { slot, name } of message.names) clientContext.state.customNames.set(String(slot), name)
      clientContext.callbacks.renderPlayerUi()
    }
  }

  const applyEnchantingResult = (message: EnchantingCommandResult): void => {
    if (clientContext.multiplayer === undefined || pendingEnchantingCommand?.commandId !== message.commandId) return
    multiplayerRevision = Math.max(multiplayerRevision, message.revision)
    pendingEnchantingCommand = null
    if (message.accepted) return
    clientContext.state.enchantingStatus = `Cannot enchant: ${message.reason}`
    resyncAnvil()
    clientContext.callbacks.renderPlayerUi()
  }

  const drainEnchantingInbound = (): void => {
    if (clientContext.multiplayer === undefined) return
    const currentWorld = String(WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension)))
    for (const message of Effect.runSync(Queue.takeAll(clientContext.multiplayer.transport.enchantingInbound))) {
      if (message._tag === 'EnchantingCommandResult') {
        applyEnchantingResult(message)
        continue
      }
      if (message._tag !== 'PlayerEnchantmentsDelta') continue
      if (
        message.world !== currentWorld
        || message.revision < multiplayerRevision
        || message.player !== String(clientContext.multiplayer.query.player)
      ) continue
      multiplayerRevision = Math.max(multiplayerRevision, message.revision)
      clientContext.state.enchantmentSeed = message.seed
      for (const key of [...clientContext.state.enchantedItems.keys()]) if (/^\d+$/u.test(key)) clientContext.state.enchantedItems.delete(key)
      for (const { slot, item } of message.items) clientContext.state.enchantedItems.set(String(slot), item)
      clientContext.callbacks.renderPlayerUi()
    }
  }

  document.addEventListener('mc-entity-command', (event) => {
    const detail = (event as CustomEvent<{ readonly entityId: string; readonly action: 'attack' | 'pickup' | 'mount' | 'dismount' | 'move'; readonly direction?: 'forward' | 'backward' }>).detail
    if (detail === undefined) return
    const entityId = EntityId.make(detail.entityId)
    if (detail.action === 'attack') sendEntityCommand({ _tag: 'EntityAttackCommand', entityId })
    else if (detail.action === 'pickup') sendEntityCommand({ _tag: 'EntityPickupCommand', entityId })
    else if (detail.action !== 'move') sendEntityCommand({
      _tag: 'VehicleCommand',
      entityId,
      action: detail.action,
    })
    else if (detail.direction !== undefined) sendEntityCommand({ _tag: 'VehicleCommand', entityId, action: { _tag: 'move', direction: detail.direction } })
  })

  const applyNetworkVitals = (state: { readonly health: number; readonly hunger: number; readonly experience: number }): void => {
    const current = Effect.runSync(clientContext.services.world.vitals.snapshot)
    Effect.runSync(clientContext.services.world.vitals.restore({
      ...current,
      healthPoints: state.health,
      hungerPoints: state.hunger,
      totalExperience: state.experience,
    }))
    clientContext.callbacks.renderPlayerUi()
  }

  const applyNetworkInventory = (state: Extract<NetworkMessage, { readonly _tag: 'PlayerInventoryDelta' }>['state']): void => {
    const storage = Effect.runSync(clientContext.services.world.inventory.storageSnapshot)
    const slots = state.slots.map((stack) => stack === null
      ? undefined
      : { item: stack.item as ItemStack['item'], count: StackCount(stack.count) })
    const equipmentSlots = { ...storage.equipment.slots }
    if (state.equipment !== undefined) {
      for (const slot of EQUIPMENT_SLOTS) {
        const stack = state.equipment[slot]
        equipmentSlots[slot] = stack === null
          ? null
          : equipmentItem(
              { item: stack.item as ItemStack['item'], count: StackCount(stack.count) },
              stack.durability ?? durabilityForItem(stack.item as ItemStack['item']),
            )
      }
    }
    Effect.runSync(clientContext.services.world.inventory.restoreStorage({
      ...storage,
      inventory: { slots },
      inventoryDurability: slots.map((stack, index) => {
        const durability = state.slots[index]?.durability ?? state.durability?.[index]
        if (durability !== undefined) return durability
        const previous = storage.inventory.slots[index]
        return previous?.item === stack?.item
          ? storage.inventoryDurability[index]
          : stack === undefined ? null : durabilityForItem(stack.item)
      }),
      equipment: { slots: equipmentSlots },
    }))
    clientContext.state.selectedHotbarIndex = state.selectedSlot
  }

  type NetworkVillagerTradeState = Extract<NetworkMessage, { readonly _tag: 'VillagerTradeDelta' }>['state']

  const applyNetworkVillagerTrade = (state: NetworkVillagerTradeState): void => {
    const current = Effect.runSync(snapshotVillagerTrades(clientContext.services.gameplayState))
    const villagers = current.villagers.map((villager) => {
      if (villager.id !== state.villagerId) return villager
      return {
        ...villager,
        offers: villager.offers.map((offer) => {
          const networkOffer = state.offers.find((candidate) => candidate.offerId === offer.id)
          const input = networkOffer?.input[0]
          if (networkOffer === undefined || input === undefined) return offer
          return {
            ...offer,
            input: { item: input.item as typeof offer.input.item, count: input.count },
            output: { item: networkOffer.output.item as typeof offer.output.item, count: networkOffer.output.count },
            uses: networkOffer.uses,
            maxUses: networkOffer.maxUses,
          }
        }),
      }
    })
    Effect.runSync(restoreVillagerTrades(clientContext.services.gameplayState, { ...current, villagers }))
  }

  const applyNetworkTimeWeather = (
    state: Extract<NetworkMessage, { readonly _tag: 'WorldTimeWeatherDelta' }>['state'],
  ): void => {
    Effect.runSync(clientContext.services.time.setTimeOfDay(state.timeOfDay / 24_000))
    const nextWeather: WeatherState = { weather: state.weather, remainingSecs: 300 }
    Effect.runSync(clientContext.services.weather.applyTransition(nextWeather))
    clientContext.services.presentWeather(nextWeather)
  }

  type NetworkContainerState = Extract<NetworkMessage, { readonly _tag: 'ContainerDelta' }>['state']
  type NetworkFurnaceState = Extract<NetworkMessage, { readonly _tag: 'FurnaceDelta' }>['state']

  const applyNetworkContainers = (states: ReadonlyArray<NetworkContainerState>): void => {
    Effect.runSync(clientContext.services.world.inventory.restoreContainerStorage({
      version: 2,
      containers: states.map((state) => ({
        id: state.containerId,
        kind: state.kind,
        slots: state.slots.map((stack) => {
          return stack == null
            ? null
            : {
                item: stack.item as ItemStack['item'],
                count: stack.count,
                durability: stack.durability ?? null,
              }
        }),
      })),
    }))
  }

  const applyNetworkContainer = (state: NetworkContainerState): void => {
    const snapshot = Effect.runSync(clientContext.services.world.inventory.containerStorageSnapshot)
    const existingStates: Array<NetworkContainerState> = snapshot.containers
      .filter((container) => container.id !== state.containerId)
      .map((container) => ({
        containerId: container.id,
        kind: container.kind,
        slots: container.slots.map((stack) => stack === null
          ? null
          : {
              item: stack.item,
              count: stack.count,
              ...(stack.durability === null ? {} : { durability: stack.durability }),
            }),
      }))
    applyNetworkContainers([...existingStates, state])
  }

  const applyNetworkFurnace = (state: NetworkFurnaceState): void => {
    const existing = clientContext.state.furnaceStates.get(state.furnaceId)
    let location: Pick<PersistedFurnaceState, 'dimension' | 'position'> | undefined = existing
    if (location === undefined) {
      try {
        const parsed: unknown = JSON.parse(state.furnaceId)
        if (
          Array.isArray(parsed)
          && parsed.length === 4
          && (parsed[0] === 'overworld' || parsed[0] === 'nether' || parsed[0] === 'end')
          && parsed.slice(1).every(Number.isFinite)
        ) {
          location = {
            dimension: parsed[0],
            position: { x: parsed[1] as number, y: parsed[2] as number, z: parsed[3] as number },
          }
        }
      } catch {
        return
      }
    }
    if (location === undefined) return
    const networkStack = (stack: NetworkFurnaceState['input']): ItemStack | null => stack === null
      ? null
      : itemStack(stack.item as ItemStack['item'], stack.count)
    clientContext.state.furnaceStates.set(state.furnaceId, {
      ...location,
      state: {
        input: networkStack(state.input),
        fuel: networkStack(state.fuel),
        output: networkStack(state.output),
        burnRemainingSecs: state.burnTicksRemaining / 20,
        cookElapsedSecs: state.cookTicks / 20,
      },
    })
  }

  const applyNetworkMessage = (message: NetworkMessage): void => {
    if (clientContext.multiplayer === undefined) return
    const localPlayer = clientContext.multiplayer.query.player
    switch (message._tag) {
      case 'WorldSnapshot':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        clientContext.multiplayer.players.clear()
        for (const player of message.players) {
          if (player.player !== clientContext.multiplayer.query.player) clientContext.multiplayer.players.set(player.player, player)
        }
        for (const block of message.blocks) applyNetworkBlock(block.world, block.at, block.block)
        const dimension = dimensionFromWorld(message.world)
        if (dimension !== undefined) {
          const dimensionKeyPrefix = `${JSON.stringify(dimension)},`
          for (const key of clientContext.state.poweredRails) {
            if (key.startsWith(dimensionKeyPrefix)) clientContext.state.poweredRails.delete(key)
          }
          for (const rail of message.poweredRails) {
            const key = clientContext.services.leverKeyOf({ dimension, position: rail.at })
            if (rail.powered) clientContext.state.poweredRails.add(key)
          }
          for (const [key, lever] of clientContext.state.leverStates) {
            if (lever.dimension === dimension) clientContext.state.leverStates.delete(key)
          }
          for (const lever of message.levers) {
            clientContext.state.leverStates.set(clientContext.services.leverKeyOf({ dimension, position: lever.at }), {
              dimension,
              position: { ...lever.at },
              active: lever.active,
            })
          }
          if (dimension === clientContext.services.currentChunkContext().dimension) clientContext.state.redstoneDirty = true
        }
        pendingLeverCommand = null
        break
      case 'AuthoritativeSnapshot': {
        if (message.revision < multiplayerRevision) {
          resumeCommandsAfterResync()
          break
        }
        multiplayerRevision = message.revision
        const local = message.vitals.find(({ player }) => player === localPlayer)
        if (local !== undefined) {
          applyNetworkVitals(local.state)
          settlePlayerDamageAfterVitals(message.revision)
        }
        const localInventory = message.inventories.find(({ player }) => player === localPlayer)
        if (localInventory !== undefined) applyNetworkInventory(localInventory.state)
        clientContext.state.networkFishingState = { phase: 'idle', result: 'idle' }
        for (const villagerTrade of message.villagerTrades) applyNetworkVillagerTrade(villagerTrade)
        applyNetworkTimeWeather(message.timeWeather)
        applyNetworkContainers(message.containers)
        clientContext.state.furnaceStates.clear()
        for (const furnace of message.furnaces) applyNetworkFurnace(furnace)
        if (
          clientContext.state.inventoryOpen
          && clientContext.state.inventoryMode === 'chest'
          && clientContext.state.activeChestId !== undefined
          && !message.containers.some(({ containerId }) => containerId === clientContext.state.activeChestId)
        ) {
          clientContext.state.activeChestId = undefined
          clientContext.callbacks.setInventoryOpen(false)
        }
        if (
          clientContext.state.inventoryOpen
          && clientContext.state.inventoryMode === 'furnace'
          && clientContext.state.activeFurnaceKey !== undefined
          && !clientContext.state.furnaceStates.has(clientContext.state.activeFurnaceKey)
        ) {
          clientContext.state.activeFurnaceKey = undefined
          clientContext.callbacks.setInventoryOpen(false)
        }
        clientContext.state.multiplayerEntities.clear()
        for (const entity of message.entities ?? []) {
          clientContext.state.multiplayerEntities.set(entity.entityId, entity)
          if (entity._tag === 'vehicle') clientContext.services.applyAuthoritativeVehicle(entity)
        }
        if (playerDamageResyncPending) {
          playerDamageResyncPending = false
          pendingPlayerDamage = null
          pumpPlayerDamage()
        }
        resumeCommandsAfterResync()
        pendingVillagerTradeCommand = null
        break
      }
      case 'RealmTransferSnapshot': {
        if (message.player !== clientContext.multiplayer.query.player) break
        const dimension = dimensionFromWorld(message.destinationWorld)
        if (dimension === undefined) break
        // Each realm maintains its own revision sequence.
        multiplayerRevision = -1
        applyNetworkMessage(message.worldSnapshot)
        applyNetworkMessage(message.authoritativeSnapshot)
        Effect.runSync(clientContext.services.playerApi.restore({
          feetPosition: message.at,
          yawRadians: message.facing.yawRadians,
          pitchRadians: message.facing.pitchRadians,
        }, dimension))
        clientContext.services.alignActiveDimension(dimension)
        clientContext.services.resetSimState(true)
        clientContext.state.lastPlayerMoveSent = { world: message.destinationWorld, at: message.at, facing: message.facing }
        clientContext.state.lastPlayerMoveSentAt = performance.now() / 1_000
        pendingPortalCommand = null
        clientContext.ui.multiplayerStatus.textContent = `Connected to multiplayer server (${dimension})`
        break
      }
      case 'EyeOfEnderThrown': {
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        const dimension = dimensionFromWorld(message.world)
        if (dimension === undefined || dimension !== clientContext.services.currentChunkContext().dimension) break
        const dx = message.target.x - message.origin.x
        const dz = message.target.z - message.origin.z
        clientContext.ui.canvas.setAttribute('data-stronghold-direction', String(Math.atan2(dx, -dz)))
        clientContext.ui.canvas.setAttribute('data-stronghold-distance', String(Math.round(Math.hypot(dx, dz))))
        clientContext.state.eyeOfEnderRuntimeState = launchRuntimeEyeOfEnder(clientContext.state.eyeOfEnderRuntimeState, {
          dimension,
          position: message.origin,
          target: message.target,
          breaks: message.breaks,
        })
        clientContext.services.queueEndAudio('eyeThrow', message.origin)
        break
      }
      case 'EntitySpawnDelta':
      case 'EntityUpdateDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        clientContext.state.multiplayerEntities.set(message.entity.entityId, message.entity)
        if (message.entity._tag === 'vehicle') clientContext.services.applyAuthoritativeVehicle(message.entity)
        break
      case 'EntityDespawnDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        clientContext.state.multiplayerEntities.delete(message.entityId)
        const existingVehicle = clientContext.services.vehicleById(String(message.entityId))
        if (existingVehicle !== undefined) Effect.runSync(clientContext.services.vehicleService.despawn(existingVehicle.id))
        break
      case 'PlayerInventoryDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        if (message.player === clientContext.multiplayer.query.player) {
          applyNetworkInventory(message.state)
          settleCraftingAfterInventory(message.revision)
        }
        if (
          message.player === clientContext.multiplayer.query.player
          && pendingFacilityCommand !== null
        ) {
          pendingFacilityCommand.inventoryDeltaRevision = message.revision
          if (
            pendingFacilityCommand.acceptedRevision !== null
            && pendingFacilityCommand.facilityDeltaRevision !== null
            && message.revision >= pendingFacilityCommand.acceptedRevision
            && pendingFacilityCommand.facilityDeltaRevision >= pendingFacilityCommand.acceptedRevision
          ) clearPendingFacilityCommand()
        }
        if (
          message.player === clientContext.multiplayer.query.player
          && pendingInventoryCommand !== null
          && pendingInventoryCommand.acceptedRevision !== null
          && message.revision >= pendingInventoryCommand.acceptedRevision
        ) {
          pendingInventoryCommand = null
          flushQueuedHotbarSelection()
        }
        break
      case 'PlayerVitalsDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        if (message.player === clientContext.multiplayer.query.player) {
          applyNetworkVitals(message.state)
          settlePlayerDamageAfterVitals(message.revision)
        }
        break
      case 'PlayerFishingDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        if (message.player === clientContext.multiplayer.query.player) {
          clientContext.state.networkFishingState = message.state
          clientContext.state.fishingResult = message.state.result
          document.body.setAttribute('data-fishing-result', message.state.result)
          document.body.setAttribute('data-fishing-phase', message.state.phase)
        }
        break
      case 'WorldTimeWeatherDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        applyNetworkTimeWeather(message.state)
        break
      case 'LightningStrikeDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        clientContext.state.authoritativeLightning = {
          sequence: message.revision,
          at: { ...message.at },
          expiresAtSecs: performance.now() / 1_000 + 0.35,
        }
        break
      case 'ContainerDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        applyNetworkContainer(message.state)
        if (
          pendingFacilityCommand?.facility === 'container'
          && pendingFacilityCommand.facilityId === message.state.containerId
        ) pendingFacilityCommand.facilityDeltaRevision = message.revision
        if (clientContext.state.inventoryOpen && clientContext.state.inventoryMode === 'chest' && clientContext.state.activeChestId === message.state.containerId) clientContext.callbacks.renderPlayerUi()
        break
      case 'FurnaceDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        applyNetworkFurnace(message.state)
        if (
          pendingFacilityCommand?.facility === 'furnace'
          && pendingFacilityCommand.facilityId === message.state.furnaceId
        ) pendingFacilityCommand.facilityDeltaRevision = message.revision
        if (clientContext.state.inventoryOpen && clientContext.state.inventoryMode === 'furnace' && clientContext.state.activeFurnaceKey === message.state.furnaceId) clientContext.callbacks.renderPlayerUi()
        break
      case 'VillagerTradeDelta':
        if (message.revision < multiplayerRevision) return
        multiplayerRevision = message.revision
        applyNetworkVillagerTrade(message.state)
        if (clientContext.state.activeVillagerId === message.state.villagerId) {
          clientContext.state.tradeStatus = 'Trade complete'
          clientContext.callbacks.renderTradeUi()
        }
        break
      case 'AuthoritativeCommandAccepted':
        multiplayerRevision = Math.max(multiplayerRevision, message.revision)
        if (message.commandId === pendingVitalsCommand) pendingVitalsCommand = null
        if (message.commandId === pendingPortalCommand) pendingPortalCommand = null
        if (message.commandId === pendingInventoryCommand?.commandId) {
          pendingInventoryCommand.acceptedRevision = message.revision
        }
        if (message.commandId === pendingEntityCommand?.commandId) {
          pendingEntityCommand = null
          pumpEntityCommands()
        }
        if (message.commandId === pendingFacilityCommand?.commandId) {
          if (!pendingFacilityCommand.expectsDelta) clearPendingFacilityCommand()
          else if (
            pendingFacilityCommand.facilityDeltaRevision !== null
            && pendingFacilityCommand.inventoryDeltaRevision !== null
            && pendingFacilityCommand.facilityDeltaRevision >= message.revision
            && pendingFacilityCommand.inventoryDeltaRevision >= message.revision
          ) clearPendingFacilityCommand()
          else pendingFacilityCommand.acceptedRevision = message.revision
        }
        if (message.commandId === pendingVillagerTradeCommand) {
          pendingVillagerTradeCommand = null
          clientContext.state.tradeStatus = 'Trade complete'
          if (clientContext.state.tradeOpen) clientContext.callbacks.renderTradeUi()
        }
        break
      case 'AuthoritativeCommandRejected':
        multiplayerRevision = Math.max(multiplayerRevision, message.revision)
        clientContext.state.multiplayerRejection = message.reason
        if (message.commandId === pendingPortalCommand) pendingPortalCommand = null
        if (message.commandId === pendingLeverCommand) pendingLeverCommand = null
        if (message.commandId === pendingVitalsCommand) pendingVitalsCommand = null
        if (message.commandId === pendingInventoryCommand?.commandId) {
          if (message.resyncRequired) pendingInventoryRetry = pendingInventoryCommand.action
          pendingInventoryCommand = null
          if (!message.resyncRequired) flushQueuedHotbarSelection()
        }
        if (message.commandId === pendingEntityCommand?.commandId) {
          const command = pendingEntityCommand.command
          pendingEntityCommand = null
          if (message.resyncRequired) {
            queuedEntityCommands = [command, ...queuedEntityCommands]
          }
          else pumpEntityCommands()
        }
        if (message.commandId === pendingFacilityCommand?.commandId) {
          clearPendingFacilityCommand()
          clientContext.state.chestStatus = message.reason
          clientContext.state.furnaceStatus = message.reason
          if (clientContext.state.inventoryOpen) clientContext.callbacks.renderPlayerUi()
        }
        if (message.resyncRequired) Effect.runSync(clientContext.multiplayer.host.enqueueOutbound({ _tag: 'AuthoritativeResyncRequest', world: message.world, lastKnownRevision: multiplayerRevision }))
        break
      case 'PlayerJoin':
        if (message.player !== clientContext.multiplayer.query.player) {
          clientContext.multiplayer.players.set(message.player, {
            name: message.name,
            world: WorldId.make(clientContext.services.currentChunkContext().dimension),
            at: message.at,
            facing: { yawRadians: 0, pitchRadians: 0 },
          })
        }
        break
      case 'PlayerMove': {
        if (message.player === clientContext.multiplayer.query.player) {
          const worldId = message.world ?? WorldId.make(Effect.runSync(clientContext.services.playerApi.dimension))
          const dimension = dimensionFromWorld(worldId)
          if (dimension !== undefined) {
            Effect.runSync(clientContext.services.playerApi.restore({
              feetPosition: message.at,
              yawRadians: message.facing.yawRadians,
              pitchRadians: message.facing.pitchRadians,
            }, dimension))
            clientContext.state.lastPlayerMoveSent = { world: worldId, at: message.at, facing: message.facing }
            clientContext.state.lastPlayerMoveSentAt = performance.now() / 1_000
            clientContext.ui.multiplayerStatus.textContent = 'Movement corrected by server.'
            clientContext.ui.multiplayerStatus.hidden = false
          }
          break
        }
        const previous = clientContext.multiplayer.players.get(message.player)
        clientContext.multiplayer.players.set(message.player, {
          name: previous?.name ?? PlayerName.make(String(message.player)),
          world: message.world ?? previous?.world ?? WorldId.make(clientContext.services.currentChunkContext().dimension),
          at: message.at,
          facing: message.facing,
        })
        break
      }
      case 'PlayerLeave':
        clientContext.multiplayer.players.delete(message.player)
        break
      case 'BlockPlace':
        applyNetworkBlock(message.world ?? WorldId.make(clientContext.services.currentChunkContext().dimension), message.at, message.block)
        multiplayerRevision += 1
        break
      case 'BlockBreak':
        {
          const worldId = message.world ?? WorldId.make(clientContext.services.currentChunkContext().dimension)
          applyNetworkBlock(worldId, message.at, null)
          const dimension = dimensionFromWorld(worldId)
          if (dimension !== undefined) {
            clientContext.state.leverStates.delete(clientContext.services.leverKeyOf({ dimension, position: message.at }))
            if (dimension === clientContext.services.currentChunkContext().dimension) clientContext.state.redstoneDirty = true
          }
        }
        multiplayerRevision += 1
        break
      case 'BlockMutationRejected':
        multiplayerRevision = Math.max(multiplayerRevision, message.revision)
        clientContext.state.multiplayerRejection = `${message.operation}: ${message.reason}`
        clientContext.ui.multiplayerStatus.textContent = clientContext.state.multiplayerRejection
        clientContext.ui.multiplayerStatus.hidden = false
        break
      case 'Chat': {
        const row = document.createElement('li')
        const sender = message.player === clientContext.multiplayer.query.player
          ? clientContext.multiplayer.query.name
          : clientContext.multiplayer.players.get(message.player)?.name ?? message.player
        row.textContent = `<${String(sender)}> ${message.text}`
        clientContext.ui.multiplayerChatLog.append(row)
        while (clientContext.ui.multiplayerChatLog.childElementCount > 50) {
          clientContext.ui.multiplayerChatLog.firstElementChild?.remove()
        }
        break
      }
      default:
        break
    }
    clientContext.ui.canvas.setAttribute('data-multiplayer-player-count', String(clientContext.multiplayer.players.size + 1))
    clientContext.ui.canvas.setAttribute('data-multiplayer-revision', String(multiplayerRevision))
    clientContext.ui.canvas.setAttribute('data-multiplayer-rejection', clientContext.state.multiplayerRejection)
  }

  clientContext.ui.multiplayerChatForm.addEventListener('submit', (event) => {
    event.preventDefault()
    const currentMultiplayer = clientContext.multiplayer
    const command = makeMultiplayerChatCommand(
      currentMultiplayer,
      clientContext.state.multiplayerHandshakeComplete,
      clientContext.ui.multiplayerChatInput.value,
    )
    if (command === undefined || currentMultiplayer === undefined) return
    Effect.runSync(currentMultiplayer.host.enqueueOutbound(command))
    clientContext.ui.multiplayerChatInput.value = ''
  })
  for (const eventName of ['keydown', 'keyup'] as const) {
    clientContext.ui.multiplayerChatInput.addEventListener(eventName, (event) => event.stopPropagation())
  }
  return {
    enqueueMultiplayerPlayerMove,
    drainMultiplayerInbound,
    sendVitalsCommand,
    sendPortalUseCommand,
    sendEndProgressCommand,
    sendToggleLeverCommand,
    sendInventoryCommand,
    sendInventorySelection,
    sendVillagerTradeCommand,
    sendEntityCommand,
    sendFacilityCommand,
    pumpPlayerDamage,
    drainPlayerDamageInbound,
    requestCrafting,
    drainCraftingInbound,
    requestBrewing,
    drainBrewingInbound,
    requestAnvil,
    drainAnvilInbound,
    requestEnchanting,
    drainEnchantingInbound,
    requestIdFor,
  }
}
