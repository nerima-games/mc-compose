import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Option } from 'effect'
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
  Either.getOrThrow(buildQaRegistry(namespaces))

const failure = (
  result: Either.Either<QaRegistry, QaApiError>,
): QaApiError | undefined => Option.getOrUndefined(Either.getLeft(result))

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
  // REGRESSION: last-one-wins shadowing gives an E2E suite that calls a
  // shadowed command, tests the wrong module, and PASSES. Given that E2E is the
  // final gate (plan.md §3.15), a silently wrong gate is worse than no gate.
  it.effect('rejects the same command contributed twice under one namespace', () =>
    Effect.sync(() => {
      const error = failure(
        buildQaRegistry([namespace('gameplay', 'breakBlock'), namespace('gameplay', 'breakBlock')]),
      )
      // The duplicate namespace is caught first, which is the more actionable
      // message; either way it does not silently merge.
      expect(error?._tag).toBe('DuplicateNamespace')
    }),
  )

  it.effect('rejects two modules claiming the same namespace', () =>
    Effect.sync(() => {
      const error = failure(buildQaRegistry([namespace('ui', 'openMenu'), namespace('ui', 'closeMenu')]))
      expect(error?._tag).toBe('DuplicateNamespace')
      expect(error?._tag === 'DuplicateNamespace' ? error.namespace : undefined).toBe('ui')
    }),
  )

  it.effect('explains a duplicate command in terms of what it would break', () =>
    Effect.sync(() => {
      const message = describeQaApiError({ _tag: 'DuplicateCommand', key: 'gameplay.breakBlock' })
      expect(message).toContain('tests the wrong module and passes')
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
        Either.isRight(
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
