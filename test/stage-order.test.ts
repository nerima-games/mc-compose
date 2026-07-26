import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Option } from 'effect'
import {
  describeStageOrderError,
  resolveStageOrder,
  StageId,
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
} from '../domain/stage-order'
import {
  SIMULATION_STAGES,
  STAGE_CAMERA_MIRROR,
  STAGE_CHUNK_SYNC,
  STAGE_HUD_SYNC,
  STAGE_INPUT,
  STAGE_POST_FX,
  STAGE_RENDER,
  STAGE_SIM_ENTITIES,
  STAGE_SIM_FLUIDS,
  STAGE_SIM_PHYSICS,
  STAGE_SIM_REDSTONE,
  STAGE_SIM_TIME_WEATHER,
  STANDARD_STAGE_SKELETON,
} from '../domain/stage-skeleton'

const id = (value: string): StageId => StageId(value)

const stage = (name: string, ...after: ReadonlyArray<string>): StageConstraint =>
  after.length === 0 ? { id: id(name) } : { id: id(name), after: after.map(id) }

const plan = (
  constraints: ReadonlyArray<StageConstraint>,
  skeleton?: ReadonlyArray<StageId>,
): StageOrderPlan => Either.getOrThrow(resolveStageOrder(constraints, skeleton ? { skeleton } : {}))

const order = (
  constraints: ReadonlyArray<StageConstraint>,
  skeleton?: ReadonlyArray<StageId>,
): ReadonlyArray<string> => [...plan(constraints, skeleton).order]

const failure = (
  result: Either.Either<StageOrderPlan, StageOrderError>,
): StageOrderError | undefined => Option.getOrUndefined(Either.getLeft(result))

/** Index of a stage in a resolved order. -1 if absent. */
const positionIn = (resolved: ReadonlyArray<string>, name: string): number => resolved.indexOf(name)

describe('the total order this repository exists to own', () => {
  // plan.md §2.3-3: every module declares only `after`; compose resolves the
  // one total order. This is the algorithm that does it.
  it.effect('turns a chain of after-constraints into the one order they imply', () =>
    Effect.sync(() => {
      expect(order([stage('c', 'b'), stage('a'), stage('b', 'a')])).toStrictEqual(['a', 'b', 'c'])
    }),
  )

  it.effect('accepts an empty registration set — a build with no stages is a legal build', () =>
    Effect.sync(() => {
      expect(order([])).toStrictEqual([])
    }),
  )

  it.effect('places every registered stage exactly once', () =>
    Effect.sync(() => {
      const resolved = order([stage('a'), stage('b', 'a'), stage('c', 'a'), stage('d', 'b', 'c')])
      expect(resolved).toHaveLength(4)
      expect(new Set(resolved).size).toBe(4)
    }),
  )

  it.effect('honours a diamond: both middles come after the source and before the sink', () =>
    Effect.sync(() => {
      const resolved = order([stage('sink', 'left', 'right'), stage('left', 'src'), stage('right', 'src'), stage('src')])
      expect(positionIn(resolved, 'src')).toBeLessThan(positionIn(resolved, 'left'))
      expect(positionIn(resolved, 'src')).toBeLessThan(positionIn(resolved, 'right'))
      expect(positionIn(resolved, 'left')).toBeLessThan(positionIn(resolved, 'sink'))
      expect(positionIn(resolved, 'right')).toBeLessThan(positionIn(resolved, 'sink'))
    }),
  )

  it.effect('ignores a duplicate after-edge rather than counting it twice', () =>
    Effect.sync(() => {
      expect(order([stage('b', 'a', 'a'), stage('a')])).toStrictEqual(['a', 'b'])
    }),
  )

  // A self-edge is meaningless rather than cyclic: "run me after me" says
  // nothing. Treating it as a cycle would make a copy-paste typo fatal.
  it.effect('drops a self-edge instead of reporting a one-node cycle', () =>
    Effect.sync(() => {
      expect(order([stage('a', 'a')])).toStrictEqual(['a'])
    }),
  )
})

