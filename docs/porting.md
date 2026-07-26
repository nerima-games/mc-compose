# 移植計画

参照実装 `takeokunn/ts-minecraft` は**凍結された仕様書兼テストオラクル**である(plan.md 冒頭)。

## 0. LOC はすべて実測値。plan.md の見積りは当てにしない

plan.md §3.15 は移植元をこう書いている:

> `src/main.ts` + `packages/app` の配線(918 LOC相当)+ QA API(~1.4k)+ `e2e/`

**この見積りは 2 箇所で実測と食い違う。**

| plan.md | 実測(2026-07-26) | 差 |
| --- | --- | --- |
| `packages/app` の配線「918 LOC相当」 | `packages/app/application/` = **20,737 LOC**(本体のみ) | 22 倍 |
| QA API「~1.4k」 | `qa-api*.ts` + `qa-spatial.ts` = **2,648 LOC**(16 ファイル、テスト込み) | 1.9 倍 |
| E2E「64本」(§8) | **70 本**(23 スペックファイル、2,875 LOC) | +6 |

測定コマンド:

```console
$ cd /Users/take/ghq/github.com/takeokunn/ts-minecraft
$ find packages/app/application -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
 20737 total
$ find packages/app/application/main \( -name 'qa-api*.ts' -o -name 'qa-spatial*.ts' \) | xargs wc -l | tail -1
  2708 total          # ここから qa-spatial.test.ts(60)を引いて 2,648
$ find e2e -name '*.e2e.ts' | wc -l
23
$ grep -rhcE "(^|[^.a-zA-Z])test\(" e2e --include='*.e2e.ts' | paste -sd+ | bc
70
```

**918 LOC と 20,737 LOC の差が、このリポジトリの計画そのものである。**
「配線」と呼べる部分は確かに 1,000 LOC 未満だったかもしれない。
残りの 20,000 LOC が、配線の場所に堆積したルールである。

## 1. 移植元の実測(`packages/app/application/`、本体のみ)

| ディレクトリ | LOC | 行き先 |
| --- | ---: | --- |
| **合計** | **20,737** | |
| `frame/` | 11,082 | **分割**(下記) |
| └ `frame/stages/` | 9,030 | 大半が体験モジュールへ |
| &nbsp;&nbsp;&nbsp;└ `stages/interaction-*.ts`(40 ファイル) | 3,317 | **mx-gameplay**(plan.md §3.11) |
| `main/` | 7,948 | **分割**(下記) |
| └ `qa-api*.ts` + `qa-spatial.ts`(16 ファイル、テスト込み) | 2,648 | **mc-compose**(名前空間マージのみ)+ 各モジュール |
| `multiplayer/` | 900 | **mx-multiplayer** + **mx-ui** |
| `mods/mod-api.ts` | 123 | **mc-compose**(`domain/modding.ts`) |

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

## 3. 移植順序

plan.md §6 Step 2 の構築順で mc-compose は**最後**に来る。

1. **stage 順序解決 + 順序表**(依存なし。**完了**)
2. **Layer 合成**(依存なし。**完了**)
3. **セッションライフサイクル**(依存なし。**完了**)
4. **QA API / Modding 入口**(依存なし。**完了**)
5. mc-kernel の契約型へ切り替え(`StageId` / `GameModule` / `DeltaTimeSecs` の re-export)
6. 4 つの体験モジュールの実合成
7. ブラウザエントリポイント(`src/main.ts` 201 LOC 相当)
8. **E2E 移植** — 最終ゲート

1〜4 が現在の内容である。**依存を持たない部分から先に、かつテストつきで作った**のは、
compose が「最後に作られる、テストの無いリポジトリ」になるのを避けるためである。

## 4. 移植時の注意

- **`frame/` を丸ごと持ってこない。** 11,082 LOC のうち compose に来るのは 100 LOC 程度である
- **`interaction-*.ts` の 40 ファイルは 1 つも来ない。** plan.md §3.11 が mx-gameplay に割り当てている
- **QA コマンドを compose で書かない。** 名前空間ごと所有モジュールから受け取る
- **`frame-adaptive-quality.ts` / `frame-budget.ts` を持ってこない。**
  フレーム予算は stage であり、フレームクロックを所有するモジュールのものである
- **delta のクランプを持ってこない**([design-notes.md](./design-notes.md) DN-9)
- **E2E を 70 本そのまま持ってこない。** 単一モジュールで閉じるものは降ろす
