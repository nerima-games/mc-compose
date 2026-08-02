import { createHash, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export interface LegacyPlayerClaims {
  readonly has: (player: string) => boolean
  readonly verify: (player: string, secret: string) => boolean
}

const SHA256_HEX = /^[a-f0-9]{64}$/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const invalidClaimsFile = (path: string, cause?: unknown): Error =>
  new Error(`invalid legacy player claims file: ${path}`, cause === undefined ? undefined : { cause })

const decodeClaims = (source: string, path: string): Map<string, Buffer> => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw invalidClaimsFile(path, error)
  }

  if (!isRecord(value)) {
    throw invalidClaimsFile(path)
  }
  const record = value
  const topLevelKeys = Object.keys(record)
  if (
    topLevelKeys.length !== 2
    || !topLevelKeys.includes('format')
    || !topLevelKeys.includes('players')
    || record['format'] !== 1
    || !isRecord(record['players'])
  ) {
    throw invalidClaimsFile(path)
  }

  const entries = Object.entries(record['players'])
  if (entries.some(([player, hash]) => player.length === 0 || typeof hash !== 'string' || !SHA256_HEX.test(hash))) {
    throw invalidClaimsFile(path)
  }
  return new Map(entries.map(([player, hash]) => [player, Buffer.from(hash as string, 'hex')] as const))
}

export const loadLegacyPlayerClaims = async (path: string): Promise<LegacyPlayerClaims> => {
  let source: string
  try {
    source = await readFile(path, 'utf8')
  } catch (error) {
    throw invalidClaimsFile(path, error)
  }
  const claims = decodeClaims(source, path)

  return {
    has: (player) => claims.has(player),
    verify: (player, secret) => {
      const expected = claims.get(player)
      if (expected === undefined) return false
      const actual = createHash('sha256').update(secret).digest()
      return timingSafeEqual(actual, expected)
    },
  }
}
