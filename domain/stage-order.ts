/**
 * THE STAGE TOTAL ORDER RESOLVER — the core algorithm of this repository.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * plan.md §2.3-3: "stage 実行順序表は compose が唯一所有"
 * ---------------------------------------------------------------------------
 *
 * Every other repository declares only ORDERING CONSTRAINTS — `after: [...]`
 * on a `StageRegistration`. No module knows, or is allowed to know, the global
 * frame order. mc-compose is the single place where those partial constraints
 * become one total order, and this file is that place.
 *
 * That asymmetry is the whole point of the design. If a module could name its
 * absolute position ("I am stage 7"), then adding a stage anywhere would be a
 * breaking change everywhere, and the 16-repository split would be undone by
 * an integer.
 *
 * ---------------------------------------------------------------------------
 * What "resolve" has to guarantee
 * ---------------------------------------------------------------------------
 *
 * 1. DETERMINISM. The same set of registrations must produce the same order on
 *    every run, in every process, forever. A topological sort has many valid
 *    answers; picking a different one between two runs would make a frame-order
 *    bug reproduce only sometimes, which is the worst possible failure mode for
 *    a simulation that is supposed to be replayable. The tie-break here is
 *    total and explicit: skeleton position first, then lexicographic id.
 *
 * 2. CYCLE DETECTION WITH THE CYCLE IN HAND. "your stages have a cycle" is not
 *    actionable across 15 repositories; "gameplay:fluids -> mx-redstone:tick ->
 *    gameplay:fluids" is. The failure carries the path.
 *
 * 3. DANGLING EDGES ARE NOT ERRORS. A stage may declare `after` on a stage that
 *    is not registered in this build — that is exactly how a module says "run
 *    me after input, if there is input" without taking a dependency on the
 *    input repository (see mc-kernel `domain/frame.ts`). Such an edge is
 *    dropped, and REPORTED, so a typo is visible without being fatal.
 *
 * ---------------------------------------------------------------------------
 * What must NEVER be added to this file
 * ---------------------------------------------------------------------------
 *
 * Game rules. Not one. See docs/responsibility.md — the prime directive. If a
 * stage needs to run before another stage under some game condition, the
 * condition belongs inside that stage's `run`, in the module that owns it. This
 * resolver only knows ids and edges; it has never heard of a block, a player or
 * a chunk, and it must stay that way.
 */
import { Brand, Either } from 'effect'

/**
 * Identifies a frame stage. Mirrors `@nerima-games/mc-kernel`'s `StageId`
 * exactly, and is declared locally only because nothing in the roster is
 * published yet (see docs/versioning.md §3). When kernel ships, this becomes a
 * re-export and the local definition is deleted.
 *
 * Convention: `<owning-repo-suffix>:<stage>` — e.g. `gameplay:fluids`,
 * `render:draw`. Not enforced.
 */
export type StageId = string & Brand.Brand<'StageId'>

export const StageId = Brand.refined<StageId>(
  (value) => value.trim().length > 0,
  (value) => Brand.error(`StageId must be a non-blank string, received ${JSON.stringify(value)}`),
)

/**
 * What a module declares. Deliberately NOT the full `StageRegistration` —
 * ordering is resolved from ids and edges alone, with no reference to the
 * effect a stage runs. Keeping `run` out of the resolver is what makes the
 * algorithm testable with plain strings.
 */
export type StageConstraint = {
  readonly id: StageId
  readonly after?: ReadonlyArray<StageId>
}

/** An `after` edge naming a stage that is not registered in this build. */
export type DanglingEdge = {
  readonly stage: StageId
  readonly missing: StageId
}

export type StageOrderError =
  /** Two registrations claim the same id. Which one runs would be arbitrary. */
  | { readonly _tag: 'DuplicateStage'; readonly id: StageId }
  /** No total order exists. `cycle` is the actual path, first node repeated at the end. */
  | { readonly _tag: 'StageCycle'; readonly cycle: ReadonlyArray<StageId> }

export type StageOrderPlan = {
  /** The single total order. This is the frame. */
  readonly order: ReadonlyArray<StageId>
  /** Edges that named an absent stage and were therefore dropped. */
  readonly dangling: ReadonlyArray<DanglingEdge>
}

export type ResolveOptions = {
  /**
   * The standard stage skeleton (plan.md §4.2), owned by this repository.
   *
   * It does two things:
   *
   * - Contributes implicit ordering edges between the skeleton stages that are
   *   actually registered, IN SKELETON ORDER, closing over any that are absent.
   *   A build with no fluids still runs entities before redstone.
   * - Provides the primary tie-break, so that two stages with no ordering
   *   relation land where the skeleton says rather than alphabetically.
   */
  readonly skeleton?: ReadonlyArray<StageId>
}

