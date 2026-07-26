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

const resolveStageOrder: (
  constraints: ReadonlyArray<StageConstraint>,
  options?: { readonly skeleton?: ReadonlyArray<StageId> },
) => Either<StageOrderPlan, StageOrderError>

const describeStageOrderError: (error: StageOrderError) => string
```

### 契約

| 保証 | 内容 |
| --- | --- |
| **決定性** | 同じ入力からは常に同じ順序。tie-break は skeleton 上の位置 → id 辞書順の**全順序** |
| **登録順非依存** | モジュールを並べた順序が結果に影響しない |
| **循環は経路つき** | `StageCycle.cycle` は実際の経路。先頭ノードが末尾に再出現する |
| **循環の最小報告** | 循環の後ろで配置できなかっただけの stage は報告に含めない |
| **dangling は非致命** | 未登録の stage を指す `after` は落として `dangling` に報告 |
| **自己エッジは無視** | 「自分の後に走る」は無意味であって循環ではない |
| **重複 id は致命** | どちらが走るかが恣意的になるため |

### `skeleton` オプションの 2 つの役割

1. **暗黙の順序エッジ。** 実際に登録された skeleton stage を skeleton 順に並べ、隣接ペアにエッジを張る。
   **登録されていない stage は鎖を閉じる** — 流体モジュール抜きのビルドでも
   entities は redstone の前に走る
2. **第一の tie-break。** 順序関係を持たない 2 つの stage は、辞書順ではなく skeleton の言うところに落ちる

## 2. stage 順序表(`domain/stage-skeleton.ts`)

```typescript
const STANDARD_STAGE_SKELETON: ReadonlyArray<StageId>
const SIMULATION_STAGES: ReadonlyArray<StageId>

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

**この配列を変えるとゲームが変わる。**
このリポジトリへの差分の中で、PR に理由の記述が要ると想定されている唯一のものである。
`test/public-api.test.ts` の
`pins the standard stage skeleton (plan.md §4.2) so a reorder is always deliberate` が値を固定している。

各エッジの根拠は `domain/stage-skeleton.ts` の各定数の doc コメントにある。

## 3. Layer 合成(`domain/composition.ts`)

```typescript
type DeltaTimeSecs = number
type StageRegistration = {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
  readonly run: (dt: DeltaTimeSecs) => Effect<void>
}
type ModuleLayer = Layer<any, any, any>
const EMPTY_MODULE_LAYER: ModuleLayer

type GameModule = {
  readonly name: string          // 診断用。分岐に使わない
  readonly layers: ModuleLayer
  readonly frameStages: ReadonlyArray<StageRegistration>
}

type ComposedGame = {
  readonly plan: StageOrderPlan
  readonly layer: ModuleLayer
  readonly runFrame: (dt: DeltaTimeSecs) => Effect<void>
  readonly moduleNames: ReadonlyArray<string>
}

const composeGame: (modules, options?) => Either<ComposedGame, StageOrderError>
const mergeModuleLayers: (modules) => ModuleLayer
const collectStages: (modules) => ReadonlyArray<StageRegistration>
```

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
`Layer<any, ...>` に代入できない(`any` が `never` に代入できる必要がある)。
実モジュールの Layer はすべて問題なく代入できる。空 Layer だけが例外であり、
この定数がその例外の封じ込め場所である。

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
| API ロックファイル | plan.md §9「未決」— ツール選定待ち |
