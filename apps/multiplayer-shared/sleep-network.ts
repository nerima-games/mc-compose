/* eslint-disable max-lines, no-magic-numbers -- Sleep synchronization is a small protocol adapter with explicit boundary validation. */
import {
  SurvivalAuthority,
  type PlayerId,
  type SurvivalActorState,
  type SurvivalCommand,
  type SurvivalCommandResult,
  type SurvivalEvent,
  type SurvivalItemStack,
  type SurvivalPosition,
  type SurvivalSleepState,
  type SurvivalSnapshot,
  type SurvivalAuthorityOptions,
} from '@nerima-games/mx-multiplayer'

export type SleepCommand = Extract<SurvivalCommand, { readonly _tag: 'EnterSleep' | 'LeaveSleep' }>

export type SleepWireMessage =
  | { readonly _tag: 'SleepCommand'; readonly command: SleepCommand }
  | { readonly _tag: 'SleepCommandResult'; readonly result: SurvivalCommandResult }
  | { readonly _tag: 'SleepSnapshot'; readonly snapshot: SurvivalSnapshot }
  | { readonly _tag: 'SleepEvents'; readonly revision: number; readonly events: ReadonlyArray<SurvivalEvent> }

export const SLEEP_MAX_WIRE_LENGTH = 1_048_576
export const SLEEP_MAX_IDENTIFIER_LENGTH = 128

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const isIdentifier = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= SLEEP_MAX_IDENTIFIER_LENGTH
  && !/\p{Cc}/u.test(value)

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)

const isPosition = (value: unknown): value is SurvivalPosition =>
  isRecord(value) && isFiniteInteger(value['x']) && isFiniteInteger(value['y']) && isFiniteInteger(value['z'])

const isItemStack = (value: unknown): value is SurvivalItemStack =>
  isRecord(value) && typeof value['item'] === 'string' && isFiniteInteger(value['count']) && value['count'] > 0

const isDrop = (value: unknown): boolean =>
  isRecord(value) && typeof value['item'] === 'string' && isFiniteInteger(value['count']) && value['count'] > 0 && isPosition(value['at'])

const isSleepState = (value: unknown): value is SurvivalSleepState =>
  isRecord(value) && typeof value['dimension'] === 'string' && isPosition(value['bed'])

const isActorState = (value: unknown): value is SurvivalActorState =>
  isRecord(value)
  && isIdentifier(value['player'])
  && isIdentifier(value['session'])
  && isPosition(value['position'])
  && (value['gameMode'] === 'survival' || value['gameMode'] === 'creative' || value['gameMode'] === 'spectator')
  && Array.isArray(value['inventory'])
  && value['inventory'].every((stack) => stack === null || isItemStack(stack))
  && typeof value['health'] === 'number'
  && Number.isFinite(value['health'])
  && isPosition(value['spawn'])
  && isFiniteInteger(value['lastActionTick'])
  && (value['sleeping'] === undefined || isSleepState(value['sleeping']))

const isSurvivalEvent = (value: unknown): value is SurvivalEvent => {
  if (!isRecord(value)) return false
  if (value['_tag'] === 'InventoryChanged') {
    return isIdentifier(value['actor']) && isFiniteInteger(value['slot']) && (value['stack'] === null || isItemStack(value['stack']))
  }
  if (value['_tag'] === 'BlockChanged') return isPosition(value['at']) && (value['block'] === null || typeof value['block'] === 'string')
  if (value['_tag'] === 'ActorDamaged') {
    return isIdentifier(value['actor']) && typeof value['source'] === 'string' && typeof value['health'] === 'number' && Number.isFinite(value['health'])
  }
  if (value['_tag'] === 'ActorDied') return isIdentifier(value['actor']) && typeof value['killer'] === 'string'
  if (value['_tag'] === 'ItemDropped') return typeof value['item'] === 'string' && isFiniteInteger(value['count']) && value['count'] > 0 && isPosition(value['at'])
  if (value['_tag'] === 'ActorRespawned') return isIdentifier(value['actor']) && isPosition(value['at']) && typeof value['health'] === 'number' && Number.isFinite(value['health'])
  if (value['_tag'] === 'ActorSleepChanged') return isIdentifier(value['actor']) && (value['sleeping'] === null || isSleepState(value['sleeping']))
  if (value['_tag'] === 'SleepProgress') {
    return isFiniteInteger(value['sleeping']) && isFiniteInteger(value['required']) && isFiniteInteger(value['connected']) && typeof value['ready'] === 'boolean'
  }
  return value['_tag'] === 'NightSkipped' && isFiniteInteger(value['sleeping']) && isFiniteInteger(value['required'])
}

