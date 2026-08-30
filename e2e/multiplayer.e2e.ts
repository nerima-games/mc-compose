import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { NetworkMessage } from '@nerima-games/mx-multiplayer'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { Either } from 'effect'
import { tsImport } from 'tsx/esm/api'
import { WebSocket } from 'ws'

import { E2E_MULTIPLAYER_URL } from '../playwright.config'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
const LEGACY_SECRETS = {
  'alice-e2e': 'alice-e2e-registration-secret',
  'bob-e2e': 'bob-e2e-registration-secret',
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
  readonly dimension: 'overworld' | 'nether' | 'end'
  readonly inventory: {
    readonly slots: ReadonlyArray<Readonly<{ readonly item: string; readonly count: number }> | null>
  }
  readonly pose: {
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  }
  readonly vitals: {
    readonly healthPoints: number
  }
  readonly renderedEntities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
  }>
  readonly ignitionTarget: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
    readonly block: number | null
  }
  readonly bedExplosionProbe: {
    readonly block: number | null
  }
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

const snapshot = (page: Page): Promise<GameplaySnapshot> =>
  callQa(page, 'gameplay.snapshot')

const itemCount = (current: GameplaySnapshot, item: string): number =>
  current.inventory.slots.reduce(
    (total, slot) => total + (slot?.item === item ? slot.count : 0),
    0,
  )

const emptySlots = (): ReadonlyArray<null> => Array.from({ length: 36 }, () => null)

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

const useTargetedBlock = async (page: Page): Promise<void> => {
  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await grantPointerLock(page)
  await canvas.click({ button: 'right' })
}

const createCreativeWorld = async (page: Page, name: string): Promise<string> => {
  await page.goto('/')
  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('input[data-mx-ui="menu-world-name"]').fill(name)
  await page.locator('[data-mx-ui="menu-game-mode"]').click()
  await expect(page.locator('[data-mx-ui="menu-game-mode"]')).toHaveAttribute(
    'aria-label',
    'Game mode: Creative',
  )
  await page.locator('[data-menu-action="confirm"]').click()
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  expect((await snapshot(page)).mode).toBe('creative')
  return page.url()
}

const createSurvivalWorld = async (page: Page, name: string): Promise<string> => {
  await page.goto('/')
  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('input[data-mx-ui="menu-world-name"]').fill(name)
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

const multiplayerUrl = (
  sessionUrl: string,
  player: string,
  name: string,
  serverUrl = E2E_MULTIPLAYER_URL,
): string => {
  const url = new URL(sessionUrl)
  url.searchParams.set('multiplayer', serverUrl)
  url.searchParams.set('player', player)
  url.searchParams.set('multiplayerName', name)
  return url.href
}

const canvasRevision = async (page: Page): Promise<number> =>
  Number(await page.locator('#game-canvas').getAttribute('data-multiplayer-revision'))

type WireMessage = { readonly _tag: string; readonly [key: string]: unknown }

const { encodeFrame } = await tsImport(
  '@nerima-games/mx-multiplayer',
  import.meta.url,
) as typeof import('@nerima-games/mx-multiplayer')

const encode = (message: NetworkMessage): string => {
  const result = encodeFrame(message)
  if (Either.isLeft(result)) throw result.left
  return result.right
}

type WireMessageReader = {
  readonly next: () => Promise<WireMessage>
  readonly close: () => void
}

const createWireMessageReader = (socket: WebSocket): WireMessageReader => {
  const messages: WireMessage[] = []
  const waiters: Array<{
    readonly resolve: (message: WireMessage) => void
    readonly reject: (error: Error) => void
  }> = []
  let failure: Error | undefined

  const cleanup = (): void => {
    socket.off('error', onError)
    socket.off('close', onClose)
    socket.off('message', onMessage)
  }

  const fail = (error: Error): void => {
    if (failure !== undefined) return
    failure = error
    cleanup()
    while (waiters.length > 0) waiters.shift()?.reject(error)
  }

  const onError = (error: Error): void => fail(error)
  const onClose = (code: number, reason: Buffer): void =>
    fail(new Error(`socket closed before receiving a message (${String(code)}): ${reason.toString()}`))
  const onMessage = (data: Buffer): void => {
    try {
      const frame = JSON.parse(data.toString()) as WireMessage & { readonly message?: WireMessage }
      const message = frame.message ?? frame
      const waiter = waiters.shift()
      if (waiter === undefined) messages.push(message)
      else waiter.resolve(message)
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  const next = (): Promise<WireMessage> => {
    const message = messages.shift()
    if (message !== undefined) return Promise.resolve(message)
    if (failure !== undefined) return Promise.reject(failure)
    return new Promise((resolve, reject) => waiters.push({ resolve, reject }))
  }

  socket.on('error', onError)
  socket.on('close', onClose)
  socket.on('message', onMessage)
  return {
    next,
    close: cleanup,
  }
}

const receiveMessageBefore = (reader: WireMessageReader, timeoutMs: number): Promise<WireMessage> => {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutPromise = new Promise<WireMessage>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`timed out after ${String(timeoutMs)}ms`)), timeoutMs)
  })
  return Promise.race([reader.next(), timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout)
  })
}

