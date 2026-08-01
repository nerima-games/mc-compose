/// <reference lib="dom" />

import { describe, expect, it } from '@effect/vitest'
import { makeUiFrameState, uiStages } from '@nerima-games/mx-ui'
import { Context, Effect, Either, Layer, Option, Ref } from 'effect'
import {
  collectStages,
  composeGame,
  DeltaTimeSecs,
  EMPTY_MODULE_LAYER,
  mergeModuleLayers,
  registerModule,
  type ComposedGame,
  type GameModule,
  type StageRegistration,
} from '../src/domain/composition'
import {
  EpochMillis,
  FixedClockLayer,
  monotonicSecs,
  MonotonicTimeSecs,
  type FrameServices,
} from '../src/domain/kernel-vocabulary'
import { StageId, type StageOrderError, type StagePhase } from '../src/domain/stage-order'
import { STAGE_HUD_SYNC, STAGE_INPUT, STAGE_RENDER, STANDARD_STAGE_SKELETON } from '../src/domain/stage-skeleton'

const id = (value: string): StageId => StageId(value)

const dt = (value: number): DeltaTimeSecs => DeltaTimeSecs(value)

/**
 * The frame services a composed game needs. In a real build this is the
 * platform's clock adapter; here it is frozen, so a frame is deterministic.
 */
const FRAME_SERVICES: Layer.Layer<FrameServices> = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

/** A stage that appends its own id to a Ref when it runs. */
const recording = (
  log: Ref.Ref<ReadonlyArray<string>>,
  name: string,
  after?: ReadonlyArray<StageId>,
): StageRegistration => ({
  id: id(name),
  ...(after === undefined ? {} : { after }),
  run: () => Ref.update(log, (previous) => [...previous, name]),
})

const moduleOf = (name: string, frameStages: ReadonlyArray<StageRegistration>): GameModule => ({
  name,
  layers: EMPTY_MODULE_LAYER,
  frameStages,
})

const composed = (
  modules: ReadonlyArray<GameModule>,
  skeleton: ReadonlyArray<StagePhase> = [],
): ComposedGame => Either.getOrThrow(composeGame(modules, { skeleton }))

const failure = (
  result: Either.Either<ComposedGame, StageOrderError>,
): StageOrderError | undefined => Option.getOrUndefined(Either.getLeft(result))

