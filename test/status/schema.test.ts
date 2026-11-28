/**
 * Tests for `scripts/status/schema.ts`.
 *
 * A `status/v1` file is written by another repository and read by the site, so
 * the rejections matter as much as the acceptance: each one below is a value
 * the site could not safely render or reason about.
 */
import { describe, expect, it } from '@effect/vitest'
import { Result } from 'effect'
import {
  MAX_CHECKS_PER_RUN,
  MAX_EVIDENCE_PER_CHECK,
  MAX_STEPS_PER_CHECK,
  MAX_TEXT_LENGTH,
  decodeStatusRun,
  isIso8601,
  isRunUrlFor,
  isSafeRelativePath,
  type Check,
  type StatusRun,
} from '../../scripts/status/schema'
import { COMMIT, FRESH, check, run } from './fixtures'

const accepts = (candidate: unknown): boolean => Result.isSuccess(decodeStatusRun(candidate))

/** A value is rejected as a whole file; the helper shows the violated rule when it is not. */
const rejects = (candidate: unknown): boolean => Result.isFailure(decodeStatusRun(candidate))

const withCheck = (overrides: Partial<Check>): StatusRun => run([check('ux/1', overrides)])

describe('decodeStatusRun', () => {
  it('accepts a minimal run', () => {
    expect(accepts(run([]))).toBe(true)
  })

  it('accepts a run that uses every optional field and returns it unchanged', () => {
    const full = run(
      [
        check('journey/J7', {
          value: 412,
          threshold: '≤ 500 ms',
          unit: 'ms',
          reason: 'まだ作られていません',
          steps: [{ id: 'open', title: '開く', atMs: 0, durationMs: 120, targetMs: 500, verdict: 'pass' }],
          evidence: [
            { kind: 'video', path: 'videos/j7.webm', atMs: 1500, caption: '導線' },
            { kind: 'imageDiff', path: 'screens/S09/diff.png' },
          ],
          testRef: { file: 'e2e/journeys/j7.spec.ts', line: 42 },
        }),
        check('perf/R1', { value: '65 fps' }),
      ],
      { environment: { tier: 'T0', browser: 'chromium', renderer: 'SwiftShader' } },
    )

    const decoded = decodeStatusRun(full)

    expect(Result.isSuccess(decoded) && decoded.success).toEqual(full)
  })

  it('survives a JSON round trip', () => {
    expect(accepts(JSON.parse(JSON.stringify(run([check('ux/1')]))))).toBe(true)
  })

  it('does not let a __proto__ key in the file reach the decoded object', () => {
    const hostile: unknown = JSON.parse(`{"__proto__": {"polluted": true}, ${JSON.stringify(run([])).slice(1)}`)
    const decoded = decodeStatusRun(hostile)

    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) expect(Object.getPrototypeOf(decoded.success)).toBe(Object.prototype)
    expect(Reflect.get({}, 'polluted')).toBeUndefined()
  })

  describe('rejects a file that is not a status/v1 run', () => {
    it.each([null, undefined, 'status/v1', 42, [], {}])('for the value %j', (candidate) => {
      expect(rejects(candidate)).toBe(true)
    })

    it('for another schema name', () => {
      expect(rejects({ ...run([]), schema: 'status/v2' })).toBe(true)
    })

    it('for a missing required field', () => {
      for (const key of Object.keys(run([]))) {
        const copy: Record<string, unknown> = { ...run([]) }
        delete copy[key]
        expect(rejects(copy), key).toBe(true)
      }
    })
  })

  describe('rejects identity fields the site cannot trust', () => {
    it.each(['mc-host-web', 'a/b/c', '/mc-host-web', 'nerima games/x', ''])('for the repo %j', (repo) => {
      expect(rejects({ ...run([]), repo })).toBe(true)
    })

    it.each(['NIGHTLY', 'a b', '', '../x'])('for the workflow %j', (workflow) => {
      expect(rejects({ ...run([]), workflow })).toBe(true)
    })

    it.each(['abc123', 'A'.repeat(40), 'g'.repeat(40), 'a'.repeat(39), 'a'.repeat(41), ''])('for the commit %j', (commit) => {
      expect(rejects({ ...run([]), commit })).toBe(true)
    })

    it('accepts a 64-character commit, the length SHA-256 repositories use', () => {
      expect(accepts({ ...run([]), commit: 'c'.repeat(64) })).toBe(true)
    })

    it.each(['1.2', 'v1.2.3', '1.2.3.4', 'latest', ''])('for the version %j', (version) => {
      expect(rejects({ ...run([]), version })).toBe(true)
    })

    it('accepts a pre-release version', () => {
      expect(accepts({ ...run([]), version: '1.2.3-rc.1+build.5' })).toBe(true)
    })

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('for the run ID %j', (runId) => {
      expect(rejects({ ...run([]), runId })).toBe(true)
    })

    it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('for %j state-changing QA commands', (stateChangingQaCommands) => {
      expect(rejects({ ...run([]), stateChangingQaCommands })).toBe(true)
    })

    it('for an unknown environment tier', () => {
      expect(rejects({ ...run([]), environment: { tier: 'prod', browser: 'chromium' } })).toBe(true)
    })
  })

  describe('rejects a runUrl that leads anywhere but this run on github.com', () => {
    const repo = 'nerima-games/mc-host-web'
    const good = `https://github.com/${repo}/actions/runs/100`

    it('accepts the run page and its attempt pages', () => {
      expect(accepts({ ...run([]), runUrl: good })).toBe(true)
      expect(accepts({ ...run([]), runUrl: `${good}/attempts/2` })).toBe(true)
    })

    it.each([
      ['another host', `https://evil.example/${repo}/actions/runs/100`],
      ['a lookalike host', `https://github.com.evil.example/${repo}/actions/runs/100`],
      ['plain http', `http://github.com/${repo}/actions/runs/100`],
      ['credentials', `https://user:pass@github.com/${repo}/actions/runs/100`],
      ['a port', `https://github.com:8443/${repo}/actions/runs/100`],
      ['another repository', 'https://github.com/nerima-games/mc-kernel/actions/runs/100'],
      ['another run', `https://github.com/${repo}/actions/runs/101`],
      ['a longer run ID', `https://github.com/${repo}/actions/runs/1000`],
      ['a data URL', 'data:text/html,<script>1</script>'],
      ['no URL', 'not a url'],
      ['an empty string', ''],
    ])('for %s', (_name, runUrl) => {
      expect(rejects({ ...run([]), runUrl })).toBe(true)
    })
  })

  describe('rejects timestamps that are not real ISO 8601 dates', () => {
    it.each([
      'yesterday',
      '2026-12-01',
      '2026-12-01 12:00:00Z',
      '2026-12-01T12:00:00',
      '2026-13-01T12:00:00Z',
      '2026-12-32T12:00:00Z',
      '2026-12-01T25:00:00Z',
      '',
    ])('for %j', (timestamp) => {
      expect(rejects({ ...run([]), startedAt: timestamp })).toBe(true)
      expect(rejects(withCheck({ measuredAt: timestamp }))).toBe(true)
    })

    it('accepts fractional seconds and offsets', () => {
      expect(accepts(withCheck({ measuredAt: '2026-12-01T12:00:00.123Z' }))).toBe(true)
      expect(accepts(withCheck({ measuredAt: '2026-12-01T21:00:00+09:00' }))).toBe(true)
    })

    it('rejects a run that finished before it started', () => {
      expect(rejects({ ...run([]), startedAt: FRESH, finishedAt: '2026-01-01T00:00:00Z' })).toBe(true)
    })
  })

  describe('rejects paths the site must not join onto its own URLs', () => {
    const traversal = [
      '../secret',
      'a/../b',
      '/etc/passwd',
      'a//b',
      'a/./b',
      './a',
      'a/',
      'a\\b',
      'a?x=1',
      'a#frag',
      'a%2e%2e/b',
      'https://evil.example/a.png',
      'file:///etc/passwd',
      'a b.png',
      'a\u0000b',
      'a\nb',
      '',
    ]

    it.each(traversal)('as evidence.path %j', (path) => {
      expect(rejects(withCheck({ evidence: [{ kind: 'image', path }] }))).toBe(true)
    })

    it.each(traversal)('as testRef.file %j', (file) => {
      expect(rejects(withCheck({ testRef: { file } }))).toBe(true)
    })

    it('accepts ordinary artifact paths', () => {
      for (const path of ['a.png', 'screens/S09/recipeBook-ja_1280.png', 'v1.2/trace.zip', 'a@2x.png']) {
        expect(accepts(withCheck({ evidence: [{ kind: 'image', path }] })), path).toBe(true)
      }
    })
  })

  describe('rejects values that are not JSON-safe numbers', () => {
    it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('for the value %j', (value) => {
      expect(rejects(withCheck({ value }))).toBe(true)
    })

    it('for a negative step time or evidence time', () => {
      const step = { id: 's', title: 't', atMs: -1, durationMs: 0, verdict: 'pass' } as const

      expect(rejects(withCheck({ steps: [step] }))).toBe(true)
      expect(rejects(withCheck({ evidence: [{ kind: 'video', path: 'a.webm', atMs: -1 }] }))).toBe(true)
    })

    it('for a test line that is not a positive integer', () => {
      for (const line of [0, -1, 1.5, Number.NaN]) {
        expect(rejects(withCheck({ testRef: { file: 'a.ts', line } })), String(line)).toBe(true)
      }
    })
  })

  describe('rejects checks that break the contract of a verdict or a group', () => {
    it('for a verdict outside pass, fail, missing and unmeasurable', () => {
      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), verdict: 'stale' }] })).toBe(true)
    })

    it('for a group outside the fourteen', () => {
      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), group: 'misc' }] })).toBe(true)
    })

    it('for an unmeasurable check without a reason, or with an empty one', () => {
      expect(rejects(withCheck({ verdict: 'unmeasurable' }))).toBe(true)
      expect(rejects(withCheck({ verdict: 'unmeasurable', reason: '' }))).toBe(true)
    })

    it('but accepts an unmeasurable check with a reason, and a failure that has none', () => {
      expect(accepts(withCheck({ verdict: 'unmeasurable', reason: 'この環境では測れません' }))).toBe(true)
      expect(accepts(withCheck({ verdict: 'fail' }))).toBe(true)
    })

    it.each(['', '/ux/1', 'ux//1', 'ux/1/', 'ux/ 1', 'ux/../1', '../ux', `ux/${'a'.repeat(300)}`])('for the check ID %j', (id) => {
      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), id }] })).toBe(true)
    })

    it('for a check ID used twice in one run', () => {
      expect(rejects(run([check('ux/1'), check('ux/1', { verdict: 'fail' })]))).toBe(true)
    })

    it('for a step verdict that is not pass or fail', () => {
      const step = { id: 's', title: 't', atMs: 0, durationMs: 0, verdict: 'missing' }

      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), steps: [step] }] })).toBe(true)
    })

    it('for an evidence kind the site has no renderer for', () => {
      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), evidence: [{ kind: 'exe', path: 'a.exe' }] }] })).toBe(true)
    })
  })

  describe('enforces its size budgets', () => {
    it('refuses text longer than the limit and accepts text at it', () => {
      expect(accepts(withCheck({ title: 'a'.repeat(MAX_TEXT_LENGTH) }))).toBe(true)
      expect(rejects(withCheck({ title: 'a'.repeat(MAX_TEXT_LENGTH + 1) }))).toBe(true)
      expect(rejects(withCheck({ reason: 'a'.repeat(MAX_TEXT_LENGTH + 1) }))).toBe(true)
      expect(rejects(withCheck({ value: 'a'.repeat(MAX_TEXT_LENGTH + 1) }))).toBe(true)
    })

    it('refuses too many evidence items or steps in one check', () => {
      const evidence = (count: number): Check['evidence'] =>
        Array.from({ length: count }, (_unused, index) => ({ kind: 'log', path: `l${index}.txt` }) as const)
      const steps = (count: number): NonNullable<Check['steps']> =>
        Array.from({ length: count }, (_unused, index) => ({ id: `s${index}`, title: 't', atMs: 0, durationMs: 0, verdict: 'pass' }) as const)

      expect(accepts(withCheck({ evidence: evidence(MAX_EVIDENCE_PER_CHECK) }))).toBe(true)
      expect(rejects(withCheck({ evidence: evidence(MAX_EVIDENCE_PER_CHECK + 1) }))).toBe(true)
      expect(accepts(withCheck({ steps: steps(MAX_STEPS_PER_CHECK) }))).toBe(true)
      expect(rejects(withCheck({ steps: steps(MAX_STEPS_PER_CHECK + 1) }))).toBe(true)
    })

    it('refuses a run with more checks than the limit, and names the limit', () => {
      // Empty objects keep the decode cheap: the length rule must reject the file on its own account.
      const overLimit = { ...run([]), checks: Array.from({ length: MAX_CHECKS_PER_RUN + 1 }, () => ({})) }
      const decoded = decodeStatusRun(overLimit)

      expect(Result.isFailure(decoded) && decoded.failure.message).toContain(`at most ${MAX_CHECKS_PER_RUN}`)
    })
  })

  describe('bounds nested arrays before decoding any element', () => {
    /** An array whose elements throw when read: a decoder that visits them fails the test. */
    const untouchable = (length: number): ReadonlyArray<unknown> => {
      const items: unknown[] = new Array(length)
      for (let index = 0; index < length; index += 1) {
        Object.defineProperty(items, index, {
          enumerable: true,
          get: () => {
            throw new Error(`element ${index} was decoded`)
          },
        })
      }
      return items
    }
    const withNested = (key: 'steps' | 'evidence', length: number): unknown => ({
      ...run([]),
      checks: [{ ...check('ux/1'), [key]: untouchable(length) }],
    })

    it('rejects too many steps without reading them', () => {
      const decoded = decodeStatusRun(withNested('steps', MAX_STEPS_PER_CHECK + 1))

      expect(Result.isFailure(decoded) && decoded.failure.message).toContain(`at most ${MAX_STEPS_PER_CHECK}`)
    })

    it('rejects too much evidence without reading it', () => {
      const decoded = decodeStatusRun(withNested('evidence', MAX_EVIDENCE_PER_CHECK + 1))

      expect(Result.isFailure(decoded) && decoded.failure.message).toContain(`at most ${MAX_EVIDENCE_PER_CHECK}`)
    })

    it('names the check whose array is too long', () => {
      const decoded = decodeStatusRun({ ...run([]), checks: [check('ux/1'), { ...check('ux/2'), steps: untouchable(MAX_STEPS_PER_CHECK + 1) }] })

      expect(Result.isFailure(decoded) && decoded.failure.message).toContain('["checks"][1]["steps"]')
    })

    it('rejects a million steps at once', () => {
      const steps = Array.from({ length: 1_000_000 }, () => ({ id: 's', title: 't', atMs: 0, durationMs: 0, verdict: 'pass' }))

      expect(rejects({ ...run([]), checks: [{ ...check('ux/1'), steps }] })).toBe(true)
    })
  })

  it('names the rule that a rejected file broke', () => {
    const decoded = decodeStatusRun({ ...run([]), commit: 'not-a-sha' })

    expect(Result.isFailure(decoded) && String(decoded.failure.message)).toContain('commit')
  })

  it('keeps the commit exactly as given', () => {
    const decoded = decodeStatusRun(run([]))

    expect(Result.isSuccess(decoded) && decoded.success.commit).toBe(COMMIT)
  })
})

describe('predicates', () => {
  it('isSafeRelativePath refuses a path longer than its limit', () => {
    expect(isSafeRelativePath('a'.repeat(512))).toBe(true)
    expect(isSafeRelativePath('a'.repeat(513))).toBe(false)
  })

  it('isIso8601 needs both the shape and a real date', () => {
    expect(isIso8601('2026-12-01T12:00:00Z')).toBe(true)
    expect(isIso8601('2026-02-30T12:00:00Z')).toBe(false)
    expect(isIso8601('2026-12-01')).toBe(false)
  })

  it('isRunUrlFor matches the repository and run ID exactly', () => {
    expect(isRunUrlFor('https://github.com/nerima-games/mc-kernel/actions/runs/7', 'nerima-games/mc-kernel', 7)).toBe(true)
    expect(isRunUrlFor('https://github.com/nerima-games/mc-kernel/actions/runs/70', 'nerima-games/mc-kernel', 7)).toBe(false)
  })
})
