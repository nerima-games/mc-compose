import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Option } from 'effect'
import {
  describeStageOrderError,
  describeStagePlanWarnings,
  phaseOf,
  resolveStageOrder,
  StageId,
  stagePhase,
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
  type StagePhase,
} from '../src/domain/stage-order'
import {
  SIMULATION_STAGES,
  STAGE_CAMERA_MIRROR,
  STAGE_CHUNK_SYNC,
  STAGE_HUD_SYNC,
  STAGE_INPUT,
  STAGE_PHASE_SIM_FLUIDS,
  STAGE_POST_FX,
  STAGE_RENDER,
  STAGE_SIM_ENTITIES,
  STAGE_SIM_FLUIDS,
  STAGE_SIM_PHYSICS,
  STAGE_SIM_REDSTONE,
  STAGE_SIM_TIME_WEATHER,
  STANDARD_STAGE_SKELETON,
} from '../src/domain/stage-skeleton'
// The roster, transcribed from the siblings' source and kept honest by
// `pnpm check:roster`. Imported rather than restated: the hand-written copy
// this file used to carry named six stages nobody registers.
import { ROSTER, ROSTER_STAGE_IDS } from './e2e/roster'

const id = (value: string): StageId => StageId(value)

/** A skeleton of one-name phases, which is the old flat-list behaviour exactly. */
const phases = (...names: ReadonlyArray<string>): ReadonlyArray<StagePhase> =>
  names.map((name) => stagePhase(name))

/** The canonical stage id of every phase in the standard skeleton, in order. */
const skeletonStageIds: ReadonlyArray<StageId> = STANDARD_STAGE_SKELETON.map((phase) =>
  id(phase.name),
)

const stage = (name: string, ...after: ReadonlyArray<string>): StageConstraint =>
  after.length === 0 ? { id: id(name) } : { id: id(name), after: after.map(id) }

const plan = (
  constraints: ReadonlyArray<StageConstraint>,
  skeleton?: ReadonlyArray<StagePhase>,
): StageOrderPlan => Either.getOrThrow(resolveStageOrder(constraints, skeleton ? { skeleton } : {}))

const order = (
  constraints: ReadonlyArray<StageConstraint>,
  skeleton?: ReadonlyArray<StagePhase>,
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
      const skeleton = phases('zulu', 'alpha')
      expect(order([stage('alpha'), stage('zulu')], skeleton)).toStrictEqual(['zulu', 'alpha'])
    }),
  )

  it.effect('sorts stages the skeleton does not know after every stage it does', () =>
    Effect.sync(() => {
      const skeleton = phases('zulu')
      expect(order([stage('alpha'), stage('zulu')], skeleton)).toStrictEqual(['zulu', 'alpha'])
    }),
  )
})