describe('composeGame', () => {
  it.effect('runs every stage exactly once, in the resolved total order', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])

      const game = composed([
        moduleOf('mx-ui', [recording(log, 'ui:hud', [id('sim:tick')])]),
        moduleOf('mx-gameplay', [recording(log, 'sim:tick', [id('input:sample')])]),
        moduleOf('mc-render', [recording(log, 'input:sample')]),
      ])

      expect([...game.plan.order]).toStrictEqual(['input:sample', 'sim:tick', 'ui:hud'])

      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.016))
      expect(yield* Ref.get(log)).toStrictEqual(['input:sample', 'sim:tick', 'ui:hud'])
    }),
  )

  // REGRESSION: the resolved order must actually DRIVE execution. A resolver
  // that is correct but not wired to `runFrame` is decoration.
  it.effect('executes in plan.order, not in module registration order', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])

      const game = composed([
        moduleOf('last-registered-runs-first', [recording(log, 'a')]),
        moduleOf('first-registered-runs-last', [recording(log, 'b', [id('a')])]),
      ])

      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.016))
      expect(yield* Ref.get(log)).toStrictEqual([...game.plan.order])
    }),
  )

  it.effect('runs each frame afresh: two frames produce two full passes', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const game = composed([moduleOf('m', [recording(log, 'a'), recording(log, 'b', [id('a')])])])
      const frame = game.runFrameWith(FRAME_SERVICES)

      yield* frame(dt(0.016))
      yield* frame(dt(0.016))

      expect(yield* Ref.get(log)).toStrictEqual(['a', 'b', 'a', 'b'])
    }),
  )

  it.effect('passes the delta through untouched — no clamp, no rounding, no first-frame special case', () =>
    Effect.gen(function* () {
      // plan.md §3.4 records the reference implementation's measured clamp
      // (min(max(0.001, raw), 0.05), first frame 0.016). That clamp is a
      // simulation invariant and belongs to whoever PRODUCES the delta.
      // Applying it here would put a physics constant in the composition layer.
      //
      // The negative delta this test used to pass through is now unconstructible
      // rather than merely unclamped: `DeltaTimeSecs` is BRANDED, and kernel's
      // refinement is "finite and non-negative". That is a stronger guarantee
      // from the vocabulary, not a weaker assertion here — compose still applies
      // nothing of its own, which is what the surviving values check.
      const seen = yield* Ref.make<ReadonlyArray<number>>([])
      const game = composed([
        moduleOf('m', [
          { id: id('a'), run: (delta) => Ref.update(seen, (previous) => [...previous, delta]) },
        ]),
      ])
      const frame = game.runFrameWith(FRAME_SERVICES)

      yield* frame(dt(9_999))
      yield* frame(dt(0))
      yield* frame(dt(0.000_001))

      expect(yield* Ref.get(seen)).toStrictEqual([9_999, 0, 0.000_001])
      expect(() => dt(-1)).toThrow()
    }),
  )

  it.effect('composes an empty module list into an empty, runnable frame', () =>
    Effect.gen(function* () {
      const game = composed([])
      expect([...game.plan.order]).toStrictEqual([])
      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.016))
    }),
  )

  it.effect('accepts a module that contributes Layers but no stages', () =>
    Effect.sync(() => {
      const game = composed([moduleOf('services-only', [])])
      expect([...game.plan.order]).toStrictEqual([])
      expect([...game.moduleNames]).toStrictEqual(['services-only'])
    }),
  )

  it.effect('reports module names for diagnostics without branching on them', () =>
    Effect.sync(() => {
      const game = composed([moduleOf('mx-gameplay', []), moduleOf('mx-redstone', [])])
      expect([...game.moduleNames]).toStrictEqual(['mx-gameplay', 'mx-redstone'])
    }),
  )

  it.effect('surfaces a cycle between two modules as a composition failure', () =>
    Effect.sync(() => {
      const result = composeGame(
        [
          moduleOf('mx-gameplay', [{ id: id('gameplay:fluids'), after: [id('redstone:tick')], run: () => Effect.void }]),
          moduleOf('mx-redstone', [{ id: id('redstone:tick'), after: [id('gameplay:fluids')], run: () => Effect.void }]),
        ],
        { skeleton: [] },
      )

      const error = failure(result)
      expect(error?._tag).toBe('StageCycle')
      const cycle = error?._tag === 'StageCycle' ? new Set(error.cycle) : new Set()
      expect(cycle).toStrictEqual(new Set(['gameplay:fluids', 'redstone:tick']))
    }),
  )

  it.effect('surfaces two modules claiming one stage id as a composition failure', () =>
    Effect.sync(() => {
      const result = composeGame(
        [
          moduleOf('mx-gameplay', [{ id: id('simulation:redstone'), run: () => Effect.void }]),
          moduleOf('mx-redstone', [{ id: id('simulation:redstone'), run: () => Effect.void }]),
        ],
        { skeleton: [] },
      )

      expect(failure(result)?._tag).toBe('DuplicateStage')
    }),
  )

  it.effect('uses the standard skeleton when none is given', () =>
    Effect.sync(() => {
      const game = Either.getOrThrow(
        composeGame([
          moduleOf('mx-ui', [{ id: STAGE_HUD_SYNC, run: () => Effect.void }]),
          moduleOf('mc-render', [{ id: STAGE_RENDER, run: () => Effect.void }]),
          moduleOf('mc-input', [{ id: STAGE_INPUT, run: () => Effect.void }]),
        ]),
      )

      expect([...game.plan.order]).toStrictEqual([STAGE_INPUT, STAGE_RENDER, STAGE_HUD_SYNC])
      expect(STANDARD_STAGE_SKELETON.map((phase) => phase.name)).toContain(STAGE_INPUT)
    }),
  )
})

