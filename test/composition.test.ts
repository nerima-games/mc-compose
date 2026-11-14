/// <reference lib="dom" />

import { describe, expect, it } from '@effect/vitest'
import { makeUiFrameState, uiStages } from '@nerima-games/mx-ui'
import * as fc from 'fast-check'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  collectStages,
  composeGame,
  ComposeOptionsError,
  DeltaTimeSecs,
  DuplicateModuleContract,
  EMPTY_MODULE_LAYER,
  mergeModuleLayers,
  registerModule,
  type GameModule,
  type StageRegistration,
} from '../src/domain/composition'
import {
  EpochMillis,
  FixedClockLayer,
  monotonicSecs,
  MonotonicTimeSecs,
  type FrameServices,
  QaNamespaceNameSchema,
  QaOperationNameSchema,
  SaveSliceIdSchema,
  SaveVersionSchema,
  type QaNamespace as KernelQaNamespace,
  type SaveSliceRegistration,
} from '@nerima-games/mc-kernel'
import { StageId, type StagePhase } from '../src/domain/stage-order'
import { QaBridge } from '../src/domain/qa-api'
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

const composed = <
  const Modules extends ReadonlyArray<
    GameModule<never, unknown, never, KernelQaNamespace, ReadonlyArray<SaveSliceRegistration>, unknown>
  >,
>(
  modules: Modules,
  skeleton: ReadonlyArray<StagePhase> = [],
) => Effect.runSync(composeGame(modules, { skeleton }))

const failure = <A, E>(effect: Effect.Effect<A, E>): E => Effect.runSync(Effect.flip(effect))

const namespaceName = (value: string) => Schema.decodeUnknownSync(QaNamespaceNameSchema)(value)

const operationName = (value: string) => Schema.decodeUnknownSync(QaOperationNameSchema)(value)

const saveSliceId = (value: string) => Schema.decodeUnknownSync(SaveSliceIdSchema)(value)

const saveVersion = Schema.decodeUnknownSync(SaveVersionSchema)(1)

const qaNamespace = <const Observe extends object, const Command extends object>(
  name: string,
  observe: Observe,
  command: Command,
) => ({ name: namespaceName(name), observe, command })

const moduleWithQa = <
  const Qa extends KernelQaNamespace,
  LayerOut,
  LayerError,
  LayerRequirements,
>(
  name: string,
  qa: Qa,
  layers: Layer.Layer<LayerOut, LayerError, LayerRequirements>,
) => ({ name, qa, layers, frameStages: [] as ReadonlyArray<StageRegistration> })

const saveSlice = (id: string) => ({
  id: saveSliceId(id),
  version: saveVersion,
  schema: Schema.String,
  snapshot: Effect.succeed(`snapshot:${id}`),
  restore: (_state: string) => Effect.void,
  migrations: [],
})

