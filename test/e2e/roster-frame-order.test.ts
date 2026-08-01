/**
 * E2E — THE ROSTER'S REAL FRAME.
 *
 * ---------------------------------------------------------------------------
 * What this file is, and what it is honestly not
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.15 makes E2E the final gate and names what only it can see:
 * "体験モジュール間の相互作用(採掘 → インベントリ反映等)はここでしか検証できない"
 * — the interaction BETWEEN experience modules, mining showing up in the
 * inventory, can be verified nowhere else.
 *
 * That claim has two halves.
 *
 *   (a) THE FRAME. Sixteen stages, declared in six repositories that are
 *       forbidden from knowing about each other, resolve into one total order.
 *       No single repository can check that: mx-gameplay cannot see
 *       mc-render's ids, and mc-render is not entitled to know where in the
 *       frame it runs (plan.md §2.3-3). Compose is the only place the question
 *       can even be asked.
 *
 *   (b) THE BEHAVIOUR. Mining puts an item in the inventory.
 *
 * THIS FILE COVERS (a) AND NOT (b), and it cannot cover (b) today: nothing is
 * published, `node_modules` holds no `@nerima-games/*`, and mx-gameplay's break
 * rule has no mc-sim inventory to write into (docs/testing.md §3.4 records the
 * measurement). Faking the modules to get a green (b) would test the fake.
 *
 * So the subject here is `test/e2e/roster.ts` — the ids and `after` edges every
 * sibling really registers, transcribed with `file:line` provenance and kept
 * honest by `pnpm check:roster`. Those are declarations, not behaviour; reading
 * them off disk is not a compromise, it is exactly what they are.
 *
 * ---------------------------------------------------------------------------
 * Why this is not the same test as `test/stage-order.test.ts`
 * ---------------------------------------------------------------------------
 *
 * `test/stage-order.test.ts` has a block called "the skeleton constrains a REAL
 * build". Its "real build" contained `input`, `sim:physics`, `camera-mirror`,
 * `chunk-sync`, `render` and `post-fx` — SIX IDS NO REPOSITORY REGISTERS. It
 * passed, because the invented ids happen to land in the same phases as the
 * real ones. That is the failure this file exists to prevent, and it is worth
 * being blunt about: a test can assert the right property about the wrong world
 * and stay green forever.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Layer, Option, Ref } from 'effect'
import {
  composeGame,
  DeltaTimeSecs,
  EMPTY_MODULE_LAYER,
  type ComposedGame,
  type GameModule,
} from '../../src/domain/composition'
import {
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  type FrameServices,
} from '../../src/domain/kernel-vocabulary'
import {
  describeStageOrderError,
  phaseOf,
  StageId,
  stagePhase,
  type StageOrderError,
} from '../../src/domain/stage-order'
import { STANDARD_STAGE_SKELETON } from '../../src/domain/stage-skeleton'
import {
  EXPECTED_PHASE_OF,
  PLAN_4_2_FRAME,
  ROSTER,
  ROSTER_REGISTERS_NOTHING,
  ROSTER_STAGE_IDS,
  rosterModules,
} from './roster'

/** The platform clock, frozen. `render:camera-mirror` is the stage that reads it. */
const FRAME_SERVICES: Layer.Layer<FrameServices> = FixedClockLayer({
  monotonicSecs: MonotonicTimeSecs(4_242.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
})

const FRAME_DELTA: DeltaTimeSecs = DeltaTimeSecs(1 / 60)

/** Compose the real roster and hand back the game plus the execution log. */
const composeRoster = (
  options: {
    readonly skeleton?: ReadonlyArray<(typeof STANDARD_STAGE_SKELETON)[number]>
    readonly modules?: ReadonlyArray<GameModule>
  } = {},
): Effect.Effect<{
  readonly game: ComposedGame
  readonly log: Ref.Ref<ReadonlyArray<string>>
}> =>
  Effect.gen(function* () {
    const log = yield* Ref.make<ReadonlyArray<string>>([])
    const modules = options.modules ?? rosterModules(log)
    const result = composeGame(modules, {
      skeleton: options.skeleton ?? STANDARD_STAGE_SKELETON,
    })
    return { game: Either.getOrThrow(result), log }
  })

const positionIn = (order: ReadonlyArray<string>, id: string): number => {
  const at = order.indexOf(id)
  if (at === -1) {
    throw new Error(`${id} is not in the resolved frame: ${order.join(' -> ')}`)
  }
  return at
}

const namespaceOf = (id: string): string => {
  const at = id.indexOf(':')
  return at === -1 ? '' : id.slice(0, at + 1)
}

describe('the roster resolves into plan.md §4.2’s frame', () => {
  // THE headline claim of this repository, stated over the ids that are
  // actually on disk. Sixteen stages from six repositories, none of which is
  // permitted to know the others exist.
  it.effect('produces exactly the §4.2 order from the ids the roster really registers', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(game.plan.order).toStrictEqual(PLAN_4_2_FRAME)
    }),
  )

  // A resolved order is a list until something runs it. This is the same claim
  // as above, made through `runFrameWith` — which also discharges `ClockPort`,
  // because `render:camera-mirror` reads it exactly as mc-render's real one does.
  it.effect('drives execution in that order, with FrameServices discharged', () =>
    Effect.gen(function* () {
      const { game, log } = yield* composeRoster()

      // The type is the assertion: `runFrameWith` returns `Effect<void>` with
      // no requirement left, so this line would not compile if the discharge
      // were an erasure.
      const frame: Effect.Effect<void> = game.runFrameWith(FRAME_SERVICES)(FRAME_DELTA)
      yield* frame

      expect(yield* Ref.get(log)).toStrictEqual(PLAN_4_2_FRAME)
    }),
  )

  it.effect('composes all sixteen registrations and drops none of them', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(game.plan.order).toHaveLength(16)
      expect([...game.plan.order].sort()).toStrictEqual([...ROSTER_STAGE_IDS].sort())
      expect(game.moduleNames).toStrictEqual([
        'mx-gameplay',
        'mx-redstone',
        'mx-ui',
        'mc-render',
        'mc-sim',
        'mx-multiplayer',
      ])
    }),
  )

  // The resolver is handed the modules in an order that is neither the frame
  // order nor alphabetical, and mc-sim — listed FIFTH — resolves to the frame's
  // THIRD stage. Stated separately from the determinism test below because it
  // is a different claim: not "permuting the input does not matter" but "the
  // input order was never the frame order to begin with".
  it.effect('does not take the order modules arrive in for the order they run in', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(ROSTER.map((module) => module.name).indexOf('mc-sim')).toBe(4)
      expect(positionIn(game.plan.order, 'sim:physics')).toBe(2)
    }),
  )

  // Determinism, over the real roster rather than over three synthetic ids. A
  // topological sort has many valid answers; picking a different one between
  // two runs is what makes a frame-order bug reproduce only sometimes.
  it.effect('is a function of the registrations alone, not of the order they arrive in', () =>
    Effect.gen(function* () {
      const forwards = yield* composeRoster()

      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const reversedModules = rosterModules(
        log,
        [...ROSTER].reverse().map((module) => ({
          ...module,
          stages: [...module.stages].reverse(),
        })),
      )
      const backwards = Either.getOrThrow(
        composeGame(reversedModules, { skeleton: STANDARD_STAGE_SKELETON }),
      )

      expect(backwards.plan.order).toStrictEqual(forwards.game.plan.order)
    }),
  )
})

