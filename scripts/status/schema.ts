/**
 * schema.ts — the `status/v1` result file (docs/ux/55 §3).
 *
 * Every repository's CI writes one of these and the status site reads it, so
 * this schema is the trust boundary of the whole site: the file comes from a
 * public URL of another repository, and its strings end up in links, file
 * paths and HTML. Decoding therefore rejects what the site could not render
 * safely instead of passing it on:
 *
 *   - `evidence.path` and `testRef.file` are relative paths from a small safe
 *     alphabet, with no `..`, scheme, query or percent-escape. The site joins
 *     them onto its own URLs.
 *   - `runUrl` is an https URL on github.com for this repository and run ID,
 *     so a result cannot link readers to another host.
 *   - Strings, arrays and `checks` are capped (`MAX_*`), so an oversized file
 *     is refused before the site spends memory on it.
 *   - Numbers are finite (C1's JSON rule); timestamps are real ISO 8601 dates.
 *
 * A file that fails here is not dropped: the aggregator lists it under "読めな
 * かった結果" (55 §4.1 ②). One bad check rejects the whole file, because the
 * file is the unit the site reports on.
 */
import { Result, Schema } from 'effect'

export const MAX_CHECKS_PER_RUN = 20_000
export const MAX_TEXT_LENGTH = 4_096
export const MAX_EVIDENCE_PER_CHECK = 64
export const MAX_STEPS_PER_CHECK = 256
const MAX_ID_LENGTH = 256
const MAX_PATH_LENGTH = 512

export const CHECK_VERDICTS = ['pass', 'fail', 'missing', 'unmeasurable'] as const
export type CheckVerdict = (typeof CHECK_VERDICTS)[number]

/**
 * 55 §3 lists thirteen groups. `audit` is the fourteenth: 55 §4.3 feeds DoD-13
 * from `audit/*` checks, and without a group they could not be reported.
 */
export const CHECK_GROUPS = [
  'ux',
  'journey',
  'feature',
  'screen',
  'ledger',
  'content',
  'catalog',
  'perf',
  'compose',
  'audio',
  'progression',
  'ci',
  'live',
  'audit',
] as const
export type CheckGroup = (typeof CHECK_GROUPS)[number]

export const EVIDENCE_KINDS = ['video', 'image', 'imageDiff', 'audio', 'json', 'log', 'trace'] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

export type Step = {
  readonly id: string
  readonly title: string
  readonly atMs: number
  readonly durationMs: number
  readonly targetMs?: number
  readonly verdict: 'pass' | 'fail'
}

export type Evidence = {
  readonly kind: EvidenceKind
  /** Relative path inside the run's artifact. */
  readonly path: string
  readonly atMs?: number
  readonly caption?: string
}

export type Check = {
  readonly id: string
  readonly title: string
  readonly group: CheckGroup
  readonly owner: string
  readonly verdict: CheckVerdict
  readonly value?: number | string
  readonly threshold?: string
  readonly unit?: string
  readonly reason?: string
  readonly steps?: ReadonlyArray<Step>
  readonly evidence: ReadonlyArray<Evidence>
  readonly testRef: { readonly file: string; readonly line?: number }
  readonly measuredAt: string
}

export type StatusRun = {
  readonly schema: 'status/v1'
  readonly repo: string
  readonly workflow: string
  readonly runId: number
  readonly runUrl: string
  readonly commit: string
  readonly version: string
  readonly startedAt: string
  readonly finishedAt: string
  readonly environment: {
    readonly tier: 'T0' | 'CI' | 'live'
    readonly browser: string
    readonly renderer?: string
  }
  readonly stateChangingQaCommands: number
  readonly checks: ReadonlyArray<Check>
}

// ---------------------------------------------------------------------------
// Value predicates
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/
const PATH_PATTERN = /^[A-Za-z0-9._~@+=,/-]+$/
const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const WORKFLOW_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/
const ISO_8601_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

/** A path the site may append to its own URL: no leading slash, no empty, `.` or `..` segment. */
export const isSafeRelativePath = (path: string): boolean =>
  path.length <= MAX_PATH_LENGTH &&
  PATH_PATTERN.test(path) &&
  !path.startsWith('/') &&
  !path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')

/**
 * `Date.parse` rolls `2026-02-30` over to March, so the calendar day is checked
 * on its own; a producer that writes an impossible date has a bug worth refusing.
 */
