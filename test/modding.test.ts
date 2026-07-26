import { describe, expect, it } from '@effect/vitest'
import { Effect, Either, Option, Ref } from 'effect'
import {
  composeGame,
  DeltaTimeSecs,
  EMPTY_MODULE_LAYER,
  type GameModule,
  type StageRegistration,
} from '../domain/composition'
import { EpochMillis, FixedClockLayer, MonotonicTimeSecs } from '../domain/kernel-vocabulary'
import {
  acceptMod,
  acceptMods,
  describeModdingError,
  MODDING_API_VERSION,
  modStageId,
  modStagePrefix,
  RESERVED_STAGE_PREFIXES,
  type ModdingError,
  type ModManifest,
} from '../domain/modding'
import { StageId } from '../domain/stage-order'
import {
  STAGE_INPUT,
  STAGE_RENDER,
  STAGE_SIM_PHYSICS,
  STANDARD_STAGE_SKELETON,
} from '../domain/stage-skeleton'

const modModule = (frameStages: ReadonlyArray<StageRegistration>): GameModule => ({
  name: 'a mod',
  layers: EMPTY_MODULE_LAYER,
  frameStages,
})

const manifest = (
  id: string,
  frameStages: ReadonlyArray<StageRegistration> = [],
  apiVersion: number = MODDING_API_VERSION,
): ModManifest => ({
  id,
  displayName: `${id} (test)`,
  apiVersion,
  module: modModule(frameStages),
})

const stage = (id: StageId, after?: ReadonlyArray<StageId>): StageRegistration => ({
  id,
  ...(after === undefined ? {} : { after }),
  run: () => Effect.void,
})

const failure = <A>(result: Either.Either<A, ModdingError>): ModdingError | undefined =>
  Option.getOrUndefined(Either.getLeft(result))

describe('accepting a mod', () => {
  it.effect('accepts a well-formed mod and hands back a plain GameModule', () =>
    Effect.sync(() => {
      const result = acceptMod(manifest('extra-ores', [stage(modStageId('extra-ores', 'tick'))]))
      expect(Either.isRight(result)).toBe(true)
      expect(Either.getOrThrow(result).frameStages).toHaveLength(1)
    }),
  )

  it.effect('accepts a mod that contributes only Layers', () =>
    Effect.sync(() => {
      expect(Either.isRight(acceptMod(manifest('quiet-mod')))).toBe(true)
    }),
  )

  it.effect('builds the namespaced stage id modules are required to use', () =>
    Effect.sync(() => {
      expect(modStagePrefix('extra-ores')).toBe('mod:extra-ores:')
      expect(modStageId('extra-ores', 'tick')).toBe('mod:extra-ores:tick')
    }),
  )

  it.effect('rejects a mod id that is not lowercase kebab-case', () =>
    Effect.sync(() => {
      for (const bad of ['ExtraOres', 'extra ores', '', 'extra_ores', '-extra', 'extra-']) {
        expect(failure(acceptMod(manifest(bad)))?._tag).toBe('InvalidModId')
      }
    }),
  )

  it.effect('rejects a mod targeting a different modding API version', () =>
    Effect.sync(() => {
      const error = failure(acceptMod(manifest('extra-ores', [], MODDING_API_VERSION + 1)))
      expect(error?._tag).toBe('UnsupportedApiVersion')
      expect(error?._tag === 'UnsupportedApiVersion' ? error.supported : undefined).toBe(
        MODDING_API_VERSION,
      )
    }),
  )

  it.effect('rejects duplicate mod ids within one build', () =>
    Effect.sync(() => {
      const error = failure(acceptMods([manifest('extra-ores'), manifest('extra-ores')]))
      expect(error?._tag).toBe('DuplicateModId')
    }),
  )

  it.effect('preserves order when accepting several mods', () =>
    Effect.sync(() => {
      const accepted = Either.getOrThrow(
        acceptMods([
          manifest('alpha', [stage(modStageId('alpha', 'tick'))]),
          manifest('bravo', [stage(modStageId('bravo', 'tick'))]),
        ]),
      )
      expect(accepted.map((module) => module.frameStages[0]?.id)).toStrictEqual([
        'mod:alpha:tick',
        'mod:bravo:tick',
      ])
    }),
  )
})

