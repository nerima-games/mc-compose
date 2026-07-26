# 公開 API

`@nerima-games/mc-compose` のバレルは `index.ts` である。
`test/public-api.test.ts` がこの一覧をピン留めしている。

## 1. stage 全順序の解決(`domain/stage-order.ts`)— 中核

```typescript
type StageId = string & Brand<'StageId'>          // 非空文字列
type StageConstraint = { readonly id: StageId; readonly after?: ReadonlyArray<StageId> }

type StageOrderPlan = {
  readonly order: ReadonlyArray<StageId>          // 単一の全順序 = フレーム
  readonly dangling: ReadonlyArray<{ stage: StageId; missing: StageId }>
}

type StageOrderError =
  | { _tag: 'DuplicateStage'; id: StageId }
  | { _tag: 'StageCycle'; cycle: ReadonlyArray<StageId> }   // 経路。先頭が末尾に再出現

type StagePhase = {
  readonly name: string                      // フェーズ名。同時にそのフェーズの正規 StageId
  readonly members: ReadonlyArray<string>    // どの stage id がこのフェーズに属するか
}

const stagePhase: (name: string, ...members: ReadonlyArray<string>) => StagePhase
const phaseAdmits: (phase: StagePhase, id: StageId) => boolean
const phaseOf: (skeleton: ReadonlyArray<StagePhase>, id: StageId) => StagePhase | undefined

const resolveStageOrder: (
  constraints: ReadonlyArray<StageConstraint>,
  options?: { readonly skeleton?: ReadonlyArray<StagePhase> },
) => Either<StageOrderPlan, StageOrderError>

const describeStageOrderError: (error: StageOrderError) => string
```

### 契約

| 保証 | 内容 |
| --- | --- |
| **決定性** | 同じ入力からは常に同じ順序。tie-break は skeleton 上の**フェーズ位置** → id 辞書順の**全順序** |
| **登録順非依存** | モジュールを並べた順序が結果に影響しない |
| **循環は経路つき** | `StageCycle.cycle` は実際の経路。先頭ノードが末尾に再出現する |
| **循環の最小報告** | 循環の後ろで配置できなかっただけの stage は報告に含めない |
| **dangling は非致命** | 未登録の stage を指す `after` は落として `dangling` に報告 |
| **自己エッジは無視** | 「自分の後に走る」は無意味であって循環ではない |
| **重複 id は致命** | どちらが走るかが恣意的になるため |

### `skeleton` は stage id の列ではなく **フェーズ**の列である

`skeleton` は `ReadonlyArray<StagePhase>` を取る。フェーズは**フレーム内の位置**と
**そこに入る仕事の種類**を名指すもので、stage id は自分の**名前部分**でそこへの所属を宣言する。

| `members` の要素 | 何と一致するか | 例 |
| --- | --- | --- |
| `:` で終わる | id の**名前空間**全体 | `redstone:` は `redstone:power` と `redstone:effects` |
| それ以外 | id の**名前**部分(最後の `:` より後ろ) | `physics` は `sim:physics` とも裸の `physics` とも一致 |

複数のフェーズに一致する id は**最も早いフェーズ**に属する(列が権威)。
したがって `render:input` は render ではなく input である。

**モジュール側は何も得ない。** 名前空間は「誰が所有するか」を、名前は「どんな仕事か」を言うだけで、
絶対位置を名乗る手段はどこにも増えていない — plan.md §2.3-3 はそのまま保たれる。
`interactions` がどこで走るかを決めるのは、今も mc-compose だけである。

### `skeleton` オプションの 2 つの役割

1. **暗黙の順序エッジ。** 実際に stage が登録された**フェーズ**を skeleton 順に並べ、
   隣接するフェーズの全ペアにエッジを張る。
   **stage が 1 つも入らなかったフェーズは鎖を閉じる** — 流体モジュール抜きのビルドでも
   entities は redstone の前に走る。
   **同じフェーズに落ちた 2 つの stage の間にはエッジを張らない** —
   `redstone:power` と `redstone:effects` の順序は mx-redstone 自身の `after` が決める。
   compose はフェーズを並べ、モジュールはフェーズ内で自分を並べる
