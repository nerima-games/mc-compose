# テスト戦略

plan.md §3.15 検証:
> **E2E(参照実装の 70 本を移植)が最終ゲート。**
> 体験モジュール間の相互作用(採掘 → インベントリ反映等)はここでしか検証できない

(実測は 64 本ではなく **70 本**。[porting.md](./porting.md) §0、per-test の triage は [e2e-triage.md](./e2e-triage.md))

## 1. 何をどこで検証するか

| レイヤ | 検証手段 | 現状 |
| --- | --- | --- |
| stage 全順序の解決 | 決定性・循環検出・dangling・フェーズ所属・skeleton 連鎖 | `test/stage-order.test.ts` |
| Layer 合成 + フレーム実行 | 解決順が**実際に実行を駆動する**こと | `test/composition.test.ts` |
| セッションライフサイクル | 状態機械。**2 周目**が最重要 | `test/session.test.ts` |
| ブラウザ session lifecycle | runtime の宣言順起動、完了済み runtime の逆順 rollback、割り込み時の冪等性 | `test/browser-session.test.ts` |
| QA API | 名前空間マージ・衝突拒否・インストール | `test/qa-api.test.ts` |
| Modding 入口 | 名前空間予約・一級モジュール性 | `test/modding.test.ts` |
| 公開 API + 規範 | バレルのピン留め + ゲームルール名の検査 + **フェーズ所属のピン留め** | `test/public-api.test.ts` |
| mc-kernel 公開契約の統合 | branded time、ClockPort、FrameServices、固定時計 Layer | `test/kernel-integration.test.ts` |
| 依存境界 | 直接 import 境界 | `.oxlintrc.json` + `pnpm lint` |
| 公開 API | 公開バレルと公開型の回帰 | `test/public-api.test.ts` |
| **ロスター実在性ゲート** | 転記が兄弟リポジトリの実ソースと一致するか | `test/check-roster-manifest.test.ts` |
| **モジュール間相互作用 — フレーム側** | **E2E** | `test/e2e/roster-frame-order.test.ts`。§3 |
| **モジュール間相互作用 — 振る舞い側** | **E2E** | `e2e/`。採掘・inventoryとbrowser lifecycleを公開package境界で検証。§3.4 |

テスト本数と実行時間はテスト追加・依存更新で変動するため、固定値を文書に持たせない。現在の選択数は
`pnpm test` の出力を一次情報とする。

## 2. 主 API は `@effect/vitest` の `it.effect`

純粋な検査でも `Effect.sync(() => { ... })` で包む。
Effect ランタイム上で走ることを既定にしておくと、後から Layer や fiber が必要になったときに
テストの書き換えが要らない。

> **例外**(参照実装で確立、plan.md §3.13): DOM イベントフローのテストで
> `Effect.fork` + `Deferred.await` を `it.effect` の中に書くとデッドロックする。
> その場合はプレーンな `it` + `Effect.runPromise` を使う。
> browser session とイベント駆動の結合テストではこの例外を適用する。

## 3. E2E — 最終ゲート、かつ**それ以外の何かにしない**

### 3.1 E2E が検証するもの

**モジュール間の相互作用でしか壊れないものだけ。**

| 例 | なぜ E2E でしか見えないか |
| --- | --- |
| **16 本の stage が plan.md §4.2 のフレームに合成される** | 6 リポジトリが互いを知らないまま宣言した id と `after` が、どう合成されるか。**これは今日検証できる**(§3.4) |
| 採掘 → インベントリに反映される | mx-gameplay が壊し、mc-sim が記録し、mx-ui が表示する。3 リポジトリにまたがる |
| リモートピアのブロック破壊がローカルの世界に現れる | mx-multiplayer → mc-sim → mx-gameplay |
| セーブ → タイトルへ戻る → ロードで状態が一致する | セッションライフサイクル全体 |
| 2 周目のワールドがデッドロックしない | plan.md §3.8 の最大級のバグ源 |
| ポーズ中はシミュレーションが止まるが描画は続く | stage 順序 + セッション状態 |

