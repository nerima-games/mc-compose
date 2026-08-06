import {
  type BrewingStandState,
  type StatusEffectState,
  isValidBrewingStandState,
  isValidStatusEffectState,
} from '@nerima-games/mx-gameplay'
import type { WireText } from '@nerima-games/mx-multiplayer'

export interface BrewingPosition {
  readonly x: number
  readonly y: number
  readonly z: number
}

export type BrewingAction =
  | { readonly _tag: 'open' }
  | { readonly _tag: 'insert'; readonly slot: number }
  | { readonly _tag: 'collect' }
  | { readonly _tag: 'drink' }

export interface BrewingCommand {
  readonly _tag: 'BrewingCommand'
  readonly commandId: string
  readonly player: string
  readonly world: string
  readonly expectedRevision: number
  readonly at: BrewingPosition
  readonly action: BrewingAction
}

export type BrewingCommandResult = Readonly<{
  _tag: 'BrewingCommandResult'
  commandId: string
  revision: number
} & (
  | { accepted: true; reason?: never }
  | { accepted: false; reason: 'stale-revision' | 'unauthorized-player' | 'wrong-world' | 'invalid-command' | 'missing-ingredients' | 'no-room' }
)>

export interface BrewingStandDelta {
  readonly _tag: 'BrewingStandDelta'
  readonly world: string
  readonly revision: number
  readonly at: BrewingPosition
  readonly state: BrewingStandState
}

export interface PlayerStatusEffectsDelta {
  readonly _tag: 'PlayerStatusEffectsDelta'
  readonly world: string
  readonly revision: number
  readonly player: string
  readonly state: StatusEffectState
}

export type BrewingWireMessage =
  | BrewingCommand
  | BrewingCommandResult
  | BrewingStandDelta
  | PlayerStatusEffectsDelta

export const BREWING_MAX_WIRE_LENGTH = 8_192
const BREWING_MAX_IDENTIFIER_LENGTH = 128
const BREWING_MAX_COORDINATE = 30_000_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactlyKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= BREWING_MAX_IDENTIFIER_LENGTH && !/\p{Cc}/u.test(value)

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const decodePosition = (value: unknown): BrewingPosition | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['x', 'y', 'z'])) return undefined
  const x = value['x']
  const y = value['y']
  const z = value['z']
  if (
    typeof x !== 'number' || !Number.isSafeInteger(x) || Math.abs(x) > BREWING_MAX_COORDINATE ||
    typeof y !== 'number' || !Number.isSafeInteger(y) || Math.abs(y) > BREWING_MAX_COORDINATE ||
    typeof z !== 'number' || !Number.isSafeInteger(z) || Math.abs(z) > BREWING_MAX_COORDINATE
  ) return undefined
  return { x, y, z }
}

const decodeAction = (value: unknown): BrewingAction | undefined => {
  if (!isRecord(value)) return undefined
  if ((value['_tag'] === 'open' || value['_tag'] === 'collect' || value['_tag'] === 'drink') && hasExactlyKeys(value, ['_tag'])) return { _tag: value['_tag'] }
  const slot = value['slot']
  return value['_tag'] === 'insert' && hasExactlyKeys(value, ['_tag', 'slot']) && typeof slot === 'number' && Number.isSafeInteger(slot) && slot >= 0 && slot < 36
    ? { _tag: 'insert', slot }
    : undefined
}

const isReason = (value: unknown): value is Extract<BrewingCommandResult, { accepted: false }>['reason'] =>
  value === 'stale-revision' || value === 'unauthorized-player' || value === 'wrong-world' || value === 'invalid-command' || value === 'missing-ingredients' || value === 'no-room'

export const encodeBrewingCommand = (command: BrewingCommand): WireText => JSON.stringify(command) as WireText

export const decodeBrewingWireMessage = (wire: WireText): BrewingWireMessage | undefined => {
  if (wire.length > BREWING_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try { value = JSON.parse(wire) } catch { return undefined }
  if (!isRecord(value)) return undefined
  const commandId = value['commandId']
  const revision = value['revision']
  if (value['_tag'] === 'BrewingCommandResult') {
    if (!isIdentifier(commandId) || !isRevision(revision)) return undefined
    if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) return { _tag: 'BrewingCommandResult', commandId, accepted: true, revision }
    if (value['accepted'] === false && isReason(value['reason']) && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) return { _tag: 'BrewingCommandResult', commandId, accepted: false, revision, reason: value['reason'] }
    return undefined
  }
  if (value['_tag'] === 'BrewingStandDelta' && hasExactlyKeys(value, ['_tag', 'world', 'revision', 'at', 'state'])) {
    const world = value['world']
    const at = decodePosition(value['at'])
    return isIdentifier(world) && isRevision(revision) && at !== undefined && isValidBrewingStandState(value['state'])
      ? { _tag: 'BrewingStandDelta', world, revision, at, state: value['state'] }
      : undefined
  }
  if (value['_tag'] === 'PlayerStatusEffectsDelta' && hasExactlyKeys(value, ['_tag', 'world', 'revision', 'player', 'state'])) {
    const world = value['world']
    const player = value['player']
    return isIdentifier(world) && isRevision(revision) && isIdentifier(player) && isValidStatusEffectState(value['state'])
      ? { _tag: 'PlayerStatusEffectsDelta', world, revision, player, state: value['state'] }
      : undefined
  }
  if (value['_tag'] !== 'BrewingCommand' || !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'at', 'action'])) return undefined
  const player = value['player']
  const world = value['world']
  const expectedRevision = value['expectedRevision']
  const at = decodePosition(value['at'])
  const action = decodeAction(value['action'])
  return isIdentifier(commandId) && isIdentifier(player) && isIdentifier(world) && isRevision(expectedRevision) && at !== undefined && action !== undefined
    ? { _tag: 'BrewingCommand', commandId, player, world, expectedRevision, at, action }
    : undefined
}
