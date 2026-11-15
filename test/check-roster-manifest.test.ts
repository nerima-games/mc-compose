/**
 * Tests for `scripts/check-roster-manifest.ts` — the gate that keeps the E2E
 * roster manifest from drifting away from what the siblings actually register.
 *
 * The gate itself cannot run in CI (it needs the sibling source checkouts to
 * compare manifests; published package contracts do not carry that provenance
 * — see the script's header). These tests can: they drive it
 * through an in-memory filesystem, so `pnpm verify` still proves the gate
 * WORKS even where it cannot prove the manifest is CURRENT.
 *
 * That split is the whole point. A stale-detector nobody has tested is worth
 * about as much as the stale manifest it was supposed to catch.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  compareModule,
  compareSilentModule,
  findRosterRoot,
  parseRegistrations,
  parseStageIds,
  requiredRepositories,
  rosterRootCandidates,
  run,
  type Io,
} from '../scripts/check-roster-manifest'
import { ROSTER, ROSTER_REGISTERS_NOTHING, type RosterModule } from './e2e/roster'

// ---------------------------------------------------------------------------
// Fixtures — shaped exactly like the siblings' real files
// ---------------------------------------------------------------------------

const STAGE_IDS_SOURCE = `import { StageId } from '@nerima-games/mc-kernel'

export const GAMEPLAY_STAGE_IDS = {
  /** doc */
  interactions: StageId('gameplay:interactions'),
  entities: StageId('gameplay:entities'),
} as const

export const UPSTREAM_STAGE_IDS = {
  simPhysics: StageId('sim:physics'),
} as const
`
// `interactions` is on line 5, `entities` on line 6, `simPhysics` on line 10.

const REGISTRATION_SOURCE = `import { GAMEPLAY_STAGE_IDS, UPSTREAM_STAGE_IDS } from './stage-ids'

export const gameplayStages = () => [
  {
    id: GAMEPLAY_STAGE_IDS.interactions,
    after: [UPSTREAM_STAGE_IDS.simPhysics],
    run: () => Effect.void,
  },
  {
    id: GAMEPLAY_STAGE_IDS.entities,
    after: [GAMEPLAY_STAGE_IDS.interactions],
    run: () => Effect.void,
  },
]
`
// `id:` on lines 5 and 10.

const MANIFEST: RosterModule = {
  name: 'mx-gameplay',
  stages: [
    {
      id: 'gameplay:interactions',
      after: ['sim:physics'],
      declaredAt: 'mx-gameplay/src/stages/registration.ts:5',
      idAt: 'mx-gameplay/src/stages/stage-ids.ts:5',
    },
    {
      id: 'gameplay:entities',
      after: ['gameplay:interactions'],
      declaredAt: 'mx-gameplay/src/stages/registration.ts:10',
      idAt: 'mx-gameplay/src/stages/stage-ids.ts:6',
    },
  ],
}

const ioOf = (files: Readonly<Record<string, string>>): Io => ({
  readFile: (at) => files[at.replace(/\\/gu, '/')],
  directoryExists: (at) =>
    Object.keys(files).some((file) => file.startsWith(`${at.replace(/\\/gu, '/')}/`)),
})

const FILES: Readonly<Record<string, string>> = {
  '/roster/mx-gameplay/src/stages/stage-ids.ts': STAGE_IDS_SOURCE,
  '/roster/mx-gameplay/src/stages/registration.ts': REGISTRATION_SOURCE,
}

// ---------------------------------------------------------------------------

describe('parsing a sibling’s stage ids', () => {
  it.effect('follows constructor import aliases, const aliases and object spreads to the minting line', () =>
    Effect.sync(() => {
      const ids = parseStageIds('stage-ids.ts', `import { StageId as makeStageId } from '@nerima-games/mc-kernel'
