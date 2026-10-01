# compose sibling 新版 pin 追随マップ

対象は `mc-compose` origin/main `61afb9c`（package version `0.2.13`）から、kernel 0.8.0 系を受けた 12 package の pin 更新である。本文の package 調査 ref は、公開済み package は各 bare repo の `origin/main`、PR 段階は指定 branch head とした。`consumer-migration.md` が存在しない package では、存在する `CHANGELOG.md`、`docs/public-api.md`、`.changeset/*.md` を根拠にし、不在自体を未確認事項として記録した。

## 1. pin 表

| package | 現 pin | 目標版 | 内容を読んだ ref | 主な根拠 |
| --- | ---: | ---: | --- | --- |
| `mc-kernel` | 0.7.1 | 0.8.0 | `origin/main` `131a2246` | `CHANGELOG.md:7-14`, `docs/consumer-migration.md:92-104,157-167` |
| `mc-physics` | 0.2.2 | 0.3.0 | `origin/main` `af0fd132` | `CHANGELOG.md:3-11` |
| `mc-save` | 0.4.2 | 0.5.0 | `origin/main` `c61b995d` | `CHANGELOG.md:3-21` |
| `mc-audio` | 0.2.8 | 0.3.0 | `origin/main` `62e15343` | `CHANGELOG.md:3-11` |
| `mc-worldgen` | 0.3.2 | 0.5.0 | `origin/main` `9073d0b1` | `CHANGELOG.md:3-21` |
| `mc-sim` | 0.4.2 | 0.5.0 | `origin/main` `6f4aedd9` | `CHANGELOG.md:3-22`, `docs/public-api.md:5-14,30-40` |
| `mc-render` | 0.7.0 | 0.8.0 | `origin/takeokunn-p3-kernel-0-8` `b8a8ea28` | `.changeset/follow-kernel-0-8.md:1-5`, `docs/public-api.md:993-995,1111-1116` |
| `mc-playground-kit` | 0.3.1 | 0.5.0 | `origin/takeokunn-p3-kernel-0-8` `7ab6dcde` | `.changeset/bright-kits-follow.md:1-5`, `docs/public-api.md:252-264` |
| `mx-gameplay` | 0.6.0 | 0.8.0 | `origin/takeokunn-tier3-kernel-0-8` `031e9ddb` | `CHANGELOG.md:11,217-232`, `docs/public-api.md:34-74` |
| `mx-redstone` | 0.3.3 | 0.4.0 | `origin/takeokunn-tier3-kernel-0-8` `10a81847` | `CHANGELOG.md:7-11,34-36`, `docs/public-api.md:55-75` |
| `mx-ui` | 0.5.3 | 0.6.0 | `origin/takeokunn-tier3-kernel-0-8` `f4500b4d` | `docs/public-api.md:22-30,40-55,104-113` |
| `mx-multiplayer` | 0.11.0 | 0.12.0 | `origin/takeokunn-tier3-kernel-0-8` `96172e54` | `CHANGELOG.md:17-23,29-58`, `docs/public-api.md:14-30,191-202` |

ref は各 bare repo で `git fetch origin` 後に `git rev-parse` した値である（verified）。目標版は kickoff で指定された予定版であり、PR branch の changelog 見出しがまだ目標版になっていない場合は branch の内容を優先して読む（assumed by task contract）。

## 2. package ごとの契約変更

### Tier1 / kernel

