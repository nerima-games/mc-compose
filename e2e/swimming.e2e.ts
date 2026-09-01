import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const MAX_OXYGEN_SECS = 15

type SwimmingSnapshot = {
  readonly swimming: {
    readonly active: boolean
    readonly fullySubmerged: boolean
    readonly oxygenSecs: number
  }
  readonly vitals: { readonly healthPoints: number }
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

const snapshot = (page: Page): Promise<SwimmingSnapshot> =>
  callQa(page, 'gameplay.snapshot')

const snapshotWithFrames = (page: Page): Promise<{ frames: number; value: SwimmingSnapshot }> =>
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
  ) as Promise<{ frames: number; value: SwimmingSnapshot }>

test('consumes oxygen, applies drowning damage, and recovers after surfacing', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedSubmergedSwimmingEncounter')

  // Oxygen depletion, drowning damage, and post-surfacing recovery are all
  // simulated-time-gated (seconds of simulated time draining a per-second
  // counter), not instant UI responses — see waitForSimulationProgress.
  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => (
      current.swimming.active
      && current.swimming.fullySubmerged
      && current.swimming.oxygenSecs < MAX_OXYGEN_SECS
    ),
    { description: 'oxygen depletion begins' },
  )
  await expect(page.locator('[data-testid="swimming"]')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-swimming-pose', 'swimming')

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.vitals.healthPoints < 20,
    { description: 'drowning damage' },
  )
  const drowned = await snapshot(page)
  expect(drowned.swimming.oxygenSecs).toBe(0)

  await callQa(page, 'gameplay.leaveSubmergedSwimmingEncounter')
  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => (
      !current.swimming.active
      && !current.swimming.fullySubmerged
      && current.swimming.oxygenSecs > drowned.swimming.oxygenSecs
    ),
    { description: 'oxygen recovery after surfacing' },
  )
  await expect(page.locator('[data-testid="swimming"]')).toBeHidden()

  const surfaced = await snapshot(page)
  await page.waitForTimeout(1_200)
  expect((await snapshot(page)).vitals.healthPoints).toBe(surfaced.vitals.healthPoints)
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
