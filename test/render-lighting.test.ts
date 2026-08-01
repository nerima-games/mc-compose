import type { MeshQuad, QuadColor } from '@nerima-games/mc-render'
import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'

import { trackChunkLightColor } from '../apps/web/render-lighting'

describe('render lighting tracking', () => {
  it('reports the actual shades consumed by chunk geometry', () => {
    const quad = { direction: 'top' } as unknown as MeshQuad
    const tracked = trackChunkLightColor(() =>
      Effect.succeed((() => [64, 64, 64] as const) satisfies QuadColor),
    )
    const color = Effect.runSync(tracked.colorForChunk({ cx: 2, cz: -3 }, [quad]))

    expect(color(quad)).toEqual([64, 64, 64])
    expect(tracked.snapshot()).toEqual({
      resolvedChunks: 1,
      sampledQuads: 1,
      darkestShade: 64,
      brightestShade: 64,
      lastChunk: { cx: 2, cz: -3 },
    })
  })
})
