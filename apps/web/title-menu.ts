import { Effect, Layer, Scope } from 'effect'
import { indexedDbStorageLayer } from '@nerima-games/mc-save'
import {
  createMainMenuView,
  initialMainMenuState,
  mainMenuViewModel,
  type CreateWorldRequest,
  type MainMenuState,
  type SavedWorld,
} from '@nerima-games/mx-ui'

import { validateMultiplayerUrl } from './multiplayer-url'
import {
  DEFAULT_PLAYER_SETTINGS,
  loadPlayerSettings,
  savePlayerSettings,
  type PlayerSettingsV1,
} from './settings'
import { createSettingsView } from './settings-view'
import { listSessions } from './session-persistence'
import { createSessionHref, createUniqueSessionId, sessionHref } from './session-navigation'
import {
  DATABASE_NAME,
  MISSING_SESSION_ERROR,
  makeSettingsWriteQueue,
  type SettingsWriteQueue,
} from './platform-adapters'

export type TitleMenuContext = {
  readonly document: Document
  readonly window: Window & typeof globalThis
  readonly indexedDB: IDBFactory
  readonly crypto: Pick<Crypto, 'randomUUID'>
  readonly requireElement: (id: string) => HTMLElement
  readonly enqueueSettingsWrite: (
    queue: SettingsWriteQueue,
    write: () => Promise<void>,
    onSuccess: () => void,
    onFailure: (error: unknown) => void,
  ) => void
  readonly drainSettingsWrites: (queue: SettingsWriteQueue) => Promise<void>
  readonly multiplayerRegistrationTokenKey: (
    url: string,
    worldId: string,
    player: string,
  ) => string
  readonly hot: { readonly dispose: (handler: () => void) => void } | undefined
}

