import { decodeEnchantedItem, type EnchantedItem } from '@nerima-games/mx-gameplay'
import type { WireText } from '@nerima-games/mx-multiplayer'

export interface EnchantingCommand {
  readonly _tag: 'EnchantingCommand'
  readonly commandId: string
  readonly player: string
  readonly world: string
  readonly expectedRevision: number
  readonly slot: number
  readonly offer: 0 | 1 | 2
}

export type EnchantingCommandResult = Readonly<{
  _tag: 'EnchantingCommandResult'
  commandId: string
  revision: number
} & (
  | { accepted: true; reason?: never }
  | { accepted: false; reason: 'stale-revision' | 'unauthorized-player' | 'wrong-world' | 'invalid-command' | 'no-item' | 'invalid-item' | 'incompatible-item' | 'conflicting-enchantment' | 'insufficient-level' | 'insufficient-lapis' }
)>

export interface PlayerEnchantmentsDelta {
  readonly _tag: 'PlayerEnchantmentsDelta'
  readonly world: string
  readonly revision: number
  readonly player: string
  readonly seed: number
  readonly items: ReadonlyArray<Readonly<{ slot: number; item: EnchantedItem }>>
}

export type EnchantingWireMessage = EnchantingCommand | EnchantingCommandResult | PlayerEnchantmentsDelta

export const ENCHANTING_MAX_WIRE_LENGTH = 32_768
const ENCHANTING_MAX_IDENTIFIER_LENGTH = 128
const ENCHANTING_SLOT_COUNT = 36

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const hasExactlyKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= ENCHANTING_MAX_IDENTIFIER_LENGTH && !/\p{Cc}/u.test(value)

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

const isSlot = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < ENCHANTING_SLOT_COUNT

const isOffer = (value: unknown): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2
const isSeed = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff

const isReason = (value: unknown): value is Extract<EnchantingCommandResult, { accepted: false }>['reason'] =>
  value === 'stale-revision' || value === 'unauthorized-player' || value === 'wrong-world' || value === 'invalid-command'
  || value === 'no-item' || value === 'invalid-item' || value === 'incompatible-item' || value === 'conflicting-enchantment'
  || value === 'insufficient-level' || value === 'insufficient-lapis'

const decodeItems = (value: unknown): PlayerEnchantmentsDelta['items'] | undefined => {
  if (!Array.isArray(value) || value.length > ENCHANTING_SLOT_COUNT) return undefined
  const slots = new Set<number>()
  const items: Array<{ slot: number; item: EnchantedItem }> = []
  for (const entry of value) {
    if (!isRecord(entry) || !hasExactlyKeys(entry, ['slot', 'item']) || !isSlot(entry['slot']) || slots.has(entry['slot'])) return undefined
    const item = decodeEnchantedItem(entry['item'])
    if (!item.ok) return undefined
    slots.add(entry['slot'])
    items.push({ slot: entry['slot'], item: item.value })
  }
  return items
}

export const encodeEnchantingCommand = (command: EnchantingCommand): WireText => JSON.stringify(command) as WireText

export const decodeEnchantingWireMessage = (wire: WireText): EnchantingWireMessage | undefined => {
  if (wire.length > ENCHANTING_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try { value = JSON.parse(wire) } catch { return undefined }
  if (!isRecord(value)) return undefined
  const commandId = value['commandId']
  const revision = value['revision']
  if (value['_tag'] === 'EnchantingCommandResult') {
    if (!isIdentifier(commandId) || !isRevision(revision)) return undefined
    if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) return { _tag: 'EnchantingCommandResult', commandId, accepted: true, revision }
    if (value['accepted'] === false && isReason(value['reason']) && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) return { _tag: 'EnchantingCommandResult', commandId, accepted: false, revision, reason: value['reason'] }
    return undefined
  }
  if (value['_tag'] === 'PlayerEnchantmentsDelta' && hasExactlyKeys(value, ['_tag', 'world', 'revision', 'player', 'seed', 'items'])) {
    const world = value['world']
    const player = value['player']
    const seed = value['seed']
    const items = decodeItems(value['items'])
    return isIdentifier(world) && isIdentifier(player) && isRevision(revision) && isSeed(seed) && items !== undefined
      ? { _tag: 'PlayerEnchantmentsDelta', world, revision, player, seed, items }
      : undefined
  }
  if (value['_tag'] !== 'EnchantingCommand' || !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'slot', 'offer'])) return undefined
  const player = value['player']
  const world = value['world']
  const expectedRevision = value['expectedRevision']
  const slot = value['slot']
  const offer = value['offer']
  return isIdentifier(commandId) && isIdentifier(player) && isIdentifier(world) && isRevision(expectedRevision) && isSlot(slot) && isOffer(offer)
    ? { _tag: 'EnchantingCommand', commandId, player, world, expectedRevision, slot, offer }
    : undefined
}