describe('the frame carries and discharges FrameServices', () => {
  // REGRESSION — THE reason this repository could not have run a real stage.
  //
  // `StageRegistration.run` used to be typed `Effect<void>`: the R channel was
  // dropped. Requirements do not erase themselves, so kernel's
  // `(dt) => Effect<void, never, ClockPort>` was NOT assignable, and every
  // module in the roster would have failed to compose the moment it stopped
  // mirroring `FrameServices = never` — which all three mx-* repositories
  // commit to doing as soon as kernel publishes.
  //
  // Written as a plain assignment rather than a `@ts-expect-error`, because the
  // failure to catch was a false NEGATIVE: it compiled when it should not have.
  it.effect('accepts a stage written against kernel’s contract, ClockPort and all', () =>
    Effect.gen(function* () {
      const ticks = yield* Ref.make<ReadonlyArray<number>>([])

      // Exactly what mc-kernel/domain/frame.ts declares. If this stops
      // assigning, compose cannot run the roster.
      const kernelShaped: StageRegistration = {
        id: id('sim:tick'),
        run: (delta) =>
          Effect.gen(function* () {
            const now = yield* monotonicSecs
            yield* Ref.update(ticks, (previous) => [...previous, delta + now])
          }),
      }

      const game = composed([moduleOf('mc-sim', [kernelShaped])])
      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.5))

      expect(yield* Ref.get(ticks)).toStrictEqual([1_235])
    }),
  )

  // REGRESSION: `runFrameWith` must DISCHARGE the requirement, not erase it.
  // `Layer.Layer<FrameServices>` has no `any` in it, so `Effect.provide` really
  // removes ClockPort — which is what makes the resulting `Effect<void>` an
  // honest type rather than the erased one the old `ModuleLayer` produced.
  it.effect('runFrame carries ClockPort; runFrameWith removes it, checked by the type', () =>
    Effect.gen(function* () {
      const game = composed([
        moduleOf('m', [{ id: id('a'), run: () => Effect.asVoid(monotonicSecs) }]),
      ])

      const carried: Effect.Effect<void, never, FrameServices> = game.runFrame(dt(0))
      const discharged: Effect.Effect<void, never, never> = game.runFrameWith(FRAME_SERVICES)(dt(0))

      // Providing the clock is the ONLY thing needed to run a frame. If a stage
      // needed anything else, `carried` would not have this type.
      yield* Effect.provide(carried, FRAME_SERVICES)
      yield* discharged
    }),
  )

  it.effect('a frame with no clock reader still typechecks as needing ClockPort, and running it is unchanged', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const game = composed([moduleOf('m', [recording(log, 'a')])])

      yield* game.runFrameWith(FRAME_SERVICES)(dt(0))
      expect(yield* Ref.get(log)).toStrictEqual(['a'])
    }),
  )
})

describe('registerModule — the bridge to kernel’s GameModule', () => {
  it.effect('drives the shared mx-ui FPS state from composed frame delta', () =>
    Effect.gen(function* () {
      const state = yield* makeUiFrameState
      const ui = yield* registerModule({
        name: '@nerima-games/mx-ui',
        layers: EMPTY_MODULE_LAYER,
        frameStages: Effect.succeed(uiStages(state)),
      })
      const game = composed([ui], STANDARD_STAGE_SKELETON)

      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.5))
      expect(yield* Ref.get(state.fpsCounter)).toStrictEqual({
        elapsedSecs: 0.5,
        frameCount: 1,
        fps: 0,
      })

      yield* game.runFrameWith(FRAME_SERVICES)(dt(0.5))
      expect(yield* Ref.get(state.fpsCounter)).toStrictEqual({
        elapsedSecs: 0,
        frameCount: 0,
        fps: 2,
      })
    }),
  )

  // kernel's `frameStages` is an Effect precisely so that a module can acquire
  // a service in order to BUILD a stage. This is that, end to end.
  it.effect('runs a module’s registration Effect and keeps its requirement in the type', () =>
    Effect.gen(function* () {
      class Bindings extends Context.Tag('test/Bindings')<Bindings, { readonly jump: string }>() {}

      const seen = yield* Ref.make<ReadonlyArray<string>>([])

      const registered = registerModule({
        name: 'mc-render',
        layers: EMPTY_MODULE_LAYER,
        frameStages: Effect.gen(function* () {
          // Acquiring a service AT REGISTRATION TIME — impossible when
          // `frameStages` was a value, which is what forced every such service
          // into FrameServices.
          const bindings = yield* Bindings
          return [
            {
              id: id('render:input'),
              run: () => Ref.update(seen, (previous) => [...previous, bindings.jump]),
            },
          ]
        }),
      })

      const module = yield* Effect.provideService(registered, Bindings, { jump: 'Space' })
      expect(module.frameStages).toHaveLength(1)

      const game = composed([module])
      yield* game.runFrameWith(FRAME_SERVICES)(dt(0))
      expect(yield* Ref.get(seen)).toStrictEqual(['Space'])
    }),
  )

  it.effect('carries the name and the Layer through untouched', () =>
    Effect.gen(function* () {
      const module = yield* registerModule({
        name: 'mx-gameplay',
        layers: EMPTY_MODULE_LAYER,
        frameStages: Effect.succeed([]),
      })

      expect(module.name).toBe('mx-gameplay')
      expect(module.layers).toBe(EMPTY_MODULE_LAYER)
      expect(module.frameStages).toStrictEqual([])
    }),
  )
})

