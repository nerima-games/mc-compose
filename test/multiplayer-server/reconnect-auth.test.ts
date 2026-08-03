import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createReconnectAuth, RECONNECT_TOKEN_BYTES } from '../../apps/multiplayer-server/reconnect-auth'

describe('reconnect auth', () => {
  it('persists only a SHA-256 hash and restores it after restart', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-auth-')), 'state.json')
    const auth = await createReconnectAuth(stateFile)
    const token = await auth.issue('alice')

    expect(token).toBeDefined()
    if (token === undefined) throw new Error('token was not issued')
    expect(Buffer.from(token, 'base64url')).toHaveLength(RECONNECT_TOKEN_BYTES)
    const persisted = JSON.parse(await readFile(`${stateFile}.auth.json`, 'utf8')) as {
      format: number
      players: Record<string, { current: string; previous?: string }>
    }
    expect(persisted.format).toBe(2)
    expect(persisted.players['alice']?.current).toBe(createHash('sha256').update(token).digest('hex'))
    expect(JSON.stringify(persisted)).not.toContain(token)

    const restarted = await createReconnectAuth(stateFile)
    await expect(restarted.rotate('alice', token)).resolves.toBeDefined()
  })

  it('rotates on success, permits one response-loss recovery, and rejects replay and cross-player tokens', async () => {
    const auth = await createReconnectAuth()
    const alice = await auth.issue('alice')
    const bob = await auth.issue('bob')
    if (alice === undefined || bob === undefined) throw new Error('token was not issued')

    await expect(auth.rotate('bob', alice)).resolves.toBeUndefined()
    const rotated = await auth.rotate('alice', alice)
    expect(rotated).toBeDefined()
    const recovered = await auth.rotate('alice', alice)
    expect(recovered).toBeDefined()
    await expect(auth.rotate('alice', alice)).resolves.toBeUndefined()
    await expect(auth.rotate('alice', rotated as string)).resolves.toBeUndefined()
    await expect(auth.rotate('alice', recovered as string)).resolves.toBeDefined()
  })

  it('persists response-loss recovery and migrates format 1 records', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-auth-')), 'state.json')
    const token = Buffer.alloc(RECONNECT_TOKEN_BYTES, 7).toString('base64url')
    await writeFile(`${stateFile}.auth.json`, JSON.stringify({
      format: 1,
      players: { alice: createHash('sha256').update(token).digest('hex') },
    }), 'utf8')

    const auth = await createReconnectAuth(stateFile)
    const rotated = await auth.rotate('alice', token)
    expect(rotated).toBeDefined()
    const restarted = await createReconnectAuth(stateFile)
    const recovered = await restarted.rotate('alice', token)
    expect(recovered).toBeDefined()
    await expect(restarted.rotate('alice', token)).resolves.toBeUndefined()
    await expect(restarted.rotate('alice', rotated as string)).resolves.toBeUndefined()
  })

  it('fails closed when persisted auth is corrupt', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-auth-')), 'state.json')
    await writeFile(`${stateFile}.auth.json`, '{"format":1,"players":{"alice":"token"}}', 'utf8')

    await expect(createReconnectAuth(stateFile)).rejects.toThrow(/invalid reconnect auth file/)
  })

  it('rolls back issue and rotation when persistence fails', async () => {
    const stateFile = join(await mkdtemp(join(tmpdir(), 'mc-compose-auth-')), 'state.json')
    const authPath = `${stateFile}.auth.json`
    const auth = await createReconnectAuth(stateFile)

    await mkdir(authPath)
    await expect(auth.issue('alice')).rejects.toThrow()
    expect(auth.has('alice')).toBe(false)
    await rm(authPath, { recursive: true })

    const token = await auth.issue('alice')
    if (token === undefined) throw new Error('token was not issued after rollback')
    await rm(authPath)
    await mkdir(authPath)
    await expect(auth.rotate('alice', token)).rejects.toThrow()
    await rm(authPath, { recursive: true })

    await expect(auth.rotate('alice', token)).resolves.toBeDefined()
  })
})
