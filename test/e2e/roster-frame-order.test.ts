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
 *   (a) THE FRAME. Thirteen stages, declared in four repositories that are
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
} from '../../domain/composition'
import {
  EpochMillis,
  FixedClockLayer,
  MonotonicTimeSecs,
  type FrameServices,
} from '../../domain/kernel-vocabulary'
import { describeStageOrderError, phaseOf, StageId, type StageOrderError } from '../../domain/stage-order'
import { STANDARD_STAGE_SKELETON } from '../../domain/stage-skeleton'
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
  // actually on disk. Thirteen stages from four repositories, none of which is
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

  it.effect('composes all thirteen registrations and drops none of them', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()
      expect(game.plan.order).toHaveLength(13)
      expect([...game.plan.order].sort()).toStrictEqual([...ROSTER_STAGE_IDS].sort())
      expect(game.moduleNames).toStrictEqual(['mx-gameplay', 'mx-redstone', 'mx-ui', 'mc-render'])
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

  // `simulation:physics` is the only phase in plan.md §4.2 that nothing fills.
  // Stating it as a computed fact rather than a literal means the day mc-sim
  // registers `sim:physics` this test fails and somebody reads the next one.
  it.effect('leaves exactly one skeleton phase unpopulated — simulation:physics', () =>
    Effect.sync(() => {
      const empty = STANDARD_STAGE_SKELETON.filter(
        (phase) =>
          !ROSTER_STAGE_IDS.some((id) => phaseOf(STANDARD_STAGE_SKELETON, StageId(id)) === phase),
      ).map((phase) => phase.name)

      expect(empty).toStrictEqual(['simulation:physics'])
    }),
  )
})

describe('the dangling edges — what the roster declares and nobody provides', () => {
  /**
   * FINDING, and the reason this file was worth writing.
   *
   * `sim:physics` is registered by NOBODY. mc-sim has no `stages/` directory;
   * its `docs/responsibility.md:50` says only that it "declares `after`
   * constraints". Yet four repositories order themselves against it:
   *
   *   mx-gameplay/stages/stage-ids.ts:71
   *   mx-redstone/stages/stage-ids.ts:57
   *   mx-ui/stages/stage-ids.ts:49
   *   mc-render/stages/stage-ids.ts:124
   *
   * A dangling edge is LEGAL by design — it is how a module says "after input,
   * if there is input" without depending on whoever owns input
   * (`domain/stage-order.ts`). What makes this one worth naming is the count:
   * see the next test.
   */
  it.effect('drops exactly four edges, all of them naming sim:physics', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()

      expect(game.plan.dangling).toStrictEqual([
        { stage: 'gameplay:interactions', missing: 'sim:physics' },
        { stage: 'redstone:power', missing: 'sim:physics' },
        { stage: 'ui:hud-sync', missing: 'sim:physics' },
        { stage: 'render:camera-mirror', missing: 'sim:physics' },
      ])
    }),
  )

  /**
   * FINDING. EVERY cross-module ordering edge in the roster dangles.
   *
   * Computed rather than listed, so it stays true as the roster grows. Of the
   * twelve `after` edges the four repositories declare, eight are intra-module
   * (a repository ordering its own two stages) and four cross a repository
   * boundary — and all four name `sim:physics`, which does not exist.
   *
   * The consequence is not "an edge was dropped". It is that NOTHING the
   * modules declare currently orders one repository against another, and the
   * §4.2 frame above is produced by `STANDARD_STAGE_SKELETON` alone. The table
   * this repository owns is not merely load-bearing — right now it is
   * load-BEARING-ALL.
   */
  it.effect('leaves the skeleton as the ONLY thing ordering one repository against another', () =>
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

      expect(declared).toHaveLength(12)
      expect(intraModule).toHaveLength(8)
      expect(crossModule).toHaveLength(4)

      // Every cross-module edge dangled; no intra-module edge did.
      expect([...game.plan.dangling]).toStrictEqual(crossModule)
      for (const edge of intraModule) {
        expect(game.plan.order).toContain(edge.missing)
      }
    }),
  )

  // The justification for not rejecting a dangling edge is that it gets
  // surfaced instead. So: a host that prints `warnings` unconditionally sees
  // all four today, and each one names the stage and the missing id.
  it.effect('surfaces all four to a host, by name', () =>
    Effect.gen(function* () {
      const { game } = yield* composeRoster()

      expect(game.warnings).toHaveLength(4)
      for (const stage of [
        'gameplay:interactions',
        'redstone:power',
        'ui:hud-sync',
        'render:camera-mirror',
      ]) {
        expect(
          game.warnings.some((line) => line.includes(stage) && line.includes('sim:physics')),
          `no warning mentions ${stage}`,
        ).toBe(true)
      }
    }),
  )

  /**
   * The forward-looking half, and the thing that makes the finding actionable
   * rather than merely alarming: when mc-sim does register `sim:physics`, the
   * four edges BIND, and binding them must not move anything.
   *
   * If this test ever fails, the roster's declared edges and plan.md §4.2's
   * skeleton disagree about the frame, and that disagreement is invisible today
   * precisely because the edges dangle.
   */
  it.effect('stays consistent with §4.2 once mc-sim registers sim:physics', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const mcSim: GameModule = {
        name: 'mc-sim',
        layers: EMPTY_MODULE_LAYER,
        frameStages: [
          {
            id: StageId('sim:physics'),
            run: () => Ref.update(log, (previous) => [...previous, 'sim:physics']),
          },
        ],
      }

      const withPhysics = Either.getOrThrow(
        composeGame([...rosterModules(log), mcSim], { skeleton: STANDARD_STAGE_SKELETON }),
      )

      expect(withPhysics.plan.dangling).toStrictEqual([])
      expect(withPhysics.plan.order).toStrictEqual([
        'render:input',
        'sim:physics',
        ...PLAN_4_2_FRAME.slice(1),
      ])
      expect(withPhysics.warnings).toStrictEqual([])
    }),
  )
})