describe('every stage lands in the phase its owner said it would', () => {
  // The direction matters. Asking the skeleton where `render:camera-mirror`
  // goes and asserting the answer is a tautology; `EXPECTED_PHASE_OF` is
  // transcribed from what the OWNING repository says in prose, so this
  // compares two independent statements.
  it.effect('claims each registered id for the phase the owning repository documents', () =>
    Effect.sync(() => {
      const actual = ROSTER_STAGE_IDS.map(
        (id) => [id, phaseOf(STANDARD_STAGE_SKELETON, StageId(id))?.name ?? '(no phase)'] as const,
      )
      expect(actual).toStrictEqual(EXPECTED_PHASE_OF)
    }),
  )

  // The one that is easy to get wrong, and the reason mc-render's
  // `stages/stage-ids.ts` spends a paragraph on it. `render:input` matches the
  // `input` phase by its NAME half; it does NOT belong to `render` merely
  // because a repository called mc-render owns it. If the `render` phase ever
  // grew a `render:` NAMESPACE member, all five of mc-render's stages would
  // collapse into one phase and the frame would silently draw before it moved.
  it.effect('does not let mc-render’s prefix pull its five stages into the render phase', () =>
    Effect.sync(() => {
      const renderPhases = ROSTER_STAGE_IDS.filter((id) => id.startsWith('render:')).map(
        (id) => phaseOf(STANDARD_STAGE_SKELETON, StageId(id))?.name,
      )
      expect(renderPhases).toStrictEqual([
        'input',
        'camera-mirror',
        'chunk-sync',
        'render',
        'post-fx',
      ])
      expect(new Set(renderPhases).size).toBe(5)
    }),
  )

  it.effect('reports no unrecognised stage: the table claims the whole roster', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(game.plan.unmatchedPhase).toStrictEqual([])
    }),
  )

  /**
   * THE GUARD FOR THE NEXT TIME, and the reason this whole exercise happened.
   *
   * `unmatchedPhase` being empty (above) is the same fact, but it fails as
   * `[] !== ['x:y']` — it says a stage is unclaimed without saying that the
   * consequence is a position, and a reader can talk themselves into believing a
   * report is the whole story. It is not: a stage in no phase is not held back
   * for review, `priorityOf` answers `MAX_SAFE_INTEGER` and it RUNS LAST.
   *
   * That is exactly what happened to `multiplayer:inbound` and
   * `multiplayer:outbound`: measured at indices 14 and 15, after
   * `ui:overlay-sync`, applying remote state one frame late every frame. The
   * defect was predicted in writing by mx-multiplayer, reported faithfully by
   * the resolver, and still shipped into the manifest — because nothing failed.
   *
   * So this fails, per stage, and says where the stage would actually run.
   */
  it.effect('fails, by name, if any registered stage matches no phase and would run last', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      const homeless = ROSTER_STAGE_IDS.filter(
        (id) => phaseOf(STANDARD_STAGE_SKELETON, StageId(id)) === undefined,
      )

      expect(
        homeless,
        `${homeless.join(', ')} match no phase of STANDARD_STAGE_SKELETON. A stage in no phase is ` +
          'not deferred, it is scheduled after every stage that is in one — i.e. after the HUD. ' +
          'Either the id is a typo, or the skeleton needs a phase for this kind of work and adding ' +
          'one is an edit to domain/stage-skeleton.ts that needs a written rationale.',
      ).toStrictEqual([])

      // The consequence, stated so the assertion above cannot be weakened into
      // a spelling check: nothing in the roster is sitting at the end of the
      // frame by default rather than by placement.
      expect(game.plan.order[game.plan.order.length - 1]).toBe('ui:overlay-sync')
    }),
  )

  /**
   * Every phase in the table is now populated — there is no empty one left.
   *
   * This assertion used to read `['simulation:physics']`, the one phase nothing
   * filled, and it was written as a computed fact rather than a literal so that
   * the day mc-sim registered `sim:physics` it would fail and somebody would
   * have to look. It did, and they did; this is the other side of that.
   *
   * Kept computed for the same reason in the other direction: a module dropping
   * out of the roster now fails here and names the phase that went dark.
   */
  it.effect('leaves no skeleton phase unpopulated', () =>
    Effect.sync(() => {
      const empty = STANDARD_STAGE_SKELETON.filter(
        (phase) =>
          !ROSTER_STAGE_IDS.some((id) => phaseOf(STANDARD_STAGE_SKELETON, StageId(id)) === phase),
      ).map((phase) => phase.name)

      expect(empty).toStrictEqual([])
      expect(STANDARD_STAGE_SKELETON).toHaveLength(14)
    }),
  )
})

