import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  allowedDirectDependencies,
  checkDeclaredDependencies,
  checkPolicyConfiguration,
  classifyImport,
  extractOrgPackageName,
  findBannedTimeSources,
  findCycles,
  findTransitivePath,
  isToolingOrTestPath,
  isUnpublishedPath,
  maskSource,
  parseImports,
  REPOSITORY_POLICY,
  SCAN_ROOTS,
  type DeclaredDependencies,
} from '../scripts/check-dependency-whitelist'

const NOTHING_DECLARED: DeclaredDependencies = {
  dependencies: new Set<string>(),
  devDependencies: new Set<string>(),
}

const graph = (entries: ReadonlyArray<readonly [string, ReadonlyArray<string>]>): Map<string, ReadonlySet<string>> =>
  new Map(entries.map(([node, targets]) => [node, new Set(targets)]))

describe('mc-compose dependency policy', () => {
  it.effect('depends on the four experience modules plus mc-render — and on no other foundation', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.thisPackage).toBe('@nerima-games/mc-compose')
      expect([...allowedDirectDependencies()].sort()).toStrictEqual([
        // The one tier-2 edge, added by the vertical-slice spike: mc-render
        // registers the frame's input / camera-mirror / chunk-sync / draw /
        // post-fx stages and nothing else in the roster could reach it.
        // See docs/architecture.md §5.
        '@nerima-games/mc-render',
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
      ])
    }),
  )

  // REGRESSION: the mc-render edge must stay the ONLY tier-2 edge. It is the
  // one exception the spike endorsed, and the argument for it — "registering
  // another module's stages is wiring, not a rule" — does not generalise to
  // mc-sim, mc-worldgen or anything else with state in it.
  it.effect('adds mc-render and nothing else below tier 3', () =>
    Effect.sync(() => {
      const belowTierThree = [...allowedDirectDependencies()].filter(
        (name) => !name.startsWith('@nerima-games/mx-'),
      )
      expect(belowTierThree).toStrictEqual(['@nerima-games/mc-render'])
    }),
  )

  it.effect('has an internally consistent configuration, so the gate itself cannot be quietly broken', () =>
    Effect.sync(() => {
      expect(checkPolicyConfiguration()).toStrictEqual([])
    }),
  )

  // REGRESSION: "the roster is complete". The graph is a mirror of 16
  // repositories; a missing row makes every import of the absent package fail
  // as `unknown-package`, and — worse — makes a cycle through it invisible.
  it.effect('carries all 16 repositories of the roster, not just this one', () =>
    Effect.sync(() => {
      expect([...REPOSITORY_POLICY.dependencyGraph.keys()].sort()).toStrictEqual([
        '@nerima-games/mc-audio',
        '@nerima-games/mc-compose',
        '@nerima-games/mc-dev-meta',
        '@nerima-games/mc-kernel',
        '@nerima-games/mc-meshing',
        '@nerima-games/mc-noise',
        '@nerima-games/mc-physics',
        '@nerima-games/mc-playground-kit',
        '@nerima-games/mc-render',
        '@nerima-games/mc-save',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-worldgen',
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-multiplayer',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
      ])
    }),
  )

  // REGRESSION: plan.md §2.3-1 — the four experience modules have zero edges
  // between them. "mining puts an item in the inventory" goes through mc-sim's
  // InventoryService, not through an mx-gameplay -> mx-ui import.
  it.effect('records no edge between any two experience modules', () =>
    Effect.sync(() => {
      const experience = [
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
        '@nerima-games/mx-multiplayer',
      ]
      for (const module of experience) {
        for (const target of REPOSITORY_POLICY.dependencyGraph.get(module) ?? []) {
          expect(experience).not.toContain(target)
        }
      }
    }),
  )

  // REGRESSION: mc-kernel is universally importable, which is expressed by its
  // ABSENCE from every row. `checkPolicyConfiguration` rejects a graph that
  // names it; this pins the intent so the rule is not "fixed" by adding it.
  it.effect('never names mc-kernel as an edge, because it is importable everywhere', () =>
    Effect.sync(() => {
      for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
        expect([...targets]).not.toContain('@nerima-games/mc-kernel')
      }
    }),
  )

  // REGRESSION: plan.md §3.10 / §2.3-2 — mc-playground-kit is devDependency
  // only. A runtime edge to it would delete input handling from the shipped
  // build, so it must appear in no row's value set at all.
  it.effect('never names mc-playground-kit as a runtime edge', () =>
    Effect.sync(() => {
      for (const targets of REPOSITORY_POLICY.dependencyGraph.values()) {
        expect([...targets]).not.toContain('@nerima-games/mc-playground-kit')
      }
    }),
  )

  it.effect('declares a graph with no cycles anywhere in the roster', () =>
    Effect.sync(() => {
      expect(findCycles(REPOSITORY_POLICY.dependencyGraph)).toStrictEqual([])
    }),
  )
})

