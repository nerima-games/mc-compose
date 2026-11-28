/**
 * dod-rules.ts — computes DoD-1 to DoD-13 from `status/v1` results (55 §4.3).
 *
 * The site draws what this module returns and never decides a verdict itself
 * (55: "書かないもの: 判定"). The function is pure: the clock, the current main
 * commits and the published version arrive as `Currency`, so a test can say
 * "48 hours later" without waiting.
 *
 * Three rules keep a green card honest:
 *
 *   - A check that was never reported is a `missing` check, not an absent
 *     one that every-pass rules skip over. `DOD_REQUIREMENTS` names what has
 *     to exist, and a DoD with nothing reported is `missing`.
 *   - A `pass` is `stale` when it is older than 48 hours or was measured on a
 *     version other than the current one. A stale pass is shown but never
 *     counted. When the current version is unknown, the pass is stale: the
 *     rule cannot confirm it is current, so it does not pretend to.
 *   - One result per check ID. When several runs report the same ID, the most
 *     recently measured one speaks for it, so an old pass cannot hide a newer
 *     failure.
 */
import {
  DOD_IDS,
  DOD_REQUIREMENTS,
  classifyCheck,
  isPublishedBy,
  type CoverageRequirement,
  type DodId,
  type Registration,
} from './registry'
import type { Check, StatusRun } from './schema'

/** The five displays of 55 §4.2. */
export type DodVerdict = 'pass' | 'fail' | 'missing' | 'unmeasurable' | 'stale'

export const STALE_AFTER_MS: number = 48 * 60 * 60 * 1000

/** A result measured this far ahead of `now` is a clock fault on the producer, not a fresh result. */
export const FUTURE_SKEW_MS: number = 5 * 60 * 1000

export type Currency = {
  /** Epoch milliseconds, read from the Clock port by the caller. */
  readonly now: number
  /** `owner/name` to the commit its main branch points at now. */
  readonly mainCommits: Readonly<Record<string, string>>
  /** The version the public URL serves now; `undefined` when nothing is published. */
  readonly publishedVersion: string | undefined
}

export type AcceptanceDecision = {
  readonly version: string
  readonly decidedBy: string
  /** ISO 8601. */
  readonly decidedAt: string
  readonly state: 'approved' | 'rejected'
}

/** What the GitHub deployments API says about Environment `release` of mc-host-web (DoD-9). */
export type ReleaseAcceptance =
  | { readonly environment: 'absent' }
  | {
      readonly environment: 'present'
      readonly candidateVersion: string | undefined
      readonly decisions: ReadonlyArray<AcceptanceDecision>
    }

export type DodInput = {
  readonly runs: ReadonlyArray<StatusRun>
  readonly currency: Currency
  /** `undefined` when the API has not been read. */
  readonly acceptance?: ReleaseAcceptance | undefined
}

export type StaleReason = 'age' | 'future' | 'commit' | 'version'

export type DodIssue =
  | { readonly code: 'absent'; readonly id: string }
  | { readonly code: 'check'; readonly id: string; readonly verdict: Exclude<DodVerdict, 'pass'> }
  | { readonly code: 'coverage'; readonly prefix: string; readonly found: number; readonly min: number }
  | { readonly code: 'qa-state-changes'; readonly id: string; readonly count: number }
  | { readonly code: 'no-video'; readonly id: string }
  | { readonly code: 'unauthorized-publisher'; readonly id: string; readonly repo: string; readonly workflow: string }
  | { readonly code: 'no-acceptance-environment' }
  | { readonly code: 'no-candidate-version' }
  | { readonly code: 'no-decision'; readonly version: string }
  | { readonly code: 'decision-for-other-version'; readonly version: string }
  | { readonly code: 'rejected'; readonly version: string; readonly decidedBy: string }
  | { readonly code: 'unreadable-decision-time'; readonly version: string; readonly decidedBy: string }

export type DodResult = {
  readonly dod: DodId
  readonly verdict: DodVerdict
  /** Required and contributing checks by displayed verdict; an absent required check counts as `missing`. */
  readonly counts: Readonly<Record<DodVerdict, number>>
  readonly total: number
  readonly issues: ReadonlyArray<DodIssue>
}

export type CheckEntry = {
  readonly run: StatusRun
  readonly check: Check
  readonly registration: Registration
}

const emptyCounts = (): Record<DodVerdict, number> => ({ pass: 0, fail: 0, missing: 0, unmeasurable: 0, stale: 0 })

/** An unreadable time sorts as the oldest instant, so comparing it never yields NaN and the order stays total. */
const timestamp = (iso: string): number => {
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
}

const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0)

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** From the best outcome to the worst: the order the card uses to pick one verdict for a DoD. */
const SEVERITY: Readonly<Record<DodVerdict, number>> = { pass: 0, stale: 1, unmeasurable: 2, missing: 3, fail: 4 }

