/**
 * Layer merge + frame assembly. The second of the two things this repository
 * owns (the first is `domain/stage-skeleton.ts`).
 *
 * Current composition contract.
 *
 * ---------------------------------------------------------------------------
 * The prime directive, restated where the code is
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.15: "ここにゲームルールを書いたら負け" — writing a game rule here
 * loses. The reference implementation's composition layer,
 * `packages/app/application/`, is 20,737 production LOC, roughly 13k of which
 * is game rules that ended up verifiable only through E2E. That is the origin
 * of this entire rebuild.
 *
 * The review norm is exact: THE ONLY CODE ADDED TO COMPOSE IS LAYER
 * COMPOSITION AND THE STAGE ORDER TABLE. Anything else moves to the module
 * that owns it. See docs/responsibility.md.
 *
 * Concretely, `composeGame` below does three things and nothing else:
 *   1. merge the modules' Layers,
 *   2. resolve the stage total order (delegated to `domain/stage-order.ts`),
 *   3. hand back an effect that runs those stages in that order.
 *
 * It never inspects a stage, never wraps one in a condition, and never decides
 * whether one should run. A stage that should sometimes not run contains that
 * decision inside its own `run`, in the repository that owns it.
 */
import { type Cause, Effect, Layer, Result, Schema } from 'effect'
import {
  type DeltaTimeSecs,
  type FrameServices,
  type GameModule as KernelGameModule,
  type QaNamespace as KernelQaNamespace,
  type StageRegistration as KernelStageRegistration,
  ModuleContractIdSchema,
  ModuleContractKindSchema,
  QaNamespaceNameSchema,
  QaOperationNameSchema,
  SaveSliceIdSchema,
  type SaveSliceRegistration,
  SaveVersionSchema,
} from '@nerima-games/mc-kernel'
import { type QaBridgeApi, QaOperationNotFound } from './qa-api'
import {
  type StageConstraint,
  type StageOrderError,
  type StageOrderPlan,
  type StagePhase,
  describeStagePlanWarnings,
  resolveStageOrder,
} from './stage-order'
import { STANDARD_STAGE_SKELETON } from './stage-skeleton'

const schemaStruct = Schema.Struct
const schemaTaggedError = Schema.TaggedError
const schemaLiterals = Schema.Literals

/**
 * Seconds since the previous frame, BRANDED, exactly as kernel brands it.
 *
 * Re-exported from `@nerima-games/mc-kernel` rather than declared here: it
 * used to be a bare `type DeltaTimeSecs = number` at the one place in the whole
 * roster that actually calls `StageRegistration.run`, which meant every stage
 * in every module was handed a value nobody had validated. The §3.4 clamp is
 * still not part of the brand.
 */
export { DeltaTimeSecs } from '@nerima-games/mc-kernel'
export type { FrameServices } from '@nerima-games/mc-kernel'

/**
 * One unit of per-frame work at the composition boundary.
 *
 * `run` returns `Effect<void, never, FrameServices>` — the SAME three channels
 * required by mc-kernel's `StageRegistration`, and the R channel is the point.
 *
 * REGRESSION: it used to be `Effect<void>`. Requirements do not erase
 * themselves, so kernel's `Effect<void, never, ClockPort>` was not assignable
 * to it and a stage written against the real contract could not be composed at
 * all. This post-registration shape is intentionally narrower than mc-kernel's
 * generic `GameModule`: composition receives already-registered stages and
 * only needs to order and run them. `test/composition.test.ts` pins the
 * assignability directly.
 *
 * The error channel stays `never`: a stage that can fail at runtime handles or
 * defects its own failure, because there is no sensible frame-level recovery
 * for "physics failed on frame 12048".
 */
export type StageRegistration = KernelStageRegistration

/**
 * A module Layer at the composition boundary.
 *
 * ---------------------------------------------------------------------------
 * What is erased, what is not, and why the difference matters
 * ---------------------------------------------------------------------------
 *
 * `composeGame` retains the union of services produced by module layers and
 * records their requirements, QA operation requirements, and registration
 * requirements on the composed layer. The host can then provide that layer to
 * the dispatcher without erasing requirements.
 */