describe('the prime directive, mechanically enforced', () => {
  const from = (importedPackage: string) => ({
    importedPackage,
    filePath: 'domain/stage-order.ts',
    line: 1,
    isToolingOrTest: false,
  })

  const declaredEverything: DeclaredDependencies = {
    dependencies: new Set([
      '@nerima-games/mx-gameplay',
      '@nerima-games/mx-redstone',
      '@nerima-games/mx-ui',
      '@nerima-games/mx-multiplayer',
      '@nerima-games/mc-sim',
      '@nerima-games/mc-worldgen',
      '@nerima-games/mc-render',
    ]),
    devDependencies: new Set<string>(),
  }

  // REGRESSION — THE one this repository exists for. The reference
  // implementation accumulated 20,737 production LOC in
  // `packages/app/application/` because its composition layer could reach any
  // service it wanted. A rule that needs mc-sim directly is a rule that belongs
  // in an experience module; the gate turns that from a review opinion into a
  // build failure.
  it.effect('rejects reaching past the experience modules to mc-sim, and names the path', () =>
    Effect.sync(() => {
      const violation = classifyImport(from('@nerima-games/mc-sim'), declaredEverything)
      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('@nerima-games/mc-sim')
    }),
  )

  it.effect('rejects every foundation and library it can reach transitively', () =>
    Effect.sync(() => {
      for (const reached of [
        '@nerima-games/mc-worldgen',
        '@nerima-games/mc-physics',
        '@nerima-games/mc-save',
        '@nerima-games/mc-audio',
        '@nerima-games/mc-noise',
      ]) {
        expect(classifyImport(from(reached), declaredEverything)?.rule).toBe('transitive-import')
      }
    }),
  )

  // INVERTED, deliberately, and the inversion is the point.
  //
  // This test used to read `cannot reach mc-render or mc-meshing at all — no
  // runtime edge in the roster leads there`, and it was RIGHT about the graph
  // as declared: mc-render's only dependant was mc-playground-kit, which is
  // devDependency-only and contributes no runtime edge. docs/architecture.md §5
  // called that a hole in plan.md §2.1 and listed three ways to close it,
  // explicitly refusing to pick one unilaterally.
  //
  // The vertical-slice spike picked option 2, and the consequence was concrete
  // rather than architectural: `InputService.endFrame` must be called exactly
  // once per frame, that is a stage by definition, and the only registered
  // input stage in the whole roster lived in mc-playground-kit — which is
  // dev-only, so the SHIPPED build had no input stage at all. That is precisely
  // the failure plan.md §2.3-2 exists to prevent.
  //
  // The test is inverted rather than deleted because both halves still matter:
  // mc-render is now reachable, and mc-meshing must still not be.
  it.effect('reaches mc-render, because compose registers the renderer’s stages', () =>
    Effect.sync(() => {
      expect(classifyImport(from('@nerima-games/mc-render'), declaredEverything)).toBeUndefined()
    }),
  )

  // REGRESSION: the edge licenses mc-render and NOTHING BEHIND IT. Rule 3 (no
  // transitive closure) is what keeps "compose may wire the renderer" from
  // becoming "compose may reach the mesher". The message changes from
  // `not-whitelisted` to `transitive-import` — the failure does not.
  it.effect('still cannot reach mc-meshing, now as a closure violation rather than a flat one', () =>
    Effect.sync(() => {
      const violation = classifyImport(from('@nerima-games/mc-meshing'), declaredEverything)
      expect(violation?.rule).toBe('transitive-import')
      expect(violation?.message).toContain('@nerima-games/mc-render')
    }),
  )

  it.effect('allows all four experience modules when they are declared', () =>
    Effect.sync(() => {
      for (const allowed of [
        '@nerima-games/mx-gameplay',
        '@nerima-games/mx-redstone',
        '@nerima-games/mx-ui',
        '@nerima-games/mx-multiplayer',
      ]) {
        expect(classifyImport(from(allowed), declaredEverything)).toBeUndefined()
      }
    }),
  )

  it.effect('allows mc-kernel without it appearing in any allowlist, once declared', () =>
    Effect.sync(() => {
      expect(
        classifyImport(from('@nerima-games/mc-kernel'), {
          dependencies: new Set(['@nerima-games/mc-kernel']),
          devDependencies: new Set<string>(),
        }),
      ).toBeUndefined()
    }),
  )
})

