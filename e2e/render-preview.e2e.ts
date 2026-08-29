/**
 * The fixture chunk, drawn on a real GPU, asserted in pixels.
 *
 * This is the first assertion in the organisation about what is ON THE SCREEN.
 * Every prior browser test asked whether a context existed (#1) or whether the
 * loop ran (#4); `smoke.e2e.ts` says so itself — "What this still does NOT
 * assert: that anything is VISIBLE".
 *
 * WHAT IT IS AN ASSERTION ABOUT: the render path. The quads are a fixture
 * written in `apps/render-preview/preview.ts`, not generated terrain, because
 * this preview isolates the renderer's geometry/material contract from world
 * generation. A passing run here means geometry, the shader material and the
 * atlas sampler work end to end; it does NOT mean a world reaches the page,
 * and the day-one world test is intentionally separate.
 */
import { expect, test } from '@playwright/test'

test.describe('the render path puts pixels on the screen', () => {
  test('a fixture chunk draws, and its tiles are distinguishable', async ({ page }) => {
    await page.goto('/apps/render-preview/index.html')

    await expect(page.locator('body')).toHaveAttribute('data-render-preview', 'drawn', {
      timeout: 30_000,
    })

    const drawn = Number(await page.locator('body').getAttribute('data-pixels-drawn'))
    const colours = Number(await page.locator('body').getAttribute('data-tile-colours'))

    // Kept as an artefact rather than compared to a baseline. A reference image
    // is a separate decision — it needs a home, a review process for updating
    // it, and an answer for SwiftShader's rasterisation differing from a real
    // driver's. This is the picture a human looks at; the numbers above are
    // what the test actually enforces.
    await page.screenshot({ path: 'test-results/render-preview.png' })
    console.log(await page.locator('#preview-report').textContent())

    // A THOUSAND pixels, not one. A single non-sky pixel would also be produced
    // by a stray line or a depth-buffer artefact; a 12x12 slab seen from above
    // covers a substantial part of a 640x360 frame, and anything much smaller
    // means the geometry is degenerate or the camera is inside it.
    expect(drawn).toBeGreaterThan(1_000)

    // THE tileIndex ASSERTION, and the reason the fixture chequers its block
    // ids. The generated atlas gives every tile a different hue, so a broken
    // tile path — the attribute unbound, or bound at the wrong stride — renders
    // the whole slab in tile 0's single colour. More than one colour means the
    // per-vertex index survived the trip to the fragment stage.
    expect(colours).toBeGreaterThan(1)
  })

  test('the frame is not uniformly one colour', async ({ page }) => {
    // Guards the count above from being satisfied by a shader that failed to
    // link and painted everything black: that would be "not sky" for every
    // pixel and would pass `drawn > 1000` on its own.
    await page.goto('/apps/render-preview/index.html')
    await expect(page.locator('body')).toHaveAttribute('data-render-preview', 'drawn', {
      timeout: 30_000,
    })

    const drawn = Number(await page.locator('body').getAttribute('data-pixels-drawn'))
    const total = 640 * 360

    expect(drawn).toBeLessThan(total)
  })
})

test.describe('the preview is interactive', () => {
  test('the frame loop runs, and WASD moves the camera through the terrain', async ({ page }) => {
    await page.goto('/apps/render-preview/index.html')
    await expect(page.locator('body')).toHaveAttribute('data-preview-interactive', 'ready', {
      timeout: 30_000,
    })

    // The loop advances on its own.
    await expect
      .poll(async () => Number(await page.locator('body').getAttribute('data-preview-frames')), {
        timeout: 10_000,
      })
      .toBeGreaterThan(5)

    // THE INPUT PATH, END TO END. Holding W must move the camera, through
    // mc-render's own `InputService` and its binding table — not through a key
    // listener this page owns, which would demonstrate nothing about the module.
    //
    // The POSE is asserted rather than a pixel checksum. `preserveDrawingBuffer`
    // is false, so `readPixels` from a Playwright evaluate (a different task
    // from the draw) reads a cleared buffer; the first cut of this test compared
    // two such reads and they were equal, and it would have stayed equal even
    // if the camera had moved. That the pose reaches the screen is what the
    // static assertions above establish.
    const before = await page.locator('body').getAttribute('data-preview-pos')

    await page.locator('#preview-canvas').click()
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(600)
    await page.keyboard.up('KeyW')

    const after = await page.locator('body').getAttribute('data-preview-pos')

    expect(after).not.toBe(before)
  })
})

test.describe('chunks stream as the camera moves', () => {
  test('moving loads chunks ahead and drops chunks behind', async ({ page }) => {
    await page.goto('/apps/render-preview/index.html')
    await expect(page.locator('body')).toHaveAttribute('data-preview-interactive', 'ready', {
      timeout: 30_000,
    })

    const loadedAtStart = Number(await page.locator('body').getAttribute('data-chunks-loaded'))
    expect(loadedAtStart).toBeGreaterThan(0)

    // Fly far enough to cross several chunk boundaries. `syncWorld` drains once
    // per frame and the source reports the DIFFERENCE between what should be
    // loaded around the camera and what is, so crossing a boundary must both
    // add chunks ahead and drop chunks behind.
    await page.locator('#preview-canvas').click()
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2_500)
    await page.keyboard.up('KeyW')

    const streamedIn = Number(await page.locator('body').getAttribute('data-chunks-streamed-in'))
    const dropped = Number(await page.locator('body').getAttribute('data-chunks-dropped'))

    // MORE than the first load: the initial fill happens before the loop, so
    // anything counted here was streamed in because the camera moved.
    expect(streamedIn).toBeGreaterThan(0)

    // The other half, and the one that catches a leak. A renderer that only
    // ever added would keep every chunk it had ever seen — which looks correct
    // on screen and grows without bound.
    expect(dropped).toBeGreaterThan(0)
  })
})
