import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const SAVED_MARKER_KEY = '__mcComposeSawSavedPersistence'
const DATABASE_NAME = 'nerima-games-minecraft'
const AIR_BLOCK_ID = 0
const STONE_BLOCK_ID = 2
const OBSIDIAN_BLOCK_ID = 40
const NETHER_PORTAL_BLOCK_ID = 118

type Position = { readonly x: number; readonly y: number; readonly z: number }
type Pose = {
  readonly feetPosition: Position
  readonly yawRadians: number
  readonly pitchRadians: number
}
type InventorySlot = null | {
  readonly item?: string
  readonly itemId?: string
  readonly count: number
}
type GameplaySnapshot = {
  readonly pose: Pose
  readonly dimension: string
  readonly activeChunkDimension: string
  readonly dead: boolean
  readonly entities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly feetPosition: Position
    readonly healthPoints: number
    readonly behaviour: unknown
  }>
  readonly renderedEntities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly category: string
    readonly feetPosition: Position
  }>
  readonly weather: {
    readonly weather: 'clear' | 'rain' | 'thunder'
    readonly remainingSecs: number
  }
  readonly vitals: {
    readonly healthPoints: number
    readonly foodTimerSecs: number
    readonly [key: string]: unknown
  }
  readonly inventory: { readonly slots: ReadonlyArray<InventorySlot> }
  readonly villagerTrades: { readonly restockElapsedSecs: number }
  readonly itemMetadata: {
    readonly customNames: Readonly<Record<string, string>>
    readonly enchantedItems: Readonly<Record<string, {
      readonly item: string
      readonly durability: number
      readonly enchantments: ReadonlyArray<{ readonly id: string; readonly level: number }>
    }>>
  }
  readonly target: {
    readonly position: Position
    readonly reading: string
    readonly block: number | null
  }
  readonly portals: ReadonlyArray<{
    readonly dimension: string
    readonly position: Position
  }>
  readonly activePortal: null | {
    readonly anchor: Position
    readonly interiorBlock: number | null
    readonly framePosition: Position
    readonly frameBlock: number | null
  }
  readonly environmentalContact: {
    readonly simulationElapsedSecs: number
    readonly lastDamageElapsedSecs: number | null
    readonly cells: ReadonlyArray<{
      readonly position: Position
      readonly block: 'lava' | 'cactus'
      readonly contactDamage: number
    }>
  }
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

const callQa = <A>(
  page: Page,
  command: string,
  ...arguments_: ReadonlyArray<unknown>
): Promise<A> =>
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

const snapshotWithFrames = (page: Page): Promise<{ frames: number; value: GameplaySnapshot }> =>
  page.evaluate(
    async ({ key, commandName }) => {
      const surface = (globalThis as unknown as Record<string, unknown>)[key] as
        | Record<string, () => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      const value = await operation()
      return { frames: Number(document.body.getAttribute('data-frames')), value }
    },
    { key: QA_GLOBAL_KEY, commandName: 'gameplay.snapshot' },
  ) as Promise<{ frames: number; value: GameplaySnapshot }>

const hotbarText = (page: Page): Promise<ReadonlyArray<string | null>> =>
  page.locator('[data-mx-ui="hotbar"] [data-mx-ui="slot"]').allTextContents()

// A save that completes while the player keeps drifting can flip
// `data-session-persistence` to 'saved' for as little as one frame before the
// next drift-driven dirty event overwrites it — too narrow a window for
// polling the attribute from outside the page to reliably catch. A
// MutationObserver installed inside the page latches the instant it happens,
// regardless of how often the test later checks in.
const watchForSavedPersistence = (page: Page): Promise<void> =>
  page.evaluate(({ key }) => {
    const globalScope = globalThis as unknown as Record<string, boolean>
    const body = document.body
    const latch = (): void => {
      if (body.getAttribute('data-session-persistence') === 'saved') globalScope[key] = true
    }
    globalScope[key] = false
    latch()
    new MutationObserver(latch).observe(body, {
      attributes: true,
      attributeFilter: ['data-session-persistence'],
    })
  }, { key: SAVED_MARKER_KEY })

