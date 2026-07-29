import { describe, expect, it } from 'vitest'

import {
  createSessionHref,
  createUniqueSessionId,
  readSessionId,
  readSessionRoute,
  sessionHref,
  sessionIdFromSearch,
} from '../apps/web/session-navigation'

describe('session navigation', () => {
  it('accepts supported session ids from the URL', () => {
    expect(readSessionId('?session=primary')).toBe('primary')
    expect(readSessionId('?session=e2e')).toBe('e2e')
    expect(readSessionId('?session=my-world-123e4567-e89b-12d3-a456-426614174000')).toBe(
      'my-world-123e4567-e89b-12d3-a456-426614174000',
    )
    expect(sessionIdFromSearch('?session=primary')).toBe('primary')
  })

  it('rejects missing and invalid session ids from the URL', () => {
    expect(sessionIdFromSearch('')).toBeUndefined()
    expect(sessionIdFromSearch('?session=')).toBeUndefined()
    expect(readSessionId('?session=World')).toBeUndefined()
    expect(readSessionId('?session=world%00id')).toBeUndefined()
    expect(readSessionId('?session=-world')).toBeUndefined()
    expect(readSessionId('?session=world_name')).toBeUndefined()
  })

  it('enforces the 128-character session id limit', () => {
    const id127 = `a${'-'.repeat(126)}`
    const id128 = `a${'-'.repeat(127)}`
    const id129 = `a${'-'.repeat(128)}`

    expect(readSessionId(`?session=${id127}`)).toBe(id127)
    expect(readSessionId(`?session=${id128}`)).toBe(id128)
    expect(readSessionId(`?session=${id129}`)).toBeUndefined()
  })

  it('encodes session ids when constructing a game URL', () => {
    expect(sessionHref('World / One')).toBe('/?session=World%20%2F%20One')
  })

  it('round-trips Unicode and reserved characters in creation metadata', () => {
    const href = createSessionHref('world-123', {
      name: '鉱山 & Plains / 100%?',
      mode: 'survival',
    })

    expect(readSessionRoute(new URL(href, 'https://example.test').search)).toEqual({
      kind: 'create',
      sessionId: 'world-123',
      metadata: { name: '鉱山 & Plains / 100%?', mode: 'survival' },
    })
    expect(readSessionRoute('?session=world-123')).toEqual({
      kind: 'load',
      sessionId: 'world-123',
    })
  })

  it('rejects incomplete or invalid creation routes', () => {
    expect(readSessionRoute('?session=world-123&create=1&name=World')).toBeUndefined()
    expect(readSessionRoute('?session=world-123&create=1&name=&mode=survival')).toBeUndefined()
    expect(readSessionRoute('?session=world-123&create=1&name=World&mode=spectator')).toBeUndefined()
    expect(readSessionRoute('?session=world-123&create=1&name=World&mode=creative')).toBeUndefined()
    expect(readSessionRoute('?session=world-123&name=World&mode=survival')).toBeUndefined()
  })

  it('normalizes and bounds creation world names', () => {
    expect(readSessionRoute('?session=world-123&create=1&name=%20World%20&mode=survival')).toEqual({
      kind: 'create',
      sessionId: 'world-123',
      metadata: { name: 'World', mode: 'survival' },
    })
    expect(readSessionRoute('?session=world-123&create=1&name=%20%20&mode=survival')).toBeUndefined()

    const name128 = 'w'.repeat(128)
    const name129 = 'w'.repeat(129)
    expect(readSessionRoute(`?session=world-123&create=1&name=${name128}&mode=survival`))
      .toMatchObject({ metadata: { name: name128 } })
    expect(readSessionRoute(`?session=world-123&create=1&name=${name129}&mode=survival`))
      .toBeUndefined()
  })

  it('retries random ids that already exist', () => {
    const values = ['duplicate', 'unique'][Symbol.iterator]()
    expect(
      createUniqueSessionId(
        'My World',
        ['my-world-duplicate'],
        () => values.next().value ?? 'fallback',
      ),
    ).toBe('my-world-unique')
  })

  it('fails after all 32 random ids collide', () => {
    let attempts = 0
    expect(() =>
      createUniqueSessionId('My World', ['my-world-duplicate'], () => {
        attempts += 1
        return 'duplicate'
      }),
    ).toThrowError('Could not allocate a unique session id')
    expect(attempts).toBe(32)
  })
})
