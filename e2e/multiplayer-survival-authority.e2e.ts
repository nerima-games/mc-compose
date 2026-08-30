import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const PLAYER_AT = { x: 8.5, y: 65, z: 10.5 } as const
const ENVIRONMENT_PLAYER_AT = { x: 24.95, y: 65, z: 8.5 } as const
const ENVIRONMENT_BLOCKS = [
  { at: { x: 23, y: 64, z: 8 }, block: 'stone' },
  { at: { x: 24, y: 64, z: 8 }, block: 'stone' },
  { at: { x: 25, y: 64, z: 8 }, block: 'stone' },
  { at: { x: 26, y: 64, z: 8 }, block: 'stone' },
  { at: { x: 24, y: 65, z: 8 }, block: 'lava' },
  { at: { x: 25, y: 65, z: 8 }, block: 'lava' },
] as const
const BOOT_TIMEOUT_MS = 15_000
const LEGACY_SECRETS = {
  'survival-alice': 'survival-alice-registration-secret',
  'survival-bob': 'survival-bob-registration-secret',
} as const

const claimsFor = (players: Record<string, string>) => ({
  format: 1,
  players: Object.fromEntries(Object.entries(players).map(([player, secret]) => [
    player,
    createHash('sha256').update(secret).digest('hex'),
  ])),
})

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
  readonly sessionId: string
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
  playerPositions: [
    { player: 'survival-alice', at: PLAYER_AT, facing: { yawRadians: 0, pitchRadians: 0 } },
    { player: 'survival-bob', at: PLAYER_AT, facing: { yawRadians: 0, pitchRadians: 0 } },
  ],
  timeWeather: { timeOfDay: 6_000, weather: 'clear' },
  containers: [],
  furnaces: [],
  villagerTrades: [],
  entities: [
    {
      _tag: 'living',
      entityId: 'survival-target',
      entityType: 'test-target',
      at: { x: PLAYER_AT.x + 1, y: PLAYER_AT.y, z: PLAYER_AT.z },
      health: 8,
      maxHealth: 20,
    },
    {
      _tag: 'item-drop',
      entityId: 'survival-rotten-flesh',
      at: { x: PLAYER_AT.x + 1, y: PLAYER_AT.y, z: PLAYER_AT.z },
      stack: { item: 'rotten_flesh', count: 2 },
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
  await expect(page.locator('body')).toHaveAttribute(
    'data-mc-compose-boot',
    'running',
    { timeout: BOOT_TIMEOUT_MS },
  )
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
  registrationToken: string,
): Promise<PlayerSession> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const sessionUrl = await createSurvivalWorld(page, `${name} Survival Authority E2E`)
  const url = new URL(sessionUrl)
  url.searchParams.set('multiplayer', serverUrl)
  url.searchParams.set('player', player)
  url.searchParams.set('multiplayerName', name)
  const sessionId = await page.locator('body').getAttribute('data-session-id')
  if (sessionId === null) throw new Error('multiplayer session lacks an id')
  const registrationTokenKey = `mc-compose:multiplayer-registration:${JSON.stringify([serverUrl, sessionId, player])}`
  await page.evaluate(({ key, token }) => {
    window.sessionStorage.setItem(key, token)
  }, { key: registrationTokenKey, token: registrationToken })
  await page.goto(url.href)
  await expect(page.locator('body')).toHaveAttribute(
    'data-mc-compose-boot',
    'running',
    { timeout: BOOT_TIMEOUT_MS },
  )
  await expect(page.locator('#game-canvas')).toHaveAttribute(
    'data-multiplayer-connection',
    'connected',
    { timeout: BOOT_TIMEOUT_MS },
  )
  return { context, page, url: url.href, sessionId }
}

