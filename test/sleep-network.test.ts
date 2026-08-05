import { PlayerId, WorldId, type SurvivalActorState, type SurvivalSnapshot } from '@nerima-games/mx-multiplayer'
import { describe, expect, it } from 'vitest'

import {
  SleepAuthority,
  applySleepCommandResult,
  applySleepEvents,
  decodeSleepWireMessage,
  initialSleepClientState,
  queueSleepCommand,
  SLEEP_MAX_IDENTIFIER_LENGTH,
  SLEEP_MAX_WIRE_LENGTH,
  sleepClientFromSnapshot,
  type SleepCommand,
} from '../apps/multiplayer-shared/sleep-network'

const alice = PlayerId.make('alice')
const bob = PlayerId.make('bob')
const bed = { x: 0, y: 64, z: 1 } as const
const actor = (player: typeof alice, session: string): SurvivalActorState => ({
  player,
  session,
  position: { x: 0, y: 64, z: 0 },
  gameMode: 'survival',
  inventory: [],
  health: 20,
  spawn: { x: 0, y: 64, z: 0 },
  lastActionTick: 0,
})
const snapshot = (...actors: ReadonlyArray<SurvivalActorState>): SurvivalSnapshot => ({
  world: WorldId.make('overworld'),
  revision: 0,
  actors,
  blocks: { '0,64,1': 'bed' },
  drops: [],
})
const command = (player: typeof alice, session: string, requestId: string, expectedRevision: number): SleepCommand => ({
  _tag: 'EnterSleep',
  actor: player,
  session,
  requestId,
  expectedRevision,
  clientTick: 5,
  bed,
})
const options = (sleepPercentage = 100) => ({
  sleepPercentage,
  validateSleep: () => ({ dimension: 'overworld', bedValid: true, nightOrThunder: true, safe: true }),
})

describe('authoritative sleep network adapter', () => {
  it('decodes complete authoritative sleep messages', () => {
    const message = { _tag: 'SleepSnapshot', snapshot: snapshot(actor(alice, 'a')) } as const
    expect(decodeSleepWireMessage(JSON.stringify(message))).toEqual(message)
  })

  it('rejects malformed nested authoritative messages', () => {
    const malformedSnapshot = { _tag: 'SleepSnapshot', snapshot: { ...snapshot(actor(alice, 'a')), actors: [{ ...actor(alice, 'a'), health: 'full' }] } }
    const malformedEvents = { _tag: 'SleepEvents', revision: 1, events: [{ _tag: 'ActorSleepChanged', actor: 'alice', sleeping: { dimension: 'overworld', bed: { x: 0, y: 'high', z: 1 } } }] }
    const malformedResult = { _tag: 'SleepCommandResult', result: { accepted: false, requestId: 'sleep-a', revision: 1, reason: 'unexpected' } }

    expect(decodeSleepWireMessage(JSON.stringify(malformedSnapshot))).toBeUndefined()
    expect(decodeSleepWireMessage(JSON.stringify(malformedEvents))).toBeUndefined()
    expect(decodeSleepWireMessage(JSON.stringify(malformedResult))).toBeUndefined()
  })

  it('rejects oversized sleep wires and command identifiers', () => {
    const base = {
      _tag: 'SleepCommand',
      command: {
        _tag: 'EnterSleep', actor: 'alice', session: 'session-a', requestId: 'sleep-size',
        expectedRevision: 0, clientTick: 5, bed,
      },
    }
    for (const key of ['actor', 'session', 'requestId'] as const) {
      const wire = JSON.stringify({ ...base, command: { ...base.command, [key]: 'x'.repeat(SLEEP_MAX_IDENTIFIER_LENGTH + 1) } })
      expect(decodeSleepWireMessage(wire)).toBeUndefined()
    }
    const oversized = `${JSON.stringify(base)}${' '.repeat(SLEEP_MAX_WIRE_LENGTH)}`
    expect(oversized.length).toBeGreaterThan(SLEEP_MAX_WIRE_LENGTH)
    expect(decodeSleepWireMessage(oversized)).toBeUndefined()
  })

  it('does not apply local sleep until the server accepts it', () => {
    const pending = queueSleepCommand(initialSleepClientState(), command(alice, 'a', 'sleep-a', 0))
    expect(pending.sleepers.size).toBe(0)
    const authority = new SleepAuthority(snapshot(actor(alice, 'a')), options())
    const result = authority.execute(command(alice, 'a', 'sleep-a', 0))
    const applied = applySleepCommandResult(pending, result)
    expect(applied.sleepers.size).toBe(0)
    expect(applied.skippedRevision).toBe(1)
    expect(applied.pending.size).toBe(0)
  })

  it('uses ceil threshold for multiple actors and simultaneous revision ordering', () => {
    const authority = new SleepAuthority(snapshot(actor(alice, 'a'), actor(bob, 'b')), options(100))
    const first = authority.execute(command(alice, 'a', 'sleep-a', 0))
    expect(first).toMatchObject({ accepted: true, revision: 1 })
    if (!first.accepted) throw new Error('first sleep rejected')
    expect(first.events).toContainEqual({ _tag: 'SleepProgress', sleeping: 1, required: 2, connected: 2, ready: false })
    expect(authority.execute(command(bob, 'b', 'stale-b', 0))).toMatchObject({ accepted: false, reason: 'stale-revision' })
    const second = authority.execute(command(bob, 'b', 'sleep-b', 1))
    expect(second).toMatchObject({ accepted: true, revision: 2 })
    if (!second.accepted) throw new Error('second sleep rejected')
    expect(second.events.filter((event) => event._tag === 'NightSkipped')).toHaveLength(1)
  })

  it('rolls back rejected requests without changing authoritative sleepers', () => {
    const queued = queueSleepCommand(initialSleepClientState(), command(alice, 'wrong', 'rejected', 0))
    const result = new SleepAuthority(snapshot(actor(alice, 'a')), options()).execute(command(alice, 'wrong', 'rejected', 0))
    const applied = applySleepCommandResult(queued, result)
    expect(applied.sleepers.size).toBe(0)
    expect(applied.pending.size).toBe(0)
    expect(applied.rejection).toMatchObject({ accepted: false, reason: 'session-mismatch' })
  })

  it('applies duplicate night skip only once per revision', () => {
    const event = { _tag: 'NightSkipped', sleeping: 1, required: 1 } as const
    const once = applySleepEvents(initialSleepClientState(), 4, [event])
    const twice = applySleepEvents(once, 4, [event])
    expect(twice).toEqual(once)
  })

  it('removes sleepers on disconnect and restores snapshot state on rejoin', () => {
    const authority = new SleepAuthority(snapshot(actor(alice, 'a'), actor(bob, 'b')), options(100))
    authority.execute(command(alice, 'a', 'sleep-a', 0))
    expect(authority.disconnect(alice)).toContainEqual(expect.objectContaining({ _tag: 'ActorSleepChanged', actor: alice, sleeping: null }))

    const sleepingBob = { ...actor(bob, 'old'), sleeping: { dimension: 'overworld', bed } }
    const restoredAuthority = new SleepAuthority({ ...snapshot(sleepingBob), revision: 7 }, options())
    expect(restoredAuthority.rejoin(bob, 'old', 'new')).toBe(true)
    const restored = sleepClientFromSnapshot(restoredAuthority.snapshot())
    expect(restored.revision).toBe(7)
    expect(restored.sleepers.get(bob)).toEqual({ dimension: 'overworld', bed })
  })
})