describe('cycle rejection', () => {
  it.effect('rejects a two-node cycle outright — there is no co-evolution allowlist in this project', () =>
    Effect.sync(() => {
      const violations = findCycles(graph([['a', ['b']], ['b', ['a']]]))
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]?.rule).toBe('cycle')
      expect(violations[0]?.message).toContain('->')
    }),
  )

  it.effect('rejects a longer cycle and names the path it found', () =>
    Effect.sync(() => {
      const violations = findCycles(graph([['a', ['b']], ['b', ['c']], ['c', ['a']]]))
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]?.message).toContain('a -> b -> c -> a')
    }),
  )

  it.effect('accepts a diamond, because a DAG with a shared descendant is not a cycle', () =>
    Effect.sync(() => {
      const violations = findCycles(
        graph([['a', ['b', 'c']], ['b', ['d']], ['c', ['d']], ['d', []]]),
      )
      expect(violations).toStrictEqual([])
    }),
  )

  it.effect('accepts an empty graph and the single-node kernel graph', () =>
    Effect.sync(() => {
      expect(findCycles(graph([]))).toStrictEqual([])
      expect(findCycles(graph([['@nerima-games/mc-kernel', []]]))).toStrictEqual([])
    }),
  )
})

describe('transitive closure', () => {
  it.effect('findTransitivePath produces the chain that explains why an import is not licensed', () =>
    Effect.sync(() => {
      const declared = graph([
        ['@nerima-games/mc-app', ['@nerima-games/mc-sim']],
        ['@nerima-games/mc-sim', ['@nerima-games/mc-physics']],
        ['@nerima-games/mc-physics', []],
      ])

      expect(findTransitivePath(declared, '@nerima-games/mc-app', '@nerima-games/mc-physics')).toStrictEqual([
        '@nerima-games/mc-app',
        '@nerima-games/mc-sim',
        '@nerima-games/mc-physics',
      ])
    }),
  )

  it.effect('findTransitivePath returns undefined when there is no path at all', () =>
    Effect.sync(() => {
      const declared = graph([['a', ['b']], ['b', []], ['c', []]])
      expect(findTransitivePath(declared, 'a', 'c')).toBeUndefined()
    }),
  )
})

