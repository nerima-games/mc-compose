# 移植計画

参照実装 `takeokunn/ts-minecraft` は**凍結された仕様書兼テストオラクル**である(plan.md 冒頭)。

## 0. LOC はすべて実測値。plan.md の見積りは当てにしない

plan.md §3.15 は移植元をこう書いている:

> `src/main.ts` + `packages/app` の配線(918 LOC相当)+ QA API(~1.4k)+ `e2e/`

**この見積りは 3 箇所で実測と突き合わせる必要がある。うち食い違うのは 1 箇所だけである。**

| plan.md | 実測(2026-07-26) | 判定 |
| --- | --- | --- |
| `packages/app` の配線「918 LOC相当」 | `main/layers/` = **918 LOC**(66 ファイル) / `packages/app/application/` 全体 = **20,737 LOC**(本体のみ) | **スコープ次第**。下記 §0.1 |
| QA API「~1.4k」 | 本体のみ **1,395 LOC**(14 ファイル) / テスト込み **2,648 LOC**(16 ファイル) | **ほぼ正しい**。下記 §0.2 |
| E2E「64本」(§8) | **70 本**(23 スペックファイル、2,875 LOC) | 食い違う(+6) |

測定コマンド:

```console
$ cd <reference-impl>          # takeokunn/ts-minecraft の checkout
$ find packages/app/application -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
 20737 total
$ find packages/app/application/main/layers -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
   918 total
$ find packages/app/application/main \( -name 'qa-api*.ts' -o -name 'qa-spatial*.ts' \) | xargs wc -l | tail -1
  2708 total          # ここから qa-spatial.test.ts(60)を引いて 2,648
$ find e2e -name '*.e2e.ts' | wc -l
23
$ grep -rhcE "(^|[^.a-zA-Z])test\(" e2e --include='*.e2e.ts' | paste -sd+ | bc
70
```

### 0.1 「918 LOC相当」— plan.md は狭義には正しく、移植計画としては誤り

