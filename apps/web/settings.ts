import {
  DEFAULT_VOLUME_SETTINGS,
} from '@nerima-games/mc-audio'
import {
  DEFAULT_BINDINGS,
  ESCAPE_KEY_CODE,
  FOCUS_NAVIGATION_KEY_CODE,
  INPUT_ACTIONS,
  type Bindings,
  type InputAction,
} from '@nerima-games/mc-render'
import {
  loadFrom,
  SaveKey,
  saveTo,
  defineFormat,
  type SaveDecodeError,
  type SaveFormat,
  type StorageError,
  type StoragePort,
} from '@nerima-games/mc-save'
import { Effect, Option, Schema } from 'effect'

export const PLAYER_SETTINGS_FORMAT_NAME = '@nerima-games/mc-compose/player-settings'
export const PLAYER_SETTINGS_KEY: SaveKey = SaveKey('mc-compose/player-settings')

export const PLAYER_BINDING_ACTIONS: ReadonlyArray<Exclude<InputAction, 'escape'>> = INPUT_ACTIONS.filter(
  (action): action is Exclude<InputAction, 'escape'> => action !== 'escape',
)

export type PlayerSettingsV1 = {
  readonly sensitivity: number
  readonly bindings: Bindings
  readonly masterVolume: number
  readonly sfxVolume: number
  readonly audioEnabled: boolean
  readonly captionsEnabled: boolean
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettingsV1 = {
  sensitivity: 1,
  bindings: { ...DEFAULT_BINDINGS },
  masterVolume: DEFAULT_VOLUME_SETTINGS.master,
  sfxVolume: 1,
  audioEnabled: true,
  captionsEnabled: true,
}

export const PLAYER_SETTINGS_FORMAT: SaveFormat<unknown, unknown> = defineFormat({
  name: PLAYER_SETTINGS_FORMAT_NAME,
  version: 1,
  schema: Schema.Unknown,
})

export type PlayerSettingsPersistenceError = StorageError | SaveDecodeError

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined

const boundedNumber = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback

const validBindingCode = (value: unknown): value is string =>
  typeof value === 'string'
  && value.trim().length > 0
  && value !== ESCAPE_KEY_CODE
  && value !== FOCUS_NAVIGATION_KEY_CODE

export const rebindPlayerSettings = (
  bindings: Bindings,
  action: Exclude<InputAction, 'escape'>,
  code: string,
): Bindings => {
  if (!validBindingCode(code) || !PLAYER_BINDING_ACTIONS.includes(action)) return bindings

  const previousCode = bindings[action] ?? DEFAULT_BINDINGS[action]
  const conflictingAction = PLAYER_BINDING_ACTIONS.find(
    (candidate) => candidate !== action && bindings[candidate] === code,
  )
  const next = { ...bindings, [action]: code }
  if (conflictingAction !== undefined) next[conflictingAction] = previousCode
  return next
}

export const normalizeBindings = (value: unknown): Bindings => {
  const record = asRecord(value)
  if (record === undefined) return { ...DEFAULT_BINDINGS }

  return PLAYER_BINDING_ACTIONS.reduce<Bindings>((bindings, action) => {
    const code = record[action]
    return validBindingCode(code) ? rebindPlayerSettings(bindings, action, code) : bindings
  }, { ...DEFAULT_BINDINGS })
}

export const normalizePlayerSettings = (value: unknown): PlayerSettingsV1 => {
  const record = asRecord(value)
  if (record === undefined) return { ...DEFAULT_PLAYER_SETTINGS, bindings: { ...DEFAULT_BINDINGS } }

  return {
    sensitivity: boundedNumber(record['sensitivity'], 1, 0.1, 3),
    bindings: normalizeBindings(record['bindings']),
    masterVolume: boundedNumber(
      record['masterVolume'],
      DEFAULT_VOLUME_SETTINGS.master,
      0,
      1,
    ),
    sfxVolume: boundedNumber(record['sfxVolume'], 1, 0, 1),
    audioEnabled: typeof record['audioEnabled'] === 'boolean' ? record['audioEnabled'] : true,
    captionsEnabled: typeof record['captionsEnabled'] === 'boolean'
      ? record['captionsEnabled']
      : true,
  }
}

export const loadPlayerSettings = (): Effect.Effect<
  PlayerSettingsV1,
  PlayerSettingsPersistenceError,
  StoragePort
> => loadFrom(PLAYER_SETTINGS_FORMAT, PLAYER_SETTINGS_KEY).pipe(
  Effect.map(Option.match({
    onNone: () => normalizePlayerSettings(undefined),
    onSome: normalizePlayerSettings,
  })),
)

export const savePlayerSettings = (
  settings: PlayerSettingsV1,
): Effect.Effect<void, StorageError | SaveDecodeError, StoragePort> =>
  saveTo(PLAYER_SETTINGS_FORMAT, PLAYER_SETTINGS_KEY, normalizePlayerSettings(settings))