export const bootTitleMenu = async (context: TitleMenuContext): Promise<void> => {
  const {
    document,
    window,
    indexedDB,
    crypto,
    requireElement,
    enqueueSettingsWrite,
    drainSettingsWrites,
    multiplayerRegistrationTokenKey,
    hot,
  } = context
  const titleScreen = requireElement('title-screen')
  const menuParent = requireElement('main-menu-root')
  const titleStatus = requireElement('title-status')
  const settingsRoot = requireElement('settings-root')
  const multiplayerJoin = requireElement('multiplayer-join')
  const multiplayerWorld = requireElement('multiplayer-world')
  const multiplayerName = requireElement('multiplayer-name')
  const multiplayerPlayer = requireElement('multiplayer-player')
  const multiplayerUrl = requireElement('multiplayer-url')
  const multiplayerRegistrationToken = requireElement('multiplayer-registration-token')
  const multiplayerJoinButton = requireElement('multiplayer-join-button')
  if (!(multiplayerJoin instanceof window.HTMLFormElement)
    || !(multiplayerWorld instanceof window.HTMLSelectElement)
    || !(multiplayerName instanceof window.HTMLInputElement)
    || !(multiplayerPlayer instanceof window.HTMLInputElement)
    || !(multiplayerUrl instanceof window.HTMLInputElement)
    || !(multiplayerRegistrationToken instanceof window.HTMLInputElement)
    || !(multiplayerJoinButton instanceof window.HTMLButtonElement)) {
    throw new Error('index.html has invalid multiplayer join controls')
  }
  titleScreen.hidden = false
  document.body.setAttribute('data-mc-compose-route', 'title')
  if (new URLSearchParams(window.location.search).get('loadError') === 'missing-session') {
    titleStatus.textContent = MISSING_SESSION_ERROR
  }

  const scope = Effect.runSync(Scope.make())
  const storageContext = await Effect.runPromise(
    Effect.provideService(
      Layer.build(indexedDbStorageLayer({ factory: indexedDB, databaseName: DATABASE_NAME })),
      Scope.Scope,
      scope,
    ),
  )
  const sessions = await Effect.runPromise(Effect.provide(listSessions(), storageContext))
  let playerSettings = await Effect.runPromise(
    Effect.provide(loadPlayerSettings(), storageContext),
  ).catch(() => DEFAULT_PLAYER_SETTINGS)
  const settingsWrites = makeSettingsWriteQueue()
  let settingsView: ReturnType<typeof createSettingsView>
  const persistPlayerSettings = (next: PlayerSettingsV1): void => {
    document.body.setAttribute('data-player-settings-persistence', 'dirty')
    settingsView.clearPersistenceError()
    enqueueSettingsWrite(
      settingsWrites,
      () => Effect.runPromise(Effect.provide(savePlayerSettings(next), storageContext)),
      () => {
        if (playerSettings === next) {
          document.body.setAttribute('data-player-settings-persistence', 'saved')
        }
      },
      (error) => {
        document.body.setAttribute('data-player-settings-persistence', 'error')
        const message = 'Settings could not be saved.'
        titleStatus.textContent = message
        settingsView.reportPersistenceError(message)
        console.error('[mc-compose] player settings persistence failed', error)
      },
    )
  }
  const savedWorlds: ReadonlyArray<SavedWorld> = sessions.map(({ sessionId, metadata }) => ({
    sessionId,
    name: metadata.name,
  }))
  multiplayerWorld.replaceChildren(...savedWorlds.map(({ sessionId, name }) => {
    const option = document.createElement('option')
    option.value = sessionId
    option.textContent = name
    return option
  }))
  multiplayerPlayer.value = `player-${crypto.randomUUID().slice(0, 8)}`
  multiplayerJoinButton.disabled = savedWorlds.length === 0
  const existingIds = savedWorlds.map(({ sessionId }) => sessionId)
  let menuState: MainMenuState = initialMainMenuState
  let menuView: ReturnType<typeof createMainMenuView>
  settingsView = createSettingsView(document, settingsRoot, {
    onChange: (next) => {
      playerSettings = next
      persistPlayerSettings(next)
    },
    onClose: () => {
      titleScreen.inert = false
    },
  })

  let titleNavigationPending = false
  const setTitleNavigationPending = (pending: boolean): void => {
    titleNavigationPending = pending
    if (pending) menuParent.setAttribute('aria-busy', 'true')
    else menuParent.removeAttribute('aria-busy')
    for (const control of menuParent.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input')) {
      control.disabled = pending
    }
  }

  const navigateAfterSettingsSaved = async (href: string): Promise<void> => {
    if (titleNavigationPending) return
    setTitleNavigationPending(true)
    try {
      await drainSettingsWrites(settingsWrites)
      window.location.assign(href)
    } catch (error: unknown) {
      setTitleNavigationPending(false)
      titleStatus.textContent = 'Could not finish saving settings. Please try again.'
      console.error('[mc-compose] navigation blocked by settings persistence failure', error)
    }
  }
  const openSession = async (sessionId: string): Promise<void> => {
    await navigateAfterSettingsSaved(sessionHref(sessionId))
  }
  multiplayerJoin.addEventListener('submit', (event) => {
    event.preventDefault()
    if (titleNavigationPending || !multiplayerJoin.reportValidity()) return
    const player = multiplayerPlayer.value.trim()
    const name = multiplayerName.value.trim()
    if (player.length === 0 || name.length === 0) {
      titleStatus.textContent = 'Player name and ID cannot be blank.'
      return
    }
    const validation = validateMultiplayerUrl(multiplayerUrl.value, window.location.href)
    if (!validation.ok) {
      titleStatus.textContent = validation.message
      return
    }
    const href = new URL(sessionHref(multiplayerWorld.value), window.location.origin)
    href.searchParams.set('multiplayer', validation.url.href)
    href.searchParams.set('player', player)
    href.searchParams.set('multiplayerName', name)
    const registrationToken = multiplayerRegistrationToken.value
    try {
      const registrationTokenKey = multiplayerRegistrationTokenKey(
        validation.url.href,
        multiplayerWorld.value,
        player,
      )
      if (registrationToken.length > 0) {
        window.sessionStorage.setItem(
          registrationTokenKey,
          registrationToken,
        )
      } else {
        window.sessionStorage.removeItem(registrationTokenKey)
      }
    } catch (error: unknown) {
      titleStatus.textContent = 'Legacy registration token could not be stored for navigation.'
      console.error('[mc-compose] multiplayer registration token storage failed', error)
      return
    }
    void navigateAfterSettingsSaved(`${href.pathname}${href.search}`)
  })
  const createWorld = async ({ name, mode }: CreateWorldRequest): Promise<void> => {
    titleStatus.textContent = ''
    const sessionId = createUniqueSessionId(name, existingIds)
    await navigateAfterSettingsSaved(createSessionHref(sessionId, { name, mode }))
  }

  menuView = createMainMenuView(document, menuParent, {
    onStateChange: (state) => {
      menuState = state
      menuView.render(mainMenuViewModel(menuState, savedWorlds))
    },
    onCreateWorld: (request) => {
      void createWorld(request)
    },
    onLoadWorld: ({ sessionId }) => {
      void openSession(sessionId)
    },
    onOpenSettings: () => {
      const returnFocus = document.activeElement instanceof window.HTMLElement
        ? document.activeElement
        : menuParent
      titleStatus.textContent = ''
      titleScreen.inert = true
      settingsView.open(playerSettings, returnFocus)
    },
  })
  menuView.render(mainMenuViewModel(menuState, savedWorlds))
  const handleTitlePageHide = (event: PageTransitionEvent): void => {
    if (!event.persisted) settingsView.dispose()
  }
  window.addEventListener('pagehide', handleTitlePageHide)
  hot?.dispose(() => {
    window.removeEventListener('pagehide', handleTitlePageHide)
    settingsView.dispose()
  })
  document.body.setAttribute('data-mc-compose-boot', 'running')
}
