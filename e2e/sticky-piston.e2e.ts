import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const DATABASE_NAME = 'nerima-games-minecraft'

type PistonSnapshot = {
  active: boolean
  lever: number | null
  piston: number | null
  near: number | null
  far: number | null
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

const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas')
    if (canvas === null) throw new Error('Game canvas is unavailable')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => canvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

const useTargetedBlock = async (page: Page): Promise<void> => {
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(50)
  await page.mouse.up({ button: 'right' })
}

// FIXED (was the interaction-never-registers cluster): seedStickyPistonEncounter
// restored the player to QA_IGNITION_POSE without setting
// QA_IGNITION_FLOOR_BLOCK under their feet, so the player free-fell for the
// whole encounter (the same omission fixed once before for a sibling
// fixture, see main.ts's other QA_IGNITION_FLOOR_BLOCK call sites). The
// input queue and use-action dispatch were never at fault — probe logging
// showed useTriggered firing correctly on every click; requestTargetedBlockUse
// simply found nothing along the raycast once eye height had drifted a
// block or more between the two clicks. Fixed in seedStickyPistonEncounter.
test('a lever extends and retracts a sticky piston through normal play input', async ({ page }) => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`))

  await clearDatabase(page)
  await startGameSession(page, 'sticky-piston-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  expect(await callQa<PistonSnapshot>(page, 'gameplay.seedStickyPistonEncounter')).toEqual({
    active: false,
    lever: 76,
    piston: 16,
    near: 2,
    far: 0,
  })

  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await grantPointerLock(page)
  await useTargetedBlock(page)
  await expect.poll(
    async () => callQa<PistonSnapshot>(page, 'gameplay.stickyPistonSnapshot'),
  ).toEqual({ active: true, lever: 76, piston: 16, near: 85, far: 2 })

  await useTargetedBlock(page)
  await expect.poll(
    async () => callQa<PistonSnapshot>(page, 'gameplay.stickyPistonSnapshot'),
  ).toEqual({ active: false, lever: 76, piston: 16, near: 2, far: 0 })

  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
