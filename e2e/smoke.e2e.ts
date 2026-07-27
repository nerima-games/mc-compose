/**
 * docs/e2e-triage.md §3.1 — the four smoke tests that stay in mc-compose.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * The reference implementation's `e2e/smoke/` is 7 tests / 104 LOC. Three were
 * DEMOTEd to mx-ui and have been written there (#2, #5, #6). These are the
 * other four: #1, #3, #4, #7.
 *
 * ---------------------------------------------------------------------------
 * What these are allowed to assert, and what would make them worthless
 * ---------------------------------------------------------------------------
 *
 * docs/testing.md §3.4 names the failure mode this file must not become: a
 * suite composed of fakes verifies the fakes. So every assertion below is about
 * the three REAL modules the page composes (mc-render, mx-ui, mx-redstone), and
 * where a claim cannot yet be made about real code it is marked `fixme` with
 * the measurement that says why — never softened into something that passes.
 *
 * §0 of the triage puts it as "主張を運ぶ": `does not crash` is not a claim.
 * #16 and #17 are OBSOLETE in the triage for exactly that reason, and nothing
 * here is allowed to reintroduce the shape.
 */
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

/** docs/testing.md §3.3. Deliberately not the reference's `__TS_MINECRAFT_QA__`. */
const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

/**
 * Collect everything that would count as a fatal startup error.
 *
 * `pageerror` and not merely `console.error`: an uncaught exception during
 * module evaluation does NOT always reach the console as an error record, and
 * that is the exact failure #3 exists to catch — the entry point throwing
 * before it ever composes anything.
 *
 * The reference's `helpers/console-monitor.ts` is the ancestor of this
 * (docs/e2e-triage.md §6 assigns it to mc-compose). It is inline rather than
 * extracted because there is one consumer; extract it at the second.
 */
type PageFaults = {
  readonly consoleErrors: ReadonlyArray<string>
  readonly pageErrors: ReadonlyArray<string>
}

const watchForFaults = (page: Page): PageFaults => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text())
    }
  })
  page.on('pageerror', (error: Error) => {
    pageErrors.push(`${error.name}: ${error.message}`)
  })

  return { consoleErrors, pageErrors }
}

const bootState = (page: Page): Promise<string | null> =>
  page.locator('body').getAttribute('data-mc-compose-boot')

const framesDrawn = async (page: Page): Promise<number> => {
  const raw = await page.locator('body').getAttribute('data-frames')
  return raw === null ? 0 : Number(raw)
}

