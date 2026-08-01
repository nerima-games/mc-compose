import { describe, expect, it } from '@effect/vitest'
import { Effect, Either } from 'effect'
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
      const result = yield* Effect.either(startBrowserSession([
        runtime('sim', log),
        runtime('render', log, { startError: 'no-webgl' }),
        runtime('ui', log),
      ]))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left).toMatchObject({
        phase: 'start',
        moduleName: 'render',
        cause: 'no-webgl',
        rollbackFailures: [],
      })
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
      const result = yield* Effect.either(startBrowserSession([
        duplicate('sim'),
        duplicate('render'),
      ]))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left.phase).toBe('compose')
      expect(result.left.rollbackFailures).toStrictEqual([])
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
      const result = yield* Effect.either(session.stop)

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left.failures).toStrictEqual([
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
      const result = yield* Effect.either(startBrowserSession([
        runtime('sim', log, { stopError: 'rollback-failed' }),
        runtime('render', log, { startError: 'start-failed' }),
      ]))

      expect(Either.isLeft(result)).toBe(true)
      if (Either.isRight(result)) return
      expect(result.left.cause).toBe('start-failed')
      expect(result.left.rollbackFailures).toStrictEqual([
        { moduleName: 'sim', cause: 'rollback-failed' },
      ])
    }),
  )
})
