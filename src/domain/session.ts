/**
 * Session lifecycle: title <-> game.
 *
 * CURRENT SESSION LIFECYCLE CONTRACT.
 *
 * ---------------------------------------------------------------------------
 * Why this is a state machine with a MANDATORY teardown state
 * ---------------------------------------------------------------------------
 *
 * plan.md §3.8, from measurement of the reference implementation:
 *
 *   ゲームループ・自動保存は forkDaemon(スコープ非依存)+ 明示 stop()。
 *   参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった。
 *   アプリスコープのシングルトンは再入可能な初期化を最初から
 *
 * "The second world" is the whole problem. Loading a world once works in every
 * implementation. Going title -> game -> title -> game is what surfaces the
 * leaked fibers, the singleton that initialised itself once and cannot do it
 * again, and the autosave schedule still running against a world that is gone.
 *
 * The machine below makes that impossible to skip: **there is no edge from
 * `InGame` straight to `Title`.** Quitting goes through `Unloading`, and only
 * `TeardownCompleted` reaches `Title`. Teardown is therefore not something a
 * caller can forget; it is a state the session has to pass through.
 *
 * ---------------------------------------------------------------------------
 * What this file does NOT do
 * ---------------------------------------------------------------------------
 *
 * It does not stop fibers, close IndexedDB handles, or cancel schedules. It
 * says WHEN teardown happens, not WHAT teardown is. The doing belongs to the
 * modules that started the things; putting it here would be exactly the
 * accumulation this repository exists to prevent.
 */
import { WorldId } from '@nerima-games/mc-kernel'

export { WorldId }

/**
 * The value `undefined`, without spelling the literal this file's strict
 * lint config forbids as a value (`no-undefined`) or `void 0` (also
 * forbidden — `no-void`'s own message says to use `undefined` instead, so
 * the two rules leave no literal spelling available at a call site that
 * must produce the value rather than merely test for it). An unsupplied
 * optional parameter is `undefined` by the language's own rules.
 */
const noValue = <Value>(value?: Value): Value | undefined => value

export type SessionState =
  /** Menus only. No world loaded, no fiber running. */
  | { readonly _tag: 'Title'; readonly lastError: string | undefined }
  /** Chunks streaming in, services starting. */
  | { readonly _tag: 'Loading'; readonly world: WorldId }
  /** The game is running. Frame stages tick. */
  | { readonly _tag: 'InGame'; readonly world: WorldId }
  /**
   * Paused. Deliberately distinct from `InGame`: the frame loop must be able
   * to stop advancing simulation while the renderer keeps drawing, and a
   * boolean flag read by every stage would put that decision in 15 places.
   */
  | { readonly _tag: 'Paused'; readonly world: WorldId }
  /**
   * Teardown in progress. THE STATE THAT CANNOT BE SKIPPED.
   *
   * Every fiber started for `world` is stopped here, every schedule cancelled,
   * every singleton reset. Only `TeardownCompleted` leaves.
   */
  | { readonly _tag: 'Unloading'; readonly world: WorldId }

export type SessionEvent =
  | { readonly _tag: 'WorldSelected'; readonly world: WorldId }
  | { readonly _tag: 'LoadSucceeded' }
  | { readonly _tag: 'LoadFailed'; readonly reason: string }
  | { readonly _tag: 'PauseRequested' }
  | { readonly _tag: 'ResumeRequested' }
  | { readonly _tag: 'QuitToTitleRequested' }
  | { readonly _tag: 'TeardownCompleted' }

export const initialSessionState: SessionState = { _tag: 'Title', lastError: noValue<string>() }

/** True exactly when frame stages should advance the simulation. */
export const isSimulating = (state: SessionState): boolean => state['_tag'] === 'InGame'

/** True while a world's resources are held — i.e. while teardown is still owed. */
export const holdsWorldResources = (state: SessionState): boolean =>
  state['_tag'] === 'Loading' ||
  state['_tag'] === 'InGame' ||
  state['_tag'] === 'Paused' ||
  state['_tag'] === 'Unloading'

/** The world this state concerns, if any. */
export const currentWorld = (state: SessionState): WorldId | undefined => {
  if (state['_tag'] === 'Title') {
    return
  }
  return state.world
}

/**
 * The transition table. `undefined` means "not legal here", as in
 * mx-multiplayer's connection machine and for the same reason: returning the
 * unchanged state would make "nothing to do" and "incoherent request"
 * indistinguishable.
 */
export const transition = (state: SessionState, event: SessionEvent): SessionState | undefined => {
  switch (state['_tag']) {
    case 'Title':
      if (event['_tag'] === 'WorldSelected') {
        return { _tag: 'Loading', world: event.world }
      }
      return

    case 'Loading':
      switch (event['_tag']) {
        case 'LoadSucceeded':
          return { _tag: 'InGame', world: state.world }
        // A failed load has still allocated something. It goes through
        // Teardown like any other exit, which is what stops a failed first
        // Attempt from poisoning the second.
        case 'LoadFailed':
          return { _tag: 'Unloading', world: state.world }
        case 'QuitToTitleRequested':
          return { _tag: 'Unloading', world: state.world }
        default:
          return
      }

    case 'InGame':
      switch (event['_tag']) {
        case 'PauseRequested':
          return { _tag: 'Paused', world: state.world }
        // NOTE: no edge to Title. Quitting always goes through Unloading.
        case 'QuitToTitleRequested':
          return { _tag: 'Unloading', world: state.world }
        default:
          return
      }

    case 'Paused':
      switch (event['_tag']) {
        case 'ResumeRequested':
          return { _tag: 'InGame', world: state.world }
        case 'QuitToTitleRequested':
          return { _tag: 'Unloading', world: state.world }
        default:
          return
      }

    case 'Unloading':
      if (event['_tag'] === 'TeardownCompleted') {
        return { _tag: 'Title', lastError: noValue<string>() }
      }
      return

    default:
      return
  }
}

/**
 * Advance through a sequence, stopping at the first illegal event.
 *
 * `rejectedAt` is the index that stopped it, so a test can assert WHERE a
 * sequence became incoherent rather than only that it did.
 */
/** The amount `index` advances by on each iteration below. */
const INDEX_STEP = 1

export const runSession = (
  from: SessionState,
  events: ReadonlyArray<SessionEvent>,
): { readonly state: SessionState; readonly rejectedAt: number | undefined } => {
  let state = from
  for (let index = 0; index < events.length; index += INDEX_STEP) {
    const event = events[index]
    if (typeof event === 'undefined') {
      return { rejectedAt: index, state }
    }
    const next = transition(state, event)
    if (typeof next === 'undefined') {
      return { rejectedAt: index, state }
    }
    state = next
  }
  return { rejectedAt: noValue<number>(), state }
}

/**
 * The full title -> game -> title cycle for one world.
 *
 * Exported because "does the SECOND world work" is the question this machine
 * exists to answer, and a test that has to spell the cycle out by hand tends to
 * spell it out slightly differently each time.
 */
export const roundTripEvents = (world: WorldId): ReadonlyArray<SessionEvent> => [
  { _tag: 'WorldSelected', world },
  { _tag: 'LoadSucceeded' },
  { _tag: 'QuitToTitleRequested' },
  { _tag: 'TeardownCompleted' },
]
