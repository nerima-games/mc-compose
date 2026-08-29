export const isDroppedItemPickupEligible = (
  currentFrame: number,
  eligibleFromFrame: number | undefined,
): boolean => eligibleFromFrame === undefined || currentFrame >= eligibleFromFrame
