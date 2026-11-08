# Browser Game Completion Criteria

## Parity audit ledger

The upstream reference is `takeokunn/ts-minecraft`, `docs/reference/vanilla-parity.md`. It contains 66 table rows: 54 feature rows, 7 content inventory rows, and 5 performance metrics. The supplied re-audit report has 98 ledger IDs, so the two row sets are not one-to-one. The report does not provide a mapping that accounts for all 98 IDs against the upstream rows. This table records the 98 IDs and dispositions from the report without inventing that mapping. The report does not name package tag versions; each version cell records `latest tag (version not specified in report)`.

| Status | Rows |
|---|---:|
| implemented | 26 |
| partial | 60 |
| missing | 5 |
| runtime-only | 7 |
| unaudited | 0 |
| conflict | 0 |
| **Total** | **98** |

`runtime-only` normalizes the report's `unverified-needs-runtime` result. Package labels follow the report's path context. Direct task IDs refer to the plan v2 work-unit table in §4. W6 is the verification and repair loop; `V` runs the full S01–S17 catalog, and `FIX` routes a confirmed gap to its owning package. W7 is final acceptance. Where §4 does not name a direct work unit, implemented rows go to `V`; all other statuses go to `FIX`. The report gives no file:line for rows 76 and 98, and gives no line for the `mc-audio` evidence in row 70. Row 73 reuses row 72's evidence. The `deferred` label on row 97 is its ledger baseline; its re-audit result is `partial`.

