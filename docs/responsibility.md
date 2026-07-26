# 責務

## 0. 最優先事項(PRIME DIRECTIVE)

> **このリポジトリに追加してよいコードは、Layer 合成と stage 順序表だけである。**
> それ以外はすべて、その振る舞いを所有するモジュールへ移す。

plan.md §3.15 設計注意:
> ここにゲームルールを書いたら負け(参照実装は合成層に 13k LOC のルールが堆積し、
> E2E でしか検証できなくなった — **本計画の出発点**)。
> 「compose の追加コードは Layer 合成と stage 順序表だけ」をレビュー規範とする

plan.md §8 リスク表:
> compose へのロジック堆積(参照実装の轍)
> → 「compose の追加コードは Layer 合成と stage 順序表だけ」をレビュー規範に。逸脱は該当モジュールへ移動

**このリポジトリは「参照実装の合成層で起きたこと」を二度と起こさないために存在する。**

### 実測: 参照実装の合成層がどこまで太ったか

測定日 2026-07-26、`takeokunn/ts-minecraft` にて `wc -l`(`.test.ts` を除いた本体のみ):

| 対象 | 実測 LOC |
| --- | ---: |
| `packages/app/application/`(合成層の全体) | **20,737** |
| └ `application/frame/` | 11,082 |
| &nbsp;&nbsp;&nbsp;└ `frame/stages/` | 9,030 |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ `stages/interaction-*.ts`(40 ファイル) | 3,317 |
| └ `application/main/` | 7,948 |
| &nbsp;&nbsp;&nbsp;└ `qa-api*.ts` + `qa-spatial.ts`(テスト込み 16 ファイル) | **2,648** |
| └ `application/multiplayer/` | 900 |
| └ `application/mods/mod-api.ts` | 123 |

`interaction-*.ts` の 40 ファイル 3,317 LOC は、plan.md §3.11 が **mx-gameplay** に割り当てている内容である。
つまり参照実装では**採掘・設置・アイテム使用のルールが合成層にいた**。
これが「E2E でしか検証できない」の正体である
— インベントリのルールを検証するのに、ブラウザを起動して世界を生成する必要があった。

**20,737 LOC はどれも、書かれた時点では局所的に妥当だった。**
「ここに置くのが一番簡単だから」が 20,737 回積み重なった結果である。
だからこの規範は「気をつける」ではなく、**機械的な拒否**として実装されている(§3)。

## 1. 持つもの(この 6 つだけ)

| 責務 | 実装 | plan.md |
| --- | --- | --- |
| **stage 全順序の解決** | `domain/stage-order.ts` | §2.3-3 |
| **stage 順序表(骨格)** | `domain/stage-skeleton.ts` | §4.2 |
| **Layer マージ** | `domain/composition.ts` | §3.15 |
| セッションライフサイクル(タイトル ⇄ ゲーム) | `domain/session.ts` | §3.15 |
| QA / デバッグ API | `domain/qa-api.ts` | §3.15, §7 |
| Modding 入口 | `domain/modding.ts` | §3.15, §7 |
| **E2E**(最終ゲート) | **未実装**([testing.md](./testing.md)) | §3.15, §8 |

### 1.1 stage 全順序の唯一の所有者(plan.md §2.3-3)

> 各モジュールは順序制約(`after`)を宣言するだけで、全順序は compose が解決する

この非対称性が設計そのものである。
モジュールが絶対位置(「自分は 7 番目」)を名乗れるなら、
**どこかに stage を 1 本足すことが全リポジトリの破壊的変更**になり、
16 リポジトリ分割は整数ひとつで無効化される。

`resolveStageOrder` が保証すること:

1. **決定性。** 同じ登録集合からは、いつ・どのプロセスで走らせても同じ順序が出る。
   トポロジカルソートの答えは複数あり、実行ごとに別の答えを選ぶと
   フレーム順序のバグが「たまにしか再現しない」ものになる
   — リプレイ可能であるべきシミュレーションにとって最悪の失敗様式である
2. **循環の経路を持った検出。** 「stage に循環があります」は 15 リポジトリにまたがると行動不能。
   `gameplay:fluids -> mx-redstone:tick -> gameplay:fluids` なら行動できる
3. **dangling edge はエラーにしない。** 「input があるなら input の後に走らせて」を
   input リポジトリへの依存なしに書けることが `after` の存在意義である(mc-kernel `domain/frame.ts`)。
   落としたうえで**報告する**

### 1.2 Layer マージ

