/**
 * The dev server behind the browser entry point.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * How sibling source checkouts are resolved, and what it costs
 * ---------------------------------------------------------------------------
 *
 * Published runtime packages are pinned in package.json. The browser app still
 * resolves sibling source checkouts so local integration exercises the same
 * working copies as the rest of the roster rather than stale installed builds.
 *
 * So the siblings are resolved from CHECKOUTS ON DISK, by alias, using the
 * SAME search order `pnpm check:roster` already uses (docs/testing.md §3.5):
 *
 *   1. `MC_ROSTER_ROOT`, if set
 *   2. `..`                    — the working copies, next to this repository
 *   3. `../mc-dev-meta/repos`  — the workspace mirror `pnpm sync` maintains
 *
 * and the chosen root is PRINTED, for the reason check:roster prints its own:
 * two checkouts of the same repository do drift, and a failure that names only
 * line numbers is usually a stale checkout rather than a real defect.
 *
 * The alias table does not replace package declarations: shipped imports remain
 * subject to the dependency whitelist and manifest checks.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { DEV_SERVER_RESOLVED_SIBLINGS, ORG_SCOPE } from './scripts/dev-server-siblings'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * The siblings the entry point composes.
 *
 * DERIVED from `scripts/dev-server-siblings.ts`'s `DEV_SERVER_RESOLVED_SIBLINGS`
 * rather than restated. That module used to be a single constant inside
 * `scripts/check-dependency-whitelist.ts` — the cross-repo import gate that
 * org policy has since retired in favour of `.oxlintrc.json`'s
 * `no-restricted-imports` (DEPENDENCY_POLICY.md §5) — but the sibling roster
 * itself is still one fact with one home, now `scripts/dev-server-siblings.ts`,
 * so that this list and any future reader of the roster cannot disagree.
 *
 * The set includes the host-boundary persistence packages because the browser
 * session imports their public storage and regeneration APIs directly.
 */
export const COMPOSED_SIBLINGS: ReadonlyArray<string> = [
  ...DEV_SERVER_RESOLVED_SIBLINGS,
].map((packageName) => packageName.slice(`${ORG_SCOPE}/`.length))

const candidateRoots = (): ReadonlyArray<string> => {
  const fromEnvironment = process.env['MC_ROSTER_ROOT']
  const declared = [
    fromEnvironment === undefined || fromEnvironment === '' ? undefined : path.resolve(fromEnvironment),
    path.resolve(here, '..'),
    path.resolve(here, '..', 'mc-dev-meta', 'repos'),
  ]
  return declared.filter((root): root is string => root !== undefined)
}

// `src/index.ts`, not `index.ts`: every one of the composed siblings has
// migrated to the org's `src/` layout (PACKAGE_STANDARD.md "なぜ `src/` か"),
// so this assumes the org-standard entry point unconditionally rather than
// probing for the pre-migration location.
const entryPointOf = (root: string, sibling: string): string => path.join(root, sibling, 'src', 'index.ts')

/**
 * Pick the first root that has EVERY composed sibling in it.
 *
 * Every, not any: a per-sibling search would happily assemble a game out of two
 * checkouts at different revisions, and the resulting failure would be
 * attributed to the code rather than to the mixture.
 */
const resolveRosterRoot = (): string => {
  const roots = candidateRoots()
  for (const root of roots) {
    if (COMPOSED_SIBLINGS.every((sibling) => existsSync(entryPointOf(root, sibling)))) {
      return root
    }
  }
  throw new Error(
    `no checkout root contains all of ${COMPOSED_SIBLINGS.join(', ')}. Looked in: ${roots.join(', ')}. ` +
      'Clone the siblings next to this repository, run `pnpm sync` in mc-dev-meta, or set MC_ROSTER_ROOT.',
  )
}

export default defineConfig(() => {
  const rosterRoot = resolveRosterRoot()

  // Printed for the reason check:roster prints its own: the two checkouts of a
  // repository drift, and knowing which one was loaded is the first question.
  console.log(`[mc-compose] roster root: ${rosterRoot}`)

  return {
    root: here,
    // Default moved off vite's stock ports AND off the reference's 5180. The
    // reference's own config records why it left 5173/5174 — "other projects on
    // this machine grab those first and the instances fight over the port" —
    // and takeokunn/ts-minecraft's Playwright already claims 5180 on the very
    // machine this repository is developed on. Same reasoning, one port along.
    server: {
      port: 5181,
      strictPort: true,
      host: '127.0.0.1',
      fs: {
        // The siblings live outside `root`, so vite has to be told it may read
        // them. Scoped to the chosen roster root rather than opened wide.
        allow: [here, rosterRoot],
      },
    },
    resolve: {
      alias: COMPOSED_SIBLINGS.map((sibling) => ({
        find: `@nerima-games/${sibling}`,
        replacement: entryPointOf(rosterRoot, sibling),
      })),
      // One `effect` instance. Two would mean two copies of every `Context.Tag`
      // identity class — and Effect resolves Tags by textual key, so the
      // failure would be a service that is present and still not found.
      dedupe: ['effect'],
    },
    optimizeDeps: {
      // The siblings are TypeScript source outside the root; pre-bundling them
      // resolves their relative imports against the wrong base.
      exclude: COMPOSED_SIBLINGS.map((sibling) => `@nerima-games/${sibling}`),
    },
    build: {
      target: 'es2024',
      outDir: 'dist',
      sourcemap: true,
    },
    clearScreen: false,
  }
})