const isRejectionReason = (value: unknown): value is Extract<SurvivalCommandResult, { readonly accepted: false }>['reason'] =>
  value === 'duplicate-request'
  || value === 'stale-revision'
  || value === 'unauthorized-actor'
  || value === 'session-mismatch'
  || value === 'invalid-command'
  || value === 'invalid-game-mode'
  || value === 'out-of-reach'
  || value === 'insufficient-items'
  || value === 'cooldown-active'
  || value === 'occupied'
  || value === 'missing-block'
  || value === 'target-not-found'
  || value === 'target-dead'
  || value === 'actor-dead'
  || value === 'target-alive'
  || value === 'invalid-bed'
  || value === 'not-sleep-time'
  || value === 'sleep-unsafe'
  || value === 'already-sleeping'
  || value === 'not-sleeping'

const isCommandResult = (value: unknown): value is SurvivalCommandResult =>
  isRecord(value)
  && isIdentifier(value['requestId'])
  && isFiniteInteger(value['revision'])
  && ((value['accepted'] === true && Array.isArray(value['events']) && value['events'].every(isSurvivalEvent))
    || (value['accepted'] === false && isRejectionReason(value['reason'])))

const isSnapshot = (value: unknown): value is SurvivalSnapshot =>
  isRecord(value)
  && typeof value['world'] === 'string'
  && isFiniteInteger(value['revision'])
  && Array.isArray(value['actors'])
  && value['actors'].every(isActorState)
  && isRecord(value['blocks'])
  && Object.values(value['blocks']).every((block) => typeof block === 'string')
  && Array.isArray(value['drops'])
  && value['drops'].every(isDrop)

const isSleepCommand = (value: unknown): value is SleepCommand => {
  if (!isRecord(value) || (value['_tag'] !== 'EnterSleep' && value['_tag'] !== 'LeaveSleep')) return false
  const validBase = isIdentifier(value['actor'])
    && isIdentifier(value['session'])
    && isIdentifier(value['requestId'])
    && isFiniteInteger(value['expectedRevision'])
    && isFiniteInteger(value['clientTick'])
  return validBase && (value['_tag'] === 'LeaveSleep' || isPosition(value['bed']))
}

export const decodeSleepWireMessage = (frame: string): SleepWireMessage | undefined => {
  if (frame.length > SLEEP_MAX_WIRE_LENGTH) return undefined
  try {
    const value: unknown = JSON.parse(frame)
    if (!isRecord(value)) return undefined
    if (value['_tag'] === 'SleepCommand' && isSleepCommand(value['command'])) return { _tag: 'SleepCommand', command: value['command'] }
    if (value['_tag'] === 'SleepCommandResult' && isCommandResult(value['result'])) return { _tag: 'SleepCommandResult', result: value['result'] }
    if (value['_tag'] === 'SleepEvents') {
      if (isFiniteInteger(value['revision']) && Array.isArray(value['events']) && value['events'].every(isSurvivalEvent)) {
        return { _tag: 'SleepEvents', revision: value['revision'], events: value['events'] }
      }
    }
    if (value['_tag'] === 'SleepSnapshot' && isSnapshot(value['snapshot'])) return { _tag: 'SleepSnapshot', snapshot: value['snapshot'] }
    return undefined
  } catch {
    return undefined
  }
}

export type SleepClientState = {
  readonly revision: number
  readonly sleepers: ReadonlyMap<PlayerId, SurvivalSleepState>
  readonly pending: ReadonlyMap<string, SleepCommand>
  readonly progress: Extract<SurvivalEvent, { readonly _tag: 'SleepProgress' }> | null
  readonly skippedRevision: number | null
  readonly rejection: SurvivalCommandResult | null
}

