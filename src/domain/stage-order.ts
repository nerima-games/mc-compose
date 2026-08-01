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
  /**
   * Stages whose id matched no phase of the skeleton.
   *
   * `priorityOf` answers `MAX_SAFE_INTEGER` for such a stage, so it sorts after
   * every stage the skeleton does recognise and it contributes no implicit
   * edge — it simply falls to the end of the frame. That is LEGAL and is how a
   * mod's stage stays schedulable (`domain/modding.ts`), but it is also exactly
   * what a mistyped `render:daw` looks like, and the two are indistinguishable
   * from the symptom.
   *
   * So: enforce nothing, report it. Sorted, so the field is a value a host can
   * compare between builds.
   *
   * Empty when `resolveStageOrder` was given no skeleton at all — with no phase
   * table there is nothing for a stage to fail to match, and reporting every
   * stage would make the field noise in exactly the tests that pass `[]`.
   */
  readonly unmatchedPhase: ReadonlyArray<StageId>
}

/**
 * One PHASE of the frame: a position in the skeleton, plus how a stage id says
 * it belongs there.
 *
 * ---------------------------------------------------------------------------
 * Why membership and not a list of ids
 * ---------------------------------------------------------------------------
 *
 * The skeleton used to be a flat `ReadonlyArray<StageId>` of concrete ids —
 * `simulation:physics`, `simulation:interactions`, `hud-sync`, … — matched
 * against the registrations by string equality. No module registers those ids.
 * They register `sim:physics`, `gameplay:interactions`, `redstone:power`,
 * `ui:hud-sync`, because plan.md §4.1's convention is
 * `<owning-repo-suffix>:<stage>` and a module names its OWN stages. So the
 * filter below matched nothing, `priorityOf` returned MAX_SAFE_INTEGER for
 * every stage, no implicit edge was ever added, and plan.md §4.2's backbone
 * decayed into a lexicographic sort of whatever happened to be registered.
 *
 * A phase fixes that without giving any module a say in the total order. The
 * NAMESPACE half of an id says who owns the stage; the NAME half says what kind
 * of work it is, and that is what a phase claims. `gameplay:interactions` and a
 * hypothetical `sim:interactions` are both interactions; mc-compose decides
 * where interactions run, and neither module can express an opinion about it.
 * §2.3-3 is preserved exactly: modules declare `after`, compose declares this.
 */
export type StagePhase = {
  /**
   * The phase's name, which doubles as its canonical `StageId` — what a module
   * with no repository prefix would register, and what the mod loader reserves.
   */
  readonly name: string
  /**
   * How a stage id declares membership. An entry ending in `:` matches a whole
   * NAMESPACE (`redstone:` matches `redstone:power`); any other entry matches
   * the stage NAME, the part after the last `:` (`physics` matches both
   * `sim:physics` and a bare `physics`).
   *
   * A stage that matches several phases belongs to the EARLIEST — the sequence
   * is the authority, so `render:input` is input rather than render.
   */
  readonly members: ReadonlyArray<string>
}

/** Build a phase. `members` defaults to the phase's own name. */
export const stagePhase = (name: string, ...members: ReadonlyArray<string>): StagePhase => ({
  name,
  members: members.length === 0 ? [name] : members,
})

/** The namespace half of an id, WITH its colon. `gameplay:fluids` -> `gameplay:`. */
const namespaceOf = (id: string): string => {
  const at = id.indexOf(':')
  return at === -1 ? '' : id.slice(0, at + 1)
}

/** The name half of an id: everything after the LAST colon. `mod:x:tick` -> `tick`. */
const stageNameOf = (id: string): string => {
  const at = id.lastIndexOf(':')
  return at === -1 ? id : id.slice(at + 1)
}

/** Does this phase claim this stage? See `StagePhase.members`. */
export const phaseAdmits = (phase: StagePhase, id: StageId): boolean =>
  phase.members.some((member) =>
    member.endsWith(':') ? namespaceOf(id) === member : stageNameOf(id) === member,
  )

/**
 * Which phase a stage belongs to, or `undefined` if the skeleton has never
 * heard of it — which is legal, and is how a mod's stage stays schedulable.
 */
