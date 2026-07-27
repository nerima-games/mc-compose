/**
 * THE ROSTER MANIFEST — every frame stage the sixteen repositories actually
 * register today, transcribed with provenance.
 *
 * ---------------------------------------------------------------------------
 * Why a transcription and not an import
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes bottom-up and NOTHING IS PUBLISHED YET.
 * `package.json` of this repository declares exactly one dependency (`effect`),
 * `node_modules` contains no `@nerima-games/*` at all, and every sibling
 * declares only `effect` too. So mc-compose cannot `import { gameplayModule }
 * from '@nerima-games/mx-gameplay'`, and no amount of wanting changes that.
 *
 * The two dishonest answers are:
 *
 *   - invent four plausible modules and compose those. That tests the
 *     invention. `test/composition.test.ts` already composes invented modules,
 *     on purpose, to test the ALGORITHM; doing it again and calling it E2E
 *     would be a green light with nothing behind it.
 *   - wait for the publish. Then this repository is the one built last, with no
 *     E2E, which is exactly what docs/porting.md §3 says not to do.
 *
 * The honest answer is that the ids and the `after` edges are NOT behaviour.
 * They are declarations, they are readable from the siblings' source today, and
 * whether they compose into plan.md §4.2's frame is a question no single
 * repository can answer — mx-gameplay cannot see mc-render's stages, and
 * mc-render is forbidden from knowing where in the frame it runs. That question
 * is exactly what mc-compose exists to answer, so it is what this file feeds.
 *
 * ---------------------------------------------------------------------------
 * What keeps a transcription from going stale
 * ---------------------------------------------------------------------------
 *
 * Nothing, on its own — and this repository has already been bitten. Before
 * this file existed, `test/public-api.test.ts` and `test/stage-order.test.ts`
 * both asserted against a list called "the stage ids the roster actually
 * registers today" containing `input`, `sim:physics`, `camera-mirror`,
 * `chunk-sync`, `render` and `post-fx`. NOT ONE of those six was registered by
 * anybody at the time. mc-render registers `render:input`,
 * `render:camera-mirror`, `render:chunk-sync`, `render:draw` and
 * `render:post-fx`; mc-sim registered nothing at all. The tests passed because
 * the fictional ids happen to land in the same phases as the real ones — a
 * green test over a roster that does not exist, which is the precise failure
 * mode this file is written against.
 *
 * mc-sim has since registered `sim:physics`, so ONE of those six invented ids
 * now names a real stage. That is not a vindication of the guess and it is the
 * best possible illustration of the problem: a fiction that later comes true is
 * still a test of the fiction while it is false, and nothing in the old list
 * would have changed on the day it stopped being wrong.
 *
 * So the transcription is paired with a gate: `pnpm check:roster`
 * (`scripts/check-roster-manifest.ts`) parses the siblings' real
 * `stages/stage-ids.ts` and `stages/registration.ts` and fails if they disagree
 * with what is written below. That gate needs the sibling checkouts, which CI
 * does not have, so it is NOT part of `pnpm verify` — see docs/testing.md §3.5.
 *
 * Every entry below carries the `file:line` it was read from, so the gate's
 * failure message and a human's re-check land in the same place.
 *
 * Transcribed 2026-07-27 from the WORKING COPIES at `nerima-games/<repo>` — the
 * checkouts that get committed, not the `mc-dev-meta/repos` mirror, which was
 * already seventeen lines behind on `mc-render/stages/registration.ts` the first
 * time this gate compared the two.
 */

import { Effect, Ref } from 'effect'
import { EMPTY_MODULE_LAYER, type GameModule, type StageRegistration } from '../../domain/composition'
import { monotonicSecs } from '../../domain/kernel-vocabulary'
import { StageId } from '../../domain/stage-order'

/** One `StageRegistration` as some repository actually writes it down. */
export type RosterStage = {
  /** The id, verbatim. */
  readonly id: string
  /** Its `after` constraints, verbatim and in declaration order. */
  readonly after: ReadonlyArray<string>
  /** `<repo>/stages/registration.ts:<line>` — where the registration lives. */
  readonly declaredAt: string
  /** `<repo>/stages/stage-ids.ts:<line>` — where the id is minted. */
  readonly idAt: string
}

/** One repository's contribution to the frame. */
export type RosterModule = {
  /** The repository name, as `GameModule.name` will carry it. */
  readonly name: string
  readonly stages: ReadonlyArray<RosterStage>
}