export const initialSleepClientState = (): SleepClientState => ({
  revision: 0,
  sleepers: new Map(),
  pending: new Map(),
  progress: null,
  skippedRevision: null,
  rejection: null,
})

export const sleepClientFromSnapshot = (snapshot: SurvivalSnapshot): SleepClientState => ({
  ...initialSleepClientState(),
  revision: snapshot.revision,
  sleepers: new Map(snapshot.actors.flatMap((actor) =>
    actor.sleeping === undefined ? [] : [[actor.player, actor.sleeping] as const],
  )),
})

export const queueSleepCommand = (
  state: SleepClientState,
  command: SleepCommand,
): SleepClientState => ({
  ...state,
  pending: new Map(state.pending).set(command.requestId, command),
  rejection: null,
})

const applyEvents = (
  state: SleepClientState,
  revision: number,
  events: ReadonlyArray<SurvivalEvent>,
): SleepClientState => {
  if (revision < state.revision) return state
  const sleepers = new Map(state.sleepers)
  let progress = state.progress
  let skippedRevision = state.skippedRevision
  for (const event of events) {
    if (event._tag === 'ActorSleepChanged') {
      if (event.sleeping === null) sleepers.delete(event.actor)
      else sleepers.set(event.actor, event.sleeping)
    } else if (event._tag === 'SleepProgress') {
      progress = event
    } else if (event._tag === 'NightSkipped' && skippedRevision !== revision) {
      skippedRevision = revision
      sleepers.clear()
    }
  }
  return { ...state, revision, sleepers, progress, skippedRevision }
}

export const applySleepCommandResult = (
  state: SleepClientState,
  result: SurvivalCommandResult,
): SleepClientState => {
  const pending = new Map(state.pending)
  pending.delete(result.requestId)
  if (!result.accepted) {
    return { ...state, revision: Math.max(state.revision, result.revision), pending, rejection: result }
  }
  return { ...applyEvents(state, result.revision, result.events), pending, rejection: null }
}

export const applySleepEvents = (
  state: SleepClientState,
  revision: number,
  events: ReadonlyArray<SurvivalEvent>,
): SleepClientState => applyEvents(state, revision, events)

export class SleepAuthority {
  #authority: SurvivalAuthority
  readonly #options: SurvivalAuthorityOptions
  readonly #requests = new Set<string>()

  constructor(snapshot: SurvivalSnapshot, options: SurvivalAuthorityOptions) {
    this.#options = options
    this.#authority = new SurvivalAuthority(snapshot, options)
  }

  addActor(actor: SurvivalActorState): SurvivalSnapshot {
    const snapshot = this.#authority.snapshot()
    if (snapshot.actors.some((candidate) => candidate.player === actor.player)) return snapshot
    this.#authority = new SurvivalAuthority({ ...snapshot, actors: [...snapshot.actors, actor] }, this.#options)
    return this.#authority.snapshot()
  }

  execute(command: SleepCommand): SurvivalCommandResult {
    const key = `${command.session}\u0000${command.requestId}`
    if (this.#requests.has(key)) {
      return { accepted: false, requestId: command.requestId, revision: this.#authority.snapshot().revision, reason: 'duplicate-request' }
    }
    this.#requests.add(key)
    return this.#authority.execute(command)
  }

  snapshot(): SurvivalSnapshot {
    return this.#authority.snapshot()
  }

  disconnect(actor: PlayerId): ReadonlyArray<SurvivalEvent> {
    return this.#authority.disconnect(actor)
  }

  reconcile(): ReadonlyArray<SurvivalEvent> {
    return this.#authority.reconcileSleep()
  }

  rejoin(actor: PlayerId, previousSession: string, nextSession: string): boolean {
    return this.#authority.rejoin(actor, previousSession, nextSession)
  }
}

export const actorSleepLocation = (actor: SurvivalActorState): SurvivalSleepState | undefined => actor.sleeping