const sawSavedPersistenceWithFrames = (
  page: Page,
): Promise<{ frames: number; value: boolean }> =>
  page.evaluate(({ key }) => ({
    frames: Number(document.body.getAttribute('data-frames')),
    value: (globalThis as unknown as Record<string, boolean>)[key] === true,
  }), { key: SAVED_MARKER_KEY }) as Promise<{ frames: number; value: boolean }>

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

const seedGroundedMiningEncounter = async (page: Page): Promise<void> => {
  await callQa(page, 'gameplay.seedSmokeGroundingEncounter')
  await callQa(page, 'gameplay.setPose', STONE_BLOCK_ID)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-grounded', 'true')
}

const deleteSessionDatabase = async (page: Page): Promise<void> => {
  // Use a same-origin document that does not start the game, so no open session
  // connection can block deletion before this test's first boot.
  await page.goto('/@vite/client')
  await page.evaluate(async (databaseName) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(databaseName)
      request.addEventListener('success', () => resolve(), { once: true })
      request.addEventListener('error', () => reject(request.error), { once: true })
      request.addEventListener('blocked', () => reject(new Error('database deletion blocked')), {
        once: true,
      })
    })
  }, DATABASE_NAME)
}

test('restores a dynamic entity with stable identity and state', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedMeleeDropEncounter')
  await callQa(page, 'gameplay.seedSmokeGroundingEncounter')
  await expect(page.locator('#game-canvas')).toHaveAttribute(
    'data-player-grounded',
    'true',
  )
  const published = await snapshot(page)
  expect(published.entities).toHaveLength(1)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const restored = await snapshot(page)
  expect(restored.entities).toEqual(published.entities)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('retains death-drop custom name and enchantments through reload and pickup', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedChestTransferMetadata')
  expect(seeded.inventory.slots[0]?.item).toBe('diamond_pickaxe')
  expect(seeded.itemMetadata.customNames['0']).toBe('Silk Runner')
  expect(seeded.itemMetadata.enchantedItems['0']).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })

  for (let hit = 0; hit < 10 && !(await snapshot(page)).dead; hit += 1) {
    await callQa(page, 'gameplay.damage')
  }
  await expect.poll(async () => (await snapshot(page)).dead).toBe(true)
  const death = await snapshot(page)
  expect(death.inventory.slots[0]).toBeNull()
  expect(death.itemMetadata.customNames['0']).toBeUndefined()
  expect(death.itemMetadata.enchantedItems['0']).toBeUndefined()
  expect(death.entities.filter(({ kind }) => kind === 'dropped_item')).toHaveLength(1)

  await callQa(page, 'persistence.flush')
  await expect(body).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(body).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect.poll(async () => (await snapshot(page)).dead).toBe(true)
  const reloaded = await snapshot(page)
  expect(reloaded.entities.filter(({ kind }) => kind === 'dropped_item')).toHaveLength(1)

  await callQa(page, 'gameplay.respawn')
  // Death never moved the player (the damage loop above is stationary), so
  // this world's default respawn point is the same position the item
  // dropped at — within the hand-rolled pickup loop's 1.5-unit radius
  // (`apps/web/main.ts`'s per-frame pickup, restored to being the only
  // picker-upper now that `droppedItemPickup: false` is honored again).
  // Respawning already stands the player on the drop, so it is usually
  // picked up before this line runs; `targetNearestDroppedItem` would throw
  // "no dropped item found" in that case. Only walk to it if it is still
  // there — this keeps the explicit-walk path exercised for a respawn that
  // is NOT already on top of the drop, without assuming either outcome.
  if ((await snapshot(page)).entities.some(({ kind }) => kind === 'dropped_item')) {
    await callQa(page, 'gameplay.targetNearestDroppedItem')
  }
  await expect.poll(async () => {
    const current = await snapshot(page)
    return current.inventory.slots.findIndex((slot) => slot?.item === 'diamond_pickaxe')
  }).toBeGreaterThanOrEqual(0)

  const recovered = await snapshot(page)
  const recoveredSlot = recovered.inventory.slots.findIndex(
    (slot) => slot?.item === 'diamond_pickaxe',
  )
  expect(recovered.entities.filter(({ kind }) => kind === 'dropped_item')).toEqual([])
  expect(recovered.itemMetadata.customNames[String(recoveredSlot)]).toBe('Silk Runner')
  expect(recovered.itemMetadata.enchantedItems[String(recoveredSlot)]).toMatchObject({
    item: 'diamond_pickaxe',
    enchantments: [{ id: 'efficiency', level: 5 }],
  })
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})