/**
 * Every repository that registers a frame stage, in the order `composeGame`
 * would receive them from a host. The order is deliberately NOT the frame order
 * — `test/e2e/roster-frame-order.test.ts` asserts that the resolver does not
 * care. mc-sim is listed fifth and registers the frame's SECOND stage.
 *
 * ---------------------------------------------------------------------------
 * "Registers a stage" is not the same list as "mc-compose may import"
 * ---------------------------------------------------------------------------
 *
 * This array used to say it was the repositories mc-compose is allowed to
 * import (docs/responsibility.md §3.1: the four experience modules plus
 * mc-render). That is no longer the same set and the difference is worth
 * stating rather than quietly widening: MC-COMPOSE MAY NOT IMPORT MC-SIM. It
 * reaches it only transitively, so `pnpm check:deps` rejects the import as a
 * `transitive-import` violation (`scripts/check-dependency-whitelist.ts` rule
 * 3), and that is deliberate — a rule that needs mc-sim directly is a rule that
 * belongs in an experience module.
 *
 * That is not a problem for this manifest, because the manifest is a
 * TRANSCRIPTION of what each repository registers, not a list of imports: it is
 * read from the siblings' source by eye and by `pnpm check:roster`, and no line
 * of this repository imports any of them (nothing is published anyway — see the
 * file header).
 *
 * It is a real question for a host, and an open one: somebody has to hand
 * mc-sim's `GameModule` to `composeGame`, and it cannot be mc-compose. That is
 * the same unresolved question docs/e2e-triage.md §4.3 asks about who builds
 * `InventoryService`, and mc-sim's `stages/registration.ts` records its own half
 * of it. Registering a stage and being importable are simply different
 * properties, and the frame only needs the first.
 */
