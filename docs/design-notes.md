# 設計注意(参照実装の実測知見)

参照実装 `takeokunn/ts-minecraft` を**仕様書兼テストオラクル**として読み、
再発させてはならない事象を抽出したもの。

**各項目は「名前付き回帰テスト」として書いてある。**
参照実装のパスは `<reference-impl>` 起点。
行番号・LOC は実測(2026-07-26)。

---

## DN-0: 合成層へのロジック堆積 — このリポジトリの存在理由

**回帰テスト名**:
- `rejects reaching past the experience modules to mc-sim, and names the path`(lint boundary)
- `exports nothing that sounds like a game rule, an entity or a world`(`test/public-api.test.ts`)

**実装**: 両方とも実装済み

**根拠**(すべて `wc -l`、`.test.ts` を除いた本体のみ):

```console
$ find packages/app/application -name '*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
 20737 total
$ find packages/app/application/frame/stages -name 'interaction-*.ts' -not -name '*.test.ts' | wc -l
40
$ find packages/app/application/frame/stages -name 'interaction-*.ts' -not -name '*.test.ts' | xargs wc -l | tail -1
  3317 total
```

| 対象 | 実測 LOC |
| --- | ---: |
| `packages/app/application/` | **20,737** |
| └ `frame/` | 11,082 |
| &nbsp;&nbsp;&nbsp;└ `frame/stages/` | 9,030 |
| &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└ `stages/interaction-*.ts`(40 ファイル) | 3,317 |
| └ `main/` | 7,948 |
| └ `multiplayer/` | 900 |
| └ `mods/`(= `mod-api.ts`) | 123 |
| └ `application/` 直下のファイル(6 ファイル) | 684 |

第 1 階層の 5 項目 11,082 + 7,948 + 900 + 123 + 684 が **20,737 に一致する**（過不足なし）。
直下 684 の内訳は [porting.md](./porting.md) §1。

`interaction-*.ts` の 40 ファイル 3,317 LOC は、plan.md §3.11 が **mx-gameplay** に割り当てている内容
(採掘・設置・アイテム使用のルール)である。

**何が問題か**: ルールが合成層にあると、そのルールを検証するために合成された全体が必要になる。
参照実装で「採掘したらインベントリに入る」を確かめる手段は **E2E しか無かった**
— ブラウザを起動し、ワールドを生成し、プレイヤーをスポーンさせて、ようやく 1 つのルールが検証できる。
plan.md §1 の出発点そのものである:

> 単一リポジトリ(84k LOC)では「正しく動くことが保証される単位」が大きすぎ、正しさを検証しきれない

**20,737 LOC はどれも、書かれた時点では局所的に妥当だった。**
「ここに置くのが一番簡単だから」の積み重ねである。
だから対処は「気をつける」ではない:

1. **依存境界が物理的に禁じる。** mc-compose の合成層が直接 import してよいのは 4 つの mx-*、
   mc-render、kernel などの明示された公開 API だけである。mc-sim を直接必要とするコードは
   書けず、`.oxlintrc.json` の `no-restricted-imports` を通じて `pnpm lint` が落とす
2. **`runFrame` に何も足さない。** try/catch も計測も条件分岐も無い
3. **公開 API の名前検査**(弱いが、追加のその場所に規範を置く)

---

## DN-1: stage 全順序の解決は決定論でなければならない

**回帰テスト名**:
- `produces the identical order for the identical input, every time`
- `produces the same order regardless of the order registrations arrive in`

**実装**: `test/stage-order.test.ts`(実装済み)

**根拠**: 参照実装には「順序制約を宣言 → 全順序を解決」という仕組みが**無い**。
`packages/app/application/frame/` は 11,082 LOC あり、
`frame-stage-executor.ts` / `frame-stage-executor-helpers.ts` が実行を担うが、
順序はコード上のハードコードされた並びである。

**何が問題か**: トポロジカルソートには複数の正解がある。
実行ごとに別の正解を選ぶ実装だと、フレーム順序に起因するバグが**たまにしか再現しない**。
リプレイ可能であることを前提にしたシミュレーション(plan.md §5.1-3「クロック注入による決定論」)にとって、
これは最悪の失敗様式である。

**本実装での対処**: tie-break を**全順序**にする — skeleton 上の**フェーズ位置**、次に id の辞書順。
2 つの異なる stage が「等しい」と比較されることは(id が一意なので)決してない。
その全域性が再現性を保証する。部分順序の比較子だと、
結果が `Array.prototype.sort` の安定性と挿入順序に左右される。

なお、この tie-break が**実際に効いている**ことは自明ではなかった。DN-4.1 を参照。

