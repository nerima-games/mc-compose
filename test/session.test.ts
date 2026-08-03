import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  currentWorld,
  holdsWorldResources,
  initialSessionState,
  isSimulating,
  roundTripEvents,
  runSession,
  transition,
  WorldId,
  type SessionEvent,
  type SessionState,
} from '../src/domain/session'

const overworld = WorldId('overworld')
const second = WorldId('second-world')

const inGame: SessionState = { _tag: 'InGame', world: overworld }

describe('the happy path', () => {
  it.effect('goes Title -> Loading -> InGame', () =>
    Effect.sync(() => {
      const { state, rejectedAt } = runSession(initialSessionState, [
        { _tag: 'WorldSelected', world: overworld },
        { _tag: 'LoadSucceeded' },
      ])

      expect(rejectedAt).toBeUndefined()
      expect(state).toStrictEqual(inGame)
    }),
  )

  it.effect('simulates only in InGame — Paused draws but does not advance', () =>
    Effect.sync(() => {
      expect(isSimulating(initialSessionState)).toBe(false)
      expect(isSimulating({ _tag: 'Loading', world: overworld })).toBe(false)
      expect(isSimulating(inGame)).toBe(true)
      expect(isSimulating({ _tag: 'Paused', world: overworld })).toBe(false)
      expect(isSimulating({ _tag: 'Unloading', world: overworld })).toBe(false)
    }),
  )

  it.effect('pauses and resumes without touching the world', () =>
    Effect.sync(() => {
      const { state } = runSession(initialSessionState, [
        { _tag: 'WorldSelected', world: overworld },
        { _tag: 'LoadSucceeded' },
        { _tag: 'PauseRequested' },
        { _tag: 'ResumeRequested' },
      ])
      expect(state).toStrictEqual(inGame)
    }),
  )

  it.effect('reports which world each state concerns', () =>
    Effect.sync(() => {
      expect(currentWorld(initialSessionState)).toBeUndefined()
      expect(currentWorld(inGame)).toBe(overworld)
      expect(currentWorld({ _tag: 'Unloading', world: overworld })).toBe(overworld)
    }),
  )
})

describe('teardown cannot be skipped', () => {
  // REGRESSION — THE reason this machine exists. plan.md §3.8:
  // "参照実装では2周目ワールドのデッドロック/やり残しfiberが最大級のバグ源だった".
  // A direct InGame -> Title edge is how teardown gets forgotten: quitting
  // looks like it worked, and the leaked fibers only show up on the SECOND
  // world.
  it.effect('has no edge from InGame straight to Title', () =>
    Effect.sync(() => {
      const afterQuit = transition(inGame, { _tag: 'QuitToTitleRequested' })
      expect(afterQuit).toStrictEqual({ _tag: 'Unloading', world: overworld })
      expect(afterQuit?._tag).not.toBe('Title')
    }),
  )

  it.effect('reaches Title only through TeardownCompleted', () =>
    Effect.sync(() => {
      const unloading: SessionState = { _tag: 'Unloading', world: overworld }

      expect(transition(unloading, { _tag: 'TeardownCompleted' })).toStrictEqual({
        _tag: 'Title',
        lastError: undefined,
      })

      for (const event of [
        { _tag: 'WorldSelected', world: second },
        { _tag: 'LoadSucceeded' },
        { _tag: 'PauseRequested' },
        { _tag: 'ResumeRequested' },
        { _tag: 'QuitToTitleRequested' },
      ] satisfies ReadonlyArray<SessionEvent>) {
        expect(transition(unloading, event)).toBeUndefined()
      }
    }),
  )

  // REGRESSION: a load that failed has still allocated something. Sending it
  // straight back to Title is how a failed first attempt poisons the second.
  it.effect('routes a failed load through teardown too', () =>
    Effect.sync(() => {
      const { state } = runSession(initialSessionState, [
        { _tag: 'WorldSelected', world: overworld },
        { _tag: 'LoadFailed', reason: 'chunk decode failed' },
      ])
      expect(state).toStrictEqual({ _tag: 'Unloading', world: overworld })
    }),
  )

  it.effect('reports that world resources are held in every state except Title', () =>
    Effect.sync(() => {
      expect(holdsWorldResources(initialSessionState)).toBe(false)
      expect(holdsWorldResources({ _tag: 'Loading', world: overworld })).toBe(true)
      expect(holdsWorldResources(inGame)).toBe(true)
      expect(holdsWorldResources({ _tag: 'Paused', world: overworld })).toBe(true)
      expect(holdsWorldResources({ _tag: 'Unloading', world: overworld })).toBe(true)
    }),
  )
})

