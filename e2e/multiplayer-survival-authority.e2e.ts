import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const PLAYER_AT = { x: 8.5, y: 65, z: 10.5 } as const

type GameplaySnapshot = {
  readonly mode: 'survival' | 'creative'
  readonly vitals: {
    readonly healthPoints: number
  }
  readonly inventory: {
    readonly slots: ReadonlyArray<{ readonly item: string; readonly count: number } | null>
  }
  readonly renderedEntities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  }>
}

type PlayerSession = {
  readonly context: BrowserContext
  readonly page: Page
  readonly url: string
}

const emptySlots = (): ReadonlyArray<null> => Array.from({ length: 36 }, () => null)

const initialState = {
  revision: 4,
  blocks: [],
  inventories: [
    {
      player: 'survival-alice',
      state: { slots: [{ item: 'potato', count: 2 }, ...emptySlots().slice(1)], selectedSlot: 0 },
    },
    {
      player: 'survival-bob',
      state: { slots: emptySlots(), selectedSlot: 0 },
    },
  ],
  vitals: [
    { player: 'survival-alice', state: { health: 13, hunger: 11, experience: 7 } },
    { player: 'survival-bob', state: { health: 18, hunger: 16, experience: 3 } },
  ],
  timeWeather: { timeOfDay: 6_000, weather: 'clear' },
  containers: [],
  furnaces: [],
  villagerTrades: [],
  entities: [
    {
      _tag: 'living',
      entityId: 'survival-zombie',
      entityType: 'zombie',
      at: { x: PLAYER_AT.x + 1, y: PLAYER_AT.y, z: PLAYER_AT.z },
      health: 8,
      maxHealth: 20,
    },
    {
      _tag: 'vehicle',
      entityId: 'survival-boat',
      vehicleType: 'boat',
      at: { x: PLAYER_AT.x, y: PLAYER_AT.y, z: PLAYER_AT.z + 1 },
      occupant: null,
    },
  ],
}

const callQa = <A>(page: Page, command: string): Promise<A> =>
  page.evaluate(async ({ key, commandName }) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as
      | Record<string, () => unknown>
      | undefined
    const operation = surface?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return await operation()
  }, { key: QA_GLOBAL_KEY, commandName: command }) as Promise<A>

const snapshot = (page: Page): Promise<GameplaySnapshot> => callQa(page, 'gameplay.snapshot')

const revision = async (page: Page): Promise<number> =>
  Number(await page.locator('#game-canvas').getAttribute('data-multiplayer-revision'))

const createSurvivalWorld = async (page: Page, name: string): Promise<string> => {
  await page.goto('/')
  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('[data-mx-ui="menu-world-name"]').fill(name)
  await expect(page.locator('[data-mx-ui="menu-game-mode"]')).toHaveAttribute(
    'aria-label',
    'Game mode: Survival',
  )
  await page.locator('[data-menu-action="confirm"]').click()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await callQa(page, 'gameplay.seedCreativePlacementEncounter')
  await page.keyboard.press('Escape')
  await callQa(page, 'persistence.flush')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  expect((await snapshot(page)).mode).toBe('survival')
  return page.url()
}

const connectPlayer = async (
  browser: Browser,
  serverUrl: string,
  player: string,
  name: string,
): Promise<PlayerSession> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const sessionUrl = await createSurvivalWorld(page, `${name} Survival Authority E2E`)
  const url = new URL(sessionUrl)
  url.searchParams.set('multiplayer', serverUrl)
  url.searchParams.set('player', player)
  url.searchParams.set('multiplayerName', name)
  await page.goto(url.href)
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-connection', 'connected')
  return { context, page, url: url.href }
}

const entityCommand = (
  page: Page,
  detail: {
    readonly entityId: string
    readonly action: 'attack' | 'pickup' | 'mount' | 'dismount' | 'move'
    readonly at?: { readonly x: number; readonly y: number; readonly z: number }
  },
): Promise<void> => page.evaluate((command) => {
  document.dispatchEvent(new CustomEvent('mc-entity-command', { detail: command }))
}, detail)

const authoritativeEntity = (page: Page, entityId: string) =>
  snapshot(page).then((state) => state.renderedEntities.find(
    (entity) => entity.id === `authoritative:${entityId}`,
  ))

let serverProcess: ChildProcess | undefined
let serverUrl: string
let stateDirectory: string | undefined

const startServer = (stateFile: string): Promise<{ process: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), [
      'apps/multiplayer-server/main.ts',
      '--host', '127.0.0.1',
      '--port', '0',
      '--state-file', stateFile,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`multiplayer server start timed out: ${stderr}`))
    }, 10_000)
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`multiplayer server exited with ${String(code)}: ${stderr}`))
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      const match = /multiplayer server listening on (ws:\/\/[^\s]+)/.exec(chunk.toString())
      if (match?.[1] === undefined) return
      clearTimeout(timeout)
      resolve({ process: child, url: match[1] })
    })
  })

