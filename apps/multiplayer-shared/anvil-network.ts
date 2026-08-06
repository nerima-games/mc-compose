import type { WireText } from '@nerima-games/mx-multiplayer'

export interface AnvilCommand {
  readonly _tag: 'AnvilCommand'
  readonly commandId: string
  readonly player: string
  readonly world: string
  readonly expectedRevision: number
  readonly slot: number
  readonly name: string
}

export type AnvilCommandResult = Readonly<{
  _tag: 'AnvilCommandResult'
  commandId: string
  revision: number
} & (
  | { accepted: true; reason?: never }
  | { accepted: false; reason: 'stale-revision' | 'unauthorized-player' | 'wrong-world' | 'invalid-command' | 'no-item' | 'no-change' | 'missing-iron' | 'insufficient-experience' }
)>

export interface PlayerAnvilNamesDelta {
  readonly _tag: 'PlayerAnvilNamesDelta'
  readonly world: string
  readonly revision: number
  readonly player: string
  readonly names: ReadonlyArray<Readonly<{ slot: number; name: string }>>
}

export type AnvilWireMessage = AnvilCommand | AnvilCommandResult | PlayerAnvilNamesDelta

export const ANVIL_MAX_WIRE_LENGTH = 2_048
const ANVIL_MAX_IDENTIFIER_LENGTH = 128
export const ANVIL_MAX_NAME_LENGTH = 50
const ANVIL_SLOT_COUNT = 36

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactlyKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= ANVIL_MAX_IDENTIFIER_LENGTH && !/\p{Cc}/u.test(value)

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isSlot = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < ANVIL_SLOT_COUNT

export const isValidAnvilName = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= ANVIL_MAX_NAME_LENGTH && !/\p{Cc}/u.test(value)

const isReason = (value: unknown): value is Extract<AnvilCommandResult, { accepted: false }>['reason'] =>
  value === 'stale-revision' || value === 'unauthorized-player' || value === 'wrong-world' || value === 'invalid-command'
  || value === 'no-item' || value === 'no-change' || value === 'missing-iron' || value === 'insufficient-experience'

const decodeNames = (value: unknown): PlayerAnvilNamesDelta['names'] | undefined => {
  if (!Array.isArray(value)) return undefined
  const names: Array<{ slot: number; name: string }> = []
  const slots = new Set<number>()
  for (const entry of value) {
    if (!isRecord(entry) || !hasExactlyKeys(entry, ['slot', 'name']) || !isSlot(entry['slot']) || !isValidAnvilName(entry['name']) || entry['name'].length === 0 || slots.has(entry['slot'])) return undefined
    slots.add(entry['slot'])
    names.push({ slot: entry['slot'], name: entry['name'] })
  }
  return names
}

export const encodeAnvilCommand = (command: AnvilCommand): WireText => JSON.stringify(command) as WireText

export const decodeAnvilWireMessage = (wire: WireText): AnvilWireMessage | undefined => {
  if (wire.length > ANVIL_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try { value = JSON.parse(wire) } catch { return undefined }
  if (!isRecord(value)) return undefined
  const commandId = value['commandId']
  const revision = value['revision']
  if (value['_tag'] === 'AnvilCommandResult') {
    if (!isIdentifier(commandId) || !isRevision(revision)) return undefined
    if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) return { _tag: 'AnvilCommandResult', commandId, accepted: true, revision }
    if (value['accepted'] === false && isReason(value['reason']) && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) return { _tag: 'AnvilCommandResult', commandId, accepted: false, revision, reason: value['reason'] }
    return undefined
  }
  if (value['_tag'] === 'PlayerAnvilNamesDelta' && hasExactlyKeys(value, ['_tag', 'world', 'revision', 'player', 'names'])) {
    const world = value['world']
    const player = value['player']
    const names = decodeNames(value['names'])
    return isIdentifier(world) && isIdentifier(player) && isRevision(revision) && names !== undefined
      ? { _tag: 'PlayerAnvilNamesDelta', world, revision, player, names }
      : undefined
  }
  if (value['_tag'] !== 'AnvilCommand' || !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'slot', 'name'])) return undefined
  const player = value['player']
  const world = value['world']
  const expectedRevision = value['expectedRevision']
  const slot = value['slot']
  const name = value['name']
  return isIdentifier(commandId) && isIdentifier(player) && isIdentifier(world) && isRevision(expectedRevision) && isSlot(slot) && isValidAnvilName(name)
    ? { _tag: 'AnvilCommand', commandId, player, world, expectedRevision, slot, name }
    : undefined
}