### 3.2 E2E が検証しないもの

**1 つのモジュールで閉じることは、そのモジュールのテストで検証する。**

参照実装の `e2e/ui/` は 6 ファイル 33 テスト 748 LOC あるが、
その多くは 1 画面の DOM 挙動である。
それは mx-ui の DOM テストとして、ブラウザ抜きで、はるかに速く検証できる。
per-test の判定は [e2e-triage.md](./e2e-triage.md) にある。

**E2E の本数が増え続けるなら、それは compose にロジックが溜まっている兆候である。**
参照実装で E2E が唯一の検証手段になったのは、ルールが合成層にあったからである
([design-notes.md](./design-notes.md) DN-0)。

### 3.3 E2E 環境の既知の制約(plan.md §3.10)

参照実装の E2E 環境から引き継ぐ知見:

- Playwright は **SwiftShader**(ソフトウェア GL)で走る
- **ヘッドレスではポインタロックが使えない** — 視点操作は QA API 経由で行う
- QA API のキーは `__NERIMA_GAMES_QA__`(参照実装の `__TS_MINECRAFT_QA__` ではない)。
  古い名前に固定された E2E が古いビルドに対して黙って通るのを防ぐため
- ブラウザ本体は Nix ではなく `npx playwright install --with-deps chromium` で取得する。
  固定した nixpkgs revision の `playwright-driver.browsers` は 1.61.1 で、
  `@playwright/test` の pin(1.62.1)が要求する chromium revision を一致させて
  提供できない — 提供できるふりをして `browserType.launch: Executable doesn't exist`
  を実行時まで隠す方が実害が大きいため、`flake.nix` はこのパッケージを一切持たない
  (mx-ui と同じ構成)。ローカルでは `nix develop` に入った後に一度実行すればよく、
  `e2e-browser` CI job も `pnpm e2e:browser` の前に同じコマンドを踏む
  ([ci.yaml](../.github/workflows/ci.yaml))。

農業のブラウザ回帰は `e2e/farming.e2e.ts` が担当する。QA API は初期状態の設定と
収穫要求の発火だけに使い、成熟は通常のフレーム tick、食事と再植付けは実際の
右クリック入力で進める。単一シナリオで次の契約を固定する。

- ジャガイモが通常 tick で成熟する
- format v11 の save / reload 後も成熟 stage と成長秒数が維持される
- 成熟作物の収穫量が 2〜5 個で、作物ブロックと registry が同時に消える
- 収穫物を 1 個食べても 2 個以上残る
- 残ったジャガイモを耕地へ再植付けでき、inventory と crop registry が同期する

環境接触ダメージのブラウザ回帰は
`e2e/environmental-contact-damage.e2e.ts` が担当する。QA API は接触地形とプレイヤー位置の
初期設定にだけ使い、cactus への接近は通常の移動入力と physics で進める。スナップショットの
接触セルはテスト側で、lava はプレイヤー AABB との体積 overlap、cactus は水平側面接触として
再照合し、次の契約を固定する。

- cactus の側面へ通常移動で到達した最初のフレームに、体積 overlap なしで 1 ダメージを受ける
- 同時に重なる lava 2 セルは加算されず、即時に 4 ダメージだけを受ける
- respawn による状態 reset 後も、lava の最初の 4 ダメージは 0.15 秒未満で発生する
- lava 接触が続く場合、次の 4 ダメージは 0.5 秒以上後に発生する
- lava と cactus の同時接触では最強の lava だけが採用され、致死原因も `lava` になる

落下ダメージのブラウザ回帰は `e2e/fall-damage.e2e.ts` が担当する。QA API は着地点の
地形と開始高度だけを設定し、落下距離の蓄積、着地信号、ダメージ適用は通常の physics と
フレームループで進める。mc-sim の `landingImpact` は `runFrame` 後の 1 フレームだけ有効で、
ホストは同じフレームで 1 回だけ読み、落下ダメージを環境接触ダメージより先に解決する。
次の契約を固定する。

