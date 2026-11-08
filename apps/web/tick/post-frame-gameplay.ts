import { blockIdOf, MonotonicTimeSecs as KernelMonotonicTimeSecs, StackCount } from '@nerima-games/mc-kernel'
import { addExperience as addVitalsExperience, changed, emptyFurnaceState, UNCHANGED, type CropLocation, type WeatherState } from '@nerima-games/mc-sim'
import { Effect, Option, Ref } from 'effect'
import {
  boardVehicle,
  castFishing,
  drainBlockPlacementResults,
  drainBlockUseResults,
  drainBowKnockbacks,
  drainItemUseResults,
  drainMobDrops,
  drainMobExperience,
  isBucketItem,
  requestBlockPlacementCommand,
  requestPotatoFoodUse,
  requestTargetedBlockPlacement,
  requestTargetedBlockUse,
  requestTargetedItemUse,
  requestTargetedPotatoPlanting,
  requestTargetedSoilTill,
  reelFishing,
  resolveTargetedBlock,
  DEFAULT_BLOCK_REACH,
  resolveBedSleep,
  spawnMobDrops,
  targetedRightClickRoute,
  useBucket,
  type FishingRod,
  type FishingSession,
} from '@nerima-games/mx-gameplay'
import { END_PORTAL_BLOCK } from '@nerima-games/mc-worldgen'
import { WorldId } from '@nerima-games/mx-multiplayer'

import { excludeReservedPlacementConsumptions } from '../placement-consumption'
import { advanceFurnaceRuntime } from '../furnace-runtime'
import { requestPlacementFromSelectedSlot } from '../player-experience'
import {
  advanceSleep,
  enterSleep,
  initialSleepRuntimeState,
  isDangerNearby,
  leaveSleep,
  reconcileSleepers,
  requiredSleeperCount,
} from '../sleep-runtime'
import { matchRuntimeWitherSummon, summonRuntimeWither } from '../../multiplayer-shared/wither-runtime'
import { REDSTONE_PLACEMENT_ITEMS } from '../qa-fixtures'
import { captionRenderSignature } from '../audio-runtime'
import type { H5cPostFrameInput, H5cTickContext } from './h5c-context'
import { queueSleepCommand, type SleepCommand } from '../../multiplayer-shared/sleep-network'
import type { PersistedVillager } from '../session-persistence'

type Dimension = import('../session-persistence').SessionState['dimension']
type GameplayItemType = Parameters<typeof import('@nerima-games/mx-gameplay').isPlaceableItem>[0]