- `mc-kernel`: `ItemStack` を `item` / `count` / 解決済み `components` の canonical immutable payload に統一し、空 slot は `undefined` にする。component patch は decoder、recipe、wire 境界で解決し、sidecar を残さない。`AnvilPlan.materialCost` は `AnvilMaterialCost`、`BlockProperties.drops` は optional になる（verified: `CHANGELOG.md:7-8`, `docs/consumer-migration.md:92-104`）。`BlockRead` 系と branded revision、固定時間 brand と tick arithmetic が追加される（verified: `CHANGELOG.md:10-14`）。
- `mc-physics`: `DeltaTimeSecs`、`FIRST_FRAME_DELTA_SECS`、`MIN_DELTA_SECS`、`MAX_DELTA_SECS` を kernel 0.8.0 の型・定数へ寄せ、固定時間は `FixedDurationSecs` として物理境界で明示変換する（verified: `CHANGELOG.md:3-8`）。
- `mc-save`: kernel 0.8.0 pin と branded value の compile fixture が追加されるが、save format、wire value、公開 field/export の意味は変わらない（verified: `CHANGELOG.md:7-21`）。ただし `decodeSave` に自動 version migration はない（verified: 目標 ref `CHANGELOG.md:27`, `docs/public-api.md:21-24`）。
- `mc-audio`: kernel 0.8.0 を必須にする。runtime API の移行はないが、外部 JSON を `unknown` として parse し、kernel-owned time / block-id brand を解決済み dependency から受ける（verified: `CHANGELOG.md:3-11`）。

### Tier2

- `mc-worldgen`: `ChunkKey` を kernel-owned brand に移し、worldgen root から `ChunkKey` を削除する一方、`chunkKeyOf` は残す（verified: `CHANGELOG.md:7-10`）。chunk block buffer は 16-bit 化し、chunk format は v1 read-only fallback と v2 write の versioned persistence になる（verified: `CHANGELOG.md:15-21`）。
- `mc-sim`: canonical `ItemStack` と `undefined` slot、kernel-owned `Dimension`、`FixedDurationSecs` の `dayLengthSecs`、kernel-owned statistics / vehicle / block-interaction を採用する。save wire と container snapshot は v3 となり、v1/v2 や component 無し payload は拒否する（verified: `CHANGELOG.md:7-14`, `docs/public-api.md:5-14,30-40`）。可変 frame advancement は固定 tick、physics substep 2 回、pause/resume、interpolation、overload 付き accumulator へ変わり、deep import の `domain/frame-timing` は削除される（verified: `CHANGELOG.md:16-18`）。
- `mc-render`: `mc-sim` の `PlayerService.cameraPose` を読む authoritative camera pose に移行し、`authoritativePose` と `initialPose` render input を削除する。chunk key と block storage も kernel/meshing contract に合わせる（verified: `.changeset/follow-kernel-0-8.md:5`, `docs/public-api.md:1111-1116`）。Dimension-aware environment の optional inputs と `planRenderEnvironment` 等の export は追加される（verified: `CHANGELOG.md:7-17`）。
- `mc-playground-kit`: kernel/worldgen/sim/save の brand、canonical component-bearing stack、save v3、fixed-step を採用する（verified: `.changeset/bright-kits-follow.md:5`）。chunk snapshot の block buffer は Uint16 相当へ移り、`ChunkBlocks.get` で読み、`legacyBytesOf` は `blockIdsOf` に置換される（verified: `CHANGELOG.md:7-21`）。

### Tier3: PR1 branch の公開契約

mx-* は指定 branch が「型ゲート PR1」で、kernel/sim/worldgen/audio の pin 追随 PR2 は未着手である。このため下記は branch と main の差分から読んだ PR1 契約であり、目標 pin の到着前に compose が完成したとは扱わない（verified: branch `.changeset/strict-type-gate.md` 各 1-5、`CHANGELOG.md` 各 package）。kernel 0.7.1 と 0.8.0 の brand 型が依存グラフに二重解決される間は、同じ見た目の `DeltaTimeSecs`、`BlockPosition`、`ItemStack`、`ClockPort` が代入不能になり、compose の型検査は失敗し得る（inferred from package pin and brand ownership; kernel ownership: `mx-gameplay/CHANGELOG.md:217-232`, `mx-ui/docs/public-api.md:195-211`).

