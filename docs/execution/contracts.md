# Cross-Package Contract Sketches C1–C7

This document records proposed type boundaries for C1–C7. Its TypeScript code blocks compile together as one temporary module against Effect 4.0.5 and TypeScript 7.0.2. `mc-compose` still declares Effect 3.22.1, so this check does not typecheck the package itself.

Effect 4 is the target API. W0 is the preparation wave that records and typechecks the proposals; W1 adopts Effect 4 in `mc-kernel` and `mc-compose` before implementing C1. Each later owning package adopts it in the first wave that implements its contract.

Package implementation waves follow W0: W1 updates `mc-kernel` and `mc-compose`; W2 updates `mc-noise`, `mc-meshing`, `mc-physics`, `mc-save`, and `mc-audio` as an intervening package migration wave with no C1–C7 surface; W3 updates `mc-worldgen`, `mc-sim`, `mc-render`, and `mc-playground-kit`; W4 integrates `mx-gameplay` and `mx-ui`, while `mx-redstone` and `mx-multiplayer` finalize their consumer contracts and determine adapter placement. W5 wires `mc-compose`, `mc-host-web`, and `mc-server`; C1 moves the E2E tests and QA transport in that wave. A contract's wave identifies when its API is fixed or implemented.

## Contract map

| ID | Owning package and proposed surface | Wave | Consumers |
|---|---|---:|---|
| C1 | `mc-kernel`, `GameModule` extensions in `src/domain/time/frame.ts`; `QaBridge` in `mc-compose` | W1 types, W2 save envelope support, W3 v3 slice migration, W5 QA transport migration | All game modules, compose, `mc-host-web` E2E |
| C2 | `mc-sim`, `IntentQueue` in `src/application/intent-queue.ts` | W3 | `mx-gameplay`, `mx-redstone`, `mx-multiplayer`, hosts |
| C3 | Event vocabulary in `mc-kernel`; `DomainEventBus` in `mc-sim` | W1 vocabulary, W3 bus | Render, UI, gameplay adapters |
| C4 | Replicated state services in `mc-sim`; grouped codecs in `mx-multiplayer` | W3 state, W4 protocol v10 contract | `mx-multiplayer`, `mc-server` |
| C5 | `mc-sim`, `@nerima-games/mc-sim/testing` | W3 | All `mx-*` packages and `mc-server` |
| C6 | `mc-render` particle request service; `mc-playground-kit` host adapter | W3 service and adapter | Gameplay reaches the render adapter through C3 events |
| C7 | Port in `mc-kernel`; public writer alias in `mx-multiplayer` | W1 type, W4 consumer contracts and adapter placement, W5 host wiring | `mc-server`, `mc-host-web`, redstone host adapter |

## Shared rules

- Decode external `unknown` values with the owning `Schema` at the boundary. Inside a package, use the inferred branded `Schema.Schema.Type`; encode values at persistence or network boundaries.
- Keep synchronous domain calculations total and pure. Represent effects, typed failures, and service requirements with Effect. Do not add thrown exceptions, untyped casts, or `Promise` to these contracts.
- Kernel provides shared vocabulary, static data, and port types only. `mx-*` packages do not depend on compose or on one another. Compose and the hosts provide adapters; the dedicated server composes the same game modules as the browser host.
- QA means the compose quality-assurance registry used by host E2E tests. An owner package holds the authoritative service for a domain; its observe operation reads that service through its public boundary. A host E2E test exercises the fully composed browser or server host.
- QA outputs and C5 state hashes use the same JSON value domain: null, booleans, finite numbers, strings, dense arrays, and plain objects whose prototype is `Object.prototype` or `null` and whose own properties are enumerable string-keyed data properties. Reject undefined, bigint, symbols and symbol keys, functions, non-finite numbers, sparse arrays, accessors, non-enumerable properties, and other prototypes.
- Save-slice versions, multiplayer protocol versions, world revisions, dimension revisions, and simulation ticks are separate compatibility or ordering domains. Do not use one as a substitute for another.
- Dependency direction: `mc-kernel` owns shared vocabulary and port types, `mc-sim` and `mc-render` consume kernel contracts, and hosts wire those packages through adapters. C3 therefore places event vocabulary in kernel and its bus in sim; C6 reaches that bus through a host adapter. C7's multiplayer-facing alias consumes a kernel port. `mx-*` packages remain independent of compose and one another.

### Shared vocabulary

```ts
import { isItemStack, DIMENSIONS, type Dimension, type ItemStack, type WorldWriteChunkUnavailable } from "@nerima-games/mc-kernel";
import { Brand, Context, Effect, Layer, Schema, SchemaGetter, Stream } from "effect";

export type EntityId = Brand.Branded<string, "EntityId">;
export const EntityIdSchema = Schema.NonEmptyString.pipe(Schema.brand("EntityId"));

export const DimensionIdSchema = Schema.Literals(["overworld", "nether", "end"])
  .pipe(Schema.brand("DimensionId"));
export type DimensionId = Schema.Schema.Type<typeof DimensionIdSchema>;

export type WorldId = Brand.Branded<string, "WorldId">;
export const WorldIdSchema = Schema.NonEmptyString.pipe(Schema.brand("WorldId"));

export type BlockId = Brand.Branded<number, "BlockId">;
export const BlockIdSchema = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: 65535 }))
  .pipe(Schema.brand("BlockId"));

export type ItemId = Brand.Branded<number, "ItemId">;
export const ItemIdSchema = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: 65535 }))
  .pipe(Schema.brand("ItemId"));

export type BlockAxis = Brand.Branded<number, "BlockAxis">;
export const BlockAxisSchema = Schema.Int.pipe(Schema.brand("BlockAxis"));

export const BlockPositionSchema = Schema.Struct({
  x: BlockAxisSchema,
  y: BlockAxisSchema,
  z: BlockAxisSchema
});
export type BlockPosition = Schema.Schema.Type<typeof BlockPositionSchema>;

export const BlockAddressSchema = Schema.Struct({
  dimension: DimensionIdSchema,
  position: BlockPositionSchema
});
export type BlockAddress = Schema.Schema.Type<typeof BlockAddressSchema>;

export const WorldPositionSchema = Schema.Struct({
  dimension: DimensionIdSchema,
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite
}).pipe(Schema.brand("WorldPosition"));
export type WorldPosition = Schema.Schema.Type<typeof WorldPositionSchema>;

export const SimulationTickSchema = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand("SimulationTick"));
export type SimulationTick = Schema.Schema.Type<typeof SimulationTickSchema>;

export const WorldRevisionSchema = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand("WorldRevision"));
export type WorldRevision = Schema.Schema.Type<typeof WorldRevisionSchema>;

export const DimensionRevisionSchema = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand("DimensionRevision"));
export type DimensionRevision = Schema.Schema.Type<typeof DimensionRevisionSchema>;
```

## C1: Module QA and save slices

1. **Placement.** Extend `GameModule` in `mc-kernel/src/domain/time/frame.ts` while keeping its existing type parameters, `layers`, and `frameStages` fields. Add optional `qa: QaNamespace` and `saveSlices: ReadonlyArray<SaveSliceRegistration>` fields.

   `composeGame` accepts a readonly tuple of `GameModule` values and returns `Effect<ComposedGame<Modules>, DuplicateModuleContract>` with no service requirements. The successful `ComposedGame` contains the tuple's QA namespaces and save slices. Modules that register QA contribute distinct namespaces. Duplicate namespace names and slice IDs fail with `DuplicateModuleContract`: namespace errors use kind `qa-namespace` and the namespace name as the error ID; slice errors use kind `save-slice` and the slice ID. A failure returns no partial registry. `ComposedGame.layers` unions module layer errors; its service requirements include module layer requirements, QA operation requirements, and the requirements of each module's `frameStages` Effect, which the host runs to register frame stages.

   `ComposedGame.qaBridge` is the runtime dispatcher typed as `QaBridgeApi<OperationErrors>` for the registered operation error union. The host installs this value as the `QaBridge` context service. The host's QA dispatcher retrieves the service instance and calls `run(namespace, operation, inputJson)`. The host uses `QaBridgeApi<unknown>` for dynamic dispatch. `composeGame` rejects operation-name collisions across a namespace's `observe` and `command` maps with `DuplicateModuleContract` kind `qa-operation` and ID `namespace.operation` before exposing the registry. The dispatch Effect fails with `QaOperationNotFound` for unknown namespace or operation names. The bridge decodes input, invokes the selected handler, and encodes success with the output codec as JSON. The host provides that dispatch Effect with `ComposedGame.layers` using `Effect.provide`, which supplies the services declared by QA operations; the resulting Effect retains the composed layer's input service requirements. Input decoding and output encoding failures produce `Schema.SchemaError`. Registered operation errors remain typed, and the host propagates them or `Schema.SchemaError` without wrapping.
