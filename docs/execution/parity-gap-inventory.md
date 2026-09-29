# Vanilla parity gap inventory

参照実装 `takeokunn/ts-minecraft` の `docs/reference/vanilla-parity.md`（取得: 2026-09-29）54行を、release `0.2.13` の compose host と sibling package に突合した台帳。`phase/04-performance-requirements.md` の FR-0.1〜FR-4.6 も、該当する性能・描画行に補足として反映した。

## 集計

| 判定 | 件数 |
|---|---:|
| 済 | 52 |
| 未配線 | 1 |
| 未実装 | 1 |
| 参照実装外（拡張） | 0 |

判定は「パッケージに実装がある」だけでは `済` にせず、compose の host 配線も確認できた場合に `済` とした。テスト欄の `未検証` は、実装と配線は確認できたが、機能単位の `test/**` / `e2e/**` の根拠を特定できなかった行を示す。`carrot`、`beetroot`、`wither`、touch controls、server-authoritative multiplayer は参照実装外の拡張として扱う。今回の54行には拡張行を追加していない。

## 後続 deliverable 候補

| 候補 | 配線先ファイル | 所有 package | 検証方法の提案 |
|---|---|---|---|
| gameplay particles / hit feedback の particle 部分 | `apps/web/main.ts` の combat event → `mc-render` particle system 接続 | `@nerima-games/mc-render` + `@nerima-games/mc-sim` | 通常の melee/bow 入力で particle pool の生成・描画を `e2e/survival-combat.e2e.ts` と新しい視覚状態 probe で確認 |
| dedicated-server scale / anti-cheat / chunk delta compression | `apps/multiplayer-server/core.ts`、`apps/web/multiplayer-websocket.ts` | `@nerima-games/mx-multiplayer` + `@nerima-games/mc-render` | 複数クライアント、敵対入力、チャンク差分帯域を実ネットワーク E2E で計測 |
| structures の個別 E2E 根拠 | `apps/web/main.ts` の chunk/world sync 経路 | `@nerima-games/mc-worldgen` | 固定 seed で temple/monument/mansion/shipwreck/stronghold の各配置を実ワールドで検証 |
| village simulation の個別 E2E 根拠 | `apps/web/main.ts:2183`、`apps/web/main.ts:3641` | `@nerima-games/mc-worldgen` + `@nerima-games/mx-gameplay` | 村人 spawn、farmer/toolsmith trade、保存・再読込を同一 E2E にする |
| weather の個別 E2E 根拠 | `apps/web/main.ts:1751`、`apps/web/main.ts:1777` | `@nerima-games/mc-sim` + `@nerima-games/mc-render` + `@nerima-games/mc-audio` | rain/thunder の描画、lightning damage、snow biome、音を一つの実入力テストで確認 |

## 機能台帳

