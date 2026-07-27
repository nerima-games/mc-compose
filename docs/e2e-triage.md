# 参照実装 E2E 70 本の triage

plan.md §3.15 は「E2E(参照実装の 64 本を移植)が最終ゲート」と書いている。
**実測は 64 本ではなく 70 本**([porting.md](./porting.md) §0)。

この文書は **70 本を 1 本ずつ判定したもの**である。
「70 本を移植する」は目標ではない([porting.md](./porting.md) §4)。
E2E に残すべきは「モジュール間の相互作用でしか壊れないもの」だけであり
([testing.md](./testing.md) §3)、残りは所有モジュールへ降ろす。

**部分的な移植より、完全な triage のほうが価値がある** — というのがこの文書の存在理由である。
どれが今できて、どれが何の publish を待っていて、どれが新アーキテクチャで意味を失ったかが
分かっていれば、モジュールが公開されるたびに「次はこれ」が引ける。

## 0. 数え方(再現可能)

```console
$ cd <reference-impl>                       # takeokunn/ts-minecraft の checkout
$ find e2e -name '*.e2e.ts' | wc -l
23
$ grep -rhcE "(^|[^.a-zA-Z])test\(" e2e --include='*.e2e.ts' | paste -sd+ | bc
70
$ find e2e -name '*.e2e.ts' | xargs wc -l | tail -1
 2875 total
$ find e2e/helpers e2e/fixtures -name '*.ts' | xargs wc -l | tail -1
  558 total
```

ヘルパー / fixture 558 LOC の内訳:
`e2e/fixtures/game-page.ts`(ページオブジェクト)、
`e2e/helpers/{console-monitor,db-helpers,touch-helpers,wait-helpers}.ts`、
`e2e/helpers/qa-globals.d.ts`(QA API の型宣言)。

実行環境は Chromium 1 プロジェクトのみ、**SwiftShader**(`--use-angle=swiftshader`)、
`webServer` が `pnpm dev` を 5180 番で立てる(`playwright.config.ts`)。
QA API のグローバルキーは **`__TS_MINECRAFT_QA__`** で、23 本中 8 ファイルが触っている。
本実装ではこれを `__NERIMA_GAMES_QA__` に変える([testing.md](./testing.md) §3.3)。

## 1. 判定の語彙

| 判定 | 意味 |
| --- | --- |
| **RUNNABLE-NOW** | 今日 mc-compose の中だけで検証できる(`effect` と自分の `domain/` のみ) |
| **NEEDS-PUBLISH** | ロスターのどれかが publish されれば書ける。何が要るかを列に書く |
| **NEEDS-BROWSER** | 加えて実ブラウザ / Playwright / WebGL / ビルド済みエントリポイントが要る |
| **DEMOTE** | 1 モジュールで閉じる。**そのモジュールのテスト**に降ろす。compose には来ない |
| **OBSOLETE** | 新アーキテクチャで主張そのものが消える |

`DEMOTE` と `NEEDS-BROWSER` は両立する(降ろした先でもブラウザが要ることがある)。
その場合は主判定を `DEMOTE` とし、降ろし先を書く。

## 2. 集計

| 判定 | 本数 | 割合 |
| --- | ---: | ---: |
| RUNNABLE-NOW | **0** | 0% |
| NEEDS-PUBLISH(compose に残る。ブラウザ不要) | 3 | 4% |
| NEEDS-BROWSER(compose に残る) | 22 | 31% |
| DEMOTE(所有モジュールへ) | 43 | 61% |
| OBSOLETE | 2 | 3% |
| **合計** | **70** | |

DEMOTE 43 本の降ろし先: **mx-ui 39 本 / mc-render 2 本 / mc-save 2 本**。

**RUNNABLE-NOW が 0 本であることが、この triage の一番重要な結論である。**
参照実装の E2E は 1 本残らずブラウザ・DOM・WebGL・IndexedDB のいずれかに触っており、
「今日そのまま持ってこられる 1 本」は存在しない。
だから `test/e2e/roster-frame-order.test.ts` は 70 本のどれかの移植ではなく、
**70 本のどれも問えなかった問い**(16 本の stage が §4.2 のフレームに合成されるか)を問う
別のテストである。その区別は [testing.md](./testing.md) §3.4 にある。

**compose に残るのは 25 本(36%)。** plan.md §3.15 が言う「E2E は最終ゲート」の
最終ゲートは、70 本ではなくこの 25 本である。

### 2.1 移植の進捗(2026-07-27 追記。上の判定は 1 つも変えていない)

**この節は 3 度目の追記を受けている。** 下の表が最新で、過去の数字は欄外に残してある。
**動いたのは移植の進捗だけである。§2 の集計(43 / 25 / 2)も §3 の判定語も、
`d43cf46` が確定させた降ろし先の訂正も、1 つも変えていない。**

| 降ろし先 | triage が割り当てた本数 | 再判定後に所有 | 移植済み | 未移植 |
| --- | ---: | ---: | ---: | ---: |
| mx-ui | 39 | **37** | **29** | 8 |
| mc-render | 2 | **4** | **3** | **1** |
| mc-save | 2 | 2 | **2** | **0** |
| **合計** | **43** | **43** | **34** | **9** |

「再判定後に所有」の列は `d43cf46` が確定させた **touch controls 2 本の mc-render への訂正**
だけを反映している(§3.5 #34-35)。**crosshair 2 本は mx-ui のままで、そして書かれた** —
同じ commit が `index.html:124` を根拠に棄却したとおりである。
**そして訂正した 2 本のうち #35 は書かれた(2026-07-27、第 3 波)。**
残る #34 は移植ではなくブラウザ待ちに変わった — 下の段落で分割する。

mx-ui の未移植 8 本の内訳: 設定画面 3 / #19 1 / `usable at ${width}px` 2 /
`#settings-apply` 1 / `Escape key opens` 1。
mc-render の 1 本は #34。mc-save は #9 が移植されたので **0** である。
**8 + 1 + 0 = 9。**
**mx-ui の 8 本はどれも「まだ書いていない」ではない** — 判断か、構造的に真か、
ブラウザが要るかである。「その画面が mx-ui に無い」という理由は**ゼロになった。**

**そして今回、「まだ書いていない」は全体でゼロになった。** 直前の追記が
「mc-render の 2 本だけは『まだ書いていない』である」と書いた 2 本が、その 2 本だったからである。
**#35 は `mc-render/test/touch-controls.test.ts` の 23 テストになった**(mc-render の suite は
373 → 396)。主張は「タップがキーと同じ intent に束ねられているか」であり、
それは入力バインディングの問いなので headless で問えた —— 予告どおりである。

**#34 は半分だけ書かれ、残り半分は今後もここでは書けない。** 分割は次のとおりで、
**この行が「未移植」に立ち続ける理由は今日から「まだ書いていない」ではなく「ブラウザが要る」である**
(mx-ui の 8 本と同じ分類に移った):

- **書けた半分** — 宣言されたコントロールが**死んでいない**こと。48px で、セーフエリアの内側で、
  そして**何にも束ねられていない**ボタンはあり得る。プレイヤーは押せて、へこんで、ゲームは反応しない。
  レイアウトの失敗より**悪い**ほうの失敗であり、これは束縛表への問いなのでブラウザは要らない
  (`unboundTouchActions`)。
- **書けない半分** — 48px の当たり判定とセーフエリアそのもの。mc-render は `lib.DOM` を出荷せず、
  `application/dom-surface.ts` は**意図的に幾何を 1 つも持たない**。Node の
  `getBoundingClientRect` は 0 を返すので、そこで `48` を主張するテストは**fake が正しく書けているか**を
  主張することになる。**測っていないものを測ったことにはしない。**

> この段落は一度「8 + 2 + 1 = 11」のまま取り残された。**同じことを述べる場所が
> 3 つある**(§2.1 の表・この内訳・各行)ため、1 つ動かすと 2 つが古くなる。
> 数字が各行から導出されない限りこれは続く。