// mx-gameplay 0.3.x added natural ecosystem spawning (mobSimulation gates all
// mob logic, and the product wants it on; there is deliberately no
// off-switch). The nether now spawns NETHER_HOSTILE_KINDS near the player on
// a cadence, so a raw entity roster is no longer just what this test seeded.
// A naturally spawned mob is wrapped the same way the rest of this codebase
// wraps a `HostileMobSnapshot` (see `apps/web/session-persistence.ts`'s
// `restoreHostileMobBehaviour` comment): `behaviour._tag === 'HostileMob'`
// with a nested `behaviour.behaviour._tag === 'EcosystemMob'`. A seeded
// creeper/dropped-item never carries that nested tag, so filtering on it
// isolates exactly the entities this test is responsible for, regardless of
// how many ecosystem mobs spawn around it.
const isEcosystemSpawn = (entity: GameplaySnapshot['entities'][number]): boolean => {
  const behaviour = entity.behaviour
  if (typeof behaviour !== 'object' || behaviour === null) return false
  const nested = (behaviour as Record<string, unknown>)['behaviour']
  return typeof nested === 'object' && nested !== null
    && (nested as Record<string, unknown>)['_tag'] === 'EcosystemMob'
}

const seededEntities = (
  current: GameplaySnapshot,
): ReadonlyArray<GameplaySnapshot['entities'][number]> =>
  current.entities.filter((entity) => !isEcosystemSpawn(entity))