describe('Layer merge', () => {
  class Alpha extends Context.Tag('test/Alpha')<Alpha, { readonly value: string }>() {}
  class Beta extends Context.Tag('test/Beta')<Beta, { readonly value: number }>() {}

  const alphaModule: GameModule = {
    name: 'alpha',
    layers: Layer.succeed(Alpha, { value: 'a' }),
    frameStages: [],
  }
  const betaModule: GameModule = {
    name: 'beta',
    layers: Layer.succeed(Beta, { value: 2 }),
    frameStages: [],
  }

  it.effect('makes every module service available from the merged Layer', () =>
    Effect.gen(function* () {
      const merged = mergeModuleLayers([alphaModule, betaModule])

      const seen = yield* Effect.gen(function* () {
        const alpha = yield* Alpha
        const beta = yield* Beta
        return `${alpha.value}${String(beta.value)}`
      }).pipe(Effect.provide(merged))

      expect(seen).toBe('a2')
    }),
  )

  // REGRESSION: modules are PEERS. `Layer.provide` would mean one module's
  // services build another's, which is a dependency edge between experience
  // modules — forbidden outright by plan.md §2.3-1.
  it.effect('merges rather than provides: neither module needs the other to build', () =>
    Effect.gen(function* () {
      const forwards = mergeModuleLayers([alphaModule, betaModule])
      const backwards = mergeModuleLayers([betaModule, alphaModule])

      const read = (layer: Layer.Layer<any, any, any>) =>
        Effect.map(Alpha, (alpha) => alpha.value).pipe(Effect.provide(layer))

      expect(yield* read(forwards)).toBe('a')
      expect(yield* read(backwards)).toBe('a')
    }),
  )

  it.effect('merges an empty module list into an empty Layer', () =>
    Effect.gen(function* () {
      yield* Effect.void.pipe(Effect.provide(mergeModuleLayers([])))
    }),
  )

  it.effect('exposes the merged Layer on the composed game', () =>
    Effect.gen(function* () {
      const game = composed([alphaModule, betaModule])
      const value = yield* Effect.map(Beta, (beta) => beta.value).pipe(Effect.provide(game.layer))
      expect(value).toBe(2)
    }),
  )
})

describe('collectStages', () => {
  it.effect('flattens every module contribution without reordering or deduplicating', () =>
    Effect.sync(() => {
      const stages = collectStages([
        moduleOf('a', [{ id: id('a1'), run: () => Effect.void }, { id: id('a2'), run: () => Effect.void }]),
        moduleOf('b', [{ id: id('b1'), run: () => Effect.void }]),
      ])

      expect(stages.map((registration) => registration.id)).toStrictEqual(['a1', 'a2', 'b1'])
    }),
  )
})

