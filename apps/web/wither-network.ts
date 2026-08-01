import type { WireText } from '@nerima-games/mx-multiplayer'
import type { WitherDamageKind } from '@nerima-games/mc-sim'

import type { WitherRuntimeSnapshot } from './wither-runtime'

type WitherPosition = Readonly<{ x: number; y: number; z: number }>

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

export type WitherWireMessage =
  | Readonly<{ _tag: 'WitherCommand'; command: WitherCommand }>
  | Readonly<{
      _tag: 'WitherCommandResult'
      requestId: string
      accepted: boolean
      revision: number
      reason?: 'stale-revision' | 'invalid-command'
    }>
  | Readonly<{ _tag: 'WitherSnapshot'; revision: number; snapshot: WitherRuntimeSnapshot }>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const isPosition = (value: unknown): value is WitherPosition =>
  isRecord(value) && ['x', 'y', 'z'].every((key) => Number.isFinite(value[key]))

export const decodeWitherWireMessage = (wire: WireText): WitherWireMessage | undefined => {
  let value: unknown
  try {
    value = JSON.parse(wire)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  if (value['_tag'] === 'WitherCommandResult'
    && typeof value['requestId'] === 'string'
    && typeof value['accepted'] === 'boolean'
    && Number.isInteger(value['revision'])) return value as unknown as WitherWireMessage
  if (value['_tag'] === 'WitherSnapshot'
    && Number.isInteger(value['revision'])
    && isRecord(value['snapshot'])) return value as unknown as WitherWireMessage
  if (value['_tag'] !== 'WitherCommand' || !isRecord(value['command'])) return undefined
  const command = value['command']
  const common = typeof command['actor'] === 'string' && typeof command['requestId'] === 'string'
    && Number.isInteger(command['expectedRevision'])
  if (!common) return undefined
  if (command['_tag'] === 'SummonWither' && typeof command['dimension'] === 'string' && isPosition(command['position'])) {
    return value as unknown as WitherWireMessage
  }
  if (command['_tag'] === 'DamageWither' && typeof command['id'] === 'string'
    && typeof command['amount'] === 'number' && Number.isFinite(command['amount'])
    && ['melee', 'ranged', 'explosion'].includes(String(command['kind']))) {
    return value as unknown as WitherWireMessage
  }
  return undefined
}