export const phaseOf = (
  skeleton: ReadonlyArray<StagePhase>,
  id: StageId,
): StagePhase | undefined => skeleton.find((phase) => phaseAdmits(phase, id))

export type ResolveOptions = {
  /**
   * The standard stage skeleton (plan.md §4.2), owned by this repository.
   *
   * It does two things:
   *
   * - Contributes implicit ordering edges between the phases that actually have
   *   a registered stage, IN SKELETON ORDER, closing over any that are empty.
   *   A build with no fluids still runs entities before redstone.
   * - Provides the primary tie-break, so that two stages with no ordering
   *   relation land where the skeleton says rather than alphabetically.
   */
  readonly skeleton?: ReadonlyArray<StagePhase>
}

/** Lower sorts first. Stages in no phase sort after every stage that is in one. */
const priorityOf = (skeleton: ReadonlyArray<StagePhase>, id: StageId): number => {
  const index = skeleton.findIndex((phase) => phaseAdmits(phase, id))
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

/**
 * The deterministic tie-break, in full: phase position, then id.
 *
 * It is TOTAL — two distinct stages can never compare equal, because ids are
 * unique by the time this runs. That totality is what makes the output
 * reproducible; a partial comparator would leave the result at the mercy of
 * `Array.prototype.sort`'s stability and of insertion order.
 */
const compareStages =
  (skeleton: ReadonlyArray<StagePhase>) =>
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
  // Every stage of one phase runs before every stage of the next NON-EMPTY
  // phase, so an unpopulated phase closes the gap rather than breaking the
  // chain: a build with no fluids still runs entities before redstone.
  //
  // Note what this does NOT do: order two stages that landed in the SAME phase.
  // Both mx-redstone stages are `simulation:redstone`, and which of them runs
  // first is settled by mx-redstone's own `after` edge, because it is the only
  // repository that knows. Compose orders phases; modules order themselves
  // within one (plan.md §2.3-3).
  const byPhase = new Map<number, Array<StageId>>()
  for (const id of registered) {
    const index = skeleton.findIndex((phase) => phaseAdmits(phase, id))
    if (index === -1) {
      continue
    }
    const bucket = byPhase.get(index)
    if (bucket === undefined) {
      byPhase.set(index, [id])
    } else {
      bucket.push(id)
    }
  }

  const populated = [...byPhase.keys()]
    .sort((left, right) => left - right)
    .map((index) => byPhase.get(index) ?? [])

  for (let index = 1; index < populated.length; index += 1) {
    for (const before of populated[index - 1] ?? []) {
      for (const after of populated[index] ?? []) {
        addEdge(before, after)
      }
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

  // --- 6. What the resolver would otherwise have swallowed ------------------
  // Neither of these is an error. Both are reported, because both are
  // indistinguishable from a typo at the point where they bite: an `after` that
  // named nothing simply does not order anything, and a stage in no phase
  // simply runs last. See `StageOrderPlan.unmatchedPhase`.
  const unmatchedPhase =
    skeleton.length === 0
      ? []
      : [...registered].filter((id) => phaseOf(skeleton, id) === undefined).sort()

  return Either.right({ order, dangling, unmatchedPhase })
}

/**
 * Everything a host should print about a resolved plan, as lines.
 *
 * Exported because `StageOrderPlan.dangling` previously had NO consumer
 * anywhere in the roster: the resolver computed it faithfully and nothing ever
 * looked. A field nobody reads is not a report, and the whole justification for
 * not rejecting a dangling edge is that it gets surfaced instead.
 *
 * Empty when there is nothing to say, so a host can print it unconditionally
 * without a length check.
 */
export const describeStagePlanWarnings = (plan: StageOrderPlan): ReadonlyArray<string> => [
  ...plan.dangling.map(
    (edge) =>
      `stage "${edge.stage}" declares after: ["${edge.missing}"], which no module registered in this build. ` +
      'The edge was dropped, not rejected — that is how a module says "after input, if there is input". ' +
      'If it was meant to order against a stage that IS in this build, it is a typo.',
  ),
  ...plan.unmatchedPhase.map(
    (id) =>
      `stage "${id}" matches no phase of the frame skeleton, so it runs after every stage that does. ` +
      'That is legal — a mod stage is expected to look like this — but a mistyped core stage id looks identical.',
  ),
]

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
