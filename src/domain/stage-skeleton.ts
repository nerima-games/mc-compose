/**
 * THE STANDARD STAGE SKELETON — plan.md §4.2.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * This table, and `domain/stage-order.ts`, are the two things this repository
 * is allowed to own.
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.15: "composeの追加コードはLayer合成とstage順序表だけ".
 * If a change to this repository is not an edit to a Layer composition or to
 * this table, it belongs in the module that owns the behaviour. See
 * docs/responsibility.md.
 *
 * ---------------------------------------------------------------------------
 * The skeleton is a sequence of PHASES, not a list of stage ids
 * ---------------------------------------------------------------------------
 *
 * It used to be a flat list of concrete ids — `simulation:physics`,
 * `simulation:interactions`, `hud-sync`, … — that `resolveStageOrder` matched
 * against the registrations by string equality. NOTHING REGISTERS THOSE IDS.
 * Modules register `sim:physics`, `gameplay:interactions`, `redstone:power`,
 * `ui:hud-sync`, because plan.md §4.1's convention is
 * `<owning-repo-suffix>:<stage>` and a module names its own stages. So the
 * match found nothing, no implicit edge was ever contributed, `priorityOf`
 * answered MAX_SAFE_INTEGER for every stage, and the tie-break degraded to a
 * pure lexicographic sort. plan.md §4.2's backbone was decorative: a real build
 * would have run `camera-mirror` before `gameplay:entities` because "c" sorts
 * before "g".
 *
 * A phase is the fix. It names a POSITION in the frame and the kind of work
 * that goes there; a stage id declares membership by its NAME half, while its
 * NAMESPACE half continues to say only who owns it. `gameplay:interactions` is
 * interactions; so is a bare `interactions`; so would be `sim:interactions`.
 * mc-compose still decides, alone, where interactions run — no module gains any
 * way to state an absolute position, which is what §2.3-3 forbids.
 *
 * Each phase's `name` is also its canonical `StageId`, so a module that owns a
 * whole phase outright (mc-render's `render`) can simply register that name.
 *
 * ---------------------------------------------------------------------------
 * Why THIS order
 * ---------------------------------------------------------------------------
 *
 * Each edge below is a claim about causality within one frame. They are written
 * out because "it was like that in the reference implementation" is not a
 * reason, and because changing one of them silently changes the game.
 */
import { StageId, stagePhase, type StagePhase } from './stage-order'

/** Read input before anything reacts to it, so a frame acts on this frame's input. */
export const STAGE_PHASE_INPUT: StagePhase = stagePhase('input', 'input')