---

## DN-2: 循環は**経路とともに**報告する

**回帰テスト名**:
- `rejects a two-stage cycle and reports the actual path`
- `reports only the cycle, not every stage that failed to be placed behind it`
- `detects a cycle created by a module fighting the skeleton chain`

**実装**: `test/stage-order.test.ts`(実装済み)

**根拠**: 参照実装の `scripts/check-package-dag.ts` は循環を**許可リスト**で正規化していた
(mc-kernel README が「参照実装は 6 つの循環を co-evolution ペアとして合法化していた」と記録)。

**何が問題か**: 「stage に循環があります」は 15 リポジトリにまたがると行動不能である。
どのモジュールの誰が何を宣言したせいなのかが分からない。

さらに重要なのは **3 番目のテスト**である:
モジュール A が「skeleton 上で自分より後の stage の後に走る」と宣言したとき、
**A の宣言も skeleton も、単体では何も間違っていない**。
循環は compose がマージしてはじめて存在する。
これこそが「全順序をモジュールではなく resolver が所有する」理由である。

---

## DN-3: `after` が存在しない stage を指してもエラーにしない

**回帰テスト名**:
- `drops an edge naming an unregistered stage instead of failing`
- `reports every dropped edge so a typo is visible without being fatal`

**実装**: `test/stage-order.test.ts`(実装済み)

**根拠**: mc-kernel `domain/frame.ts` が契約として明記している:

> `after` declares ordering edges only — it is not a dependency on the other stage existing.
> A stage that names an absent stage is scheduled as if the edge were absent, so a module can
> express "run me after input, if there is input" without taking a dependency on the input repository.

**何が問題か**: エラーにすると、モジュールがビルドのモジュール集合に依存する。
mx-redstone を積まないビルドで「redstone の後に走る」と書いた mod がロードできなくなる。

一方、**黙って落とす**と `after` の id のタイプミスが不可視になる。
stage は単にどこか別の場所で走るだけで、誰も気づかない。

**本実装での対処**: 落としたうえで `StageOrderPlan.dangling` として**報告**する。
致命的にせず、可視にする。

---

## DN-4: skeleton の暗黙エッジは「stage が入ったフェーズの間」だけに張る

**回帰テスト名**:
- `closes the chain over a skeleton stage that no loaded module registered`
- `closes over a phase no loaded module populates`

**実装**: `test/stage-order.test.ts`(実装済み)

**何が問題か**: skeleton の連鎖を「表の全要素」から作ると、
stage が 1 つも入らなかったところで鎖が切れる。
流体モジュールを積まないビルドでは `entities` と `redstone` の間のエッジが消え、
**辞書順の tie-break にフォールバックしてフレーム順序が黙って変わる**。

**本実装での対処**: 実際に stage が登録された**フェーズ**だけを skeleton 順に並べ、
隣接するフェーズの全ペアにエッジを張る。空のフェーズは鎖を**閉じる**。

**同じフェーズの中には 1 本もエッジを張らない。** `redstone:power` と `redstone:effects` は
どちらも `simulation:redstone` に属するが、どちらが先かは mx-redstone にしか言えない
(自分の `after` で宣言する)。compose はフェーズを並べ、モジュールはフェーズ内で自分を並べる。
`honours the modules’ own after-edges inside a phase, without needing to know them` がこれを固定している。

---

## DN-4.1: 骨格が**フェーズ**でなければ、1 本もエッジを出していなかった

**回帰テスト名**:
- `pins how each phase claims a stage, which is what makes the table load-bearing`(`test/public-api.test.ts`)
- `claims every stage id the roster actually registers`(同上)
- `differs from the lexicographic fallback, which is what the old skeleton degraded to`
- `produces the §4.2 frame from registrations that declare no ordering at all`
- `places redstone between fluids and time/weather, which no module is allowed to declare`

**実装**: `test/stage-order.test.ts` / `test/public-api.test.ts`(実装済み)

**何が問題だったか**: `STANDARD_STAGE_SKELETON` は当初、
`simulation:physics` / `simulation:interactions` / `hud-sync` といった
**具体的な stage id の平坦なリスト**で、登録との照合は文字列の完全一致だった。

**そのどれ 1 つとして、登録するモジュールは存在しない。**
plan.md §4.1 の id 規約は `<owning-repo-suffix>:<stage>` であり、
モジュールは自分の stage を自分で名付ける — 実際に登録されるのは
`sim:physics` / `gameplay:interactions` / `redstone:power` / `ui:hud-sync` である。

したがって照合は常に空振りし、

