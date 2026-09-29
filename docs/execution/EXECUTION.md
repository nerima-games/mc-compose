# mc-kernel から順に全 package を完成させる実行仕様

## 1. 要約

依存グラフ `mc-compose → mx-* → mc-* → mc-kernel` は org ポリシー通りに機械強制されているが、責務は守られていない。
mc-compose の `apps/web/main.ts` は 11,428 行(`bootGame` 1 関数が約 10,300 行)、`apps/multiplayer-server/core.ts` は 4,531 行あり(いずれも `f603ce2` 時点)、mx-gameplay から 110 シンボルを直接 import して睡眠、落下ダメージ、水泳、ポータル移動、ホッパー搬送、権威コマンド適用、QA fixture、save format を手配線している。

本仕様の狙いは次の 3 点である。

- 下層 package が「自己登録する stage、service、format」として振る舞いを所有し、上位は Layer merge と起動配線だけを持つ状態にする。
- 型を Branded Type で閉じ、外部入力は Schema decoder だけを通す。
- 参照実装 ts-minecraft の機能範囲を物差しに、Minecraft Java Edition 26.3 の公式データと Wiki を正本として挙動の正しさを検証し、各 package を 1.0.0 タグまで持っていく。

## 2. 現状

すべて `origin/main` と `f603ce2` の直接読取、または読み取り専用エージェントの file:line 付き報告に基づく。

### 2.1 リポジトリと branch