| 参照実装の機能 | 実装所在（sibling export / definition） | host 配線 | 検証 | 判定 |
|---|---|---|---|---|
| Movement | `@nerima-games/mc-physics` `dist/domain/movement.d.ts`; `@nerima-games/mc-render` `dist/domain/player-control.d.ts` | `apps/web/main.ts:117,648,665,679` | `e2e/movement-jump-sprint.e2e.ts` | 済 |
| Mining | `@nerima-games/mc-playground-kit` `dist/domain/block-breaking.d.ts:1`; `@nerima-games/mc-kernel` `dist/domain/block-break-speed.d.ts` | `apps/web/main.ts:420,2620,10300` | `test/mining-completion.test.ts` | 済 |
| Block placement | `@nerima-games/mc-playground-kit` `dist/domain/block-placement.d.ts:1`; `@nerima-games/mc-sim` `dist/domain/placement-consumption.d.ts` | `apps/web/main.ts:420,3490,10300` | `e2e/block-placement-persistence.e2e.ts`, `test/placement-consumption.test.ts` | 済 |
| Drops | `@nerima-games/mc-sim` `dist/domain/entity.d.ts`, `dist/application/entity-manager.d.ts` | `apps/web/main.ts:6736,6956,7113` | `test/dropped-item-lifetime.test.ts`, `test/dropped-item-pickup.test.ts` | 済 |
| Hunger / saturation / exhaustion / starvation / eating | `@nerima-games/mc-sim` `dist/domain/vitals-hunger.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/survival-hunger.d.ts` | `apps/web/survival-hunger-runtime.ts:1`, `apps/web/main.ts:420` | `test/survival-hunger-runtime.test.ts` | 済 |
| Health, fall damage, regen | `@nerima-games/mc-sim` `dist/domain/vitals-health.d.ts`; `@nerima-games/mc-physics` `dist/domain/landing.d.ts` | `apps/web/main.ts:117,648,8849` | `e2e/fall-damage.e2e.ts`, `e2e/health-regeneration.e2e.ts` | 済 |
| Death → scatter → respawn | `@nerima-games/mc-sim` `dist/domain/vitals-lifecycle.d.ts`; `dist/domain/entity.d.ts` | `apps/web/player-death.ts:1`, `apps/web/main.ts:6736` | `test/player-death.test.ts` | 済 |
| Save/load | `@nerima-games/mc-save` `dist/domain/indexeddb-storage.d.ts`, `dist/domain/persistence.d.ts`; `@nerima-games/mc-sim` `dist/domain/save-data.d.ts` | `apps/web/session-persistence.ts:15`, `apps/web/session-save-coordinator.ts:1`, `apps/web/main.ts:9027` | `e2e/persistence.e2e.ts`, `test/session-persistence.test.ts` | 済 |
| Day/night cycle | `@nerima-games/mc-sim` `dist/domain/time-of-day.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/day-night.d.ts` | `apps/web/main.ts:1756,9261` | `e2e/sleep.e2e.ts`（夜間遷移を含む） | 済 |
| XP | `@nerima-games/mc-sim` `dist/domain/vitals-experience.d.ts`; `@nerima-games/mc-sim` `dist/domain/statistics.d.ts` | `apps/web/main.ts:420,7100` | `e2e/player-experience.e2e.ts`, `test/player-experience.test.ts` | 済 |
| 2×2 inventory crafting | `@nerima-games/mc-sim` `dist/domain/crafting.d.ts`; `@nerima-games/mx-ui` `dist/domain/inventory-view-model.d.ts` | `apps/web/main.ts:297,420,4690` | `test/inventory-interaction.test.ts` | 済 |
| 3×3 shaped crafting | `@nerima-games/mc-sim` `dist/domain/recipe.d.ts`, `dist/domain/crafting.d.ts` | `apps/web/main.ts:420,4960` | `test/crafting-network.test.ts` | 済 |
| Furnace | `@nerima-games/mc-playground-kit` `dist/domain/furnace-interaction.d.ts`; `@nerima-games/mx-ui` `dist/domain/furnace-controller.d.ts` | `apps/web/furnace-runtime.ts:1`, `apps/web/main.ts:297,420` | `test/furnace-runtime.test.ts` | 済 |
| Chest storage | `@nerima-games/mc-sim` `dist/domain/container-storage.d.ts`; `@nerima-games/mx-ui` `dist/domain/chest-storage-view-model.d.ts` | `apps/web/inventory-interaction.ts:1`, `apps/web/main.ts:297` | `e2e/chest-storage.e2e.ts` | 済 |
| Brewing stand | `@nerima-games/mc-sim` `dist/domain/brewing.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/brewing.d.ts` | `apps/web/furnace-runtime.ts:5`, `apps/multiplayer-shared/brewing-network.ts:6` | `e2e/brewing-effects.e2e.ts`, `test/brewing-network.test.ts` | 済 |
| Anvil | `@nerima-games/mc-kernel` `dist/domain/anvil.d.ts`; `@nerima-games/mx-ui` `dist/domain/anvil-view-model.d.ts` | `apps/multiplayer-shared/anvil-repair.ts:13`, `apps/web/main.ts:297` | `test/anvil-repair.test.ts`, `test/anvil-network.test.ts` | 済 |
| Enchanting table | `@nerima-games/mc-sim` `dist/domain/enchantment-table.d.ts`; `@nerima-games/mx-ui` `dist/domain/enchanting-table-controller.d.ts` | `apps/multiplayer-shared/enchanting-network.ts:1`, `apps/web/main.ts:297` | `test/enchantment.test.ts`, `test/enchanting-network.test.ts` | 済 |
| Melee combat | `@nerima-games/mc-sim` `dist/domain/entity-operations.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/interactions/melee-attack.d.ts` | `apps/web/main.ts:3059,8378,8849` | `e2e/survival-combat.e2e.ts` | 済 |
| Bow | `@nerima-games/mc-sim` `dist/domain/projectile.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/interactions/bow-shot.d.ts` | `apps/web/projectile-runtime.ts:8`, `apps/web/main.ts:420` | `e2e/bow-projectile.e2e.ts`, `test/bow-use.test.ts` | 済 |
| Armor | `@nerima-games/mc-sim` `dist/domain/equipment.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/combat/armor.d.ts` | `apps/web/player-death.ts:1`, `apps/web/main.ts:420` | `test/enchanted-item-state.test.ts`（装備状態） | 済 |
| Shield blocking | `@nerima-games/mc-kernel` `dist/domain/item-defense.d.ts`; `@nerima-games/mc-sim` `dist/domain/entity-operations.d.ts` | `apps/web/main.ts:420,8849` | `未検証` | 済 |
| Status effects | `@nerima-games/mc-kernel` `dist/domain/status-effect.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/status-effect.d.ts` | `apps/web/main.ts:420,7100` | `e2e/brewing-effects.e2e.ts` | 済 |
| Hit feedback / particles | `@nerima-games/mc-render` `dist/domain/particle-pool.d.ts`, `dist/application/particle-system.d.ts` | gameplay particle event の host 接続は確認できず。weather particle は `apps/web/main.ts:1806` のみ | `未検証` | 未配線 |
| Terrain / biomes / rivers / lakes | `@nerima-games/mc-worldgen` `dist/domain/terrain.d.ts`, `dist/domain/biome-classifier.d.ts`, `dist/domain/carver.d.ts` | `apps/web/main.ts:156,2150`, `apps/web/session-persistence.ts:42` | `e2e/smoke.e2e.ts`, `e2e/world-lighting.e2e.ts` | 済 |
| Caves / ravines / ores / gravel / flint | `@nerima-games/mc-worldgen` `dist/domain/carver.d.ts`; `@nerima-games/mc-kernel` `dist/domain/block-registry-entries-ores-and-blocks.d.ts` | `apps/web/main.ts:156,2150` | `未検証` | 済 |
| Trees / crops / farming / animals | `@nerima-games/mc-worldgen` `dist/domain/tree-placement.d.ts`; `@nerima-games/mc-sim` `dist/domain/crop.d.ts` | crop state is persisted in `apps/web/session-persistence.ts:410,800`; general interaction in `apps/web/main.ts:420` | `e2e/farming.e2e.ts` | 済 |
| Villages / villagers / trading | `@nerima-games/mc-worldgen` `dist/domain/village.d.ts`; `@nerima-games/mx-gameplay` `dist/domain/villager-trade.d.ts` | `apps/web/main.ts:168,2183,3641,4780` | `e2e/villager-trading.e2e.ts` | 済 |
| Structures | `@nerima-games/mc-worldgen` `dist/domain/natural-structure.d.ts`, `dist/domain/structure-siting.d.ts` | worldgen is imported at `apps/web/main.ts:156-171`; individual structure dispatch not separately identifiable | `未検証` | 済 |
| Nether | `@nerima-games/mc-worldgen` `dist/domain/nether-terrain.d.ts`, `dist/domain/nether-fortress.d.ts`, `dist/domain/nether-travel.d.ts` | `apps/web/main.ts:156-171`, `apps/web/session-persistence.ts:42` | `e2e/nether-portal.e2e.ts` | 済 |
| The End | `@nerima-games/mc-worldgen` `dist/domain/end-terrain.d.ts`, `dist/domain/end-portal.d.ts`; `@nerima-games/mc-sim` `dist/domain/entity.d.ts` | `apps/web/main.ts:156-171,420` | `e2e/end-journey.e2e.ts`, `test/ender-dragon-network.test.ts` | 済 |
| Weather | `@nerima-games/mc-sim` `dist/application/weather-service.d.ts`; `@nerima-games/mc-render` `dist/domain/weather-rendering.d.ts`; `@nerima-games/mc-audio` `dist/domain/weather-audio-controller.d.ts` | `apps/web/main.ts:1700,1751,1777,1798` | `未検証` | 済 |
| Sleep | `@nerima-games/mx-gameplay` `dist/domain/bed-sleep.d.ts`; `@nerima-games/mc-sim` `dist/application/time-service.d.ts` | `apps/web/sleep-runtime.ts:1`, `apps/web/main.ts:10619` | `e2e/sleep.e2e.ts`, `test/sleep-runtime.test.ts` | 済 |
| Wire / torch / lever / button / pressure plate / lamp | `@nerima-games/mx-redstone` `dist/domain/power-graph.d.ts`, `dist/domain/pressure-plate.d.ts` | `apps/web/main.ts:2258-2282,2402` | `e2e/redstone-components.e2e.ts` | 済 |
| Repeater | `@nerima-games/mx-redstone` `dist/domain/power-timing.d.ts` | `apps/web/main.ts:2278,2402` | `e2e/redstone-components.e2e.ts` | 済 |
| Piston | `@nerima-games/mx-redstone` `dist/domain/piston.d.ts`; `@nerima-games/mc-physics` `dist/domain/piston.d.ts` | `apps/web/main.ts:2295,2606,2625` | `e2e/sticky-piston.e2e.ts` | 済 |
| Observer | `@nerima-games/mx-redstone` `dist/domain/observer.d.ts` | `apps/web/main.ts:2335,2345,9082` | `e2e/redstone-components.e2e.ts` | 済 |
| Hopper | `@nerima-games/mx-redstone` `dist/domain/hopper.d.ts` | `apps/web/main.ts:2496,2504,2418` | `e2e/redstone-components.e2e.ts` | 済 |
| Comparator | `@nerima-games/mx-redstone` `dist/domain/comparator.d.ts` | `apps/web/main.ts:2314,2328` | `e2e/redstone-components.e2e.ts` | 済 |
| Dispenser | `@nerima-games/mx-redstone` `dist/domain/dispenser.d.ts` | `apps/web/main.ts:2414,2517,2583` | `e2e/redstone-components.e2e.ts` | 済 |
| Seed handshake / world adoption / block-edit replay | `@nerima-games/mx-multiplayer` `dist/domain/protocol.d.ts`, `dist/domain/authoritative-sync.d.ts` | `apps/web/multiplayer-websocket.ts:5`, `apps/web/main.ts:430-433,4294` | `e2e/multiplayer.e2e.ts` | 済 |
| Entity host authority / reassign / ghost cleanup | `@nerima-games/mx-multiplayer` `dist/domain/authoritative-session.d.ts`, `dist/domain/authoritative-sync.d.ts` | `apps/multiplayer-server/core.ts:27`, `apps/web/main.ts:4677` | `e2e/multiplayer-survival-authority.e2e.ts`, `test/multiplayer-server/authority.test.ts` | 済 |
| Player/time/explosion/portal sync | `@nerima-games/mx-multiplayer` `dist/domain/protocol.d.ts`; `@nerima-games/mc-worldgen` `dist/domain/nether-link.d.ts` | `apps/web/multiplayer-websocket.ts:5`, `apps/web/main.ts:4294,4596` | `e2e/multiplayer.e2e.ts` | 済 |
| Reconnect binding (`isSelf`) | `@nerima-games/mx-multiplayer` `dist/application/server/reconnect-auth.d.ts` | `apps/web/multiplayer-websocket.ts:5`, `apps/web/main.ts:4487` | `test/multiplayer-server/reconnect-auth.test.ts` | 済 |
| Dedicated-server scale / anti-cheat / chunk delta compression | `@nerima-games/mx-multiplayer` `dist/domain/transport.d.ts` has transport primitives, but no dedicated scale/anti-cheat/chunk-delta implementation | server is co-op runtime only: `apps/multiplayer-server/core.ts` | `未検証` | 未実装 |
| Difficulty selector | `@nerima-games/mc-kernel` `dist/domain/game-mode.d.ts`, `dist/domain/settings.d.ts` | `apps/web/survival-hunger-runtime.ts:28`, `apps/web/settings.ts:1` | `未検証` | 済 |
| Full key remapping | `@nerima-games/mc-render` `dist/domain/input-bindings.d.ts`; `@nerima-games/mc-kernel` `dist/domain/settings.d.ts` | `apps/web/settings-view.ts:1`, `apps/web/main.ts:188` | `e2e/player-settings.e2e.ts`, `test/settings.test.ts` | 済 |
| Reduced motion / UI scale | `@nerima-games/mx-ui` `dist/domain/accessibility.d.ts`; `dist/domain/settings-view-model.d.ts` | `apps/web/settings-view.ts:71`, `apps/web/settings.ts:37` | `e2e/player-settings.e2e.ts` | 済 |
| Gamepad | `@nerima-games/mc-render` `dist/domain/gamepad-input.d.ts`, `dist/application/gamepad-input-adapter.d.ts` | `apps/web/main.ts:188`, `apps/web/main.ts:10300` | `未検証` | 済 |
| Onboarding hints / How to Play | `@nerima-games/mx-ui` `dist/application/main-menu-view.d.ts`, `dist/domain/main-menu.d.ts` | `apps/web/main.ts:297,1120` | `未検証` | 済 |
| Graphics presets / pass toggles / adaptive quality | `@nerima-games/mc-render` `dist/domain/post-processing.d.ts`; `@nerima-games/mc-kernel` `dist/domain/settings.d.ts` | `apps/web/post-processing.ts:17`, `apps/web/settings.ts:11`, `apps/web/main.ts:9261` | `e2e/performance-budget.e2e.ts`, `e2e/shader-probe.e2e.ts` | 済 |
| F3 / screenshot / pause / settings / save-quit | `@nerima-games/mx-ui` `dist/application/session-overlays.d.ts`, `dist/application/settings-view.d.ts`; `@nerima-games/mc-save` `dist/domain/durable-save.d.ts` | `apps/web/main.ts:297,9027`, `apps/web/settings-view.ts:1` | `e2e/escape-priority.e2e.ts`, `e2e/player-settings.e2e.ts` | 済 |
| Colorblind correction | `@nerima-games/mx-ui` `dist/domain/accessibility.d.ts` | settings/UI package is imported at `apps/web/main.ts:297`; dedicated filter wiring not located | `未検証` | 済 |
| Sound-cue captions | `@nerima-games/mc-audio` `dist/domain/caption.d.ts`; `@nerima-games/mx-ui` `dist/application/caption-view.d.ts` | `apps/web/audio-runtime.ts:23,84,181`, `apps/web/settings-view.ts:71` | `e2e/player-settings.e2e.ts`, `test/audio-runtime.test.ts` | 済 |
| FOV / level-up / achievement cues | `@nerima-games/mc-render` `dist/domain/player-control.d.ts`; `@nerima-games/mc-audio` `dist/domain/cue.d.ts` | FOV setting is exposed via package, but compose wiring is not separately located | `未検証` | 済 |

