/**
 * The multiplayer server's implementation of mc-kernel's Clock Port.
 *
 * mc-kernel 0.5.1 made `FrameServices = ClockPort` (frame.ts), so every
 * `StageRegistration.run` this process invokes directly — not through
 * `apps/web/main.ts`'s `game.runFrameWith`, which already discharges its own
 * `BrowserClockLayer` — now needs a `ClockPort` provided at the call site.
 * `redstone-runtime.ts` is that call site on the server.
 *
 * `performance.now()`, not `Date.now()`, for the monotonic reading: Node
 * exposes the same global `performance` a browser does, and the wall clock
 * can step backwards across an NTP correction, which a monotonic simulation
 * reading must never do.
 */
import { Effect, Layer } from 'effect'
import {
  ClockPort,
  EpochMillis,
  MonotonicTimeSecs,
  type ClockService,
} from '@nerima-games/mc-kernel'

export const serverClock: ClockService = {
  monotonicSecs: Effect.sync(() => MonotonicTimeSecs(performance.now() / 1000)), // mc-kernel-allow-time-source
  wallClockEpochMillis: Effect.sync(() => EpochMillis(Date.now())), // mc-kernel-allow-time-source
}

export const ServerClockLayer: Layer.Layer<ClockPort> = Layer.succeed(ClockPort, serverClock)
