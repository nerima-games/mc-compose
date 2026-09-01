import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { ARROW_PROFILE, stepProjectile, type Projectile, type ProjectileWorld } from '@nerima-games/mc-sim'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type Position = Readonly<{ x: number; y: number; z: number }>
type InventorySlot = Readonly<{ item: string; count: number }> | null
type ProjectileSnapshot = Readonly<{
  id: string
  state: 'flying' | 'stuck' | 'despawned'
  position: Position
  velocity: Position
  ageSeconds: number
}>
type GameplaySnapshot = Readonly<{
  pose: Readonly<{
    feetPosition: Position
    yawRadians: number
    pitchRadians: number
  }>
  inventory: Readonly<{
    slots: ReadonlyArray<InventorySlot>
    durability: ReadonlyArray<Readonly<{ current: number; max: number }> | null>
  }>
  projectiles: ReadonlyArray<ProjectileSnapshot>
}>

const callQa = <A>(page: Page, command: string): Promise<A> => page.evaluate(
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

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

// The frame counter and the snapshot are read in ONE round trip. Split across
// two, they can describe different frames, and a wait that compares them is
// then reasoning about a state that never existed.
const readGameplayWithFrames = (
  page: Page,
): Promise<{ frames: number; value: GameplaySnapshot }> => page.evaluate(
  async ({ key, commandName }) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = surface?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: await operation(),
    }
  },
  { key: QA_GLOBAL_KEY, commandName: 'gameplay.snapshot' },
) as Promise<{ frames: number; value: GameplaySnapshot }>

const itemCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const bowDurability = (current: GameplaySnapshot): number => {
  const bowIndex = current.inventory.slots.findIndex((slot) => slot?.item === 'bow')
  const durability = current.inventory.durability[bowIndex]
  if (bowIndex < 0 || durability === null || durability === undefined) {
    throw new Error('bow fixture must provide a damageable bow')
  }
  return durability.current
}

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

// PHYSICS ORACLE for the bow-projectile happy path below. A real-time-driven
// charge (see the `raw`-not-`deltaSecs` comment at apps/web/main.ts's
// `advanceBowUse` call site) means a test cannot know the exact charge — and
// therefore the exact launch speed and landing position — that a given hold
// will produce; the CI failure this replaces asserted a fixed landing box
// sized for an assumed charge and broke the moment the real one drifted.
// Instead of assuming, this replays `stepProjectile`/`ARROW_PROFILE` — the
// SAME functions apps/web/projectile-runtime.ts's `advanceProjectileRuntime`
// calls — starting from an OBSERVED (position, velocity) partway through the
// real flight, for the OBSERVED elapsed simulated time, and checks that the
// browser's own integration agrees with this independent replay. It never
// needs to know what charge was achieved; it only needs two snapshots of the
// same projectile in flight.
//
// The world model below knows only about the QA fixture's stone wall
// (apps/web/main.ts's seedBowProjectileEncounter: x:6..10, y:62..69, z:2),
// not the surrounding procedurally generated terrain, so this oracle is valid
// only for a shot that actually lands on that wall — true for a normal,
// unstalled hold (this is the same fixture the pre-fix test hit reliably
// across repeated local runs), not necessarily true for a hold delayed enough
// to fly past it, which is a different, already-covered concern: see "still
// fires a genuinely long hold..." below for the discrete fire/no-fire
// distinction under an actual stall.
const FIXTURE_WALL_WORLD: ProjectileWorld = {
  blockBounds: (start, end) => {
    const bounds: Array<{
      minX: number
      minY: number
      minZ: number
      maxX: number
      maxY: number
      maxZ: number
    }> = []
    const minXi = Math.floor(Math.min(start.x, end.x))
    const maxXi = Math.floor(Math.max(start.x, end.x))
    const minYi = Math.floor(Math.min(start.y, end.y))
    const maxYi = Math.floor(Math.max(start.y, end.y))
    const minZi = Math.floor(Math.min(start.z, end.z))
    const maxZi = Math.floor(Math.max(start.z, end.z))
    for (let x = Math.max(6, minXi); x <= Math.min(10, maxXi); x += 1) {
      for (let y = Math.max(62, minYi); y <= Math.min(69, maxYi); y += 1) {
        if (minZi <= 2 && maxZi >= 2) {
          bounds.push({ minX: x, minY: y, minZ: 2, maxX: x + 1, maxY: y + 1, maxZ: 3 })
        }
      }
    }
    return bounds
  },
  entities: [],
  isInWater: () => false,
  bounds: { minX: -10_000, minY: -10_000, minZ: -10_000, maxX: 10_000, maxY: 10_000, maxZ: 10_000 },
}