| Ledger ID | Audit status | # | Package/repository | Version | Evidence file:line | Plan v2 unit(s) |
|---|---|---:|---|---|---|---|
| `content/block-types` | implemented | `1` | mc-kernel | latest tag (version not specified in report) | `src/domain/block/block-type-data.ts:6` | V |
| `content/item-types` | implemented | `2` | mc-kernel | latest tag (version not specified in report) | `src/domain/item/item-type-data.ts:6-452` | K2 |
| `content/recipes` | partial | `3` | mc-kernel | latest tag (version not specified in report) | `recipe-vanilla-data.ts:23` | K2, SM2 |
| `content/enchantments` | partial | `4` | mx-gameplay | latest tag (version not specified in report) | `src/domain/enchantment.ts:20-27` | GP8 |
| `content/mob-types` | partial | `5` | mx-gameplay | latest tag (version not specified in report) | `mob-ecosystem.ts:9-35` | GP4, RN9 |
| `content/biomes` | implemented | `6` | mc-worldgen | latest tag (version not specified in report) | `src/domain/biome.ts:40-54` | WG2 |
| `content/texture-atlas` | partial | `7` | mc-render | latest tag (version not specified in report) | `src/domain/texture-atlas.ts:516-538` | RN5 |
| `survival/movement` | partial | `8` | mc-physics | latest tag (version not specified in report) | `src/domain/movement.ts:52` | FIX |
| `survival/mining` | implemented | `9` | mx-gameplay | latest tag (version not specified in report) | `mining-progress.ts:163` | K2, GP8 |
| `survival/placement` | implemented | `10` | mx-gameplay | latest tag (version not specified in report) | `interactions/place-block.ts:388` | V |
| `survival/drops` | partial | `11` | mx-gameplay | latest tag (version not specified in report) | `dropped-item.ts:146` | FIX |
| `survival/hunger` | partial | `12` | mc-sim | latest tag (version not specified in report) | `vitals-hunger.ts:65-91` | GP2, GP3, SM4 |
| `survival/health-fall-regen` | partial | `13` | mx-gameplay | latest tag (version not specified in report) | `fall-damage.ts:3-8` | FIX |
| `survival/death-respawn` | implemented | `14` | mx-gameplay | latest tag (version not specified in report) | `dropped-item.ts:780` | V |
| `survival/save-load` | implemented | `15` | mc-save | latest tag (version not specified in report) | `persistence.ts:125,147` | SV1, HW4 |
| `survival/day-night` | partial | `16` | mc-sim | latest tag (version not specified in report) | `time-of-day.ts:288` | RN4 |
| `survival/xp` | partial | `17` | mx-gameplay | latest tag (version not specified in report) | `xp-orb.ts:154-175` | GP8 |
| `crafting/grid-2x2` | partial | `18` | mc-sim | latest tag (version not specified in report) | `crafting.ts:121` | K2, SM2, UI1 |
| `crafting/grid-3x3` | implemented | `19` | mc-compose host | latest tag (version not specified in report) | `main.ts:3410`; `e2e/player-experience.e2e.ts:568` | V |
| `crafting/furnace` | partial | `20` | mc-sim | latest tag (version not specified in report) | `smelting.ts:390,427` | SM2 |
| `crafting/chest` | implemented | `21` | mc-sim | latest tag (version not specified in report) | `container-storage.ts:16` | V |
| `crafting/brewing` | partial | `22` | mx-gameplay | latest tag (version not specified in report) | `brewing.ts:79-94` | FIX |
| `crafting/anvil` | partial | `23` | mc-compose | latest tag (version not specified in report) | `apps/multiplayer-shared/anvil-repair.ts:80-118` | SM2 |
| `crafting/enchanting-table` | partial | `24` | mc-sim | latest tag (version not specified in report) | `enchantment-table.ts:44,127` | SM2 |
| `combat/melee` | partial | `25` | mx-gameplay | latest tag (version not specified in report) | `melee-attack.ts:47-52` | GP5 |
| `combat/bow` | runtime-only | `26` | mx-gameplay | latest tag (version not specified in report) | `draw-bow.ts:107,186` | GP5 |
| `combat/armor` | partial | `27` | mx-gameplay | latest tag (version not specified in report) | `armor.ts:42-54` | GP5 |
| `combat/shield` | partial | `28` | mx-gameplay | latest tag (version not specified in report) | `hostile-combat.ts:29-104` | GP5 |
| `combat/status-effects` | partial | `29` | mx-gameplay | latest tag (version not specified in report) | `status-effect.ts:4-10` | GP8, UI2 |
| `combat/hit-feedback` | partial | `30` | mc-render | latest tag (version not specified in report) | `particle-event-adapter.ts:145` | RN4, UI2 |
| `worldgen/terrain-biomes` | implemented | `31` | mc-worldgen | latest tag (version not specified in report) | `terrain.ts:543-555` | WG2 |
| `worldgen/caves-ores` | implemented | `32` | mc-worldgen | latest tag (version not specified in report) | `terrain.ts:70,102` | WG2 |
| `worldgen/trees-farming` | partial | `33` | mx-gameplay | latest tag (version not specified in report) | `till-soil.ts:165` | WG2, GP1, GP3 |
| `worldgen/passive-animals` | missing | `34` | mx-gameplay | latest tag (version not specified in report) | `mob-ecosystem.ts:114-125` | GP7 |
| `worldgen/villages` | implemented | `35` | mc-worldgen | latest tag (version not specified in report) | `natural-structure.ts:231` | WG3, GP9 |
| `worldgen/structures` | partial | `36` | mc-worldgen | latest tag (version not specified in report) | `natural-structure-chunk-planner.ts:45-54` | WG3 |
| `worldgen/nether` | partial | `37` | mc-worldgen | latest tag (version not specified in report) | `chunk-store.ts:142-152` | WG2, HW2 |
| `worldgen/end-dragon` | partial | `38` | mx-gameplay | latest tag (version not specified in report) | `ender-dragon-encounter.ts:3-60` | GP9, RN9 |
| `worldgen/weather` | partial | `39` | mx-gameplay | latest tag (version not specified in report) | `weather.ts:72-107` | FIX |
| `worldgen/sleep` | partial | `40` | mx-gameplay | latest tag (version not specified in report) | `bed-sleep.ts:45-50` | FIX |
| `survival/creative-flight` | partial | `41` | mc-physics | latest tag (version not specified in report) | `creative-flight.ts:16,33` | HW3 |
| `redstone/basic-components` | implemented | `42` | mx-redstone | latest tag (version not specified in report) | `power-graph.ts:115` | RS1 |
| `redstone/repeater` | partial | `43` | mx-redstone | latest tag (version not specified in report) | `power-timing.ts:33,96` | K1, RS1 |
| `redstone/piston` | partial | `44` | mx-redstone | latest tag (version not specified in report) | `piston.ts:86,178` | K1, RS1 |
| `redstone/observer` | partial | `45` | mx-redstone | latest tag (version not specified in report) | `observer.ts:86,132` | K1, RS1 |
| `redstone/hopper` | partial | `46` | mx-redstone | latest tag (version not specified in report) | `hopper.ts:75-80,246` | K1, RS1 |
| `redstone/comparator` | partial | `47` | mc-compose | latest tag (version not specified in report) | `main.ts:1959-1979` | K1, RS1 |
| `redstone/dispenser` | partial | `48` | mx-redstone | latest tag (version not specified in report) | `dispenser.ts:110-128,253` | K1, RS1 |
| `multiplayer/seed-handshake` | partial | `49` | mx-multiplayer | latest tag (version not specified in report) | `protocol.ts:419-436` | MP1, HW6 |
| `multiplayer/entity-authority` | partial | `50` | mc-compose host | latest tag (version not specified in report) | `core.ts:1804,4157`; `core.ts:2709` | MP1, U6b |
| `multiplayer/player-time-sync` | implemented | `51` | mx-multiplayer | latest tag (version not specified in report) | `protocol.ts:825,1161,1186,693` | MP1, U6b |
| `multiplayer/reconnect-binding` | runtime-only | `52` | mx-multiplayer | latest tag (version not specified in report) | `reconnect-auth.ts:549` | MP1, U6b |
| `multiplayer/dedicated-server` | partial | `53` | mx-multiplayer | latest tag (version not specified in report) | `area-of-interest.ts:285`; `rate-limit.ts:259`; `chunk-delta.ts:368` | MP1, U6b, HW6 |
| `ux/difficulty-selector` | partial | `54` | mc-sim; mx-ui | latest tag (version not specified in report) | `settings.ts:43` (mc-sim); `settings-view.ts:81` (mx-ui) | SM4, UI3 |
| `ux/key-remapping` | implemented | `55` | mc-compose host; mx-ui | latest tag (version not specified in report) | `apps/web/settings-view.ts:164-203`; test named in report, no line given | V |
| `ux/reduced-motion-ui-scale` | partial | `56` | mc-sim; mx-ui | latest tag (version not specified in report) | `settings.ts:45,104` (mc-sim); `settings-view.ts:259` (mx-ui) | SM4, UI4 |
| `ux/gamepad` | partial | `57` | mc-render | latest tag (version not specified in report) | `gamepad-input.ts:128`; `gamepad-input-adapter.ts:90` | HW2 |
| `ux/onboarding` | partial | `58` | mx-ui | latest tag (version not specified in report) | `onboarding-view.ts:53,122` | HW3, UI3 |
| `ux/graphics-presets-adaptive` | partial | `59` | mc-render | latest tag (version not specified in report) | `adaptive-quality.ts:88`; `browser-render-policy.ts:1143` | SM4, RN8, HW7 |
| `ux/f3-overlay` | partial | `60` | mx-ui | latest tag (version not specified in report) | `debug-overlay.ts:35-43` | HW2 |
| `ux/screenshot-key` | partial | `61` | mc-render | latest tag (version not specified in report) | `browser.ts:1640-1697,1812` | HW2 |
| `ux/pause-settings-savequit` | implemented | `62` | mc-compose host; mx-ui | latest tag (version not specified in report) | `main.ts:1007,6464` (mc-compose); `pause-menu-view.ts:274` (mx-ui) | UI3, HW2 |
| `ux/colorblind` | partial | `63` | mx-ui | latest tag (version not specified in report) | `accessibility-dom.ts:59` | UI4 |
| `ux/captions` | implemented | `64` | mc-audio | latest tag (version not specified in report) | `caption.ts:113` | AU1, HW1 |
| `ux/fov-celebration` | partial | `65` | mc-sim | latest tag (version not specified in report) | `achievement-service.ts:132` | FIX |
| `gap/modding` | partial | `66` | mc-kernel | latest tag (version not specified in report) | `recipe-json.ts:619`; `data-pack-registry.ts:150-305` | FIX |
| `gap/boats` | partial | `67` | mx-gameplay | latest tag (version not specified in report) | `vehicle-motion.ts:106` | FIX |
| `gap/minecarts` | implemented | `68` | mx-gameplay | latest tag (version not specified in report) | `vehicle-motion.ts:141-158` | V |
| `gap/ocean-depth` | partial | `69` | mc-worldgen | latest tag (version not specified in report) | `vegetation.ts:350-370` | FIX |
| `gap/audio-live` | implemented | `70` | mc-compose host; mc-audio | latest tag (version not specified in report) | `audio-runtime.ts:13`; mc-audio path has no line in report | AU1, HW1 |
| `extension/wither` | implemented | `71` | mx-gameplay | latest tag (version not specified in report) | `boss/wither.ts:96` | V |
| `performance/fps-rd5` | runtime-only | `72` | mc-compose host | latest tag (version not specified in report) | `e2e/performance-budget.e2e.ts:11,70`; `main.ts:1782` | RN8, HW7, PERF |
| `performance/fps-rd8` | runtime-only | `73` | mc-compose host | latest tag (version not specified in report) | `e2e/performance-budget.e2e.ts:11,70`; `main.ts:1782` (same evidence as row 72) | RN8, HW7, PERF |
| `performance/frustum-cull-ratio` | runtime-only | `74` | mc-render | latest tag (version not specified in report) | `world-renderer.ts:627`; `frustum-culling.ts:284` | PERF |
| `performance/teleport-readiness` | runtime-only | `75` | mc-worldgen | latest tag (version not specified in report) | `chunk-store.ts:133` | PERF |
| `performance/test-suite-count` | runtime-only | `76` | mc-compose | latest tag (version not specified in report) | No file:line supplied; report says no harness | FIX |
| `perf/fr-0.1` | partial | `77` | mc-render | latest tag (version not specified in report) | `browser.ts:160-187,320` | PERF |
| `perf/fr-0.2` | missing | `78` | mc-compose | latest tag (version not specified in report) | `src/domain/composition.ts:294-301` | PERF |
| `perf/fr-0.3` | partial | `79` | mc-compose host | latest tag (version not specified in report) | `e2e/performance-budget.e2e.ts:60-84` | PERF |
| `perf/fr-1.1` | partial | `80` | mc-compose | latest tag (version not specified in report) | `src/domain/composition.ts:300` | FIX |
| `perf/fr-1.2` | partial | `81` | mc-render | latest tag (version not specified in report) | `adaptive-quality.ts:88`; `browser.ts:1486` | RN8, HW7 |
| `perf/fr-1.3` | partial | `82` | mc-physics; mc-sim | latest tag (version not specified in report) | `delta-time.ts:11` (mc-physics); `fixed-step.ts:19` (mc-sim) | SM1, HW7 |
| `perf/fr-1.4` | partial | `83` | mc-sim | latest tag (version not specified in report) | `autosave.ts:100,177` | HW4 |
| `perf/fr-2.1` | implemented | `84` | mc-worldgen | latest tag (version not specified in report) | `chunk-store-lru.ts:19`; `chunk-store.ts:621`; `chunk-store.test.ts:409` | V |
| `perf/fr-2.2` | missing | `85` | mc-worldgen | latest tag (version not specified in report) | `chunk-store.ts:107` | WG1 |
| `perf/fr-2.3` | implemented | `86` | mc-save | latest tag (version not specified in report) | `indexeddb-storage.ts:412` | SV1, HW4 |
| `perf/fr-2.4` | implemented | `87` | mc-worldgen | latest tag (version not specified in report) | `lake-generator.ts:30-199` | WG2 |
| `perf/fr-3.1` | partial | `88` | mc-meshing; mc-render | latest tag (version not specified in report) | `lod.ts:72,136,405` (mc-meshing); `level-of-detail.ts:304` (mc-render) | RN8, HW7 |
| `perf/fr-3.2` | partial | `89` | mc-meshing | latest tag (version not specified in report) | `lod.ts:375-430` | RN8, HW7 |
| `perf/fr-3.3` | implemented | `90` | mc-meshing | latest tag (version not specified in report) | `lod.ts:426` | RN1, RN6, ME1 |
| `perf/fr-3.4` | implemented | `91` | mc-meshing | latest tag (version not specified in report) | `mesh-greedy.ts:336,562` | V |
| `perf/fr-3.5` | implemented | `92` | mc-worldgen | latest tag (version not specified in report) | `light-update.ts:366`; `light.test.ts:657` | V |
| `perf/fr-4.1` | partial | `93` | mc-meshing | latest tag (version not specified in report) | `mesh.ts:601` | WG1, RN6 |
| `perf/fr-4.2` | missing | `94` | mc-worldgen | latest tag (version not specified in report) | `chunk-store-state.ts:280-294` | WG1 |
| `perf/fr-4.3` | partial | `95` | mc-render | latest tag (version not specified in report) | `browser.ts:573-739` | RN8 |
| `perf/fr-4.4` | partial | `96` | mc-render | latest tag (version not specified in report) | `water-refraction.ts:230,287` | RN1 |
| `perf/fr-4.5` | partial | `97` | mc-render | latest tag (version not specified in report) | `browser.ts:964-981,1383`; `ssim-adaptive-quality.ts:7,41` | FIX |
| `perf/fr-4.6` | missing | `98` | mc-meshing; mc-render | latest tag (version not specified in report) | No file:line supplied; report says no slice cache | FIX |

