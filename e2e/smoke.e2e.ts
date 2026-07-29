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
   * UNBLOCKED. It was `fixme` because mc-render drew nothing — `render:draw`
   * was `Ref.update(state.framesDrawn, (drawn) => drawn + 1)` and the
   * repository had no `three` dependency and no `getContext` call anywhere. It
   * now has `application/world-renderer.ts`, whose `makeWorldRenderer` runs
   * `new WebGLRenderer({ canvas })`, and `apps/web/main.ts` hands it the
   * element and the `three` namespace.
   *
   * ---------------------------------------------------------------------------
   * THE OBVIOUS ASSERTION IS WORTHLESS, AND THIS WAS MEASURED
   * ---------------------------------------------------------------------------
   *
   * The `fixme` body this replaces was:
   *
   *   canvas instanceof HTMLCanvasElement && canvas.getContext('webgl2') !== null
   *
   * IT PASSES WITH NO RENDERER AT ALL. `getContext` is a CONSTRUCTOR, not an
   * accessor: called on a canvas that has none, it creates one and returns it.
   * So the assertion is satisfied by the test itself, on any `<canvas>` in any
   * page. This was confirmed by running it against the previous
   * `apps/web/main.ts` — the one with no renderer — where it went green.
   *
   * That is docs/testing.md §3.4's "偽物のモジュールを4つ作って合成すれば、検証
   * されるのは偽物である" in its purest form: the test was verifying itself. The
   * row was `fixme` for a true reason, and had it ever been un-`fixme`d as
   * written it would have gone green without mc-render moving.
   *
   * So the claim is carried by two assertions that a test CANNOT satisfy for
   * itself, and the naive one is kept only as a postscript:
   *
   *   1. `getContext('2d')` RETURNS NULL. A canvas holds one context, and a
   *      request for an incompatible type on a canvas that already has one is
   *      specified to return null. Null therefore means SOMEBODY ELSE GOT HERE
   *      FIRST — and this is asked before anything in this file has touched the
   *      canvas, so that somebody is mc-render. On a bare canvas it returns a
   *      `CanvasRenderingContext2D` and this test fails.
   *   2. `canvas.width` EQUALS ITS LAYOUT WIDTH. A canvas with no width
   *      attribute is 300x150 regardless of its CSS size, and `index.html`
   *      gives it none — only `renderer.setSize(clientWidth, clientHeight,
   *      false)` inside mc-render makes the two agree. 1280, not 300.
   *
   * ---------------------------------------------------------------------------
   * What this still does NOT assert
   * ---------------------------------------------------------------------------
   *
   * That anything is VISIBLE. The page is a flat sky colour: no chunk geometry
   * reaches it, because `mc-worldgen` and `mc-meshing` are not among the three
   * siblings `vite.config.ts` can resolve, for the reason §4.3 of the triage
   * gives. This says the frame loop has somewhere to draw TO; #4 says the loop
   * runs. A pixel assertion belongs here when a world reaches this page.
   */
  test('#1 WebGL2 canvas is present and active', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const probe = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas')
      if (!(canvas instanceof HTMLCanvasElement)) {
        return undefined
      }
      // FIRST, before this file has touched the canvas: null here means a
      // context of an incompatible type already exists, i.e. mc-render's.
      const twoDimensional = canvas.getContext('2d')
      const gl = canvas.getContext('webgl2')
      return {
        somebodyElseHoldsAContext: twoDimensional === null,
        bufferWidth: canvas.width,
        bufferHeight: canvas.height,
        layoutWidth: canvas.clientWidth,
        layoutHeight: canvas.clientHeight,
        hasWebgl2: gl !== null,
        lost: gl === null || gl.isContextLost(),
      }
    })

    expect(probe).toBeDefined()
    // The two that a test cannot satisfy for itself.
    expect(probe?.somebodyElseHoldsAContext).toBe(true)
    expect(probe?.bufferWidth).toBe(probe?.layoutWidth)
    expect(probe?.bufferHeight).toBe(probe?.layoutHeight)
    expect(probe?.layoutWidth).toBeGreaterThan(0)
    // The naive pair, kept because they are what the row is named after — but
    // they are a postscript to the two above, not the claim.
    expect(probe?.hasWebgl2).toBe(true)
    expect(probe?.lost).toBe(false)
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

    // FOUR MODULES NOW, not three. `gameplayModule` joined when mx-gameplay
    // shipped complete in-memory implementations of the four services it
    // requires; its stages are placed HERE BY THE RESOLVER, from the `after`
    // edges each one declares, not by the order this file registers them in.
    //
    // That is the property worth reading off this list: `gameplay:interactions`
    // lands after `render:input` because it consumes the frame's input, and
    // `gameplay:time-weather` after the redstone pair — neither placement is
    // written anywhere in `apps/web/main.ts`.
    expect(order?.split(' ')).toEqual([
      'render:input',
      'gameplay:interactions',
      'gameplay:entities',
      'gameplay:fluids',
      'redstone:power',
      'redstone:effects',
      'gameplay:time-weather',
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
  test('#4b the QA surface publishes the host persistence contract', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const surface = await page.evaluate(
      (key) => {
        const published = (globalThis as unknown as Record<string, unknown>)[key]
        return published === undefined ? undefined : Object.keys(published as object)
      },
      QA_GLOBAL_KEY,
    )

    expect(surface?.sort()).toEqual([
      'gameplay.breakTarget',
      'gameplay.damage',
      'gameplay.eat',
      'gameplay.heal',
      'gameplay.respawn',
      'gameplay.seedCraftingLog',
      'gameplay.seedFoodUseEncounter',
      'gameplay.seedLethalZombieEncounter',
      'gameplay.seedMeleeDropEncounter',
      'gameplay.setPose',
      'gameplay.setWeather',
      'gameplay.shoot',
      'gameplay.snapshot',
      'persistence.flush',
    ])
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

test.describe('the composed game has a world in it', () => {
  test('#5 chunk geometry reaches the renderer, and the source is declared', async ({ page }) => {
    // The claim #1 could not make. #1 asks whether a WebGL2 context exists;
    // this asks whether anything is IN it. Until `setChunk` had a caller the
    // two were indistinguishable from this page — a context on an empty scene
    // and a context on a world both clear to sky blue.
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const canvas = page.locator('#game-canvas')

    // DECLARED, not inferred. A static fixture cannot satisfy this check.
    await expect(canvas).toHaveAttribute('data-world-source', 'generated')

    const meshed = Number(await canvas.getAttribute('data-chunks-meshed'))
    expect(meshed).toBeGreaterThan(0)
  })

  test('#6 the composed frame draws the world, not just the sky', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'generated')

    // Sampled INSIDE the page and in the same task as a draw: the renderer runs
    // with `preserveDrawingBuffer: false`, so a readPixels from a later task
    // sees a cleared buffer and would report the sky no matter what was drawn.
    const drawn = await page.evaluate(async () => {
      const canvas = document.getElementById('game-canvas') as HTMLCanvasElement
      const gl = canvas.getContext('webgl2')
      if (gl === null) return -1
      return await new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          const pixels = new Uint8Array(canvas.width * canvas.height * 4)
          gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
          // 0x87ceeb, the clear colour, with a tolerance for the float->byte round.
          let nonSky = 0
          for (let at = 0; at < pixels.length; at += 4) {
            const r = pixels[at] ?? 0
            const g = pixels[at + 1] ?? 0
            const b = pixels[at + 2] ?? 0
            if (Math.abs(r - 135) > 2 || Math.abs(g - 206) > 2 || Math.abs(b - 235) > 2) {
              nonSky += 1
            }
          }
          resolve(nonSky)
        })
      })
    })

    expect(drawn).toBeGreaterThan(1_000)

    // The artefact a human looks at. Not compared to a baseline: SwiftShader's
    // rasterisation is not a real driver's, and the scalar above is the claim.
    await page.screenshot({ path: 'test-results/composed-game.png' })
  })
})

