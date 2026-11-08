import { afterEach, describe, expect, it, vi } from 'vitest'

import { bootTitleMenu } from '../apps/web/title-menu'

const mocks = vi.hoisted(() => ({
  sessions: [{ sessionId: 'saved-world', metadata: { name: 'Saved World' } }],
  createMainMenuView: vi.fn(() => ({ render: vi.fn() })),
  createSettingsView: vi.fn(() => ({
    open: vi.fn(),
    clearPersistenceError: vi.fn(),
    reportPersistenceError: vi.fn(),
    dispose: vi.fn(),
  })),
}))

vi.mock('@nerima-games/mc-save', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mc-save')>()
  return {
    ...actual,
    indexedDbStorageLayer: () => actual.InMemoryStorageLayer,
  }
})

vi.mock('@nerima-games/mx-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nerima-games/mx-ui')>()
  return { ...actual, createMainMenuView: mocks.createMainMenuView }
})

vi.mock('../apps/web/session-persistence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../apps/web/session-persistence')>()
  const { Effect } = await import('effect')
  return {
    ...actual,
    listSessions: () => Effect.succeed(mocks.sessions),
  }
})

vi.mock('../apps/web/settings-view', () => ({
  createSettingsView: mocks.createSettingsView,
}))

class FakeElement {
  hidden = false
  inert = false
  disabled = false
  value = ''
  textContent = ''
  readonly attributes = new Map<string, string>()
  readonly children: Array<FakeElement> = []
  readonly listeners = new Map<string, EventListenerOrEventListenerObject>()

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  querySelectorAll<T extends Element>(): NodeListOf<T> {
    return this.children as unknown as NodeListOf<T>
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener)
  }

  replaceChildren(...children: Array<FakeElement>): void {
    this.children.splice(0, this.children.length, ...children)
  }
}

class FakeFormElement extends FakeElement {
  valid = true

  reportValidity(): boolean {
    return this.valid
  }

  submit(): void {
    const listener = this.listeners.get('submit')
    if (typeof listener === 'function') listener.call(this, new Event('submit'))
    else listener?.handleEvent(new Event('submit'))
  }
}

class FakeSelectElement extends FakeElement {}
class FakeInputElement extends FakeElement {}
class FakeButtonElement extends FakeElement {}

const makeTitleMenuContext = () => {
  const body = new FakeElement()
  const titleScreen = new FakeElement()
  const menuParent = new FakeElement()
  const titleStatus = new FakeElement()
  const settingsRoot = new FakeElement()
  const multiplayerJoin = new FakeFormElement()
  const multiplayerWorld = new FakeSelectElement()
  const multiplayerName = new FakeInputElement()
  const multiplayerPlayer = new FakeInputElement()
  const multiplayerUrl = new FakeInputElement()
  const multiplayerRegistrationToken = new FakeInputElement()
  const multiplayerJoinButton = new FakeButtonElement()
  const elements = new Map<string, FakeElement>([
    ['title-screen', titleScreen],
    ['main-menu-root', menuParent],
    ['title-status', titleStatus],
    ['settings-root', settingsRoot],
    ['multiplayer-join', multiplayerJoin],
    ['multiplayer-world', multiplayerWorld],
    ['multiplayer-name', multiplayerName],
    ['multiplayer-player', multiplayerPlayer],
    ['multiplayer-url', multiplayerUrl],
    ['multiplayer-registration-token', multiplayerRegistrationToken],
    ['multiplayer-join-button', multiplayerJoinButton],
  ])
  const document = {
    body,
    activeElement: null,
    createElement: vi.fn(() => new FakeElement()),
  }
  const location = {
    search: '?loadError=missing-session',
    href: 'https://game.example/',
    origin: 'https://game.example',
    assign: vi.fn(),
  }
  const sessionStorage = {
    setItem: vi.fn(),
    removeItem: vi.fn(),
  }
  const window = {
    location,
    sessionStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    HTMLFormElement: FakeFormElement,
    HTMLSelectElement: FakeSelectElement,
    HTMLInputElement: FakeInputElement,
    HTMLButtonElement: FakeButtonElement,
    HTMLElement: FakeElement,
  }
  const dispose = vi.fn()
  return {
    context: {
      document: document as unknown as Document,
      window: window as unknown as Window & typeof globalThis,
      indexedDB: {} as IDBFactory,
      crypto: { randomUUID: (): ReturnType<Crypto['randomUUID']> => '12345678-abcd-1234-abcd-12345678abcd' },
      requireElement: (id: string) => {
        const element = elements.get(id)
        if (element === undefined) throw new Error(`missing fake element: ${id}`)
        return element as unknown as HTMLElement
      },
      enqueueSettingsWrite: vi.fn(),
      drainSettingsWrites: vi.fn(async () => {}),
      multiplayerRegistrationTokenKey: vi.fn(() => 'registration-key'),
      hot: { dispose },
    },
    body,
    titleScreen,
    menuParent,
    titleStatus,
    multiplayerJoin,
    multiplayerWorld,
    multiplayerName,
    multiplayerPlayer,
    multiplayerUrl,
    multiplayerRegistrationToken,
    multiplayerJoinButton,
    location,
    sessionStorage,
    dispose,
    window,
  }
}

describe('title menu boot', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('populates saved worlds and joins one through the title form', async () => {
    const state = makeTitleMenuContext()

    await bootTitleMenu(state.context)

    expect(state.titleScreen.hidden).toBe(false)
    expect(state.body.attributes.get('data-mc-compose-route')).toBe('title')
    expect(state.body.attributes.get('data-mc-compose-boot')).toBe('running')
    expect(state.titleStatus.textContent).toBe('The requested saved world could not be found.')
    expect(state.multiplayerWorld.children).toHaveLength(1)
    expect(state.multiplayerWorld.children[0]).toMatchObject({
      value: 'saved-world',
      textContent: 'Saved World',
    })
    expect(state.multiplayerJoinButton.disabled).toBe(false)
    expect(state.multiplayerPlayer.value).toBe('player-12345678')

    state.multiplayerWorld.value = 'saved-world'
    state.multiplayerPlayer.value = 'alice'
    state.multiplayerName.value = 'Alice'
    state.multiplayerUrl.value = 'wss://game.example/socket'
    state.multiplayerRegistrationToken.value = 'test-token'
    state.multiplayerJoin.submit()

    await vi.waitFor(() => expect(state.location.assign).toHaveBeenCalledOnce())

    expect(state.sessionStorage.setItem).toHaveBeenCalledWith('registration-key', 'test-token')
    expect(state.location.assign).toHaveBeenCalledWith(
      '/?session=saved-world&multiplayer=wss%3A%2F%2Fgame.example%2Fsocket&player=alice&multiplayerName=Alice',
    )
    expect(state.menuParent.attributes.get('aria-busy')).toBe('true')
    expect(state.dispose).toHaveBeenCalledOnce()
  })
})
