import { expect, test, type Locator } from '@playwright/test'

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

test.describe('player inventory experience', () => {
  test('keeps HUD selection and the read-only inventory overlay in sync', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const hud = page.locator('#hud-root')
    const inventory = page.locator('#inventory-root')
    const hudHotbar = hud.locator('[data-mx-ui="hotbar"]')
    const inventoryHotbar = inventory.locator('[data-region="hotbar"]')
    await expect(inventory).toBeHidden()
    await expect(inventory).toHaveAttribute('aria-readonly', 'true')
    await expect(inventory.locator('[data-region="hotbar"] [data-mx-ui="slot"]')).toHaveCount(9)
    await expect(inventory.locator('[data-region="main"] [data-mx-ui="slot"]')).toHaveCount(27)

    await page.keyboard.press('Digit3')
    await expect.poll(() => selectedSlotIndex(hudHotbar)).toBe(2)

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeVisible()
    await expect(page.locator('body')).toHaveAttribute('data-inventory-open', 'true')
    await expect.poll(() => selectedSlotIndex(inventoryHotbar)).toBe(2)

    await page.keyboard.press('Digit5')
    await expect.poll(() => selectedSlotIndex(hudHotbar)).toBe(2)
    await expect.poll(() => selectedSlotIndex(inventoryHotbar)).toBe(2)

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await page.keyboard.press('Digit5')
    await expect.poll(() => selectedSlotIndex(hudHotbar)).toBe(4)
  })
})
