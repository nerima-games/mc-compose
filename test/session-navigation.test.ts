import { describe, expect, it } from 'vitest'

import {
  createUniqueSessionId,
  sessionHref,
  sessionIdFromSearch,
} from '../apps/web/session-navigation'

describe('session navigation', () => {
  it('boots a session only when a non-empty session query is present', () => {
    expect(sessionIdFromSearch('')).toBeUndefined()
    expect(sessionIdFromSearch('?session=')).toBeUndefined()
    expect(sessionIdFromSearch('?session=World%20One')).toBe('World One')
  })

  it('encodes session ids when constructing a game URL', () => {
    expect(sessionHref('World / One')).toBe('/?session=World%20%2F%20One')
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
})
