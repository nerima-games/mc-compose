/**
 * Builders for fake `status/v1` results. Everything here is valid by default,
 * so a test names only the field it breaks.
 */
import type { Currency } from '../../scripts/status/dod-rules'
import { DOD_IDS, DOD_REQUIREMENTS, ORGANIZATION, REPOSITORIES, type DodId } from '../../scripts/status/registry'
import { CHECK_GROUPS, type Check, type CheckGroup, type StatusRun } from '../../scripts/status/schema'

export const NOW: number = Date.parse('2026-12-01T12:00:00Z')
export const HOUR_MS: number = 60 * 60 * 1000

export const COMMIT: string = 'a'.repeat(40)
export const OTHER_COMMIT: string = 'b'.repeat(40)
export const VERSION: string = '1.2.3'

export const isoAt = (epochMs: number): string => new Date(epochMs).toISOString()

/** An hour before `NOW`, so a fresh result is far from both the age limit and the future limit. */
export const FRESH: string = isoAt(NOW - HOUR_MS)

export const currency = (overrides: Partial<Currency> = {}): Currency => ({
  now: NOW,
  mainCommits: Object.fromEntries(REPOSITORIES.map((repository) => [`${ORGANIZATION}/${repository}`, COMMIT])),
  publishedVersion: VERSION,
  ...overrides,
})

const groupOf = (id: string): CheckGroup => {
  const first = id.split('/')[0]
  const group = CHECK_GROUPS.find((candidate) => candidate === first)
  if (group === undefined) throw new Error(`fixture id ${id} has no group`)
  return group
}

export const check = (id: string, overrides: Partial<Check> = {}): Check => ({
  id,
  title: `check ${id}`,
  group: overrides.group ?? groupOf(id),
  owner: 'mc-host-web',
  verdict: 'pass',
  evidence: [],
  testRef: { file: 'test/example.test.ts', line: 1 },
  measuredAt: FRESH,
  ...overrides,
})

export const run = (checks: ReadonlyArray<Check>, overrides: Partial<StatusRun> = {}): StatusRun => {
  const repo = overrides.repo ?? `${ORGANIZATION}/mc-host-web`
  const runId = overrides.runId ?? 100
  return {
    schema: 'status/v1',
    repo,
    workflow: 'nightly',
    runId,
    runUrl: `https://github.com/${repo}/actions/runs/${runId}`,
    commit: COMMIT,
    version: VERSION,
    startedAt: isoAt(NOW - 2 * HOUR_MS),
    finishedAt: FRESH,
    environment: { tier: 'CI', browser: 'chromium' },
    stateChangingQaCommands: 0,
    checks,
    ...overrides,
  }
}

/**
 * Check IDs that satisfy `dod`'s presence rules: every required ID plus one
 * member for each coverage requirement (every screen key, at least one audit).
 */
export const idsSatisfying = (dod: DodId): ReadonlyArray<string> => {
  const requirement = DOD_REQUIREMENTS[dod]
  const covering = requirement.coverage.flatMap((item) =>
    item.keys === undefined
      ? Array.from({ length: item.min }, (_unused, index) => `${item.prefix}sample-${index}`)
      : item.keys.map((key) => `${item.prefix}${key}/default/ja/1280`),
  )
  return [...requirement.requiredIds, ...covering]
}

export const journeyVideo = { kind: 'video', path: 'journey-full.webm' } as const

/** A check that passes by every rule of its DoD, including the evidence DoD-4 asks for. */
export const passingCheck = (id: string): Check =>
  check(id, id === 'journey/full' ? { evidence: [journeyVideo] } : {})

/** Runs under which every one of the thirteen DoD passes. `live` checks carry the published version. */
export const allPassingRuns = (): ReadonlyArray<StatusRun> => [
  run(DOD_IDS.filter((dod) => dod !== 9).flatMap((dod) => idsSatisfying(dod)).map(passingCheck)),
]