/**
 * Apply what arrived from the network, before the simulation reads it.
 *
 * ---------------------------------------------------------------------------
 * THIS PHASE AND `network:outbound` EXTEND plan.md §4.2 RATHER THAN
 * TRANSCRIBE IT. READ THE ARGUMENT BEFORE MOVING EITHER.
 * ---------------------------------------------------------------------------
 *
 * §4.2's backbone is input -> simulation -> camera-mirror -> chunk-sync ->
 * render -> post-fx -> hud-sync. IT SAYS NOTHING ABOUT NETWORKING — not a
 * phase, not a namespace, not a name a network stage would plausibly use. So
 * these two phases are not a reading of the plan; they are an addition to it,
 * and the header above says an addition to this array is the one edit to this
 * repository expected to carry a written rationale. This is it.
 *
 * ---------------------------------------------------------------------------
 * Why the addition could not be deferred
 * ---------------------------------------------------------------------------
 *
 * mx-multiplayer now registers `multiplayer:inbound` and `multiplayer:outbound`
 * (`mx-multiplayer/stages/registration.ts:188` and `:234`). Before these two
 * phases existed, MEASURED against the real roster, both landed at indices 14
 * and 15 — AFTER `ui:overlay-sync` — because `priorityOf` answers
 * `MAX_SAFE_INTEGER` for a stage in no phase. Remote state applied one frame
 * late, every frame; the local player's position published a frame after the
 * renderer had already drawn it.
 *
 * The decisive point is that DECLINING TO ACT IS NOT NEUTRAL. This table has no
 * "unplaced" state: a stage the skeleton does not claim is not held back, it is
 * scheduled last. Waiting for mx-multiplayer's transport to be finished would
 * not leave the frame undecided, it would ship the wrong answer in the meantime.
 * That asymmetry is why "its stages exist but its socket does not" is not a
 * reason to wait — the frame POSITION depends only on ids and edges, which
 * `mx-multiplayer/stages/stage-ids.ts` states are settled, and not on what the
 * `run` bodies currently do.
 *
 * The cost of being early is bounded and was measured: both phases are empty in
 * any build without mx-multiplayer, and an empty phase closes the chain rather
 * than breaking it (`domain/stage-order.ts` §3). A single-player or headless
 * build resolves to exactly the frame it did before — pinned by
 * `test/e2e/roster-frame-order.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Why TWO phases, and why they claim a stage NAME rather than `multiplayer:`
 * ---------------------------------------------------------------------------
 *
 * One `multiplayer:` NAMESPACE phase cannot express the requirement, and not as
 * a matter of taste: `phaseOf` returns the FIRST phase that admits an id, so a
 * namespace member would claim both stages for one position by construction.
 * The two halves have opposite ordering requirements — receive before the world
 * is simulated, publish after — so any single position is wrong for one of them.
 * The split is the whole point; a namespace phase would undo it.
 *
 * `members` is therefore the stage NAME half (`inbound`, `outbound`), which is
 * also the rule the rest of this table follows: the NAMESPACE says who owns a
 * stage, the NAME says what kind of work it is, and a phase claims a kind of
 * work. These phases are named for network I/O, NOT for mx-multiplayer — a
 * future `sim:inbound` would land here too, exactly as `physics` claims
 * `sim:physics` without mentioning mc-sim.
 *
 * ---------------------------------------------------------------------------
 * Why HERE: after `input`, before `simulation:physics`
 * ---------------------------------------------------------------------------
 *
 * Remote state must be in the world before the world is simulated, or every
 * remote action is one frame stale. That is the same claim about causality
 * `input` makes for local intent, pointed at the far end of a socket, and it is
 * the argument mx-multiplayer states at `stages/stage-ids.ts:59-65`.
 *
 * It also cannot be declared from there, which is why it is here: the
 * requirement is "BEFORE `sim:physics`", `StageRegistration` has `after` and no
 * `before`, and inverting it into `after: [render:input]` would be a claim about
 * the global order that §2.3-3 reserves to this repository — and would be false
 * of a headless build that registers no input stage at all.
 *
 * BE HONEST ABOUT WHAT IS AND IS NOT FORCED. "Before physics" is forced. The
 * choice of AFTER `input` rather than before it is not: both sample the outside
 * world, they touch disjoint state (local input edges vs. a receive queue), and
 * either position satisfies the stated requirement. It is placed second because
 * that is the narrower reading of what mx-multiplayer asked for ("between
 * `STAGE_PHASE_INPUT` and `STAGE_PHASE_SIM_PHYSICS`"), and because if the two
 * ever do interact, the frame is easier to reason about when the local player's
 * intent for this frame is established first and remote state is applied over a
 * known baseline. Moving it to index 0 would not violate anything declared.
 */
export const STAGE_PHASE_NETWORK_INBOUND: StagePhase = stagePhase('network:inbound', 'inbound')

/**
 * Simulation, in six phases.
 *
 * `physics` first: interactions and entities both need this frame's resolved
 * positions. plan.md §3.4 records that in the reference implementation the
 * ground-clamp lives INSIDE the AABB collision resolver and runs AFTER
 * `step()` — reordering that pair is what makes things float. The same class of
 * bug at frame scale is running interactions against last frame's positions.
 *
 * mc-sim registers `sim:physics`; the member below is the stage NAME, so the
 * owning repository's prefix is free to be anything.
 */
