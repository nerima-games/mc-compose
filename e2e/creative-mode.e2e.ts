import { expect, test, type Page } from '@playwright/test'

import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly mode: 'survival' | 'creative'
  readonly vitals: { readonly healthPoints: number; readonly hungerPoints: number }
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly target: { readonly block: number | null }
  readonly ignitionTarget: { readonly block: number | null }
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(async ({ key, commandName }) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = surface?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return await operation()
  }, { key: QA_GLOBAL_KEY, commandName: command }) as Promise<A>

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

type BreakProgress = { readonly requests: number; readonly block: number | null }
type PlacementProgress = { readonly requests: number; readonly placed: boolean; readonly stone: number }

const readBreakProgress = (
  page: Page,
): Promise<{ frames: number; value: BreakProgress }> =>
  page.evaluate((key) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const snap = surface?.['gameplay.snapshot']?.() as GameplaySnapshot | undefined
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: {
        requests: Number(canvas?.getAttribute('data-breaks-requested')),
        block: snap?.target.block ?? null,
      },
    }
  }, QA_GLOBAL_KEY)

const readPlacementProgress = (
  page: Page,
): Promise<{ frames: number; value: PlacementProgress }> =>
  page.evaluate((key) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const snap = surface?.['gameplay.snapshot']?.() as GameplaySnapshot | undefined
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    const stone = (snap?.inventory.slots ?? []).reduce(
      (total, slot) => total + (slot?.item === 'stone' ? slot.count : 0),
      0,
    )
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: {
        requests: Number(canvas?.getAttribute('data-placements-requested')),
        placed: snap !== undefined
          && snap.ignitionTarget.block !== null
          && snap.ignitionTarget.block !== 0,
        stone,
      },
    }
  }, QA_GLOBAL_KEY)

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

test('creates, plays, saves, and resumes a Creative world', async ({ page }) => {
  await page.goto('/')
  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('[data-mx-ui="menu-world-name"]').fill('Creative E2E')
  await page.locator('[data-mx-ui="menu-game-mode"]').click()
  await expect(page.locator('[data-mx-ui="menu-game-mode"]')).toHaveAttribute(
    'aria-label',
    'Game mode: Creative',
  )
  await page.locator('[data-menu-action="confirm"]').click()

  await expect(page).toHaveURL(/mode=creative$/u)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const sessionId = new URL(page.url()).searchParams.get('session')
  expect(sessionId).not.toBeNull()
  expect((await snapshot(page)).mode).toBe('creative')

  const breakSeed = await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativeBreakEncounter')
  expect(breakSeed.target.block).not.toBeNull()
  await grantPointerLock(page)
  const canvas = page.locator('#game-canvas')
  const breaksBefore = Number(await canvas.getAttribute('data-breaks-requested'))
  await canvas.hover()
  await page.mouse.down({ button: 'left' })
  try {
    // Breaking accumulates mining progress over simulated frames, which fall
    // behind wall-clock time under host contention — see
    // waitForSimulationProgress.
    await waitForSimulationProgress(
      page,
      () => readBreakProgress(page),
      (progress) => progress.requests === breaksBefore + 1 && progress.block === 0,
      { description: 'creative-mode block break' },
    )
  } finally {
    await page.mouse.up({ button: 'left' })
  }

  const placementSeed = await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativePlacementEncounter')
  const stoneBefore = inventoryCount(placementSeed, 'stone')
  const placementsBefore = Number(await canvas.getAttribute('data-placements-requested'))
  await canvas.hover()
  await page.mouse.down({ button: 'right' })
  try {
    await waitForSimulationProgress(
      page,
      () => readPlacementProgress(page),
      (progress) => (
        progress.requests === placementsBefore + 1
        && progress.placed
        && progress.stone === stoneBefore
      ),
      { description: 'creative-mode block placement' },
    )
  } finally {
    await page.mouse.up({ button: 'right' })
  }

  const beforeDamage = await snapshot(page)
  const afterDamage = await callQa<GameplaySnapshot>(page, 'gameplay.damage')
  expect(afterDamage.vitals).toEqual(beforeDamage.vitals)

  await page.keyboard.press('Escape')
  await page.getByTestId('save-quit-button').click()
  await page.locator('[data-menu-entry="load-world"]').click()
  const savedSession = page.locator('[data-mx-ui="menu-world-row"]', {
    has: page.locator('[data-mx-ui="menu-world-session-id"]', { hasText: sessionId ?? '' }),
  })
  await savedSession.click()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  expect((await snapshot(page)).mode).toBe('creative')
})
