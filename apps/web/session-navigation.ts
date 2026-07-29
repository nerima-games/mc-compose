const SESSION_ID_ATTEMPTS = 32
const MAX_SESSION_ID_LENGTH = 128
const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u

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

export const sessionIdFromSearch = readSessionId

export const sessionHref = (sessionId: string): string =>
  `/?session=${encodeURIComponent(sessionId)}`

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