## Definition of done

Each item below must pass before release acceptance. The performance targets use decision D7. The audit statuses above describe the re-audit snapshot; DoD-1 defines the completion target.

| ID | Requirement | Verification | Pass criterion |
|---|---|---|---|
| DoD-1 | Complete the 98-row parity inventory. Extension behavior and `perf/fr-4.5`/`perf/fr-4.6` are excluded from this gate. | Run each in-scope package test and host end-to-end test; review the parity inventory. | 100% of in-scope rows are `implemented`, and every row has its package test and host end-to-end test. |
| DoD-2 | Match or exceed reference content counts. | Count registered blocks, items, recipes, effect-bearing enchantments, mobs, biomes, and texture-atlas tiles. | Blocks ≥120; items ≥124; recipes ≥112; effect-bearing enchantments ≥24; mobs ≥20; biomes ≥12; texture tiles ≥140. Block names may differ where the kernel maps the same block. |
| DoD-3 | Clear the verification catalog. | Run all catalog cases S01–S17 against the browser host and classify each result as `missing`, `defect`, or pass. | `missing` = 0; high- and medium-severity `defect` = 0. |
| DoD-4 | Complete the End journey with real input and without QA state changes. | Record one real-input playthrough from the start through defeating the End dragon and returning. | 1 completed journey; 0 state-changing QA commands; 1 recording. |
| DoD-5 | Meet the performance thresholds. | Measure on SwiftShader at render distances 5 and 8; record frame-time p99; move 200 blocks and measure the time until the surrounding visible ring is fully rendered; compare memory after a two-hour session. | At distance 5: ≥65 fps. At distance 8: ≥41.7 fps. Frame-time p99: ≤50 ms. Rendering after a 200-block move: ≤5 seconds. Memory after 2 hours: ≤1.5× start. |
| DoD-6 | Keep every repository CI green and enforce the shared conformance action. | Inspect the latest CI run for each repository and verify the action ran with its result. | Failed repository CI runs = 0; missing action runs = 0; `core` violations = 0; `effect3` violations = 0. |
| DoD-7 | Sustain a two-hour play session without runtime or save failures. | Play continuously for 2 hours; inspect errors, crashes, and saved-world integrity afterward. | Duration = 7,200 seconds; errors = 0; crashes = 0; corrupt saves = 0. |
| DoD-8 | Make the release playable at its public URL. | Open the published URL in a browser and complete a start-to-play smoke session. | 1 of 1 release URLs is publicly reachable and playable. |
| DoD-9 | Obtain user acceptance. | Give the user the human-judgment package and record the decision. | 1 recorded acceptance decision is `accepted`; unresolved blocking findings = 0. The judgment remains human. |
| DoD-10 | Deliver complete, licensed, scene-aware audio. | Check FR-A01–A05; record game output, compare event fingerprints, inspect spectra and BGM timing, count oscillator nodes, and prepare the listening package for human review. | Tracks cover all 8 scenes; each BGM track is ≥60 seconds and has multiple instruments and melodic development; every event maps to its intended audio file; all files have a recorded source and license; main-path `OscillatorNode` count = 0; the 30-minute recording and human review pass. |
| DoD-11 | Pass the 12 UX acceptance scenarios in the next section. | Exercise real input with Playwright and complete a human playtest. | 12/12 scenarios pass. |
| DoD-12 | Meet the progression targets in the next section. | Run a 10,000-seed simulation and 20 full bot playthroughs; compare both reports against every progression target. | 10,000 seeds and 20 bot runs complete; measured timing and probability outcomes meet every listed target. |
| DoD-13 | Resolve every audit item rated high for appearance or feel. | Confirm all corresponding work units in plan v2 §4 are complete and review screenshots. | High-rated items resolved = 100%; incomplete assigned work units = 0; screenshot judgments passed = 100%. |