describe('classifyImport', () => {
  const site = (importedPackage: string, isToolingOrTest = false) => ({
    importedPackage,
    filePath: isToolingOrTest ? 'test/example.test.ts' : 'domain/example.ts',
    line: 3,
    isToolingOrTest,
  })

  it.effect('rejects importing this package by name instead of relatively', () =>
    Effect.sync(() => {
      const violation = classifyImport(site('@nerima-games/mc-compose'), NOTHING_DECLARED)
      expect(violation?.rule).toBe('self-import')
    }),
  )

  it.effect('rejects an org package that is not in the declared graph, so the gate fails closed', () =>
    Effect.sync(() => {
      const violation = classifyImport(site('@nerima-games/mc-does-not-exist'), NOTHING_DECLARED)
      expect(violation?.rule).toBe('unknown-package')
      expect(violation?.filePath).toBe('domain/example.ts')
      expect(violation?.line).toBe(3)
    }),
  )

  it.effect('rejects mc-playground-kit imported from shipped source, with the reason spelled out', () =>
    Effect.sync(() => {
      const violation = classifyImport(site('@nerima-games/mc-playground-kit'), {
        dependencies: new Set<string>(),
        devDependencies: new Set(['@nerima-games/mc-playground-kit']),
      })
      expect(violation?.rule).toBe('dev-only-package-in-shipped-source')
      expect(violation?.message).toContain('input handling')
    }),
  )

  it.effect('allows mc-playground-kit from a test file when it is declared in devDependencies', () =>
    Effect.sync(() => {
      const violation = classifyImport(site('@nerima-games/mc-playground-kit', true), {
        dependencies: new Set<string>(),
        devDependencies: new Set(['@nerima-games/mc-playground-kit']),
      })
      expect(violation).toBeUndefined()
    }),
  )

  it.effect('still requires an otherwise-allowed import to be declared in package.json', () =>
    Effect.sync(() => {
      const violation = classifyImport(site('@nerima-games/mc-playground-kit', true), NOTHING_DECLARED)
      expect(violation?.rule).toBe('undeclared-dependency')
    }),
  )
})

/**
 * The browser entry point's exemption (`REPOSITORY_POLICY.devServerResolved`).
 *
 * REGRESSION — this is a HOLE IN A GATE, and a hole nobody tests is a hole that
 * grows. The gate's own norm is docs/testing.md's:「テストされていない腐り検出器は、
 * それが守るはずだった腐ったマニフェストと同じ価値しか無い」。
 *
 * The exemption exists because rule 5 (DECLARED == IMPORTED) had no satisfiable
 * answer under `apps/`: the organisation forbids declaring an unpublished
 * sibling (mc-dev-meta/scripts/check-repoint.ts — every repository also builds
 * standalone, where `workspace:*` does not resolve). See docs/testing.md §3.5.1.
 *
 * What these pin is the SHAPE of the hole: one rule, one root, no extra reach.
 */