- `mx-gameplay`: coordinate/frame/item vocabulary mirror を kernel-owned contract に寄せ、local mirror files を削除済み。`FrameServices` は kernel の `ClockPort` を要求する（verified: `CHANGELOG.md:217-232`, `docs/public-api.md:34-74`）。旧 `DeathCause: 'fire'` と `FIRE_CONTACT_DAMAGE` は削除され、`'in_fire'` / `'on_fire'` に分かれる（verified: `CHANGELOG.md:7-11`）。
- `mx-redstone`: host port と `redstoneSnapshotFromRealm` / `applyRedstoneHostEvents` / `componentForBlock` / `kernelPistonCapabilities` を公開し、host が block classification と drain loop を再実装しない契約を明示する（verified: `CHANGELOG.md:34-36`, `docs/public-api.md:9-15,55-75`）。`timed-power-graph` は `power-timing` に改名された（verified: `CHANGELOG.md:7-11`）。
- `mx-ui`: `frameStages` は Effect、stage は `StageRegistration.after` の制約だけを宣言し、全順序は compose が解く。UI stage は `makeUiStages` / `uiModule` の形で提供される（verified: `docs/public-api.md:22-30,40-55,104-113`）。inventory view model に残る mc-sim mirror は canonical stack へ寄せる必要がある（verified: `docs/public-api.md:211-264`）。
- `mx-multiplayer`: `WorldWriteServices` に `inventoryFor` / `vehiclesFor` / `hotbarFor` が必要になり、host の service lookup 契約が拡張された（verified: `CHANGELOG.md:17-23,29-43`）。protocol は branded IDs と `encodeFrame` / `decodeFrame`、snapshot interpolation、`makeMultiplayerStages` を公開し、全体 stage order は compose に残る（verified: `docs/public-api.md:14-30,45-48,127-184,191-202`）。

## 3. compose の呼び出し箇所

検索対象は `apps/web`、`apps/multiplayer-server`、`apps/multiplayer-shared`、`src`、`e2e`、`test`。以下の行は現 tree の call/import site であり、必要変更はコードではなく実装者向け指示である。

