/** Browser runtime lifecycle wiring around the existing stage composition. */
import { Effect, Either, Ref } from 'effect'
import {
  composeGame,
  type ComposeOptions,
  type ComposedGame,
  type GameModule,
} from './composition'
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
  readonly start: Effect.Effect<GameModule, unknown>
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
  Effect.gen(function* () {
    const failures: Array<BrowserRuntimeStopFailure> = []

    for (const runtime of [...runtimes].reverse()) {
      yield* Effect.match(runtime.stop, {
        onFailure: (cause) => {
          failures.push({ moduleName: runtime.name, cause })
        },
        onSuccess: () => undefined,
      })
    }

    return failures
  })

/**
 * Starts injected sibling runtimes in declaration order and composes their
 * registered stages into a playable session.
 */
export const startBrowserSession = (
  runtimes: ReadonlyArray<BrowserRuntimeModule>,
  options: StartBrowserSessionOptions = {},
): Effect.Effect<BrowserSession, BrowserSessionStartError> =>
  Effect.suspend(() => {
    const started: Array<BrowserRuntimeModule> = []

    return Effect.flatMap(Ref.make(false), (rolledBack) => {
      const rollback = Effect.uninterruptible(
        Effect.flatMap(Ref.getAndSet(rolledBack, true), (alreadyRolledBack) =>
          alreadyRolledBack ? Effect.succeed([]) : stopRuntimes(started),
        ),
      )
      const rollbackAndFail = (
        error: Omit<BrowserSessionStartError, 'rollbackFailures'>,
      ): Effect.Effect<never, BrowserSessionStartError> =>
        Effect.flatMap(rollback, (rollbackFailures) =>
          Effect.fail({ ...error, rollbackFailures }),
        )

      return Effect.gen(function* () {
        const modules: Array<GameModule> = []

        for (const runtime of runtimes) {
          const result = yield* Effect.either(runtime.start)
          if (Either.isLeft(result)) {
            return yield* rollbackAndFail({
              _tag: 'BrowserSessionStartError',
              phase: 'start',
              moduleName: runtime.name,
              cause: result.left,
            })
          }

          started.push(runtime)
          modules.push(result.right)
        }

        const composed = composeGame(modules, options.compose)
        if (Either.isLeft(composed)) {
          return yield* rollbackAndFail({
            _tag: 'BrowserSessionStartError',
            phase: 'compose',
            moduleName: undefined,
            cause: composed.left,
          })
        }

        const stopped = yield* Ref.make(false)
        const stop = Effect.gen(function* () {
          if (yield* Ref.getAndSet(stopped, true)) return

          const failures = yield* stopRuntimes(started)
          if (failures.length > 0) {
            return yield* Effect.fail({
              _tag: 'BrowserSessionStopError' as const,
              failures,
            })
          }
        })

        return { game: composed.right, stop }
      }).pipe(Effect.onInterrupt(() => Effect.asVoid(rollback)))
    })
  })