2. **第一の tie-break。** 順序関係を持たない 2 つの stage は、辞書順ではなくフェーズの位置に落ちる。
   どのフェーズにも属さない stage(mod の stage など)は、属する stage すべての**後ろ**に回る

#### なぜフェーズでなければならなかったか(回帰)

skeleton は以前 `simulation:physics` / `hud-sync` のような**具体的な id の平坦なリスト**であり、
登録との照合は文字列の完全一致だった。**それらの id を登録するモジュールは 1 つも無い。**
plan.md §4.1 の規約が `<owning-repo-suffix>:<stage>` である以上、モジュールが登録するのは
`sim:physics` / `gameplay:interactions` / `redstone:power` / `ui:hud-sync` である。
結果として照合は常に空振りし、暗黙エッジは 1 本も張られず、`priorityOf` は全 stage に
`MAX_SAFE_INTEGER` を返し、**tie-break は純粋な辞書順に退化していた**。
plan.md §4.2 の骨格は装飾であり、実ビルドでは `camera-mirror` が `gameplay:entities` より先に走る
(`c` が `g` より前だから)。

固定しているテストは `test/public-api.test.ts` の
`pins how each phase claims a stage, which is what makes the table load-bearing` と
`claims every stage id the roster actually registers`。
前者は `members` を、後者は「今日ロスターが実際に登録する 14 個の id が全部どこかのフェーズに落ちる」ことを見る。

## 2. stage 順序表(`domain/stage-skeleton.ts`)

```typescript
const STANDARD_STAGE_SKELETON: ReadonlyArray<StagePhase>
const SIMULATION_PHASES: ReadonlyArray<StagePhase>
const SIMULATION_STAGES: ReadonlyArray<StageId>     // 各シミュレーションフェーズの正規 id

// フェーズ本体。`name` と、そこに所属を宣言できる `members`。
const STAGE_PHASE_INPUT            // 'input'                    <- ['input']
const STAGE_PHASE_SIM_PHYSICS      // 'simulation:physics'       <- ['physics']
const STAGE_PHASE_SIM_INTERACTIONS // 'simulation:interactions'  <- ['interactions']
const STAGE_PHASE_SIM_ENTITIES     // 'simulation:entities'      <- ['entities']
const STAGE_PHASE_SIM_FLUIDS       // 'simulation:fluids'        <- ['fluids']
const STAGE_PHASE_SIM_REDSTONE     // 'simulation:redstone'      <- ['redstone', 'redstone:']
const STAGE_PHASE_SIM_TIME_WEATHER // 'simulation:time-weather'  <- ['time-weather', 'weather']
const STAGE_PHASE_CAMERA_MIRROR    // 'camera-mirror'            <- ['camera-mirror']
const STAGE_PHASE_CHUNK_SYNC       // 'chunk-sync'               <- ['chunk-sync', 'mesh-sync']
const STAGE_PHASE_RENDER           // 'render'                   <- ['render', 'draw']
const STAGE_PHASE_POST_FX          // 'post-fx'                  <- ['post-fx']
const STAGE_PHASE_HUD_SYNC         // 'hud-sync'                 <- ['hud-sync', 'ui:']

// 各フェーズの正規 StageId(= `phase.name`)。フェーズ丸ごとを所有するモジュールが
// そのまま登録できる名前であり、`domain/modding.ts` が mod に対して予約する名前でもある。
// フェーズから導出しているので、表と id が食い違うことはない。
const STAGE_INPUT              // 'input'
const STAGE_SIM_PHYSICS        // 'simulation:physics'
const STAGE_SIM_INTERACTIONS   // 'simulation:interactions'
const STAGE_SIM_ENTITIES       // 'simulation:entities'
const STAGE_SIM_FLUIDS         // 'simulation:fluids'
const STAGE_SIM_REDSTONE       // 'simulation:redstone'
const STAGE_SIM_TIME_WEATHER   // 'simulation:time-weather'
const STAGE_CAMERA_MIRROR      // 'camera-mirror'
const STAGE_CHUNK_SYNC         // 'chunk-sync'
const STAGE_RENDER             // 'render'
const STAGE_POST_FX            // 'post-fx'
const STAGE_HUD_SYNC           // 'hud-sync'
```