`Layer.merge` であって `Layer.provide` ではない。
モジュールは**対等**である。モジュール A がモジュール B のサービスを**構築時に**必要とするなら、
それは体験モジュール間の依存エッジであり plan.md §2.3-1 が明確に禁じている。

## 2. 持たないもの

**ゲームルールを 1 行も持たない。** 具体的には:

| 症状 | 正しい置き場 |
| --- | --- |
| 「掘ったら〜がドロップする」 | mx-gameplay |
| 「水が〜へ伝播する」 | mx-gameplay |
| 「レッドストーン信号が〜」 | mx-redstone |
| プレイヤー・エンティティ・インベントリの状態 | mc-sim |
| チャンク・地形・バイオーム | mc-worldgen |
| 描画・ポストFX・入力 | mc-render |
| HUD・メニュー・画面 | mx-ui |
| プロトコル・トランスポート | mx-multiplayer |
| **delta time のクランプ**(`min(max(0.001, raw), 0.05)`) | **delta を生成する側**。§2.1 |
| stage の実行時間計測・フレーム予算 | **stage そのもの**。stage を 1 本足せばよい |
| 「この条件のときだけ stage を飛ばす」 | **その stage の `run` の中**。所有モジュール側 |

### 2.1 delta time のクランプを compose に置かない

plan.md §3.4 は参照実装の実測値としてクランプ規約を記録している:

> deltaTime は `min(max(0.001, raw), 0.05)` にクランプ、初回フレームは 0.016

**それでも `runFrame` はクランプしない。** クランプはシミュレーションの不変条件であり、
delta を**生成する側**のものである。ここに置けば、それは合成層に置かれた物理定数であり、
まさにこのリポジトリが防ごうとしている失敗そのものになる。

回帰テスト: `passes the delta through untouched — no clamp, no rounding, no first-frame special case`

### 2.2 `runFrame` に何も足さない

現在の `runFrame` は `Effect.forEach(ordered, stage => stage.run(dt), { discard: true })` だけである。
try/catch も、stage 単位の時間計測も、条件付きスキップも、予算も無い。
どれかを足した時点で「合成層に振る舞いを足した」ことになる。

フレーム予算が本当に欲しくなったら、それは **stage** である。
フレームクロックを所有するモジュールが 1 本登録すればよい。

## 3. 規範の機械的な強制

「気をつける」では 20,737 LOC は止まらない。以下は自動で落ちる。

### 3.1 依存ホワイトリスト(最重要)

mc-compose が import してよいのは **4 つの体験モジュール + mc-kernel だけ**である。

```
mc-compose -> mx-gameplay / mx-redstone / mx-ui / mx-multiplayer   ... OK
mc-compose -> mc-sim                                               ... transitive-import 違反
mc-compose -> mc-worldgen / mc-physics / mc-save / mc-audio / mc-noise ... 同上
mc-compose -> mc-render / mc-meshing                               ... not-whitelisted 違反
```

`pnpm install` すると `node_modules` にはこれら全部が物理的に置かれる。
**それでも import は禁止**であり、`pnpm check:deps` が非ゼロ終了する。

**これが規範の機械化された半分である。** mc-sim を直接必要とするルールは、
体験モジュールに属するルールである。
ゲートは「mx-* を飛び越えてここに書く」をレビューの意見ではなくビルドの失敗にする。

回帰テスト: `test/check-dependency-whitelist.test.ts` の
`rejects reaching past the experience modules to mc-sim, and names the path` ほか。

### 3.2 公開 API の名前検査

`test/public-api.test.ts` の
`exports nothing that sounds like a game rule, an entity or a world` が、
`block` / `item` / `inventory` / `craft` / `mob` / `entity` / `chunk` / `biome` /
`terrain` / `fluid` / `damage` / `health` / `hunger` / `recipe` / `furnace` /
`drop` / `loot` を名前に含む export を拒否する。

**これは弱いチェックである**(名前しか見ていない)。
強いチェックのつもりではなく、**新しい export を足すその場所に規範を置く**ためにある。

例外は `STAGE_*` / `SIMULATION_*` / `RESERVED_*` — stage 順序表がその概念を**名指す**のは表の仕事であり、
**実装する**のは表の仕事ではない。

### 3.3 レビュー時の質問

このリポジトリへの差分をレビューするとき、聞くべきは「動くか」ではない。

> **どのリポジトリがこれを所有するのか。**

答えが「compose」になるのは、差分が Layer 合成か stage 順序表のどちらかであるときだけである。
