import { blockIdOf, blockPosition, chunkCoord, DeltaTimeSecs, MonotonicTimeSecs } from '@nerima-games/mc-kernel'
import { type InputSnapshot } from '@nerima-games/mc-render'
import { makeTimeService, makeWeatherService } from '@nerima-games/mc-sim'
import { CHUNK_SIZE_XZ, CHUNK_VOLUME, FALLBACK_BIOME, type ChunkSource } from '@nerima-games/mc-worldgen'
import { type ItemUseResult, type MobBehaviour } from '@nerima-games/mx-gameplay'
import { Effect, Ref } from 'effect'
import { describe, expect, it } from 'vitest'
import * as gameplay from '@nerima-games/mx-gameplay'
import { makeUiFrameState } from '@nerima-games/mx-ui'

import { makeSurvivalHungerCoordinator } from '../apps/web/survival-hunger-runtime'
import { DEFAULT_PLAYER_SETTINGS } from '../apps/web/settings'
import { IDLE_BOW_USE } from '../apps/web/bow-use'
import { enterSleep, initialSleepRuntimeState, type SleepLocation } from '../apps/web/sleep-runtime'
import { initialSleepClientState } from '../apps/multiplayer-shared/sleep-network'
import type { PersistedVillager, SessionPosition } from '../apps/web/session-persistence'
import { mutableState, type H5aFrameInputResult, type H5aMovementResult, type H5aTickContext } from '../apps/web/tick/h5a-context'
import type { H5bPostFrameResult } from '../apps/web/tick/h5b-context'
import type { H5cTickContext } from '../apps/web/tick/h5c-context'
import { runTickPostFrameGameplay } from '../apps/web/tick/post-frame-gameplay'
import { type DimensionChunkContext } from '../apps/web/chunk-streaming'

const allAirChunkSource: ChunkSource = (coord) => Effect.succeed({
  coord,
  blocks: new Uint8Array(CHUNK_VOLUME).fill(blockIdOf('air')),
  biomes: Array.from({ length: CHUNK_SIZE_XZ * CHUNK_SIZE_XZ }, () => FALLBACK_BIOME),
})

const cell = <Value,>(initial: Value) => {
  let value = initial
  return {
    state: mutableState(() => value, (next) => { value = next }),
    get: () => value,
  }
}

const inputSnapshot: InputSnapshot = {
  pressed: new Set(),
  justPressed: new Set(),
  uiClicks: new Set(),
  uiClickLandings: [],
  pointerDelta: { x: 0, y: 0 },
  wheelNotches: 0,
  wheelSteps: 0,
  pointerLocked: false,
  pointerLockState: 'unlocked',
  keyboardFocus: undefined,
  gamepadAxes: { leftX: 0, leftY: 0, rightX: 0, rightY: 0 },
}

const makeDocument = (attributes: Map<string, string>): Document => ({
  body: {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
  },
  createElement: () => ({
    className: '',
    dataset: {},
    setAttribute: () => undefined,
    textContent: '',
  }),
} as unknown as Document)

type HarnessOptions = Readonly<{
  useTriggered?: boolean
  selectedItem?: 'eye_of_ender' | 'fishing_rod' | 'stone' | 'flint_and_steel'
  nearbyVillager?: PersistedVillager
  endFeatureResult?: boolean
  deadAfterFrame?: boolean
  targetedBlock?: {
    readonly position: SessionPosition
    readonly adjacentPosition: SessionPosition
    readonly block: number
  }
  fishingHasWater?: boolean
  lampTransitions?: ReadonlyArray<{
    readonly dimension: string
    readonly position: SessionPosition
    readonly lit: boolean
  }>
  dimension?: 'overworld' | 'end'
}>