- **暗黙エッジ(DN-4)は 1 本も張られず**、
- `priorityOf` は全 stage に `MAX_SAFE_INTEGER` を返し、
- **tie-break(DN-1)は純粋な辞書順に退化していた**。

plan.md §4.2 の骨格は装飾だった。実ビルドのフレームは
`camera-mirror` → `gameplay:entities` の順に走る。`c` が `g` より前だからである。

**発見しにくい種類の欠陥である。** `test/stage-order.test.ts` は skeleton の**正規 id を直接登録して**
検証していたので、当然すべて緑だった。表は自分自身に対しては正しく効いていた
— ただ、誰も表の言葉で登録していなかった。

**本実装での対処**: 骨格を `ReadonlyArray<StagePhase>` にする。
1 つのフェーズは `{ name, members }` で、id は**名前部分**(最後の `:` より後ろ)で所属を宣言する。
`members` の要素が `:` で終わるときだけ、名前空間まるごとが一致する。

**§2.3-3 は緩んでいない。** 名前空間は所有者を、名前は仕事の種類を言うだけで、
どちらも絶対位置ではない。`interactions` がフレームのどこで走るかを決めるのは今も compose だけである。

テストも直した。`the skeleton constrains a REAL build, not just its own canonical ids` の
describe は、**ロスターが実際に登録する id だけ**を使って §4.2 のフレームが出ることを検証する。
`differs from the lexicographic fallback` は、その結果が辞書順の答えと**違う**ことを見ている
— 同じだったら、このテストは何も検証していないことになる。

---

## DN-5: セッションのティアダウンは飛ばせない状態にする

**回帰テスト名**:
- `has no edge from InGame straight to Title`
- `reaches Title only through TeardownCompleted`
- `reaches InGame on the second world exactly as on the first`
- `survives ten round trips with no accumulated state`

**実装**: `test/session.test.ts`(実装済み)

**根拠**: plan.md §3.8 設計注意(参照実装の実測知見):

> **ゲームループ・自動保存は `forkDaemon`**(スコープ非依存)+ 明示 `stop()`。
> 参照実装では **2 周目ワールドのデッドロック/やり残し fiber が最大級のバグ源**だった。
> アプリスコープのシングルトンは**再入可能な初期化**を最初から

**何が問題か**: 「2 周目」が問題のすべてである。
ワールドを 1 回ロードするのはどの実装でも動く。
タイトル → ゲーム → タイトル → ゲームで初めて、
残った fiber・1 回しか初期化できないシングルトン・
消えたワールドに対して走り続ける自動保存スケジュールが露出する。

**本実装での対処**: `InGame` から `Title` への直行エッジを**作らない**。
終了は必ず `Unloading` を通り、`TeardownCompleted` だけが `Title` に到達する。
ティアダウンは呼び出し側が忘れられるものではなく、セッションが**通過しなければならない状態**になる。

ロード失敗も同じ扱いにする(`LoadFailed -> Unloading`)。失敗したロードも何かを確保しており、
そのままタイトルへ戻すのが「1 回目の失敗が 2 回目を汚染する」経路である。

**このファイルは fiber を止めない。** *いつ*ティアダウンするかを言い、*何が*ティアダウンかは言わない。
実際に止めるのは、始めたモジュールの仕事である。

---

## DN-6: QA API は「もう 1 つのアクセサ」で膨らむ

**回帰テスト名**:
- `rejects two modules claiming the same namespace`
- `publishes a detached snapshot, so a test cannot mutate the real registry`
- `publishes onto the target object it is given, not onto a global`

**実装**: `test/qa-api.test.ts`(実装済み)

**根拠**: 参照実装は window にデバッグオブジェクトを生やしている。

`packages/app/application/main/qa-api.ts:171`:

```typescript
Reflect.set(window, '__TS_MINECRAFT_QA__', makeQaApi(deps, stagedResourceBlocksRef, stagedZombiePositionRef))
```

**plan.md §3.15 の見積り「~1.4k」は実質的に正しい。**（以前ここに「見積りより大きい」と
書いていたのは、計数条件を混同した誤りである。[porting.md](./porting.md) §0.2 と同じ訂正。）

実測:

```console
$ find packages/app/application/main \( -name 'qa-api*.ts' -o -name 'qa-spatial*.ts' \) | xargs wc -l | tail -1
  2708 total
$ wc -l packages/app/application/main/qa-spatial.test.ts
  60
```

| 計数条件 | ファイル数 | LOC | plan.md「~1.4k」との差 |
| --- | ---: | ---: | --- |
| **本体のみ**（本書の他の LOC と同条件） | 14 | **1,395** | **5 行**。ほぼ一致 |
| テスト込み | 16 | 2,648 | 1.9 倍 |