export const STAGE_PHASE_SIM_PHYSICS: StagePhase = stagePhase('simulation:physics', 'physics')

/** Player-initiated actions: mining, placing, item use. mx-gameplay's `gameplay:interactions`. */
export const STAGE_PHASE_SIM_INTERACTIONS: StagePhase = stagePhase(
  'simulation:interactions',
  'interactions',
)

/** Mob AI, projectiles, vehicles. After interactions, so mobs see this frame's world. */
export const STAGE_PHASE_SIM_ENTITIES: StagePhase = stagePhase('simulation:entities', 'entities')

/**
 * Fluid propagation. After entities so that a mob that just broke a dam is
 * accounted for in the same frame.
 *
 * plan.md §3.11: the reference implementation capped the propagation frontier
 * per tick (a 37x–55x improvement). That cap belongs INSIDE this phase, in
 * mx-gameplay — not here as a frame-level budget.
 */
export const STAGE_PHASE_SIM_FLUIDS: StagePhase = stagePhase('simulation:fluids', 'fluids')

/**
 * Redstone. After fluids: water breaks redstone dust.
 *
 * The whole `redstone:` namespace, because mx-redstone splits its work into
 * `redstone:power` (a pure recomputation) and `redstone:effects` (the world
 * writes), and BOTH belong in this slot of the frame. Which of the two runs
 * first is mx-redstone's to say — it declares `effects` after `power` — and it
 * is the only repository that can say it. Compose orders phases; a module
 * orders itself within one.
 */
export const STAGE_PHASE_SIM_REDSTONE: StagePhase = stagePhase(
  'simulation:redstone',
  'redstone',
  'redstone:',
)

/** Day/night and weather. Last in simulation: it reads the settled world. */
export const STAGE_PHASE_SIM_TIME_WEATHER: StagePhase = stagePhase(
  'simulation:time-weather',
  'time-weather',
  'weather',
)

/**
 * Publish this frame's settled state to the network.
 *
 * See `STAGE_PHASE_NETWORK_INBOUND` for the argument that these two phases
 * belong in this table at all; this comment is only about the position.
 *
 * LAST IN SIMULATION, FIRST BEFORE PRESENTATION. Two independent reasons, and
 * they happen to name the same slot:
 *
 * 1. WHAT IT PUBLISHES IS FINAL HERE AND NOT BEFORE. `simulation:time-weather`
 *    is the end of simulation — the phase above says so in as many words ("Last
 *    in simulation: it reads the settled world"). Everything after this point is
 *    presentation: mirroring a pose into the THREE camera, meshing, drawing,
 *    post-processing, writing the DOM. None of it changes authoritative state,
 *    so none of it changes what would be sent.
 *
 * 2. EVERYTHING AFTER IT IS LOCAL, AND EXPENSIVE. `render` and `post-fx` are the
 *    frame's largest costs (plan.md §3.9's whole chain lives in one of them).
 *    Publishing after them adds that cost to the latency of state that was
 *    already final at `time-weather` — paying the frame's worst case in network
 *    lag for nothing. Latency that comes from a scheduling choice rather than
 *    from the wire is invisible from inside mx-multiplayer and reads to a player
 *    as a slow connection.
 *
 * Note what this does NOT rest on. `multiplayer:outbound` declares
 * `after: [sim:physics]` (`mx-multiplayer/stages/registration.ts:235`), and that
 * edge alone would be satisfied by ANY position after physics, including the
 * end of the frame. Pinning it to the end of SIMULATION is this table's claim,
 * not mx-multiplayer's, which is exactly the division §2.3-3 draws.
 */
export const STAGE_PHASE_NETWORK_OUTBOUND: StagePhase = stagePhase('network:outbound', 'outbound')

