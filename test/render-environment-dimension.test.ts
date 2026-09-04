import { planRenderEnvironment } from '@nerima-games/mc-render'
import { describe, expect, it } from 'vitest'

/**
 * apps/web/main.ts now passes `currentChunkContext.dimension` into every
 * per-frame weather snapshot, where mc-render 0.7.0 previously saw no
 * `dimension` argument at all. The whole risk of that change is altering the
 * overworld sky as a side effect — every existing session is in the
 * overworld, and `planRenderEnvironment`'s own contract (domain/
 * render-environment.ts) is that an absent dimension means overworld.
 *
 * This pins that contract at the exact call boundary apps/web/main.ts
 * relies on: a call omitting `dimension` and a call passing `'overworld'`
 * must produce identical output, across the values that actually vary frame
 * to frame (daylight and far plane). If mc-render ever changed the default
 * away from overworld, this would fail here rather than surfacing as a
 * silently different overworld sky in the browser suite.
 */
describe('planRenderEnvironment overworld default', () => {
  it.each([
    [0, 300],
    [0.08, 300],
    [0.5, 300],
    [1, 300],
    [0.5, 16],
    [0.5, undefined],
  ] as const)('daylight=%s farPlane=%s: omitting dimension matches passing overworld explicitly', (daylight, farPlane) => {
    const omitted = planRenderEnvironment(daylight, farPlane)
    const explicitOverworld = planRenderEnvironment(daylight, farPlane, 'overworld')
    expect(omitted).toEqual(explicitOverworld)
  })
})