const stageId = makeStageId
const FIRST = { first: stageId('sample:first') } as const
const SECOND = { second: makeStageId('sample:second') } as const
export const STAGES = { ...FIRST, ...SECOND } as const
export const SINGLE = stageId('sample:single')
`)
      expect(ids.get('STAGES.first')).toStrictEqual({ id: 'sample:first', line: 3 })
      expect(ids.get('STAGES.second')).toStrictEqual({ id: 'sample:second', line: 4 })
      expect(ids.get('SINGLE')).toStrictEqual({ id: 'sample:single', line: 6 })
    }),
  )
  it.effect('resolves every `NAME.prop` reference to the literal it was minted from', () =>
    Effect.sync(() => {
      const ids = parseStageIds('stage-ids.ts', STAGE_IDS_SOURCE)

      expect(ids.get('GAMEPLAY_STAGE_IDS.interactions')?.id).toBe('gameplay:interactions')
      expect(ids.get('GAMEPLAY_STAGE_IDS.entities')?.id).toBe('gameplay:entities')
      expect(ids.get('UPSTREAM_STAGE_IDS.simPhysics')?.id).toBe('sim:physics')
    }),
  )

  // The citations in the manifest are only trustworthy if something checks
  // them, and that means the parser has to know the line.
  it.effect('records the line each id is minted on', () =>
    Effect.sync(() => {
      const ids = parseStageIds('stage-ids.ts', STAGE_IDS_SOURCE)
      expect(ids.get('GAMEPLAY_STAGE_IDS.interactions')?.line).toBe(5)
      expect(ids.get('GAMEPLAY_STAGE_IDS.entities')?.line).toBe(6)
      expect(ids.get('UPSTREAM_STAGE_IDS.simPhysics')?.line).toBe(10)
    }),
  )
})

describe('following registered stage factories', () => {
  const root = '/roster/sample/src/stages'
  const entry = `${root}/registration.ts`
  const idsSource = `import { StageId } from '@nerima-games/mc-kernel'
export const STAGES = { first: StageId('sample:first'), second: StageId('sample:second') }
export const EXTRA = StageId('sample:extra')
`
  const registration = `import { assembled } from './composition.js'
export const sampleModule = { frameStages: Effect.gen(function* () { return yield* assembled() }) }
export const preview = () => ({ frameStages: Effect.succeed([{ id: StageId('preview:only'), run: () => Effect.void }]) })
`
  const factory = `import { STAGES, EXTRA } from './registration-core.js'
export const second = () => ({ id: STAGES.second, after: [STAGES.first], run: () => Effect.void })
export const extra = () => { const stage = { id: EXTRA, after: [STAGES.second], run: () => Effect.void }; return { stage } }
export const unused = () => ({ id: StageId('unused:helper'), run: () => Effect.void })
`
  const composition = `import { STAGES } from './stage-ids.js'
import { second, extra } from './factory.js'
const core = () => [{ id: STAGES.first, run: () => Effect.void }, second()]
export const assembled = () => Effect.gen(function* () {
  const stages = core()
  const api = yield* extra()
  return [...stages, api.stage]
})
`
  const files = {
    [entry]: registration,
    [`${root}/stage-ids.ts`]: idsSource,
    [`${root}/registration-core.ts`]: "export { STAGES, EXTRA } from './stage-ids.js'",
    [`${root}/factory.ts`]: factory,
    [`${root}/composition.ts`]: composition,
  }
  const parse = (overrides: Readonly<Record<string, string>> = {}) =>
    parseRegistrations(entry, registration, parseStageIds(`${root}/stage-ids.ts`, idsSource), ioOf({ ...files, ...overrides }))

  it.effect('follows mixed inline and imported factories, array spreads and returned stage properties', () =>
    Effect.sync(() => {
      const result = parse()
      expect(result.unresolved).toStrictEqual([])
      expect(result.stages).toStrictEqual([
        { id: 'sample:first', after: [], declaredAtLine: 3, declaredAtFile: `${root}/composition.ts` },
        { id: 'sample:second', after: ['sample:first'], declaredAtLine: 2, declaredAtFile: `${root}/factory.ts` },
        { id: 'sample:extra', after: ['sample:second'], declaredAtLine: 3, declaredAtFile: `${root}/factory.ts` },
      ])
    }),
  )

  it.effect('reports an unresolved factory beside an inline registration', () =>
    Effect.sync(() => {
      const result = parse({ [`${root}/composition.ts`]: composition.replace('second()]', 'unknownFactory()]') })
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0]).toContain('unknownFactory')
    }),
  )

  it.effect('reports unknown ids reached through a factory', () =>
    Effect.sync(() => {
      const result = parse({ [`${root}/factory.ts`]: factory.replace('id: STAGES.second', 'id: STAGES.missing') })
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0]).toContain('missing')
    }),
  )

  it.effect('requires factory ids to follow an imported constructor', () =>
    Effect.sync(() => {
      const result = parse({ [`${root}/factory.ts`]: factory.replace('id: STAGES.second', "id: StageId('sample:second')") })
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0]).toContain('cannot resolve symbol StageId')
    }),
  )

  it.effect('reports an imported source that is absent', () =>
    Effect.sync(() => {
      const result = parse({ [`${root}/composition.ts`]: composition.replace('./factory.js', './missing.js') })
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0]).toContain('cannot read imported source')
    }),
  )

  it.effect('reports factory cycles instead of recursing indefinitely', () =>
    Effect.sync(() => {
      const result = parse({ [`${root}/composition.ts`]: 'export const assembled = () => assembled()' })
      expect(result.unresolved).toHaveLength(1)
      expect(result.unresolved[0]).toContain('cyclic')
    }),
  )

  it.effect('requires both Option branches to resolve to the same registrations', () =>
    Effect.sync(() => {
      const branchSource = `import { STAGES } from './stage-ids.js'
