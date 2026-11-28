/**
 * Tests for `scripts/status/dod-rules.ts`: fake results go in, the verdict of
 * each of DoD-1 to DoD-13 comes out.
 *
 * The cases that matter most are the ones where a rule could go green by
 * accident: an empty input, a required check that was never reported, a result
 * measured on an old commit, and an old pass sitting next to a newer failure.
 */
import { describe, expect, it } from '@effect/vitest'
import {
  FUTURE_SKEW_MS,
  STALE_AFTER_MS,
  evaluateDods,
  staleReason,
  type AcceptanceDecision,
  type CheckEntry,
  type DodInput,
  type DodResult,
  type DodVerdict,
  type ReleaseAcceptance,
} from '../../scripts/status/dod-rules'
import { DOD_IDS, DOD_REQUIREMENTS, classifyCheck, type DodId } from '../../scripts/status/registry'
import type { Check, StatusRun } from '../../scripts/status/schema'
import {
  FRESH,
  HOUR_MS,
  NOW,
  OTHER_COMMIT,
  VERSION,
  allPassingRuns,
  check,
  currency,
  idsSatisfying,
  isoAt,
  journeyVideo,
  passingCheck,
  run,
} from './fixtures'

const APPROVED: AcceptanceDecision = {
  version: VERSION,
  decidedBy: 'reviewer',
  decidedAt: FRESH,
  state: 'approved',
}

const ACCEPTED: ReleaseAcceptance = { environment: 'present', candidateVersion: VERSION, decisions: [APPROVED] }

const input = (runs: ReadonlyArray<StatusRun>, overrides: Partial<DodInput> = {}): DodInput => ({
  runs,
  currency: currency(),
  acceptance: ACCEPTED,
  ...overrides,
})

const resultOf = (results: ReadonlyArray<DodResult>, dod: DodId): DodResult => {
  const found = results.find((result) => result.dod === dod)
  if (found === undefined) throw new Error(`no result for DoD-${dod}`)
  return found
}

const verdictOf = (dodInput: DodInput, dod: DodId): DodVerdict => resultOf(evaluateDods(dodInput), dod).verdict

/** All passing runs with `replace` applied to one check ID. */
const withCheck = (id: string, replacement: Check | undefined): ReadonlyArray<StatusRun> =>
  allPassingRuns().map((base) => ({
    ...base,
    checks: base.checks.flatMap((existing) => (existing.id === id ? (replacement === undefined ? [] : [replacement]) : [existing])),
  }))

const DOD_WITH_CHECKS = DOD_IDS.filter((dod) => dod !== 9)