describe('reserved stage namespaces', () => {
  // REGRESSION: without namespacing, a mod could register `simulation:physics`
  // and either collide with the real one (caught as DuplicateStage) or — once a
  // build ships without physics — silently BE the physics stage.
  it.effect('rejects a mod registering a core stage id', () =>
    Effect.sync(() => {
      for (const core of [STAGE_INPUT, STAGE_SIM_PHYSICS, STAGE_RENDER]) {
        const error = failure(acceptMod(manifest('sneaky', [stage(core)])))
        expect(error?._tag).toBe('ReservedStageNamespace')
      }
    }),
  )

  it.effect('rejects a mod registering a stage outside its own namespace', () =>
    Effect.sync(() => {
      const error = failure(
        acceptMod(manifest('extra-ores', [stage(modStageId('other-mod', 'tick'))])),
      )
      expect(error?._tag).toBe('ReservedStageNamespace')
    }),
  )

  it.effect('rejects an unnamespaced stage id even when it collides with nothing', () =>
    Effect.sync(() => {
      expect(failure(acceptMod(manifest('extra-ores', [stage(StageId('tick'))])))?._tag).toBe(
        'ReservedStageNamespace',
      )
    }),
  )

  it.effect('reserves every simulation sub-stage, not just the ones spelled out', () =>
    Effect.sync(() => {
      expect(
        failure(acceptMod(manifest('sneaky', [stage(StageId('simulation:invented'))])))?._tag,
      ).toBe('ReservedStageNamespace')
      expect(RESERVED_STAGE_PREFIXES).toContain('simulation:')
    }),
  )

  /**
   * REGRESSION: `RESERVED_STAGE_PREFIXES` is written out by hand and
   * `STANDARD_STAGE_SKELETON` is written out by hand, and NOTHING connected
   * them. Adding a thirteenth phase — a `multiplayer` slot is the one the
   * roster is currently missing (docs/design-notes.md DN-15) — would leave its
   * canonical id unreserved, and a mod registering that bare name would BE the
   * phase in any build whose owning module is absent. That is the failure the
   * test above describes for `simulation:physics`, reintroduced through the
   * table rather than through the reserve list.
   *
   * Two tables that must agree and cannot see each other is precisely what this
   * repository is for, so the agreement is asserted rather than remembered.
   */
  it.effect('reserves the canonical id of every phase in the standard skeleton', () =>
    Effect.sync(() => {
      const unreserved = STANDARD_STAGE_SKELETON.map((phase) => phase.name).filter(
        (name) =>
          failure(acceptMod(manifest('sneaky', [stage(StageId(name))])))?._tag !==
          'ReservedStageNamespace',
      )
      expect(unreserved).toStrictEqual([])
    }),
  )

  it.effect('explains a namespace violation with the prefix the mod should have used', () =>
    Effect.sync(() => {
      const message = describeModdingError({
        _tag: 'ReservedStageNamespace',
        id: 'extra-ores',
        stage: STAGE_SIM_PHYSICS,
      })
      expect(message).toContain('mod:extra-ores:')
      expect(message).toContain('silently become a core stage')
    }),
  )
})

describe('a mod is not a second-class module', () => {
  // REGRESSION: `acceptMod` returns a plain GameModule, merged by `composeGame`
  // exactly like mx-gameplay's. No mod-specific hook, no priority, no pre/post
  // pass — otherwise the mod API becomes a weaker copy of the module contract.
  it.effect('composes alongside first-party modules through the same path', () =>
    Effect.gen(function* () {
      const log = yield* Ref.make<ReadonlyArray<string>>([])
      const record = (name: string) => () => Ref.update(log, (previous) => [...previous, name])

      const mod = Either.getOrThrow(
        acceptMod(
          manifest('extra-ores', [
            { id: modStageId('extra-ores', 'tick'), after: [STAGE_INPUT], run: record('mod') },
          ]),
        ),
      )

      const game = Either.getOrThrow(
        composeGame([
          { name: 'mc-render', layers: EMPTY_MODULE_LAYER, frameStages: [{ id: STAGE_INPUT, run: record('input') }] },
          mod,
          { name: 'mc-render:draw', layers: EMPTY_MODULE_LAYER, frameStages: [{ id: STAGE_RENDER, run: record('render') }] },
        ]),
      )

      yield* game.runFrameWith(
        FixedClockLayer({
          monotonicSecs: MonotonicTimeSecs(0),
          wallClockEpochMillis: EpochMillis(0),
        }),
      )(DeltaTimeSecs(0.016))
      expect(yield* Ref.get(log)).toStrictEqual(['input', 'render', 'mod'])
    }),
  )

  // A mod's `after` may legitimately point at a stage this build does not have
  // — a mod that runs after redstone in a build with no redstone is fine.
  // Rejecting it would make mods depend on the build's module set.
  it.effect('lets a mod declare an after-edge on a stage the build does not load', () =>
    Effect.sync(() => {
      const mod = Either.getOrThrow(
        acceptMod(
          manifest('extra-ores', [
            stage(modStageId('extra-ores', 'tick'), [StageId('simulation:redstone')]),
          ]),
        ),
      )

      const game = Either.getOrThrow(composeGame([mod]))
      expect([...game.plan.order]).toStrictEqual(['mod:extra-ores:tick'])
      expect([...game.plan.dangling]).toStrictEqual([
        { stage: 'mod:extra-ores:tick', missing: 'simulation:redstone' },
      ])
    }),
  )

  it.effect('surfaces a cycle between two mods like any other cycle', () =>
    Effect.sync(() => {
      const mods = Either.getOrThrow(
        acceptMods([
          manifest('alpha', [stage(modStageId('alpha', 'tick'), [modStageId('bravo', 'tick')])]),
          manifest('bravo', [stage(modStageId('bravo', 'tick'), [modStageId('alpha', 'tick')])]),
        ]),
      )

      const result = composeGame(mods)
      expect(Either.isLeft(result)).toBe(true)
    }),
  )
})
