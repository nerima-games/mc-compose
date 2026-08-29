import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as compose from '../src/index'
import { resolveStageOrder } from '../src/domain/stage-order'
import { STANDARD_STAGE_SKELETON } from '../src/domain/stage-skeleton'
import { ROSTER_STAGE_IDS } from './e2e/roster'

describe('public API surface', () => {
  it.effect('re-exports every value a consumer is expected to import', () =>
    Effect.sync(() => {
      const expected = [
        // stage order — the core algorithm
        'StageId',
        'resolveStageOrder',
        'describeStageOrderError',
        'stagePhase',
        'phaseOf',
        'phaseAdmits',
        // what the resolver would otherwise have swallowed
        'describeStagePlanWarnings',
        // the stage order table
        'STANDARD_STAGE_SKELETON',
        'SIMULATION_PHASES',
        'SIMULATION_STAGES',
        'STAGE_PHASE_INPUT',
        'STAGE_PHASE_NETWORK_INBOUND',
        'STAGE_PHASE_NETWORK_OUTBOUND',
        'STAGE_PHASE_SIM_PHYSICS',
        'STAGE_PHASE_SIM_INTERACTIONS',
        'STAGE_PHASE_SIM_ENTITIES',
        'STAGE_PHASE_SIM_FLUIDS',
        'STAGE_PHASE_SIM_REDSTONE',
        'STAGE_PHASE_SIM_TIME_WEATHER',
        'STAGE_PHASE_CAMERA_MIRROR',
        'STAGE_PHASE_CHUNK_SYNC',
        'STAGE_PHASE_RENDER',
        'STAGE_PHASE_POST_FX',
        'STAGE_PHASE_HUD_SYNC',
        'STAGE_INPUT',
        'STAGE_NETWORK_INBOUND',
        'STAGE_NETWORK_OUTBOUND',
        'STAGE_SIM_PHYSICS',
        'STAGE_SIM_INTERACTIONS',
        'STAGE_SIM_ENTITIES',
        'STAGE_SIM_FLUIDS',
        'STAGE_SIM_REDSTONE',
        'STAGE_SIM_TIME_WEATHER',
        'STAGE_CAMERA_MIRROR',
        'STAGE_CHUNK_SYNC',
        'STAGE_RENDER',
        'STAGE_POST_FX',
        'STAGE_HUD_SYNC',
        // Layer composition
        'composeGame',
        'mergeModuleLayers',
        'EMPTY_MODULE_LAYER',
        'collectStages',
        // the bridge from kernel's `GameModule` (whose `frameStages` is an
        // Effect) to the post-registration module this repository composes
        'registerModule',
        // browser runtime lifecycle composition
        'startBrowserSession',
        // kernel's branded delta, re-exported so a host can construct one
        // without reaching into the dependency's internal source layout
        'DeltaTimeSecs',
        // session lifecycle
        'WorldId',
        'initialSessionState',
        'transition',
        'runSession',
        'isSimulating',
        'holdsWorldResources',
        'currentWorld',
        'roundTripEvents',
        // QA / debug API
        'QA_GLOBAL_KEY',
        'buildQaRegistry',
        'installQaApi',
        'readInstalledQaApi',
        'qaKey',
        'describeQaApiError',
        // modding
        'MODDING_API_VERSION',
        'RESERVED_STAGE_PREFIXES',
        'acceptMod',
        'acceptMods',
        'modStageId',
        'modStagePrefix',
        'describeModdingError',
      ]

      for (const name of expected) {
        expect(Object.keys(compose)).toContain(name)
      }
    }),
  )

  it.effect('exposes the same implementations through the barrel as through the modules', () =>
    Effect.sync(() => {
      expect(compose.resolveStageOrder).toBe(resolveStageOrder)
      expect(compose.STANDARD_STAGE_SKELETON).toBe(STANDARD_STAGE_SKELETON)
    }),
  )
})

