# バージョニングと公開

## 1. 現在地

- **package version**: `0.1.0`
- **公開状態**: **未公開。** ビルド / publish パイプラインはまだ存在しない
- **`package.json#exports`**: TypeScript ソースを直接指している(`./index.ts`)

## 2. なぜ公開しないのか(plan.md §6 Step 0 / Step 3)

plan.md §6 Step 0 item 2:
> 開発中は `workspace:*` 解決でモノレポ同等の DX。
> **npm 公開・バージョン bump 運用は界面安定(4 週間 API ロック無変更)まで開始しない**

plan.md §8 のリスク表:
> 新規構築初期は全界面が高 churn → npm 公開を遅らせ dev-meta workspace で開発。bump 連鎖を構造的に回避

16 リポジトリが相互に依存する状態で早期に publish を始めると、
mc-kernel の 1 行変更が 15 リポジトリの bump 連鎖を引き起こす。
それを構造的に避けるため、開発中は `@nerima-games/mc-dev-meta` が
15 リポジトリを 1 つの pnpm workspace に束ね、`workspace:*` で解決する。

## 3. `dependencies` に依存先が 1 つも無い理由

mc-compose の実行時依存は mx-gameplay / mx-redstone / mx-ui / mx-multiplayer / mc-render である。
にもかかわらず `package.json` には `effect` しか無い。

理由は **ボトムアップの publish-then-pin** である:

1. 依存順(kernel → noise/meshing/physics/save/audio → worldgen → sim → render → kit →
   gameplay/redstone → ui → multiplayer → **compose**)に完成させる
2. 完成した層から publish する
3. 下流はそこで初めて**公開済みバージョンを pin** する

**mc-compose はこの順序の最後尾である。** つまり他の 15 リポジトリすべてが
少なくとも 1 回は publish されるまで、ここに書ける `dependencies` は存在しない。

**ポリシー側(`scripts/check-dependency-whitelist.ts` の `REPOSITORY_POLICY`)には
5 つとも既に宣言してある**ので、契約は最初から機械可読な形で存在する。
`package.json` があとから追いつく。

## 4. 0.x の間の約束

| 項目 | 約束 |
| --- | --- |
| 公開 API | **破壊的変更を予告なく入れてよい。** 0.x とはそういう意味である |
| バージョン | 変更のたびに patch/minor を上げるが、semver の保証はしない |
| **`STANDARD_STAGE_SKELETON`** | **変更には PR に理由の記述が要る。** 0.x でもこれは守る。フェーズの**並び**だけでなく、各フェーズの `members`(どの stage id がそこに落ちるか)も同じ扱いである — `members` を落とすと並びを保ったまま表が効かなくなる([design-notes.md](./design-notes.md) DN-4.1) |
| `MODDING_API_VERSION` | 1 のまま。mod の互換性保証は**開始していない** |
| ドキュメント | `docs/` は実装と同時に更新する。ここも 0.x でも守る |

## 5. 1.0.0 の条件

以下がすべて満たされたとき 1.0.0 にする。

1. **4 つの体験モジュールと mc-render を実際に合成し、動くゲームが起動する**
2. **E2E が最終ゲートとして動いている**([testing.md](./testing.md) §3)。
   参照実装の 70 本のうち、モジュール間相互作用を検証するものが移植済み
3. **API ロック 4 週間無変更**(plan.md §6 Step 3)。
   ロックファイルは実装済みで、計測の起点は `api-lock.md` が最後に変わったコミットである
   ([public-api.md](./public-api.md) §7)
4. **本体 LOC が 2,000 を超えていない**([porting.md](./porting.md) §2)。
   超えていたら、超えた分がどのモジュールに属するかを先に決める
5. **ビルド / publish パイプラインが存在する**(§7)
6. **カバレッジ 99% ゲートが有効**

条件 4 は他のリポジトリには無い。**このリポジトリだけは「小さいこと」が完成条件である。**

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
