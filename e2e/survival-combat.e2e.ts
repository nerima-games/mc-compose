import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type Position = { readonly x: number; readonly y: number; readonly z: number }
type Pose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}
type EntitySnapshot = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: Position
  readonly healthPoints: number
}
type RenderedEntitySnapshot = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: Position
  readonly category?: 'hostile' | 'item'
}
type GameplaySnapshot = {
  readonly pose: Pose
  readonly vitals: {
    readonly healthPoints: number
    readonly maxHealthPoints: number
    readonly lastDamageCause?: string
  }
  readonly dead: boolean
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly entityCount: number
  readonly entities: ReadonlyArray<EntitySnapshot>
  readonly renderedEntities: ReadonlyArray<RenderedEntitySnapshot>
}

type PageFaults = {
  readonly consoleErrors: ReadonlyArray<string>
  readonly pageErrors: ReadonlyArray<string>
}

const watchForFaults = (page: Page): PageFaults => {
  const consoleErrors: Array<string> = []
  const pageErrors: Array<string> = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => pageErrors.push(`${error.name}: ${error.message}`))
  return { consoleErrors, pageErrors }
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(
    async ({ key, commandName }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, (...arguments_: ReadonlyArray<unknown>) => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation()
    },
    { key: QA_GLOBAL_KEY, commandName: command },
  ) as Promise<A>

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

const framesDrawn = async (page: Page): Promise<number> =>
  Number(await page.locator('body').getAttribute('data-frames'))

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

test('renders a lethal zombie encounter and recovers through the Respawn control', async ({
  page,
}) => {
  const faults = watchForFaults(page)

  await page.goto('/')
  const body = page.locator('body')
  const hud = page.locator('#hud-root')
  const hotbar = hud.locator('[data-mx-ui="hotbar"]')
  const deathOverlay = hud.locator('[data-mx-ui="death"]')
  const respawn = hud.getByRole('button', { name: 'Respawn' })
  const inventory = page.locator('#inventory-root')

  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(hotbar.locator('[data-mx-ui="slot"]')).toHaveCount(9)
  const spawn = await snapshot(page)

  await callQa<unknown>(page, 'gameplay.seedLethalZombieEncounter')
  await expect.poll(async () => {
    const current = await snapshot(page)
    const simulated = current.entities[0]
    const rendered = current.renderedEntities[0]
    return current.entities.length === 1
      && current.renderedEntities.length === 1
      && simulated?.kind === 'zombie'
      && rendered?.kind === 'zombie'
      && rendered.category === 'hostile'
      && simulated.id === rendered.id
  }).toBe(true)
  const zombieId = (await snapshot(page)).entities[0]?.id
  expect(zombieId).toBeDefined()

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      simulationIds: current.entities.map((entity) => entity.id),
      simulationKinds: current.entities.map((entity) => entity.kind),
      renderedIds: current.renderedEntities.map((entity) => entity.id),
      renderedKinds: current.renderedEntities.map((entity) => entity.kind),
      renderedCategories: current.renderedEntities.map((entity) => entity.category),
      healthPoints: current.vitals.healthPoints,
      dead: current.dead,
      lastDamageCause: current.vitals.lastDamageCause,
    }
  }).toEqual({
    simulationIds: [zombieId],
    simulationKinds: ['zombie'],
    renderedIds: [zombieId],
    renderedKinds: ['zombie'],
    renderedCategories: ['hostile'],
    healthPoints: 0,
    dead: true,
    lastDamageCause: 'mob',
  })

  await expect(deathOverlay).toBeVisible()
  await expect(respawn).toBeVisible()

  const selectedBeforeLockedInput = await selectedSlotIndex(hotbar)
  const otherDigit = ((selectedBeforeLockedInput + 1) % 9) + 1
  await page.keyboard.press(`Digit${String(otherDigit)}`)
  await page.keyboard.press('KeyE')
  await expect.poll(() => selectedSlotIndex(hotbar)).toBe(selectedBeforeLockedInput)
  await expect(inventory).toBeHidden()
  await expect(body).toHaveAttribute('data-inventory-open', 'false')

  const framesAtDeath = await framesDrawn(page)
  await respawn.click()

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      pose: current.pose,
      healthPoints: current.vitals.healthPoints,
      maxHealthPoints: current.vitals.maxHealthPoints,
      lastDamageCause: current.vitals.lastDamageCause ?? null,
      dead: current.dead,
      entityCount: current.entityCount,
      simulationIds: current.entities.map((entity) => entity.id),
      renderedIds: current.renderedEntities.map((entity) => entity.id),
    }
  }).toEqual({
    pose: spawn.pose,
    healthPoints: spawn.vitals.maxHealthPoints,
    maxHealthPoints: spawn.vitals.maxHealthPoints,
    lastDamageCause: null,
    dead: false,
    entityCount: 0,
    simulationIds: [],
    renderedIds: [],
  })

  await expect(deathOverlay).toBeHidden()
  await expect(respawn).toBeHidden()
  await expect.poll(() => framesDrawn(page)).toBeGreaterThan(framesAtDeath)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('kills a hostile with a left click and collects its dropped item', async ({ page }) => {
  const faults = watchForFaults(page)

  await page.goto('/')
  const body = page.locator('body')
  const canvas = page.locator('#game-canvas')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')

  await canvas.hover()
  await callQa<unknown>(page, 'gameplay.seedMeleeDropEncounter')
  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.entities.map(({ kind, healthPoints }) => ({ kind, healthPoints }))
  }).toEqual([{ kind: 'creeper', healthPoints: 1 }])
  const gunpowderBefore = inventoryCount(await snapshot(page), 'gunpowder')

  // Headless Chromium's SwiftShader backend cannot grant pointer lock. Model
  // the granted state, then use a real canvas click for the attack itself.
  await page.evaluate(() => {
    const gameCanvas = document.querySelector<HTMLCanvasElement>('#game-canvas')
    if (gameCanvas === null) throw new Error('missing game canvas')
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => gameCanvas,
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
  await canvas.click({ button: 'left' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      hostileKinds: current.entities
        .filter((entity) => entity.kind !== 'dropped_item')
        .map((entity) => entity.kind),
      droppedKinds: current.entities
        .filter((entity) => entity.kind === 'dropped_item')
        .map((entity) => entity.kind),
    }
  }).toEqual({
    hostileKinds: [],
    droppedKinds: ['dropped_item'],
  })

  await page.keyboard.down('KeyW')
  try {
    await expect.poll(async () => {
      const current = await snapshot(page)
      return {
        droppedItems: current.entities.filter((entity) => entity.kind === 'dropped_item').length,
        gunpowder: inventoryCount(current, 'gunpowder'),
      }
    }).toEqual({ droppedItems: 0, gunpowder: gunpowderBefore + 1 })
  } finally {
    await page.keyboard.up('KeyW')
  }

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