// Replays from an observed (position, velocity) for `flightSecs` of simulated
// time, at a fixed `stepSecs` per call. Used both to produce the oracle's
// prediction (a fine step) and, at the app's own coarsest step (0.1s, the
// `Math.min(deltaSecs, 0.1)` cap in apps/web/main.ts's projectile-advance
// call), to measure how much a real, irregular frame schedule could
// legitimately diverge from that prediction.
const replayFlight = (
  origin: Readonly<{ position: Position; velocity: Position }>,
  flightSecs: number,
  stepSecs: number,
): Projectile => {
  let state: Projectile = {
    position: origin.position,
    velocity: origin.velocity,
    ageSeconds: 0,
    state: 'flying',
  }
  let remaining = flightSecs
  while (state.state === 'flying' && remaining > 1e-9) {
    const dt = Math.min(stepSecs, remaining)
    state = stepProjectile(state, dt, FIXTURE_WALL_WORLD, ARROW_PROFILE).projectile
    remaining -= dt
  }
  return state
}

const distance = (a: Position, b: Position): number =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

// The tolerance is DERIVED, not chosen: `stepProjectile` is semi-implicit
// (symplectic) Euler, which is path-dependent — the same total flight time
// stepped in a few large chunks lands somewhere numerically different from
// the same time stepped in many small ones. The `schedulesSpread` term below
// measures that directly, per run, as the gap between a fine reference
// replay and the coarsest replay the app's own clamp allows — but for THIS
// fixture's short real flight (~0.25-0.5s at this ~8-block range), that term
// alone undershoots the real achievable precision: even with a near-zero
// `schedulesSpread`, running this test 15 times against the code with
// `elapsedSecs: raw` (the fix, apps/web/main.ts's `advanceBowUse` call site)
// measured a real prediction-vs-observation gap of 0.0294 to 0.0729 blocks
// every time. That is boundary-crossing time sensitivity, not step-schedule
// sensitivity: a shot this fast (8-32 blocks/sec) crosses the wall's face in
// well under a millisecond, so any small difference in exactly when the
// replay and the browser's own integration register that crossing — from
// re-sampling the QA-reported velocity rather than the exact internal launch
// state, or from ordinary floating-point rounding — becomes a position gap
// proportional to impact speed, and a schedule-only bound does not see it.
// MIN_TOLERANCE_BLOCKS below is that measured maximum (0.0729) doubled for
// margin: `pnpm exec playwright test e2e/bow-projectile.e2e.ts -g "charges,
// fires" --repeat-each=15` reproduces the measurement.
const FINE_STEP_SECS = 0.001
const COARSE_STEP_SECS = 0.1
const TOLERANCE_SAFETY_FACTOR = 2
const MIN_TOLERANCE_BLOCKS = 0.15

const predictLanding = (
  origin: Readonly<{ position: Position; velocity: Position }>,
  flightSecs: number,
): Readonly<{ prediction: Projectile; toleranceBlocks: number }> => {
  const prediction = replayFlight(origin, flightSecs, FINE_STEP_SECS)
  const coarse = replayFlight(origin, flightSecs, COARSE_STEP_SECS)
  const schedulesSpread = prediction.state !== 'flying' && coarse.state !== 'flying'
    ? distance(prediction.position, coarse.position)
    : 0
  return {
    prediction,
    toleranceBlocks: Math.max(MIN_TOLERANCE_BLOCKS, schedulesSpread * TOLERANCE_SAFETY_FACTOR),
  }
}

