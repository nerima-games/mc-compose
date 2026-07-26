# テスト戦略

plan.md §3.15 検証:
> **E2E(参照実装の 64 本を移植)が最終ゲート。**
> 体験モジュール間の相互作用(採掘 → インベントリ反映等)はここでしか検証できない

(実測は 64 本ではなく **70 本**。[porting.md](./porting.md) §0、per-test の triage は [e2e-triage.md](./e2e-triage.md))

## 1. 何をどこで検証するか

| レイヤ | 検証手段 | 現状 |
| --- | --- | --- |
| stage 全順序の解決 | 決定性・循環検出・dangling・フェーズ所属・skeleton 連鎖 | `test/stage-order.test.ts`(46 tests) |
| Layer 合成 + フレーム実行 | 解決順が**実際に実行を駆動する**こと | `test/composition.test.ts`(26 tests) |
| セッションライフサイクル | 状態機械。**2 周目**が最重要 | `test/session.test.ts`(15 tests) |
| QA API | 名前空間マージ・衝突拒否・インストール | `test/qa-api.test.ts`(15 tests) |
| Modding 入口 | 名前空間予約・一級モジュール性 | `test/modding.test.ts`(16 tests) |
| 公開 API + 規範 | バレルのピン留め + ゲームルール名の検査 + **フェーズ所属のピン留め** | `test/public-api.test.ts`(7 tests) |
| kernel ミラーの忠実性 | 公開時に差し替えられること | `test/kernel-mirror.test.ts`(7 tests) |
| 依存境界 | ホワイトリスト・推移閉包・`Date.now()` 禁止 | `test/check-dependency-whitelist.test.ts`(46 tests) |
| 公開 API ロック | スナップショット生成・差分描画 | `test/api-lock.test.ts`(26 tests) |
| **ロスター実在性ゲート** | 転記が兄弟リポジトリの実ソースと一致するか | `test/check-roster-manifest.test.ts`(19 tests) |
| **モジュール間相互作用 — フレーム側** | **E2E** | `test/e2e/roster-frame-order.test.ts`(18 tests)。§3 |
| **モジュール間相互作用 — 振る舞い側** | **E2E** | **未実装、かつ今日は実装できない**。§3.4 |

現在 **241 tests / 11 files**、`pnpm test` で 1.3〜1.6 秒。

## 2. 主 API は `@effect/vitest` の `it.effect`

純粋な検査でも `Effect.sync(() => { ... })` で包む。
Effect ランタイム上で走ることを既定にしておくと、後から Layer や fiber が必要になったときに
テストの書き換えが要らない。

> **例外**(参照実装で確立、plan.md §3.13): DOM イベントフローのテストで
> `Effect.fork` + `Deferred.await` を `it.effect` の中に書くとデッドロックする。
> その場合はプレーンな `it` + `Effect.runPromise` を使う。
> compose がブラウザエントリポイントを持つ日に必要になる。

## 3. E2E — 最終ゲート、かつ**それ以外の何かにしない**

### 3.1 E2E が検証するもの

**モジュール間の相互作用でしか壊れないものだけ。**

| 例 | なぜ E2E でしか見えないか |
| --- | --- |
| **13 本の stage が plan.md §4.2 の 1 本の全順序になる** | 4 リポジトリが互いを知らないまま宣言した id と `after` が、どう合成されるか。**これは今日検証できる**(§3.4) |
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

### 3.4 **今の E2E が検証していること / していないこと**

plan.md §3.15 の主張には**半分が 2 つある**。それを混ぜないことが、この節の目的である。

| 半分 | 内容 | 現状 |
| --- | --- | --- |
| **(a) フレーム** | 13 本の stage が 1 本の全順序になる。どの id が、どのフェーズに入り、どの順で走るか | **検証済み**。`test/e2e/roster-frame-order.test.ts` |
| **(b) 振る舞い** | 「採掘したらインベントリに入る」 | **未検証。今日は検証できない** |

**(b) が今日できない理由は「まだ書いていない」ではない。**

- plan.md §6 Step 3 の publish は bottom-up で、**1 つも公開されていない**。
  mc-compose の `package.json#dependencies` は `effect` のみ、
  `node_modules` に `@nerima-games/*` は 1 つも無い(兄弟リポジトリも全部同じ)。
- したがって `import { gameplayModule } from '@nerima-games/mx-gameplay'` は書けない。
- そして偽物のモジュールを 4 つ作って合成すれば、**検証されるのは偽物**である。
  `test/composition.test.ts` が合成アルゴリズムの検証のために意図的にそれをやっており、
  同じことを E2E と名乗ってもう一度やるのは、後ろに何も無い緑のランプにしかならない。

