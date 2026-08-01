/**
 * The browser's implementation of mc-kernel's Clock Port.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * This is the one file in the repository allowed to read a real clock
 * ---------------------------------------------------------------------------
 *
 * plan.md §5.1-3 bans reading a global clock and `pnpm check:deps` rule 7
 * enforces it across `apps`, `index.ts`, `domain`, `scripts` and `test`. The
 * gate's own message names the single legitimate exception: "If this is the
 * adapter that implements the Port, mark the line with a
 * `mc-kernel-allow-time-source` comment." This is that adapter, and the marks
 * below are the only two in the repository.
 *
 * Confining it here is the whole point. Every stage in every module receives
 * time as `dt` or reads `ClockPort`, so a replay driven by `FixedClockLayer`
 * exercises the same code the browser does — which is what makes the E2E suite
 * able to blame the game rather than the schedule.
 *
 * `performance.now()` and NOT `Date.now()` for the monotonic reading: the wall
 * clock steps backwards across an NTP correction or a DST change, and a
 * negative `dt` reaches `DeltaTimeSecs`, whose refinement rejects it — a crash
 * at 02:00 on the last Sunday in October.
 */
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  EpochMillis,
  MonotonicTimeSecs,
  type ClockService,
} from '../../src/domain/kernel-vocabulary'

/**
 * `performance.now()` is milliseconds since the page's time origin; the Port is
 * in seconds. The origin is unspecified by the Port's contract, so the division
 * is the whole conversion — no epoch is added, and adding one would invite
 * somebody to subtract two monotonic readings taken in different tabs.
 */
export const browserClock: ClockService = {
  // The escape-hatch marker is checked PER LINE, so it sits on the line that
  // carries the reading rather than above it. Learned the hard way: the first
  // draft put both markers on the preceding comment line and `pnpm check:deps`
  // reported both readings, correctly.
  monotonicSecs: Effect.sync(() => MonotonicTimeSecs(performance.now() / 1000)), // mc-kernel-allow-time-source
  wallClockEpochMillis: Effect.sync(() => EpochMillis(Date.now())), // mc-kernel-allow-time-source
}

/**
 * The Layer `runFrameWith` discharges.
 *
 * `Layer.succeed` rather than `Layer.effect`: the service holds no state, so
 * building it twice would be harmless — but saying so with the constructor is
 * cheaper than making a reader check.
 */
export const BrowserClockLayer: Layer.Layer<ClockPort> = Layer.succeed(ClockPort, browserClock)
