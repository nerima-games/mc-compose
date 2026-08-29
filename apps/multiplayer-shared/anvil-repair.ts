import {
  AnvilCustomName,
  AnvilEnchantmentId,
  ITEM_TYPES,
  isAnvilCustomName,
  planAnvil,
  type AnvilDurability,
  type AnvilItemPayload,
  type AnvilPlan,
  type AnvilRuleSet,
  type CanonicalAnvilItemPayload,
  type ItemType,
} from '@nerima-games/mc-kernel'
import {
  ENCHANTMENT_IDS,
  ENCHANTMENT_REGISTRY,
  enchantmentAppliesTo,
  type EnchantedItem,
  type EnchantmentId,
} from '@nerima-games/mx-gameplay'
import {
  durabilityForItem,
  experienceCostOfLevel,
  itemStack,
  levelForTotalExperience,
  totalExperienceAtLevel,
  type PlayerStorage,
} from '@nerima-games/mc-sim'

const isGameplayEnchantmentId = (value: string): value is EnchantmentId =>
  ENCHANTMENT_IDS.includes(value as EnchantmentId)

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

export type AnvilOperationRequest = {
  readonly name: string
  readonly currentName?: string | null
  readonly enchantedItem?: EnchantedItem
}

export type AnvilOperationInput = AnvilOperationRequest & {
  readonly item: ItemType
  readonly durability: AnvilDurability | null
  readonly material?: {
    readonly item: ItemType
    readonly count: number
  }
}

export type AppliedAnvilOperation = {
  readonly storage: PlayerStorage
  readonly output: CanonicalAnvilItemPayload
  readonly levelCost: number
  readonly materialCost: number
}

const invalidInput = (path: string, reason: string): AnvilPlan => ({
  ok: false,
  reason: 'invalid-input',
  issues: [{ path, reason }],
})

const anvilEnchantmentRules = ENCHANTMENT_IDS.map((id) => {
  const definition = ENCHANTMENT_REGISTRY[id]
  return {
    id: AnvilEnchantmentId(id),
    maxLevel: definition.maxLevel,
    applicableItems: ITEM_TYPES.filter((item) => enchantmentAppliesTo(id, item)),
    incompatibleWith: definition.incompatibleWith
      .filter(isGameplayEnchantmentId)
      .map((value) => AnvilEnchantmentId(value)),
    costPerLevel: 1,
  }
})

const anvilRepairMaterials = ITEM_TYPES.flatMap((item) => {
  const durability = durabilityForItem(item)
  return durability === null
    ? []
    : [{ target: item, material: 'iron_ingot' as ItemType, durabilityPerUnit: durability.max }]
})

export const ANVIL_RULES: AnvilRuleSet = Object.freeze({
  enchantments: Object.freeze(anvilEnchantmentRules),
  repairMaterials: Object.freeze(anvilRepairMaterials),
})

const anvilPayload = (
  item: ItemType,
  durability: AnvilDurability | null,
  enchantments: ReadonlyArray<{ readonly id: string; readonly level: number }>,
  customName: AnvilCustomName | null,
): AnvilItemPayload => ({
  item,
  durability,
  enchantments: enchantments.map((enchantment) => ({
    id: AnvilEnchantmentId(enchantment.id),
    level: enchantment.level,
  })),
  repairCost: 0,
  customName,
})

export const planAnvilOperation = (
  input: AnvilOperationInput,
): AnvilPlan => {
  if (typeof input.name !== 'string') return invalidInput('name', 'must be a string')

  const requestedName = input.name.trim()
  if (requestedName !== '' && !isAnvilCustomName(requestedName)) {
    return invalidInput('name', 'must be at most 50 characters without control characters')
  }
  const existingName = input.currentName?.trim() ?? ''
  if (existingName !== '' && !isAnvilCustomName(existingName)) {
    return invalidInput('currentName', 'must be at most 50 characters without control characters')
  }

  const enchantedItem = input.enchantedItem
  if (enchantedItem !== undefined && enchantedItem.item !== input.item) {
    return invalidInput('enchantedItem.item', 'must match item')
  }

  const enchantments = enchantedItem?.enchantments ?? []
  for (const [index, enchantment] of enchantments.entries()) {
    if (!isGameplayEnchantmentId(enchantment.id)) {
      return invalidInput(`enchantedItem.enchantments[${index}].id`, 'unsupported enchantment')
    }
  }

  const material = input.material
  if (material !== undefined && (!Number.isSafeInteger(material.count) || material.count <= 0)) {
    return invalidInput('material.count', 'must be a positive safe integer')
  }

  const left = anvilPayload(
    input.item,
    input.durability,
    enchantments,
    existingName === '' ? null : AnvilCustomName(existingName),
  )
  const right = material === undefined
    ? null
    : {
      payload: anvilPayload(material.item, null, [], null),
      count: material.count,
    }

  return planAnvil(
    {
      left,
      right,
      rename: requestedName === '' ? null : AnvilCustomName(requestedName),
      experienceLevels: 0,
    },
    ANVIL_RULES,
  )
}

export const enchantedItemFromAnvilOutput = (
  output: CanonicalAnvilItemPayload,
): EnchantedItem | undefined => {
  if (output.enchantments.length === 0) return undefined
  const enchantments: Array<{ readonly id: EnchantmentId; readonly level: number }> = []
  for (const enchantment of output.enchantments) {
    const id = String(enchantment.id)
    if (!isGameplayEnchantmentId(id)) return undefined
    enchantments.push({ id, level: enchantment.level })
  }
  return {
    item: output.item,
    durability: output.durability,
    enchantments,
  }
}

export const applyAnvilOperation = (
  storage: PlayerStorage,
  slotIndex: number,
  request: AnvilOperationRequest,
): AppliedAnvilOperation | undefined => {
  const stack = storage.inventory.slots[slotIndex]
  if (stack === undefined) return undefined

  const durability = storage.inventoryDurability[slotIndex] ?? null
  const needsRepair = durability !== null && durability.current < durability.max
  const ironIndex = needsRepair
    ? storage.inventory.slots.findIndex(
        (candidate, index) => index !== slotIndex && candidate?.item === 'iron_ingot' && candidate.count > 0,
      )
    : -1
  const iron = ironIndex < 0 ? undefined : storage.inventory.slots[ironIndex]
  const operationInput = {
    ...request,
    item: stack.item,
    durability,
  }
  const plan = planAnvilOperation(
    iron === undefined
      ? operationInput
      : { ...operationInput, material: { item: iron.item, count: iron.count } },
  )
  if (!plan.ok || (plan.materialCost > 0 && iron === undefined)) return undefined
  if (iron !== undefined && iron.count < plan.materialCost) return undefined

  const slots = [...storage.inventory.slots]
  const inventoryDurability = [...storage.inventoryDurability]
  if (iron !== undefined && plan.materialCost > 0) {
    slots[ironIndex] = iron.count === plan.materialCost
      ? undefined
      : itemStack(iron.item, iron.count - plan.materialCost)
    if (iron.count === plan.materialCost) inventoryDurability[ironIndex] = null
  }
  inventoryDurability[slotIndex] = plan.output.durability

  return {
    storage: {
      ...storage,
      inventory: { slots },
      inventoryDurability,
    },
    output: plan.output,
    levelCost: plan.levelCost,
    materialCost: plan.materialCost,
  }
}