export type ModuleLayer = Layer.Layer<never, unknown, never>

/**
 * A module that provides no services.
 *
 * Exported rather than left to callers writing `Layer.empty`, because
 * `Layer.empty` does NOT assign to `ModuleLayer`: `Layer` declares `in ROut`
 * (contravariant), so `Layer.empty` is already assignable to this safe erased
 * boundary. Every real module layer also assigns fine; the constant remains
 * the shared spelling for an empty module.
 *
 * No output service is claimed by the empty layer.
 */
export const EMPTY_MODULE_LAYER: ModuleLayer = Layer.empty as unknown as ModuleLayer

/**
 * A repository's contribution to a running game, AFTER REGISTRATION.
 *
 * kernel's `GameModule.frameStages` is an
 * `Effect<ReadonlyArray<StageRegistration>, never, RRegister>`, not an array —
 * a module must be able to acquire a service in order to BUILD a stage, and
 * with an array there was no context in which to do that (see
 * `mc-kernel/domain/frame.ts` and its freeze checklist (b)).
 *
 * That Effect runs ONCE, at startup, and `composeGame` runs after it.
 * `RRegister` is retained as `GameModule`'s phantom type parameter, then carried
 * into `ComposedGame.layers` so the host can provide the registration services.
 *
 * `registerModule` below is the adapter between the kernel's registration-time
 * module and this post-registration shape. It evaluates `frameStages` once and
 * preserves `RRegister` in the result type; it does not erase that requirement.
 */
declare const registrationRequirements: unique symbol

export type GameModule<
  ROut = never,
  Err = unknown,
  RIn = never,
  Qa extends KernelQaNamespace = KernelQaNamespace,
  Slices extends ReadonlyArray<SaveSliceRegistration> = ReadonlyArray<SaveSliceRegistration>,
  RRegister = never,
> = Pick<
  KernelGameModule<ROut, Err, RIn>,
  'layers'
> & {
  /** For diagnostics only. Never branched on. */
  readonly name: string
  readonly frameStages: ReadonlyArray<StageRegistration>
  readonly qa?: Qa
  readonly saveSlices?: Slices
  readonly [registrationRequirements]?: RRegister
}

type RegisterableGameModule<ROut, Err, RIn, RRegister, Qa, Slices> =
  KernelGameModule<ROut, Err, RIn, RRegister> & {
    readonly name: string
    readonly qa?: Qa
    readonly saveSlices?: Slices
  }

/**
 * Run a kernel-shaped module's registration Effect and hand back the
 * composable module.
 *
 * Three lines, and it is the whole adapter between `mc-kernel`'s
 * `GameModule<ROut, Err, RIn, RRegister>` and this repository's post-registration
 * `GameModule`. It qualifies under the prime directive as wiring: it inspects
 * no stage, decides nothing, and adds no behaviour — it evaluates a value the
 * module already computed and copies it into a record.
 *
 * `RRegister` flows straight through into the result's phantom type and then
 * `ComposedGame.layers`, so a module that acquires `InputService` to build its
 * input stage still forces the host to supply `InputService`. That is the
 * property the erased `ModuleLayer` cannot give, and it is why this function
 * exists rather than callers writing `Effect.map` by hand and losing the
 * parameter to inference on an erased boundary.
 */
export const registerModule = <
  RRegister,
  ROut = never,
  Err = unknown,
  RIn = never,
  Qa extends KernelQaNamespace = KernelQaNamespace,
  Slices extends ReadonlyArray<SaveSliceRegistration> = ReadonlyArray<SaveSliceRegistration>,
>(
  module: RegisterableGameModule<ROut, Err, RIn, RRegister, Qa, Slices>,
): Effect.Effect<GameModule<ROut, Err, RIn, Qa, Slices, RRegister>, never, RRegister> =>
  Effect.map(module.frameStages, (frameStages) => {
    const { layers, name, qa, saveSlices } = module
    const optional: { qa?: Qa; saveSlices?: Slices } = {}
    if (typeof qa !== 'undefined') {
      optional.qa = qa
    }
    if (typeof saveSlices !== 'undefined') {
      optional.saveSlices = saveSlices
    }
    return {
      frameStages,
      layers,
      name,
      ...optional,
    }
  })