> **初回追記(mx-ui 20 / mc-render 2 / mc-save 1 = 23 移植済み、20 未移植)。**
> この表は一度「mc-render 0 本移植済み」と書かれて commit 直前に直った。同じ文書の
> #23・#24 の欄は同じ日付で「移植済み → `mc-render/test/movement-keys.test.ts`」と書いており、
> そのファイルは 10 本 green で存在していた。**同じことを述べる手書きの表が 2 つあれば、
> いつか食い違う** — この組織が `SCAN_ROOTS` / 出荷ソース述語 / `package.json` `files` で
> 3 度やった失敗と同じ形である。表の数字が本文の欄から導出されていない限り、
> この行はまた壊れる。
>
> **予告どおり壊れていた。今回それを踏んだ。** 初回追記の「未移植 19 本」の内訳表(下に原文のまま
> 残してある)は 1 行目を **7**(main menu 5 / loading 1 / crosshair 1)、2 行目を **4** と書いている。
> だが 1 行目の括弧は「#2 と `main-menu.e2e.ts` の DEMOTE 分」であり、それは 1 + 5 = **6** で、
> loading と crosshair を足すと **8** になる。一方 2 行目が名指しする
> `settings-overlay.e2e.ts` の slider / persist 系は §3.6 の内訳で数えて **3** 本しかない。
> **1 行目が 1 少なく 2 行目が 1 多かったので、合計 19 だけが合っていた。**
> 正しい分割は 8 / 3 / 8 である。**合計も降ろし先も判定も誤っていない。誤っていたのは
> 内訳表の 2 つの数字だけで、そしてそれは「main menu を 5 本と読むか 6 本と読むか」を
> 次に移植する者に 1 度だけ迷わせるのにちょうど足りた。**

mc-render の 2 本は `test/movement-keys.test.ts` の 10 テストになった。参照実装の主張は
`does not crash` であり、それは**何も主張していない**に等しい(§0 の「主張を運ぶ」の反例)。
移植したのは「そのキーがどの意図に束ねられているか」であって、**落ちないこと**ではない。

mx-ui の 20 本は 3 ファイル 28 テストになった(`test/accessibility-gate.test.ts`、
`test/modal-flows.test.ts`、`test/screen-mount.test.ts`)。本数が増えているのは
`hotbar slot 1..9` を 9 本に開いたためで、逆に accessibility の 7 本は 1 本のスイープに畳まれている。
**28 本すべてについて、狙った実装コードを壊して赤くなることを確認してある。**

