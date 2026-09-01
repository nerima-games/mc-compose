import { expect, test, type Page } from '@playwright/test'

import { startGameSession } from './helpers/session'
import { waitForSimulationProgress } from './helpers/simulation-wait'

type LampTransitionRecord = {
  readonly lit: boolean
  readonly writtenBlock: number | null
}

type RedstoneSnapshot = {
  button: number | null
  repeater: number | null
  lamp: number | null
  door: number | null
  poweredRail: boolean
  dispenser: number | null
  hopper: number | null
  observer: number | null
  observerLamp: number | null
  observerLampTransitions: ReadonlyArray<LampTransitionRecord>
  comparator: number | null
  trigger: string | null
}

const callQa = async <Result>(page: Page, command: string): Promise<Result> =>
  page.evaluate((commandName) => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return operation() as Result
  }, command)

const useTargetedBlock = async (page: Page): Promise<void> => {
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(50)
  await page.mouse.up({ button: 'right' })
}

const readRedstoneSnapshot = (
  page: Page,
): Promise<{ frames: number; value: RedstoneSnapshot }> =>
  page.evaluate((commandName) => {
    const qa = (globalThis as unknown as Record<string, unknown>)['__NERIMA_GAMES_QA__'] as
      | Record<string, () => unknown>
      | undefined
    const operation = qa?.[commandName]
    if (operation === undefined) throw new Error(`missing QA command: ${commandName}`)
    return {
      frames: Number(document.body.getAttribute('data-frames')),
      value: operation() as RedstoneSnapshot,
    }
  }, 'gameplay.redstoneFixturesSnapshot')

test('redstone components place, activate, tick, and emit host transitions', async ({ page }) => {
  await startGameSession(page, 'redstone-components-e2e')
  await expect(page.locator('body')).toHaveAttribute('data-mc-compose-boot', 'running')
  const initial = await callQa<RedstoneSnapshot>(page, 'gameplay.seedRedstoneFixtures')
  expect(initial).toMatchObject({
    button: 77,
    repeater: 78,
    lamp: 79,
    door: 106,
    poweredRail: false,
    dispenser: 83,
    hopper: 84,
    observer: 81,
    observerLamp: 79,
    comparator: 82,
  })

  const canvas = page.locator('#game-canvas')
  await canvas.hover()
  await page.evaluate(() => {
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get: () => document.querySelector('#game-canvas'),
    })
    document.dispatchEvent(new Event('pointerlockchange'))
  })
  await useTargetedBlock(page)
  // Redstone tick propagation is simulated-time-gated, same as the fishing
  // bite window — see waitForSimulationProgress.
  await waitForSimulationProgress(
    page,
    () => readRedstoneSnapshot(page),
    (snapshot) => snapshot.lamp === 80,
    { description: 'redstone lamp pulse' },
  )

  await callQa(page, 'gameplay.pressRedstoneBranchButton')
  await waitForSimulationProgress(
    page,
    () => readRedstoneSnapshot(page),
    (snapshot) => snapshot.door === 107 && snapshot.poweredRail,
    { description: 'redstone branch button (door + powered rail)' },
  )
  expect((await callQa<RedstoneSnapshot>(page, 'gameplay.redstoneFixturesSnapshot')).trigger)
    .toContain('dispenser:')

  await callQa(page, 'gameplay.mutateObserverInput')
  // Two separate problems meet at this assertion, and it needs both fixes.
  //
  // The observer's pulse is deliberately two redstone ticks — vanilla-accurate,
  // not a bug — so the lit block state is transient by design, and a poll of the
  // live value can step over it entirely while the circuit works perfectly. So
  // the subject is the durable transition record the host already keeps: a
  // recorded transition cannot be un-recorded, so a slow poll cannot miss it.
  //
  // And the wait is bounded by simulation progress rather than wall-clock,
  // because under contention the frame rate collapses and each frame's simulated
  // delta is clamped, so simulated time runs at a fraction of real time and any
  // real-time budget expires while the game is merely slow.
  await waitForSimulationProgress(
    page,
    () => readRedstoneSnapshot(page),
    (snapshot) => snapshot.observerLampTransitions.some((transition) => transition.lit),
    { description: 'redstone observer lamp pulse' },
  )

  // A distinct claim from the one above: the transition record proves the lit
  // event fired, and this proves the write landed in the block a player would
  // see. It reads the host's read-after-write confirmation rather than sampling
  // live state again, so it stays true after the pulse expires.
  const { value: afterPulse } = await readRedstoneSnapshot(page)
  expect(afterPulse.observerLampTransitions).toContainEqual(
    expect.objectContaining({ lit: true, writtenBlock: 80 }),
  )
})
