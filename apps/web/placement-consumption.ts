export const excludeReservedPlacementConsumptions = <Item>(
  consumedItems: ReadonlyArray<Item>,
  reservedItems: ReadonlyArray<Item>,
): ReadonlyArray<Item> => {
  const remainingReservations = [...reservedItems]

  return consumedItems.filter((item) => {
    const reservationIndex = remainingReservations.indexOf(item)
    if (reservationIndex < 0) return true
    remainingReservations.splice(reservationIndex, 1)
    return false
  })
}
