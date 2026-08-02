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
    if (!isValidIdentifier(value['commandId'])
      || !Number.isSafeInteger(value['revision'])
      || (value['revision'] as number) < 0) return undefined
    if (value['accepted'] === true
      && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) {
      return value as unknown as PlayerDamageCommandResult
    }
    if (value['accepted'] === false
      && isPlayerDamageRejectionReason(value['reason'])
      && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) {
      return value as unknown as PlayerDamageCommandResult
    }
    return undefined
  }
  if (value['_tag'] !== 'PlayerDamageCommand'
    || (!hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'amount'])
      && !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'amount', 'minimumHealthPoints']))
    || !isValidIdentifier(value['commandId'])
    || !isValidIdentifier(value['player'])
    || !isValidIdentifier(value['world'])
    || !Number.isSafeInteger(value['expectedRevision'])
    || (value['expectedRevision'] as number) < 0
    || typeof value['amount'] !== 'number'
    || !Number.isFinite(value['amount'])
    || (value['amount'] as number) <= 0
    || (value['amount'] as number) > PLAYER_DAMAGE_MAX_AMOUNT
    || (Object.hasOwn(value, 'minimumHealthPoints')
      && (typeof value['minimumHealthPoints'] !== 'number'
        || !Number.isFinite(value['minimumHealthPoints'])
        || (value['minimumHealthPoints'] as number) < 0
        || (value['minimumHealthPoints'] as number) > PLAYER_DAMAGE_MAX_MINIMUM_HEALTH_POINTS))) return undefined
  return value as unknown as PlayerDamageCommand
}