DoD-1 excludes the explicitly labeled `extension/wither` row and extension behavior that decision D9 assigns to carrots and beetroot. This document does not infer additional extension exclusions.

### Verification catalog scope

| ID | Coverage |
|---|---|
| S01 | Real-input playthrough without injected state |
| S02a–S02c | Block mining and drops; block rendering; physics, explosions, liquids, and light |
| S03a–S03b | Item interactions; containers and controls |
| S04 | Crafting, smelting, brewing, enchanting, and anvil use |
| S05 | Combat and damage |
| S06 | Mobs |
| S07 | World generation and a 1,000-seed scan |
| S08 | Environment, farming, and vehicles |
| S09 | Redstone |
| S10 | Progression and dimensions |
| S11 | Saving and failure cases |
| S12 | Multiplayer and malformed protocol input |
| S13 | Input, UI, settings, and accessibility |
| S14 | Audio fingerprints, spectra, 30-minute BGM timeline, and oscillator count |
| S15 | Performance, runtime environment, and three-browser rerun |
| S16 | Random actions, invariants, and two-hour soak |
| S17 | Sensory proxy metrics and preparation of human-review evidence |

### Audio requirements for DoD-10

| ID | Requirement |
|---|---|
| FR-A01 | Assign BGM to daytime, nighttime, caves, underwater, Nether, End, Creative, and title scenes. Transitions, silence between tracks, fades, and volume settings must behave as intended. |
| FR-A02 | Each BGM track is at least 1 minute long, uses multiple instruments, and develops its melody. A single tone or an eight-note loop does not pass. |
| FR-A03 | Sound effects and ambient audio use recorded sources or audio files of equivalent quality. Keep oscillator tones only as an audio-load failure fallback. |
| FR-A04 | Record the source and license of every audio file. Do not use files whose license is unverified. |
| FR-A05 | Map every audio event to its intended audio file and make the game follow that mapping. |