- 3 m 以下の落下はダメージを受けない
- 7 m の落下は `ceil(7 - 3) = 4` ダメージを 1 回だけ受け、原因は `fall` になる
- 23 m の落下は 20 ダメージで死亡し、既存の respawn 経路で体力 20 に戻る
- respawn と dimension 変更は落下状態を reset し、消費済みの着地信号を再適用しない

### 3.4 **今の E2E が検証していること / していないこと**

plan.md §3.15 の主張には**半分が 2 つある**。それを混ぜないことが、この節の目的である。

| 半分 | 内容 | 現状 |
| --- | --- | --- |
| **(a) フレーム** | 16 本の stage が 1 本の全順序になる。どの id が、どのフェーズに入り、どの順で走るか | **検証済み**。`test/e2e/roster-frame-order.test.ts` |
| **(b) 振る舞い** | 「採掘したらインベントリに入る」 | **部分検証済み**。公開 package 境界の browser E2E に採掘・inventory・永続化の経路がある。 |

**(b) は完全な一つのシナリオとしては、まだこの文書で主張しない。**

- `package.json` は公開済みの `@nerima-games/*` package をバージョン固定し、
  `pnpm install --frozen-lockfile` で解決する。
- `e2e/survival-combat.e2e.ts` は長押し採掘、進捗、破壊要求を検証する。
- `e2e/persistence.e2e.ts` は採掘した world・inventory・姿勢を reload 後に検証する。
- `e2e/chest-storage.e2e.ts` は inventory と chest の相互作用を検証する。

これらは公開 package を実ブラウザで組み合わせる検証であり、合成アルゴリズムだけを偽物の
module で再検証するものではない。一方、単一の「ブロック破壊の drop が同じフレームで
inventory に入る」契約は、専用シナリオとしてはまだ固定していない。

**(a) が今日できる理由**は、id と `after` が**振る舞いではなく宣言**だからである。
兄弟リポジトリの `stages/stage-ids.ts` と `stages/registration.ts` から読み出せて、
それが §4.2 のフレームに合成されるかどうかは、**どの 1 リポジトリにも答えられない**。
mx-gameplay は mc-render の stage を見られないし、mc-render は自分がフレームのどこで走るかを
知ることを禁じられている(plan.md §2.3-3)。それがまさに compose の問いである。

したがって現在の E2E の主語は `test/e2e/roster.ts` —
**兄弟リポジトリが実際に登録している 16 本の id と 13 本の `after` エッジを、
`file:line` 付きで転記したもの**である。

`run` の中身は本物ではない。id をログに追記するだけで、
`render:camera-mirror` だけが `ClockPort` を読む(本物の mc-render も
`FrameServices` を読むのはこの 1 本だけだからである)。
**stage が「何をするか」は 1 行も検証していない。**

### 3.5 転記が腐らないようにする仕掛け

転記は腐る。**このリポジトリは既に一度腐らせている。**

ロスターマニフェストができる前、`test/public-api.test.ts` と `test/stage-order.test.ts` の
両方に「the stage ids the roster actually registers today」と書かれたリストがあり、
そこには `input` / `sim:physics` / `camera-mirror` / `chunk-sync` / `render` / `post-fx` が
並んでいた。**当時この 6 本はどれも誰も登録していなかった。**
mc-render が登録するのは `render:input` / `render:camera-mirror` / `render:chunk-sync` /
`render:draw` / `render:post-fx` であり、mc-sim は 1 本も登録していなかった。
それでもテストは通っていた — 架空の id が偶然、本物と同じフェーズに入るからである。
**正しい性質を、存在しない世界について主張して、ずっと緑だった。**