const core = () => [{ id: STAGES.first, run: () => Effect.void }]
const other = () => [{ id: STAGES.second, run: () => Effect.void }]
export const assembled = () => Effect.flatMap(source, Option.match({
  onNone: () => Effect.map(source, core),
  onSome: () => Effect.map(source, core),
})).pipe(Effect.orDie)
`
      const accepted = parse({ [`${root}/composition.ts`]: branchSource })
      expect(accepted.unresolved).toStrictEqual([])
      expect(accepted.stages.map((stage) => stage.id)).toStrictEqual(['sample:first'])
      const rejected = parse({ [`${root}/composition.ts`]: branchSource.replace('onSome: () => Effect.map(source, core)', 'onSome: () => Effect.map(source, other)') })
      expect(rejected.unresolved).toHaveLength(1)
      expect(rejected.unresolved[0]).toContain('different registrations')
    }),
  )
})

describe('parsing a sibling’s registrations', () => {
  const ids = parseStageIds('stage-ids.ts', STAGE_IDS_SOURCE)

  it.effect('reads the stages in source order, with their after edges resolved', () =>
    Effect.sync(() => {
      const parsed = parseRegistrations('registration.ts', REGISTRATION_SOURCE, ids)

      expect(parsed.unresolved).toStrictEqual([])
      expect(parsed.stages).toStrictEqual([
        { id: 'gameplay:interactions', after: ['sim:physics'], declaredAtLine: 5 },
        { id: 'gameplay:entities', after: ['gameplay:interactions'], declaredAtLine: 10 },
      ])
    }),
  )

  // Several repositories keep an `after: [StageId('ui:hud-sync')]` example in a
  // doc comment or a type illustration. Requiring `run` alongside `id` is what
  // keeps those out of the answer.
  it.effect('ignores an object literal that has an id but no run', () =>
    Effect.sync(() => {
      const parsed = parseRegistrations(
        'registration.ts',
        `const example = { id: StageId('not:a-stage'), after: [] }\n`,
        ids,
      )
      expect(parsed.stages).toStrictEqual([])
    }),
  )

  it.effect('accepts a bare StageId literal as well as a named reference', () =>
    Effect.sync(() => {
      const parsed = parseRegistrations(
        'registration.ts',
        `const s = [{ id: StageId('sim:physics'), run: () => Effect.void }]\n`,
        ids,
      )
      expect(parsed.stages[0]?.id).toBe('sim:physics')
    }),
  )

  // REGRESSION: the dangerous failure for a parser like this is to silently
  // report FEWER stages than exist, because "the manifest matches" and "the
  // parser found nothing" look identical from the outside. An id it cannot
  // resolve must be a reported problem, never a skipped row.
  it.effect('reports an id it cannot resolve instead of dropping the stage', () =>
    Effect.sync(() => {
      for (const expression of ['SOMETHING_ELSE.mystery', '123', '`dynamic:id`', 'chooseId()']) {
        const parsed = parseRegistrations(
          'registration.ts',
          `const s = [{ id: ${expression}, run: () => Effect.void }]\n`,
          ids,
        )
        expect(parsed.stages).toStrictEqual([])
        expect(parsed.unresolved).toHaveLength(1)
        expect(parsed.unresolved[0]).toContain('cannot resolve the `id`')
      }
    }),
  )

  it.effect('reports an after edge it cannot resolve', () =>
    Effect.sync(() => {
      const parsed = parseRegistrations(
        'registration.ts',
        `const s = [{ id: StageId('a:b'), after: [MYSTERY.x], run: () => Effect.void }]\n`,
        ids,
      )
      expect(parsed.unresolved[0]).toContain('cannot resolve an `after` edge')
    }),
  )
})

describe('comparing the manifest against the source', () => {
  it.effect('says nothing when the transcription is exact', () =>
    Effect.sync(() => {
      expect(compareModule('/roster', MANIFEST, ioOf(FILES))).toStrictEqual([])
    }),
  )

  it.effect('catches a renamed stage id', () =>
    Effect.sync(() => {
      const drifted: RosterModule = {
        ...MANIFEST,
        stages: [
          { ...MANIFEST.stages[0]!, id: 'gameplay:interaction' },
          MANIFEST.stages[1]!,
        ],
      }
      const problems = compareModule('/roster', drifted, ioOf(FILES))
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('gameplay:interaction')
      expect(problems[0]).toContain('gameplay:interactions')
    }),
  )

  // The edge that matters most: an `after` appearing or disappearing changes
  // the frame, and it is invisible in the id list.
  it.effect('catches an after edge that was added on disk', () =>
    Effect.sync(() => {
      const drifted: RosterModule = {
        ...MANIFEST,
        stages: [{ ...MANIFEST.stages[0]!, after: [] }, MANIFEST.stages[1]!],
      }
      expect(compareModule('/roster', drifted, ioOf(FILES))[0]).toContain('sim:physics')
    }),
  )

  it.effect('catches a stage the manifest never heard of', () =>
    Effect.sync(() => {
      const drifted: RosterModule = { ...MANIFEST, stages: [MANIFEST.stages[0]!] }
      expect(compareModule('/roster', drifted, ioOf(FILES))[0]).toContain('gameplay:entities')
    }),
  )

  // A citation is the only thing that lets a reader check the transcription
  // without re-deriving it, so a drifted line number is a real failure and not
  // a cosmetic one.
  it.effect('catches a file:line citation that has moved', () =>
    Effect.sync(() => {
      const drifted: RosterModule = {
        ...MANIFEST,
        stages: [
          { ...MANIFEST.stages[0]!, declaredAt: 'mx-gameplay/src/stages/registration.ts:999' },
          { ...MANIFEST.stages[1]!, idAt: 'mx-gameplay/src/stages/stage-ids.ts:1' },
        ],
      }
      const problems = compareModule('/roster', drifted, ioOf(FILES))
      expect(problems).toHaveLength(2)
      expect(problems[0]).toContain('registration.ts:5')
      expect(problems[1]).toContain('stage-ids.ts:6')
    }),
  )

  it.effect('reports a repository whose stage files are simply not there', () =>
    Effect.sync(() => {
      expect(compareModule('/roster', MANIFEST, ioOf({}))[0]).toContain('does not exist')
    }),
  )
})

describe('the repositories that register nothing', () => {
  it.effect('reports unresolved registrations in a supposedly silent repository', () =>
    Effect.sync(() => {
      const files = ioOf({
        '/roster/sample/src/stages/registration.ts': 'const stages = [{ id: UNKNOWN.stage, run: () => Effect.void }]',
      })
      const problems = compareSilentModule('/roster', { name: 'sample' }, files)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('cannot resolve the `id`')
    }),
  )

  it.effect('is satisfied while they have no stages directory', () =>
    Effect.sync(() => {
      for (const entry of ROSTER_REGISTERS_NOTHING) {
        expect(compareSilentModule('/roster', entry, ioOf(FILES))).toStrictEqual([])
      }
    }),
  )

  /**
   * REGRESSION — and this one is no longer hypothetical: IT FIRED.
   *
   * mc-sim and mx-multiplayer were both listed under `ROSTER_REGISTERS_NOTHING`,
   * both grew a `stages/` directory, and this is the check that caught it — the
   * manifest was updated because the gate failed, not because anybody noticed.
   * Both have since moved into `ROSTER`, so the fixture below is synthetic
   * again; it keeps guarding mc-worldgen and mc-playground-kit.
   *
   * What makes the check worth its weight is stated in the negative: a manifest
   * that simply never mentions a repository composes perfectly happily, so
   * `test/e2e/roster-frame-order.test.ts` would have stayed green over a roster
   * that had moved on. Being silent about a stage and there being no stage are
   * indistinguishable from inside the composition.
   */
  it.effect('fails loudly the day a silent repository registers a stage', () =>
    Effect.sync(() => {
      const withPhysics = ioOf({
        '/roster/mc-sim/src/stages/stage-ids.ts': `export const SIM_STAGE_IDS = { physics: StageId('sim:physics') } as const\n`,
        '/roster/mc-sim/src/stages/registration.ts': `const s = [{ id: SIM_STAGE_IDS.physics, run: () => Effect.void }]\n`,
      })
      const problems = compareSilentModule('/roster', { name: 'mc-sim' }, withPhysics)

      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('sim:physics')
      expect(problems[0]).toContain('ROSTER_REGISTERS_NOTHING')
    }),
  )
})

describe('finding the checkouts', () => {
  // The ORDER is load-bearing, not cosmetic: `..` and `../mc-dev-meta/repos`
  // are two checkouts of the same repositories and they diverge. The working
  // copy wins, because it is the one that gets committed. See the script header.
  it.effect('prefers MC_ROSTER_ROOT, then the working copies, then the mirror', () =>
    Effect.sync(() => {
      const candidates = rosterRootCandidates({ MC_ROSTER_ROOT: '/explicit' })
      expect(candidates[0]).toContain('explicit')
      expect(candidates[2]).toContain(`mc-dev-meta${'/'}repos`)
      // Candidate 1 is the repo root's own parent (the sibling working
      // copies); assert it is a distinct root from the mirror rather than
      // that its PATH avoids the string "mc-dev-meta" — when this repository
      // is checked out inside mc-dev-meta's repos/ mirror (check:workspace
      // does exactly that), the parent path legitimately contains that name.
      expect(candidates[1]).not.toBe(candidates[2])
      expect(candidates).toHaveLength(3)

      expect(rosterRootCandidates({})).toHaveLength(2)
      expect(rosterRootCandidates({ MC_ROSTER_ROOT: '' })).toHaveLength(2)
    }),
  )

  it.effect('takes the first candidate that holds every repository the manifest names', () =>
    Effect.sync(() => {
      const present = new Set(requiredRepositories().map((name) => `/complete/${name}`))
      const chosen = findRosterRoot(['/partial', '/complete'], (at) => present.has(at))
      expect(chosen).toBe('/complete')
    }),
  )

  it.effect('names every repository it needs, including the ones registering nothing', () =>
    Effect.sync(() => {
      expect(requiredRepositories()).toStrictEqual([
        ...ROSTER.map((module) => module.name),
        ...ROSTER_REGISTERS_NOTHING.map((entry) => entry.name),
      ])
    }),
  )

  // An empty answer must not read as a clean one.
  it.effect('turns a missing checkout into a problem per module, not into silence', () =>
    Effect.sync(() => {
      const { problems, stageCount } = run('/nowhere', ioOf({}))
      expect(problems).toHaveLength(ROSTER.length)
      expect(stageCount).toBe(21)
    }),
  )
})
