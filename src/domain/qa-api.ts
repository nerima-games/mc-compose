/**
 * The QA / debug API surface.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this replaces
 * ---------------------------------------------------------------------------
 *
 * The reference implementation exposes a debug object on the window:
 *
 *   packages/app/application/main/qa-api.ts:171
 *     Reflect.set(window, '__TS_MINECRAFT_QA__', makeQaApi(deps, ...))
 *
 * Its QA surface is much larger than plan.md §3.15's "~1.4k" estimate. Measured
 * on 2026-07-26, all `qa-api*.ts` files plus `qa-spatial.ts` total **2,648
 * LOC** across 16 files (14 production + 2 test), split by concern:
 * qa-api-visual (181), qa-api-debug-state (179), qa-api (172),
 * qa-api-rendering (145), qa-api-world (121), qa-api-inventory (127),
 * qa-api-perf (105), qa-spatial (83), qa-api-combat (81), qa-api-mob-ai (51),
 * qa-api-redstone (49), qa-api-village (49), qa-api-env (33),
 * qa-api-settings (19).
 *
 * That size is the warning. A QA API is a place where "just one more accessor"
 * is always locally reasonable, and each accessor quietly grants the E2E suite
 * a private door into a module's internals — which is how the E2E suite becomes
 * the only thing that can verify anything.
 *
 * ---------------------------------------------------------------------------
 * The rule this file encodes
 * ---------------------------------------------------------------------------
 *
 * A QA command is NAMESPACED BY THE MODULE THAT OWNS IT, and mc-compose only
 * merges namespaces. compose does not author commands. If a QA command needs
 * to read mc-sim's inventory, mx-gameplay (or mc-sim) exposes it and compose
 * publishes it under that module's namespace. Writing the accessor here would
 * require compose to reach past the experience modules, which
 * `pnpm check:deps` rejects as `transitive-import` anyway.
 *
 * ---------------------------------------------------------------------------
 * Why nothing here touches `globalThis`
 * ---------------------------------------------------------------------------
 *
 * `installQaApi` takes the target object as an argument. Reaching for
 * `globalThis` or `window` would pin this repository to a platform (see
 * tsconfig.base.json: `lib: ["ES2024"]`, `types: []`) and would make the
 * install path untestable without a DOM. The browser entry point passes
 * `globalThis` in; a test passes a plain object.
 */
import { Either } from 'effect'

/**
 * The property name the QA API is published under.
 *
 * Renamed from the reference's `__TS_MINECRAFT_QA__` because the project is no
 * longer called ts-minecraft, and because an E2E suite pinned to the old name
 * would silently pass against a stale build.
 */
export const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'

/** A single debug entry point. Opaque to compose: it is neither called nor inspected. */
export type QaCommand = (...args: ReadonlyArray<never>) => unknown

/**
 * One module's QA commands.
 *
 * `namespace` must be a lowercase kebab-case identifier — usually the module's
 * repository suffix (`gameplay`, `redstone`, `ui`, `multiplayer`) or a concern
 * within it (`gameplay.fluids`). The published key is `namespace.command`.
 */
export type QaNamespace = {
  readonly namespace: string
  readonly commands: Readonly<Record<string, QaCommand>>
}

export type QaApiError =
  | { readonly _tag: 'InvalidNamespace'; readonly namespace: string }
  | { readonly _tag: 'InvalidCommandName'; readonly namespace: string; readonly command: string }
  | { readonly _tag: 'DuplicateNamespace'; readonly namespace: string }
  | { readonly _tag: 'DuplicateCommand'; readonly key: string }

/** The merged surface: fully-qualified key -> command. */
export type QaRegistry = ReadonlyMap<string, QaCommand>

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u
const COMMAND_PATTERN = /^[a-z][A-Za-z0-9]*$/u

export const qaKey = (namespace: string, command: string): string => `${namespace}.${command}`

/**
 * Merge module QA namespaces into one registry.
 *
 * Every failure mode is a NAME collision, and every one is fatal rather than
 * last-one-wins. A silently shadowed QA command produces an E2E suite that
 * tests the wrong module and passes.
 */
export const buildQaRegistry = (
  namespaces: ReadonlyArray<QaNamespace>,
): Either.Either<QaRegistry, QaApiError> => {
  const seenNamespaces = new Set<string>()
  const registry = new Map<string, QaCommand>()

  for (const entry of namespaces) {
    if (!NAMESPACE_PATTERN.test(entry.namespace)) {
      return Either.left({ _tag: 'InvalidNamespace', namespace: entry.namespace })
    }
    if (seenNamespaces.has(entry.namespace)) {
      return Either.left({ _tag: 'DuplicateNamespace', namespace: entry.namespace })
    }
    seenNamespaces.add(entry.namespace)

    for (const [command, run] of Object.entries(entry.commands)) {
      if (!COMMAND_PATTERN.test(command)) {
        return Either.left({ _tag: 'InvalidCommandName', namespace: entry.namespace, command })
      }
      const key = qaKey(entry.namespace, command)
      if (registry.has(key)) {
        return Either.left({ _tag: 'DuplicateCommand', key })
      }
      registry.set(key, run)
    }
  }

  return Either.right(registry)
}

/**
 * Publish a registry onto a target object under `QA_GLOBAL_KEY`.
 *
 * The target is an argument, not `globalThis`, so this is testable without a
 * platform and so a production build can decline to call it at all.
 *
 * The published value is a fresh plain object each time. Handing out the live
 * Map would let an E2E test mutate the registry and leave the next test running
 * against a surface the build never produced.
 */
export const installQaApi = (target: Record<string, unknown>, registry: QaRegistry): void => {
  target[QA_GLOBAL_KEY] = Object.fromEntries(registry)
}

/** Read back a published surface. Used by tests; mirrors what an E2E page does. */
export const readInstalledQaApi = (
  target: Readonly<Record<string, unknown>>,
): Readonly<Record<string, QaCommand>> | undefined => {
  const published = target[QA_GLOBAL_KEY]
  return published === undefined ? undefined : (published as Readonly<Record<string, QaCommand>>)
}

export const describeQaApiError = (error: QaApiError): string => {
  switch (error._tag) {
    case 'InvalidNamespace':
      return `"${error.namespace}" is not a valid QA namespace; use lowercase kebab/dot segments, e.g. "gameplay" or "gameplay.fluids".`
    case 'InvalidCommandName':
      return `"${error.command}" in namespace "${error.namespace}" is not a valid QA command name; use lowerCamelCase.`
    case 'DuplicateNamespace':
      return `the QA namespace "${error.namespace}" was contributed twice; each module owns exactly one.`
    case 'DuplicateCommand':
      return `the QA command "${error.key}" was contributed twice. Shadowing is rejected: an E2E test calling a shadowed command tests the wrong module and passes.`
  }
}
