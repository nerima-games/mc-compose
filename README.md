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
| **stage 全順序の解決**(唯一の所有者、§2.3-3) | `src/domain/stage-order.ts` |
| **stage 順序表**(§4.2 + ネットワーク 2 フェーズ。14 個の**フェーズ**の列) | `src/domain/stage-skeleton.ts` |
| **Layer マージ** | `src/domain/composition.ts` |
| セッションライフサイクル(タイトル ⇄ ゲーム) | `src/domain/session.ts` |
| QA / デバッグ API | `src/domain/qa-api.ts` |
| Modding 入口 | `src/domain/modding.ts` |
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
`pnpm install` すると `node_modules` には mc-noise / mc-meshing / mc-physics も物理的に置かれるが、
**import は禁止**であり、規範としては `.oxlintrc.json`(旧 `oxlint.json`。oxlint はドット付きの
`.oxlintrc.json` しか自動検出しないため、以前の PR でファイル名を訂正した)の
`no-restricted-imports`(Tier4 の 2 パターン)がその import を検出して `pnpm lint` を落とす。
**oxlint はこの PR から package.json の devDependency ではなく Nix の devShell(`flake.nix`)提供**
になっており(このリポジトリが以前固定していた `^0.12.0` は `no-restricted-imports` を一切実装して
いなかった)、この機構は**このリポジトリで初めて機械的に効くようになった**: Nix 提供の oxlint
(nixpkgs、この PR の時点で ~1.73)は `.oxlintrc.json` を `-c` なしで自動検出し、
`no-restricted-imports` も実装している。実測確認済み ──
`@nerima-games/mc-playground-kit` を import するファイルに対して実際に
`eslint(no-restricted-imports)` が発火し、`pnpm lint`(`nix develop --command pnpm lint`)が
非ゼロで落ちる。

これが規範の機械化された半分である。mc-sim を直接必要とするルールは、体験モジュールに属するルールである。

