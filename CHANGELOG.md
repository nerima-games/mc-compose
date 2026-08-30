# @nerima-games/mc-compose

## 0.1.49

### Patch Changes

- [#9](https://github.com/nerima-games/mc-compose/pull/9) [`8df8fb5`](https://github.com/nerima-games/mc-compose/commit/8df8fb50bbcb9132f2b51b34cfa5081eacc1766a) Thanks [@takeokunn](https://github.com/takeokunn)! - Fix CI: sync the `pnpm.overrides` pin for `@nerima-games/mx-gameplay` to the version already declared in `dependencies` (0.3.1), which was silently resolving to 0.2.1 and dropping the `drainBowKnockbacks` export the web client imports. Apply the org-standard oxlint scoped-strictness overrides for `test/**`, `scripts/**`, `apps/**`, `e2e/**`, and fix the real violations this surfaced under `src/**`. Make `vitest.config.ts`'s sibling `mc-audio` checkout resolution fall back to the installed registry package when no sibling checkout exists, so `pnpm test` runs in CI's single-repo checkout instead of throwing.

- [#16](https://github.com/nerima-games/mc-compose/pull/16) [`416bf85`](https://github.com/nerima-games/mc-compose/commit/416bf85473643c44360b082f8e673b2889428e46) Thanks [@takeokunn](https://github.com/takeokunn)! - Toolchain frozen to org pin set (TypeScript 7.0.2, vitest 4.1.11, effect 3.22.1, node 24, pnpm 11.24.0); release workflow added. mc-compose ships no library dist (unchanged) — `build:web` stays the Vite web bundle.

## 0.1.14

### Patch Changes

- Persist End progression and expose the complete Eye crafting, portal activation, dragon encounter, reward, and return journey through the web runtime.

  Align the composed runtime on `@nerima-games/mc-sim@0.1.29` so shapeless Eye of Ender crafting uses the same recipe implementation across gameplay and UI services.
