# テスト戦略

plan.md §3.15 検証:
> **E2E(参照実装の 64 本を移植)が最終ゲート。**
> 体験モジュール間の相互作用(採掘 → インベントリ反映等)はここでしか検証できない

(実測は 64 本ではなく **70 本**。[porting.md](./porting.md) §0)

## 1. 何をどこで検証するか

| レイヤ | 検証手段 | 現状 |
| --- | --- | --- |
| stage 全順序の解決 | 決定性・循環検出・dangling・フェーズ所属・skeleton 連鎖 | `test/stage-order.test.ts`(38 tests) |
| Layer 合成 + フレーム実行 | 解決順が**実際に実行を駆動する**こと | `test/composition.test.ts`(15 tests) |
| セッションライフサイクル | 状態機械。**2 周目**が最重要 | `test/session.test.ts`(15 tests) |
| QA API | 名前空間マージ・衝突拒否・インストール | `test/qa-api.test.ts`(15 tests) |
| Modding 入口 | 名前空間予約・一級モジュール性 | `test/modding.test.ts`(15 tests) |
| 公開 API + 規範 | バレルのピン留め + ゲームルール名の検査 + **フェーズ所属のピン留め** | `test/public-api.test.ts`(7 tests) |
| 依存境界 | ホワイトリスト・推移閉包・`Date.now()` 禁止 | `test/check-dependency-whitelist.test.ts`(44 tests) |
| **モジュール間相互作用** | **E2E** | **未実装**。§3 |

現在 **138 tests / 7 files**、`pnpm test` で 650ms 前後。

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

**E2E の本数が増え続けるなら、それは compose にロジックが溜まっている兆候である。**
参照実装で E2E が唯一の検証手段になったのは、ルールが合成層にあったからである
([design-notes.md](./design-notes.md) DN-0)。

### 3.3 E2E 環境の既知の制約(plan.md §3.10)

参照実装の E2E 環境から引き継ぐ知見:

- Playwright は **SwiftShader**(ソフトウェア GL)で走る
- **ヘッドレスではポインタロックが使えない** — 視点操作は QA API 経由で行う
- QA API のキーは `__NERIMA_GAMES_QA__`(参照実装の `__TS_MINECRAFT_QA__` ではない)。
  古い名前に固定された E2E が古いビルドに対して黙って通るのを防ぐため

### 3.4 移植の内訳

参照実装の実測: 23 スペックファイル(`*.e2e.ts`)/ 70 テスト / 2,875 LOC、
加えてヘルパー・fixture 558 LOC。
ディレクトリ別の内訳は [porting.md](./porting.md) §1.3。

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
| `claims every stage id the roster actually registers` | 表がロスターの実 id を取りこぼしていないこと。取りこぼした stage は辞書順に流れる |
| `passes the delta through untouched` | 物理定数が合成層に来ない |
| `records no edge between any two experience modules` | plan.md §2.3-1 |
| `never names mc-playground-kit as a runtime edge` | plan.md §2.3-2 |

**これらが落ちたときは、実装ではなく設計判断が変わったということである。**
直すのではなく、まず「どのリポジトリがこれを所有するのか」を問い直す。

## 6. カバレッジ

計測は常に動いている(`pnpm test:coverage`)が、**閾値は未設定**。
参照実装は 99% を強制しているが、スケルトンに閾値を課しても意味がない。
99% ゲートは完成条件到達時に `vitest.config.ts` と CI の両方で有効化する。

## 7. まだ書いていないテスト

| テスト | 前提 |
| --- | --- |
| **E2E スイート全体** | 合成できる中身(4 つの体験モジュール)ができてから |
| stage 順序解決のプロパティテスト(任意の DAG で全順序が制約を満たす) | `effect/FastCheck`。`.npmrc` の hoist は用意済み |
| 実モジュールの合成テスト | 各モジュール公開後 |
| セッションのティアダウン実測(fiber が本当に止まるか) | 実サービスが存在してから。**これは E2E マター** |
| ブラウザエントリポイントのスモーク | エントリポイント実装後 |
