import { expect, test } from '@playwright/test'

import { startGameSession } from './helpers/session'

test('Escape closes inventory before toggling pause', async ({ page }) => {
  await startGameSession(page, 'escape-priority')
  const body = page.locator('body')
  const gameShell = page.getByTestId('game-shell')
  const canvas = page.locator('#game-canvas')
  const pauseOverlay = page.getByTestId('pause-overlay')
  const resumeButton = page.getByTestId('resume-button')
  const saveQuitButton = page.getByTestId('save-quit-button')

  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(canvas).toHaveAttribute('aria-label', 'Minecraft game world')
  await page.keyboard.press('e')
  await expect(body).toHaveAttribute('data-inventory-open', 'true')

  await page.keyboard.press('Escape')
  await expect(body).toHaveAttribute('data-inventory-open', 'false')
  await expect(pauseOverlay).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(pauseOverlay).toBeVisible()
  await expect(gameShell).toHaveAttribute('inert', '')
  await expect(resumeButton).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await expect(saveQuitButton).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(resumeButton).toBeFocused()

  await resumeButton.click()
  await expect(pauseOverlay).toBeHidden()
  await expect(gameShell).not.toHaveAttribute('inert', '')
  await expect(canvas).toBeFocused()
  await expect(body).toHaveAttribute('data-inventory-open', 'false')
})