`qa-api*.ts`(全 15 ファイル、テスト込み)+ `qa-spatial.ts`(83)= 2,648 LOC。
本書の LOC はすべて `.test.ts` を除いた本体のみで数えているので、
plan.md の見積りの正誤は **1,395 と比べて判断すること**。
2,648 はテスト込みの規模を知りたいときのために残してある。

内訳(本体): qa-api-visual 181 / qa-api-debug-state 179 / qa-api 172 /
qa-api-rendering 145 / qa-api-inventory 127 / qa-api-world 121 / qa-api-perf 105 /
qa-spatial 83 / qa-api-combat 81 / qa-api-mob-ai 51 / qa-api-redstone 49 /
qa-api-village 49 / qa-api-env 33 / qa-api-settings 19。

**何が問題か**: QA API は「もう 1 つアクセサを足す」が常に局所的に妥当な場所である。
そしてアクセサ 1 本ごとに、E2E スイートがモジュール内部への私的な扉を 1 つ手に入れる。
これが「E2E だけが何かを検証できる」状態への道である。

**本実装での対処**:

1. **QA コマンドは所有モジュールが名前空間ごと提供し、compose はマージするだけ。**
   compose はコマンドを**書かない**。mc-sim のインベントリを読む QA コマンドが要るなら、
   mx-gameplay(または mc-sim)が公開し、compose がその名前空間の下に出す。
   ここで書こうとすると体験モジュールを飛び越えることになり、`pnpm lint` が落とす
2. **名前衝突はすべて致命的。** last-one-wins の shadowing は、
   E2E が別モジュールを検証して**成功する**という結果を生む。
   E2E が最終ゲート(plan.md §3.15)である以上、黙って間違うゲートはゲートが無いより悪い
3. **`globalThis` に触らない。** 公開先はオブジェクト引数。
   プラットフォーム固定を避け、DOM 無しでインストール経路をテストできる
4. **公開するのは毎回新しいプレーンオブジェクト。** 生の Map を渡すと、
   E2E テストがレジストリを書き換え、次のテストがビルドの生成しなかった surface に対して走る
5. **キーを `__NERIMA_GAMES_QA__` に改名。** 古い名前に固定された E2E が
   古いビルドに対して黙って通るのを防ぐ

---

## DN-7: mod は一級のモジュールにする

**回帰テスト名**:
- `composes alongside first-party modules through the same path`
- `rejects a mod registering a core stage id`

**実装**: `test/modding.test.ts`(実装済み)

**根拠**: 参照実装の `packages/app/application/mods/mod-api.ts` は 123 LOC の独立した仕組みである。

**何が問題か**: mod 専用の仕組みを作ると、モジュール契約の**弱い複製**ができる。
一級モジュールにできて mod にできないことが増え、
「mod でやるには mod-api に穴を開ける」という力が働き続ける。

**本実装での対処**: `acceptMod` はただの `GameModule` を返し、
`composeGame` が mx-gameplay のものとまったく同じ経路でマージする。
mod 専用フックも優先度も pre/post パスも無い。

**唯一の制約が stage 名前空間**である。mod の stage は `mod:<modId>:<stage>` でなければならない。
これが無いと mod は各フェーズの正規 id(`simulation:physics` など)を登録でき、
実在する physics と衝突する(`DuplicateStage` で捕まる)か、
あるいは — physics 抜きのビルドが出荷された瞬間 — **黙って physics フェーズそのものになる**。

なお `mod:<modId>:<stage>` は**名前部分でフェーズに参加できる**。
`mod:extra-ores:physics` は physics フェーズに落ち、`mod:mine:tick` はどのフェーズにも属さず
(それも正当で)、フェーズを持つ全 stage の後ろに決定論的に並ぶ。
`gives a stage in no phase no phase, which is legal and keeps it schedulable` と
`gives a module stage outside the skeleton a deterministic position` が両方を固定している。

---

## DN-8: E2E は最終ゲートであり、それ以外の何かにしない

**回帰テスト名**: `produces exactly the §4.2 order from the ids the roster really registers` ほか
**実装**: `test/e2e/roster-frame-order.test.ts` はフレーム側を固定し、現行の
browser composition gate は [testing.md](./testing.md) §3.5 にまとめている。
採掘から同じ frame で inventory drop が一回だけ反映される専用シナリオは残課題であり、
70 本 1 本ずつの初期判定は [e2e-triage.md](./e2e-triage.md) に履歴として残している。

**根拠**: 参照実装の E2E は `e2e/` にある。plan.md は「64 本」と書いているが、実測は異なる。

