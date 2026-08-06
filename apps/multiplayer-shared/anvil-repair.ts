import {
  durabilityForItem,
  experienceCostOfLevel,
  itemStack,
  levelForTotalExperience,
  totalExperienceAtLevel,
  type PlayerStorage,
} from '@nerima-games/mc-sim'

export const spendExperienceLevels = (
  totalExperience: number,
  levels: number,
): number | undefined => {
  if (!Number.isFinite(totalExperience) || totalExperience < 0) return undefined
  if (!Number.isSafeInteger(levels) || levels < 0) return undefined
  const currentLevel = levelForTotalExperience(totalExperience)
  if (currentLevel < levels) return undefined
  if (levels === 0) return totalExperience

  const progress = (
    totalExperience - totalExperienceAtLevel(currentLevel)
  ) / experienceCostOfLevel(currentLevel)
  const nextLevel = currentLevel - levels
  return totalExperienceAtLevel(nextLevel)
    + Math.floor(progress * experienceCostOfLevel(nextLevel))
}

export const applyAnvilOperation = (
  storage: PlayerStorage,
  slotIndex: number,
  hasChange: boolean,
): PlayerStorage | undefined => {
  const stack = storage.inventory.slots[slotIndex]
  if (stack === undefined || !hasChange) return undefined

  const ironIndex = storage.inventory.slots.findIndex(
    (candidate, index) => index !== slotIndex && candidate?.item === 'iron_ingot' && candidate.count > 0,
  )
  if (ironIndex < 0) return undefined

  const slots = [...storage.inventory.slots]
  const iron = slots[ironIndex]
  if (iron === undefined) return undefined
  slots[ironIndex] = iron.count === 1 ? undefined : itemStack(iron.item, iron.count - 1)

  const inventoryDurability = [...storage.inventoryDurability]
  inventoryDurability[ironIndex] = null
  const repaired = durabilityForItem(stack.item)
  if (repaired !== null) inventoryDurability[slotIndex] = repaired

  return {
    ...storage,
    inventory: { slots },
    inventoryDurability,
  }
}
