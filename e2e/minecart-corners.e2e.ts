import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const DATABASE_NAME = 'nerima-games-minecraft'

// Mirrors qa-fixtures.ts's QA_RAIL_TRACK_ORIGIN / _WIDTH / _HEIGHT — the loop
// gameplay.seedRailTrackEncounter (apps/web/main.ts) actually builds. Kept as
// a literal here rather than imported, the same way every other *.e2e.ts in
// this suite treats a fixture's shape as expected values rather than a
// shared cross-package import.
const TRACK_ORIGIN = { x: 4, y: 64, z: 24 }
const TRACK_WIDTH = 8
const TRACK_HEIGHT = 6

/**
 * The perimeter cell set of the seeded rectangle, as `x,z` keys — the same
 * shape mx-gameplay's own package-level test builds via its
 * `rectanglePerimeterCells` helper (test/vehicle-rail-simulation.test.ts),
 * checked here against the running browser instead of an in-memory rig.
 */
const trackCellKeys = (): ReadonlySet<string> => {
  const keys = new Set<string>()
  for (let x = 0; x <= TRACK_WIDTH; x += 1) {
    keys.add(`${String(TRACK_ORIGIN.x + x)},${String(TRACK_ORIGIN.z)}`)
    keys.add(`${String(TRACK_ORIGIN.x + x)},${String(TRACK_ORIGIN.z + TRACK_HEIGHT)}`)
  }
  for (let z = 1; z < TRACK_HEIGHT; z += 1) {
    keys.add(`${String(TRACK_ORIGIN.x)},${String(TRACK_ORIGIN.z + z)}`)
    keys.add(`${String(TRACK_ORIGIN.x + TRACK_WIDTH)},${String(TRACK_ORIGIN.z + z)}`)
  }
  return keys
}

type RailTrackSnapshot = {
  cart: {
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
  } | null
}

const callQa = async <Result>(page: Page, command: string): Promise<Result> =>
  page.evaluate((commandName) => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return operation() as Result
  }, command)

// The cart's corner-turning happens on the simulation's own tick schedule,
// not wall-clock time — the same reason every other multi-tick wait in this
// suite goes through waitForSimulationProgress (see
// e2e/helpers/simulation-wait.ts) instead of a bare expect.poll.
const railSnapshotWithFrames = (
  page: Page,
): Promise<{ frames: number; value: RailTrackSnapshot }> =>
  page.evaluate(() => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.['gameplay.railTrackSnapshot']
    if (operation === undefined) throw new Error('missing QA command: gameplay.railTrackSnapshot')
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: operation() as RailTrackSnapshot,
    }
  })

const clearDatabase = async (page: Page): Promise<void> => {
  await page.goto('/@vite/client')
  await page.evaluate(
    (databaseName) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error(`Database ${databaseName} deletion was blocked`))
    }),
    DATABASE_NAME,
  )
}

// FIXED (browser-level testability gap): the minecart-corners fix shipped
// with package-level proof only — mx-gameplay's own closed-rectangle
// regression guard, run against an in-memory rig — and nothing reachable
// from the running game. The only production path that spawns a minecart is
// a real right-click against a rail block, and a fresh survival session's
// starter kit holds neither a minecart nor rail (both are craftable only
// through a full mining-and-smelting chain), so nobody driving the game by
// hand could ever see the fix work. gameplay.seedRailTrackEncounter closes
// that gap: it seeds a closed rail loop and a moving cart through the same
// vehicleService and frame stage (gameplayStages) production play uses, not
// a test-only stepper, so what this test observes afterward is the real
// simulation turning the corners.
test('a minecart driven around a closed rail circuit turns all four corners and never leaves the rails', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`))

  await clearDatabase(page)
  await startGameSession(page, 'minecart-corners-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<RailTrackSnapshot>(page, 'gameplay.seedRailTrackEncounter')
  expect(seeded.cart).not.toBeNull()

  const trackCells = trackCellKeys()
  let maxX = Number.NEGATIVE_INFINITY
  let minX = Number.POSITIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY

  await waitForSimulationProgress(
    page,
    () => railSnapshotWithFrames(page),
    (snapshot) => {
      const cart = snapshot.cart
      if (cart === null) throw new Error('cart despawned mid-circuit')
      const cellKey = `${String(Math.floor(cart.position.x))},${String(Math.floor(cart.position.z))}`
      // THE PROPERTY THAT ACTUALLY FALSIFIES THE ORIGINAL BUG: the pre-fix
      // cart did not fail at the first corner it reached (the old
      // dominant-axis fallback happens to redirect correctly there) but ran
      // straight off the track at the second corner, one tick after
      // entering it (mx-gameplay's test/vehicle-rail-simulation.test.ts
      // documents why). Checked on every sampled tick, not only at the end,
      // so a cart that derails and happens to coast back cannot hide behind
      // a final-position assertion.
      if (!trackCells.has(cellKey)) {
        throw new Error(
          `cart left the rails at cell ${cellKey} (position ${JSON.stringify(cart.position)})`,
        )
      }
      maxX = Math.max(maxX, cart.position.x)
      minX = Math.min(minX, cart.position.x)
      maxZ = Math.max(maxZ, cart.position.z)
      minZ = Math.min(minZ, cart.position.z)
      // Reached near all four sides of the rectangle — the same proof
      // mx-gameplay's package-level test uses — not merely that the cart
      // idled back and forth on its starting edge, which trackCells alone
      // cannot distinguish from a real circuit.
      return (
        maxX > TRACK_ORIGIN.x + TRACK_WIDTH - 1
        && minX < TRACK_ORIGIN.x + 1
        && maxZ > TRACK_ORIGIN.z + TRACK_HEIGHT - 1
        && minZ < TRACK_ORIGIN.z + 1
      )
    },
    { description: 'minecart completes a lap of the closed rail circuit' },
  )

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
