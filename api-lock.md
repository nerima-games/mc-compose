# API lock — @nerima-games/mc-compose

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 85
supporting declarations: 0

## Exported

### ComposeOptions  `type`

```ts
type ComposeOptions = {
    readonly skeleton?: ReadonlyArray<StagePhase>;
};
```

### ComposedGame  `type`

```ts
type ComposedGame = {
    readonly plan: StageOrderPlan;
    readonly layer: ModuleLayer;
    readonly runFrame: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
    readonly runFrameWith: (services: Layer.Layer<FrameServices>) => (dt: DeltaTimeSecs) => Effect.Effect<void>;
    readonly moduleNames: ReadonlyArray<string>;
    readonly warnings: ReadonlyArray<string>;
};
```

### DanglingEdge  `type`

```ts
type DanglingEdge = {
    readonly stage: StageId;
    readonly missing: StageId;
};
```

### EMPTY_MODULE_LAYER  `const`

```ts
const EMPTY_MODULE_LAYER: ModuleLayer;
```

### GameModule  `type`

```ts
type GameModule = {
    readonly name: string;
    readonly layers: ModuleLayer;
    readonly frameStages: ReadonlyArray<StageRegistration>;
};
```

### MODDING_API_VERSION  `const`

```ts
const MODDING_API_VERSION = 1;
```

### ModManifest  `type`

```ts
type ModManifest = {
    readonly id: string;
    readonly displayName: string;
    readonly apiVersion: number;
    readonly module: GameModule;
};
```

### ModdingError  `type`

```ts
type ModdingError = {
    readonly _tag: 'InvalidModId';
    readonly id: string;
} | {
    readonly _tag: 'UnsupportedApiVersion';
    readonly id: string;
    readonly declared: number;
    readonly supported: number;
} | {
    readonly _tag: 'ReservedStageNamespace';
    readonly id: string;
    readonly stage: StageId;
} | {
    readonly _tag: 'DuplicateModId';
    readonly id: string;
};
```

### ModuleLayer  `type`

```ts
type ModuleLayer = Layer.Layer<any, any, never>;
```

### QA_GLOBAL_KEY  `const`

```ts
const QA_GLOBAL_KEY = "__NERIMA_GAMES_QA__";
```

### QaApiError  `type`

```ts
type QaApiError = {
    readonly _tag: 'InvalidNamespace';
    readonly namespace: string;
} | {
    readonly _tag: 'InvalidCommandName';
    readonly namespace: string;
    readonly command: string;
} | {
    readonly _tag: 'DuplicateNamespace';
    readonly namespace: string;
} | {
    readonly _tag: 'DuplicateCommand';
    readonly key: string;
};
```

### QaCommand  `type`

```ts
type QaCommand = (...args: ReadonlyArray<never>) => unknown;
```

### QaNamespace  `type`

```ts
type QaNamespace = {
    readonly namespace: string;
    readonly commands: Readonly<Record<string, QaCommand>>;
};
```

### QaRegistry  `type`

```ts
type QaRegistry = ReadonlyMap<string, QaCommand>;
```

### RESERVED_STAGE_PREFIXES  `const`

```ts
const RESERVED_STAGE_PREFIXES: ReadonlyArray<string>;
```

### ResolveOptions  `type`

```ts
type ResolveOptions = {
    readonly skeleton?: ReadonlyArray<StagePhase>;
};
```

### SIMULATION_PHASES  `const`

```ts
const SIMULATION_PHASES: ReadonlyArray<StagePhase>;
```

### SIMULATION_STAGES  `const`

```ts
const SIMULATION_STAGES: ReadonlyArray<StageId>;
```

### STAGE_CAMERA_MIRROR  `const`

```ts
const STAGE_CAMERA_MIRROR: StageId;
```

### STAGE_CHUNK_SYNC  `const`

```ts
const STAGE_CHUNK_SYNC: StageId;
```

### STAGE_HUD_SYNC  `const`

```ts
const STAGE_HUD_SYNC: StageId;
```

### STAGE_INPUT  `const`

```ts
const STAGE_INPUT: StageId;
```

### STAGE_NETWORK_INBOUND  `const`

```ts
const STAGE_NETWORK_INBOUND: StageId;
```

### STAGE_NETWORK_OUTBOUND  `const`

```ts
const STAGE_NETWORK_OUTBOUND: StageId;
```

### STAGE_PHASE_CAMERA_MIRROR  `const`

```ts
const STAGE_PHASE_CAMERA_MIRROR: StagePhase;
```

