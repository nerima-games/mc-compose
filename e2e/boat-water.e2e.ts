import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const DATABASE_NAME = 'nerima-games-minecraft'

// Mirrors qa-fixtures.ts's QA_WATER_ORIGIN / _SIZE — the pool
// gameplay.seedBoatWaterEncounter (apps/web/main.ts) actually builds. Kept as
// a literal here rather than imported, the same way every other *.e2e.ts in
// this suite treats a fixture's shape as expected values rather than a
// shared cross-package import.
const WATER_ORIGIN = { x: 4, y: 64, z: 40 }
const WATER_SIZE = 8

type BoatSnapshot = {
  boat: {
    position: { x: number; y: number; z: number }
    velocity: { x: number; y: number; z: number }
    yawRadians: number
    mounted: boolean
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

const boatSnapshotWithFrames = (
  page: Page,
): Promise<{ frames: number; value: BoatSnapshot }> =>
  page.evaluate(() => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.['gameplay.boatWaterSnapshot']
    if (operation === undefined) throw new Error('missing QA command: gameplay.boatWaterSnapshot')
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: operation() as BoatSnapshot,
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

// mc-render's InputService only treats a click as a game action while the
// pointer is locked, and Playwright on SwiftShader cannot acquire a real
// pointer lock at all (see e2e/smoke.e2e.ts's #10 comment on breaking).
// block-placement-persistence.e2e.ts's fix applies here too: spoof the ONE
// property the handler actually reads, `document.pointerLockElement`, and
// dispatch a real click — the click event itself, and everything the game
// does with it (the raycast, the placement, the boarding-distance check),
// is real.
const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (canvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => canvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

const rightClick = async (page: Page): Promise<void> => {
  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await grantPointerLock(page)
  await canvas.click({ button: 'right' })
}

const speedOf = (velocity: { x: number; y: number; z: number }): number =>
  Math.hypot(velocity.x, velocity.y, velocity.z)

const distance = (
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

/**
 * FIXED (browser-level testability gap): a live QA pass drove a boat as far
 * as the surface allows — crafted, placed by real right-click (a boat entity
 * genuinely appeared), and mounted (the player's pose snapped onto it) — but
 * could only test propulsion on a dry stone floor, the only terrain the QA
 * fixtures offered without new work, and reported "could not test on water"
 * rather than a defect. gameplay.seedBoatWaterEncounter closes that gap: it
 * terraforms an open-water pool and equips the boat item, but deliberately
 * does NOT place or mount the boat itself — this test drives placement,
 * boarding and propulsion through the SAME targetedBlock() raycast,
 * boarding-distance check and vehicleService/frame stage (gameplayStages)
 * production play uses, so what it observes afterward is the real game, not
 * a QA-only substitute for any part of it.
 */
test('a boat placed on open water is driven by the real vehicle service and frame stage', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`))

  await clearDatabase(page)
  await startGameSession(page, 'boat-water-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<BoatSnapshot>(page, 'gameplay.seedBoatWaterEncounter')
  expect(seeded.boat).toBeNull()

  // Real right-click placement, aimed straight down at the pool — the same
  // aim a player uses to place a boat on open water in front of them.
  await rightClick(page)
  const placed = await waitForSimulationProgress(
    page,
    () => boatSnapshotWithFrames(page),
    (snapshot) => snapshot.boat !== null,
    { description: 'the placed boat appears in the vehicle service' },
  )
  const boat = placed.boat
  expect(boat).not.toBeNull()
  if (boat === null) throw new Error('unreachable: asserted above')

  // Landed within the pool's own footprint, not off its edge.
  expect(boat.position.x).toBeGreaterThan(WATER_ORIGIN.x - 1)
  expect(boat.position.x).toBeLessThan(WATER_ORIGIN.x + WATER_SIZE + 1)
  expect(boat.position.z).toBeGreaterThan(WATER_ORIGIN.z - 1)
  expect(boat.position.z).toBeLessThan(WATER_ORIGIN.z + WATER_SIZE + 1)

  console.log(`boat placed at ${JSON.stringify(boat.position)} (water surface cell y=${String(WATER_ORIGIN.y)})`)

  // Real right-click boarding: no vehicle/boat item is selected anymore
  // (placement consumed it), so this exercises the SAME boarding-distance
  // check (main.ts's nearbyVehicle search, <= 2 blocks, unoccupied) real
  // play uses, not a QA-only mount.
  await rightClick(page)
  const mounted = await waitForSimulationProgress(
    page,
    () => boatSnapshotWithFrames(page),
    (snapshot) => snapshot.boat?.mounted === true,
    { description: 'the player boards the placed boat' },
  )
  expect(mounted.boat?.mounted).toBe(true)

  // Hold forward. Both the correct-in-water regime (BOAT_ACCELERATION,
  // heavy drag toward roughly walking speed) and an incorrect
  // not-detected-as-water regime (mx-gameplay's stepBoat applies only 15% of
  // that acceleration off water) are slow enough that a fixed, generous
  // sample count — not a wall-clock wait, see e2e/helpers/simulation-wait.ts
  // — safely covers either one settling.
  await page.keyboard.down('KeyW')
  const samples: Array<{ frames: number; value: BoatSnapshot }> = []
  let sampleCount = 0
  await waitForSimulationProgress(
    page,
    async () => {
      const sample = await boatSnapshotWithFrames(page)
      samples.push(sample)
      return sample
    },
    () => {
      sampleCount += 1
      return sampleCount >= 60
    },
    { description: 'the boat is driven forward long enough to reveal its steady-state speed' },
  )
  await page.keyboard.up('KeyW')

  const start = samples[0]?.value.boat
  expect(start).not.toBeNull()
  if (start === null || start === undefined) {
    throw new Error('unreachable: asserted above')
  }
  const end = samples[samples.length - 1]?.value.boat

  const speeds = samples.map((sample) => speedOf(sample.value.boat?.velocity ?? { x: 0, y: 0, z: 0 }))
  const peakSpeed = Math.max(...speeds)
  const traveled = end === null || end === undefined ? 0 : distance(start.position, end.position)
  console.log(
    `boat driven forward: start=${JSON.stringify(start.position)} end=${JSON.stringify(end?.position)} `
    + `traveled=${traveled.toFixed(3)} peakSpeed=${peakSpeed.toFixed(3)} finalSpeed=${speeds[speeds.length - 1]?.toFixed(3) ?? 'n/a'}`,
  )

  // PEAK, not final, speed is the discriminating measurement: the pool is
  // only QA_WATER_SIZE blocks across, and at real cruising speed the boat
  // crosses from the centre (where it is placed and driven from) to the
  // water's edge well inside this test's sample window — by the LAST sample
  // it may already be back over dry land and decelerating, which the
  // traveled distance below confirms rather than contradicts. mx-gameplay's
  // stepBoat still applies a small (15%) acceleration off water, so a boat
  // that never registers as in-water still creeps — asserting non-zero
  // displacement alone would pass either way. A real in-water boat reaches
  // within an order of magnitude of vanilla's ~1.8 blocks/sec cruising speed
  // at its peak; a not-in-water boat never exceeds roughly 5% of that.
  expect(peakSpeed).toBeGreaterThan(0.5)
  expect(traveled).toBeGreaterThan(1)

  // Steering, checked separately: mx-gameplay's stepBoat applies
  // BOAT_TURN_RATE to yaw unconditionally on `steering` (not gated on
  // `inWater` the way acceleration is), so this holds regardless of
  // whether the boat is still over the pool by this point in the test.
  const yawBefore = end?.yawRadians
  expect(yawBefore).not.toBeUndefined()
  await page.keyboard.down('KeyD')
  let steeringSamples = 0
  const steered = await waitForSimulationProgress(
    page,
    () => boatSnapshotWithFrames(page),
    () => {
      steeringSamples += 1
      return steeringSamples >= 15
    },
    { description: 'the mounted boat is steered right' },
  )
  await page.keyboard.up('KeyD')
  const yawAfter = steered.boat?.yawRadians
  expect(yawAfter).not.toBeUndefined()
  console.log(`boat steering: yaw ${String(yawBefore)} -> ${String(yawAfter)}`)
  if (yawBefore !== undefined && yawAfter !== undefined) {
    expect(Math.abs(yawAfter - yawBefore)).toBeGreaterThan(0.05)
  }

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
