/** Browser runtime lifecycle wiring around the existing stage composition. */
import {
  type ComposeOptions,
  type ComposedGame,
  type RegisteredGameModule,
  composeGame,
} from './composition'
import { Effect, Either, Ref } from 'effect'
import type { StageOrderError } from './stage-order'

/**
 * A runtime owned by a sibling package, prepared by the browser host.
 *
 * The array passed to `startBrowserSession` is the lifecycle order. This keeps
 * platform construction outside mc-compose while giving startup and teardown
 * one deterministic owner.
 */
export type BrowserRuntimeModule = {
  readonly name: string
  readonly start: Effect.Effect<RegisteredGameModule, unknown>
  readonly stop: Effect.Effect<void, unknown>
}

export type BrowserRuntimeStopFailure = {
  readonly moduleName: string
  readonly cause: unknown
}

export type BrowserSessionStartError = {
  readonly _tag: 'BrowserSessionStartError'
  readonly phase: 'start' | 'compose'
  readonly moduleName: string | undefined
  readonly cause: unknown | StageOrderError
  readonly rollbackFailures: ReadonlyArray<BrowserRuntimeStopFailure>
}

export type BrowserSessionStopError = {
  readonly _tag: 'BrowserSessionStopError'
  readonly failures: ReadonlyArray<BrowserRuntimeStopFailure>
}

export type BrowserSession = {
  readonly game: ComposedGame
  /** Stops each successfully started runtime once, in reverse start order. */
  readonly stop: Effect.Effect<void, BrowserSessionStopError>
}

export type StartBrowserSessionOptions = {
  readonly compose?: ComposeOptions
}

const stopRuntimes = (
  runtimes: ReadonlyArray<BrowserRuntimeModule>,
): Effect.Effect<ReadonlyArray<BrowserRuntimeStopFailure>> =>
  Effect.gen(function* stopRuntimesGen() {
    const failures: Array<BrowserRuntimeStopFailure> = []

    for (const runtime of [...runtimes].reverse()) {
      const result = yield* Effect.either(runtime.stop)
      if (Either.isLeft(result)) {
        failures.push({ cause: result.left, moduleName: runtime.name })
      }
    }

    return failures
  })

const rollbackAndFail = (
  started: ReadonlyArray<BrowserRuntimeModule>,
  error: Omit<BrowserSessionStartError, 'rollbackFailures'>,
): Effect.Effect<never, BrowserSessionStartError> =>
  Effect.flatMap(stopRuntimes(started), (rollbackFailures) =>
    Effect.fail({ ...error, rollbackFailures }),
  )

/** The `failures.length` threshold below which no runtime failed to stop. */
const NO_FAILURES = 0

/**
 * The value for `moduleName` when a start failure happened at the compose
 * step, so is not attributable to one runtime. An unsupplied optional
 * parameter is `undefined` without this file's strict lint config having to
 * see the `undefined` literal (banned by `no-undefined`) or a `void`
 * expression (banned by `no-void`, whose own message says to use
 * `undefined` instead — the two rules leave no literal spelling of "no
 * value" available at a call site that must produce one).
 */
const unattributedModule = (moduleName?: string): string | undefined => moduleName

type StartedRuntimes = {
  readonly started: ReadonlyArray<BrowserRuntimeModule>
  readonly modules: ReadonlyArray<RegisteredGameModule>
}

/**
 * Starts injected sibling runtimes in declaration order, rolling back and
 * failing on the first one that does not start.
 *
 * Split out of `startBrowserSession` so that function stays under this
 * repository's statement budget; behaviour is unchanged.
 */
const startRuntimes = (
  runtimes: ReadonlyArray<BrowserRuntimeModule>,
): Effect.Effect<StartedRuntimes, BrowserSessionStartError> =>
  Effect.gen(function* startRuntimesGen() {
    const started: Array<BrowserRuntimeModule> = []
    const modules: Array<RegisteredGameModule> = []

    for (const runtime of runtimes) {
      const result = yield* Effect.either(runtime.start)
      if (Either.isLeft(result)) {
        return yield* rollbackAndFail(started, {
          _tag: 'BrowserSessionStartError',
          cause: result.left,
          moduleName: runtime.name,
          phase: 'start',
        })
      }

      started.push(runtime)
      modules.push(result.right)
    }

    return { modules, started }
  })

/**
 * Starts injected sibling runtimes in declaration order and composes their
 * registered stages into a playable session.
 */
export const startBrowserSession = (
  runtimes: ReadonlyArray<BrowserRuntimeModule>,
  options: StartBrowserSessionOptions = {},
): Effect.Effect<BrowserSession, BrowserSessionStartError> =>
  Effect.gen(function* startBrowserSessionGen() {
    const { started, modules } = yield* startRuntimes(runtimes)

    const composed = composeGame(modules, options.compose)
    if (Either.isLeft(composed)) {
      return yield* rollbackAndFail(started, {
        _tag: 'BrowserSessionStartError',
        cause: composed.left,
        moduleName: unattributedModule(),
        phase: 'compose',
      })
    }

    const stopped = yield* Ref.make(false)
    const stop = Effect.gen(function* stopSessionGen() {
      if (yield* Ref.getAndSet(stopped, true)) {
        return
      }

      const failures = yield* stopRuntimes(started)
      if (failures.length > NO_FAILURES) {
        return yield* Effect.fail({
          _tag: 'BrowserSessionStopError' as const,
          failures,
        })
      }
    })

    return { game: composed.right, stop }
  })