```console
$ find e2e -name '*.e2e.ts' | wc -l
23
$ grep -rhcE "(^|[^.a-zA-Z])test\(" e2e --include='*.e2e.ts' | paste -sd+ | bc
70
$ find e2e -name '*.e2e.ts' | xargs wc -l | tail -1
  2875 total
```

**23 スペックファイル / 70 テスト / 2,875 LOC**(拡張子は `.spec.ts` ではなく `.e2e.ts`)。
ヘルパーと fixture が別に 558 LOC。

| ディレクトリ | ファイル | test() | LOC |
| --- | ---: | ---: | ---: |
| `e2e/gameplay/` | 12 | 22 | 1,577 |
| `e2e/ui/` | 6 | 33 | 748 |
| `e2e/multiplayer/` | 1 | 3 | 236 |
| `e2e/persistence/` | 1 | 3 | 108 |
| `e2e/smoke/` | 1 | 7 | 104 |
| `e2e/contracts/` | 1 | 1 | 68 |
| `e2e/production-smoke.e2e.ts` | 1 | 1 | 34 |

**何が問題か**: 参照実装では E2E が**唯一の検証手段**になっていた。
ルールが合成層にあったからである(DN-0)。

**本実装での対処**: E2E は最終ゲートとして必ず維持する(plan.md §8)が、
**それは「モジュール間の相互作用しか検証しない」ことを意味する**。
「採掘 → インベントリ反映」のような境界をまたぐ経路だけが E2E の対象であり、
1 モジュール内で閉じることは、そのモジュールのユニット/シナリオテストで検証する。

E2E の本数が増え続けるなら、それは compose にロジックが溜まっている兆候である。

---

## DN-9: delta time のクランプを合成層に置かない

**回帰テスト名**: `passes the delta through untouched — no clamp, no rounding, no first-frame special case`
**実装**: `test/composition.test.ts`(実装済み)

**根拠**: plan.md §3.4 の実測知見:

> deltaTime は `min(max(0.001, raw), 0.05)` にクランプ、初回フレームは 0.016

**何が問題か**: この定数は**シミュレーションの不変条件**である。
合成層に置くと、それは合成層に置かれた物理定数であり、
「compose の追加コードは Layer 合成と stage 順序表だけ」の最初の例外になる。
最初の例外が 20,737 LOC の始まりである。

**本実装での対処**: `runFrame` は delta をそのまま渡す。
`9_999` も `0` も `-1` も素通りする。クランプは delta を**生成する側**が行う。

---

## DN-10: カメラ姿勢のミラーは名前の付いた 1 回の出来事にする

**回帰テスト名**: `is input -> simulation -> camera-mirror -> chunk-sync -> post-fx -> render -> hud-sync`
**実装**: `test/stage-order.test.ts`(実装済み。順序の担保のみ)

**根拠**: plan.md §3.8 / §5.1-2:

> **カメラ所有権**: 参照実装は THREE カメラが正でシミュレーションが描画から視線を読む逆転構造だった
> (「camera.position を読むな matrixWorld を使え」という慢性 gotcha の根源)。
> 新実装は sim が姿勢を所有し、THREE カメラはミラー

**本実装での対処**: `camera-mirror` を skeleton 上の**独立したフェーズ**として置く。
コピーの方向が、名前が付いていて、順序が決まっていて、1 フレームに 1 回だけ起きる出来事になる。
6 つの `simulation:*` フェーズの後、`chunk-sync` と `render` の前。

---

## DN-11: stage の R チャネルを落とすと、契約どおりの stage が 1 つも走らせられない

**回帰テスト名**: `accepts a stage written against kernel's contract, ClockPort and all`
**実装**: `test/composition.test.ts`(実装済み)

`domain/composition.ts` の `StageRegistration.run` は `Effect<void>` を返していた。
**R チャネルを落としていた。** 要求は勝手に消えないので、kernel の
`Effect<void, never, ClockPort>` はその型に代入できない。

にもかかわらず `composeGame` がコンパイルできていたのは、`mx-gameplay` / `mx-redstone` / `mx-ui` が
それぞれのミラーで `FrameServices = never` と宣言していたからにすぎない。
3 つとも kernel 公開時にそのファイルを削除すると明言している。**その瞬間に落ちる時限爆弾だった。**

**本実装での対処**: `run` は `Effect<void, never, FrameServices>` を返す。
`FrameServices` と `ClockPort` は `@nerima-games/mc-kernel` から直接 import する —
compose 側で kernel の型・Tag を再宣言しない。`compose` は stage の著者ではなく提供者なので、
公開 kernel のサービス契約をそのまま使うことで、名前と実行時 Tag のずれをなくす。
`test/kernel-integration.test.ts` が branded time、ClockPort、FrameServices、固定時計 Layer の
公開契約を直接検証する。compose の `StageRegistration` は、kernel の generic な登録 API ではなく、
登録後に stage を順序付けて実行するこのリポジトリ固有の境界として残している。