| 契約 | compose の該当箇所（symbol） | 必要な変更 |
| --- | --- | --- |
| canonical `ItemStack` / no zero sentinel | `apps/web/main.ts:136,637-678,3696-3823,5293-5933`; `apps/web/session-persistence.ts:28,409,659-674`; `apps/multiplayer-server/inventory-state.ts:16-30,82-211`; `apps/multiplayer-server/core.ts:200,351,478-485,559-565,1019-1020,1257,2483,3513`; `apps/multiplayer-shared/anvil-repair.ts:226`; `test/session-persistence.test.ts:902` | local `{item,count}`、`count: 0`、durability/metadata sidecar を canonical payload / `undefined` slot と component patch 境界へ移行。anvil の material cost を stack count と混同しない。 |
| fixed time brands / fixed-step sim | `apps/web/clock.ts:30-47`; `apps/multiplayer-server/clock.ts:18-25`; `apps/web/main.ts:93-102,537-538,3670,3696,5119,8091,9047,9082-9091`; `apps/web/host-modules.ts:14,54,172`; `apps/multiplayer-server/core.ts:562,2683,2770,3869,3876` | kernel 0.8.0 constructors を使用し、`FixedDurationSecs` を `DeltaTimeSecs` と assertion で兼用しない。`simStages` と server tick を fixed-step API、pause/overload/interpolation へ合わせる。 |
| save v3 / no automatic migration | `apps/web/platform-adapters.ts:16,76,122`; `apps/web/settings.ts:20,25,49,123-134`; `apps/web/session-persistence.ts:10,914,939-954,975-1061,1122-1136`; `apps/web/session-save-coordinator.ts:1,83`; `test/session-persistence.test.ts:12-37` | `defineFormat`/load/save の envelope と player/container/equipment snapshot を v3 に更新し、旧 envelope を自動修復しない。必要なら consumer 側で旧 decode → 現行 encode の明示 migration を設計する。 |
| worldgen `ChunkKey` / widened blocks | `apps/web/chunk-sync-budget.ts:1,20-37`; `apps/web/main.ts:159,1812-1824,1868,1902,2025-2036`; `apps/web/session-persistence.ts:42`; `test/session-save-coordinator.test.ts:40`; `test/session-persistence.test.ts:1280-1281,1448-1457,1644` | `ChunkKey` は kernel から import、block buffer 添字アクセスは `get/set` または package API に置換。chunk persistence の v1 fallback/v2 write を壊さない。 |
| render authoritative camera pose | `apps/web/host-modules.ts:7,95,124,129-141`; `apps/web/main.ts:167,1422,1502,1889-1890,6538,6718`; `apps/web/platform-adapters.ts:27,349-376`; `apps/web/qa-surface.ts:44,381-384,570,1964`; `apps/render-preview/preview.ts:55,324,347`; `apps/shader-probe/probe.ts:62,183,215` | `renderModule` へ渡す `initialPose` / `authoritativePose` を除去し、sim の `PlayerService.cameraPose` を camera mirror に供給する。Dimension は kernel 型を使う。 |
| mx gameplay / redstone / UI stage and ports | `apps/web/host-modules.ts:154-178`; `apps/web/main.ts:224,232,331`; `apps/multiplayer-server/redstone-runtime.ts:2,98`; `test/composition.test.ts:4,284`; `apps/web/main.ts:2406-2632`（EXECUTION planned move） | `uiStages`/gameplay/redstone stage の `frameStages` Effect 契約と ClockPort を provide。redstone の搬送・piston・hopper・dispenser は `RedstoneHostPort` へ移す。UI mirror は canonical model/controller に置換。 |
| multiplayer protocol/service | `apps/multiplayer-shared/{anvil,brewing,crafting,enchanting,ender-dragon,player-damage,wither}-network.ts`; `apps/web/multiplayer-websocket.ts:5`; `apps/multiplayer-server/core.ts:27,207-227`; `test/multiplayer-server/runtime.test.ts:6`; `e2e/multiplayer.e2e.ts:7,147-149` | shared hand-rolled codec を mx-multiplayer protocol/codec へ置換し、server の command dispatch/idempotency と `WorldWriteServices` lookup を `applyAuthoritativeCommand` 側へ移す。 |

削除・改名 export の compose 全体検索結果（各 package の候補名を literal/ import path として `rg -n`、verified）:

| 候補 | 件数 | 判定 |
| --- | ---: | --- |
| `DeathCause` / `FIRE_CONTACT_DAMAGE` | 0 / 0 | compose は直接参照なし |
| worldgen からの `ChunkKey` import | 0 | kernel import への変更対象は未発見 |
| `legacyBytesOf` | 0 | 既に新名へ移行済みか未使用 |
| `domain/frame-timing` deep import | 0 | deep import は未使用 |
| `authoritativePose` / `initialPose` | 2 | render preview/host の型・コメントを確認して除去 |
| `blocks[index]` | 11 | 主に persistence test と `apps/web/main.ts:1902`; `get/set` へ移行 |
| `count: 0` | 4 | server/web/test の sentinel を canonical slot へ移行 |

網羅性の限界: export 名が文書にしか現れないもの、型名が同名の別 package と共有されるもの、branch の PR2 で追加される名前はこの検索件数だけでは保証できない（未確認）。

## 4. 作業順序と分類

### 機械的

1. `package.json` の 12 pin を目標版へ更新する。
2. `ChunkKey`、`legacyBytesOf`、`domain/frame-timing`、`authoritativePose` / `initialPose`、`timed-power-graph` などの import/path/name を更新する。
3. kernel-owned `Dimension`、`Position`、`DeltaTimeSecs`、`StageId`、`FrameServices` の import source を揃える。

### 契約移行