### STAGE_PHASE_CHUNK_SYNC  `const`

```ts
const STAGE_PHASE_CHUNK_SYNC: StagePhase;
```

### STAGE_PHASE_HUD_SYNC  `const`

```ts
const STAGE_PHASE_HUD_SYNC: StagePhase;
```

### STAGE_PHASE_INPUT  `const`

```ts
const STAGE_PHASE_INPUT: StagePhase;
```

### STAGE_PHASE_NETWORK_INBOUND  `const`

```ts
const STAGE_PHASE_NETWORK_INBOUND: StagePhase;
```

### STAGE_PHASE_NETWORK_OUTBOUND  `const`

```ts
const STAGE_PHASE_NETWORK_OUTBOUND: StagePhase;
```

### STAGE_PHASE_POST_FX  `const`

```ts
const STAGE_PHASE_POST_FX: StagePhase;
```

### STAGE_PHASE_RENDER  `const`

```ts
const STAGE_PHASE_RENDER: StagePhase;
```

### STAGE_PHASE_SIM_ENTITIES  `const`

```ts
const STAGE_PHASE_SIM_ENTITIES: StagePhase;
```

### STAGE_PHASE_SIM_FLUIDS  `const`

```ts
const STAGE_PHASE_SIM_FLUIDS: StagePhase;
```

### STAGE_PHASE_SIM_INTERACTIONS  `const`

```ts
const STAGE_PHASE_SIM_INTERACTIONS: StagePhase;
```

### STAGE_PHASE_SIM_PHYSICS  `const`

```ts
const STAGE_PHASE_SIM_PHYSICS: StagePhase;
```

### STAGE_PHASE_SIM_REDSTONE  `const`

```ts
const STAGE_PHASE_SIM_REDSTONE: StagePhase;
```

### STAGE_PHASE_SIM_TIME_WEATHER  `const`

```ts
const STAGE_PHASE_SIM_TIME_WEATHER: StagePhase;
```

### STAGE_POST_FX  `const`

```ts
const STAGE_POST_FX: StageId;
```

### STAGE_RENDER  `const`

```ts
const STAGE_RENDER: StageId;
```

### STAGE_SIM_ENTITIES  `const`

```ts
const STAGE_SIM_ENTITIES: StageId;
```

### STAGE_SIM_FLUIDS  `const`

```ts
const STAGE_SIM_FLUIDS: StageId;
```

### STAGE_SIM_INTERACTIONS  `const`

```ts
const STAGE_SIM_INTERACTIONS: StageId;
```

### STAGE_SIM_PHYSICS  `const`

```ts
const STAGE_SIM_PHYSICS: StageId;
```

### STAGE_SIM_REDSTONE  `const`

```ts
const STAGE_SIM_REDSTONE: StageId;
```

### STAGE_SIM_TIME_WEATHER  `const`

```ts
const STAGE_SIM_TIME_WEATHER: StageId;
```

### STANDARD_STAGE_SKELETON  `const`

```ts
const STANDARD_STAGE_SKELETON: ReadonlyArray<StagePhase>;
```

### SessionEvent  `type`

```ts
type SessionEvent = {
    readonly _tag: 'WorldSelected';
    readonly world: WorldId;
} | {
    readonly _tag: 'LoadSucceeded';
} | {
    readonly _tag: 'LoadFailed';
    readonly reason: string;
} | {
    readonly _tag: 'PauseRequested';
} | {
    readonly _tag: 'ResumeRequested';
} | {
    readonly _tag: 'QuitToTitleRequested';
} | {
    readonly _tag: 'TeardownCompleted';
};
```

### SessionState  `type`

```ts
type SessionState = {
    readonly _tag: 'Title';
    readonly lastError: string | undefined;
} | {
    readonly _tag: 'Loading';
    readonly world: WorldId;
} | {
    readonly _tag: 'InGame';
    readonly world: WorldId;
} | {
    readonly _tag: 'Paused';
    readonly world: WorldId;
} | {
    readonly _tag: 'Unloading';
    readonly world: WorldId;
};
```

### StageConstraint  `type`

```ts
type StageConstraint = {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
};
```

### StageId  `const`

```ts
const StageId: Brand.Brand.Constructor<StageId>;
```

### StageId  `type`

```ts
type StageId = string & Brand.Brand<'StageId'>;
```

### StageOrderError  `type`

```ts
type StageOrderError = {
    readonly _tag: 'DuplicateStage';
    readonly id: StageId;
} | {
    readonly _tag: 'StageCycle';
    readonly cycle: ReadonlyArray<StageId>;
};
```