/**
 * The two phases this repository added to plan.md §4.2's backbone, checked
 * against what mx-multiplayer asked for rather than against what was built.
 *
 * `mx-multiplayer/stages/stage-ids.ts:59-72` does not describe where its stages
 * land — it SPECIFIES where they should, in terms of this repository's own phase
 * constants, because it measured that they landed after the HUD and could not
 * fix it from there (`StageRegistration` has `after` and no `before`). So these
 * assertions compare an answer to a request, which is the strongest form the
 * "owner's stated intent" check takes anywhere in this file.
 */
describe('network I/O: the phases §4.2 does not have', () => {
  it.effect('applies remote state BEFORE the simulation reads it, as inbound asked', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      const at = (id: string): number => positionIn(game.plan.order, id)

      // "a phase between STAGE_PHASE_INPUT and STAGE_PHASE_SIM_PHYSICS".
      expect(at('render:input')).toBeLessThan(at('multiplayer:inbound'))
      expect(at('multiplayer:inbound')).toBeLessThan(at('sim:physics'))

      // The point of the placement, not just the placement: every stage that
      // reads the simulated world runs after the remote state was applied.
      for (const reader of [
        'gameplay:interactions',
        'gameplay:entities',
        'redstone:power',
        'ui:hud-sync',
        'render:draw',
      ]) {
        expect(at('multiplayer:inbound'), `${reader} would read pre-network state`).toBeLessThan(
          at(reader),
        )
      }
    }),
  )

  it.effect('publishes settled state at the end of simulation, before any presentation', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      const at = (id: string): number => positionIn(game.plan.order, id)

      // "a phase between STAGE_PHASE_SIM_TIME_WEATHER and STAGE_PHASE_CAMERA_MIRROR".
      expect(at('gameplay:time-weather')).toBeLessThan(at('multiplayer:outbound'))
      expect(at('multiplayer:outbound')).toBeLessThan(at('render:camera-mirror'))

      // The argument for that position: nothing after it can change what would
      // be sent, and the two most expensive stages in the frame are after it.
      // Publishing later would add the frame's largest cost to network latency
      // for a value that was already final.
      for (const presentation of ['render:draw', 'render:post-fx', 'ui:hud-sync']) {
        expect(at('multiplayer:outbound'), `${presentation} would delay the send`).toBeLessThan(
          at(presentation),
        )
      }
    }),
  )

  /**
   * WHY TWO PHASES AND NOT ONE `multiplayer:` NAMESPACE PHASE — and this turned
   * out to be a sharper answer than the one written down.
   *
   * mx-multiplayer's `stages/stage-ids.ts:74-76` rejects a namespace phase
   * because "it would claim both stages for one position, and the whole point of
   * splitting them is that they belong at opposite ends of the frame". That is
   * right, and it undersells the problem. MEASURED over the real roster, there
   * is no position a single `multiplayer:` phase could take:
   *
   *   - ANYWHERE BEFORE `simulation:physics`, the composition does not merely
   *     order things badly — IT FAILS. The skeleton chains every stage of a
   *     phase ahead of every stage of the next populated one, so the phase
   *     contributes `multiplayer:outbound -> sim:physics`, while
   *     `multiplayer:outbound` declares `after: [sim:physics]`
   *     (`mx-multiplayer/stages/registration.ts:235`). That is a cycle, and no
   *     total order exists.
   *
   *   - ANYWHERE AFTER IT, `multiplayer:inbound` runs after the simulation has
   *     already read the world, which is the one-frame lag the stage exists to
   *     avoid.
   *
   * So the split is not a preference about tidiness. One phase is either
   * unsatisfiable or wrong, and the resolver says so in the first case.
   */
  it.effect('has no position at all as a single `multiplayer:` namespace phase', () =>
    Effect.gen(function* () {
      const namespacePhase = stagePhase('multiplayer', 'multiplayer:')
      const core = STANDARD_STAGE_SKELETON.filter(
        (phase) => phase.name !== 'network:inbound' && phase.name !== 'network:outbound',
      )
      const withNamespaceAt = (index: number): ReadonlyArray<(typeof core)[number]> => [
        ...core.slice(0, index),
        namespacePhase,
        ...core.slice(index),
      ]

      // One phase claims both ids — by construction, since `phaseAdmits` matches
      // the namespace half and `phaseOf` returns the first match.
      expect(phaseOf(withNamespaceAt(1), StageId('multiplayer:inbound'))).toBe(namespacePhase)
      expect(phaseOf(withNamespaceAt(1), StageId('multiplayer:outbound'))).toBe(namespacePhase)

      // Before physics: UNSATISFIABLE, and the failure carries the path.
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const beforePhysics = composeGame(rosterModules(log), { skeleton: withNamespaceAt(1) })
      const error = Option.getOrUndefined(Either.getLeft(beforePhysics))

      expect(error?._tag).toBe('StageCycle')
      expect(error === undefined ? '' : describeStageOrderError(error)).toContain(
        'multiplayer:outbound -> sim:physics -> multiplayer:outbound',
      )

      // After simulation: it resolves, and `inbound` is one frame late.
      const { game } = yield* composeRoster({ skeleton: withNamespaceAt(7) })
      expect(
        positionIn(game.plan.order, 'sim:physics'),
        'inbound would apply remote state after the simulation had read the world',
      ).toBeLessThan(positionIn(game.plan.order, 'multiplayer:inbound'))
    }),
  )

  /**
   * The cost of adding two phases for a module that may not be in every build,
   * measured rather than assumed.
   *
   * This is the strongest objection to making this change now — mx-multiplayer's
   * stages exist but its transport is a loopback, so the phases are being added
   * for a repository that cannot yet talk to anything. The answer is that the
   * phases cost nothing when unpopulated: an empty phase closes the chain rather
   * than breaking it, so a single-player or headless build resolves to exactly
   * the frame it did before the phases existed.
   */
  it.effect('costs a build without mx-multiplayer nothing at all', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const singlePlayer = rosterModules(
        log,
        ROSTER.filter((module) => module.name !== 'mx-multiplayer'),
      )
      const { game } = yield* composeRoster({ modules: singlePlayer })

      expect(game.plan.order).toStrictEqual(
        PLAN_4_2_FRAME.filter((id) => !id.startsWith('multiplayer:')),
      )
      expect(game.plan.unmatchedPhase).toStrictEqual([])
      expect(game.warnings).toStrictEqual([])
    }),
  )
})