その後 mc-sim が `sim:physics` を登録したので、**6 本のうち 1 本は今や実在する**。
これは当てずっぽうが正しかったという話ではなく、問題の最良の例示である:
**後から真になる作り話も、偽である間はやはり作り話のテスト**であり、
真になった日に何かが変わる仕掛けは、あのリストの側には 1 つも無かった。

対処は 2 層である。

| ゲート | 何を見るか | `pnpm verify` に入るか |
| --- | --- | --- |
| `pnpm e2e`(= `vitest run test/e2e`) | マニフェストが §4.2 のフレームに合成されるか | **入る**。`effect` と自分の `domain/` しか要らない純粋なテストで、`pnpm test` のグロブが既に拾う |
| `pnpm check:roster` | マニフェストが兄弟リポジトリの**実ソース**と一致するか(id・`after`・`file:line` の 26 箇所すべて) | **入らない**。兄弟リポジトリのチェックアウトが要る |
| `pnpm e2e:browser`(= `playwright test`) | **公開パッケージ群を合成したゲームが実ブラウザで起動し、フレームが回り、停止できるか**([e2e-triage.md](./e2e-triage.md) §3.1) | **入らない**。Chromium と dev サーバを要るが、兄弟checkoutは不要 |
| `pnpm typecheck:preview` | 公開パッケージ境界で `apps/` と `e2e/` が型として通るか(`tsconfig.preview.json`) | **入る**。`pnpm verify` が実行する |

`pnpm check:roster` を `verify` に入れない理由は 1 つで、
**mc-compose の CI は mc-compose しか clone しない**からである。
CI で走れないゲートを CI が走らせるゲートに入れると、`pnpm verify` が
「これは緑だ」を意味しなくなる([architecture.md](./architecture.md) §4.4:
参照実装の `check-package-dag.ts` は警告を出して常に 0 で終了していた)。

`pnpm check:roster` は **ロスターに触ったときに手で走らせる**ものであり、
`test/e2e/roster-frame-order.test.ts` が予想外の理由で落ちたときに**最初に走らせる**ものである。
チェックアウトの場所は `MC_ROSTER_ROOT` → `..`(作業コピー) → `../mc-dev-meta/repos`(ミラー)
の順に探し、**選んだルートを必ず印字する**。

> この順番は飾りではない。**同じリポジトリの 2 つのチェックアウトは実際にずれる。**
> このゲートを最初に両方に対して走らせたとき、`mc-dev-meta/repos` の
> `mc-render/stages/registration.ts` は作業コピーより **17 行うしろ**にいた
> (id もエッジも同一、`file:line` だけがずれていた)。
> 行番号だけを並べた失敗は、たいていマニフェストではなく**チェックアウトのずれ**である。
> まず印字されたルートを見ること。

ゲート自身が動くことは `test/check-roster-manifest.test.ts` がインメモリの
ファイルシステムで検証しており、これは CI で走る。
**テストされていない腐り検出器は、それが守るはずだった腐ったマニフェストと同じ価値しか無い。**

`pnpm e2e:browser` はChromiumを要するため `verify` の外に置く。
どちらも
公開済みpackageを `node_modules` から解決し、兄弟checkoutには依存しない。

### 3.5.1 公開package境界での最終ゲート

ブラウザエントリポイント(`apps/web/main.ts` + `index.html` + `vite.config.ts`)は
**本物の公開済み mc-render / mx-ui / mx-redstone などを import する。** 偽物を作らず、
consumerと同じ `node_modules` 境界を通す。

`@nerima-games/mc-playground-kit` はブラウザホストの runtime dependency として使い、
`makeBrowserPreview` がcanvas・RAF・AbortSignal・cleanupを一世代として所有する。
Playwrightは起動後のframe増加をQAで観測し、`lifecycle.stop` 後にframeが固定され、
QA surfaceが解放されるところまでを最終ゲートとする。

公開 package pin を `dependencies` に置くため、単独 checkout の
`pnpm install --frozen-lockfile` と consumer 相当の解決を同時に検証できる。兄弟 source alias は
local overlay の補助に限り、未公開 package を前提にしたゲートにはしない。