**さらに 9 本(2026-07-27、第 2 波)。「その画面が mx-ui にまだ無い」で止まっていた 8 本が
ぜんぶ解けた。** メインメニュー 6 本(#2 と `main-menu.e2e.ts` の DEMOTE 5 本)、
ローディング画面 1 本、crosshair 2 本(#15 と `hud.e2e.ts` の重複)が
3 ファイル 54 テストになった(`mx-ui/test/main-menu.test.ts`、
`mx-ui/test/loading-screen.test.ts`、`mx-ui/test/crosshair.test.ts`)。
`accessibility-gate.test.ts` のスイープは 4 画面から **7 画面**になり 9 → 12 テスト。
mx-ui の suite は 226 → 283。**新規 57 本すべてについて、狙った実装コードを壊して
赤くなることを確認してある(69 変異、うち 68 が 1 本以上を殺し、全て revert 済み)。**
残る 1 変異は `setMotion` の早期 return を外すもので、`project()` が完全に差分化されている
以上**観測不能な等価変異**である。テストの穴ではないので、そう記録して残した。

画面は 3 つとも `domain/` の導出 + `application/` の射影という既存の形で書かれている
(`domain/main-menu.ts` / `application/main-menu-view.ts`、
`domain/loading-screen.ts` / `application/loading-view.ts`、
`domain/crosshair.ts` / `application/crosshair-view.ts`)。
**3 つともリスナを 1 つも持たず、タイマーも 1 つも持たない。** メニューの「クリック」は `test/modal-flows.test.ts` の
「E キー」と同じ扱いで、mx-ui が持つのは**押した後にメニューがどこにいるか**だけである
(DN-UI-4)。設定画面がここに無い理由は依然として `mx-ui/test/screen-views.test.ts` 冒頭にあり、
**それはメニューには当てはまらない**: rebind はキーストロークそのものが全部だが、
クリックを取り除いたメニューには**遷移という値**が残る。

**未移植 19 本の理由は 3 種類しかなく、どれも「まだ書いていない」ではない。**

> **以下の表は初回追記の原文である(数字の誤りは上の欄外で訂正済み)。**
> 第 2 波の後、**1 行目は 8 → 0 になり、この理由の分類そのものが消えた。**
> 2 行目・3 行目は動いていない — そちらは判断と構造であって、書き忘れではないからである。
>
> **第 3 波(2026-07-27)で 3 行目が 8 → 7 になった。** touch controls 2 本のうち
> **#35 が書かれ、#34 はレイアウト側だけが残った**ので、3 行目の内訳から
> 「touch controls 2」が「**#34 のレイアウト側 1**」に縮んでいる。
> **降ろし先の訂正はここでは動いていない** — 3 行目はもともと「降ろし先が違う、
> または主張が構造的に真」であり、#34 が残る理由は今日から**ブラウザが要る**だからである。

| 理由 | 本数 | 内訳 |
| --- | ---: | --- |
| **その画面が mx-ui にまだ無い** | 7 | main menu 5(#2 と `main-menu.e2e.ts` の 5 本のうち DEMOTE 分)、loading screen 1、crosshair 1 |
| **設定画面が無いのは判断であって欠落ではない** | 4 | `settings-overlay.e2e.ts` の slider / persist 系。`mx-ui/test/screen-views.test.ts` 冒頭が理由を述べている |
| **降ろし先が違う、または主張が構造的に真** | 8 | touch controls 2(**mc-render に訂正確定**。語彙に `addEventListener` があるのは mc-render のみ)、#19、crosshair の重複 1、`usable at ${width}px` 2(レイアウト+`role="button"` の矛盾)、`#settings-apply` 1(§3.6 の判断どおり削除)、`Escape key opens` 1(既存テストが持っている) |

**この表の 2 行目と 3 行目が、部分的な移植より完全な triage のほうが価値があるという
§0 の主張の実例である。** 19 本のうち 12 本は「mx-ui が書き忘れた」ではなく、
**mx-ui が別の答えを出した**か、**降ろし先の判定が誤っていた**かである。
touch controls 2 本は **mc-render への訂正が確定した**(§3.5)。決め手は推測ではなく計測で、
mc-render の `application/dom-surface.ts:172` は `addEventListener` を持ち、mx-ui の同名ファイルは
**意図的に持たない**(DN-UI-4)。**その動詞が語彙にあるか**は「入力面か表示面か」より検証可能である。

逆に **crosshair は mx-ui のままで正しかった**。「照準はカメラ中心だから mc-render 寄り」という
推測は、参照実装が 2 度否定している: ファイルは `packages/presentation/hud/crosshair` にあり、
`index.html:124` は `body.hud-hidden #crosshair` を `#health-display` や `#hunger-display` と
**同一の規則**で隠す。HUD を隠すことが crosshair を隠すことだと書いた人間がいる、ということである。
**もっともらしい直感を 1 つ採用し 1 つ棄却した。差はどちらも「実装を読んだか」だけである。**

そして **39 本のうち 1 本が、移植した瞬間に赤くなった** — `HUD remains usable at ${width}px` の
名前付けの半分である。詳細は §3.6 の `hud.e2e.ts` の欄。
**参照実装がブラウザでしか問えなかったことを問い直したら、本実装の欠陥が 1 つ出てきた**
というのが、この移植の一番具体的な収穫である。

## 3. 1 本ずつ

### 3.1 `e2e/smoke/` — 7 本 / 104 LOC

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 1 | `WebGL2 canvas is present and active` | NEEDS-BROWSER | **mc-compose**。ブラウザエントリポイント + mc-render |
| 2 | `main menu renders on boot` | DEMOTE | **mx-ui**。1 画面の DOM<br>**移植済み(2026-07-27、第 2 波)** → `mx-ui/test/main-menu.test.ts`「mounts into the host and opens on its root card」。参照実装の主張は「初期化の後に `#mm-new-world` が見える」だが、本実装ではそれより強い: 親は**引数**である(`docs/public-api.md` §4-1)ので、メニューが**渡された親に**生えることと、2 インスタンスが 1 要素も共有しないことを問える<br>*(初回追記時は未移植。理由は「`application/` にあるのは hud / inventory / caption / save-indicator の 4 画面で、メニューはそのどれでもない」だった。)* |
| 3 | `no fatal startup errors before game session` | NEEDS-BROWSER | **mc-compose**。全 Layer が起動時に落ちないこと = 合成の主張 |
| 4 | `game loop starts and FPS counter becomes non-zero` | NEEDS-BROWSER | **mc-compose**。フレームが回る = `runFrameWith` が実際に駆動している |
| 5 | `dynamic DOM elements are injected after game initialization` | DEMOTE | **mx-ui**<br>**移植済み(2026-07-27)** → `mx-ui/test/screen-mount.test.ts`。「JS が注入する」より強い主張になった: 親は**引数**であって探索先ではない(`docs/public-api.md` §4-1)ので、4 画面すべてが渡された親に mount することと、2 インスタンスが 1 要素も共有しないことを問える |
| 6 | `settings and inventory overlays are hidden at startup` | DEMOTE | **mx-ui**。`ui:overlay-sync` の初期状態<br>**移植済み(2026-07-27)** → `mx-ui/test/modal-flows.test.ts`。`emptyModalStack` にどちらも載っておらず、`gameplayInputSuppressed` も `pointerLockReleased` も false であること |
| 7 | `no fatal startup errors during session` | NEEDS-BROWSER | **mc-compose**。セッション全体 |

compose に 4 本、mx-ui に 3 本。

### 3.2 `e2e/contracts/` — 1 本 / 68 LOC

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 8 | `storage-service IndexedDB roundtrip works in Chromium` | DEMOTE | **mc-save**。ブラウザ API 契約であり、合成とは無関係。mc-save の DOM テストへ<br>**移植済み(2026-07-27)** → `mc-save/test/binary-roundtrip.test.ts` |

参照実装がこれを `e2e/contracts/` に置いたのは、mc-save に相当する境界が無かったからである。
分割後は「IndexedDB が約束どおり振る舞うか」は永続化の所有者の問いになる。

### 3.3 `e2e/persistence/` — 3 本 / 108 LOC

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 9 | `'minecraft-worlds' IndexedDB is created after game starts` | DEMOTE | **mc-save**。DB が作られるのはストレージ層の話<br>**移植済み(2026-07-27)** → `mc-save/test/indexeddb-storage.test.ts`。**この行が予告したとおりの形になった。** かつてここには「アダプタが無いので問う先が無い」と書いてあり、さらに「`chunks` と `metadata` という store がある」という主張は mc-save が意図的に捨てた参照実装のスキーマなので**移植してはならない**とも書いてあった。アダプタが書かれた今、前者は消え、後者は生きている: :84 が「渡された名前の DB を作り、他は作らない」を、:107 が「**参照実装の chunks/metadata ではなく自分の store 構成**を作る」を主張する。**参照実装のスキーマを主張し返さないことが、この移植の中身である。** |
| 10 | `world data persists across page reload (within same context)` | NEEDS-BROWSER | **mc-compose**。リロードはセッション境界をまたぐ |
| 11 | `save & quit to title loads the same world with restored player position` | NEEDS-BROWSER | **mc-compose**。**このディレクトリで最も価値が高い 1 本**。`Title ⇄ InGame` の往復と mc-sim / mc-save / mc-worldgen の状態一致を同時に主張する。plan.md §3.8 の「2 周目デッドロック」に直接当たる |

### 3.4 `e2e/multiplayer/` — 3 本 / 236 LOC

3 本とも 2 ブラウザを立てる。**3 本とも mc-compose**:
mx-multiplayer → mc-sim → mx-gameplay / mx-ui をまたぐので、定義上ここでしか見えない。

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 12 | `connects two browsers to the same server and shows both players` | NEEDS-BROWSER | **mc-compose**。mx-multiplayer + mc-sim + mx-ui + サーバ |
| 13 | `broadcasts chat messages to both connected players` | NEEDS-BROWSER | **mc-compose**。mx-multiplayer + mx-ui |
| 14 | `syncs remote player positions after movement` | NEEDS-BROWSER | **mc-compose**。mx-multiplayer → mc-sim → mc-render |

> **DN-15 に直結していた。解決済み(2026-07-27)。** この 3 本を書くには mx-multiplayer が
> stage を登録している必要があり、当時 `STANDARD_STAGE_SKELETON` にはそれを拾うフェーズが
> 1 つも無かった。**この triage が骨格の欠落を指していた。**
> mx-multiplayer が `multiplayer:inbound` / `multiplayer:outbound` を登録し、骨格に
> `network:inbound` / `network:outbound` を追加した([architecture.md](./architecture.md) §4.5)。
> **残る前提はトランスポートとブラウザであって、フレーム位置ではない。**

### 3.5 `e2e/gameplay/` — 12 ファイル / 22 本 / 1,577 LOC

#### `block-interaction.e2e.ts`(5 本 / 97 LOC)

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 15 | `crosshair is visible after game loads` | DEMOTE | **mx-ui**。HUD の DOM。#26 と重複<br>**移植済み(2026-07-27、第 2 波)** → `mx-ui/test/crosshair.test.ts`。降ろし先は `d43cf46` のとおり mx-ui。**保留していた「パレットの保証にこのマークを収める節が無い」は解けた** — 節を足すのではなく、**照準が自分用の scrim を連れて歩く**ことで既存の G1 の中に入った。新トークンは 1 つも足していない。詳細は下の欄外 |
| 16 | `left click on canvas does not crash game` | **OBSOLETE** | 「クラッシュしない」は主張ではない。`gameplay:interactions` は `Effect<void, never, _>` で、エラーチャネルが `never` である。破壊の結果を主張するテスト(#31)に置き換わる |
| 17 | `right click on canvas does not crash game` | **OBSOLETE** | 同上 |
| 18 | `repeated left and right clicks do not accumulate errors` | NEEDS-PUBLISH | **mc-compose**。入力エッジが毎フレーム 1 回だけクリアされること。`render:input` が存在する理由そのもの(mc-render `stages/stage-ids.ts` 冒頭)。**mc-render + mc-sim** |
| 19 | `game remains in play mode after click (overlays stay closed)` | DEMOTE | **mx-ui**。モーダルスタックの状態機械<br>**未移植(2026-07-27)。主張が構造的に真になったので、書けば必ず緑になるテストにしかならない。** mx-ui でモーダルを開ける動詞は `openScreen` だけで、`render` は `ModalStack` を引数にも戻り値にも持たない。「クリックしても開かない」は型で閉じている。HUD 側の対応する主張(死んでも画面を開かない)は `test/hud-view.test.ts`「marks death as state rather than acting on it」が既に持っている |

> **crosshair の移植(2026-07-27、第 2 波)。降ろし先は 2 度確かめて mx-ui、
> そして「保証の形」の問題は節を足さずに解けた。**
>
> `d43cf46` の判断は正しい。`index.html:124` が `#crosshair` を `#survival-hud` や
> `#sound-captions` と同じ `body.hud-hidden` の規則で隠している以上、参照実装の書き手は
> これを HUD だと思っていた。**そして `#sound-captions` も `#autosave-status` も
> 現に mx-ui のものである。**
>
> 実装を最後まで読むと、別のものが出てくる。
> `packages/presentation/hud/crosshair.ts:19-20` は照準に
> `mix-blend-mode: difference` と `drop-shadow` を掛けており、`crosshair.test.ts:296`
> 「should protect crosshair contrast against bright and dark backgrounds」が
> **その 2 つを名指しで assert している**。つまり参照実装は crosshair のコントラスト方針を
> 明示的に持っていて、**それは色ではない**。線自体は `background-color: white` だが、
> 画面に出る色は `255 - 背後のピクセル` である。
>
> 固定色を選ばなかったのは正しい。**任意のワールドピクセルの上で読める固定色は無い。**
> ただし `difference` は**レンジの真ん中で壊れる**。合成結果は `|背後 − 元|` なので、
> 白い線を中間グレーの上に置くと、ほぼ同じグレーが返ってくる:
>
> | ワールドピクセル | 線 対 背後 | ハロー 対 背後 |
> | ---: | ---: | ---: |
> | 96 | 2.38:1 | 1.00:1 |
> | 128 | **1.01:1** | **1.00:1** |
> | 160 | 2.44:1 | 1.00:1 |
>
> `filter` は blend より先に走るので、**安全網であるはずの黒いハローも差分を取られて
> 背後そのものに戻る**。線とハローが同時に消える。石も水も、夕暮れのたいていのものも
> このバンドにいる。**参照実装のテストは方針が「書かれている」ことを assert しており、
> 効くことは assert していない** — そしてタイトルが名指しする bright と dark は、
> ちょうどそれが安全な 2 点である。`domain/save-status.ts` の自動保存ペアに続いて、
> このパレットの算術が参照実装に見つけた **2 件目の欠陥**である。
>
> **解いた方法は、パレットに節を足すことではなかった。**
> mx-ui の `domain/palette.ts` は、シーンの上に直接描かれたものを保証の外に置いたうえで、
> その理由も書いている: 「That is why `SCRIM` is a token and not a decoration: it is the
> mechanism by which the claim above is made honourable, and **content that leaves it
> leaves the guarantee with it**」。**ならば離れさせなければよい。**
> 照準の線は `INK`、その 1px の縁は `SCRIM` — つまり**照準が自分用の scrim を連れて歩く**。
> 参照実装の `drop-shadow(0 0 2px rgba(0,0,0,.9))` は既にそれであって、
> `rgba(0,0,0,.9)` は `SCRIM` と 3 チャンネルしか違わない。**壊しているのは上に載せた
> blend mode のほうで、それがハローを取り上げてしまう。**
>
> 結果として **新トークンは 0 個**である。床は `surveyPalette()` が既に測っている
> `worstCaseContrastOnScrim(INK)` = **13.34:1**(アイコンの床は 3:1)であり、
> 既存のテストが既に pin している数字がそのまま照準の床になる。
> `CROSSHAIR` トークンを足す道も検討したが、それは新しいコントラスト測定と、
> `SLOT_SELECTED`(白 対 白、距離 0)との全ペア衝突と、その言い訳の免除エントリを
> 3 つセットで連れてくる。**保証を広げずに済むなら広げない。**
>
> **スイープの空振りは実在した。** `mx-ui/test/accessibility-gate.test.ts` の画面別監査は
> `color` しか読んでいなかったので、テキストを持たない crosshair は
> **1 色も見られないまま緑**になる。ミューテーションで確認してある: 線の色をベタの
> `#f0f0f0` に変えても、監査は気づかなかった。**監査を `background-color` まで広げた。**
> 判定はプロパティ名の一覧ではなくパレット自身の区別で書ける — **未ガードのトークンは面**
> (`SCRIM` / `SURFACE` / `METER_TRACK` / `SLOT_FILL`。測っていないのは、他が
> それに対して測られる側だからである)なので背景に使ってよい。**ガード済みのトークンはマーク**
> なので、どこに塗られていても自分の床を超えていなければならない。トークンでない値は
> どちらでも失格である。**既存 5 画面はいずれも緑のままで、以前は見えなかった
> 「背景に生リテラル」が新たに捕まるようになった。**

> **ヒットマーカーはタイマーを持たずに移植できた(第 2 波)。**
> 参照実装は `crosshair.ts:141` で `setTimeout(resetPulse, 120)` を使う — レンダラの中の
> 壁時計であり、plan.md §4.3 がリポジトリ全体で禁じているものである。要らなかった:
> パルスは「ある時刻からの継続時間」であって、それは `domain/save-status.ts` と
> `domain/loading-screen.ts` が既に持っている形である。フレームが `lastHitAtSecs` を置き、
> `crosshairViewModel` が `nowSecs` を引数で取る(DN-UI-10)。
> **参照実装が手で管理している `pulseTimeoutRef` — `hide` でも `toggle` でも再パルスでも
> 消して回るあれ — は、消すものが無いので丸ごと消えた。**
>
> **表示条件も新しいフラグにはならなかった。** 参照実装は `visibleRef` を持つが、
> 「照準はポインタロックを要る」ので `domain/modal-stack.ts` の `pointerLockReleased` が
> 既に答えである。おかげで参照実装には言えない主張が立つ: **まだ誰も書いていない画面**
> (`achievements`、`statistics`)を開いても照準は下がる。呼び出し箇所の一覧では覆えない。
>
> **そして 1 つ、reduced-motion で情報を落とさないようにした。** 参照実装のパルスは
> 1.45 倍のスケールで、それは装飾アニメーションなので `domain/accessibility.ts` の規定では
> reduced-motion で抑止される — **抑止するとその人はヒットのフィードバックを完全に失う。**
> ローディングバーの凍結と同じ形の間違いである。だから mx-ui では**ヒットは常に線が太くなり**
> (`weight` はパレットが宣言済みの `Distinguisher` である)、スケールはモーションが
> 許されているときの上乗せにした。**誰も信号を失わず、一部の人はアニメーションも得る。**
>
> **持ってこなかったもの**: `DomOperationsService`。参照実装の crosshair ファイルは
> trading / settings-overlay / inventory-renderer が import する汎用 DOM ファサードも
> 輸出しており、それは同居しているだけの別の仕事である。
> **中央に来ているかの検証も持ってこない** — それはレイアウトでブラウザが要る
> (`hud.e2e.ts:61-62`)。compose に残る。

> #16 / #17 が OBSOLETE なのは「弱い」からではなく、**新アーキテクチャで主張が消える**からである。
> 参照実装ではルールが合成層にあり、クリックが何を壊すかを合成層でしか確かめられなかったので、
> 「落ちないこと」が現実的な唯一の主張だった。ルールが mx-gameplay に移った今、
> 「掘ったら何が起きるか」は mx-gameplay のユニットテストで直接主張できる。

#### `player-controls.e2e.ts`(5 本 / 268 LOC)

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 20 | `keyboard movement changes camera view` | NEEDS-PUBLISH | **mc-compose**。入力(mc-render)→ 物理(mc-sim)→ カメラミラー(mc-render)。**3 stage・2 リポジトリをまたぐ**。plan.md §3.8 のカメラ姿勢反転に直接当たる |
| 21 | `hotbar slot 1 through 3 can be selected by number keys` | DEMOTE | **mx-ui**(+ mc-sim のホットバー状態)。1 画面<br>**移植済み(2026-07-27)** → `mx-ui/test/screen-mount.test.ts`。**数字キーは移植していない**(mc-render の持ち物)。移植したのは「選択されたと言われたスロットがどう見えるか」で、参照実装が `borderTopColor === 'rgb(255, 255, 255)'` というリテラルで見ていたところを `SLOT_SELECTED` トークン経由にした。**ONLY 性**(2 つ光らない)を足してある |
| 22 | `hotbar slots 4 through 9 can be selected by number keys` | DEMOTE | 同上。#21 と同じ主張の反復<br>**移植済み(2026-07-27)。#21 と統合**して 0..8 のパラメタライズド 9 本になった |
| 23 | `sprint key (ControlLeft) does not crash game` | **DEMOTE** | **mc-render** の入力バインディングテスト。ブラウザ不要<br>**移植済み(2026-07-27)** → `mc-render/test/movement-keys.test.ts` |
| 24 | `jump key (Space) does not crash game` | DEMOTE | 同上<br>**移植済み(2026-07-27)** → `mc-render/test/movement-keys.test.ts` |

#### 計測系 4 本

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 25 | `fps-threshold: sustained FPS meets platform threshold` | NEEDS-BROWSER | **mc-compose**。合成済みフレーム全体の実測。SwiftShader 前提の閾値ごと持ってくる |
| 26 | `perf-target: default settings — perf target window (30s)` | NEEDS-BROWSER | **mc-compose**。#25 の上位互換。統合を検討 |
| 27 | `perf-stage-baseline: stage perf baseline — regression check (30s window)` | NEEDS-BROWSER | **mc-compose**。**stage 別の時間内訳**を取るので、順序表の所有者にしか書けない。ただし計測そのものは `runFrame` に足さない — [responsibility.md](./responsibility.md) §2.2 のとおり、それは **stage を 1 本足す**話である |
| 28 | `long-run-stability: sustained mixed gameplay stays interactive and performant` | NEEDS-BROWSER | **mc-compose**。fiber リーク / メモリ増加。plan.md §3.8 |

#### 残り 8 本

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 29 | `inventory-management: fresh survival inventory shows an empty hotbar and visible crafting section` | DEMOTE | **mx-ui**。初期状態の DOM。タイトルは inventory だが、本体は「空のホットバーと crafting セクションが見えるか」しか見ておらず、**アイテムの出入りを 1 つも主張していない**<br>**移植済み(2026-07-27)** → `mx-ui/test/screen-mount.test.ts`。**元が持っていた分だけを移植した** — 主張していない「採掘 → インベントリ反映」は #32 に残したままである |
| 30 | `lighting-entities: game runs without subsystem errors and canvas shows lit, non-uniform terrain` | NEEDS-BROWSER | **mc-compose**。1 本で 3 つ(サブシステムのエラー無し・ライティング・mob 移動)を主張する 175 LOC。移植時は **3 本に割る** |
| 31 | `new-world-regression: terrain generation, night readability, and mob movement are observable` | NEEDS-BROWSER | **mc-compose**。219 LOC で 3 主張。同じく割る。`gameplay:time-weather` → 描画の経路を含む |
| 32 | `progression-loop: supports gather → craft → build → fight through the runtime loop` | NEEDS-BROWSER | **mc-compose。plan.md §3.15 の「採掘 → インベントリ反映」そのもの。** mx-gameplay(破壊)→ mc-sim(`InventoryService`)→ mx-ui(ホットバー)。**この 1 本が §3.15 の主張の (b) 側の代表である**([testing.md](./testing.md) §3.4)。§4 参照 |
| 33 | `user-flow: same-route playthrough stays interactive and performant` | NEEDS-BROWSER | **mc-compose**。#28 と重複気味。統合を検討 |
| 34-36 | `mobile-touch-controls`: `controls fit the safe viewport…` / `inventory and pause are operable without a keyboard` / `look gesture rotates the camera and releases cleanly` | DEMOTE ×2 + NEEDS-PUBLISH ×1 | 34・35 は **mx-ui**(1 画面のレイアウトと操作)。36 は **mc-compose**(タッチ → 入力 → カメラ。#20 と同じ経路のタッチ版)<br>**34・35 とも未移植(2026-07-27)。降ろし先の判定が誤りだった可能性がある。** mx-ui は `[data-touch-control]` を 1 つも作らない。作れない理由が構造的で、`application/dom-surface.ts` の冒頭に書いてある: タップは `addEventListener` であり、その動詞は語彙に無く、無いことが Escape の単一ハンドラを守っている(DN-UI-4)。**降ろし先を mc-render に訂正する(2026-07-27。推測ではなく計測による)。** 決め手は 2 つの `dom-surface.ts` の差である: mc-render の `application/dom-surface.ts:172` は `addEventListener` を**持つ**が、mx-ui の同名ファイルは**意図的に持たない**(DN-UI-4)。つまりタッチは mx-ui では構造的に書けず mc-render では書ける —— 「入力面だから」という言い方より、**語彙にその動詞があるか**のほうが検証可能な基準である。34 の残り半分(48px の当たり判定とセーフエリア)はレイアウトなので、どちらにせよブラウザが要る<br>**35 は移植済み(2026-07-27、第 3 波)** → `mc-render/test/touch-controls.test.ts`。**34 は入力側の半分だけ移植し、レイアウト側の半分は未移植のまま残した**(同ファイル。理由は §2.1)。**タッチは既存の語彙に合流させた。並行の語彙は作っていない** — オンスクリーンのコントロールは `InputAction` を担い、タップは `codeForTouchAction` で**その時点の束縛**へ解決される。だから `Bindings` は形を変えていない(1 アクション 1 コード、`remap` の衝突検査も 1 つの値空間のまま)。**`openInventory` を `KeyE` から `KeyI` に付け替えると、オンスクリーンのボタンも一緒に動く** —— これが 35 の主張の一番鋭い形である。**pause は Escape を 2 人目の所有者にせずに解いた**: タッチの pause は `ESCAPE_KEY_CODE` **そのもの**を出し、読むのは `ESCAPE_OWNER` が名指す唯一のフレームハンドラのままである(所有は「誰が押すか」ではなく「誰が処理するか」)。**DOM surface は 1 メンバーも増えていない** — コントロールは座標ではなく `event.target` の**同一性**で解決するので、`TouchList` も `clientX` も要らず、`test/fixtures/dom-surface.ts` の代入可能性証明は再議論不要だった。**タップはポインタロック取得経路に到達しない**(DN-16 §5(b) は閉じたまま。詳細は §3.5 の直後) |

#### 3.5.1 タッチを足すときに閉じたままにしなければならなかったもの(2026-07-27)

**#36 の所有は動いていない。** 「ドラッグでカメラが回り、きれいに離れる」は
NEEDS-PUBLISH のまま **mc-compose** のものである — それは**カメラに届くか**の主張であり、
mc-render はカメラの権威になることを禁じられている(ポーズは mc-sim が所有し、
逆向きは依存の循環になる)。**移したのは算術だけである。**
`touchLookStep` は mc-render の `domain/input-bindings.ts` にあり、
`notchesForWheelDelta` と同じ規則で置かれている(アダプタに置いた方針は
`environment: 'node'` が触れない)。罠は 2 つあり、どちらも #36 の文言そのものである:
`MouseEvent.movementX` は**すでに差分**だが `Touch` が返すのは**絶対座標**なので、
そのままカメラに渡すと**指の画面位置の分だけ視点が回る**。そして離したときに anchor を
忘れないと、**次のドラッグの最初の 1 フレームで前のドラッグの終点との差だけ視点が飛ぶ**
—— DN-09 が別のデバイスで再発した形である。

**そして、2 つ目の入力ソースを足すことは DN-16 §5(b) を開け直す絶好の機会だった。**
あの実害(HUD をクリックするとポインタロックを取ってしまう)は、
`landing !== 'ui'` という**開いた**判定ではなく
`landing === 'lock-target'` という**閉じた** 3 値で閉じられている。**その選択が、
タッチを安全に足せた理由そのものだった:**

- タッチの押下は `withCodeDown` を通り `withButtonDown` を通らないので、
  `uiClickLandings` に**エントリを作らない**。フレームはそこしか読まないので、
  タップは取得経路に**到達し得ない**。`attack` のコントロール(既定で `MouseLeft` に解決される)でも同じである。
- ブラウザがタップから合成する互換 `mousedown` は残るが、その `target` は**コントロールの要素**なので
  `resolveClickLanding` は `ui` か `elsewhere` を返し、`acquiresPointerLock` は `lock-target` を要求する。
- **開いた判定のままだったら、こうはならなかった。** ホストが宣言し忘れたコントロールは
  「UI ではない」と読まれ、**タップのたびにポインタを奪っていた**。
  閉じた判定の最悪ケースは「マウスルックが起動しない」で、それは 1 回目で目に見える。

### 3.6 `e2e/ui/` — 6 ファイル / 33 本 / 748 LOC

**33 本中 31 本が DEMOTE。** [testing.md](./testing.md) §3.2 の判断がここで数字になる。
これらは 1 画面の DOM 挙動であり、mx-ui の DOM テストとして、
ブラウザを起動せずに、はるかに速く検証できる。

| ファイル | 本数 | 判定 | 備考 |
| --- | ---: | --- | --- |
| `accessibility.e2e.ts` | 7 | **DEMOTE(7 本すべて)→ mx-ui** | 6 画面 + パラメタライズ 1。名前付けとコントラスト比は 1 画面で閉じる。**ただし 7 本のうち 6 本が同一のヘルパーを画面違いで呼ぶだけなので、mx-ui では 1 本のパラメタライズドテストになる**<br>**移植済み(2026-07-27)** → `mx-ui/test/accessibility-gate.test.ts`。**予想どおり 1 本のスイープになった** |
| `hud.e2e.ts` | 3 | DEMOTE ×2 → mx-ui / NEEDS-BROWSER ×1 → mc-compose | `#crosshair is visible`(#15 と重複)と `HUD remains usable at ${width}px` は mx-ui。`#fps-value updates with numeric content` は **フレームが実際に回っていること**の主張なので compose<br>**crosshair は移植済み(2026-07-27、第 2 波。#15 と同じファイル)。`HUD remains usable` は部分移植(2026-07-27)** → `mx-ui/test/accessibility-gate.test.ts`。**この 1 本が 39 本のうち唯一「mx-ui が NO と答えた」ものである** — 下の欄外を見よ |
| `inventory-overlay.e2e.ts` | 6 | **DEMOTE(6 本すべて)→ mx-ui** | 開閉・スロット要素・レスポンシブ・E/Escape。**すべて `ui:overlay-sync` のモーダル状態機械で、世界が要らない**<br>**4 本移植済み(2026-07-27)** → `mx-ui/test/modal-flows.test.ts` と `test/screen-mount.test.ts`。残り 2 本は下の内訳を見よ。**E キーそのものは移植していない** — `application/dom-surface.ts` に `addEventListener` が無く、キーは mc-render の持ち物である |
| `loading-screen.e2e.ts` | 1 | DEMOTE → mx-ui | 最低表示時間はローディング画面の内部規約<br>**移植済み(2026-07-27、第 2 波)** → `mx-ui/test/loading-screen.test.ts`。初回追記が「ローディング画面が書かれたときに、その画面のテストとして立つ」と予告したとおりに立った。予告どおり `domain/loading-screen.ts` は `domain/save-status.ts` と同じ形(時刻は引数、DN-UI-10)で、**参照実装が 90 秒のタイムアウトとストップウォッチで、しかも本来の 2,500 ms を CI ジッタのため 1,800 ms に緩めて問うていた 1 本が、境界の両側を厳密に問う算術になった** |
| `main-menu.e2e.ts` | 7 | DEMOTE ×5 → mx-ui / NEEDS-BROWSER ×2 → mc-compose | `New World confirm starts game session` と `Options opens settings before starting a world and returns to main menu` は **`Title → InGame` 遷移**を含むのでセッションライフサイクル = compose。残り 5 本はメニューの DOM<br>**5 本とも移植済み(2026-07-27、第 2 波)** → `mx-ui/test/main-menu.test.ts`。初回追記の「降ろし先の判定は正しく、まだ書かれていないだけである」(plan.md §3.13 はメニューを mx-ui に置いている)がそのまま解消した。**5 本ともクリックを駆動していたが、移植したのはクリックの後にメニューがどこにいるかである** — 下の欄外を見よ |
| `settings-overlay.e2e.ts` | 9 | DEMOTE ×8 → mx-ui / NEEDS-BROWSER ×1 → mc-compose | `persisted render distance is reflected in slider after page reload` だけがリロードをまたぐ。`render distance change persists immediately` と `quality selection persists immediately without Apply` は mx-ui + mc-render の設定適用で、**mx-ui に降ろしたうえで mc-render 側に対応するテストを置く**のが正しい割り方<br>**3 本移植済み(2026-07-27)** → `mx-ui/test/modal-flows.test.ts`。**設定画面そのものは mx-ui に無く、それは意図的である** — `mx-ui/test/screen-views.test.ts` の冒頭が理由を述べている(rebind は `KeyboardEvent.code` を要り、それはリスナを要り、リスナは語彙に無い)。移植できたのは**スタックの遷移**の側だけである |

#### 33 本の内訳(算数を検算できるように全部書く)

`accessibility.e2e.ts`(7 / DEMOTE 7):
`main menu` / `in-session HUD + settings overlay` / `inventory overlay` / `pause menu` /
`how to play overlay` / `death screen` / `${label}`(パラメタライズ) —
いずれも `all controls named and AA-contrasted`。

> **移植の中身(2026-07-27)。** 7 本が 1 本のスイープになったが、**画面は 7 つではなく 4 つである**
> — mx-ui が持っているのは HUD / inventory / captions / save-indicator で、
> main menu・pause menu・how to play はまだ書かれていない。death screen は HUD の**状態**であって
> 画面ではない(`application/hud-view.ts`「The HUD says 「dead」; it does not open a screen」)ので、
> 死んだプレイヤーを render することでスイープが見る。
>
> **コントラストの測り方は参照実装のものではない。** 参照実装は `getComputedStyle` で
> **ピクセル**を測っていた。`test/fake-dom.ts` は `var()` を解決せずレイアウトも持たないので、
> 逐語移植は何も測らないテストになる。代わりに、書かれた色をトークンに解決し直し、
> `surveyPalette()` が既に持っている**そのトークンの最悪読み**が床を超えているかを問う。
> **したがって拾えないものが 1 つ残る**: トークン単体では読めるが置かれた場所では読めない色。
> それはレイアウトであり、ブラウザが要る。compose に 22 本残っている理由と同じである。

`hud.e2e.ts`(3):
`#crosshair is visible after game loads`(DEMOTE)/
`#fps-value updates with numeric content`(**NEEDS-BROWSER → compose**)/
`HUD remains usable at ${viewport.width}px`(DEMOTE)。

> **`#crosshair is visible` は #15 と同じ 1 ファイルに移植した(2026-07-27、第 2 波)** →
> `mx-ui/test/crosshair.test.ts`。重複を 2 本のテストに開くことはしていない —
> 2 つのファイルが同じ主張を別の言葉で書いていたことこそが、
> `docs/e2e-triage.md` がこれを「#15 と重複」と記録した理由だからである。
> **移植版は元より強い**: 参照実装が問えたのは「attached であること」だけで、
> それはあの実装で `show()` が `document.body` に append し `hide()` が remove するからである。
> mx-ui には `removeChild` が無いので可視性は `hidden` 属性であり、
> **面白いほうの問い(いつ描かれないか)**が初めて問える。

> **`HUD remains usable` を移植したら赤になった(2026-07-27)。39 本のうち唯一である。**
> 参照実装はこの 1 本の中で `getByLabel('Health')` / `getByLabel('Hunger')` を使って
> 2 つの表示を掴んでいた。掴めるということは**名前が付いている**ということで、
> mx-ui の心臓と満腹の行には名前が無かった — 中身は `♡` と `○` の並びなので、
> スクリーンリーダーは「white heart suit」を 20 回読み上げ、
> **プレイヤーは餓死しかけているのか瀕死なのかを聞き分けられない**。
> `application/icon-element.ts` に `ICON_ROW_LABEL` を足し、行に `role="group"` と
> `aria-label` を付けた。**これがこの移植で唯一の実装コード変更である。**
> レイアウト側(320px で収まるか、crosshair が中央か)は移植していない — ブラウザが要る。

`inventory-overlay.e2e.ts`(6 / DEMOTE 6):
`hidden at startup` / `E key opens` / `contains slot elements when open` /
`usable at ${viewport.width}px` / `second E key closes` / `Escape key closes when open`。

> **4 本移植済み(2026-07-27)。** `hidden at startup`・`E key opens`+`second E key closes`
> (2 本で 1 つの往復になった)・`Escape key closes when open`・`contains slot elements when open`。
> **`Escape` の移植は元より強い**: 参照実装は途中で諦めて
> 「After Escape, either inventory or settings may be shown」と書き、FPS カウンタを読んで終えている。
> どの画面を見ているのか判別できなかったからである。移植版は 1 押下で 1 画面、
> かつポーズメニューが**下に開かないこと**まで問う。
>
> **`usable at ${width}px` は未移植。** 前半(要素が viewport に収まる)はレイアウトでブラウザが要る。
> **後半は矛盾するので移植してはならない**: 参照実装は最初のスロットに
> `role="button"` と `aria-label=/Inventory slot/` があり focus できることを主張しているが、
> mx-ui は**意図的にそうしていない** — `application/slot-element.ts`
> 「A slot has no activation, no `role="button"` and no click」。押せることは
> キーかポインタのイベントを要り、その動詞は `dom-surface.ts` に無い。
> **押せない control に `role="button"` を付けるのは、届くのに使えない control を作ることである。**
> これは移植の失敗ではなく、2 つのアーキテクチャが違う答えを出した点であり、記録に値する。

`loading-screen.e2e.ts`(1 / DEMOTE 1):
`keeps loading visible for a minimum duration before gameplay starts`。

> **移植の中身(2026-07-27、第 2 波)。** 参照実装のこの 1 本は、ページを起動し、
> メインメニューを最大 60 秒待ち、New World をクリックし、オーバーレイを最大 30 秒待ち、
> 1 秒眠ってから「2,500 ms のうち 1,800 ms は出ていた」と主張する。**緩めた 700 ms は
> ジッタのための保険であって、主張の一部ではない。** 本実装では
> `LOADING_MINIMUM_VISIBLE_SECS` は引数で来る時刻に対する算術なので(DN-UI-10)、
> **床のちょうど手前とちょうど上の両方**をマイクロ秒で問える。
>
> **床が「まだ働いている」と別物であることが、移植して初めて言えるようになった。**
> 参照実装にとってはどちらも `toBeVisible()` である。`loadingScreenView` は
> `{ kind: 'preparing', held: true }` を返し、`held` は DOM の
> `data-loading-held` にも出る — **ワールドは出来ていて、床だけが画面を支えている**状態である。
>
> **そして 1 つ、参照実装側の欠陥が出た。** `loading-screen.ts:67` は不定(indeterminate)の
> プログレスバーを描き、情報を運ばないので `aria-hidden` にしている。ところが `:123` の
> reduced-motion 分岐はアニメーションを外したうえで**バーを `left:29%;width:42%` に置き去りにする**。
> OS にアニメーションを切ってくれと頼んだプレイヤーにとって、揺れていたはずのものは
> **3 分の 1 ほど進んだ確定的な進捗に見える静止バー**になり、二度と動かない —
> つまり遅いロードがハングしたロードに見える。`domain/accessibility.ts` は
> reduced-motion を「せっかちな人のためではなく、乗り物酔いする人のため」と書いている。
> **凍った不定バーはそのどちらにも応えず、最も無視しにくい層に向かって数字を捏造する。**
> だから mx-ui のローディング画面はバーを描かない。**言葉だけである。**

`main-menu.e2e.ts`(7):
`shows title, play buttons, and Options`(DEMOTE)/
`Options opens settings before starting a world and returns to main menu`(**compose**)/
`New World flow shows world name input and confirm button`(DEMOTE)/
`New World confirm starts game session`(**compose**)/
`New World cancel returns to main menu root`(DEMOTE)/
`Load World back button returns to root`(DEMOTE)/
`no fatal startup errors on menu display`(DEMOTE)。

> **移植の中身(2026-07-27、第 2 波)。DEMOTE 5 本ぜんぶと、#2。**
>
> **クリックは移植していない。** 5 本とも `page.click('#mm-new-world')` で駆動していたが、
> それは `test/modal-flows.test.ts` の E キーや `test/screen-mount.test.ts` の数字キーと同じで、
> mc-render の持ち物である(plan.md §2.3-2)。mx-ui が持つのは**押した後にメニューがどこにいるか**で、
> それは `domain/main-menu.ts` の純関数である。
>
> **設定画面が無い理由がここには当てはまらない**ことを先に確かめてある。
> `mx-ui/test/screen-views.test.ts` 冒頭の主張は「rebind はキーストロークそのものが全部なので、
> キーを取り除くと何も残らない」であり、それは正しい。**メニューからクリックを取り除くと
> 遷移が残る** — 現に 5 本のうち 3 本(`New World cancel`、`Load World back`、
> `New World flow` の可視性の半分)はポインタについて何も言っておらず、
> **どのカードが上にいるか**だけを問うている。
>
> 移植して強くなった点が 3 つある。
>
> 1. **往復が「根に戻った」ではなく「元の値に戻った」になった。** 参照実装は
>    `#mm-new-world` が再び見えることを見ており、**2 枚目のカードを下に開いたまま**でも
>    それは満たされる。`backToRoot(openPanel(s, ...))` が `s` と `toStrictEqual` であることは満たさない。
> 2. **空の名前の置換が画面に出た。** `main-menu-handlers.ts:282` の
>    `trimmed.length > 0 ? trimmed : 'New World'` は**確定ハンドラの中**にあるので、
>    参照実装のカードは空欄を見せたまま「New World」という名前の世界を作れる。
>    **プレイヤーに見せた文字列と作られる世界の名前が違い、テストからは見えない。**
>    `worldNameLabel` は 1 か所しかないので、カードが見せる名前が作られる名前である。
> 3. **`no fatal startup errors on menu display` は「落ちない」の言い換えなので捨てた。**
>    §3.5 が #16 / #17 について既に述べたとおりである。代わりに置いたのは全状態の網羅で、
>    **どの状態でもカードがちょうど 1 枚**であることを問う。**2 枚出ていても 0 枚でも、
>    コンソールには何も出ない。**
>
> **`role="button"` は 1 つも付けていない。** §3.6 が `usable at ${width}px` の後半について
> 出した判断(「押せない control に `role="button"` を付けるのは、届くのに使えない control を
> 作ることである」)は、**ボタンでできているメニューにこそ効く**。
> `accessibility-gate.test.ts` のフォーカス可能物の国勢調査に、メインメニューは
> **0 / 0 の行として載っている** — 押せるようになった日に更新しなければならない行として。
>
> **Load World のセーブ一覧は「空」ではなく `unknown` である。** mc-save に訊く手段が無いので、
> `application/inventory-view.ts` が防具立てについて出した答えをそのまま使った:
> 空の一覧は「あなたに世界はありません」という**主張**であり、それが誤っている相手は
> 世界がぜんぶ残っているプレイヤーである。
>
> **`onEsc` を持ってこなかったことも記録に値する。**
> `main-menu-handlers.ts` の末尾はメニュー自身の Escape ハンドラで、
> `preventDefault()` を呼んでサブ状態を根に戻す — セッション側に既に 1 つある
> (`session-runtime-overlays.ts:151` が自分で困っていると書いている)のに、である。
> **DN-UI-4 が禁じている 2 人目の所有者そのものである。** だから `backToRoot` は関数であって
> リスナではなく、フレーム側の単一ハンドラが `escapePressed` と同じ資格で呼ぶ。

`settings-overlay.e2e.ts`(9):
`Escape key opens` / `second Escape key closes` / `pause -> settings -> resume returns to active gameplay state` /
`#settings-close button closes overlay` / `#settings-apply button is not rendered` /
`#rd-input slider is interactable` / `render distance change persists immediately` /
`quality selection persists immediately without Apply`(以上 8 本 DEMOTE)/
`persisted render distance is reflected in slider after page reload`(**compose**)。

> **3 本移植済み(2026-07-27)** → `mx-ui/test/modal-flows.test.ts`。
> `pause -> settings -> resume`(**9 本のうち最も価値がある** — 唯一、列を最後まで辿る)、
> `#settings-close button closes overlay` と `second Escape key closes` は
> **1 本に統合した**: 2 つの閉じ方が同じスタックに着くこと自体が主張だからである
> (参照実装は自分のソースで同じ問題を記録している —
> `session-runtime-overlays.ts:151`「paths (Escape, M key, Save & Quit) with no shared open/close stream」)。
> `Escape key opens` は既存の `test/accessibility.test.ts` が既に持っている。
>
> **4 本未移植。** `#rd-input slider is interactable` / `render distance change persists immediately` /
> `quality selection persists immediately without Apply` は**設定画面そのものを要る**。
> mx-ui にそれが無いのは欠落ではなく判断で、`test/screen-views.test.ts` の冒頭が
> 段落 1 つを使って述べている。永続化は mc-save の側でもある。
> `#settings-apply button is not rendered` は §3.6 の判断どおり**削除**した。

#### タイトルより主張が弱い 2 本(参照実装側の欠陥)

- **`#settings-apply button is not rendered`**(`settings-overlay.e2e.ts:107`)。
  「Apply ボタンが無い」ことしか見ていない。意図は「Apply 無しで即時反映される」なので、
  主張すべきは反映のほうである。移植するなら**削除**し、#131/#167 の即時反映テストに統合する。
- **`fresh survival inventory shows an empty hotbar and visible crafting section`**(#29)。
  ファイル名が `inventory-management.e2e.ts` で 1 本しかなく、
  **アイテムの追加も削除も移動も 1 つも主張していない**。
  「インベントリ管理の E2E がある」と読める名前で、実体は初期表示の確認である。
  plan.md §3.15 が名指しする「採掘 → インベントリ反映」を本当に検証しているのは
  #32 の `progression-loop` **1 本だけ**である。

### 3.7 `e2e/production-smoke.e2e.ts` — 1 本 / 34 LOC

| # | test() | 判定 | 行き先・必要なもの |
| --- | --- | --- | --- |
| 70 | `built app boots without runtime ReferenceError` | NEEDS-BROWSER | **mc-compose**。`dist` に対して走る唯一のテスト。dev サーバでは通ってビルドで落ちる種類の問題を拾う。**publish + ビルドパイプラインが要る** |

## 4. 「採掘 → インベントリ反映」は今日書けるか — **書けない**

plan.md §3.15 が E2E の存在理由として名指しする 1 本(#32)を、
今日の契約のまま繋げられるかどうかを実際に追った。**繋がらない。**
理由は 3 つあり、**どれか 1 つを直しても残りが残る**。

### 4.1 publish されていない

mc-compose の `dependencies` は `effect` のみで、`node_modules` に `@nerima-games/*` は無い。
兄弟リポジトリも全部 `effect` だけである。import が書けない。

### 4.2 型が繋がらない — `BlockId` は数値、`ItemId` は文字列

| 側 | 宣言 | 場所 |
| --- | --- | --- |
| 出す側 | `{ _tag: 'Broken'; yielded: BlockId }` / `BlockId = number` | `mx-gameplay/domain/interactions/break-block.ts:44`、`mx-gameplay/domain/chunk-store-port.ts:95` |
| 受ける側 | `add: (item: ItemId, count: number) => Effect.Effect<number>` / `ItemId = string` | `mc-sim/application/inventory-service.ts:21`、`mc-sim/domain/inventory.ts:31` |

**壊れたブロックは数値の `BlockId` を返し、インベントリは文字列の `ItemId` を取る。**
間を埋める `BlockId → 落ちるアイテム` の解決は mc-kernel にあり
(`domain/block-registry.ts` の `BlockId`、`domain/block-harvest.ts:115` の
`resolveDropItem(rule, brokenBlock: BlockType): BlockType`)、
**返すのは `BlockType` であって `ItemId` ではない**。
mc-kernel は `ItemId` / `ItemType` / `ItemStack` を**まだ 1 つも定義していない** —
mc-sim 自身が `domain/inventory.ts:25-31` でそう書いている:

> A bare `string` on purpose, and PROVISIONAL. `ItemType` is mc-kernel's vocabulary
> (plan.md §3.1) and will be a literal union with exhaustiveness checking.

繋ぐには `BlockId -> BlockType -> (drop rule) -> ItemType` の 3 段が要り、
**その 3 段目が存在しない**。

### 4.3 サービスのインスタンスを 1 つに保てない — **構造の問題**

これが一番重い。仮に 4.1 と 4.2 が解けても残る。

- `InventoryService` に**書く**のは mx-gameplay の `gameplay:interactions`。
  今日は書けないので `state.minedItems: Ref<ReadonlyArray<BlockId>>` という
  **アウトボックス**に積んでいる(`mx-gameplay/stages/registration.ts:114-121`。
  「`minedItems` is an OUTBOX … Until mc-sim is published there is no
  `InventoryService.add` to call」と自分で書いている)。**そのアウトボックスを抜く者は誰もいない。**
- `InventoryService` を**読む**のは mx-ui の `ui:hud-sync`。
  今日は `state.snapshot` という Ref で、これも FIRST CUT
  (`mx-ui/stages/registration.ts:95-97`)。
- 両者は**同じ 1 つのインスタンス**を見なければならない。2 つ作れば掘った物は表示されない。
- ところが `StageRegistration.run` の R チャネルは `FrameServices = ClockPort` だけなので、
  mx-gameplay は**登録時に**`InventoryService` を acquire するしかない
  (kernel の `GameModule.frameStages` が Effect である理由。mc-render が `InputService` で
  実際にやっている)。すると `registerModule` の `RRegister` に `InventoryService` が乗り、
  **それを discharge するのはホスト**である。
- ホストは mc-compose のブラウザエントリポイント([porting.md](./porting.md) §2)。
  **mc-compose は mc-sim を import できない** — `transitive-import` として
  `pnpm check:deps` が非ゼロ終了する([responsibility.md](./responsibility.md) §3.1)。

つまり **「両者が共有する 1 つの `InventoryService` を、誰がどこで構築するのか」に
今日の契約は答えを持っていない。** mc-render の `InputService` が成立するのは、
それが mc-render **自身の** `ROut` にあり、mc-render がホワイトリストに入っているからである。
`InventoryService` は mc-sim のもので、mc-sim はホワイトリストに入っていない。

**この問いは 1 リポジトリからは立てられない。** mx-gameplay は「書く先が要る」としか言えず、
mx-ui は「読む先が要る」としか言えず、mc-sim は誰が自分を構築するかを知らない。
**plan.md §3.15 が E2E を最終ゲートと呼ぶ理由の、これ以上ない実例である**
— そして「緑になるテスト」より、**繋がらないと分かったことのほうが価値が高い**。

### 4.4 したがって

#32 は **NEEDS-PUBLISH** ではなく、**設計上の未決事項を 1 つ含む**。
publish 待ちのリストに入れる前に、
「`InventoryService` のインスタンスを誰が構築し、どの Layer に載せるか」を決める必要がある。
[design-notes.md](./design-notes.md) の未検証表に項目として立てた。

## 5. 移植の順番(publish 待ちの解け方)

| 段階 | 解ける本数 | 前提 |
| --- | ---: | --- |
| 今 | **0**(70 本のうち) | — |
| mc-kernel publish | 0 | 契約型が入るだけ。E2E は 1 本も動かない |
| mc-render + mc-sim publish + ブラウザエントリポイント | **#1, #3, #4, #7, #18, #20, #25, #26, #27, #28, #36** = 11 本 | 入力・物理・カメラ・フレーム計測。うち #18 / #20 / #36 はブラウザ不要 |
| + mx-gameplay / mx-ui | **#30, #31, #33** + `hud: #fps-value` + `main-menu` 2 本 + `settings: persisted render distance` = 7 本 | ただし #32 は §4.3 の未決事項が先 |
| + mc-save | **#10, #11** = 2 本 | セーブ / ロード |
| + mx-multiplayer のトランスポート実体(骨格へのフェーズ追加は**完了**。DN-15) | **#12, #13, #14** = 3 本 | 2 クライアント |
| + ビルド / publish パイプライン | **#70** = 1 本 | `dist` に対して走る唯一のテスト |
| + `InventoryService` の所有者決定(§4.3) | **#32** = 1 本 | plan.md §3.15 の本丸 |
| **compose 合計** | **25 本** | |

DEMOTE 43 本は publish を待たない。**mx-ui へ 39 本、mc-render へ 2 本、mc-save へ 2 本**であり、
いずれもブラウザ抜きで、はるかに速く書ける。
それが [testing.md](./testing.md) §3.2 の言う「E2E の本数が増え続けるなら
compose にロジックが溜まっている兆候」の予防そのものである。

**39 対 25 という比が、この triage の 2 番目の結論である。**
参照実装の E2E の 6 割は mx-ui のものであり、E2E であった理由は
「mx-ui という境界が無かったから」でしかない。

## 6. ヘルパーをどう移すか

参照実装のヘルパー 558 LOC は 1 本も今は要らない(RUNNABLE-NOW が 0 本なので、
移す先の spec がまだ 1 本も無い)。移すときの判断:

| ファイル | 行き先 |
| --- | --- |
| `fixtures/game-page.ts` | **mc-compose**。合成済みゲームのページオブジェクトであり、まさに compose の対象 |
| `helpers/console-monitor.ts` | **mc-compose**。「起動時にエラーが出ていないこと」は全 Layer をまたぐ主張 |
| `helpers/db-helpers.ts` | **mc-save**。IndexedDB の操作 |
| `helpers/wait-helpers.ts` | **mc-compose**。フレームが進むのを待つ = 合成済みフレームの概念 |
| `helpers/touch-helpers.ts` | **mx-ui**(#34-35 の降ろし先)+ mc-render(#36) |
| `helpers/qa-globals.d.ts` | **mc-compose**。ただしキーは `__NERIMA_GAMES_QA__` に変える。[testing.md](./testing.md) §3.3 |
