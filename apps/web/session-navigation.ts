import {
  normalizeWorldName,
  type SessionMetadata,
} from './session-persistence'

const SESSION_ID_ATTEMPTS = 32
const MAX_SESSION_ID_LENGTH = 128
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u

export type SessionRoute =
  | { readonly kind: 'load'; readonly sessionId: string }
  | { readonly kind: 'create'; readonly sessionId: string; readonly metadata: SessionMetadata }

const sessionNameSlug = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 40)
  return slug.length > 0 ? slug : 'world'
}

export const readSessionId = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get('session')
  if (
    value === null ||
    value.length === 0 ||
    value.length > MAX_SESSION_ID_LENGTH ||
    !SESSION_ID_PATTERN.test(value)
  ) {
    return undefined
  }
  return value
}

export const sessionIdFromSearch: typeof readSessionId = readSessionId

export const readSessionRoute = (search: string): SessionRoute | undefined => {
  const parameters = new URLSearchParams(search)
  const sessionId = readSessionId(search)
  if (sessionId === undefined) return undefined

  const create = parameters.get('create')
  const name = parameters.get('name')
  const mode = parameters.get('mode')
  const normalizedName = name === null ? undefined : normalizeWorldName(name)
  const hasCreationParameter = create !== null || name !== null || mode !== null
  if (!hasCreationParameter) return { kind: 'load', sessionId }
  if (
    create !== '1'
    || normalizedName === undefined
    || (mode !== 'survival' && mode !== 'creative')
  ) {
    return undefined
  }

  return { kind: 'create', sessionId, metadata: { name: normalizedName, mode } }
}

export const sessionHref = (sessionId: string): string =>
  `/?session=${encodeURIComponent(sessionId)}`

export const createSessionHref = (sessionId: string, metadata: SessionMetadata): string => {
  const parameters = new URLSearchParams({
    session: sessionId,
    create: '1',
    name: metadata.name,
    mode: metadata.mode,
  })
  return `/?${parameters.toString()}`
}

export const createUniqueSessionId = (
  worldName: string,
  existingIds: Iterable<string>,
  randomId: () => string = () => crypto.randomUUID(),
): string => {
  const existing = new Set(existingIds)
  const prefix = sessionNameSlug(worldName)
  for (let attempt = 0; attempt < SESSION_ID_ATTEMPTS; attempt += 1) {
    const candidate = `${prefix}-${randomId()}`
    if (!existing.has(candidate)) return candidate
  }
  throw new Error('Could not allocate a unique session id')
}