test('isolates and restores entity rosters across dimensions and reload', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const damageUntilNewDrop = async (
    existingEntityIds: ReadonlyArray<string>,
  ): Promise<GameplaySnapshot> => {
    const maximumAttempts = 10
    const dropState = async () => {
      const entities = seededEntities(await snapshot(page))
      const ids = new Set(entities.map(({ id }) => id))
      return {
        count: entities.length,
        kinds: entities.map(({ kind }) => kind),
        retainedExistingIds: existingEntityIds.every((id) => ids.has(id)),
      }
    }

    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      const beforeDamage = await snapshot(page)
      await callQa(page, 'gameplay.damage')
      try {
        await expect.poll(async () => {
          const current = await snapshot(page)
          return current.dead || current.vitals.healthPoints < beforeDamage.vitals.healthPoints
        }, { timeout: 500 }).toBe(true)
      } catch (error: unknown) {
        if (attempt === maximumAttempts - 1) throw error
        continue
      }
      if ((await snapshot(page)).dead) break
    }

    await expect.poll(async () => (await snapshot(page)).dead).toBe(true)
    await expect.poll(dropState).toEqual({
      count: existingEntityIds.length + 1,
      kinds: Array.from(
        { length: existingEntityIds.length + 1 },
        () => 'dropped_item',
      ),
      retainedExistingIds: true,
    })
    return snapshot(page)
  }

  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await callQa(page, 'gameplay.seedMeleeDropEncounter')
  const overworldCreeper = seededEntities(await snapshot(page))[0]
  expect(overworldCreeper?.kind).toBe('creeper')
  await grantPointerLock(page)
  await page.mouse.down({ button: 'left' })
  await page.waitForTimeout(250)
  await page.mouse.up({ button: 'left' })
  await expect.poll(async () => seededEntities(await snapshot(page)).map(({ kind }) => kind)).toEqual([
    'dropped_item',
  ])
  const overworld = await snapshot(page)
  const seededOverworld = seededEntities(overworld)
  const overworldDrop = seededOverworld[0]
  expect(overworld.dimension).toBe('overworld')
  expect(overworldDrop?.id).not.toBe(overworldCreeper?.id)

  await callQa(page, 'gameplay.seedFoodUseEncounter')
  await callQa(page, 'gameplay.enterNether')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('nether')
  // Only the SEEDED roster is asserted empty here — the property under test
  // is that entering the nether does not leak the overworld's seeded
  // entities in, not that the nether roster starts empty of everything (see
  // `isEcosystemSpawn`'s comment: natural spawns are on by design).
  expect(seededEntities(await snapshot(page))).toEqual([])
  const nether = await damageUntilNewDrop([])
  const seededNether = seededEntities(nether)
  expect(seededNether).toHaveLength(1)
  expect(seededNether[0]?.kind).toBe('dropped_item')
  // NOT an id-string comparison against `overworldDrop`: ids are minted
  // `${kind}-${serial}` from a counter that is per-DIMENSION, not global
  // (mc-sim's entity manager keeps one `nextSerial` per roster), so two
  // entities in different dimensions can legitimately share a literal id —
  // and once natural spawns can consume serials ahead of a seeded entity,
  // that coincidence is no longer rare enough to treat as a leak signal.
  // The leak property — that the overworld's seeded entities did not carry
  // into the nether roster — is what the empty-`seededEntities` assertion
  // just above already proved, by roster membership rather than by id.

  const serial = (id: string): number => {
    const match = /(?<serial>\d+)$/u.exec(id)
    if (match?.groups?.['serial'] === undefined) throw new Error(`entity id has no serial: ${id}`)
    return Number(match.groups['serial'])
  }
  // Natural spawns mint from the SAME per-dimension serial counter as
  // seeded entities (mc-sim's entity manager has one `spawn` per dimension
  // roster), so a literal serial value is no longer meaningful once natural
  // spawns can land before a seeded one. What the literal assertions this
  // replaces actually protected — that id allocation is per-dimension and
  // strictly increasing within a dimension's own lifetime, not that any
  // particular value is minted next — is asserted directly instead.
  expect(serial(overworldDrop?.id ?? '')).toBeGreaterThan(serial(overworldCreeper?.id ?? ''))

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('nether')
  const restoredNether = await snapshot(page)
  const seededRestoredNether = seededEntities(restoredNether)
  // Compares the SEEDED subset only: the ecosystem's own population keeps
  // evolving in real time (including across a reload's round trip), so
  // asserting the full roster is byte-identical would just be asserting how
  // long the reload happened to take. Reload stability of what this test
  // seeded is the property that matters, and it is asserted exactly.
  expect(seededRestoredNether.map(({ id, kind }) => ({ id, kind }))).toEqual(
    seededNether.map(({ id, kind }) => ({ id, kind })),
  )
  expect(seededRestoredNether[0]?.feetPosition).toEqual(seededNether[0]?.feetPosition)

  await callQa(page, 'gameplay.enterOverworld')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('overworld')
  await callQa(page, 'gameplay.respawn')
  await expect.poll(async () => (await snapshot(page)).dead).toBe(false)
  await callQa(page, 'gameplay.seedCraftingLog')
  await callQa(page, 'gameplay.enterNether')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('nether')
  const expandedNether = await damageUntilNewDrop(seededNether.map(({ id }) => id))
  const seededExpandedNether = seededEntities(expandedNether)
  expect(seededExpandedNether).toHaveLength(2)
  const nextNether = seededExpandedNether.find(({ id }) => id !== seededNether[0]?.id)
  expect(serial(nextNether?.id ?? '')).toBeGreaterThan(serial(seededNether[0]?.id ?? ''))

  await callQa(page, 'gameplay.enterOverworld')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('overworld')
  const restoredOverworld = await snapshot(page)
  const seededRestoredOverworld = seededEntities(restoredOverworld)
  expect(seededRestoredOverworld.map(({ id, kind }) => ({ id, kind }))).toEqual(
    seededOverworld.map(({ id, kind }) => ({ id, kind })),
  )
  expect(seededRestoredOverworld[0]?.feetPosition).toEqual(overworldDrop?.feetPosition)

  // The leak property this test exists for: entities seeded in one
  // dimension never surface in another dimension's roster, in either
  // direction, reload or not.
  expect(seededRestoredOverworld.map(({ feetPosition }) => feetPosition)).not.toContainEqual(
    seededNether[0]?.feetPosition,
  )
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('publishes a mined world, inventory, and exact pose across reload', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('[data-mx-ui="hotbar"] [data-mx-ui="slot"]')).toHaveCount(9)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather-audio-mode', 'clear')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather-particles', '0')

  await seedGroundedMiningEncounter(page)
  const beforeBreak = await snapshot(page)
  expect(beforeBreak.target.reading).toBe('Block')
  expect(beforeBreak.target.block).not.toBe(AIR_BLOCK_ID)

  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  await expect.poll(async () => (await snapshot(page)).pose.feetPosition.y).toBe(63)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-grounded', 'true')

  await callQa(page, 'gameplay.setWeather')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather', 'thunder')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather-audio-mode', 'thunder')
  await expect.poll(async () => Number(
    await page.locator('#game-canvas').getAttribute('data-weather-particles'),
  )).toBeGreaterThan(0)

  const published = await snapshot(page)
  const publishedHotbar = await hotbarText(page)
  expect(published.inventory.slots).toHaveLength(36)
  expect(publishedHotbar).toHaveLength(9)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page).toHaveURL(/\?session=e2e$/u)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather', 'thunder')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-weather-audio-mode', 'thunder')
  await expect.poll(async () => Number(
    await page.locator('#game-canvas').getAttribute('data-weather-particles'),
  )).toBeGreaterThan(0)

  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  const restored = await snapshot(page)
  expect(restored.pose).toEqual(published.pose)
  expect(restored.dimension).toBe(published.dimension)
  expect(restored.weather.weather).toBe(published.weather.weather)
  expect(Math.abs(restored.weather.remainingSecs - published.weather.remainingSecs)).toBeLessThan(5)
  expect(restored.inventory).toEqual(published.inventory)
  expect(await hotbarText(page)).toEqual(publishedHotbar)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('debounces dirty gameplay into a durable save without an explicit flush', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  await seedGroundedMiningEncounter(page)
  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-player-grounded', 'true')

  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  const published = await snapshot(page)

  await page.reload()
  await expect(page).toHaveURL(/\?session=e2e$/u)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)
  const restored = await snapshot(page)
  expect(restored).toEqual({
    ...published,
    // Autonomous entities resume immediately after boot, so compare their durable roster below.
    entities: restored.entities,
    renderedEntities: restored.renderedEntities,
    environmentalContact: {
      ...published.environmentalContact,
      simulationElapsedSecs: expect.any(Number),
    },
    weather: {
      ...published.weather,
      remainingSecs: expect.any(Number),
    },
    vitals: {
      ...published.vitals,
      foodTimerSecs: expect.any(Number),
    },
    villagerTrades: {
      ...published.villagerTrades,
      restockElapsedSecs: expect.any(Number),
    },
  })
  const durableEntityRoster = (value: GameplaySnapshot) => value.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    healthPoints: entity.healthPoints,
  }))
  expect(durableEntityRoster(restored)).toEqual(durableEntityRoster(published))
  expect(Math.abs(restored.weather.remainingSecs - published.weather.remainingSecs)).toBeLessThan(5)
  expect(restored.vitals.foodTimerSecs).toBeGreaterThanOrEqual(0)
  expect(restored.vitals.foodTimerSecs).toBeLessThan(4)
  expect(restored.villagerTrades.restockElapsedSecs).toBeGreaterThan(0)
  expect(
    Math.abs(
      restored.villagerTrades.restockElapsedSecs - published.villagerTrades.restockElapsedSecs,
    ),
  ).toBeLessThan(1)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('isolates and restores edits while travelling overworld to nether and back', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  await callQa(page, 'gameplay.setPose')
  expect(await callQa<unknown>(page, 'gameplay.breakTarget')).not.toBeNull()
  await expect.poll(async () => (await snapshot(page)).target.block).toBe(AIR_BLOCK_ID)

  await callQa(page, 'gameplay.enterNether')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('nether')
  const nether = await snapshot(page)
  expect(nether.dimension).toBe('nether')
  expect(nether.target.reading).toBe('Block')
  expect(nether.target.block).not.toBe(AIR_BLOCK_ID)

  await callQa(page, 'gameplay.enterOverworld')
  await expect.poll(async () => (await snapshot(page)).activeChunkDimension).toBe('overworld')
  const overworld = await snapshot(page)
  expect(overworld.dimension).toBe('overworld')
  expect(overworld.target.block).toBe(AIR_BLOCK_ID)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('materializes, persists, and reuses a portal round trip without duplicates', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedPortalEncounter')
  expect(seeded.dimension).toBe('overworld')
  expect(seeded.portals).toEqual([
    { dimension: 'overworld', position: { x: 120, y: 65, z: 8 } },
  ])
  expect(seeded.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(seeded.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  // Portal dimension transitions stream chunks over several simulated
  // frames — see waitForSimulationProgress.
  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.dimension === 'nether',
    { description: 'portal transition to nether' },
  )
  const generated = await snapshot(page)
  expect(generated.activeChunkDimension).toBe('nether')
  expect(generated.portals).toEqual([
    { dimension: 'overworld', position: { x: 120, y: 65, z: 8 } },
    { dimension: 'nether', position: { x: 15, y: 65, z: 1 } },
  ])
  expect(generated.activePortal?.anchor).toEqual({ x: 15, y: 65, z: 1 })
  expect(generated.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(generated.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  await page.reload()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-world-source', 'persisted')

  const restored = await snapshot(page)
  expect(restored.dimension).toBe('nether')
  expect(restored.activeChunkDimension).toBe('nether')
  expect(restored.portals).toEqual(generated.portals)
  expect(restored.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(restored.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)

  await waitForSimulationProgress(
    page,
    () => snapshotWithFrames(page),
    (current) => current.dimension === 'overworld',
    { description: 'portal transition to overworld' },
  )
  const returned = await snapshot(page)
  expect(returned.activeChunkDimension).toBe('overworld')
  expect(returned.portals).toEqual(generated.portals)
  expect(returned.portals.filter(({ dimension }) => dimension === 'overworld')).toHaveLength(1)
  expect(returned.portals.filter(({ dimension }) => dimension === 'nether')).toHaveLength(1)
  expect(returned.activePortal?.anchor).toEqual({ x: 120, y: 65, z: 8 })
  expect(returned.activePortal?.interiorBlock).toBe(NETHER_PORTAL_BLOCK_ID)
  expect(returned.activePortal?.frameBlock).toBe(OBSIDIAN_BLOCK_ID)
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})

test('reaches saved after an autosave, even while the player keeps drifting', async ({ page }) => {
  const faults = watchForFaults(page)
  await deleteSessionDatabase(page)

  await startGameSession(page)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')

  // Water buoyancy moves the player every frame with zero input — the same
  // condition that starved the indicator in production: `main.ts`'s
  // `if (looked || moved) markSessionDirty()` mints a fresh dirty generation
  // on essentially every frame, so a save's async round trip is always
  // racing a newer generation than the one it captured. The regression was
  // that the indicator compared a just-completed save against whatever
  // generation was live *when the callback ran*, which under continuous
  // drift is (almost) never the generation the save actually covered.
  await callQa(page, 'gameplay.seedSubmergedSwimmingEncounter')
  await watchForSavedPersistence(page)

  // AUTOSAVE_INTERVAL_MS (main.ts) is 5s and does not wait for a debounce
  // gap the continuous drift never provides — this only needs to observe
  // that a background save eventually completes and is shown, not to force
  // one. waitForSimulationProgress backs this off by real frame progress
  // rather than a fixed wall-clock sleep, matching the drift-sensitive
  // waits elsewhere in this suite.
  await waitForSimulationProgress(
    page,
    () => sawSavedPersistenceWithFrames(page),
    (sawSaved) => sawSaved,
    { description: 'save indicator reaches saved despite continuous drift' },
  )

  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
})