test.describe('the player', () => {
  test('#8 falls onto the terrain and is stopped by it', async ({ page }) => {
    // THE ASSERTION THAT SEPARATES "a world is drawn" FROM "a world can be
    // stood on". Before collision, a player either hung in the air or fell
    // forever; neither is visible in a screenshot of the first frame.
    await page.goto('/')
    await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'generated')

    await expect
      .poll(async () => page.locator('#game-canvas').getAttribute('data-player-grounded'), {
        timeout: 15_000,
      })
      .toBe('true')

    const feet = await page.locator('#game-canvas').getAttribute('data-player-feet')
    const y = Number(feet?.split(',')[1])

    // Standing ON the terrain, not inside it and not below the world.
    expect(Number.isFinite(y)).toBe(true)
    expect(y).toBeGreaterThan(0)
  })

  test('#9 holding W moves the player, and the ground still holds', async ({ page }) => {
    await page.goto('/')
    await expect
      .poll(async () => page.locator('#game-canvas').getAttribute('data-player-grounded'), {
        timeout: 15_000,
      })
      .toBe('true')

    const before = await page.locator('#game-canvas').getAttribute('data-player-feet')

    await page.locator('#game-canvas').click()
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(700)
    await page.keyboard.up('KeyW')

    const after = await page.locator('#game-canvas').getAttribute('data-player-feet')

    // Moved...
    expect(after).not.toBe(before)

    // ...and did not fall through the floor doing it. A resolver that only ran
    // on the Y axis would pass the first assertion and fail this one the moment
    // the player walked off the block they spawned on.
    expect(await page.locator('#game-canvas').getAttribute('data-player-grounded')).toBe('true')

    await page.screenshot({ path: 'test-results/playable.png' })
    console.log(`feet before ${String(before)} -> after ${String(after)}`)
  })
})