/**
 * A positive result means `candidate` speaks for the check ID. The later
 * measurement wins; the run's finish time and ID come next. When all three
 * tie, the worse outcome wins, so the choice never depends on input order:
 * a displayed verdict, then more QA state changes, then no recording, and
 * finally the run's own labels, which decide nothing a DoD reads.
 */
const compareEntries = (candidate: CheckEntry, incumbent: CheckEntry, currency: Currency): number =>
  compareNumbers(timestamp(candidate.check.measuredAt), timestamp(incumbent.check.measuredAt)) ||
  compareNumbers(timestamp(candidate.run.finishedAt), timestamp(incumbent.run.finishedAt)) ||
  compareNumbers(candidate.run.runId, incumbent.run.runId) ||
  compareNumbers(SEVERITY[displayedVerdict(candidate, currency)], SEVERITY[displayedVerdict(incumbent, currency)]) ||
  compareNumbers(candidate.run.stateChangingQaCommands, incumbent.run.stateChangingQaCommands) ||
  compareNumbers(Number(!hasVideo(candidate)), Number(!hasVideo(incumbent))) ||
  compareText(candidate.run.repo, incumbent.run.repo) ||
  compareText(candidate.run.workflow, incumbent.run.workflow) ||
  compareText(candidate.run.commit, incumbent.run.commit) ||
  compareText(candidate.run.version, incumbent.run.version)

const hasVideo = (entry: CheckEntry): boolean => entry.check.evidence.some((item) => item.kind === 'video')

type Sifted = {
  readonly latest: ReadonlyMap<string, CheckEntry>
  /** Results the registry knows but whose publisher the spec does not allow, in input order, one per source and ID. */
  readonly ignored: ReadonlyArray<CheckEntry>
}

const sift = (runs: ReadonlyArray<StatusRun>, currency: Currency): Sifted => {
  const latest = new Map<string, CheckEntry>()
  const ignored = new Map<string, CheckEntry>()
  for (const run of runs) {
    for (const check of run.checks) {
      const classification = classifyCheck(check)
      if (classification.kind !== 'registered') continue
      const entry: CheckEntry = { run, check, registration: classification.registration }
      if (!isPublishedBy(check.id, run)) {
        ignored.set(`${check.id}\u0000${run.repo}\u0000${run.workflow}`, entry)
        continue
      }
      const incumbent = latest.get(check.id)
      if (incumbent === undefined || compareEntries(entry, incumbent, currency) > 0) latest.set(check.id, entry)
    }
  }
  return { latest, ignored: [...ignored.values()] }
}

/**
 * Why a check's pass does not count, or `undefined` when it is current.
 * A `live` check is measured against the public URL, so it is compared with
 * the published version; every other check is compared with its repository's
 * main. The comparison uses the check's registered group, not the run's
 * `environment.tier`, because the tier is the producer's own label.
 */
export const staleReason = (entry: CheckEntry, currency: Currency): StaleReason | undefined => {
  const measuredAt = timestamp(entry.check.measuredAt)
  if (!Number.isFinite(measuredAt)) return 'age'
  if (measuredAt > currency.now + FUTURE_SKEW_MS) return 'future'
  if (currency.now - measuredAt > STALE_AFTER_MS) return 'age'
  if (entry.registration.group === 'live') {
    return currency.publishedVersion !== undefined && entry.run.version === currency.publishedVersion ? undefined : 'version'
  }
  const main = currency.mainCommits[entry.run.repo]
  return main !== undefined && entry.run.commit === main ? undefined : 'commit'
}

const displayedVerdict = (entry: CheckEntry, currency: Currency): DodVerdict => {
  if (entry.check.verdict !== 'pass') return entry.check.verdict
  return staleReason(entry, currency) === undefined ? 'pass' : 'stale'
}

/** `fail` outranks everything, then `missing`, `unmeasurable` and `stale`; only a clean sweep is `pass`. */
const worst = (counts: Readonly<Record<DodVerdict, number>>, otherwiseFail: boolean): DodVerdict => {
  if (otherwiseFail || counts.fail > 0) return 'fail'
  if (counts.missing > 0) return 'missing'
  if (counts.unmeasurable > 0) return 'unmeasurable'
  if (counts.stale > 0) return 'stale'
  return 'pass'
}

type CoverageIssue = Extract<DodIssue, { readonly code: 'coverage' }>

const coverageIssue = (requirement: CoverageRequirement, entries: ReadonlyArray<CheckEntry>): CoverageIssue | undefined => {
  const found = entries.filter((entry) => entry.check.id.startsWith(requirement.prefix)).length
  return found >= requirement.min ? undefined : { code: 'coverage', prefix: requirement.prefix, found, min: requirement.min }
}

const JOURNEY_FULL_ID = 'journey/full'

