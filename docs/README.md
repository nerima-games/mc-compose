# mc-compose ドキュメント索引

`@nerima-games/mc-compose` の実装情報はここに集約する。

## 表記

| 表記 | 意味 |
| --- | --- |
| `<reference-impl>` | **参照実装のチェックアウトのルート**。凍結された `takeokunn/ts-minecraft` の作業コピーを指す。本ドキュメント群では `<reference-impl>/packages/…` の形か、単に `packages/…`（同じくルート相対）で引用する。手元のどこに clone してあっても読み替えられるようにするためのプレースホルダである |
| plan.md | リポジトリ構成仕様書（16 リポジトリ、確定済み）。**非公開**であり、公開読者は開けない。だから本ドキュメント群は「plan.md を読まなくても追える」ことを要件にしている —— plan.md の主張を引くときは必ず原文を引用し、参照実装での裏づけを file:line で添える |
| `nerima-games/<repo>` | 同 org の兄弟リポジトリ。リンクは GitHub の URL で張る |

## 0. 最初に読むこと

> **このリポジトリに追加してよいコードは、Layer 合成と stage 順序表だけである。**

参照実装の合成層 `packages/app/application/` は **20,737 LOC**(本体のみ、実測)まで膨らみ、
E2E でしか検証できなくなった。**それが本計画全体の出発点である**(plan.md §1, §3.15, §8)。

このリポジトリは、それを二度と起こさないために存在する。
詳細は [responsibility.md](./responsibility.md) — **実装前に必ず読む**。

## 1. 索引

| ドキュメント | 内容 | 主な読者 |
| --- | --- | --- |
| [responsibility.md](./responsibility.md) | **PRIME DIRECTIVE。** 持つもの / 持たないもの / 規範の機械的強制 | **全員。最初に読む** |
| [architecture.md](./architecture.md) | 4 階層アーキテクチャ、16 リポジトリ依存グラフ、本リポジトリの位置、名詞/動詞ルール、mc-playground-kit の devDependency 専用ルール、**mc-render 到達性の未解決問題** | 全員 |
| [public-api.md](./public-api.md) | 公開 API 一覧と、それぞれの契約 | mod 作者・実装者 |
| [design-notes.md](./design-notes.md) | 参照実装の実測知見。各項目が「名前付き回帰テスト」として書かれている | 実装者。**実装前に必読** |
| [porting.md](./porting.md) | 移植計画。**LOC は実測値**(plan.md の見積りは 22 倍ずれている) | 実装者 |
| [testing.md](./testing.md) | テスト戦略。E2E が**今日どちらの半分を検証していて、どちらをしていないか**(§3.4) | 実装者・レビュアー |
| [e2e-triage.md](./e2e-triage.md) | **参照実装 E2E 70 本を 1 本ずつ判定したもの。** compose に残る 25 本 / 降ろす 43 本 / 消える 2 本。「採掘 → インベントリ」が今日繋がらない理由を 3 つに分けて記録している(§4) | 実装者。E2E に着手するとき |
| [versioning.md](./versioning.md) | 0.x → 1.0.0、GitHub Packages、modding API バージョン | リリース担当 |

## 2. 読む順番

1. **responsibility.md** — 何を書いてよくて、何を書いてはいけないか
2. **architecture.md** — グラフ上の位置と、推移閉包禁止がなぜここで最も効くか
3. **design-notes.md** — 参照実装で実際に起きたことと、その回帰テスト
4. **public-api.md** — 中核である `resolveStageOrder` の契約
5. **porting.md** — 実際に移植を始めるとき

## 3. このリポジトリの中核 2 ファイル

| ファイル | 役割 |
| --- | --- |
| `domain/stage-order.ts` | **stage 全順序の解決器。** 決定論・循環検出・dangling 報告 |
| `domain/stage-skeleton.ts` | **stage 順序表**(plan.md §4.2)。12 個の**フェーズ**の列。**この配列を変えるとゲームが変わる** |

他の 4 ファイル(`composition.ts` / `session.ts` / `qa-api.ts` / `modding.ts`)は、
plan.md §3.15 が compose に割り当てた残りの責務である。

## 4. 現状

このリポジトリは **叩き台(pre-audit first cut)** である。

**確定している**(仕組みとして):

- stage 全順序は compose だけが解決する。決定論、循環は経路つきで報告、dangling は非致命
- 順序表は**フェーズの列**。stage id は名前部分(または名前空間)で所属を宣言し、絶対位置は名乗れない
- skeleton の暗黙エッジは stage が入ったフェーズの間だけに張り、空のフェーズは鎖を閉じる
- Layer は `merge` であって `provide` ではない(モジュールは対等)
- `runFrame` は delta をクランプせず、try/catch も計測も条件分岐も持たない
- セッションは `InGame` から `Title` へ直行できない。ティアダウンは通過必須の状態
- QA コマンドは所有モジュールが名前空間ごと提供し、compose はマージするだけ
- mod は一級のモジュール。stage 名前空間だけが制約

**確定していない**:

- 4 つの体験モジュールの実合成(全モジュール未公開)
- mc-kernel の契約型への切り替え(現在はローカル宣言のミラー)
- **E2E の振る舞い側**(「採掘 → インベントリ」)。フレーム側は `test/e2e/` に実装済みで、
  半分ずつの区別は [testing.md](./testing.md) §3.4、繋がらない理由は
  [e2e-triage.md](./e2e-triage.md) §4
- ブラウザエントリポイント
- `ModuleLayer` の精密な型(現在 `Layer<any, any, any>`)
- **`sim:physics` を誰が登録するのか**([design-notes.md](./design-notes.md) DN-14)
- **ネットワーク同期のフェーズを骨格のどこに置くか**(同 DN-15)
- **`InventoryService` のインスタンスを誰が構築するのか**([e2e-triage.md](./e2e-triage.md) §4.3)