describe('determinism', () => {
  // REGRESSION — the most important property here. A topological sort has many
  // valid answers. If the resolver picked a different one between two runs, a
  // frame-order bug would reproduce only sometimes, in a simulation that is
  // supposed to be replayable. The tie-break is total: skeleton position, then
  // lexicographic id.
  it.effect('produces the identical order for the identical input, every time', () =>
    Effect.sync(() => {
      const constraints = [stage('zebra'), stage('alpha'), stage('mike'), stage('bravo', 'zebra')]
      const runs = [order(constraints), order(constraints), order(constraints)]
      expect(runs[1]).toStrictEqual(runs[0])
      expect(runs[2]).toStrictEqual(runs[0])
    }),
  )

  // REGRESSION: the answer must not depend on the order modules happened to be
  // listed in. Otherwise "we loaded mx-ui before mx-redstone today" changes the
  // frame.
  it.effect('produces the same order regardless of the order registrations arrive in', () =>
    Effect.sync(() => {
      const forwards = [stage('a'), stage('b'), stage('c'), stage('d', 'a')]
      const backwards = [stage('d', 'a'), stage('c'), stage('b'), stage('a')]
      expect(order(forwards)).toStrictEqual(order(backwards))
    }),
  )

  it.effect('breaks a tie lexicographically when the skeleton has nothing to say', () =>
    Effect.sync(() => {
      expect(order([stage('charlie'), stage('alpha'), stage('bravo')])).toStrictEqual([
        'alpha',
        'bravo',
        'charlie',
      ])
    }),
  )

  it.effect('lets the skeleton override the lexicographic tie-break', () =>
    Effect.sync(() => {
      const skeleton = [id('zulu'), id('alpha')]
      expect(order([stage('alpha'), stage('zulu')], skeleton)).toStrictEqual(['zulu', 'alpha'])
    }),
  )

  it.effect('sorts stages the skeleton does not know after every stage it does', () =>
    Effect.sync(() => {
      const skeleton = [id('zulu')]
      expect(order([stage('alpha'), stage('zulu')], skeleton)).toStrictEqual(['zulu', 'alpha'])
    }),
  )
})

describe('cycle detection', () => {
  // REGRESSION: "your stages have a cycle" is not actionable across 15
  // repositories. The failure has to carry the path.
  it.effect('rejects a two-stage cycle and reports the actual path', () =>
    Effect.sync(() => {
      const error = failure(resolveStageOrder([stage('a', 'b'), stage('b', 'a')]))

      expect(error?._tag).toBe('StageCycle')
      const cycle = error?._tag === 'StageCycle' ? [...error.cycle] : []
      expect(cycle.length).toBeGreaterThanOrEqual(3)
      expect(cycle[0]).toBe(cycle[cycle.length - 1])
      expect(new Set(cycle)).toStrictEqual(new Set(['a', 'b']))
    }),
  )

  it.effect('rejects a three-stage cycle and reports every stage in it', () =>
    Effect.sync(() => {
      const error = failure(resolveStageOrder([stage('a', 'c'), stage('b', 'a'), stage('c', 'b')]))

      expect(error?._tag).toBe('StageCycle')
      const cycle = error?._tag === 'StageCycle' ? [...error.cycle] : []
      expect(new Set(cycle)).toStrictEqual(new Set(['a', 'b', 'c']))
      expect(cycle[0]).toBe(cycle[cycle.length - 1])
    }),
  )

  // The cycle may be a small knot inside a much larger, otherwise fine graph.
  // Reporting the whole registration set would be useless.
  it.effect('reports only the cycle, not every stage that failed to be placed behind it', () =>
    Effect.sync(() => {
      const error = failure(
        resolveStageOrder([
          stage('ok-1'),
          stage('ok-2', 'ok-1'),
          stage('knot-a', 'knot-b'),
          stage('knot-b', 'knot-a'),
          stage('downstream', 'knot-a'),
        ]),
      )

      expect(error?._tag).toBe('StageCycle')
      const cycle = error?._tag === 'StageCycle' ? [...error.cycle] : []
      expect(new Set(cycle)).toStrictEqual(new Set(['knot-a', 'knot-b']))
      expect(cycle).not.toContain('downstream')
      expect(cycle).not.toContain('ok-1')
    }),
  )

  // REGRESSION: the skeleton contributes implicit edges. A module that declares
  // an `after` pointing backwards along the skeleton creates a cycle that no
  // single module's declaration reveals — it only exists once compose merges
  // them. Catching it is exactly why the resolver, not the modules, owns order.
  it.effect('detects a cycle created by a module fighting the skeleton chain', () =>
    Effect.sync(() => {
      const skeleton = [id('early'), id('late')]
      // `early` declares it runs after `late`, but the skeleton says the
      // opposite. Neither declaration is wrong in isolation.
      const error = failure(resolveStageOrder([stage('early', 'late'), stage('late')], { skeleton }))

      expect(error?._tag).toBe('StageCycle')
    }),
  )

  it.effect('explains a cycle in a message a human can act on', () =>
    Effect.sync(() => {
      const error = failure(resolveStageOrder([stage('a', 'b'), stage('b', 'a')]))
      const message = error === undefined ? '' : describeStageOrderError(error)

      expect(message).toContain('->')
      expect(message).toContain('cycle')
      expect(message).toContain('never by deleting an `after` edge you do not own')
    }),
  )
})