export const isIso8601 = (value: string): boolean => {
  if (!ISO_8601_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const calendar = new Date(Date.UTC(year, month - 1, day))
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 && calendar.getUTCDate() === day
}

/** The run's own page on github.com, nothing else. */
export const isRunUrlFor = (url: string, repo: string, runId: number): boolean => {
  const parsed = URL.parse(url)
  if (parsed === null) return false
  const base = `/${repo}/actions/runs/${runId}`
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname === 'github.com' &&
    parsed.port === '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    (parsed.pathname === base || parsed.pathname.startsWith(`${base}/`))
  )
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const Text = Schema.String.check(Schema.isMaxLength(MAX_TEXT_LENGTH))
const NonEmptyText = Text.check(Schema.isMinLength(1))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Timestamp = Schema.String.check(Schema.makeFilter(isIso8601, { title: 'ISO 8601 timestamp' }))
const SafePath = Schema.String.check(Schema.makeFilter(isSafeRelativePath, { title: 'safe relative path' }))

const StepSchema: Schema.Codec<Step> = Schema.Struct({
  id: NonEmptyText,
  title: NonEmptyText,
  atMs: Milliseconds,
  durationMs: Milliseconds,
  targetMs: Schema.optionalKey(Milliseconds),
  verdict: Schema.Literals(['pass', 'fail']),
})

const EvidenceSchema: Schema.Codec<Evidence> = Schema.Struct({
  kind: Schema.Literals(EVIDENCE_KINDS),
  path: SafePath,
  atMs: Schema.optionalKey(Milliseconds),
  caption: Schema.optionalKey(Text),
})

const CheckId = Schema.String.check(Schema.isMaxLength(MAX_ID_LENGTH), Schema.isPattern(ID_PATTERN))

export const CheckSchema: Schema.Codec<Check> = Schema.Struct({
  id: CheckId,
  title: NonEmptyText,
  group: Schema.Literals(CHECK_GROUPS),
  owner: NonEmptyText,
  verdict: Schema.Literals(CHECK_VERDICTS),
  value: Schema.optionalKey(Schema.Union([Schema.Finite, Text])),
  threshold: Schema.optionalKey(Text),
  unit: Schema.optionalKey(Text),
  reason: Schema.optionalKey(Text),
  steps: Schema.optionalKey(Schema.Array(StepSchema).check(Schema.isMaxLength(MAX_STEPS_PER_CHECK))),
  evidence: Schema.Array(EvidenceSchema).check(Schema.isMaxLength(MAX_EVIDENCE_PER_CHECK)),
  testRef: Schema.Struct({
    file: SafePath,
    line: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
  }),
  measuredAt: Timestamp,
}).check(
  // 55 §3: an unmeasurable result always says why.
  Schema.makeFilter((check) => check.verdict !== 'unmeasurable' || (check.reason !== undefined && check.reason.length > 0), {
    title: 'unmeasurable check needs a reason',
  }),
)

export const StatusRunSchema: Schema.Codec<StatusRun> = Schema.Struct({
  schema: Schema.Literal('status/v1'),
  repo: Schema.String.check(Schema.isPattern(REPO_PATTERN), Schema.isMaxLength(MAX_ID_LENGTH)),
  workflow: Schema.String.check(Schema.isPattern(WORKFLOW_PATTERN), Schema.isMaxLength(MAX_ID_LENGTH)),
  runId: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runUrl: Text,
  commit: Schema.String.check(Schema.isPattern(COMMIT_PATTERN)),
  version: Schema.String.check(Schema.isPattern(VERSION_PATTERN), Schema.isMaxLength(MAX_ID_LENGTH)),
  startedAt: Timestamp,
  finishedAt: Timestamp,
  environment: Schema.Struct({
    tier: Schema.Literals(['T0', 'CI', 'live']),
    browser: NonEmptyText,
    renderer: Schema.optionalKey(NonEmptyText),
  }),
  stateChangingQaCommands: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  checks: Schema.Array(CheckSchema).check(Schema.isMaxLength(MAX_CHECKS_PER_RUN)),
}).check(
  Schema.makeFilter((run) => isRunUrlFor(run.runUrl, run.repo, run.runId), {
    title: 'runUrl must be the https github.com page of this repo and run',
  }),
  Schema.makeFilter((run) => Date.parse(run.startedAt) <= Date.parse(run.finishedAt), {
    title: 'startedAt must not be later than finishedAt',
  }),
  Schema.makeFilter((run) => new Set(run.checks.map((check) => check.id)).size === run.checks.length, {
    title: 'check IDs must be unique within a run',
  }),
)

/**
 * Effect decodes every array element before it applies the array's own length
 * rule, so `isMaxLength` on `checks` alone would reject an oversized file only
 * after decoding all of it. This first pass looks at the length and nothing else.
 * The caller still has to cap the bytes it downloads: the per-check caps on
 * `evidence` and `steps` fire after those arrays are decoded.
 */
const ChecksBudget = Schema.Struct({
  checks: Schema.Array(Schema.Unknown).check(Schema.isMaxLength(MAX_CHECKS_PER_RUN)),
})

/** Decodes parsed JSON. The error is the Schema's own, so the aggregator can print every violated rule. */
export const decodeStatusRun = (input: unknown): Result.Result<StatusRun, Schema.SchemaError> => {
  const budget = Schema.decodeUnknownResult(ChecksBudget)(input)
  return Result.isFailure(budget) ? Result.fail(budget.failure) : Schema.decodeUnknownResult(StatusRunSchema)(input)
}