const makeHarness = async (options: HarnessOptions = {}) => {
  const world = await Effect.runPromise(gameplay.makeGeneratedWorld<MobBehaviour>({
    dimension: options.dimension ?? 'overworld',
    chunkSource: allAirChunkSource,
  }))
  if (options.selectedItem !== undefined) {
    Effect.runSync(world.inventory.add(options.selectedItem, 1))
  }
  const gameplayState = await Effect.runPromise(gameplay.makeGameplayFrameState)
  const time = await Effect.runPromise(makeTimeService())
  const weather = await Effect.runPromise(makeWeatherService())
  const weatherBeforeFrame = Effect.runSync(weather.snapshot)
  const uiFrameState = Effect.runSync(makeUiFrameState)
  const attributes = new Map<string, string>()
  const canvasAttributes = new Map<string, string>()
  const tradeOpenCalls: Array<{ readonly open: boolean; readonly villagerId?: string }> = []
  const fishingResults: string[] = []
  const streamCalls: Array<{ readonly dimension: string; readonly x: number; readonly z: number }> = []
  const endAudioCalls: Array<{ readonly cue: string; readonly position: SessionPosition }> = []
  const endFeatureCalls = cell(0)
  const playerUiCalls = cell(0)
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

  const currentChunkContext = {
    dimension: options.dimension ?? 'overworld',
    chunkStore: world.chunkStore,
  } as DimensionChunkContext
  const pose = {
    feetPosition: { x: 12.346, y: 64.234, z: -7.891 },
    yawRadians: 0.25,
    pitchRadians: -0.1,
  }
  const frame: H5aFrameInputResult = {
    nowSecs: MonotonicTimeSecs(2),
    raw: 0.05,
    deltaSecs: DeltaTimeSecs(0.05),
    walk: inputSnapshot,
    dead: false,
    held: () => 0,
    attackTriggered: false,
    attackHeld: false,
    canUse: false,
    useTriggered: options.useTriggered ?? false,
    useHeld: false,
    looked: false,
  }
  const movement: H5aMovementResult = {
    poseBeforeFrame: pose,
    groundedBeforeFrame: true,
    dimensionBeforeFrame: 'overworld',
    weatherBeforeFrame,
    sprinting: false,
  }
  const postFrame: H5bPostFrameResult = {
    deadAfterFrame: options.deadAfterFrame ?? false,
    dimensionChanged: false,
    postFramePose: pose,
    dimensionAfterFrame: options.dimension ?? 'overworld',
    bowAdvance: { state: IDLE_BOW_USE, release: null, capturedUse: false },
    groundedAfterFrame: true,
    playerHeals: [],
  }
  const h5aState = {
    simulationElapsedSecs: cell(0).state,
    redstoneDirty: cell(false).state,
    inventoryOpen: cell(false).state,
    brewingOpen: cell(false).state,
    selectedHotbarIndex: cell(0).state,
    nextItemUseRequestId: cell(0).state,
    fishingSession: cell(undefined).state,
    fishingWater: cell(undefined).state,
    multiplayerHandshakeComplete: cell(false).state,
  }
  const h5a = {
    world,
    playerApi: world.player,
    currentChunkStore: world.chunkStore,
    blockPosition,
    blockTypeOfId: (id: number) => id === blockIdOf('air') ? 'air' : undefined,
    gameplayState,
    multiplayer: undefined,
    isCreativeMode: false,
    survivalHunger: makeSurvivalHungerCoordinator({
      snapshot: world.vitals.snapshot,
      restore: world.vitals.restore,
    }),
    setInventoryOpen: () => undefined,
    setBrewingOpen: () => undefined,
    setFishingResult: (result: string) => fishingResults.push(result),
    markSessionDirty: () => undefined,
    sendVitalsCommand: () => undefined,
    renderCrosshair: () => undefined,
    playerSettings: { ...DEFAULT_PLAYER_SETTINGS, captionsEnabled: false },
    currentChunkContext: () => currentChunkContext,
    canvas: {
      setAttribute: (name: string, value: string) => canvasAttributes.set(name, value),
    },
    state: h5aState,
  } as unknown as H5aTickContext
  const h5b = {
    state: {
      activeChestId: cell<string | undefined>(undefined).state,
      activeFurnaceKey: cell<string | undefined>(undefined).state,
      witherRuntimeState: cell(gameplay.initialWitherRuntimeState()).state,
    },
    inventoryMode: () => 'player',
    applyPlayerDamage: () => undefined,
    applyWorldExplosion: () => undefined,
    endDragonPosition: () => ({ x: 0, y: 64, z: 0 }),
    spawnDroppedItems: gameplay.spawnDroppedItems,
    spawnMobDrops: () => Effect.void,
    containerIdAt: () => '',
    furnaceKeyOf: () => '',
    drainPlayerHeals: gameplay.drainPlayerHeals,
    renderPlayerUi: () => playerUiCalls.state.set(playerUiCalls.get() + 1),
    dimensionContexts: new Map([[options.dimension ?? 'overworld', currentChunkContext]]),
    isLegacyGameplayItemType: (item: string) => item === 'flint_and_steel',
  } as unknown as H5cTickContext['h5b']
  const emptyEvents = Effect.succeed([])
  const adapters = {
    audio: { visible: () => [] },
    endAudio: { update: () => undefined },
    getReadAudioListenerForward: () => ({ x: 0, y: 0, z: -1 }),
    drainEndAudioEvents: () => [],
    queueEndAudio: (cue: string, position: SessionPosition) => endAudioCalls.push({ cue, position }),
    placementAudio: { request: () => undefined, confirm: () => undefined },
  }
  const services = {
    nearestVillagerForTrade: () => options.nearbyVillager,
    setTradeOpen: (open: boolean, villagerId?: string) => tradeOpenCalls.push({
      open,
      ...(villagerId === undefined ? {} : { villagerId }),
    }),
    targetedBlock: () => Effect.succeed(options.targetedBlock),
    fishingEnvironmentAt: () => Effect.succeed({
      hasWater: options.fishingHasWater ?? false,
      hasSkyAccess: false,
      isRaining: false,
      isOpenWater: false,
    }),
    networkFishingPhase: () => 'idle',
    vehicleService: {},
    vehicleList: () => [],
    localVehicleOccupant: 'player',
    replaceVehicle: () => undefined,
    multiplayerClient: {},
    playerSettings: () => ({ ...DEFAULT_PLAYER_SETTINGS, captionsEnabled: false }),
    endPortalComplete: () => false,
    useEndFeature: () => {
      endFeatureCalls.state.set(endFeatureCalls.get() + 1)
      return Effect.succeed(options.endFeatureResult ?? false)
    },
    renderBrewingUi: () => undefined,
    time,
    weather,
    redstoneContainerRuntime: {
      containerIdForStorageBlock: () => undefined,
      applyHopperTransfer: () => undefined,
      applyDispenserTrigger: () => undefined,
      applyDropperTrigger: () => undefined,
      applyPoweredPistonTransition: () => undefined,
    },
    redstoneRuntime: {
      drainLampTransitions: Effect.succeed(options.lampTransitions ?? []),
      drainPistonTransitions: emptyEvents,
      drainTriggerEvents: emptyEvents,
      drainHopperTransferEvents: emptyEvents,
      drainPoweredComponentTransitions: emptyEvents,
    },
    leverKeyOf: () => '',
    asBlockPosition: (position: SessionPosition) => blockPosition(position.x, position.y, position.z),
    streamAround: (context: DimensionChunkContext, x: number, z: number) => {
      streamCalls.push({ dimension: context.dimension, x, z })
      return Effect.void
    },
    presentWeather: () => undefined,
    presentWeatherRuntime: () => undefined,
    syncRenderedEntities: () => undefined,
    registerPortal: () => false,
    requiredSleepRatio: 1,
    sleepHud: { textContent: '', hidden: true },
    endDragonSnapshot: () => Effect.runSync(gameplayState.enderDragonEncounter.snapshot),
    adapters,
    uiFrameState,
    fpsValue: { textContent: '' },
    captionsParent: { replaceChildren: () => undefined },
    pendingItemUses: new Map(),
    pendingBlockUses: new Map(),
    pendingBlockPlacements: new Map(),
    pendingWitherSummonChecks: [],
    leverStates: new Map(),
    comparatorModes: new Map(),
    poweredRails: new Set(),
    redstoneLampTransitionLog: new Map(),
    crops: {},
    isGameplayUseItemType: (item: string) => item === 'flint_and_steel',
    isGameplayHoeItem: () => false,
    isGameplayIgnitionItem: (item: string) => item === 'flint_and_steel',
    isPlaceableGameplayItem: (item: string) => item === 'stone',
  } as unknown as H5cTickContext['services']
  const state: H5cTickContext['state'] = {
    framesTotal: cell(41).state,
    renderedCaptionSignature: cell<string | undefined>(undefined).state,
    nextFishingRoll: cell(0).state,
    mountedVehicleId: cell<string | undefined>(undefined).state,
    activeBrewingStandAt: cell<SessionPosition | undefined>(undefined).state,
    brewingStatus: cell('closed').state,
    sleepRuntimeState: cell(initialSleepRuntimeState()).state,
    respawnLocation: cell<SleepLocation | null>(null).state,
    networkSleepState: cell(initialSleepClientState()).state,
    nextSleepRequest: cell(0).state,
    appliedNightSkipRevision: cell<number | null>(null).state,
    multiplayerRejection: cell('').state,
    nextBlockUseRequestId: cell(0).state,
    nextBlockPlacementRequestId: cell(0).state,
    placementsRequested: cell(0).state,
    dragonEggRewarded: cell(false).state,
    exitPortalMaterialized: cell(false).state,
    nextMobDropId: cell(0).state,
    lastObservedItemUse: cell<ItemUseResult | undefined>(undefined).state,
  }
  const context = { h5a, h5b, services, state } as H5cTickContext

  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: makeDocument(attributes),
  })

  const restoreDocument = (): void => {
    if (previousDocument === undefined) {
      Reflect.deleteProperty(globalThis, 'document')
    } else {
      Object.defineProperty(globalThis, 'document', previousDocument)
    }
  }

  return {
    context,
    frame,
    movement,
    postFrame,
    world,
    attributes,
    canvasAttributes,
    tradeOpenCalls,
    fishingResults,
    streamCalls,
    endAudioCalls,
    endFeatureCalls,
    playerUiCalls,
    restoreDocument,
  }
}

