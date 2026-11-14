import { describe, expect, it } from '@effect/vitest'
import {
  QaNamespaceNameSchema,
  QaOperationNameSchema,
  type QaNamespace as KernelQaNamespace,
} from '@nerima-games/mc-kernel'
import { Effect, Option, Result, Schema } from 'effect'
import * as fc from 'fast-check'
import { composeGame, EMPTY_MODULE_LAYER } from '../src/domain/composition'
import {
  buildQaRegistry,
  describeQaApiError,
  installQaApi,
  QA_GLOBAL_KEY,
  qaKey,
  readInstalledQaApi,
  type QaApiError,
  type QaNamespace,
  type QaRegistry,
} from '../src/domain/qa-api'

const noop = (): unknown => undefined

const namespace = (name: string, ...commands: ReadonlyArray<string>): QaNamespace => ({
  namespace: name,
  commands: Object.fromEntries(commands.map((command) => [command, noop])),
})

const registryOf = (namespaces: ReadonlyArray<QaNamespace>): QaRegistry =>
  Result.getOrThrow(buildQaRegistry(namespaces))

const failure = (
  result: Result.Result<QaRegistry, QaApiError>,
): QaApiError | undefined => Option.getOrUndefined(Result.getFailure(result))

const namespaceName = (value: string) => Schema.decodeUnknownSync(QaNamespaceNameSchema)(value)

const operationName = (value: string) => Schema.decodeUnknownSync(QaOperationNameSchema)(value)

const moduleWithQa = <const Qa extends KernelQaNamespace>(qa: Qa) => ({
  name: 'qa-test-module',
  layers: EMPTY_MODULE_LAYER,
  frameStages: [],
  qa,
})

const failedValue = <A, E>(result: Result.Result<A, E>): E | undefined =>
  Option.getOrUndefined(Result.getFailure(result))

describe('building the QA surface', () => {
  it.effect('publishes each command under namespace.command', () =>
    Effect.sync(() => {
      const registry = registryOf([
        namespace('gameplay', 'breakBlock', 'placeBlock'),
        namespace('redstone', 'setPower'),
      ])

      expect([...registry.keys()].sort()).toStrictEqual([
        'gameplay.breakBlock',
        'gameplay.placeBlock',
        'redstone.setPower',
      ])
    }),
  )

  it.effect('accepts an empty contribution set', () =>
    Effect.sync(() => {
      expect([...registryOf([]).keys()]).toStrictEqual([])
      expect([...registryOf([namespace('gameplay')]).keys()]).toStrictEqual([])
    }),
  )

  it.effect('accepts a dotted sub-namespace for a concern within a module', () =>
    Effect.sync(() => {
      expect([...registryOf([namespace('gameplay.fluids', 'flood')]).keys()]).toStrictEqual([
        'gameplay.fluids.flood',
      ])
    }),
  )

  it.effect('composes the published key the same way callers do', () =>
    Effect.sync(() => {
      expect(qaKey('gameplay', 'breakBlock')).toBe('gameplay.breakBlock')
    }),
  )
})

describe('name collisions are fatal', () => {
  it.effect('rejects two modules claiming the same namespace', () =>
    Effect.sync(() => {
      const error = failure(buildQaRegistry([namespace('ui', 'openMenu'), namespace('ui', 'closeMenu')]))
      expect(error?._tag).toBe('DuplicateNamespace')
      expect(error?._tag === 'DuplicateNamespace' ? error.namespace : undefined).toBe('ui')
    }),
  )

})

describe('describeQaApiError', () => {
  it.effect('explains an invalid namespace', () =>
    Effect.sync(() => {
      const message = describeQaApiError({ _tag: 'InvalidNamespace', namespace: 'Gameplay' })
      expect(message).toContain('"Gameplay"')
      expect(message).toContain('lowercase kebab/dot segments')
    }),
  )

  it.effect('explains an invalid command name', () =>
    Effect.sync(() => {
      const message = describeQaApiError({
        _tag: 'InvalidCommandName',
        namespace: 'gameplay',
        command: 'BreakBlock',
      })
      expect(message).toContain('"BreakBlock"')
      expect(message).toContain('namespace "gameplay"')
      expect(message).toContain('lowerCamelCase')
    }),
  )

  it.effect('explains a duplicate namespace', () =>
    Effect.sync(() => {
      const message = describeQaApiError({ _tag: 'DuplicateNamespace', namespace: 'ui' })
      expect(message).toContain('"ui"')
      expect(message).toContain('contributed twice')
    }),
  )

  // Defensive fallback: `QaApiError` is exhaustively typed, but a value
  // reaching this function at runtime is not guaranteed to have been produced
  // by `buildQaRegistry` itself.
  it.effect('describes an unrecognised error tag rather than throwing', () =>
    Effect.sync(() => {
      const bogus = { _tag: 'SomethingNew' } as unknown as QaApiError
      expect(describeQaApiError(bogus)).toContain('unknown QA API error')
    }),
  )
})