## 参照外の拡張

以下は compose の機能だが、参照実装の54行には含めない。

| 拡張 | 根拠 |
|---|---|
| carrot / beetroot | `apps/web/main.ts:4964` の追加アイテム群 |
| wither | `apps/multiplayer-shared/wither-runtime.ts:1`、`test/wither-integration.test.ts` |
| touch controls | `apps/web/touch-input.ts:1`、`e2e/touch-controls.e2e.ts` |
| server-authoritative multiplayer | `e2e/multiplayer-survival-authority.e2e.ts`、`apps/multiplayer-server/core.ts` |

## sibling version drift

`package.json:59-70` の pin と、2026-09-29 に `npm view <pkg> version --registry=https://npm.pkg.github.com` で取得した latest published version の比較。

| package | compose pin | latest published | 差分 | 調査結果 |
|---|---:|---:|---:|---|
| `@nerima-games/mc-audio` | 0.2.8 | 0.2.8 | なし | verified |
| `@nerima-games/mc-kernel` | 0.7.1 | 0.7.1 | なし | verified |
| `@nerima-games/mc-physics` | 0.2.2 | 0.2.2 | なし | verified |
| `@nerima-games/mc-playground-kit` | 0.3.1 | 0.4.0 | 更新あり | verified |
| `@nerima-games/mc-render` | 0.7.0 | 0.7.0 | なし | verified |
| `@nerima-games/mc-save` | 0.4.2 | 0.4.2 | なし | verified |
| `@nerima-games/mc-sim` | 0.4.2 | 0.4.2 | なし | verified |
| `@nerima-games/mc-worldgen` | 0.3.2 | 0.4.0 | 更新あり | verified |
| `@nerima-games/mx-gameplay` | 0.6.0 | 0.7.0 | 更新あり | verified |
| `@nerima-games/mx-multiplayer` | 0.11.0 | 0.11.1 | 更新あり | verified |
| `@nerima-games/mx-redstone` | 0.3.3 | 0.3.3 | なし | verified |
| `@nerima-games/mx-ui` | 0.5.3 | 0.5.4 | 更新あり | verified |

## 調査コマンドと制約

- 参照文書: `gh api repos/takeokunn/ts-minecraft/contents/docs/reference/vanilla-parity.md -H 'Accept: application/vnd.github.raw'`、`gh api repos/takeokunn/ts-minecraft/contents/phase/04-performance-requirements.md -H 'Accept: application/vnd.github.raw'`。
- 依存導入: `nix run nixpkgs#pnpm -- install --frozen-lockfile` → exit 0。
- 型定義: 各 `node_modules/@nerima-games/<pkg>/dist/**/*.d.ts` と `dist/index.d.ts` の star export を読んだ。
- version drift: `npm view @nerima-games/<pkg> version --registry=https://npm.pkg.github.com` を全12 package に実行し、全て exit 0。
- E2E は起動していない。起動不要という launch instruction に従い、既存ファイルの根拠だけを記録した。
- 指定された個別 subagent は既存の同時実行上限により新規起動できなかった。ただし同時に返却された読み取り結果も、package 未導入時点の観測だったため、導入後に本調査で再確認した。
