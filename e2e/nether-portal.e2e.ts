import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'
import { overworldToNether } from '@nerima-games/mc-worldgen'
import { blockPosition } from '@nerima-games/mc-kernel'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

// Mirrors qa-fixtures.ts's QA_PORTAL_ANCHOR — the interior cell
// seedPortalArrivalIntoSolidGround (apps/web/main.ts) restores the player
// into and registers as the Overworld side of the crossing.
const QA_PORTAL_ANCHOR = blockPosition(120, 65, 8)

type Dimension = 'overworld' | 'nether' | 'end'
type Position = Readonly<{ x: number; y: number; z: number }>
type GameplaySnapshot = Readonly<{
  dimension: Dimension
  pose: Readonly<{ feetPosition: Position }>
  fall: Readonly<{ grounded: boolean }>
}>

type PageFaults = {
  readonly consoleErrors: ReadonlyArray<string>
  readonly pageErrors: ReadonlyArray<string>
}

const watchForFaults = (page: Page): PageFaults => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))
  return { consoleErrors, pageErrors }
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

const snapshot = (page: Page): Promise<GameplaySnapshot> => callQa(page, 'gameplay.snapshot')

// The frame counter and the snapshot are read in ONE round trip, the same
// shape bow-projectile.e2e.ts's readGameplayWithFrames uses — split across
// two calls they can describe different frames, which would make
// waitForSimulationProgress's stall detection compare values that never
// coexisted.
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

test('grounds the player after a Nether portal arrival lands inside solid ground', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')

  // seedPortalArrivalIntoSolidGround registers the Nether side of the
  // crossing directly and force-sets it to solid stone through the whole
  // body height, so the arrival is deterministically embedded in rock
  // rather than depending on whatever the generator happens to produce at
  // the scaled destination — see the fixture's own comment in
  // apps/web/main.ts for why an UNDISCOVERED destination (which gets a
  // freshly built portal, frame included) would not exercise this defect
  // at all: the frame's own construction already guarantees footing.
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedPortalArrivalIntoSolidGround')
  expect(seeded.dimension).toBe('overworld')

  // Portal dwell is four seconds of standing in the block before it fires.
  // QA_PORTAL_POSE floors to one of QA_PORTAL_LAYOUT's own interior cells,
  // so the player already starts inside it — no movement is needed, only
  // enough simulated time to cross the dwell threshold.
  const crossed = await waitForSimulationProgress(
    page,
    () => readGameplayWithFrames(page),
    (current) => current.dimension === 'nether',
    { description: 'Nether portal dwell completing the crossing' },
  )
  expect(crossed.dimension).toBe('nether')

  // Without ensureSafePortalLanding, an arrival embedded in solid rock is
  // neither grounded nor falling: the player's AABB starts the frame
  // already overlapping the block instead of crossing its boundary during
  // a step, so mc-physics's resolver never pushes it out and it never
  // settles on its own. Polling the simulated frame count rather than
  // wall-clock time (the same shape survival-combat.e2e.ts's footing test
  // uses) is what makes "corrected immediately" distinguishable from
  // "never corrected" without the assertion being load-sensitive.
  let grounded = false
  for (let poll = 0; poll < 200 && !grounded; poll += 1) {
    grounded = (await page.locator('#game-canvas').getAttribute('data-player-grounded')) === 'true'
    if (!grounded) await page.waitForTimeout(20)
  }
  expect(
    grounded,
    'the player should be grounded shortly after arriving on rock the fixture set solid',
  ).toBe(true)

  // "Landing a block or two from the arithmetic destination is fine;
  // landing across the map is not" is the standard this repair is held to.
  // seedPortalArrivalIntoSolidGround fills solid rock through the ENTIRE
  // vertical band ensureSafePortalLanding searches (not just a thin slab),
  // so there is deliberately no open pocket anywhere nearby for the search
  // to find — it must exhaust the search and fall back to carving a
  // landing at the arithmetic destination itself. That fallback is exact,
  // so the resulting position should match overworldToNether(QA_PORTAL_ANCHOR)
  // almost precisely rather than merely "nearby".
  const landed = await snapshot(page)
  const netherAnchor = overworldToNether(QA_PORTAL_ANCHOR)
  const horizontalDrift = Math.hypot(
    landed.pose.feetPosition.x - netherAnchor.x,
    landed.pose.feetPosition.z - netherAnchor.z,
  )
  expect(horizontalDrift).toBeLessThanOrEqual(1)
  expect(Math.abs(landed.pose.feetPosition.y - netherAnchor.y)).toBeLessThanOrEqual(1)

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
