import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as compose from '../index'
import { resolveStageOrder } from '../domain/stage-order'
import { STANDARD_STAGE_SKELETON } from '../domain/stage-skeleton'

describe('public API surface', () => {
  it.effect('re-exports every value a consumer is expected to import', () =>
    Effect.sync(() => {
      const expected = [
        // stage order — the core algorithm
        'StageId',
        'resolveStageOrder',
        'describeStageOrderError',
        // the stage order table
        'STANDARD_STAGE_SKELETON',
        'SIMULATION_STAGES',
        'STAGE_INPUT',
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
      expect([...STANDARD_STAGE_SKELETON]).toStrictEqual([
        'input',
        'simulation:physics',
        'simulation:interactions',
        'simulation:entities',
        'simulation:fluids',
        'simulation:redstone',
        'simulation:time-weather',
        'camera-mirror',
        'chunk-sync',
        'render',
        'post-fx',
        'hud-sync',
      ])
    }),
  )

  it.effect('declares every skeleton stage exactly once', () =>
    Effect.sync(() => {
      expect(new Set(STANDARD_STAGE_SKELETON).size).toBe(STANDARD_STAGE_SKELETON.length)
    }),
  )
})