type ModuleList = ReadonlyArray<
  GameModule<never, unknown, unknown, KernelQaNamespace, ReadonlyArray<SaveSliceRegistration>, unknown>
>

export type ComposedGame<Modules extends ModuleList = ModuleList> = {
  readonly modules: Modules
  readonly qaNamespaces: ReadonlyArray<KernelQaNamespace>
  readonly saveSlices: ReadonlyArray<SaveSliceRegistration>
  readonly qaBridge: QaBridgeApi<
    QaOperationErrorsOfModules<Modules>,
    QaOperationRequirementsOfModules<Modules>
  >
  /** Every module's services, merged. */
  readonly layers: Layer.Layer<
    ModuleOutput<Modules>,
    ModuleError<Modules>,
    ModuleCompositionRequirements<Modules>
  >
  /** Compatibility alias for consumers of the U5-1 composition API. */
  readonly layer: Layer.Layer<
    ModuleOutput<Modules>,
    ModuleError<Modules>,
    ModuleCompositionRequirements<Modules>
  >
  /** The resolved total order, plus the dropped and the unrecognised. */
  readonly plan: StageOrderPlan
  /**
   * Run one frame: every stage, once, in `plan.order`.
   *
   * CARRIES `FrameServices`. That is the honest type — a stage may read the
   * clock — and stating it is what makes `runFrameWith` a discharge rather than
   * an erasure. A host that wants a `Effect<void>` calls `runFrameWith`.
   */
  readonly runFrame: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>
  /**
   * `runFrame` with the frame's services supplied. THE discharge.
   *
   * `Layer.Layer<FrameServices>` is `Layer<ClockPort, never, never>` — no `any`
   * anywhere on this path, so `Effect.provide` genuinely removes the
   * requirement instead of erasing it. Discharging `ClockPort` is exactly the
   * composition layer's job: it is the one repository that can see both the
   * stages that read the clock and the platform adapter that implements it.
   */
  readonly runFrameWith: (
    services: Layer.Layer<FrameServices>,
  ) => (dt: DeltaTimeSecs) => Effect.Effect<void>
  /** Names of the composed modules, in the order given. Diagnostics only. */
  readonly moduleNames: ReadonlyArray<string>
  /**
   * Everything the resolver would otherwise have swallowed, rendered for a log.
   *
   * A dangling `after` edge and a stage the skeleton does not recognise are
   * both LEGAL — see `domain/stage-order.ts` — and both are indistinguishable
   * from a typo at the point where they bite. Enforcing either would delete a
   * sanctioned idiom; not surfacing them is how a mistyped stage id silently
   * runs at the end of the frame forever. So: enforce nothing, report both.
   *
   * Empty when there is nothing to say, so a host can print it unconditionally.
   */
  readonly warnings: ReadonlyArray<string>
}

export type ComposeOptions = {
  /**
   * The frame's phases. Defaults to `STANDARD_STAGE_SKELETON`; overridable so
   * tests can be small. See `domain/stage-order.ts` on why a phase rather than
   * a concrete stage id.
   */
  readonly skeleton?: ReadonlyArray<StagePhase>
}

/**
 * Merge every module's Layer into one.
 *
 * `Layer.merge` rather than `Layer.provide`: modules are peers. If module A
 * needed module B's services to *build*, that would be a dependency edge
 * between two experience modules, which plan.md §2.3-1 forbids outright.
 */
type LayerOutput<LayerType> = LayerType extends Layer.Layer<infer ROut, infer _Err, infer _RIn>
  ? ROut
  : never
type LayerError<LayerType> = LayerType extends Layer.Layer<infer _ROut, infer Err, infer _RIn>
  ? Err
  : never
type LayerRequirements<LayerType> = LayerType extends Layer.Layer<infer _ROut, infer _Err, infer RIn>
  ? RIn
  : never
type ModuleOutput<Modules extends ModuleList> = LayerOutput<Modules[number]['layers']>
type ModuleError<Modules extends ModuleList> = LayerError<Modules[number]['layers']>
type ModuleLayerRequirements<Modules extends ModuleList> = LayerRequirements<Modules[number]['layers']>
type ModuleQa<Module> = Module extends { readonly qa?: infer Qa } ? NonNullable<Qa> : never

