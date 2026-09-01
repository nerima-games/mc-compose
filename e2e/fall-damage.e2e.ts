import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly pose: {
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  }
  readonly dimension: 'overworld' | 'nether'
  readonly vitals: {
    readonly healthPoints: number
    readonly lastDamageCause?: string
  }
  readonly dead: boolean
  readonly fall: {
    readonly grounded: boolean
    readonly accumulatedDistance: number
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

const startRunningGame = async (page: Page) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  return { consoleErrors, pageErrors }
}

const waitForLanding = async (page: Page, healthPoints: number) => {
  // Falling and landing are physics simulated over several frames, not
  // instant — see waitForSimulationProgress.
  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => (
      current.fall.grounded
      && current.pose.feetPosition.y === 65
      && current.vitals.healthPoints === healthPoints
    ),
    { description: 'fall landing' },
  )
}

test('keeps a normal-physics fall within the safe distance harmless', async ({ page }) => {
  const faults = await startRunningGame(page)
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedSafeFall')
  expect(seeded.pose.feetPosition.y - 65).toBeLessThanOrEqual(3)

  await waitForLanding(page, 20)
  await page.waitForTimeout(150)
  expect((await snapshot(page)).vitals.healthPoints).toBe(20)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('applies ceil(distance - 3) once for a damaging landing', async ({ page }) => {
  const faults = await startRunningGame(page)
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedDamagingFall')
  expect(seeded.pose.feetPosition.y - 65).toBe(7)

  await waitForLanding(page, 16)
  await page.waitForTimeout(150)
  expect((await snapshot(page)).vitals.healthPoints).toBe(16)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('uses the existing death and respawn flow for a lethal landing', async ({ page }) => {
  const faults = await startRunningGame(page)
  await callQa<GameplaySnapshot>(page, 'gameplay.seedLethalFall')

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.dead,
    { description: 'lethal fall landing' },
  )
  const dead = await snapshot(page)
  expect(dead.vitals.healthPoints).toBe(0)
  expect(dead.vitals.lastDamageCause).toBe('fall')

  const respawned = await callQa<GameplaySnapshot>(page, 'gameplay.respawn')
  expect(respawned.dead).toBe(false)
  expect(respawned.vitals.healthPoints).toBe(20)
  await page.waitForTimeout(150)
  expect((await snapshot(page)).vitals.healthPoints).toBe(20)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('does not replay a consumed landing after a dimension change', async ({ page }) => {
  const faults = await startRunningGame(page)
  await callQa<GameplaySnapshot>(page, 'gameplay.seedDamagingFall')
  await waitForLanding(page, 16)

  const changed = await callQa<GameplaySnapshot>(page, 'gameplay.enterNether')
  expect(changed.dimension).toBe('nether')
  expect(changed.vitals.healthPoints).toBe(16)
  await page.waitForTimeout(150)
  const stable = await snapshot(page)
  expect(stable.dimension).toBe('nether')
  expect(stable.vitals.healthPoints).toBe(16)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
