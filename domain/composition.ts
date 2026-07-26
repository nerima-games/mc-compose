/**
 * Layer merge + frame assembly. The second of the two things this repository
 * owns (the first is `domain/stage-skeleton.ts`).
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * The prime directive, restated where the code is
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.15: "ここにゲームルールを書いたら負け" — writing a game rule here
 * loses. The reference implementation's composition layer,
 * `packages/app/application/`, is 20,737 production LOC, roughly 13k of which
 * is game rules that ended up verifiable only through E2E. That is the origin
 * of this entire rebuild.
 *
 * The review norm is exact: THE ONLY CODE ADDED TO COMPOSE IS LAYER
 * COMPOSITION AND THE STAGE ORDER TABLE. Anything else moves to the module
 * that owns it. See docs/responsibility.md.
 *
 * Concretely, `composeGame` below does three things and nothing else:
 *   1. merge the modules' Layers,
 *   2. resolve the stage total order (delegated to `domain/stage-order.ts`),
 *   3. hand back an effect that runs those stages in that order.
 *
 * It never inspects a stage, never wraps one in a condition, and never decides
 * whether one should run. A stage that should sometimes not run contains that
 * decision inside its own `run`, in the repository that owns it.
 */
import { Effect, Either, Layer } from 'effect'
import {
  resolveStageOrder,
  type StageConstraint,
  type StageId,
  type StageOrderError,
  type StageOrderPlan,
  type StagePhase,
} from './stage-order'
import { STANDARD_STAGE_SKELETON } from './stage-skeleton'

/**
 * Seconds since the previous frame. Mirrors `@nerima-games/mc-kernel`'s
 * `DeltaTimeSecs`; declared locally only because nothing is published yet.
 *
 * plan.md §3.4 records the reference implementation's measured clamp:
 * `min(max(0.001, raw), 0.05)`, first frame 0.016. THAT CLAMP IS NOT APPLIED
 * HERE. It is a simulation invariant and belongs to whoever produces the delta,
 * not to the code that passes it along — applying it here would put a physics
 * constant in the composition layer, which is precisely the failure this
 * repository exists to prevent.
 */
export type DeltaTimeSecs = number

/**
 * One unit of per-frame work. Mirrors mc-kernel's `StageRegistration`.
 *
 * `run` returns `Effect<void>` with no error channel: a stage that can fail at
 * runtime handles or defects its own failure, because there is no sensible
 * frame-level recovery for "physics failed on frame 12048".
 */
export type StageRegistration = {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void>
}

/**
 * A module's Layer, with its type parameters erased.
 *
 * Erasure is deliberate and is confined to this one alias. `composeGame` takes
 * a heterogeneous array of modules whose service types differ; expressing that
 * precisely needs a variadic tuple type, and the payoff — type-checking the
 * service graph at the composition site — is real but belongs to the vertical
 * slice spike, once the actual service set exists. Until then an honest `any`
 * beats a fake precision.
 */
export type ModuleLayer = Layer.Layer<any, any, any>

/**
 * A module that provides no services.
 *
 * Exported rather than left to callers writing `Layer.empty`, because
 * `Layer.empty` does NOT assign to `ModuleLayer`: `Layer` declares `in ROut`
 * (contravariant), so `Layer<never, ...>` would need `any` to be assignable to
 * `never`. Every real module layer assigns fine; the empty one is the single
 * exception, and this constant is where that exception is confined.
 */
export const EMPTY_MODULE_LAYER: ModuleLayer = Layer.empty as unknown as ModuleLayer

/** A repository's contribution to a running game. Mirrors mc-kernel's `GameModule`. */
export type GameModule = {
  /** For diagnostics only. Never branched on. */
  readonly name: string
  readonly layers: ModuleLayer
  readonly frameStages: ReadonlyArray<StageRegistration>
}

export type ComposedGame = {
  /** The resolved total order, plus any dropped dangling edges. */
  readonly plan: StageOrderPlan
  /** Every module's services, merged. */
  readonly layer: ModuleLayer
  /** Run one frame: every stage, once, in `plan.order`. */
  readonly runFrame: (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** Names of the composed modules, in the order given. Diagnostics only. */
  readonly moduleNames: ReadonlyArray<string>
}

export type ComposeOptions = {
  /**
   * The frame's phases. Defaults to `STANDARD_STAGE_SKELETON`; overridable so
   * tests can be small. See `domain/stage-order.ts` on why a phase rather than
   * a concrete stage id.
   */
  readonly skeleton?: ReadonlyArray<StagePhase>
}

/**
 * Merge every module's Layer into one.
 *
 * `Layer.merge` rather than `Layer.provide`: modules are peers. If module A
 * needed module B's services to *build*, that would be a dependency edge
 * between two experience modules, which plan.md §2.3-1 forbids outright.
 */
export const mergeModuleLayers = (modules: ReadonlyArray<GameModule>): ModuleLayer => {
  // A plain loop rather than `reduce`: with `ModuleLayer` erased to `any`,
  // `reduce`'s overload set resolves to the wrong signature and the accumulator
  // is inferred as `GameModule`. The loop states the intent unambiguously.
  //
  // Seeded with EMPTY_MODULE_LAYER; see that constant for why `Layer.empty`
  // cannot be used directly.
  //
  // NOTE on the erasure: erasing to `Layer<never, unknown, unknown>` instead
  // would need no assertion anywhere — but then `Effect.provide(game.layer)`
  // would discharge no requirement, which defeats the purpose of merging. The
  // precise alternative is a variadic tuple type, and that belongs to the
  // vertical-slice spike once the real service set exists.
  let merged = EMPTY_MODULE_LAYER
  for (const module of modules) {
    merged = Layer.merge(merged, module.layers)
  }
  return merged
}

/** Every module's stages, flattened. Order here is irrelevant — the resolver sorts. */
export const collectStages = (modules: ReadonlyArray<GameModule>): ReadonlyArray<StageRegistration> =>
  modules.flatMap((module) => [...module.frameStages])

const asConstraint = (registration: StageRegistration): StageConstraint =>
  registration.after === undefined
    ? { id: registration.id }
    : { id: registration.id, after: registration.after }

/**
 * Compose modules into a runnable game.
 *
 * Fails only for reasons that make a frame impossible to define: a duplicate
 * stage id, or a cycle. Everything else — a dangling `after`, a module with no
 * stages, an empty module list — is legal and reported rather than rejected.
 */
export const composeGame = (
  modules: ReadonlyArray<GameModule>,
  options: ComposeOptions = {},
): Either.Either<ComposedGame, StageOrderError> => {
  const stages = collectStages(modules)
  const skeleton = options.skeleton ?? STANDARD_STAGE_SKELETON

  return Either.map(
    resolveStageOrder(stages.map(asConstraint), { skeleton }),
    (plan): ComposedGame => {
      const byId = new Map(stages.map((stage) => [stage.id, stage] as const))
      const ordered = plan.order.flatMap((id) => {
        const stage = byId.get(id)
        return stage === undefined ? [] : [stage]
      })

      return {
        plan,
        layer: mergeModuleLayers(modules),
        moduleNames: modules.map((module) => module.name),
        // Note what is NOT here: no try/catch, no per-stage timing, no
        // conditional skip, no budget. Adding any of them would be adding
        // behaviour to the composition layer. Frame budgeting, if it is ever
        // wanted, is a stage like any other and belongs to the module that
        // owns the frame clock.
        runFrame: (dt) => Effect.forEach(ordered, (stage) => stage.run(dt), { discard: true }),
      }
    },
  )
}