test.beforeAll(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-survival-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'overworld',
    seed: 0,
    state: initialState,
  })}\n`, 'utf8')
  const started = await startServer(stateFile)
  serverProcess = started.process
  serverUrl = started.url
})

test.afterAll(async () => {
  serverProcess?.kill('SIGTERM')
  if (stateDirectory !== undefined) {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('keeps Survival inventory, vitals, entities, vehicles, and reconnect state authoritative', async ({ browser }) => {
  const alice = await connectPlayer(browser, serverUrl, 'survival-alice', 'Alice')
  const bob = await connectPlayer(browser, serverUrl, 'survival-bob', 'Bob')

  try {
    await expect(alice.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect(bob.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect.poll(async () => (await snapshot(alice.page)).vitals.healthPoints).toBe(13)
    await expect.poll(async () => (await snapshot(alice.page)).inventory.slots[0]).toEqual({
      item: 'potato', count: 2,
    })
    await expect.poll(async () => (await snapshot(bob.page)).vitals.healthPoints).toBe(18)
    await expect.poll(async () => (await snapshot(bob.page)).inventory.slots[0]).toBeNull()
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-zombie')).toMatchObject({ kind: 'zombie' })

    await entityCommand(alice.page, { entityId: 'survival-zombie', action: 'attack' })
    await expect.poll(() => revision(bob.page)).toBe(5)
    await expect.poll(() => revision(alice.page)).toBe(5)
    await entityCommand(alice.page, { entityId: 'survival-zombie', action: 'attack' })
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-zombie')).toBeUndefined()

    await expect.poll(async () => (await snapshot(bob.page)).renderedEntities.find(
      (entity) => entity.kind === 'dropped_item',
    )).not.toBeUndefined()
    await expect.poll(async () => (await snapshot(alice.page)).renderedEntities.find(
      (entity) => entity.kind === 'dropped_item',
    )).not.toBeUndefined()
    const dropEntity = (await snapshot(alice.page)).renderedEntities.find(
      (entity) => entity.kind === 'dropped_item',
    )
    expect(dropEntity).toBeDefined()
    await entityCommand(alice.page, {
      entityId: dropEntity?.id.replace('authoritative:', '') ?? '',
      action: 'pickup',
    })
    await expect.poll(async () => (await snapshot(alice.page)).inventory.slots).toEqual(
      expect.arrayContaining([{ item: 'rotten_flesh', count: 2 }]),
    )
    await expect.poll(async () => (await snapshot(bob.page)).renderedEntities.some(
      (entity) => entity.kind === 'dropped_item',
    )).toBe(false)

    await Promise.all([alice.page, bob.page].map((page) => page.evaluate(() => {
      const canvas = document.querySelector('#game-canvas')
      const rejections: string[] = []
      ;(globalThis as unknown as { multiplayerRejections: string[] }).multiplayerRejections = rejections
      new MutationObserver(() => {
        const rejection = canvas?.getAttribute('data-multiplayer-rejection') ?? ''
        if (rejection !== '') rejections.push(rejection)
      }).observe(canvas ?? document.body, { attributes: true, attributeFilter: ['data-multiplayer-rejection'] })
    })))
    await Promise.all([
      entityCommand(alice.page, { entityId: 'survival-boat', action: 'mount' }),
      entityCommand(bob.page, { entityId: 'survival-boat', action: 'mount' }),
    ])
    await expect.poll(async () => {
      const histories = await Promise.all([alice.page, bob.page].map((page) => page.evaluate(() =>
        (globalThis as unknown as { multiplayerRejections: string[] }).multiplayerRejections)))
      return histories.some((rejections) => rejections.some((rejection) =>
        rejection === 'stale-revision' || rejection === 'vehicle-occupied'))
    }).toBe(true)

    const aliceRejected = await alice.page.evaluate(() =>
      (globalThis as unknown as { multiplayerRejections: string[] }).multiplayerRejections.length > 0)
    const rider = aliceRejected ? bob.page : alice.page
    const movedTo = { x: PLAYER_AT.x + 3, y: PLAYER_AT.y, z: PLAYER_AT.z + 1 }
    await entityCommand(rider, { entityId: 'survival-boat', action: 'move', at: movedTo })
    await expect.poll(() => authoritativeEntity(alice.page, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    await entityCommand(rider, { entityId: 'survival-boat', action: 'dismount' })
    await expect.poll(() => revision(alice.page)).toBeGreaterThanOrEqual(10)

    await bob.page.close()
    await expect(alice.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '1')
    const reconnectedBob = await bob.context.newPage()
    await reconnectedBob.goto(bob.url)
    await expect(reconnectedBob.locator('#game-canvas')).toHaveAttribute('data-multiplayer-connection', 'connected')
    await expect.poll(() => authoritativeEntity(reconnectedBob, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    await expect.poll(async () => (await snapshot(reconnectedBob)).renderedEntities.some(
      (entity) => entity.id === 'authoritative:survival-zombie' || entity.kind === 'dropped_item',
    )).toBe(false)
    await expect.poll(async () => (await snapshot(reconnectedBob)).vitals.healthPoints).toBe(18)
    await expect.poll(async () => (await snapshot(reconnectedBob)).inventory.slots[0]).toBeNull()
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