const receiveMessageWithTag = async (reader: WireMessageReader, tag: string): Promise<WireMessage> => {
  const deadline = Date.now() + 5_000
  const observedTags: string[] = []
  try {
    while (Date.now() < deadline) {
      const message = await receiveMessageBefore(reader, deadline - Date.now())
      if (message._tag === tag) return message
      observedTags.push(message._tag)
    }
  } catch (error) {
    throw new Error(
      `did not receive ${tag} within 5000ms; observed ${observedTags.join(', ') || 'no messages'}`,
      { cause: error },
    )
  }
  throw new Error(`did not receive ${tag} within 5000ms; observed ${observedTags.join(', ') || 'no messages'}`)
}

const expectOutOfBoundsPlacementRejection = async (
  revision: number,
  serverUrl = E2E_MULTIPLAYER_URL,
): Promise<void> => {
  const socket = new WebSocket(serverUrl)
  let reader: WireMessageReader | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    reader = createWireMessageReader(socket)
    socket.send(JSON.stringify({
      _tag: 'PlayerResume',
      player: 'invalid-mutation-e2e',
    }))
    expect(await reader.next()).toMatchObject({ _tag: 'PlayerResumeAccepted' })

    socket.send(encode({
      _tag: 'PlayerJoin',
      player: 'invalid-mutation-e2e',
      name: 'Invalid Mutation Probe',
      at: { x: 0, y: 64, z: 0 },
    } as NetworkMessage))
    expect(await reader.next()).toMatchObject({ _tag: 'WorldSnapshot', revision })

    socket.send(encode({
      _tag: 'BlockPlace',
      player: 'invalid-mutation-e2e',
      at: { x: 30_000_001, y: 64, z: 0 },
      block: 'stone',
    } as NetworkMessage))
    expect(await receiveMessageWithTag(reader, 'BlockMutationRejected')).toMatchObject({
      _tag: 'BlockMutationRejected',
      operation: 'place',
      reason: 'out-of-bounds',
      revision,
    })
  } finally {
    reader?.close()
    socket.close()
  }
}

const connectPage = async (page: Page, url: string, registrationToken?: string): Promise<void> => {
  if (registrationToken !== undefined) {
    const parsed = new URL(url)
    const serverUrl = parsed.searchParams.get('multiplayer')
    const player = parsed.searchParams.get('player')
    if (serverUrl === null || player === null) throw new Error('multiplayer URL lacks auth fields')
    const sessionId = await page.locator('body').getAttribute('data-session-id')
    if (sessionId === null) throw new Error('multiplayer session lacks an id')
    const key = `mc-compose:multiplayer-registration:${JSON.stringify([serverUrl, sessionId, player])}`
    await page.evaluate(({ key: storageKey, token }) => {
      window.sessionStorage.setItem(storageKey, token)
    }, { key, token: registrationToken })
  }
  await page.goto(url)
  const canvas = page.locator('#game-canvas')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(canvas).toHaveAttribute('data-multiplayer-connection', 'connected')
}