### 3.5.2 `three` はホストが渡す —— それがなぜ prime directive 違反でないか

**2026-07-28。`three` と `@types/three` が mc-compose の `devDependencies` に入った。**
`dependencies` ではない。使うのは `apps/web/main.ts` だけで、それは
`isToolingOrTestPath` が tooling と分類する場所であり、`package.json` の `files` にも
入っていない —— `vite` がここにあるのと同じ理由である。

**なぜホストが持つのか。** mc-render は `three` を 1 行も import しない。
`application/three-surface.ts` が使うコンストラクタを構造的な型として書き、
本物の名前空間は外から渡される。これは mc-render が
`lib: ["ES2024"]` / `types: []` を保つための機構であり(mc-render の
`docs/versioning.md` §5)、**本物を持てるのはブラウザにいると知っている場所だけ** ——
つまりホストである。`window` / `document` / canvas を渡しているのと同じ立場に
`three` が 1 つ増えた。

**なぜ `domain/composition.ts` の違反ではないのか。** 境界は「ライブラリを渡すこと」と
「何を描くか決めること」の間にある。`apps/web/main.ts` に `getContext` は無く、
scene も geometry も draw call も無い。**このファイルは三角形 1 つ描けない。**
WebGL2 コンテキストを作るのは mc-render の `new WebGLRenderer({ canvas })` である。

判定材料としてはこれが決定的である: e2e-triage #1 は
「エントリポイント側で 1 行書けば緑になる」ことを理由に `fixme` だった。
**その 1 行は今も書かれていない。** 緑になったのは mc-render が描くようになったからで、
それは #1 が最初から言っていた条件そのものである。

**ただし #1 の本体は書き換えた。書かれていたアサーションは無価値だった。**
`canvas.getContext('webgl2') !== null` は `getContext` が**コンストラクタ**である以上、
描画器が無くても緑になる —— テスト自身がコンテキストを作ってしまう。
描画器導入前の `main.ts` に対して走らせて確認した。
**`fixme` の理由は正しく、本体は間違っていた**という組み合わせで、
これは §3.4 の「検証されるのは偽物である」がテスト自身に起きた形である。
現在は「テストが自分では満たせないこと」——
`getContext('2d')` が null であること(= 先に誰かがコンテキストを取っている)と、
`canvas.width` が CSS サイズと一致すること(= `renderer.setSize` が呼ばれた)——
を問うており、ホストから描画器の生成を外すミューテーションで赤くなることを確認してある。

**現行の画面:** `apps/web` は `mc-worldgen` の生成データと、mc-render が所有する公開
meshing/render path を使う generated-world entrypoint である。`mc-meshing` への直接 import は
`.oxlintrc.json` + `pnpm lint` が境界として拒否し、meshing は mc-render 側に属する。
`apps/render-preview` は fixture-only で、`e2e/render-preview.e2e.ts` が fixture pixels を検証する。
generated-world の mining / persistence / chest paths は browser E2E で検証済みだが、画面全体の
pixel golden test を意味するものではない。

### 3.6 移植の内訳

参照実装の実測: 23 スペックファイル(`*.e2e.ts`)/ 70 テスト / 2,875 LOC、
加えてヘルパー・fixture 558 LOC。
ディレクトリ別の内訳は [porting.md](./porting.md) §1.3、
**70 本 1 本ずつの判定は [e2e-triage.md](./e2e-triage.md)**。

## 4. テストは「名前付き回帰」として書く

[design-notes.md](./design-notes.md) の各項目には**回帰テスト名**が付いている。

```typescript
// REGRESSION — THE reason this machine exists. plan.md §3.8:
// "参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった".
it.effect('has no edge from InGame straight to Title', ...)
```

コメントの `REGRESSION:` には**なぜそれが問題なのか**を書く。
「どう動くか」はコードが言うので、テストが言うべきは「壊れたときに何が起きるか」である。

## 5. 規範を検査するテスト