2. **Effect 4 types.** An observe or command operation declares input/output codecs and an Effect handler with its typed error and requirements. A slice snapshot is an infallible Effect that may require state services; restore is an Effect with a typed error. A per-slice `SaveMigration` is a total synchronous transformation between decoded slice types, with decode or encode failures represented by `Schema.SchemaError`.
3. **Schema shape.** `qa.name` is a branded `QaNamespaceName`; `qa.observe` and `qa.command` are named maps whose values are `QaOperation`s with branded `name`, input, and output codecs. Each map key must equal its operation's `name`; compose validates this before publishing the registry. Their inputs and outputs are `Schema.Codec`s, so branded identifiers are validated at the QA boundary. The output codec must encode values in the shared JSON domain. Each save entry is keyed by stable `SaveSliceId`, carries a positive integer version, and stores the encoded value accepted by that slice's codec. The persisted bundle is an object keyed by `SaveSliceId`; each value contains its version and encoded data.

```ts
export const SaveSliceIdSchema = Schema.NonEmptyString.pipe(Schema.brand("SaveSliceId"));
export type SaveSliceId = Schema.Schema.Type<typeof SaveSliceIdSchema>;

export const SaveVersionSchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("SaveVersion"));
export type SaveVersion = Schema.Schema.Type<typeof SaveVersionSchema>;

export const QaNamespaceNameSchema = Schema.NonEmptyString.pipe(Schema.brand("QaNamespaceName"));
export type QaNamespaceName = Schema.Schema.Type<typeof QaNamespaceNameSchema>;

export const QaOperationNameSchema = Schema.NonEmptyString.pipe(Schema.brand("QaOperationName"));
export type QaOperationName = Schema.Schema.Type<typeof QaOperationNameSchema>;

export const ModuleContractIdSchema = Schema.NonEmptyString.pipe(Schema.brand("ModuleContractId"));
export type ModuleContractId = Schema.Schema.Type<typeof ModuleContractIdSchema>;

export const ModuleContractKindSchema = Schema.Literals([
  "qa-namespace",
  "qa-operation",
  "save-slice"
]).pipe(Schema.brand("ModuleContractKind"));
export type ModuleContractKind = Schema.Schema.Type<typeof ModuleContractKindSchema>;

export interface QaOperation<
  Input extends Schema.Codec<unknown>,
  Output extends Schema.Codec<unknown>,
  Error = never,
  Requirements = never
> {
  readonly name: QaOperationName;
  readonly input: Input;
  readonly output: Output;
  readonly run: (
    input: Input["Type"]
  ) => Effect.Effect<Output["Type"], Error, Requirements>;
}

export interface QaNamespace<
  Observe extends object = object,
  Command extends object = object
> {
  readonly name: QaNamespaceName;
  readonly observe: Observe;
  readonly command: Command;
}

export type StageId = string & Brand.Brand<"StageId">;
export declare const StageId: Brand.Constructor<StageId>;
export type DeltaTimeSecs = number & Brand.Brand<"DeltaTimeSecs">;
export declare const DeltaTimeSecs: Brand.Constructor<DeltaTimeSecs>;
export type MonotonicTimeSecs = number & Brand.Brand<"MonotonicTimeSecs">;
export declare const MonotonicTimeSecs: Brand.Constructor<MonotonicTimeSecs>;
export type EpochMillis = number & Brand.Brand<"EpochMillis">;
export declare const EpochMillis: Brand.Constructor<EpochMillis>;
export type ClockService = {
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;
};
const ClockPortBase: Context.ServiceClass<ClockPort, "@nerima-games/mc-kernel/ClockPort", ClockService> =
  Context.Service<ClockPort, ClockService>()("@nerima-games/mc-kernel/ClockPort");
export class ClockPort extends ClockPortBase {}
export type FrameServices = ClockPort;

/** Ordering edges only; missing targets are dropped and reported by the host. */
export interface StageRegistration {
  readonly id: StageId;
  readonly after?: ReadonlyArray<StageId>;
  readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
}

/** RIn builds layers; RRegister is the separate environment for evaluating frameStages. */
export interface KernelGameModule<ROut, Error, RIn, RRegister = never> {
  readonly layers: Layer.Layer<ROut, Error, RIn>;
  readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}

export interface GameModule<
  ROut,
  Error,
  RIn,
  RRegister = never
> extends KernelGameModule<ROut, Error, RIn, RRegister> {
  readonly qa?: QaNamespace;
  readonly saveSlices?: ReadonlyArray<SaveSliceRegistration>;
}

type RequirementsOf<Operation> = Operation extends QaOperation<
  infer _Input,
  infer _Output,
  infer _Error,
  infer Requirements
> ? Requirements : never;

type ErrorsOf<Operation> = Operation extends QaOperation<
  infer _Input,
  infer _Output,
  infer Error,
  infer _Requirements
> ? Error : never;

type OperationsRequirements<Operations> = Operations extends object
  ? RequirementsOf<Operations[keyof Operations]>
  : never;

type OperationsErrors<Operations> = Operations extends object
  ? ErrorsOf<Operations[keyof Operations]>
  : never;

type NamespaceRequirements<Namespace> = Namespace extends {
  readonly observe: infer Observe;
  readonly command: infer Command;
}
  ? OperationsRequirements<Observe> | OperationsRequirements<Command>
  : never;

type NamespaceErrors<Namespace> = Namespace extends {
  readonly observe: infer Observe;
  readonly command: infer Command;
}
  ? OperationsErrors<Observe> | OperationsErrors<Command>
  : never;

type ModuleQa<Module> = Module extends { readonly qa?: infer Namespace }
  ? NonNullable<Namespace>
  : never;

type QaOperationErrorsOfModules<Modules extends ReadonlyArray<unknown>> =
  NamespaceErrors<ModuleQa<Modules[number]>>;

type ModuleLayerServicesOf<Module> = Module extends {
  readonly layers: Layer.Layer<infer Services, infer _Error, infer _Requirements>
} ? Services : never;

type ModuleLayerErrorOf<Module> = Module extends {
  readonly layers: Layer.Layer<infer _Services, infer Error, infer _Requirements>
} ? Error : never;

type ModuleLayerRequirementsOf<Module> = Module extends {
  readonly layers: Layer.Layer<infer _Services, infer _Error, infer Requirements>
} ? Requirements | NamespaceRequirements<ModuleQa<Module>> : NamespaceRequirements<ModuleQa<Module>>;

type ModuleFrameStageRequirementsOf<Module> = Module extends {
  readonly frameStages: Effect.Effect<infer _Stages, infer _Error, infer Requirements>
} ? Requirements : never;

type ModuleLayerServices<Modules extends ReadonlyArray<unknown>> =
  ModuleLayerServicesOf<Modules[number]>;

type ModuleLayerErrors<Modules extends ReadonlyArray<unknown>> =
  ModuleLayerErrorOf<Modules[number]>;

type ModuleLayerRequirements<Modules extends ReadonlyArray<unknown>> =
  ModuleLayerRequirementsOf<Modules[number]>;

type ModuleRegistrationRequirements<Modules extends ReadonlyArray<unknown>> =
  ModuleFrameStageRequirementsOf<Modules[number]>;

type ModuleCompositionRequirements<Modules extends ReadonlyArray<unknown>> =
  ModuleLayerRequirements<Modules>
  | ModuleRegistrationRequirements<Modules>;

type ModuleSaveSlices<Module> = Module extends { readonly saveSlices?: infer Slices }
  ? NonNullable<Slices>
  : readonly [];

type ModuleQaNamespaces<Modules extends ReadonlyArray<unknown>> = ModuleQa<Modules[number]>;

type ModuleSaveSliceEntries<Modules extends ReadonlyArray<unknown>> =
  ModuleSaveSlices<Modules[number]> extends ReadonlyArray<infer Slice> ? Slice : never;

export interface ComposedGame<Modules extends ReadonlyArray<unknown>> {
  readonly modules: Modules;
  readonly layers: Layer.Layer<
    ModuleLayerServices<Modules>,
    ModuleLayerErrors<Modules>,
    ModuleCompositionRequirements<Modules>
  >;
  readonly qaNamespaces: ReadonlyArray<ModuleQaNamespaces<Modules>>;
  readonly saveSlices: ReadonlyArray<ModuleSaveSliceEntries<Modules>>;
  readonly qaBridge: QaBridgeApi<QaOperationErrorsOfModules<Modules>>;
}

export declare const composeGame: <const Modules extends ReadonlyArray<
  GameModule<never, unknown, unknown, unknown>
>>(
  modules: Modules
) => Effect.Effect<ComposedGame<Modules>, DuplicateModuleContract>;

export interface QaBridgeApi<OperationErrors> {
  readonly run: (
    namespace: QaNamespaceName,
    operation: QaOperationName,
    inputJson: unknown
  ) => Effect.Effect<unknown, Schema.SchemaError | QaOperationNotFound | OperationErrors>;
}

export class QaBridge extends Context.Service<QaBridge, QaBridgeApi<unknown>>()(
  "mc-compose/domain/QaBridge"
) {}

export interface SaveMigration<To extends Schema.Codec<unknown> = Schema.Codec<unknown>> {
  readonly fromVersion: SaveVersion;
  readonly toVersion: SaveVersion;
  readonly run: (encoded: unknown) => Effect.Effect<To["Encoded"], Schema.SchemaError>;
}

export const defineSaveMigration = <
  From extends Schema.Codec<unknown>,
  To extends Schema.Codec<unknown>
>(
  fromVersion: SaveVersion,
  toVersion: SaveVersion,
  fromSchema: From,
  toSchema: To,
  migrate: (value: From["Type"]) => To["Type"]
): SaveMigration<To> => ({
  fromVersion,
  toVersion,
  run: (encoded) =>
    Schema.decodeUnknownEffect(fromSchema)(encoded).pipe(
      Effect.flatMap((value) => Schema.encodeUnknownEffect(toSchema)(migrate(value)))
    )
});

export interface SaveSliceRegistration<
  Slice extends Schema.Codec<unknown> = Schema.Codec<unknown>,
  RestoreError = unknown,
  Requirements = unknown
> {
  readonly id: SaveSliceId;
  readonly version: SaveVersion;
  readonly schema: Slice;
  readonly snapshot: Effect.Effect<Slice["Type"], never, Requirements>;
  restore(state: Slice["Type"]): Effect.Effect<void, RestoreError, Requirements>;
  readonly migrations: ReadonlyArray<SaveMigration>;
}

export type EncodedSaveBundle = Readonly<Record<SaveSliceId, {
  readonly version: SaveVersion;
  readonly data: unknown;
}>>;

export class SaveMigrationPathMissing extends Schema.TaggedError<SaveMigrationPathMissing>()("SaveMigrationPathMissing", {
  id: SaveSliceIdSchema,
  storedVersion: SaveVersionSchema,
  currentVersion: SaveVersionSchema
}) {}

export class SaveMigrationPathAmbiguous extends Schema.TaggedError<SaveMigrationPathAmbiguous>()("SaveMigrationPathAmbiguous", {
  id: SaveSliceIdSchema,
  storedVersion: SaveVersionSchema,
  currentVersion: SaveVersionSchema
}) {}

export class DuplicateModuleContract extends Schema.TaggedError<DuplicateModuleContract>()("DuplicateModuleContract", {
  kind: ModuleContractKindSchema,
  id: ModuleContractIdSchema
}) {}

export class QaOperationNotFound extends Schema.TaggedError<QaOperationNotFound>()("QaOperationNotFound", {
  namespace: QaNamespaceNameSchema,
  operation: QaOperationNameSchema
}) {}

export const QaBlockPositionInput = Schema.Struct({
  address: BlockAddressSchema
});
export const QaBlockIdOutput = Schema.Struct({
  blockId: BlockIdSchema
});
export type ObserveBlockAtQa = QaOperation<typeof QaBlockPositionInput, typeof QaBlockIdOutput>;
export type ExampleQaNamespace = QaNamespace<{
  readonly blockAt: ObserveBlockAtQa;
}>;

const componentsWithUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(componentsWithUndefined);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    entry === null ? undefined : componentsWithUndefined(entry)
  ]));
};

const componentsWithNull = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(componentsWithNull);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    entry === undefined ? null : componentsWithNull(entry)
  ]));
};

const LegacyItemStackWireSchema = Schema.Struct({
  item: Schema.String,
  count: Schema.Number,
  components: Schema.Unknown
});

const LegacyItemStackSchema = LegacyItemStackWireSchema.pipe(
  Schema.decode({
    decode: SchemaGetter.transform((stack) => ({
      ...stack,
      components: componentsWithUndefined(stack.components)
    })),
    encode: SchemaGetter.transform((stack) => ({
      ...stack,
      components: componentsWithNull(stack.components)
    }))
  }),
  Schema.refine((stack): stack is ItemStack => isItemStack(stack))
);

export const LegacySimulationSaveV3Schema = Schema.Struct({
  dimension: Schema.Literals(["overworld", "nether", "end"]),
  tick: SimulationTickSchema,
  player: Schema.Struct({
    position: Schema.Struct({ x: Schema.Finite, y: Schema.Finite, z: Schema.Finite }),
    inventory: Schema.Array(Schema.Union([Schema.Null, LegacyItemStackSchema])),
    selectedHotbarSlot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 8 }))
  }),
  statistics: Schema.Struct({
    counters: Schema.Record(Schema.String, Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
    unlocked: Schema.Array(Schema.String)
  })
});
export type LegacySimulationSaveV3 = Schema.Schema.Type<typeof LegacySimulationSaveV3Schema>;

export interface SaveSliceCodec<Slice extends Schema.Codec<unknown>> {
  readonly id: SaveSliceId;
  readonly version: SaveVersion;
  readonly schema: Slice;
}

export interface InitialSimulationSliceValues<
  Player extends Schema.Codec<unknown>,
  Time extends Schema.Codec<unknown>,
  Inventory extends Schema.Codec<unknown>,
  Statistics extends Schema.Codec<unknown>
> {
  readonly player: Player["Type"];
  readonly time: Time["Type"];
  readonly inventory: Inventory["Type"];
  readonly statistics: Statistics["Type"];
}

export interface SimulationV3SliceInputs {
  readonly player: unknown;
  readonly time: unknown;
  readonly inventory: unknown;
  readonly statistics: unknown;
}

export interface SimulationV3SliceTargets<
  Player extends Schema.Codec<unknown>,
  Time extends Schema.Codec<unknown>,
  Inventory extends Schema.Codec<unknown>,
  Statistics extends Schema.Codec<unknown>
> {
  readonly player: SaveSliceCodec<Player>;
  readonly time: SaveSliceCodec<Time>;
  readonly inventory: SaveSliceCodec<Inventory>;
  readonly statistics: SaveSliceCodec<Statistics>;
  readonly map: (
    legacy: LegacySimulationSaveV3
  ) => Effect.Effect<SimulationV3SliceInputs, Schema.SchemaError>;
}

export declare const decodeSimulationV3SliceInputs: <
  Player extends Schema.Codec<unknown>,
  Time extends Schema.Codec<unknown>,
  Inventory extends Schema.Codec<unknown>,
  Statistics extends Schema.Codec<unknown>
>(
  inputs: SimulationV3SliceInputs,
  targets: SimulationV3SliceTargets<Player, Time, Inventory, Statistics>
) => Effect.Effect<InitialSimulationSliceValues<Player, Time, Inventory, Statistics>, Schema.SchemaError>;

export declare const migrateSimulationSaveV3: <
  Player extends Schema.Codec<unknown>,
  Time extends Schema.Codec<unknown>,
  Inventory extends Schema.Codec<unknown>,
  Statistics extends Schema.Codec<unknown>
>(
  encodedV3Payload: unknown,
  targets: SimulationV3SliceTargets<Player, Time, Inventory, Statistics>
) => Effect.Effect<EncodedSaveBundle, Schema.SchemaError>;


```