describe('phase membership', () => {
  // REGRESSION, and the reason the skeleton is a phase list at all. It used to
  // be a flat list of concrete ids matched by string equality, and NOTHING
  // registers those ids: modules register `sim:physics`, `gameplay:fluids`,
  // `redstone:power`, `ui:hud-sync` under plan.md §4.1's
  // `<owning-repo-suffix>:<stage>` convention. So the skeleton matched nothing,
  // contributed no edge, and plan.md §4.2's backbone was decoration.
  it.effect('claims a stage by its NAME half, whatever repository prefix owns it', () =>
    Effect.sync(() => {
      const skeleton = phases('physics', 'fluids')
      expect(phaseOf(skeleton, id('sim:physics'))?.name).toBe('physics')
      expect(phaseOf(skeleton, id('gameplay:fluids'))?.name).toBe('fluids')
      // A bare id is its own name, so a module owning a whole phase may simply
      // register the phase name.
      expect(phaseOf(skeleton, id('physics'))?.name).toBe('physics')
      // ...and the deepest colon wins, so a mod's namespaced id is read the
      // same way.
      expect(phaseOf(skeleton, id('mod:extra-ores:physics'))?.name).toBe('physics')
    }),
  )

  it.effect('claims a whole NAMESPACE when the member ends in a colon', () =>
    Effect.sync(() => {
      const skeleton = [stagePhase('simulation:redstone', 'redstone', 'redstone:')]
      expect(phaseOf(skeleton, id('redstone:power'))?.name).toBe('simulation:redstone')
      expect(phaseOf(skeleton, id('redstone:effects'))?.name).toBe('simulation:redstone')
      // A namespace member matches the namespace, not a stage merely named for it.
      expect(phaseOf(skeleton, id('mod:mine:redstone'))?.name).toBe('simulation:redstone')
      expect(phaseOf(skeleton, id('redstoneish:power'))).toBeUndefined()
    }),
  )

  it.effect('gives a stage in no phase no phase, which is legal and keeps it schedulable', () =>
    Effect.sync(() => {
      expect(phaseOf(phases('physics'), id('mod:extra-ores:tick'))).toBeUndefined()
      expect(order([stage('mod:extra-ores:tick')], phases('physics'))).toStrictEqual([
        'mod:extra-ores:tick',
      ])
    }),
  )

  // The sequence is the authority: mc-render's input stage is input, even
  // though `render:` would also read as rendering.
  it.effect('resolves a stage matching two phases to the EARLIER one', () =>
    Effect.sync(() => {
      const skeleton = [stagePhase('input', 'input'), stagePhase('render', 'render', 'render:')]
      expect(phaseOf(skeleton, id('render:input'))?.name).toBe('input')
      expect(phaseOf(skeleton, id('render:draw'))?.name).toBe('render')
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
      const skeleton = phases('early', 'late')
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

describe('stages the skeleton does not recognise', () => {
  // REGRESSION: `priorityOf` answers MAX_SAFE_INTEGER for a stage in no phase,
  // so it sorts after everything the skeleton knows and contributes no implicit
  // edge — it silently falls to the end of the frame. That is LEGAL (it is how
  // a mod's stage stays schedulable) and it is also indistinguishable from a
  // typo. `dangling` had the same problem and was at least computed; this was
  // not computed at all.
  it.effect('reports a stage whose name half matches no phase, without rejecting it', () =>
    Effect.sync(() => {
      const skeleton = phases('input', 'render')
      const resolved = plan([stage('render:daw'), stage('render:draw'), stage('input')], skeleton)

      // `render:draw` matches nothing here either — this skeleton's `render`
      // phase claims the NAME `render`, not `draw`. Both are reported; neither
      // is rejected.
      expect([...resolved.unmatchedPhase]).toStrictEqual(['render:daw', 'render:draw'])
      expect(resolved.order).toContain('render:daw')
    }),
  )

  it.effect('reports nothing when every registered stage lands in a phase', () =>
    Effect.sync(() => {
      const everyStage = skeletonStageIds.map((skeletonId) => ({ id: skeletonId }))
      expect([...plan(everyStage, STANDARD_STAGE_SKELETON).unmatchedPhase]).toStrictEqual([])
    }),
  )

  // A definition, not an oversight: with no phase table there is nothing for a
  // stage to fail to match, and reporting every stage would make the field
  // noise in exactly the tests that pass no skeleton.
  it.effect('reports nothing at all when no skeleton was supplied', () =>
    Effect.sync(() => {
      expect([...plan([stage('anything'), stage('else')]).unmatchedPhase]).toStrictEqual([])
    }),
  )

  it.effect('sorts the report, so it is comparable between builds', () =>
    Effect.sync(() => {
      const resolved = plan([stage('zeta'), stage('alpha'), stage('mid')], phases('nothing-matches'))
      expect([...resolved.unmatchedPhase]).toStrictEqual(['alpha', 'mid', 'zeta'])
    }),
  )
})

describe('describeStagePlanWarnings', () => {
  // REGRESSION — the reason this function exists. `StageOrderPlan.dangling` had
  // NO consumer anywhere in the roster: the resolver computed it faithfully and
  // nothing ever looked, which makes "we report rather than reject" false in
  // practice.
  it.effect('renders a dropped edge with the idiom that makes it legal', () =>
    Effect.sync(() => {
      const lines = describeStagePlanWarnings(plan([stage('mine', 'not-loaded')]))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('mine')
      expect(lines[0]).toContain('not-loaded')
      expect(lines[0]).toContain('after input, if there is input')
    }),
  )

  it.effect('renders an unrecognised stage and says why it is not an error', () =>
    Effect.sync(() => {
      const lines = describeStagePlanWarnings(plan([stage('render:daw')], phases('render')))
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('render:daw')
      expect(lines[0]).toContain('matches no phase')
    }),
  )

  it.effect('is empty when there is nothing to say, so a host can print it unconditionally', () =>
    Effect.sync(() => {
      const everyStage = skeletonStageIds.map((skeletonId) => ({ id: skeletonId }))
      expect(describeStagePlanWarnings(plan(everyStage, STANDARD_STAGE_SKELETON))).toStrictEqual([])
    }),
  )

  it.effect('renders both kinds together', () =>
    Effect.sync(() => {
      const lines = describeStagePlanWarnings(
        plan([stage('render:daw', 'never-registered')], phases('render')),
      )
      expect(lines).toHaveLength(2)
    }),
  )
})

describe('the standard skeleton (plan.md §4.2)', () => {
  const everyStage = skeletonStageIds.map((skeletonId) => ({ id: skeletonId }))

  it.effect('resolves a full build to exactly the skeleton order', () =>
    Effect.sync(() => {
      expect(order(everyStage, STANDARD_STAGE_SKELETON)).toStrictEqual([...skeletonStageIds])
    }),
  )

  it.effect('is input -> simulation -> camera-mirror -> chunk-sync -> post-fx -> render -> hud-sync', () =>
    Effect.sync(() => {
      const resolved = order(everyStage, STANDARD_STAGE_SKELETON)
      const at = (value: StageId): number => positionIn(resolved, value)

      expect(at(STAGE_INPUT)).toBe(0)
      expect(at(STAGE_SIM_PHYSICS)).toBeGreaterThan(at(STAGE_INPUT))
      expect(at(STAGE_CAMERA_MIRROR)).toBeGreaterThan(at(STAGE_SIM_TIME_WEATHER))
      expect(at(STAGE_CHUNK_SYNC)).toBeGreaterThan(at(STAGE_CAMERA_MIRROR))
      expect(at(STAGE_POST_FX)).toBeGreaterThan(at(STAGE_CHUNK_SYNC))
      expect(at(STAGE_RENDER)).toBeGreaterThan(at(STAGE_POST_FX))
      expect(at(STAGE_HUD_SYNC)).toBe(resolved.length - 1)
    }),
  )

  it.effect('orders the nine simulation sub-stages from physics through time/weather', () =>
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
      const withoutFluids = skeletonStageIds
        .filter((value) => value !== STAGE_SIM_FLUIDS)
        .map((value) => ({ id: value }))

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

describe('the skeleton constrains a REAL build, not just its own canonical ids', () => {
  /**
   * THE REAL BUILD — every stage id in `test/e2e/roster.ts`, which
   * `pnpm check:roster` verifies line by line against the siblings' source.
   *
   * REGRESSION, and an unusually instructive one. This array used to be written
   * out by hand, under a comment claiming it was "the stage ids the roster
   * actually registers today", as:
   *
   *     input, sim:physics, gameplay:*, redstone:*,
   *     camera-mirror, chunk-sync, render, post-fx, ui:*
   *
   * SIX OF THOSE FOURTEEN ARE REGISTERED BY NOBODY. mc-render registers
   * `render:input`, `render:camera-mirror`, `render:chunk-sync`, `render:draw`
   * and `render:post-fx` — all five carrying its repository prefix, for the
   * reasons its `stages/stage-ids.ts` sets out — and mc-sim registers nothing at
   * all, so `sim:physics` does not exist either.
   *
   * Every assertion in this block passed anyway, because the invented ids land
   * in the same phases as the real ones. That is the failure mode worth
   * remembering: a test can assert exactly the right property about a world
   * that is not the one being shipped, and stay green forever. The manifest and
   * `pnpm check:roster` exist so it cannot happen again.
   *
   * The constraints are dropped on purpose: with NO `after` edges at all, the
   * skeleton is the only thing that can order these stages. Under the old flat
   * list it ordered nothing and the result was the alphabet.
   */
  const realBuild: ReadonlyArray<StageConstraint> = ROSTER_STAGE_IDS.map((value) => stage(value))

  it.effect('produces the §4.2 frame from registrations that declare no ordering at all', () =>
    Effect.sync(() => {
      expect(order(realBuild, STANDARD_STAGE_SKELETON)).toStrictEqual([
        'render:input',
        // The two network phases the skeleton adds to §4.2's backbone. With no
        // `after` edges at all, they are placed by the table alone — which is
        // the whole reason they had to be added to it: `multiplayer:inbound`
        // cannot declare "before sim:physics" from mx-multiplayer, because
        // `StageRegistration` has `after` and no `before`.
        'multiplayer:inbound',
        // No longer empty: mc-sim registers `sim:physics`. This line used to be
        // a comment explaining that the phase closed over rather than breaking
        // the chain.
        'sim:physics',
        'gameplay:interactions',
        'gameplay:fire',
        'gameplay:survival-hunger',
        'gameplay:entities',
        'gameplay:ender-dragon',
        'gameplay:fluids',
        // Two stages in one phase: mc-compose places the PHASE, and their
        // relative order falls to the tie-break unless mx-redstone declares one
        // (it does — see the next test).
        'redstone:effects',
        'redstone:power',
        'gameplay:time-weather',
        'multiplayer:outbound',
        'render:camera-mirror',
        'render:chunk-sync',
        'render:post-fx',
        'render:draw',
        'ui:hud-sync',
        'ui:overlay-sync',
      ])
    }),
  )

  // REGRESSION: the previous assertion would also pass a skeleton that did
  // nothing, if the alphabet happened to agree. It does not, and spelling out
  // the difference is what proves the skeleton is load-bearing rather than
  // decorative.
  it.effect('differs from the lexicographic fallback, which is what the old skeleton degraded to', () =>
    Effect.sync(() => {
      const withSkeleton = order(realBuild, STANDARD_STAGE_SKELETON)
      const withoutSkeleton = order(realBuild)

      // What a skeleton that matches nothing produces: `priorityOf` answers
      // MAX_SAFE_INTEGER for every id and the tie-break is the alphabet alone.
      expect(withoutSkeleton).toStrictEqual(realBuild.map((entry) => entry.id).sort())
      expect(withoutSkeleton).not.toStrictEqual(withSkeleton)

      // Concretely, under the alphabet: the world reacts to input before the
      // input stage has read it ("g" < "r"), the frame is drawn before this
      // frame's input exists ("render:d" < "render:i"), and redstone runs after
      // time/weather, reversing §4.2's simulation block ("g" < "r"). Each of
      // those is reversed by the skeleton.
      const brokenPairs: ReadonlyArray<readonly [string, string]> = [
        ['gameplay:interactions', 'render:input'],
        ['render:draw', 'render:input'],
        ['gameplay:time-weather', 'redstone:power'],
      ]

      for (const [earlier, later] of brokenPairs) {
        expect(positionIn(withoutSkeleton, earlier), `${earlier} vs ${later}`).toBeLessThan(
          positionIn(withoutSkeleton, later),
        )
        expect(positionIn(withSkeleton, later), `${later} vs ${earlier}`).toBeLessThan(
          positionIn(withSkeleton, earlier),
        )
      }
    }),
  )

  // plan.md §4.2 puts redstone BETWEEN gameplay's fluids and its time/weather
  // stage — and no module declares that, deliberately: mx-redstone's
  // `stages/stage-ids.ts` records that an `after` edge on `gameplay:fluids`
  // would couple redstone's frame position to another experience module
  // (§2.3-1). It is exactly the kind of claim only mc-compose may make, and
  // exactly what the old skeleton failed to make.
  it.effect('places redstone between fluids and time/weather, which no module is allowed to declare', () =>
    Effect.sync(() => {
      const resolved = order(realBuild, STANDARD_STAGE_SKELETON)

      expect(positionIn(resolved, 'gameplay:fluids')).toBeLessThan(
        positionIn(resolved, 'redstone:power'),
      )
      expect(positionIn(resolved, 'redstone:effects')).toBeLessThan(
        positionIn(resolved, 'gameplay:time-weather'),
      )
      expect(phaseOf(STANDARD_STAGE_SKELETON, id('gameplay:fluids'))).toBe(STAGE_PHASE_SIM_FLUIDS)
    }),
  )

  it.effect('honours the modules’ own after-edges inside a phase, without needing to know them', () =>
    Effect.sync(() => {
      // The real registrations, edges included, straight out of the manifest:
      // mx-redstone declares `effects after power`, mx-ui declares
      // `overlay-sync after hud-sync`, and four repositories declare
      // `after sim:physics` — which dangles, because mc-sim registers nothing.
      const resolved = order(
        ROSTER.flatMap((module) =>
          module.stages.map((registration) => stage(registration.id, ...registration.after)),
        ),
        STANDARD_STAGE_SKELETON,
      )

      // Now the declared edge decides inside the redstone phase, where the
      // alphabet decided before.
      expect(positionIn(resolved, 'redstone:power')).toBeLessThan(
        positionIn(resolved, 'redstone:effects'),
      )
      expect(positionIn(resolved, 'ui:hud-sync')).toBeLessThan(
        positionIn(resolved, 'ui:overlay-sync'),
      )
      // ...and the phases still hold everything else in place.
      expect(resolved[0]).toBe('render:input')
      expect(resolved[resolved.length - 1]).toBe('ui:overlay-sync')
    }),
  )

  // A build with no redstone module still runs entities before time/weather:
  // the empty phase closes rather than breaking the chain.
  it.effect('closes over a phase no loaded module populates', () =>
    Effect.sync(() => {
      const noRedstone = realBuild.filter((entry) => !entry.id.startsWith('redstone:'))
      const resolved = order(noRedstone, STANDARD_STAGE_SKELETON)

      expect(resolved).not.toContain('redstone:power')
      expect(positionIn(resolved, 'gameplay:fluids')).toBeLessThan(
        positionIn(resolved, 'gameplay:time-weather'),
      )
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