describe('the skeleton is what produces the frame — measured, not asserted', () => {
  /**
   * With every cross-module edge dangling (above), removing the skeleton leaves
   * only the eight intra-module edges. What comes out is not a subtly different
   * frame; it is a broken one, and it is worth naming the breakages because
   * each is a claim about causality inside one frame.
   */
  it.effect('without it, input is sampled after the world has already reacted to it', () =>
    Effect.gen(function* () {
      const withSkeleton = (yield* composeRoster()).game.plan.order
      const withoutSkeleton = (yield* composeRoster({ skeleton: [] })).game.plan.order

      expect(withoutSkeleton).not.toStrictEqual(withSkeleton)

      const inversions: ReadonlyArray<readonly [string, string, string]> = [
        [
          'gameplay:interactions',
          'render:input',
          'the world acts on input before the input stage has read it',
        ],
        ['render:draw', 'render:input', 'the frame is drawn before this frame’s input exists'],
        [
          'gameplay:time-weather',
          'redstone:power',
          'redstone runs after time/weather, reversing plan.md §4.2’s simulation block',
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
        'mc-sim',
        'mx-multiplayer',
        'mc-worldgen',
        'mc-playground-kit',
      ])
    }),
  )

  /**
   * FINDING, forward-looking. plan.md §4.2's skeleton has twelve phases and not
   * one of them would claim a `multiplayer:` id — no `multiplayer` namespace
   * member, and no phase named for network work. mx-multiplayer's stage
   * registration is 未実装 (`mx-multiplayer/docs/responsibility.md:17`), so the
   * gap is currently free.
   *
   * The day it registers one, the stage matches no phase, sorts after every
   * stage that does, and RUNS AFTER THE HUD — remote peer state applied one
   * frame late, every frame, which is exactly the class of bug that reads as
   * lag rather than as a defect.
   *
   * It is reported (`unmatchedPhase`, and a `warnings` line), which is the
   * resolver behaving correctly. This test is here so the report has a reader.
   */
  it.effect('would schedule a multiplayer stage after the HUD, and says so', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const mxMultiplayer: GameModule = {
        name: 'mx-multiplayer',
        layers: EMPTY_MODULE_LAYER,
        frameStages: [
          {
            id: StageId('multiplayer:sync'),
            run: () => Ref.update(log, (previous) => [...previous, 'multiplayer:sync']),
          },
        ],
      }

      const { game } = yield* composeRoster({
        modules: [...rosterModules(log), mxMultiplayer],
      })

      expect(game.plan.unmatchedPhase).toStrictEqual(['multiplayer:sync'])
      expect(game.plan.order[game.plan.order.length - 1]).toBe('multiplayer:sync')
      expect(positionIn(game.plan.order, 'ui:overlay-sync')).toBeLessThan(
        positionIn(game.plan.order, 'multiplayer:sync'),
      )
      expect(
        game.warnings.some(
          (line) => line.includes('multiplayer:sync') && line.includes('matches no phase'),
        ),
      ).toBe(true)
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