describe('the unpublished-root exemption', () => {
  const inApps = (importedPackage: string) => ({
    importedPackage,
    filePath: 'apps/web/main.ts',
    line: 3,
    isToolingOrTest: true,
  })

  const inDomain = (importedPackage: string) => ({
    importedPackage,
    filePath: 'domain/example.ts',
    line: 3,
    isToolingOrTest: false,
  })

  it.effect('recognises apps/ as unpublished, and every other scanned root as published', () =>
    Effect.sync(() => {
      expect(isUnpublishedPath('apps/web/main.ts')).toBe(true)
      // The rest of SCAN_ROOTS. `index.ts` and `domain/` are in package.json
      // `files`; `scripts/` and `test/` are not shipped but are also not
      // resolved by a dev server, so they keep the ordinary requirement.
      expect(isUnpublishedPath('index.ts')).toBe(false)
      expect(isUnpublishedPath('domain/composition.ts')).toBe(false)
      expect(isUnpublishedPath('scripts/api-lock.ts')).toBe(false)
      expect(isUnpublishedPath('test/composition.test.ts')).toBe(false)
      // Not a prefix match on the bare word: a `apps-legacy/` directory must
      // not inherit the exemption.
      expect(isUnpublishedPath('apps-legacy/main.ts')).toBe(false)
    }),
  )

  it.effect('waives the package.json declaration for the modules the dev server aliases', () =>
    Effect.sync(() => {
      for (const resolved of REPOSITORY_POLICY.devServerResolved) {
        expect(classifyImport(inApps(resolved), NOTHING_DECLARED)).toBeUndefined()
      }
    }),
  )

  // REGRESSION — THE reason the exemption is written after the whitelist checks
  // rather than before them. `apps/` is the composition layer's own front door;
  // if it could reach mc-sim, every rule mc-compose exists to enforce
  // (domain/composition.ts's prime directive) would be reachable from a file
  // nobody thinks of as shipped source.
  it.effect('still refuses to let apps/ reach past the modules it may compose', () =>
    Effect.sync(() => {
      expect(classifyImport(inApps('@nerima-games/mc-sim'), NOTHING_DECLARED)?.rule).toBe(
        'transitive-import',
      )
      expect(classifyImport(inApps('@nerima-games/mc-meshing'), NOTHING_DECLARED)?.rule).toBe(
        'transitive-import',
      )
      expect(classifyImport(inApps('@nerima-games/mc-does-not-exist'), NOTHING_DECLARED)?.rule).toBe(
        'unknown-package',
      )
    }),
  )

  // REGRESSION: a whitelisted module that is NOT in `devServerResolved` gets no
  // exemption. The set is the dev server's alias table; a module absent from it
  // would not resolve in the browser either, so a gate that passed it would be
  // reporting on a build that cannot run.
  it.effect('does not waive the declaration for a whitelisted module the dev server does not alias', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.devServerResolved.has('@nerima-games/mx-gameplay')).toBe(false)
      expect(classifyImport(inApps('@nerima-games/mx-gameplay'), NOTHING_DECLARED)?.rule).toBe(
        'undeclared-dependency',
      )
    }),
  )

  // REGRESSION: the exemption is scoped to the ROOT, not to the package. The
  // shipped `domain/` importing mc-render must still declare it — that import
  // really would be missing from an install.
  it.effect('does not waive the declaration outside an unpublished root', () =>
    Effect.sync(() => {
      expect(classifyImport(inDomain('@nerima-games/mc-render'), NOTHING_DECLARED)?.rule).toBe(
        'undeclared-dependency',
      )
    }),
  )

  // REGRESSION: rule 6 outranks the exemption. mc-playground-kit in a runtime
  // entry point would ship a game whose input handling comes from the developer
  // harness — i.e. a released build with no input handling at all.
  it.effect('does not let the exemption admit the dev-only package', () =>
    Effect.sync(() => {
      expect(REPOSITORY_POLICY.devServerResolved.has('@nerima-games/mc-playground-kit')).toBe(false)
    }),
  )

  // REGRESSION: every exempted package must also be a legal direct dependency.
  // The set may waive a declaration; it must never grant reach.
  it.effect('exempts only packages that are already whitelisted direct dependencies', () =>
    Effect.sync(() => {
      const allowed = allowedDirectDependencies()
      for (const resolved of REPOSITORY_POLICY.devServerResolved) {
        expect(allowed.has(resolved)).toBe(true)
      }
    }),
  )
})