**Contract probes** verify at compile time that `composeGame` accepts valid modules, rejects invalid QA and save-slice fields, retains `DuplicateModuleContract` in its failure type, and tracks QA service requirements in `ComposedGame.layers` and the resulting dispatch Effect.

```ts
declare const probeNamespaceName: QaNamespaceName;
declare const probeOperationName: QaOperationName;

const noRequirementLayer: Layer.Layer<never, never, never> = Layer.empty;
const moduleWithoutQa = {
  layers: noRequirementLayer,
  frameStages: Effect.succeed([] as const)
};
composeGame([moduleWithoutQa]);

declare const probeConcreteQaNamespace: ExampleQaNamespace;
const moduleWithQa: GameModule<never, never, never> = {
  ...moduleWithoutQa,
  qa: probeConcreteQaNamespace
};
const composedWithQaProbe = composeGame([moduleWithQa]);

const invalidQaModule = { ...moduleWithoutQa, qa: "invalid" };
// @ts-expect-error qa must be a QaNamespace.
composeGame([invalidQaModule]);

const invalidSaveSlicesModule = { ...moduleWithoutQa, saveSlices: "invalid" };
// @ts-expect-error saveSlices must be a readonly array of SaveSliceRegistration values.
composeGame([invalidSaveSlicesModule]);

type ContractProbeAssert<Value extends true> = Value;
type ContractProbeSuccess<Value> = Value extends Effect.Effect<infer Success, infer _Error, infer _Requirements>
  ? Success
  : never;
type ContractProbeError<Value> = Value extends Effect.Effect<infer _Success, infer Error, infer _Requirements>
  ? Error
  : never;
type ContractProbeEffectRequirements<Value> = Value extends Effect.Effect<infer _Success, infer _Error, infer Requirements>
  ? Requirements
  : never;
type ContractProbeLayerRequirements<Value> = ContractProbeSuccess<Value> extends {
  readonly layers: Layer.Layer<infer _Services, infer _Error, infer Requirements>
} ? Requirements : never;
type QaRequirementsRemainNever = ContractProbeAssert<
  [ContractProbeLayerRequirements<typeof composedWithQaProbe>] extends [never] ? true : false
>;

type ProbeQaService = { readonly _tag: "ProbeQaService" };
declare const operationWithRequirement: QaOperation<
  typeof Schema.Unknown,
  typeof Schema.Unknown,
  never,
  ProbeQaService
>;
const namespaceWithRequiredQa: QaNamespace<{
  readonly read: typeof operationWithRequirement;
}> = {
  name: probeNamespaceName,
  observe: { read: operationWithRequirement },
  command: {}
};
const moduleWithRequiredQa = {
  ...moduleWithoutQa,
  qa: namespaceWithRequiredQa
};
const composedWithRequiredQaEffect = composeGame([moduleWithRequiredQa]);
declare const composedWithRequiredQa: ContractProbeSuccess<typeof composedWithRequiredQaEffect>;
type QaRequirementIsOnComposedLayer = ContractProbeAssert<
  ProbeQaService extends ContractProbeLayerRequirements<typeof composedWithRequiredQaEffect> ? true : false
>;
const dispatchWithUnresolvedRequirement = Effect.provide(
  composedWithRequiredQa.qaBridge.run(probeNamespaceName, probeOperationName, null),
  composedWithRequiredQa.layers
);
type UnresolvedQaRequirementRemains = ContractProbeAssert<
  ProbeQaService extends ContractProbeEffectRequirements<typeof dispatchWithUnresolvedRequirement>
    ? true
    : false
>;

const duplicateFailureProbe = composeGame([moduleWithoutQa]);
type DuplicateModuleContractIsReturned = ContractProbeAssert<
  DuplicateModuleContract extends ContractProbeError<typeof duplicateFailureProbe> ? true : false
>;
```

