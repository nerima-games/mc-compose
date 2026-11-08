import { WorldId } from '@nerima-games/mx-multiplayer'
import { Effect, Option, Ref } from 'effect'
import { blockIdOf } from '@nerima-games/mc-kernel'
import { PLAYER_HALF_HEIGHT, PLAYER_HALF_WIDTH } from '@nerima-games/mc-physics'
import { changed, type ItemStack, UNCHANGED } from '@nerima-games/mc-sim'
import { DEFAULT_BLOCK_REACH, INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE, enchantmentLevel, resolveEnvironmentalContactDamage } from '@nerima-games/mx-gameplay'

import { POTATO_CROP_BLOCK_ID } from '../qa-fixtures'
import { initialFootstepRuntimeState } from '../footstep-runtime'
import type { H5bPostFrameContext, H5bPostFrameInput, H5bPostFrameResult } from './h5b-context'

type LegacyGameplayItemType = Exclude<ItemStack['item'], 'arrow' | 'bow'>

export const runTickPostFrame = (
  context: H5bPostFrameContext,
  input: H5bPostFrameInput,
): H5bPostFrameResult => {
  const { frame, movement, framesTotal } = input
  const h5a = context.h5a
  const h5aState = h5a.state
  const state = context.state
  const {
    multiplayerEntities,
    dimensionContexts,
    pendingBlockBreakConfirmations,
    pendingMiningToolDamage,
    customNames,
    enchantedItems,
    containerMetadataKey,
    deleteContainerMetadata,
    containerIdAt,
    furnaceKeyOf,
    isDroppedItemPickupEligible,
    droppedItemMetadataFromBehaviour,
    maxStackCountForItem,
    itemStack,
    observeBlockBreakCompletion,
    recordBlockBreakRequest,
    drainVillagerTradeResults,
    drainPlayerDamages,
    drainPlayerHeals,
    villagerTradeStatus,
    renderPlayerUi,
    renderTradeUi,
    enqueueMultiplayerPlayerMove,
    sendEntityCommand,
    applyPortalTravels,
    applyPlayerDamage,
    settleMeleeAttackResults,
    alignActiveDimension,
    resetSimState: resetSimStateAction,
    resolveFallDamage,
    isStandingOnCell,
    pressurePlateOccupancy,
    environmentalContactsForPose,
    isGameplayBlockSolid,
    applyWorldExplosion,
    resetBowUse: resetBowUseAction,
    projectileHud,
    projectedInventoryEnchantedItem,
    durabilityWearWithEnchantments,
    endDragonPosition,
    inventoryMeleeDamage,
    requestIdFor,
    canFireBow,
    bowCharge,
    bowDamage,
    bowDamageWithEnchantments,
    advanceFootstepRuntime,
    surfaceForBlockType,
    audio,
    advanceWitherRuntime,
    damageRuntimeWither,
    advanceProjectileRuntime,
    initialProjectileRuntimeState,
    launchRuntimeProjectile,
    recoverProjectile,
    advanceEyeOfEnderRuntime,
    initialEyeOfEnderRuntimeState,
    advanceBowUse,
    resolveBowHits,
    resolveTargetedPrimaryAttack,
    advanceMiningProgress,
    isLegacyGameplayItemType,
    projectEnchantedItem,
    miningLootContextForItem,
    requestMeleeAttack,
    requestBlockBreak,
    requestPotatoHarvest,
    isSwordItem,
    pendingMeleeAttacks,
    crops,
    pendingItemUses,
    spawnDroppedItems,
  } = context
  const {
    world,
    playerApi,
    simState,
    currentChunkContext: getCurrentChunkContext,
    currentChunkStore,
    blockPosition,
    blockTypeOfId,
    gameplayState,
    multiplayer,
    furnaceStates,
    isCreativeMode,
    survivalHunger,
    playerIsDead,
    setInventoryOpen,
    markSessionDirty,
    syncTouchControls,
    droppedItemMetadata,
    droppedItemMetadataKey,
    isDroppedItemBehaviour,
    canvas,
    resetPrimaryAttackGesture: resetPrimaryAttackGestureAction,
  } = h5a
  const { sendVitalsCommand } = context
  const readInventoryMode = context.inventoryMode
  const EYE_LEVEL_OFFSET = h5a.eyeLevelOffset
  const witherRevision = context.witherRevision()
  const enderDragonRevision = context.enderDragonRevision()
  const activeVillagerId = context.activeVillagerId()

  let blockBreakCounters = state.blockBreakCounters.get()
  let environmentalContactDamageState = state.environmentalContactDamageState.get()
  let witherRuntimeState = state.witherRuntimeState.get()
  let projectileRuntimeState = state.projectileRuntimeState.get()
  let eyeOfEnderRuntimeState = state.eyeOfEnderRuntimeState.get()
  let bowUseState = state.bowUseState.get()
  let footstepRuntimeState = state.footstepRuntimeState.get()
  let nextWitherCommand = state.nextWitherCommand.get()
  let nextEnderDragonCommand = state.nextEnderDragonCommand.get()
  let nextMeleeAttackRequestId = state.nextMeleeAttackRequestId.get()
  let miningProgress = state.miningProgress.get()
  let primaryAttackGestureConsumed = state.primaryAttackGestureConsumed.get()
  let activeChestId = state.activeChestId.get()
  let activeFurnaceKey = state.activeFurnaceKey.get()
  let tradeStatus = state.tradeStatus.get()
  const resetPrimaryAttackGesture = (): void => {
    try {
      resetPrimaryAttackGestureAction()
    } finally {
      miningProgress = state.miningProgress.get()
      primaryAttackGestureConsumed = state.primaryAttackGestureConsumed.get()
    }
  }
  const resetBowUse = (): void => {
    try {
      resetBowUseAction()
    } finally {
      bowUseState = state.bowUseState.get()
    }
  }
  const resetSimState = (physicsEnabled: boolean): void => {
    try {
      resetSimStateAction(physicsEnabled)
    } finally {
      environmentalContactDamageState = state.environmentalContactDamageState.get()
      bowUseState = state.bowUseState.get()
    }
  }

  try {
      const {
        raw,
        nowSecs,
        deltaSecs,
        dead,
        held,
        attackTriggered,
        attackHeld,
        useTriggered,
        useHeld,
        looked,
      } = frame
      let deadAfterFrame = dead
      const {
        poseBeforeFrame,
        groundedBeforeFrame,
        dimensionBeforeFrame,
        sprinting,
      } = movement

      const playerPosition = Effect.runSync(playerApi.pose).feetPosition
      const playerDimension = Effect.runSync(playerApi.dimension)
      if (multiplayer !== undefined) {
        for (const entity of multiplayerEntities.values()) {
          if (entity._tag !== 'item-drop') continue
          const dx = entity.at.x - playerPosition.x
          const dy = entity.at.y - playerPosition.y
          const dz = entity.at.z - playerPosition.z
          if (dx * dx + dy * dy + dz * dz > 1.5 * 1.5) continue
          sendEntityCommand({ _tag: 'EntityPickupCommand', entityId: entity.entityId })
        }
      } else for (const entity of Effect.runSync(world.entities.entities)) {
        if (deadAfterFrame) break
        if (!isDroppedItemBehaviour(entity.behaviour)) continue
        if (!isDroppedItemPickupEligible(framesTotal, entity.behaviour.eligibleFromFrame)) continue
        const metadataKey = droppedItemMetadataKey(playerDimension, String(entity.id))
        const metadata = droppedItemMetadata.get(metadataKey)
          ?? droppedItemMetadataFromBehaviour(entity.behaviour)
        const dx = entity.feetPosition.x - playerPosition.x
        const dy = entity.feetPosition.y - playerPosition.y
        const dz = entity.feetPosition.z - playerPosition.z
        if (dx * dx + dy * dy + dz * dz > 1.5 * 1.5) continue

        const storage = Effect.runSync(world.inventory.storageSnapshot)
        const slots = [...storage.inventory.slots]
        const durability = [...storage.inventoryDurability]
        const destinations: number[] = []
        const behaviour = entity.behaviour
        if (behaviour === undefined) continue
        const maxCount = maxStackCountForItem(behaviour.item)
        let remaining = behaviour.count
        const sameDurability = (slot: number): boolean =>
          JSON.stringify(durability[slot] ?? null)
            === JSON.stringify(behaviour.durability ?? null)
        const metadataMatches = (slot: number): boolean => {
          const key = String(slot)
          return customNames.get(key) === metadata.customName
            && JSON.stringify(enchantedItems.get(key) ?? null)
              === JSON.stringify(metadata.enchantedItem ?? null)
        }

        for (let slot = 0; slot < slots.length && remaining > 0; slot += 1) {
          const current = slots[slot]
          if (current === undefined || current.item !== behaviour.item
            || current.count >= maxCount || !sameDurability(slot) || !metadataMatches(slot)) continue
          const accepted = Math.min(maxCount - current.count, remaining)
          slots[slot] = itemStack(current.item, current.count + accepted)
          destinations.push(slot)
          remaining -= accepted
        }
        for (let slot = 0; slot < slots.length && remaining > 0; slot += 1) {
          if (slots[slot] !== undefined) continue
          const accepted = Math.min(maxCount, remaining)
          slots[slot] = itemStack(entity.behaviour.item, accepted)
          durability[slot] = behaviour.durability ?? null
          destinations.push(slot)
          remaining -= accepted
        }
        if (remaining === entity.behaviour.count) continue

        Effect.runSync(world.inventory.restoreStorage({
          ...storage,
          inventory: { slots },
          inventoryDurability: durability,
        }))
        for (const slot of destinations) {
          const key = String(slot)
          if (metadata.customName === undefined) customNames.delete(key)
          else customNames.set(key, metadata.customName)
          if (metadata.enchantedItem === undefined) enchantedItems.delete(key)
          else enchantedItems.set(key, metadata.enchantedItem)
        }
        if (remaining === 0) {
          Effect.runSync(world.entities.despawn(entity.id))
          droppedItemMetadata.delete(metadataKey)
        } else {
          Effect.runSync(world.entities.sweep((candidate) => ({
            transition: candidate.id === entity.id && isDroppedItemBehaviour(candidate.behaviour)
              ? changed({
                  feetPosition: candidate.feetPosition,
                  healthPoints: candidate.healthPoints,
                  behaviour: { ...candidate.behaviour, count: remaining },
                })
              : UNCHANGED,
            emit: undefined,
          })))
        }
        markSessionDirty()
        renderPlayerUi()
      }

      const villagerTradeResults = multiplayer === undefined || !h5aState.multiplayerHandshakeComplete.get()
        ? Effect.runSync(drainVillagerTradeResults(gameplayState))
        : []
      for (const result of villagerTradeResults) {
        if (result.villagerId !== activeVillagerId) continue
        tradeStatus = villagerTradeStatus(result)
        state.tradeStatus.set(tradeStatus)
        if (result._tag === 'Traded') markSessionDirty()
      }
      if (villagerTradeResults.length > 0) renderTradeUi()

      if (multiplayer !== undefined) {
        enqueueMultiplayerPlayerMove(nowSecs)
      }

      // Portal travel has already updated the player. Make its destination world
      // concrete before dimension alignment streams or renders that world.
      if (multiplayer === undefined) Effect.runSync(applyPortalTravels())

      for (const pending of pendingBlockBreakConfirmations.splice(0)) {
        const context = dimensionContexts.get(pending.dimension)
        if (context === undefined) continue
        const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(pending.position.x, pending.position.y, pending.position.z)))
        const nextBlockBreakCounters = observeBlockBreakCompletion(
          blockBreakCounters,
          pending.blockId,
          reading._tag === 'Block' ? reading.block : undefined,
        )
        if (nextBlockBreakCounters === blockBreakCounters) continue
        blockBreakCounters = nextBlockBreakCounters
        canvas.setAttribute('data-breaks-completed', String(blockBreakCounters.completed))
        if (
          pending.blockId === blockIdOf('chest') ||
          pending.blockId === blockIdOf('shulker_box') ||
          pending.blockId === blockIdOf('dispenser') ||
          pending.blockId === blockIdOf('dropper') ||
          pending.blockId === blockIdOf('hopper')
        ) {
          const id = containerIdAt(pending.dimension, pending.position)
          const container = Effect.runSync(world.inventory.containerStorageSnapshot).containers
            .find((candidate) => candidate.id === id)
          const slotMetadata = container?.slots.flatMap((stack, slot) => stack === null
            ? []
            : [{
                customName: customNames.get(containerMetadataKey(id, slot)),
                enchantedItem: enchantedItems.get(containerMetadataKey(id, slot)),
              }]) ?? []
          const drained = Effect.runSync(world.inventory.drainContainer(id))
          if (drained._tag === 'Drained') {
            const at = {
              x: pending.position.x + 0.5,
              y: pending.position.y + 0.5,
              z: pending.position.z + 0.5,
            }
            if (drained.items.length > 0) {
              const dropped = Effect.runSync(spawnDroppedItems(
                world.entities,
                drained.items.map((stack, index) => ({
                  ...stack,
                  at,
                  ...(slotMetadata[index]?.customName === undefined
                      && slotMetadata[index]?.enchantedItem === undefined
                    ? {}
                    : { eligibleFromFrame: framesTotal + 1 }),
                })),
              ))
              dropped.forEach((entity, index) => {
                const metadata = slotMetadata[index]
                if (metadata?.customName === undefined && metadata?.enchantedItem === undefined) return
                droppedItemMetadata.set(
                  droppedItemMetadataKey(pending.dimension, String(entity.id)),
                  {
                    ...(metadata.customName === undefined ? {} : { customName: metadata.customName }),
                    ...(metadata.enchantedItem === undefined
                      ? {}
                      : { enchantedItem: metadata.enchantedItem }),
                  },
                )
              })
            }
            deleteContainerMetadata(id)
            markSessionDirty()
          }
          if (activeChestId === id && h5aState.inventoryOpen.get() && readInventoryMode() === 'chest') {
            activeChestId = undefined
            state.activeChestId.set(activeChestId)
            setInventoryOpen(false)
          }
          continue
        }
        if (pending.blockId !== 104) continue
        const key = furnaceKeyOf(pending)
        const furnace = furnaceStates.get(key)
        if (furnace !== undefined) {
          const at = {
            x: pending.position.x + 0.5,
            y: pending.position.y + 0.5,
            z: pending.position.z + 0.5,
          }
          const contents = [furnace.state.input, furnace.state.fuel, furnace.state.output]
            .filter(
              (stack): stack is ItemStack & { readonly item: LegacyGameplayItemType } =>
                stack !== null && isLegacyGameplayItemType(stack.item),
            )
            .map((stack) => ({ ...stack, at }))
          if (contents.length > 0) {
            Effect.runSync(spawnDroppedItems(world.entities, contents))
          }
          furnaceStates.delete(key)
          markSessionDirty()
        }
        if (activeFurnaceKey === key && h5aState.inventoryOpen.get() && readInventoryMode() === 'furnace') {
          activeFurnaceKey = undefined
          state.activeFurnaceKey.set(activeFurnaceKey)
          setInventoryOpen(false)
        }
      }

      for (const pending of pendingMiningToolDamage.splice(0)) {
        const context = dimensionContexts.get(pending.dimension)
        if (context === undefined) continue
        const reading = Effect.runSync(context.chunkStore.getBlock(blockPosition(pending.position.x, pending.position.y, pending.position.z)))
        if (reading._tag !== 'Block' || reading.block === pending.blockId) continue

        const selected = Effect.runSync(world.inventory.snapshot).slots[pending.slotIndex]
        if (selected?.item !== pending.item) continue

        const enchantedItem = projectedInventoryEnchantedItem(pending.slotIndex)
        const appliedWear = enchantedItem === null
          ? 1
          : durabilityWearWithEnchantments(1, enchantedItem, [Math.random()])
        if (appliedWear === 0) continue
        const damageResult = Effect.runSync(
          world.inventory.damageAt(
            { _tag: 'Inventory', slotIndex: pending.slotIndex },
            appliedWear,
          ),
        )
        if (damageResult._tag === 'Broken') {
          enchantedItems.delete(String(pending.slotIndex))
          customNames.delete(String(pending.slotIndex))
        }
        if (damageResult._tag === 'Damaged' || damageResult._tag === 'Broken') {
          markSessionDirty()
        }
      }

      const playerDamages = Effect.runSync(drainPlayerDamages(gameplayState))
      for (const event of playerDamages) {
        applyPlayerDamage(
          event.damage,
          event._tag === 'StatusEffect' ? event.minimumHealthPoints : 0,
        )
      }
      const playerHeals = Effect.runSync(drainPlayerHeals(gameplayState))
      if (multiplayer === undefined) {
        for (const event of playerHeals) {
          const vitals = Effect.runSync(world.vitals.view)
          const allowed = Math.max(
            0,
            Math.min(event.maximumHealthPoints, vitals.maxHealthPoints) - vitals.healthPoints,
          )
          if (allowed > 0) Effect.runSync(world.vitals.heal(Math.min(event.amount, allowed)))
        }
      }
      if (multiplayer === undefined && playerDamages.length > 0) {
        markSessionDirty()
        if (playerIsDead()) {
          setInventoryOpen(false)
          if (document.pointerLockElement === canvas) document.exitPointerLock()
        }
      }
      deadAfterFrame = playerIsDead()

      // A portal may change dimension in the same frame that gameplay confirms a
      // attack. Settle confirmations before dimension reset clears the outboxes.
      settleMeleeAttackResults()

      let postFramePose = Effect.runSync(playerApi.pose)
      let dimensionAfterFrame = Effect.runSync(playerApi.dimension)
      if (
        dead &&
        (dimensionAfterFrame !== dimensionBeforeFrame ||
          postFramePose.feetPosition.x !== poseBeforeFrame.feetPosition.x ||
          postFramePose.feetPosition.y !== poseBeforeFrame.feetPosition.y ||
          postFramePose.feetPosition.z !== poseBeforeFrame.feetPosition.z)
      ) {
        Effect.runSync(playerApi.restore(poseBeforeFrame, dimensionBeforeFrame))
        postFramePose = poseBeforeFrame
        dimensionAfterFrame = dimensionBeforeFrame
      }

      const dimensionChanged =
        dimensionAfterFrame !== dimensionBeforeFrame ||
        dimensionAfterFrame !== getCurrentChunkContext().dimension
      if (dimensionChanged) {
        resetPrimaryAttackGesture()
        resetBowUse()
        alignActiveDimension(dimensionAfterFrame)
        resetSimState(!deadAfterFrame)
        markSessionDirty()
      }

      const landingImpact = Effect.runSync(Ref.get(simState.landingImpact))
      if (!deadAfterFrame && !dimensionChanged && Option.isSome(landingImpact)) {
        const fallDamage = resolveFallDamage(landingImpact.value.fallDistance)
        if (fallDamage !== undefined) {
          applyPlayerDamage(fallDamage)
          markSessionDirty()
          if (playerIsDead()) {
            setInventoryOpen(false)
            if (document.pointerLockElement === canvas) document.exitPointerLock()
          }
        }
      }
      deadAfterFrame = playerIsDead()

      // Plate occupancy is entity/AABB work this host owns (mx-redstone does
      // not — see pressurePlateOccupancy's declaration), so it is computed
      // from the resolved post-movement pose, same as environmental contact
      // just below. Only an occupancy CHANGE dirties the redstone snapshot;
      // syncRedstoneSnapshot itself does not run every frame, so re-detecting
      // "still standing here" every tick would set redstoneDirty forever.
      if (!deadAfterFrame && !dimensionChanged && multiplayer === undefined) {
        for (const [key, plate] of pressurePlateOccupancy) {
          if (plate.dimension !== dimensionAfterFrame) continue
          const occupied = isStandingOnCell(
            postFramePose.feetPosition,
            plate.position.x,
            plate.position.y,
            plate.position.z,
          )
          if (occupied !== plate.occupied) {
            pressurePlateOccupancy.set(key, { ...plate, occupied })
            h5aState.redstoneDirty.set(true)
          }
        }
      }

      // Landing damage resolves before block contact in the same frame.
      if (!deadAfterFrame && !dimensionChanged && multiplayer === undefined) {
        const environmentalDamage = resolveEnvironmentalContactDamage(
          environmentalContactDamageState,
          environmentalContactsForPose(postFramePose),
          h5aState.simulationElapsedSecs.get(),
        )
        environmentalContactDamageState = environmentalDamage.state
        for (const damage of environmentalDamage.damages) applyPlayerDamage(damage)
        if (environmentalDamage.damages.length > 0) {
          markSessionDirty()
          if (playerIsDead()) {
            setInventoryOpen(false)
            if (document.pointerLockElement === canvas) document.exitPointerLock()
          }
        }
      } else if (deadAfterFrame) {
        environmentalContactDamageState = INITIAL_ENVIRONMENTAL_CONTACT_DAMAGE_STATE
      }
      deadAfterFrame = playerIsDead()
      syncTouchControls()

      if (!deadAfterFrame && !dimensionChanged) {
        const advancedWither = advanceWitherRuntime(
          witherRuntimeState,
          dimensionAfterFrame,
          postFramePose.feetPosition,
          Math.min(deltaSecs, 0.1),
          (_skull, position) => isGameplayBlockSolid({
            x: Math.floor(position.x),
            y: Math.floor(position.y),
            z: Math.floor(position.z),
          }),
        )
        witherRuntimeState = advancedWither.state
        if (advancedWither.meleeDamage > 0) {
          applyPlayerDamage({ amount: advancedWither.meleeDamage, cause: 'generic' })
        }
        for (const explosion of advancedWither.explosions) {
          applyWorldExplosion(
            explosion.position,
            explosion.power,
            Math.floor(h5aState.simulationElapsedSecs.get() * 20),
            explosion.destroysResistantBlocks,
          )
        }
        if (advancedWither.explosions.length > 0 || advancedWither.meleeDamage > 0) markSessionDirty()
      }

      if (deadAfterFrame) {
        projectileRuntimeState = initialProjectileRuntimeState()
        eyeOfEnderRuntimeState = initialEyeOfEnderRuntimeState()
      } else if (!dimensionChanged && multiplayer === undefined) {
        const projectileEntities = Effect.runSync(world.entities.entities)
        const projectileWorld = {
          blockBounds: (
            start: Readonly<{ x: number; y: number; z: number }>,
            end: Readonly<{ x: number; y: number; z: number }>,
          ) => {
            const bounds = []
            for (let x = Math.floor(Math.min(start.x, end.x)); x <= Math.floor(Math.max(start.x, end.x)); x += 1) {
              for (let y = Math.floor(Math.min(start.y, end.y)); y <= Math.floor(Math.max(start.y, end.y)); y += 1) {
                for (let z = Math.floor(Math.min(start.z, end.z)); z <= Math.floor(Math.max(start.z, end.z)); z += 1) {
                  if (isGameplayBlockSolid({ x, y, z })) {
                    bounds.push({ minX: x, minY: y, minZ: z, maxX: x + 1, maxY: y + 1, maxZ: z + 1 })
                  }
                }
              }
            }
            return bounds
          },
          entities: [
            ...projectileEntities
              .filter(({ kind }) => kind !== 'dropped_item')
              .map((entity) => ({
                id: String(entity.id),
                bounds: {
                  minX: entity.feetPosition.x - 0.3,
                  minY: entity.feetPosition.y,
                  minZ: entity.feetPosition.z - 0.3,
                  maxX: entity.feetPosition.x + 0.3,
                  maxY: entity.feetPosition.y + 1.8,
                  maxZ: entity.feetPosition.z + 0.3,
                },
              })),
            ...witherRuntimeState.withers
              .filter((wither) => wither.dimension === dimensionAfterFrame)
              .map((wither) => ({
                id: wither.id,
                bounds: {
                  minX: wither.state.feetPosition.x - 0.75,
                  minY: wither.state.feetPosition.y,
                  minZ: wither.state.feetPosition.z - 0.75,
                  maxX: wither.state.feetPosition.x + 0.75,
                  maxY: wither.state.feetPosition.y + 3.5,
                  maxZ: wither.state.feetPosition.z + 0.75,
                },
              })),
            {
              id: 'player',
              bounds: {
                minX: postFramePose.feetPosition.x - PLAYER_HALF_WIDTH,
                minY: postFramePose.feetPosition.y,
                minZ: postFramePose.feetPosition.z - PLAYER_HALF_WIDTH,
                maxX: postFramePose.feetPosition.x + PLAYER_HALF_WIDTH,
                maxY: postFramePose.feetPosition.y + PLAYER_HALF_HEIGHT * 2,
                maxZ: postFramePose.feetPosition.z + PLAYER_HALF_WIDTH,
              },
            },
          ],
          isInWater: (position: Readonly<{ x: number; y: number; z: number }>) => {
            const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(
              Math.floor(position.x),
              Math.floor(position.y),
              Math.floor(position.z),
            )))
            return reading._tag === 'Block' && blockTypeOfId(reading.block) === 'water'
          },
          bounds: {
            minX: -30_000_000,
            minY: -64,
            minZ: -30_000_000,
            maxX: 30_000_000,
            maxY: 320,
            maxZ: 30_000_000,
          },
        }
        const advancedProjectiles = advanceProjectileRuntime(
          projectileRuntimeState,
          projectileWorld,
          dimensionAfterFrame,
          Math.min(deltaSecs, 0.1),
        )
        projectileRuntimeState = advancedProjectiles.state
        for (const impact of advancedProjectiles.impacts) {
          if (impact.hit.kind !== 'entity' || impact.hit.entityId === 'player') continue
          const entityId = impact.hit.entityId
          const hitWither = witherRuntimeState.withers.find(({ id }) => id === entityId)
          if (hitWither !== undefined) {
            const result = damageRuntimeWither(witherRuntimeState, hitWither.id, impact.damage, 'ranged')
            witherRuntimeState = result.state
            if (result.death !== undefined) {
              Effect.runSync(spawnDroppedItems(world.entities, [{
                item: result.death.drop.item,
                count: result.death.drop.count,
                at: result.death.drop.position,
              }]))
            }
            markSessionDirty()
            continue
          }
          const target = projectileEntities.find(({ id }) => String(id) === entityId)
          if (target === undefined) continue
          Effect.runSync(resolveBowHits(world.entities, [{ id: target.id, damage: impact.damage }]))
          const horizontalSpeed = Math.hypot(impact.velocity.x, impact.velocity.z)
          if (horizontalSpeed > 0 && impact.knockback > 0) {
            Effect.runSync(world.entities.sweep((entity) => ({
              transition: entity.id === target.id
                ? changed({
                  feetPosition: {
                    x: entity.feetPosition.x + impact.velocity.x / horizontalSpeed * impact.knockback,
                    y: entity.feetPosition.y,
                    z: entity.feetPosition.z + impact.velocity.z / horizontalSpeed * impact.knockback,
                  },
                  healthPoints: entity.healthPoints,
                  behaviour: entity.behaviour,
                })
                : UNCHANGED,
              emit: undefined,
            })))
          }
          markSessionDirty()
        }
        const recovery = recoverProjectile(
          projectileRuntimeState,
          dimensionAfterFrame,
          postFramePose.feetPosition,
          1.5,
        )
        if (recovery.recovered !== null) {
          const leftover = Effect.runSync(world.inventory.add('arrow', 1))
          if (leftover === 0) {
            projectileRuntimeState = recovery.state
            markSessionDirty()
          }
        }
      }
      if (!deadAfterFrame && !dimensionChanged) {
        const advancedEyes = advanceEyeOfEnderRuntime(
          eyeOfEnderRuntimeState,
          dimensionAfterFrame,
          Math.min(deltaSecs, 0.1),
        )
        eyeOfEnderRuntimeState = advancedEyes.state
        for (const settlement of advancedEyes.settlements) {
          if (!settlement.breaks && multiplayer === undefined) {
            Effect.runSync(spawnDroppedItems(world.entities, [{
              item: 'eye_of_ender',
              count: 1,
              at: settlement.position,
            }]))
          }
          markSessionDirty()
        }
      }
      const activeProjectileCount = projectileRuntimeState.projectiles
        .filter(({ dimension }) => dimension === dimensionAfterFrame)
        .length
      projectileHud.textContent = `Arrows ${String(activeProjectileCount)}`
      projectileHud.hidden = activeProjectileCount === 0

      const bowInventory = Effect.runSync(world.inventory.snapshot)
      const selectedBowItem = bowInventory.slots[h5aState.selectedHotbarIndex.get()]?.item ?? null
      // `raw`, NOT `deltaSecs` — bow charge is how long a player held a button,
      // a wall-clock fact, not a physics integration step. `deltaSecs` clamps
      // to MAX_FRAME_SECS to keep a backgrounded tab from taking one giant
      // physics step, which is correct for physics but would make sustained
      // slow frames undercount real hold duration and silently drop the shot.
      // Do not fold this back into `deltaSecs` to "simplify" it.
      const bowAdvance = advanceBowUse({
        state: bowUseState,
        useTriggered,
        useHeld,
        cancelled: deadAfterFrame || dimensionChanged || h5aState.inventoryOpen.get(),
        selectedItem: selectedBowItem,
        selectedSlotIndex: h5aState.selectedHotbarIndex.get(),
        arrowCount: bowInventory.slots.reduce(
          (count, slot) => count + (slot?.item === 'arrow' ? slot.count : 0),
          0,
        ),
        elapsedSecs: raw,
      })
      const previousBowUseState = bowUseState
      bowUseState = bowAdvance.state
      if (multiplayer !== undefined) {
        if (previousBowUseState._tag === 'Idle' && (bowUseState._tag === 'Drawing' || bowAdvance.release !== null)) {
          sendEntityCommand({ _tag: 'BowUseCommand', action: 'start' })
        }
        if (bowAdvance.release !== null) sendEntityCommand({ _tag: 'BowUseCommand', action: 'release' })
      }
      if (
        multiplayer === undefined &&
        bowAdvance.release !== null &&
        canFireBow(bowAdvance.release.chargeSecs) &&
        bowInventory.slots[bowAdvance.release.bowSlotIndex]?.item === 'bow'
      ) {
        const enchantedBow = projectedInventoryEnchantedItem(bowAdvance.release.bowSlotIndex)
        const appliedWear = enchantedBow === null
          ? 1
          : durabilityWearWithEnchantments(1, enchantedBow, [Math.random()])
        const settlement = appliedWear === 0
          ? (() => {
              const arrowSlotIndex = bowInventory.slots.findIndex((slot) => slot?.item === 'arrow')
              if (arrowSlotIndex < 0) return { _tag: 'MissingConsumable' } as const
              const result = Effect.runSync(world.inventory.removeAt(arrowSlotIndex, 'arrow', 1))
              return result._tag === 'Removed'
                ? { _tag: 'Applied' } as const
                : { _tag: 'MissingConsumable' } as const
            })()
          : Effect.runSync(world.inventory.consumeAndDamageAt({
              consume: { item: 'arrow', count: 1 },
              damage: {
                location: { _tag: 'Inventory', slotIndex: bowAdvance.release.bowSlotIndex },
                expectedItem: 'bow',
                amount: appliedWear,
              },
            }))
        if (settlement._tag === 'Applied') {
          const damage = 'damage' in settlement ? settlement.damage : undefined
          if (
            damage !== undefined &&
            typeof damage === 'object' &&
            damage !== null &&
            '_tag' in damage &&
            damage._tag === 'Broken'
          ) {
            enchantedItems.delete(String(bowAdvance.release.bowSlotIndex))
            customNames.delete(String(bowAdvance.release.bowSlotIndex))
          }
          const charge = bowCharge(bowAdvance.release.chargeSecs)
          const baseDamage = bowDamage(charge)
          projectileRuntimeState = launchRuntimeProjectile(projectileRuntimeState, {
            dimension: dimensionAfterFrame,
            position: {
              x: postFramePose.feetPosition.x,
              y: postFramePose.feetPosition.y + EYE_LEVEL_OFFSET,
              z: postFramePose.feetPosition.z,
            },
            yawRadians: postFramePose.yawRadians,
            pitchRadians: -postFramePose.pitchRadians,
            speed: 8 + 24 * charge,
            damage: enchantedBow === null
              ? baseDamage
              : bowDamageWithEnchantments(baseDamage, enchantedBow),
            knockback: 0.35 + 0.65 * charge,
            shooterId: 'player',
          })
          markSessionDirty()
        }
      }

      const groundedAfterFrame = Effect.runSync(Ref.get(simState.isGrounded))
      const moved =
        dimensionChanged ||
        postFramePose.feetPosition.x !== poseBeforeFrame.feetPosition.x ||
        postFramePose.feetPosition.y !== poseBeforeFrame.feetPosition.y ||
        postFramePose.feetPosition.z !== poseBeforeFrame.feetPosition.z
      if (!deadAfterFrame && !dimensionChanged) {
        const horizontalDistance = Math.hypot(
          postFramePose.feetPosition.x - poseBeforeFrame.feetPosition.x,
          postFramePose.feetPosition.z - poseBeforeFrame.feetPosition.z,
        )
        const footstepBlock = Effect.runSync(currentChunkStore.getBlock(blockPosition(
          Math.floor(postFramePose.feetPosition.x),
          Math.floor(postFramePose.feetPosition.y - 0.1),
          Math.floor(postFramePose.feetPosition.z),
        )))
        footstepRuntimeState = advanceFootstepRuntime(footstepRuntimeState, {
          grounded: groundedAfterFrame && !h5aState.swimmingState.get().active,
          horizontalDistance,
          surface: surfaceForBlockType(
            footstepBlock._tag === 'Block' && typeof footstepBlock.block === 'number'
              ? blockTypeOfId(footstepBlock.block) ?? 'air'
              : 'air',
          ),
          sneaking: held('sneak') > 0,
          dead: deadAfterFrame,
          dimensionChanged,
          position: postFramePose.feetPosition,
          play: (cueId, options) => audio.play(cueId, options),
        })
        if (!isCreativeMode && horizontalDistance > 0) {
          if (multiplayer === undefined) survivalHunger.submit(h5aState.swimmingState.get().active
            ? { _tag: 'swim', distance: horizontalDistance }
            : sprinting
              ? { _tag: 'sprint', distance: horizontalDistance }
              : { _tag: 'walk', distance: horizontalDistance })
          // mx-multiplayer's PlayerVitalsCommand has no 'sprint' activity
          // literal (protocol.d.ts: Schema.Literal<['walk','swim','jump',
          // 'attack','mine']>), so the network path folds sprinting into
          // 'walk' — a narrower exhaustion cost than single-player until the
          // protocol grows the tag.
          else sendVitalsCommand({ _tag: 'activity', activity: h5aState.swimmingState.get().active ? 'swim' : 'walk', amount: horizontalDistance })
        }
        if (
          !isCreativeMode && groundedBeforeFrame &&
          !groundedAfterFrame && held('jump') > 0
        ) {
          if (multiplayer === undefined) survivalHunger.submit({ _tag: 'jump', count: 1, sprinting })
            else sendVitalsCommand({ _tag: 'activity', activity: 'jump', amount: 1 })
        }
      } else {
        footstepRuntimeState = initialFootstepRuntimeState()
      }
      if (looked || moved) markSessionDirty()
      Effect.runSync(Ref.set(gameplayState.targetPosition, postFramePose.feetPosition))

      if (attackTriggered && !primaryAttackGestureConsumed) {
        const eye = { ...postFramePose.feetPosition, y: postFramePose.feetPosition.y + EYE_LEVEL_OFFSET }
        const horizontal = Math.cos(postFramePose.pitchRadians)
        const forward = {
          x: -Math.sin(postFramePose.yawRadians) * horizontal,
          y: Math.sin(postFramePose.pitchRadians),
          z: -Math.cos(postFramePose.yawRadians) * horizontal,
        }
        const target = witherRuntimeState.withers
          .filter((wither) => wither.dimension === dimensionAfterFrame)
          .map((wither) => {
            const center = { ...wither.state.feetPosition, y: wither.state.feetPosition.y + 1.75 }
            const dx = center.x - eye.x
            const dy = center.y - eye.y
            const dz = center.z - eye.z
            const distance = Math.hypot(dx, dy, dz)
            const alignment = distance === 0 ? 1 : (dx * forward.x + dy * forward.y + dz * forward.z) / distance
            return { wither, distance, alignment }
          })
          .filter(({ distance, alignment }) => distance <= DEFAULT_BLOCK_REACH && alignment >= 0.8)
          .sort((left, right) => left.distance - right.distance)[0]
        if (target !== undefined) {
          if (multiplayer === undefined) {
            const result = damageRuntimeWither(
              witherRuntimeState,
              target.wither.id,
              Math.max(1, inventoryMeleeDamage(h5aState.selectedHotbarIndex.get())),
              'melee',
            )
            witherRuntimeState = result.state
            if (result.death !== undefined) {
              Effect.runSync(spawnDroppedItems(world.entities, [{
                item: result.death.drop.item,
                count: result.death.drop.count,
                at: result.death.drop.position,
              }]))
            }
            markSessionDirty()
          } else {
            nextWitherCommand += 1
            Effect.runFork(multiplayer.transport.sendWither({
              _tag: 'DamageWither',
              actor: String(multiplayer.query.player),
              requestId: requestIdFor('wither', nextWitherCommand),
              expectedRevision: witherRevision,
              id: target.wither.id,
              amount: Math.max(1, inventoryMeleeDamage(h5aState.selectedHotbarIndex.get())),
              kind: 'melee',
            }))
          }
          primaryAttackGestureConsumed = true
        }
      }

      if (
        attackTriggered
        && dimensionAfterFrame === 'end'
        && !primaryAttackGestureConsumed
      ) {
        const dragonPosition = endDragonPosition()
        const dx = dragonPosition.x - postFramePose.feetPosition.x
        const dy = dragonPosition.y - (postFramePose.feetPosition.y + EYE_LEVEL_OFFSET)
        const dz = dragonPosition.z - postFramePose.feetPosition.z
        const distance = Math.hypot(dx, dy, dz)
        const horizontal = Math.cos(postFramePose.pitchRadians)
        const forward = {
          x: -Math.sin(postFramePose.yawRadians) * horizontal,
          y: Math.sin(postFramePose.pitchRadians),
          z: -Math.cos(postFramePose.yawRadians) * horizontal,
        }
        const alignment = distance === 0 ? 1 : (dx * forward.x + dy * forward.y + dz * forward.z) / distance
        if (distance <= DEFAULT_BLOCK_REACH + 3 && alignment >= 0.8) {
          const damage = inventoryMeleeDamage(h5aState.selectedHotbarIndex.get())
          if (multiplayer === undefined) {
            Effect.runSync(gameplayState.enderDragonEncounter.damageByPlayer(Math.max(1, damage)))
          } else {
            nextEnderDragonCommand += 1
            Effect.runFork(multiplayer.transport.sendEnderDragon({
              _tag: 'DamageEnderDragon',
              actor: String(multiplayer.query.player),
              requestId: `ender-dragon:${nextEnderDragonCommand}`,
              expectedRevision: enderDragonRevision,
            }))
          }
          primaryAttackGestureConsumed = true
          if (multiplayer === undefined) markSessionDirty()
        }
      }

      // Resolve click rays from the authoritative post-simulation pose. Requests
      // enter gameplay's inbox and are consumed by the next frame.
      if (!deadAfterFrame && !dimensionChanged && attackHeld) {
        if (primaryAttackGestureConsumed) {
          miningProgress = null
        } else {
          const inventoryStorage = Effect.runSync(world.inventory.storageSnapshot)
          const inventorySnapshot = inventoryStorage.inventory
          const selectedSlotIndex = h5aState.selectedHotbarIndex.get()
          const selectedItem = inventorySnapshot.slots[selectedSlotIndex]?.item ?? null
          const enchantedMiningItem = projectEnchantedItem(
            inventorySnapshot.slots[selectedSlotIndex],
            inventoryStorage.inventoryDurability[selectedSlotIndex],
            enchantedItems.get(String(selectedSlotIndex)),
          )
          const resolution = Effect.runSync(
            resolveTargetedPrimaryAttack(
              currentChunkStore,
              world.entities,
              playerApi,
              {
                meleeDamage: inventoryMeleeDamage(selectedSlotIndex),
              },
            ),
          )
          if (resolution._tag === 'Melee') {
            miningProgress = null
            if (attackTriggered) {
              nextMeleeAttackRequestId += 1
              const requestId = `melee-attack-${String(nextMeleeAttackRequestId)}`
              Effect.runSync(
                requestMeleeAttack(gameplayState, {
                  ...resolution.request,
                  requestId,
                }),
              )
              if (selectedItem !== null && isSwordItem(selectedItem)) {
                pendingMeleeAttacks.set(requestId, {
                  slotIndex: selectedSlotIndex,
                  item: selectedItem,
                })
              }
              primaryAttackGestureConsumed = true
              markSessionDirty()
            }
          } else {
            const miningItem = selectedItem !== null && isLegacyGameplayItemType(selectedItem)
              ? selectedItem
              : null
            let target: Parameters<typeof advanceMiningProgress>[0]['target'] = null
            if (resolution._tag === 'Block') {
              const reading = Effect.runSync(currentChunkStore.getBlock(blockPosition(resolution.target.position.x, resolution.target.position.y, resolution.target.position.z)))
              if (reading._tag === 'Block') {
                const position = {
                  x: Math.floor(resolution.target.position.x),
                  y: Math.floor(resolution.target.position.y),
                  z: Math.floor(resolution.target.position.z),
                } as NonNullable<Parameters<typeof advanceMiningProgress>[0]['target']>['position']
                target = { position, blockId: reading.block }
              }
            }
            const advancement = advanceMiningProgress({
              current: miningProgress,
              target,
              isMining: true,
              selectedItem: miningItem,
              efficiencyLevel: enchantedMiningItem === null
                ? 0
                : enchantmentLevel(enchantedMiningItem, 'efficiency'),
              deltaSecs,
            })
            miningProgress = isCreativeMode ? null : advancement.nextProgress
            const shouldBreak = isCreativeMode ? attackTriggered : advancement.shouldBreak
            if (shouldBreak && target !== null) {
              if (!isCreativeMode) {
                if (multiplayer === undefined) survivalHunger.submit({ _tag: 'mine', blocks: 1 })
                else sendVitalsCommand({ _tag: 'activity', activity: 'mine', amount: 1 })
              }
              const dimension = Effect.runSync(playerApi.dimension)
              if (multiplayer !== undefined) {
                Effect.runSync(multiplayer.host.enqueueOutbound({
                  _tag: 'BlockBreak',
                  player: multiplayer.query.player,
                  world: WorldId.make(dimension),
                  at: target.position,
                }))
              } else if (target.blockId === POTATO_CROP_BLOCK_ID) {
                const location = { dimension, position: target.position }
                const ripe = Effect.runSync(crops.matureYieldsAt(location)) !== null
                Effect.runSync(currentChunkStore.setBlock(target.position, blockIdOf('air')))
                Effect.runSync(crops.remove(location))
                h5aState.nextItemUseRequestId.set(h5aState.nextItemUseRequestId.get() + 1)
                const requestId = `item-use-${String(h5aState.nextItemUseRequestId.get())}`
                Effect.runSync(
                  requestPotatoHarvest(gameplayState, requestId, target.position, ripe, Math.random()),
                )
                pendingItemUses.set(requestId, {
                  kind: 'harvest',
                  dimension,
                  position: target.position,
                })
              } else {
                Effect.runSync(
                  requestBlockBreak(
                    gameplayState,
                    target.position,
                    {
                      ...miningLootContextForItem(miningItem),
                      fortuneLevel: enchantedMiningItem === null
                        ? 0
                        : enchantmentLevel(enchantedMiningItem, 'fortune'),
                    },
                  ),
                )
                pendingBlockBreakConfirmations.push({
                  dimension,
                  position: target.position,
                  blockId: target.blockId,
                })
                if (
                  !isCreativeMode && (
                    selectedItem === 'wooden_pickaxe' ||
                    selectedItem === 'stone_pickaxe' ||
                    selectedItem === 'iron_pickaxe' ||
                    selectedItem === 'diamond_pickaxe'
                  )
                ) {
                  pendingMiningToolDamage.push({
                    dimension,
                    position: target.position,
                    blockId: target.blockId,
                    slotIndex: h5aState.selectedHotbarIndex.get(),
                    item: selectedItem,
                  })
                }
              }
              blockBreakCounters = recordBlockBreakRequest(blockBreakCounters)
              canvas.setAttribute('data-breaks-requested', String(blockBreakCounters.requested))
              if (target.blockId === POTATO_CROP_BLOCK_ID && multiplayer === undefined) {
                blockBreakCounters = observeBlockBreakCompletion(
                  blockBreakCounters,
                  target.blockId,
                  0,
                )
                canvas.setAttribute('data-breaks-completed', String(blockBreakCounters.completed))
              }
              primaryAttackGestureConsumed = true
              if (multiplayer === undefined) {
                h5aState.redstoneDirty.set(true)
                markSessionDirty()
              }
            }
          }
        }
      } else if (deadAfterFrame || dimensionChanged) {
        resetPrimaryAttackGesture()
      }

      return {
        deadAfterFrame,
        dimensionChanged,
        postFramePose,
        dimensionAfterFrame,
        bowAdvance,
        groundedAfterFrame,
        playerHeals,
      }
  } finally {
    state.blockBreakCounters.set(blockBreakCounters)
    state.environmentalContactDamageState.set(environmentalContactDamageState)
    state.witherRuntimeState.set(witherRuntimeState)
    state.projectileRuntimeState.set(projectileRuntimeState)
    state.eyeOfEnderRuntimeState.set(eyeOfEnderRuntimeState)
    state.bowUseState.set(bowUseState)
    state.footstepRuntimeState.set(footstepRuntimeState)
    state.nextWitherCommand.set(nextWitherCommand)
    state.nextEnderDragonCommand.set(nextEnderDragonCommand)
    state.nextMeleeAttackRequestId.set(nextMeleeAttackRequestId)
    state.miningProgress.set(miningProgress)
    state.primaryAttackGestureConsumed.set(primaryAttackGestureConsumed)
    state.activeChestId.set(activeChestId)
    state.activeFurnaceKey.set(activeFurnaceKey)
    state.tradeStatus.set(tradeStatus)
  }
}
