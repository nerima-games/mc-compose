/**
 * The modding entry point.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * plan.md §3.15 lists "Modding入口" among this repository's responsibilities,
 * and §7 assigns it here. It belongs here for one reason: a mod is, structurally,
 * another `GameModule` — Layers plus frame stages — and merging GameModules is
 * what this repository does. A mod loader anywhere else would need its own
 * composition machinery.
 *
 * ---------------------------------------------------------------------------
 * A mod gets no privileges the built-in modules do not have
 * ---------------------------------------------------------------------------
 *
 * `acceptMod` returns a plain `GameModule`. It is then merged by `composeGame`
 * exactly like mx-gameplay's. There is no mod-specific hook, no priority, no
 * pre/post pass. Anything a mod can do, a first-party module can do, and vice
 * versa — which is what keeps the mod API from becoming a second, weaker copy
 * of the module contract.
 *
 * ---------------------------------------------------------------------------
 * Stage namespacing is the one restriction
 * ---------------------------------------------------------------------------
 *
 * A mod's stages must be named `mod:<modId>:<stage>`. Without it, a mod could
 * register `simulation:physics` and either collide with the real one (caught,
 * as `DuplicateStage`) or — worse, once a build ships without physics —
 * silently BE the physics stage. Reserving the core namespaces makes both
 * impossible to express.
 */
import { Either } from 'effect'
import type { GameModule, StageRegistration } from './composition'
import { StageId } from './stage-order'

/**
 * The mod contract version.
 *
 * Separate from the package version for the same reason mx-multiplayer's
 * `PROTOCOL_VERSION` is separate from its: this number is what a third party's
 * artefact is compiled against, and bumping it breaks their build, not ours.
 */
export const MODDING_API_VERSION = 1

/**
 * Namespace prefixes a mod may never register a stage under.
 *
 * Must cover the canonical id of every phase in `STANDARD_STAGE_SKELETON`; the
 * two tables cannot see each other, so `test/modding.test.ts` asserts the
 * agreement rather than trusting it. `network:` is the group prefix for the two
 * network phases, exactly as `simulation:` is for the six simulation ones — one
 * entry, so a later network phase is reserved the day it is added rather than
 * the day somebody remembers this list.
 */
export const RESERVED_STAGE_PREFIXES: ReadonlyArray<string> = [
  'input',
  'network:',
  'simulation:',
  'camera-mirror',
  'chunk-sync',
  'render',
  'post-fx',
  'hud-sync',
]

const MOD_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u

export type ModManifest = {
  /** Lowercase kebab-case. Becomes part of every stage id the mod registers. */
  readonly id: string
  /** Human-facing. Never branched on. */
  readonly displayName: string
  /** Must equal `MODDING_API_VERSION`. */
  readonly apiVersion: number
  /** The mod's Layers and stages. Structurally identical to a first-party module. */
  readonly module: GameModule
}

export type ModdingError =
  | { readonly _tag: 'InvalidModId'; readonly id: string }
  | {
      readonly _tag: 'UnsupportedApiVersion'
      readonly id: string
      readonly declared: number
      readonly supported: number
    }
  | {
      readonly _tag: 'ReservedStageNamespace'
      readonly id: string
      readonly stage: StageId
    }
  | { readonly _tag: 'DuplicateModId'; readonly id: string }

/** The prefix every stage a mod registers must start with. */
export const modStagePrefix = (modId: string): string => `mod:${modId}:`

/** Build a correctly namespaced stage id for a mod. */
export const modStageId = (modId: string, stage: string): StageId =>
  StageId(`${modStagePrefix(modId)}${stage}`)

const isReserved = (stage: StageId): boolean =>
  RESERVED_STAGE_PREFIXES.some((prefix) =>
    prefix.endsWith(':') ? stage.startsWith(prefix) : stage === prefix,
  )

const violatesNamespace = (modId: string, registration: StageRegistration): boolean =>
  isReserved(registration.id) || !registration.id.startsWith(modStagePrefix(modId))

/**
 * Validate one mod and hand back its module.
 *
 * Note what is NOT checked: whether the mod's `after` edges point at stages
 * that exist. They may legitimately not — a mod that runs after redstone in a
 * build with no redstone module is fine, and `resolveStageOrder` reports the
 * dropped edge as dangling. Rejecting it here would make mods depend on the
 * build's module set.
 */
export const acceptMod = (manifest: ModManifest): Either.Either<GameModule, ModdingError> => {
  if (!MOD_ID_PATTERN.test(manifest.id)) {
    return Either.left({ _tag: 'InvalidModId', id: manifest.id })
  }

  if (manifest.apiVersion !== MODDING_API_VERSION) {
    return Either.left({
      _tag: 'UnsupportedApiVersion',
      id: manifest.id,
      declared: manifest.apiVersion,
      supported: MODDING_API_VERSION,
    })
  }

  for (const registration of manifest.module.frameStages) {
    if (violatesNamespace(manifest.id, registration)) {
      return Either.left({ _tag: 'ReservedStageNamespace', id: manifest.id, stage: registration.id })
    }
  }

  return Either.right(manifest.module)
}

/** Validate a set of mods, rejecting duplicate ids. Order is preserved. */
export const acceptMods = (
  manifests: ReadonlyArray<ModManifest>,
): Either.Either<ReadonlyArray<GameModule>, ModdingError> => {
  const seen = new Set<string>()
  const accepted: Array<GameModule> = []

  for (const manifest of manifests) {
    if (seen.has(manifest.id)) {
      return Either.left({ _tag: 'DuplicateModId', id: manifest.id })
    }
    seen.add(manifest.id)

    const result = acceptMod(manifest)
    if (Either.isLeft(result)) {
      return Either.left(result.left)
    }
    accepted.push(result.right)
  }

  return Either.right(accepted)
}

export const describeModdingError = (error: ModdingError): string => {
  switch (error._tag) {
    case 'InvalidModId':
      return `"${error.id}" is not a valid mod id; use lowercase kebab-case, e.g. "extra-ores".`
    case 'UnsupportedApiVersion':
      return `mod "${error.id}" targets modding API version ${String(error.declared)}, this build supports ${String(error.supported)}.`
    case 'ReservedStageNamespace':
      return (
        `mod "${error.id}" registered the stage "${error.stage}", which is outside its namespace ` +
        `"${modStagePrefix(error.id)}". Core stage names are reserved so that a mod can never silently become a core stage.`
      )
    case 'DuplicateModId':
      return `two mods declare the id "${error.id}"; ids must be unique within a build.`
  }
}
