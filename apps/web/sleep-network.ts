/* eslint-disable max-lines, no-magic-numbers -- Sleep synchronization is a small protocol adapter with explicit boundary validation. */
import {
  SurvivalAuthority,
  type PlayerId,
  type SurvivalActorState,
  type SurvivalCommand,
  type SurvivalCommandResult,
  type SurvivalEvent,
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

const isPosition = (value: unknown): boolean =>
  isRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number' && typeof value['z'] === 'number'

const isSleepCommand = (value: unknown): value is SleepCommand => {
  if (!isRecord(value) || (value['_tag'] !== 'EnterSleep' && value['_tag'] !== 'LeaveSleep')) return false
  const validBase = typeof value['actor'] === 'string'
    && typeof value['session'] === 'string'
    && typeof value['requestId'] === 'string'
    && typeof value['expectedRevision'] === 'number'
    && typeof value['clientTick'] === 'number'
  return validBase && (value['_tag'] === 'LeaveSleep' || isPosition(value['bed']))
}

export const decodeSleepWireMessage = (frame: string): SleepWireMessage | undefined => {
  try {
    const value: unknown = JSON.parse(frame)
    if (!isRecord(value)) return undefined
    if (value['_tag'] === 'SleepCommand') return isSleepCommand(value['command']) ? value as SleepWireMessage : undefined
    if (value['_tag'] === 'SleepCommandResult') return isRecord(value['result']) ? value as SleepWireMessage : undefined
    if (value['_tag'] === 'SleepEvents') {
      return typeof value['revision'] === 'number' && Array.isArray(value['events']) ? value as SleepWireMessage : undefined
    }
    if (value['_tag'] === 'SleepSnapshot') return isRecord(value['snapshot']) ? value as SleepWireMessage : undefined
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