4. **Consumers.** Each owning module registers observations and commands under its QA namespace. Compose merges distinct namespaces for end-to-end tests against the fully composed host. Tests read state through owner observe operations rather than DOM attributes. Keep `window.__NERIMA_GAMES_QA__` as one transport slot whose only operation is dispatching `(namespace, operation, inputJson)` to `QaBridge.run`; it is not an operation registry. Host tests call the retrieved `QaBridge` service's `run` method with the QA namespace's `name`, an operation key from `observe` or `command`, and JSON input.
5. **Compatibility.** A slice ID remains stable for the lifetime of the saved data. A shape change increments only that slice's version. Treat migrations as a directed version graph whose edges always increase the version; array order does not select a path. Each supported stored version must have one complete path to the current version. Each migration decodes its source's encoded data, transforms the decoded value, and encodes it with the target codec; the next migration receives that encoded result. After the final migration, decode the current version before restore. `mc-sim` gathers registered snapshots; `mc-save` encodes each with its registered codec and stores the bundle. W2 validates the legacy envelope's format, version, and integrity. The initial migration supports the existing v3 envelope only; other legacy versions are rejected before any slice restore. For v3, `mc-save` passes only the validated payload to `migrateSimulationSaveV3`. `LegacySimulationSaveV3Schema` validates inventory as an array of `null` or an item stack accepted by `isItemStack`, matching the v3 save format. `LegacyItemStackSchema` maps the v3 component `null` placeholders to the current `ItemStack` representation while decoding and reverses that mapping when encoding. The migration decodes that payload, maps its fields to raw slice inputs in an Effect, then decodes each input with its registered slice codec before encoding the initial player, time, inventory, and statistics slices at their registered versions. The mapper and slice decoders report `Schema.SchemaError`; they use no casts or thrown exceptions. Map v3 player position to `PlayerService`'s `pose.feetPosition`; set `yawRadians` and `pitchRadians` to 0 because v3 stored no orientation; preserve `dimension` in the same player slice. Map `tick` to the time slice with `dayLengthTicks` 24000 because v3 stored no day-length denominator. Map inventory and `selectedHotbarSlot` together into the initial inventory slice; map counters and unlocked achievements into the statistics slice. These four registered slices receive the v3 data; additional registered slices are initialized by normal world startup, not restored from the legacy payload. Encode every v3 target slice before restore. Decode or encode failure invokes no restore. Restore the four migrated slices in an unpublished world session; if any restore fails or is interrupted, close that session and expose no partially restored world. The host registers it only after every restore succeeds. `mc-save` adds generic legacy-envelope decoding in W2. `mc-sim` registers the v3 fan-out migration in W3 after the initial slice schemas exist. If no complete per-slice migration path exists for a stored slice, restore fails with `SaveMigrationPathMissing`; if multiple paths exist, it fails with `SaveMigrationPathAmbiguous`. Both errors carry the slice ID, stored version, and current version, and neither invokes that slice's restore.
6. **Wave.** Fix the module and slice type shape in W1. In W2, decode the legacy save envelope. In W3, map the existing v3 payload into the initial player, time, inventory, and statistics slices. In W5, move the 37 host E2E tests to `mc-host-web`, remove the old function registry and install/read API from `mc-compose`, and have `mc-host-web` decide the browser startup wiring and which resources to roll back on startup failure.

## C2: Simulation intent queue