1. kernel 0.8.0 を最初に揃え、次に Tier1、worldgen、sim、render/kit、Tier3 の順で pin を更新する。これは `EXECUTION.md` §12 の順序（`ab1e0fc:394-413`）と一致する。
2. canonical `ItemStack` と `undefined` slot を web/server/shared/test の境界へ適用する。
3. fixed-step sim、`FixedDurationSecs` / `SimulationTick`、camera pose、render interpolation を host module と tick 経路へ適用する。
4. save v3 を session persistence の schema/load/save と E2E fixture に適用する。自動 migration がないため、旧 fixture を現行 codec に黙って通さない。
5. chunk block `get/set`、kernel `ChunkKey`、worldgen v1→v2 load を persistence と render sync に適用する。

### 設計判断が要る

- `apps/web/main.ts:2406-2632` の redstone 搬送を mx-redstone の stage/port へ移すかは、単なる改名ではなく ownership 移転である（`EXECUTION.md:478-496`）。
- `apps/web/main.ts:3284-4262` 相当の multiplayer client protocol と shared network files は mx-multiplayer protocol/snapshot/transport へ移す（`EXECUTION.md:482-489`）。ただし `sleep-network.ts` の実装を基準に関数単位 diff を取る。
- Screens、QA surface、tick、session persistence はそれぞれ mx-ui、各 gameplay/sim owner、mc-sim save slice へ移す候補であり、compose に残すのは orchestration と platform adapter だけにする（`EXECUTION.md:489-496`）。
- `apps/web/main.ts:2989-3187` の portal safe landing は対応 export が無く移設先未確定である（`EXECUTION.md:486-487`）。推測で移さない。

`EXECUTION.md` §12 の release/pin 順序と整合する。一方、同文書 §14-15 は main 未マージの設計であり、現 worktree に存在しないため、今回の map は bare commit `ab1e0fc` の記載を参照した（verified）。§14 の apps 薄型化は今回の「pin 追随」より広い ownership 移転を含むため、実装ストリームでは pin/type green 後に別作業として扱うべきである（inferred）。

## 5. 未確認事項

- `mc-render`、`mc-playground-kit`、mx-* の target version の release commit と PR2 head は未公開。指定された PR1 branch head の文書だけを読んだため、PR2 の追加 export、依存 pin、wire/save 変更は未確認。確認方法: PR2 branch head を fetch し、同じ文書一覧と `git diff main...head -- package.json src/index.ts docs .changeset` を再取得する。
- `mc-physics` から compose への直接 import は現 tree で確認できない。確認方法: `rg -n "@nerima-games/mc-physics" apps src e2e test` と package-generated declaration の両方を更新後に再実行する。
- `mc-save` の v3 という compose-level save schema の具体的 envelope version、既存 session fixture の移行方針は sibling 文書だけでは確定しない。確認方法: mc-sim 0.5.0 の `save-data`/`save-coordinator` declarations と compose の `session-persistence.ts` schema を field 単位で突合する。
- portal safe landing の所有 package/export は `EXECUTION.md:486-487` が未確定としている。確認方法: worldgen/gameplay target ref の公開 barrel と stage registration を検索し、owner と API を決定する。
- `mx-ui` の screen registry branch は今回指定された PR1 ref には含まれない。確認方法: `takeokunn-minecraft-verification-cb2830e` の `screen-registry.ts` と target branch の diff を読んでから UI 移設を台帳へ追加する。
- package docs の `docs/consumer-migration.md` は mc-kernel には存在するが、他の target ref の tree listing では確認できない。各 package の consumer-specific migration は `CHANGELOG.md`/`docs/public-api.md` の記載に限定しており、別名文書の不在は未確認として扱う。
- 今回は `pnpm install`、`pnpm build`、`pnpm test`、`nix develop` を禁止されているため、型エラーが解消したことは未検証。確認方法: 全 12 pin が publish 済みで GitHub Packages が利用可能になった後、まず各 sibling の verify、次に compose の typecheck、最後に lint/test/E2E を実行する。
