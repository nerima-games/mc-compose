# Cross-Package Contract Sketches C1–C7

This document records proposed type boundaries for C1–C7. Its TypeScript code blocks compile together as one temporary module against Effect 4.0.5 and TypeScript 7.0.2. `mc-compose` still declares Effect 3.22.1, so this check does not typecheck the package itself.

Effect 4 is the target API. W0 is the preparation wave that records and typechecks the proposals; W1 adopts Effect 4 in `mc-kernel` and `mc-compose` before implementing C1. Each later owning package adopts it in the first wave that implements its contract.

Package implementation waves follow W0: W1 updates `mc-kernel` and `mc-compose`; W2 updates `mc-noise`, `mc-meshing`, `mc-physics`, `mc-save`, and `mc-audio` as an intervening package migration wave with no C1–C7 surface; W3 updates `mc-worldgen`, `mc-sim`, `mc-render`, and `mc-playground-kit`; W4 integrates `mx-gameplay`, `mx-redstone`, `mx-ui`, and `mx-multiplayer`. A contract's wave identifies when its API is fixed or implemented.

## Contract map

| ID | Owning package and proposed surface | Wave | Consumers |
|---|---|---:|---|
| C1 | `mc-kernel`, `GameModule` extensions in `src/domain/time/frame.ts` | W1 | All game modules and compose |
| C2 | `mc-sim`, `IntentQueue` in `src/application/intent-queue.ts` | W3 | `mx-gameplay`, `mx-redstone`, `mx-multiplayer`, hosts |
| C3 | Event vocabulary in `mc-kernel`; `DomainEventBus` in `mc-sim` | W1 vocabulary, W3 bus | Render, UI, gameplay adapters |
| C4 | Replicated state services in `mc-sim`; codecs in `mx-multiplayer` | W3 | `mx-multiplayer`, `mc-server` |
| C5 | `mc-sim`, `@nerima-games/mc-sim/testing` | W3 | All `mx-*` packages and `mc-server` |
| C6 | `mc-render`, particle request service | W3 | Render adapter; gameplay reaches it through C3 events |
| C7 | Port in `mc-kernel`; public writer alias in `mx-multiplayer` | W1 type, W4 wiring | `mc-server`, `mc-host-web`, redstone host adapter |

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
import { Brand, Context, Effect, Layer, Schema, Stream } from "effect";

export type EntityId = Brand.Branded<string, "EntityId">;
export const EntityIdSchema = Schema.NonEmptyString.pipe(Schema.brand("EntityId"));

export type DimensionId = Brand.Branded<string, "DimensionId">;
export const DimensionIdSchema = Schema.NonEmptyString.pipe(Schema.brand("DimensionId"));

export type WorldId = Brand.Branded<string, "WorldId">;
export const WorldIdSchema = Schema.NonEmptyString.pipe(Schema.brand("WorldId"));

export type BlockId = Brand.Branded<string, "BlockId">;
export const BlockIdSchema = Schema.NonEmptyString.pipe(Schema.brand("BlockId"));

export const BlockPositionSchema = Schema.Struct({
  x: Schema.Int,
  y: Schema.Int,
  z: Schema.Int
}).pipe(Schema.brand("BlockPosition"));
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

1. **Placement.** Extend `GameModule` in `mc-kernel/src/domain/time/frame.ts` with optional `qa` and `saveSlices` members. In compose, preserve both fields when registering modules and merge them. Reject composition with `DuplicateModuleContract` when a QA namespace or save-slice ID is duplicated; include its kind and ID and expose no partially merged registry. Keep the QA bridge in compose and expose `QaBridge.run(namespaceName, operationName, inputJson)`. Namespace and operation are separate names, not a dotted lookup path. Operation names must be unique across each namespace's combined observe and command maps; reject a collision with `DuplicateModuleContract` kind `qa-operation` and ID `namespace.operation` before exposing the registry. Unknown names fail with `QaOperationNotFound`. The bridge decodes input, provides each operation's declared `Requirements` from composed module layers, and encodes successful results. Compose's typed `Layer.provide` call for the QA bridge must satisfy every registered operation's `Requirements`; a missing service makes that composition ill-typed. Input decoding and output encoding failures produce `Schema.SchemaError`; operation errors remain typed Effect failures. Success returns the output codec's JSON-encoded value. The host call fails with the operation's typed error or `Schema.SchemaError`; the bridge does not wrap failures in an error value.
2. **Effect 4 types.** An observe or command operation declares input/output codecs and an Effect handler with its typed error and requirements. A slice snapshot is an infallible Effect that may require state services; restore is an Effect with a typed error. A migration is a total synchronous transformation between decoded slice types, with decode or encode failures represented by `Schema.SchemaError`.
3. **Schema shape.** `qa.observe` and `qa.command` are named maps whose values must be `QaOperation`s. Their inputs and outputs are `Schema.Codec`s, so branded identifiers are validated at the QA boundary. The output codec must encode values in the shared JSON domain. Each save entry is keyed by stable `SaveSliceId`, carries a positive integer version, and stores the encoded value accepted by that slice's codec. The persisted bundle is an object keyed by `SaveSliceId`; each value contains its version and encoded data.