1. **Placement.** Add the intent vocabulary and queue service to `mc-sim/src/application/intent-queue.ts`. `mc-sim` creates one queue layer when a world session starts, scopes it to that session's Effect layer, and disposes it when the session closes. The host's world-session registry maps each `WorldId` to that session's scope; ingress resolves the ID there and runs the queue service from that scope. `enqueue` receives no world identifier. Gameplay stages consume ready intents; local input, network receive, and host adapters submit through the same queue.
2. **Effect 4 types.** `enqueue` returns the queue sequence or a typed `IntentQueueFull` failure. Queue admission is serialized; it assigns the next sequence in admission order, starting at zero for a world session. `takeReady(tick)` removes and returns entries with `targetTick <= tick`. Replaying the same accepted intents with the same assigned sequences preserves processing order; differing network arrival timing can produce a different accepted order. Commit each processed intent separately. At commit time, check the expected revisions on network intents; enqueue does not check either revision. One successful intent creates one C4 group delta, while a failed intent creates none.
3. **Schema shape.** The initial tagged union covers block break, block place, and item use. Each intent's `id` is its correlation ID; ingress adapters keep it unique within its world session and preserve it through processing. Intents also carry a target simulation tick, source tag, and actor; block-changing payloads carry a dimension-qualified address. Network commands carry both expected revisions on the wire, and network intents retain them until commit. `expectedRevision` is the expected current world revision; it maps to C7's wire field `expectedWorldRevision`. At commit, compare it with the current world revision, and compare `expectedDimensionRevision` with the current revision of the addressed block's dimension for block intents or the current revision of the actor's dimension for `UseItem`. Decode local and network payloads before enqueueing. Order ready work by target tick and then assigned sequence.

```ts
export const IntentSequenceSchema = Schema.Int
  .check(Schema.isGreaterThanOrEqualTo(0))
  .pipe(Schema.brand("IntentSequence"));
export type IntentSequence = Schema.Schema.Type<typeof IntentSequenceSchema>;

export const IntentQueueCapacitySchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("IntentQueueCapacity"));
export type IntentQueueCapacity = Schema.Schema.Type<typeof IntentQueueCapacitySchema>;

export const IntentIdSchema = Schema.NonEmptyString.pipe(Schema.brand("IntentId"));
export type IntentId = Schema.Schema.Type<typeof IntentIdSchema>;

const BreakBlockIntentSchema = Schema.TaggedStruct("BreakBlock", {
  actor: EntityIdSchema,
  address: BlockAddressSchema
});
const PlaceBlockIntentSchema = Schema.TaggedStruct("PlaceBlock", {
  actor: EntityIdSchema,
  address: BlockAddressSchema,
  block: BlockIdSchema
});
const UseItemIntentSchema = Schema.TaggedStruct("UseItem", {
  actor: EntityIdSchema,
  item: ItemIdSchema
});

export const IntentPayloadSchema = Schema.Union([
  BreakBlockIntentSchema,
  PlaceBlockIntentSchema,
  UseItemIntentSchema
]);

const LocalIntentSchema = Schema.Struct({
  id: IntentIdSchema,
  targetTick: SimulationTickSchema,
  source: Schema.Literals(["local"]),
  payload: IntentPayloadSchema
});

const NetworkIntentSchema = Schema.Struct({
  id: IntentIdSchema,
  targetTick: SimulationTickSchema,
  source: Schema.Literals(["network"]),
  payload: IntentPayloadSchema,
  expectedRevision: WorldRevisionSchema,
  expectedDimensionRevision: DimensionRevisionSchema
});

export const IntentSchema = Schema.Union([LocalIntentSchema, NetworkIntentSchema]);
export type Intent = Schema.Schema.Type<typeof IntentSchema>;

export const QueuedIntentSchema = Schema.Struct({
  sequence: IntentSequenceSchema,
  intent: IntentSchema
});
export type QueuedIntent = Schema.Schema.Type<typeof QueuedIntentSchema>;

export class IntentQueueFull extends Schema.TaggedError<IntentQueueFull>()("IntentQueueFull", {
  capacity: IntentQueueCapacitySchema
}) {}

export class IntentQueue extends Context.Service<IntentQueue, {
  readonly enqueue: (intent: Intent) => Effect.Effect<IntentSequence, IntentQueueFull>;
  readonly takeReady: (tick: SimulationTick) => Effect.Effect<ReadonlyArray<QueuedIntent>>;
}>()("mc-sim/application/IntentQueue") {}

export declare const IntentQueueLayer: (
  config: { readonly capacity: IntentQueueCapacity }
) => Layer.Layer<IntentQueue>;
```

The configured capacity bounds pending entries; `enqueue` fails with `IntentQueueFull` containing that capacity when full, without allocating a sequence. Sequence state cannot be reset during a live world session. Once `takeReady` returns an entry, the queue has consumed it and does not retry or re-enqueue it if downstream processing fails or is interrupted; that failure propagates to the simulation caller.

4. **Consumers.** `mx-gameplay` and `mx-redstone` translate accepted intents into domain operations. `mx-multiplayer` validates and forwards network commands; hosts adapt device input. These paths do not apply game rules in the transport layer.
5. **Compatibility.** The intent queue is an in-process simulation contract. If intent payloads are sent over the network, their encoded envelope is governed by the multiplayer protocol version, not by save-slice versions. Unknown tags fail schema decoding before entering the queue.
6. **Wave.** Finalize in W3, before gameplay, redstone, multiplayer, and host streams wire their command paths.

## C3: Domain events

1. **Placement.** Put event tags and payload vocabulary in `mc-kernel` (proposed `src/domain/event/domain-event.ts`). Put the in-process `DomainEventBus` service in `mc-sim/src/application/domain-event-bus.ts`.
2. **Effect 4 types.** Producers publish typed events through Effect. Consumers subscribe to a `Stream`; they do not depend on producer services. Publish only after the corresponding state transition succeeds.
3. **Schema shape.** Payloads carry the originating tick and branded IDs. `WorldPosition` x/y/z coordinates use blocks, with one coordinate unit equal to one block. `EntityDamaged` and `LevelUp` capture their `WorldPosition` when created, so consumers do not resolve position later. `DamageAmount` is a positive finite number of health points and may be fractional after mitigation. It has no fixed upper bound so events can represent overkill and variable maximum health. `ExplosionPower` is an integer from 1 through 6 in the current game scale; its radius is twice the power in blocks. `ExperienceLevel` is a safe integer from 0 through `Number.MAX_SAFE_INTEGER`; a `LevelUp` event carries a strictly positive level. W1 fixes these bounds.

```ts
export const DamageAmountSchema = Schema.Finite
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("DamageAmount"));
export type DamageAmount = Schema.Schema.Type<typeof DamageAmountSchema>;

export const ExplosionPowerSchema = Schema.Int
  .check(Schema.isBetween({ minimum: 1, maximum: 6 }))
  .pipe(Schema.brand("ExplosionPower"));
export type ExplosionPower = Schema.Schema.Type<typeof ExplosionPowerSchema>;

export const ExperienceLevelSchema = Schema.Int
  .check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
  .pipe(Schema.brand("ExperienceLevel"));
export type ExperienceLevel = Schema.Schema.Type<typeof ExperienceLevelSchema>;

export const LevelUpLevelSchema = Schema.Int
  .check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }))
  .pipe(Schema.brand("LevelUpLevel"));
export type LevelUpLevel = Schema.Schema.Type<typeof LevelUpLevelSchema>;

export const AchievementIdSchema = Schema.NonEmptyString.pipe(Schema.brand("AchievementId"));
export type DomainEventAchievementId = Schema.Schema.Type<typeof AchievementIdSchema>;

export const DomainEventSchema = Schema.Union([
  Schema.TaggedStruct("EntityDamaged", {
    tick: SimulationTickSchema,
    entity: EntityIdSchema,
    position: WorldPositionSchema,
    amount: DamageAmountSchema
  }),
  Schema.TaggedStruct("BlockBroken", {
    tick: SimulationTickSchema,
    actor: EntityIdSchema,
    address: BlockAddressSchema,
    block: BlockIdSchema
  }),
  Schema.TaggedStruct("Explosion", {
    tick: SimulationTickSchema,
    position: WorldPositionSchema,
    power: ExplosionPowerSchema
  }),
  Schema.TaggedStruct("LevelUp", {
    tick: SimulationTickSchema,
    entity: EntityIdSchema,
    position: WorldPositionSchema,
    level: LevelUpLevelSchema
  }),
  Schema.TaggedStruct("AchievementUnlocked", {
    tick: SimulationTickSchema,
    player: EntityIdSchema,
    achievement: AchievementIdSchema
  })
]);
export type DomainEvent = Schema.Schema.Type<typeof DomainEventSchema>;

export class DomainEventBus extends Context.Service<DomainEventBus, {
  readonly publish: (event: DomainEvent) => Effect.Effect<void>;
  readonly events: Stream.Stream<DomainEvent>;
}>()("mc-sim/application/DomainEventBus") {}

export const EventSubscriberCapacitySchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("EventSubscriberCapacity"));
export type EventSubscriberCapacity = Schema.Schema.Type<typeof EventSubscriberCapacitySchema>;

export declare const DomainEventBusLayer: (
  capacity: EventSubscriberCapacity
) => Layer.Layer<DomainEventBus>;
```