plan.md §4.2 の骨格:

```
input
  -> simulation (physics -> interactions -> entities -> fluids -> redstone -> time/weather)
  -> camera-mirror
  -> chunk-sync
  -> render
  -> post-fx
  -> hud-sync
```

ロスターが今日登録している id が、どのフェーズに落ちるか:

| フェーズ | 実際に落ちる id | 所有者 |
| --- | --- | --- |
| `input` | `render:input` | mc-render |
| `simulation:physics` | `sim:physics` | mc-sim |
| `simulation:interactions` | `gameplay:interactions` | mx-gameplay |
| `simulation:entities` | `gameplay:entities` | mx-gameplay |
| `simulation:fluids` | `gameplay:fluids` | mx-gameplay |
| `simulation:redstone` | `redstone:power`、`redstone:effects` | mx-redstone |
| `simulation:time-weather` | `gameplay:time-weather` | mx-gameplay |
| `camera-mirror` | `render:camera-mirror` | mc-render(正は mc-sim) |
| `chunk-sync` | `render:chunk-sync` | mc-render |
| `render` | `render:draw` | mc-render |
| `post-fx` | `render:post-fx` | mc-render |
| `hud-sync` | `ui:hud-sync`、`ui:overlay-sync` | mx-ui |

**この配列を変えるとゲームが変わる。**
このリポジトリへの差分の中で、PR に理由の記述が要ると想定されている唯一のものである。
`test/public-api.test.ts` の
`pins the standard stage skeleton (plan.md §4.2) so a reorder is always deliberate` が並びを、
`pins how each phase claims a stage, which is what makes the table load-bearing` が
各フェーズの `members` を固定している。**後者も同じだけ重要である** — `members` を落とせば、
並びを保ったまま表が再び効かなくなる。

各エッジの根拠は `domain/stage-skeleton.ts` の各定数の doc コメントにある。

## 3. Layer 合成(`domain/composition.ts`)

```typescript
type DeltaTimeSecs = number & Brand<'DeltaTimeSecs'>   // kernel のブランドそのもの
type FrameServices = ClockPort                          // kernel の確定した答え
type StageRegistration = {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect<void, never, FrameServices>
}
type ModuleLayer = Layer<any, any, never>               // RIn だけは never に締めてある
const EMPTY_MODULE_LAYER: ModuleLayer

type GameModule = {
  readonly name: string          // 診断用。分岐に使わない
  readonly layers: ModuleLayer
  readonly frameStages: ReadonlyArray<StageRegistration>   // 登録**済み**
}

type ComposedGame = {
  readonly plan: StageOrderPlan
  readonly layer: ModuleLayer
  readonly runFrame: (dt: DeltaTimeSecs) => Effect<void, never, FrameServices>
  readonly runFrameWith: (services: Layer<FrameServices>) => (dt: DeltaTimeSecs) => Effect<void>
  readonly moduleNames: ReadonlyArray<string>
  readonly warnings: ReadonlyArray<string>
}

const composeGame: (modules, options?) => Either<ComposedGame, StageOrderError>
const mergeModuleLayers: (modules) => ModuleLayer
const collectStages: (modules) => ReadonlyArray<StageRegistration>
const registerModule: <RRegister>(module) => Effect<GameModule, never, RRegister>
```

### `run` が R チャネルを運ぶ（旧: `Effect<void>`）

**以前は R チャネルを落としていた。** 要求は勝手に消えないので、kernel の
`Effect<void, never, ClockPort>` はその型に**代入できない**。にもかかわらず `composeGame` が
コンパイルできていたのは、`mx-gameplay` / `mx-redstone` / `mx-ui` の 3 つがそれぞれのミラーで
`FrameServices = never` と宣言していたからにすぎない。3 つとも kernel 公開時にそのファイルを削除すると
明言しており、その瞬間にこのリポジトリはコンパイルしなくなるはずだった。

`test/composition.test.ts` の
`accepts a stage written against kernel's contract, ClockPort and all` が
kernel の契約どおりに書かれた stage を直接組み立てて固定している。