/**
 * #10 — BREAKING IS NOT TESTED HERE, AND THE REASON IS RECORDED UPSTREAM.
 *
 * The wiring exists: a left click is `attack`, `attack` calls
 * `requestTargetedBlockBreak`, `gameplay:interactions` drains the inbox and writes AIR,
 * and the collision predicate reads that same store. What cannot happen in this
 * runner is the CLICK: mc-render's `InputService` treats a click as a game
 * action only while the pointer is LOCKED — the closed-world predicate that
 * stops a HUD click stealing the pointer — and plan.md §3.10 records that
 * Playwright on SwiftShader cannot do pointer lock at all. mc-render's
 * `apps/preview-render` exists because of the same limit.
 *
 * So the loop is tested one layer down, where it is reachable:
 * `mx-gameplay/test/break-loop.test.ts` resolves the first visible block and
 * enqueues a break through the same public door this host calls, runs the real
 * stage against the real store, and asserts the block is gone.
 *
 * A test that clicked and asserted nothing changed would be worse than this
 * comment, and a test that reached past the lock machine to fake the event
 * would be asserting about a build nobody runs.
 */

test.describe('sustained play', () => {
  test('#11 chunks stream in and out as the player walks', async ({ page }) => {
    // THE DIFFERENCE BETWEEN A DEMO AND A WORLD. A boot-time load of everything
    // passes every earlier test in this file and is the wrong shape: it bounds
    // the world by what fits in memory at once and never releases anything.
    // What this asserts is `syncWorld`'s ADD and its REMOVE.
    await page.goto('/')
    await expect
      .poll(async () => page.locator('#game-canvas').getAttribute('data-player-grounded'), {
        timeout: 15_000,
      })
      .toBe('true')

    const residentAtSpawn = Number(
      await page.locator('#game-canvas').getAttribute('data-chunks-meshed'),
    )
    expect(residentAtSpawn).toBeGreaterThan(0)

    await page.locator('#game-canvas').click()
    await page.keyboard.down('KeyW')
    try {
      // More than the first fill: anything counted here loaded because the player
      // moved. Poll the observable rather than guessing how many frames CI renders.
      await expect
        .poll(
          async () =>
            Number(
              await page.locator('#game-canvas').getAttribute('data-chunks-streamed-in'),
            ),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(residentAtSpawn)

      // And the other half — the one that catches a renderer that only ever adds,
      // which looks correct on screen and grows without bound.
      await expect
        .poll(
          async () =>
            Number(await page.locator('#game-canvas').getAttribute('data-chunks-dropped')),
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0)
    } finally {
      await page.keyboard.up('KeyW')
    }
  })

  test('#12 a sustained session stays healthy: frames advance, no defects, still standing', async ({
    page,
  }) => {
    // Not "does it boot" but "does it keep going". A frame loop that throws on
    // frame 200, a resolver that drifts the player into the floor, or a stream
    // that leaks until it stalls all pass a first-frame assertion.
    const fatal: Array<string> = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        fatal.push(message.text())
      }
    })
    page.on('pageerror', (error) => fatal.push(String(error)))

    await page.goto('/')
    await expect
      .poll(async () => page.locator('#game-canvas').getAttribute('data-player-grounded'), {
        timeout: 15_000,
      })
      .toBe('true')

    const framesAtStart = Number(await page.locator('body').getAttribute('data-frames'))

    // Walk, turn, walk back. Enough frames that a per-frame leak or a drift
    // would show.
    await page.locator('#game-canvas').click()
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(2_000)
    await page.keyboard.up('KeyW')
    await page.keyboard.down('KeyD')
    await page.waitForTimeout(1_500)
    await page.keyboard.up('KeyD')
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(2_000)
    await page.keyboard.up('KeyS')

    const framesAtEnd = Number(await page.locator('body').getAttribute('data-frames'))

    // The loop never stopped. `boot` replaces the body attribute on a defect,
    // so a stalled loop shows here as a count that stopped rising.
    expect(framesAtEnd).toBeGreaterThan(framesAtStart + 100)
    expect(await page.locator('body').getAttribute('data-mc-compose-boot')).toBe('running')

    // Still standing on the world after all of it — not sunk into it, not
    // fallen out of it.
    expect(await page.locator('#game-canvas').getAttribute('data-player-grounded')).toBe('true')
    const feetY = Number(
      (await page.locator('#game-canvas').getAttribute('data-player-feet'))?.split(',')[1],
    )
    expect(feetY).toBeGreaterThan(0)

    expect(fatal).toStrictEqual([])

    await page.screenshot({ path: 'test-results/sustained.png' })
  })
})