4. **Consumers.** `mx-ui` maps events to toast state, and a host audio adapter maps them to sound cues. Keep those translations outside the kernel vocabulary and the bus.
5. **Compatibility.** Each independent consumption of `events` creates a subscriber when stream evaluation begins; completion or interruption closes it. The bus snapshots active subscribers when `publish` begins, so later subscribers do not receive that event. If the set is empty, `publish` completes without buffering for later subscribers. Concurrent publish calls are linearized so every subscriber observes the same order. Compose supplies a positive integer queue capacity per subscriber; there is no default. If any recipient queue is full, `publish` suspends until capacity is available, then enqueues the event for every still-open recipient and completes. A recipient that closes while publication waits is removed from the pending set. If `publish` is interrupted while waiting, no recipient receives that event and the Effect fails by interruption. The stream is transient: do not save, replay, or replicate it as authoritative state. Network synchronization uses C4 state snapshots or an explicitly versioned protocol message. Open: W3 chooses the concrete positive capacity after subscriber fanout and backpressure behavior are integrated.
6. **Wave.** Freeze vocabulary in W1 so independent streams can target it; implement and export the bus in W3.

## C4: Replicated state

1. **Placement.** Authoritative state and snapshot services belong to `mc-sim`. `mx-multiplayer` owns wire encoding, validation, and delivery; `mc-server` composes the same simulation services used by the browser host.
2. **Effect 4 types.** State is exposed as a world-scoped snapshot. Mutations remain in owner services, and each owner routes replicated writes through the `mc-sim` world-session `WorldCommitCoordinator`. An owner validates its candidate and submits it in `WorldCommitRequest.changes`, with `expectedRevision` and `expectedDimensions`; it does not mutate replicated state directly. The request may also include `blockWrite?: WorldWriteBatch`. The coordinator serializes each accepted request into one local world-session commit and increments the shared world revision once. Under that gate, it validates the candidates and batch, then requires `blockWrite.world` to match its world, `blockWrite.expectedWorldRevision` to match request `expectedRevision`, and every `{ dimension, expectedRevision }` entry for `blockWrite.dimension` in `expectedDimensions` to match `blockWrite.expectedDimensionRevision` (at least one matching entry is required). A mismatch fails as `WorldCommitBlockWriteMismatch` with reason `world`, `world-revision`, or `dimension-revision`. It then compares request expectations with current revisions and prepares the ChunkStore write. It prepares the next owner state, revisions, and `ReplicatedWorldDelta`, publishes the ChunkStore write, then exposes the committed owner state and revisions and returns the delta. No fallible work follows publication. ChunkStore (`mc-worldgen`) owns block state, which is not part of a C4 owner snapshot. The coordinator's `observe` API reads owner state and block values under the same gate and revision. Callers that read through ChunkStore `load` or `peek` directly reread after commit when they need current values. Owner snapshot services read state and revision from the committed version. The network adapter sends the committed group as one message after the local commit; transport delivery is outside that transaction. Clients validate and apply the entire group atomically, then advance the shared world revision once.
3. **Schema shape.** A snapshot carries a `WorldId`, a monotonically increasing `WorldRevision` within that world, and the owner's state codec; it does not contain chunks. The player example extends the existing `PlayerService` API with a snapshot that combines the service's coordinate-only `pose.feetPosition` and `dimension` into the `WorldPosition` used in the snapshot. It does not create another player-state service. Other owner services provide their own codecs.

```ts
export const replicatedSnapshotSchema = <State extends Schema.Codec<unknown>>(state: State) =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: WorldRevisionSchema,
    state
  });

export type ReplicatedSnapshot<State extends Schema.Codec<unknown>> = Readonly<{
  world: WorldId;
  revision: WorldRevision;
  state: State["Type"];
}>;

export const ReplicatedOwnerIdSchema = Schema.NonEmptyString.pipe(Schema.brand("ReplicatedOwnerId"));
export type ReplicatedOwnerId = Schema.Schema.Type<typeof ReplicatedOwnerIdSchema>;

export const replicatedOwnerChangeSchema = <const Owner extends string, State extends Schema.Codec<unknown>>(
  owner: Owner,
  state: State
) =>
  Schema.Struct({
    owner: Schema.Literals([owner] as const).pipe(Schema.brand("ReplicatedOwnerId")),
    state
  });

export type ReplicatedBlockChange = Readonly<{
  dimension: Dimension;
  position: BlockPosition;
  before: BlockId;
  after: BlockId;
}>;

const SafeBlockAxisSchema: Schema.Codec<BlockPosition["x"], number> = Schema.Int
  .check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }))
  .pipe(Schema.brand("BlockAxis"));

export const WorldBlockPositionSchema: Schema.Codec<
  BlockPosition,
  Readonly<{ x: number; y: number; z: number }>
> = Schema.Struct({
  x: SafeBlockAxisSchema,
  y: SafeBlockAxisSchema,
  z: SafeBlockAxisSchema
});

export const ReplicatedBlockChangeSchema: Schema.Codec<ReplicatedBlockChange, Readonly<{
  dimension: Dimension;
  position: Schema.Codec.Encoded<typeof WorldBlockPositionSchema>;
  before: Schema.Codec.Encoded<typeof BlockIdSchema>;
  after: Schema.Codec.Encoded<typeof BlockIdSchema>;
}>> = Schema.Struct({
  dimension: Schema.Literals(DIMENSIONS),
  position: WorldBlockPositionSchema,
  before: BlockIdSchema,
  after: BlockIdSchema
});

export const replicatedWorldDeltaSchema = <Change extends Schema.Codec<unknown>>(change: Change) =>
  Schema.Struct({
    world: WorldIdSchema,
    revision: WorldRevisionSchema,
    changes: Schema.Array(change),
    blockChanges: Schema.Array(ReplicatedBlockChangeSchema)
  });

export type ReplicatedWorldDelta<Change> = Readonly<{
  readonly world: WorldId;
  readonly revision: WorldRevision;
  readonly changes: ReadonlyArray<Change>;
  readonly blockChanges: ReadonlyArray<ReplicatedBlockChange>;
}>;

export const YawRadiansSchema = Schema.Finite.pipe(Schema.brand("YawRadians"));
export type YawRadians = Schema.Schema.Type<typeof YawRadiansSchema>;

export const PitchRadiansSchema = Schema.Finite.pipe(Schema.brand("PitchRadians"));
export type PitchRadians = Schema.Schema.Type<typeof PitchRadiansSchema>;

export const PlayerPoseSchema = Schema.Struct({
  feetPosition: WorldPositionSchema,
  yawRadians: YawRadiansSchema,
  pitchRadians: PitchRadiansSchema
});

export const PlayerServiceSnapshotSchema = Schema.Struct({
  pose: PlayerPoseSchema
});

export const PlayerOwnerChangeSchema = replicatedOwnerChangeSchema("player", PlayerServiceSnapshotSchema);
export const ExampleWorldDeltaSchema = replicatedWorldDeltaSchema(
  Schema.Union([PlayerOwnerChangeSchema])
);

export type PlayerServiceApiWithSnapshot<ExistingPlayerServiceApi> = ExistingPlayerServiceApi & {
  readonly snapshot: Effect.Effect<ReplicatedSnapshot<typeof PlayerServiceSnapshotSchema>>;
};
```

