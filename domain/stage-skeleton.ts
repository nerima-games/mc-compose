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
 * The skeleton is a SKELETON, not the order
 * ---------------------------------------------------------------------------
 *
 * The list below is not the frame. The frame is whatever
 * `resolveStageOrder` produces from the registrations of the modules that are
 * actually loaded, using this list for two things:
 *
 * - implicit ordering edges between the skeleton stages that ARE registered,
 *   closing over any that are not;
 * - the primary tie-break between stages that have no ordering relation.
 *
 * A build with no redstone module still runs entities before time/weather. A
 * module that registers a stage not on this list still gets a deterministic
 * position — after every skeleton stage it is not explicitly ordered against,
 * and lexicographically among its peers.
 *
 * ---------------------------------------------------------------------------
 * Why THIS order
 * ---------------------------------------------------------------------------
 *
 * Each edge below is a claim about causality within one frame. They are written
 * out because "it was like that in the reference implementation" is not a
 * reason, and because changing one of them silently changes the game.
 */
import { StageId } from './stage-order'

/** Read input before anything reacts to it, so a frame acts on this frame's input. */
export const STAGE_INPUT = StageId('input')

/**
 * Simulation, in six steps.
 *
 * `physics` first: interactions and entities both need this frame's resolved
 * positions. plan.md §3.4 records that in the reference implementation the
 * ground-clamp lives INSIDE the AABB collision resolver and runs AFTER
 * `step()` — reordering that pair is what makes things float. The same class of
 * bug at frame scale is running interactions against last frame's positions.
 */
export const STAGE_SIM_PHYSICS = StageId('simulation:physics')

/** Player-initiated actions: mining, placing, item use. mx-gameplay. */
export const STAGE_SIM_INTERACTIONS = StageId('simulation:interactions')

/** Mob AI, projectiles, vehicles. After interactions, so mobs see this frame's world. */
export const STAGE_SIM_ENTITIES = StageId('simulation:entities')

/**
 * Fluid propagation. After entities so that a mob that just broke a dam is
 * accounted for in the same frame.
 *
 * plan.md §3.11: the reference implementation capped the propagation frontier
 * per tick (a 37x–55x improvement). That cap belongs INSIDE this stage, in
 * mx-gameplay — not here as a frame-level budget.
 */
export const STAGE_SIM_FLUIDS = StageId('simulation:fluids')

/** Redstone power graph. mx-redstone. After fluids: water breaks redstone dust. */
export const STAGE_SIM_REDSTONE = StageId('simulation:redstone')

/** Day/night and weather. Last in simulation: it reads the settled world. */
export const STAGE_SIM_TIME_WEATHER = StageId('simulation:time-weather')

/**
 * Copy the authoritative camera pose out to the renderer's camera.
 *
 * plan.md §3.8 / §5.1-2: **mc-sim owns the camera pose; the THREE camera is a
 * mirror.** The reference implementation had this inverted — the THREE camera
 * was authoritative and the simulation read its view direction back out, which
 * is the root of the chronic "don't read camera.position, use matrixWorld"
 * gotcha. This stage exists to make the direction of that copy a named,
 * ordered, single event.
 */
export const STAGE_CAMERA_MIRROR = StageId('camera-mirror')

/** Push dirty chunks to the mesher. After simulation, before render. */
export const STAGE_CHUNK_SYNC = StageId('chunk-sync')

/** Draw. mc-render. */
export const STAGE_RENDER = StageId('render')

/**
 * Post-processing chain.
 *
 * plan.md §3.9 fixes the INTERNAL order of this stage:
 * RenderPass -> GTAO -> GodRays -> Bloom -> Bokeh(DoF) -> SMAA -> Output.
 * That order is mc-render's business, not this table's — this table only says
 * post-fx comes after render and before the HUD.
 */
export const STAGE_POST_FX = StageId('post-fx')

/** Update the DOM HUD from settled state. mx-ui. Last: it reads, it does not decide. */
export const STAGE_HUD_SYNC = StageId('hud-sync')

/**
 * The skeleton, in order (plan.md §4.2):
 *
 *   input
 *   -> simulation (physics -> interactions -> entities -> fluids -> redstone -> time/weather)
 *   -> camera-mirror
 *   -> chunk-sync
 *   -> render
 *   -> post-fx
 *   -> hud-sync
 *
 * CHANGING THIS ARRAY CHANGES THE GAME. It is the one edit to this repository
 * that is expected to need a written rationale in the pull request.
 */
export const STANDARD_STAGE_SKELETON: ReadonlyArray<StageId> = [
  STAGE_INPUT,
  STAGE_SIM_PHYSICS,
  STAGE_SIM_INTERACTIONS,
  STAGE_SIM_ENTITIES,
  STAGE_SIM_FLUIDS,
  STAGE_SIM_REDSTONE,
  STAGE_SIM_TIME_WEATHER,
  STAGE_CAMERA_MIRROR,
  STAGE_CHUNK_SYNC,
  STAGE_RENDER,
  STAGE_POST_FX,
  STAGE_HUD_SYNC,
]

/** The six simulation stages, for tests and for documentation generation. */
export const SIMULATION_STAGES: ReadonlyArray<StageId> = [
  STAGE_SIM_PHYSICS,
  STAGE_SIM_INTERACTIONS,
  STAGE_SIM_ENTITIES,
  STAGE_SIM_FLUIDS,
  STAGE_SIM_REDSTONE,
  STAGE_SIM_TIME_WEATHER,
]
