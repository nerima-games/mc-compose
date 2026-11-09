# バージョニングと公開

## 1. 現在地

- **package version**: `0.2.13`
- **Browser build**: owned by [mc-host-web](https://github.com/nerima-games/mc-host-web) ([migration PR #8](https://github.com/nerima-games/mc-host-web/pull/8))
- **`package.json#exports`**: TypeScript ソースを直接指している(`./src/index.ts`)
- **公開状態**: この checkout からの publish 結果は未確認。publish workflow も未配置

## 2. 初期計画との関係

初期計画(plan.md §6 Step 0 / Step 3)には、界面安定まで npm 公開と version bump を遅らせ、
`@nerima-games/mc-dev-meta` の `workspace:*` 解決で開発する方針があった。

plan.md §6 Step 0 item 2 の原文は次のとおりである:
> 開発中は `workspace:*` 解決でモノレポ同等の DX。
> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**

plan.md §8 のリスク表も、初期段階では次の理由で publish を遅らせるとしていた:
> 新規構築初期は全界面が高 churn → npm 公開を遅らせ dev-meta workspace で開発。bump 連鎖を構造的に回避

現在の mc-compose はこの初期状態から進み、公開済み sibling package の固定版を
`package.json` と lockfile で解決している。初期計画の「未公開なので依存先が無い」という説明は、
現在の実装状態の説明としては使わない。

## 3. dependencies と互換性パッチ

mc-compose は `package.json#dependencies` に次の sibling package を直接 pin している:

- `mc-kernel`, `mc-render`, `mc-save`, `mc-sim`, `mc-worldgen`
- `mx-gameplay`, `mx-multiplayer`, `mx-redstone`, `mx-ui`

`effect` も直接依存し、`pnpm-lock.yaml` はこれらの解決結果を固定する。`mc-audio` は
`mx-gameplay` と `mx-ui`、`mc-physics` は `mc-sim` から推移的に解決されるが、Compose の
直接依存ではない。`mc-playground-kit` とブラウザ build は [mc-host-web](https://github.com/nerima-games/mc-host-web)
([PR #8](https://github.com/nerima-games/mc-host-web/pull/8)) が所有する。

この checkout では sibling package 向けの pnpm patch を適用していない。以前 `patches/` に
あった `@types/three` patch はブラウザ app 用であり、Compose から削除した。mc-host-web は
自分のブラウザ依存に対応する patch を管理する。

`pnpm install --frozen-lockfile` が単独 checkout でこの境界を再現する検証手段であり、
兄弟リポジトリの source alias や `workspace:*` を runtime 解決には使わない。

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

1. **4 つの体験モジュールと mc-render を実際に合成し、動くゲームが起動する**
2. **E2E が最終ゲートとして動いている**([testing.md](./testing.md) §3)。
   参照実装の 70 本のうち、モジュール間相互作用を検証するものが移植済み
3. **本体 LOC が 2,000 を超えていない**([porting.md](./porting.md) §2)。
   超えていたら、超えた分がどのモジュールに属するかを先に決める
4. **ビルド / publish パイプラインが存在する**(§7)
5. **カバレッジ 4 指標 100% ゲートが有効**

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

## 7. ビルドと publish

The browser bundle moved to [mc-host-web](https://github.com/nerima-games/mc-host-web) in
[PR #8](https://github.com/nerima-games/mc-host-web/pull/8). `tsconfig.base.json` remains `noEmit: true`,
and TypeScript package `.d.ts` / ESM emit is not configured here.

現在このリポジトリで未確認・未配置なのは次の項目である:

- `.d.ts` + ESM を出す emit 用 tsconfig
- `package.json#exports` を `./dist/index.js` / `./dist/index.d.ts` に切り替え
- GitHub Packages(`https://npm.pkg.github.com`)への publish ワークフロー
- publish 用の versioning / changeset 運用
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