describe('the cross-repository edges — every one of them now binds', () => {
  /**
   * THE FINDING THIS FILE WAS WRITTEN FOR, NOW CLOSED.
   *
   * This block used to assert that FOUR edges were dropped, all of them naming
   * `sim:physics`, which no repository registered. Those four were every
   * cross-repository ordering edge in the roster, so nothing the modules
   * declared ordered one repository against another and `STANDARD_STAGE_SKELETON`
   * was not merely load-bearing but load-bearing-ALL. No single repository could
   * see it: mx-gameplay declared "after sim:physics" correctly and had no way to
   * learn it was being ignored.
   *
   * mc-sim now registers `sim:physics` (`mc-sim/stages/registration.ts:167`) and
   * all four bind. The assertion is inverted rather than deleted — the count
   * that mattered was the count of DROPPED edges, so zero is the statement.
   */
  it.effect('drops nothing: no declared edge names a stage that is absent', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(game.plan.dangling).toStrictEqual([])
      expect(game.warnings).toStrictEqual([])
    }),
  )

  /**
   * Computed rather than listed, so it stays true as the roster grows — which
   * it just did. Of the thirteen `after` edges the six repositories declare,
   * eight are intra-module (a repository ordering its own stages) and FIVE cross
   * a repository boundary. All five name `sim:physics`, and all five now resolve.
   *
   * The fifth is new: `multiplayer:outbound after sim:physics`. It is worth
   * noticing that the roster's cross-repository ordering is still a star with
   * mc-sim at the centre — no experience module orders itself against another,
   * which is §2.3-1 holding.
   */
  it.effect('binds every cross-repository edge, and they all point at mc-sim', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()

      const declared = ROSTER.flatMap((module) =>
        module.stages.flatMap((stage) =>
          stage.after.map((after) => ({ stage: stage.id, missing: after })),
        ),
      )
      const crossModule = declared.filter(
        (edge) => namespaceOf(edge.stage) !== namespaceOf(edge.missing),
      )
      const intraModule = declared.filter(
        (edge) => namespaceOf(edge.stage) === namespaceOf(edge.missing),
      )

      expect(declared).toHaveLength(13)
      expect(intraModule).toHaveLength(8)
      expect(crossModule).toHaveLength(5)
      expect(new Set(crossModule.map((edge) => edge.missing))).toStrictEqual(
        new Set(['sim:physics']),
      )

      // Every declared edge — cross-module and intra-module alike — is now a
      // real ordering constraint: the named stage is in the frame, and it runs
      // before the stage that asked for it.
      for (const edge of declared) {
        expect(game.plan.order, `${edge.missing} is not in the frame`).toContain(edge.missing)
        expect(
          positionIn(game.plan.order, edge.missing),
          `${edge.stage} declares after ${edge.missing}, but does not run after it`,
        ).toBeLessThan(positionIn(game.plan.order, edge.stage))
      }
    }),
  )

  /**
   * THE PREDICTION, CHECKED AGAINST THE REAL ROSTER RATHER THAN A HYPOTHETICAL.
   *
   * This test used to build a synthetic `mc-sim` module and assert that adding
   * it would insert `sim:physics` at index 1 and move nothing else — the claim
   * being that the four dangling edges, once bound, are already implied by the
   * skeleton, so binding them costs nothing. mc-sim's own
   * `stages/stage-ids.ts:34-41` records the same measurement in prose and calls
   * the smallness the point.
   *
   * mc-sim is now in the roster, so the prediction is checked the other way
   * round: take the REAL roster, remove mc-sim, and the remaining stages must
   * hold their exact relative order. If they do not, the roster's declared edges
   * and the skeleton disagree about the frame — a disagreement that was
   * invisible for as long as the edges dangled.
   *
   * MEASURED: `sim:physics` sits at index 2 (index 1 in a build without
   * `multiplayer:inbound`, which is where the original prediction was made), and
   * the other stages keep their order exactly. The frame did not move.
   */
  it.effect('binding mc-sim’s four edges did not move any other stage', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const withoutSim = rosterModules(
        log,
        ROSTER.filter((module) => module.name !== 'mc-sim'),
      )
      const before = (yield* composeRoster({ modules: withoutSim })).game
      const after = (yield* composeRoster()).game

      // Before: the four edges name a stage nobody registers, and are dropped.
      expect(before.plan.dangling).toStrictEqual([
        { stage: 'gameplay:interactions', missing: 'sim:physics' },
        { stage: 'redstone:power', missing: 'sim:physics' },
        { stage: 'ui:hud-sync', missing: 'sim:physics' },
        { stage: 'render:camera-mirror', missing: 'sim:physics' },
        { stage: 'multiplayer:outbound', missing: 'sim:physics' },
      ])

      // After: none dropped, and the ONLY difference in the frame is that
      // `sim:physics` is in it.
      expect(after.plan.dangling).toStrictEqual([])
      expect(after.plan.order.filter((id) => id !== 'sim:physics')).toStrictEqual(before.plan.order)
      expect(positionIn(after.plan.order, 'sim:physics')).toBe(2)
    }),
  )

  /**
   * The same claim as a statement about what the declared edges are FOR.
   *
   * Binding them changed no position, which invites the reading that they are
   * redundant. They are not: before, the ordering was arranged by this
   * repository's table and the modules' stated requirements were dropped on the
   * way in and satisfied by coincidence. Now they are declared AND arranged, and
   * the difference shows up the moment the table is taken away — without the
   * skeleton, the four edges are the only thing keeping physics ahead of the
   * stages that read it.
   */
  it.effect('keeps physics ahead of its four readers even with no skeleton at all', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster({ skeleton: [] })
      const at = (id: string): number => positionIn(game.plan.order, id)

      for (const reader of [
        'gameplay:interactions',
        'redstone:power',
        'ui:hud-sync',
        'render:camera-mirror',
        'multiplayer:outbound',
      ]) {
        expect(at('sim:physics'), `${reader} would read last frame's positions`).toBeLessThan(
          at(reader),
        )
      }
    }),
  )
})