// Forces every animation frame to cost at least `stallMs` of real wall-clock
// time, well past MAX_FRAME_SECS (apps/web/main.ts), by busy-waiting inside a
// wrapped requestAnimationFrame installed before the game's own script runs.
// A CPU-throttled CDP session does not reliably reproduce this on a fast
// host — a fixture this cheap per frame stays under the clamp threshold even
// at the DevTools Protocol's 20x throttling ceiling — so this simulates the
// stall directly instead of relying on CPU throttling to induce one.
const stallEachAnimationFrame = async (page: Page, stallMs: number): Promise<void> => {
  await page.addInitScript((ms: number) => {
    const request = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) => request((time) => {
      const stallUntil = performance.now() + ms
      while (performance.now() < stallUntil) { /* hold the main thread so real elapsed time exceeds the clamp */ }
      callback(time)
    })
  }, stallMs)
}

// A real-time-driven charge means the hold below cannot be guaranteed to
// produce an exact, pre-known chargeSecs — see the FIXTURE_WALL_WORLD comment
// above for why the landing-position assertion is a physics-oracle replay
// rather than an absolute box (a fixed box FAILED on CI: PR #21's
// e2e-browser job hit `stuckProjectile.position.x` of 13.525478571692624 and
// 13.750315233859862 against an intended `< 11`, and the same test inside the
// full Functional-regression suite instead timed out waiting for
// `state === 'stuck'` — a longer, still-unresolved flight from a larger
// overshoot under more contention. Both are downstream of correctly fixing
// the clamp defect, not a sign it is unfixed).
// PARKED, and NOT for a bow, physics or oracle defect — the aim is already
// wrong before the shot is taken.
//
// Extracted from a CI run's trace: immediately after seeding, the pose is what
// the fixture sets (yaw 0, pitch 0). The very next snapshot — after
// grantPointerLock, hover() and the mouse press, before release — reads yaw
// -1.408 and pitch -0.792, about -80.7 and -45.4 degrees, with the player
// swimming. The arrow then lands at x 10.79, y 59, z 10.12: essentially
// straight down beside the player's own feet, nowhere near the fixture's wall
// at z 2. So the oracle's 'flying' prediction is correct reporting — replaying
// the observed velocity for the observed time does not reach a wall the shot
// was never travelling toward.
//
// Suspected mechanism, traced to source but NOT confirmed: grantPointerLock
// fakes document.pointerLockElement, mc-render's input adapter flips its own
// lock flag on that event and then accumulates every subsequent mousemove's
// movementX/Y unconditionally (its own comment notes the automation framework
// cannot grant real pointer lock), and hover() moves the real cursor
// afterwards — delivering one large jump as a look delta. Five local runs of
// that exact sequence produced yaw and pitch of exactly zero, so this does not
// reproduce off the CI runner and the mechanism is a lead, not a conclusion.
//
// Candidate fix, behaviour-neutral where the bug is absent (20/20 runs, values
// unchanged): move hover() BEFORE grantPointerLock so no real cursor movement
// follows the fake lock. grantPointerLock is duplicated across ~16 e2e files,
// so the fix belongs in a shared helper rather than here.
//
// Do NOT un-park this by widening the tolerance. A separate 171-run study
// found the tolerance floor's stated derivation is itself wrong for this
// fixture — the step-schedule term measures exactly zero here, because swept
// collision computes the crossing analytically — and that the real error
// scales with flight time. That correction is worth landing, but it is a
// different problem from the aim, and it cannot un-park this test.
test('charges, fires, and embeds an arrow while settling inventory wear', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedBowProjectileEncounter')
  const initialArrowCount = itemCount(seeded, 'arrow')
  const initialBowDurability = bowDurability(seeded)
  expect(initialArrowCount).toBeGreaterThan(0)
  expect(seeded.projectiles).toEqual([])

  await grantPointerLock(page)
  await page.locator('#game-canvas').hover()
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(350)
  const charged = await snapshot(page)
  expect(charged.projectiles).toEqual([])
  expect(itemCount(charged, 'arrow')).toBe(initialArrowCount)
  expect(bowDurability(charged)).toBe(initialBowDurability)
  await page.mouse.up({ button: 'right' })

  // Tight, explicit intervals rather than expect.poll's default backoff
  // (100ms, then 250ms, ...): a full-charge shot at this fixture's ~8-block
  // range flies in as little as ~0.25s, so the default backoff can land
  // straight on 'stuck' and skip observing 'flying' entirely, leaving no
  // earlier (position, velocity) to seed the oracle replay from.
  let createdProjectile: ProjectileSnapshot | undefined
  await expect.poll(async () => {
    const current = await snapshot(page)
    const projectile = current.projectiles[0]
    if (projectile !== undefined && projectile.state === 'flying') {
      expect(current.projectiles).toHaveLength(1)
      createdProjectile = projectile
      return true
    }
    return false
  }, { intervals: [10, 20, 50] }).toBe(true)

  const fired = await snapshot(page)
  expect(itemCount(fired, 'arrow')).toBe(initialArrowCount - 1)
  expect(bowDurability(fired)).toBe(initialBowDurability - 1)
  expect(createdProjectile).toBeDefined()

  // Landing is gated on the simulation advancing, not on wall-clock: the arrow
  // covers its distance in ticks, and each frame contributes at most the
  // clamped delta, so on a slow host the same flight takes proportionally
  // longer in real time. A real-time budget here fails while the arrow is
  // merely still travelling, which is what CI observed — 'flying' where it
  // wanted 'stuck'. Unlike the in-flight poll above, this one has no transient
  // to catch: a stuck arrow stays stuck, so the sampling rate does not matter.
  const landed = await waitForSimulationProgress(
    page,
    () => readGameplayWithFrames(page),
    (current) => current.projectiles.some(
      ({ id, state }) => id === createdProjectile!.id && state === 'stuck',
    ),
    { description: 'bow arrow embedding in the wall' },
  )
  expect(landed.projectiles).toHaveLength(1)
  const stuckProjectile = landed.projectiles.find(({ id }) => id === createdProjectile!.id)

  expect(stuckProjectile!.id).toBe(createdProjectile!.id)
  expect(stuckProjectile!.position.z).toBeLessThan(seeded.pose.feetPosition.z)

  const flightSecs = stuckProjectile!.ageSeconds - createdProjectile!.ageSeconds
  // A non-positive gap means the two snapshots above caught the SAME frame
  // (the tight poll intervals did not manage to observe it mid-flight) —
  // there is then no independent replay to check, so fail loudly rather than
  // silently asserting nothing.
  expect(flightSecs).toBeGreaterThan(0)

  const { prediction, toleranceBlocks } = predictLanding(createdProjectile!, flightSecs)
  expect(prediction.state).toBe('stuck')
  if (prediction.state === 'stuck') {
    expect(distance(prediction.position, stuckProjectile!.position)).toBeLessThanOrEqual(toleranceBlocks)
  }

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('still fires a genuinely long hold when every frame stalls well past the physics clamp', async ({ page }) => {
  // A 600ms/frame stall bounds each real frame to cost AT LEAST 600ms, so a
  // 700ms hold can fit at most one full extra frame after the one that
  // starts the draw — structurally at most 2 charge-contributing frames,
  // never the 4 a clamped accumulator (MAX_FRAME_SECS=0.05s) would need to
  // reach mx-gameplay's BOW_MIN_CHARGE_SECS=0.2s by accident (4 * 0.05 =
  // 0.20, the inclusive boundary — an earlier version of this probe used
  // parameters that landed almost exactly on it and passed even against the
  // pre-fix clamped-delta code, which is why the margin here is deliberate
  // and documented rather than tuned by feel). Real elapsed time across
  // those same 1-2 frames is ~0.6-1.2s, well clear of the 0.2s threshold.
  await stallEachAnimationFrame(page, 600)

  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedBowProjectileEncounter')
  const initialArrowCount = itemCount(seeded, 'arrow')
  expect(initialArrowCount).toBeGreaterThan(0)

  await grantPointerLock(page)
  await page.locator('#game-canvas').hover()
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(700)
  await page.mouse.up({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.projectiles.length
  }, { timeout: 30_000 }).toBeGreaterThan(0)

  const fired = await snapshot(page)
  expect(itemCount(fired, 'arrow')).toBe(initialArrowCount - 1)

  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