const startServer = (
  stateFile: string,
  claimsFile: string,
  worldId = 'overworld',
): Promise<{ process: ChildProcess; url: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(join(process.cwd(), 'node_modules/.bin/tsx'), [
      'apps/multiplayer-server/main.ts',
      '--host', '127.0.0.1',
      '--port', '0',
      '--world', worldId,
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
// actually exit. A `finally` block that killed the server and immediately
// `rm(stateDirectory, { recursive: true })`'d its directory raced the child's
// own shutdown writes to that directory, observed as
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

const openPlayer = async (
  browser: Browser,
  worldName: string,
  player: string,
  name: string,
  serverUrl = E2E_MULTIPLAYER_URL,
  registrationToken?: string,
  createWorld: (page: Page, name: string) => Promise<string> = createCreativeWorld,
  existingContext?: BrowserContext,
): Promise<{ readonly context: BrowserContext; readonly page: Page; readonly url: string }> => {
  const context = existingContext ?? await browser.newContext()
  const page = await context.newPage()
  const sessionUrl = await createWorld(page, worldName)
  if (createWorld !== createSurvivalWorld) {
    await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativePlacementEncounter')
    await page.keyboard.press('Escape')
    await callQa(page, 'persistence.flush')
    await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  }
  const url = multiplayerUrl(sessionUrl, player, name, serverUrl)
  await connectPage(page, url, registrationToken)
  return { context, page, url }
}

test('joins a saved world from the title screen multiplayer form', async ({ page }) => {
  await createCreativeWorld(page, 'Title Multiplayer E2E')
  await page.keyboard.press('Escape')
  await Promise.all([
    page.waitForURL((url) => url.pathname === '/'),
    page.locator('#save-quit-button').click(),
  ])
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-route', 'title')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(page.locator('#multiplayer-join')).toBeVisible()

  await page.locator('#multiplayer-name').fill('Title Player')
  await page.locator('#multiplayer-player').fill('title-player-e2e')
  await page.locator('#multiplayer-url').fill(E2E_MULTIPLAYER_URL)
  await page.locator('#multiplayer-join-button').click()

  await expect(page.locator('#game-canvas')).toHaveAttribute(
    'data-multiplayer-connection',
    'connected',
  )
  await expect(page.locator('#multiplayer-status')).toContainText('Movement corrected')
  expect(new URL(page.url()).searchParams.get('player')).toBe('title-player-e2e')
})

test('does not explode or mutate a Nether bed in multiplayer', async ({ page }) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-multiplayer-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  const claimsFile = join(stateDirectory, 'claims.json')
  const player = 'alice-e2e'
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'nether',
    seed: 0,
    state: {
      // The local fixture advances before the multiplayer connection is established.
      // Keep the server snapshot newer so the client accepts it during reconciliation.
      revision: 4,
      blocks: [],
      inventories: [{
        player,
        state: { slots: [{ item: 'stone', count: 2 }, ...emptySlots().slice(1)], selectedSlot: 0 },
      }],
      playerPositions: [{
        player,
        at: { x: 8.5, y: 65, z: 10.5 },
        facing: { yawRadians: 0, pitchRadians: 0 },
      }],
    },
  })}\n`, 'utf8')
  await writeFile(claimsFile, `${JSON.stringify(claimsFor({
    [player]: LEGACY_SECRETS[player],
  }))}\n`, 'utf8')
    const server = await startServer(stateFile, claimsFile, 'nether')

  try {
    const sessionUrl = await createCreativeWorld(page, 'Multiplayer Nether Bed E2E')
    await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativePlacementEncounter')
    const seeded = await callQa<GameplaySnapshot>(page, 'gameplay.seedBedExplosionEncounter')
    expect(seeded.dimension).toBe('nether')
    expect(seeded.bedExplosionProbe.block).not.toBeNull()
    expect(seeded.bedExplosionProbe.block).not.toBe(0)
    await page.keyboard.press('Escape')
    await callQa(page, 'persistence.flush')
    await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
    await connectPage(
      page,
      multiplayerUrl(sessionUrl, player, 'Alice', server.url),
      LEGACY_SECRETS[player],
    )
    const before = await snapshot(page)
    expect(before.dimension).toBe('nether')
    expect(before.bedExplosionProbe.block).toBe(seeded.bedExplosionProbe.block)
    await expect.poll(() => canvasRevision(page)).toBe(4)
    const revisionBeforeUse = await canvasRevision(page)

    await useTargetedBlock(page)

    await expect(page.locator('body')).toHaveAttribute('data-sleep-result', 'unavailable')
    const after = await snapshot(page)
    expect(after.bedExplosionProbe.block).toBe(before.bedExplosionProbe.block)
    expect(after.vitals.healthPoints).toBe(before.vitals.healthPoints)
    expect(await canvasRevision(page)).toBe(revisionBeforeUse)
    await expect(page.locator('body')).not.toHaveAttribute('data-bed-explosion-request')
  } finally {
    await stopServer(server.process)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('fires a bow through the authoritative multiplayer server', async ({ browser }) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-multiplayer-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  const claimsFile = join(stateDirectory, 'claims.json')
  const player = 'alice-e2e'
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'overworld',
    seed: 0,
    state: {
      // The browser advances its local revision while creating the Survival world.
      revision: 4,
      blocks: [],
      inventories: [{
        player,
        state: {
          slots: [{ item: 'bow', count: 1 }, { item: 'arrow', count: 2 }, ...emptySlots().slice(2)],
          selectedSlot: 0,
        },
      }],
      playerPositions: [{
        player,
        at: { x: 8.5, y: 65, z: 10.5 },
        facing: { yawRadians: 0, pitchRadians: 0 },
      }],
      vitals: [{ player, state: { health: 20, hunger: 20, experience: 0 } }],
      timeWeather: { timeOfDay: 6_000, weather: 'clear' },
      containers: [],
      furnaces: [],
      villagerTrades: [],
      entities: [],
    },
  })}\n`, 'utf8')
  await writeFile(claimsFile, `${JSON.stringify(claimsFor({
    [player]: LEGACY_SECRETS[player],
  }))}\n`, 'utf8')
  const server = await startServer(stateFile, claimsFile)
  let alice: Awaited<ReturnType<typeof openPlayer>> | undefined

  try {
    const playerSession = await openPlayer(
      browser,
      'Authoritative Multiplayer Bow E2E',
      player,
      'Alice',
      server.url,
      LEGACY_SECRETS[player],
      createSurvivalWorld,
    )
    alice = playerSession
    const canvas = playerSession.page.locator('#game-canvas')
    await expect.poll(() => canvasRevision(playerSession.page)).toBe(4)
    await expect.poll(async () => itemCount(await snapshot(playerSession.page), 'bow')).toBe(1)
    await expect.poll(async () => itemCount(await snapshot(playerSession.page), 'arrow')).toBe(2)
    const before = await snapshot(playerSession.page)
    expect(before.renderedEntities).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'arrow' })]),
    )
    const revisionBeforeDraw = await canvasRevision(playerSession.page)

    await canvas.hover()
    await grantPointerLock(playerSession.page)
    await playerSession.page.mouse.down({ button: 'right' })
    await playerSession.page.waitForTimeout(350)
    expect(await canvasRevision(playerSession.page)).toBe(revisionBeforeDraw)
    expect(itemCount(await snapshot(playerSession.page), 'arrow')).toBe(2)
    await playerSession.page.mouse.up({ button: 'right' })

    // A minimally-drawn arrow lands within a block of the shooter, and the
    // server converts a stuck arrow into an `:arrow:pickup:` item-drop the
    // frame it lands — the in-flight `kind: 'arrow'` entity exists for less
    // than one snapshot round-trip, so polling for it can only ever pass by
    // luck (this assertion was red on main long before Wave 0). The drop's id
    // is derived exclusively from the server-side arrow entity, so its arrival
    // in the client's render list proves the same round-trip — spawn, flight
    // simulation, impact conversion, entity delta, client render —
    // deterministically. Rendering a long-lived transient entity needs a QA
    // pause hook; deferred.
    await expect.poll(async () => (await snapshot(playerSession.page)).renderedEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'dropped_item',
          id: expect.stringMatching(/:arrow:pickup:/u),
        }),
      ]),
    )
    await expect.poll(() => canvasRevision(playerSession.page)).toBeGreaterThan(revisionBeforeDraw)
    await expect.poll(async () => itemCount(await snapshot(playerSession.page), 'arrow')).toBe(1)
  } finally {
    await alice?.context.close()
    await stopServer(server.process)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})