このリポジトリには、**振る舞いではなく規範**を検査するテストがある。

| テスト | 何を守るか |
| --- | --- |
| `the prime directive, as a surface check` | compose の公開面にゲームルール・entity・world を持ち込まないこと |
| `exports nothing that sounds like a game rule, an entity or a world` | 弱いが、追加のその場所に規範を置く |
| `pins the standard stage skeleton (plan.md §4.2)` | 順序表の**並び**の変更を必ず明示的な編集にする |
| `pins how each phase claims a stage, which is what makes the table load-bearing` | 順序表の**所属規則**を落とすと、並びを保ったまま表が効かなくなる([design-notes.md](./design-notes.md) DN-4.1) |
| `claims every stage id the roster actually registers` | 表がロスターの**実 id**を取りこぼしていないこと。取りこぼした stage は辞書順に流れる |
| `passes the delta through untouched` | 物理定数が合成層に来ない |
| `produces exactly the §4.2 order from the ids the roster really registers` | 順序表が**実在するロスター**に対して §4.2 を出すこと(DN-14) |
| `claims each registered id for the phase the owning repository documents` | stage の所有 repository と phase の対応を固定する |
| `reports no unrecognised stage: the table claims the whole roster` | ロスターの stage を順序表から落とさない |
| `drops nothing: no declared edge names a stage that is absent` | 宣言した依存 edge が存在しない stage を参照しない |
| `binds every cross-repository edge, and they all point at mc-sim` | リポジトリ間エッジ 5 本がすべて `sim:physics` を名指しし、すべて繋がっていること(DN-14) |
| `binding mc-sim's four edges did not move any other stage` | 宙に浮いていた 4 本が繋がってもフレームが動かないという、事前に固定してあった予測の答え合わせ(DN-14) |
| `without it, the frame breaks in exactly the ways no module may repair` | 骨格を外したとき残る破れが、体験モジュール境界をまたぐ = どのモジュールも `after` で言えないものだけであること |
| `states every repository that contributes no stage, so an absence is deliberate` | `ROSTER_REGISTERS_NOTHING` を含む roster の不在を明示する |
| `without the two network phases, both multiplayer stages run after the HUD` | 骨格に `multiplayer:` を拾うフェーズが無いと index 14/15 に落ちるという実測 = 2 フェーズを足した理由(DN-15) |
| `has no position at all as a single `multiplayer:` namespace phase` | 単一の名前空間フェーズは physics より前だと**循環**、後だと 1 フレーム遅れ。置ける位置が無い(DN-15) |
| `fails, by name, if any registered stage matches no phase and would run last` | フェーズに落ちない stage は保留ではなく最後尾で走る。**この失敗モードがこの一連の作業を生んだ** |
| `reserves the canonical id of every phase in the standard skeleton` | 順序表と `RESERVED_STAGE_PREFIXES` は互いを見られない 2 つの表であり、フェーズを 1 つ足すと予約から漏れる |

**これらが落ちたときは、実装ではなく設計判断が変わったということである。**
直すのではなく、まず「どのリポジトリがこれを所有するのか」を問い直す。

## 6. カバレッジ

`pnpm test:coverage` は V8 の statements / branches / functions / lines を計測し、
`vitest.config.ts` の 100% 閾値で検証する。CI は通常の `verify` と coverage を分離して実行する。

## 7. まだ書いていないテスト

| テスト | 前提 |
| --- | --- |
| 公開package横断の追加プレイヤー経路 | 所有packageの公開APIが揃った経路から追加する。§3.4 |
| 実モジュールの Layer 合成テスト | 対象packageが公開する Layer / `run` 契約 |
| stage 順序解決のプロパティテスト(任意の DAG で全順序が制約を満たす) | `effect/FastCheck`。`.npmrc` の hoist は用意済み |
| 参照実装 E2E の残りの NEEDS-BROWSER 群 | 所有packageの公開API + Playwright。[e2e-triage.md](./e2e-triage.md) |
