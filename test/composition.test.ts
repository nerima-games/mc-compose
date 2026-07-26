import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Either, Layer, Option, Ref } from 'effect'
import {
  collectStages,
  composeGame,
  EMPTY_MODULE_LAYER,
  mergeModuleLayers,
  type ComposedGame,
  type GameModule,
  type StageRegistration,
} from '../domain/composition'
import { StageId, type StageOrderError, type StagePhase } from '../domain/stage-order'
import { STAGE_HUD_SYNC, STAGE_INPUT, STAGE_RENDER, STANDARD_STAGE_SKELETON } from '../domain/stage-skeleton'

const id = (value: string): StageId => StageId(value)

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

      yield* game.runFrame(0.016)
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

      yield* game.runFrame(0.016)
      expect(yield* Ref.get(log)).toStrictEqual([...game.plan.order])
    }),
  )

  it.effect('runs each frame afresh: two frames produce two full passes', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const game = composed([moduleOf('m', [recording(log, 'a'), recording(log, 'b', [id('a')])])])

      yield* game.runFrame(0.016)
      yield* game.runFrame(0.016)

      expect(yield* Ref.get(log)).toStrictEqual(['a', 'b', 'a', 'b'])
    }),
  )

  it.effect('passes the delta through untouched — no clamp, no rounding, no first-frame special case', () =>
    Effect.gen(function* () {
      // plan.md §3.4 records the reference implementation's measured clamp
      // (min(max(0.001, raw), 0.05), first frame 0.016). That clamp is a
      // simulation invariant and belongs to whoever PRODUCES the delta.
      // Applying it here would put a physics constant in the composition layer.
      const seen = yield* Ref.make<ReadonlyArray<number>>([])
      const game = composed([
        moduleOf('m', [
          { id: id('a'), run: (dt) => Ref.update(seen, (previous) => [...previous, dt]) },
        ]),
      ])

      yield* game.runFrame(9_999)
      yield* game.runFrame(0)
      yield* game.runFrame(-1)

      expect(yield* Ref.get(seen)).toStrictEqual([9_999, 0, -1])
    }),
  )

  it.effect('composes an empty module list into an empty, runnable frame', () =>
    Effect.gen(function* () {
      const game = composed([])
      expect([...game.plan.order]).toStrictEqual([])
      yield* game.runFrame(0.016)
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