/**
 * Copy the authoritative camera pose out to the renderer's camera.
 *
 * plan.md §3.8 / §5.1-2: **mc-sim owns the camera pose; the THREE camera is a
 * mirror.** The reference implementation had this inverted — the THREE camera
 * was authoritative and the simulation read its view direction back out, which
 * is the root of the chronic "don't read camera.position, use matrixWorld"
 * gotcha. This phase exists to make the direction of that copy a named,
 * ordered, single event.
 */
export const STAGE_PHASE_CAMERA_MIRROR: StagePhase = stagePhase('camera-mirror', 'camera-mirror')

/** Push dirty chunks to the mesher. After simulation, before render. */
export const STAGE_PHASE_CHUNK_SYNC: StagePhase = stagePhase('chunk-sync', 'chunk-sync', 'mesh-sync')

/**
 * Draw. mc-render.
 *
 * `draw` as well as `render`, because mc-kernel's own worked example of the id
 * convention is `render:draw` (`mc-kernel/domain/identifiers.ts:26`). A
 * skeleton that did not admit the vocabulary's own example would be repeating
 * the bug this table was rewritten to fix.
 */
export const STAGE_PHASE_RENDER: StagePhase = stagePhase('render', 'render', 'draw')

/**
 * Post-processing chain.
 *
 * plan.md §3.9 fixes the INTERNAL order of this phase:
 * RenderPass -> GTAO -> GodRays -> Bloom -> Bokeh(DoF) -> SMAA -> Output.
 * That order is mc-render's business, not this table's — this table only says
 * post-fx comes after render and before the HUD.
 */
export const STAGE_PHASE_POST_FX: StagePhase = stagePhase('post-fx', 'post-fx')

/**
 * Update the DOM HUD from settled state. mx-ui. Last: it reads, it does not decide.
 *
 * The whole `ui:` namespace: mx-ui registers `ui:hud-sync` and
 * `ui:overlay-sync`, and both are end-of-frame presentation. As with redstone,
 * their relative order is mx-ui's own `after` edge to declare.
 */
export const STAGE_PHASE_HUD_SYNC: StagePhase = stagePhase('hud-sync', 'hud-sync', 'ui:')

/**
 * The skeleton, in order — plan.md §4.2, plus the two network phases §4.2 does
 * not mention:
 *
 *   input
 *   -> network:inbound                                          [EXTENSION]
 *   -> simulation (physics -> interactions -> entities -> fluids -> redstone -> time/weather)
 *   -> network:outbound                                         [EXTENSION]
 *   -> camera-mirror
 *   -> chunk-sync
 *   -> render
 *   -> post-fx
 *   -> hud-sync
 *
 * The two marked phases are an EXTENSION of §4.2's backbone, not a reading of
 * it: §4.2 has twelve phases and none of them is about networking. The argument
 * for adding them, for their positions, and for why there are two rather than
 * one is at `STAGE_PHASE_NETWORK_INBOUND` and `STAGE_PHASE_NETWORK_OUTBOUND`.
 * docs/architecture.md §4.3 carries the same table and the same distinction.
 *
 * CHANGING THIS ARRAY CHANGES THE GAME. It is the one edit to this repository
 * that is expected to need a written rationale in the pull request.
 */
export const STANDARD_STAGE_SKELETON: ReadonlyArray<StagePhase> = [
  STAGE_PHASE_INPUT,
  STAGE_PHASE_NETWORK_INBOUND,
  STAGE_PHASE_SIM_PHYSICS,
  STAGE_PHASE_SIM_INTERACTIONS,
  STAGE_PHASE_SIM_ENTITIES,
  STAGE_PHASE_SIM_FLUIDS,
  STAGE_PHASE_SIM_REDSTONE,
  STAGE_PHASE_SIM_TIME_WEATHER,
  STAGE_PHASE_NETWORK_OUTBOUND,
  STAGE_PHASE_CAMERA_MIRROR,
  STAGE_PHASE_CHUNK_SYNC,
  STAGE_PHASE_RENDER,
  STAGE_PHASE_POST_FX,
  STAGE_PHASE_HUD_SYNC,
]