```ts
export const SaveSliceIdSchema = Schema.NonEmptyString.pipe(Schema.brand("SaveSliceId"));
export type SaveSliceId = Schema.Schema.Type<typeof SaveSliceIdSchema>;

export const SaveVersionSchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("SaveVersion"));
export type SaveVersion = Schema.Schema.Type<typeof SaveVersionSchema>;

export interface QaOperation<
  Input extends Schema.Codec<unknown>,
  Output extends Schema.Codec<unknown>,
  Error = never,
  Requirements = never
> {
  readonly input: Input;
  readonly output: Output;
  readonly run: (
    input: Input["Type"]
  ) => Effect.Effect<Output["Type"], Error, Requirements>;
}

export type QaOperationMap<Operations extends Readonly<Record<string, unknown>>> = {
  readonly [Key in keyof Operations]: Operations[Key] extends QaOperation<
    infer Input,
    infer Output,
    infer Error,
    infer Requirements
  > ? QaOperation<Input, Output, Error, Requirements> : never;
};

export interface QaNamespace<
  Observe extends Readonly<Record<string, unknown>> = Readonly<Record<string, never>>,
  Command extends Readonly<Record<string, unknown>> = Readonly<Record<string, never>>
> {
  readonly name: string;
  readonly observe: QaOperationMap<Observe>;
  readonly command: QaOperationMap<Command>;
}

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
  Slice extends Schema.Codec<unknown>,
  RestoreError = never,
  Requirements = never
> {
  readonly id: SaveSliceId;
  readonly version: SaveVersion;
  readonly schema: Slice;
  readonly snapshot: Effect.Effect<Slice["Type"], never, Requirements>;
  readonly restore: (state: Slice["Type"]) => Effect.Effect<void, RestoreError, Requirements>;
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

export interface GameModuleExtensions<
  QA extends QaNamespace = QaNamespace,
  SaveSlices extends ReadonlyArray<unknown> = ReadonlyArray<unknown>
> {
  readonly qa?: QA;
  readonly saveSlices?: SaveSlices;
}

export type GameModuleWithContracts<Base extends object> = Base & GameModuleExtensions;

export class DuplicateModuleContract extends Schema.TaggedError<DuplicateModuleContract>()("DuplicateModuleContract", {
  kind: Schema.Literals(["qa-namespace", "qa-operation", "save-slice"]),
  id: Schema.NonEmptyString
}) {}

export class QaOperationNotFound extends Schema.TaggedError<QaOperationNotFound>()("QaOperationNotFound", {
  namespace: Schema.String,
  operation: Schema.String
}) {}

export const QaBlockPositionInput = Schema.Struct({
  address: BlockAddressSchema
});
export const QaBlockIdOutput = Schema.Struct({
  blockId: BlockIdSchema
});
export type ObserveBlockAtQa = QaOperation<typeof QaBlockPositionInput, typeof QaBlockIdOutput>;
export type ExampleQaNamespace = QaNamespace<{ readonly blockAt: ObserveBlockAtQa }>;
```