discharge は `ComposedGame.runFrameWith(services: Layer<FrameServices>)` である。
この経路に `any` は 1 つも無いので、`Effect.provide` は要求を**消去ではなく除去**する。

---

## DN-12: `ModuleLayer` の `RIn` を締め、合成時に `ROut` の union を保持する

**回帰テスト名**: `rejects a module whose Layer still needs a service, at compile time` /
`does not claim that a composed layer provides erased services`
**実装**: `test/composition.test.ts`(実装済み)

`ModuleLayer = Layer<any, any, any>` だと `Effect.provide(game.layer)` は要求を
**discharge するのではなく消去する**。どのモジュールも提供していないサービスを要求する Effect が
型検査を通り、実行時に `Service not found` で落ちる。
`tsc` はこれを `exactOptionalPropertyTypes` 経由で偶発的にしか捕まえない。

**本実装での対処**: `Layer<never, unknown, never>`。`Layer` の `RIn` は共変(`out RIn`)なので、
これは「モジュールは自己完結して届かなければならない」を型で言うことになる。
新しい規則ではない — モジュールは対等であり(`Layer.merge`、`Layer.provide` ではない)、
他モジュールのサービスを構築に要求するモジュールは plan.md §2.3-1 が禁じるエッジそのものである。

**`ROut` は合成時に締める。** const generic の異種配列から提供サービスの union を推論し、
`game.layer` 経由の `Effect.provide` がその union を要求から除去する。明示的に `GameModule` として
消去された配列だけは `never` となる。**フレームの経路にも穴は無い**(DN-11)。

---

## DN-13: 誰も読まないフィールドは報告ではない

**回帰テスト名**: `surfaces a dropped after edge on the composed game` /
`surfaces a stage the skeleton does not recognise, without rejecting it`
**実装**: `test/composition.test.ts`、`test/stage-order.test.ts`(実装済み)

DN-3 は「ダングリングエッジは拒否せず**報告する**」と書いている。
ところが `StageOrderPlan.dangling` には**ロスター中どこにも消費者が無かった**。
リゾルバは忠実に計算し、誰も見ていなかった。それでは DN-3 の後半が成り立っていない。

同じ問題がもう 1 つあり、そちらは計算すらされていなかった。名前がどの phase にも一致しない stage は
`priorityOf` が `MAX_SAFE_INTEGER` を返し、暗黙エッジも張られず、**黙ってフレーム末尾に落ちる**
(`domain/stage-order.ts`)。これは合法であり(mod の stage が予定表に乗る仕組みそのもの)、
同時に `render:daw` と見分けがつかない。

**本実装での対処**: 何も強制せず、両方を報告する。
`StageOrderPlan` が `dangling` と `unmatchedPhase` を運び、`describeStagePlanWarnings` が
両方を行に落とし、`ComposedGame.warnings` がホストに見せる。
言うことが無ければ空配列なので、ホストは長さを見ずに常に印字してよい。

強制しない理由は DN-3 と同じである。ダングリングエッジは
「input があるなら input の後」を表明する正規の手段であり、拒否するとその語法が消える。

---

## DN-14: ロスターのリポジトリ間 `after` エッジは、**4 本とも宙に浮いている** → **解決**

**状態**: **解決済み**(2026-07-27)。mc-sim が `sim:physics` を登録し、4 本すべてが繋がった。
以下は当時の記述と、繋いだ結果の実測である。

**回帰テスト名**: `binds every cross-repository edge, and they all point at mc-sim` /
`drops nothing: no declared edge names a stage that is absent` /
`binding mc-sim’s four edges did not move any other stage`
**実装**: `test/e2e/roster-frame-order.test.ts`(実装済み)

**実測**(2026-07-27、`test/e2e/roster.ts` の転記と `pnpm check:roster` による照合):

当時、ロスター全体で登録されている stage は **13 本**、宣言されている `after` エッジは **12 本**。
そのうち 8 本は**同一リポジトリ内**(自分の 2 本を並べているだけ)であり、
リポジトリ境界をまたぐのは **4 本だけ**であった:

| 宣言している stage | `after` | 宣言箇所 |
| --- | --- | --- |
| `gameplay:interactions` | `sim:physics` | `mx-gameplay/stages/stage-ids.ts:71` |
| `redstone:power` | `sim:physics` | `mx-redstone/stages/stage-ids.ts:57` |
| `ui:hud-sync` | `sim:physics` | `mx-ui/stages/stage-ids.ts:49` |
| `render:camera-mirror` | `sim:physics` | `mc-render/stages/stage-ids.ts:124` |

