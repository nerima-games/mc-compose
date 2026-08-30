import type { GeometryQuad, QuadColor } from '@nerima-games/mc-render'
import { Effect } from 'effect'

type ChunkRef = { readonly cx: number; readonly cz: number }

export type RenderLightingSnapshot = {
  readonly resolvedChunks: number
  readonly sampledQuads: number
  readonly darkestShade: number | null
  readonly brightestShade: number | null
  readonly lastChunk: ChunkRef | null
}

export const trackChunkLightColor = (
  // `quads` is only ever forwarded to `resolve` and never inspected by name
  // here, so widening from MeshQuad to mc-render's full GeometryQuad union
  // (its syncWorld's colorForChunk signature) changes nothing behaviorally.
  resolve: (chunk: ChunkRef, quads: ReadonlyArray<GeometryQuad>) => Effect.Effect<QuadColor>,
): {
  readonly colorForChunk: typeof resolve
  readonly snapshot: () => RenderLightingSnapshot
} => {
  let resolvedChunks = 0
  let sampledQuads = 0
  let darkestShade: number | null = null
  let brightestShade: number | null = null
  let lastChunk: ChunkRef | null = null

  return {
    colorForChunk: (chunk, quads) =>
      resolve(chunk, quads).pipe(
        Effect.map((color) => {
          resolvedChunks += 1
          lastChunk = chunk
          return (quad) => {
            const result = color(quad)
            const shade = result[0]
            sampledQuads += 1
            darkestShade = darkestShade === null ? shade : Math.min(darkestShade, shade)
            brightestShade = brightestShade === null ? shade : Math.max(brightestShade, shade)
            return result
          }
        }),
      ),
    snapshot: () => ({
      resolvedChunks,
      sampledQuads,
      darkestShade,
      brightestShade,
      lastChunk,
    }),
  }
}
