import { describe, expect, it } from '@effect/vitest'
import { Deferred, Effect, Fiber, Result } from 'effect'
import {
  EMPTY_MODULE_LAYER,
  StageId,
  startBrowserSession,
  type BrowserRuntimeModule,
  type GameModule,
} from '../src/index'

const gameModule = (name: string, stageId = name): GameModule => ({
  name,
  layers: EMPTY_MODULE_LAYER,
  frameStages: [{ id: StageId(stageId), run: () => Effect.void }],
})

const runtime = (
  name: string,
  log: Array<string>,
  options: { readonly startError?: string; readonly stopError?: string } = {},
): BrowserRuntimeModule => ({
  name,
  start: Effect.gen(function* () {
    log.push(`start:${name}`)
    if (options.startError !== undefined) yield* Effect.fail(options.startError)
    return gameModule(name)
  }),
  stop: Effect.gen(function* () {
    log.push(`stop:${name}`)
    if (options.stopError !== undefined) yield* Effect.fail(options.stopError)
  }),
})

describe('startBrowserSession', () => {
  it.effect('starts in declaration order and stops once in reverse order', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const session = yield* startBrowserSession([
        runtime('sim', log),
        runtime('render', log),
        runtime('ui', log),
      ], { compose: { skeleton: [] } })

      expect(session.game.moduleNames).toStrictEqual(['sim', 'render', 'ui'])
      expect(log).toStrictEqual(['start:sim', 'start:render', 'start:ui'])

      yield* session.stop
      yield* session.stop
      expect(log).toStrictEqual([
        'start:sim',
        'start:render',
        'start:ui',
        'stop:ui',
        'stop:render',
        'stop:sim',
      ])
    }),
  )

  it.effect('rolls back successful starts when a later runtime fails', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const result = yield* Effect.result(startBrowserSession([
        runtime('sim', log),
        runtime('render', log, { startError: 'no-webgl' }),
        runtime('ui', log),
      ]))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isSuccess(result)) return
      expect(result.failure).toMatchObject({
        phase: 'start',
        moduleName: 'render',
        cause: 'no-webgl',
        rollbackFailures: [],
      })
      expect(log).toStrictEqual(['start:sim', 'start:render', 'stop:sim'])
    }),
  )

  it.effect('rolls back successful starts when a later runtime is interrupted', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const entered = yield* Deferred.make<void>()
      const waitForInterrupt = yield* Deferred.make<GameModule>()
      const blockedRuntime: BrowserRuntimeModule = {
        name: 'render',
        start: Effect.gen(function* () {
          log.push('start:render')
          yield* Deferred.succeed(entered, undefined)
          return yield* Deferred.await(waitForInterrupt)
        }),
        stop: Effect.sync(() => {
          log.push('stop:render')
        }),
      }
      const fiber = yield* Effect.forkChild(startBrowserSession([
        runtime('sim', log),
        blockedRuntime,
      ], { compose: { skeleton: [] } }))

      yield* Deferred.await(entered)
      yield* Fiber.interrupt(fiber)

      expect(log).toStrictEqual(['start:sim', 'start:render', 'stop:sim'])
    }),
  )

  it.effect('does not repeat rollback when startup failure is interrupted during rollback', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const stopEntered = yield* Deferred.make<void>()
      const releaseStop = yield* Deferred.make<void>()
      const rollbackRuntime: BrowserRuntimeModule = {
        name: 'sim',
        start: Effect.sync(() => {
          log.push('start:sim')
          return gameModule('sim')
        }),
        stop: Effect.gen(function* () {
          log.push('stop:sim')
          yield* Deferred.succeed(stopEntered, undefined)
          yield* Deferred.await(releaseStop)
        }),
      }
      const fiber = yield* Effect.forkChild(startBrowserSession([
        rollbackRuntime,
        runtime('render', log, { startError: 'no-render' }),
      ]))

      yield* Deferred.await(stopEntered)
      const interruptFiber = yield* Effect.forkChild(Fiber.interrupt(fiber))
      yield* Effect.yieldNow
      yield* Deferred.succeed(releaseStop, undefined)
      yield* Fiber.await(fiber)
      yield* Fiber.await(interruptFiber)

      expect(log).toStrictEqual(['start:sim', 'start:render', 'stop:sim'])
    }),
  )

  it.effect('rolls back all runtimes when stage composition fails', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const duplicate = (name: string): BrowserRuntimeModule => ({
        name,
        start: Effect.sync(() => {
          log.push(`start:${name}`)
          return gameModule(name, 'duplicate')
        }),
        stop: Effect.sync(() => {
          log.push(`stop:${name}`)
        }),
      })
      const result = yield* Effect.result(startBrowserSession([
        duplicate('sim'),
        duplicate('render'),
      ]))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isSuccess(result)) return
      expect(result.failure.phase).toBe('compose')
      expect(result.failure.rollbackFailures).toStrictEqual([])
      expect(log).toStrictEqual(['start:sim', 'start:render', 'stop:render', 'stop:sim'])
    }),
  )

  it.effect('attempts every stop and reports all failures', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const session = yield* startBrowserSession([
        runtime('sim', log, { stopError: 'sim-stop' }),
        runtime('render', log),
        runtime('ui', log, { stopError: 'ui-stop' }),
      ], { compose: { skeleton: [] } })
      const result = yield* Effect.result(session.stop)

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isSuccess(result)) return
      expect(result.failure.failures).toStrictEqual([
        { moduleName: 'ui', cause: 'ui-stop' },
        { moduleName: 'sim', cause: 'sim-stop' },
      ])
      expect(log.slice(-3)).toStrictEqual(['stop:ui', 'stop:render', 'stop:sim'])

      yield* session.stop
      expect(log.filter((entry) => entry.startsWith('stop:'))).toHaveLength(3)
    }),
  )

  it.effect('preserves rollback failures alongside the startup cause', () =>
    Effect.gen(function* () {
      const log: Array<string> = []
      const result = yield* Effect.result(startBrowserSession([
        runtime('sim', log, { stopError: 'rollback-failed' }),
        runtime('render', log, { startError: 'start-failed' }),
      ]))

      expect(Result.isFailure(result)).toBe(true)
      if (Result.isSuccess(result)) return
      expect(result.failure.cause).toBe('start-failed')
      expect(result.failure.rollbackFailures).toStrictEqual([
        { moduleName: 'sim', cause: 'rollback-failed' },
      ])
    }),
  )
})
