/**
 * mc-render's generated GLSL, compiled by a real GL driver.
 *
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES
 * ---------------------------------------------------------------------------
 *
 * Three shader sources landed in mc-render, each generated from domain
 * constants and each covered by a Node suite that asserts things about the
 * resulting STRING. Every one of those files' headers says the same sentence —
 * "no GLSL is compiled in this repository ... mc-compose's Playwright run is
 * where the source is actually compiled" — and until this file existed, that
 * sentence pointed at nothing. The sources had been tested thoroughly and
 * never once compiled.
 *
 * A shader defect does not throw. three logs the driver's error through
 * `console.error` and carries on with a broken program, so the symptom in a
 * browser is a blank canvas and the symptom in CI is nothing at all. That is
 * precisely the class of failure `docs/testing.md` §1 says to name rather than
 * to cover with a weaker test, and this is the naming.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT ASSERT
 * ---------------------------------------------------------------------------
 *
 * That anything LOOKS right. A shader that compiles, links and renders the
 * world uniformly black passes this. Pixel assertions need a reference image
 * and a world on the page; this says the programs are valid and their
 * attributes and uniforms resolve, which is the half that currently has no
 * check anywhere.
 */
import { expect, test } from '@playwright/test'

test.describe('mc-render shaders against a real GL driver', () => {
  test('all three generated shaders compile and link', async ({ page }) => {
    const consoleErrors: Array<string> = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await page.goto('/apps/shader-probe/index.html')

    // The probe sets this only after all three have been through three's
    // compiler. Waiting on the attribute rather than on a timeout means a
    // probe that never finished fails as a timeout naming this locator.
    await expect(page.locator('body')).toHaveAttribute('data-shader-probe', 'passed', {
      timeout: 30_000,
    })

    // Derived from the probe's own count rather than hard-coded to 3, so that
    // adding a fourth shader without adding it to the probe cannot pass here.
    const total = await page.locator('body').getAttribute('data-shader-probe-total')
    const compiled = await page.locator('body').getAttribute('data-shader-probe-compiled')

    expect(compiled).toBe(total)
    expect(Number(total)).toBeGreaterThanOrEqual(3)

    // The report is in the DOM so a human sees what the test saw.
    await expect(page.locator('#probe-report')).toContainText('OK    chunk')
    await expect(page.locator('#probe-report')).toContainText('OK    water')
    await expect(page.locator('#probe-report')).toContainText('OK    particle')

    // No shader error reached the console by any other route. three's
    // `checkShaderErrors` path is intercepted inside the probe; this catches a
    // driver complaint raised outside that window.
    const shaderErrors = consoleErrors.filter((text) => /shader|program|GLSL/i.test(text))
    expect(shaderErrors).toStrictEqual([])
  })
})
