const SESSION_ID_ATTEMPTS = 32

const sessionNameSlug = (name: string): string => {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 40)
  return slug.length > 0 ? slug : 'world'
}

export const sessionIdFromSearch = (search: string): string | undefined => {
  const value = new URLSearchParams(search).get('session')
  return value === null || value.length === 0 ? undefined : value
}

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
