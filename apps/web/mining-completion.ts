export type BlockBreakCounters = Readonly<{
  readonly requested: number
  readonly completed: number
}>

export const EMPTY_BLOCK_BREAK_COUNTERS: BlockBreakCounters = {
  requested: 0,
  completed: 0,
}

export const recordBlockBreakRequest = (
  counters: BlockBreakCounters,
): BlockBreakCounters => ({
  requested: counters.requested + 1,
  completed: counters.completed,
})

export const observeBlockBreakCompletion = (
  counters: BlockBreakCounters,
  expectedBlockId: number,
  observedBlockId: number | undefined,
): BlockBreakCounters => (
  observedBlockId === undefined || observedBlockId === expectedBlockId
    ? counters
    : {
        requested: counters.requested,
        completed: counters.completed + 1,
      }
)