describe('evaluateDods', () => {
  it('returns all thirteen DoD in order, each missing, when nothing was reported', () => {
    const results = evaluateDods(input([], { acceptance: undefined }))

    expect(results.map((result) => result.dod)).toEqual([...DOD_IDS])
    expect(results.map((result) => result.verdict)).toEqual(DOD_IDS.map(() => 'missing'))
    for (const result of results) expect(result.total).toBeGreaterThan(0)
  })

  it('reports every required ID as absent when nothing was reported', () => {
    const result = resultOf(evaluateDods(input([])), 1)

    expect(result.counts.missing).toBe(DOD_REQUIREMENTS[1].requiredIds.length)
    expect(result.issues).toContainEqual({ code: 'absent', id: 'ledger/content/block-types' })
  })

  it('passes all thirteen DoD when every check passes and the release is accepted', () => {
    const results = evaluateDods(input(allPassingRuns()))

    expect(results.map((result) => result.verdict)).toEqual(DOD_IDS.map(() => 'pass'))
    for (const result of results) expect(result.issues).toEqual([])
  })

  it('does not depend on the order of the runs', () => {
    const runs = [
      run([check('ux/1', { verdict: 'fail', measuredAt: isoAt(NOW - 3 * HOUR_MS) })], { runId: 1 }),
      run([check('ux/1', { verdict: 'pass', measuredAt: isoAt(NOW - 2 * HOUR_MS) })], { runId: 2 }),
    ]

    expect(evaluateDods(input(runs))).toEqual(evaluateDods(input([...runs].reverse())))
  })

  describe.each(DOD_WITH_CHECKS)('DoD-%i', (dod) => {
    it('passes when its required checks pass', () => {
      expect(verdictOf(input(allPassingRuns()), dod)).toBe('pass')
    })

    it('is missing, not passing, when only part of its checks were reported', () => {
      const ids = idsSatisfying(dod)
      const partial = [run(ids.slice(0, -1).map(passingCheck))]

      expect(verdictOf(input(partial), dod)).toBe('missing')
    })

    it('fails when one of its checks fails, even if another is missing', () => {
      const ids = idsSatisfying(dod)
      const first = ids[0]
      if (first === undefined) throw new Error('DoD has no checks')
      const failing = [run([check(first, { verdict: 'fail', reason: 'broke' })])]

      expect(verdictOf(input(failing), dod)).toBe('fail')
    })
  })

  it('treats every required ID as required: dropping any one makes its DoD missing', () => {
    for (const dod of DOD_WITH_CHECKS) {
      for (const id of DOD_REQUIREMENTS[dod].requiredIds) {
        const result = resultOf(evaluateDods(input(withCheck(id, undefined))), dod)
        expect(result.verdict, `DoD-${dod} without ${id}`).toBe('missing')
        expect(result.issues).toContainEqual({ code: 'absent', id })
      }
    }
  })

  it('shows a reported `missing` check as missing', () => {
    const runs = withCheck('ux/3', check('ux/3', { verdict: 'missing', reason: 'not written yet' }))

    expect(verdictOf(input(runs), 11)).toBe('missing')
  })

  it('shows an unmeasurable check as unmeasurable and never as a pass', () => {
    const runs = withCheck('perf/R2', check('perf/R2', { verdict: 'unmeasurable', reason: 'no SwiftShader' }))

    expect(verdictOf(input(runs), 5)).toBe('unmeasurable')
  })

  it('ranks fail above missing above unmeasurable above stale', () => {
    const stale = check('ux/1', { measuredAt: isoAt(NOW - STALE_AFTER_MS - 1) })
    const unmeasurable = check('ux/2', { verdict: 'unmeasurable', reason: 'x' })
    const missing = check('ux/3', { verdict: 'missing' })
    const failing = check('ux/4', { verdict: 'fail' })
    const ladder = (...replacements: ReadonlyArray<Check>): DodVerdict => {
      const runs = allPassingRuns().map((base) => ({
        ...base,
        checks: base.checks.map((existing) => replacements.find((candidate) => candidate.id === existing.id) ?? existing),
      }))
      return verdictOf(input(runs), 11)
    }

    expect(ladder(stale)).toBe('stale')
    expect(ladder(stale, unmeasurable)).toBe('unmeasurable')
    expect(ladder(stale, unmeasurable, missing)).toBe('missing')
    expect(ladder(stale, unmeasurable, missing, failing)).toBe('fail')
  })

  describe('which result speaks for a check ID', () => {
    it('lets a newer failure override an older pass', () => {
      const runs = [
        ...withCheck('ux/1', undefined),
        run([check('ux/1', { measuredAt: isoAt(NOW - 5 * HOUR_MS) })], { runId: 1 }),
        run([check('ux/1', { verdict: 'fail', measuredAt: isoAt(NOW - HOUR_MS) })], { runId: 2 }),
      ]

      expect(verdictOf(input(runs), 11)).toBe('fail')
    })

    it('lets a newer pass override an older failure', () => {
      const runs = [
        ...withCheck('ux/1', undefined),
        run([check('ux/1', { verdict: 'fail', measuredAt: isoAt(NOW - 5 * HOUR_MS) })], { runId: 1 }),
        run([check('ux/1', { measuredAt: isoAt(NOW - HOUR_MS) })], { runId: 2 }),
      ]

      expect(verdictOf(input(runs), 11)).toBe('pass')
    })

    it('breaks a tie on measurement time by the later run, then the larger run ID', () => {
      const same = isoAt(NOW - HOUR_MS)
      const laterFinish = [
        run([check('ux/1', { measuredAt: same })], { runId: 9, finishedAt: isoAt(NOW - 10 * 60 * 1000) }),
        run([check('ux/1', { verdict: 'fail', measuredAt: same })], { runId: 1, finishedAt: isoAt(NOW - 20 * 60 * 1000) }),
      ]
      const largerRunId = [
        run([check('ux/1', { measuredAt: same })], { runId: 1 }),
        run([check('ux/1', { verdict: 'fail', measuredAt: same })], { runId: 2 }),
      ]
      const others = allPassingRuns().map((base) => ({ ...base, checks: base.checks.filter((existing) => existing.id !== 'ux/1') }))

      expect(verdictOf(input([...others, ...laterFinish]), 11)).toBe('pass')
      expect(verdictOf(input([...others, ...largerRunId]), 11)).toBe('fail')
      expect(verdictOf(input([...others, ...[...largerRunId].reverse()]), 11)).toBe('fail')
    })
  })

  describe('checks the registry does not know', () => {
    it('ignores an unregistered ID, so it cannot fail or complete a DoD', () => {
      const runs = [...allPassingRuns(), run([check('ux/13', { verdict: 'fail' })], { runId: 7 })]

      expect(verdictOf(input(runs), 11)).toBe('pass')
    })

    it('ignores a check whose group does not match its ID, so it cannot stand in for the real one', () => {
      const wrongGroup = check('ux/2', { group: 'journey' })
      const runs = withCheck('ux/2', wrongGroup)

      expect(verdictOf(input(runs), 11)).toBe('missing')
    })
  })

  describe('DoD-1', () => {
    it('does not count the rows that are out of scope', () => {
      const runs = [
        ...allPassingRuns(),
        run(
          ['ledger/extension/wither', 'ledger/perf/fr-4.5', 'ledger/perf/fr-4.6'].map((id) => check(id, { verdict: 'fail' })),
          { runId: 8 },
        ),
      ]

      expect(verdictOf(input(runs), 1)).toBe('pass')
    })

    it('requires the 95 in-scope rows', () => {
      expect(DOD_REQUIREMENTS[1].requiredIds).toHaveLength(95)
    })
  })

  describe('DoD-4', () => {
    const journey = (overrides: Partial<Check>, runOverrides: Partial<StatusRun> = {}): ReadonlyArray<StatusRun> => [
      ...withCheck('journey/full', undefined),
      run([check('journey/full', { evidence: [journeyVideo], ...overrides })], { runId: 5, ...runOverrides }),
    ]

    it('passes for a clean journey with a recording', () => {
      expect(verdictOf(input(journey({})), 4)).toBe('pass')
    })

    it('does not count a journey that used QA state changes', () => {
      const result = resultOf(evaluateDods(input(journey({}, { stateChangingQaCommands: 2 }))), 4)

      expect(result.verdict).toBe('fail')
      expect(result.issues).toContainEqual({ code: 'qa-state-changes', id: 'journey/full', count: 2 })
    })

    it('does not count a journey without a video', () => {
      const withoutVideo = resultOf(evaluateDods(input(journey({ evidence: [{ kind: 'image', path: 'a.png' }] }))), 4)

      expect(withoutVideo.verdict).toBe('fail')
      expect(withoutVideo.issues).toContainEqual({ code: 'no-video', id: 'journey/full' })
    })

    it('judges the QA count of the run that holds the newest result', () => {
      const runs = [
        run([check('journey/full', { evidence: [journeyVideo], measuredAt: isoAt(NOW - 5 * HOUR_MS) })], { runId: 1 }),
        run([check('journey/full', { evidence: [journeyVideo], measuredAt: isoAt(NOW - HOUR_MS) })], {
          runId: 2,
          stateChangingQaCommands: 1,
        }),
      ]
      const others = withCheck('journey/full', undefined)

      expect(verdictOf(input([...others, ...runs]), 4)).toBe('fail')
    })

    it('reports a failed journey through the check, not through the QA rules', () => {
      const result = resultOf(evaluateDods(input(journey({ verdict: 'fail' }))), 4)

      expect(result.verdict).toBe('fail')
      expect(result.issues).toEqual([{ code: 'check', id: 'journey/full', verdict: 'fail' }])
    })
  })

  describe('DoD-8', () => {
    const smoke = (runOverrides: Partial<StatusRun>): ReadonlyArray<StatusRun> => [
      ...withCheck('live/smoke', undefined),
      run([check('live/smoke')], { runId: 6, repo: 'nerima-games/mc-host-web', ...runOverrides }),
    ]

    it('passes for a smoke test of the published version', () => {
      expect(verdictOf(input(smoke({})), 8)).toBe('pass')
    })

    it('is stale for a smoke test of another version', () => {
      expect(verdictOf(input(smoke({ version: '1.2.4' })), 8)).toBe('stale')
    })

    it('is stale when nothing is published, so a green card needs a published version', () => {
      const dodInput = input(smoke({}), { currency: currency({ publishedVersion: undefined }) })

      expect(verdictOf(dodInput, 8)).toBe('stale')
    })

    it('compares a live check with the published version, not with main', () => {
      const dodInput = input(smoke({ commit: OTHER_COMMIT }))

      expect(verdictOf(dodInput, 8)).toBe('pass')
    })
  })

  describe('DoD-10 and DoD-13 coverage', () => {
    it('is missing when a screen key has no check, even though every reported screen passes', () => {
      const lastScreen = 'screen/S34/default/ja/1280'
      const result = resultOf(evaluateDods(input(withCheck(lastScreen, undefined))), 13)

      expect(result.verdict).toBe('missing')
      expect(result.counts.missing).toBe(1)
      expect(result.issues).toContainEqual({
        code: 'coverage',
        prefix: 'screen/',
        found: 33,
        min: 34,
        missingKeys: ['S34'],
      })
    })

    it('accepts many states of one screen and still requires the other screens', () => {
      const extra = run(['recipeBook', 'inventory'].map((state) => passingCheck(`screen/S09/${state}/ja/1280`)), { runId: 11 })

      expect(verdictOf(input([...allPassingRuns(), extra]), 13)).toBe('pass')
    })

    it('fails when any screen fails', () => {
      const runs = [...allPassingRuns(), run([check('screen/S02/extra/en/844', { verdict: 'fail' })], { runId: 12 })]

      expect(verdictOf(input(runs), 13)).toBe('fail')
    })

    it('is missing when no audit check was reported', () => {
      const result = resultOf(evaluateDods(input(withCheck('audit/sample-0', undefined))), 13)

      expect(result.verdict).toBe('missing')
    })

    it('is missing when no audio recording check was reported', () => {
      expect(verdictOf(input(withCheck('audio/recording/sample-0', undefined)), 10)).toBe('missing')
    })

    it('fails DoD-10 when any audio check fails, including ones no rule names', () => {
      const runs = [...allPassingRuns(), run([check('audio/oscillator/main-path', { verdict: 'fail' })], { runId: 13 })]

      expect(verdictOf(input(runs), 10)).toBe('fail')
    })
  })

  describe('DoD-9', () => {
    const accept = (acceptance: ReleaseAcceptance | undefined): DodVerdict => verdictOf(input([], { acceptance }), 9)
    const decision = (overrides: Partial<AcceptanceDecision>): AcceptanceDecision => ({ ...APPROVED, ...overrides })

    it('says nothing is approved while the API has not been read or the environment does not exist', () => {
      expect(accept(undefined)).toBe('missing')
      expect(accept({ environment: 'absent' })).toBe('missing')
      expect(resultOf(evaluateDods(input([], { acceptance: { environment: 'absent' } })), 9).issues).toEqual([
        { code: 'no-acceptance-environment' },
      ])
    })

    it('is missing without a candidate version or without a decision on it', () => {
      expect(accept({ environment: 'present', candidateVersion: undefined, decisions: [APPROVED] })).toBe('missing')
      expect(accept({ environment: 'present', candidateVersion: VERSION, decisions: [] })).toBe('missing')
      expect(accept({ environment: 'present', candidateVersion: VERSION, decisions: [decision({ state: 'rejected', version: '9.9.9' })] })).toBe(
        'missing',
      )
    })

    it('passes when the candidate version is approved', () => {
      expect(accept(ACCEPTED)).toBe('pass')
    })

    it('is stale when only another version was approved', () => {
      const other = { environment: 'present', candidateVersion: VERSION, decisions: [decision({ version: '1.2.2' })] } as const

      expect(accept(other)).toBe('stale')
    })

    it('fails when the candidate was rejected', () => {
      const rejected = { environment: 'present', candidateVersion: VERSION, decisions: [decision({ state: 'rejected' })] } as const

      expect(accept(rejected)).toBe('fail')
    })

    it('lets the latest decision stand, in either order', () => {
      const early = isoAt(NOW - 3 * HOUR_MS)
      const late = isoAt(NOW - HOUR_MS)
      const approvedThenRejected = [decision({ decidedAt: early }), decision({ decidedAt: late, state: 'rejected' })]
      const rejectedThenApproved = [decision({ decidedAt: early, state: 'rejected' }), decision({ decidedAt: late })]
      const acceptance = (decisions: ReadonlyArray<AcceptanceDecision>): ReleaseAcceptance => ({
        environment: 'present',
        candidateVersion: VERSION,
        decisions,
      })

      expect(accept(acceptance(approvedThenRejected))).toBe('fail')
      expect(accept(acceptance([...approvedThenRejected].reverse()))).toBe('fail')
      expect(accept(acceptance(rejectedThenApproved))).toBe('pass')
      expect(accept(acceptance([...rejectedThenApproved].reverse()))).toBe('pass')
    })

    it('lets a rejection win when an approval and a rejection share a timestamp', () => {
      const tied = [decision({}), decision({ state: 'rejected' })]
      const acceptance = (decisions: ReadonlyArray<AcceptanceDecision>): ReleaseAcceptance => ({
        environment: 'present',
        candidateVersion: VERSION,
        decisions,
      })

      expect(accept(acceptance(tied))).toBe('fail')
      expect(accept(acceptance([...tied].reverse()))).toBe('fail')
    })
  })
})

