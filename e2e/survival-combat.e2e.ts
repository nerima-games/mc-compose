import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

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
type EquipmentSnapshotEntry = {
  readonly item: string
  readonly count: number
  readonly durability: {
    readonly current: number
    readonly max: number
  } | null
}
type GameplaySnapshot = {
  readonly pose: Pose
  readonly vitals: {
    readonly healthPoints: number
    readonly maxHealthPoints: number
    readonly hungerPoints: number
    readonly maxHungerPoints: number
    readonly lastDamageCause?: string
  }
  readonly dead: boolean
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
    readonly durability: ReadonlyArray<{
      readonly current: number
      readonly max: number
    } | null>
    readonly equipment: {
      readonly head: EquipmentSnapshotEntry | null
      readonly chest: EquipmentSnapshotEntry | null
      readonly legs: EquipmentSnapshotEntry | null
      readonly feet: EquipmentSnapshotEntry | null
      readonly offhand: EquipmentSnapshotEntry | null
    }
  }
  readonly entityCount: number
  readonly entities: ReadonlyArray<EntitySnapshot>
  readonly renderedEntities: ReadonlyArray<RenderedEntitySnapshot>
  readonly itemUse: {
    readonly requestId: string
    readonly heldItem: 'fire_charge' | 'flint_and_steel'
    readonly success: boolean
    readonly outcome: {
      readonly _tag: 'Fire' | 'Portal'
      readonly outcome: { readonly _tag: string }
    }
  } | null
  readonly ignitionTarget: {
    readonly reading: string
    readonly block: number | null
  }
  readonly target: {
    readonly reading: string
    readonly block: number | null
  }
}

type PageFaults = {
  readonly consoleErrors: ReadonlyArray<string>
  readonly pageErrors: ReadonlyArray<string>
}