export const ROSTER: ReadonlyArray<RosterModule> = [
  {
    name: 'mx-gameplay',
    stages: [
      {
        id: 'gameplay:interactions',
        // Dangling. `sim:physics` is registered by nobody — see
        // `ROSTER_REGISTERS_NOTHING` below.
        after: ['sim:physics'],
        declaredAt: 'mx-gameplay/stages/registration.ts:496',
        idAt: 'mx-gameplay/stages/stage-ids.ts:41',
      },
      {
        id: 'gameplay:entities',
        after: ['gameplay:interactions'],
        declaredAt: 'mx-gameplay/stages/registration.ts:696',
        idAt: 'mx-gameplay/stages/stage-ids.ts:43',
      },
      {
        id: 'gameplay:fluids',
        after: ['gameplay:entities'],
        declaredAt: 'mx-gameplay/stages/registration.ts:896',
        idAt: 'mx-gameplay/stages/stage-ids.ts:45',
      },
      {
        id: 'gameplay:time-weather',
        after: ['gameplay:fluids'],
        declaredAt: 'mx-gameplay/stages/registration.ts:911',
        idAt: 'mx-gameplay/stages/stage-ids.ts:47',
      },
    ],
  },
  {
    name: 'mx-redstone',
    stages: [
      {
        id: 'redstone:power',
        after: ['sim:physics'],
        declaredAt: 'mx-redstone/stages/registration.ts:128',
        idAt: 'mx-redstone/stages/stage-ids.ts:38',
      },
      {
        id: 'redstone:effects',
        after: ['redstone:power'],
        declaredAt: 'mx-redstone/stages/registration.ts:155',
        idAt: 'mx-redstone/stages/stage-ids.ts:49',
      },
    ],
  },
  {
    name: 'mx-ui',
    stages: [
      {
        id: 'ui:hud-sync',
        after: ['sim:physics'],
        declaredAt: 'mx-ui/stages/registration.ts:103',
        idAt: 'mx-ui/stages/stage-ids.ts:36',
      },
      {
        id: 'ui:overlay-sync',
        after: ['ui:hud-sync'],
        declaredAt: 'mx-ui/stages/registration.ts:116',
        idAt: 'mx-ui/stages/stage-ids.ts:38',
      },
    ],
  },
  {
    name: 'mc-render',
    stages: [
      {
        id: 'render:input',
        // No `after`, and the comment above the registration says why: "where
        // that lands in the frame is mc-compose's to decide — its skeleton
        // claims the NAME half of this id (`input`) for the first phase."
        after: [],
        declaredAt: 'mc-render/stages/registration.ts:232',
        idAt: 'mc-render/stages/stage-ids.ts:85',
      },
      {
        id: 'render:camera-mirror',
        after: ['sim:physics'],
        declaredAt: 'mc-render/stages/registration.ts:291',
        idAt: 'mc-render/stages/stage-ids.ts:92',
      },
      {
        id: 'render:chunk-sync',
        after: ['render:camera-mirror'],
        declaredAt: 'mc-render/stages/registration.ts:316',
        idAt: 'mc-render/stages/stage-ids.ts:94',
      },
      {
        id: 'render:draw',
        after: ['render:chunk-sync'],
        declaredAt: 'mc-render/stages/registration.ts:344',
        idAt: 'mc-render/stages/stage-ids.ts:96',
      },
      {
        id: 'render:post-fx',
        after: ['render:draw'],
        declaredAt: 'mc-render/stages/registration.ts:356',
        idAt: 'mc-render/stages/stage-ids.ts:105',
      },
    ],
  },
  {
    name: 'mc-sim',
    stages: [
      {
        id: 'sim:physics',
        // No `after`, and uniquely in the roster it is the ABSENCE that is
        // argued for rather than the edges: `mc-sim/stages/stage-ids.ts:89-121`
        // gives three reasons it declares none — an `after: [render:input]`
        // would be a claim about the global order §2.3-3 reserves to
        // mc-compose, mc-render depends on mc-sim so the reverse edge would
        // invert the graph while evading `pnpm check:deps` (an `after` is a
        // string), and a headless build with no input stage is still a correct
        // simulation.
        //
        // THIS IS THE STAGE THE OTHER FOUR REPOSITORIES WERE ALL WAITING FOR.
        // Every cross-repository `after` edge in the roster names it, and until
        // it existed all four dangled.
        after: [],
        declaredAt: 'mc-sim/stages/registration.ts:167',
        idAt: 'mc-sim/stages/stage-ids.ts:86',
      },
    ],
  },
  {
    name: 'mx-multiplayer',
    stages: [
      {
        id: 'multiplayer:inbound',
        // No `after`. Its requirement is to run BEFORE `sim:physics` and
        // `StageRegistration` has no `before`, so it cannot be declared from
        // mx-multiplayer at all — the placement had to come from this
        // repository's skeleton. `mx-multiplayer/stages/registration.ts:189-191`
        // names `render:input` as the precedent, which declares no `after`
        // either for the same reason.
        after: [],
        declaredAt: 'mx-multiplayer/stages/registration.ts:188',
        idAt: 'mx-multiplayer/stages/stage-ids.ts:125',
      },
      {
        id: 'multiplayer:outbound',
        // The roster's FIFTH cross-repository edge, and the first that is not
        // about `sim:physics` existing but about what it produced: publish the
        // position the simulation resolved THIS frame, not the pre-integration
        // one. Same argument as `render:camera-mirror after sim:physics`, aimed
        // at the far end of a socket.
        after: ['sim:physics'],
        declaredAt: 'mx-multiplayer/stages/registration.ts:234',
        idAt: 'mx-multiplayer/stages/stage-ids.ts:147',
      },
    ],
  },
]

/**
 * Repositories that register NO stage, stated rather than left to inference.
 *
 * An absence that nobody wrote down is indistinguishable from an oversight, so
 * `pnpm check:roster` verifies each of these still registers nothing: the day
 * one of them grows a `stages/` directory, the gate fails rather than quietly
 * continuing to describe a roster that has moved on.
 *
 * ---------------------------------------------------------------------------
 * THE TRIPWIRE HAS FIRED ONCE, AND IT WORKED
 * ---------------------------------------------------------------------------
 *
 * `mc-sim` and `mx-multiplayer` were both on this list, and both are now in
 * `ROSTER` above. They were not moved because somebody noticed — they were moved
 * because `compareSilentModule` failed, named the ids it had parsed
 * (`sim:physics`; `multiplayer:inbound`, `multiplayer:outbound`) and said the
 * frame had changed. That is the entire justification for stating an absence
 * instead of leaving it to inference, and it is worth recording that the
 * mechanism paid for itself:
 *
 *   - mc-sim was the reason this array exists. FOUR repositories declared
 *     `after: [StageId('sim:physics')]` against a repository with no `stages/`
 *     directory, so every cross-repository ordering edge in the roster dangled
 *     and `STANDARD_STAGE_SKELETON` was the only thing ordering one repository
 *     against another. All four now bind.
 *
 *   - mx-multiplayer's entry predicted, in writing, that the first
 *     `multiplayer:` id registered would land at the END of the frame because
 *     the skeleton had no phase for it. It did — measured at indices 14 and 15,
 *     after `ui:overlay-sync`. The prediction was right, which is why the fix
 *     was two new phases in the skeleton rather than a surprise.
 */
