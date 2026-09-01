import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly vitals: {
    readonly healthPoints: number
    readonly totalExperience: number
  }
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly entities: ReadonlyArray<{ readonly kind: string }>
  readonly brewing: {
    readonly fuelUnits: number
    readonly bottle?: 'water_bottle' | { readonly potion: string }
    readonly ingredient?: string
    readonly brewing?: { readonly output: string; readonly remainingSecs: number }
  }
  readonly statusEffects: {
    readonly effects: ReadonlyArray<{ readonly type: string; readonly remainingSecs: number }>
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

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const grantPointerLock = (page: Page): Promise<void> => page.evaluate(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
  if (canvas === null) throw new Error('missing game canvas')
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    get: () => canvas,
  })
  document.dispatchEvent(new Event('pointerlockchange'))
})

const openBrewingStand = async (page: Page): Promise<void> => {
  // hover() before grantPointerLock(): the render package's input adapter
  // starts accumulating movementX/movementY as soon as it sees the faked
  // pointerlockchange, and Playwright cannot grant genuine pointer lock, so a
  // real cursor move (click()'s own move-to-target step included) after the
  // fake lock is set would be read as a full-size look delta instead of a
  // per-frame one. Moving the cursor first makes click()'s internal move a
  // no-op.
  await page.locator('#game-canvas').hover()
  await grantPointerLock(page)
  await page.locator('#game-canvas').click({ button: 'right' })
  await expect(page.locator('#brewing-root')).toBeVisible()
}

const selectAndInsert = async (page: Page, digit: string): Promise<void> => {
  const brewing = page.locator('#brewing-root')
  await page.keyboard.press(digit)
  await page.waitForTimeout(100)
  if (!(await brewing.isVisible())) await openBrewingStand(page)
  await brewing.locator('[data-brewing-action="insert"]').click()
}

test.describe('brewing, effects, and experience', () => {
  // FIXED (was the interaction-never-registers cluster): seedBrewingEncounter
  // restored the player to QA_IGNITION_POSE without setting
  // QA_IGNITION_FLOOR_BLOCK under their feet, so the player free-fell for the
  // whole encounter (same omission fixed once before for a sibling fixture,
  // see main.ts's other QA_IGNITION_FLOOR_BLOCK call sites). The click itself
  // always reached the input queue; requestTargetedBlockUse's raycast simply
  // found nothing once eye height had drifted enough. Fixed in
  // seedBrewingEncounter.
  test('brews through the normal UI and persists brewing and poison', async ({ page }) => {
    test.setTimeout(120_000)
    const sessionId = `brewing-${String(Date.now())}`
    await startGameSession(page, sessionId)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    await callQa(page, 'gameplay.seedBrewingEncounter')

    await selectAndInsert(page, 'Digit1')
    await selectAndInsert(page, 'Digit1')
    await selectAndInsert(page, 'Digit2')
    await selectAndInsert(page, 'Digit3')
    await expect.poll(async () => (await snapshot(page)).brewing.brewing?.output).toBe('awkward')

    const beforeReload = await snapshot(page)
    expect(beforeReload.brewing.bottle).toBe('water_bottle')
    expect(beforeReload.brewing.ingredient).toBeUndefined()
    await callQa(page, 'persistence.flush')
    await startGameSession(page, sessionId)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    const restoredBrewing = await snapshot(page)
    expect(restoredBrewing.brewing.brewing?.output).toBe('awkward')
    expect(restoredBrewing.brewing.brewing?.remainingSecs).toBeLessThanOrEqual(
      beforeReload.brewing.brewing?.remainingSecs ?? 20,
    )

    await callQa(page, 'gameplay.seedBrewingEncounter')
    await selectAndInsert(page, 'Digit1')
    await selectAndInsert(page, 'Digit1')
    await selectAndInsert(page, 'Digit2')
    await selectAndInsert(page, 'Digit3')
    await expect.poll(async () => (await snapshot(page)).brewing.bottle, { timeout: 30_000 })
      .toEqual({ potion: 'awkward' })
    await selectAndInsert(page, 'Digit4')
    await expect.poll(async () => (await snapshot(page)).brewing.bottle, { timeout: 30_000 })
      .toEqual({ potion: 'poison' })

    const brewing = page.locator('#brewing-root')
    await brewing.locator('[data-brewing-action="collect"]').click()
    await expect.poll(async () => (await snapshot(page)).inventory.slots[0]?.item).toBe('potion_of_poison')
    await selectAndInsert(page, 'Digit1')
    await brewing.locator('[data-brewing-action="drink"]').click()

    await expect(page.locator('[data-testid="status-effects"]')).toContainText('poison:')
    await expect.poll(async () => (await snapshot(page)).statusEffects.effects[0]?.type).toBe('poison')
    await callQa(page, 'persistence.flush')
    await startGameSession(page, sessionId)
    await expect(page.locator('[data-testid="status-effects"]')).toContainText('poison:')
    expect((await snapshot(page)).statusEffects.effects[0]?.remainingSecs).toBeGreaterThan(0)
  })

  test('awards mob experience through a normal attack and persists the HUD value', async ({ page }) => {
    const sessionId = `experience-${String(Date.now())}`
    await startGameSession(page, sessionId)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    await callQa(page, 'gameplay.seedMeleeDropEncounter')
    const experienceBefore = (await snapshot(page)).vitals.totalExperience

    // Move the cursor BEFORE granting the synthetic lock. Once the lock flag is
    // set, the input adapter accumulates every subsequent mouse movement as a
    // look delta, and a cursor move made afterwards arrives as one large jump —
    // enough to swing the aim off the target so a melee swing hits nothing.
    // CI observed exactly that here: the mob survived the attack (one non-drop
    // entity remaining where none was expected) while the same sequence passes
    // locally, and every helper in this suite using this order has been reliable.
    await page.locator('#game-canvas').hover()
    await grantPointerLock(page)
    await page.mouse.down({ button: 'left' })
    await page.waitForTimeout(250)
    await page.mouse.up({ button: 'left' })
    await expect.poll(async () => (await snapshot(page)).entities
      .filter(({ kind }) => kind !== 'dropped_item').length).toBe(0)
    await expect.poll(async () => (await snapshot(page)).vitals.totalExperience)
      .toBeGreaterThan(experienceBefore)
    const awardedExperience = (await snapshot(page)).vitals.totalExperience
    await expect(page.locator('[data-mx-ui="experience-fill"]')).not.toHaveCSS('width', '0px')

    await callQa(page, 'persistence.flush')
    await startGameSession(page, sessionId)
    await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
    expect((await snapshot(page)).vitals.totalExperience).toBe(awardedExperience)
    await expect(page.locator('[data-mx-ui="experience-fill"]')).not.toHaveCSS('width', '0px')
  })
})