describe('the prime directive, as a surface check', () => {
  // plan.md §3.15: "composeの追加コードはLayer合成とstage順序表だけ".
  // The reference implementation's composition layer reached 20,737 production
  // LOC because every addition was locally reasonable. This is a weak check —
  // a name test — and it is here so the norm is visible at the exact place a
  // new export gets added.
  it.effect('exports nothing that sounds like a game rule, an entity or a world', () =>
    Effect.sync(() => {
      const forbidden =
        /block|item|inventory|craft|mob|entity|chunk|biome|terrain|redstone(?!$)|fluid|damage|health|hunger|recipe|furnace|drop|loot/iu

      const offenders = Object.keys(compose).filter(
        (name) =>
          forbidden.test(name) &&
          // The skeleton table legitimately NAMES the stages that own those
          // concerns. Naming a stage is the table's whole job; implementing one
          // is not.
          !name.startsWith('STAGE_') &&
          !name.startsWith('SIMULATION_') &&
          !name.startsWith('RESERVED_'),
      )

      expect(offenders).toStrictEqual([])
    }),
  )

  // The skeleton is the one table whose contents change the game. Pinning it
  // here means a reorder cannot land without an explicit edit to a test that
  // says so.
  it.effect('pins the standard stage skeleton (plan.md §4.2) so a reorder is always deliberate', () =>
    Effect.sync(() => {
      expect(STANDARD_STAGE_SKELETON.map((phase) => phase.name)).toStrictEqual([
        'input',
        // EXTENSION. plan.md §4.2's backbone has no networking phase; these two
        // were added when mx-multiplayer registered `multiplayer:inbound` and
        // `multiplayer:outbound` and both resolved after the HUD. The argument
        // is at `domain/stage-skeleton.ts`; this list is where a reviewer sees
        // that the table is no longer a straight transcription of §4.2.
        'network:inbound',
        'simulation:physics',
        'simulation:interactions',
        'simulation:fire',
        'simulation:survival-hunger',
        'simulation:entities',
        'simulation:ender-dragon',
        'simulation:fluids',
        'simulation:redstone',
        'simulation:time-weather',
        'network:outbound', // EXTENSION
        'camera-mirror',
        'chunk-sync',
        'post-fx',
        'render',
        'hud-sync',
      ])
    }),
  )

  it.effect('declares every skeleton phase exactly once', () =>
    Effect.sync(() => {
      const names = STANDARD_STAGE_SKELETON.map((phase) => phase.name)
      expect(new Set(names).size).toBe(STANDARD_STAGE_SKELETON.length)
    }),
  )

  // REGRESSION: the skeleton's names alone are not what makes it work. It used
  // to be a flat list of exactly these strings, matched against registrations
  // by equality, and no module registers any of them — so it contributed no
  // ordering edge and the frame degraded to a lexicographic sort. Pinning the
  // MEMBERSHIP alongside the names means dropping a member is as visible as
  // reordering the table.
  it.effect('pins how each phase claims a stage, which is what makes the table load-bearing', () =>
    Effect.sync(() => {
      expect(
        STANDARD_STAGE_SKELETON.map((phase) => [phase.name, [...phase.members]] as const),
      ).toStrictEqual([
        ['input', ['input']],
        // The network phases claim a stage NAME, not the `multiplayer:`
        // namespace. That is not a stylistic choice: a namespace member would
        // claim both of mx-multiplayer's stages for one position, and
        // `test/e2e/roster-frame-order.test.ts` measures that there is no
        // position such a phase could take — before physics it is a CYCLE
        // against `multiplayer:outbound`'s declared edge, after it `inbound`
        // runs a frame late. Turning either of these into `['multiplayer:']`
        // breaks that test, which is the point of pinning membership here.
        ['network:inbound', ['inbound']],
        ['simulation:physics', ['physics']],
        ['simulation:interactions', ['interactions']],
        ['simulation:fire', ['fire']],
        ['simulation:survival-hunger', ['survival-hunger']],
        ['simulation:entities', ['entities']],
        ['simulation:ender-dragon', ['ender-dragon']],
        ['simulation:fluids', ['fluids']],
        ['simulation:redstone', ['redstone', 'redstone:']],
        ['simulation:time-weather', ['time-weather', 'weather']],
        ['network:outbound', ['outbound']],
        ['camera-mirror', ['camera-mirror']],
        ['chunk-sync', ['chunk-sync', 'mesh-sync']],
        ['post-fx', ['post-fx']],
        ['render', ['render', 'draw']],
        ['hud-sync', ['hud-sync', 'ui:']],
      ])
    }),
  )

  // REGRESSION: every stage id the roster registers today must land in a phase.
  // One that does not is scheduled after everything the skeleton knows, which
  // is how `ui:hud-sync` used to end up ordered by the alphabet.
  //
  // REGRESSION, second layer: this list used to be written out here by hand and
  // contained `input`, `sim:physics`, `camera-mirror`, `chunk-sync`, `render`
  // and `post-fx` — six ids NOBODY REGISTERS. mc-render registers `render:input`
  // and friends; mc-sim registers nothing. The test passed because the invented
  // ids happen to land in the same phases as the real ones. It now reads the
  // manifest that `pnpm check:roster` verifies against the siblings' source.
  it.effect('claims every stage id the roster actually registers', () =>
    Effect.sync(() => {
      const registeredToday = ROSTER_STAGE_IDS

      expect(registeredToday).toHaveLength(19)

      for (const stageId of registeredToday) {
        expect(
          compose.phaseOf(STANDARD_STAGE_SKELETON, compose.StageId(stageId))?.name,
          `${stageId} belongs to no phase`,
        ).toBeDefined()
      }
    }),
  )
})
