import { Effect } from 'effect'
import {
  MonotonicTimeSecs as KernelMonotonicTimeSecs,
  position,
  type CameraPoseSnapshot,
} from '@nerima-games/mc-kernel'
import { renderModule } from '@nerima-games/mc-render'
import {
  simStages,
  type CropServiceApi,
  type PlayerPose,
  type PlayerServiceApi,
  type SimFrameState,
  type TimeServiceApi,
  type VehicleServiceApi,
} from '@nerima-games/mc-sim'
import {
  EYE_LEVEL_OFFSET,
  gameplayStages,
  type GameplayFrameState,
  type GeneratedWorld,
  type MobBehaviour,
  type VehicleControlInput,
} from '@nerima-games/mx-gameplay'
import { uiStages, type UiFrameState } from '@nerima-games/mx-ui'
import { type MultiplayerHost } from '@nerima-games/mx-multiplayer'
import { type ChunkStoreApi, type Dimension } from '@nerima-games/mc-worldgen'
import {
  EMPTY_MODULE_LAYER,
  registerModule,
  type GameModule,
  type StageRegistration,
} from '../../src/domain/composition'
import { type PlatformAdapters } from './platform-adapters'
import { type PersistedLeverState } from './session-persistence'

/**
 * Everything `bootGame` needs to register the six composed modules, built in one
 * place so `main.ts` shrinks toward pure assembly.
 *
 * The live state `main.ts` still owns — the mounted vehicle id, the current
 * vehicle controls, and the active dimension — crosses the boundary as closures
 * rather than snapshots, so a value reassigned later in the frame loop stays
 * visible to the stages registered here. `mountedVehicleId` is a `let` mutated
 * in three places, `vehicleControls` is reassigned every frame, and
 * `currentChunkContext.dimension` changes when the player crosses a portal.
 */
type HostModulesDeps = {
  readonly adapters: PlatformAdapters
  readonly spawnPose: PlayerPose
  readonly chunkSyncStage: StageRegistration
  readonly uiFrameState: UiFrameState
  readonly simState: SimFrameState
  readonly time: TimeServiceApi
  readonly playerApi: PlayerServiceApi
  readonly crops: CropServiceApi
  readonly gameplayState: GameplayFrameState
  readonly currentChunkStore: ChunkStoreApi
  readonly world: GeneratedWorld<MobBehaviour>
  readonly vehicleService: VehicleServiceApi
  readonly isActiveDimension: (dimension: Dimension) => boolean
  readonly poweredRails: ReadonlySet<string>
  readonly leverKeyOf: (lever: Pick<PersistedLeverState, 'dimension' | 'position'>) => string
  readonly getMountedVehicleId: () => string | undefined
  readonly setMountedVehicleId: (id: string | undefined) => void
  readonly getVehicleControls: () => VehicleControlInput
  readonly multiplayer: { readonly host: MultiplayerHost } | undefined
}

export const makeHostModules = async (
  deps: HostModulesDeps,
): Promise<ReadonlyArray<GameModule>> => {
  const {
    adapters,
    spawnPose,
    chunkSyncStage,
    uiFrameState,
    simState,
    time,
    playerApi,
    crops,
    gameplayState,
    currentChunkStore,
    world,
    vehicleService,
    isActiveDimension,
    poweredRails,
    leverKeyOf,
    getMountedVehicleId,
    setMountedVehicleId,
    getVehicleControls,
    multiplayer,
  } = deps

  // `renderModule()` supplies the render stages and receives the concrete draw
  // port. Chunk synchronization is a separate composition stage so it follows
  // the camera mirror and runs once per frame against the active dimension.
  /** The starting camera pose, one eye level above the player's feet. */
  const initialPose: CameraPoseSnapshot = {
    position: position(
      spawnPose.feetPosition.x,
      spawnPose.feetPosition.y + EYE_LEVEL_OFFSET,
      spawnPose.feetPosition.z,
    ),
    yawRadians: spawnPose.yawRadians,
    pitchRadians: spawnPose.pitchRadians,
    capturedAtSecs: KernelMonotonicTimeSecs(0),
  }

  const render = renderModule(adapters.renderQuality, undefined, adapters.worldRenderer, initialPose)

  const registeredRender = await Effect.runPromise(
    Effect.provide(
      registerModule({
        name: '@nerima-games/mc-render',
        layers: adapters.inputLayer,
        frameStages: render.frameStages,
      }),
      adapters.inputContext,
    ),
  )

  const registeredChunkSync = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mc-render/world-sync',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed([chunkSyncStage]),
    }),
  )

  // `EMPTY_MODULE_LAYER` and not `uiModule.layers`, even though the two are the
  // same value. `Layer.empty` is typed `Layer<never, never, never>` and does NOT
  // assign to `ModuleLayer`: `Layer` declares `in ROut` contravariantly, so the
  // empty Layer is the single case where `any` would have to assign to `never`.
  // `domain/composition.ts` exports the constant precisely so that the cast
  // lives in one place and is checked by the preview TypeScript project.
  const registeredUi = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-ui',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(uiStages(uiFrameState)),
    }),
  )

  const registeredRedstone = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-redstone',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(adapters.runtimeRedstoneStages),
    }),
  )

  const registeredSim = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mc-sim',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(simStages(simState, time, playerApi, crops)),
    }),
  )

  const registeredGameplay = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-gameplay',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(
        gameplayStages(
          gameplayState,
          currentChunkStore,
          world.entities,
          world.inventory,
          world.player,
          time,
          vehicleService,
          {
            isActiveDimension,
            isPoweredRailAt: (dimension, position) => poweredRails.has(leverKeyOf({ dimension, position })),
            controlsForVehicle: (vehicle) => String(vehicle.id) === getMountedVehicleId() ? getVehicleControls() : { throttle: 0, steering: 0 },
            onVehicleExit: (vehicle) => {
              if (String(vehicle.id) === getMountedVehicleId()) setMountedVehicleId(undefined)
            },
          },
          {
            // This pickup configuration preserves
            // metadata/durability/custom names that the stage-level pickup does
            // not; droppedItemPickup: false keeps the two from consuming the
            // same inventory in one frame (restored in mx-gameplay 0.3.3).
            droppedItemPickup: false,
            mobSimulation: multiplayer === undefined,
          },
        ),
      ),
    }),
  )

  const modules: ReadonlyArray<GameModule> = [
    registeredRender,
    registeredChunkSync,
    registeredUi,
    registeredRedstone,
    registeredSim,
    registeredGameplay,
    ...(multiplayer === undefined
      ? []
      : [{
          name: 'mx-multiplayer',
          layers: EMPTY_MODULE_LAYER,
          frameStages: multiplayer.host.stages,
        }]),
  ]

  return modules
}