type NamespaceOperations<Namespace> = Namespace extends {
  readonly observe: infer Observe extends object
  readonly command: infer Command extends object
}
  ? Observe[keyof Observe] | Command[keyof Command]
  : never
type QaOperationError<Operation> = Operation extends {
  readonly run: (input: never) => Effect.Effect<unknown, infer Error, infer _Requirements>
}
  ? Error
  : never
type QaOperationRequirements<Operation> = Operation extends {
  readonly input: infer Input
  readonly output: infer Output
  readonly run: (input: never) => Effect.Effect<unknown, infer _Error, infer Requirements>
}
  ? Requirements | CodecDecodingRequirements<Input> | CodecEncodingRequirements<Output>
  : never
type CodecDecodingRequirements<Codec> = Codec extends { readonly DecodingServices: infer Requirements }
  ? Requirements
  : never
type CodecEncodingRequirements<Codec> = Codec extends { readonly EncodingServices: infer Requirements }
  ? Requirements
  : never
type QaOperationErrorsOfModules<Modules extends ReadonlyArray<unknown>> = QaOperationError<
  NamespaceOperations<ModuleQa<Modules[number]>>
>
type QaOperationRequirementsOfModules<Modules extends ReadonlyArray<unknown>> = QaOperationRequirements<
  NamespaceOperations<ModuleQa<Modules[number]>>
>
type RegistrationRequirements<Module> = typeof registrationRequirements extends keyof Module
  ? NonNullable<Module[typeof registrationRequirements]>
  : never
type ModuleRegistrationRequirements<Modules extends ReadonlyArray<unknown>> =
  RegistrationRequirements<Modules[number]>
type ModuleCompositionRequirements<Modules extends ModuleList> =
  | ModuleLayerRequirements<Modules>
  | QaOperationRequirementsOfModules<Modules>
  | ModuleRegistrationRequirements<Modules>

type DuplicateModuleContractFields = {
  readonly id: typeof ModuleContractIdSchema
  readonly kind: typeof ModuleContractKindSchema
}

type DuplicateModuleContractTagged = Schema.TaggedStruct<
  'DuplicateModuleContract',
  DuplicateModuleContractFields
>

export interface DuplicateModuleContractSelf extends Cause.YieldableError {
  readonly _tag: 'DuplicateModuleContract'
  readonly kind: Schema.Schema.Type<typeof ModuleContractKindSchema>
  readonly id: Schema.Schema.Type<typeof ModuleContractIdSchema>
}

const DuplicateModuleContractBase: Schema.Class<
  DuplicateModuleContractSelf,
  DuplicateModuleContractTagged,
  Cause.YieldableError
> = schemaTaggedError<DuplicateModuleContractSelf>()(
  'DuplicateModuleContract',
  {
    id: ModuleContractIdSchema,
    kind: ModuleContractKindSchema,
  },
)
export class DuplicateModuleContract extends DuplicateModuleContractBase {}

type ComposeOptionsErrorFields = {
  readonly field: Schema.Literals<readonly ['options', 'skeleton']>
}

type ComposeOptionsErrorTagged = Schema.TaggedStruct<'ComposeOptionsError', ComposeOptionsErrorFields>

export interface ComposeOptionsErrorSelf extends Cause.YieldableError {
  readonly _tag: 'ComposeOptionsError'
  readonly field: 'options' | 'skeleton'
}

const ComposeOptionsErrorBase: Schema.Class<
  ComposeOptionsErrorSelf,
  ComposeOptionsErrorTagged,
  Cause.YieldableError
> = schemaTaggedError<ComposeOptionsErrorSelf>()('ComposeOptionsError', {
  field: schemaLiterals(['options', 'skeleton']),
})
export class ComposeOptionsError extends ComposeOptionsErrorBase {}

type ModuleContractKindInput = Schema.Codec.Encoded<typeof ModuleContractKindSchema>

