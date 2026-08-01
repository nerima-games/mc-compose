/**
 * The npm scope and sibling roster `vite.config.ts` needs to resolve
 * unpublished `@nerima-games/*` checkouts from disk.
 *
 * Extracted from the now-deleted `scripts/check-dependency-whitelist.ts`
 * (org-wide removal: DEPENDENCY_POLICY.md §5 / PACKAGE_STANDARD.md
 * "`scripts/check-dependency-whitelist.ts` の廃止"). That script's whitelist /
 * cycle-detection enforcement moved to `.oxlintrc.json`'s `no-restricted-imports`
 * and is not reproduced here. The one piece of it with a real runtime
 * consumer — `vite.config.ts`'s `COMPOSED_SIBLINGS`, which resolves the
 * browser entry point's not-yet-published dependencies from a sibling
 * checkout on disk rather than `node_modules` (docs/e2e-triage.md §3.5.1) —
 * survives the deletion here, unchanged.
 */

/** The npm scope that identifies a sibling repository. */
export const ORG_SCOPE = '@nerima-games'

/**
 * Sibling packages `vite.config.ts` resolves from a disk checkout rather than
 * `node_modules`, because none of the sixteen repositories has been published
 * yet. Each entry here is already a declared `dependencies` edge in
 * `package.json`; this set only says which of those edges the dev server may
 * satisfy from `..` / `../mc-dev-meta/repos` instead of a registry install.
 * `mc-meshing` remains transitively reachable only and is deliberately
 * absent, the same way it was absent from the deleted script's
 * `devServerResolved`.
 */
export const DEV_SERVER_RESOLVED_SIBLINGS: ReadonlySet<string> = new Set([
  `${ORG_SCOPE}/mc-audio`,
  `${ORG_SCOPE}/mc-render`,
  `${ORG_SCOPE}/mc-save`,
  `${ORG_SCOPE}/mc-worldgen`,
  `${ORG_SCOPE}/mx-ui`,
  `${ORG_SCOPE}/mx-redstone`,
  `${ORG_SCOPE}/mx-gameplay`,
])
