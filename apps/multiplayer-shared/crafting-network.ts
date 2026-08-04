import { isItemType, type ItemType } from '@nerima-games/mc-kernel'
import type { WireText } from '@nerima-games/mx-multiplayer'

export type CraftingGridCommand = Readonly<{
  width: 2 | 3
  height: 2 | 3
  cells: ReadonlyArray<ItemType | null>
}>

export type CraftingCommand = Readonly<{
  _tag: 'CraftingCommand'
  commandId: string
  player: string
  world: string
  expectedRevision: number
  grid: CraftingGridCommand
}>

export type CraftingCommandResult = Readonly<{
  _tag: 'CraftingCommandResult'
  commandId: string
  revision: number
} & (
  | { accepted: true; reason?: never }
  | { accepted: false; reason: 'stale-revision' | 'unauthorized-player' | 'wrong-world' | 'invalid-command' | 'no-match' | 'missing-ingredients' | 'no-room' }
)>

export type CraftingWireMessage = CraftingCommand | CraftingCommandResult

export const CRAFTING_MAX_WIRE_LENGTH = 1_024
export const CRAFTING_MAX_IDENTIFIER_LENGTH = 128

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const hasExactlyKeys = (value: Record<string, unknown>, expected: ReadonlyArray<string>): boolean => {
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key))
}
const isIdentifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= CRAFTING_MAX_IDENTIFIER_LENGTH && !/\p{Cc}/u.test(value)
const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isReason = (value: unknown): value is Extract<CraftingCommandResult, { accepted: false }>['reason'] =>
  value === 'stale-revision' || value === 'unauthorized-player' || value === 'wrong-world' || value === 'invalid-command' || value === 'no-match' || value === 'missing-ingredients' || value === 'no-room'

const decodeGrid = (value: unknown): CraftingGridCommand | undefined => {
  if (!isRecord(value) || !hasExactlyKeys(value, ['width', 'height', 'cells'])) return undefined
  const { width, height, cells } = value
  if (!((width === 2 && height === 2) || (width === 3 && height === 3)) || !Array.isArray(cells) || cells.length !== width * height || !cells.every((cell) => cell === null || isItemType(cell))) return undefined
  return { width, height, cells }
}

export const encodeCraftingCommand = (command: CraftingCommand): WireText => JSON.stringify(command) as WireText

export const decodeCraftingWireMessage = (wire: WireText): CraftingWireMessage | undefined => {
  if (wire.length > CRAFTING_MAX_WIRE_LENGTH) return undefined
  let value: unknown
  try { value = JSON.parse(wire) } catch { return undefined }
  if (!isRecord(value)) return undefined
  const commandId = value['commandId']
  const revision = value['revision']
  if (value['_tag'] === 'CraftingCommandResult') {
    if (!isIdentifier(commandId) || !isRevision(revision)) return undefined
    if (value['accepted'] === true && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision'])) return { _tag: 'CraftingCommandResult', commandId, accepted: true, revision }
    if (value['accepted'] === false && isReason(value['reason']) && hasExactlyKeys(value, ['_tag', 'commandId', 'accepted', 'revision', 'reason'])) return { _tag: 'CraftingCommandResult', commandId, accepted: false, revision, reason: value['reason'] }
    return undefined
  }
  if (value['_tag'] !== 'CraftingCommand' || !hasExactlyKeys(value, ['_tag', 'commandId', 'player', 'world', 'expectedRevision', 'grid'])) return undefined
  const player = value['player']
  const world = value['world']
  const expectedRevision = value['expectedRevision']
  const grid = decodeGrid(value['grid'])
  return isIdentifier(commandId) && isIdentifier(player) && isIdentifier(world) && isRevision(expectedRevision) && grid !== undefined
    ? { _tag: 'CraftingCommand', commandId, player, world, expectedRevision, grid }
    : undefined
}
