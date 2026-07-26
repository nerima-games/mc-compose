# @nerima-games/mc-compose

## PRIME DIRECTIVE

> **このリポジトリに追加してよいコードは、Layer 合成と stage 順序表だけである。**
> それ以外はすべて、その振る舞いを所有するモジュールへ移す。

参照実装の合成層 `packages/app/application/` は **20,737 LOC**(本体のみ、実測)まで膨らみ、
そのおよそ 13k がゲームルールで、結果として **E2E でしか検証できなくなった**。
**それが本計画全体の出発点である**(plan.md §1, §3.15, §8)。

このリポジトリは、それを二度と起こさないために存在する。
**[docs/responsibility.md](./docs/responsibility.md) を実装前に必ず読むこと。**

## 責務

plan.md §3.15:

| 責務 | 実装 |
| --- | --- |
| **stage 全順序の解決**(唯一の所有者、§2.3-3) | `domain/stage-order.ts` |
| **stage 順序表**(§4.2。12 個の**フェーズ**の列) | `domain/stage-skeleton.ts` |
| **Layer マージ** | `domain/composition.ts` |
| セッションライフサイクル(タイトル ⇄ ゲーム) | `domain/session.ts` |
| QA / デバッグ API | `domain/qa-api.ts` |
| Modding 入口 | `domain/modding.ts` |
| **E2E**(最終ゲート) | 未実装 |

**ゲームルールは 1 行も持たない。**

## 依存

直接依存は 4 つの体験モジュール + mc-render:
mx-gameplay / mx-redstone / mx-ui / mx-multiplayer / mc-render
(加えて mc-kernel はどこからでも import 可)。

mc-render は縦切りスパイクが足した唯一の tier 2 エッジである。それ以前は
**ロスターの誰も mc-render を実行時依存に宣言しておらず**、結果として出荷ビルドには
入力 stage が 1 つも存在しなかった(唯一の入力 stage が開発時専用の mc-playground-kit にあった)。
経緯は [docs/architecture.md](./docs/architecture.md) §5。

**推移的には全リポジトリに到達する。だからこそ推移閉包の禁止がここで最も重要になる。**
`pnpm install` すると `node_modules` には mc-sim も mc-worldgen も物理的に置かれるが、
**import は禁止**であり `pnpm check:deps` が `transitive-import` として非ゼロ終了する。

これが規範の機械化された半分である。mc-sim を直接必要とするルールは、体験モジュールに属するルールである。

> **現状**: `package.json` の `dependencies` は `effect` のみ。
> mc-compose は依存順の最後尾であり、他の 15 リポジトリが publish されるまで書ける依存が無い
> (plan.md §6 Step 3)。依存契約は
> `scripts/check-dependency-whitelist.ts` の `REPOSITORY_POLICY` 側に宣言してある。
> 詳細は [docs/versioning.md](./docs/versioning.md) §3。

## ドキュメント

**[docs/](./docs/) に実装情報がある。実装前に読むこと。**

| ドキュメント | 内容 |
| --- | --- |
| [docs/README.md](./docs/README.md) | 索引と読む順番 |
| [docs/responsibility.md](./docs/responsibility.md) | **PRIME DIRECTIVE。必読** |
| [docs/architecture.md](./docs/architecture.md) | 4 階層、16 リポジトリ依存グラフ、mc-render 到達性の未解決問題 |
| [docs/public-api.md](./docs/public-api.md) | 公開 API と契約 |
| [docs/design-notes.md](./docs/design-notes.md) | 参照実装の実測知見(回帰テスト名付き)。**必読** |
| [docs/porting.md](./docs/porting.md) | 移植計画。LOC は実測値 |
| [docs/testing.md](./docs/testing.md) | テスト戦略。E2E が何を検証し、何を検証しないか |
| [docs/versioning.md](./docs/versioning.md) | 0.x → 1.0.0、GitHub Packages、modding API バージョン |

## 依存ルール(16 リポジトリ共通)

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない。依存は直接依存のみが import 許可を意味する |
| kernel は例外 | mc-kernel はどこからでも import 可 |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載されていなければならない |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。実行時依存になると、出荷ビルドから入力処理が消える |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

`scripts/check-dependency-whitelist.ts` は 16 リポジトリ共通のテンプレートである。
姉妹リポジトリへ移植する際は、ファイル冒頭で囲ってある `REPOSITORY_POLICY` 定数だけを書き換えればよい。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない(0.12.0 で実測確認済み)。

そのため禁止は **`scripts/check-dependency-whitelist.ts` 側で実装**している。
対象は `Date.now()` / `new Date()` / `performance.now()` の 3 つ。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。

Clock Port の実装アダプタ自身だけは実クロックを読む必要があるため、
その行に `mc-kernel-allow-time-source` コメントを付けると除外される。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0(`corepack` 推奨)を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint(このリポジトリ唯一の lint / format 設定)。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest(`@effect/vitest` の `it.effect` が主 API) |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測(閾値は未設定) |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[`docs/public-api.md`](./docs/public-api.md) §7） |
| `pnpm api:update` | `api-lock.md` を書き直す。公開面を変える PR は結果を同じ PR に含める |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容 |

## 現状

**このリポジトリはまだ叩き台(pre-audit first cut)である。**

確定している **仕組み**:

- stage 全順序は compose だけが解決する。決定論、循環は経路つきで報告、dangling は非致命
- 順序表は**フェーズの列**であり、stage id は名前部分(または名前空間)で所属を宣言する。
  モジュールは絶対位置を名乗れないまま、表が実際にエッジを出す
- skeleton の暗黙エッジは stage が入ったフェーズの間だけに張り、空のフェーズは鎖を閉じる。
  同じフェーズ内の順序はそのモジュール自身の `after` が決める
- Layer は `merge` であって `provide` ではない(モジュールは対等)
- `runFrame` は delta をクランプせず、try/catch も計測も条件分岐も持たない
- セッションは `InGame` から `Title` へ直行できない。ティアダウンは通過必須の状態
- QA コマンドは所有モジュールが名前空間ごと提供し、compose はマージするだけ
- mod は一級のモジュール。stage 名前空間だけが制約

確定していない:

- **4 つの体験モジュールの実合成**(全モジュール未公開)
- **mc-kernel の契約型への切り替え**。現在 `StageId` / `DeltaTimeSecs` / `GameModule` /
  `StageRegistration` / `WorldId` はローカル宣言のミラーである
- **E2E スイート**。合成できる中身がまだ無い
- **ブラウザエントリポイント**
- `ModuleLayer` の精密な型(現在 `Layer<any, any, any>`)
- **mc-render がどこから実行時に到達するか** — 宣言されたグラフの穴。
  [docs/architecture.md](./docs/architecture.md) §5
- ビルド / publish。`package.json` の `exports` は TypeScript ソースを直接指している
- カバレッジ閾値(99% ゲートは完成条件到達時に有効化)

## License

MIT