test.describe('smoke — the composed frame in a real browser', () => {
  /**
   * #1 `WebGL2 canvas is present and active`.
   *
   * NOT WRITTEN, and this is the measurement rather than an omission. mc-render
   * draws nothing: `stages/registration.ts`'s `render:draw` is
   * `Ref.update(state.framesDrawn, (drawn) => drawn + 1)`, the repository has no
   * `three` dependency in its package.json, and it contains no `getContext` call
   * anywhere. Its THREE.js surface is a documented FIRST CUT seam.
   *
   * The entry point could satisfy this test in one line — `canvas.getContext(
   * 'webgl2')` — and that line is the reason this is `fixme` instead. It would
   * make the test green while asserting nothing whatsoever about mc-render, and
   * mc-compose drawing anything is the prime-directive violation
   * `domain/composition.ts` exists to prevent.
   *
   * UNBLOCKED BY: a real renderer in mc-render's `render:draw`.
   */
  test.fixme('#1 WebGL2 canvas is present and active', async ({ page }) => {
    await page.goto('/')
    const hasContext = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas')
      return canvas instanceof HTMLCanvasElement && canvas.getContext('webgl2') !== null
    })
    expect(hasContext).toBe(true)
  })

  /**
   * #3 `no fatal startup errors before game session`.
   *
   * The triage's note on this row is "全 Layer が起動時に落ちないこと = 合成の主張",
   * and that is what makes it a compose test rather than a module test: it is
   * the merge of three independently-authored Layers, plus the registration
   * Effects that acquire services, plus `composeGame`'s resolver — and no single
   * repository can run any of that.
   */
  test('#3 no fatal startup errors before the frame starts', async ({ page }) => {
    const faults = watchForFaults(page)

    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    // `boot-status` is written only by `failBoot`. Empty means no path through
    // boot reported a failure — which is a stronger claim than "no exception
    // reached the console", because `composeGame` returning a Left is a
    // FAILURE THAT THROWS NOTHING.
    await expect(page.locator('#boot-status')).toBeEmpty()

    expect(faults.pageErrors).toEqual([])
    expect(faults.consoleErrors).toEqual([])
  })

  /**
   * #3b The composition actually resolved a total order — the browser twin of
   * `test/e2e/roster-frame-order.test.ts`.
   *
   * That test proves half (a) of plan.md §3.15 from a hand-transcribed manifest
   * (docs/testing.md §3.4). This proves it from the modules THAT ACTUALLY
   * LOADED, which is the one thing the transcript cannot do — §3.5 records that
   * the transcript has already been wrong once, listing six stage ids that no
   * module registered, and staying green for it.
   *
   * Nine stages, not sixteen: three modules are composed, not six. The exact
   * ids are asserted rather than the count, because a count is satisfied by any
   * nine things.
   */
  test('#3b the resolved stage order is the one the loaded modules declare', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const order = await page.locator('#stage-order').textContent()

    expect(order?.split(' ')).toEqual([
      'render:input',
      'redstone:power',
      'redstone:effects',
      'render:camera-mirror',
      'render:chunk-sync',
      'render:draw',
      'render:post-fx',
      'ui:hud-sync',
      'ui:overlay-sync',
    ])
  })

  /**
   * #4 `game loop starts and FPS counter becomes non-zero`.
   *
   * "フレームが回る = `runFrameWith` が実際に駆動している" — the triage's own gloss,
   * and the reason the assertion is on a COUNT THAT RISES rather than on the
   * counter being non-zero once. A counter stuck at its first value satisfies
   * "non-zero" forever, and a frame loop that ran once and threw is exactly the
   * failure this is for.
   */
  test('#4 the frame loop runs and the FPS readout becomes non-zero', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    // The FPS readout is recomputed on a 0.5s window, so the first value takes
    // that long to appear. Waiting for the DOM rather than sleeping.
    await expect(page.locator('#fps-value')).not.toHaveText('0', { timeout: 10_000 })

    const fps = Number(await page.locator('#fps-value').textContent())
    expect(fps).toBeGreaterThan(0)

    const before = await framesDrawn(page)
    await page.waitForTimeout(1_000)
    const after = await framesDrawn(page)

    expect(after).toBeGreaterThan(before)
  })

  /**
   * #4b The QA surface is installed.
   *
   * A boot milestone, not a feature test: `installQaApi` runs after composition
   * and before the loop, so its presence dates the boot. The surface is EMPTY
   * and the assertion says so — `domain/qa-api.ts` is explicit that compose
   * authors no commands, and no composed module contributes a namespace yet.
   * Asserting emptiness is what makes the first real namespace show up here as
   * a deliberate change rather than as drift.
   */
  test('#4b the QA surface is installed, and is empty', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const surface = await page.evaluate(
      (key) => {
        const published = (globalThis as unknown as Record<string, unknown>)[key]
        return published === undefined ? undefined : Object.keys(published as object)
      },
      QA_GLOBAL_KEY,
    )

    expect(surface).toEqual([])
  })

  /**
   * #7 `no fatal startup errors during session`.
   *
   * The same claim as #3 held over TIME, and the difference is the point: #3
   * catches a Layer that fails to build, #7 catches a stage that defects on
   * frame 400. `apps/web/main.ts` stops the loop on a defect and writes
   * `data-mc-compose-boot="failed"`, so a defect is observable rather than
   * merely loud — a frame that throws sixty times a second buries its own first
   * occurrence.
   */
  test('#7 no fatal errors during a sustained session', async ({ page }) => {
    const faults = watchForFaults(page)

    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    await page.waitForTimeout(5_000)

    expect(await bootState(page)).toBe('running')
    expect(faults.pageErrors).toEqual([])
    expect(faults.consoleErrors).toEqual([])

    // Still advancing at the end of the window, not merely un-crashed.
    const before = await framesDrawn(page)
    await page.waitForTimeout(500)
    expect(await framesDrawn(page)).toBeGreaterThan(before)
  })

  /**
   * mx-ui mounted into the page it was handed.
   *
   * The browser half of `mx-ui/test/screen-mount.test.ts`. That test proves
   * mounting against `test/fake-dom.ts`; this proves the same call works
   * against a real `Document` — which is the claim `mx-ui`'s
   * `application/dom-surface.ts` header makes and calls "checked by CI rather
   * than by a comment": that `Document` and `HTMLElement` satisfy its types
   * WITHOUT A CAST, and `apps/web/main.ts` passes `document` straight in.
   */
  test('mx-ui screens mount into the host-supplied parent', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    await expect(page.locator('#hud-root [data-mx-ui="hud"]')).toHaveCount(1)
    await expect(page.locator('#hud-root [data-mx-ui="crosshair"]')).toHaveCount(1)

    // The HUD projected the spawn snapshot: ten hearts and ten shanks. Reading
    // the icon rows rather than a screenshot, because the claim is that the
    // view model reached the DOM, not that it looks a particular way.
    await expect(page.locator('[data-mx-ui="vitals"] [data-mx-ui="icon"]')).toHaveCount(20)
    await expect(page.locator('[data-mx-ui="vitals"] [data-icon="heart"]')).toHaveCount(10)
    await expect(page.locator('[data-mx-ui="vitals"] [data-icon="shank"]')).toHaveCount(10)
  })
})
