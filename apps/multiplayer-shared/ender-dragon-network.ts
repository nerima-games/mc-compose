import type { WireText } from '@nerima-games/mx-multiplayer'
import {
  decodeEnderDragonEncounterSnapshot,
  type EnderDragonEncounterSnapshot,
} from '@nerima-games/mx-gameplay'

export type EnderDragonCommand = Readonly<{
  _tag: 'DamageEnderDragon'
  actor: string
  requestId: string
  expectedRevision: number
}>

export type EnderDragonCommandResult =
  | Readonly<{ _tag: 'EnderDragonCommandResult'; requestId: string; accepted: true; revision: number }>
  | Readonly<{ _tag: 'EnderDragonCommandResult'; requestId: string; accepted: false; revision: number; reason: 'stale-revision' | 'invalid-command' }>

export type EnderDragonWireMessage =
  | Readonly<{ _tag: 'EnderDragonCommand'; command: EnderDragonCommand }>
  | EnderDragonCommandResult
  | Readonly<{ _tag: 'EnderDragonSnapshot'; revision: number; snapshot: EnderDragonEncounterSnapshot }>

export const ENDER_DRAGON_MAX_WIRE_LENGTH = 16_384
const MAX_IDENTIFIER_LENGTH = 128

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const hasExactlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_IDENTIFIER_LENGTH && !/[\u0000-\u001f\u007f]/.test(value)
const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export const encodeEnderDragonCommand = (command: EnderDragonCommand): WireText =>
  JSON.stringify({ _tag: 'EnderDragonCommand', command }) as WireText

export const decodeEnderDragonWireMessage = (wire: WireText): EnderDragonWireMessage | undefined => {
  if (wire.length > ENDER_DRAGON_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try { value = JSON.parse(wire) } catch { return undefined }
  if (!isRecord(value)) return undefined
  if (value['_tag'] === 'EnderDragonCommand' && hasExactlyKeys(value, ['_tag', 'command']) && isRecord(value['command'])) {
    const command = value['command']
    if (!hasExactlyKeys(command, ['_tag', 'actor', 'requestId', 'expectedRevision']) || command['_tag'] !== 'DamageEnderDragon'
      || !isIdentifier(command['actor']) || !isIdentifier(command['requestId']) || !isRevision(command['expectedRevision'])) return undefined
    return { _tag: 'EnderDragonCommand', command: { _tag: 'DamageEnderDragon', actor: command['actor'], requestId: command['requestId'], expectedRevision: command['expectedRevision'] } }
  }
  if (value['_tag'] === 'EnderDragonSnapshot' && hasExactlyKeys(value, ['_tag', 'revision', 'snapshot']) && isRevision(value['revision'])) {
    const snapshot = decodeEnderDragonEncounterSnapshot(value['snapshot'])
    return snapshot === undefined ? undefined : { _tag: 'EnderDragonSnapshot', revision: value['revision'], snapshot }
  }
  if (value['_tag'] === 'EnderDragonCommandResult' && isIdentifier(value['requestId']) && isRevision(value['revision'])) {
    if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'requestId', 'accepted', 'revision'])) return { _tag: 'EnderDragonCommandResult', requestId: value['requestId'], accepted: true, revision: value['revision'] }
    if (value['accepted'] === false && hasExactlyKeys(value, ['_tag', 'requestId', 'accepted', 'revision', 'reason']) && (value['reason'] === 'stale-revision' || value['reason'] === 'invalid-command')) return { _tag: 'EnderDragonCommandResult', requestId: value['requestId'], accepted: false, revision: value['revision'], reason: value['reason'] }
  }
  return undefined
}