4. **Consumers.** All modules may register observations and commands for their owned services. Compose merges them for end-to-end tests against the fully composed host. Tests read state through owner observe operations rather than DOM attributes.
5. **Compatibility.** A slice ID remains stable for the lifetime of the saved data. A shape change increments only that slice's version. Treat migrations as a directed version graph whose edges always increase the version; array order does not select a path. Each supported stored version must have one complete path to the current version. Each migration decodes its source's encoded data, transforms the decoded value, and encodes it with the target codec; the next migration receives that encoded result. After the final migration, decode the current version before restore. `mc-sim` gathers registered snapshots; `mc-save` encodes each with its registered codec and stores the bundle. If no complete migration path exists for a stored slice, restore fails with `SaveMigrationPathMissing`; if multiple paths exist, it fails with `SaveMigrationPathAmbiguous`. Both errors carry the slice ID, stored version, and current version, and neither invokes that slice's restore.
6. **Wave.** Finalize in W1 before module migrations and compose integration.

## C2: Simulation intent queue

1. **Placement.** Add the intent vocabulary and queue service to `mc-sim/src/application/intent-queue.ts`. `mc-sim` creates one queue layer when a world session starts, scopes it to that session's Effect layer, and disposes it when the session closes. The host's world-session registry maps each `WorldId` to that session's scope; ingress resolves the ID there and runs the queue service from that scope. `enqueue` receives no world identifier. Gameplay stages consume ready intents; local input, network receive, and host adapters submit through the same queue.
2. **Effect 4 types.** `enqueue` returns the queue sequence or a typed `IntentQueueFull` failure. Queue admission is serialized; it assigns the next sequence in admission order, starting at zero for a world session. `takeReady(tick)` removes and returns entries with `targetTick <= tick`. Replaying the same accepted intents with the same assigned sequences preserves processing order; differing network arrival timing can produce a different accepted order.
3. **Schema shape.** The initial tagged union covers block break, block place, and item use. Each intent has a correlation ID that ingress adapters keep unique within its world session and preserve through processing, a target simulation tick, source tag, and actor; block-changing payloads also carry a dimension-qualified address. Decode local and network payloads before enqueueing. Order ready work by target tick and then assigned sequence.

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
  item: Schema.NonEmptyString
});

export const IntentPayloadSchema = Schema.Union([
  BreakBlockIntentSchema,
  PlaceBlockIntentSchema,
  UseItemIntentSchema
]);

export const IntentSchema = Schema.Struct({
  id: IntentIdSchema,
  targetTick: SimulationTickSchema,
  source: Schema.Literals(["local", "network"]),
  payload: IntentPayloadSchema
});
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
3. **Schema shape.** Payloads carry the originating tick and branded IDs; positions include a dimension. Open: gameplay rules must define units and valid ranges for damage amount and explosion power, plus the valid range for level; the initial schemas only constrain amount and power to finite numbers and level to an integer.

```ts
export const DomainEventSchema = Schema.Union([
  Schema.TaggedStruct("EntityDamaged", {
    tick: SimulationTickSchema,
    entity: EntityIdSchema,
    amount: Schema.Finite
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
    power: Schema.Finite
  }),
  Schema.TaggedStruct("LevelUp", {
    tick: SimulationTickSchema,
    entity: EntityIdSchema,
    level: Schema.Int
  }),
  Schema.TaggedStruct("AchievementUnlocked", {
    tick: SimulationTickSchema,
    player: EntityIdSchema,
    achievement: Schema.NonEmptyString
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
5. **Compatibility.** Each independent consumption of `events` creates a subscriber when stream evaluation begins; completion or interruption closes it. The bus snapshots active subscribers when `publish` begins, so later subscribers do not receive that event. If the set is empty, `publish` completes without buffering for later subscribers. Concurrent publish calls are linearized so every subscriber observes the same order. Compose supplies a finite positive queue capacity per subscriber; there is no default. If any recipient queue is full, `publish` suspends until capacity is available, then enqueues the event for every still-open recipient and completes. A recipient that closes while publication waits is removed from the pending set. If `publish` is interrupted while waiting, no recipient receives that event and the Effect fails by interruption. The stream is transient: do not save, replay, or replicate it as authoritative state. Network synchronization uses C4 state snapshots or an explicitly versioned protocol message. Open: W3 chooses the production capacity value.
6. **Wave.** Freeze vocabulary in W1 so independent streams can target it; implement and export the bus in W3.

## C4: Replicated state

1. **Placement.** Authoritative state and snapshot services belong to `mc-sim`. `mx-multiplayer` owns wire encoding, validation, and delivery; `mc-server` composes the same simulation services used by the browser host.
2. **Effect 4 types.** State is exposed as a world-scoped snapshot. Mutations remain in owner services. The `mc-sim` world-session commit coordinator assigns the shared revision once as each authoritative transition commits state; owner snapshot services read that same committed revision with their state. Consumers receive snapshots rather than writing replicated state through a transport service.
3. **Schema shape.** A snapshot carries a `WorldId`, a monotonically increasing `WorldRevision` within that world, and the owner's state codec. The sample uses player state to show the shape; other services provide their own codecs.

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

export const PlayerStateSchema = Schema.Struct({
  id: EntityIdSchema,
  position: WorldPositionSchema
});

export class PlayerStateService extends Context.Service<PlayerStateService, {
  readonly snapshot: (world: WorldId) => Effect.Effect<ReplicatedSnapshot<typeof PlayerStateSchema>>;
}>()("mc-sim/application/PlayerStateService") {}
```

