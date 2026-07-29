import { expect, test, type Locator, type Page } from '@playwright/test'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

const callQa = async (page: Page, key: string): Promise<unknown> =>
  page.evaluate(({ globalKey, commandKey }) => {
    const commands = (globalThis as unknown as Record<string, Record<string, () => unknown>>)[globalKey]
    return commands?.[commandKey]?.()
  }, { globalKey: QA_GLOBAL_KEY, commandKey: key })

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

test.describe('player inventory experience', () => {
  test('keeps HUD selection and the interactive inventory overlay in sync', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

    const hud = page.locator('#hud-root')
    const inventory = page.locator('#inventory-root')
    const hudHotbar = hud.locator('[data-mx-ui="hotbar"]')
    const inventoryHotbar = inventory.locator('[data-region="hotbar"]')
    await expect(inventory).toBeHidden()
    await expect(inventory).not.toHaveAttribute('aria-readonly', 'true')
    await expect(inventory).not.toHaveAttribute('data-readonly', 'true')
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

  test('crafts four planks through the service and clears a draft on close', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    await callQa(page, 'gameplay.seedCraftingLog')

    const inventory = page.locator('#inventory-root')
    const hotbarSlot = inventory.locator('[data-region="hotbar"] [data-slot-index="0"]')
    const craftingCell = inventory.locator('[data-region="crafting-grid"] [data-slot-index="0"]')
    const output = inventory.locator('[data-mx-ui="crafting-output"]')

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeVisible()
    await expect(hotbarSlot).toHaveAttribute('aria-label', /oak_log/)

    await hotbarSlot.click()
    await craftingCell.focus()
    await page.keyboard.press('Enter')
    await expect(output).toHaveAttribute('aria-label', /oak_planks, 4/)

    await output.click()
    await expect(inventory.locator('[data-mx-ui="inventory-status"]')).toContainText(
      'Crafted 4 oak_planks',
    )
    await expect(hotbarSlot).toHaveAttribute('aria-label', /oak_planks, 4/)
    await expect(page.locator('body')).toHaveAttribute('data-session-persistence', /dirty|saved/)

    await callQa(page, 'gameplay.seedCraftingLog')
    await hotbarSlot.click()
    await craftingCell.focus()
    await page.keyboard.press('Enter')
    await expect(craftingCell).toHaveAttribute('aria-label', /oak_log/)

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await page.keyboard.press('KeyE')
    await expect(inventory).toBeVisible()
    await expect(craftingCell).toHaveAttribute('aria-label', /empty/)
    await expect(
      inventory.locator('[data-mx-ui="crafting-outcome"]'),
    ).toHaveAttribute('data-crafting-state', 'unknown')
    await expect(output).toBeHidden()
  })
})