describe('name shape', () => {
  it.effect('rejects a namespace that is not lowercase kebab/dot segments', () =>
    Effect.sync(() => {
      for (const bad of ['Gameplay', 'game play', '', '.gameplay', 'gameplay.', '1gameplay', 'game_play']) {
        expect(failure(buildQaRegistry([namespace(bad, 'doThing')]))?._tag).toBe('InvalidNamespace')
      }
    }),
  )

  it.effect('rejects a command name that is not lowerCamelCase', () =>
    Effect.sync(() => {
      for (const bad of ['BreakBlock', 'break-block', 'break block', '', '_private']) {
        expect(failure(buildQaRegistry([namespace('gameplay', bad)]))?._tag).toBe('InvalidCommandName')
      }
    }),
  )

  it.effect('accepts the shapes modules are expected to use', () =>
    Effect.sync(() => {
      expect(
        Result.isSuccess(
          buildQaRegistry([
            namespace('gameplay', 'breakBlock', 'giveItem2'),
            namespace('mx-ui', 'openInventory'),
            namespace('gameplay.mob-ai', 'spawnZombie'),
          ]),
        ),
      ).toBe(true)
    }),
  )
})

describe('installation', () => {
  // REGRESSION: nothing here touches globalThis. Reaching for it would pin the
  // repository to a platform (tsconfig.base.json: lib ES2024, types []) and
  // make the install path untestable without a DOM. The reference
  // implementation calls `Reflect.set(window, '__TS_MINECRAFT_QA__', ...)`
  // directly at packages/app/application/main/qa-api.ts:171.
  it.effect('publishes onto the target object it is given, not onto a global', () =>
    Effect.sync(() => {
      const target: Record<string, unknown> = {}
      installQaApi(target, registryOf([namespace('gameplay', 'breakBlock')]))

      expect(Object.keys(target)).toStrictEqual([QA_GLOBAL_KEY])
      expect(readInstalledQaApi(target)).toStrictEqual({ 'gameplay.breakBlock': expect.any(Function) })
    }),
  )

  it.effect('reports nothing installed on an untouched target', () =>
    Effect.sync(() => {
      expect(readInstalledQaApi({})).toBeUndefined()
    }),
  )

  it.effect('rejects malformed installed values at the runtime boundary', () =>
    Effect.sync(() => {
      const malformedTargets: ReadonlyArray<Readonly<Record<string, unknown>>> = [
        { [QA_GLOBAL_KEY]: null },
        { [QA_GLOBAL_KEY]: 'not-an-api' },
        { [QA_GLOBAL_KEY]: [] },
        { [QA_GLOBAL_KEY]: { 'gameplay.breakBlock': 'not-a-command' } },
      ]

      for (const target of malformedTargets) {
        expect(readInstalledQaApi(target)).toBeUndefined()
      }
    }),
  )

  // REGRESSION: handing out the live Map would let one E2E test mutate the
  // registry and leave the next test running against a surface the build never
  // produced.
  it.effect('publishes a detached snapshot, so a test cannot mutate the real registry', () =>
    Effect.sync(() => {
      const registry = registryOf([namespace('gameplay', 'breakBlock')])
      const target: Record<string, unknown> = {}
      installQaApi(target, registry)

      const published = readInstalledQaApi(target) as Record<string, unknown>
      published['gameplay.injected'] = noop
      delete published['gameplay.breakBlock']

      expect([...registry.keys()]).toStrictEqual(['gameplay.breakBlock'])
    }),
  )

  it.effect('uses a key that is not the reference implementation\'s, so a stale E2E build cannot pass', () =>
    Effect.sync(() => {
      expect(QA_GLOBAL_KEY).toBe('__NERIMA_GAMES_QA__')
      expect(QA_GLOBAL_KEY).not.toBe('__TS_MINECRAFT_QA__')
    }),
  )

  it.effect('installing an empty registry publishes an empty surface rather than nothing', () =>
    Effect.sync(() => {
      const target: Record<string, unknown> = {}
      installQaApi(target, registryOf([]))
      expect(readInstalledQaApi(target)).toStrictEqual({})
    }),
  )
})