export const ROSTER_REGISTERS_NOTHING: ReadonlyArray<{
  readonly name: string
  readonly why: string
}> = [
  {
    name: 'mc-worldgen',
    why: 'A foundation service (a NOUN). Its work happens inside other modules\' stages.',
  },
  {
    name: 'mc-playground-kit',
    why:
      'Dev-only, banned from `dependencies` by rule 6 of `scripts/check-dependency-whitelist.ts`, and it ' +
      'consumes stages rather than registering any. It used to register `input:sample`; mc-render\'s ' +
      '`stages/stage-ids.ts` header records why that was the shipped build having no input stage at all.',
  },
]

/**
 * The frame the skeleton asks for, spelled in the ids the roster REALLY
 * registers.
 *
 * docs/architecture.md §4.3 prints the same table against a column of example
 * ids (`sim:physics`, `camera-mirror`, `render`, …). This is that column
 * corrected to what is on disk, which is the whole point: a backbone that
 * orders ids nobody registers orders nothing.
 *
 * EVERY PHASE IS NOW POPULATED. `simulation:physics` used to have no line —
 * mc-sim registered nothing — and it was the only empty one. It is filled, and
 * the two network phases arrived with a module already registering both, so
 * there is no phase in the table that nothing fills. The e2e suite asserts that
 * as a computed fact rather than a literal, so the day a module drops out the
 * test says which phase went dark.
 *
 * The two lines marked EXTENSION are the phases plan.md §4.2 does not have; see
 * `domain/stage-skeleton.ts`.
 */
export const PLAN_4_2_FRAME: ReadonlyArray<string> = [
  'render:input', //           input
  'multiplayer:inbound', //    network:inbound         — EXTENSION (not in §4.2)
  'sim:physics', //            simulation:physics
  'gameplay:interactions', //  simulation:interactions
  'gameplay:entities', //      simulation:entities
  'gameplay:fluids', //        simulation:fluids
  'redstone:power', //         simulation:redstone     — mx-redstone orders these two
  'redstone:effects', //       simulation:redstone       against each other
  'gameplay:time-weather', //  simulation:time-weather
  'multiplayer:outbound', //   network:outbound        — EXTENSION (not in §4.2)
  'render:camera-mirror', //   camera-mirror
  'render:chunk-sync', //      chunk-sync
  'render:draw', //            render
  'render:post-fx', //         post-fx
  'ui:hud-sync', //            hud-sync                — mx-ui orders these two
  'ui:overlay-sync', //        hud-sync                  against each other
]

/**
 * The phase each registered id must land in, transcribed from the OWNING
 * repository's stated intent rather than from `STANDARD_STAGE_SKELETON`.
 *
 * That direction matters. Asking the skeleton where `render:camera-mirror` goes
 * and then asserting the answer is a tautology. mc-render's
 * `stages/stage-ids.ts:60-71` states, in prose, which phase each of its five
 * ids expects to be claimed by; this array is that prose, and the test compares
 * it against what the table actually does.
 *
 * In `ROSTER_STAGE_IDS` order — i.e. registration order, NOT frame order — so
 * that the comparison cannot accidentally be satisfied by a sort.
 */