**そして `sim:physics` を登録しているリポジトリは 1 つも無い。**
mc-sim には `stages/` ディレクトリが存在せず、`docs/responsibility.md:50` は
「mc-sim は `after` 制約を宣言するだけ」としか書いていない。

**何が問題か**: 単体では問題ではない。ダングリングエッジは合法であり(DN-3)、
落として報告するのが正しい。**問題は本数である。**
**リポジトリ間の順序制約は 4 本しか存在せず、その 4 本が全部落ちている。**
つまり今日のビルドでは、**あるリポジトリを別のリポジトリより先に走らせているものは
`STANDARD_STAGE_SKELETON` しか無い。** 順序表が load-bearing なのではなく、
**load-bearing のすべて**である。

これは 1 リポジトリからは絶対に見えない。mx-gameplay は
「`sim:physics` の後に走らせてくれ」と正しく宣言しており、それが無視されていることを
知る方法が無い。mc-sim は自分が何を求められているかを知らない。
**合成層だけがこの数を数えられる。** plan.md §3.15 が E2E を最終ゲートと呼ぶ理由の実例である。

**本実装での対処**: 強制しない、報告する — DN-3 / DN-13 のとおり。当時
`ComposedGame.warnings` は 4 行を返し、そのすべてが stage 名と `sim:physics` を名指ししていた。
加えて `stays consistent with §4.2 once mc-sim registers sim:physics` が
**mc-sim が `sim:physics` を登録した日にフレームが動かないこと**を先に固定していた。

### DN-14 の決着(2026-07-27)

mc-sim が `stages/` を作り `sim:physics` を登録した
(`mc-sim/stages/registration.ts:167`、`stages/stage-ids.ts:86`、`after` は無し)。
`pnpm check:roster` の `compareSilentModule` がそれを検出して落ちた
— **人間が気づいたのではなく、ゲートが気づいた**。

**予測は当たっていた。フレームは動かなかった。**
`sim:physics` は 1 本挿さり、他の 13 本は**順序を 1 つも変えなかった**
(mx-multiplayer を含まない構成で index 1、含む構成で index 2)。
ダングリングは 4 → 0、`warnings` は 4 行 → 0 行。

**それでもこのエッジは冗長ではない。** 骨格を外すと差が出る:
以前は骨格を外したフレームで 3 つの因果が壊れていたが、**エッジが繋がった今は 1 つが直っている**
(`render:input` が `gameplay:interactions` と `render:draw` より前に来る。
どちらも `sim:physics` 経由で到達されるようになったため)。
残る破れは 2 つで、**どちらも体験モジュールの境界をまたぐ**ため §2.3-1 によりどのモジュールも
`after` で表現できない — つまり **mc-compose にしか言えないことだけが残った**。
「順序表が load-bearing のすべて」は、「順序表だけが言えることを言っている」に変わった。
回帰テスト `without it, the frame breaks in exactly the ways no module may repair`。

## DN-15: 骨格に `multiplayer:` を拾うフェーズが無い → **解決**

**状態**: **解決済み**(2026-07-27)。骨格に `network:inbound` と `network:outbound` を足した。
設計上の議論は [architecture.md](./architecture.md) §4.5 に置いてある(ここは経緯)。

**回帰テスト名**: `without the two network phases, both multiplayer stages run after the HUD` /
`has no position at all as a single `multiplayer:` namespace phase` /
`applies remote state BEFORE the simulation reads it, as inbound asked` /
`publishes settled state at the end of simulation, before any presentation` /
`costs a build without mx-multiplayer nothing at all`
**実装**: `test/e2e/roster-frame-order.test.ts`(実装済み)

**当時の実測**: plan.md §4.2 の骨格は 12 フェーズあり、そのどれも `multiplayer:` 名前空間も
`sync` のような名前も `members` に持たない。mx-multiplayer の stage 登録は
未実装である(`mx-multiplayer/docs/responsibility.md:17`)ため、今日は表面化しない。

**何が問題か**: mx-multiplayer が最初の 1 本を登録した瞬間、
それはどのフェーズにも一致せず、`priorityOf` が `MAX_SAFE_INTEGER` を返し、
**HUD の後ろ、フレームの最後尾で走る**。リモートピアの状態が毎フレーム 1 フレーム遅れて
適用されるという症状になり、これは「バグ」ではなく「ラグ」に見えるので誰も報告しない。