type AudioSnapshot = {
  readonly cueIds: ReadonlyArray<string>
  readonly captions: ReadonlyArray<{
    readonly cueId: string
    readonly reason: string
  }>
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

const selectedSlotIndex = async (hotbar: Locator): Promise<number> =>
  hotbar.locator('[data-mx-ui="slot"]').evaluateAll((slots) =>
    slots.findIndex((slot) => slot.hasAttribute('data-selected')),
  )

const framesDrawn = async (page: Page): Promise<number> =>
  Number(await page.locator('body').getAttribute('data-frames'))

test('shows a damage caption without requiring autoplay unlock', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  await callQa<unknown>(page, 'gameplay.damage')

  await expect(page.getByTestId('sound-caption')).toHaveAttribute('data-cue-id', 'playerHurt')
  const audio = await callQa<AudioSnapshot>(page, 'audio.snapshot')
  expect(audio.cueIds).toContain('playerHurt')
  expect(audio.captions).toContainEqual(expect.objectContaining({
    cueId: 'playerHurt',
  }))
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('reduces player damage with equipped iron armor', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const equipped = await callQa<GameplaySnapshot>(page, 'gameplay.seedIronArmor')
  expect(equipped.inventory.equipment).toMatchObject({
    head: {
      item: 'iron_helmet',
      count: 1,
      durability: { current: 165, max: 165 },
    },
    chest: {
      item: 'iron_chestplate',
      count: 1,
      durability: { current: 240, max: 240 },
    },
    legs: {
      item: 'iron_leggings',
      count: 1,
      durability: { current: 225, max: 225 },
    },
    feet: {
      item: 'iron_boots',
      count: 1,
      durability: { current: 195, max: 195 },
    },
  })
  expect(equipped.vitals.healthPoints).toBe(20)

  const damaged = await callQa<GameplaySnapshot>(page, 'gameplay.damage')
  expect(damaged.vitals.healthPoints).toBeCloseTo(18.4, 5)
  expect(damaged.vitals.lastDamageCause).toBeUndefined()
  expect(damaged.inventory.equipment).toMatchObject({
    head: { durability: { current: 164, max: 165 } },
    chest: { durability: { current: 239, max: 240 } },
    legs: { durability: { current: 224, max: 225 } },
    feet: { durability: { current: 194, max: 195 } },
  })
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

const inventoryCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const grantPointerLock = async (page: Page): Promise<void> => {
  // Headless Chromium's SwiftShader backend cannot grant pointer lock. Model
  // the granted state, then use a real canvas click for the action itself.
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

test('renders a zombie pursuing the player and persists contact damage', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa<unknown>(page, 'gameplay.seedZombiePursuitEncounter')

  await expect.poll(async () => {
    const current = await snapshot(page)
    const zombie = current.entities[0]
    const renderedZombie = current.renderedEntities[0]
    return current.entities.length === 1
      && current.renderedEntities.length === 1
      && zombie?.kind === 'zombie'
      && renderedZombie?.kind === 'zombie'
      && renderedZombie.category === 'hostile'
      && zombie.id === renderedZombie.id
  }).toBe(true)

  const pursuitStart = await snapshot(page)
  const zombieId = pursuitStart.entities[0]?.id
  expect(zombieId).toBeDefined()
  const initialZombie = pursuitStart.entities.find((entity) => entity.id === zombieId)
  expect(initialZombie).toBeDefined()
  const initialDistance = Math.hypot(
    initialZombie!.feetPosition.x - pursuitStart.pose.feetPosition.x,
    initialZombie!.feetPosition.z - pursuitStart.pose.feetPosition.z,
  )
  expect(initialDistance).toBeGreaterThan(2)

  await expect.poll(async () => {
    const current = await snapshot(page)
    const zombie = current.entities.find((entity) => entity.id === zombieId)
    if (zombie === undefined) return initialDistance
    return Math.hypot(
      zombie.feetPosition.x - current.pose.feetPosition.x,
      zombie.feetPosition.z - current.pose.feetPosition.z,
    )
  }, { timeout: 10_000 }).toBeLessThan(initialDistance - 0.5)

  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.vitals.healthPoints
  }, { timeout: 10_000 }).toBeLessThan(pursuitStart.vitals.healthPoints)

  const damaged = await snapshot(page)
  expect(damaged.entities.map((entity) => entity.id)).toContain(zombieId)
  expect(damaged.renderedEntities.map((entity) => entity.id)).toContain(zombieId)
  expect(damaged.vitals.healthPoints).toBeLessThan(damaged.vitals.maxHealthPoints)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('renders a lethal zombie encounter and recovers through the Respawn control', async ({
  page,
}) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const body = page.locator('body')
  const hud = page.locator('#hud-root')
  const hotbar = hud.locator('[data-mx-ui="hotbar"]')
  const deathOverlay = hud.locator('[data-mx-ui="death"]')
  const respawn = hud.getByRole('button', { name: 'Respawn' })
  const inventory = page.locator('#inventory-root')

  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(hotbar.locator('[data-mx-ui="slot"]')).toHaveCount(9)
  const spawn = await callQa<GameplaySnapshot>(page, 'gameplay.respawn')

  await callQa<unknown>(page, 'gameplay.seedLethalZombieEncounter')
  await expect.poll(async () => {
    const current = await snapshot(page)
    const simulated = current.entities.find((entity) => entity.kind === 'zombie')
    const rendered = current.renderedEntities.find((entity) => entity.kind === 'zombie')
    return simulated !== undefined
      && rendered?.category === 'hostile'
      && simulated.id === rendered.id
  }).toBe(true)
  const zombieId = (await snapshot(page)).entities
    .find((entity) => entity.kind === 'zombie')?.id
  expect(zombieId).toBeDefined()

  await expect.poll(async () => {
    const current = await snapshot(page)
    const simulatedZombie = current.entities.find((entity) => entity.kind === 'zombie')
    const simulatedDrops = current.entities.filter((entity) => entity.kind === 'dropped_item')
    const renderedZombie = current.renderedEntities.find((entity) => entity.kind === 'zombie')
    const renderedDrops = current.renderedEntities.filter(
      (entity) => entity.kind === 'dropped_item',
    )
    return {
      simulationEntityCount: current.entities.length,
      simulationZombieId: simulatedZombie?.id,
      simulationDropIds: simulatedDrops.map((entity) => entity.id).sort(),
      renderedEntityCount: current.renderedEntities.length,
      renderedZombieId: renderedZombie?.id,
      renderedZombieCategory: renderedZombie?.category,
      renderedDropIds: renderedDrops.map((entity) => entity.id).sort(),
      renderedDropCategories: renderedDrops.map((entity) => entity.category),
      healthPoints: current.vitals.healthPoints,
      dead: current.dead,
      lastDamageCause: current.vitals.lastDamageCause,
    }
  }).toEqual({
    simulationEntityCount: 5,
    simulationZombieId: zombieId,
    simulationDropIds: expect.arrayContaining([
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]),
    renderedEntityCount: 5,
    renderedZombieId: zombieId,
    renderedZombieCategory: 'hostile',
    renderedDropIds: expect.arrayContaining([
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]),
    renderedDropCategories: ['item', 'item', 'item', 'item'],
    healthPoints: 0,
    dead: true,
    lastDamageCause: 'mob',
  })

  const deathSnapshot = await snapshot(page)
  const dropIds = deathSnapshot.entities
    .filter((entity) => entity.kind === 'dropped_item')
    .map((entity) => entity.id)
    .sort()
  expect(dropIds).toHaveLength(4)
  expect(
    deathSnapshot.renderedEntities
      .filter((entity) => entity.kind === 'dropped_item')
      .map((entity) => entity.id)
      .sort(),
  ).toEqual(dropIds)

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
      pose: {
        feetPosition: {
          x: current.pose.feetPosition.x,
          z: current.pose.feetPosition.z,
        },
        yawRadians: current.pose.yawRadians,
        pitchRadians: current.pose.pitchRadians,
      },
      healthPoints: current.vitals.healthPoints,
      maxHealthPoints: current.vitals.maxHealthPoints,
      lastDamageCause: current.vitals.lastDamageCause ?? null,
      dead: current.dead,
      entityCount: current.entityCount,
      simulationZombieIds: current.entities
        .filter((entity) => entity.kind === 'zombie')
        .map((entity) => entity.id),
      simulationDropIds: current.entities
        .filter((entity) => entity.kind === 'dropped_item')
        .map((entity) => entity.id)
        .sort(),
      renderedZombieIds: current.renderedEntities
        .filter((entity) => entity.kind === 'zombie')
        .map((entity) => entity.id),
      renderedDropIds: current.renderedEntities
        .filter((entity) => entity.kind === 'dropped_item')
        .map((entity) => entity.id)
        .sort(),
      renderedDropCategories: current.renderedEntities
        .filter((entity) => entity.kind === 'dropped_item')
        .map((entity) => entity.category),
    }
  }).toEqual({
    pose: {
      feetPosition: {
        x: spawn.pose.feetPosition.x,
        z: spawn.pose.feetPosition.z,
      },
      yawRadians: spawn.pose.yawRadians,
      pitchRadians: spawn.pose.pitchRadians,
    },
    healthPoints: spawn.vitals.maxHealthPoints,
    maxHealthPoints: spawn.vitals.maxHealthPoints,
    lastDamageCause: null,
    dead: false,
    entityCount: 5,
    simulationZombieIds: [zombieId],
    simulationDropIds: dropIds,
    renderedZombieIds: [zombieId],
    renderedDropIds: dropIds,
    renderedDropCategories: ['item', 'item', 'item', 'item'],
  })

  await expect(deathOverlay).toBeHidden()
  await expect(respawn).toBeHidden()
  await expect.poll(() => framesDrawn(page)).toBeGreaterThan(framesAtDeath)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('eats the selected potato through a right-click use action', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const body = page.locator('body')
  const canvas = page.locator('#game-canvas')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')

  await canvas.hover()
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedFoodUseEncounter')
  expect(seeded.vitals.healthPoints).toBeLessThan(seeded.vitals.maxHealthPoints)
  expect(seeded.vitals.hungerPoints).toBeLessThan(seeded.vitals.maxHungerPoints)
  const potatoesBefore = inventoryCount(seeded, 'potato')
  expect(potatoesBefore).toBe(2)

  await grantPointerLock(page)
  await canvas.click({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      potatoes: inventoryCount(current, 'potato'),
      hungerPoints: current.vitals.hungerPoints,
    }
  }).toEqual({
    potatoes: potatoesBefore - 1,
    hungerPoints: seeded.vitals.hungerPoints + 1,
  })

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('consumes one fire charge only after successful ignition', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const canvas = page.locator('#game-canvas')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await canvas.hover()
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedFireChargeIgnition')
  const chargesBefore = inventoryCount(seeded, 'fire_charge')
  expect(chargesBefore).toBe(2)
  expect(seeded.ignitionTarget.block).toBe(0)

  await grantPointerLock(page)
  await canvas.click({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      item: current.itemUse?.heldItem,
      success: current.itemUse?.success,
      outcome: current.itemUse?.outcome.outcome._tag,
      charges: inventoryCount(current, 'fire_charge'),
      ignitionLit: current.ignitionTarget.block !== 0,
    }
  }).toEqual({
    item: 'fire_charge',
    success: true,
    outcome: 'Lit',
    charges: chargesBefore - 1,
    ignitionLit: true,
  })

  await page.waitForTimeout(100)
  expect(inventoryCount(await snapshot(page), 'fire_charge')).toBe(chargesBefore - 1)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('does not consume a fire charge when ignition is refused', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedRefusedFireChargeIgnition')
  const chargesBefore = inventoryCount(seeded, 'fire_charge')

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      item: current.itemUse?.heldItem,
      success: current.itemUse?.success,
      outcome: current.itemUse?.outcome.outcome._tag,
      charges: inventoryCount(current, 'fire_charge'),
    }
  }).toEqual({
    item: 'fire_charge',
    success: false,
    outcome: 'Occupied',
    charges: chargesBefore,
  })

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('damages flint and steel after successful ignition', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const canvas = page.locator('#game-canvas')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await canvas.hover()
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedFlintAndSteelIgnition')
  const toolsBefore = inventoryCount(seeded, 'flint_and_steel')
  const durabilityBefore = seeded.inventory.durability[0]?.current
  expect(durabilityBefore).toBe(64)

  await grantPointerLock(page)
  await canvas.click({ button: 'right' })

  await expect.poll(async () => {
    const current = await snapshot(page)
    return {
      item: current.itemUse?.heldItem,
      success: current.itemUse?.success,
      outcome: current.itemUse?.outcome.outcome._tag,
      tools: inventoryCount(current, 'flint_and_steel'),
      durability: current.inventory.durability[0]?.current,
    }
  }).toEqual({
    item: 'flint_and_steel',
    success: true,
    outcome: 'Lit',
    tools: toolsBefore,
    durability: 63,
  })

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('mines only after continuous hold and exposes progress at the crosshair', async ({
  page,
}) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const body = page.locator('body')
  const canvas = page.locator('#game-canvas')
  const progress = page.locator('[data-mx-ui="crosshair-progress"]')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')

  await callQa<unknown>(page, 'gameplay.setPose')
  const targetBefore = (await snapshot(page)).target.block
  expect(targetBefore).not.toBeNull()
  const breaksBefore = Number(await canvas.getAttribute('data-breaks-requested'))
  await callQa<unknown>(page, 'gameplay.setPose', 40)
  await canvas.hover()
  await grantPointerLock(page)

  await page.mouse.down({ button: 'left' })
  await expect(progress).toBeVisible()
  const firstProgress = Number(await progress.getAttribute('aria-valuenow'))
  expect(firstProgress).toBeGreaterThan(0)
  expect(firstProgress).toBeLessThan(100)
  await expect.poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(firstProgress)
  await page.mouse.up({ button: 'left' })

  await expect(progress).toBeHidden()
  await page.waitForTimeout(100)
  expect((await snapshot(page)).target.block).toBe(40)
  await expect.poll(async () => Number(await canvas.getAttribute('data-breaks-requested')))
    .toBe(breaksBefore)

  await callQa<unknown>(page, 'gameplay.setPose', targetBefore)
  await page.mouse.down({ button: 'left' })
  try {
    await expect(canvas).toHaveAttribute(
      'data-breaks-requested',
      String(breaksBefore + 1),
      { timeout: 10_000 },
    )
    await page.waitForTimeout(250)
    await expect(canvas).toHaveAttribute('data-breaks-requested', String(breaksBefore + 1))
  } finally {
    await page.mouse.up({ button: 'left' })
  }
  await expect(progress).toBeHidden()

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('kills a hostile with a left click and collects its dropped item', async ({ page }) => {
  const faults = watchForFaults(page)

  await startGameSession(page)
  const body = page.locator('body')
  const canvas = page.locator('#game-canvas')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')

  await canvas.hover()
  await callQa<unknown>(page, 'gameplay.seedMeleeDropEncounter')
  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.entities.map(({ kind, healthPoints }) => ({ kind, healthPoints }))
  }).toEqual([{ kind: 'creeper', healthPoints: 1 }])
  const seededSnapshot = await snapshot(page)
  expect(seededSnapshot.inventory.slots[0]).toEqual({
    item: 'wooden_sword',
    count: 1,
  })
  expect(seededSnapshot.inventory.durability[0]).toEqual({
    current: 59,
    max: 59,
  })
  const gunpowderBefore = inventoryCount(seededSnapshot, 'gunpowder')

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
  await page.mouse.down({ button: 'left' })
  await page.waitForTimeout(250)
  await page.mouse.up({ button: 'left' })

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
  await expect
    .poll(
      async () =>
        (await snapshot(page)).inventory.durability[0]?.current ?? null,
    )
    .toBe(58)

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
