/**
 * The QA / debug API surface.
 *
 * The browser host publishes this surface explicitly for Playwright and other
 * deterministic smoke checks. Each command is owned by a registered module;
 * mc-compose validates and merges the namespaces but does not reach into a
 * module's private state.
 *
 * A QA command is NAMESPACED BY THE MODULE THAT OWNS IT, and mc-compose only
 * merges namespaces. compose does not author commands. If a QA command needs
 * to read mc-sim's inventory, mx-gameplay (or mc-sim) exposes it and compose
 * publishes it under that module's namespace. Writing the accessor here would
 * require compose to reach past the experience modules, which the dependency
 * boundary enforced by `.oxlintrc.json` rejects as a transitive import.
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

/** The merged surface: fully-qualified key -> command. */
export type QaRegistry = ReadonlyMap<string, QaCommand>

const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u
const COMMAND_PATTERN = /^[a-z][A-Za-z0-9]*$/u

export const qaKey = (namespace: string, command: string): string => `${namespace}.${command}`

/**
 * Validate and merge one namespace entry's commands into the accumulating
 * registry. Split out of `mergeNamespaceEntry` so both functions stay under
 * this repository's statement budget; behaviour is unchanged — `registry` is
 * mutated exactly as it was when this was inline.
 */
const mergeCommands = (
  entry: QaNamespace,
  registry: Map<string, QaCommand>,
): QaApiError | undefined => {
  for (const [command, run] of Object.entries(entry.commands)) {
    if (!COMMAND_PATTERN.test(command)) {
      return { _tag: 'InvalidCommandName', command, namespace: entry.namespace }
    }
    const key = qaKey(entry.namespace, command)
    registry.set(key, run)
  }
  return
}

/**
 * Validate and merge one namespace entry into the accumulating registry.
 *
 * Split out of `buildQaRegistry` so that function stays under this
 * repository's statement budget; behaviour is unchanged — `seenNamespaces`
 * and `registry` are mutated exactly as they were when this was inline.
 */
const mergeNamespaceEntry = (
  entry: QaNamespace,
  seenNamespaces: Set<string>,
  registry: Map<string, QaCommand>,
): QaApiError | undefined => {
  if (!NAMESPACE_PATTERN.test(entry.namespace)) {
    return { _tag: 'InvalidNamespace', namespace: entry.namespace }
  }
  if (seenNamespaces.has(entry.namespace)) {
    return { _tag: 'DuplicateNamespace', namespace: entry.namespace }
  }
  seenNamespaces.add(entry.namespace)
  return mergeCommands(entry, registry)
}

/**
 * Merge module QA namespaces into one registry.
 *
 * Namespace collisions are fatal rather than last-one-wins. A silently
 * shadowed QA namespace produces an E2E suite that tests the wrong module and
 * passes.
 */
export const buildQaRegistry = (
  namespaces: ReadonlyArray<QaNamespace>,
): Either.Either<QaRegistry, QaApiError> => {
  const seenNamespaces = new Set<string>()
  const registry = new Map<string, QaCommand>()

  for (const entry of namespaces) {
    const error = mergeNamespaceEntry(entry, seenNamespaces, registry)
    if (typeof error !== 'undefined') {
      return Either.left(error)
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

const isInstalledQaApi = (value: unknown): value is Readonly<Record<string, QaCommand>> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((command) => typeof command === 'function')
}

/** Read back a published surface. Used by tests; mirrors what an E2E page does. */
export const readInstalledQaApi = (
  target: Readonly<Record<string, unknown>>,
): Readonly<Record<string, QaCommand>> | undefined => {
  const published = target[QA_GLOBAL_KEY]
  if (typeof published === 'undefined') {
    return
  }
  if (!isInstalledQaApi(published)) {
    return
  }
  return published
}

export const describeQaApiError = (error: QaApiError): string => {
  switch (error['_tag']) {
    case 'InvalidNamespace':
      return `"${error.namespace}" is not a valid QA namespace; use lowercase kebab/dot segments, e.g. "gameplay" or "gameplay.fluids".`
    case 'InvalidCommandName':
      return `"${error.command}" in namespace "${error.namespace}" is not a valid QA command name; use lowerCamelCase.`
    case 'DuplicateNamespace':
      return `the QA namespace "${error.namespace}" was contributed twice; each module owns exactly one.`
    default:
      return `unknown QA API error: ${JSON.stringify(error)}`
  }
}