describe('the skeleton is what produces the frame — measured, not asserted', () => {
  /**
   * FINDING, and a change of degree worth recording precisely.
   *
   * This block used to be able to say something very strong: with EVERY
   * cross-repository edge dangling, removing the skeleton left only the eight
   * intra-module edges, so the skeleton was not merely load-bearing but
   * load-bearing-ALL (docs/design-notes.md DN-14). Three separate inversions
   * were listed, and each was a claim about causality inside one frame.
   *
   * BINDING mc-sim's FOUR EDGES REPAIRED TWO OF THE THREE. Re-measured against
   * the real roster with no skeleton at all, `render:input` now precedes
   * `gameplay:interactions` and `render:draw`, because those stages are reached
   * through `sim:physics` — which exists now — rather than floating free at
   * indegree zero. The declared edges are doing real ordering work for the first
   * time, which is exactly what mc-sim's registration was for.
   *
   * The skeleton is still load-bearing, and the two breakages that remain are
   * the ones no module is ALLOWED to fix: both cross an experience-module
   * boundary (§2.3-1), so no `after` edge may express them. That is the sharper
   * version of the same claim — what is left is precisely what only mc-compose
   * can say.
   */
  it.effect('without it, the frame breaks in exactly the ways no module may repair', () =>
    Effect.gen(function* () {
      const withSkeleton = (yield* composeRoster()).game.plan.order
      const withoutSkeleton = (yield* composeRoster({ skeleton: [] })).game.plan.order

      expect(withoutSkeleton).not.toStrictEqual(withSkeleton)

      const inversions: ReadonlyArray<readonly [string, string, string]> = [
        [
          'gameplay:time-weather',
          'redstone:power',
          'redstone runs after time/weather, reversing plan.md §4.2’s simulation block',
        ],
        [
          'multiplayer:outbound',
          'redstone:power',
          'the frame is published before redstone has run, i.e. mid-simulation',
        ],
      ]

      for (const [earlier, later, why] of inversions) {
        expect(positionIn(withoutSkeleton, earlier), why).toBeLessThan(
          positionIn(withoutSkeleton, later),
        )
        expect(positionIn(withSkeleton, later), `${why} (skeleton should reverse this)`).toBeLessThan(
          positionIn(withSkeleton, earlier),
        )
      }

      // The two that the newly-bound edges now hold on their own, stated so that
      // an edge going missing upstream is visible here rather than only in the
      // dangling report.
      for (const [earlier, later] of [
        ['render:input', 'gameplay:interactions'],
        ['render:input', 'render:draw'],
      ] as const) {
        expect(positionIn(withoutSkeleton, earlier)).toBeLessThan(
          positionIn(withoutSkeleton, later),
        )
      }
    }),
  )

  // A phase nobody fills closes the gap rather than breaking the chain, over
  // the real roster: drop mx-redstone entirely and the rest of §4.2 holds.
  it.effect('closes over a module that is not in the build', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const withoutRedstone = rosterModules(
        log,
        ROSTER.filter((module) => module.name !== 'mx-redstone'),
      )
      const { game } = yield* composeRoster({ modules: withoutRedstone })

      expect(game.plan.order).toStrictEqual(
        PLAN_4_2_FRAME.filter((id) => !id.startsWith('redstone:')),
      )
    }),
  )
})

