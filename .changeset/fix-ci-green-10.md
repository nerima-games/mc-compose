---
"@nerima-games/mc-compose": patch
---

Fix CI: sync the `pnpm.overrides` pin for `@nerima-games/mx-gameplay` to the version already declared in `dependencies` (0.3.1), which was silently resolving to 0.2.1 and dropping the `drainBowKnockbacks` export the web client imports. Apply the org-standard oxlint scoped-strictness overrides for `test/**`, `scripts/**`, `apps/**`, `e2e/**`, and fix the real violations this surfaced under `src/**`. Make `vitest.config.ts`'s sibling `mc-audio` checkout resolution fall back to the installed registry package when no sibling checkout exists, so `pnpm test` runs in CI's single-repo checkout instead of throwing.