918 は**再現できる実測値**である。`packages/app/application/main/layers/`(66 ファイル)が
ちょうど 918 LOC で、これは Layer 合成そのもの —— 文字どおりの「配線」—— である。
mc-playground-kit の
[porting.md](https://github.com/nerima-games/mc-playground-kit/blob/main/docs/porting.md) §1 / §1.1 が
`layers/` を「移植しないもの」として挙げるときに使っているのがこの数字であり、
そちらは「plan.md の 918 はこの実測値と一致する」と書いている。**その指摘は正しい。**
（同 §1.1 に、この 2 つの判定が矛盾しない理由を本節と同じ表で置いてある。
どちらか一方だけを読んで「plan.md は正しい / 誤り」と結論しないこと。）

一方 20,737 は `packages/app/application/` 全体である。内訳は
`frame/` 11,082 + `main/` 7,948 + `multiplayer/` 900 + `mods/` 123 + 直下ファイル 684 = **20,737**
(いずれも本体のみ。§1 に直下 684 の内訳がある)。
plan.md §3.15 は「`packages/app` の配線(918 LOC相当)」を **mc-compose の移植元の規模**として
提示しているので、**移植量の見積りとして読むと 22 倍の過小評価になる。**

したがって両方が正しい:

| 読み方 | 918 | 20,737 |
| --- | --- | --- |
| 「Layer 合成コードは何行か」 | **正解** | 過大 |
| 「`packages/app` から出ていく総量は何行か」 | **22 倍の過小評価** | 正解 |

**918 LOC と 20,737 LOC の差が、このリポジトリの計画そのものである。**
「配線」と呼べる部分は確かに 918 LOC だった。
残りの約 19,800 LOC が、配線の場所に堆積したルールである。
mc-compose が引き取るのはそのうちのごく一部で、残りは各体験モジュールへ散る(§1)。

### 0.2 QA API「~1.4k」は実質的に正しかった

`qa-api*.ts` + `qa-spatial.ts` は**本体だけなら 1,395 LOC**(14 ファイル。内訳は
[design-notes.md](./design-notes.md) DN-6)であり、plan.md の「~1.4k」と
5 行しか違わない。2,648 はテスト(`*.test.ts` 2 ファイル)を含めた数字で、
本文書の他の LOC(すべて本体のみ)とは計数条件が違う。
**「1.9 倍の過小評価」という以前の判定はこの計数条件の混同によるもので、撤回する。**
テスト込みの規模を知りたいときのために 2,648 は残すが、plan.md の見積りの正誤は
1,395 と比較して判断すること。

## 1. 移植元の実測(`packages/app/application/`、本体のみ)

直下の 5 行（`frame/` / `main/` / `multiplayer/` / `mods/` / 直下ファイル）が
`packages/app/application/` を**過不足なく分割する**。合計は 20,737 に一致する。
インデントされた行はその内訳であり、合計には二重に足さないこと。

| ディレクトリ | LOC | 行き先 |
| --- | ---: | --- |
| `frame/` | 11,082 | **分割**(下記) |
| └ `frame/stages/` | 9,030 | 大半が体験モジュールへ |
| &nbsp;&nbsp;&nbsp;└ `stages/interaction-*.ts`(40 ファイル) | 3,317 | **mx-gameplay**(plan.md §3.11) |
| `main/` | 7,948 | **分割**(下記) |
| └ `qa-api*.ts` + `qa-spatial.ts`(16 ファイル、テスト込み) | 2,648 | **mc-compose**(名前空間マージのみ)+ 各モジュール |
| `multiplayer/` | 900 | **mx-multiplayer** + **mx-ui** |
| `mods/`(= `mod-api.ts` 1 ファイル) | 123 | **mc-compose**(`domain/modding.ts`) |
| `application/` 直下のファイル(6 ファイル) | 684 | **分割**(下記) |
| **合計** | **20,737** | 11,082 + 7,948 + 900 + 123 + 684 |

直下 684 LOC の内訳(`find packages/app/application -maxdepth 1 -name '*.ts' -not -name '*.test.ts'`):

| ファイル | LOC | 行き先 |
| --- | ---: | --- |
| `frame-handler.ts` | 306 | **mc-compose**(`runFrame` の呼び出し側。条件分岐は落とす) |
| `debug-feature-flags.config.ts` | 192 | **mc-compose**(QA/デバッグ入口、plan.md §3.15) |
| `frame-handler.config.ts` | 76 | **mc-compose** |
| `debug-feature-flags.ts` | 65 | **mc-compose** |
| `main.config.ts` | 32 | **mc-compose** |
| `debug-feature-flags.types.ts` | 13 | **mc-compose** |

加えて `src/main.ts` = **201 LOC**(エントリポイント)、
`packages/app/test/` = **1,095 LOC**。

### 1.1 `frame/` 11,082 LOC の分解

`frame/` 直下の主なファイル(いずれも「フレームで何をするか」の実装):

| ファイル | 行き先 | 理由 |
| --- | --- | --- |
| `frame-stage-executor.ts` / `-helpers.ts` | **mc-compose** | まさに `runFrame`。ただし条件分岐は落とす |
| `frame-fixed-step.ts` | **mc-sim** | 固定ステップはシミュレーションの不変条件 |
| `frame-camera-pose.ts` | **mc-sim**(姿勢の正)+ compose(`camera-mirror` stage の順序) | plan.md §3.8 |
| `frame-maintenance-*.ts`(dirty / furnace / simulation / sync-chunks / time-of-day) | **mc-sim / mc-worldgen / mx-gameplay** | いずれもゲーム状態の維持 |
| `frame-adaptive-quality.ts` / `frame-budget.ts` | **mc-render**(または新規 stage) | **compose には置かない** |
| `frame-remote-player-sync.ts` | **mx-multiplayer** | |
| `frame-settings-apply.ts` | **mx-ui / mc-render** | |
| `error-logging.ts` | 各モジュール | stage は自分の失敗を自分で扱う |
| `stages/interaction-*.ts`(40 ファイル、3,317 LOC) | **mx-gameplay** | plan.md §3.11 が明示 |

**`frame/` から mc-compose に来るのは `frame-stage-executor` 相当の 100 LOC 程度である。**
現在の `domain/composition.ts` + `domain/stage-order.ts` がそれに当たる。

### 1.2 `main/` 7,948 LOC の分解

| 内容 | 行き先 |
| --- | --- |
| `qa-api*.ts` + `qa-spatial.ts`(本体 1,395 / テスト込み 2,648) | **各モジュールが名前空間ごと提供**。compose はマージのみ |
| セッションブートストラップ(`session-bootstrap-types/` 等) | **mc-compose**(`domain/session.ts`)+ 各モジュールのティアダウン |
| Layer 配線 | **mc-compose** |
| その他 | 該当モジュールへ |

### 1.3 E2E `e2e/` — 23 ファイル / 70 テスト / 2,875 LOC

| ディレクトリ | ファイル | test() | LOC | 移植先 |
| --- | ---: | ---: | ---: | --- |
| `e2e/gameplay/` | 12 | 22 | 1,577 | **mc-compose**(モジュール間相互作用のみ)。単一モジュールで閉じるものは各モジュールへ |
| `e2e/ui/` | 6 | 33 | 748 | **mx-ui** の DOM テストへ大半を降ろす。残りが compose |
| `e2e/multiplayer/` | 1 | 3 | 236 | **mc-compose**(2 クライアント間の相互作用) |
| `e2e/persistence/` | 1 | 3 | 108 | **mc-compose**(セーブ → ロード → 状態一致) |
| `e2e/smoke/` | 1 | 7 | 104 | **mc-compose** |
| `e2e/contracts/` | 1 | 1 | 68 | **mc-compose**(ブラウザ API 契約) |
| `e2e/production-smoke.e2e.ts` | 1 | 1 | 34 | **mc-compose** |
| `e2e/helpers/` + `e2e/fixtures/` | — | — | 558 | **mc-compose** |

**70 本すべてを compose に移すのが目標ではない。**
`e2e/ui/` の 33 本の多くは 1 画面で閉じており、mx-ui の DOM テストとして
ブラウザ抜きで、はるかに速く検証できる。
E2E に残すべきは「モジュール間の相互作用でしか壊れないもの」だけである
([testing.md](./testing.md) §3)。

## 2. mc-compose が最終的に持つ規模の見込み

| 区分 | 見込み LOC |
| --- | ---: |
| stage 順序解決 + 順序表 | 400 |
| Layer 合成 | 100 |
| セッションライフサイクル | 200 |
| QA API(マージのみ) | 150 |
| Modding 入口 | 200 |
| ブラウザエントリポイント配線 | 200 |
| **本体合計** | **約 1,250** |
| E2E(スペック + ヘルパー) | 1,500〜2,500 |

**参照実装の 20,737 LOC に対して本体 1,250 LOC。**
差の 19,500 LOC は消えるのではなく、所有するモジュールへ移る。

この数字が守れているかは、レビューのたびに `wc -l domain/*.ts` で確認できる。
**本体が 2,000 LOC を超えたら、それは黄信号である。**

### 実測(2026-07-26、コメント込みの生の `wc -l`)

| ファイル | LOC |
| --- | ---: |
| `domain/stage-order.ts` | 417 |
| `domain/stage-skeleton.ts` | 231 |
| `domain/composition.ts` | 190 |
| `domain/session.ts` | 174 |
| `domain/modding.ts` | 168 |
| `domain/qa-api.ts` | 160 |
| `index.ts` | 42 |
| **合計** | **1,382** |

上の見込みは実装コードの見込みであり、この実測はコメントを含む生の行数である。
順序解決 + 順序表の 648 行のうち過半は「なぜこの順序なのか」「なぜフェーズなのか」の
散文であり、それはこのリポジトリで**残すべき**種類の行数である
(順序表の各エッジが 1 フレーム内の因果についての主張であり、
「参照実装がそうだったから」は理由にならないため)。
黄信号の閾値 2,000 に対しては十分に内側にいる。

## 3. 移植順序

plan.md §6 Step 2 の構築順で mc-compose は**最後**に来る。

1. **stage 順序解決 + 順序表**(依存なし。**完了**)
2. **Layer 合成**(依存なし。**完了**)
3. **セッションライフサイクル**(依存なし。**完了**)
4. **QA API / Modding 入口**(依存なし。**完了**)
5. mc-kernel の契約型へ切り替え(`StageId` / `GameModule` / `DeltaTimeSecs` の re-export)
6. 4 つの体験モジュールの実合成
7. ブラウザエントリポイント(`src/main.ts` 201 LOC 相当)
8. **E2E 移植** — 最終ゲート。**フレーム側は先取りして実装済み**(`test/e2e/`)

1〜4 が現在の内容である。**依存を持たない部分から先に、かつテストつきで作った**のは、
compose が「最後に作られる、テストの無いリポジトリ」になるのを避けるためである。

8 も同じ理由で前倒しした。E2E の主張は 2 つに割れており、
**「16 本の stage が §4.2 のフレームに合成される」は 6 を待たずに検証できる**
— id と `after` は振る舞いではなく宣言で、兄弟リポジトリのソースから読めるからである。
待つ必要があるのは「採掘 → インベントリ」の側だけである。
どちらがどちらかは [testing.md](./testing.md) §3.4、
70 本 1 本ずつの判定は [e2e-triage.md](./e2e-triage.md)。

## 4. 移植時の注意

- **`frame/` を丸ごと持ってこない。** 11,082 LOC のうち compose に来るのは 100 LOC 程度である
- **`interaction-*.ts` の 40 ファイルは 1 つも来ない。** plan.md §3.11 が mx-gameplay に割り当てている
- **QA コマンドを compose で書かない。** 名前空間ごと所有モジュールから受け取る
- **`frame-adaptive-quality.ts` / `frame-budget.ts` を持ってこない。**
  フレーム予算は stage であり、フレームクロックを所有するモジュールのものである
- **delta のクランプを持ってこない**([design-notes.md](./design-notes.md) DN-9)
- **E2E を 70 本そのまま持ってこない。** 単一モジュールで閉じるものは降ろす