| Check | Pass criterion |
|---|---|
| Fingerprint comparison | Record output through `MediaStreamDestination` and compare each event with its mapped file using cross-correlation. Every event matches its intended file. |
| Spectrum analysis | Measure spectral flatness, harmonic count, and change over time. Reject a single unchanging oscillator peak. |
| BGM timeline | Record 30 minutes. Record scene changes, gaps between tracks, scene mismatches, and gain changes after volume adjustments. |
| Oscillator monitoring | Count created `OscillatorNode` instances during play. Main-path count is 0; record any fallback use. |
| Human review | Provide recordings of BGM by scene and all sound effects. The user accepts the listening package. |

## Decisions D1–D16

| ID | Decision | Reason |
|---|---|---|
| D1 | Combine the 98-row ledger with UX, visual and interaction quality, balance, and audio criteria. | A ledger alone could accept provisional implementations, including audio and rendering. |
| D2 | Store each cell's block state separately; move save chunks to v3, add state to C7 [`BlockEdit`](./contracts.md#c7-generic-world-write-port), and advance the multiplayer protocol from 10 to 11. | This preserves the meaning of 277 block-ID comparisons and keeps the changes in kernel, world generation, and multiplayer. |
| D3 | Let the simulation tick service return the number of ticks for a frame; each stage runs that many ticks. | This preserves the rule that compose's `runFrame` adds no behavior ([`docs/responsibility.md`](../responsibility.md) §2.2). |
| D4 | Regenerate old Nether and End chunks only when they match same-seed surface-generated chunks and have no edits. Retain edited chunks and notify the world. | Preserve player-built content. |
| D5 | Move the 230-line `browser-preview.ts` from the kit into `mc-host-web`; kit 0.5 is outside the required completion path. | The ownership map assigns this work to W5, the integration and wiring wave. |
| D6 | Use original CC0 or CC-BY sound effects, textures, and icons; commission BGM. Keep procedural synthesis only as an audio-load fallback. Do not use original-game assets or derivatives. | Meet the quality target and avoid rights issues. |
| D7 | Set performance targets to 65 fps at distance 5, 41.7 fps at distance 8, p99 frame time ≤50 ms, visible rendering ≤5 seconds after movement, and memory ≤1.5× after two hours. | These retain the prior measurements and provisional thresholds. |
| D8 | Publish to GitHub Pages and private Terraform; the operator runs `apply`. | Match the previous release plan. |
| D9 | Keep the authoritative-command applier in multiplayer; validate crops and environmental damage on the server. Treat carrots and beetroot as extensions. Set the coverage threshold after migration. | The dedicated server composes the same game modules as the browser host. |
| D10 | Keep English and Japanese item names in kernel and icons in rendering. | Anvil and multiplayer flows also need item names. |
| D11 | Keep render-preview and shader-probe as development pages and exclude them from production `dist`. | The audit found debug pages in the published output. |
| D12 | Include dropping items (Q), view toggle (F5), pick block, F3, and screenshots in UX work. | These are basic play controls. |
| D13 | Provide Japanese and English UI. | The audience includes Japanese speakers. |
| D14 | Use the balance targets below, including a 1,200-second day. | The balance research recommended these targets. |
| D15 | Enable state-changing QA commands only when a build-time flag is set. | Prevent console-based state changes in production. |
| D16 | Remove “Minecraft” from visible UI text, including the browser tab title and canvas `aria-label`. | Avoid trademark use in the interface. |