describe('what the roster does not register', () => {
  it.effect('states every repository that contributes no stage, so an absence is deliberate', () =>
    Effect.sync(() => {
      expect(ROSTER_REGISTERS_NOTHING.map((entry) => entry.name)).toStrictEqual([
        'mc-worldgen',
        'mc-playground-kit',
      ])
    }),
  )

  /**
   * REGRESSION — THE DEFECT THE TWO NETWORK PHASES WERE ADDED TO FIX.
   *
   * This test used to be forward-looking, and it used an INVENTED id
   * (`multiplayer:sync`) because mx-multiplayer registered nothing: it predicted
   * that the first `multiplayer:` stage registered would match no phase, sort
   * after every stage that does, and run after the HUD.
   *
   * The prediction was exactly right, and mx-multiplayer independently measured
   * the same thing from its side (`stages/stage-ids.ts:36-51`) — indices 14 and
   * 15, after `ui:overlay-sync`, with both ids in `unmatchedPhase`.
   *
   * It now runs against the REAL ids and the real skeleton with the two network
   * phases removed, so it pins the reason those phases exist rather than a
   * hypothesis about a stage nobody had written. Delete the phases and this test
   * describes what the frame goes back to being: remote state applied one frame
   * late, every frame, and the local position published after the renderer had
   * already drawn it. Neither is a crash, which is why it needed a test.
   */
  it.effect('without the two network phases, both multiplayer stages run after the HUD', () =>
    Effect.gen(function* () {
      const withoutNetworkPhases = STANDARD_STAGE_SKELETON.filter(
        (phase) => phase.name !== 'network:inbound' && phase.name !== 'network:outbound',
      )
      expect(withoutNetworkPhases).toHaveLength(12)

      const { game } = yield* composeRoster({ skeleton: withoutNetworkPhases })

      expect(game.plan.unmatchedPhase).toStrictEqual([
        'multiplayer:inbound',
        'multiplayer:outbound',
      ])
      expect(game.plan.order.slice(-2)).toStrictEqual([
        'multiplayer:inbound',
        'multiplayer:outbound',
      ])
      // The indices mx-multiplayer measured from its side and wrote down at
      // `stages/stage-ids.ts:38-39`, reproduced here against the real resolver.
      expect(positionIn(game.plan.order, 'multiplayer:inbound')).toBe(14)
      expect(positionIn(game.plan.order, 'multiplayer:outbound')).toBe(15)

      // The two defects, stated as orderings rather than as indices.
      expect(
        positionIn(game.plan.order, 'sim:physics'),
        'remote state would be applied after the simulation read it',
      ).toBeLessThan(positionIn(game.plan.order, 'multiplayer:inbound'))
      expect(
        positionIn(game.plan.order, 'render:post-fx'),
        'the local position would be published after the renderer drew it',
      ).toBeLessThan(positionIn(game.plan.order, 'multiplayer:outbound'))

      // And it is reported, which is the resolver behaving correctly. Reporting
      // was never the problem — the report had no reader.
      for (const id of ['multiplayer:inbound', 'multiplayer:outbound']) {
        expect(
          game.warnings.some((line) => line.includes(id) && line.includes('matches no phase')),
        ).toBe(true)
      }
    }),
  )
})

