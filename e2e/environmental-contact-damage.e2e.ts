import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const PLAYER_HALF_WIDTH = 0.3
const PLAYER_HEIGHT = 1.8
const PHYSICS_CONTACT_EPSILON = 1e-9

type Position = { readonly x: number; readonly y: number; readonly z: number }
type EnvironmentalContactCell = {
  readonly position: Position
  readonly block: 'lava' | 'cactus'
  readonly contactDamage: number
}
type GameplaySnapshot = {
  readonly pose: { readonly feetPosition: Position }
  readonly vitals: {
    readonly healthPoints: number
    readonly lastDamageCause?: string
  }
  readonly dead: boolean
  readonly environmentalContact: {
    readonly simulationElapsedSecs: number
    readonly lastDamageElapsedSecs: number | null
    readonly cells: ReadonlyArray<EnvironmentalContactCell>
  }
}
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

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

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

const overlapsPlayerAabb = (
  feetPosition: Position,
  cellPosition: Position,
): boolean => {
  const playerMin = {
    x: feetPosition.x - PLAYER_HALF_WIDTH,
    y: feetPosition.y,
    z: feetPosition.z - PLAYER_HALF_WIDTH,
  }
  const playerMax = {
    x: feetPosition.x + PLAYER_HALF_WIDTH,
    y: feetPosition.y + PLAYER_HEIGHT,
    z: feetPosition.z + PLAYER_HALF_WIDTH,
  }
  return playerMin.x < cellPosition.x + 1
    && playerMax.x > cellPosition.x
    && playerMin.y < cellPosition.y + 1
    && playerMax.y > cellPosition.y
    && playerMin.z < cellPosition.z + 1
    && playerMax.z > cellPosition.z
}

const intervalOverlap = (
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
): number => Math.min(maxA, maxB) - Math.max(minA, minB)

const intervalGap = (
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
): number => Math.max(minB - maxA, minA - maxB, 0)

const touchesCactusHorizontalSide = (
  feetPosition: Position,
  cellPosition: Position,
): boolean => {
  const minX = feetPosition.x - PLAYER_HALF_WIDTH
  const maxX = feetPosition.x + PLAYER_HALF_WIDTH
  const minY = feetPosition.y
  const maxY = feetPosition.y + PLAYER_HEIGHT
  const minZ = feetPosition.z - PLAYER_HALF_WIDTH
  const maxZ = feetPosition.z + PLAYER_HALF_WIDTH
  const overlapsY =
    intervalOverlap(minY, maxY, cellPosition.y, cellPosition.y + 1) >
    PHYSICS_CONTACT_EPSILON
  const overlapsX =
    intervalOverlap(minX, maxX, cellPosition.x, cellPosition.x + 1) >
    PHYSICS_CONTACT_EPSILON
  const overlapsZ =
    intervalOverlap(minZ, maxZ, cellPosition.z, cellPosition.z + 1) >
    PHYSICS_CONTACT_EPSILON

  return overlapsY && (
    (intervalGap(minX, maxX, cellPosition.x, cellPosition.x + 1) <=
      PHYSICS_CONTACT_EPSILON && overlapsZ) ||
    (intervalGap(minZ, maxZ, cellPosition.z, cellPosition.z + 1) <=
      PHYSICS_CONTACT_EPSILON && overlapsX)
  )
}

const expectRealContacts = (current: GameplaySnapshot): void => {
  expect(current.environmentalContact.cells.length).toBeGreaterThan(0)
  for (const cell of current.environmentalContact.cells) {
    if (cell.block === 'lava') {
      expect(overlapsPlayerAabb(current.pose.feetPosition, cell.position)).toBe(true)
    } else {
      expect(touchesCactusHorizontalSide(current.pose.feetPosition, cell.position)).toBe(true)
    }
  }
}