describe('the second world', () => {
  // REGRESSION — "loading a world once works in every implementation".
  // title -> game -> title -> game is what surfaces leaked fibers, singletons
  // that can only initialise once, and an autosave schedule still running
  // against a world that is gone.
  it.effect('completes a full title -> game -> title round trip', () =>
    Effect.sync(() => {
      const { state, rejectedAt } = runSession(initialSessionState, roundTripEvents(overworld))
      expect(rejectedAt).toBeUndefined()
      expect(state).toStrictEqual({ _tag: 'Title', lastError: undefined })
    }),
  )

  it.effect('reaches InGame on the second world exactly as on the first', () =>
    Effect.sync(() => {
      const { state, rejectedAt } = runSession(initialSessionState, [
        ...roundTripEvents(overworld),
        { _tag: 'WorldSelected', world: second },
        { _tag: 'LoadSucceeded' },
      ])

      expect(rejectedAt).toBeUndefined()
      expect(state).toStrictEqual({ _tag: 'InGame', world: second })
    }),
  )

  it.effect('survives ten round trips with no accumulated state', () =>
    Effect.sync(() => {
      const events = Array.from({ length: 10 }, (_, index) =>
        roundTripEvents(WorldId(`world-${String(index)}`)),
      ).flat()

      const { state, rejectedAt } = runSession(initialSessionState, events)
      expect(rejectedAt).toBeUndefined()
      expect(state).toStrictEqual(initialSessionState)
    }),
  )
})

describe('illegal transitions', () => {
  // As in mx-multiplayer's connection machine: `undefined` means "not legal
  // here". Returning the unchanged state would make "nothing to do" and
  // "incoherent request" indistinguishable, and the machine advisory.
  it.effect('returns undefined rather than silently absorbing an impossible event', () =>
    Effect.sync(() => {
      expect(transition(initialSessionState, { _tag: 'LoadSucceeded' })).toBeUndefined()
      expect(transition(initialSessionState, { _tag: 'PauseRequested' })).toBeUndefined()
      expect(transition(initialSessionState, { _tag: 'TeardownCompleted' })).toBeUndefined()
      expect(transition(inGame, { _tag: 'ResumeRequested' })).toBeUndefined()
      expect(transition(inGame, { _tag: 'WorldSelected', world: second })).toBeUndefined()
    }),
  )

  // REGRESSION: selecting a second world while one is loaded must not start a
  // second load on top of the first. That is the same class of bug as
  // mx-multiplayer's reconnect storm.
  it.effect('refuses to start a second world without unloading the first', () =>
    Effect.sync(() => {
      const { state, rejectedAt } = runSession(initialSessionState, [
        { _tag: 'WorldSelected', world: overworld },
        { _tag: 'LoadSucceeded' },
        { _tag: 'WorldSelected', world: second },
      ])

      expect(rejectedAt).toBe(2)
      expect(state).toStrictEqual(inGame)
    }),
  )

  it.effect('reports the index at which a sequence became incoherent', () =>
    Effect.sync(() => {
      const { rejectedAt } = runSession(initialSessionState, [
        { _tag: 'WorldSelected', world: overworld },
        { _tag: 'LoadSucceeded' },
        { _tag: 'PauseRequested' },
        { _tag: 'PauseRequested' },
      ])
      expect(rejectedAt).toBe(3)
    }),
  )
})

describe('WorldId', () => {
  it.effect('rejects a blank world id', () =>
    Effect.sync(() => {
      expect(() => WorldId('')).toThrow()
      expect(() => WorldId('  ')).toThrow()
    }),
  )
})
