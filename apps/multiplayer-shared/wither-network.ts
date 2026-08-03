import type { WireText } from '@nerima-games/mx-multiplayer'
import type {
  WitherDamageKind,
  WitherPhase,
  WitherSkullProjectileDescriptor,
  WitherSkullVariant,
  WitherSnapshot,
} from '@nerima-games/mc-sim'

import type { RuntimeWitherSkull, WitherRuntimeSnapshot } from './wither-runtime'

type WitherPosition = Readonly<{ x: number; y: number; z: number }>
type RuntimeWitherSnapshot = WitherRuntimeSnapshot['withers'][number]

export type WitherCommand =
  | Readonly<{
      _tag: 'SummonWither'
      actor: string
      requestId: string
      expectedRevision: number
      dimension: string
      position: WitherPosition
    }>
  | Readonly<{
      _tag: 'DamageWither'
      actor: string
      requestId: string
      expectedRevision: number
      id: string
      amount: number
      kind: WitherDamageKind
    }>

export type WitherCommandResult =
  | Readonly<{
      _tag: 'WitherCommandResult'
      requestId: string
      accepted: true
      revision: number
    }>
  | Readonly<{
      _tag: 'WitherCommandResult'
      requestId: string
      accepted: false
      revision: number
      reason: 'stale-revision' | 'invalid-command'
    }>

export type WitherWireMessage =
  | Readonly<{ _tag: 'WitherCommand'; command: WitherCommand }>
  | WitherCommandResult
  | Readonly<{ _tag: 'WitherSnapshot'; revision: number; snapshot: WitherRuntimeSnapshot }>

export const WITHER_MAX_WIRE_LENGTH = 1_048_576

const WITHER_MAX_IDENTIFIER_LENGTH = 128
const WITHER_DAMAGE_KINDS = ['melee', 'ranged', 'magic', 'explosion', 'void'] as const satisfies ReadonlyArray<WitherDamageKind>
const WITHER_PHASES = ['charging', 'airborne', 'armoured', 'dead'] as const satisfies ReadonlyArray<WitherPhase>
const WITHER_SKULL_VARIANTS = ['normal', 'blue'] as const satisfies ReadonlyArray<WitherSkullVariant>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const hasExactlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= WITHER_MAX_IDENTIFIER_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value)

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isNonNegativeFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const decodePosition = (value: unknown): WitherPosition | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['x', 'y', 'z'])) return undefined
  const x = value['x']
  const y = value['y']
  const z = value['z']
  if (typeof x !== 'number' || !Number.isFinite(x)
    || typeof y !== 'number' || !Number.isFinite(y)
    || typeof z !== 'number' || !Number.isFinite(z)) return undefined
  return { x, y, z }
}

const isWitherDamageKind = (value: unknown): value is WitherDamageKind =>
  typeof value === 'string' && WITHER_DAMAGE_KINDS.some((kind) => kind === value)

const isWitherPhase = (value: unknown): value is WitherPhase =>
  typeof value === 'string' && WITHER_PHASES.some((phase) => phase === value)

const isWitherSkullVariant = (value: unknown): value is WitherSkullVariant =>
  typeof value === 'string' && WITHER_SKULL_VARIANTS.some((variant) => variant === value)

const decodeWitherSnapshot = (value: unknown): WitherSnapshot | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['kind', 'version', 'state'])
    || value['kind'] !== 'wither' || value['version'] !== 1 || !isRecord(value['state'])
    || !hasExactlyKeys(value['state'], ['phase', 'healthPoints', 'chargeRemainingSecs', 'feetPosition', 'velocity'])) return undefined

  const state = value['state']
  const phase = state['phase']
  const healthPoints = state['healthPoints']
  const chargeRemainingSecs = state['chargeRemainingSecs']
  const feetPosition = decodePosition(state['feetPosition'])
  const velocity = decodePosition(state['velocity'])
  if (!isWitherPhase(phase) || !isNonNegativeFiniteNumber(healthPoints)
    || !isNonNegativeFiniteNumber(chargeRemainingSecs) || feetPosition === undefined || velocity === undefined) return undefined

  return { kind: 'wither', version: 1, state: { phase, healthPoints, chargeRemainingSecs, feetPosition, velocity } }
}

const decodeWitherSkullDescriptor = (value: unknown): WitherSkullProjectileDescriptor | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    'kind', 'variant', 'origin', 'direction', 'speed', 'explosivePower', 'destroysResistantBlocks',
  ]) || value['kind'] !== 'wither_skull') return undefined

  const variant = value['variant']
  const origin = decodePosition(value['origin'])
  const direction = decodePosition(value['direction'])
  const speed = value['speed']
  const explosivePower = value['explosivePower']
  const destroysResistantBlocks = value['destroysResistantBlocks']
  if (!isWitherSkullVariant(variant) || origin === undefined || direction === undefined
    || !isNonNegativeFiniteNumber(speed) || !isNonNegativeFiniteNumber(explosivePower)
    || typeof destroysResistantBlocks !== 'boolean') return undefined

  return { kind: 'wither_skull', variant, origin, direction, speed, explosivePower, destroysResistantBlocks }
}