const moduleWithSaveSlices = <const Slices extends ReadonlyArray<SaveSliceRegistration>>(
  name: string,
  saveSlices: Slices,
) => ({ name, layers: EMPTY_MODULE_LAYER, frameStages: [], saveSlices })

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
      const game = Effect.runSync(
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
      class Bindings extends Context.Service<Bindings, { readonly jump: string }>()('test/Bindings') {}

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
  class Alpha extends Context.Service<Alpha, { readonly value: string }>()('test/Alpha') {}
  class Beta extends Context.Service<Beta, { readonly value: number }>()('test/Beta') {}

  const alphaModule = {
    name: 'alpha',
    layers: Layer.succeed(Alpha, { value: 'a' }),
    frameStages: [],
  } satisfies GameModule<Alpha>
  const betaModule = {
    name: 'beta',
    layers: Layer.succeed(Beta, { value: 2 }),
    frameStages: [],
  } satisfies GameModule<Beta>

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

      const read = <ROut>(layer: Layer.Layer<ROut, unknown, never>) =>
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
      const value = yield* Effect.map(Beta, (beta) => beta.value).pipe(Effect.provide(game.layers))
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

describe('composed layer service boundary', () => {
  class Missing extends Context.Service<Missing, { readonly value: number }>()('test/Missing') {}

  it('does not claim that a composed layer provides erased services', () => {
    const game = composed([moduleOf('provides-nothing', [])])
    const missing: Effect.Effect<number, never, Missing> = Effect.map(Missing, (service) => service.value)
    // @ts-expect-error An empty composed layer cannot discharge Missing.
    const runnable: Effect.Effect<number, never, never> = Effect.provide(game.layers)(missing)
    expect(runnable).toBeDefined()
  })
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
      const game = Effect.runSync(
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
      const game = Effect.runSync(
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

describe('C1 module contracts', () => {
  it.effect('collects module QA namespaces and save slices', () =>
    Effect.gen(function* () {
      const health = {
        name: operationName('health'),
        input: Schema.Struct({}),
        output: Schema.String,
        run: () => Effect.succeed('healthy'),
      }
      const power = {
        name: operationName('power'),
        input: Schema.Struct({}),
        output: Schema.Number,
        run: () => Effect.succeed(15),
      }
      const gameplay = moduleWithQa(
        'mx-gameplay',
        qaNamespace('gameplay', { health }, {}),
        EMPTY_MODULE_LAYER,
      )
      const redstone = moduleWithQa(
        'mx-redstone',
        qaNamespace('redstone', { power }, {}),
        EMPTY_MODULE_LAYER,
      )
      const player = moduleWithSaveSlices('mc-sim-player', [saveSlice('player')])
      const time = moduleWithSaveSlices('mc-sim-time', [saveSlice('time')])

      const game = yield* composeGame([gameplay, redstone, player, time])

      expect(game.qaNamespaces.map((namespace) => namespace.name)).toStrictEqual([
        namespaceName('gameplay'),
        namespaceName('redstone'),
      ])
      expect(game.saveSlices.map((slice) => slice.id)).toStrictEqual([
        saveSliceId('player'),
        saveSliceId('time'),
      ])
      expect(game.qaBridge).toHaveProperty('run')
    }),
  )

  it.effect('rejects duplicate namespaces without exposing a partial registry', () =>
    Effect.gen(function* () {
      const shared = qaNamespace('gameplay', {}, {})
      const error = yield* Effect.flip(
        composeGame([
          moduleWithQa('first', shared, EMPTY_MODULE_LAYER),
          moduleWithQa('second', shared, EMPTY_MODULE_LAYER),
        ]),
      )

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({ _tag: 'DuplicateModuleContract', kind: 'qa-namespace', id: 'gameplay' })
      expect(error).not.toHaveProperty('qaNamespaces')
    }),
  )

  it.effect('rejects an observe/command name collision', () =>
    Effect.gen(function* () {
      const operation = {
        name: operationName('reset'),
        input: Schema.Struct({}),
        output: Schema.Boolean,
        run: () => Effect.succeed(true),
      }
      const namespace = qaNamespace('gameplay', { reset: operation }, { reset: operation })
      const error = yield* Effect.flip(
        composeGame([moduleWithQa('gameplay', namespace, EMPTY_MODULE_LAYER)]),
      )

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({ _tag: 'DuplicateModuleContract', kind: 'qa-operation', id: 'gameplay.reset' })
    }),
  )

  it.effect('rejects a QA map key that differs from the operation name', () =>
    Effect.gen(function* () {
      const operation = {
        name: operationName('actualName'),
        input: Schema.Struct({}),
        output: Schema.Boolean,
        run: () => Effect.succeed(true),
      }
      const namespace = qaNamespace('gameplay', { declaredName: operation }, {})
      const error = yield* Effect.flip(
        composeGame([moduleWithQa('gameplay', namespace, EMPTY_MODULE_LAYER)]),
      )

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({
        _tag: 'DuplicateModuleContract',
        kind: 'qa-operation',
        id: 'gameplay.declaredName',
      })
    }),
  )

  it.effect('rejects duplicate save slice IDs without returning a partial slice set', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        composeGame([
          moduleWithSaveSlices('first', [saveSlice('player')]),
          moduleWithSaveSlices('second', [saveSlice('player')]),
        ]),
      )

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({ _tag: 'DuplicateModuleContract', kind: 'save-slice', id: 'player' })
      expect(error).not.toHaveProperty('saveSlices')
    }),
  )

  it.effect('rejects a present QA namespace with a non-record value', () =>
    Effect.gen(function* () {
      const malformed = moduleOf('broken-qa', [])
      Object.defineProperty(malformed, 'qa', { enumerable: true, value: undefined })

      const error = yield* Effect.flip(composeGame([malformed]))

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({
        _tag: 'DuplicateModuleContract',
        kind: 'qa-namespace',
        id: 'broken-qa',
      })
    }),
  )

  it.effect('rejects a present save slice collection that is not an array', () =>
    Effect.gen(function* () {
      const malformed = moduleOf('broken-slices', [])
      Object.defineProperty(malformed, 'saveSlices', {
        enumerable: true,
        value: { id: 'player' },
      })

      const error = yield* Effect.flip(composeGame([malformed]))

      expect(error).toBeInstanceOf(DuplicateModuleContract)
      expect(error).toMatchObject({
        _tag: 'DuplicateModuleContract',
        kind: 'save-slice',
        id: 'broken-slices',
      })
    }),
  )

  it.effect('rejects malformed options and skeletons with field-specific errors', () =>
    Effect.sync(() => {
      // @ts-expect-error Runtime validation also guards callers without TypeScript checks.
      const nullOptions = composeGame([], null)
      // @ts-expect-error Runtime validation also guards callers without TypeScript checks.
      const nullSkeleton = composeGame([], { skeleton: null })

      const optionsError = failure(nullOptions)
      const skeletonError = failure(nullSkeleton)

      expect(optionsError).toBeInstanceOf(ComposeOptionsError)
      expect(optionsError).toMatchObject({ _tag: 'ComposeOptionsError', field: 'options' })
      expect(skeletonError).toBeInstanceOf(ComposeOptionsError)
      expect(skeletonError).toMatchObject({ _tag: 'ComposeOptionsError', field: 'skeleton' })
    }),
  )

  it.effect('rejects duplicate namespace, operation, and slice IDs for every non-empty name', () =>
    Effect.sync(() =>
      fc.assert(
        fc.property(fc.string({ minLength: 1 }), (name) => {
          const shared = qaNamespace(name, {}, {})
          const namespaceError = failure(
            composeGame([
              moduleWithQa('first', shared, EMPTY_MODULE_LAYER),
              moduleWithQa('second', shared, EMPTY_MODULE_LAYER),
            ]),
          )

          const operation = {
            name: operationName(name),
            input: Schema.Struct({}),
            output: Schema.Boolean,
            run: () => Effect.succeed(true),
          }
          const operationError = failure(
            composeGame([
              moduleWithQa(
                'gameplay',
                qaNamespace('gameplay', { [name]: operation }, { [name]: operation }),
                EMPTY_MODULE_LAYER,
              ),
            ]),
          )
          const sliceError = failure(
            composeGame([
              moduleWithSaveSlices('first', [saveSlice(name)]),
              moduleWithSaveSlices('second', [saveSlice(name)]),
            ]),
          )

          expect(namespaceError).toMatchObject({
            _tag: 'DuplicateModuleContract',
            kind: 'qa-namespace',
            id: name,
          })
          expect(operationError).toMatchObject({
            _tag: 'DuplicateModuleContract',
            kind: 'qa-operation',
            id: `gameplay.${name}`,
          })
          expect(sliceError).toMatchObject({
            _tag: 'DuplicateModuleContract',
            kind: 'save-slice',
            id: name,
          })
        }),
      ),
    ),
  )

  it.effect('dispatches through QaBridge and provides the operation service from composed layers', () =>
    Effect.gen(function* () {
      class QaState extends Context.Service<QaState, { readonly value: string }>()('test/QaState') {}

      const readState = {
        name: operationName('readState'),
        input: Schema.Struct({}),
        output: Schema.String,
        run: () => Effect.map(QaState, (state) => state.value),
      }
      const qa = qaNamespace('gameplay', { readState }, {})
      const game = yield* composeGame([
        moduleWithQa('gameplay', qa, Layer.succeed(QaState, { value: 'provided by composed layers' })),
      ])
      const qaBridge = QaBridge<QaState>()
      const program = Effect.gen(function* () {
        return yield* qaBridge
      })
      const api = yield* Effect.provideService(program, qaBridge, game.qaBridge)

      const dispatch = Effect.provide(api.run(qa.name, readState.name, {}), game.layers)
      const dispatchWithQaState: Effect.Effect<unknown, unknown, QaState> = dispatch

      // @ts-expect-error the QA operation requirement remains on the provided Effect
      const incorrectlyDischarged: Effect.Effect<unknown, unknown, never> = dispatch
      expect(incorrectlyDischarged).toBeDefined()

      const output = yield* Effect.provideService(
        dispatchWithQaState,
        QaState,
        { value: 'external fallback' },
      )

      expect(output).toBe('provided by composed layers')
    }),
  )

  it.effect('retains module layer requirements on the composed layers', () =>
    Effect.gen(function* () {
      class Required extends Context.Service<Required, { readonly value: number }>()('test/Required') {}
      class Provided extends Context.Service<Provided, { readonly value: number }>()('test/Provided') {}

      const dependentLayer: Layer.Layer<Provided, never, Required> = Layer.effect(
        Provided,
        Effect.map(Required, (required) => ({ value: required.value + 1 })),
      )
      const game = yield* composeGame([
        { name: 'dependent', layers: dependentLayer, frameStages: [] },
      ])
      const provided: Effect.Effect<number, never, Required> = Effect.map(
        Provided,
        (service) => service.value,
      ).pipe(Effect.provide(game.layers))

      expect(yield* Effect.provideService(provided, Required, { value: 8 })).toBe(9)
    }),
  )

  it.effect('retains registerModule frame-stage requirements on the composed layers', () =>
    Effect.gen(function* () {
      class RegistrationInput extends Context.Service<
        RegistrationInput,
        { readonly suffix: string }
      >()('test/RegistrationInput') {}

      const registered = yield* Effect.provideService(
        registerModule({
          name: 'registers-with-input',
          layers: EMPTY_MODULE_LAYER,
          frameStages: Effect.gen(function* () {
            const input = yield* RegistrationInput
            return [{ id: id(`registered:${input.suffix}`), run: () => Effect.void }]
          }),
        }),
        RegistrationInput,
        { suffix: 'tick' },
      )
      const game = yield* composeGame([registered])
      const retainedRequirement: Effect.Effect<string, unknown, RegistrationInput> = Effect.provide(
        Effect.succeed('composed'),
        game.layers,
      )

      // @ts-expect-error the registration requirement is still part of the composed layer contract
      const incorrectlyDischarged: Effect.Effect<string, unknown, never> = retainedRequirement
      expect(incorrectlyDischarged).toBeDefined()
      expect(yield* Effect.provideService(retainedRequirement, RegistrationInput, { suffix: 'external' })).toBe(
        'composed',
      )
    }),
  )
})
