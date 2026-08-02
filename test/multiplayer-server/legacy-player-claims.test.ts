import { createHash } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadLegacyPlayerClaims } from '../../apps/multiplayer-server/legacy-player-claims'

const hash = (secret: string): string => createHash('sha256').update(secret).digest('hex')

const writeClaims = async (value: unknown): Promise<string> => {
  const path = join(await mkdtemp(join(tmpdir(), 'mc-compose-legacy-claims-')), 'claims.json')
  await writeFile(path, JSON.stringify(value), 'utf8')
  return path
}

describe('legacy player claims', () => {
  it('verifies a player-specific secret without storing the secret itself', async () => {
    const secret = 'alice-one-time-secret'
    const path = await writeClaims({ format: 1, players: { alice: hash(secret), bob: hash('bob-secret') } })
    const claims = await loadLegacyPlayerClaims(path)

    expect(claims.has('alice')).toBe(true)
    expect(claims.has('charlie')).toBe(false)
    expect(claims.verify('alice', secret)).toBe(true)
    expect(claims.verify('alice', 'wrong-secret')).toBe(false)
    expect(claims.verify('bob', secret)).toBe(false)
    expect(claims.verify('charlie', secret)).toBe(false)
    expect(await readFile(path, 'utf8')).not.toContain(secret)
  })

  it.each([
    ['invalid JSON', '{'],
    ['null', 'null'],
    ['array', '[]'],
    ['invalid format', JSON.stringify({ format: 2, players: {} })],
    ['missing format', JSON.stringify({ players: {} })],
    ['missing players', JSON.stringify({ format: 1 })],
    ['extra top-level key', JSON.stringify({ format: 1, players: {}, extra: true })],
    ['null players', JSON.stringify({ format: 1, players: null })],
    ['array players', JSON.stringify({ format: 1, players: [] })],
    ['empty player', JSON.stringify({ format: 1, players: { '': hash('secret') } })],
    ['non-string hash', JSON.stringify({ format: 1, players: { alice: 1 } })],
    ['short hash', JSON.stringify({ format: 1, players: { alice: 'abcd' } })],
    ['uppercase hash', JSON.stringify({ format: 1, players: { alice: hash('secret').toUpperCase() } })],
    ['extra player record', JSON.stringify({ format: 1, players: { alice: { hash: hash('secret') } } })],
  ])('fails closed for %s', async (_label, source) => {
    const path = join(await mkdtemp(join(tmpdir(), 'mc-compose-legacy-claims-')), 'claims.json')
    await writeFile(path, source, 'utf8')

    await expect(loadLegacyPlayerClaims(path)).rejects.toThrow(/invalid legacy player claims file/)
  })

  it('fails closed when the file cannot be read', async () => {
    await expect(loadLegacyPlayerClaims('/missing/legacy-player-claims.json'))
      .rejects.toThrow(/invalid legacy player claims file/)
  })
})
