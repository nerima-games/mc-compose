import { expect, test, type Locator, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const EYES_REQUIRED = 13

type EntitySnapshot = {
  readonly kind: string
  readonly healthPoints: number
  readonly item?: string
}

type RenderedEntitySnapshot = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
}

type EndSnapshot = {
  readonly pose: {
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
    readonly yawRadians: number
    readonly pitchRadians: number
  }
  readonly dimension: 'overworld' | 'nether' | 'end'
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly vitals: { readonly totalExperience: number }
  readonly entities: ReadonlyArray<EntitySnapshot>
  readonly renderedEntities: ReadonlyArray<RenderedEntitySnapshot>
  readonly eyesOfEnder: ReadonlyArray<{
    readonly id: string
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
  }>
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

const snapshot = (page: Page): Promise<EndSnapshot> =>
  callQa(page, 'gameplay.snapshot')

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

const itemCount = (current: EndSnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const inventoryItemSlot = (inventory: Locator, item: string): Locator =>
  inventory.locator(
    `[data-region="hotbar"] [data-mx-ui="slot"][aria-label*="${item}"], `
    + `[data-region="main"] [data-mx-ui="slot"][aria-label*="${item}"]`,
  ).first()

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

const selectHotbarItem = async (page: Page, item: string): Promise<void> => {
  const slotIndex = (await snapshot(page)).inventory.slots
    .slice(0, 9)
    .findIndex((slot) => slot?.item === item)
  expect(slotIndex, `${item} must be in the hotbar`).toBeGreaterThanOrEqual(0)
  await page.keyboard.press(`Digit${String(slotIndex + 1)}`)
  await expect.poll(() => (
    selectedSlotIndex(page.locator('#hud-root [data-mx-ui="hotbar"]'))
  )).toBe(slotIndex)
}

const collectMobDrop = async (
  page: Page,
  canvas: Locator,
  mob: 'enderman' | 'blaze',
  item: 'ender_pearl' | 'blaze_powder',
  required: number,
): Promise<void> => {
  const command = mob === 'enderman'
    ? 'gameplay.spawnFullHealthEnderman'
    : 'gameplay.spawnFullHealthBlaze'
  const maximumHealth = mob === 'enderman' ? 40 : 20
  const maximumAttacks = mob === 'enderman' ? 18 : 10

  for (let encounter = 0; encounter < required * 8; encounter += 1) {
    if (itemCount(await snapshot(page), item) >= required) return

    const encounterSnapshot = await callQa<EndSnapshot>(page, command)
    const experienceBeforeKill = encounterSnapshot.vitals.totalExperience
    await expect.poll(async () => (
      (await snapshot(page)).entities.find((entity) => entity.kind === mob)?.healthPoints
    )).toBe(maximumHealth)

    for (let attack = 0; attack < maximumAttacks; attack += 1) {
      if (!(await snapshot(page)).entities.some((entity) => entity.kind === mob)) break
      await callQa(page, 'gameplay.targetNearestHostile')
      await canvas.click({ delay: 50 })
      await page.waitForTimeout(300)
    }
    await expect.poll(async () => (
      (await snapshot(page)).entities.some((entity) => entity.kind === mob)
    )).toBe(false)
    // Experience is drained after mob drops in the host frame, so this is the
    // settlement barrier before checking whether this encounter produced loot.
    await expect.poll(async () => (
      (await snapshot(page)).vitals.totalExperience
    )).toBeGreaterThan(experienceBeforeKill)

    const beforePickup = itemCount(await snapshot(page), item)
    if ((await snapshot(page)).entities.some((entity) => entity.kind === 'dropped_item' && entity.item === item)) {
      await callQa(page, 'gameplay.targetNearestDroppedItem')
      await expect.poll(async () => itemCount(await snapshot(page), item)).toBeGreaterThan(beforePickup)
    }
  }

  const collected = itemCount(await snapshot(page), item)
  throw new Error(
    `failed to collect ${String(required)} ${item} from ${String(required * 8)} full-health ${mob} encounters; collected ${String(collected)}`,
  )
}

test('completes and persists a survival End journey without progression-state seeds', async ({ page }) => {
  test.setTimeout(600_000)
  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const canvas = page.locator('#game-canvas')
  const inventory = page.locator('#inventory-root')
  const craftingCells = inventory.locator('[data-region="crafting-grid"] [data-mx-ui="slot"]')
  const output = inventory.locator('[data-mx-ui="crafting-output"]')
  await grantPointerLock(page)

  await collectMobDrop(page, canvas, 'enderman', 'ender_pearl', EYES_REQUIRED)
  await collectMobDrop(page, canvas, 'blaze', 'blaze_powder', EYES_REQUIRED)

  await page.keyboard.press('KeyE')
  for (let crafted = 0; crafted < EYES_REQUIRED; crafted += 1) {
    await inventoryItemSlot(inventory, 'ender_pearl').click()
    await craftingCells.nth(0).click()
    await inventoryItemSlot(inventory, 'blaze_powder').click()
    await craftingCells.nth(1).click()
    await expect(output).toHaveAttribute('aria-label', /eye_of_ender, 1/)
    await output.click()
  }
  await expect.poll(async () => itemCount(await snapshot(page), 'eye_of_ender')).toBe(EYES_REQUIRED)

  await page.keyboard.press('KeyE')
  await expect(inventory).toBeHidden()
  await selectHotbarItem(page, 'eye_of_ender')
  await grantPointerLock(page)
  await callQa(page, 'gameplay.forceNextEyeOfEnderDrop')
  await canvas.click({ button: 'right' })
  await expect(canvas).toHaveAttribute('data-stronghold-direction', /.+/)
  await expect.poll(async () => itemCount(await snapshot(page), 'eye_of_ender')).toBe(EYES_REQUIRED - 1)
  await expect.poll(async () => (await snapshot(page)).eyesOfEnder.length).toBe(1)
  const thrownEye = (await snapshot(page)).eyesOfEnder[0]
  expect(thrownEye).toBeDefined()
  const renderedEyeId = `projectile:${thrownEye?.id ?? ''}`
  // The eye of ender is a moving projectile, so its position and the rendered
  // entity's feetPosition must come from the SAME snapshot call. Comparing
  // against `thrownEye.position` captured above would race the projectile's
  // own motion across the two async page.evaluate round-trips.
  const atThrow = await snapshot(page)
  expect(atThrow.renderedEntities.find((entity) => entity.id === renderedEyeId))
    .toMatchObject({
      kind: 'eye_of_ender',
      feetPosition: atThrow.eyesOfEnder.find((eye) => eye.id === thrownEye?.id)?.position,
    })
  await expect.poll(async () => {
    const current = await snapshot(page)
    const position = current.eyesOfEnder.find((eye) => eye.id === thrownEye?.id)?.position
    const rendered = current.renderedEntities.find((entity) => entity.id === renderedEyeId)
    return position !== undefined
      && rendered?.feetPosition.x === position.x
      && rendered.feetPosition.y === position.y
      && rendered.feetPosition.z === position.z
      && (position.x !== thrownEye?.position.x || position.z !== thrownEye.position.z)
  }).toBe(true)
  // CI's SwiftShader runner ticks the simulation slower in wall-clock time
  // than a real GPU does, so the eye's flight — real motion, confirmed by the
  // poll just above — needs more real seconds to finish landing. This test
  // already carries a 600s budget (see `test.setTimeout` above), so the
  // extra 15s costs nothing there.
  await expect.poll(async () => (await snapshot(page)).eyesOfEnder.length, { timeout: 20_000 }).toBe(0)
  await expect.poll(async () => (
    (await snapshot(page)).entities.some((entity) => (
      entity.kind === 'dropped_item' && entity.item === 'eye_of_ender'
    ))
  )).toBe(true)
  await callQa(page, 'gameplay.targetNearestDroppedItem')
  await expect.poll(async () => itemCount(await snapshot(page), 'eye_of_ender'))
    .toBe(EYES_REQUIRED)
  await expect.poll(async () => (
    (await snapshot(page)).entities.some((entity) => (
      entity.kind === 'dropped_item' && entity.item === 'eye_of_ender'
    ))
  )).toBe(false)

  await callQa(page, 'gameplay.forceNextEyeOfEnderBreak')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => itemCount(await snapshot(page), 'eye_of_ender'))
    .toBe(EYES_REQUIRED - 1)
  await expect.poll(async () => (await snapshot(page)).eyesOfEnder.length).toBe(1)
  // Same frame-rate-scaled flight-completion wait as the poll above at the
  // first eye launch — CI's software renderer stretches the flight well past
  // the 5 s default.
  await expect.poll(async () => (await snapshot(page)).eyesOfEnder.length, { timeout: 20_000 }).toBe(0)
  expect((await snapshot(page)).entities.some((entity) => (
    entity.kind === 'dropped_item' && entity.item === 'eye_of_ender'
  ))).toBe(false)

  for (let frame = 0; frame < 12; frame += 1) {
    if ((await snapshot(page)).end.portalComplete) break
    const eyesBeforeInsert = itemCount(await snapshot(page), 'eye_of_ender')
    const targeted = await callQa<EndSnapshot>(page, 'gameplay.targetNearestStrongholdFrame')
    await expect.poll(async () => {
      const pose = (await snapshot(page)).pose
      return {
        x: pose.feetPosition.x,
        z: pose.feetPosition.z,
        pitchRadians: pose.pitchRadians,
        yawRadians: pose.yawRadians,
      }
    }).toEqual({
      x: targeted.pose.feetPosition.x,
      z: targeted.pose.feetPosition.z,
      pitchRadians: targeted.pose.pitchRadians,
      yawRadians: targeted.pose.yawRadians,
    })
    await expect.poll(async () => (await snapshot(page)).pose.feetPosition.y)
      .toBeGreaterThanOrEqual(targeted.pose.feetPosition.y - 1)
    await canvas.click({ button: 'right' })
    await expect.poll(async () => itemCount(await snapshot(page), 'eye_of_ender'))
      .toBe(eyesBeforeInsert - 1)
  }
  await expect.poll(async () => (await snapshot(page)).end.portalComplete).toBe(true)
  await expect(canvas).toHaveAttribute('data-end-portal-progress', '12')

  await callQa(page, 'gameplay.targetCompletedEndPortal')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => (await snapshot(page)).dimension).toBe('end')
  expect((await snapshot(page)).end.dragon.health).toBe(200)
  const experienceBeforeDragon = (await snapshot(page)).vitals.totalExperience

  for (let attack = 0; attack < 240; attack += 1) {
    if ((await snapshot(page)).end.dragon.health === 0) break
    await callQa(page, 'gameplay.targetEndDragon')
    await canvas.click({ delay: 50 })
  }
  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      phase: current.end.dragon.phase,
      health: current.end.dragon.health,
      exit: current.end.exitPortalMaterialized,
      egg: current.end.dragonEggRewarded,
      experience: current.vitals.totalExperience,
    }
  }).toEqual({
    phase: 'dead',
    health: 0,
    exit: true,
    egg: true,
    experience: experienceBeforeDragon + 12_000,
  })

  await expect.poll(async () => (
    (await snapshot(page)).entities.some((entity) => entity.kind === 'dropped_item' && entity.item === 'dragon_egg')
  )).toBe(true)
  await callQa(page, 'gameplay.targetNearestDroppedItem')
  await expect.poll(async () => itemCount(await snapshot(page), 'dragon_egg')).toBe(1)

  const beforeReload = await snapshot(page)
  await callQa(page, 'persistence.flush')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const restored = await snapshot(page)
  expect(restored.dimension).toBe('end')
  expect(restored.end).toEqual(beforeReload.end)
  expect(restored.vitals.totalExperience).toBe(experienceBeforeDragon + 12_000)
  expect(itemCount(restored, 'dragon_egg')).toBe(1)

  await callQa(page, 'gameplay.targetEndExitPortal')
  await canvas.click({ button: 'right' })
  await expect.poll(async () => (await snapshot(page)).dimension).toBe('overworld')
})
