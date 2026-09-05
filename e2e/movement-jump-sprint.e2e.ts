/**
 * Two core-loop mechanics with no prior e2e coverage (confirmed absent by
 * `grep -rniE 'sprint|jump' e2e` before this file existed).
 *
 * Jump is wired end to end: `apps/web/main.ts` reads `held('jump')`, sets
 * `simState.jumpIntent`, and the physics service applies `JUMP_SPEED_M_PER_S`
 * on the next grounded frame. It used to also cost a health point on every
 * ordinary jump — `JUMP_SPEED_M_PER_S` was 8.4, which combined with
 * `@nerima-games/mc-physics`'s verified `GRAVITY_Y = -9.82` (cited to the
 * reference implementation's own source in that package's
 * `docs/public-api.md`) to send every jump 3.5+ blocks up, past the
 * `ceil(fallDistance - 3)` fall-damage rule. Fixed by correcting the
 * uncited, un-verified `JUMP_SPEED_M_PER_S` itself (see its docstring in
 * `apps/web/main.ts`) rather than the fall-damage threshold.
 *
 * Sprint now IS wired. `'sprint'` is a real, user-remappable `InputAction`
 * (`@nerima-games/mc-render`'s `DEFAULT_BINDINGS.sprint = 'ControlLeft'`,
 * labelled "Sprint" in the settings screen — see `apps/web/settings-view.ts`),
 * and mx-gameplay's domain layer prices it
 * (`SURVIVAL_EXHAUSTION.sprintPerBlock`, a `'sprint'` activity tag).
 * `apps/web/main.ts` now reads `held('sprint')` and substitutes
 * `SPRINT_SPEED_M_PER_S` (5.612 m/s, cited to the reference implementation
 * via `@nerima-games/mc-physics`'s `test/resolve.test.ts`) for
 * `WALK_SPEED_M_PER_S` while moving forward, the same way an active Speed
 * status effect already substitutes a multiplier. The second test below
 * exercises that from the player's side — holding the real,
 * settings-visible sprint key produces measurably more displacement than
 * walking alone.
 */
import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly pose: {
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  }
  readonly fall: {
    readonly grounded: boolean
    readonly accumulatedDistance: number
  }
  readonly vitals: {
    readonly healthPoints: number
    readonly lastDamageCause?: string
  }
  // `apps/web/main.ts`'s own accumulator: the sum of every frame's CLAMPED
  // delta (`simulationElapsedSecs += deltaSecs`), not a wall clock. Two
  // phases compared over an equal SPAN of this value cover equal simulated
  // ground regardless of how many real frames, or how much real time, either
  // one took to get there — which is what makes it usable as a common basis
  // for a speed measurement. See the sprint test below for why wall-clock
  // holds cannot be compared this way.
  readonly environmentalContact: {
    readonly simulationElapsedSecs: number
  }
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(
    async ({ key, commandName }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, () => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation()
    },
    { key: QA_GLOBAL_KEY, commandName: command },
  ) as Promise<A>

const snapshotWithFrames = (page: Page): Promise<{ frames: number; value: GameplaySnapshot }> =>
  page.evaluate(
    async ({ key, commandName }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, () => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      const value = await operation()
      return { frames: Number(document.body.getAttribute('data-frames')), value }
    },
    { key: QA_GLOBAL_KEY, commandName: 'gameplay.snapshot' },
  ) as Promise<{ frames: number; value: GameplaySnapshot }>

const settleOnFlatGround = async (page: Page): Promise<GameplaySnapshot> => {
  await callQa<GameplaySnapshot>(page, 'gameplay.seedSmokeGroundingEncounter')
  // The QA command's own return value reflects the pose it just SET (still
  // mid-air), not where gravity settles it — settling is physics-simulated
  // over several frames, not instant. Read the settled snapshot back out of
  // the wait itself rather than trusting the command's immediate return.
  return await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.fall.grounded,
    { description: 'player settles onto flat QA terrain' },
  )
}

const horizontalDistance = (
  a: GameplaySnapshot['pose']['feetPosition'],
  b: GameplaySnapshot['pose']['feetPosition'],
): number => Math.hypot(b.x - a.x, b.z - a.z)