報告はされる(`unmatchedPhase` と `warnings`。DN-13)。それがリゾルバの正しい振る舞いである。
**足りないのは報告ではなく、報告の読み手である。**

### DN-15 の決着(2026-07-27)

**予測は 1 文字も外れていなかった。** mx-multiplayer が `multiplayer:inbound` と
`multiplayer:outbound` を登録し、実測でインデックス **14 と 15**、`ui:overlay-sync` の後ろに落ちた。
`unmatchedPhase` は 2 本とも報告した。しかも mx-multiplayer は**自分の側から同じ数値を測って
`stages/stage-ids.ts:36-51` に書いていた** — 両側が同じ欠陥を独立に測り、
どちらも自分では直せなかった(`StageRegistration` に `before` が無いため)。

対処は骨格への 2 フェーズ追加で、**プルリクエストに理由が要る種類の編集**である。
理由は [architecture.md](./architecture.md) §4.5、
コード上の論拠は [stage-skeleton.ts](../domain/stage-skeleton.ts) にある。要点だけ:

1. **何もしないことは中立ではない。** この表に「未配置」は無く、拾われない stage は最後に走る。
   待つことはフレームを未決にすることではなく、誤った答えを出荷し続けることである。
2. **単一の `multiplayer:` 名前空間フェーズには置ける位置が 1 つも無い。**
   physics より前は `multiplayer:outbound after sim:physics` と骨格の鎖が**循環**になり合成が失敗する。
   physics より後は `inbound` が 1 フレーム遅れる。これは mx-multiplayer が書いた理由より強い。
3. **早すぎるコストはゼロと実測した。** mx-multiplayer を含まないビルドではフレームが 1 本も変わらない。

**DN-15 が残したもの**: `RESERVED_STAGE_PREFIXES` に `network:` を足した。
このノートは「13 個目のフェーズを足すとその正規 id が予約されないままになる」と
`test/modding.test.ts` の中で自分自身の使用例を予言していて、それがそのまま起きた
(13 個目と 14 個目だった)。予約漏れは、**mx-multiplayer を含まないすべてのビルドで
mod がそのフェーズになれる**ことを意味する。

---

## 未検証・要調査

| 項目 | 状態 |
| --- | --- |
| `FrameServices` の実体 | **確定**。`ClockPort` のみ(mc-kernel `docs/freeze-checklist.md` (b))。DN-11 |
| `ModuleLayer` の `ROut` union | `composeGame` の const generic で保持。明示的消去時のみ `never`。DN-12 |
| stage の障害処理(`Effect.catchAllCause` を誰が張るか) | 未決。plan.md §3.8 は sim に対して defect のログ出力を求めている |
| 自動保存の `Schedule.spaced`(plan.md §3.8) | mc-sim 側。compose は stage 順序だけ |
| フレーム予算 / adaptive quality | 参照実装は `frame-adaptive-quality.ts` を持つ。**compose には置かない** |
| **`sim:physics` を誰が登録するのか** | **解決。DN-14。** mc-sim が登録した(`stages/registration.ts:167`)。4 本のエッジはすべて繋がり、フレームは動かなかった |
| **mc-sim の `GameModule` を誰がホストに渡すのか** | **解決。** `apps/web/main.ts` が公開 `mc-sim` API の `registerModule` を呼び、解決済み stage を composition に登録する |
| **`InventoryService` のインスタンスを誰が構築するのか** | **解決。** `mx-gameplay` の公開 `makeGeneratedWorld` が generated `ChunkStore` と同じ `InventoryService` / Player / Entity / Time services を構築し、host はその `world.layer` を共有する |
| **`BlockId`(数値)から canonical `ItemType` への解決を誰が持つか** | **解決。** `mc-sim` の `ItemType` は `mc-kernel` から再公開され、`mx-gameplay` の block vocabulary が drop をその型へ橋渡しする |
| **ネットワーク同期のフェーズ位置** | **解決。DN-15。** `network:inbound`(input と physics の間)/ `network:outbound`(time-weather と camera-mirror の間)を骨格に追加。§4.2 の**拡張**であり転記ではない([architecture.md](./architecture.md) §4.5) |
| E2E の (b) 側(振る舞いの相互作用) | 現行 browser composition gate は実装済み。[testing.md](./testing.md) §3.5。ホストは次フレームのブロック状態遷移を `data-breaks-completed` として観測する。依存 API が返す同一フレームの drop → inventory reflection と、その一回性を検証する専用シナリオは残課題 |
| E2E ハーネス(Playwright、SwiftShader、ポインタロック不可) | 実装済み。[playwright.config.ts](../playwright.config.ts) と `pnpm e2e:browser` |
