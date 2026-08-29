import { expect, test } from '@playwright/test'

test('returns to the title screen when the requested saved world is missing', async ({ page }) => {
  await page.goto('/?session=missing-e2e-session')

  await expect(page).toHaveURL('/?loadError=missing-session')
  await expect(page.getByTestId('title-screen')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-route', 'title')
  await expect(page.locator('#title-status')).toHaveText(
    'The requested saved world could not be found.',
  )
})

test('creates, saves, and reloads a session from the title screen', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('title-screen')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-route', 'title')

  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('[data-mx-ui="menu-world-name"]').fill('E2E Lifecycle')
  await page.locator('[data-menu-action="confirm"]').click()

  await expect(page).toHaveURL(/\?session=e2e-lifecycle-[^&]+$/u)
  const sessionId = new URL(page.url()).searchParams.get('session')
  expect(sessionId).not.toBeNull()
  await expect(page.getByTestId('game-shell')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const initialInventory = await page.evaluate(async () => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const snapshot = await qa?.['gameplay.snapshot']?.() as {
      readonly inventory: { readonly slots: ReadonlyArray<unknown> }
    } | undefined
    return snapshot?.inventory.slots
  })
  expect(initialInventory).toHaveLength(36)
  expect(initialInventory?.every((slot) => slot === null)).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pause-overlay')).toBeVisible()
  await page.getByTestId('save-quit-button').click()

  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('title-screen')).toBeVisible()
  await page.locator('[data-menu-entry="load-world"]').click()

  const savedSession = page.locator('[data-mx-ui="menu-world-row"]', {
    has: page.locator(`[data-mx-ui="menu-world-session-id"]`, { hasText: sessionId ?? '' }),
  })
  await expect(savedSession).toHaveAttribute('data-session-id', sessionId ?? '')
  await expect(savedSession).toContainText('E2E Lifecycle')

  const conflictingCreate = new URLSearchParams({
    session: sessionId ?? '',
    create: '1',
    name: 'Replacement Name',
    mode: 'survival',
  })
  await page.goto(`/?${conflictingCreate.toString()}`)
  await expect(page.getByTestId('game-shell')).toBeVisible()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('pause-overlay')).toBeVisible()
  await page.getByTestId('save-quit-button').click()
  await page.locator('[data-menu-entry="load-world"]').click()
  await expect(savedSession).toContainText('E2E Lifecycle')
  await expect(savedSession).not.toContainText('Replacement Name')
  await savedSession.click()

  await expect(page).toHaveURL(`/?session=${encodeURIComponent(sessionId ?? '')}`)
  await expect(page.getByTestId('game-shell')).toBeVisible()
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')
})