test('jumping reaches the intended height and lands without fall damage', async ({ page }) => {
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const seeded = await settleOnFlatGround(page)
  const spawnY = seeded.pose.feetPosition.y

  await page.locator('#game-canvas').click()
  await page.keyboard.down('Space')
  const airborne = await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => !current.fall.grounded,
    { description: 'jump leaves the ground' },
  )
  // Proves the jump actually imparted upward velocity, not merely that
  // grounded flickered false for a physics-internal reason.
  expect(airborne.pose.feetPosition.y).toBeGreaterThan(spawnY)
  await page.keyboard.up('Space')

  // Track the peak height across the whole ascent/descent, not just the
  // moment flight starts or ends. A test that only checks "no fall damage"
  // cannot tell a correctly-tuned jump from one that got the physics wrong
  // in a way that happens not to trip the 3-block threshold (too low is
  // just as wrong as too high, and a 3-times-too-high jump like the old
  // JUMP_SPEED_M_PER_S=8.4 would pass a damage-only check if gravity were
  // ever raised without the jump speed being re-validated against it).
  let peakY = airborne.pose.feetPosition.y
  const landed = await waitForSimulationProgress(
    page,
    async () => {
      const read = await snapshotWithFrames(page)
      peakY = Math.max(peakY, read.value.pose.feetPosition.y)
      return read
    },
    (current) => current.fall.grounded,
    { description: 'jump lands back on the ground' },
  )
  expect(landed.pose.feetPosition.y).toBeCloseTo(spawnY, 1)
  // A jump this short must not read as a damaging fall.
  expect(landed.vitals.healthPoints).toBe(seeded.vitals.healthPoints)

  // Pins the apex itself, not only its consequence. JUMP_SPEED_M_PER_S=5.0
  // under mc-physics's verified GRAVITY_Y=-9.82 was simulated directly
  // against the actual integrateBody (not the idealized no-drag parabola)
  // across frame times from 60fps down to the MAX_DELTA_SECS=0.05 floor,
  // landing at 1.15-1.23 blocks every time (see JUMP_SPEED_M_PER_S's
  // docstring in apps/web/main.ts). The band below is wider than that
  // range to absorb real browser frame-timing variance, but still narrow
  // enough to fail if the apex reverts toward the old ~3.5 blocks or
  // collapses toward zero.
  const apexHeight = peakY - spawnY
  expect(apexHeight).toBeGreaterThan(0.8)
  expect(apexHeight).toBeLessThan(1.6)
})

// How much SIMULATED time each phase below holds its key for. Not a
// wall-clock duration — see the helper.
const SPEED_SAMPLE_SIMULATED_SECS = 1.0

/**
 * Holds forward (optionally with Sprint) until `simulationElapsedSecs` — the
 * sum of every frame's CLAMPED delta, `apps/web/main.ts`'s own accumulator —
 * has advanced by `SPEED_SAMPLE_SIMULATED_SECS`, then returns distance over
 * the ACTUAL simulated span covered (which overshoots the target by at most
 * one frame's clamped delta, i.e. <= MAX_FRAME_SECS), not the target itself.
 *
 * A wall-clock `waitForTimeout(1_000)` measures frame availability, not
 * speed: the simulation clamps its per-frame delta, so once real frame times
 * exceed that clamp — which happens while the page is still warming up
 * (shader compilation, JIT), and on a slow runner generally — simulated time
 * advances more slowly than the clock, and whichever phase eats that warm-up
 * covers less ground in the same wall-clock window at the SAME real speed.
 * That is what happened on CI: walk ran first, absorbed the warm-up, and
 * measured at roughly a quarter of its warm value while sprint (run second,
 * already warm) measured close to its true value — inflating the ratio to
 * 2.35 against the real 1.305, on a run where both assertions still failed
 * every retry, i.e. it was reproducible, not a fluke.
 *
 * Gating on simulated time instead removes the confound structurally rather
 * than statistically: however long warm-up makes real frames take, the
 * distance covered over one full simulated-time span is complete and
 * correct, so neither phase can be shortchanged relative to the other
 * regardless of which one happens to run first or how the warm-up cost is
 * distributed across the run (front-loaded, steady, or otherwise — an
 * average-two-samples-around-the-middle mitigation only cancels a linear
 * drift; this does not depend on the drift's shape at all).
 */