4. **Consumers.** The server supplies owner-service snapshots to `mx-multiplayer`; the multiplayer adapter sends them to clients, which apply deltas according to the revision rule below.
5. **Compatibility.** Snapshot codecs are protocol data, not save slices. Wire incompatibility is handled by multiplayer protocol versioning. A newly initialized world starts at revision zero, and its initial snapshot is the client's baseline. All replicated owner services in one world share a single revision sequence, incremented once by `mc-sim` for each successful coordinator commit. A failed intent commit changes neither owner state nor `WorldRevision`. Group every changed owner snapshot from one transition into one world delta; `mx-multiplayer` delivers that group as a unit, and clients validate every owner payload before atomically applying the whole group and advancing `WorldRevision` once. A delta's revision identifies the state after applying that transition; apply it only when its world matches and its revision equals the current revision plus one. A duplicate, stale revision, gap, or invalid member rejects the whole group and requires a resync snapshot. A C7 batch contributes dimension-scoped, sparse `blockChanges` to the same C4 group delta and `WorldRevision` as any owner changes in that commit; it does not produce a world-block owner snapshot. The local commit updates the owner state, the `DimensionRevision`, and the world's `WorldRevision` atomically, and creates the group delta in that same commit. Network delivery follows the local commit; a failed or interrupted batch changes neither block state, owner state, nor revisions and creates no delta. `mx-multiplayer` owns versioned delta envelopes and payload fields; this contract fixes state ownership and revision semantics. The addition of same-revision block changes changes the grouped-delta wire contract. W4 assigns `PROTOCOL_VERSION`'s move from v9 to v10 to `mx-multiplayer`; v9 peers are rejected, and this contract does not define the v10 shape. This incompatible change is allowed in the 0.x minor release.
6. **Wave.** Finalize service ownership and snapshot shape in W3. Freeze the grouped-delta wire contract in W4 before W5 host and server wiring.

## C5: Deterministic headless harness

1. **Placement.** Implement the harness in `mc-sim/src/testing` and expose a dedicated `@nerima-games/mc-sim/testing` entry point.
2. **Effect 4 types.** The test layer provides deterministic Clock and Random services to the simulation. `reset(seed)` closes the previous session, creates a fresh session through normal world initialization, sets its simulation tick and Clock to zero, clears queued intents, and initializes Random from the seed. `enqueue` forwards typed test inputs to that session's C2 `IntentQueue`; `step(count)` advances exactly that many simulation ticks, processes ready intents, and advances Clock by the same count. Clock is measured in simulation ticks. The same build, seed, inputs, and Random call order reproduce the initial world and Random values; repeatability is not promised across builds. `stateHash` fails with `Schema.SchemaError` if a save-slice codec cannot encode state, or `StateHashNonJsonValue` if encoded data is outside the allowed JSON value set. It returns no partial hash on failure.
3. **Schema shape.** Seed, step count, and hash use named brands. Snapshot and encode every registered C1 save slice, then hash a JSON object keyed by `SaveSliceId`; each value contains that slice's `version` and encoded `data`, so IDs, versions, and data all participate. Accept only values in the shared JSON domain. Recursively serialize objects with keys emitted in UTF-16 code-unit order, preserve array order, and use JavaScript `JSON.stringify` number and string formatting. `stateHash` is lowercase hexadecimal SHA-256 of the resulting UTF-8 bytes; render and other derived caches are excluded.

```ts
export const TickCountSchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("TickCount"));
export type TickCount = Schema.Schema.Type<typeof TickCountSchema>;

export const RandomSeedSchema = Schema.Int.pipe(Schema.brand("RandomSeed"));
export type RandomSeed = Schema.Schema.Type<typeof RandomSeedSchema>;

export const StateHashSchema = Schema.String
  .check(Schema.isPattern(/^[0-9a-f]{64}$/))
  .pipe(Schema.brand("StateHash"));
export type StateHash = Schema.Schema.Type<typeof StateHashSchema>;

export class StateHashNonJsonValue extends Schema.TaggedError<StateHashNonJsonValue>()("StateHashNonJsonValue", {
  sliceId: SaveSliceIdSchema,
  path: Schema.NonEmptyString
}) {}

export class HeadlessHarness extends Context.Service<HeadlessHarness, {
  readonly reset: (seed: RandomSeed) => Effect.Effect<void>;
  readonly enqueue: IntentQueue["Service"]["enqueue"];
  readonly step: (count: TickCount) => Effect.Effect<void>;
  readonly stateHash: Effect.Effect<StateHash, Schema.SchemaError | StateHashNonJsonValue>;
}>()("mc-sim/testing/HeadlessHarness") {}

export declare const HeadlessHarnessTestLayer: Layer.Layer<HeadlessHarness>;
```

4. **Consumers.** All `mx-*` packages and `mc-server` use the harness to advance simulation for rule-level and integration tests without a browser or renderer.
5. **Compatibility.** Keep the testing entry separate from the production package entry. Expected hashes live beside the consuming package's headless tests and their inputs. Hash stability is a test contract; intentional changes to canonical state coverage, ordering, or encoding update those fixtures. Open: W3 chooses the Random algorithm because repeatability depends on using the simulation's concrete Random service.
6. **Wave.** Implement in W3 so later package streams can test their rules against a common simulation clock and random source.

## C6: Particle request API

1. **Placement.** Add the request schema and service to `mc-render` (proposed `src/application/particle-service.ts`). Rendering owns particle allocation and defaults. Put the W3 browser-host adapter in `mc-playground-kit`; it maps C3 events to particle requests and calls the `mc-render` service.
2. **Effect 4 types.** `spawn` accepts one typed request and returns the accepted count (`0` or `1`) as an Effect value. A full pool may reject a spawn without failing simulation state.
3. **Schema shape.** Requests include a finite set of particle kinds, branded dimension-aware world position, optional RGB channels in `[0, 1]`, optional positive finite lifetime in seconds, optional branded direction, and optional followed entity ID. `lifetimeSeconds` is measured in render time, not simulation ticks. Direction is an unnormalized world-space vector; initial velocity is direction multiplied by the particle kind's configured base speed in world units per second. The zero vector means no initial directional velocity.

```ts
export const ParticleKindSchema = Schema.Literals([
  "block-break",
  "entity-hit",
  "explosion",
  "level-up"
]);

export const ParticleColorChannelSchema = Schema.Finite
  .check(Schema.isBetween({ minimum: 0, maximum: 1 }))
  .pipe(Schema.brand("ParticleColorChannel"));
export type ParticleColorChannel = Schema.Schema.Type<typeof ParticleColorChannelSchema>;

export const ParticleColorSchema = Schema.Struct({
  red: ParticleColorChannelSchema,
  green: ParticleColorChannelSchema,
  blue: ParticleColorChannelSchema
});

export const ParticleDirectionSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite
}).pipe(Schema.brand("ParticleDirection"));
export type ParticleDirection = Schema.Schema.Type<typeof ParticleDirectionSchema>;

export const ParticleLifetimeSecondsSchema = Schema.Finite
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("ParticleLifetimeSeconds"));
export type ParticleLifetimeSeconds = Schema.Schema.Type<typeof ParticleLifetimeSecondsSchema>;

export const ParticleRequestSchema = Schema.Struct({
  kind: ParticleKindSchema,
  position: WorldPositionSchema,
  color: Schema.optional(ParticleColorSchema),
  lifetimeSeconds: Schema.optional(ParticleLifetimeSecondsSchema),
  direction: Schema.optional(ParticleDirectionSchema),
  followEntity: Schema.optional(EntityIdSchema)
});

export class ParticleService extends Context.Service<ParticleService, {
  readonly spawn: (
    request: Schema.Schema.Type<typeof ParticleRequestSchema>
  ) => Effect.Effect<0 | 1>;
}>()("mc-render/application/ParticleService") {}
```

4. **Consumers.** The `mc-playground-kit` render adapter consumes C3 events and calls the particle service. `mx-gameplay` emits semantic events and remains independent of `mc-render`; the C3 adapter supplies the connection.
5. **Compatibility.** Particle requests are presentation data, not replicated or saved state. Unspecified appearance fields use the kind's render defaults. Open: W3 decides behavior when a followed entity is removed because the answer depends on render-pool ownership and particle lifetime cleanup.
6. **Wave.** Finalize and implement the `mc-render` service and `mc-playground-kit` adapter in W3 alongside event consumers.

## C7: Generic world-write port