**(a) が今日できる理由**は、id と `after` が**振る舞いではなく宣言**だからである。
兄弟リポジトリの `stages/stage-ids.ts` と `stages/registration.ts` から読み出せて、
それが §4.2 のフレームに合成されるかどうかは、**どの 1 リポジトリにも答えられない**。
mx-gameplay は mc-render の stage を見られないし、mc-render は自分がフレームのどこで走るかを
知ることを禁じられている(plan.md §2.3-3)。それがまさに compose の問いである。

したがって現在の E2E の主語は `test/e2e/roster.ts` —
**兄弟リポジトリが実際に登録している 13 本の id と 12 本の `after` エッジを、
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
並んでいた。**この 6 本はどれも誰も登録していない。**
mc-render が登録するのは `render:input` / `render:camera-mirror` / `render:chunk-sync` /
`render:draw` / `render:post-fx` であり、mc-sim は 1 本も登録していない。
それでもテストは通っていた — 架空の id が偶然、本物と同じフェーズに入るからである。
**正しい性質を、存在しない世界について主張して、ずっと緑だった。**

対処は 2 層である。

| ゲート | 何を見るか | `pnpm verify` に入るか |
| --- | --- | --- |
| `pnpm e2e`(= `vitest run test/e2e`) | マニフェストが §4.2 のフレームに合成されるか | **入る**。`effect` と自分の `domain/` しか要らない純粋なテストで、`pnpm test` のグロブが既に拾う |
| `pnpm check:roster` | マニフェストが兄弟リポジトリの**実ソース**と一致するか(id・`after`・`file:line` の 26 箇所すべて) | **入らない**。兄弟リポジトリのチェックアウトが要る |

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
| `rejects reaching past the experience modules to mc-sim, and names the path` | prime directive の機械化された半分 |
| `cannot reach mc-render or mc-meshing at all` | グラフの穴をピン留め([architecture.md](./architecture.md) §5) |
| `exports nothing that sounds like a game rule, an entity or a world` | 弱いが、追加のその場所に規範を置く |
| `pins the standard stage skeleton (plan.md §4.2)` | 順序表の**並び**の変更を必ず明示的な編集にする |
| `pins how each phase claims a stage, which is what makes the table load-bearing` | 順序表の**所属規則**を落とすと、並びを保ったまま表が効かなくなる([design-notes.md](./design-notes.md) DN-4.1) |
| `claims every stage id the roster actually registers` | 表がロスターの**実 id**を取りこぼしていないこと。取りこぼした stage は辞書順に流れる |
| `passes the delta through untouched` | 物理定数が合成層に来ない |
| `records no edge between any two experience modules` | plan.md §2.3-1 |
| `never names mc-playground-kit as a runtime edge` | plan.md §2.3-2 |
| `produces exactly the §4.2 order from the ids the roster really registers` | 順序表が**実在するロスター**に対して §4.2 を出すこと(DN-14) |
| `leaves the skeleton as the ONLY thing ordering one repository against another` | ロスターのリポジトリ間エッジが 4 本とも dangling であるという実測(DN-14) |
| `stays consistent with §4.2 once mc-sim registers sim:physics` | その 4 本が繋がった日にフレームが動かないこと |
| `fails loudly the day mc-sim registers sim:physics` | 上の前提が変わったことをマニフェスト側で検出する |
| `would schedule a multiplayer stage after the HUD, and says so` | 骨格に `multiplayer:` を拾うフェーズが無いという実測(DN-15) |
| `reserves the canonical id of every phase in the standard skeleton` | 順序表と `RESERVED_STAGE_PREFIXES` は互いを見られない 2 つの表であり、フェーズを 1 つ足すと予約から漏れる |

**これらが落ちたときは、実装ではなく設計判断が変わったということである。**
直すのではなく、まず「どのリポジトリがこれを所有するのか」を問い直す。

## 6. カバレッジ

計測は常に動いている(`pnpm test:coverage`)が、**閾値は未設定**。
参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
99% ゲートは完成条件到達時に `vitest.config.ts` と CI の両方で有効化する。

## 7. まだ書いていないテスト

| テスト | 前提 |
| --- | --- |
| **E2E の (b) 側 — 振る舞いの相互作用** | mc-sim と 4 体験モジュールの publish。§3.4 |
| 実モジュールの合成テスト(本物の Layer / 本物の `run`) | 同上 |
| stage 順序解決のプロパティテスト(任意の DAG で全順序が制約を満たす) | `effect/FastCheck`。`.npmrc` の hoist は用意済み |
| セッションのティアダウン実測(fiber が本当に止まるか) | 実サービスが存在してから。**これは E2E マター** |
| ブラウザエントリポイントのスモーク | エントリポイント実装後 |
| 参照実装 E2E の NEEDS-BROWSER 群 | ブラウザエントリポイント + Playwright。[e2e-triage.md](./e2e-triage.md) |
