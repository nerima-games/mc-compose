import {
  decodeFrame,
  encodeFrame,
  type BlockMutationRejected,
  type BlockPos,
  type NetworkMessage,
  type Orientation,
  type PlayerId,
  type PlayerSnapshot,
  type WireText,
  type WorldId,
  type WorldSnapshot,
} from '@nerima-games/mx-multiplayer'
import { Either } from 'effect'

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
}

export type ReceiveResult =
  | Readonly<{ accepted: true; message: NetworkMessage }>
  | Readonly<{ accepted: false; reason: 'unknown-client' | 'malformed-frame' | 'join-required' | 'duplicate-player' | 'identity-spoof' | 'wrong-world' | 'invalid-mutation' }>

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

const DEFAULT_BOUNDS = {
  minX: -30_000_000,
  maxX: 30_000_000,
  minY: -64,
  maxY: 319,
  minZ: -30_000_000,
  maxZ: 30_000_000,
} as const

const DEFAULT_FACING: Orientation = { yawRadians: 0, pitchRadians: 0 }
const positionKey = ({ x, y, z }: BlockPos): string => `${String(x)},${String(y)},${String(z)}`

export interface MultiplayerServerCore {
  readonly connect: (clientId: ClientId, send: SendFrame) => boolean
  readonly receive: (clientId: ClientId, frame: WireText) => ReceiveResult
  readonly disconnect: (clientId: ClientId) => void
  readonly snapshot: () => WorldSnapshot
}

export const makeMultiplayerServerCore = (options: MultiplayerServerOptions): MultiplayerServerCore => {
  const worldId = options.worldId as WorldId
  const bounds = options.bounds ?? DEFAULT_BOUNDS
  const clients = new Map<ClientId, ConnectedClient>()
  const players = new Map<PlayerId, MutablePlayer>()
  const playerClients = new Map<PlayerId, ClientId>()
  const blocks = new Map<string, Readonly<{ at: BlockPos; block: string | null }>>()
  let revision = 0

  const sendMessage = (client: ConnectedClient, message: NetworkMessage): void => {
    const encoded = encodeFrame(message)
    if (Either.isRight(encoded)) client.send(encoded.right)
  }

  const broadcast = (message: NetworkMessage, except?: ClientId): void => {
    for (const [clientId, client] of clients) {
      if (clientId !== except && client.playerId !== null) sendMessage(client, message)
    }
  }

  const snapshot = (): WorldSnapshot => ({
    _tag: 'WorldSnapshot',
    world: worldId,
    seed: options.seed,
    revision,
    players: [...players.values()].map((player) => ({ ...player })),
    blocks: [...blocks.values()].map((mutation) => ({ world: worldId, ...mutation })),
  })

  const isInBounds = ({ x, y, z }: BlockPos): boolean =>
    x >= bounds.minX && x <= bounds.maxX &&
    y >= bounds.minY && y <= bounds.maxY &&
    z >= bounds.minZ && z <= bounds.maxZ

  const blockAt = (at: BlockPos): string | null => {
    const override = blocks.get(positionKey(at))
    return override === undefined ? (options.generatedBlockAt?.(at) ?? null) : override.block
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
      sendMessage(client, snapshot())
      broadcast(message, clientId)
      return { accepted: true, message }
    }

    if (message._tag === 'Ping') {
      sendMessage(client, { _tag: 'Pong', nonce: message.nonce })
      return { accepted: true, message }
    }

    if (client.playerId === null) return { accepted: false, reason: 'join-required' }

    if ('player' in message && message.player !== client.playerId) {
      if (message._tag === 'BlockPlace' || message._tag === 'BlockBreak') {
        return rejectMutation(client, message, 'unauthorized-player')
      }
      return { accepted: false, reason: 'identity-spoof' }
    }

    switch (message._tag) {
      case 'PlayerLeave':
        removePlayer(clientId, client)
        return { accepted: true, message }
      case 'PlayerMove': {
        if (message.world !== undefined && message.world !== worldId) return { accepted: false, reason: 'wrong-world' }
        const player = players.get(message.player)
        if (player === undefined) return { accepted: false, reason: 'join-required' }
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
        broadcast({ ...message, world: worldId })
        return { accepted: true, message }
      }
      case 'BlockBreak': {
        if (message.world !== undefined && message.world !== worldId) return rejectMutation(client, message, 'unauthorized-player')
        if (!isInBounds(message.at)) return rejectMutation(client, message, 'out-of-bounds')
        if (blockAt(message.at) === null) return rejectMutation(client, message, 'missing-block')
        blocks.set(positionKey(message.at), { at: message.at, block: null })
        revision += 1
        broadcast({ ...message, world: worldId })
        return { accepted: true, message }
      }
      case 'Pong':
        return { accepted: true, message }
      case 'WorldInfo':
      case 'WorldSnapshot':
      case 'BlockMutationRejected':
        return { accepted: false, reason: 'identity-spoof' }
    }
  }

  const disconnect = (clientId: ClientId): void => {
    const client = clients.get(clientId)
    if (client === undefined) return
    removePlayer(clientId, client)
    clients.delete(clientId)
  }

  return { connect, receive, disconnect, snapshot }
}