export const runTickPostFrameGameplay = (context: H5cTickContext, input: H5cPostFrameInput): void => {
  const { frame, movement, postFrame, nowSecs } = input
  const { deltaSecs, useTriggered } = frame
  const { poseBeforeFrame, weatherBeforeFrame } = movement
  const {
    deadAfterFrame,
    dimensionChanged,
    postFramePose,
    dimensionAfterFrame,
    bowAdvance,
    groundedAfterFrame,
    playerHeals,
  } = postFrame
  const { h5a, h5b, services, state } = context
  const {
    world,
    playerApi,
    currentChunkStore,
    blockPosition,
    blockTypeOfId,
    gameplayState,
    multiplayer,
    isCreativeMode,
    survivalHunger,
    setBrewingOpen,
    markSessionDirty,
    setFishingResult,
    renderCrosshair,
    canvas,
    currentChunkContext,
    vehicleById,
    getOrCreateDimensionChunkContext,
    furnaceStates,
    pendingFurnaceAdvances,
    deferredFurnaceAdvanceSecs,
  } = h5a
  const EYE_LEVEL_OFFSET = h5a.eyeLevelOffset
  const {
    applyPlayerDamage,
    applyWorldExplosion,
    endDragonPosition,
    spawnDroppedItems,
    containerIdAt,
    furnaceKeyOf,
    isLegacyGameplayItemType,
    inventoryMode,
    renderPlayerUi,
    dimensionContexts,
  } = h5b
  const {
    nearestVillagerForTrade,
    setTradeOpen,
    setInventoryOpen,
    targetedBlock,
    fishingEnvironmentAt,
    networkFishingPhase,
    playerSettings,
    vehicleService,
    vehicleList,
    localVehicleOccupant,
    replaceVehicle,
    multiplayerClient,
    endPortalComplete,
    useEndFeature,
    renderBrewingUi,
    time,
    weather,
    redstoneContainerRuntime,
    redstoneRuntime,
    leverKeyOf,
    asBlockPosition,
    streamAround,
    presentWeather,
    presentWeatherRuntime,
    syncRenderedEntities,
    registerPortal,
    requiredSleepRatio,
    sleepHud,
    endDragonSnapshot,
    adapters,
    uiFrameState,
    fpsValue,
    captionsParent,
    observedMobDrops,
    pendingItemUses,
    pendingBlockUses,
    pendingBlockPlacements,
    pendingWitherSummonChecks,
    leverStates,
    comparatorModes,
    poweredRails,
    redstoneLampTransitionLog,
    crops,
    isGameplayUseItemType,
    isGameplayHoeItem,
    isGameplayIgnitionItem,
    isPlaceableGameplayItem,
  } = services
  const {
    sendEntityCommand,
    sendPortalUseCommand,
    sendToggleLeverCommand,
    sendFacilityCommand,
    requestBrewing,
  } = multiplayerClient
  const {
    containerIdForStorageBlock,
    applyHopperTransfer,
    applyDispenserTrigger,
    applyDropperTrigger,
    applyPoweredPistonTransition,
  } = redstoneContainerRuntime
  const { audio, endAudio, queueEndAudio, placementAudio } = adapters
  const { state: h5aState } = h5a
  const { state: h5bState } = h5b
  const increment = (reference: { readonly get: () => number; readonly set: (value: number) => void }): void => {
    reference.set(reference.get() + 1)
  }
  const takeThenIncrement = (reference: { readonly get: () => number; readonly set: (value: number) => void }): number => {
    const current = reference.get()
    reference.set(current + 1)
    return current
  }

  let nearbyVillager: PersistedVillager | undefined
  try {
    nearbyVillager = !deadAfterFrame && !dimensionChanged && useTriggered
      ? nearestVillagerForTrade(postFramePose.feetPosition, currentChunkContext().dimension)
      : undefined
  } catch (error) {
    console.warn('Unable to resolve nearby villager for interaction', error)
  }
  if (nearbyVillager !== undefined && !bowAdvance.capturedUse) {
    setTradeOpen(true, nearbyVillager.id)
  }

  if (
    nearbyVillager === undefined
    && !deadAfterFrame
    && useTriggered
    && !bowAdvance.capturedUse
  ) {
    let usedSpecialItem = false
    const fishingStorage = Effect.runSync(world.inventory.storageSnapshot)
    const fishingHeld = fishingStorage.inventory.slots[h5aState.selectedHotbarIndex.get()]
    const fishingDurability = fishingStorage.inventoryDurability[h5aState.selectedHotbarIndex.get()]
    let currentFishingSession: FishingSession | undefined
    if (
      multiplayer !== undefined
      && h5aState.multiplayerHandshakeComplete.get()
      && (h5aState.fishingSession.get() !== undefined || fishingHeld?.item === 'fishing_rod')
    ) {
      sendEntityCommand({ _tag: 'FishingCommand', action: networkFishingPhase() === 'idle' ? 'cast' : 'reel' })
      usedSpecialItem = true
    } else if ((currentFishingSession = h5aState.fishingSession.get()) !== undefined) {
      const result = reelFishing(currentFishingSession)
      Effect.runSync(world.inventory.damageAt(
        { _tag: 'Inventory', slotIndex: h5aState.selectedHotbarIndex.get() },
        1,
      ))
      if (result._tag === 'Caught') {
        Effect.runSync(world.inventory.add(result.loot.item, result.loot.count))
        setFishingResult(`caught-${result.loot.item}`)
      } else {
        setFishingResult(result._tag === 'ReeledTooEarly' ? 'too-early' : 'too-late')
      }
      h5aState.fishingSession.set(undefined)
      h5aState.fishingWater.set(undefined)
      document.body.setAttribute('data-fishing-phase', 'idle')
      markSessionDirty()
      renderPlayerUi()
      usedSpecialItem = true
    } else if (
      fishingHeld?.item === 'fishing_rod' &&
      fishingDurability !== null &&
      fishingDurability !== undefined
    ) {
      const target = Effect.runSync(targetedBlock())
      const dimension = Effect.runSync(playerApi.dimension)
      const environment = target === undefined
        ? { hasWater: false, hasSkyAccess: false, isRaining: false, isOpenWater: false }
        : Effect.runSync(fishingEnvironmentAt(
            target.position,
            weatherBeforeFrame.weather === 'rain' || weatherBeforeFrame.weather === 'thunder',
          ))
      const serial = takeThenIncrement(state.nextFishingRoll)
      const cast = castFishing({
        item: 'fishing_rod',
        count: StackCount(1),
        durability: fishingDurability,
      } satisfies FishingRod, environment, {
        wait: ((serial * 37) % 997) / 997,
        category: ((serial * 101) % 997) / 997,
        item: ((serial * 211) % 997) / 997,
      })
      if (cast._tag === 'Cast' && target !== undefined) {
        h5aState.fishingSession.set(cast.session)
        h5aState.fishingWater.set({ dimension, position: target.position })
        setFishingResult('cast')
      } else {
        setFishingResult(cast._tag === 'NoWater' ? 'no-water' : 'invalid-rod')
      }
      usedSpecialItem = true
    }
    let currentMountedVehicleId: string | undefined
    if (!usedSpecialItem && (currentMountedVehicleId = state.mountedVehicleId.get()) !== undefined) {
      const vehicle = vehicleById(currentMountedVehicleId)
      if (vehicle !== undefined) Effect.runSync(vehicleService.dismount(vehicle.id, localVehicleOccupant))
      state.mountedVehicleId.set(undefined)
      usedSpecialItem = true
    } else if (!usedSpecialItem) {
      const pose = Effect.runSync(playerApi.pose)
      const nearbyVehicle = vehicleList()
        .filter((vehicle) => vehicle.dimension === currentChunkContext().dimension && vehicle.occupant === undefined)
        .map((vehicle) => ({ vehicle, distance: Math.hypot(
          vehicle.position.x - pose.feetPosition.x,
          vehicle.position.y - pose.feetPosition.y,
          vehicle.position.z - pose.feetPosition.z,
        ) }))
        .filter(({ distance }) => distance <= 2)
        .sort((left, right) => left.distance - right.distance)[0]
      if (nearbyVehicle !== undefined) {
        const boarded = boardVehicle(nearbyVehicle.vehicle, localVehicleOccupant, nearbyVehicle.distance)
        if (boarded.occupant !== undefined) Effect.runSync(vehicleService.mount(boarded.id, localVehicleOccupant))
        state.mountedVehicleId.set(String(boarded.id))
        usedSpecialItem = true
      }
    }
    const specialInventory = Effect.runSync(world.inventory.snapshot)
    const specialSelected = specialInventory.slots[h5aState.selectedHotbarIndex.get()]
    if (!usedSpecialItem && specialSelected?.item === 'ender_pearl') {
      if (multiplayer !== undefined) {
        sendEntityCommand({ _tag: 'EnderPearlCommand' })
      } else {
        const pose = Effect.runSync(playerApi.pose)
        const horizontal = Math.cos(pose.pitchRadians)
        const origin = {
          x: pose.feetPosition.x,
          y: pose.feetPosition.y + EYE_LEVEL_OFFSET,
          z: pose.feetPosition.z,
        }
        const target = Effect.runSync(targetedBlock())
        const hitDistance = target === undefined
          ? undefined
          : Math.hypot(
              target.position.x + 0.5 - origin.x,
              target.position.y + 0.5 - origin.y,
              target.position.z + 0.5 - origin.z,
            )
        Effect.runSync(Ref.update(gameplayState.pendingPearlThrows, (requests) => [
          ...requests,
          {
            origin,
            inventory: {
              mode: isCreativeMode ? 'creative' as const : 'survival' as const,
              slotIndex: h5aState.selectedHotbarIndex.get(),
            },
            dirX: -Math.sin(pose.yawRadians) * horizontal,
            dirY: Math.sin(pose.pitchRadians),
            dirZ: -Math.cos(pose.yawRadians) * horizontal,
            ...(hitDistance === undefined ? {} : { hitDistance }),
          },
        ]))
        if (!isCreativeMode) {
          Effect.runSync(world.inventory.removeAt(h5aState.selectedHotbarIndex.get(), 'ender_pearl', 1))
        }
        markSessionDirty()
        renderPlayerUi()
      }
      usedSpecialItem = true
    }
    if (!usedSpecialItem && specialSelected !== undefined && isBucketItem(specialSelected.item)) {
      if (multiplayer !== undefined && h5aState.multiplayerHandshakeComplete.get()) {
        sendEntityCommand({ _tag: 'BucketUseCommand' })
        usedSpecialItem = true
      } else {
        const target = Effect.runSync(targetedBlock())
        if (target !== undefined) {
          const dimension = Effect.runSync(playerApi.dimension)
          const result = Effect.runSync(useBucket(
            currentChunkStore,
            world.inventory,
            gameplayState.fluidFrontier,
            {
              activeDimension: dimension,
              targetDimension: dimension,
              position: (specialSelected.item === 'bucket'
                ? blockPosition(target.position.x, target.position.y, target.position.z)
                : blockPosition(target.adjacentPosition.x, target.adjacentPosition.y, target.adjacentPosition.z)),
              heldItem: specialSelected.item,
            },
          ))
          document.body.setAttribute('data-bucket-result', result._tag)
          usedSpecialItem = true
          if (result._tag === 'Collected' || result._tag === 'Placed') {
            markSessionDirty()
            renderPlayerUi()
          }
        }
      }
    }
    if (!usedSpecialItem && specialSelected !== undefined
      && (specialSelected.item === 'oak_boat' || specialSelected.item === 'minecart')) {
      if (multiplayer !== undefined && h5aState.multiplayerHandshakeComplete.get()) {
        sendEntityCommand({ _tag: 'VehicleUseCommand' })
      } else {
        const target = Effect.runSync(targetedBlock())
        if (target !== undefined) {
          const type = specialSelected.item === 'oak_boat' ? 'boat' : 'minecart'
          const item = specialSelected.item
          // A boat aimed at open water must land AT the water block's
          // own cell, not the empty cell adjacent to whichever face was
          // hit — the same reason a minecart lands at the rail's own
          // cell rather than beside it. mx-gameplay's vehicle-frame.ts
          // (`waterAt`) reads whether the BOAT'S OWN cell (or the one
          // above it) is water to decide propulsion; a boat commonly
          // gets placed by aiming down at open water, which hits the
          // water block's TOP face, and `target.adjacentPosition` for a
          // top-face hit is one cell ABOVE the water — never detected as
          // in-water, so the boat only ever gets stepBoat's 15% off-water
          // crawl (~0.05 blocks/sec measured) no matter how it is
          // driven. Landed via a QA-seeded pool and the SAME real
          // right-click placement path in e2e/boat-water.e2e.ts before
          // this fix: placed at water's own y+1, terminal speed 0.048.
          const at = (
            (type === 'minecart' && (blockTypeOfId(target.block) === 'rail' || blockTypeOfId(target.block) === 'powered_rail'))
            || (type === 'boat' && blockTypeOfId(target.block) === 'water')
          )
            ? target.position
            : target.adjacentPosition
          const removed = Effect.runSync(world.inventory.removeAt(h5aState.selectedHotbarIndex.get(), item, 1))
          if (removed._tag === 'Removed') {
            const spawned = Effect.runSync(vehicleService.spawn(
              type,
              Effect.runSync(playerApi.dimension),
              { x: at.x + 0.5, y: at.y, z: at.z + 0.5 },
              poseBeforeFrame.yawRadians,
            ))
            replaceVehicle({
              ...spawned,
              velocity: type === 'minecart' ? { x: 0, y: 0, z: -0.25 } : { x: 0, y: 0, z: 0 },
            })
            document.body.setAttribute('data-vehicle-result', `placed-${type}`)
            markSessionDirty()
            renderPlayerUi()
          }
        }
      }
      usedSpecialItem = true
    }
    const portalTarget = !usedSpecialItem && multiplayer !== undefined && h5aState.multiplayerHandshakeComplete.get()
      ? Effect.runSync(targetedBlock())
      : undefined
    const portalBlock = portalTarget === undefined ? undefined : blockTypeOfId(portalTarget.block)
    const usedMultiplayerPortal = portalTarget !== undefined
      && (portalBlock === 'end_portal' || portalBlock === 'nether_portal')
      && sendPortalUseCommand(
        portalTarget.position,
        portalBlock === 'end_portal' ? 'EndPortalUseCommand' : 'NetherPortalUseCommand',
      )
    const usedMultiplayerLever = portalTarget !== undefined
      && blockTypeOfId(portalTarget.block) === 'lever'
    if (usedMultiplayerLever) sendToggleLeverCommand(portalTarget.position)
    const shouldAttemptEndFeature = currentChunkContext().dimension === 'end'
      || endPortalComplete()
      || specialSelected?.item === 'eye_of_ender'
    const usedEndFeature = usedSpecialItem
      || usedMultiplayerPortal
      || (shouldAttemptEndFeature && Effect.runSync(useEndFeature()))
    const brewingTarget = usedEndFeature || usedMultiplayerLever ? undefined : Effect.runSync(targetedBlock())
    const opensBrewing = brewingTarget !== undefined && blockTypeOfId(brewingTarget.block) === 'brewing_stand'
    const route = usedEndFeature || usedMultiplayerLever || opensBrewing
      ? undefined
      : Effect.runSync(targetedRightClickRoute(currentChunkStore, playerApi, DEFAULT_BLOCK_REACH))
    if (usedEndFeature || usedMultiplayerLever) {
      renderPlayerUi()
    } else if (opensBrewing) {
      setBrewingOpen(true)
      if (multiplayer !== undefined && brewingTarget !== undefined) {
        state.activeBrewingStandAt.set({ ...brewingTarget.position })
        if (!requestBrewing({ _tag: 'open' })) state.brewingStatus.set('Brewing stand is unavailable')
        renderBrewingUi()
      }
    } else if (route?.kind === 'craftingTable') {
      setInventoryOpen(true, 'craftingTable')
    } else if (route?.kind === 'anvil') {
      setInventoryOpen(true, 'anvil')
    } else if (route?.kind === 'enchantingTable') {
      setInventoryOpen(true, 'enchanting')
    } else if (route?.kind === 'bed') {
      const bedPosition = blockPosition(
        Math.floor(route.at.x),
        Math.floor(route.at.y),
        Math.floor(route.at.z),
      )
      const currentDimension = Effect.runSync(playerApi.dimension)
      if (currentDimension !== 'overworld' && multiplayer !== undefined) {
        document.body.setAttribute('data-sleep-result', 'unavailable')
      } else if (currentDimension !== 'overworld') {
        state.sleepRuntimeState.set(leaveSleep(state.sleepRuntimeState.get(), multiplayer?.query.player ?? 'local'))
        Effect.runSync(currentChunkStore.setBlock(bedPosition, blockIdOf('air')))
        applyWorldExplosion(
          { x: bedPosition.x + 0.5, y: bedPosition.y + 0.5, z: bedPosition.z + 0.5 },
          5,
          Math.floor(h5aState.simulationElapsedSecs.get() * 20),
          false,
        )
        document.body.setAttribute(
          'data-bed-explosion-request',
          `${currentDimension}:${bedPosition.x},${bedPosition.y},${bedPosition.z}`,
        )
        document.body.setAttribute('data-sleep-result', 'exploded')
      } else {
        const hostilePositions = Effect.runSync(world.entities.snapshot).entities
          .filter((entity) => entity.kind !== 'dropped_item')
          .map((entity) => entity.feetPosition)
        const decision = resolveBedSleep({
          bedPosition,
          dangerNearby: isDangerNearby(bedPosition, hostilePositions),
          dimension: currentDimension,
          timeOfDay: Effect.runSync(time.timeOfDay),
          weather: Effect.runSync(weather.snapshot).weather,
        })
        if (decision._tag === 'SleepAccepted') {
          const location = { ...decision.respawnLocation, bedPosition }
          state.respawnLocation.set(location)
          if (multiplayer === undefined) {
            state.sleepRuntimeState.set(enterSleep(state.sleepRuntimeState.get(), 'local', location))
            document.body.setAttribute('data-sleep-result', 'accepted')
          } else {
            const command: SleepCommand = {
              _tag: 'EnterSleep',
              actor: multiplayer.query.player,
              session: String(multiplayer.query.player),
              requestId: `sleep-${String(takeThenIncrement(state.nextSleepRequest))}`,
              expectedRevision: state.networkSleepState.get().revision,
              clientTick: Math.floor(performance.now()),
              bed: bedPosition,
            }
            state.networkSleepState.set(queueSleepCommand(state.networkSleepState.get(), command))
            Effect.runFork(multiplayer.transport.sendSleep({ _tag: 'SleepCommand', command }))
            document.body.setAttribute('data-sleep-result', 'pending')
          }
          markSessionDirty()
        } else {
          document.body.setAttribute('data-sleep-result', decision.reason)
        }
      }
    } else if (route?.kind === 'furnace') {
      const dimension = Effect.runSync(playerApi.dimension)
      const position = {
        x: Math.floor(route.at.x),
        y: Math.floor(route.at.y),
        z: Math.floor(route.at.z),
      }
      const key = furnaceKeyOf({ dimension, position })
      if (multiplayer === undefined && !furnaceStates.has(key)) {
        furnaceStates.set(key, { dimension, position, state: emptyFurnaceState() })
        markSessionDirty()
      }
      if (multiplayer === undefined || furnaceStates.has(key)) {
        h5bState.activeFurnaceKey.set(key)
        setInventoryOpen(true, 'furnace')
      } else {
        state.multiplayerRejection.set('Furnace is not present in the authoritative snapshot.')
      }
    } else if (route?.kind === 'storage') {
      const dimension = Effect.runSync(playerApi.dimension)
      const position = {
        x: Math.floor(route.at.x),
        y: Math.floor(route.at.y),
        z: Math.floor(route.at.z),
      }
      const id = containerIdAt(dimension, position)
      if (multiplayer !== undefined) {
        const container = Effect.runSync(world.inventory.containerSnapshot(id))
        if (container !== undefined && sendFacilityCommand({
          _tag: 'ContainerCommand',
          containerId: id,
          action: { _tag: 'open' },
        })) {
          h5bState.activeChestId.set(id)
          setInventoryOpen(true, 'chest')
        }
      } else {
        const localContainerId = containerIdForStorageBlock(dimension, position)
        if (localContainerId !== undefined) {
          h5bState.activeChestId.set(localContainerId)
          setInventoryOpen(true, 'chest')
        }
      }
    } else {
      const inventoryBeforeUse = Effect.runSync(world.inventory.snapshot)
      const selected = inventoryBeforeUse.slots[h5aState.selectedHotbarIndex.get()]
      let shouldAttemptPlacement = selected !== undefined
        && !isGameplayUseItemType(selected.item)

      if (selected !== undefined && isGameplayUseItemType(selected.item)) {
        increment(h5aState.nextItemUseRequestId)
        const requestId = `item-use-${String(h5aState.nextItemUseRequestId.get())}`
        if (selected.item === 'potato') {
          const target = Effect.runSync(
            requestTargetedPotatoPlanting(
              gameplayState,
              currentChunkStore,
              playerApi,
              requestId,
            ),
          )
          if (Option.isSome(target)) {
            pendingItemUses.set(requestId, {
              kind: 'plant',
              slotIndex: h5aState.selectedHotbarIndex.get(),
              dimension: Effect.runSync(playerApi.dimension),
            })
          } else {
            Effect.runSync(
              requestPotatoFoodUse(
                gameplayState,
                requestId,
                Effect.runSync(world.vitals.snapshot),
              ),
            )
            pendingItemUses.set(requestId, { kind: 'eat', slotIndex: h5aState.selectedHotbarIndex.get() })
          }
        } else if (
          isLegacyGameplayItemType(selected.item) &&
          isGameplayHoeItem(selected.item)
        ) {
          const target = Effect.runSync(
            requestTargetedSoilTill(
              gameplayState,
              currentChunkStore,
              playerApi,
              requestId,
              selected.item,
            ),
          )
          if (Option.isSome(target)) {
            pendingItemUses.set(requestId, {
              kind: 'till',
              slotIndex: h5aState.selectedHotbarIndex.get(),
              heldItem: selected.item,
            })
          }
        } else if (
          isLegacyGameplayItemType(selected.item) &&
          isGameplayIgnitionItem(selected.item)
        ) {
          const blockTarget = Effect.runSync(resolveTargetedBlock(currentChunkStore, playerApi))
          const blockReading = Option.isSome(blockTarget)
            ? Effect.runSync(currentChunkStore.getBlock(blockPosition(blockTarget.value.position.x, blockTarget.value.position.y, blockTarget.value.position.z)))
            : undefined
          if (
            multiplayer !== undefined &&
            Option.isSome(blockTarget) &&
            blockReading?._tag === 'Block' &&
            blockTypeOfId(blockReading.block) === 'tnt'
          ) {
            sendEntityCommand({ _tag: 'IgniteTntCommand', at: blockTarget.value.position })
          } else {
            const target = Effect.runSync(
              requestTargetedItemUse(
                gameplayState,
                currentChunkStore,
                playerApi,
                requestId,
                selected.item,
              ),
            )
            if (Option.isSome(target)) {
              pendingItemUses.set(requestId, {
                kind: 'ignition',
                slotIndex: h5aState.selectedHotbarIndex.get(),
                heldItem: selected.item,
                dimension: Effect.runSync(playerApi.dimension),
              })
            }
          }
        } else {
          shouldAttemptPlacement = true
        }
      }

      if (shouldAttemptPlacement) {
        placementAudio.request()
        requestPlacementFromSelectedSlot(
          inventoryBeforeUse.slots,
          h5aState.selectedHotbarIndex.get(),
          isPlaceableGameplayItem,
          (heldItem) => {
            if (multiplayer !== undefined) {
              const target = Effect.runSync(
                requestTargetedBlockPlacement(
                  gameplayState,
                  currentChunkStore,
                  playerApi,
                  heldItem,
                ),
              )
              Effect.runSync(Ref.set(gameplayState.pendingPlacements, []))
              if (Option.isSome(target)) {
                Effect.runSync(multiplayer.host.enqueueOutbound({
                  _tag: 'BlockPlace',
                  player: multiplayer.query.player,
                  world: WorldId.make(Effect.runSync(playerApi.dimension)),
                  at: target.value.adjacentPosition,
                  block: heldItem,
                }))
                increment(state.placementsRequested)
                placementAudio.request(target.value.adjacentPosition)
                canvas.setAttribute('data-placements-requested', String(state.placementsRequested.get()))
              }
              return
            }
            increment(state.nextBlockUseRequestId)
            const requestId = `block-use-${String(state.nextBlockUseRequestId.get())}`
            const target = Effect.runSync(
              requestTargetedBlockUse(
                gameplayState,
                currentChunkStore,
                playerApi,
                requestId,
                heldItem,
              ),
            )
            if (Option.isSome(target)) {
              const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(target.value.position.x, target.value.position.y, target.value.position.z)))
              if (reading._tag === 'Block' && reading.block === 76) {
                pendingBlockUses.set(requestId, {
                  dimension: currentChunkContext().dimension,
                  position: target.value.position,
                })
              } else if (reading._tag === 'Block' && reading.block === 77) {
                Effect.runSync(redstoneRuntime.pressButton(
                  currentChunkContext().dimension,
                  target.value.position,
                ))
              } else if (reading._tag === 'Block' && reading.block === 82) {
                const key = leverKeyOf({
                  dimension: currentChunkContext().dimension,
                  position: target.value.position,
                })
                comparatorModes.set(
                  key,
                  comparatorModes.get(key) === 'subtract' ? 'compare' : 'subtract',
                )
                h5aState.redstoneDirty.set(true)
              } else {
                Effect.runSync(Ref.set(gameplayState.pendingPlacements, []))
                increment(state.nextBlockPlacementRequestId)
                const placementRequestId = `block-placement-${String(state.nextBlockPlacementRequestId.get())}`
                Effect.runSync(requestBlockPlacementCommand(gameplayState, {
                  requestId: placementRequestId,
                  positionKey: `${target.value.adjacentPosition.x},${target.value.adjacentPosition.y},${target.value.adjacentPosition.z}` as Parameters<typeof requestBlockPlacementCommand>[1]['positionKey'],
                  heldItem,
                  mode: isCreativeMode ? 'creative' : 'survival',
                }))
                pendingBlockPlacements.set(placementRequestId, {
                  dimension: currentChunkContext().dimension,
                  item: heldItem,
                  position: target.value.adjacentPosition,
                })
                increment(state.placementsRequested)
                placementAudio.request(target.value.adjacentPosition)
                canvas.setAttribute('data-placements-requested', String(state.placementsRequested.get()))
              }
              markSessionDirty()
            }
          },
        )
      }
    }
  }
  if (multiplayer === undefined) {
    for (const outcome of Effect.runSync(Ref.getAndSet(gameplayState.enderPearlOutcomes, []))) {
      const pose = Effect.runSync(playerApi.pose)
      Effect.runSync(playerApi.moveTo({
        x: pose.feetPosition.x + outcome.displacement.x,
        y: pose.feetPosition.y + outcome.displacement.y,
        z: pose.feetPosition.z + outcome.displacement.z,
      }))
      if (outcome.damage !== undefined) applyPlayerDamage(outcome.damage)
      markSessionDirty()
    }
    for (const knockback of Effect.runSync(drainBowKnockbacks(gameplayState))) {
      let applied = false
      Effect.runSync(world.entities.sweep((entity) => {
        if (entity.id !== knockback.id || entity.healthPoints <= 0) {
          return { transition: UNCHANGED, emit: undefined }
        }
        applied = true
        return {
          transition: changed({
            feetPosition: knockback.direction._tag === 'Away'
              ? {
                x: entity.feetPosition.x + knockback.direction.x * 0.35,
                y: entity.feetPosition.y,
                z: entity.feetPosition.z + knockback.direction.z * 0.35,
              }
              : {
                x: entity.feetPosition.x,
                y: entity.feetPosition.y + 0.35,
                z: entity.feetPosition.z,
              },
            healthPoints: entity.healthPoints,
            behaviour: entity.behaviour,
          }),
          emit: undefined,
        }
      }))
      if (applied) markSessionDirty()
    }
  }
  const confirmedPlacementItems: GameplayItemType[] = []
  const reservedPlacementItems: GameplayItemType[] = []
  for (const result of Effect.runSync(drainBlockPlacementResults(gameplayState))) {
    const pending = pendingBlockPlacements.get(result.requestId)
    pendingBlockPlacements.delete(result.requestId)
    if (pending === undefined || !result.success) continue
    confirmedPlacementItems.push(pending.item)
    if (result.consumed) reservedPlacementItems.push(pending.item)
    markSessionDirty()
    if (REDSTONE_PLACEMENT_ITEMS.has(pending.item)) h5aState.redstoneDirty.set(true)
    if (pending.item === 'wither_skeleton_skull') {
      pendingWitherSummonChecks.push(pending as {
        readonly dimension: Dimension
        readonly item: 'wither_skeleton_skull'
        readonly position: { readonly x: number; readonly y: number; readonly z: number }
      })
    }
  }

  // Placement requests are serviced after the frame-start redstone sync.
  // Only the success outbox proves that a component now exists in the store.
  const consumedPlacements = excludeReservedPlacementConsumptions(
    Effect.runSync(Ref.getAndSet(gameplayState.consumedItems, [])),
    reservedPlacementItems,
  )
  for (const item of consumedPlacements) {
    if (isCreativeMode) {
      Effect.runSync(world.inventory.add(item, 1))
    } else {
      const selected = Effect.runSync(world.inventory.snapshot).slots[h5aState.selectedHotbarIndex.get()]
      if (selected?.item === item) {
        Effect.runSync(world.inventory.removeAt(h5aState.selectedHotbarIndex.get(), item, 1))
      }
    }
    let summonCheckIndex = -1
    for (let index = pendingWitherSummonChecks.length - 1; index >= 0; index -= 1) {
      if (pendingWitherSummonChecks[index]?.item === item) {
        summonCheckIndex = index
        break
      }
    }
    if (summonCheckIndex >= 0) {
      const [pending] = pendingWitherSummonChecks.splice(summonCheckIndex, 1)
      for (let index = pendingWitherSummonChecks.length - 1; index >= 0; index -= 1) {
        if (pendingWitherSummonChecks[index]?.item === item) {
          pendingWitherSummonChecks.splice(index, 1)
        }
      }
      if (pending !== undefined) {
        const context = dimensionContexts.get(pending.dimension)
        const match = context === undefined ? undefined : matchRuntimeWitherSummon(
          pending.position,
          (cell) => {
            const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(cell.x, cell.y, cell.z)))
            return reading._tag === 'Block' ? blockTypeOfId(reading.block) : undefined
          },
        )
        if (match !== undefined && context !== undefined) {
          for (const position of match.consumedBlocks) {
            Effect.runSync(context.chunkStore.setBlock(blockPosition(position.x, position.y, position.z), blockIdOf('air')))
          }
          h5bState.witherRuntimeState.set(summonRuntimeWither(
            h5bState.witherRuntimeState.get(),
            pending.dimension,
            match.spawnPosition,
          ))
          markSessionDirty()
        }
      }
    }
  }
  placementAudio.confirm([...consumedPlacements, ...confirmedPlacementItems])
  if (consumedPlacements.some((item) => REDSTONE_PLACEMENT_ITEMS.has(item))) {
    h5aState.redstoneDirty.set(true)
  }

  for (const result of Effect.runSync(drainBlockUseResults(gameplayState))) {
    const pending = pendingBlockUses.get(result.requestId)
    pendingBlockUses.delete(result.requestId)
    if (
      pending !== undefined &&
      result.success &&
      result.outcome._tag === 'ToggleLever' &&
      result.outcome.position.x === pending.position.x &&
      result.outcome.position.y === pending.position.y &&
      result.outcome.position.z === pending.position.z
    ) {
      const key = leverKeyOf(pending)
      leverStates.set(key, {
        dimension: pending.dimension,
        position: pending.position,
        active: !(leverStates.get(key)?.active ?? false),
      })
      h5aState.redstoneDirty.set(true)
      markSessionDirty()
    }
  }

  if (multiplayer === undefined) {
    for (const transition of Effect.runSync(redstoneRuntime.drainLampTransitions)) {
      const context = dimensionContexts.get(transition.dimension as Dimension)
      if (context === undefined) continue
      const lampPosition = asBlockPosition(transition.position)
      Effect.runSync(context.chunkStore.setBlock(lampPosition, transition.lit ? blockIdOf('redstone_lamp_lit') : blockIdOf('redstone_lamp')))
      const confirmedRead = Effect.runSync(context.chunkStore.getBlock(lampPosition))
      const transitionKey = leverKeyOf({ dimension: transition.dimension as Dimension, position: transition.position })
      redstoneLampTransitionLog.set(transitionKey, [
        ...(redstoneLampTransitionLog.get(transitionKey) ?? []),
        { lit: transition.lit, writtenBlock: confirmedRead._tag === 'Block' ? confirmedRead.block : null },
      ])
      markSessionDirty()
    }
    for (const transition of Effect.runSync(redstoneRuntime.drainPistonTransitions)) {
      applyPoweredPistonTransition(transition)
    }
    for (const event of Effect.runSync(redstoneRuntime.drainTriggerEvents)) {
      canvas.setAttribute(
        'data-redstone-trigger',
        `${event.kind}:${event.dimension}:${event.position.x},${event.position.y},${event.position.z}`,
      )
      if (event.kind === 'dispenser') {
        applyDispenserTrigger(event.dimension as Dimension, event.position)
      } else if (event.kind === 'dropper') {
        applyDropperTrigger(event.dimension as Dimension, event.position)
      }
      markSessionDirty()
    }
    for (const event of Effect.runSync(redstoneRuntime.drainHopperTransferEvents)) {
      applyHopperTransfer(event.dimension as Dimension, event.position)
    }
    for (const transition of Effect.runSync(redstoneRuntime.drainPoweredComponentTransitions)) {
      const context = dimensionContexts.get(transition.dimension as Dimension)
      if (context === undefined) continue
      const key = leverKeyOf({
        dimension: transition.dimension as Dimension,
        position: transition.position,
      })
      if (transition.kind === 'door') {
        Effect.runSync(context.chunkStore.setBlock(asBlockPosition(transition.position), transition.powered ? blockIdOf('door_open') : blockIdOf('door')))
      } else if (transition.kind === 'powered-rail') {
        if (transition.powered) poweredRails.add(key)
        else poweredRails.delete(key)
        canvas.setAttribute('data-powered-rail', `${key}:${String(transition.powered)}`)
      }
      markSessionDirty()
    }
  }

  // Portal stages can replace both dimension and pose. Stream and present
  // only after the frame so the renderer never meshes the destination pose
  // against the source dimension's store.
  Effect.runSync(
    streamAround(
      currentChunkContext(),
      postFramePose.feetPosition.x,
      postFramePose.feetPosition.z,
    ),
  )
  canvas.setAttribute(
    'data-player-feet',
    `${postFramePose.feetPosition.x.toFixed(2)},${postFramePose.feetPosition.y.toFixed(2)},${postFramePose.feetPosition.z.toFixed(2)}`,
  )
  canvas.setAttribute('data-player-grounded', String(groundedAfterFrame))

  const weatherAdvanced = Effect.runSync(Ref.get(gameplayState.weatherAdvanced))
  if (weatherAdvanced !== undefined) {
    Effect.runSync(weather.applyTransition(weatherAdvanced))
    presentWeather(weatherAdvanced)
    if (weatherAdvanced.weather !== weatherBeforeFrame.weather) markSessionDirty()
  }
  const localSleepPlayerId = String(multiplayer?.query.player ?? 'local')
  const connectedSurvivalPlayers = new Set<string>([
    localSleepPlayerId,
    ...[...(multiplayer?.players.keys() ?? [])].map(String),
  ])
  if (multiplayer === undefined && (deadAfterFrame || dimensionChanged)) {
    state.sleepRuntimeState.set(leaveSleep(state.sleepRuntimeState.get(), localSleepPlayerId))
  } else if (multiplayer !== undefined && (deadAfterFrame || dimensionChanged) && state.networkSleepState.get().sleepers.has(multiplayer.query.player)) {
    const command: SleepCommand = {
      _tag: 'LeaveSleep',
      actor: multiplayer.query.player,
      session: String(multiplayer.query.player),
      requestId: `sleep-${String(takeThenIncrement(state.nextSleepRequest))}`,
      expectedRevision: state.networkSleepState.get().revision,
      clientTick: Math.floor(performance.now()),
    }
    state.networkSleepState.set(queueSleepCommand(state.networkSleepState.get(), command))
    Effect.runFork(multiplayer.transport.sendSleep({ _tag: 'SleepCommand', command }))
  }
  if (multiplayer === undefined) state.sleepRuntimeState.set(reconcileSleepers(
    state.sleepRuntimeState.get(),
    connectedSurvivalPlayers,
    (location) => {
      const context = getOrCreateDimensionChunkContext(location.dimension)
      const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(location.bedPosition.x, location.bedPosition.y, location.bedPosition.z)))
      return reading._tag === 'Block' && blockTypeOfId(reading.block) === 'bed'
    },
  ))
  const sleepAdvance = multiplayer === undefined ? advanceSleep(
    state.sleepRuntimeState.get(),
    deltaSecs,
    connectedSurvivalPlayers.size,
    requiredSleepRatio,
    2,
  ) : {
    state: state.sleepRuntimeState.get(),
    skipToMorning: state.networkSleepState.get().skippedRevision === state.networkSleepState.get().revision
      && state.appliedNightSkipRevision.get() !== state.networkSleepState.get().revision,
  }
  state.sleepRuntimeState.set(sleepAdvance.state)
  const requiredSleepers = requiredSleeperCount(connectedSurvivalPlayers.size, requiredSleepRatio)
  sleepHud.textContent = `Sleeping ${String(state.sleepRuntimeState.get().sleepers.length)}/${String(requiredSleepers)}`
  sleepHud.hidden = state.sleepRuntimeState.get().sleepers.length === 0
  document.body.setAttribute('data-sleeping-players', String(state.sleepRuntimeState.get().sleepers.length))
  document.body.setAttribute('data-sleep-required', String(requiredSleepers))
  if (sleepAdvance.skipToMorning) {
    state.appliedNightSkipRevision.set(multiplayer === undefined ? null : state.networkSleepState.get().revision)
    if (multiplayer === undefined) {
      const clearWeather: WeatherState = { weather: 'clear', remainingSecs: 300 }
      Effect.runSync(time.setTimeOfDay(0.25))
      Effect.runSync(weather.applyTransition(clearWeather))
      presentWeather(clearWeather)
      markSessionDirty()
    }
    state.sleepRuntimeState.set(initialSleepRuntimeState())
    sleepHud.hidden = true
    document.body.setAttribute('data-sleep-result', 'morning-skipped')
  }
  presentWeatherRuntime(
    weatherAdvanced ?? Effect.runSync(weather.snapshot),
    postFramePose,
    nowSecs,
  )

  const itemUseResults = Effect.runSync(drainItemUseResults(gameplayState))
  for (const result of itemUseResults) {
    if ('action' in result && result.action === 'AdvanceFurnace') {
      const key = pendingFurnaceAdvances.get(result.requestId)
      pendingFurnaceAdvances.delete(result.requestId)
      const furnace = key === undefined ? undefined : furnaceStates.get(key)
      if (key !== undefined && furnace !== undefined) {
        const applied = advanceFurnaceRuntime(furnace.state, result.plan)
        if (applied.deferredSecs > 0) {
          deferredFurnaceAdvanceSecs.set(
            key,
            (deferredFurnaceAdvanceSecs.get(key) ?? 0) + applied.deferredSecs,
          )
        }
        if (applied.changed) {
          furnaceStates.set(key, { ...furnace, state: applied.state })
          markSessionDirty()
          if (h5aState.inventoryOpen.get() && inventoryMode() === 'furnace') renderPlayerUi()
        }
      }
      continue
    }
    state.lastObservedItemUse.set(result)
    const pending = pendingItemUses.get(result.requestId)
    pendingItemUses.delete(result.requestId)
    if (pending === undefined || !result.success) continue

    if (!('action' in result) && pending.kind === 'ignition' && pending.heldItem === result.heldItem) {
      if (
        result.outcome._tag === 'Portal'
        && result.outcome.outcome._tag === 'Lit'
        && result.outcome.outcome.cells.length === result.outcome.outcome.frame.interior.length
        && result.outcome.outcome.cells.length > 0
      ) {
        const anchor = [...result.outcome.outcome.cells].sort((left, right) =>
          left.y - right.y || left.x - right.x || left.z - right.z
        )[0]
        if (anchor !== undefined) {
          registerPortal({ dimension: pending.dimension, position: anchor })
        }
      }
      if (result.heldItem === 'fire_charge') {
        Effect.runSync(world.inventory.removeAt(pending.slotIndex, pending.heldItem, 1))
      } else if (Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]?.item === 'flint_and_steel') {
        Effect.runSync(world.inventory.damageAt({ _tag: 'Inventory', slotIndex: pending.slotIndex }, 1))
      }
    } else if ('action' in result) {
      switch (result.action) {
        case 'TillSoil':
          if (
            pending.kind === 'till'
            && pending.heldItem === result.heldItem
            && Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]?.item === result.heldItem
          ) {
            Effect.runSync(
              world.inventory.damageAt(
                { _tag: 'Inventory', slotIndex: pending.slotIndex },
                result.durabilityDamage,
              ),
            )
          }
          break
        case 'PlantPotato':
          if (pending.kind === 'plant' && result.outcome._tag === 'planted') {
            const planted = Effect.runSync(crops.plant({
              dimension: pending.dimension,
              position: result.outcome.at as CropLocation['position'],
            }))
            if (planted) {
              Effect.runSync(
                world.inventory.removeAt(pending.slotIndex, 'potato', result.consumedCount),
              )
            }
          }
          break
        case 'HarvestPotato':
          if (pending.kind === 'harvest' && result.outcome._tag === 'drops') {
            const at = {
              x: pending.position.x + 0.5,
              y: pending.position.y + 0.5,
              z: pending.position.z + 0.5,
            }
            const leftovers = result.outcome.drops.flatMap((drop) => {
              const leftover = Effect.runSync(world.inventory.add(drop.item, drop.count))
              return leftover > 0 ? [{ item: drop.item, count: leftover }] : []
            })
            if (leftovers.length > 0) {
              Effect.runSync(spawnDroppedItems(world.entities, leftovers.map((stack) => ({ ...stack, at }))))
            }
          }
          break
        case 'EatPotato':
          if (pending.kind === 'eat' && result.outcome._tag === 'consume') {
            if (multiplayer !== undefined) {
                  multiplayerClient.sendVitalsCommand({ _tag: 'eat', item: 'potato' })
              break
            }
            const removal = Effect.runSync(
              world.inventory.removeAt(pending.slotIndex, 'potato', result.consumedCount),
            )
            if (removal._tag === 'Removed') {
              survivalHunger.eat(
                result.outcome.foodPoints,
                result.outcome.saturationModifier,
              )
            }
          }
          break
      }
    }
    markSessionDirty()
  }

  const mobDrops = multiplayer === undefined
    ? Effect.runSync(drainMobDrops(gameplayState))
    : []
  if (mobDrops.length > 0) {
    Effect.runSync(spawnMobDrops(world.entities, mobDrops))
    markSessionDirty()
  }
  for (const drop of mobDrops) {
    increment(state.nextMobDropId)
    observedMobDrops.push({ ...drop, renderId: `mob-drop-${state.nextMobDropId.get()}` })
  }
  const mobExperience = multiplayer === undefined
    ? Effect.runSync(drainMobExperience(gameplayState))
    : []
  for (const event of mobExperience) {
    const currentVitals = Effect.runSync(world.vitals.snapshot)
    Effect.runSync(world.vitals.restore(addVitalsExperience(currentVitals, event.amount)))
  }
  if (mobExperience.length > 0 || (multiplayer === undefined && playerHeals.length > 0)) markSessionDirty()

  const dragonEvents = multiplayer === undefined
    ? Effect.runSync(gameplayState.enderDragonEncounter.drainEvents)
    : []
  for (const event of dragonEvents) {
    switch (event._tag) {
      case 'PlayerDamaged': {
        if (dimensionAfterFrame !== 'end') break
        const dragon = endDragonPosition()
        const player = Effect.runSync(playerApi.pose).feetPosition
        if (Math.hypot(dragon.x - player.x, dragon.y - player.y, dragon.z - player.z) <= 6) {
          applyPlayerDamage({ amount: event.amount, cause: 'generic' })
          queueEndAudio('playerHit', player)
        }
        break
      }
      case 'ExperienceRewarded': {
        const currentVitals = Effect.runSync(world.vitals.snapshot)
        Effect.runSync(world.vitals.restore(addVitalsExperience(currentVitals, event.amount)))
        queueEndAudio('dragonReward', endDragonPosition())
        break
      }
      case 'DragonEggRewarded':
        if (!state.dragonEggRewarded.get()) {
          Effect.runSync(spawnDroppedItems(world.entities, [{
            item: event.item,
            count: event.count,
            at: endDragonPosition(),
          }]))
          state.dragonEggRewarded.set(true)
        }
        break
      case 'ExitPortalMaterializationRequested':
        if (!state.exitPortalMaterialized.get()) {
          const portalY = 64
          for (let x = -1; x <= 1; x += 1) {
            for (let z = -1; z <= 1; z += 1) {
              Effect.runSync(currentChunkStore.setBlock(blockPosition(x, portalY, z), END_PORTAL_BLOCK.PORTAL))
            }
          }
          state.exitPortalMaterialized.set(true)
          queueEndAudio('exitPortal', { x: 0, y: portalY, z: 0 })
        }
        break
      case 'DragonDamagedByPlayer':
        queueEndAudio('dragonHurt', endDragonPosition())
        break
    }
  }
  if (dragonEvents.length > 0) markSessionDirty()
  const dragonSnapshot = endDragonSnapshot()
  canvas.setAttribute('data-end-dragon-phase', dragonSnapshot.phase)
  canvas.setAttribute('data-end-dragon-health', String(dragonSnapshot.health))
  endAudio.update({
    dimension: dimensionAfterFrame,
    phase: dragonSnapshot.phase === 'dead' ? 'defeated' : 'active',
    nowSecs,
    listener: postFramePose.feetPosition,
    listenerForward: adapters.getReadAudioListenerForward(),
    events: adapters.drainEndAudioEvents(),
  })

  syncRenderedEntities()
  if (h5aState.brewingOpen.get()) renderBrewingUi()
  renderPlayerUi()
  renderCrosshair(nowSecs)
  const captions = playerSettings().captionsEnabled ? audio.visible(KernelMonotonicTimeSecs(nowSecs)) : []
  const nextCaptionSignature = captionRenderSignature(captions)
  if (nextCaptionSignature !== state.renderedCaptionSignature.get()) {
    captionsParent.replaceChildren(...captions.map((caption) => {
      const row = document.createElement('div')
      row.className = 'sound-caption'
      row.dataset['cueId'] = caption.cueId
      row.setAttribute('data-testid', 'sound-caption')
      row.textContent = caption.text
      return row
    }))
    state.renderedCaptionSignature.set(nextCaptionSignature)
  }

  state.framesTotal.set(state.framesTotal.get() + 1)
  fpsValue.textContent = String(Math.round(Effect.runSync(Ref.get(uiFrameState.fpsCounter)).fps))

  // Readable by a test without a QA command: the frame count IS the claim
  // that the loop is running, and docs/e2e-triage.md #4 is exactly that claim.
  document.body.setAttribute('data-frames', String(state.framesTotal.get()))
}
