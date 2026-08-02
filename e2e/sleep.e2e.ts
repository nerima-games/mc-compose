import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const BED_BLOCK_ID = 112
const AIR_BLOCK_ID = 0
const DATABASE_NAME = 'nerima-games-minecraft'
const SAVE_STORE_NAME = 'saves'

type SleepSnapshot = {
  readonly dimension: string
  readonly weather: { readonly weather: string }
  readonly vitals: { readonly healthPoints: number }
  readonly target: { readonly position: Position; readonly block: number | null }
  readonly ignitionTarget: { readonly position: Position; readonly block: number | null }
  readonly bedExplosionProbe: { readonly block: number | null }
}

type Position = { readonly x: number; readonly y: number; readonly z: number }
type PersistedTime = { readonly ticks: number; readonly dayLengthTicks: number }

const callQa = <Result>(
  page: Page,
  command: string,
  ...arguments_: ReadonlyArray<unknown>
): Promise<Result> =>
  page.evaluate(
    async ({ commandName, commandArguments }) => {
      const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
        | Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>
        | undefined
      const operation = qa?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation(...commandArguments)
    },
    { commandName: command, commandArguments: arguments_ },
  ) as Promise<Result>

const useTargetedBlock = async (page: Page): Promise<void> => {
  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await page.evaluate(() => {
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (gameCanvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => gameCanvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
  await canvas.click({ button: 'right' })
}

const persistedTime = async (page: Page, sessionId: string): Promise<PersistedTime> => {
  await callQa(page, 'persistence.flush')
  return page.evaluate(async ({ databaseName, storeName, key }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName)
      request.addEventListener('success', () => resolve(request.result), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
    })
    try {
      const record = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(storeName).objectStore(storeName).get(key)
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener('error', () => reject(request.error), { once: true })
      }) as { readonly envelope?: { readonly payload?: { readonly state?: { readonly time?: PersistedTime } } } }
      const time = record.envelope?.payload?.state?.time
      if (time === undefined) throw new Error('persisted session is missing time state')
      return time
    } finally {
      database.close()
    }
  }, {
    databaseName: DATABASE_NAME,
    storeName: SAVE_STORE_NAME,
    key: `mc-compose/session/${encodeURIComponent(sessionId)}/head`,
  })
}

test('one player sleeps in a bed and advances to morning', async ({ page }) => {
  const sessionId = 'sleep-single-player-e2e'
  await startGameSession(page, sessionId)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  // Thunder makes sleep legal without a test-only clock mutation and is cleared
  // by the morning transition.
  const setup = await callQa<SleepSnapshot>(page, 'gameplay.setPose', BED_BLOCK_ID)
  expect(setup.target.block).toBe(BED_BLOCK_ID)
  await callQa<SleepSnapshot>(page, 'gameplay.setWeather')
  const timeBeforeSleep = await persistedTime(page, sessionId)
  await useTargetedBlock(page)

  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-sleep-result', 'accepted')
  await expect(body).toHaveAttribute('data-sleeping-players', '1')
  await expect(body).toHaveAttribute('data-sleep-required', '1')
  await expect(page.locator('#sleep-hud')).toHaveText('Sleeping 1/1')
  await expect(page.locator('#sleep-hud')).toBeVisible()

  await expect(body).toHaveAttribute('data-sleep-result', 'morning-skipped', { timeout: 10_000 })
  await expect(body).toHaveAttribute('data-sleeping-players', '0')
  await expect(page.locator('#sleep-hud')).toBeHidden()
  await expect.poll(async () => (await callQa<SleepSnapshot>(page, 'gameplay.snapshot')).weather.weather)
    .toBe('clear')
  const morning = await persistedTime(page, sessionId)
  expect(morning.ticks).not.toBe(timeBeforeSleep.ticks)
  expect(morning.ticks / morning.dayLengthTicks).toBeGreaterThanOrEqual(0.25)
  expect(morning.ticks / morning.dayLengthTicks).toBeLessThan(0.3)
})

test('using a bed in the Nether explodes it and damages the player', async ({ page }) => {
  await startGameSession(page, 'sleep-nether-explosion-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const before = await callQa<SleepSnapshot>(page, 'gameplay.seedBedExplosionEncounter')
  expect(before.dimension).toBe('nether')
  expect(before.ignitionTarget.block).toBe(AIR_BLOCK_ID)
  expect(before.bedExplosionProbe.block).not.toBeNull()
  expect(before.bedExplosionProbe.block).not.toBe(AIR_BLOCK_ID)

  await useTargetedBlock(page)

  await expect(page.locator('body')).toHaveAttribute('data-sleep-result', 'exploded')
  await expect(page.locator('body')).toHaveAttribute(
    'data-bed-explosion-request',
    'nether:8,66,8',
  )
  await expect.poll(async () => (
    await callQa<SleepSnapshot>(page, 'gameplay.snapshot')
  ).bedExplosionProbe.block).toBe(AIR_BLOCK_ID)
  await expect.poll(async () => (await callQa<SleepSnapshot>(page, 'gameplay.snapshot')).vitals.healthPoints)
    .toBeLessThan(before.vitals.healthPoints)
})