describe('duplicate stage ids', () => {
  // REGRESSION: two modules claiming one id means "which one runs" is
  // arbitrary. Last-one-wins would let a mod silently replace a core stage.
  it.effect('rejects two registrations of the same id rather than picking one', () =>
    Effect.sync(() => {
      const error = failure(resolveStageOrder([stage('a'), stage('b'), stage('a')]))

      expect(error?._tag).toBe('DuplicateStage')
      expect(error?._tag === 'DuplicateStage' ? error.id : undefined).toBe('a')
    }),
  )

  it.effect('explains a duplicate in a message a human can act on', () =>
    Effect.sync(() => {
      const error = failure(resolveStageOrder([stage('a'), stage('a')]))
      const message = error === undefined ? '' : describeStageOrderError(error)
      expect(message).toContain('unique across the whole build')
    }),
  )
})

describe('dangling after-edges', () => {
  // mc-kernel domain/frame.ts: "`after` declares ordering edges only — it is
  // not a dependency on the other stage existing." A module says "run me after
  // input, if there is input" without depending on the input repository.
  it.effect('drops an edge naming an unregistered stage instead of failing', () =>
    Effect.sync(() => {
      expect(order([stage('mine', 'not-loaded')])).toStrictEqual(['mine'])
    }),
  )

  // REGRESSION: dropped silently, a typo in an `after` id is invisible — the
  // stage just runs somewhere else. Reporting makes it findable without making
  // it fatal.
  it.effect('reports every dropped edge so a typo is visible without being fatal', () =>
    Effect.sync(() => {
      const resolved = plan([stage('mine', 'not-loaded', 'also-absent'), stage('other')])

      expect([...resolved.dangling]).toStrictEqual([
        { stage: 'mine', missing: 'not-loaded' },
        { stage: 'mine', missing: 'also-absent' },
      ])
    }),
  )

  it.effect('reports nothing when every edge resolves', () =>
    Effect.sync(() => {
      expect([...plan([stage('a'), stage('b', 'a')]).dangling]).toStrictEqual([])
    }),
  )
})