/** The six simulation phases, for tests and for documentation generation. */
export const SIMULATION_PHASES: ReadonlyArray<StagePhase> = [
  STAGE_PHASE_SIM_PHYSICS,
  STAGE_PHASE_SIM_INTERACTIONS,
  STAGE_PHASE_SIM_ENTITIES,
  STAGE_PHASE_SIM_FLUIDS,
  STAGE_PHASE_SIM_REDSTONE,
  STAGE_PHASE_SIM_TIME_WEATHER,
]

// ---------------------------------------------------------------------------
// The canonical stage id of each phase
// ---------------------------------------------------------------------------
//
// A phase's name IS a stage id: it is what a module owning a whole phase
// registers, and what `domain/modding.ts` reserves against a mod claiming it.
// Derived from the phases rather than written a second time, so the two cannot
// drift apart the way the skeleton and the modules' real ids did.

/** @see STAGE_PHASE_INPUT */
export const STAGE_INPUT: StageId = StageId(STAGE_PHASE_INPUT.name)
/** @see STAGE_PHASE_NETWORK_INBOUND */
export const STAGE_NETWORK_INBOUND: StageId = StageId(STAGE_PHASE_NETWORK_INBOUND.name)
/** @see STAGE_PHASE_SIM_PHYSICS */
export const STAGE_SIM_PHYSICS: StageId = StageId(STAGE_PHASE_SIM_PHYSICS.name)
/** @see STAGE_PHASE_SIM_INTERACTIONS */
export const STAGE_SIM_INTERACTIONS: StageId = StageId(STAGE_PHASE_SIM_INTERACTIONS.name)
/** @see STAGE_PHASE_SIM_ENTITIES */
export const STAGE_SIM_ENTITIES: StageId = StageId(STAGE_PHASE_SIM_ENTITIES.name)
/** @see STAGE_PHASE_SIM_FLUIDS */
export const STAGE_SIM_FLUIDS: StageId = StageId(STAGE_PHASE_SIM_FLUIDS.name)
/** @see STAGE_PHASE_SIM_REDSTONE */
export const STAGE_SIM_REDSTONE: StageId = StageId(STAGE_PHASE_SIM_REDSTONE.name)
/** @see STAGE_PHASE_SIM_TIME_WEATHER */
export const STAGE_SIM_TIME_WEATHER: StageId = StageId(STAGE_PHASE_SIM_TIME_WEATHER.name)
/** @see STAGE_PHASE_NETWORK_OUTBOUND */
export const STAGE_NETWORK_OUTBOUND: StageId = StageId(STAGE_PHASE_NETWORK_OUTBOUND.name)
/** @see STAGE_PHASE_CAMERA_MIRROR */
export const STAGE_CAMERA_MIRROR: StageId = StageId(STAGE_PHASE_CAMERA_MIRROR.name)
/** @see STAGE_PHASE_CHUNK_SYNC */
export const STAGE_CHUNK_SYNC: StageId = StageId(STAGE_PHASE_CHUNK_SYNC.name)
/** @see STAGE_PHASE_RENDER */
export const STAGE_RENDER: StageId = StageId(STAGE_PHASE_RENDER.name)
/** @see STAGE_PHASE_POST_FX */
export const STAGE_POST_FX: StageId = StageId(STAGE_PHASE_POST_FX.name)
/** @see STAGE_PHASE_HUD_SYNC */
export const STAGE_HUD_SYNC: StageId = StageId(STAGE_PHASE_HUD_SYNC.name)

/** The canonical id of each simulation phase, in order. */
export const SIMULATION_STAGES: ReadonlyArray<StageId> = SIMULATION_PHASES.map((phase) =>
  StageId(phase.name),
)