### `runFrame` は運び、`runFrameWith` が discharge する

`Layer<FrameServices>` は `Layer<ClockPort, never, never>` であり、この経路に `any` は 1 つも無い。
だから `Effect.provide` は要求を**消去するのではなく除去**する。
`ClockPort` を discharge するのは合成層の仕事そのものである — 時計を読む stage と、
それを実装するプラットフォームアダプタの両方が見える唯一のリポジトリだからである。

### `DeltaTimeSecs` はブランド付きになった

以前は素の `number` だった。**ロスター全体で `StageRegistration.run` を実際に呼ぶ唯一の場所が
ここである**以上、素の `number` は「全モジュールの全 stage が誰も検証していない値を渡される」を意味する。
kernel の refine（有限かつ非負）をそのまま持ってきてある。
plan.md §3.4 のクランプ `min(max(0.001, raw), 0.05)` は**ブランドの一部ではなく**、
このリポジトリも適用しない（[design-notes.md](./design-notes.md) DN-9）。

### `warnings` — リゾルバが飲み込んでいたもの

`StageOrderPlan.dangling` にはロスター中どこにも**消費者が無かった**。
リゾルバは忠実に計算し、誰も見ていなかった。誰も読まないフィールドは報告ではないので、
「ダングリングエッジは拒否せず報告する」は実際には成り立っていなかった。

同じ問題がもう 1 つあり、そちらは計算すらされていなかった。名前がどの phase にも一致しない stage は
`priorityOf` が `MAX_SAFE_INTEGER` を返し、**黙ってフレーム末尾に落ちる**。
これは合法（mod の stage が予定表に乗る仕組みそのもの）であり、同時に `render:daw` と見分けがつかない。

**何も強制せず、両方を報告する。** `StageOrderPlan` が `dangling` と `unmatchedPhase` を運び、
`describeStagePlanWarnings` が両方を行に落とし、`ComposedGame.warnings` がそれをホストに見せる。
言うことが無ければ空配列なので、ホストは長さを見ずに常に印字してよい。

### `registerModule` — kernel の `GameModule` との橋

kernel の `GameModule.frameStages` は配列ではなく
`Effect<ReadonlyArray<StageRegistration>, never, RRegister>` である
（モジュールが stage を**組み立てる**ためにサービスを取得できる瞬間がそこにしか無いため。
mc-kernel `docs/freeze-checklist.md` (b)）。

その Effect は起動時に 1 回だけ走り、`composeGame` はその後に走る。
だからこのリポジトリが合成する型は kernel のそれの `frameStages` を評価済みにしたものである。
境界をそこに置いてあるのは `composeGame` を純粋な `Either` のまま保つためで、
全順序の解決は id とエッジに対する計算であり、他人のコンストラクタの都合で
ファイバを借りて算術をするのは筋が悪い。

`registerModule` は 3 行のアダプタで、`RRegister` が現れる唯一の場所である。
そこで消去していないのは意図的で、discharge するのはホストであり、ホストはその型を持っているからである。

### `composeGame` がやることは 3 つだけ

1. モジュールの Layer をマージする
2. stage 全順序を解決する(`resolveStageOrder` に委譲)
3. その順序で stage を走らせる Effect を返す

**stage を覗かない。条件で包まない。走るべきかを判断しない。**
条件付きで走らない stage は、その判断を自分の `run` の中に持つ。

### `runFrame` にあえて無いもの

try/catch なし、stage 単位の時間計測なし、条件付きスキップなし、予算なし。
delta はクランプせずそのまま渡す
([design-notes.md](./design-notes.md) DN-9)。

### `EMPTY_MODULE_LAYER` が必要な理由

`Layer` は `in ROut`(反変)で宣言されているため、`Layer<never, ...>` は
`Layer<any, ...>` に代入できない(`any` が `never` に代入できる必要があり、
`never` は `any` が代入できない唯一の型である)。
実モジュールの Layer はすべて問題なく代入できる。空 Layer だけが例外であり、
この定数がその例外の封じ込め場所である。

### `ModuleLayer` の `RIn` は `never` に締めた。`ROut` は締められていない

