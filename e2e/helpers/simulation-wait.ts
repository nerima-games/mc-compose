import type { Page } from '@playwright/test'

/**
 * `apps/web/main.ts` clamps every frame's simulated delta to `MAX_FRAME_SECS`
 * unconditionally, so N real frames can advance the simulation by at most
 * N * MAX_FRAME_SECS regardless of how long they took in wall-clock time.
 * Under host contention the frame rate collapses and simulated time falls
 * behind real time — measured stretching a ~215ms redstone pulse to
 * 770-900ms under load average 72-87 on a 16-core machine. A wall-clock
 * `expect.poll` timeout silently assumes simulated time is approximately
 * real time; that assumption is false exactly when the host is busy, and
 * whichever test is mid-wait during a load spike is the one that times out.
 *
 * This waits on the thing that is actually true regardless of host speed —
 * the simulation making progress toward the condition — rather than on a
 * wall-clock budget. The `data-frames` counter (already used by
 * `smoke.e2e.ts`) is read in the SAME round trip as the condition's value,
 * so there is no gap for the two to go stale against each other.
 *
 * A frame counter that stops advancing is a different failure — a real
 * hang, not slowness — and fails fast rather than waiting out the backstop.
 */

const DEFAULT_FRAME_STALL_TIMEOUT_MS = 5_000
const DEFAULT_BACKSTOP_MS = 60_000
const POLL_INTERVAL_MS = 50

export type SimulationRead<T> = { readonly frames: number; readonly value: T }

export type WaitForSimulationOptions = {
  readonly frameStallTimeoutMs?: number
  readonly backstopMs?: number
  readonly description: string
}

export const waitForSimulationProgress = async <T>(
  page: Page,
  read: () => Promise<SimulationRead<T>>,
  predicate: (value: T) => boolean,
  options: WaitForSimulationOptions,
): Promise<T> => {
  const frameStallTimeoutMs = options.frameStallTimeoutMs ?? DEFAULT_FRAME_STALL_TIMEOUT_MS
  const backstopMs = options.backstopMs ?? DEFAULT_BACKSTOP_MS
  const startedAt = Date.now()
  const deadline = startedAt + backstopMs

  let lastFrames = -1
  let lastFramesAdvancedAt = startedAt
  let lastValue: T | undefined

  for (;;) {
    const { frames, value } = await read()
    lastValue = value
    if (predicate(value)) return value

    const now = Date.now()
    if (frames !== lastFrames) {
      lastFrames = frames
      lastFramesAdvancedAt = now
    } else if (now - lastFramesAdvancedAt > frameStallTimeoutMs) {
      throw new Error(
        `${options.description}: frame counter stalled at ${String(frames)} for over `
        + `${String(frameStallTimeoutMs)}ms — the frame loop appears hung, not merely slow `
        + `(last value: ${JSON.stringify(lastValue)})`,
      )
    }

    if (now > deadline) {
      throw new Error(
        `${options.description}: exceeded the ${String(backstopMs)}ms real-time backstop while `
        + `the frame counter kept advancing (frames=${String(frames)}) — the condition never `
        + `became true (last value: ${JSON.stringify(lastValue)})`,
      )
    }

    await page.waitForTimeout(POLL_INTERVAL_MS)
  }
}