test('applies cactus damage on the first normal-physics side contact', async ({
  page,
}) => {
  const faults = watchForFaults(page)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedCactusApproach')
  expect(seeded.vitals.healthPoints).toBe(20)
  expect(seeded.environmentalContact.cells).toEqual([])

  await page.keyboard.down('KeyD')
  try {
    // Contact damage lands after the physics step registers the overlap on
    // a simulated frame, not instantly on keydown — see
    // waitForSimulationProgress.
    await waitForSimulationProgress(
      page,
      () => snapshotWithFrames(page),
      (current) => (
        current.environmentalContact.cells.some(({ block }) => block === 'cactus')
        && current.vitals.healthPoints === 19
      ),
      { description: 'cactus first-contact damage' },
    )
  } finally {
    await page.keyboard.up('KeyD')
  }
  const contacted = await snapshot(page)
  const cactus = contacted.environmentalContact.cells.find(({ block }) => block === 'cactus')
  expect(cactus).toBeDefined()
  // This value is a regression guard FOR per-shape collision, not a weakened
  // check: under full-cube collision the player stops at the cell's nominal
  // face and this is false; under a cactus's real registry shape (inset one
  // sixteenth on X and Z — main.ts's `blockPropertiesAt`) the collidable
  // surface sits one sixteenth inside that face, so a player stopped against
  // it legitimately overlaps the nominal 1x1x1 cell by that same sixteenth
  // (measured: 0.0625). Revert the per-shape migration and this goes red.
  // It is still not immersion: touchesCactusHorizontalSide below is what
  // actually distinguishes a side touch (this test) from being inside the
  // cell, the way lava's overlap check (this file, above) does for a block a
  // player is meant to stand IN — that assertion is unchanged.
  expect(overlapsPlayerAabb(contacted.pose.feetPosition, cactus!.position)).toBe(true)
  expect(touchesCactusHorizontalSide(contacted.pose.feetPosition, cactus!.position)).toBe(true)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('resets lava cadence and preserves its half-second repeat interval', async ({ page }) => {
  const faults = watchForFaults(page)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedDuplicateLavaContact')
  expect(seeded.environmentalContact.cells).toHaveLength(2)
  expect(seeded.environmentalContact.cells).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ block: 'lava', contactDamage: 4 }),
      expect.objectContaining({ block: 'lava', contactDamage: 4 }),
    ]),
  )
  expectRealContacts(seeded)

  // Lava damage repeats on a simulated cadence — see
  // waitForSimulationProgress.
  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.vitals.healthPoints === 16,
    { description: 'lava contact damage' },
  )
  const reseeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedDuplicateLavaContact')
  expect(reseeded.vitals.healthPoints).toBe(20)
  expect(reseeded.environmentalContact.lastDamageElapsedSecs).toBeNull()

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.vitals.healthPoints === 16,
    { description: 'lava contact damage after reset' },
  )
  const afterResetDamage = await snapshot(page)
  const resetDamageElapsedSecs = afterResetDamage.environmentalContact.lastDamageElapsedSecs
  expect(resetDamageElapsedSecs).not.toBeNull()
  expect(resetDamageElapsedSecs! - reseeded.environmentalContact.simulationElapsedSecs)
    .toBeGreaterThanOrEqual(0)
  expect(resetDamageElapsedSecs! - reseeded.environmentalContact.simulationElapsedSecs)
    .toBeLessThan(0.15)

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.vitals.healthPoints === 12,
    { description: 'second lava contact damage tick' },
  )
  const afterSecondDamage = await snapshot(page)
  const secondDamageElapsedSecs = afterSecondDamage.environmentalContact.lastDamageElapsedSecs
  expect(secondDamageElapsedSecs).not.toBeNull()
  expect(secondDamageElapsedSecs! - resetDamageElapsedSecs!).toBeGreaterThanOrEqual(0.5)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('uses only the strongest simultaneous contact and preserves the lethal cause', async ({
  page,
}) => {
  const faults = watchForFaults(page)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedLethalMixedContact')
  expect(seeded.vitals.healthPoints).toBe(4)
  expect(seeded.environmentalContact.cells.map(({ block }) => block).sort()).toEqual([
    'cactus',
    'lava',
  ])
  expectRealContacts(seeded)

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.dead,
    { description: 'lethal contact damage' },
  )
  const dead = await snapshot(page)
  expect(dead.vitals.healthPoints).toBe(0)
  expect(dead.vitals.lastDamageCause).toBe('lava')
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