type Harness = Awaited<ReturnType<typeof makeHarness>>

const withHarness = async (
  options: HarnessOptions,
  run: (harness: Harness) => void,
): Promise<void> => {
  const harness = await makeHarness(options)
  try {
    run(harness)
  } finally {
    harness.restoreDocument()
  }
}

describe('tick post-frame gameplay processing', () => {
  it('publishes fixed player pose, grounded state, and frame count', async () => {
    await withHarness({}, (harness) => {
      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.canvasAttributes.get('data-player-feet')).toBe('12.35,64.23,-7.89')
      expect(harness.canvasAttributes.get('data-player-grounded')).toBe('true')
      expect(harness.attributes.get('data-frames')).toBe('42')
    })
  })

  it('uses the end feature for an eye of ender and renders its UI route', async () => {
    await withHarness({
      useTriggered: true,
      selectedItem: 'eye_of_ender',
      endFeatureResult: true,
    }, (harness) => {
      expect(harness.frame.useTriggered).toBe(true)
      expect(Effect.runSync(harness.world.inventory.snapshot).slots[0]?.item).toBe('eye_of_ender')

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.endFeatureCalls.get()).toBe(1)
      expect(harness.playerUiCalls.get()).toBe(2)
    })
  })

  it('opens the nearby villager trade on a use trigger', async () => {
    const villager: PersistedVillager = {
      id: 'villager-7',
      profession: 'farmer',
      dimension: 'overworld',
      feetPosition: { x: 12.346, y: 64.234, z: -7.891 },
    }

    await withHarness({
      useTriggered: true,
      nearbyVillager: villager,
    }, (harness) => {
      expect(harness.frame.useTriggered).toBe(true)

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.tradeOpenCalls).toEqual([{ open: true, villagerId: 'villager-7' }])
    })
  })

  it('casts a local fishing rod into water and records the fishing session', async () => {
    const target = {
      position: { x: 2, y: 64, z: -3 },
      adjacentPosition: { x: 2, y: 65, z: -3 },
      block: blockIdOf('water'),
    }
    await withHarness({
      useTriggered: true,
      selectedItem: 'fishing_rod',
      targetedBlock: target,
      fishingHasWater: true,
    }, (harness) => {
      expect(harness.frame.useTriggered).toBe(true)
      expect(Effect.runSync(harness.world.inventory.snapshot).slots[0]?.item).toBe('fishing_rod')

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.fishingResults).toEqual(['cast'])
      expect(harness.context.h5a.state.fishingWater.get()).toEqual({
        dimension: 'overworld',
        position: target.position,
      })
    })
  })

  it('requests stone placement at the cell adjacent to the targeted block', async () => {
    await withHarness({ useTriggered: true, selectedItem: 'stone' }, (harness) => {
      const supportPosition = blockPosition(0, 65, -2)
      Effect.runSync(harness.world.worldgenChunkStore.load(chunkCoord(0, -1)))
      Effect.runSync(harness.world.player.restore({
        feetPosition: { x: 0.5, y: 64, z: 0.5 },
        yawRadians: 0,
        pitchRadians: 0,
      }, 'overworld'))
      Effect.runSync(harness.world.chunkStore.setBlock(supportPosition, blockIdOf('stone')))
      expect(harness.frame.useTriggered).toBe(true)
      expect(Effect.runSync(harness.world.inventory.snapshot).slots[0]?.item).toBe('stone')
      expect(Effect.runSync(harness.world.chunkStore.getBlock(supportPosition))).toMatchObject({
        _tag: 'Block',
        block: blockIdOf('stone'),
      })

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect([...harness.context.services.pendingBlockPlacements.values()]).toEqual([{
        dimension: 'overworld',
        item: 'stone',
        position: { x: 0, y: 65, z: -1 },
      }])
      expect(harness.context.state.placementsRequested.get()).toBe(1)
    })
  })

  it('queues flint-and-steel use at the targeted block cell', async () => {
    await withHarness({ useTriggered: true, selectedItem: 'flint_and_steel' }, (harness) => {
      const supportPosition = blockPosition(0, 65, -2)
      Effect.runSync(harness.world.worldgenChunkStore.load(chunkCoord(0, -1)))
      Effect.runSync(harness.world.player.restore({
        feetPosition: { x: 0.5, y: 64, z: 0.5 },
        yawRadians: 0,
        pitchRadians: 0,
      }, 'overworld'))
      Effect.runSync(harness.world.chunkStore.setBlock(supportPosition, blockIdOf('stone')))
      expect(harness.frame.useTriggered).toBe(true)
      expect(Effect.runSync(harness.world.inventory.snapshot).slots[0]?.item).toBe('flint_and_steel')

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect([...harness.context.services.pendingItemUses.entries()]).toEqual([['item-use-1', {
        kind: 'ignition',
        slotIndex: 0,
        heldItem: 'flint_and_steel',
        dimension: 'overworld',
      }]])
      expect(Effect.runSync(Ref.get(harness.context.h5a.gameplayState.pendingItemUses))).toEqual([{
        requestId: 'item-use-1',
        positionKey: '0,65,-1',
        heldItem: 'flint_and_steel',
      }])
    })
  })

  it('writes a lit redstone lamp transition into the active chunk store', async () => {
    const position = { x: 4, y: 70, z: -2 }
    await withHarness({
      lampTransitions: [{ dimension: 'overworld', position, lit: true }],
    }, (harness) => {
      Effect.runSync(harness.world.worldgenChunkStore.load(chunkCoord(0, -1)))
      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(Effect.runSync(harness.world.chunkStore.getBlock(blockPosition(position.x, position.y, position.z)))).toMatchObject({
        _tag: 'Block',
        block: blockIdOf('redstone_lamp_lit'),
      })
    })
  })

  it('streams chunks around the post-frame player position', async () => {
    await withHarness({}, (harness) => {
      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.streamCalls).toEqual([{ dimension: 'overworld', x: 12.346, z: -7.891 }])
    })
  })

  it('removes the local sleeper after a death frame', async () => {
    const bed: SleepLocation = {
      dimension: 'overworld',
      position: { x: 3, y: 64, z: 3 },
      bedPosition: { x: 3, y: 64, z: 3 },
    }
    await withHarness({ deadAfterFrame: true }, (harness) => {
      harness.context.state.sleepRuntimeState.set(enterSleep(initialSleepRuntimeState(), 'local', bed))
      expect(harness.context.state.sleepRuntimeState.get().sleepers).toHaveLength(1)
      expect(harness.postFrame.deadAfterFrame).toBe(true)

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.context.state.sleepRuntimeState.get().sleepers).toEqual([])
      expect(harness.attributes.get('data-sleeping-players')).toBe('0')
    })
  })

  it('applies the dragon defeat events to the portal and reward state', async () => {
    await withHarness({ dimension: 'end' }, (harness) => {
      Effect.runSync(harness.world.worldgenChunkStore.load(chunkCoord(0, 0)))
      const damage = Effect.runSync(harness.context.h5a.gameplayState.enderDragonEncounter.damageByPlayer(200))
      expect(damage).toMatchObject({ _tag: 'Applied', state: { phase: 'dead', health: 0 } })

      runTickPostFrameGameplay(harness.context, {
        frame: harness.frame,
        movement: harness.movement,
        postFrame: harness.postFrame,
        nowSecs: MonotonicTimeSecs(2),
      })

      expect(harness.context.state.dragonEggRewarded.get()).toBe(true)
      expect(harness.context.state.exitPortalMaterialized.get()).toBe(true)
      expect(harness.canvasAttributes.get('data-end-dragon-phase')).toBe('dead')
      expect(Effect.runSync(harness.world.chunkStore.getBlock(blockPosition(0, 64, 0)))).toMatchObject({
        _tag: 'Block',
        block: blockIdOf('end_portal'),
      })
      expect(harness.endAudioCalls.map(({ cue }) => cue)).toEqual(['dragonHurt', 'dragonReward', 'exitPortal'])
    })
  })
})