1. **Placement.** Define `WorldWritePort` and its data vocabulary in `mc-kernel/src/domain/world/world-write-port.ts`. Put the `MultiplayerWorldWriter` alias in `mx-multiplayer/src/domain/world-write.ts` and re-export it from the multiplayer package entry point. Open: W4 selects the adapter file and export after `mx-redstone` and `mx-multiplayer` finalize their contracts, because the placement depends on their consumer boundary; W5 wires that adapter in `mc-host-web` and `mc-server`.
2. **Effect 4 types.** `applyBatch` is an atomic, dual-revision-checked Effect operation. It returns both the committed dimension and world revisions or a typed conflict, invalid-batch, or unavailable-chunk failure. Validate the entire batch before checking revisions or writing. The network adapter checks the expected world revision first, then the expected dimension revision. The world-session commit coordinator rechecks both in the same transaction as the writes to prevent a time-of-check/time-of-use race. The coordinator accepts the C7 batch as optional `blockWrite` on `WorldCommitRequest`, together with any owner candidate changes for that action. It prepares and publishes the ChunkStore write in the same commit, then advances the world revision once and the batch dimension revision once. The delta contains dimension-scoped, sparse `blockChanges` at that same world revision rather than a world-block owner snapshot. A missing chunk keeps the kernel's typed `WorldWriteChunkUnavailable` failure. When the batch is submitted through `WorldCommitRequest.blockWrite`, a batch/request mismatch returns `WorldCommitBlockWriteMismatch`; once aligned, stale request revisions use the C4 `WorldRevisionConflict` or `DimensionRevisionConflict`. Out-of-range positions return `WorldCommitBlockWriteInvalidPosition`, ChunkStore stale publication returns `WorldWriteStale`, and an invalid prepared token returns the typed internal `WorldWriteTokenInvalid` failure. Other ChunkStore prepare validation failures return `WorldCommitBlockWritePrepareInvalid` with reason `not-array`, `invalid-edit`, `invalid-position`, `invalid-block-id`, or `out-of-world`. The batch-related members of `WorldCommitCoordinatorError` are `WorldCommitBlockWriteMismatch`, `WorldCommitChunkStoreUnavailable`, `WorldWriteChunkUnavailable`, `WorldWriteInvalidBatch`, `WorldCommitBlockWriteInvalidPosition`, `WorldCommitBlockWritePrepareInvalid`, `WorldWriteStale`, and `WorldWriteTokenInvalid`; existing C4 request, schema, owner, and revision failures also remain in that union. The kernel `WorldWritePort.applyBatch` error union remains `WorldWriteConflict | WorldWriteInvalidBatch | WorldWriteChunkUnavailable`. `WorldWriteStale` remains a typed ChunkStore stale failure and is not mapped to C4 `WorldRevisionConflict` with invented revision values. Any failure leaves block state, owner state, and both revisions unchanged and creates no delta.
3. **Schema shape.** A batch names its world, expected `WorldRevision`, dimension, expected `DimensionRevision`, and block edits. `WorldWritePort.applyBatch` rejects empty batches and duplicate positions as `WorldWriteInvalidBatch`; stale expected world or dimension revisions return `WorldWriteConflict` with the expected and current revisions. The coordinator decodes the batch and its edit list, then checks the vertical world bounds and returns `WorldCommitBlockWriteInvalidPosition` for positions with `y < 0` or `y >= CHUNK_HEIGHT`, not `WorldWriteInvalidBatch`. `WorldBlockPositionSchema`, used for replicated block changes and typed invalid-position payloads, requires safe integer axes. Validate batch structure before checking revisions, so an empty or duplicate-position batch fails as invalid even when either expected revision is stale. `WorldRevision` is checked before `DimensionRevision` at the network boundary.

```ts
export const BlockEditSchema = Schema.Struct({
  position: BlockPositionSchema,
  block: BlockIdSchema
});
export type WorldWriteBlockEdit = Schema.Schema.Type<typeof BlockEditSchema>;

export const WorldWriteBatchSchema = Schema.Struct({
  world: WorldIdSchema,
  expectedWorldRevision: WorldRevisionSchema,
  dimension: DimensionIdSchema,
  expectedDimensionRevision: DimensionRevisionSchema,
  edits: Schema.Array(BlockEditSchema)
});
export type WorldWriteBatch = Schema.Schema.Type<typeof WorldWriteBatchSchema>;

export const WorldWriteCommitSchema = Schema.Struct({
  worldRevision: WorldRevisionSchema,
  dimensionRevision: DimensionRevisionSchema
});
export type WorldWriteCommit = Schema.Schema.Type<typeof WorldWriteCommitSchema>;

export class WorldWriteConflict extends Schema.TaggedError<WorldWriteConflict>()("WorldWriteConflict", {
  expectedWorldRevision: WorldRevisionSchema,
  currentWorldRevision: WorldRevisionSchema,
  expectedDimensionRevision: DimensionRevisionSchema,
  currentDimensionRevision: DimensionRevisionSchema
}) {}

export class WorldWriteInvalidBatch extends Schema.TaggedError<WorldWriteInvalidBatch>()("WorldWriteInvalidBatch", {
  reason: Schema.Literals(["empty", "duplicate-position"])
}) {}

export class WorldWritePort extends Context.Service<WorldWritePort, {
  readonly applyBatch: (
    batch: WorldWriteBatch
  ) => Effect.Effect<WorldWriteCommit, WorldWriteConflict | WorldWriteInvalidBatch | WorldWriteChunkUnavailable>;
}>()("mc-kernel/domain/world/WorldWritePort") {}

export type MultiplayerWorldWriter = WorldWritePort["Service"];
```

4. **Consumers.** The server command adapter authenticates the remote peer; `mx-gameplay` validates game rules before issuing an accepted block write. The port enforces batch validity and revision atomicity, not gameplay authorization. `mx-redstone` is connected through host composition to the same world adapter and does not depend on multiplayer. Browser and server hosts provide equivalent adapters.
5. **Compatibility.** Dimension revisions are a distinct branded type from C4 world revisions. A stale batch has no partial effects. If the batch itself is put on the wire, its message shape is governed by protocol versioning; it is not a save-slice migration.
6. **Wave.** Freeze the port type in W1. W4 finalizes the mx consumer contracts and adapter placement only; W5 wires the adapter in `mc-host-web` and `mc-server`.

## Verification notes

The type check requires Node.js, npm, Python 3, and network access to install packages. Run it from the repository root. It creates its files and installs packages in a temporary directory, which remains afterward so the generated module and installed packages can be inspected.

```sh
scratch=$(mktemp -d)
export SCRATCH="$scratch"
python3 - <<'PY'
import os
import re
from pathlib import Path

document = Path("docs/execution/contracts.md").read_text()
blocks = re.findall(r"```ts\n(.*?)\n```", document, flags=re.S)
Path(os.environ["SCRATCH"], "contracts.ts").write_text("\n\n".join(blocks) + "\n")
Path(os.environ["SCRATCH"], "mc-kernel.d.ts").write_text('''declare module "@nerima-games/mc-kernel" {
  export const DIMENSIONS: readonly ["overworld", "nether", "end"];
  export type Dimension = typeof DIMENSIONS[number];
  export type ItemStack = Readonly<{ item: string; count: number; components: unknown }>;
  export const isItemStack: (value: unknown) => value is ItemStack;
  export type WorldWriteChunkUnavailable = Readonly<{ _tag: "WorldWriteChunkUnavailable" }>;
}
''')
PY
cat > "$SCRATCH/tsconfig.json" <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["contracts.ts", "mc-kernel.d.ts"]
}
JSON
npm install --prefix "$SCRATCH" --no-save effect@4.0.5 typescript@7.0.2
"$SCRATCH/node_modules/.bin/tsc" --noEmit -p "$SCRATCH/tsconfig.json"
```

The probe stubs the kernel item-stack guard, dimension union, and unavailable-chunk error tag, and checks signatures and Schema APIs only; runtime ordering, migration completeness, event delivery, revision policy, atomic writes, and package integration remain implementation and test obligations for their listed waves.

Effect 4 service and layer conventions follow the [official Effect v4 layer guide](https://effect.website/docs/v4/requirements-management/layers).