describe('staleReason', () => {
  const entryFor = (id: string, runOverrides: Partial<StatusRun>, checkOverrides: Partial<Check> = {}): CheckEntry => {
    const measured = check(id, checkOverrides)
    const classification = classifyCheck(measured)
    if (classification.kind !== 'registered') throw new Error(`${id} is not registered`)
    return { run: run([measured], runOverrides), check: measured, registration: classification.registration }
  }
  const at = (epochMs: number): Partial<Check> => ({ measuredAt: isoAt(epochMs) })

  it('keeps a result that is exactly 48 hours old and stales it one millisecond later', () => {
    expect(staleReason(entryFor('ux/1', {}, at(NOW - STALE_AFTER_MS)), currency())).toBeUndefined()
    expect(staleReason(entryFor('ux/1', {}, at(NOW - STALE_AFTER_MS - 1)), currency())).toBe('age')
  })

  it('stales a result measured on a commit other than the current main of its repository', () => {
    expect(staleReason(entryFor('ux/1', { commit: OTHER_COMMIT }), currency())).toBe('commit')
  })

  it('compares with the main of the repository that produced the run, not another one', () => {
    const entry = entryFor('ux/1', { repo: 'nerima-games/mc-kernel' })

    expect(staleReason(entry, currency())).toBeUndefined()
    expect(staleReason(entry, currency({ mainCommits: { 'nerima-games/mc-kernel': OTHER_COMMIT } }))).toBe('commit')
  })

  it('stales a result when the current main of its repository is unknown', () => {
    expect(staleReason(entryFor('ux/1', {}), currency({ mainCommits: {} }))).toBe('commit')
  })

  it('stales a live result measured on another version, or when no version is published', () => {
    expect(staleReason(entryFor('live/smoke', {}), currency())).toBeUndefined()
    expect(staleReason(entryFor('live/smoke', { version: '9.9.9' }), currency())).toBe('version')
    expect(staleReason(entryFor('live/smoke', {}), currency({ publishedVersion: undefined }))).toBe('version')
  })

  it('accepts a small clock skew into the future and stales a larger one', () => {
    expect(staleReason(entryFor('ux/1', {}, at(NOW + FUTURE_SKEW_MS)), currency())).toBeUndefined()
    expect(staleReason(entryFor('ux/1', {}, at(NOW + FUTURE_SKEW_MS + 1)), currency())).toBe('future')
  })

  it('stales a timestamp it cannot read instead of treating it as fresh', () => {
    expect(staleReason(entryFor('ux/1', {}, { measuredAt: 'not a date' }), currency())).toBe('age')
  })
})
