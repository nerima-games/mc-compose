# Open PR Intake

This record covers the 85 open pull requests found across the 16 repositories during W0-8 review. Class 1 means main already contains the same or a newer dependency version, or equivalent work. Class 2 means the change should be carried into the listed wave. Class 3 means the current plan has no change to retain. The reason text is the English comment posted before each pull request is closed.

## Pull request decisions

| Repository | PR | Title | Author | Classification | Reason (comment) | Intake wave |
|---|---:|---|---|---|---|---|
| mc-kernel | 62 | build(deps-dev): bump @types/node from 26.4.0 to 26.5.1 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, newer than this PR's 26.5.1, so this update is already present and I am closing the PR. | none |
| mc-kernel | 61 | build(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The W1 plan moves mc-kernel directly to Effect 4.0.5, so there is no planned use for this 3.22.2-only bump. I am closing this PR ahead of that migration. | none |
| mc-kernel | 60 | build(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, newer than this PR's 6.35.1, so this update is already present and I am closing the PR. | none |
| mc-kernel | 59 | build(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already pins @changesets/cli 3.0.3, newer than this PR's 3.0.2, so this update is already present and I am closing the PR. | none |
| mc-kernel | 58 | build(deps-dev): bump @changesets/changelog-github from 1.0.0 to 1.0.1 | app/dependabot | 1: absorbed | Main already pins @changesets/changelog-github 1.0.1, the version proposed here, so this update is already present and I am closing the PR. | none |
| mc-kernel | 57 | build(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's ci.yaml and release.yaml already pin pnpm/action-setup v6.1.0, so this update is already present and I am closing the PR. | none |
| mc-noise | 30 | build(deps-dev): bump @types/node from 26.4.0 to 26.5.0 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, newer than this PR's 26.5.0, so this update is already present and I am closing the PR. | none |
| mc-noise | 29 | build(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, newer than this PR's 6.35.1, so this update is already present and I am closing the PR. | none |
| mc-noise | 28 | build(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already pins @changesets/cli 3.0.3, newer than this PR's 3.0.2, so this update is already present and I am closing the PR. | none |
| mc-noise | 27 | build(deps-dev): bump @changesets/changelog-github from 1.0.0 to 1.0.1 | app/dependabot | 1: absorbed | Main already pins @changesets/changelog-github 1.0.1, the version proposed here, so this update is already present and I am closing the PR. | none |
| mc-noise | 26 | build(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's ci.yaml and release.yaml already pin pnpm/action-setup v6.1.0, so this update is already present and I am closing the PR. | none |
| mc-noise | 23 | build(deps-dev): bump tsx from 4.23.12 to 4.23.15 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, the version proposed here, so this update is already present and I am closing the PR. | none |
| mc-meshing | 26 | build(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already pins @changesets/cli 3.0.3, newer than this PR's 3.0.2, so this update is already present and I am closing the PR. | none |
| mc-meshing | 25 | build(deps-dev): bump @types/node from 26.4.0 to 26.5.1 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, newer than this PR's 26.5.1, so this update is already present and I am closing the PR. | none |
| mc-meshing | 24 | build(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, newer than this PR's 6.35.1, so this update is already present and I am closing the PR. | none |
| mc-meshing | 23 | build(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The W2 plan moves mc-meshing directly to Effect 4.0.5, so there is no planned use for this 3.22.2-only bump. I am closing this PR ahead of that migration. | none |
| mc-meshing | 22 | build(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's ci.yaml and release.yaml already pin pnpm/action-setup v6.1.0, so this update is already present and I am closing the PR. | none |
| mc-meshing | 20 | build(deps-dev): bump tsx from 4.23.12 to 4.23.13 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, newer than this PR's 4.23.13, so this update is already present and I am closing the PR. | none |
| mc-meshing | 10 | WIP: 20260820T144429-d6b69bb | takeokunn | 3: unnecessary | Main has since added regional and special meshing (630eac5), direct kernel chunk handling (62e0544), and package verification (59b61a3); meshChunkRegion is in src/domain/mesh.ts. This draft has no distinct change to carry into W2, so I am closing it. | none |
| mc-physics | 20 | chore(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The W2 plan moves mc-physics directly to Effect 4.0.5, so there is no planned use for this 3.22.2-only bump. I am closing this PR ahead of that migration. | none |
| mc-physics | 19 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's ci.yaml and release.yaml already pin pnpm/action-setup v6.1.0, so this update is already present and I am closing the PR. | none |
| mc-save | 40 | chore(deps-dev): bump @types/node from 26.4.0 to 26.6.3 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, above this PR's 26.6.3. This update is absorbed and can be closed. | none |
| mc-save | 32 | chore(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The plan targets Effect 4.0.5 with Vitest 5 in the package wave, so this intermediate 3.22.2 bump is unnecessary. | none |
| mc-save | 29 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's CI and release workflows already pin pnpm/action-setup v6.1.0 at the same SHA. This PR is absorbed and can be closed. | none |
| mc-audio | 35 | chore(deps): bump effect from 3.22.1 to 3.22.3 | app/dependabot | 3: unnecessary | The plan targets Effect 4.0.5 with Vitest 5 in the package wave, so this intermediate 3.22.3 bump is unnecessary. | none |
| mc-audio | 29 | chore(deps-dev): bump @changesets/changelog-github from 1.0.0 to 1.0.1 | app/dependabot | 1: absorbed | Main already pins @changesets/changelog-github 1.0.1. This update is absorbed and can be closed. | none |
| mc-audio | 25 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's CI and release workflows already pin pnpm/action-setup v6.1.0 at the same SHA. This PR is absorbed and can be closed. | none |
| mc-worldgen | 38 | chore(deps): bump effect from 3.22.1 to 3.22.3 | app/dependabot | 3: unnecessary | The plan targets Effect 4.0.5 with Vitest 5 in the package wave, so this intermediate 3.22.3 bump is unnecessary. | none |
| mc-worldgen | 31 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's CI and release workflows already pin pnpm/action-setup v6.1.0 at the same SHA. This PR is absorbed and can be closed. | none |
| mc-worldgen | 9 | Phase 0 rescue: consume mc-noise from worldgen | takeokunn | 1: absorbed | Main already contains the mc-noise adapter change in ddd2316e689dec35f8814e78d8449e267fb94cb8, including the same seeded-random.ts implementation. This PR is absorbed and can be closed. | none |
| mc-sim | 37 | feat: add per-player registry and R-SI3 state services | takeokunn | 2: later intake | W3 still needs the planned container, furnace, fishing, projectile, and fluid services, so I am recording those for intake and closing this PR. Rework replicated writes through C4's WorldCommitCoordinator and extend PlayerService instead of adding this PR's separate PlayerRegistry. | W3 |
| mc-sim | 29 | chore(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The plan targets Effect 4.0.5 with Vitest 5 in the package wave, so this intermediate 3.22.2 bump is unnecessary. | none |
| mc-sim | 28 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main's CI and release workflows already pin pnpm/action-setup v6.1.0 at the same SHA. This PR is absorbed and can be closed. | none |
| mc-render | 40 | chore(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, which is newer than this update. The dependency change is absorbed. | none |
| mc-render | 39 | chore(deps-dev): bump @types/node from 26.4.0 to 26.5.0 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, which is newer than this update. The dependency change is absorbed. | none |
| mc-render | 38 | chore(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already pins @changesets/cli 3.0.3, which is newer than this update. The dependency change is absorbed. | none |
| mc-render | 37 | chore(deps-dev): bump @changesets/changelog-github from 1.0.0 to 1.0.1 | app/dependabot | 1: absorbed | Main already pins @changesets/changelog-github 1.0.1, the version proposed here. The dependency change is absorbed. | none |
| mc-render | 36 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already uses pnpm/action-setup v6.1.0 in both CI and release workflows. This update is absorbed. | none |
| mc-render | 35 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.13 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, which is newer than this update. The dependency change is absorbed. | none |
| mc-render | 13 | WIP: 20260829T214000-5af5c05 | takeokunn | 2: later intake | Most of this renderer work is already represented on main; the only live delta is the final WIP commit, which includes a fluid-quad tile resolver and tighter Three.js material types. Carry those focused changes into the mc-render W3 work, then close this stale umbrella PR. | W3 |
| mc-render | 11 | Phase 0 rescue: wither rendering (WIP) | takeokunn | 1: absorbed | Main already contains the Wither visual implementation and renderer integration in commit 3f213b8e1a05. This WIP is an older parallel version, so no changes need to be carried. | none |
| mc-playground-kit | 29 | feat: follow kernel 0.8 and simulation 0.5 contracts | takeokunn | 2: later intake | This PR has useful kernel-owned Dimension, canonical stack, and brand-boundary work for retained kit runtime paths, but its end-portal interaction path is slated for removal and its pins are intermediate. Carry the retained application and flat-chunk changes with their type and runtime tests into mc-playground-kit W3. | W3 |
| mc-playground-kit | 27 | chore(deps-dev): bump @types/node from 26.4.0 to 26.5.0 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, which is newer than this update. The dependency change is absorbed. | none |
| mc-playground-kit | 26 | chore(deps-dev): bump knip from 6.33.0 to 6.35.0 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, which is newer than this update. The dependency change is absorbed. | none |
| mc-playground-kit | 25 | chore(deps-dev): bump @changesets/changelog-github from 1.0.0 to 1.0.1 | app/dependabot | 1: absorbed | Main already pins @changesets/changelog-github 1.0.1, the version proposed here. The dependency change is absorbed. | none |
| mc-playground-kit | 24 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already uses pnpm/action-setup v6.1.0 in both CI and release workflows. This update is absorbed. | none |
| mc-playground-kit | 23 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.13 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, which is newer than this update. The dependency change is absorbed. | none |
| mc-playground-kit | 20 | chore(deps): bump @nerima-games/mc-save from 0.4.1 to 0.4.2 | app/dependabot | 3: unnecessary | Plan §4.3 removes mc-save from mc-playground-kit's dependencies in W3, and the proposed 0.4.2 pin is behind mc-save main at 0.5.0. This intermediate bump needs no intake. | none |
| mx-gameplay | 52 | chore: release mx-gameplay 0.8.0 | takeokunn | 3: unnecessary | This branch adds an earlier release snapshot around changes carried by #51, including the 0.8.0 version and changelog update. W4 will create the planned 0.8.0 release after integration, so this snapshot needs no separate intake. | none |
| mx-gameplay | 51 | chore: align Tier 3 runtime pins for 0.8.0 | takeokunn | 2: later intake | Main has no equivalent for the bow-hit candidate and runtime/type-safety changes in this PR, and W4 assigns mx-gameplay 0.8.0. Carry the useful source and matching test changes into W4 with refreshed dependency pins, then close this pre-release branch. | W4 |
| mx-gameplay | 50 | chore(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, which is newer than this update. The dependency change is absorbed. | none |
| mx-gameplay | 49 | chore(deps): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | W4 targets Effect 4.0.5 for mx-gameplay, so this 3.22.2 update would be superseded. Close it and apply the planned major-version migration in W4. | none |
| mx-gameplay | 48 | chore(deps): bump @nerima-games/mc-kernel from 0.7.0 to 0.7.1 | app/dependabot | 1: absorbed | Main already pins @nerima-games/mc-kernel 0.7.1, the version proposed here. The dependency change is absorbed. | none |
| mx-gameplay | 47 | chore(deps-dev): bump @types/node from 26.4.0 to 26.5.1 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, which is newer than this update. The dependency change is absorbed. | none |
| mx-gameplay | 46 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already uses pnpm/action-setup v6.1.0 in both CI and release workflows. This update is absorbed. | none |
| mx-gameplay | 44 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.13 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, which is newer than this update. The dependency change is absorbed. | none |
| mx-gameplay | 10 | Phase 0 rescue: portal travel registration (WIP) | takeokunn | 2: later intake | Main history already moved the portal travel imports and contracts to kernel/worldgen APIs; the unique changes are shared empty-array reuse and an idle-frame status-effect test. Carry those focused changes into the W4 registration split before closing this rescue branch. | W4 |
| mx-gameplay | 7 | Phase 0 rescue: kernel capability API migration (WIP) | takeokunn | 1: absorbed | Main already uses capabilityOfBlockId in the touched falling-block, mob-frame, and hostile-spawn paths after the kernel vocabulary migrations. The remaining portal-frame API move is also reflected in main; no changes need to be carried. | none |
| mx-ui | 36 | chore(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already pins knip 6.42.1, which is newer than this update. The dependency change is absorbed. | none |
| mx-ui | 35 | chore(deps-dev): bump @playwright/test from 1.62.1 to 1.63.0 | app/dependabot | 1: absorbed | Main already pins @playwright/test 1.64.1, which is newer than this update. The dependency change is absorbed. | none |
| mx-ui | 34 | chore(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already pins @changesets/cli 3.0.3, which is newer than this update. The dependency change is absorbed. | none |
| mx-ui | 33 | chore(deps-dev): bump @types/node from 26.4.0 to 26.6.3 | app/dependabot | 1: absorbed | Main already pins @types/node 26.6.5, which is newer than this update. The dependency change is absorbed. | none |
| mx-ui | 32 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already uses pnpm/action-setup v6.1.0 in both CI and release workflows. This update is absorbed. | none |
| mx-ui | 30 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.15 | app/dependabot | 1: absorbed | Main already pins tsx 4.23.15, the version proposed here. The dependency change is absorbed. | none |
| mx-multiplayer | 46 | chore(deps): bump effect from 3.22.1 to 3.22.3 | app/dependabot | 3: unnecessary | The planned dependency target is Effect 4.0.5, upgraded together with the Vitest 5 toolchain. This intermediate Effect 3.22.3 bump is not needed for that wave and can close. | none |
| mx-multiplayer | 37 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already pins pnpm/action-setup 6.1.0 at the same SHA in both CI and release workflows, so this update is absorbed. | none |
| mx-redstone | 26 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 1: absorbed | Main already pins pnpm/action-setup 6.1.0 at the same SHA in both CI and release workflows, so this update is absorbed. | none |
| mc-compose | 74 | chore(deps-dev): bump @types/node from 26.4.0 to 26.5.1 | app/dependabot | 1: absorbed | Main already uses @types/node 26.6.5, which is newer than this update, so this PR is absorbed. | none |
| mc-compose | 73 | chore(deps-dev): bump knip from 6.33.0 to 6.35.1 | app/dependabot | 1: absorbed | Main already uses knip 6.42.1, which is newer than this update, so this PR is absorbed. | none |
| mc-compose | 72 | chore(deps): bump @nerima-games/mx-ui from 0.5.3 to 0.5.4 | app/dependabot | 1: absorbed | Main already uses @nerima-games/mx-ui 0.5.4, so this PR is absorbed. | none |
| mc-compose | 71 | chore(deps-dev): bump @changesets/cli from 3.0.1 to 3.0.2 | app/dependabot | 1: absorbed | Main already uses @changesets/cli 3.0.3, which is newer than this update, so this PR is absorbed. | none |
| mc-compose | 70 | chore(deps): bump pnpm/action-setup from 4.3.0 to 6.1.0 | app/dependabot | 1: absorbed | Main already pins pnpm/action-setup 6.1.0 at the same SHA in the browser-performance, browser-regression, CI, and release workflows, so this PR is absorbed. | none |
| mc-compose | 68 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.13 | app/dependabot | 1: absorbed | Main already uses tsx 4.23.15, which is newer than this update, so this PR is absorbed. | none |
| mc-compose | 10 | Phase 0 rescue: session boundary worktree (WIP, possibly superseded) | takeokunn | 1: absorbed | The session-boundary code is already on main: #9 merged that work, and main's src/domain/browser-session.ts and session-save test match this head. Main also records the related CI and lint fixes in 8df8fb50; this snapshot is superseded. | none |
| mc-compose | 12 | WIP: 20260818T054534-828fabb | takeokunn | 1: absorbed | Main's signed integration commit 88ae2525 includes the Aug. 20 integration snapshot. Of this PR's 96 touched paths, 52 have identical blobs on main and the other 44 have changed or disappeared; no separate surviving change was identified for intake. | none |
| mc-compose | 13 | WIP: 20260820T154948-828fabb | takeokunn | 2: later intake | Main's inventory interaction helper still lacks the two crafting-grid move operations this PR adds. The ownership map assigns this logic to mc-sim in W3, so carry the behavior and tests to mc-sim during W3, then close this snapshot. | W3 |
| mc-dev-meta | 45 | chore(deps): bump actions/setup-node from 7.0.0 to 7.1.0 | app/dependabot | 2: later intake | Main still pins setup-node v7.0.0, while this diff updates it to v7.1.0. This matches the planned Actions refresh; carry .github/workflows/ci.yaml into mc-dev-meta in W0-T. | W0-T |
| mc-dev-meta | 44 | chore(deps): bump actions/upload-artifact from 7.0.1 to 7.0.2 | app/dependabot | 2: later intake | Main still pins upload-artifact v7.0.1, while this diff updates it to v7.0.2. Carry the workflow update into mc-dev-meta in W0-T. | W0-T |
| mc-dev-meta | 43 | chore(deps-dev): bump effect from 3.22.1 to 3.22.2 | app/dependabot | 3: unnecessary | The planned target is Effect 4.0.5, upgraded with the Vitest 5 toolchain. This intermediate Effect 3.22.2 bump is not part of that target and can close. | none |
| mc-dev-meta | 42 | chore(deps-dev): bump @vitest/coverage-v8 from 4.1.11 to 5.0.3 | app/dependabot | 2: later intake | The plan moves the Vitest toolchain to 5.0.5 alongside Effect 4.0.5. Carry the coverage upgrade and refreshed lockfile into mc-dev-meta during W6-5, then close this older 5.0.3 snapshot. | W6-5 (inferred) |
| mc-dev-meta | 41 | chore(deps-dev): bump @types/node from 26.4.0 to 26.6.3 | app/dependabot | 2: later intake | The planned W0-T update includes @types/node; main is still on 26.4.0, while the PR proposes 26.6.3. Carry the update and lockfile refresh into mc-dev-meta in W0-T, using the current planned latest version. | W0-T |
| mc-dev-meta | 40 | chore(deps-dev): bump vitest from 4.1.11 to 5.0.3 | app/dependabot | 2: later intake | The plan moves the Vitest toolchain to 5.0.5 alongside Effect 4.0.5. Carry the Vitest upgrade and refreshed lockfile into mc-dev-meta during W6-5, then close this older 5.0.3 snapshot. | W6-5 (inferred) |
| mc-dev-meta | 37 | chore(deps-dev): bump tsx from 4.23.12 to 4.23.15 | app/dependabot | 2: later intake | The planned W0-T update includes tsx; main is still on 4.23.12, while the PR proposes 4.23.15. Carry the package and lockfile updates into mc-dev-meta in W0-T. | W0-T |
| mc-dev-meta | 30 | chore(deps): bump pnpm/action-setup from 6.0.10 to 6.1.0 | app/dependabot | 2: later intake | Main still pins pnpm/action-setup v6.0.10, while this diff updates it to v6.1.0 at the planned SHA. Carry the workflow update into mc-dev-meta in W0-T. | W0-T |
| mc-dev-meta | 16 | WIP: 20260820T143121-d7ed761 | takeokunn | 3: unnecessary | Main has moved mc-dev-meta to a mirror-free registry model and added the 26.3 conformance catalog and generator. This WIP's proposed runtime kernel, mirror layer, and audio implementation do not fit the planned role for mc-dev-meta, so there is no intake. | none |

## Disposition counts

| Repository | Open PRs reviewed | Class 1 | Class 2 | Class 3 |
|---|---:|---:|---:|---:|
| mc-kernel | 6 | 5 | 0 | 1 |
| mc-noise | 6 | 6 | 0 | 0 |
| mc-meshing | 7 | 5 | 0 | 2 |
| mc-physics | 2 | 1 | 0 | 1 |
| mc-save | 3 | 2 | 0 | 1 |
| mc-audio | 3 | 2 | 0 | 1 |
| mc-worldgen | 3 | 2 | 0 | 1 |
| mc-sim | 3 | 1 | 1 | 1 |
| mc-render | 8 | 7 | 1 | 0 |
| mc-playground-kit | 7 | 5 | 1 | 1 |
| mx-gameplay | 10 | 6 | 2 | 2 |
| mx-ui | 6 | 6 | 0 | 0 |
| mx-multiplayer | 2 | 1 | 0 | 1 |
| mx-redstone | 1 | 1 | 0 | 0 |
| mc-compose | 9 | 8 | 1 | 0 |
| mc-dev-meta | 9 | 0 | 7 | 2 |
| **Total** | **85** | **58** | **13** | **14** |

### W0-T: mc-dev-meta PR #45

Carry the actions/setup-node update from v7.0.0 to v7.1.0 in mc-dev-meta/.github/workflows/ci.yaml, using the PR's updated action SHA. Apply it in W0-T.

### W0-T: mc-dev-meta PR #44

Carry the actions/upload-artifact update from v7.0.1 to v7.0.2 in mc-dev-meta/.github/workflows/ci.yaml, using the PR's updated action SHA. Apply it in W0-T.

### W0-T: mc-dev-meta PR #41

Carry the @types/node update in mc-dev-meta/package.json and mc-dev-meta/pnpm-lock.yaml. Use the planned current version 26.6.5 rather than this PR's 26.6.3, then apply it in W0-T.

### W0-T: mc-dev-meta PR #37

Carry the tsx update to 4.23.15 in mc-dev-meta/package.json and mc-dev-meta/pnpm-lock.yaml. Apply it in W0-T.

### W0-T: mc-dev-meta PR #30

Carry the pnpm/action-setup update to v6.1.0 at SHA ea17c68df8912ef543352723c149a84f56e3d413 in mc-dev-meta/.github/workflows/ci.yaml. Apply it in W0-T.

### W3: mc-sim PR #37

Use the PR's container, furnace, fishing, fluid, and projectile service work as implementation input in mc-sim. The source files are src/domain/container-state.ts, src/application/container-service.ts, src/domain/furnace-state.ts, src/application/furnace-service.ts, src/domain/fishing-state.ts, src/application/fishing-service.ts, src/domain/fluid-state.ts, src/application/fluid-service.ts, src/domain/projectile-state.ts, and src/application/projectile-charge-service.ts; carry relevant cases from test/container-service.test.ts, test/furnace-service.test.ts, and test/r-si3-state-services.test.ts, then update src/index.ts and scripts/verify-package.mjs. Route replicated writes through C4's WorldCommitCoordinator and extend src/application/player-service.ts; do not add the PR's separate player registry. The proposed coordinator file src/application/world-commit-coordinator.ts is inferred because C4 names the coordinator but does not specify its file.

### W3: mc-render PR #13

Carry the fluid-quad tile resolver from mc-render/src/domain/chunk-geometry.ts and mc-render/src/domain/block-texture-map.ts, plus the Three.js material typing change in mc-render/src/application/three-surface.ts. Carry the related tests in mc-render/test/support/fake-three.ts and mc-render/test/world-renderer.test.ts.

### W3: mc-playground-kit PR #29

Carry kernel-owned Dimension imports in mc-playground-kit/src/application/generated-gameplay.ts and mc-playground-kit/src/application/generated-world-provider.ts, and the retained runtime work in mc-playground-kit/src/domain/flat-chunk.ts. Carry the brand-boundary and runtime tests in mc-playground-kit/test/brand-boundaries.compile.ts, mc-playground-kit/test/browser-preview.test.ts, mc-playground-kit/test/gameplay-services.test.ts, mc-playground-kit/test/generated-gameplay.test.ts, and mc-playground-kit/test/playground.test.ts. Refresh mc-playground-kit/package.json and mc-playground-kit/pnpm-lock.yaml for W3; do not carry the end-portal interaction implementation scheduled for removal.

### W3: mc-compose PR #13 to mc-sim

Move the two crafting-grid operations and their four focused tests from mc-compose/apps/web/inventory-interaction.ts and mc-compose/test/inventory-interaction.test.ts to mc-sim. The ownership map assigns the source logic to mc-sim:src/ in W3; proposed destination files are mc-sim/src/application/inventory-interaction.ts and mc-sim/test/inventory-interaction.test.ts. The destination filenames are inferred from the ownership map's directory-level assignment.

### W4: mx-gameplay PR #10

Carry shared empty-array reuse in mx-gameplay/src/stages/registration.ts and its idle-frame status-effect regression test in mx-gameplay/test/stage-registration.test.ts as part of the W4 registration split.