test('synchronizes two Creative browser sessions through the authoritative server', async ({ browser }) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'mc-compose-multiplayer-e2e-'))
  const stateFile = join(stateDirectory, 'state.json')
  const claimsFile = join(stateDirectory, 'claims.json')
  const placementPose = { x: 8.5, y: 65, z: 10.5 }
  await writeFile(stateFile, `${JSON.stringify({
    format: 1,
    worldId: 'overworld',
    seed: 0,
    state: {
      revision: 0,
      blocks: [],
      // mc-sim 0.2.1's `restoreStorage` rejects any `slots` array whose length is
      // not exactly 36 (`PlayerStorageValidationError: expected exactly 36
      // slots` — see `player-storage.js`'s `hasExactKeys`/length check). The
      // fixture below used to send just one slot; that was already invalid by
      // this contract, but nothing on the path from this state file to
      // `AuthoritativeSnapshot` (`apps/multiplayer-server/inventory-state.ts`'s
      // `cloneInventory`, which is a 1:1 `.map`, not a pad-to-36) ever
      // normalized it, and nothing rejected it either before 0.2.1's stricter
      // validation. The first `AuthoritativeSnapshot` this fixture reaches — as
      // soon as Bob joins — now throws inside `apps/web/main.ts`'s
      // `applyNetworkInventory`, which crashes Alice's frame loop and freezes
      // `data-multiplayer-player-count` at its initial value. Pad to 36 the
      // same way the other multiplayer fixtures in this file already do
      // (`emptySlots().slice(n)`, see lines above for the bow/nether-bed
      // fixtures) rather than loosening the product's validation.
      inventories: [{
        player: 'alice-e2e',
        state: { slots: [{ item: 'stone', count: 2 }, ...emptySlots().slice(1)], selectedSlot: 0 },
      }],
      playerPositions: ['alice-e2e', 'bob-e2e'].map((player) => ({
        player,
        at: placementPose,
        facing: { yawRadians: 0, pitchRadians: 0 },
      })),
    },
  })}\n`, 'utf8')
  await writeFile(claimsFile, `${JSON.stringify(claimsFor(LEGACY_SECRETS))}\n`, 'utf8')
  const server = await startServer(stateFile, claimsFile)
  const playerContext = await browser.newContext()
  const alice = await openPlayer(
    browser,
    'Alice Multiplayer E2E',
    'alice-e2e',
    'Alice',
    server.url,
    LEGACY_SECRETS['alice-e2e'],
    createCreativeWorld,
    playerContext,
  )
  await alice.page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const bob = await openPlayer(
    browser,
    'Bob Multiplayer E2E',
    'bob-e2e',
    'Bob',
    server.url,
    LEGACY_SECRETS['bob-e2e'],
    createCreativeWorld,
    playerContext,
  )
  try {
    const aliceCanvas = alice.page.locator('#game-canvas')
    const bobCanvas = bob.page.locator('#game-canvas')
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect(bobCanvas).toHaveAttribute('data-multiplayer-player-count', '2')

    await expect.poll(async () => (await snapshot(alice.page)).renderedEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'multiplayer:bob-e2e', kind: 'remote_player' }),
      ]),
    )
    await expect.poll(async () => (await snapshot(bob.page)).renderedEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'multiplayer:alice-e2e', kind: 'remote_player' }),
      ]),
    )

    const aliceSeed = await snapshot(alice.page)
    expect(aliceSeed.ignitionTarget.block).toBe(0)
    const revisionBeforePlace = await canvasRevision(alice.page)
    await callQa<GameplaySnapshot>(alice.page, 'gameplay.requestMultiplayerBlockPlacement')
    await expect.poll(() => canvasRevision(alice.page)).toBe(revisionBeforePlace + 1)
    await expect.poll(() => canvasRevision(bob.page)).toBe(revisionBeforePlace + 1)
    const placedBlock = (await snapshot(alice.page)).ignitionTarget.block
    expect(placedBlock).not.toBeNull()
    expect(placedBlock).not.toBe(0)
    await expect.poll(async () => (await snapshot(bob.page)).ignitionTarget.block).toBe(placedBlock)

    await callQa<GameplaySnapshot>(alice.page, 'gameplay.requestMultiplayerBlockBreak')
    const revisionAfterBreak = revisionBeforePlace + 2
    await expect.poll(() => canvasRevision(alice.page)).toBe(revisionAfterBreak)
    await expect.poll(() => canvasRevision(bob.page)).toBe(revisionAfterBreak)
    await expect.poll(async () => (await snapshot(bob.page)).ignitionTarget.block).toBe(0)

    const chatPayload = '<img src=x onerror=alert(1)> hello'
    await alice.page.locator('#multiplayer-chat-input').fill(chatPayload)
    await alice.page.locator('#multiplayer-chat-form button').click()
    await expect(bob.page.locator('#multiplayer-chat-log li').last()).toHaveText(
      `<Alice> ${chatPayload}`,
    )
    await expect(bob.page.locator('#multiplayer-chat-log img')).toHaveCount(0)

    for (let index = 0; index < 51; index += 1) {
      await alice.page.locator('#multiplayer-chat-input').fill(`bounded message ${index}`)
      await alice.page.locator('#multiplayer-chat-form button').click()
    }
    await expect(bob.page.locator('#multiplayer-chat-log li')).toHaveCount(50)
    await expect(bob.page.locator('#multiplayer-chat-log li').first()).toHaveText(
      '<Alice> bounded message 1',
    )

    const authoritativeX = (await snapshot(alice.page)).pose.feetPosition.x
    await callQa<GameplaySnapshot>(alice.page, 'gameplay.setMultiplayerInvalidPose')
    await expect(alice.page.locator('#multiplayer-status')).toContainText('corrected')
    await expect.poll(async () => Math.abs(
      (await snapshot(alice.page)).pose.feetPosition.x - authoritativeX,
    )).toBeLessThan(2)
    await expect.poll(async () => Math.abs(
      (await snapshot(alice.page)).pose.feetPosition.x - authoritativeX,
    )).toBeLessThan(2)

    await expectOutOfBoundsPlacementRejection(revisionAfterBreak, server.url)
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '2')
    expect(await canvasRevision(alice.page)).toBe(revisionAfterBreak)

    await bob.page.close()
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '1')

    const reconnectedBob = await bob.context.newPage()
    await connectPage(reconnectedBob, bob.url)
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect(reconnectedBob.locator('#game-canvas')).toHaveAttribute(
      'data-multiplayer-player-count',
      '2',
    )
    await expect.poll(() => canvasRevision(reconnectedBob)).toBe(revisionAfterBreak)
    await expect.poll(async () => (await snapshot(reconnectedBob)).ignitionTarget.block).toBe(0)
  } finally {
    await playerContext.close()
    await stopServer(server.process)
    await rm(stateDirectory, { recursive: true, force: true })
  }
})