## Balance and progression targets

The balance values in this table are targets. W6 compares the measured game against every target; DoD-12 also requires the progression targets to pass in both the seed simulation and bot playthroughs.

| Measure | Current value | Target | Plan v2 unit |
|---|---|---|---|
| Day length | 400 seconds; first night about 3 minutes after spawn | 1,200 seconds; first night about 9 minutes after spawn | SM4 |
| Night interval | 0.75–0.25 of the day | 0.55–0.95 | GP6 |
| Hunger lost from walking | 0.01 per block | 0 | SM4 |
| Regeneration while full | None | 1 health every 0.5 seconds | SM4 |
| Sprinting at hunger ≤6 | Allowed | Not allowed | GP5 |
| Invulnerability after damage | None | 0.5 seconds | GP5 |
| Attack cooldown | None | Same formula as the reference implementation | GP5 |
| Axe damage | 1 | 7–10 | GP5 |
| Skeleton | 4 damage every 2 seconds | 3 damage every 3 seconds | GP5 |
| Spider | 3 damage; 4 blocks per second | 2 damage; 3 blocks per second | GP5 |
| Difficulty damage multiplier | None | Easy: `min(N, N/2 + 1)`; Normal: 1×; Hard: 1.5× | GP5 |
| Hostile mob cap | 16 | Normal: 8–10; Easy: 6; Hard: 14 | GP6 |
| Spawn interval | 0.3 seconds | 1–2 seconds | GP6 |
| Spawn distance | 16–40 blocks | 24–40 blocks | GP6 |
| Spawn light | Block light ≤7; night only | Light level 0; dark caves can spawn mobs during daytime | GP6 |
| Mining with an unsuitable tool | No time penalty; bare-hand stone takes 1.25 seconds | 5× mining time | GP5 |
| Obsidian mining time | 0.56 seconds | At least 5 seconds | K2 |
| Early food | Rotten flesh only | Drops from cows, pigs, chickens, and sheep; bread; cooked meat | GP2, K2 |
| String | Spiderwebs only | Spiders and skeletons drop string | GP2 |
| Ores | No copper | Add copper; emeralds only in mountain biomes | WG2 |
| Time to sleep | 2 seconds | 5 seconds | HW3 |