describe('checkDeclaredDependencies', () => {
  it.effect('rejects @nerima-games/mc-playground-kit in "dependencies", because it is devDependency-only', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies({
        dependencies: new Set(['effect', '@nerima-games/mc-playground-kit']),
        devDependencies: new Set<string>(),
      })
      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('dev-only-package-in-dependencies')
      expect(violations[0]?.message).toContain('input handling')
    }),
  )

  it.effect('accepts @nerima-games/mc-playground-kit in "devDependencies"', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies({
        dependencies: new Set(['effect']),
        devDependencies: new Set(['@nerima-games/mc-playground-kit', 'vitest']),
      })
      expect(violations).toStrictEqual([])
    }),
  )

  it.effect('rejects an org dependency the policy does not allow, even if the code never imports it', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies({
        dependencies: new Set(['@nerima-games/mc-sim']),
        devDependencies: new Set<string>(),
      })
      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('undeclared-in-policy')
    }),
  )

  it.effect('ignores non-org dependencies entirely', () =>
    Effect.sync(() => {
      const violations = checkDeclaredDependencies({
        dependencies: new Set(['effect', 'three']),
        devDependencies: new Set(['vitest', 'oxlint']),
      })
      expect(violations).toStrictEqual([])
    }),
  )
})

describe('maskSource', () => {
  it.effect('preserves length and line structure, so offsets stay valid against the original', () =>
    Effect.sync(() => {
      const source = ['const a = "text"', '// comment', '/* block */', 'const b = `tpl`'].join('\n')
      const masked = maskSource(source)
      expect(masked).toHaveLength(source.length)
      expect(masked.split('\n')).toHaveLength(4)
    }),
  )

  it.effect('blanks comment bodies and string interiors while keeping the delimiters', () =>
    Effect.sync(() => {
      expect(maskSource('const a = "hello"')).toBe('const a = "     "')
      expect(maskSource('const a = 1 // why')).toBe('const a = 1       ')
    }),
  )

  it.effect('keeps `${...}` interpolations as live code inside a template literal', () =>
    Effect.sync(() => {
      expect(maskSource('`x${ y }z`')).toBe('` ${ y } `')
    }),
  )
})

describe('import extraction', () => {
  it.effect('finds single-line, multi-line, side-effect, re-export and dynamic imports', () =>
    Effect.sync(() => {
      const source = [
        "import { a } from '@nerima-games/mc-alpha'",
        'import {',
        '  b,',
        "} from '@nerima-games/mc-beta'",
        "import '@nerima-games/mc-gamma'",
        "export * from '@nerima-games/mc-delta'",
        "const later = await import('@nerima-games/mc-epsilon')",
      ].join('\n')

      const specifiers = parseImports(source).map((record) => record.specifier)

      expect(specifiers).toContain('@nerima-games/mc-alpha')
      expect(specifiers).toContain('@nerima-games/mc-beta')
      expect(specifiers).toContain('@nerima-games/mc-gamma')
      expect(specifiers).toContain('@nerima-games/mc-delta')
      expect(specifiers).toContain('@nerima-games/mc-epsilon')
    }),
  )

  it.effect('ignores imports that only appear inside comments', () =>
    Effect.sync(() => {
      const source = [
        "// import { a } from '@nerima-games/mc-commented-out'",
        '/*',
        " import { b } from '@nerima-games/mc-block-commented'",
        '*/',
        "import { c } from '@nerima-games/mc-real'",
      ].join('\n')

      const specifiers = parseImports(source).map((record) => record.specifier)
      expect(specifiers).toStrictEqual(['@nerima-games/mc-real'])
    }),
  )

  it.effect('reports the line an import was found on', () =>
    Effect.sync(() => {
      const source = ['const x = 1', '', "import { a } from '@nerima-games/mc-alpha'"].join('\n')
      expect(parseImports(source)[0]?.line).toBe(3)
    }),
  )

  it.effect('maps a deep specifier back to the package that owns it', () =>
    Effect.sync(() => {
      expect(extractOrgPackageName('@nerima-games/mc-sim/domain/tick')).toBe('@nerima-games/mc-sim')
      expect(extractOrgPackageName('@nerima-games/mc-sim')).toBe('@nerima-games/mc-sim')
      expect(extractOrgPackageName('effect')).toBeUndefined()
      expect(extractOrgPackageName('./relative')).toBeUndefined()
      expect(extractOrgPackageName('@other-scope/thing')).toBeUndefined()
    }),
  )
})