describe('ModuleLayer — what it now checks, and what it still cannot', () => {
  class Missing extends Context.Tag('test/Missing')<Missing, { readonly value: number }>() {}
  class Provided extends Context.Tag('test/Provided')<Provided, { readonly value: number }>() {}

  // REGRESSION: `ModuleLayer` used to be `Layer<any, any, any>`, so a module
  // arriving with an UNSATISFIED requirement was accepted silently. `Layer`
  // declares `out RIn`, so pinning the third parameter to `never` makes that a
  // compile error instead. Modules are peers (plan.md §2.3-1): one whose Layer
  // still needs something has not been assembled yet, and assembling it is the
  // host's job, where the type to do so still exists.
  it.effect('rejects a module whose Layer still needs a service, at compile time', () =>
    Effect.sync(() => {
      const needsSomething: Layer.Layer<Provided, never, Missing> = Layer.effect(
        Provided,
        Effect.map(Missing, (missing) => ({ value: missing.value })),
      )

      // @ts-expect-error RIn is `never` on ModuleLayer: an unmet requirement
      // cannot be smuggled into a composed game any more.
      const smuggled: GameModule = { name: 'bad', layers: needsSomething, frameStages: [] }
      expect(smuggled.name).toBe('bad')

      // Satisfying it first is all that is asked, and then it composes.
      const satisfied = Layer.provide(needsSomething, Layer.succeed(Missing, { value: 7 }))
      const good: GameModule = { name: 'good', layers: satisfied, frameStages: [] }
      expect(good.name).toBe('good')
    }),
  )

  // KNOWN LIMIT, pinned so it is a documented hole rather than a surprise.
  //
  // `ROut` is still `any`, because `composeGame` takes a heterogeneous array
  // and typing that union needs a variadic tuple. So `Effect.provide(game.layer)`
  // ERASES the service an effect asks for instead of checking it, and the
  // failure only shows up at runtime. Note that this hole is NOT on the frame's
  // path: `runFrame` states `FrameServices` in its own type and `runFrameWith`
  // discharges it against a precisely typed Layer.
  it.effect('KNOWN LIMIT: ROut stays erased, so a missing service still fails at runtime, not at tsc', () =>
    Effect.gen(function* () {
      const game = composed([moduleOf('provides-nothing', [])])

      // This COMPILES — `game.layer` claims to provide `any` — and dies when run.
      const outcome = yield* Effect.exit(
        Effect.map(Missing, (missing) => missing.value).pipe(Effect.provide(game.layer)),
      )

      expect(outcome._tag).toBe('Failure')
    }),
  )
})

describe('warnings — what the resolver used to swallow', () => {
  // REGRESSION: `StageOrderPlan.dangling` had NO consumer anywhere in the
  // roster. The resolver computed it faithfully and nothing ever looked, which
  // makes "we report dangling edges rather than rejecting them" false in
  // practice. A host now gets both kinds of report off the composed game.
  it.effect('surfaces a dropped `after` edge on the composed game', () =>
    Effect.sync(() => {
      const game = composed([
        moduleOf('mx-ui', [{ id: id('ui:hud-sync'), after: [id('input')], run: () => Effect.void }]),
      ])

      expect(game.plan.dangling).toStrictEqual([{ stage: 'ui:hud-sync', missing: 'input' }])
      expect(game.warnings.join('\n')).toContain('ui:hud-sync')
      expect(game.warnings.join('\n')).toContain('after input, if there is input')
    }),
  )

  // REGRESSION: a stage whose NAME half matches no phase gets
  // `priorityOf === MAX_SAFE_INTEGER` and falls silently to the end of the
  // frame (domain/stage-order.ts). That is legal — it is how a mod's stage
  // stays schedulable — and it is also exactly what `render:daw` looks like.
  it.effect('surfaces a stage the skeleton does not recognise, without rejecting it', () =>
    Effect.sync(() => {
      const game = Either.getOrThrow(
        composeGame([
          moduleOf('mc-render', [{ id: STAGE_RENDER, run: () => Effect.void }]),
          moduleOf('typo', [{ id: id('render:daw'), run: () => Effect.void }]),
        ]),
      )

      // Not rejected: it still runs, and it runs last.
      expect([...game.plan.order]).toStrictEqual([STAGE_RENDER, 'render:daw'])
      expect([...game.plan.unmatchedPhase]).toStrictEqual(['render:daw'])
      expect(game.warnings.join('\n')).toContain('render:daw')
      expect(game.warnings.join('\n')).toContain('matches no phase')
    }),
  )

  it.effect('says nothing when there is nothing to say, so a host can print it unconditionally', () =>
    Effect.sync(() => {
      const game = Either.getOrThrow(
        composeGame([moduleOf('mc-render', [{ id: STAGE_RENDER, run: () => Effect.void }])]),
      )

      expect(game.plan.dangling).toStrictEqual([])
      expect([...game.plan.unmatchedPhase]).toStrictEqual([])
      expect(game.warnings).toStrictEqual([])
    }),
  )

  // With no phase table there is nothing for a stage to fail to match, so
  // reporting every stage would make the field noise in exactly the tests that
  // pass `[]`. Pinned because it is a definition, not an oversight.
  it.effect('reports no unmatched stage when no skeleton was supplied at all', () =>
    Effect.sync(() => {
      const game = composed([moduleOf('m', [{ id: id('whatever'), run: () => Effect.void }])])
      expect([...game.plan.unmatchedPhase]).toStrictEqual([])
    }),
  )
})