const decodeRuntimeWitherSnapshot = (value: unknown): RuntimeWitherSnapshot | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, [
    'id', 'dimension', 'snapshot', 'rangedCooldownSecs', 'meleeCooldownSecs', 'shotsFired',
  ])) return undefined

  const id = value['id']
  const dimension = value['dimension']
  const snapshot = decodeWitherSnapshot(value['snapshot'])
  const rangedCooldownSecs = value['rangedCooldownSecs']
  const meleeCooldownSecs = value['meleeCooldownSecs']
  const shotsFired = value['shotsFired']
  if (!isIdentifier(id) || !isIdentifier(dimension) || snapshot === undefined
    || !isNonNegativeFiniteNumber(rangedCooldownSecs) || !isNonNegativeFiniteNumber(meleeCooldownSecs)
    || !isNonNegativeSafeInteger(shotsFired)) return undefined

  return { id, dimension, snapshot, rangedCooldownSecs, meleeCooldownSecs, shotsFired }
}

const decodeRuntimeWitherSkull = (value: unknown): RuntimeWitherSkull | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['id', 'ownerId', 'dimension', 'descriptor', 'position', 'ageSecs'])) return undefined

  const id = value['id']
  const ownerId = value['ownerId']
  const dimension = value['dimension']
  const descriptor = decodeWitherSkullDescriptor(value['descriptor'])
  const position = decodePosition(value['position'])
  const ageSecs = value['ageSecs']
  if (!isIdentifier(id) || !isIdentifier(ownerId) || !isIdentifier(dimension)
    || descriptor === undefined || position === undefined || !isNonNegativeFiniteNumber(ageSecs)) return undefined

  return { id, ownerId, dimension, descriptor, position, ageSecs }
}

const decodeArray = <Value>(values: unknown[], decode: (value: unknown) => Value | undefined): Value[] | undefined => {
  const decoded: Value[] = []
  for (const value of values) {
    const item = decode(value)
    if (item === undefined) return undefined
    decoded.push(item)
  }
  return decoded
}

const decodeWitherRuntimeSnapshot = (value: unknown): WitherRuntimeSnapshot | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['nextWitherId', 'nextSkullId', 'withers', 'skulls'])) return undefined

  const nextWitherId = value['nextWitherId']
  const nextSkullId = value['nextSkullId']
  const withers = value['withers']
  const skulls = value['skulls']
  if (!isNonNegativeSafeInteger(nextWitherId) || !isNonNegativeSafeInteger(nextSkullId)
    || !Array.isArray(withers) || !Array.isArray(skulls)) return undefined

  const decodedWithers = decodeArray(withers, decodeRuntimeWitherSnapshot)
  const decodedSkulls = decodeArray(skulls, decodeRuntimeWitherSkull)
  if (decodedWithers === undefined || decodedSkulls === undefined) return undefined

  return { nextWitherId, nextSkullId, withers: decodedWithers, skulls: decodedSkulls }
}

const decodeWitherCommand = (value: unknown): WitherCommand | undefined => {
  if (!isRecord(value)) return undefined
  const actor = value['actor']
  const requestId = value['requestId']
  const expectedRevision = value['expectedRevision']
  if (!isIdentifier(actor) || !isIdentifier(requestId) || !isNonNegativeSafeInteger(expectedRevision)) return undefined

  if (value['_tag'] === 'SummonWither' && hasExactlyKeys(value, [
    '_tag', 'actor', 'requestId', 'expectedRevision', 'dimension', 'position',
  ])) {
    const dimension = value['dimension']
    const position = decodePosition(value['position'])
    if (!isIdentifier(dimension) || position === undefined) return undefined
    return { _tag: 'SummonWither', actor, requestId, expectedRevision, dimension, position }
  }

  if (value['_tag'] === 'DamageWither' && hasExactlyKeys(value, [
    '_tag', 'actor', 'requestId', 'expectedRevision', 'id', 'amount', 'kind',
  ])) {
    const id = value['id']
    const amount = value['amount']
    const kind = value['kind']
    if (!isIdentifier(id) || !isNonNegativeFiniteNumber(amount) || !isWitherDamageKind(kind)) return undefined
    return { _tag: 'DamageWither', actor, requestId, expectedRevision, id, amount, kind }
  }

  return undefined
}

const decodeWitherCommandResult = (value: Record<string, unknown>): WitherCommandResult | undefined => {
  const requestId = value['requestId']
  const revision = value['revision']
  if (!isIdentifier(requestId) || !isNonNegativeSafeInteger(revision)) return undefined

  if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'requestId', 'accepted', 'revision'])) {
    return { _tag: 'WitherCommandResult', requestId, accepted: true, revision }
  }
  if (value['accepted'] === false && hasExactlyKeys(value, ['_tag', 'requestId', 'accepted', 'revision', 'reason'])) {
    const reason = value['reason']
    if (reason === 'stale-revision' || reason === 'invalid-command') {
      return { _tag: 'WitherCommandResult', requestId, accepted: false, revision, reason }
    }
  }
  return undefined
}

export const decodeWitherWireMessage = (wire: WireText): WitherWireMessage | undefined => {
  if (wire.length > WITHER_MAX_WIRE_LENGTH) return undefined

  let value: unknown
  try {
    value = JSON.parse(wire)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined

  if (value['_tag'] === 'WitherCommand') {
    if (!hasExactlyKeys(value, ['_tag', 'command'])) return undefined
    const command = decodeWitherCommand(value['command'])
    return command === undefined ? undefined : { _tag: 'WitherCommand', command }
  }
  if (value['_tag'] === 'WitherCommandResult') return decodeWitherCommandResult(value)
  if (value['_tag'] === 'WitherSnapshot' && hasExactlyKeys(value, ['_tag', 'revision', 'snapshot'])) {
    const revision = value['revision']
    const snapshot = decodeWitherRuntimeSnapshot(value['snapshot'])
    if (!isNonNegativeSafeInteger(revision) || snapshot === undefined) return undefined
    return { _tag: 'WitherSnapshot', revision, snapshot }
  }
  return undefined
}
