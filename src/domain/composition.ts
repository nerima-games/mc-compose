/**
 * Layer merge + frame assembly. The second of the two things this repository
 * owns (the first is `domain/stage-skeleton.ts`).
 *
 * CURRENT COMPOSITION BASELINE.
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
import {
  DeltaTimeSecs,
  type FrameServices,
  type GameModule as KernelGameModule,
  type StageRegistration,
} from '@nerima-games/mc-kernel'
import { Effect, Either, Layer } from 'effect'
import {
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
  type StagePhase,
  describeStagePlanWarnings,
  resolveStageOrder,
} from './stage-order'
import { STANDARD_STAGE_SKELETON } from './stage-skeleton'

/**
 * Seconds since the previous frame, BRANDED, exactly as kernel brands it.
 *
 * Re-exported from `mc-kernel` rather than declared here: the composition
 * boundary is the one place in the whole roster that calls
 * `StageRegistration.run`, so every stage receives the shared validated
 * quantity. The §3.4 clamp remains a host concern rather than part of the
 * kernel brand.
 */
export { DeltaTimeSecs }
export type { FrameServices, StageRegistration }

/**
 * A self-contained module Layer at the composition boundary.
 *
 * ---------------------------------------------------------------------------
 * What is erased, what is not, and why the difference matters
 * ---------------------------------------------------------------------------
 *
 * `composeGame` takes a heterogeneous array of modules whose PROVIDED service
 * types differ. The variadic tuple is threaded through
 * `mergeModuleLayers`, `ComposedGame` and `composeGame`'s return, so the
 * composed layer exposes the union of the services the supplied modules
 * provide. An explicitly erased `GameModule` still produces `never`, which is
 * deliberately conservative: the boundary never claims an unknown service.
 *
 * `RIn` is `never`, and that is a real tightening rather than a cosmetic one.
 * With `RIn` erased to `any`, `Effect.provide(game.layer)` ERASED the
 * requirement instead of discharging it: an effect needing a service no module
 * provided typechecked and then died at runtime with `Service not found`, which
 * is the worst possible shape for this particular failure — `tsc` caught it
 * only incidentally, via `exactOptionalPropertyTypes`, and only sometimes.
 * `Layer`'s `RIn` is covariant (`out RIn`), so `Layer<X, Err, R>` is assignable
 * to `Layer<never, unknown, never>` exactly when `R` is `never`. A module must
 * therefore arrive SELF-CONTAINED, which is not a new rule: modules are peers
 * (`Layer.merge`, never `Layer.provide`), and a module needing another
 * module's services to build is the dependency edge plan.md §2.3-1 forbids
 * outright. A module that needs a platform handle takes it before it is handed
 * to `composeGame`, where the host still has the type to satisfy.
 *
 * The frame path remains precise through `FrameServices` and `runFrameWith`.
 */
export type ModuleLayer = Layer.Layer<never, unknown, never>

/**
 * A module that provides no services.
 *
 * Exported rather than left to callers writing `Layer.empty`, because
 * `Layer.empty` does NOT assign to `ModuleLayer`: `Layer` declares `in ROut`
 * (contravariant), so `Layer.empty` is already assignable to this safe erased
 * boundary. Every real module layer also assigns fine; the constant remains
 * the shared spelling for an empty module.
 *
 * No output service is claimed by the empty layer.
 */
export const EMPTY_MODULE_LAYER: ModuleLayer = Layer.empty as unknown as ModuleLayer

/**
 * A resolved repository contribution, AFTER REGISTRATION.
 *
 * kernel's `GameModule.frameStages` is an
 * `Effect<ReadonlyArray<StageRegistration>, never, RRegister>`, not an array —
 * a module must be able to acquire a service in order to BUILD a stage, and
 * with an array there was no context in which to do that (see
 * `mc-kernel/domain/frame.ts` and its freeze checklist (b)).
 *
 * That Effect runs ONCE, at startup, and `composeGame` runs after it. So the
 * type this repository composes is kernel's with `frameStages` already
 * evaluated. Keeping the boundary there is what lets `composeGame` stay a pure
 * `Either` — resolving a total order is a calculation over ids and edges, and
 * making it an `Effect` because of somebody else's constructor would be
 * borrowing a fibre to do arithmetic.
 *
 * The runtime contract remains `mc-kernel`'s `GameModule`; this record is only
 * the resolved data that `mc-compose` needs after the registration effect has
 * been evaluated. Keeping that distinction prevents the host from confusing a
 * registration-time effect with a runnable module.
 */
export type RegisteredGameModule<ROut = never, Err = unknown> = {
  /** For diagnostics only. Never branched on. */
  readonly name: string
  readonly layers: Layer.Layer<ROut, Err, never>
  readonly frameStages: ReadonlyArray<StageRegistration>
}

/**
 * Run a kernel-shaped module's registration Effect and hand back the
 * composable module.
 *
 * This is the only boundary between `mc-kernel`'s registration contract and
 * the resolved data consumed by the composition algorithm. It inspects no
 * stage, decides nothing, and adds no behaviour — it evaluates the module's
 * registration effect and copies the result into a record.
 *
 * `RRegister` flows straight through, so a module that acquires `InputService`
 * to build its input stage still forces the host to supply `InputService`. That
 * is the property the erased `ModuleLayer` cannot give, and it is why this
 * function exists rather than callers writing `Effect.map` by hand and losing
 * the parameter to inference on an erased boundary.
 */
export const registerModule = <RRegister, ROut = never, Err = unknown>(module: {
  readonly name: string
  readonly module: KernelGameModule<ROut, Err, never, RRegister>
}): Effect.Effect<RegisteredGameModule<ROut, Err>, never, RRegister> =>
  Effect.map(module.module.frameStages, (frameStages) => ({
    frameStages,
    layers: module.module.layers,
    name: module.name,
  }))