describe('QaBridge', () => {
  it.effect('decodes JSON input, runs the namespaced operation, and encodes JSON output', () =>
    Effect.gen(function* () {
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({ block: Schema.String }),
        output: Schema.Struct({ exists: Schema.Boolean }),
        run: ({ block }: { readonly block: string }) => Effect.succeed({ exists: block === 'stone' }),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])

      const output = yield* game.qaBridge.run(qa.name, inspect.name, { block: 'stone' })

      expect(output).toStrictEqual({ exists: true })
    }),
  )

  it.effect('returns a typed SchemaError when input JSON does not decode', () =>
    Effect.gen(function* () {
      const calls = yield* Effect.sync(() => ({ count: 0 }))
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({ block: Schema.String }),
        output: Schema.Boolean,
        run: () =>
          Effect.sync(() => {
            calls.count += 1
            return true
          }),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const result = yield* Effect.result(game.qaBridge.run(qa.name, inspect.name, { block: 4 }))

      expect(failedValue(result)?._tag).toBe('SchemaError')
      expect(calls.count).toBe(0)
    }),
  )

  it.effect('returns a typed SchemaError when the output cannot be encoded', () =>
    Effect.gen(function* () {
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({}),
        output: Schema.Finite,
        run: () => Effect.succeed(Number.NaN),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const result = yield* Effect.result(game.qaBridge.run(qa.name, inspect.name, {}))

      expect(failedValue(result)?._tag).toBe('SchemaError')
    }),
  )

  it.effect('returns QaOperationNotFound for a namespace operation that was not registered', () =>
    Effect.gen(function* () {
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({}),
        output: Schema.Boolean,
        run: () => Effect.succeed(true),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const result = yield* Effect.result(game.qaBridge.run(qa.name, operationName('missing'), {}))

      expect(failedValue(result)?._tag).toBe('QaOperationNotFound')
    }),
  )

  it.effect('returns QaOperationNotFound for an unknown namespace with a known operation name', () =>
    Effect.gen(function* () {
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({}),
        output: Schema.Boolean,
        run: () => Effect.succeed(true),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const result = yield* Effect.result(game.qaBridge.run(namespaceName('unknown'), inspect.name, {}))

      expect(failedValue(result)?._tag).toBe('QaOperationNotFound')
    }),
  )

  it.effect('preserves the registered operation error without wrapping it', () =>
    Effect.gen(function* () {
      const expected = { _tag: 'QaOperationRejected', reason: 'occupied' } as const
      const inspect = {
        name: operationName('inspect'),
        input: Schema.Struct({}),
        output: Schema.Boolean,
        run: () => Effect.fail(expected),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const result = yield* Effect.result(game.qaBridge.run(qa.name, inspect.name, {}))

      expect(failedValue(result)).toStrictEqual(expected)
    }),
  )

  it.effect('keeps the existing flat QA output while returning the same JSON from an empty-input operation', () =>
    Effect.gen(function* () {
      const expected = { active: true, blocks: ['stone', 'dirt'] }
      const legacy = registryOf([
        {
          namespace: 'gameplay',
          commands: { inspect: () => expected },
        },
      ])
      const operation = {
        name: operationName('inspect'),
        input: Schema.Struct({}),
        output: Schema.Json,
        run: () => Effect.succeed(expected),
      }
      const qa = {
        name: namespaceName('gameplay'),
        observe: { inspect: operation },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])
      const newOutput = yield* game.qaBridge.run(qa.name, operation.name, {})
      const oldOutput = legacy.get(qaKey('gameplay', 'inspect'))?.()

      expect(oldOutput).toStrictEqual({ active: true, blocks: ['stone', 'dirt'] })
      expect(newOutput).toStrictEqual({ active: true, blocks: ['stone', 'dirt'] })
      expect(JSON.stringify(newOutput)).toBe(JSON.stringify(oldOutput))
    }),
  )

  it.effect('round-trips arbitrary JSON values through the namespaced JSON boundary', () =>
    Effect.gen(function* () {
      const roundTrip = {
        name: operationName('roundTrip'),
        input: Schema.Json,
        output: Schema.Json,
        run: (value: Schema.Json) => Effect.succeed(value),
      }
      const qa = {
        name: namespaceName('test'),
        observe: { roundTrip },
        command: {},
      }
      const game = yield* composeGame([moduleWithQa(qa)])

      fc.assert(
        fc.property(fc.jsonValue(), (input) => {
          const output = Effect.runSync(game.qaBridge.run(qa.name, roundTrip.name, input))
          expect(output).toStrictEqual(input)
          return true
        }),
      )
    }),
  )
})