const duplicateModuleContract = (kind: ModuleContractKindInput, id: unknown) =>
  Effect.gen(function* duplicateModuleContractGen() {
    const decodedKind = yield* Schema.decodeUnknownEffect(ModuleContractKindSchema)(kind)
    const decodedId = yield* Schema.decodeUnknownEffect(ModuleContractIdSchema)(id)
    return yield* Effect.fail(new DuplicateModuleContract({ id: decodedId, kind: decodedKind }))
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSchemaCodec = (value: unknown): value is Schema.Codec<unknown> =>
  typeof value === 'function' && Schema.isSchema(value)

type QaOperationValidation = {
  readonly key: string
  readonly namespace: Schema.Schema.Type<typeof QaNamespaceNameSchema>
  readonly seenOperations: Set<string>
  readonly value: unknown
}

const validateQaOperation = ({ key, namespace, seenOperations, value }: QaOperationValidation) =>
  Effect.gen(function* validateQaOperationGen() {
    if (!isRecord(value)) {
      return yield* duplicateModuleContract('qa-operation', `${namespace}.${key}`)
    }
    const { input, name: encodedName, output, run } = value
    const name = yield* Schema.decodeUnknownEffect(QaOperationNameSchema)(encodedName)
    if (key !== name || typeof run !== 'function' || !isSchemaCodec(input) || !isSchemaCodec(output)) {
      return yield* duplicateModuleContract('qa-operation', `${namespace}.${key}`)
    }
    if (seenOperations.has(name)) {
      return yield* duplicateModuleContract('qa-operation', `${namespace}.${name}`)
    }
    seenOperations.add(name)
  })

const validateQaOperationMap = (
  namespace: Schema.Schema.Type<typeof QaNamespaceNameSchema>,
  operationMap: unknown,
  seenOperations: Set<string>,
) =>
  Effect.gen(function* validateQaOperationMapGen() {
    if (!isRecord(operationMap)) {
      return yield* duplicateModuleContract('qa-operation', `${namespace}.<map>`)
    }
    for (const [key, value] of Object.entries(operationMap)) {
      yield* validateQaOperation({ key, namespace, seenOperations, value })
    }
  })

const QaNamespaceRegistrationSchema = schemaStruct({
  command: Schema.Unknown,
  name: QaNamespaceNameSchema,
  observe: Schema.Unknown,
})

const SaveSliceContractSchema = schemaStruct({
  id: SaveSliceIdSchema,
  version: SaveVersionSchema,
})

const validateQaNamespaceName = (name: string, seenNamespaces: Set<string>) =>
  Effect.gen(function* validateQaNamespaceNameGen() {
    if (seenNamespaces.has(name)) {
      return yield* duplicateModuleContract('qa-namespace', name)
    }
    seenNamespaces.add(name)
  })

const validateQaOperations = (
  namespace: Schema.Schema.Type<typeof QaNamespaceNameSchema>,
  observe: unknown,
  command: unknown,
) =>
  Effect.gen(function* validateQaOperationsGen() {
    const seenOperations = new Set<string>()
    yield* validateQaOperationMap(namespace, observe, seenOperations)
    yield* validateQaOperationMap(namespace, command, seenOperations)
  })

type QaNamespaceValidation = {
  readonly moduleName: string
  readonly qa: unknown
  readonly seenNamespaces: Set<string>
}

const validateQaNamespace = ({ moduleName, qa, seenNamespaces }: QaNamespaceValidation) =>
  Effect.gen(function* validateQaNamespaceGen() {
    if (!isRecord(qa)) {
      return yield* duplicateModuleContract('qa-namespace', moduleName)
    }
    const parsedQa = yield* Schema.decodeUnknownEffect(QaNamespaceRegistrationSchema)(qa)
    const { command, name, observe } = parsedQa
    yield* validateQaNamespaceName(name, seenNamespaces)
    yield* validateQaOperations(name, observe, command)
  })

const validateModuleQa = (module: ModuleList[number], seenNamespaces: Set<string>) =>
  Effect.gen(function* validateModuleQaGen() {
    const { name: moduleName, qa } = module
    if (!Object.hasOwn(module, 'qa')) {
      return
    }
    yield* validateQaNamespace({ moduleName, qa, seenNamespaces })
  })

const validateSaveSlice = (value: unknown, seenSlices: Set<string>) =>
  Effect.gen(function* validateSaveSliceGen() {
    const { id } = yield* Schema.decodeUnknownEffect(SaveSliceContractSchema)(value)
    if (seenSlices.has(id)) {
      return yield* duplicateModuleContract('save-slice', id)
    }
    seenSlices.add(id)
  })

const validateModuleSaveSlices = (
  module: ModuleList[number],
  seenSlices: Set<string>,
) =>
  Effect.gen(function* validateModuleSaveSlicesGen() {
    const { saveSlices } = module
    if (!Object.hasOwn(module, 'saveSlices')) {
      return
    }
    if (!Array.isArray(saveSlices)) {
      return yield* duplicateModuleContract('save-slice', module.name)
    }
    for (const slice of saveSlices) {
      yield* validateSaveSlice(slice, seenSlices)
    }
  })

const validateModuleContracts = (modules: ReadonlyArray<ModuleList[number]>) =>
  Effect.gen(function* validateModuleContractsGen() {
    const seenNamespaces = new Set<string>()
    const seenSlices = new Set<string>()
    for (const module of modules) {
      yield* validateModuleQa(module, seenNamespaces)
      yield* validateModuleSaveSlices(module, seenSlices)
    }
  })

type DynamicQaOperation<OperationErrors, Requirements> = {
  readonly input: Schema.Codec<unknown>
  readonly output: Schema.Codec<unknown>
  readonly run: (input: unknown) => Effect.Effect<unknown, OperationErrors, Requirements>
}

const makeQaBridge = <OperationErrors, Requirements>(
  namespaces: ReadonlyArray<KernelQaNamespace>,
): QaBridgeApi<OperationErrors, Requirements> => {
  const registry = new Map<string, Map<string, DynamicQaOperation<OperationErrors, Requirements>>>()
  for (const { command, name, observe } of namespaces) {
    const operations = new Map<string, DynamicQaOperation<OperationErrors, Requirements>>()
    for (const operationMap of [observe, command]) {
      for (const [key, value] of Object.entries(operationMap)) {
        operations.set(key, value)
      }
    }
    registry.set(name, operations)
  }

  return {
    run: (namespace, operation, inputJson) => {
      const decodedNamespace = Schema.decodeUnknownEffect(QaNamespaceNameSchema)(namespace)
      const decodedOperation = Schema.decodeUnknownEffect(QaOperationNameSchema)(operation)
      return Effect.gen(function* dispatchQaOperation() {
        const validNamespace = yield* decodedNamespace
        const validOperation = yield* decodedOperation
        const registered = registry.get(validNamespace)?.get(validOperation)
        if (typeof registered === 'undefined') {
          return yield* Effect.fail(new QaOperationNotFound({ namespace: validNamespace, operation: validOperation }))
        }
        const json = yield* Schema.decodeUnknownEffect(Schema.Json)(inputJson)
        const input = yield* Schema.decodeUnknownEffect(registered.input)(json)
        const output = yield* registered.run(input)
        const encoded = yield* Schema.encodeUnknownEffect(registered.output)(output)
        return yield* Schema.decodeUnknownEffect(Schema.Json)(encoded)
      })
    },
  }
}

export const mergeModuleLayers = <const Modules extends ModuleList>(
  modules: Modules,
): Layer.Layer<ModuleOutput<Modules>, ModuleError<Modules>, ModuleLayerRequirements<Modules>> => {
  // Seeded with EMPTY_MODULE_LAYER; see that constant for why `Layer.empty`
  // Cannot be used directly.
  //
  let merged: Layer.Layer<unknown, unknown, unknown> = EMPTY_MODULE_LAYER as unknown as Layer.Layer<
    unknown,
    unknown,
    unknown
  >
  for (const module of modules) {
    merged = Layer.merge(merged, module.layers) as unknown as Layer.Layer<unknown, unknown, unknown>
  }
  return merged as unknown as Layer.Layer<
    ModuleOutput<Modules>,
    ModuleError<Modules>,
    ModuleLayerRequirements<Modules>
  >
}

/** Every module's stages, flattened. Order here is irrelevant — the resolver sorts. */
export const collectStages = (modules: ReadonlyArray<ModuleList[number]>): ReadonlyArray<StageRegistration> =>
  modules.flatMap(({ frameStages }) => [...frameStages])

const asConstraint = (registration: StageRegistration): StageConstraint => {
  const { after, id } = registration
  if (typeof after === 'undefined') {
    return { id }
  }
  return { after, id }
}

const collectQaNamespaces = (
  modules: ReadonlyArray<ModuleList[number]>,
): ReadonlyArray<KernelQaNamespace> => {
  const namespaces: Array<KernelQaNamespace> = []
  for (const { qa: namespace } of modules) {
    if (typeof namespace !== 'undefined') {
      namespaces.push(namespace)
    }
  }
  return namespaces
}

const collectSaveSlices = (
  modules: ReadonlyArray<ModuleList[number]>,
): ReadonlyArray<SaveSliceRegistration> => {
  const saveSlices: Array<SaveSliceRegistration> = []
  for (const { saveSlices: moduleSaveSlices } of modules) {
    if (typeof moduleSaveSlices !== 'undefined') {
      for (const slice of moduleSaveSlices) {
        saveSlices.push(slice)
      }
    }
  }
  return saveSlices
}

const composeSuccessfulGame = <const Modules extends ModuleList>(
  modules: Modules,
  plan: StageOrderPlan,
): ComposedGame<Modules> => {
  const stages = collectStages(modules)
  const byId = new Map(stages.map((stage) => [stage.id, stage] as const))
  // The order in plan.order is a permutation of these stages after the resolver has
  // The resolver confirmed that stage ids are unique.
  const ordered = plan.order.map((id) => byId.get(id)!)
  const qaNamespaces = collectQaNamespaces(modules)
  const saveSlices = collectSaveSlices(modules)
  const mergedLayers: Layer.Layer<
    ModuleOutput<Modules>,
    ModuleError<Modules>,
    ModuleCompositionRequirements<Modules>
  > = mergeModuleLayers(modules)
  const qaBridge = makeQaBridge<
    QaOperationErrorsOfModules<Modules>,
    QaOperationRequirementsOfModules<Modules>
  >(qaNamespaces)
  const runFrame = (dt: DeltaTimeSecs): Effect.Effect<void, never, FrameServices> =>
    Effect.forEach(ordered, (stage) => stage.run(dt), { discard: true })

  return {
    layer: mergedLayers,
    layers: mergedLayers,
    moduleNames: modules.map(({ name }) => name),
    modules,
    plan,
    qaBridge,
    qaNamespaces,
    runFrame,
    runFrameWith: (services) => (dt) => Effect.provide(runFrame(dt), services),
    saveSlices,
    warnings: describeStagePlanWarnings(plan),
  }
}

/**
 * Compose modules, validating their QA namespaces and save-slice registrations
 * before exposing the composed runtime.
 */
export const composeGame = <const Modules extends ModuleList>(
  modules: Modules,
  options: ComposeOptions = {},
): Effect.Effect<
  ComposedGame<Modules>,
  DuplicateModuleContract | ComposeOptionsError | Schema.SchemaError | StageOrderError
> => {
  if (typeof options !== 'object' || options === null) {
    return Effect.fail(new ComposeOptionsError({ field: 'options' }))
  }
  const { skeleton: providedSkeleton } = options
  let skeleton: ReadonlyArray<StagePhase> = STANDARD_STAGE_SKELETON
  if (Object.hasOwn(options, 'skeleton')) {
    if (!Array.isArray(providedSkeleton)) {
      return Effect.fail(new ComposeOptionsError({ field: 'skeleton' }))
    }
    skeleton = providedSkeleton
  }

  const stages = collectStages(modules)
  return Effect.flatMap(validateModuleContracts(modules), () => {
    const order = resolveStageOrder(stages.map(asConstraint), { skeleton })
    if (Result.isFailure(order)) {
      return Effect.fail(order.failure)
    }
    return Effect.succeed(composeSuccessfulGame(modules, order.success))
  })
}
