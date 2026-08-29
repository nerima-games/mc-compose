# バージョニングと公開

## 1. 現在地

- **package version**: `package.json#version` を唯一の値とする
- **実行時依存**: `package.json#dependencies` に公開済みの `mc-*` / `mx-*` 契約を直接宣言し、lockfile で固定している
- **`package.json#exports`**: TypeScript ソース(`./src/index.ts`)を指している。リポジトリの主用途はブラウザ／サーバーの composition runtime である
- **公開自動化**: CI は型・lint・テスト・ブラウザ検証を行うが、npm publish workflow はまだ定義していない

## 2. 依存先を直接宣言する理由

現在の composition layer は、依存元が公開している API を直接利用する。実行時の主な依存は
`mc-kernel`、`mc-sim`、`mc-worldgen`、`mc-render`、`mx-gameplay`、`mx-ui`、
`mx-multiplayer` などであり、アプリ側に同等の型・サービスを複製しない。

各依存は `package.json` の明示的なバージョンと `pnpm-lock.yaml` で再現可能にする。
ローカル開発時の同一パッケージ解決は `pnpm-workspace.yaml#overrides` に限定し、
`workspace:*` の互換 shim やアプリ内ミラーは追加しない。

旧来の `check:deps`／whitelist 方針はこの直接依存モデルに置き換えた。低レベル実装への
誤った依存は `.oxlintrc.json` と `pnpm lint` で検出し、公開パッケージの境界は
`test/public-api.test.ts` と実際の typecheck で検証する。

## 3. 過去の workspace 方針

初期計画では、依存先が未公開だった期間に `mc-dev-meta` と `workspace:*` で複数
リポジトリを束ねる案を採用していた。このリポジトリの現行構成はその前提から移行済みであり、
現在の判断基準は公開パッケージの API、manifest、lockfile、実行時の検証である。

## 4. 0.x の間の約束

| 項目 | 約束 |
| --- | --- |
| 公開 API | **破壊的変更を予告なく入れてよい。** 0.x とはそういう意味である |
| バージョン | 変更のたびに patch/minor を上げるが、semver の保証はしない |
| **`STANDARD_STAGE_SKELETON`** | **変更には PR に理由の記述が要る。** 0.x でもこれは守る。フェーズの**並び**だけでなく、各フェーズの `members`(どの stage id がそこに落ちるか)も同じ扱いである — `members` を落とすと並びを保ったまま表が効かなくなる([design-notes.md](./design-notes.md) DN-4.1) |
| `MODDING_API_VERSION` | 1 のまま。mod の互換性保証は**開始していない** |
| ドキュメント | `docs/` は実装と同時に更新する。ここも 0.x でも守る |

## 5. 1.0.0 の条件

**旧・日数計測ベースの自動凍結ゲート(「API ロック 4 週間無変更」)は廃止した。**
`api-lock.md` / `scripts/api-lock.ts` 自体が org 標準から削除されており
([API_STANDARD.md §4](../../.github/API_STANDARD.md#4-自動-apiロックスナップショットツールは使わない))、
1.0.0 への昇格は代替の自動ゲートを設けず、**maintainer(take)の裁量判断のみ**で行う
([RELEASE_STANDARD.md §4.2](../../.github/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断))。
以下は昇格を検討する際に maintainer が見る観点であり、自動判定される条件の列挙ではない。

1. **公開された `mc-*` / `mx-*` の実行時サービスと `mc-render` を実際に合成し、動くゲームが起動する**
2. **E2E が最終ゲートとして動いている**([testing.md](./testing.md) §3)。
   参照実装の 70 本のうち、モジュール間相互作用を検証するものが移植済み
3. **本体 LOC が 2,000 を超えていない**([porting.md](./porting.md) §2)。
   超えていたら、超えた分がどのモジュールに属するかを先に決める
4. **ビルド / publish パイプラインが存在する**(§7)
5. **カバレッジ 99% ゲートが有効**

条件 3 は他のリポジトリには無い。**このリポジトリだけは「小さいこと」が完成条件である。**

## 6. mc-compose は publish されるのか

**未決。** plan.md §9「未決事項」にも
「compose リポジトリの名称(既存 `ts-minecraft` を引き継ぐか新名称か)」が残っている。

compose を npm パッケージとして publish する意味は、他の 2 つとは異なる:

- mx-multiplayer / mc-kernel は**他のリポジトリが import する**ので publish に意味がある
- mc-compose を import するものは**存在しない**(グラフの頂点)

publish する理由があるとすれば:

1. **mod 作者が `GameModule` / `StageRegistration` / `modStageId` を使う。**
   これは実在する理由である
2. デプロイ成果物のバージョン管理

`publishConfig` は他のリポジトリと同じ設定にしてあり、
実際に publish するかどうかは完成条件到達時に決める。
**mod API のためだけなら、mod 向け型を別パッケージに切り出す選択肢もある**
— そのほうが「mod 作者が合成層の内部に触れられる」問題を避けられる。

## 7. ビルドと publish(完成時に追加する)

現在 `tsconfig.base.json` は `noEmit: true` であり、**すべての tsconfig は検査専用**である。
完成条件を満たした時点で以下を追加する:

- `.d.ts` + ESM を出す emit 用 tsconfig
- ブラウザ向けバンドル(compose は最終的にアプリケーションでもある)
- `package.json#exports` を `./dist/index.js` / `./dist/index.d.ts` に切り替え
- GitHub Packages(`https://npm.pkg.github.com`)への publish ワークフロー
  — `publishConfig` は既に設定済み
- changesets 運用(plan.md §6 Step 3)

## 8. `MODDING_API_VERSION` は package バージョンと別物

| | 何を表すか | 誰が困るか |
| --- | --- | --- |
| `version`(package.json) | この npm パッケージの API の互換性 | このパッケージを import する開発者 |
| `MODDING_API_VERSION` | **mod 契約の互換性** | サードパーティの mod 作者 |

`MODDING_API_VERSION` を上げると、既存の mod は `UnsupportedApiVersion` で拒否される。
これは意図した挙動である — 黙って壊れた mod をロードするより、
「このビルドには対応していない」と言うほうがよい。

`RESERVED_STAGE_PREFIXES` の変更も mod 破壊的変更である。
予約を**増やす**と、既存 mod の stage 名が違反になりうる。