/** Lower sorts first. Non-skeleton stages sort after every skeleton stage. */
const priorityOf = (skeleton: ReadonlyArray<StageId>, id: StageId): number => {
  const index = skeleton.indexOf(id)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * The deterministic tie-break, in full: skeleton position, then id.
 *
 * It is TOTAL — two distinct stages can never compare equal, because ids are
 * unique by the time this runs. That totality is what makes the output
 * reproducible; a partial comparator would leave the result at the mercy of
 * `Array.prototype.sort`'s stability and of insertion order.
 */
const compareStages =
  (skeleton: ReadonlyArray<StageId>) =>
  (left: StageId, right: StageId): number => {
    const byPriority = priorityOf(skeleton, left) - priorityOf(skeleton, right)
    return byPriority === 0 ? (left < right ? -1 : left > right ? 1 : 0) : byPriority
  }

/**
 * Find one cycle among the nodes that a topological sort could not place.
 *
 * Iterative DFS with an explicit stack: a frame graph is small, but recursion
 * here would put the depth limit of the *host* between a developer and an error
 * message, which is a bad trade for zero benefit.
 */
const findCycle = (
  nodes: ReadonlyArray<StageId>,
  edges: ReadonlyMap<StageId, ReadonlySet<StageId>>,
): ReadonlyArray<StageId> => {
  const remaining = new Set(nodes)
  const onPath = new Set<StageId>()
  const done = new Set<StageId>()
  const path: Array<StageId> = []

  const walk = (start: StageId): ReadonlyArray<StageId> | undefined => {
    const stack: Array<{ readonly node: StageId; readonly entering: boolean }> = [
      { node: start, entering: true },
    ]

    while (stack.length > 0) {
      const frame = stack.pop()
      if (frame === undefined) {
        break
      }
      const { node, entering } = frame

      if (!entering) {
        onPath.delete(node)
        done.add(node)
        path.pop()
        continue
      }

      if (done.has(node)) {
        continue
      }

      if (onPath.has(node)) {
        return [...path.slice(path.indexOf(node)), node]
      }

      onPath.add(node)
      path.push(node)
      stack.push({ node, entering: false })

      for (const next of edges.get(node) ?? []) {
        if (remaining.has(next) && !done.has(next)) {
          stack.push({ node: next, entering: true })
        }
      }
    }

    return undefined
  }

  for (const node of nodes) {
    const cycle = walk(node)
    if (cycle !== undefined) {
      return cycle
    }
  }

  // Unreachable: this function is only called when Kahn's algorithm left nodes
  // unplaced, which happens exactly when a cycle exists. Returning the whole
  // remainder rather than throwing keeps the failure a value.
  return nodes
}

/**
 * Resolve the single total order of frame stages.
 *
 * Kahn's algorithm over `before -> after` edges, with the ready set kept sorted
 * by `compareStages` so that the result is a function of the input alone.
 */
export const resolveStageOrder = (
  constraints: ReadonlyArray<StageConstraint>,
  options: ResolveOptions = {},
): Either.Either<StageOrderPlan, StageOrderError> => {
  const skeleton = options.skeleton ?? []

  // --- 1. Registrations must be unique -------------------------------------
  const registered = new Set<StageId>()
  for (const constraint of constraints) {
    if (registered.has(constraint.id)) {
      return Either.left({ _tag: 'DuplicateStage', id: constraint.id })
    }
    registered.add(constraint.id)
  }

  // --- 2. Edges from declared `after`, dangling ones set aside --------------
  const successors = new Map<StageId, Set<StageId>>()
  const indegree = new Map<StageId, number>()
  const dangling: Array<DanglingEdge> = []

  for (const id of registered) {
    successors.set(id, new Set<StageId>())
    indegree.set(id, 0)
  }

  const addEdge = (before: StageId, after: StageId): void => {
    const outgoing = successors.get(before)
    if (outgoing === undefined || outgoing.has(after) || before === after) {
      return
    }
    outgoing.add(after)
    indegree.set(after, (indegree.get(after) ?? 0) + 1)
  }

  for (const constraint of constraints) {
    for (const before of constraint.after ?? []) {
      if (registered.has(before)) {
        addEdge(before, constraint.id)
      } else {
        dangling.push({ stage: constraint.id, missing: before })
      }
    }
  }

  // --- 3. Implicit skeleton chain ------------------------------------------
  // Only over skeleton stages that are actually registered, so an absent stage
  // closes the gap rather than breaking the chain.
  const presentSkeleton = skeleton.filter((id) => registered.has(id))
  for (let index = 1; index < presentSkeleton.length; index += 1) {
    const before = presentSkeleton[index - 1]
    const after = presentSkeleton[index]
    if (before !== undefined && after !== undefined) {
      addEdge(before, after)
    }
  }

  // --- 4. Kahn, with a deterministically ordered ready set ------------------
  const compare = compareStages(skeleton)
  const ready = [...registered].filter((id) => (indegree.get(id) ?? 0) === 0).sort(compare)
  const order: Array<StageId> = []

  while (ready.length > 0) {
    const next = ready.shift()
    if (next === undefined) {
      break
    }
    order.push(next)

    const unlocked: Array<StageId> = []
    for (const successor of successors.get(next) ?? []) {
      const remaining = (indegree.get(successor) ?? 0) - 1
      indegree.set(successor, remaining)
      if (remaining === 0) {
        unlocked.push(successor)
      }
    }

    if (unlocked.length > 0) {
      ready.push(...unlocked)
      ready.sort(compare)
    }
  }

  // --- 5. Anything left over is in a cycle ---------------------------------
  if (order.length !== registered.size) {
    const placed = new Set(order)
    const stuck = [...registered].filter((id) => !placed.has(id)).sort(compare)
    const frozenEdges: ReadonlyMap<StageId, ReadonlySet<StageId>> = successors
    return Either.left({ _tag: 'StageCycle', cycle: findCycle(stuck, frozenEdges) })
  }

  return Either.right({ order, dangling })
}

/** Human-readable rendering of a resolution failure, for logs and test output. */
export const describeStageOrderError = (error: StageOrderError): string => {
  switch (error._tag) {
    case 'DuplicateStage':
      return `two modules registered the stage id "${error.id}"; stage ids must be unique across the whole build.`
    case 'StageCycle':
      return (
        `frame stages form a cycle: ${error.cycle.join(' -> ')}. ` +
        'No total order exists. Break it by moving the shared work into the earlier stage, ' +
        'or by splitting one of the stages in two — never by deleting an `after` edge you do not own.'
      )
  }
}
