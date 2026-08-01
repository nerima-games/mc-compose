import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WebSocket } from 'ws'

import { E2E_MULTIPLAYER_URL } from '../playwright.config'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type GameplaySnapshot = {
  readonly mode: 'survival' | 'creative'
  readonly pose: {
    readonly feetPosition: { readonly x: number; readonly y: number; readonly z: number }
  }
  readonly renderedEntities: ReadonlyArray<{
    readonly id: string
    readonly kind: string
  }>
  readonly ignitionTarget: {
    readonly position: { readonly x: number; readonly y: number; readonly z: number }
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

const createCreativeWorld = async (page: Page, name: string): Promise<string> => {
  await page.goto('/')
  await page.locator('[data-menu-entry="new-world"]').click()
  await page.locator('[data-mx-ui="menu-world-name"]').fill(name)
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

const multiplayerUrl = (sessionUrl: string, player: string, name: string): string => {
  const url = new URL(sessionUrl)
  url.searchParams.set('multiplayer', E2E_MULTIPLAYER_URL)
  url.searchParams.set('player', player)
  url.searchParams.set('multiplayerName', name)
  return url.href
}

const canvasRevision = async (page: Page): Promise<number> =>
  Number(await page.locator('#game-canvas').getAttribute('data-multiplayer-revision'))

type WireMessage = { readonly _tag: string; readonly [key: string]: unknown }

const encode = (message: WireMessage): string => JSON.stringify({ protocolVersion: 1, message })

const receiveMessage = (socket: WebSocket): Promise<WireMessage> =>
  new Promise((resolve, reject) => {
    socket.once('error', reject)
    socket.once('message', (data) => {
      const frame = JSON.parse(data.toString()) as { readonly message?: WireMessage }
      if (frame.message === undefined) reject(new Error('received frame without a message'))
      else resolve(frame.message)
    })
  })

const expectOutOfBoundsPlacementRejection = async (revision: number): Promise<void> => {
  const socket = new WebSocket(E2E_MULTIPLAYER_URL)
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    socket.send(encode({
      _tag: 'PlayerJoin',
      player: 'invalid-mutation-e2e',
      name: 'Invalid Mutation Probe',
      at: { x: 0, y: 64, z: 0 },
    }))
    expect(await receiveMessage(socket)).toMatchObject({ _tag: 'WorldSnapshot', revision })

    socket.send(encode({
      _tag: 'BlockPlace',
      player: 'invalid-mutation-e2e',
      at: { x: 30_000_001, y: 64, z: 0 },
      block: 'stone',
    }))
    expect(await receiveMessage(socket)).toMatchObject({
      _tag: 'BlockMutationRejected',
      operation: 'place',
      reason: 'out-of-bounds',
      revision,
    })
  } finally {
    socket.close()
  }
}

const connectPage = async (page: Page, url: string): Promise<void> => {
  await page.goto(url)
  const canvas = page.locator('#game-canvas')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  await expect(canvas).toHaveAttribute('data-multiplayer-connection', 'connected')
}

const openPlayer = async (
  browser: Browser,
  worldName: string,
  player: string,
  name: string,
): Promise<{ readonly context: BrowserContext; readonly page: Page; readonly url: string }> => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const sessionUrl = await createCreativeWorld(page, worldName)
  await callQa<GameplaySnapshot>(page, 'gameplay.seedCreativePlacementEncounter')
  await expect(page.locator('body')).toHaveAttribute('data-session-persistence', 'saved')
  const url = multiplayerUrl(sessionUrl, player, name)
  await connectPage(page, url)
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
  await expect(page.locator('#multiplayer-status')).toContainText('Connected')
  expect(new URL(page.url()).searchParams.get('player')).toBe('title-player-e2e')
})

test('synchronizes two Creative browser sessions through the authoritative server', async ({ browser }) => {
  const alice = await openPlayer(browser, 'Alice Multiplayer E2E', 'alice-e2e', 'Alice')
  const bob = await openPlayer(browser, 'Bob Multiplayer E2E', 'bob-e2e', 'Bob')

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

    await alice.page.waitForTimeout(300)
    const authoritativeX = (await snapshot(alice.page)).pose.feetPosition.x
    await callQa<GameplaySnapshot>(alice.page, 'gameplay.setMultiplayerInvalidPose')
    await expect(alice.page.locator('#multiplayer-status')).toContainText('corrected')
    await expect.poll(async () => Math.abs(
      (await snapshot(alice.page)).pose.feetPosition.x - authoritativeX,
    )).toBeLessThan(2)
    await alice.page.waitForTimeout(300)
    expect(Math.abs((await snapshot(alice.page)).pose.feetPosition.x - authoritativeX)).toBeLessThan(2)

    await expectOutOfBoundsPlacementRejection(revisionBeforePlace + 1)
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '2')
    expect(await canvasRevision(alice.page)).toBe(revisionBeforePlace + 1)

    await bob.page.close()
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '1')

    const reconnectedBob = await bob.context.newPage()
    await connectPage(reconnectedBob, bob.url)
    await expect(aliceCanvas).toHaveAttribute('data-multiplayer-player-count', '2')
    await expect(reconnectedBob.locator('#game-canvas')).toHaveAttribute(
      'data-multiplayer-player-count',
      '2',
    )
    await expect.poll(() => canvasRevision(reconnectedBob)).toBe(revisionBeforePlace + 1)
    await expect.poll(async () => (await snapshot(reconnectedBob)).ignitionTarget.block).toBe(
      placedBlock,
    )
  } finally {
    await Promise.all([alice.context.close(), bob.context.close()])
  }
})
