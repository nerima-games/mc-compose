import { expect, test, type ConsoleMessage, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'

const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

type AudioReport = {
  readonly availability: string
  readonly contextState: string | null
  readonly unlockAttempts: number
  readonly activeTones: number
}

type AudioSnapshot = {
  readonly cueIds: ReadonlyArray<string>
  readonly captions: ReadonlyArray<{
    readonly cueId: string
    readonly reason: string
  }>
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
        | Record<string, () => unknown>
        | undefined
      const operation = surface?.[commandName]
      if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
      return await operation()
    },
    { key: QA_GLOBAL_KEY, commandName: command },
  ) as Promise<A>

test('unlocks Web Audio and schedules a player-hurt node from a game event', async ({ page }) => {
  const faults = watchForFaults(page)
  await startGameSession(page)

  await page.locator('canvas').click({ position: { x: 8, y: 8 } })
  await expect.poll(async () => callQa<AudioReport>(page, 'audio.report')).toMatchObject({
    availability: 'ready',
    contextState: 'running',
    unlockAttempts: 1,
  })

  const result = await page.evaluate(({ key }) => {
    const surface = (globalThis as unknown as Record<string, unknown>)[key] as Record<
      string,
      () => unknown
    >
    surface['gameplay.damage']?.()
    return {
      report: surface['audio.report']?.(),
      snapshot: surface['audio.snapshot']?.(),
    }
  }, { key: QA_GLOBAL_KEY }) as { readonly report: AudioReport; readonly snapshot: AudioSnapshot }

  expect(result.report.activeTones).toBeGreaterThan(0)
  expect(result.snapshot.cueIds).toContain('playerHurt')
  expect(result.snapshot.captions).toContainEqual(expect.objectContaining({
    cueId: 'playerHurt',
    reason: 'audible',
  }))
  expect(faults).toEqual({ consoleErrors: [], pageErrors: [] })
})
