import { expect, test, type Locator, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
    readonly durability: ReadonlyArray<{ readonly current: number; readonly max: number } | null>
  }
  readonly ignitionTarget: {
    readonly block: number | null
  }
}

const callQa = <A>(page: Page, command: string, ...arguments_: ReadonlyArray<unknown>): Promise<A> =>
  page.evaluate(
    async ({ key, commandName, commandArguments }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation(...commandArguments)
    },
    { key: QA_GLOBAL_KEY, commandName: command, commandArguments: arguments_ },
  ) as Promise<A>

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

const grantPointerLock = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (gameCanvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => gameCanvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
}

test.describe('player inventory experience', () => {
  test('keeps HUD selection and the interactive inventory overlay in sync', async ({ page }) => {
    await startGameSession(page)
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
    await expect(inventory).toHaveAttribute('aria-label', 'Inventory')
    await expect(
      inventory.locator('[data-region="crafting-grid"] [data-mx-ui="slot"]'),
    ).toHaveCount(4)
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
    await startGameSession(page)
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

    const mainSlot = inventory.locator('[data-region="main"] [data-slot-index="0"]')
    await hotbarSlot.click({ button: 'right' })
    await expect(hotbarSlot).toHaveAttribute('aria-label', /oak_planks, 2/)
    await mainSlot.click({ button: 'right' })
    await expect(mainSlot).toHaveAttribute('aria-label', /oak_planks, 1/)
    await mainSlot.click({ button: 'right' })
    await expect(mainSlot).toHaveAttribute('aria-label', /oak_planks, 2/)

    await mainSlot.click()
    await expect(mainSlot).toHaveAttribute('aria-label', /empty/)
    await hotbarSlot.click()
    await expect(hotbarSlot).toHaveAttribute('aria-label', /oak_planks, 4/)

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

  test('progresses from wood through diamond and mines obsidian', async ({ page }) => {
    await startGameSession(page)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    await callQa(page, 'gameplay.seedWoodenPickaxeProgression')

    const canvas = page.locator('#game-canvas')
    const inventory = page.locator('#inventory-root')
    const craftingCells = inventory.locator(
      '[data-region="crafting-grid"] [data-mx-ui="slot"]',
    )
    const output = inventory.locator('[data-mx-ui="crafting-output"]')
    const inventoryItemSlot = (item: string): Locator =>
      inventory.locator(
        `[data-region="hotbar"] [data-mx-ui="slot"][aria-label*="${item}"], ` +
        `[data-region="main"] [data-mx-ui="slot"][aria-label*="${item}"]`,
      ).first()

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeVisible()
    await expect(inventoryItemSlot('oak_log')).toHaveAttribute('aria-label', /oak_log, 3/)

    for (let craftIndex = 0; craftIndex < 3; craftIndex += 1) {
      await inventoryItemSlot('oak_log').click()
      await craftingCells.nth(0).click()
      await expect(output).toHaveAttribute('aria-label', /oak_planks, 4/)
      await output.click()
    }
    await expect(inventoryItemSlot('oak_planks')).toHaveAttribute('aria-label', /oak_planks, 12/)

    for (const cellIndex of [0, 1, 2, 3]) {
      await inventoryItemSlot('oak_planks').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /crafting_table, 1/)
    await output.click()

    const craftingTableSlot = inventory.locator(
      '[data-region="hotbar"] [data-mx-ui="slot"][aria-label*="crafting_table"]',
    )
    await expect(craftingTableSlot).toHaveAttribute('aria-label', /crafting_table, 1/)
    const craftingTableSlotIndex = Number(
      await craftingTableSlot.getAttribute('data-slot-index'),
    )

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await page.keyboard.press(`Digit${craftingTableSlotIndex + 1}`)
    const heldTableSlot = page.locator(
      `#hud-root [data-mx-ui="hotbar"] [data-slot-index="${craftingTableSlotIndex}"]`,
    )
    await expect(heldTableSlot).toContainText('crafting_table')

    await grantPointerLock(page)
    await canvas.click({ button: 'right' })
    await expect(heldTableSlot).toHaveAttribute('data-empty', '')

    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')
    await expect(craftingCells).toHaveCount(9)

    for (const cellIndex of [0, 3]) {
      await inventoryItemSlot('oak_planks').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /stick, 4/)
    await output.click()

    for (const cellIndex of [0, 1, 2]) {
      await inventoryItemSlot('oak_planks').click()
      await craftingCells.nth(cellIndex).click()
    }
    for (const cellIndex of [4, 7]) {
      await inventoryItemSlot('stick').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /wooden_pickaxe, 1/)
    await output.click()
    await expect(inventoryItemSlot('wooden_pickaxe')).toHaveAttribute(
      'aria-label',
      /wooden_pickaxe, 1/,
    )

    const selectHotbarItem = async (item: string): Promise<number> => {
      const slot = inventory.locator(
        `[data-region="hotbar"] [data-mx-ui="slot"][aria-label*="${item}"]`,
      )
      await expect(slot).toHaveCount(1)
      const slotIndex = Number(await slot.getAttribute('data-slot-index'))
      await page.keyboard.press(`Digit${slotIndex + 1}`)
      await expect.poll(() => selectedSlotIndex(page.locator('#hud-root [data-mx-ui="hotbar"]')))
        .toBe(slotIndex)
      return slotIndex
    }
    const itemCount = async (item: string): Promise<number> => {
      const snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
      return snapshot.inventory.slots.reduce(
        (count, slot) => count + (slot?.item === item ? slot.count : 0),
        0,
      )
    }
    const mineCurrentTarget = async (): Promise<void> => {
      const before = Number(await canvas.getAttribute('data-breaks-requested') ?? '0')
      await canvas.hover()
      await grantPointerLock(page)
      await page.mouse.down({ button: 'left' })
      try {
        await expect(canvas).toHaveAttribute('data-breaks-requested', String(before + 1), {
          timeout: 10_000,
        })
      } finally {
        await page.mouse.up({ button: 'left' })
      }
    }

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    const woodenPickaxeSlotIndex = await selectHotbarItem('wooden_pickaxe')

    for (let mined = 1; mined <= 3; mined += 1) {
      await callQa<unknown>(page, 'gameplay.setPose', 2)
      await mineCurrentTarget()
      await expect.poll(() => itemCount('cobblestone')).toBe(mined)
    }
    const afterStone = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterStone.inventory.durability[woodenPickaxeSlotIndex]?.current).toBe(56)

    await callQa<unknown>(page, 'gameplay.returnToCraftingTable')
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')

    for (const cellIndex of [0, 1, 2]) {
      await inventoryItemSlot('cobblestone').click()
      await craftingCells.nth(cellIndex).click()
    }
    for (const cellIndex of [4, 7]) {
      await inventoryItemSlot('stick').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /stone_pickaxe, 1/)
    await output.click()
    await expect(inventoryItemSlot('stone_pickaxe')).toHaveAttribute(
      'aria-label',
      /stone_pickaxe, 1/,
    )

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    const stonePickaxeSlotIndex = await selectHotbarItem('stone_pickaxe')
    for (let mined = 1; mined <= 3; mined += 1) {
      await callQa<unknown>(page, 'gameplay.setPose', 51)
      await mineCurrentTarget()
      await expect.poll(() => itemCount('raw_iron')).toBe(mined)
    }

    await callQa<unknown>(page, 'gameplay.setPose', 50)
    await mineCurrentTarget()
    await expect.poll(() => itemCount('coal')).toBe(1)

    const afterIron = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterIron.inventory.durability[stonePickaxeSlotIndex]?.current).toBe(127)

    for (let mined = 1; mined <= 8; mined += 1) {
      await callQa<unknown>(page, 'gameplay.setPose', 2)
      await mineCurrentTarget()
      await expect.poll(() => itemCount('cobblestone')).toBe(mined)
    }
    const afterFurnaceStone = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterFurnaceStone.inventory.durability[stonePickaxeSlotIndex]?.current).toBe(119)

    await callQa<unknown>(page, 'gameplay.returnToCraftingTable')
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')

    for (const cellIndex of [0, 1, 2, 3, 5, 6, 7, 8]) {
      await inventoryItemSlot('cobblestone').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /furnace, 1/)
    await output.click()
    await expect(inventoryItemSlot('furnace')).toHaveAttribute('aria-label', /furnace, 1/)

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await selectHotbarItem('raw_iron')
    await mineCurrentTarget()
    await expect.poll(() => itemCount('crafting_table')).toBe(1)
    await expect.poll(async () => {
      const snapshot = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
      return snapshot.ignitionTarget.block
    }).toBe(0)
    await callQa<unknown>(page, 'gameplay.returnToCraftingTable')
    await selectHotbarItem('furnace')
    await grantPointerLock(page)
    const placementsBefore = Number(
      await canvas.getAttribute('data-placements-requested') ?? '0',
    )
    await canvas.click({ button: 'right' })
    await expect(canvas).toHaveAttribute(
      'data-placements-requested',
      String(placementsBefore + 1),
    )
    await expect.poll(() => itemCount('furnace')).toBe(0)
    await selectHotbarItem('raw_iron')
    await grantPointerLock(page)
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Furnace')

    const furnaceInput = inventory.locator('[data-furnace-slot="input"]')
    const furnaceFuel = inventory.locator('[data-furnace-slot="fuel"]')
    const furnaceOutput = inventory.locator('[data-furnace-slot="output"]')
    const cookProgress = inventory.locator('[data-mx-ui="furnace-cook-progress"]')
    await expect(furnaceInput).toBeFocused()
    for (let inputCount = 1; inputCount <= 3; inputCount += 1) {
      await furnaceInput.click()
      await expect(furnaceInput).toHaveAttribute(
        'aria-label',
        new RegExp(`raw_iron, ${inputCount}`),
      )
    }

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await selectHotbarItem('coal')
    await grantPointerLock(page)
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await furnaceFuel.click()
    await expect(furnaceFuel).toHaveAttribute('aria-label', /coal, 1/)
    await expect(cookProgress).not.toHaveAttribute('aria-valuenow', '0')
    await expect(furnaceOutput).toHaveAttribute('aria-label', /iron_ingot, 3/, {
      timeout: 35_000,
    })

    await furnaceOutput.click()
    await expect.poll(() => itemCount('iron_ingot')).toBe(3)

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    await selectHotbarItem('stone_pickaxe')
    await mineCurrentTarget()
    await expect.poll(() => itemCount('furnace')).toBe(1)

    await callQa<unknown>(page, 'gameplay.returnToCraftingTable')
    await selectHotbarItem('crafting_table')
    await grantPointerLock(page)
    await canvas.click({ button: 'right' })
    await expect.poll(() => itemCount('crafting_table')).toBe(0)
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')

    for (const cellIndex of [0, 3]) {
      await inventoryItemSlot('oak_planks').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /stick, 4/)
    await output.click()

    for (const cellIndex of [0, 1, 2]) {
      await inventoryItemSlot('iron_ingot').click()
      await craftingCells.nth(cellIndex).click()
    }
    for (const cellIndex of [4, 7]) {
      await inventoryItemSlot('stick').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /iron_pickaxe, 1/)
    await output.click()
    await expect(inventoryItemSlot('iron_pickaxe')).toHaveAttribute(
      'aria-label',
      /iron_pickaxe, 1/,
    )

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    const ironPickaxeSlotIndex = await selectHotbarItem('iron_pickaxe')
    const beforeGold = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(beforeGold.inventory.durability[ironPickaxeSlotIndex]?.current).toBe(250)

    await callQa<unknown>(page, 'gameplay.setPose', 52)
    await mineCurrentTarget()
    await expect.poll(() => itemCount('raw_gold')).toBe(1)
    const afterGold = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterGold.inventory.durability[ironPickaxeSlotIndex]?.current).toBe(249)

    for (let mined = 1; mined <= 3; mined += 1) {
      await callQa<unknown>(page, 'gameplay.setPose', 53)
      await mineCurrentTarget()
      await expect.poll(() => itemCount('diamond')).toBe(mined)
    }
    const afterDiamond = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterDiamond.inventory.durability[ironPickaxeSlotIndex]?.current).toBe(246)

    await callQa<unknown>(page, 'gameplay.returnToCraftingTable')
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')

    for (const cellIndex of [0, 1, 2]) {
      await inventoryItemSlot('diamond').click()
      await craftingCells.nth(cellIndex).click()
    }
    for (const cellIndex of [4, 7]) {
      await inventoryItemSlot('stick').click()
      await craftingCells.nth(cellIndex).click()
    }
    await expect(output).toHaveAttribute('aria-label', /diamond_pickaxe, 1/)
    await output.click()
    await expect(inventoryItemSlot('diamond_pickaxe')).toHaveAttribute(
      'aria-label',
      /diamond_pickaxe, 1/,
    )

    await page.keyboard.press('KeyE')
    await expect(inventory).toBeHidden()
    const diamondPickaxeSlotIndex = await selectHotbarItem('diamond_pickaxe')
    const beforeObsidian = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(beforeObsidian.inventory.durability[diamondPickaxeSlotIndex]?.current).toBe(1561)

    await callQa<unknown>(page, 'gameplay.setPose', 40)
    await mineCurrentTarget()
    await expect.poll(() => itemCount('obsidian')).toBe(1)
    const afterObsidian = await callQa<GameplaySnapshot>(page, 'gameplay.snapshot')
    expect(afterObsidian.inventory.durability[diamondPickaxeSlotIndex]?.current).toBe(1560)
  })

  test('opens an empty 3x3 crafting table through targeted canvas use', async ({ page }) => {
    await startGameSession(page)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    await callQa(page, 'gameplay.seedCraftingTableEncounter')

    const canvas = page.locator('#game-canvas')
    const hudHotbarSlot = page.locator(
      '#hud-root [data-mx-ui="hotbar"] [data-slot-index="0"]',
    )
    const inventory = page.locator('#inventory-root')
    const craftingCells = inventory.locator(
      '[data-region="crafting-grid"] [data-mx-ui="slot"]',
    )

    await expect(hudHotbarSlot).toHaveAttribute('data-empty', '')
    await grantPointerLock(page)
    await canvas.click({ button: 'right' })
    await expect(inventory).toBeVisible()
    await expect(inventory).toHaveAttribute('aria-label', 'Crafting Table')
    await expect(craftingCells).toHaveCount(9)
    await expect(
      inventory.locator('[data-region="crafting-grid"] [data-mx-ui="slot"][data-empty]'),
    ).toHaveCount(9)
  })
})