### StageOrderPlan  `type`

```ts
type StageOrderPlan = {
    readonly order: ReadonlyArray<StageId>;
    readonly dangling: ReadonlyArray<DanglingEdge>;
    readonly unmatchedPhase: ReadonlyArray<StageId>;
};
```

### StagePhase  `type`

```ts
type StagePhase = {
    readonly name: string;
    readonly members: ReadonlyArray<string>;
};
```

### StageRegistration  `type`

```ts
type StageRegistration = {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
    readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
};
```

### WorldId  `const`

```ts
const WorldId: Brand.Brand.Constructor<WorldId>;
```

### WorldId  `type`

```ts
type WorldId = string & Brand.Brand<'WorldId'>;
```

### acceptMod  `const`

```ts
const acceptMod: (manifest: ModManifest) => Either.Either<GameModule, ModdingError>;
```

### acceptMods  `const`

```ts
const acceptMods: (manifests: ReadonlyArray<ModManifest>) => Either.Either<ReadonlyArray<GameModule>, ModdingError>;
```

### buildQaRegistry  `const`

```ts
const buildQaRegistry: (namespaces: ReadonlyArray<QaNamespace>) => Either.Either<QaRegistry, QaApiError>;
```

### collectStages  `const`

```ts
const collectStages: (modules: ReadonlyArray<GameModule>) => ReadonlyArray<StageRegistration>;
```

### composeGame  `const`

```ts
const composeGame: (modules: ReadonlyArray<GameModule>, options?: ComposeOptions) => Either.Either<ComposedGame, StageOrderError>;
```

### currentWorld  `const`

```ts
const currentWorld: (state: SessionState) => WorldId | undefined;
```

### describeModdingError  `const`

```ts
const describeModdingError: (error: ModdingError) => string;
```

### describeQaApiError  `const`

```ts
const describeQaApiError: (error: QaApiError) => string;
```

### describeStageOrderError  `const`

```ts
const describeStageOrderError: (error: StageOrderError) => string;
```

### describeStagePlanWarnings  `const`

```ts
const describeStagePlanWarnings: (plan: StageOrderPlan) => ReadonlyArray<string>;
```

### holdsWorldResources  `const`

```ts
const holdsWorldResources: (state: SessionState) => boolean;
```

### initialSessionState  `const`

```ts
const initialSessionState: SessionState;
```

### installQaApi  `const`

```ts
const installQaApi: (target: Record<string, unknown>, registry: QaRegistry) => void;
```

### isSimulating  `const`

```ts
const isSimulating: (state: SessionState) => boolean;
```

### mergeModuleLayers  `const`

```ts
const mergeModuleLayers: (modules: ReadonlyArray<GameModule>) => ModuleLayer;
```

### modStageId  `const`

```ts
const modStageId: (modId: string, stage: string) => StageId;
```

### modStagePrefix  `const`

```ts
const modStagePrefix: (modId: string) => string;
```

### phaseAdmits  `const`

```ts
const phaseAdmits: (phase: StagePhase, id: StageId) => boolean;
```

### phaseOf  `const`

```ts
const phaseOf: (skeleton: ReadonlyArray<StagePhase>, id: StageId) => StagePhase | undefined;
```

### qaKey  `const`

```ts
const qaKey: (namespace: string, command: string) => string;
```

### readInstalledQaApi  `const`

```ts
const readInstalledQaApi: (target: Readonly<Record<string, unknown>>) => Readonly<Record<string, QaCommand>> | undefined;
```

### registerModule  `const`

```ts
const registerModule: <RRegister>(module: {
    readonly name: string;
    readonly layers: ModuleLayer;
    readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}) => Effect.Effect<GameModule, never, RRegister>;
```

### resolveStageOrder  `const`

```ts
const resolveStageOrder: (constraints: ReadonlyArray<StageConstraint>, options?: ResolveOptions) => Either.Either<StageOrderPlan, StageOrderError>;
```

### roundTripEvents  `const`

```ts
const roundTripEvents: (world: WorldId) => ReadonlyArray<SessionEvent>;
```

### runSession  `const`

```ts
const runSession: (from: SessionState, events: ReadonlyArray<SessionEvent>) => {
    readonly state: SessionState;
    readonly rejectedAt: number | undefined;
};
```

### stagePhase  `const`

```ts
const stagePhase: (name: string, ...members: ReadonlyArray<string>) => StagePhase;
```

### transition  `const`

```ts
const transition: (state: SessionState, event: SessionEvent) => SessionState | undefined;
```
