import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type EndSnapshot = {
  readonly dimension: 'overworld' | 'nether' | 'end'
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly vitals: { readonly totalExperience: number }
  readonly end: {
    readonly frames: ReadonlyArray<unknown>
    readonly portalComplete: boolean
    readonly dragon: { readonly phase: string; readonly health: number }
    readonly exitPortalMaterialized: boolean
    readonly dragonEggRewarded: boolean
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

const itemCount = (snapshot: EndSnapshot, item: string): number =>
  snapshot.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

test('crafts an Eye and completes the End journey through normal player input', async ({ page }) => {
  test.setTimeout(90_000)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedEndEyeCrafting')

  const canvas = page.locator('#game-canvas')
  const inventory = page.locator('#inventory-root')
  const hotbar = inventory.locator('[data-region="hotbar"] [data-mx-ui="slot"]')
  const craftingCells = inventory.locator('[data-region="crafting-grid"] [data-mx-ui="slot"]')
  const output = inventory.locator('[data-mx-ui="crafting-output"]')

  await page.keyboard.press('KeyE')
  await hotbar.nth(0).click()
  await craftingCells.nth(0).focus()
  await page.keyboard.press('Enter')
  await hotbar.nth(1).click()
  await craftingCells.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(output).toHaveAttribute('aria-label', /eye_of_ender, 1/)
  await output.click()
  await expect.poll(async () => itemCount(
    await callQa<EndSnapshot>(page, 'gameplay.snapshot'),
    'eye_of_ender',
  )).toBe(1)

  await page.keyboard.press('KeyE')
  await grantPointerLock(page)
  await canvas.click({ button: 'right' })
  await expect(canvas).toHaveAttribute('data-stronghold-direction', /.+/)
  await expect.poll(async () => itemCount(
    await callQa<EndSnapshot>(page, 'gameplay.snapshot'),
    'eye_of_ender',
  )).toBe(0)

  await callQa(page, 'gameplay.seedEndPortalFinalFrame')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => {
    const snapshot = await callQa<EndSnapshot>(page, 'gameplay.snapshot')
    return { frames: snapshot.end.frames.length, complete: snapshot.end.portalComplete }
  }).toEqual({ frames: 12, complete: true })
  await expect(canvas).toHaveAttribute('data-end-portal-progress', '12')

  await callQa(page, 'gameplay.targetCompletedEndPortal')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => (
    await callQa<EndSnapshot>(page, 'gameplay.snapshot')
  ).dimension).toBe('end')

  await callQa(page, 'gameplay.seedEndDragonFinalHit')
  await canvas.click()
  await expect.poll(async () => {
    const snapshot = await callQa<EndSnapshot>(page, 'gameplay.snapshot')
    return {
      phase: snapshot.end.dragon.phase,
      health: snapshot.end.dragon.health,
      exit: snapshot.end.exitPortalMaterialized,
      egg: snapshot.end.dragonEggRewarded,
      eggCount: itemCount(snapshot, 'dragon_egg'),
      experience: snapshot.vitals.totalExperience,
    }
  }).toEqual({
    phase: 'dead',
    health: 0,
    exit: true,
    egg: true,
    eggCount: 1,
    experience: 12_000,
  })

  await callQa(page, 'gameplay.targetEndExitPortal')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => (
    await callQa<EndSnapshot>(page, 'gameplay.snapshot')
  ).dimension).toBe('overworld')
})