const entityCommand = (
  page: Page,
  detail: {
    readonly entityId: string
    readonly action: 'attack' | 'pickup' | 'mount' | 'dismount' | 'move'
    readonly direction?: 'forward' | 'backward'
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

const startServer = (stateFile: string, claimsFile: string): Promise<{ process: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), [
      'apps/multiplayer-server/main.ts',
      '--host', '127.0.0.1',
      '--port', '0',
      '--state-file', stateFile,
      '--legacy-player-claims-file', claimsFile,
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

// `child.kill()` only sends the signal; it does not wait for the process to
// actually exit. Deleting a server's state directory right after killing it
// races the child's own shutdown writes to that directory, observed as
// `ENOTEMPTY: directory not empty, rmdir '...'` and — worse — as orphaned
// multiplayer-server processes still running (and still holding a port) long
// after the run that spawned them finished, degrading later tests in the
// same suite run. Wait for the real `exit` event before deleting anything,
// escalating to SIGKILL if the process ignores SIGTERM.
const stopServer = (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000)
    child.once('exit', () => {
      clearTimeout(forceKill)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

test.beforeAll(async () => {
  stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-survival-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  const claimsFile = join(stateDirectory, 'claims.json')
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'overworld',
    seed: 0,
    state: initialState,
  })}\n`, 'utf8')
  await writeFile(claimsFile, `${JSON.stringify(claimsFor(LEGACY_SECRETS))}\n`, 'utf8')
  const started = await startServer(stateFile, claimsFile)
  serverProcess = started.process
  serverUrl = started.url
})

test.afterAll(async () => {
  if (serverProcess !== undefined) await stopServer(serverProcess)
  if (stateDirectory !== undefined) {
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('routes environmental survival damage through multiplayer authority', async ({ browser }) => {
  const environmentStateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-environmental-authority-e2e-'))
  const environmentStateFile = join(environmentStateDirectory, 'state.json')
  const environmentClaimsFile = join(environmentStateDirectory, 'claims.json')
  let environmentServer: ChildProcess | undefined
  let alice: PlayerSession | undefined

  try {
    await writeFile(environmentStateFile, `${JSON.stringify({
      format: 1,
      worldId: 'overworld',
      seed: 0,
      state: {
        ...initialState,
        blocks: ENVIRONMENT_BLOCKS,
        playerPositions: initialState.playerPositions.map((position) => ({
          ...position,
          at: ENVIRONMENT_PLAYER_AT,
        })),
      },
    })}\n`, 'utf8')
    await writeFile(environmentClaimsFile, `${JSON.stringify(claimsFor(LEGACY_SECRETS))}\n`, 'utf8')
    const started = await startServer(environmentStateFile, environmentClaimsFile)
    environmentServer = started.process
    alice = await connectPlayer(browser, started.url, 'survival-alice', 'Alice', LEGACY_SECRETS['survival-alice'])

    await expect.poll(async () => (await snapshot(alice!.page)).vitals.healthPoints).toBeLessThanOrEqual(9)
  } finally {
    await alice?.context.close()
    if (environmentServer !== undefined) await stopServer(environmentServer)
    await rm(environmentStateDirectory, { recursive: true, force: true })
  }
})

test('automatically picks up nearby item drops through the authoritative multiplayer snapshot', async ({ browser }) => {
  const alice = await connectPlayer(browser, serverUrl, 'survival-alice', 'Alice', LEGACY_SECRETS['survival-alice'])
  let bob: PlayerSession | undefined

  try {
    await expect.poll(async () => (await snapshot(alice.page)).inventory.slots).toEqual(
      expect.arrayContaining([{ item: 'rotten_flesh', count: 2 }]),
    )
    await expect.poll(() => authoritativeEntity(alice.page, 'survival-rotten-flesh')).toBeUndefined()

    const bobSession = await connectPlayer(browser, serverUrl, 'survival-bob', 'Bob', LEGACY_SECRETS['survival-bob'])
    bob = bobSession
    await expect.poll(() => authoritativeEntity(bobSession.page, 'survival-rotten-flesh')).toBeUndefined()
    await expect.poll(async () => (await snapshot(bobSession.page)).inventory.slots).not.toEqual(
      expect.arrayContaining([{ item: 'rotten_flesh', count: 2 }]),
    )
  } finally {
    await Promise.all([alice.context.close(), bob?.context.close()])
  }
})

test('keeps Survival inventory, vitals, entities, vehicles, and reconnect state authoritative', async ({ browser }) => {
  const alice = await connectPlayer(browser, serverUrl, 'survival-alice', 'Alice', LEGACY_SECRETS['survival-alice'])
  const bob = await connectPlayer(browser, serverUrl, 'survival-bob', 'Bob', LEGACY_SECRETS['survival-bob'])

  try {
    await expect(alice.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect(bob.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect.poll(async () => (await snapshot(alice.page)).vitals.healthPoints).toBe(13)
    await expect.poll(async () => (await snapshot(alice.page)).inventory.slots[0]).toEqual({
      item: 'potato', count: 2,
    })
    const aliceInventory = alice.page.locator('#inventory-root')
    const alicePotatoes = aliceInventory.locator('[data-region="hotbar"] [data-slot-index="0"]')
    const aliceMainSlot = aliceInventory.locator('[data-region="main"] [data-slot-index="0"]')
    await alice.page.keyboard.press('KeyE')
    await expect(aliceInventory).toBeVisible()
    await alicePotatoes.click({ button: 'right' })
    await expect(alice.page.locator('body')).toHaveAttribute('data-equipment-action', 'selecting')
    await aliceMainSlot.click({ button: 'right' })
    await expect(alice.page.locator('body')).toHaveAttribute('data-equipment-action', 'pending')
    await expect.poll(async () => {
      const slots = (await snapshot(alice.page)).inventory.slots
      return [slots[0], ...slots.slice(2, 10)]
    }).toEqual([
      { item: 'potato', count: 1 },
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      { item: 'potato', count: 1 },
    ])
    await alice.page.keyboard.press('KeyE')
    await expect(aliceInventory).toBeHidden()
    await expect.poll(async () => (await snapshot(bob.page)).vitals.healthPoints).toBe(18)
    await expect.poll(async () => (await snapshot(bob.page)).inventory.slots[0]).toBeNull()
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-target')).toMatchObject({ kind: 'test-target' })

    const revisionBeforeAttack = await revision(alice.page)
    await entityCommand(alice.page, { entityId: 'survival-target', action: 'attack' })
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-target')).toMatchObject({ kind: 'test-target' })
    await expect.poll(() => authoritativeEntity(alice.page, 'survival-target')).toMatchObject({ kind: 'test-target' })
    await expect.poll(() => revision(alice.page)).toBeGreaterThan(revisionBeforeAttack)
    await entityCommand(alice.page, { entityId: 'survival-target', action: 'attack' })
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-target')).toBeUndefined()

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
    const mountRejection = (page: Page): Promise<boolean> => page.evaluate(() =>
      (globalThis as unknown as { multiplayerRejections: string[] }).multiplayerRejections.some(
        (rejection) => rejection === 'stale-revision' || rejection === 'vehicle-occupied',
      ))
    await expect.poll(async () => {
      const rejected = await Promise.all([mountRejection(alice.page), mountRejection(bob.page)])
      return rejected.filter(Boolean).length
    }).toBe(1)
    const aliceRejected = await mountRejection(alice.page)
    const rider = aliceRejected ? bob.page : alice.page
    await expect.poll(() => revision(rider)).toBeGreaterThanOrEqual(9)
    const revisionBeforeMove = await revision(rider)
    const movedTo = { x: PLAYER_AT.x, y: PLAYER_AT.y, z: PLAYER_AT.z + 2 }
    await entityCommand(rider, { entityId: 'survival-boat', action: 'move', direction: 'backward' })
    await expect.poll(() => revision(rider)).toBeGreaterThan(revisionBeforeMove)
    await expect.poll(() => authoritativeEntity(alice.page, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    await expect.poll(() => authoritativeEntity(bob.page, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    const revisionBeforeDismount = await revision(rider)
    await entityCommand(rider, { entityId: 'survival-boat', action: 'dismount' })
    await expect.poll(() => revision(rider)).toBeGreaterThan(revisionBeforeDismount)

    await bob.page.close()
    await expect(alice.page.locator('#game-canvas')).toHaveAttribute('data-multiplayer-player-count', '1')
    const reconnectedBob = await bob.context.newPage()
    const bobUrl = new URL(bob.url)
    const bobRegistrationTokenKey = `mc-compose:multiplayer-registration:${JSON.stringify([serverUrl, bob.sessionId, 'survival-bob'])}`
    await reconnectedBob.goto(bobUrl.origin)
    await reconnectedBob.evaluate(({ key, token }) => {
      window.sessionStorage.setItem(key, token)
    }, { key: bobRegistrationTokenKey, token: LEGACY_SECRETS['survival-bob'] })
    await reconnectedBob.goto(bobUrl.href)
    await expect(reconnectedBob.locator('body')).toHaveAttribute(
      'data-mc-compose-boot',
      'running',
      { timeout: BOOT_TIMEOUT_MS },
    )
    await expect(reconnectedBob.locator('#game-canvas')).toHaveAttribute(
      'data-multiplayer-connection',
      'connected',
      { timeout: BOOT_TIMEOUT_MS },
    )
    await expect.poll(() => authoritativeEntity(reconnectedBob, 'survival-boat')).toMatchObject({ feetPosition: movedTo })
    await expect.poll(async () => (await snapshot(reconnectedBob)).renderedEntities.some(
      (entity) => entity.id === 'authoritative:survival-target' || entity.kind === 'dropped_item',
    )).toBe(false)
    await expect.poll(async () => (await snapshot(reconnectedBob)).vitals.healthPoints).toBe(18)
    await expect.poll(async () => (await snapshot(reconnectedBob)).inventory.slots[0]).toBeNull()
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