const holdForwardForSimulatedSpan = async (
  page: Page,
  sprinting: boolean,
): Promise<{ readonly distance: number; readonly elapsedSecs: number; readonly speed: number }> => {
  const settled = await settleOnFlatGround(page)
  if (sprinting) await page.keyboard.down('ControlLeft')
  await page.keyboard.down('KeyW')

  // Start the span once the player is demonstrably already moving, not at
  // key-down. Simulated time begins accumulating immediately, but the player
  // does not move until the key press has actually crossed into the page and
  // been read by a frame — and that gap is charged to whichever phase is
  // measuring. It is not constant: the first keyboard interaction after a
  // page load is the slowest, so the phase that runs first absorbs the most
  // of it. Gating the span on simulated time fixed the earlier wall-clock
  // confound but not this one, and it showed up the same way — as a walk
  // speed that came in below its own constant and varied run to run (3.46
  // and 3.85 against a real 4.3) while sprint, running second, sat stable at
  // its own value. Measuring only between two samples that are both already
  // in motion removes the dead time from both phases instead of hoping it is
  // equal.
  const moving = await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => horizontalDistance(settled.pose.feetPosition, current.pose.feetPosition) > 0.5,
    { description: `${sprinting ? 'sprint' : 'walk'} phase reaches steady motion` },
  )
  const startElapsed = moving.environmentalContact.simulationElapsedSecs
  const after = await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.environmentalContact.simulationElapsedSecs - startElapsed >= SPEED_SAMPLE_SIMULATED_SECS,
    { description: `${sprinting ? 'sprint' : 'walk'} phase accumulates ${String(SPEED_SAMPLE_SIMULATED_SECS)} simulated seconds` },
  )
  await page.keyboard.up('KeyW')
  if (sprinting) await page.keyboard.up('ControlLeft')
  const distance = horizontalDistance(moving.pose.feetPosition, after.pose.feetPosition)
  const elapsedSecs = after.environmentalContact.simulationElapsedSecs - startElapsed
  return { distance, elapsedSecs, speed: distance / elapsedSecs }
}

test('holding the bound Sprint key increases movement speed over walking alone', async ({ page }) => {
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await page.locator('#game-canvas').click()

  const walk = await holdForwardForSimulatedSpan(page, false)
  const sprint = await holdForwardForSimulatedSpan(page, true)

  expect(walk.distance).toBeGreaterThan(0)
  expect(walk.elapsedSecs).toBeGreaterThanOrEqual(SPEED_SAMPLE_SIMULATED_SECS)
  expect(sprint.elapsedSecs).toBeGreaterThanOrEqual(SPEED_SAMPLE_SIMULATED_SECS)

  const ratio = sprint.speed / walk.speed
  // Logged so a reviewer can see the measured speeds and ratio land near
  // WALK_SPEED_M_PER_S (4.3), SPRINT_SPEED_M_PER_S (5.612) and their ~1.305x
  // ratio, not only that the bracket below was satisfied.
  console.log(`walkSpeed=${String(walk.speed)} sprintSpeed=${String(sprint.speed)} ratio=${String(ratio)} walkElapsedSecs=${String(walk.elapsedSecs)} sprintElapsedSecs=${String(sprint.elapsedSecs)}`)

  // Speed, not distance, is now the measured quantity, and both phases are
  // measured over an equal simulated-time span — so unlike a distance-over-
  // wall-clock ratio, this one carries no frame-rate confound to leave room
  // for. Measured repeatedly (8 reps, host load average 72-84 at the time)
  // the ratio landed at exactly 1.3051162790697735 — 5.612/4.3 to floating-
  // point precision — every single time: no acceleration ramp exists on this
  // path (mc-sim's stage sets vx/vz directly from config.walkSpeed, not
  // through mc-physics's unused `approach()`), so speed is exact from the
  // first frame and the ratio carries no measurement noise to speak of. The
  // band below is still well clear of exact equality to allow for a
  // differently-shaped single frame of overshoot on a much slower runner.
  expect(ratio).toBeGreaterThan(1.27)
  expect(ratio).toBeLessThan(1.34)
})
