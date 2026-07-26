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
 * `chunk-sync`, `render` and `post-fx`. NOT ONE of those six is registered by
 * anybody. mc-render registers `render:input`, `render:camera-mirror`,
 * `render:chunk-sync`, `render:draw` and `render:post-fx`; mc-sim registers
 * nothing at all. The tests passed because the fictional ids happen to land in
 * the same phases as the real ones — a green test over a roster that does not
 * exist, which is the precise failure mode this file is written against.
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
 * The four repositories mc-compose is allowed to import (docs/responsibility.md
 * §3.1: the four experience modules plus mc-render), in the order
 * `composeGame` would receive them from a host. The order is deliberately NOT
 * the frame order — `test/e2e/roster-frame-order.test.ts` asserts that the
 * resolver does not care.
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
        declaredAt: 'mx-gameplay/stages/registration.ts:164',
        idAt: 'mx-gameplay/stages/stage-ids.ts:41',
      },
      {
        id: 'gameplay:entities',
        after: ['gameplay:interactions'],
        declaredAt: 'mx-gameplay/stages/registration.ts:223',
        idAt: 'mx-gameplay/stages/stage-ids.ts:43',
      },
      {
        id: 'gameplay:fluids',
        after: ['gameplay:entities'],
        declaredAt: 'mx-gameplay/stages/registration.ts:259',
        idAt: 'mx-gameplay/stages/stage-ids.ts:45',
      },
      {
        id: 'gameplay:time-weather',
        after: ['gameplay:fluids'],
        declaredAt: 'mx-gameplay/stages/registration.ts:274',
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
        idAt: 'mx-redstone/stages/stage-ids.ts:44',
      },
    ],
  },
  {
    name: 'mx-ui',
    stages: [
      {
        id: 'ui:hud-sync',
        after: ['sim:physics'],
        declaredAt: 'mx-ui/stages/registration.ts:91',
        idAt: 'mx-ui/stages/stage-ids.ts:36',
      },
      {
        id: 'ui:overlay-sync',
        after: ['ui:hud-sync'],
        declaredAt: 'mx-ui/stages/registration.ts:104',
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
        declaredAt: 'mc-render/stages/registration.ts:227',
        idAt: 'mc-render/stages/stage-ids.ts:85',
      },
      {
        id: 'render:camera-mirror',
        after: ['sim:physics'],
        declaredAt: 'mc-render/stages/registration.ts:279',
        idAt: 'mc-render/stages/stage-ids.ts:92',
      },
      {
        id: 'render:chunk-sync',
        after: ['render:camera-mirror'],
        declaredAt: 'mc-render/stages/registration.ts:304',
        idAt: 'mc-render/stages/stage-ids.ts:94',
      },
      {
        id: 'render:draw',
        after: ['render:chunk-sync'],
        declaredAt: 'mc-render/stages/registration.ts:332',
        idAt: 'mc-render/stages/stage-ids.ts:96',
      },
      {
        id: 'render:post-fx',
        after: ['render:draw'],
        declaredAt: 'mc-render/stages/registration.ts:344',
        idAt: 'mc-render/stages/stage-ids.ts:105',
      },
    ],
  },
]

/**
 * Repositories that register NO stage, stated rather than left to inference.
 *
 * An absence that nobody wrote down is indistinguishable from an oversight, and
 * `mc-sim` below is the reason this array exists at all: FOUR repositories
 * declare `after: [StageId('sim:physics')]` and mc-sim has no `stages/`
 * directory. Leaving that as "mc-sim is simply not in the roster yet" is how it
 * stays unnoticed until the shipped build has no physics in the frame.
 *
 * `pnpm check:roster` verifies each of these still registers nothing, so the
 * day mc-sim gains a `stages/` directory this file fails rather than quietly
 * continuing to describe a roster that has moved on.
 */
export const ROSTER_REGISTERS_NOTHING: ReadonlyArray<{
  readonly name: string
  readonly why: string
}> = [
  {
    name: 'mc-sim',
    why:
      'No `stages/` directory at all, and `docs/responsibility.md:50` says only that mc-sim "declares `after` ' +
      'constraints". But `sim:physics` is named in an `after` edge by mx-gameplay, mx-redstone, mx-ui AND ' +
      'mc-render — every cross-module ordering edge in the entire roster points at it. Today all four dangle.',
  },
  {
    name: 'mx-multiplayer',
    why:
      '`docs/responsibility.md:17` marks stage registration 未実装 (not implemented), pending mc-kernel\'s ' +
      'publication. Note that plan.md §4.2\'s skeleton has no phase a `multiplayer:` id would match, so the ' +
      'first one registered will land at the END of the frame — see the roster test that pins this.',
  },
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
 * The frame plan.md §4.2 asks for, spelled in the ids the roster REALLY
 * registers.
 *
 * docs/architecture.md §4.3 prints the same table against a column of example
 * ids (`sim:physics`, `camera-mirror`, `render`, …). This is that column
 * corrected to what is on disk, which is the whole point: a backbone that
 * orders ids nobody registers orders nothing.
 *
 * `simulation:physics` has no line because no module populates it.
 */
export const PLAN_4_2_FRAME: ReadonlyArray<string> = [
  'render:input', //          input
  //                          simulation:physics      — EMPTY. Nobody registers one.
  'gameplay:interactions', //  simulation:interactions
  'gameplay:entities', //      simulation:entities
  'gameplay:fluids', //        simulation:fluids
  'redstone:power', //         simulation:redstone     — mx-redstone orders these two
  'redstone:effects', //       simulation:redstone       against each other
  'gameplay:time-weather', //  simulation:time-weather
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
