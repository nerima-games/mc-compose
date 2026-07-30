import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

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
    await expect.poll(async () => {
      const current = await snapshot(page)
      return {
        hasCactusContact: current.environmentalContact.cells.some(
          ({ block }) => block === 'cactus',
        ),
        healthPoints: current.vitals.healthPoints,
      }
    }, { intervals: [10], timeout: 2_000 }).toEqual({
      hasCactusContact: true,
      healthPoints: 19,
    })
  } finally {
    await page.keyboard.up('KeyD')
  }
  const contacted = await snapshot(page)
  const cactus = contacted.environmentalContact.cells.find(({ block }) => block === 'cactus')
  expect(cactus).toBeDefined()
  expect(overlapsPlayerAabb(contacted.pose.feetPosition, cactus!.position)).toBe(false)
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

  await expect.poll(async () => (await snapshot(page)).vitals.healthPoints).toBe(16)
  const reseeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedDuplicateLavaContact')
  expect(reseeded.vitals.healthPoints).toBe(20)
  expect(reseeded.environmentalContact.lastDamageElapsedSecs).toBeNull()

  await expect.poll(async () => (await snapshot(page)).vitals.healthPoints).toBe(16)
  const afterResetDamage = await snapshot(page)
  const resetDamageElapsedSecs = afterResetDamage.environmentalContact.lastDamageElapsedSecs
  expect(resetDamageElapsedSecs).not.toBeNull()
  expect(resetDamageElapsedSecs! - reseeded.environmentalContact.simulationElapsedSecs)
    .toBeGreaterThanOrEqual(0)
  expect(resetDamageElapsedSecs! - reseeded.environmentalContact.simulationElapsedSecs)
    .toBeLessThan(0.15)

  await expect.poll(async () => (await snapshot(page)).vitals.healthPoints).toBe(12)
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

  await expect.poll(async () => (await snapshot(page)).dead).toBe(true)
  const dead = await snapshot(page)
  expect(dead.vitals.healthPoints).toBe(0)
  expect(dead.vitals.lastDamageCause).toBe('lava')
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
