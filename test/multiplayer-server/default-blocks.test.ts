import { PLACEABLE_ITEM_TYPES, UNITEMISED_BLOCK_TYPES } from '@nerima-games/mc-kernel'
import { describe, expect, it } from 'vitest'

import { DEFAULT_BLOCKS } from '../../apps/multiplayer-server/default-blocks'

describe('multiplayer default block admission', () => {
  it('uses the kernel placement roster without admitting state-only blocks', () => {
    expect([...DEFAULT_BLOCKS]).toEqual(PLACEABLE_ITEM_TYPES)
    expect(DEFAULT_BLOCKS.size).toBe(PLACEABLE_ITEM_TYPES.length)
    expect(UNITEMISED_BLOCK_TYPES.every((block) => !DEFAULT_BLOCKS.has(block))).toBe(true)
  })
})