> **現状**: `package.json` の `dependencies` は org 標準の Tier4 グラフと一致しており、
> mc-audio / mc-render / mc-save / mc-sim / mc-worldgen / mx-gameplay / mx-redstone / mx-ui /
> mx-multiplayer(+ どこからでも import 可能な mc-kernel)を宣言している。
> 依存契約(誰が誰に依存してよいか)は org リポジトリ `.github` の
> [`DEPENDENCY_POLICY.md`](https://github.com/nerima-games/.github/blob/main/DEPENDENCY_POLICY.md)
> に一本化されている。詳細は [docs/versioning.md](./docs/versioning.md) §3。

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
| [docs/testing.md](./docs/testing.md) | テスト戦略。E2E が**今日どちらの半分を検証していて、どちらをしていないか** |
| [docs/e2e-triage.md](./docs/e2e-triage.md) | **参照実装 E2E 70 本の 1 本ずつの判定。** compose に 25 本 / 降ろす 43 本 / 消える 2 本 |
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

正典は org リポジトリ `.github` の `DEPENDENCY_POLICY.md`。実効機構(の設計)は各リポジトリの
`.oxlintrc.json` の `no-restricted-imports` であり(このリポジトリの分は本ファイル内の
Tier4 向けパターンを参照)、内容は Tier ごと・リポジトリごとに異なってよい
(byte-identical は適合条件ではない)。旧 `scripts/check-dependency-whitelist.ts`(16 リポジトリ
byte-for-byte テンプレート + `REPOSITORY_POLICY` 定数の差し替え方式)は org 標準から廃止済み。
**oxlint が Nix 提供になったこの PR から、上記「実効機構」は実際に機能する**(理由は前節、および
`.oxlintrc.json` 内のコメント)。`no-restricted-globals`(下記)も同様に、この PR から初めて発火する
ようになった。

### `Date.now()` 禁止について

Nix 提供の oxlint(この PR の時点で ~1.73)は `no-restricted-syntax` も `no-restricted-properties` も
まだ実装していない(`oxlint --rules` に存在しない)。`no-restricted-globals` は実装されており
(`name` などのグローバルに対して実測で発火することを確認済み)、`Date.now()` はグローバル関数呼び出し
であって bare global 参照ではないため、この禁止の対象には引き続きならない。

以前はこの禁止を `scripts/check-dependency-whitelist.ts` 側で実装していたが、そのスクリプト自体が
org 標準から廃止された。PACKAGE_STANDARD.md はこの種の(oxlint で表現できない)チェックの
代替スクリプトを置くかどうかを各リポジトリの裁量とし、org 標準としては要求していない。
**現在このリポジトリに `Date.now()` / `performance.now()` を禁止するツールは無い** —
時刻は注入された Clock Port から取得する規約自体は変わっていないが、機械的な検査は
oxlint が `no-restricted-syntax` 相当を実装するまで存在しない(`.oxlintrc.json` のコメント参照)。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack + oxlint が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0(`corepack` 推奨)を用意する。ただし
**oxlint は package.json の devDependency ではない**ので、Nix なしでは `pnpm lint` を動かす
`oxlint` バイナリ自体が無い ── 別途 `oxlint` を自分で用意するか、Nix 経由(`nix develop --command
pnpm lint`)で実行すること。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` と `tsconfig.test.json` の両方を型検査 |
| `pnpm lint` | oxlint(このリポジトリ唯一の lint / format 設定。Nix 提供、`package.json` の devDependency ではない ── `direnv allow` 済みなら素の `pnpm lint`、そうでなければ `nix develop --command pnpm lint`。CI も後者)。**`--deny-warnings` 付きで走る**ため `warn` のルールもビルドを落とす設計で、`.oxlintrc.json` はこの PR から `-c` なしで実際に読み込まれる(前節「依存ルール」参照)。**その結果、このリポジトリで初めて実測した現在のベースラインは非ゼロ(数千件規模の warning)** ── oxlint 0.12.0 時代は設定自体が読まれておらず実質何も検査していなかったので、これは新規の後退ではなく「これまで一度も測っていなかった実数が初めて見えた」もの。個々の警告を消す作業はこの PR のスコープ外 |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest(`@effect/vitest` の `it.effect` が主 API) |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測 + 4 指標 99% ゲート。`verify` には含まれない別ゲート(TEST_STANDARD.md §1/§3) |
| `pnpm e2e` | E2E だけを走らせる(`vitest run test/e2e`)。純粋なので `pnpm test` も `pnpm verify` も既に拾っている |
| `pnpm check:roster` | `test/e2e/roster.ts` の転記が兄弟リポジトリの実ソースと一致するかを照合。**`verify` に入っていない** — 兄弟のチェックアウトが要り、CI には無いため([docs/testing.md](./docs/testing.md) §3.5) |
| `pnpm typecheck:preview` | `apps/` と `e2e/` が型として通るか(`tsconfig.preview.json`)。**`verify` に入っていない** — 同上、兄弟のチェックアウトが要る |
| `pnpm changeset` | ユーザー向け変更に `.changeset/*.md` を追加する(RELEASE_STANDARD.md §1) |
| `pnpm verify` | `typecheck && lint && test`。CI と同じ内容 |

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
- **ロスターの実 id 16 本(6 リポジトリ)が §4.2 のフレームに合成される**ことは検証済み
  (`test/e2e/`、[docs/testing.md](./docs/testing.md) §3.4)

ロスターについて**測って分かったこと**([docs/design-notes.md](./docs/design-notes.md) DN-14 / DN-15):

- リポジトリ境界をまたぐ `after` エッジは全ロスターで **5 本しか無く、5 本とも `sim:physics`
  を名指ししている**。かつてはその `sim:physics` を誰も登録しておらず 4 本とも宙に浮いていた。
  mc-sim が登録して**全部繋がり、しかしフレームは 1 本も動かなかった** — 骨格が既に同じ順序を
  与えていたからで、その一致は宙に浮いている間は**確かめようが無かった**(DN-14)
- 骨格の 12 フェーズに **`multiplayer:` を拾うものが無かった**。mx-multiplayer が
  `multiplayer:inbound` / `multiplayer:outbound` を登録した日、予測どおり **index 14, 15 =
  HUD の後ろ**で走った。対処として骨格に `network:inbound` / `network:outbound` を追加した。
  これは **plan.md §4.2 の拡張であって転記ではない** — §4.2 はネットワークに触れていない
  ([docs/architecture.md](./docs/architecture.md) §4.5、DN-15)

確定していない:

- **4 つの体験モジュールの実合成**(全モジュール未公開)
- **mc-kernel の契約型への切り替え**。現在 `StageId` / `DeltaTimeSecs` / `GameModule` /
  `StageRegistration` / `WorldId` はローカル宣言のミラーである
- **E2E の振る舞い側**(「採掘 → インベントリ」)。合成できる中身がまだ無い。
  フレーム側は済んでいる — 半分ずつの区別は [docs/testing.md](./docs/testing.md) §3.4
- **ブラウザエントリポイント**
- `ModuleLayer` の精密な型(現在 `Layer<any, any, any>`)
- **mc-sim の `GameModule` を誰がホストに渡すのか**。mc-sim は `sim:physics` を登録したが、
  mc-compose は mc-sim を import できない(rule 3)。stage を登録することと import 可能で
  あることは別の性質である([docs/design-notes.md](./docs/design-notes.md) DN-14)
- ビルド / publish。`package.json` の `exports` は TypeScript ソースを直接指している

確定している **仕組み(org 標準への移行)**:

- **カバレッジ 4 指標 99% ゲートは有効。** org の一律ロールアウト決定(TEST_STANDARD.md §3)により、
  完成条件を待たず有効化した。実測ベースライン(2026-08-01、このリポジトリで初めて計測):
  statements 96.13% / branches 88.39% / functions 100% / lines 96.13%。
  3 指標が未達であり CI は赤くなるが、これは既知・受容済みの結果であって延期の理由にしない
  (TEST_STANDARD.md §4)

## License

MIT