export const EXPECTED_PHASE_OF: ReadonlyArray<readonly [string, string]> = [
  ['gameplay:interactions', 'simulation:interactions'],
  ['gameplay:entities', 'simulation:entities'],
  ['gameplay:fluids', 'simulation:fluids'],
  ['gameplay:time-weather', 'simulation:time-weather'],
  ['redstone:power', 'simulation:redstone'],
  ['redstone:effects', 'simulation:redstone'],
  ['ui:hud-sync', 'hud-sync'],
  ['ui:overlay-sync', 'hud-sync'],
  // mc-render's five. Note `render:input` -> `input`, NOT `render`: its NAME
  // half is `input`, and a stage matching two phases belongs to the earliest.
  ['render:input', 'input'],
  ['render:camera-mirror', 'camera-mirror'],
  ['render:chunk-sync', 'chunk-sync'],
  ['render:draw', 'render'],
  ['render:post-fx', 'post-fx'],
  // mc-sim's one stage. `mc-sim/stages/registration.ts:83-88` states the
  // expectation in prose — "the skeleton puts `simulation:physics` FIRST in
  // simulation, so every stage in the frame that reads the hour reads the hour
  // of the frame it is running in" — and argues at length against the two
  // alternative names it considered (`sim:time-weather`, `sim:clock`), both of
  // which would have landed somewhere else.
  ['sim:physics', 'simulation:physics'],
  // mx-multiplayer's two, and these are the only entries in this table whose
  // phase did not exist when the owning repository wrote the prose.
  // `mx-multiplayer/stages/stage-ids.ts:59-72` does not name a phase it can
  // point at; it SPECIFIES one — "a phase between `STAGE_PHASE_INPUT` and
  // `STAGE_PHASE_SIM_PHYSICS`, whose `members` claim the stage name `inbound`",
  // and likewise for `outbound` between `STAGE_PHASE_SIM_TIME_WEATHER` and
  // `STAGE_PHASE_CAMERA_MIRROR`. So this pair compares mc-compose's answer
  // against a written request rather than against a description, which is a
  // stronger check than the rest of the table gets.
  ['multiplayer:inbound', 'network:inbound'],
  ['multiplayer:outbound', 'network:outbound'],
]

/** Every registered id, flattened. */
export const ROSTER_STAGE_IDS: ReadonlyArray<string> = ROSTER.flatMap((module) =>
  module.stages.map((stage) => stage.id),
)

// ---------------------------------------------------------------------------
// Turning the manifest into something `composeGame` accepts
// ---------------------------------------------------------------------------

/**
 * The manifest as composable `GameModule`s.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING A GREEN RUN
 * ---------------------------------------------------------------------------
 *
 * The `run` bodies below are NOT the modules' real bodies. They append their id
 * to a log and, for `render:camera-mirror`, read the clock — because
 * mc-render's real `render:camera-mirror` is the one stage in the whole roster
 * that touches `FrameServices` (`mc-render/stages/registration.ts:280-284`), so
 * a frame assembled from this manifest exercises the real discharge path rather
 * than a `never` one.
 *
 * What that buys and what it does not:
 *
 *   VERIFIED — the ids, the `after` edges, the phase memberships, the total
 *   order they resolve to, which edges dangle, which phases are empty, and that
 *   the resolved order is what actually drives execution.
 *
 *   NOT VERIFIED — anything a stage DOES. Whether mining puts an item in the
 *   inventory is not visible here and cannot be until mc-sim and mx-gameplay
 *   publish. docs/testing.md §3.4 says which half of plan.md §3.15's claim that
 *   leaves uncovered, and says it in those words.
 *
 * `layers` is `EMPTY_MODULE_LAYER` for the same reason: a module's real Layer
 * is not readable from here. What IS checkable about the Layers — that
 * `ModuleLayer` forces `RIn = never`, so a module must arrive self-contained —
 * is a compile-time property and is pinned in `test/composition.test.ts`.
 */
export const rosterModules = (
  log: Ref.Ref<ReadonlyArray<string>>,
  only: ReadonlyArray<RosterModule> = ROSTER,
): ReadonlyArray<GameModule> =>
  only.map((module) => ({
    name: module.name,
    layers: EMPTY_MODULE_LAYER,
    frameStages: module.stages.map((stage) => rosterStageRegistration(log, stage)),
  }))

const rosterStageRegistration = (
  log: Ref.Ref<ReadonlyArray<string>>,
  stage: RosterStage,
): StageRegistration => {
  const record = Ref.update(log, (previous) => [...previous, stage.id])
  const base = {
    id: StageId(stage.id),
    // `exactOptionalPropertyTypes` is on: an `after: undefined` is not the same
    // as an absent `after`, and mc-render's `render:input` has an absent one.
    ...(stage.after.length === 0
      ? {}
      : { after: stage.after.map((after) => StageId(after)) }),
  }

  return stage.id === 'render:camera-mirror'
    ? {
        ...base,
        run: () =>
          Effect.flatMap(monotonicSecs, () => record),
      }
    : { ...base, run: () => record }
}