export type ComposedGame<ROut = never, Err = unknown> = {
  /** The resolved total order, plus the dropped and the unrecognised. */
  readonly plan: StageOrderPlan
  /** Every module's services, merged. */
  readonly layer: Layer.Layer<ROut, Err, never>
  /**
   * Run one frame: every stage, once, in `plan.order`.
   *
   * CARRIES `FrameServices`. That is the honest type — a stage may read the
   * clock — and stating it is what makes `runFrameWith` a discharge rather than
   * an erasure. A host that wants a `Effect<void>` calls `runFrameWith`.
   */
  readonly runFrame: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
  /**
   * `runFrame` with the frame's services supplied. THE discharge.
   *
   * `Layer.Layer<FrameServices>` is `Layer<ClockPort, never, never>` — no `any`
   * anywhere on this path, so `Effect.provide` genuinely removes the
   * requirement instead of erasing it. Discharging `ClockPort` is exactly the
   * composition layer's job: it is the one repository that can see both the
   * stages that read the clock and the platform adapter that implements it.
   */
  readonly runFrameWith: (
    services: Layer.Layer<FrameServices>,
  ) => (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** Names of the composed modules, in the order given. Diagnostics only. */
  readonly moduleNames: ReadonlyArray<string>
  /**
   * Everything the resolver would otherwise have swallowed, rendered for a log.
   *
   * A dangling `after` edge and a stage the skeleton does not recognise are
   * both LEGAL — see `domain/stage-order.ts` — and both are indistinguishable
   * from a typo at the point where they bite. Enforcing either would delete a
   * sanctioned idiom; not surfacing them is how a mistyped stage id silently
   * runs at the end of the frame forever. So: enforce nothing, report both.
   *
   * Empty when there is nothing to say, so a host can print it unconditionally.
   */
  readonly warnings: ReadonlyArray<string>
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
type ModuleList = ReadonlyArray<RegisteredGameModule<never, unknown>>
type LayerOutput<LayerType> = LayerType extends Layer.Layer<infer ROut, unknown, never> ? ROut : never
type LayerError<LayerType> = LayerType extends Layer.Layer<never, infer Err, never> ? Err : never
type ModuleOutput<Modules extends ModuleList> = LayerOutput<Modules[number]['layers']>
type ModuleError<Modules extends ModuleList> = LayerError<Modules[number]['layers']>

export const mergeModuleLayers = <const Modules extends ModuleList>(
  modules: Modules,
): Layer.Layer<ModuleOutput<Modules>, ModuleError<Modules>, never> => {
  // Seeded with EMPTY_MODULE_LAYER; see that constant for why `Layer.empty`
  // Cannot be used directly.
  //
  let merged: ModuleLayer = EMPTY_MODULE_LAYER
  for (const module of modules) {
    merged = Layer.merge(merged, module.layers)
  }
  return merged as unknown as Layer.Layer<ModuleOutput<Modules>, ModuleError<Modules>, never>
}

/** Every module's stages, flattened. Order here is irrelevant — the resolver sorts. */
export const collectStages = (
  modules: ReadonlyArray<RegisteredGameModule>,
): ReadonlyArray<StageRegistration> =>
  modules.flatMap((module) => [...module.frameStages])

const asConstraint = (registration: StageRegistration): StageConstraint => {
  if (typeof registration.after === 'undefined') {
    return { id: registration.id }
  }
  return { after: registration.after, id: registration.id }
}

/**
 * Compose modules into a runnable game.
 *
 * Fails only for reasons that make a frame impossible to define: a duplicate
 * stage id, or a cycle. Everything else — a dangling `after`, a module with no
 * stages, an empty module list — is legal and reported rather than rejected.
 */
export const composeGame = <const Modules extends ModuleList>(
  modules: Modules,
  options: ComposeOptions = {},
): Either.Either<ComposedGame<ModuleOutput<Modules>, ModuleError<Modules>>, StageOrderError> => {
  const stages = collectStages(modules)
  const skeleton = options.skeleton ?? STANDARD_STAGE_SKELETON

  return Either.map(
    resolveStageOrder(stages.map(asConstraint), { skeleton }),
    (plan): ComposedGame<ModuleOutput<Modules>, ModuleError<Modules>> => {
      const byId = new Map(stages.map((stage) => [stage.id, stage] as const))
      // Non-null: `plan.order` is a permutation of `registered`, which
      // `resolveStageOrder` built from exactly these `stages`' ids — and this
      // Callback only runs on `Either.Right`, i.e. only once
      // `collectRegistered` has already confirmed those ids are unique. So
      // Every id `plan.order` yields is present in `byId`, built from the
      // Same `stages` array.
      const ordered = plan.order.map((id) => byId.get(id)!)

      // Note what is NOT here: no try/catch, no per-stage timing, no
      // Conditional skip, no budget. Adding any of them would be adding
      // Behaviour to the composition layer. Frame budgeting, if it is ever
      // Wanted, is a stage like any other and belongs to the module that
      // Owns the frame clock.
      const runFrame = (dt: DeltaTimeSecs): Effect.Effect<void, never, FrameServices> =>
        Effect.forEach(ordered, (stage) => stage.run(dt), { discard: true })

      return {
        layer: mergeModuleLayers(modules),
        moduleNames: modules.map((module) => module.name),
        plan,
        runFrame,
        runFrameWith: (services) => (dt) => Effect.provide(runFrame(dt), services),
        warnings: describeStagePlanWarnings(plan),
      }
    },
  )
}