| 項目 | 事実 |
| --- | --- |
| 未コミット変更 | 全 16 repo で無し。mc-compose 以外は bare clone のみ |
| 取り込む価値のある未マージ branch | mc-compose `takeokunn-20260917-023043-f603ce2`(bootGame 抽出 3 commit)、同 `takeokunn-20260927-130931-f603ce2`(K03〜K05 packet 文書)、同 `feat/pressure-plate-e2e`、同 `test/bow-charge-guard`(bow E2E)、mx-ui `takeokunn-minecraft-verification-cb2830e`(型アサーション排除と screen registry、43 file)、mc-dev-meta `takeokunn-minecraft-parity-ledger`(98 行の parity ledger)、mx-gameplay `fix/armor-mitigation-by-damage-cause` / `feat/vehicle-rails` / `chore/verify-multi-angle-2`(テスト追加) |
| 残骸 branch | それ以外の feat / fix / test / probe / release / rescue / wip / dependabot 系は changeset 残骸か main 取り込み済みの旧系譜(`git merge-tree --write-tree` で確認)。mc-meshing `feat/production-meshing`、mc-render `feat/wither-rendering`、mx-gameplay `feat/basic-brewing-runtime`、mx-multiplayer `feat/state-sync` は main が同名モジュールを別実装で持つため破棄 |
| open PR | dependabot が各 repo に 5〜6 本、WIP PR 9 本(mc-compose #10 / #12 / #13、mc-dev-meta #16、mc-meshing #10、mc-render #11 / #13、mc-worldgen #9、mx-gameplay #7 / #10) |
| 公開とタグ | 各 repo の `release.yaml` が main への version bump push で `pnpm verify && pnpm package:verify` を再実行し、GitHub Packages へ publish した後に `v<version>` タグを打つ。手動タグは打たない |
| 前計画の残骸 | K01〜K05 / D02〜D07 の契約文書と mc-kernel `feat/k02-count-quantity`(packet が `.mediator/clones/kernel-execution` の SHA 311fc86 として参照)はディスク上にもリモートにも存在しない。K02 以降の実装は未着手として扱う。K03(canonical item)、K04(chunk read/edit)、K05(time units)の packet 本文のみ mc-compose `takeokunn-20260927-130931-f603ce2` に残存 |

### 2.2 品質ゲートの偏り

| 項目 | 事実 |
| --- | --- |
| 型 | 16 repo が strict フルセット(noUncheckedIndexedAccess、exactOptionalPropertyTypes 等)。isolatedDeclarations 等の欠落は mc-render(5 flag)と mc-save(2 flag)のみ。ast-grep `no-type-assertion` は Tier1 が error、Tier2 / Tier3 は warning(ast-grep は warning で非ゼロ終了しないため実質未ゲート) |
| 性能基盤 | baseline と tolerance 付き回帰ゲートは mc-noise / mc-meshing / mc-worldgen のみ。mc-kernel / mc-physics / mc-save / mc-sim / mc-render は単発計測、mc-audio と mc-playground-kit は皆無。CI では走らせない(org PERFORMANCE_STANDARD §5) |
| docs drift | `docs/versioning.md` の「現在のバージョン」が package.json と乖離(mc-kernel 0.4.0 表記 vs 実 0.7.1 など 5 package)。mc-sim `docs/public-api.md` §5 が responsibility.md と矛盾。mc-audio `docs/versioning.md` は「未公開」と書くが registry に 0.2.8 が存在 |
| 依存 pin | mc-kernel 0.7.1 に対し下流は 0.7.0。mc-worldgen 0.4.0 に対し mc-sim / mc-render / mx-gameplay / mx-redstone は 0.3.2。mc-meshing 0.2.0 に対し mc-render は 0.1.6 |

### 2.3 package ごとの主要ギャップ

| package | 事実 |
| --- | --- |
| mc-kernel | `docs/freeze-checklist.md` の機械条件は全達成、1.0.0 は maintainer 裁量待ち。`docs/consumer-migration.md` に下流の重複語彙(Dimension / BlockState / Settings / recipe 系)の張り替え未完を明記。`src/domain/` は 214 file の平坦構造、`package.json#exports` は 92 subpath。`block-world.ts` は `ReadonlyMap` の素朴実装(41 行、空間索引なし)。brand は `quantities.ts` / `identifiers.ts` / `coordinate-primitives.ts` に `Brand.refined` で約 45 種 |
| mc-noise / mc-meshing | baseline 付き bench あり。mc-meshing は参照実装 fixture 照合を「外部保留」(mc-meshing `docs/testing.md:148,171,178`) |
| mc-physics / mc-save / mc-audio | bench は単発または無し。mc-save は tsconfig 2 flag 欠落 |
| mc-worldgen | `src/application/chunk-store.ts` に revision / epoch 概念なし(dirty は `drain` 差分方式)。worker parity test 未了(`docs/testing.md:306-308`) |
| mc-sim | `scripts/benchmark-explosion.ts` が package.json に未登録。public-api.md が実装より古い |
| mc-render | `src/stages/registration.ts:130-135` の `authoritativePose` が FIRST CUT のまま。`any` 57 件、`as` 309 件(概算) |
| mc-playground-kit | `responsibility.md` が「同じ合成を出荷 runtime にも使える」と明記。bench 無し |
| mx-gameplay | 19 のドメインモジュール(bed-sleep、fall-damage、player-swimming、boss/wither、ignite-portal、mining-progress 等)が自前 stage から到達不能で、compose が手配線 |
| mx-redstone | 公開 API は `makeRedstoneStages` のみで健全。ピストンがレベル駆動(参照はエッジ駆動)。hopper / dispenser は搬送の実体を持たない |
| mx-ui | 統一 screen registry 無し(`makeUiMount` は 4 画面のみ)。parity ledger 6 行全てが「compose 配線未検証」 |
| mx-multiplayer | 権威コマンド 20 tag 中 4 tag のみ mc-sim 接続(`src/application/server/command-application.ts` 冒頭が自己申告)。サーバ側ソケットアダプタ無し。compose の `apps/multiplayer-server/{transport-security,reconnect-auth,wire-frame-validation}.ts` と `apps/multiplayer-shared/*-network.ts` 7 本は mx-multiplayer 側 docstring が「lowered 済み」と明言 |
| parity ledger | 98 行: implemented 39 / partial 16 / unverified 39 / unimplemented 2(passive-animals、creative-flight)/ deferred 2 |

### 2.4 mc-compose `apps/` の分解マップ

`apps/web/main.ts` は `// N. タイトル` の自己申告セクションを持つ。

| 行範囲 | セクション | 所有先 | 判定 |
| --- | --- | --- | --- |
| 1103〜1403 | 1. Platform adapters | compose(host) | 正当な Layer 配線 |
| 1404〜2406 | 2. Registration / 2a. generated world | mc-sim / mc-worldgen(状態)、mx-gameplay(ルール結果反映) | 一部ルール適用含む |
| 2406〜2632 | hopper / dispenser / dropper / piston 搬送 | mx-redstone | responsibility.md §2 の禁止表に直接該当 |
| 2711〜4642 | 2c. gameplayModule と 4 service、ポータル安全着地(2989〜3187) | mc-worldgen または mx-gameplay | 対応 export が無いギャップ |
| 3284〜4262 | multiplayer client protocol(約 980 行) | mx-multiplayer | 既存 export の再実装 |
| 4696〜4736 | 3. Composition(`composeGame`) | compose | 約 40 行で健全 |
| 4737〜6773 | 4. Screens | mx-ui | inventory controller 相当が未出荷のため直書き |
| 6934〜9045 | 5. QA surface(約 2,100 行、`seed*Encounter` 30 本超) | 各所有 package の QA namespace | porting.md「QA API はマージのみ」に抵触 |
| 9049 | `runFrame`(clamp、try/catch、計測なし) | compose | responsibility.md §2.2 準拠 |
| 9061〜11373 | `tick()`(約 2,300 行) | mx-gameplay / mc-sim の stage 本体 | フレーム内調停が host に堆積 |
| 11376〜11428 | preview 起動と `boot()` | mc-playground-kit / compose | 正当 |

その他のファイルの所有先は次の通り。

- `apps/multiplayer-server/core.ts`(4,531 行、`makeMultiplayerServerCore` が 675 行目から末尾)は mx-multiplayer の `applyAuthoritativeCommand` と `AuthoritativeSession` を import せず 20 tag を独自ディスパッチし、冪等キーも独自生成(207〜227 行)。
- `apps/multiplayer-server/main.ts` の `decodeServerState`(195〜411 行)は手書き型ガードで、末尾で既存 Schema を二重に呼ぶ。`findSpawnAt` / `makeGeneratedBlockAt`(512〜538 行)は web 側が使う mc-worldgen `surfaceHeightAt` を使っていない。
- `apps/web/session-persistence.ts`(1,172 行)はほぼ全体が save format 定義で、mc-sim `SIMULATION_SAVE_FORMAT` の slice と統合できる。
- `apps/multiplayer-shared/*-network.ts` は anvil / brewing / crafting / enchanting / ender-dragon / player-damage / wither の 7 本が重複確定。`sleep-network.ts` は mx-multiplayer の `SurvivalAuthority` を使う移行済みの模範例。
- `apps/web/{bow-use,mining-completion,sleep-runtime,eye-of-ender-runtime,dropped-item-lifetime}.ts` は mx-gameplay の対応 export を import せず独自状態機械を持つ(本文比較は未実施)。

## 3. 決定事項

| # | 決定 | 影響 |
| --- | --- | --- |
| D1 | package ごとに 1.0.0 へ昇格する。上位 Tier が実消費して green になった時点で major changeset を書き、CI が `v1.0.0` を打つ | FR-009、P7 |
| D2 | host は新 package `mc-host-web` と `mc-server` を新設し、そこへ apps/ を移した後に所有 package へルールを降ろして薄くする | FR-005、FR-006、P0b、P5 |
| D3 | branch と PR は local と remote の両方を整理し、WIP PR 9 本を close する。dependabot の `@nerima-games/*` bump は再 pin 波に吸収する | FR-008、P0 |
| D4 | mc-kernel は契約を再定義して破壊的に拡張する。K03〜K05 packet と freeze-checklist を一次資料とし、消失した D02 / D03 / D05 / D07 は復元しない | FR-001、P1 |
| D5 | Minecraft 仕様の正本は Java Edition 最新安定版を 1 つ pin する。現在は 26.3(misode/mcmeta の `26.3-data` / `26.3-registries` / `26.3-assets-json` / `26.3-summary`) | FR-014 |
| D6 | 完成の物差しは参照実装 ts-minecraft の全機能。参照に無い機能(carrot / beetroot / pick-block、タッチ操作、サーバ権威)は extension と明記して残す | FR-007、V-4 |
| D7 | 工数より理想状態を優先する。移設だけで終える読みは採らない | FR-005、FR-006 |
| D8 | 権威コマンドの適用実装は mx-multiplayer の `applyAuthoritativeCommand` / `AuthoritativeSession` を残し、compose 由来の `core.ts` のディスパッチは捨てる | FR-005、P5 |

## 4. 機能要件

すべて mandatory である。
依頼が理想状態を要求し、各項目が完成判定(ledger と 1.0.0 昇格)の前提になるため、optional は置かない。

### FR-001 kernel 契約の封印

- canonical ItemStack payload: count ゼロは `ItemSlot` の空で表し、`ItemStack` に count ゼロを許さない。split / merge / equality と patch 競合の拒否を持つ。
- chunk read/edit 語彙: `BlockRead` は `Loaded` / `Unloaded` / `OutOfWorld` を区別する。`ReadView`、`BlockEdit`、`BlockWriteBatch`、`WorldEpoch` / `ChunkRevision` / `LightRevision` を持つ。
- 時間ブランド: `SimulationTick`、`FixedDurationSecs`、`InterpolationFraction`、`SessionEpoch` と、overflow を typed error で返す `addTick` / `secondsForTicks` / `interpolationFraction`。`tickDuration = 0.05`、`physicsSubstepDuration = 0.025`。
- 下流重複語彙の吸収と、矢を止めるブロック能力の追加。

受け入れ条件: K03〜K05 packet の literal oracle がそのまま test に存在して green。`test/*.compile.ts` が brand 混同を `@ts-expect-error` で拒否。`docs/consumer-migration.md` の未完了項目が 0。

### FR-002 型ゲートの統一

16 repo で tsconfig の flag セットが同一(lib 差分のみ許容)。`no-type-assertion` は全 repo で error。`any` と非 null 断言は 0。

受け入れ条件: `pnpm lint` が assertion 1 件で非ゼロ終了することを各 repo で確認。

### FR-003 性能基盤

全 runtime package に `pnpm bench`(baseline JSON と guard / workload tolerance)を置く。
ホットパス(meshing、worldgen、fluid frontier、mob spawn、world-sync)は per-cell / per-frame のオブジェクト割り当てを持たない。

受け入れ条件: baseline を 1.3x 超えると `pnpm bench` が非ゼロ。mc-host-web の performance-budget E2E が FR-013 の閾値を満たす。

### FR-004 Tier2 名詞の完成

- mc-worldgen: revision / epoch 付き `ChunkStore`、read view、worker parity test。
- mc-sim: hunger / death / swimming / dropped-item / vehicle / portal / villager / brewing の状態 service、save format と coordinator、multiplayer が要る per-player registry。
- mc-render: `authoritativePose` を sim から読む。post-processing / lighting / touch を所有。フォーカス通知 API。
- mc-playground-kit: 出荷 host が使う canvas / RAF / teardown の boot API。

受け入れ条件: 各 package の `docs/public-api.md` が responsibility.md と矛盾しない。host 側に `post-processing.ts` / `render-lighting.ts` / `touch-input.ts` / `chunk-sync-budget.ts` / `session-persistence.ts` / `session-save-coordinator.ts` / `projectile-runtime.ts` が残らない。

### FR-005 Tier3 動詞の自己登録

- mx-gameplay: 19 モジュール全てを stage 経由で到達可能にする。host の runtime(bow-use、eye-of-ender、dropped-item、mining-completion、sleep、fall、hunger、portal travel、player-death)を吸収する。QA namespace を export する。
- mx-redstone: hopper / dispenser / dropper / piston 搬送を stage 内に持つ。ピストンをエッジ駆動にする。
- mx-ui: 全画面の screen registry、inventory controller、settings view。
- mx-multiplayer: 20 / 20 tag を mc-sim へ適用する。wire codec を `src/domain/protocol.ts` に一本化する。client 同期(main.ts 3284〜4262 相当)を所有する。Node ws 用 transport port を持つ。

受け入れ条件: mc-host-web / mc-server が mx-* から import するのは `GameModule` と host port 型だけである(`test/public-api.test.ts` 相当で固定)。

### FR-006 host の新設と薄型化

`mc-host-web`(ブラウザ起動、DOM 取得、platform Layer、session route、Playwright E2E)と `mc-server`(HTTP / WS bootstrap、3 realm orchestration、Node port 実装)を Tier5 として新設する。
mc-compose は `src/` と frame 側テストだけを持つ。

受け入れ条件: `src/` 合計が mc-host-web で 3,000 行以下、mc-server で 1,500 行以下(残余見積: main.ts 600〜900、core.ts 500〜800、server main.ts 約 500、その他 web 28 file で 1,500〜2,000)。mc-compose に `apps/` が無い。

### FR-007 parity 完了

ledger 98 行の unverified 39 行を implemented / partial-with-reason / extension のいずれかに確定する。
unimplemented 2 行(passive-animals、creative-flight)を実装する。

受け入れ条件: `pnpm check:features` が unverified 0、evidence path 実在。FR-014 の `check:conformance` も unverified 0。

### FR-008 branch と PR の整理

2.1 の「取り込む価値のある」branch を取り込み、残りの local / remote branch と WIP PR 9 本の削除と close を行う。
dependabot の `@nerima-games/*` bump は再 pin 波で吸収して close する。

受け入れ条件: 各 repo で `git branch -a` が `main` と in-flight の作業 branch のみ。`gh pr list` が 0。

### FR-009 1.0.0 昇格とタグ

各 package は上位 Tier が実消費して green になった後に major changeset で 1.0.0 にする。CI が `v1.0.0` を打つ。

受け入れ条件: 15 runtime package と 2 host に `v1.0.0` タグ。mc-dev-meta は private のためタグ無し。

### FR-010 下層 package のリファクタリング

#### 全下層共通(R-C)

Tier1 6 package と Tier2 4 package に適用する。mc-kernel の分は P1 で扱い、P2 は残る Tier1 5 package を並列で進める。

| ID | 要件 | 受け入れ条件 |
| --- | --- | --- |
| R-C1 型境界 | `as` 型アサーション、非 null 断言、`any` を src/ から排除する。外部入力は `Schema` decoder か brand コンストラクタ(`.either`)で検証する。`.ast-grep/rules/no-type-assertion.yml` を全 package で `severity: error` にする | `pnpm lint` が assertion 1 件で非ゼロ。概算件数(kernel 205 / noise 62 / meshing 73 / physics 19 / save 28 / audio 73 / worldgen 95 / sim 165 / render 309 / kit 73)が 0 |
| R-C2 tsconfig 同一化 | `tsconfig.base.json` を kernel の複製とし、差分は `lib` のみ許す | 10 package で `diff` が `lib` 行以外空 |
| R-C3 公開面の正本化 | `src/index.ts` と `package.json#exports` の対応を test で固定する。`docs/public-api.md` は export 一覧から生成した表を含む。`knip` で未使用 export 0 | export 集合と docs の表の一致を検査する test |
| R-C4 docs drift 除去 | `docs/versioning.md` の「現在のバージョン」記載を削除し package.json を正とする。responsibility.md と public-api.md の矛盾を解消する | 版数の直書きが docs から消える。CI に docs 整合 test |
| R-C5 性能基盤 | `pnpm bench` を全 package に置き、baseline JSON と guard 1.3x / workload 2.0x tolerance(mc-noise / mc-meshing の harness を共通化)。ホットパスは typed array と事前確保バッファで割り当てを持たない | baseline 超過で非ゼロ終了。`docs/testing.md` にホットパス一覧と計測手順 |
| R-C6 依存 pin | kernel 0.8.0 に続き各 Tier の最新へ一括追随する | `dependencies` が最新タグに一致 |

#### Tier1 個別

| ID | package | 要件 | 受け入れ条件 |
| --- | --- | --- | --- |
| R-K1 | mc-kernel | `src/domain/` 214 file を `package.json#exports` の 92 subpath と一致する領域ディレクトリ(coordinates / item / block / recipe / entity / world / time など)に再編し、各領域に barrel を置く。root `index.ts` は領域 barrel の再 export のみ | subpath 数と領域 barrel 数が一致する test。`architecture.md` §6 の分割方針を維持 |
| R-K2 | mc-kernel | canonical ItemStack(`item-stack.ts:19-24` の optional `components` / `componentPatch` を廃止) | K03 packet の literal fixture 8 系列が green |
| R-K3 | mc-kernel | `block-world.ts` を `world-read-write.ts` の `ReadView` / `BlockEdit` / revision 語彙へ置換し、section 単位の typed array view を提供する | K04 packet の 6 挙動と compile fixture。`chunk.ts` の v2 codec レイアウト不変 |
| R-K4 | mc-kernel | 時間ブランド(`quantities.ts` / `frame-timing.ts` / `clock.ts`)と純粋 tick 演算 | K05 packet の oracle 表 |
| R-K5 | mc-kernel | 下流重複の吸収: `consumer-migration.md` の Dimension / BlockState / Settings / Statistics / recipe 系、host の item-type guard(main.ts 726〜776)、矢を止める block capability | consumer-migration の未完了項目 0。下流に同名ローカル型無し |
| R-K6 | mc-kernel | `scripts/benchmark.mjs` を R-C5 形式へ | registry 参照 / BlockState / chunk codec / anvil の baseline JSON |
| R-N1 | mc-noise | `density-function-codec.ts`(19 件)/ `climate.ts`(12 件)の decoder を Schema 化する。seed から値への契約 golden を維持する | golden 不変、R-C1 |
| R-M1 | mc-meshing | 外部保留の参照 fixture 照合を解消する。LOD 3 段(perf/fr-3.1)、opaque のみ LOD(fr-3.2)、6 軸 greedy の AO 共有(fr-3.4)、sub-region dirty AABB 入口(fr-4.1)、cross-frame slice cache(fr-4.6)を実装する | ledger の meshing 5 行が implemented。bench baseline 更新 |
| R-M2 | mc-meshing | `chunk-view.ts`(14 件)の byte view 構築を kernel の `ReadView` に置換する | meshing が kernel `ReadView` を直接受け取る |
| R-P1 | mc-physics | 固定 25 ms substep を kernel `FixedDurationSecs` / `physicsSubstepDuration` で受ける純粋 API に整理する。`delta-time.ts` のクランプは kernel の frame policy を再 export する | substep API の literal test。sim からの呼び出しが `DeltaTimeSecs` 生値を渡さない |
| R-P2 | mc-physics | `scripts/benchmark.mjs` を R-C5 形式へ。AABB / DDA / 積分のホットパスで割り当て 0 | baseline JSON |
| R-S1 | mc-save | tsconfig flag 追加。`SaveFormat` の断片合成 helper(各所有 package が出す slice を version 付きで束ねる)を提供する | slice 合成の round-trip test。`bench-durable-save.ts` を baseline 化 |
| R-A1 | mc-audio | `pnpm bench` 新設(cue lookup、mixer graph 構築)。WebAudio smoke を `test:browser` として固定する。`docs/versioning.md` の「未公開」記載を訂正する | baseline JSON。Playwright smoke が CI 外で再現可能 |

#### Tier2 個別

| ID | package | 要件 | 受け入れ条件 |
| --- | --- | --- | --- |
| R-W1 | mc-worldgen | `src/application/chunk-store.ts` に `WorldEpoch` / `ChunkRevision` / `LightRevision`、immutable `ReadView`、`BlockWriteBatch` の all-or-none 適用、revision 付き dirty 通知を実装する | K04 packet が worldgen に割り当てた 7 挙動(`readBlock_distinguishesLoadedAirUnloadedAndOutOfWorld` 等)が test 名として存在し green |
| R-W2 | mc-worldgen | 地形生成の worker entry を worldgen 自身が出荷し、参照実装の worker-pool parity test を移植する | `docs/testing.md:306-308` の未達が消える |
| R-W3 | mc-worldgen | ポータル着地探索(main.ts 2989〜3187 相当)を `resolveNetherTravel` に衝突判定 port を注入する形で所有するか、mx-gameplay に置くかを P3 着手時に決めて実装する | host に着地探索が残らない |
| R-SI1 | mc-sim | 固定ステップ accumulator、`SimulationTick`、catch-up 上限、pause / overload を `src/application/game-loop.ts` に実装する。`src/domain/frame-timing.ts` の互換 forwarder を削除する | tick oracle test。`runFrame` は compose のまま |
| R-SI2 | mc-sim | host の `session-persistence.ts` / `session-save-coordinator.ts` と server state を、`SIMULATION_SAVE_FORMAT` の slice 群(furnace / brewing / portal / villager / vehicle / end / status-effect / wither を追加)と `src/application/save-coordinator` へ吸収する | host 側 format 定義 0 行。旧セッションは読まない(後方互換なし) |
| R-SI3 | mc-sim | hunger / death と respawn / swimming / dropped-item lifetime / vehicle / villager / brewing / end-state の状態 service を追加し、per-player registry を提供する | `command-application.ts` が 20 tag を sim service だけで適用できる |
| R-SI4 | mc-sim | `docs/public-api.md` §5「未設計」を実装と同期する。`scripts/benchmark-explosion.ts` を `pnpm bench` に登録し R-C5 形式へ | R-C3 / R-C4 / R-C5 |
| R-R1 | mc-render | `src/stages/registration.ts:130-135` の `authoritativePose` FIRST CUT を廃し、sim `PlayerService.cameraPose` を読む | FIRST CUT コメント 0 |
| R-R2 | mc-render | host の `post-processing.ts` / `render-lighting.ts` / `touch-input.ts` / `chunk-sync-budget.ts` とチャンクストリーミング半径方針(main.ts 2100〜2300)を所有する。mx-ui 向けフォーカス通知 API を追加する | host 側に同名ファイルが無い |
| R-R3 | mc-render | 参照 perf 要件の render 所有分(fr-0.1 / 0.2 / 4.2 / 4.3 / 4.4 / 4.5)と ledger の render 15 行を実装または理由付き partial に確定する | ledger render 行に unverified 0 |
| R-R4 | mc-render | `input-bindings.ts`(30 件)/ `browser-input-adapter.ts`(28 件)/ `input-service.ts`(22 件)の DOM 境界を構造型と Schema で置換する。`any` 57 件を 0 にする。screenshot fixture test を追加する | R-C1。fixture test が CI で走る |
| R-PK1 | mc-playground-kit | `makeBrowserPreview` / `runBootSequence` を出荷 host が使える boot API として整理する。boot budget の bench を新設する | mc-host-web が RAF / canvas / teardown を自前実装しない |

### FR-011 型戦略: Branded Type の徹底

| ID | 要件 | 受け入れ条件 |
| --- | --- | --- |
| T-1 生の number / string を公開境界に置かない | `src/index.ts` から到達可能な関数と型のパラメータと戻り値で、ドメイン量(座標、tick、秒、count、ID、レベル、耐久、確率、ratio)は brand 型のみ。生 `number` / `string` が許されるのは brand コンストラクタと decoder の入力だけ | 各 package に `test/*.compile.ts`。ast-grep 規則「exported 関数の parameter 型 annotation が `number` / `string` そのもの」を error で追加 |
| T-2 brand の正本は mc-kernel | 全 brand は kernel の領域 barrel で定義し、下流は再定義しない。`src/domain/brand-catalog.ts`(名前 / 不変条件 / コンストラクタ / 禁止代入 / 所有 package)を kernel が export し、test が「export する brand 集合 = catalog の集合」を固定する。motion と vitals / XP にも brand を付与する(`Velocity` 各軸、`Health`、`Hunger`、`Saturation`、`ExperiencePoints`、`ExperienceLevel`) | 下流 10 package で `Brand.refined` / `Brand.nominal` の呼び出し 0 |
| T-3 コンストラクタ規約 | 直接呼び出しは throw(内部の不変条件違反はバグ)。外部入力、保存データ、wire は `.either` / `.option` か `Schema.brand` decoder で受け、失敗は `Data.TaggedError` で返す。`as` による brand 付与は禁止 | R-C1 と同じ ast-grep gate。decoder は `Schema` 経由のみ |
| T-4 混同禁止の brand 対 | `EpochMillis` / `MonotonicTimeSecs` / `DeltaTimeSecs` / `FixedDurationSecs` / `SimulationTick`、`BlockAxis` / `ChunkAxis` / `LocalAxis`、`StackCount` / `TransferQuantity` / `MaxStackSize`、`WorldEpoch` / `ChunkRevision` / `LightRevision` / `SessionEpoch`、`BlockId` / `BlockType`、`ItemDamage` / `MaxDamage`、`EntityId` / `PlayerId` / `WorldId` / `StageId` | 各 package の `*.compile.ts` に対ごとの negative control |
| T-5 判別可能 union と網羅性 | 状態と結果は `Data.TaggedEnum` か `_tag` 付き union で表し、分岐は `Match.exhaustive` か `switch` と `never` assertion。boolean フラグの組み合わせで状態を表さない | oxlint `switch-exhaustiveness-check` を error。boolean 2 個以上を持つ状態 record を新規に増やさない |
| T-6 readonly と不変 | 公開型は全 field `readonly`、配列は `ReadonlyArray`、typed array は `ReadView` で渡す | 生成 `.d.ts` に mutable 配列型が出ない test |
| T-7 Schema を境界の唯一の入口に | save / wire / URL / DOM / JSON の decode は `Schema` で行い、手書き `isXxx` 型ガード群を持たない | ast-grep で `value is` 述語関数の export を error(kernel `json-value.ts` は許可リスト) |

### FR-012 テスト戦略

| 層 | 対象 | 手法 | 所有 | ゲート |
| --- | --- | --- | --- | --- |
| L0 型 | brand 混同、readonly 漏れ、`any` | `*.compile.ts` と `tsc -p tsconfig.test.json`、ast-grep error | 全 package | typecheck / lint |
| L1 純粋関数 | domain/ の全 export | literal oracle(実装から導出しない期待値)、`@effect/vitest` と FastCheck の property test(brand 不変条件、split / merge の可逆性、codec round-trip、順序の決定性)、golden(chunk codec byte、noise、mesh quad hash) | 各 package | `vitest run` とカバレッジ 4 指標 100% |
| L2 service / stage | application/ と stages/ | `TestClock` / `Ref` によるフレーム駆動、stage 到達可能性検査(index.ts の全 export が stage か service 経由で到達)、`GameModule` 契約 test | Tier2 / Tier3 | 同上 |
| L3 package 境界 | 出荷物 | `pnpm package:verify`、`docs/public-api.md` と export 集合の一致 | 全 runtime package | publish 前必須 |
| L4 契約 | 下層の破壊的変更の下流影響 | mc-dev-meta workspace で `workspace:*` 結線し、上位 package の typecheck / test を下層変更ごとに実行 | mc-dev-meta | Phase 境界 |
| L5 合成 | stage 順序、Layer merge | mc-compose の `test/e2e/roster-frame-order.test.ts` と `check:roster` | mc-compose | compose verify |
| L6 ホスト E2E | 起動から RAF、QA 観測、teardown まで。多人数 | Playwright(Chromium + SwiftShader)、2 client + server の multiplayer spec、QA API 経由の観測のみ | mc-host-web(mc-server を devDependency) | `browser-regression.yml` |
| L7 parity と conformance | 参照実装との機能同等、Minecraft 仕様適合 | ledger の evidence path 実在と `kind` 整合、`check:features`、`check:conformance` | mc-dev-meta | P6 |
| L8 性能 | FR-013 | `pnpm bench` baseline、performance-budget E2E | 各 package / host | P6 と publish 前 |

規律は次の通り。

- skip 0、`only` 0。テスト数と assertion 数の最小値を CI が固定し、減少を検知する。
- mock は port の fake 実装に限り、mc-* 本体を mock しない。
- 時計は `ClockPort` 注入のみ。`no-wall-clock-read` 規則を全 package に置く。
- flaky は「負荷 20 超では再判定」の規則を `simulation-wait` helper に組み込み、worktree 間で shard する。
- ルールは所有 package が単体で証明し、host E2E は合成して動くことだけを証明する。
- 参照実装の 9,287 unit と 64 e2e(ledger `test-suite-count`)は目安であり、件数自体は要件にしない。

### FR-013 パフォーマンス戦略

| 領域 | 予算と目標 | 計測 | 所有 |
| --- | --- | --- | --- |
| フレーム | 60 fps 目標。`tickDuration` 0.05 s の固定 tick と catch-up 上限。ステージ別の `performance.mark` / `measure`(fr-0.2) | mc-host-web の performance-budget E2E。stage 別計測は mc-render / mc-sim が 1 stage 登録(compose には置かない) | render / sim / host |
| 参照 FPS 同等 | 描画距離 5(225 mesh)で 65 fps、8(289 mesh)で 41.7 fps を同一ハーネス条件で参照値の 90% 以上。frustum cull 55〜60%。200 block テレポートで可視リング完成が数秒(上限は初回計測後に baseline 化) | fr-0.3 の headless FPS ハーネスを mc-host-web に移植し、ledger の 4 行を verified にする | host / render / worldgen |
| メッシュ | LOD 3 段(頂点比 1 は 25〜30%、2 は 6〜10%)、opaque のみ LOD、6 軸 greedy の AO 共有、sub-region dirty AABB、slice cache | mc-meshing bench(quad 数と μs/chunk)、mc-render bench(chunk update) | meshing / render |
| 地形 | 生成は worker pool。chunk load 並列 4 fiber 上限(fr-2.2)。LRU eviction(fr-2.1) | mc-worldgen bench(ms/chunk) | worldgen |
| 割り当て | ホットパスは per-cell / per-frame の object 割り当て 0。typed array と事前確保バッファ、`ReadView` の index アクセス。`Map` のキー文字列化はフレーム内で禁止 | bench に allocation count(`--expose-gc` と `process.memoryUsage` 差分)を追加し baseline 化 | 各 package |
| 保存 | autosave 5 s 間隔(fr-1.4 / 2.3)。IndexedDB 書き込みはフレーム外 | mc-save `bench-durable-save` baseline 化 | save / sim |
| 描画後処理 | preset gate 付き composite pass(fr-4.3)、水面比率による refraction skip(fr-4.4)、SSIM 0.95 未満で自動 preset 降格(fr-4.5) | render bench と E2E の preset 切替検証 | render |
| 回帰ゲート | 全 runtime package に baseline JSON。guard 1.3x / workload 2.0x 超で `pnpm bench` 非ゼロ。CI では artifact 保存のみ。Phase 境界と publish 前に手元で必須実行 | R-C5 | 全 package |

計測の規律: 数字のない性能主張を docs に書かない。before / after は同一マシンと同一負荷帯で 5 回以上計測し、`uptime` の load を記録する。参照値との比較は同一ハーネス条件のみ。
参照 FPS を絶対値にしない理由は、参照実測が SwiftShader 上の値で、開発機は他 session の負荷で 10 fps を割ることがあるため。

### FR-014 Minecraft 仕様適合の検証

参照実装は「どの機能を持つか」の物差しであり、その挙動が Minecraft として正しい保証は無い(mc-worldgen README が記録する SEA_LEVEL 48 から実物 63 への訂正が実例)。
適合性は parity とは別軸で判定する。

#### 正本の階層

| 優先 | 正本 | 使い方 | pin |
| --- | --- | --- | --- |
| 1 | 公式ゲームデータ(vanilla data pack、registry レポート、assets の `sounds.json` / blockstates / models) | データで表せる語彙と数値はここから生成した golden と突き合わせる | misode/mcmeta の `26.3-data` / `26.3-registries` / `26.3-assets-json` / `26.3-summary`(SHA を `docs/conformance.md` に固定) |
| 2 | Minecraft Wiki(Java Edition の該当版) | データに現れない力学(落下ダメージ式、空腹と飽和の消費、防具軽減式、redstone tick、流体拡散、ピストン押し上限 12、睡眠、1 日 24,000 tick、重力 0.08 と抗力 0.98、ジャンプ初速 0.42、歩行 4.317 m/s、疾走 5.612 m/s 等)は URL とセクション、参照日を引用し literal oracle にする | 引用ごとに参照日 |
| 3 | 参照実装 ts-minecraft | 機能の範囲のみ。挙動の正しさの根拠には使わない | ledger の `REFERENCE_REF` |

全 package を 26.3 に揃える。影響は次の通り。

- mc-kernel の biome / damage type / status effect / tag / recipe データは `1.21-data` 照合(`biome-data.ts:16`、`docs/public-api.md:2161`)のため 26.3 へ再生成する(1.21.2 以降の `mace_smash` などが増える)。
- mc-save の Java 26.1 の NBT / Anvil(`README.md:14`)を 26.3 で再検証する。
- mc-audio の 26.2 安定カタログと 26.3 Snapshot 9 検証版(`docs/minecraft-sounds.md:107-162`)を 26.3 リリース版の `sounds.json` 1 本に統合する。

#### 検証機構

| ID | 機構 | 所有 | 受け入れ条件 |
| --- | --- | --- | --- |
| V-1 データ生成 golden | `scripts/conformance/generate.ts`(mc-dev-meta)が pin 済み mcmeta から block / item / biome / enchantment / recipe / loot table / tag / damage type / mob effect / sound event / block state を取り出し、各 package の `test/golden/vanilla-*.json` を生成する。各 package のデータ表は golden と集合と値が一致することを test で固定する | mc-dev-meta が生成、各 package が照合 | ledger の `parity/content/*` 6 行が implemented。件数は 26.3 の registry を正とする |
| V-2 力学 oracle | Wiki 引用の力学ごとに literal test を置き、test 名に力学名、`docs/conformance.md` に URL、セクション、参照日、引用値を記録する | 所有 package | 表の各行に test path が実在し green。値が実装から導出されていない |
| V-3 conformance ledger | mc-dev-meta に `src/domain/conformance-catalog.ts` を置く。行は挙動 1 つで、field は `id` / `owner` / `authority`(data / wiki / none)/ `source`(path または URL と参照日)/ `status`(conformant / divergent / unverified)/ `divergenceReason` / `evidence`(test path)。`pnpm check:conformance` が evidence 実在と status 整合を検査する | mc-dev-meta | unverified 0 が P6 のゲート。divergent は理由必須 |
| V-4 意図的乖離の目録 | Minecraft と違えることを決めた点(独自 chunk / save format、Bedrock 非対応、参照に無い拡張機能、SwiftShader 前提の性能条件、`temperature_modifier` 由来の導出値を模さない等)を V-3 の divergent 行として登録する | 各 package と mc-dev-meta | 乖離が理由無しに増えない(ledger の diff をレビュー項目に) |
| V-5 実ファイル適合 | mc-save の NBT / region / `.mca` / `.mcc` decoder は 26.3 で生成した実 world save の fixture(小さな region 1 個、level.dat、player.dat)を読める。書き出した NBT を vanilla 形式として再読できる | mc-save | fixture の SHA と生成手順を docs に記録 |
| V-6 数表の property test | Wiki の既知の数表(落下高さからダメージ、防具値から軽減率、経験値レベルから必要 XP、食料から飢餓と飽和)を表形式の property test にし、表全体を検証する | 所有 package | 表の全行が test の入力 |
| V-7 版更新手順 | 版を上げるときは pin の SHA 更新、V-1 再生成、差分 golden のレビュー、V-2 の参照日更新の順を `docs/conformance.md` に固定する。複数版の同時サポートはしない | mc-dev-meta | 手順が docs にあり、pin は 1 箇所 |

vanilla を直接実行する差分テストは採らない。
CI と devShell が Node のみで完結している設計を崩し、サーバ jar の配布制約も加わるため、公式データ、Wiki 数表、実 save fixture で代替する。

FR-001 の item payload は 26.3 の item component 定義を V-1 golden で照合する。
FR-004 と FR-005 の各 service と stage は対応する V-2 行(例: 空腹は Wiki「Hunger」の exhaustion 表、redstone は「Redstone circuits」の tick 遅延)を受け入れ条件に含める。

## 5. 非機能要件

全 package でカバレッジ 4 指標 100% を維持する(既存ゲート)。
型と性能の非機能要件は FR-011 と FR-013 に含める。

## 6. 技術仕様と設計判断

- **階層に Tier5「ホスト」を追加する(推奨案。未解決事項 #1 で確定する)。** `mc-host-web` と `mc-server` は mc-compose に依存し、compose の stage 順序表を使って browser / headless の frame を組む。同一 Tier 内エッジ禁止のため Tier4 に置けない。org `DEPENDENCY_POLICY.md` と mc-dev-meta の `repository-roster.ts`(件数 6 / 4 / 4 / 1 / 1 を固定する test)を改訂する。却下案: compose 内でファイル分割のみ(依頼と不整合)。
- **compose は合成ライブラリに戻る。** `src/domain/*` と frame 側 test / roster 検査だけを残し、apps/ と browser E2E は mc-host-web、multiplayer server は mc-server へ移す。E2E は本物の合成済みゲームを対象とするため、host 無しでは起動できない。
- **開発中は mc-dev-meta の workspace で結線し、Phase 境界でのみ publish する。** `pnpm sync` で 18 repo を `workspace:*` 解決し、下層の未公開変更に対して上層を並列で書く。publish-then-pin は Tier 完了ごとに一括で行う(RELEASE_STANDARD §5)。local の `pnpm install` は GitHub Packages 認証(`NODE_AUTH_TOKEN`)が要るため、workspace 方式が並列化の前提になる。
- **kernel の破壊的契約は 0.8.0 で先に publish し、Tier1 / Tier2 が追随して green になった時点で 1.0.0 に昇格する。**
- **所有権の違反を機械ゲート化する。** import 境界は強制済みだが、許可 package の公開関数を上位で orchestration する違反は検出できない。各 mx-* の `test/stage-registration.test.ts` に「index.ts の全 export が stage 経由で到達可能」検査を、各 host に「mx-* からの import は GameModule と port 型のみ」検査を追加する。
- **移設は先に丸ごと移し、後で薄くする。** P0b で apps/ を新 package へ無変更で移し(E2E を維持)、各所有 package が capability を出荷するたびに host 側を削る。
- **R-K1 の kernel ディレクトリ再編は契約変更(K-A〜K-D)の後に行う。** 先に再編すると契約 diff が移動 diff に埋もれる。
- **repo 新設は terraform で宣言する。** `takeokunn-private/private-terraform` の `projects/github/repos_nerima_games.tf` に `module "mc-host-web"` と `module "mc-server"`(`./modules/nerima-games-repo`、name / description / topics)を追加し、同ファイル末尾の `local.nerima_games_repos` に 2 名を追記すると `rulesets.tf` の main 保護は for_each で追従する。同ファイル冒頭の WARNING に従い、apply は各 repo の初期コミットを push できる状態になってから行う。

## 7. 制約

- Git 書き込み、GitHub repo 作成、org `.github` 改訂、PR close、terraform apply は各 /execute で明示授権が要る。
- ローカルの `oxlint` / `ast-grep` / `tsc` は nix devShell 経由でのみ利用できる。
- ブラウザ E2E は負荷 20 超で偽陽性を出す。
- `.mediator/clones/*` と D02〜D07 文書は存在しない。
- 「ahead=1」の branch を未マージ内容と見なさない(2.1 の 6 本以外は破棄)。
- 30 分超の browser E2E は負荷を見てから判定する。

## 8. 未解決事項

| # | 事項 | 状態 | ブロックされる task |
| --- | --- | --- | --- |
| 1 | Tier 配置 | 持ち越し。推奨は host を Tier5 とし compose に依存させる案。代替は host を Tier4 に置き compose 非依存にする案で、その場合 stage 順序表の所有が host に漏れる | P0b の org `DEPENDENCY_POLICY.md` 改訂と mc-dev-meta `repository-roster.ts` / roster test 更新。host が compose に依存するかを決めないと `dependsOn` を書けないため、P0b の該当 task 着手前に決める |
| 2 | mc-dev-meta の扱い | 持ち越し。推奨は graph 外の tooling として維持し、parity / conformance ledger の正本とし、タグは打たない | P7 の mc-dev-meta タグ有無 |
| 3 | multiplayer 権威の範囲 | 持ち越し。作物の成長と環境ダメージ(火、溶岩、落下)をサーバ権威にするか client 計算のままにするか。推奨はサーバ権威(FR-005 の 20 / 20 tag に含める) | P4 multiplayer の `WorldTimeWeatherCommand` / `PlayerDamageCommand` 適用範囲、P5 server |
| 4 | host のカバレッジ閾値 | 持ち越し。mc-host-web / mc-server の `src/` に 100% を課すか、E2E で代替するか。推奨は `src/` 100%(E2E は `test:coverage` の対象外) | P0b の vitest.config.ts |

## 9. タスク分解

依存: P0 と P0b と P1 は並行可。P2 は P1 の publish 後、P3 は P2、P4 は P3、P5 は P4(段階的に P3 から着手可)、P6 は P5、P7 は上位 Tier の実消費が green になった Tier から順に進める。

| Phase | 並列単位 | 主な作業と対象ファイル | 前提 | ゲート |
| --- | --- | --- | --- | --- |
| P0 hygiene | repo ごと(16 並列) | 2.1 の取り込み branch のマージ、残骸 branch と WIP PR の削除と close、`docs/versioning.md` の版数 drift 修正、mc-render / mc-save の tsconfig flag 追加、Tier2 / Tier3 の `no-type-assertion` を error 化して違反修正、dependabot bump の採否。mc-dev-meta に V-3 catalog の雛形と `check:conformance` を追加し、26.3 pin を `docs/conformance.md` に記録 | 授権 | 各 repo `pnpm verify` |
| P0b host 新設 | 2 並列 | terraform で `mc-host-web` / `mc-server` を宣言して apply。compose `apps/web` と `e2e/`、`playwright.config.ts`、`index.html`、`vite.config.ts` を web へ、`apps/multiplayer-server` と `apps/multiplayer-shared` を server へ無変更移設。compose から `apps/` と不要 dependency を除去。org `DEPENDENCY_POLICY.md` に Tier5、mc-dev-meta `repository-roster.ts` / `repos.json` / roster test を更新 | P0 授権、repo 作成授権、未解決事項 #1 | web で `pnpm e2e:browser` が移設前と同数 pass。compose `pnpm verify` |
| P1 kernel 契約 | 逐次(K-A、K-B、K-C、K-D、R-K1 再編、K-E の順) | K-A canonical item(`src/domain/item-stack.ts`、`item-component-patch.ts`、`item-components-validation.ts` と同名 test)。K-B `src/domain/world-read-write.ts` 新設と `index.ts` / `package.json` exports。K-C `quantities.ts` / `frame-timing.ts` / `clock.ts` と `test/time-units.compile.ts`。K-D 下流重複吸収と矢を止める block capability、brand catalog と compile fixture 雛形(T-1〜T-7)、V-1 golden 生成器と kernel データ表の 26.3 再生成。R-K1 領域ディレクトリ再編。K-E `pnpm bench` baseline 化。0.8.0 publish | 無し | `pnpm verify`、`package:verify`、100%、bench |
| P2 Tier1 | 5 並列(noise / meshing / physics / save / audio) | kernel 0.8.0 追随。R-C1〜R-C6。R-N1、R-M1、R-M2、R-P1、R-P2、R-S1、R-A1。mc-save V-5、mc-audio 26.3 カタログ統合。T-1〜T-7 の compile fixture 追加 | P1 publish | 各 verify、publish |
| P3 Tier2 | 4 並列(worldgen / sim / render / kit) | R-C1〜R-C6。R-W1〜R-W3、R-SI1〜R-SI4(R-SI2 と R-SI3 は P4 / P5 の前提なので最優先)、R-R1〜R-R4、R-PK1。各 service に V-2 行を作成 | P2 publish | 各 verify、publish |
| P4 Tier3 | 4 並列(gameplay / redstone / ui / multiplayer) | gameplay: 19 モジュールの stage 配線、host runtime 吸収、QA namespace、passive-animals / creative-flight / shield。redstone: main.ts 2406〜2654 の搬送、エッジ駆動ピストン、QA fixture。ui: screen registry(branch 取り込みと全画面)、inventory controller(`apps/web/inventory-interaction.ts` と main.ts 6075〜6394)、settings view。multiplayer: 20 / 20 tag(`src/application/server/command-application.ts`)、codec 一本化、client 同期、Node transport port。各 stage に V-2 行を作成 | P3 publish | 各 verify、到達可能性検査、publish |
| P5 host 薄型化 | 2 並列 | web: main.ts の「2. Registration」「2c」「4. Screens」「5. QA surface」「6. tick」を所有 package の module 呼び出しに置換。server: `core.ts` のディスパッチと冪等キー生成(207〜227 行)を mx-multiplayer の `applyAuthoritativeCommand` / `AuthoritativeSession` に置換、`decodeServerState` を mc-save の `defineFormat` パターンへ、`findSpawnAt` を `surfaceHeightAt` へ、`apps/multiplayer-server/{transport-security,reconnect-auth,wire-frame-validation}.ts` と `apps/multiplayer-shared/*-network.ts` 7 本を削除。着手時に `core.ts` の handler と `command-application.ts`、main.ts 3284〜4262 と mx-multiplayer `domain/protocol/*` の関数単位 diff を行う | P4 publish | 行数上限、E2E 全 pass、import 検査 |
| P6 parity / perf / conformance | ledger 行ごと | unverified 39 行を evidence 付きで確定。perf 行を E2E 閾値化。V-1〜V-6 を閉じ、`check:features` と `check:conformance` を green にする | P5 | 両 check が unverified 0 |
| P7 昇格 | Tier 順 | major changeset、main push、CI publish と `v1.0.0`。順序は kernel、Tier1、Tier2、Tier3、compose、host | 上位 Tier の実消費 green | タグ存在確認 |

## 10. /execute への引き継ぎ

参照資料は次の通り。

- K03〜K05 packet: mc-compose branch `takeokunn-20260927-130931-f603ce2` の `docs/completion-packets/`。
- mc-kernel `docs/freeze-checklist.md`、`docs/consumer-migration.md`。
- mc-compose `docs/porting.md` §1〜§2、`docs/responsibility.md`。
- org `DEPENDENCY_POLICY.md`、`RELEASE_STANDARD.md`、`PERFORMANCE_STANDARD.md`。
- parity ledger: mc-dev-meta branch `takeokunn-minecraft-parity-ledger` の `src/domain/parity-catalog.ts`。
- 参照実装 `takeokunn/ts-minecraft` の `docs/reference/vanilla-parity.md` と `phase/04-performance-requirements.md`。
- Minecraft 公式データ: misode/mcmeta の 26.3 タグ群。

根拠の確度は次の通り。

- verified: 2.1〜2.4 の file:line、決定事項、release / PR / terraform の機構、26.3 が最新安定版であること(Mojang version manifest)、mcmeta 26.3 タグの存在。
- inferred: host 残存行数の見積、`core.ts` handler と `command-application.ts` の重複範囲、main.ts 3284〜4262 と mx-multiplayer `domain/protocol/*` の重複、R-W3 の所有先、R-SI2 の slice 粒度、allocation count の計測手段。
- 未実行: ビルド、テスト、ast-grep。`as` / `any` の件数はテキスト grep の概算。

## 11. FR 別の対象と検証コマンド

各 FR の対象 repo、主な file / symbol、検証コマンドを一覧にする。
`pnpm` は各 repo の `nix develop --command pnpm` で実行する。

| FR | 対象 repo | 主な file / symbol | 検証コマンド |
| --- | --- | --- | --- |
| FR-001 | mc-kernel | `src/domain/item-stack.ts`、`src/domain/item-component-patch.ts`、`src/domain/item-components-validation.ts`、新規 `src/domain/world-read-write.ts`、`src/domain/quantities.ts`、`src/domain/frame-timing.ts`、`src/domain/clock.ts`、`src/index.ts`、`package.json#exports` | `pnpm verify && pnpm typecheck:dependencies && pnpm package:verify && pnpm bench` |
| FR-002 | 全 17 repo | `tsconfig.base.json`、`.ast-grep/rules/no-type-assertion.yml`、`.oxlintrc.json` | `pnpm lint`(assertion を 1 件入れて非ゼロを確認してから戻す) |
| FR-003 | 全 runtime package | `scripts/bench-*.ts`、`scripts/bench-baseline.json`、`vitest.config.ts` | `pnpm bench` |
| FR-004 | mc-worldgen / mc-sim / mc-render / mc-playground-kit | `src/application/chunk-store.ts`、`src/application/game-loop.ts`、`src/application/save-coordinator.ts`、`src/stages/registration.ts`(render)、`src/application/browser-preview.ts`(kit) | 各 repo `pnpm verify && pnpm package:verify` |
| FR-005 | mx-gameplay / mx-redstone / mx-ui / mx-multiplayer | `src/stages/registration.ts`(各)、`src/application/server/command-application.ts`、`src/domain/protocol.ts`、mx-ui `src/application/ui-mount.ts` と新規 screen registry | 各 repo `pnpm verify` と `test/stage-registration.test.ts` の到達可能性検査 |
| FR-006 | mc-host-web / mc-server / mc-compose | host `src/main.ts`、`src/server.ts`、compose `package.json` | host `pnpm e2e:browser`、`pnpm test`、行数上限は `find src -name "*.ts" | xargs wc -l` |
| FR-007 | mc-dev-meta | `src/domain/parity-catalog.ts`、`src/domain/conformance-catalog.ts` | `pnpm check:features && pnpm check:conformance` |
| FR-008 | 全 17 repo | branch と PR | `git branch -a`、`gh pr list --state open` |
| FR-009 | 全 runtime package | `.changeset/*.md`、`package.json#version` | main への push 後に `gh run watch` で release workflow の `tag` job 成功、`git tag -l v1.0.0` |
| FR-010 | Tier1 / Tier2 の 10 repo | 表 R-C / R-K / R-N / R-M / R-P / R-S / R-A / R-W / R-SI / R-R / R-PK の file | 各 repo `pnpm verify && pnpm package:verify && pnpm bench` |
| FR-011 | 全 runtime package | mc-kernel `src/domain/brand-catalog.ts`、各 repo `test/*.compile.ts` | `pnpm typecheck && pnpm lint` |
| FR-012 | 全 repo | `vitest.config.ts`、`test/**` | `pnpm test:coverage`(4 指標 100%)、host は `pnpm e2e:browser` |
| FR-013 | 各 package / host | bench と performance-budget E2E | `pnpm bench`、host `pnpm e2e:browser -- performance-budget` |
| FR-014 | mc-dev-meta と各 package | `scripts/conformance/generate.ts`、`test/golden/vanilla-*.json`、`docs/conformance.md` | `pnpm check:conformance`、各 package `pnpm test` |

## 12. リリース順序と pin

Tier ごとに publish し、上位はその版を pin し直してから着手する。
版数は changeset が確定するため予定値であり、breaking を含む 0.x は minor を上げる。

| 順 | package | 予定版 | pin し直す consumer |
| --- | --- | --- | --- |
| 1 | mc-kernel | 0.8.0(破壊的契約) | 残り 16 repo すべて |
| 2 | mc-noise / mc-meshing / mc-physics / mc-save / mc-audio | 0.4.0 / 0.3.0 / 0.3.0 / 0.5.0 / 0.3.0 | worldgen(noise、save)、render(meshing)、sim(physics、save)、kit(physics、save)、gameplay(audio)、ui(audio) |
| 3 | mc-worldgen | 0.5.0 | sim、render、kit、gameplay、redstone |
| 4 | mc-sim | 0.5.0 | render、kit、gameplay、redstone、ui、multiplayer |
| 5 | mc-render / mc-playground-kit | 0.8.0 / 0.5.0 | compose、host |
| 6 | mx-gameplay / mx-redstone / mx-ui / mx-multiplayer | 0.8.0 / 0.4.0 / 0.6.0 / 0.12.0 | compose、host |
| 7 | mc-compose | 0.3.0 | mc-host-web、mc-server |
| 8 | mc-host-web / mc-server | 0.1.0 | 無し |
| 9 | 1.0.0 昇格 | 上位の実消費が green になった順に kernel から | 同上の順で再 pin |

順 2 の 5 package は互いに依存しないため並列で publish してよい。
順 3 と 4 は sim が worldgen に依存するため逐次。
順 6 は順 5 を待たない(mx-* は render / kit に依存しない)。

## 13. 未配線機能の配線先

### 13.1 mx-gameplay の到達不能モジュール 19 件

配線先はすべて mx-gameplay `src/stages/registration.ts` か、そこから呼ぶ `src/stages/targeted-right-click-route.ts` / `src/stages/ender-dragon-encounter-stage.ts`。
E2E は mc-host-web に移設後の `e2e/` の spec 名で示す。

| モジュール | stage | E2E 確認 |
| --- | --- | --- |
| `domain/bed-sleep.ts` | `gameplay:interactions`(右クリック route) | `sleep.e2e.ts` |
| `domain/environmental-contact-damage.ts` | `gameplay:entities` | `environmental-contact-damage.e2e.ts` |
| `domain/fall-damage.ts` | `gameplay:entities` | `fall-damage.e2e.ts` |
| `domain/player-swimming.ts` | `gameplay:entities` | `swimming.e2e.ts` |
| `domain/item-metadata.ts` | `gameplay:interactions` | `item-upgrades.e2e.ts`、`equipment-ui.e2e.ts` |
| `domain/boss/wither.ts` | `gameplay:entities` | `multiplayer-wither-protocol.e2e.ts`、新規 single-player wither spec |
| `domain/mob/shulker-shell.ts` | `gameplay:entities`(`mob-frame.ts` から) | 新規 spec |
| `domain/interactions/ignite-fire.ts` | 右クリック route | 新規 spec(fire) |
| `domain/interactions/ignite-portal.ts` | 右クリック route | `nether-portal.e2e.ts` |
| `domain/interactions/ignite-tnt.ts` | 右クリック route | 新規 spec(tnt) |
| `domain/interactions/place-from-hotbar-slot.ts` | `gameplay:interactions` | `block-placement-persistence.e2e.ts` |
| `domain/interactions/break-progress.ts` | `gameplay:interactions` | 新規 spec(mining) |
| `domain/interactions/mining-progress.ts` | `gameplay:interactions` | 同上 |
| `domain/interactions/interaction-intent.ts` | `gameplay:interactions` | 既存の相互作用 spec 全般 |
| `domain/interactions/place-cactus-sides.ts` | `gameplay:interactions` | `farming.e2e.ts` に case 追加 |
| `domain/interactions/place-mushroom-light.ts` | `gameplay:interactions` | 同上 |
| `domain/interactions/place-sugar-cane-water.ts` | `gameplay:interactions` | 同上 |
| `domain/interactions/unequip-armor.ts` | `gameplay:interactions` | `equipment-ui.e2e.ts` |
| `domain/interactions/use-eye-of-ender.ts` | 右クリック route | `end-journey.e2e.ts` |

### 13.2 mx-multiplayer の未接続 tag 16 件

`AuthoritativeCommand` は 20 member で、`EntityPickupCommand` / `PlayerInventoryCommand` / `PlayerVitalsCommand` / `VehicleCommand` の 4 つだけが `src/application/server/command-application.ts` から mc-sim に書き込まれる。
残り 16 件は同ファイルに applier を追加し、必要な mc-sim service は R-SI3 で用意する。

| tag | 必要な mc-sim service | E2E 確認 |
| --- | --- | --- |
| `WorldTimeWeatherCommand` | TimeService、WeatherService | `multiplayer.e2e.ts` |
| `ContainerCommand` | container storage | `chest-storage.e2e.ts`(multiplayer 変種) |
| `FurnaceCommand` | furnace state | `multiplayer-survival-authority.e2e.ts` |
| `VillagerTradeCommand` | villager service(新設) | `villager-trading.e2e.ts` |
| `EntityAttackCommand` | EntityManager、VitalsService | `survival-combat.e2e.ts` |
| `BowUseCommand` | projectile service | `bow-projectile.e2e.ts` |
| `IgniteTntCommand` | explosion / primed-tnt | 新規 spec |
| `EndPortalUseCommand` | portal / end-state service | `end-journey.e2e.ts` |
| `ThrowEyeOfEnderCommand` | projectile service | 同上 |
| `InsertEyeIntoEndPortalFrameCommand` | end-state service | 同上 |
| `NetherPortalUseCommand` | portal service | `nether-portal.e2e.ts` |
| `ToggleLeverCommand` | world write(worldgen `BlockWriteBatch`) | `redstone-components.e2e.ts` |
| `EnderPearlCommand` | projectile service | 新規 spec |
| `BucketUseCommand` | fluid state | `boat-water.e2e.ts`、`swimming.e2e.ts` |
| `VehicleUseCommand` | VehicleService | `minecart-corners.e2e.ts`、`boat-water.e2e.ts` |
| `FishingCommand` | fishing service(新設) | `fishing.e2e.ts` |

anvil / brewing / crafting / enchanting / ender-dragon / player-damage / wither は `AuthoritativeCommand` ではなく `NetworkMessage` の別 member で、`src/domain/protocol/*.ts` に codec が既にある。
P5 で host の `multiplayer-shared/*-network.ts` をこれらに置き換える。

### 13.3 mx-ui の screen registry

`src/application/ui-mount.ts` の `makeUiMount` は root / hud / inventory / mainMenu / overlays の 4 面しか mount しない。
registry は branch `takeokunn-minecraft-verification-cb2830e` の `src/application/screen-registry.ts` を取り込み、`src/application/{anvil,chest-storage,crosshair,enchanting-table,furnace,hud,inventory,loading,main-menu,settings,caption}-view.ts` と `session-overlays.ts` の全画面を登録する。
host の `main.ts` 4737〜6773 行の DOM 配線は registry の mount / controller 呼び出しに置き換える。
E2E は `equipment-ui.e2e.ts`、`chest-storage.e2e.ts`、`item-upgrades.e2e.ts`、`player-settings.e2e.ts`、`escape-priority.e2e.ts` で確認する。

## 14. apps/ 薄型化の移設先

| host 側の現在地 | 移設先 | 備考 |
| --- | --- | --- |
| `apps/multiplayer-shared/{anvil,brewing,crafting,enchanting,ender-dragon,player-damage,wither}-network.ts` | mx-multiplayer `src/domain/protocol/*.ts`(既存) | 削除して import に置換。`sleep-network.ts` が模範 |
| `apps/multiplayer-server/core.ts` のディスパッチと冪等キー(207〜227 行) | mx-multiplayer `applyAuthoritativeCommand` / `AuthoritativeSession` | D8 |
| `apps/multiplayer-server/{transport-security,reconnect-auth,wire-frame-validation}.ts` | mx-multiplayer `src/application/server/{transport-security,reconnect-auth,frame-inspection}.ts`(既存) | host は Node の crypto / fs port 実装だけ供給 |
| `apps/multiplayer-server/main.ts` の `decodeServerState`(195〜411 行)と atomic write queue(413〜555 行) | mc-sim の save slice と mc-save の `durable-save` | R-SI2 |
| `apps/web/main.ts` 2406〜2632 行(hopper / dispenser / dropper / piston 搬送) | mx-redstone `src/stages/registration.ts` と `src/domain/{hopper,dispenser,piston}.ts` | FR-005 |
| `apps/web/main.ts` 2989〜3187 行(ポータル安全着地) | R-W3 で決定 | 対応 export が無い |
| `apps/web/main.ts` 3284〜4262 行(multiplayer client protocol) | mx-multiplayer `src/domain/authoritative-sync.ts` / `snapshot-interpolation.ts` と `src/application/browser-transport.ts` | 関数単位 diff を P5 で実施 |
| `apps/web/main.ts` 4737〜6773 行(Screens) | mx-ui screen registry と inventory controller | 13.3 |
| `apps/web/main.ts` 6934〜9045 行(QA surface) | 各所有 package の QA namespace(mx-gameplay、mx-redstone、mc-sim)。compose の `qa-api.ts` はマージのみ | `apps/web/qa-fixtures.ts` も同様に分割 |
| `apps/web/main.ts` 9061〜11373 行(`tick()`) | mx-gameplay / mc-sim / mx-multiplayer の stage 本体。host は入力読み取りと DOM 属性更新のみ残す | R-SI1、FR-005 |
| `apps/web/session-persistence.ts`、`session-save-coordinator.ts` | mc-sim `SIMULATION_SAVE_FORMAT` slice と `src/application/save-coordinator.ts`、mc-save の slice 合成 helper | R-SI2、R-S1 |
| `apps/web/{post-processing,render-lighting,touch-input,chunk-sync-budget}.ts` | mc-render | R-R2 |
| `apps/web/{bow-use,mining-completion,sleep-runtime,eye-of-ender-runtime,dropped-item-lifetime,player-death,placement-consumption}.ts` | mx-gameplay の対応 export(`draw-bow` / `bow-shot`、`mining-progress` / `break-progress`、`bed-sleep`、`use-eye-of-ender`、`entities/dropped-item`) | 本文 diff の上で削除 |
| `apps/web/inventory-interaction.ts`、`item-metadata-store.ts`、`settings-view.ts`、`settings.ts` | mx-ui(controller、settings view)、mc-sim(metadata state) | 13.3 |
| `apps/web/{clock,multiplayer-url,multiplayer-websocket,native-input-queue,session-navigation,audio-runtime}.ts` | host に残す(platform adapter) | `multiplayer-websocket.ts` は codec import を protocol に置換 |

## 15. 修正対象の drift

| 対象 | 事実 | 修正 |
| --- | --- | --- |
| ast-grep `no-type-assertion` | Tier2 / Tier3 で `severity: warning` のまま。ast-grep は warning で非ゼロ終了しないため未ゲート | P0 で error 化し違反を修正(R-C1) |
| `docs/versioning.md` の版数 | mc-kernel 0.4.0 表記(実 0.7.1)、mc-noise 0.2.0(実 0.3.1)、mc-meshing 0.1.4(実 0.2.0)、mc-physics 0.1.7(実 0.2.2)、mc-audio 0.2.6 未公開(実 0.2.8 公開済み) | 版数の直書きを削除(R-C4) |
| mc-sim `docs/public-api.md` §5 | 体力 / 空腹 / XP、実績 / 統計、設定を「未設計」と書くが responsibility.md §3.4〜3.6 は実装済み | 実装と同期(R-SI4) |
| mc-render `src/stages/registration.ts:130-135` | `authoritativePose` が FIRST CUT で「mc-sim が publish されたら」と書くが mc-sim 0.4.2 は依存に存在 | sim の `cameraPose` を読む(R-R1) |
| mx-gameplay `docs/testing.md:225` | 完了条件 8「frame-contract.ts / position-key.ts 削除」が未達表記だが `src/index.ts` では削除済み | 条件を達成済みに更新 |
| 地形定数 | plan.md 由来の SEA_LEVEL 48 / LAKE_LEVEL 62 は誤りで、mc-worldgen README と `test/terrain-levels.test.ts` が 63 に訂正済み | V-2 の Wiki oracle として `docs/conformance.md` に登録し、plan.md 引用の警告は残す |
| mc-worldgen `.ast-grep` コメント | 「W3 で error に上げる」と予告して未実施 | P0 で実施 |
| K 系列の前提 | packet は `.mediator/clones/kernel-execution` を前提にするが存在しない | 本仕様の P1 が packet を一次資料として再開する。K02 の `StackCount` / `TransferQuantity` 分離も P1 で実装する |