describe('the standard skeleton (plan.md §4.2)', () => {
  const everyStage = STANDARD_STAGE_SKELETON.map((skeletonId) => ({ id: skeletonId }))

  it.effect('resolves a full build to exactly the skeleton order', () =>
    Effect.sync(() => {
      expect(order(everyStage, STANDARD_STAGE_SKELETON)).toStrictEqual([...STANDARD_STAGE_SKELETON])
    }),
  )

  it.effect('is input -> simulation -> camera-mirror -> chunk-sync -> render -> post-fx -> hud-sync', () =>
    Effect.sync(() => {
      const resolved = order(everyStage, STANDARD_STAGE_SKELETON)
      const at = (value: StageId): number => positionIn(resolved, value)

      expect(at(STAGE_INPUT)).toBe(0)
      expect(at(STAGE_SIM_PHYSICS)).toBeGreaterThan(at(STAGE_INPUT))
      expect(at(STAGE_CAMERA_MIRROR)).toBeGreaterThan(at(STAGE_SIM_TIME_WEATHER))
      expect(at(STAGE_CHUNK_SYNC)).toBeGreaterThan(at(STAGE_CAMERA_MIRROR))
      expect(at(STAGE_RENDER)).toBeGreaterThan(at(STAGE_CHUNK_SYNC))
      expect(at(STAGE_POST_FX)).toBeGreaterThan(at(STAGE_RENDER))
      expect(at(STAGE_HUD_SYNC)).toBe(resolved.length - 1)
    }),
  )

  it.effect('orders the six simulation sub-stages physics -> interactions -> entities -> fluids -> redstone -> time/weather', () =>
    Effect.sync(() => {
      const resolved = order(everyStage, STANDARD_STAGE_SKELETON)
      const positions = SIMULATION_STAGES.map((value) => positionIn(resolved, value))
      const ascending = [...positions].sort((left, right) => left - right)
      expect(positions).toStrictEqual(ascending)
    }),
  )

  // REGRESSION: "a build with no fluids still runs entities before redstone".
  // If the skeleton chain were built from the full list rather than the present
  // one, an absent stage would break the chain and the two neighbours would
  // fall back to the lexicographic tie-break — silently reordering the frame.
  it.effect('closes the chain over a skeleton stage that no loaded module registered', () =>
    Effect.sync(() => {
      const withoutFluids = STANDARD_STAGE_SKELETON.filter(
        (value) => value !== STAGE_SIM_FLUIDS,
      ).map((value) => ({ id: value }))

      const resolved = order(withoutFluids, STANDARD_STAGE_SKELETON)

      expect(resolved).not.toContain(STAGE_SIM_FLUIDS)
      expect(positionIn(resolved, STAGE_SIM_ENTITIES)).toBeLessThan(
        positionIn(resolved, STAGE_SIM_REDSTONE),
      )
    }),
  )

  it.effect('still resolves when only two skeleton stages are loaded', () =>
    Effect.sync(() => {
      expect(
        order([{ id: STAGE_HUD_SYNC }, { id: STAGE_INPUT }], STANDARD_STAGE_SKELETON),
      ).toStrictEqual([STAGE_INPUT, STAGE_HUD_SYNC])
    }),
  )

  // A module's own stage, unrelated to the skeleton, still lands
  // deterministically — after every skeleton stage it is not ordered against.
  it.effect('gives a module stage outside the skeleton a deterministic position', () =>
    Effect.sync(() => {
      const resolved = order(
        [
          { id: STAGE_INPUT },
          { id: STAGE_RENDER },
          { id: id('mod:extra-ores:tick'), after: [STAGE_INPUT] },
        ],
        STANDARD_STAGE_SKELETON,
      )

      expect(resolved).toStrictEqual([STAGE_INPUT, STAGE_RENDER, 'mod:extra-ores:tick'])
    }),
  )

  it.effect('lets a module pull its stage earlier with an explicit after-edge', () =>
    Effect.sync(() => {
      const resolved = order(
        [
          { id: STAGE_INPUT },
          { id: STAGE_RENDER, after: [id('mod:extra-ores:tick')] },
          { id: id('mod:extra-ores:tick'), after: [STAGE_INPUT] },
        ],
        STANDARD_STAGE_SKELETON,
      )

      expect(resolved).toStrictEqual([STAGE_INPUT, 'mod:extra-ores:tick', STAGE_RENDER])
    }),
  )
})

describe('StageId', () => {
  it.effect('rejects a blank id, so a stage cannot be registered under nothing', () =>
    Effect.sync(() => {
      expect(() => StageId('')).toThrow()
      expect(() => StageId('   ')).toThrow()
    }),
  )
})