4. **Consumers.** The server supplies owner-service snapshots to `mx-multiplayer`; the multiplayer adapter sends them to clients, which apply deltas according to the revision rule below.
5. **Compatibility.** Snapshot codecs are protocol data, not save slices. Wire incompatibility is handled by multiplayer protocol versioning. A newly initialized world starts at revision zero, and its initial snapshot is the client's baseline. All replicated owner services in one world share a single revision sequence, incremented once by `mc-sim` for each committed authoritative world-state transition. Group every changed owner snapshot from one transition into one world delta; `mx-multiplayer` delivers that group as a unit, and clients apply it atomically before advancing the revision. A delta's revision identifies the state after applying that transition; apply it only when its world matches and its revision equals the current revision plus one. A duplicate, stale revision, or gap requires a resync snapshot. `mx-multiplayer` owns versioned delta envelopes and payload fields; this contract fixes state ownership and revision semantics.
6. **Wave.** Finalize service ownership and snapshot shape in W3 before multiplayer and server synchronization work.

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
5. **Compatibility.** Keep the testing entry separate from the production package entry. Expected hashes live beside the consuming package's headless tests and their inputs. Hash stability is a test contract; intentional changes to canonical state coverage, ordering, or encoding update those fixtures. Open: the Random algorithm and cross-build sequence compatibility are implementation decisions; this contract guarantees repeatability within one build.
6. **Wave.** Implement in W3 so later package streams can test their rules against a common simulation clock and random source.

## C6: Particle request API

1. **Placement.** Add the request schema and service to `mc-render` (proposed `src/application/particle-service.ts`). Rendering owns particle allocation and defaults.
2. **Effect 4 types.** `spawn` accepts one typed request and returns the accepted count (`0` or `1`) as an Effect value. A full pool may reject a spawn without failing simulation state.
3. **Schema shape.** Requests include a finite set of particle kinds, branded dimension-aware world position, optional RGB channels in `[0, 1]`, optional positive lifetime in ticks, optional direction, and optional followed entity ID. `lifetimeTicks` counts `mc-render` particle update steps, not simulation ticks or wall-clock time. Direction is an unnormalized world-space vector; initial velocity is direction multiplied by the particle kind's configured base speed in world units per render update. The zero vector means no initial directional velocity.

```ts
export const ParticleKindSchema = Schema.Literals([
  "block-break",
  "entity-hit",
  "explosion",
  "level-up"
]);

export const ColorChannelSchema = Schema.Finite
  .check(Schema.isBetween({ minimum: 0, maximum: 1 }));

export const ParticleColorSchema = Schema.Struct({
  red: ColorChannelSchema,
  green: ColorChannelSchema,
  blue: ColorChannelSchema
});

export const ParticleDirectionSchema = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  z: Schema.Finite
});

export const ParticleTicksSchema = Schema.Int
  .check(Schema.isGreaterThan(0))
  .pipe(Schema.brand("ParticleTicks"));

export const ParticleRequestSchema = Schema.Struct({
  kind: ParticleKindSchema,
  position: WorldPositionSchema,
  color: Schema.optional(ParticleColorSchema),
  lifetimeTicks: Schema.optional(ParticleTicksSchema),
  direction: Schema.optional(ParticleDirectionSchema),
  followEntity: Schema.optional(EntityIdSchema)
});

export class ParticleService extends Context.Service<ParticleService, {
  readonly spawn: (
    request: Schema.Schema.Type<typeof ParticleRequestSchema>
  ) => Effect.Effect<0 | 1>;
}>()("mc-render/application/ParticleService") {}
```