describe('composition failures the roster could actually produce', () => {
  const failure = (
    result: Either.Either<ComposedGame, StageOrderError>,
  ): StageOrderError | undefined => Option.getOrUndefined(Either.getLeft(result))

  // A mod, or a second module, claiming an id mc-render already owns. Which of
  // the two would run is arbitrary, so the composition fails and names the id.
  it.effect('rejects a second module claiming render:draw, and names it', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const impostor: GameModule = {
        name: 'a-mod-that-should-not-have',
        layers: EMPTY_MODULE_LAYER,
        frameStages: [{ id: StageId('render:draw'), run: () => Effect.void }],
      }

      const result = composeGame([...rosterModules(log), impostor], {
        skeleton: STANDARD_STAGE_SKELETON,
      })

      expect(failure(result)).toStrictEqual({ _tag: 'DuplicateStage', id: 'render:draw' })
      expect(describeStageOrderError({ _tag: 'DuplicateStage', id: StageId('render:draw') })).toContain(
        'render:draw',
      )
    }),
  )

  /**
   * The cycle the roster is one edge away from, and the reason mx-ui's
   * `stages/stage-ids.ts:56-62` argues against it in prose: "the hotbar should
   * update after mining" reads like an ordering constraint on `gameplay:`.
   *
   * It is not just forbidden by plan.md §2.3-1 — with the skeleton's chain
   * running the other way it is UNSATISFIABLE, and the failure carries the
   * path. Nobody could discover that from inside mx-ui.
   */
  it.effect('reports the path when a module orders itself against a later phase', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const tempted = rosterModules(log).map((module) =>
        module.name !== 'mx-gameplay'
          ? module
          : {
              ...module,
              frameStages: module.frameStages.map((stage) =>
                stage.id !== 'gameplay:interactions'
                  ? stage
                  : { ...stage, after: [StageId('ui:hud-sync')] },
              ),
            },
      )

      const result = composeGame(tempted, { skeleton: STANDARD_STAGE_SKELETON })
      const error = failure(result)

      expect(error?._tag).toBe('StageCycle')
      const rendered = error === undefined ? '' : describeStageOrderError(error)
      expect(rendered).toContain('gameplay:interactions')
      expect(rendered).toContain('ui:hud-sync')
    }),
  )
})