### Progression targets

| Goal | Pass criterion |
|---|---|
| First log | ≤30 seconds |
| Wooden pickaxe | ≤2 minutes 30 seconds |
| Stone tools | ≤4 minutes |
| First cooked food | ≤7 minutes |
| First night | Begins no earlier than 8 minutes |
| First iron | ≤15 minutes |
| Bed | Craftable by the end of night one |
| Death risk with shelter on night one | ≤10% |
| Death risk without shelter on Normal | 30–50% |
| Hostile damage before first dusk | 0 |

## UX acceptance scenarios

Each scenario passes only when the stated behavior and timing are observed during a real-input Playwright run and human playtest.

| # | Scenario | Pass criterion |
|---:|---|---|
| 1 | On first open, show the game name and “New World” within one click. Hide network fields. | Both entry points are available within 1 click; no network input is visible. |
| 2 | Show progress after confirming world creation and keep it visible until the first terrain is rendered. | Progress appears within 500 ms and remains until first terrain renders. |
| 3 | Before the player enters input, show how to look, move, mine, open inventory, and pause. | All 5 control instructions are visible without input. |
| 4 | Pause immediately when pointer lock exits and offer click-to-resume. | Pause occurs within 1 frame; “Click to resume” appears. |
| 5 | An uninstructed beginner uses only on-screen information to craft a wooden pickaxe. | Completion within 10 minutes. |
| 6 | Holding on a log shows cracks and plays the break and pickup sounds with captions. | Cracks, both sounds, and both captions appear. |
| 7 | Give the player time before the first night and warn before hostile mobs can spawn. | First night starts at or after 8 minutes; dusk warning appears at least 30 seconds before hostile spawning. |
| 8 | Keep internal item IDs out of every screen. | No `minecraft:` prefix and no snake_case IDs are displayed. |
| 9 | Show the death cause and coordinates, then allow recovery of the player's items. | Cause and coordinates are visible; at least 1 stack is recovered within 5 minutes. |
| 10 | A cow provides food that the player cooks and eats. | Food is obtained, cooked, and eaten; the hunger indicator increases. |
| 11 | Give immediate feedback when the player hits a mob. | Hit sound and crosshair response appear within 100 ms. |
| 12 | Notify the player when autosave fails. | A localized save-failure message appears within 10 seconds. |