describe('the Date.now() ban', () => {
  const banned = (source: string) => findBannedTimeSources(source, 'domain/example.ts')

  // NOTE: every fixture below is a string literal, so the checker's own scan of
  // this file masks it out. If one of these ever starts failing `pnpm check:deps`
  // that is a genuine bug in maskSource, not a problem with the test.

  it.effect('flags a bare wall-clock read, which oxlint 0.12 cannot express as a rule', () =>
    Effect.sync(() => {
      const violations = banned('const t = Date.now()')
      expect(violations).toHaveLength(1)
      expect(violations[0]?.rule).toBe('banned-time-source')
      expect(violations[0]?.message).toContain('ClockPort')
    }),
  )

  it.effect('flags new Date() and performance.now() as the same class of violation', () =>
    Effect.sync(() => {
      expect(banned('const t = new Date()')).toHaveLength(1)
      expect(banned('const t = performance.now()')).toHaveLength(1)
    }),
  )

  it.effect('does not flag a mention inside a line comment', () =>
    Effect.sync(() => {
      expect(banned('// never call Date.now() here')).toStrictEqual([])
    }),
  )

  it.effect('does not flag a mention inside a string literal', () =>
    Effect.sync(() => {
      expect(banned('const message = "Date.now() is banned"')).toStrictEqual([])
    }),
  )

  it.effect('does not flag a mention inside a regex literal', () =>
    Effect.sync(() => {
      expect(banned('const pattern = /Date\\.now\\(/u')).toStrictEqual([])
    }),
  )

  it.effect('does flag a call hidden inside a template literal interpolation', () =>
    Effect.sync(() => {
      expect(banned('const message = `at ${Date.now()}`')).toHaveLength(1)
    }),
  )

  it.effect('honours the escape hatch, which exists for the one adapter that implements the clock Port', () =>
    Effect.sync(() => {
      expect(banned('const t = Date.now() // mc-kernel-allow-time-source: this IS the adapter')).toStrictEqual([])
    }),
  )

  it.effect('reports the line the call was on', () =>
    Effect.sync(() => {
      expect(banned(['const a = 1', 'const b = 2', 'const t = Date.now()'].join('\n'))[0]?.line).toBe(3)
    }),
  )

  it.effect('does not mistake division for a regex literal and blank the rest of the file', () =>
    Effect.sync(() => {
      const source = ['const half = total / 2', 'const third = total / 3', 'const t = Date.now()'].join('\n')
      expect(banned(source)).toHaveLength(1)
    }),
  )
})

/**
 * RULE 6's SECOND HALF: the gate only bites where `isToolingOrTestPath` says
 * "shipped".
 *
 * ---------------------------------------------------------------------------
 * The defect this block was written against, which happened in a sibling
 * ---------------------------------------------------------------------------
 *
 * `SCAN_ROOTS` and `isToolingOrTestPath` are two hand-maintained lists that must
 * agree, and nothing connected them. mx-multiplayer's copy of this script had
 * `stages` in `SCAN_ROOTS` but NOT in `isToolingOrTestPath`, so every file under
 * `stages/` — shipped code, in its `package.json` `files` — was classified as
 * tooling. The consequence is precise: rule 6 says mc-playground-kit may not be
 * imported from shipped source, and `classifyImport` only raises
 * `dev-only-package-in-shipped-source` when `isToolingOrTest` is false. So
 * mx-multiplayer's first stage registration could have imported the dev-only kit
 * and the gate would have passed it.
 *
 * That is not a hypothetical failure mode. It is rule 6's exact origin: the only
 * input stage in the entire roster used to be mc-playground-kit's `input:sample`,
 * kit is banned from `dependencies`, and the shipped build therefore had NO
 * INPUT STAGE AT ALL (docs/architecture.md §5-2). A hole in the predicate is a
 * licence to do it again, in the one directory where it would be done.
 *
 * ---------------------------------------------------------------------------
 * What this repository's copy looks like
 * ---------------------------------------------------------------------------
 *
 * mc-compose does NOT have that hole: it registers no stages (it composes other
 * modules'), so it has no `stages/` directory, and its shipped set is exactly
 * `index.ts` + `domain/` — which is exactly what the predicate says.
 *
 * Checking that by hand once is worth very little, because the hole opens when
 * somebody adds a root LATER. So the assertions below derive the shipped set
 * from `package.json`'s `files` — the single place that actually decides what
 * gets published — instead of restating it. Add a shipped directory without
 * teaching the predicate about it and this fails.
 */