以前は `Layer<any, any, any>` だった。`RIn` が `any` だと `Effect.provide(game.layer)` は
要求を **discharge するのではなく消去する** — どのモジュールも提供していないサービスを要求する
Effect が型検査を通り、実行時に `Service not found` で落ちる。
`tsc` はこれを `exactOptionalPropertyTypes` 経由で偶発的にしか捕まえない。

`Layer` の `RIn` は共変(`out RIn`)なので、`Layer<X, E, R>` が `Layer<any, any, never>` に
代入できるのは `R` が `never` のときだけである。つまり**モジュールは自己完結して届かなければならない**。
これは新しい規則ではない。モジュールは対等であり(`Layer.merge`、`Layer.provide` ではない)、
他モジュールのサービスを構築に要求するモジュールは plan.md §2.3-1 が禁じる依存エッジそのものである。
プラットフォームハンドルを要求するモジュールは、`composeGame` に渡す**前に**それを受け取る
——ホスト側にはまだそれを満たす型がある。

**残る不健全さを明記しておく**: `ROut` は依然として `any` である。`composeGame` は
サービス型の異なるモジュールの異種配列を取るので、その和を正確に書くには可変長タプル型が要る。
したがって `Effect.provide(game.layer)` は「要求されたサービスをどれかのモジュールが提供しているか」を
検査できない。**ただしこの穴はフレームの経路には無い** — `runFrame` は `FrameServices` を自分の型に
書いており、`runFrameWith` は正確に型付けされた Layer に対して discharge する。
`test/composition.test.ts` の
`KNOWN LIMIT: ROut stays erased, so a missing service still fails at runtime, not at tsc`
が、これを驚きではなく既知の穴として固定している。

## 4. セッションライフサイクル(`domain/session.ts`)

```typescript
type SessionState = Title | Loading | InGame | Paused | Unloading
type SessionEvent =
  | WorldSelected | LoadSucceeded | LoadFailed
  | PauseRequested | ResumeRequested | QuitToTitleRequested | TeardownCompleted

const initialSessionState: SessionState
const transition: (state, event) => SessionState | undefined
const runSession: (from, events) => { state, rejectedAt: number | undefined }
const isSimulating: (state) => boolean
const holdsWorldResources: (state) => boolean
const currentWorld: (state) => WorldId | undefined
const roundTripEvents: (world: WorldId) => ReadonlyArray<SessionEvent>
```

**`InGame` から `Title` への直行エッジは存在しない。**
終了は必ず `Unloading` を通る。ティアダウンは呼び出し側が忘れられるものではなく、
セッションが通過しなければならない状態である
([design-notes.md](./design-notes.md) DN-5)。

`transition` が `undefined` を返すのは「そのイベントはここでは不正」の意味であり、
現状態をそのまま返さない。

**このモジュールは fiber を止めない。** *いつ*ティアダウンするかを言い、*何が*ティアダウンかは言わない。

## 5. QA / デバッグ API(`domain/qa-api.ts`)

```typescript
const QA_GLOBAL_KEY = '__NERIMA_GAMES_QA__'
type QaCommand = (...args: ReadonlyArray<never>) => unknown
type QaNamespace = { readonly namespace: string; readonly commands: Record<string, QaCommand> }
type QaRegistry = ReadonlyMap<string, QaCommand>   // 'namespace.command' -> command

const buildQaRegistry: (namespaces) => Either<QaRegistry, QaApiError>
const installQaApi: (target: Record<string, unknown>, registry: QaRegistry) => void
const readInstalledQaApi: (target) => Record<string, QaCommand> | undefined
const qaKey: (namespace, command) => string
const describeQaApiError: (error) => string
```

- 名前空間は lowercase kebab / dot セグメント(`gameplay`、`gameplay.fluids`、`mx-ui`)
- コマンド名は lowerCamelCase
- **名前衝突はすべて致命的。** shadowing は「E2E が別モジュールを検証して成功する」を生む
- **`globalThis` に触らない。** 公開先はオブジェクト引数
- 公開されるのは毎回新しいプレーンオブジェクト(生の Map ではない)

