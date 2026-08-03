import type { WireText } from '@nerima-games/mx-multiplayer'

export type PlayerDamageCommand = Readonly<{
  _tag: 'PlayerDamageCommand'
  commandId: string
  player: string
  world: string
  expectedRevision: number
  amount: number
  minimumHealthPoints?: number
}>

export type PlayerDamageCommandResult = Readonly<{
  _tag: 'PlayerDamageCommandResult'
  commandId: string
  revision: number
} & (
  | { accepted: true; reason?: never }
  | {
      accepted: false
      reason: 'stale-revision' | 'unauthorized-player' | 'wrong-world' | 'invalid-command'
    }
)>

export type PlayerDamageWireMessage = PlayerDamageCommand | PlayerDamageCommandResult

export const PLAYER_DAMAGE_MAX_WIRE_LENGTH = 1_024
export const PLAYER_DAMAGE_MAX_IDENTIFIER_LENGTH = 128
export const PLAYER_DAMAGE_MAX_AMOUNT = 20
export const PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS = 1

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasExactlyKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isValidIdentifier = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= PLAYER_DAMAGE_MAX_IDENTIFIER_LENGTH
  && !/\p{Cc}/u.test(value)

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isValidMinimumHealthPoints = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS

const isPlayerDamageRejectionReason = (
  value: unknown,
): value is Extract<PlayerDamageCommandResult, { accepted: false }>['reason'] =>
  value === 'stale-revision'
  || value === 'unauthorized-player'
  || value === 'wrong-world'
  || value === 'invalid-command'

export const encodePlayerDamageCommand = (command: PlayerDamageCommand): WireText =>
  JSON.stringify(command) as WireText

export const decodePlayerDamageWireMessage = (wire: WireText): PlayerDamageWireMessage | undefined => {
  if (wire.length > PLAYER_DAMAGE_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try {
    value = JSON.parse(wire)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value['_tag'] === 'PlayerDamageCommandResult') {
    const commandId = value['commandId']
    const revision = value['revision']
    if (!isValidIdentifier(commandId) || !isNonNegativeSafeInteger(revision)) return undefined
    if (value['accepted'] === true
      && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) {
      return {
        _tag: 'PlayerDamageCommandResult',
        commandId,
        accepted: true,
        revision,
      }
    }
    if (value['accepted'] === false
      && isPlayerDamageRejectionReason(value['reason'])
      && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) {
      return {
        _tag: 'PlayerDamageCommandResult',
        commandId,
        accepted: false,
        revision,
        reason: value['reason'],
      }
    }
    return undefined
  }
  if (value['_tag'] !== 'PlayerDamageCommand') return undefined
  const commandId = value['commandId']
  const player = value['player']
  const world = value['world']
  const expectedRevision = value['expectedRevision']
  const amount = value['amount']
  const minimumHealthPoints = value['minimumHealthPoints']
  const hasMinimumHealthPoints = Object.hasOwn(value, 'minimumHealthPoints')
  if ((!hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'amount'])
      && !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'amount', 'minimumHealthPoints']))
    || !isValidIdentifier(commandId)
    || !isValidIdentifier(player)
    || !isValidIdentifier(world)
    || !isNonNegativeSafeInteger(expectedRevision)
    || typeof amount !== 'number'
    || !Number.isFinite(amount)
    || amount <= 0
    || amount > PLAYER_DAMAGE_MAX_AMOUNT
    || (hasMinimumHealthPoints && !isValidMinimumHealthPoints(minimumHealthPoints))) return undefined
  if (hasMinimumHealthPoints) {
    if (!isValidMinimumHealthPoints(minimumHealthPoints)) return undefined
    return {
      _tag: 'PlayerDamageCommand',
      commandId,
      player,
      world,
      expectedRevision,
      amount,
      minimumHealthPoints,
    }
  }
  return {
    _tag: 'PlayerDamageCommand',
    commandId,
    player,
    world,
    expectedRevision,
    amount,
  }
}