describe('shipped vs tooling source classification', () => {
  const repositoryRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(
    readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { readonly files?: ReadonlyArray<string> }

  /**
   * The entries of `files` that can hold TypeScript source: `index.ts` itself,
   * and every entry that is a directory on disk. Decided by looking rather than
   * by a name heuristic — `LICENSE` has no extension and is not a directory.
   */
  const publishedSourceRoots = (manifest.files ?? []).filter(
    (entry) => entry === 'index.ts' || statSync(path.join(repositoryRoot, entry)).isDirectory(),
  )

  it.effect('treats index.ts and domain/ as shipped, and everything else as tooling or tests', () =>
    Effect.sync(() => {
      expect(isToolingOrTestPath('index.ts')).toBe(false)
      expect(isToolingOrTestPath('domain/stage-order.ts')).toBe(false)
      expect(isToolingOrTestPath('test/stage-order.test.ts')).toBe(true)
      expect(isToolingOrTestPath('scripts/check-dependency-whitelist.ts')).toBe(true)
    }),
  )

  // THE ONE THAT WOULD HAVE CAUGHT mx-multiplayer's HOLE. Everything published
  // must be classified as shipped, so rule 6 applies to it.
  it.effect('classifies every published source root as shipped, derived from package.json', () =>
    Effect.sync(() => {
      expect(publishedSourceRoots).toStrictEqual(['index.ts', 'domain'])

      const misclassified = publishedSourceRoots.filter((root) =>
        isToolingOrTestPath(root === 'index.ts' ? root : `${root}/anything.ts`),
      )

      expect(
        misclassified,
        `${misclassified.join(', ')} is published in package.json "files" but isToolingOrTestPath ` +
          'calls it tooling. Rule 6 (mc-playground-kit may not be imported from shipped source) is ' +
          'only enforced where that predicate says "shipped", so this is a licence to put a ' +
          'devDependency in the shipped build — which is how the roster ended up with no input stage.',
      ).toStrictEqual([])
    }),
  )

  // The other direction: shipped code that is never scanned is not checked at
  // all. A root can be correctly classified and still invisible.
  it.effect('scans every published source root', () =>
    Effect.sync(() => {
      const unscanned = publishedSourceRoots.filter((root) => !SCAN_ROOTS.includes(root))
      expect(
        unscanned,
        `${unscanned.join(', ')} is published but absent from SCAN_ROOTS, so no import in it is ` +
          'ever classified.',
      ).toStrictEqual([])
    }),
  )

  // And the converse, so the classification stays deliberate rather than
  // accidental: a scanned root that is NOT published must be tooling. `apps/`
  // is the one this pins — mc-compose has no `apps/` today, and if it grows one
  // it will be a preview harness, which is exactly where importing the dev-only
  // playground kit is legitimate.
  it.effect('treats every scanned root that is not published as tooling', () =>
    Effect.sync(() => {
      const scannedButUnpublished = SCAN_ROOTS.filter(
        (root) => !publishedSourceRoots.includes(root),
      )
      expect(scannedButUnpublished).toStrictEqual(['apps', 'scripts', 'test'])

      for (const root of scannedButUnpublished) {
        expect(isToolingOrTestPath(`${root}/anything.ts`), `${root} is treated as shipped`).toBe(
          true,
        )
      }
    }),
  )
})