/** DoD-4 counts only a completed journey with no QA state change and a recording (55 §4.3). */
const journeyIssues = (entry: CheckEntry | undefined): ReadonlyArray<DodIssue> => {
  if (entry === undefined || entry.check.verdict !== 'pass') return []
  return [
    ...(entry.run.stateChangingQaCommands === 0
      ? []
      : [{ code: 'qa-state-changes', id: entry.check.id, count: entry.run.stateChangingQaCommands } satisfies DodIssue]),
    ...(hasVideo(entry)
      ? []
      : [{ code: 'no-video', id: entry.check.id } satisfies DodIssue]),
  ]
}

const evaluateChecks = (dod: DodId, sifted: Sifted, currency: Currency): DodResult => {
  const { latest, ignored } = sifted
  const requirement = DOD_REQUIREMENTS[dod]
  const contributing = [...latest.values()].filter((entry) => entry.registration.dods.includes(dod))
  const counts = emptyCounts()
  const issues: DodIssue[] = []

  for (const entry of contributing) {
    const verdict = displayedVerdict(entry, currency)
    counts[verdict] += 1
    if (verdict !== 'pass') issues.push({ code: 'check', id: entry.check.id, verdict })
  }
  for (const id of requirement.requiredIds) {
    if (!latest.has(id)) {
      counts.missing += 1
      issues.push({ code: 'absent', id })
    }
  }
  for (const item of requirement.coverage) {
    const issue = coverageIssue(item, contributing)
    if (issue === undefined) continue
    // Each result still owed counts as missing, so a card never reads "0 of 0" while it waits for results.
    counts.missing += issue.min - issue.found
    issues.push(issue)
  }
  for (const entry of ignored) {
    if (!entry.registration.dods.includes(dod)) continue
    issues.push({ code: 'unauthorized-publisher', id: entry.check.id, repo: entry.run.repo, workflow: entry.run.workflow })
  }
  const journey = dod === 4 ? journeyIssues(latest.get(JOURNEY_FULL_ID)) : []
  issues.push(...journey)

  return {
    dod,
    verdict: worst(counts, journey.length > 0),
    counts,
    total: counts.pass + counts.fail + counts.missing + counts.unmeasurable + counts.stale,
    issues,
  }
}

const acceptanceResult = (acceptance: ReleaseAcceptance | undefined): DodResult => {
  const result = (verdict: DodVerdict, issues: ReadonlyArray<DodIssue>): DodResult => {
    const counts = emptyCounts()
    counts[verdict] += 1
    return { dod: 9, verdict, counts, total: 1, issues }
  }
  if (acceptance === undefined || acceptance.environment === 'absent') {
    return result('missing', [{ code: 'no-acceptance-environment' }])
  }
  const { candidateVersion, decisions } = acceptance
  // A decision whose time cannot be read cannot be ordered against the others, so it is set aside
  // (like an unreadable measurement time, which is stale) and reported instead of deciding by input order.
  const readable = decisions.filter((decision) => Number.isFinite(timestamp(decision.decidedAt)))
  const unreadable: ReadonlyArray<DodIssue> = decisions
    .filter((decision) => !readable.includes(decision))
    .map((decision) => ({ code: 'unreadable-decision-time', version: decision.version, decidedBy: decision.decidedBy }))
  const outcome = (verdict: DodVerdict, issues: ReadonlyArray<DodIssue>): DodResult => result(verdict, [...issues, ...unreadable])
  if (candidateVersion === undefined) return outcome('missing', [{ code: 'no-candidate-version' }])

  const forCandidate = readable.filter((decision) => decision.version === candidateVersion)
  // The latest decision stands, and a rejection wins a tie: acceptance must not rest on an ordering accident.
  const decisive = [...forCandidate].sort((a, b) => {
    const byTime = compareNumbers(timestamp(b.decidedAt), timestamp(a.decidedAt))
    if (byTime !== 0) return byTime
    return Number(b.state === 'rejected') - Number(a.state === 'rejected')
  })[0]
  if (decisive?.state === 'approved') return outcome('pass', [])
  if (decisive?.state === 'rejected') {
    return outcome('fail', [{ code: 'rejected', version: decisive.version, decidedBy: decisive.decidedBy }])
  }
  const other = readable.find((decision) => decision.state === 'approved')
  return other === undefined
    ? outcome('missing', [{ code: 'no-decision', version: candidateVersion }])
    : outcome('stale', [{ code: 'decision-for-other-version', version: other.version }])
}

/** All thirteen results, in DoD order, even when `runs` is empty. */
export const evaluateDods = (input: DodInput): ReadonlyArray<DodResult> => {
  const sifted = sift(input.runs, input.currency)
  return DOD_IDS.map((dod) => (dod === 9 ? acceptanceResult(input.acceptance) : evaluateChecks(dod, sifted, input.currency)))
}
