/**
 * Tests for `scripts/status/registry.ts`: the ID list the site relies on
 * must be stable, complete, and consistent with the documents it mirrors.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from '@effect/vitest'
import {
  CATALOG_CHECK_IDS,
  DOD_IDS,
  DOD_REQUIREMENTS,
  LEDGER_IDS,
  LEDGER_OUT_OF_SCOPE_IDS,
  ORGANIZATION,
  REPOSITORIES,
  SOURCES,
  classifyCheck,
  isRunFromSource,
  type DodId,
} from '../../scripts/status/registry'
import { CHECK_GROUPS } from '../../scripts/status/schema'
import { check } from './fixtures'

const COMPLETION_CRITERIA = new URL('../../docs/execution/completion-criteria.md', import.meta.url)

describe('LEDGER_IDS', () => {
  it('lists the same IDs as the parity ledger table, in the same order', () => {
    const table = readFileSync(COMPLETION_CRITERIA, 'utf8')
    const documented = [...table.matchAll(/^\| `([a-z-]+\/[^`]+)` \| (?:implemented|partial|missing|runtime-only) \|/gm)].map(
      (match) => match[1],
    )

    expect(documented).toHaveLength(98)
    expect(LEDGER_IDS).toEqual(documented)
  })

  it('has no duplicates and names only IDs that exist', () => {
    expect(new Set(LEDGER_IDS).size).toBe(LEDGER_IDS.length)
    for (const id of LEDGER_OUT_OF_SCOPE_IDS) expect(LEDGER_IDS).toContain(id)
  })
})

describe('REPOSITORIES', () => {
  it('lists the 17 repositories of the run once each', () => {
    expect(REPOSITORIES).toHaveLength(17)
    expect(new Set(REPOSITORIES).size).toBe(17)
  })
})

describe('DOD_REQUIREMENTS', () => {
  const withChecks = DOD_IDS.filter((dod) => dod !== 9)

  it('has an entry for each of the 13 DoD', () => {
    expect(Object.keys(DOD_REQUIREMENTS).map(Number)).toEqual([...DOD_IDS])
  })

  it('requires something for every DoD that is computed from checks, so an empty result cannot pass', () => {
    for (const dod of withChecks) {
      const requirement = DOD_REQUIREMENTS[dod]
      expect(requirement.requiredIds.length + requirement.coverage.length, `DoD-${dod}`).toBeGreaterThan(0)
    }
  })

  it('requires nothing by ID for DoD-9, which reads the deployments API', () => {
    expect(DOD_REQUIREMENTS[9]).toEqual({ requiredIds: [], coverage: [] })
  })

  it('registers every required ID for the DoD that requires it and for no other', () => {
    for (const dod of withChecks) {
      for (const id of DOD_REQUIREMENTS[dod].requiredIds) {
        const classification = classifyCheck(check(id))
        expect(classification.kind, id).toBe('registered')
        if (classification.kind === 'registered') {
          expect(classification.registration.dods, id).toEqual([dod])
        }
      }
    }
  })

  it('requires each ID once across all DoD', () => {
    const all = withChecks.flatMap((dod) => DOD_REQUIREMENTS[dod].requiredIds)

    expect(new Set(all).size).toBe(all.length)
  })

  it('requires the documented counts', () => {
    const counts: Readonly<Record<DodId, number>> = {
      1: 95,
      2: 7,
      3: 20,
      4: 1,
      5: 5,
      6: REPOSITORIES.length * 2,
      7: 1,
      8: 1,
      9: 0,
      10: 8,
      11: 12,
      12: 10,
      13: 0,
    }

    for (const dod of DOD_IDS) expect(DOD_REQUIREMENTS[dod].requiredIds, `DoD-${dod}`).toHaveLength(counts[dod])
    expect(CATALOG_CHECK_IDS).toContain('catalog/S02c')
    expect(CATALOG_CHECK_IDS).toContain('catalog/S17')
  })
})

describe('classifyCheck', () => {
  it('registers the IDs 55 §3 gives as examples', () => {
    for (const id of ['ux/5', 'journey/J7', 'feature/G2', 'screen/S09/recipeBook/ja/1280', 'ledger/perf/fr-2.2', 'perf/R1', 'compose/C02', 'audio/bgm/night', 'progression/first-iron']) {
      expect(classifyCheck(check(id)).kind, id).toBe('registered')
    }
  })

  it('reports an unknown ID instead of dropping it', () => {
    expect(classifyCheck(check('ux/13'))).toEqual({ kind: 'unregistered', reason: 'unknown-id' })
    expect(classifyCheck(check('feature'))).toEqual({ kind: 'unregistered', reason: 'unknown-id' })
    expect(classifyCheck(check('uxx/1', { group: 'ux' }))).toEqual({ kind: 'unregistered', reason: 'unknown-id' })
  })

  it('reports a group that does not match the ID', () => {
    expect(classifyCheck(check('ux/1', { group: 'journey' }))).toEqual({ kind: 'unregistered', reason: 'group-mismatch' })
  })

  it('lets an exact ID take precedence over its namespace', () => {
    const smoke = classifyCheck(check('live/smoke'))
    const other = classifyCheck(check('live/p17'))

    expect(smoke).toEqual({ kind: 'registered', registration: { group: 'live', dods: [8] } })
    expect(other).toEqual({ kind: 'registered', registration: { group: 'live', dods: [] } })
  })

  it('registers the out-of-scope ledger rows so they are shown, without feeding any DoD', () => {
    for (const id of LEDGER_OUT_OF_SCOPE_IDS) {
      expect(classifyCheck(check(`ledger/${id}`))).toEqual({ kind: 'registered', registration: { group: 'ledger', dods: [] } })
    }
  })

  it('gives every group a place to register', () => {
    const registeredGroups = new Set(
      [
        'ux/1',
        'journey/J1',
        'feature/G1',
        'screen/S01/a/ja/1280',
        'ledger/perf/fr-2.2',
        'content/blocks',
        'catalog/S01',
        'perf/R1',
        'compose/C01',
        'audio/bgm/day',
        'progression/bed',
        'ci/mc-kernel/main',
        'live/smoke',
        'audit/high-1',
      ].map((id) => {
        const classification = classifyCheck(check(id))
        return classification.kind === 'registered' ? classification.registration.group : undefined
      }),
    )

    expect([...registeredGroups].sort()).toEqual([...CHECK_GROUPS].sort())
  })
})

describe('SOURCES', () => {
  it('has one source per repository and workflow', () => {
    const keys = SOURCES.map((source) => `${source.repo}#${source.workflow}`)

    expect(new Set(keys).size).toBe(keys.length)
  })

  it('names only repositories of the run, and fetches every file over https with no credentials', () => {
    for (const source of SOURCES) {
      const [owner, name] = source.repo.split('/')
      expect(owner).toBe(ORGANIZATION)
      expect(REPOSITORIES.some((repository) => repository === name), source.repo).toBe(true)

      const url = new URL(source.location.url)
      expect(url.protocol).toBe('https:')
      expect(url.username + url.password + url.search + url.hash).toBe('')
    }
  })

  it('serves a Pages source from the repository site and a release source from its release downloads', () => {
    for (const source of SOURCES) {
      const name = source.repo.split('/')[1]
      const url = new URL(source.location.url)
      if (source.location.kind === 'pages') {
        expect(url.hostname).toBe(`${ORGANIZATION}.github.io`)
        expect(url.pathname).toBe(`/${name}/status/v1/${source.workflow}/latest.json`)
      } else {
        expect(url.hostname).toBe('github.com')
        expect(url.pathname.startsWith(`/${source.repo}/releases/download/`)).toBe(true)
      }
    }
  })

  it('publishes mc-host-web T0 measurements as the asset of the status-t0 prerelease', () => {
    const t0 = SOURCES.find((source) => source.repo === `${ORGANIZATION}/mc-host-web` && source.workflow === 't0')

    expect(t0?.location).toEqual({
      kind: 'release',
      url: `https://github.com/${ORGANIZATION}/mc-host-web/releases/download/status-t0/status-v1.json`,
    })
  })

  it('covers every producer named in 55 §3.1', () => {
    const has = (repository: string, workflow: string): boolean =>
      SOURCES.some((source) => source.repo === `${ORGANIZATION}/${repository}` && source.workflow === workflow)

    for (const workflow of ['ci', 'nightly', 'release', 'deploy']) expect(has('mc-host-web', workflow), workflow).toBe(true)
    expect(has('mc-audio', 'ci')).toBe(true)
    expect(has('mc-sim', 'nightly')).toBe(true)
    expect(has('mc-compose', 'ci')).toBe(true)
    expect(has('mc-compose', 'nightly')).toBe(true)
  })
})

describe('isRunFromSource', () => {
  const source = SOURCES[0]
  if (source === undefined) throw new Error('SOURCES is empty')

  it('accepts a file that names the repository and workflow it was fetched for', () => {
    expect(isRunFromSource({ repo: source.repo, workflow: source.workflow }, source)).toBe(true)
  })

  it('refuses a file that speaks for another repository or another workflow', () => {
    expect(isRunFromSource({ repo: `${ORGANIZATION}/mc-kernel`, workflow: source.workflow }, source)).toBe(false)
    expect(isRunFromSource({ repo: source.repo, workflow: 'other' }, source)).toBe(false)
  })
})