4. **Consumers.** The host's render adapter consumes C3 events and calls the particle service. `mx-gameplay` emits semantic events and remains independent of `mc-render`; the C3 adapter supplies the connection.
5. **Compatibility.** Particle requests are presentation data, not replicated or saved state. Unspecified appearance fields use the kind's render defaults. Open: behavior when a followed entity is removed is assigned to `mc-render` during W3.
6. **Wave.** Finalize and implement in W3 alongside event consumers.

## C7: Generic world-write port

1. **Placement.** Define `WorldWritePort` and its data vocabulary in `mc-kernel/src/domain/world/world-write-port.ts`. Put the `MultiplayerWorldWriter` alias in `mx-multiplayer/src/domain/world-write.ts` and re-export it from the multiplayer package entry point. The host and dedicated server supply the implementation. Open: the `mc-host-web` adapter file and export are assigned during W4 integration.
2. **Effect 4 types.** `applyBatch` is an atomic, revision-checked Effect operation. It returns the committed dimension revision or a typed conflict/invalid-batch failure. Validate the entire batch before writing; a successful batch increments the dimension revision once.
3. **Schema shape.** A batch names its dimension, expected revision, and block edits. Reject empty batches and duplicate positions as `WorldWriteInvalidBatch`; report expected and current revisions as `WorldWriteConflict`. Validate batch structure before checking the expected revision, so an empty or duplicate-position batch fails as invalid even when its expected revision is stale.

```ts
export const BlockEditSchema = Schema.Struct({
  position: BlockPositionSchema,
  block: BlockIdSchema
});
export type BlockEdit = Schema.Schema.Type<typeof BlockEditSchema>;

export const WorldWriteBatchSchema = Schema.Struct({
  dimension: DimensionIdSchema,
  expectedRevision: DimensionRevisionSchema,
  edits: Schema.Array(BlockEditSchema)
});
export type WorldWriteBatch = Schema.Schema.Type<typeof WorldWriteBatchSchema>;

export class WorldWriteConflict extends Schema.TaggedError<WorldWriteConflict>()("WorldWriteConflict", {
  expectedRevision: DimensionRevisionSchema,
  currentRevision: DimensionRevisionSchema
}) {}

export class WorldWriteInvalidBatch extends Schema.TaggedError<WorldWriteInvalidBatch>()("WorldWriteInvalidBatch", {
  reason: Schema.Literals(["empty", "duplicate-position"])
}) {}

export class WorldWritePort extends Context.Service<WorldWritePort, {
  readonly applyBatch: (
    batch: WorldWriteBatch
  ) => Effect.Effect<DimensionRevision, WorldWriteConflict | WorldWriteInvalidBatch>;
}>()("mc-kernel/domain/world/WorldWritePort") {}

export type MultiplayerWorldWriter = WorldWritePort["Service"];
```

4. **Consumers.** The server command adapter authenticates the remote peer; `mx-gameplay` validates game rules before issuing an accepted block write. The port enforces batch validity and revision atomicity, not gameplay authorization. `mx-redstone` is connected through host composition to the same world adapter and does not depend on multiplayer. Browser and server hosts provide equivalent adapters.
5. **Compatibility.** Dimension revisions are a distinct branded type from C4 world revisions. A stale batch has no partial effects. If the batch itself is put on the wire, its message shape is governed by protocol versioning; it is not a save-slice migration.
6. **Wave.** Freeze the port type in W1 and wire both host adapters in W4.

## Verification notes

To reproduce the type check, run this from the repository root. It creates its files and installs packages in a temporary directory, which remains afterward so the generated module and installed packages can be inspected.

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
  "include": ["contracts.ts"]
}
JSON
npm install --prefix "$SCRATCH" --no-save effect@4.0.5 typescript@7.0.2
"$SCRATCH/node_modules/.bin/tsc" --noEmit -p "$SCRATCH/tsconfig.json"
```

The probe checks signatures and Schema APIs only; runtime ordering, migration completeness, event delivery, revision policy, atomic writes, and package integration remain implementation and test obligations for their listed waves.

Effect 4 service and layer conventions follow the [official Effect v4 layer guide](https://effect.website/docs/v4/requirements-management/layers).