**compose は QA コマンドを書かない。** 所有モジュールが名前空間ごと提供し、compose はマージするだけである。

## 6. Modding 入口(`domain/modding.ts`)

```typescript
const MODDING_API_VERSION = 1
const RESERVED_STAGE_PREFIXES: ReadonlyArray<string>

type ModManifest = { id, displayName, apiVersion, module: GameModule }
const acceptMod:  (manifest) => Either<GameModule, ModdingError>
const acceptMods: (manifests) => Either<ReadonlyArray<GameModule>, ModdingError>
const modStagePrefix: (modId) => string      // 'mod:<modId>:'
const modStageId: (modId, stage) => StageId  // 'mod:<modId>:<stage>'
const describeModdingError: (error) => string
```

**mod は一級のモジュールである。** `acceptMod` はただの `GameModule` を返し、
`composeGame` が mx-gameplay のものとまったく同じ経路でマージする。
mod 専用フックも優先度も pre/post パスも無い。

**唯一の制約は stage 名前空間**である。mod の stage は `mod:<modId>:<stage>` でなければならない。

`after` が存在しない stage を指すのは**許される** — redstone 抜きのビルドで
「redstone の後に走る」と書いた mod は正当であり、dangling として報告される。
拒否すると mod がビルドのモジュール集合に依存してしまう。

## 7. まだ無いもの

| 未実装 | 追加時期 |
| --- | --- |
| mc-kernel の型の re-export(`StageId` / `DeltaTimeSecs` / `GameModule`) | mc-kernel 公開後。現在はローカル宣言 |
| 4 つの体験モジュールの実際の合成 | 各モジュール公開後 |
| ブラウザエントリポイント | 縦切りスパイク後 |
| **E2E スイート** | 合成できる中身ができてから。[testing.md](./testing.md) |
| `ModuleLayer` の精密な型 | 縦切りスパイクで実サービス集合が出てから |

**API ロックファイルはこの表から外れた。** plan.md §9 の未決事項
「API ロックファイルのツール選定（api-extractor 相当の Effect-TS 互換手段）」は決着し、
実装されている。

| 項目 | 内容 |
| --- | --- |
| 生成物 | リポジトリ直下の `api-lock.md`（公開宣言 84 件 + 参照されている非 export 宣言 7 件。コミット対象） |
| 生成器 | `scripts/api-lock.ts`（16 リポジトリに byte-identical で vendor。`scripts/check-dependency-whitelist.ts` と同じ方式で、編集してよいのは `REPOSITORY_POLICY` だけ） |
| 検査 | `pnpm api:check` — `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了 |
| 更新 | `pnpm api:update` |
| 配線 | `pnpm verify` の `check:deps` と `test` の間、および CI の `API lock` ステップ |
| 追加依存 | **なし**（`typescript` は既に devDependency） |

理由と実測の正本は mc-kernel の `docs/versioning.md` §7。
`@microsoft/api-extractor` は「`Context.Tag` のサービスクラスが写らない」ことを決め手に却下されている。
16 リポジトリの全サービスがその形で宣言されており、合成する側の本リポジトリは
その Tag 識別子文字列が正しいことに全面的に依存している。

**mc-compose 固有で効くのは §6 の modding 契約である。** `api-lock.md` には

```ts
const MODDING_API_VERSION = 1;
```

がリテラルとして記録されている。`GameModule` / `ModManifest` の形も同様に写る。
サードパーティが書いた mod を黙って壊す変更 —— `GameModule` にフィールドを足す、
`ModManifest.apiVersion` の意味を変える —— は、レビューの前に diff として目に見える。
`composeGame` / `resolveStageOrder` のシグネチャも同じ扱いである。

**写らないものは正直に書く。** `STAGE_INPUT` などの stage id 定数は `StageId` としか写らず、
**文字列そのものはロックに出ない**。§2 の stage 順序表（`SIMULATION_STAGES` などの並び）も
`ReadonlyArray<StageId>` としか写らない。順序は本リポジトリの中核であり、
守るのは引き続き `domain/stage-skeleton.ts` に対するテストである。
**ロックは形を、テストは順序と挙動を見る。**
