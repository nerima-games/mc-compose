import { test, type Page } from '@playwright/test'

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
const DEFAULT_POLL_INTERVALS_MS: ReadonlyArray<number> = [50]

// A fixed default backstop equal to (or close to) the test's own wall-clock
// timeout races Playwright's generic "Test timeout exceeded" against this
// helper's own diagnostic error, and the generic one can win — found in
// practice on bow-projectile.e2e.ts, where the helper's 60_000ms default
// collided with playwright.config.ts's 60_000ms global test timeout and hid
// the "frames stalled" / "condition never became true" message behind a bare
// timeout with no useful detail. Deriving the default from the CURRENT
// test's own configured timeout (test.info().timeout, which reflects any
// test.setTimeout() call already made) keeps this helper's message ahead of
// Playwright's by a fixed margin automatically, for every caller, without
// requiring each call site to work out and set its own backstopMs.
const BACKSTOP_MARGIN_BEFORE_TEST_TIMEOUT_MS = 15_000
const MIN_BACKSTOP_MS = 5_000
const NO_TEST_TIMEOUT_FALLBACK_BACKSTOP_MS = 60_000

const defaultBackstopMs = (): number => {
  const testTimeoutMs = test.info().timeout
  // 0 is Playwright's convention for "no timeout" (e.g. an explicit
  // `test.setTimeout(0)`) — that disables the outer race entirely, but this
  // helper's own backstop against a true hang should still exist.
  if (testTimeoutMs <= 0) return NO_TEST_TIMEOUT_FALLBACK_BACKSTOP_MS
  return Math.max(MIN_BACKSTOP_MS, testTimeoutMs - BACKSTOP_MARGIN_BEFORE_TEST_TIMEOUT_MS)
}

export type SimulationRead<T> = { readonly frames: number; readonly value: T }

export type WaitForSimulationOptions = {
  readonly frameStallTimeoutMs?: number
  readonly backstopMs?: number
  /**
   * Cadence between reads, e.g. `[10, 20, 50]` to poll tightly at first and
   * back off — the last entry repeats once exhausted. Needed when a
   * transient state is narrow enough that the default 50ms cadence could
   * skip over it entirely (a projectile's brief 'flying' state before it
   * embeds, an observer's ~250ms redstone pulse). Defaults to a flat 50ms.
   */
  readonly pollIntervalsMs?: ReadonlyArray<number>
  readonly description: string
}

export const waitForSimulationProgress = async <T>(
  page: Page,
  read: () => Promise<SimulationRead<T>>,
  predicate: (value: T) => boolean,
  options: WaitForSimulationOptions,
): Promise<T> => {
  const frameStallTimeoutMs = options.frameStallTimeoutMs ?? DEFAULT_FRAME_STALL_TIMEOUT_MS
  const backstopMs = options.backstopMs ?? defaultBackstopMs()
  const pollIntervalsMs = options.pollIntervalsMs ?? DEFAULT_POLL_INTERVALS_MS
  const startedAt = Date.now()
  const deadline = startedAt + backstopMs

  let lastFrames = -1
  let lastFramesAdvancedAt = startedAt
  let lastValue: T | undefined
  let pollCount = 0

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

    const interval = pollIntervalsMs[Math.min(pollCount, pollIntervalsMs.length - 1)] ?? 50
    pollCount += 1
    await page.waitForTimeout(interval)
  }
}
