import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const RECONNECT_TOKEN_BYTES = 32

interface PersistedReconnectAuth {
  readonly format: 2
  readonly players: Readonly<Record<string, ReconnectTokenHashes>>
}

interface ReconnectTokenHashes {
  readonly current: string
  readonly previous?: string
}

export interface ReconnectAuth {
  readonly has: (player: string) => boolean
  readonly issue: (player: string) => Promise<string | undefined>
  readonly reissue: (player: string) => Promise<string | undefined>
  readonly rotate: (player: string, token: string) => Promise<string | undefined>
}

const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest()

const decodeToken = (token: string): Buffer | undefined => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined
  const decoded = Buffer.from(token, 'base64url')
  return decoded.length === RECONNECT_TOKEN_BYTES && decoded.toString('base64url') === token
    ? decoded
    : undefined
}

const isHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const decodeTokenHashes = (value: unknown): ReconnectTokenHashes | undefined => {
  if (!isRecord(value) || !isHash(value['current'])) return undefined
  const previous = value['previous']
  if (previous !== undefined && !isHash(previous)) return undefined
  if (Object.keys(value).some((key) => key !== 'current' && key !== 'previous')) return undefined
  return {
    current: value['current'],
    ...(previous === undefined ? {} : { previous }),
  }
}

const decodePersisted = (source: string, path: string): Map<string, ReconnectTokenHashes> => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    throw new Error(`Failed to read reconnect auth: ${path}`, { cause: error })
  }
  if (!isRecord(value)) throw new Error(`invalid reconnect auth file: ${path}`)
  const persisted = value
  if ((persisted['format'] !== 1 && persisted['format'] !== 2) || !isRecord(persisted['players'])) {
    throw new Error(`invalid reconnect auth file: ${path}`)
  }
  const entries = Object.entries(persisted['players'])
  if (persisted['format'] === 1) {
    if (entries.some(([player, hash]) => player.length === 0 || !isHash(hash))) {
      throw new Error(`invalid reconnect auth file: ${path}`)
    }
    return new Map(entries.map(([player, hash]) => [player, { current: hash as string }] as const))
  }
  const decoded = new Map<string, ReconnectTokenHashes>()
  for (const [player, hashesValue] of entries) {
    const hashes = decodeTokenHashes(hashesValue)
    if (player.length === 0 || hashes === undefined) {
      throw new Error(`invalid reconnect auth file: ${path}`)
    }
    decoded.set(player, hashes)
  }
  return decoded
}

const loadHashes = async (path: string | undefined): Promise<Map<string, ReconnectTokenHashes>> => {
  if (path === undefined) return new Map()
  try {
    return decodePersisted(await readFile(path, 'utf8'), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw error
  }
}

const writeHashes = async (path: string, hashes: ReadonlyMap<string, ReconnectTokenHashes>): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${String(process.pid)}.${randomUUID()}.tmp`
  const persisted: PersistedReconnectAuth = { format: 2, players: Object.fromEntries(hashes) }
  await writeFile(temporaryPath, `${JSON.stringify(persisted)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, path)
}

export const createReconnectAuth = async (stateFile?: string): Promise<ReconnectAuth> => {
  const path = stateFile === undefined ? undefined : `${stateFile}.auth.json`
  const hashes = await loadHashes(path)
  let queue = Promise.resolve()

  const mutate = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  const persist = async (): Promise<void> => {
    if (path !== undefined) await writeHashes(path, hashes)
  }

  return {
    has: (player) => hashes.has(player),
    issue: (player) => mutate(async () => {
      if (player.length === 0 || hashes.has(player)) return undefined
      const token = randomBytes(RECONNECT_TOKEN_BYTES).toString('base64url')
      hashes.set(player, { current: hashToken(token).toString('hex') })
      try {
        await persist()
      } catch (error) {
        hashes.delete(player)
        throw error
      }
      return token
    }),
    reissue: (player) => mutate(async () => {
      const expected = hashes.get(player)
      if (player.length === 0 || expected === undefined) return undefined
      const token = randomBytes(RECONNECT_TOKEN_BYTES).toString('base64url')
      hashes.set(player, { current: hashToken(token).toString('hex') })
      try {
        await persist()
      } catch (error) {
        hashes.set(player, expected)
        throw error
      }
      return token
    }),
    rotate: (player, token) => mutate(async () => {
      const decoded = decodeToken(token)
      const expected = hashes.get(player)
      if (decoded === undefined || expected === undefined) return undefined
      const actual = hashToken(token)
      const matchesCurrent = timingSafeEqual(actual, Buffer.from(expected.current, 'hex'))
      const matchesPrevious = expected.previous !== undefined
        && timingSafeEqual(actual, Buffer.from(expected.previous, 'hex'))
      if (!matchesCurrent && !matchesPrevious) return undefined
      const rotated = randomBytes(RECONNECT_TOKEN_BYTES).toString('base64url')
      hashes.set(player, {
        current: hashToken(rotated).toString('hex'),
        ...(matchesCurrent ? { previous: expected.current } : {}),
      })
      try {
        await persist()
      } catch (error) {
        hashes.set(player, expected)
        throw error
      }
      return rotated
    }),
  }
}
