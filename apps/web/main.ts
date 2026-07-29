/**
 * The browser entry point. THE HOST.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
 *
 * ---------------------------------------------------------------------------
 * What this file is, under the prime directive
 * ---------------------------------------------------------------------------
 *
 * `index.ts` says the only code added to this repository is Layer composition
 * and the stage order table. This file is neither — it is the HOST, the thing
 * `docs/porting.md` §2 names and `domain/composition.ts` keeps referring to as
 * "the host has the type to discharge it". It is not published: `package.json`
 * `files` lists `index.ts` and `domain` and does not list `apps`, and
 * `check-dependency-whitelist.ts`'s own `isToolingOrTestPath` agrees, treating
 * everything outside `index.ts` and `domain/` as tooling.
 *
 * So the rule this file lives under is not "no game rules" (it has none) but
 * "nothing here may be a rule some module should have owned". Concretely it
 * does five things:
 *
 *   1. builds the platform adapters (clock, browser input),
 *   2. registers each module, discharging what registration requires,
 *   3. calls `composeGame`,
 *   4. mounts the screens mx-ui hands back,
 *   5. drives `runFrameWith` from `requestAnimationFrame`.
 *
 * ---------------------------------------------------------------------------
 * COMPOSED MODULES AND THE REMAINING NETWORK BOUNDARY
 * ---------------------------------------------------------------------------
 *
 * `mc-render`, `mx-ui`, `mx-redstone` and `mx-gameplay` are composed. Gameplay
 * supplies its public production services, including the generated chunk
 * store shared with the renderer. `mx-multiplayer` remains outside this host
 * until a production `TransportPort` is selected; composing a test transport
 * would only verify the fake.
 *
 * ---------------------------------------------------------------------------
 * THERE IS A RENDERER NOW, AND THIS FILE STILL DOES NOT DRAW
 * ---------------------------------------------------------------------------
 *
 * This paragraph used to say "mc-render draws nothing yet", and
 * `docs/e2e-triage.md` #1 (`WebGL2 canvas is present and active`) was `fixme`
 * because of it. mc-render now has `application/world-renderer.ts`, and the
 * WebGL2 context on `#game-canvas` is created BY IT — `new WebGLRenderer({
 * canvas })`, inside mc-render, from mc-render's own transcribed parameters.
 *
 * What this file adds is item (1) of the five above and nothing else: `three`
 * is a PLATFORM LIBRARY, supplied here exactly as `window`, `document` and the
 * canvas already are. mc-render describes the seven constructors it needs as
 * structural types in `application/three-surface.ts` and imports `three`
 * nowhere; the host is the only place that can hold the real namespace, because
 * the host is the only place that knows it is in a browser.
 *
 * The line that would have been the violation is still not written. There is no
 * `canvas.getContext(...)` here, no scene, no geometry and no draw call — this
 * file cannot draw a triangle, and `domain/composition.ts` is why. Passing a
 * library to a module that decides what to do with it is wiring; deciding what
 * to draw is a rule, and rules belong to modules.
 *
 * ---------------------------------------------------------------------------
 * THERE IS A WORLD NOW. THIS PARAGRAPH USED TO SAY THE PICTURE WAS A BLUE FIELD
 * ---------------------------------------------------------------------------
 *
 * It read: "No chunk geometry reaches the renderer because no world reaches
 * this page", and it argued that mc-worldgen and mc-meshing COULD NOT be
 * resolved here, for the reason under "WHY THREE MODULES AND NOT SIX".
 *
 * HALF OF THAT WAS RIGHT AND THE HALF THAT WAS WRONG IS THE INTERESTING ONE.
 * The wall it named is real: registering `gameplayModule` needs a `ChunkStore`,
 * an `EntityManager` and an `InventoryService`, and the only implementations
 * are test doubles. But DRAWING TERRAIN NEVER NEEDED `gameplayModule`. It
 * needed chunk geometry, and geometry is data.
 *
 * The blocker was stated as a CATEGORY ("registering a module needs services")
 * over a set that included a case which registers nothing — the fourth time
 * this project has recorded that shape (§0.1 of the residual-work document
 * counts the others).
 *
 * WHAT IS ON THE SCREEN: a deterministic generated world, streamed around the
 * player through mx-gameplay's public world constructor. Gameplay collision,
 * block edits and mc-render meshing all observe the same mc-worldgen store;
 * dirty chunk notifications are the only render synchronization path.
 */
import * as THREE from 'three'
import { Context, Effect, Either, Exit, Layer, Option, Ref, Scope } from 'effect'
import { indexedDbStorageLayer } from '@nerima-games/mc-save'
import { makeTimeService } from '@nerima-games/mc-sim'
import {
  chunkCoord,
  chunkSnapshotOf,
  generatedChunkSource,
  type Chunk,
} from '@nerima-games/mc-worldgen'
import {
  browserInputLayer,
  InputService,
  chunkKeyOf,
  makeChunkStoreMesher,
  makeWorldRenderer,
  renderModule,
  syncWorld,
  wrapHotbarSelection,
  type ChunkRef,
  type RenderEntity,
} from '@nerima-games/mc-render'
import {
  createCrosshairView,
  createHudView,
  createInventoryView,
  hudViewModel,
  inventoryViewModel,
  slotSnapshotOf,
  uiModule,
  type InventoryInteractionTarget,
} from '@nerima-games/mx-ui'
import { redstoneModule } from '@nerima-games/mx-redstone'
import {
  applyGravity,
  CREEPER_KIND,
  drainMobDrops,
  drainPlayerDamages,
  EYE_LEVEL_OFFSET,
  gameplayStages,
  makeGameplayFrameState,
  makeGeneratedWorld,
  isPlaceableItem,
  requestBowShot,
  requestMobSpawn,
  requestTargetedBlockBreak,
  requestTargetedBlockPlacement,
  requestTargetedPrimaryAttack,
  resolvePlayerMovement,
  solidityFromStore,
  spawnMobDrops,
  PLAYER_HALF_HEIGHT,
  ZOMBIE_KIND,
  type MobBehaviour,
  type MobDropEvent,
} from '@nerima-games/mx-gameplay'
import {
  composeGame,
  EMPTY_MODULE_LAYER,
  registerModule,
  type GameModule,
} from '../../domain/composition'
import { DeltaTimeSecs } from '../../domain/kernel-vocabulary'
import { buildQaRegistry, describeQaApiError, installQaApi } from '../../domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'
import { createInventoryInteraction } from './inventory-interaction'
import { requestPlacementFromSelectedSlot, selectedHotbarAfterInput } from './player-experience'
import { createSessionSaveCoordinator } from './session-save-coordinator'
import {
  loadSession,
  makeSessionChunkSource,
  saveSession,
  snapshotResidentChunks,
  type SessionState,
} from './session-persistence'

/**
 * plan.md §3.4's measured clamp, applied by the DELTA'S PRODUCER.
 *
 * `domain/kernel-vocabulary.ts` is explicit that this is not part of the
 * `DeltaTimeSecs` brand and is not applied by mc-compose: "It is a simulation
 * invariant belonging to whoever produces the delta". The host produces it, so
 * the host clamps it — and without the clamp a backgrounded tab returns for its
 * first frame with a delta of several seconds, which every integrator in the
 * roster would step straight through a wall.
 */
const FIRST_FRAME_SECS = 0.016
const MIN_FRAME_SECS = 0.001
const MAX_FRAME_SECS = 0.05

const clampDelta = (raw: number): DeltaTimeSecs =>
  DeltaTimeSecs(Math.min(Math.max(MIN_FRAME_SECS, raw), MAX_FRAME_SECS))

/** How often the FPS readout is recomputed. Long enough to be a rate, short enough to watch. */
const FPS_WINDOW_SECS = 0.5

/**
 * How fast the player walks, jumps and turns.
 *
 * THESE ARE HOST CONSTANTS AND SHOULD NOT BE. Walk speed and jump impulse are
 * player TUNING, which mc-sim owns — `mc-render/docs/responsibility.md` puts the
 * same class of value there for step height, and `domain/composition.ts` would
 * rather this file held none of them. They are here because mc-sim is not
 * composed and a player with no speed does not move at all.
 *
 * They are the first thing to delete when mc-sim publishes, and they are
 * grouped and labelled so that deletion is one block rather than a search.
 */
const WALK_SPEED_M_PER_S = 4.3
const WALK_EXHAUSTION_PER_METRE = 0.01
const JUMP_SPEED_M_PER_S = 8.4
const LOOK_SENSITIVITY = 0.0022
const WORLD_SEED = 20260728
const SESSION_ID = 'primary'
const DATABASE_NAME = 'nerima-games-minecraft'
const AUTOSAVE_INTERVAL_MS = 5_000
const SAVE_DEBOUNCE_MS = 500
const KNOWN_TARGET_BLOCK = { x: 8, y: 63, z: 8 } as const
const QA_POSE = {
  feetPosition: { x: 8.5, y: 64.5, z: 8.5 },
  yawRadians: 0,
  pitchRadians: -Math.PI / 2 + 0.01,
} as const

const requireElement = (id: string): HTMLElement => {
  const element = document.getElementById(id)
  if (element === null) {
    throw new Error(`index.html is missing #${id}`)
  }
  return element
}

/**
 * The same, narrowed to a canvas.
 *
 * `instanceof` and not a cast. `makeWorldRenderer` is generic in the canvas
 * type — mc-render cannot name `HTMLCanvasElement` — so THIS call site is where
 * the real type is supplied and where a `<div id="game-canvas">` would
 * otherwise sail through into `new WebGLRenderer` and fail somewhere inside
 * three with a message about a null context.
 */
const requireCanvas = (id: string): HTMLCanvasElement => {
  const element = requireElement(id)
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`#${id} is a ${element.tagName}, not a <canvas>`)
  }
  return element
}

/**
 * Report a boot failure where BOTH a human and Playwright can see it.
 *
 * `data-mc-compose-boot` is the machine-readable half. docs/e2e-triage.md #3
 * and #7 ask "no fatal startup errors", and a page that failed to boot silently
 * looks exactly like a page that booted and drew nothing — which is precisely
 * the confusion a smoke test exists to remove.
 */
const failBoot = (reason: string, detail?: unknown): void => {
  document.body.setAttribute('data-mc-compose-boot', 'failed')
  const banner = requireElement('boot-status')
  banner.textContent = `boot failed: ${reason}`
  banner.setAttribute('data-boot-error', reason)
  console.error(`[mc-compose] boot failed: ${reason}`, detail)
}

const boot = async (): Promise<void> => {
  const canvas = requireCanvas('game-canvas')
  const hudParent = requireElement('hud-root')
  const inventoryParent = requireElement('inventory-root')
  const fpsValue = requireElement('fps-value')
  const stageList = requireElement('stage-order')
  let inventoryOpen = false

  // -------------------------------------------------------------------------
  // 1. Platform adapters
  // -------------------------------------------------------------------------

  // The scope stays open for the life of the page ON PURPOSE. `browserInputLayer`
  // is `Layer.scoped` and removes its listeners when the scope closes; closing
  // it here would install the listeners and immediately take them away.
  const scope = Effect.runSync(Scope.make())

  const storageContext = await Effect.runPromise(
    Effect.provideService(
      Layer.build(indexedDbStorageLayer({ factory: indexedDB, databaseName: DATABASE_NAME })),
      Scope.Scope,
      scope,
    ),
  )
  const runStorage = <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
    Effect.runPromise(effect)
  const loadedSession = await runStorage(
    Effect.provide(loadSession(SESSION_ID), storageContext),
  )

  // POINTER LOCK IS THE HOST'S TO ASK FOR. mc-render's `InputService` treats a
  // click as a GAME action only while the pointer is locked, and as a UI click
  // otherwise — the closed-world predicate `domain/input-bindings.ts` describes,
  // and the reason a HUD click cannot steal the pointer. Without this, `attack`
  // never fires and no block can be broken.
  const inputLayer = browserInputLayer({
    targets: { window, document },
    canvas,
    allowsPointerLock: () => !inventoryOpen,
  })

  // The gesture the browser requires: pointer lock can only be requested from a
  // user activation, so the canvas asks on click.
  //
  // A REFUSAL IS NOT AN ERROR. Some environments decline pointer lock outright
  // — Playwright on SwiftShader is one, and answers `WrongDocumentError` — and
  // a host that let that reach the console would make every automated run
  // report a failure it cannot do anything about. The game degrades exactly as
  // mc-render's `UNAVAILABLE_POINTER_LOCK` describes: keyboard still works,
  // clicks stay UI clicks, and `attack` does not fire.
  canvas.addEventListener('click', () => {
    if (inventoryOpen || document.pointerLockElement === canvas) {
      return
    }
    try {
      const requested: unknown = canvas.requestPointerLock()
      if (requested instanceof Promise) {
        requested.catch(() => {
          canvas.setAttribute('data-pointer-lock', 'refused')
        })
      }
    } catch {
      // The attribute IS the record. A boolean nobody reads would be the
      // unread-field shape this project keeps finding; a test can see this.
      canvas.setAttribute('data-pointer-lock', 'refused')
    }
  })

  // Built ONCE, into a Context, and then provided as a Context rather than as a
  // Layer. `mx-multiplayer/stages/registration.ts` records why this matters:
  // "providing `Layer.effect` twice builds two services" — and two
  // `InputService`s means the stage clears the edges on one of them while the
  // DOM listeners write to the other, so every key would appear stuck down.
  const inputContext = await Effect.runPromise(
    Effect.provideService(Layer.build(inputLayer), Scope.Scope, scope),
  )

  // -------------------------------------------------------------------------
  // 2. Registration
  // -------------------------------------------------------------------------

  // The renderer. mc-render builds it; this file supplies only the two things
  // it cannot reach — the `three` namespace and the element to draw on.
  //
  // `clientWidth`/`clientHeight` and not `width`/`height`: the canvas has the
  // host's CSS 100vw/100vh rule on it and no width attribute, so the attribute
  // pair is three's default 300x150 and the layout pair is the viewport. That
  // distinction is also why mc-render passes `updateStyle: false` to `setSize`
  // — see `application/world-renderer.ts`.
  //
  // THE THREE TYPE ARGUMENTS ARE NOT OPTIONAL, and mc-render's
  // `application/three-surface.ts` records why at length: `typeof
  // THREE.BufferGeometry` is itself generic and defaults to
  // `BufferGeometry<NormalOrGLBufferAttributes>`, while `typeof THREE.Mesh`
  // wants the narrower `BufferGeometry<NormalBufferAttributes>` — so inference
  // draws incompatible conclusions from the same namespace and fails four
  // levels down, naming `GLBufferAttribute`. mc-render cannot pin either from
  // its side without naming a `three` type, which is the one thing that seam
  // exists not to do. The host has `three` in scope and pins them here.
  const worldRenderer = await Effect.runPromise(
    makeWorldRenderer<HTMLCanvasElement, THREE.BufferGeometry, THREE.MeshBasicMaterial>(
      THREE,
      canvas,
      { width: canvas.clientWidth, height: canvas.clientHeight },
    ),
  )

  // The canvas is the host's element and its SIZE is the host's business, so
  // the resize listener is here rather than in mc-render — mc-render ships no
  // `lib.DOM` and could not add one. It tells the renderer; the renderer
  // decides what that means for the projection.
  window.addEventListener('resize', () => {
    Effect.runSync(worldRenderer.resize(canvas.clientWidth, canvas.clientHeight))
  })

  // -------------------------------------------------------------------------
  // 2a. The generated world, shared by gameplay and rendering
  // -------------------------------------------------------------------------
  //
  // ONE CONSTRUCTION. The gameplay adapter and the renderer-facing worldgen
  // store returned here wrap the same store instance, so a mined block cannot
  // disappear from collision while remaining visible (or vice versa).
  let activeSeed = WORLD_SEED
  let initialKnownChunks: ReadonlyArray<Chunk> = []

  const generatedSource = generatedChunkSource(
    Option.isSome(loadedSession) ? loadedSession.value.state.seed : WORLD_SEED,
  )
  const restored = Option.isSome(loadedSession)
    ? await runStorage(
        Effect.provide(
          makeSessionChunkSource(loadedSession.value, generatedSource),
          storageContext,
        ),
      )
    : undefined
  if (Option.isSome(loadedSession)) {
    activeSeed = loadedSession.value.state.seed
    initialKnownChunks = (restored?.chunks ?? []).map(chunkSnapshotOf)
  }

  const world = await Effect.runPromise(
    makeGeneratedWorld<MobBehaviour>({
      seed: activeSeed,
      ...(restored === undefined ? {} : { chunkSource: restored.source }),
      ...(Option.isSome(loadedSession)
        ? {
            dimension: loadedSession.value.state.dimension,
            inventory: loadedSession.value.state.inventory.slots as never,
          }
        : {}),
    }),
  )
  const initialSpawnPose = await Effect.runPromise(world.player.pose)
  const initialSpawnDimension = await Effect.runPromise(world.player.dimension)
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(
      world.player.restore(loadedSession.value.state.player, loadedSession.value.state.dimension),
    )
    await Effect.runPromise(world.vitals.restore(loadedSession.value.state.vitals))
  }
  const time = await Effect.runPromise(makeTimeService())
  if (Option.isSome(loadedSession)) {
    await Effect.runPromise(time.restore(loadedSession.value.state.time))
  }

  const reportPersistenceFailure = (error: unknown): void => {
    document.body.setAttribute('data-session-persistence', 'failed')
    console.error('[mc-compose] session persistence failed', error)
  }
  const saveCoordinator = createSessionSaveCoordinator<SessionState>({
    initialKnownChunks,
    snapshotResidents: () => Effect.runPromise(snapshotResidentChunks(world.worldgenChunkStore)),
    snapshotState: () => ({
      seed: activeSeed,
      dimension: Effect.runSync(world.player.dimension),
      player: Effect.runSync(world.player.pose),
      inventory: Effect.runSync(world.inventory.snapshot),
      vitals: Effect.runSync(world.vitals.snapshot),
      time: Effect.runSync(time.snapshot),
    }),
    publish: ({ state, chunks }) =>
      runStorage(
        Effect.provide(
          saveSession({
            sessionId: SESSION_ID,
            revision: crypto.randomUUID(),
            state,
            chunks,
          }),
          storageContext,
        ),
      ).then(() => undefined),
    onFailure: reportPersistenceFailure,
  })
  let markSessionDirty = (): void => {}
  const spawnPose = await Effect.runPromise(world.player.pose)
  const dirtyChunks = await Effect.runPromise(world.worldgenChunkStore.subscribeDirty)
  const meshChunkFromStore = makeChunkStoreMesher(world.worldgenChunkStore)
  canvas.setAttribute('data-world-source', restored === undefined ? 'generated' : 'persisted')
  canvas.setAttribute('data-world-seed', String(activeSeed))

  // STREAMING, keyed to where the player is — not a one-shot load at boot.
  //
  // A fixed radius bounds memory while still exercising both add and removal.
  const STREAM_RADIUS_CHUNKS = 2
  const streamLoaded = new Set<string>()
  let chunksStreamedIn = 0
  let chunksDropped = 0

  /**
   * Which chunks should be resident around a world position.
   *
   * The world is unbounded horizontally, so every coordinate in the radius is
   * loadable and no fixture-edge filtering is needed.
   */
  const desiredAround = (x: number, z: number): ReadonlyArray<ChunkRef> => {
    const cx0 = Math.floor(x / 16)
    const cz0 = Math.floor(z / 16)
    const wanted: Array<ChunkRef> = []
    for (let cx = cx0 - STREAM_RADIUS_CHUNKS; cx <= cx0 + STREAM_RADIUS_CHUNKS; cx += 1) {
      for (let cz = cz0 - STREAM_RADIUS_CHUNKS; cz <= cz0 + STREAM_RADIUS_CHUNKS; cz += 1) {
        wanted.push({ cx, cz })
      }
    }
    return wanted
  }

  const streamAround = (x: number, z: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      const wanted = desiredAround(x, z)
      const wantedKeys = new Set(wanted.map(chunkKeyOf))
      const changed = wanted.filter((chunk) => !streamLoaded.has(chunkKeyOf(chunk)))
      const removed = [...streamLoaded]
        .filter((key) => !wantedKeys.has(key))
        .map((key) => {
          const [cx, cz] = key.split(',')
          return { cx: Number(cx), cz: Number(cz) }
        })

      for (const chunk of changed) {
        yield* world.chunkStore.load(chunk)
        streamLoaded.add(chunkKeyOf(chunk))
      }
      for (const chunk of removed) {
        const snapshot = yield* world.worldgenChunkStore.snapshot(chunkCoord(chunk.cx, chunk.cz))
        if (snapshot !== undefined) {
          saveCoordinator.retainChunk(snapshot)
          markSessionDirty()
        }
        yield* world.chunkStore.unload(chunk)
        streamLoaded.delete(chunkKeyOf(chunk))
      }

      yield* syncWorld(worldRenderer, dirtyChunks, meshChunkFromStore)
      chunksStreamedIn += changed.length
      chunksDropped += removed.length
      canvas.setAttribute('data-chunks-meshed', String(streamLoaded.size))
      canvas.setAttribute('data-chunks-streamed-in', String(chunksStreamedIn))
      canvas.setAttribute('data-chunks-dropped', String(chunksDropped))
    })

  await Effect.runPromise(streamAround(spawnPose.feetPosition.x, spawnPose.feetPosition.z))

  // `renderModule()` is called for its `frameStages` only; its `layers` field
  // is replaced by the browser adapter. The module's own header sanctions
  // exactly this: "Pass it where `InputServiceLayer()` would go — `renderModule`'s
  // `layers` is the same tag."
  //
  // The third argument is the `DrawPort` that `render:draw` calls. Its default
  // is `NO_DRAW_TARGET`, which is what every Node consumer gets and what this
  // page got until the renderer existed.
  /**
   * The starting pose, derived from the generated surface height.
   *
   * The TYPE IS DERIVED FROM THE FUNCTION rather than named, because
   * `CameraPoseSnapshot` lives in mc-render's kernel-vocabulary MIRROR and
   * `index.ts` deliberately keeps that out of the barrel — consumers take
   * kernel's vocabulary from `@nerima-games/mc-kernel`, which is not published.
   * `Parameters<typeof renderModule>[3]` follows the signature instead, so a
   * change to it fails here rather than drifting.
   *
   * The cast inside is for the brands: `position` is a branded `Position` and
   * `capturedAtSecs` a branded `MonotonicTimeSecs`. Neither has a runtime
   * representation and the renderer reads five numbers off this.
   *
   * The camera is eye-level above the player service's feet position.
   */
  const initialPose = ({
    position: {
      x: spawnPose.feetPosition.x,
      y: spawnPose.feetPosition.y + EYE_LEVEL_OFFSET,
      z: spawnPose.feetPosition.z,
    },
    yawRadians: spawnPose.yawRadians,
    pitchRadians: spawnPose.pitchRadians,
    capturedAtSecs: 0,
  } as unknown as NonNullable<Parameters<typeof renderModule>[3]>)

  const render = renderModule(undefined, undefined, worldRenderer, initialPose)

  const registeredRender = await Effect.runPromise(
    Effect.provide(
      registerModule({
        name: '@nerima-games/mc-render',
        layers: inputLayer,
        frameStages: render.frameStages,
      }),
      inputContext,
    ),
  )

  // `EMPTY_MODULE_LAYER` and not `uiModule.layers`, even though the two are the
  // same value. `Layer.empty` is typed `Layer<never, never, never>` and does NOT
  // assign to `ModuleLayer`: `Layer` declares `in ROut` contravariantly, so the
  // empty Layer is the single case where `any` would have to assign to `never`.
  // `domain/composition.ts` exports the constant precisely so that the cast
  // lives in one place — and `pnpm typecheck:app` caught this the first time,
  // which is the whole argument for that project existing.
  const registeredUi = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-ui',
      layers: EMPTY_MODULE_LAYER,
      frameStages: uiModule.frameStages,
    }),
  )

  const registeredRedstone = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-redstone',
      layers: EMPTY_MODULE_LAYER,
      frameStages: redstoneModule.frameStages,
    }),
  )

  // -------------------------------------------------------------------------
  // 2c. gameplayModule, and the four services it requires
  // -------------------------------------------------------------------------
  //
  // `gameplayModule` is `GameModule<..., ChunkStore | EntityManager |
  // InventoryService | PlayerService>`. Until mx-gameplay shipped complete
  // in-memory implementations of all four, this file's own header recorded the
  // wall correctly: the only implementations in the organisation were
  // `test/support/*-double.ts`, none exported, and composing them would be
  // 「偽物のモジュールを4つ作って合成すれば、検証されるのは偽物である」.
  //
  // WHAT CHANGED IS NOT THAT RULE. Those four are now real services on
  // mx-gameplay's PUBLIC API — every member implemented, no `dieMessage`, and
  // mc-compose is allowed to import mx-gameplay. Nothing here reaches past it.
  //
  const playerApi = world.player
  const inputApi = Context.get(inputContext, InputService)
  const isBlockSolid = solidityFromStore(world.chunkStore)

  let playerVelocityY = 0
  let grounded = false
  let breaksRequested = 0
  let placementsRequested = 0

  // THE FRAME STATE IS BUILT HERE, not inside `gameplayModule`, and that is the
  // whole reason breaking works. `gameplayStages` takes the state as an
  // argument — `makeGameplayStages` builds a private one — and `pendingBreaks`
  // is an INBOX the host fills. mx-gameplay's own header says so: "Input
  // belongs to mc-render and reaches the rules as a request to act on a
  // position."
  //
  // A host that used `gameplayModule` directly would get stages that drain an
  // inbox nobody can reach, which is the 「callable but unreachable」 state that
  // repository has had to correct more than once.
  const gameplayState = await Effect.runPromise(makeGameplayFrameState)
  const observedMobDrops: Array<MobDropEvent & { readonly renderId: string }> = []
  let nextMobDropId = 0

  const registeredGameplay = await Effect.runPromise(
    registerModule({
      name: '@nerima-games/mx-gameplay',
      layers: EMPTY_MODULE_LAYER,
      frameStages: Effect.succeed(
        gameplayStages(
          gameplayState,
          world.chunkStore,
          world.entities,
          world.inventory,
          world.player,
        ),
      ),
    }),
  )

  const modules: ReadonlyArray<GameModule> = [
    registeredRender,
    registeredUi,
    registeredRedstone,
    registeredGameplay,
  ]

  // -------------------------------------------------------------------------
  // 3. Composition
  // -------------------------------------------------------------------------

  const composed = composeGame(modules)

  if (Either.isLeft(composed)) {
    failBoot('composeGame rejected the stage set', composed.left)
    return
  }

  const game = composed.right

  // Reported, never enforced — `domain/composition.ts` on why a dangling `after`
  // is legal and still worth printing.
  for (const warning of game.warnings) {
    console.warn(`[mc-compose] ${warning}`)
  }

  // The resolved total order, in the DOM. This is (a) of docs/testing.md §3.4
  // made visible in the browser: `test/e2e/roster-frame-order.test.ts` proves it
  // headless from a transcript, and this is the same claim about the modules
  // actually loaded.
  stageList.textContent = game.plan.order.join(' ')
  stageList.setAttribute('data-stage-count', String(game.plan.order.length))

  // -------------------------------------------------------------------------
  // 4. Screens
  // -------------------------------------------------------------------------

  // `document` satisfies mx-ui's `DomElementFactory` without a cast — that is
  // the property `mx-ui/application/dom-surface.ts` was designed around, and
  // the parent is an argument because mx-ui never goes looking for a document
  // (docs/public-api.md §4-1).
  //
  // NOTE: mx-ui's tidy `UiMount` facade in §4-1 is still unimplemented, so the
  // host calls the per-screen constructors directly. That is a smaller surface
  // than it looks: both take (factory, parent, motion) and hand back a handle.
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
  const hud = createHudView(document, hudParent, motion)
  const inventoryView = createInventoryView(document, inventoryParent)
  createCrosshairView(document, hudParent, motion)

  inventoryParent.setAttribute('role', 'dialog')
  inventoryParent.setAttribute('aria-label', 'Inventory')
  inventoryParent.setAttribute('aria-hidden', 'true')
  document.body.setAttribute('data-inventory-open', 'false')

  let selectedHotbarIndex = 0
  let inventoryFocus: InventoryInteractionTarget = {
    kind: 'slot',
    region: 'hotbar',
    index: selectedHotbarIndex,
  }
  const inventoryInteraction = createInventoryInteraction(world.inventory, {
    onCrafted: () => markSessionDirty(),
  })
  const initialInventory = Effect.runSync(world.inventory.snapshot)
  const playerIsDead = (): boolean => Effect.runSync(world.vitals.view).healthPoints <= 0

  const interactionStatus = (): string => {
    const status = inventoryInteraction.state().status
    if (status === undefined) return ''
    switch (status._tag) {
      case 'Crafted':
        return `Crafted ${String(status.output.count)} ${status.output.item}`
      case 'MissingIngredients':
        return 'Missing ingredients'
      case 'NoRoom':
        return 'Inventory is full'
      case 'NoMatch':
        return 'No matching recipe'
    }
  }

  const renderPlayerUi = (inventory: typeof initialInventory): void => {
    const draft = inventoryInteraction.state()
    hud.render(hudViewModel({
      ...Effect.runSync(world.vitals.view),
      hotbar: inventory.slots.slice(0, 9).map((slot) => slotSnapshotOf(slot, undefined)),
      selectedHotbarIndex,
    }))
    inventoryView.render(inventoryViewModel({
      inventory,
      selectedHotbarIndex,
      durabilityBySlot: undefined,
      carried: draft.carried,
      armour: undefined,
      offhand: undefined,
      crafting: {
        gridWidth: draft.grid.width,
        grid: draft.grid.cells,
        result: draft.preview,
      },
      mergeableSlotIndices: undefined,
    }), {
      focused: inventoryFocus,
      status: interactionStatus(),
    })
  }

  const targetOf = (source: EventTarget | null): InventoryInteractionTarget | undefined => {
    if (!(source instanceof Element)) return undefined
    const interactive = source.closest<HTMLElement>('[role="button"]')
    if (interactive === null || !inventoryParent.contains(interactive)) return undefined
    if (interactive.matches('[data-mx-ui="crafting-output"]')) {
      return { kind: 'crafting-output' }
    }
    if (!interactive.matches('[data-mx-ui="slot"]')) return undefined
    const region = interactive.closest<HTMLElement>('[data-region]')?.dataset['region']
    const index = Number(interactive.dataset['slotIndex'])
    if (
      !Number.isInteger(index) ||
      (region !== 'hotbar' && region !== 'main' && region !== 'crafting-grid')
    ) {
      return undefined
    }
    return { kind: 'slot', region, index }
  }

  const focusRenderedTarget = (): void => {
    inventoryParent.querySelector<HTMLElement>('[role="button"][tabindex="0"]')?.focus()
  }

  const activateInventoryTarget = (target: InventoryInteractionTarget): void => {
    if (playerIsDead()) return
    inventoryFocus = target
    if (target.kind === 'crafting-output') {
      Effect.runSync(inventoryInteraction.craftOnce())
    } else if (target.region === 'crafting-grid') {
      inventoryInteraction.interactCraftingCell(target.index)
      Effect.runSync(inventoryInteraction.preview())
    } else if (target.region === 'hotbar') {
      Effect.runSync(inventoryInteraction.pickupInventoryItem(target.index))
    } else if (target.region === 'main') {
      Effect.runSync(inventoryInteraction.pickupInventoryItem(9 + target.index))
    }
    renderPlayerUi(Effect.runSync(world.inventory.snapshot))
  }

  inventoryParent.addEventListener('click', (event) => {
    if (playerIsDead()) return
    const target = targetOf(event.target)
    if (target !== undefined) activateInventoryTarget(target)
  })
  inventoryParent.addEventListener('keydown', (event) => {
    if (playerIsDead()) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    const target = targetOf(event.target)
    if (target === undefined) return
    event.preventDefault()
    activateInventoryTarget(target)
    focusRenderedTarget()
  })

  const setInventoryOpen = (open: boolean): void => {
    if (open && playerIsDead()) return
    inventoryOpen = open
    inventoryParent.hidden = !open
    inventoryParent.setAttribute('aria-hidden', String(!open))
    document.body.setAttribute('data-inventory-open', String(open))
    if (open) {
      inventoryFocus = { kind: 'slot', region: 'hotbar', index: selectedHotbarIndex }
    } else {
      inventoryInteraction.close()
    }
    renderPlayerUi(Effect.runSync(world.inventory.snapshot))
    if (open) window.requestAnimationFrame(focusRenderedTarget)
    if (open && document.pointerLockElement === canvas) {
      document.exitPointerLock()
    }
  }

  const respawnPlayer = (): void => {
    Effect.runSync(world.vitals.respawn)
    Effect.runSync(world.entities.reset)
    Effect.runSync(Ref.set(gameplayState.hostileContactCooldowns, new Map()))
    Effect.runSync(Ref.set(gameplayState.playerDamages, []))
    Effect.runSync(Ref.set(gameplayState.pendingBowShots, []))
    Effect.runSync(Ref.set(gameplayState.spawnAttempts, []))
    Effect.runSync(Ref.set(gameplayState.mobDrops, []))
    observedMobDrops.splice(0)
    Effect.runSync(world.player.restore(initialSpawnPose, initialSpawnDimension))
    playerVelocityY = 0
    grounded = false
    setInventoryOpen(false)
    markSessionDirty()
  }

  hudParent.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const control = event.target.closest('[data-mx-ui="respawn"]')
    if (control === null || !hudParent.contains(control)) return
    respawnPlayer()
  })

  renderPlayerUi(initialInventory)

  // -------------------------------------------------------------------------
  // 4a. Durable session publication
  // -------------------------------------------------------------------------

  let dirtyGeneration = 0
  let savedGeneration = 0
  let debounceTimer: number | undefined

  const requestFlush = (): Promise<void> => {
    const requestedGeneration = dirtyGeneration
    return saveCoordinator.requestSave().then(() => {
      savedGeneration = Math.max(savedGeneration, requestedGeneration)
      if (savedGeneration === dirtyGeneration) {
        document.body.setAttribute('data-session-persistence', 'saved')
      }
    })
  }

  const requestBackgroundFlush = (): void => {
    void requestFlush().catch(() => {
      // The coordinator already made the failure visible; background callers consume it.
    })
  }

  const flushDirty = (): void => {
    if (dirtyGeneration !== savedGeneration) requestBackgroundFlush()
  }

  markSessionDirty = () => {
    dirtyGeneration += 1
    document.body.setAttribute('data-session-persistence', 'dirty')
    if (debounceTimer !== undefined) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(flushDirty, SAVE_DEBOUNCE_MS)
  }

  // -------------------------------------------------------------------------
  // 5. QA surface
  // -------------------------------------------------------------------------

  const entityRenderProjection = (): ReadonlyArray<RenderEntity> =>
    Effect.runSync(world.entities.snapshot).entities.map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      feetPosition: entity.feetPosition,
      category: entity.kind === 'dropped_item' ? 'item' : 'hostile',
    }))

  const gameplaySnapshot = () => {
    const reading = Effect.runSync(world.chunkStore.getBlock(KNOWN_TARGET_BLOCK))
    const inventory = Effect.runSync(world.inventory.snapshot)
    const vitals = Effect.runSync(world.vitals.snapshot)
    const entities = Effect.runSync(world.entities.snapshot).entities
    return {
      pose: Effect.runSync(playerApi.pose),
      dimension: Effect.runSync(playerApi.dimension),
      vitals,
      dead: vitals.healthPoints <= 0,
      inventory: {
        slots: inventory.slots.map((slot) => slot ?? null),
      },
      entityCount: entities.length,
      renderedEntities: entityRenderProjection(),
      mobDrops: observedMobDrops.map(({ renderId: _, ...drop }) => drop),
      entities: entities.map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        feetPosition: entity.feetPosition,
        healthPoints: entity.healthPoints,
      })),
      target: {
        position: KNOWN_TARGET_BLOCK,
        reading: reading._tag,
        block: reading._tag === 'Block' ? reading.block : null,
      },
      persistence: {
        knownChunks: saveCoordinator.knownChunkCount(),
        retainedChunks: saveCoordinator.retainedChunkCount(),
      },
    }
  }

  const registry = buildQaRegistry([
    {
      namespace: 'gameplay',
      commands: {
        snapshot: gameplaySnapshot,
        setPose: () => {
          Effect.runSync(playerApi.restore(QA_POSE, Effect.runSync(playerApi.dimension)))
          playerVelocityY = 0
          grounded = false
          markSessionDirty()
          return gameplaySnapshot()
        },
        breakTarget: () => {
          if (playerIsDead()) return null
          const target = Effect.runSync(
            requestTargetedBlockBreak(gameplayState, world.chunkStore, playerApi),
          )
          if (Option.isSome(target)) markSessionDirty()
          return Option.isSome(target) ? target.value : null
        },
        seedCraftingLog: () => {
          if (playerIsDead()) return gameplaySnapshot()
          Effect.runSync(world.inventory.reset)
          Effect.runSync(world.inventory.add('oak_log', 1))
          inventoryInteraction.reset()
          markSessionDirty()
          renderPlayerUi(Effect.runSync(world.inventory.snapshot))
          return gameplaySnapshot()
        },
        damage: () => {
          Effect.runSync(world.vitals.damage({ amount: 4, cause: 'generic' }))
          markSessionDirty()
          renderPlayerUi(Effect.runSync(world.inventory.snapshot))
          return gameplaySnapshot()
        },
        heal: () => {
          Effect.runSync(world.vitals.heal(4))
          markSessionDirty()
          renderPlayerUi(Effect.runSync(world.inventory.snapshot))
          return gameplaySnapshot()
        },
        eat: () => {
          Effect.runSync(world.vitals.eat(4, 0.3))
          markSessionDirty()
          renderPlayerUi(Effect.runSync(world.inventory.snapshot))
          return gameplaySnapshot()
        },
        respawn: () => {
          respawnPlayer()
          return gameplaySnapshot()
        },
        shoot: () => {
          if (playerIsDead()) return gameplaySnapshot()
          const currentPose = Effect.runSync(playerApi.pose)
          const horizontal = Math.cos(currentPose.pitchRadians)
          Effect.runSync(requestBowShot(gameplayState, {
            origin: {
              x: currentPose.feetPosition.x,
              y: currentPose.feetPosition.y + EYE_LEVEL_OFFSET,
              z: currentPose.feetPosition.z,
            },
            dirX: -Math.sin(currentPose.yawRadians) * horizontal,
            dirY: Math.sin(currentPose.pitchRadians),
            dirZ: -Math.cos(currentPose.yawRadians) * horizontal,
            chargeSecs: 1,
          }))
          return gameplaySnapshot()
        },
        seedLethalZombieEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.vitals.damage({ amount: 18, cause: 'generic' }))
          const currentPose = Effect.runSync(playerApi.pose)
          Effect.runSync(requestMobSpawn(gameplayState, {
            kind: ZOMBIE_KIND,
            feetPosition: {
              x: currentPose.feetPosition.x + 0.5,
              y: currentPose.feetPosition.y,
              z: currentPose.feetPosition.z,
            },
            candidate: {
              groundBlock: 2,
              footBlock: 0,
              headBlock: 0,
              blockLight: 0,
              timeOfDay: 0,
              distanceToPlayerBlocksXZ: 16,
            },
          }))
          markSessionDirty()
          return gameplaySnapshot()
        },
        seedMeleeDropEncounter: () => {
          respawnPlayer()
          Effect.runSync(world.inventory.reset)
          inventoryInteraction.reset()
          const spawnPose = Effect.runSync(playerApi.pose)
          Effect.runSync(playerApi.look(-spawnPose.yawRadians, -spawnPose.pitchRadians))
          const currentPose = Effect.runSync(playerApi.pose)
          const distance = 2
          const horizontal = Math.cos(currentPose.pitchRadians)
          const direction = {
            x: -Math.sin(currentPose.yawRadians) * horizontal,
            y: Math.sin(currentPose.pitchRadians),
            z: -Math.cos(currentPose.yawRadians) * horizontal,
          }
          const eyeY = Math.floor(currentPose.feetPosition.y + EYE_LEVEL_OFFSET)
          for (let zOffset = 0; zOffset >= -3; zOffset -= 1) {
            Effect.runSync(world.chunkStore.setBlock({
              x: Math.floor(currentPose.feetPosition.x),
              y: eyeY,
              z: Math.floor(currentPose.feetPosition.z) + zOffset,
            }, 0))
          }
          Effect.runSync(
            world.entities.spawn({
              kind: CREEPER_KIND,
              feetPosition: {
                x: currentPose.feetPosition.x + direction.x * distance,
                y: currentPose.feetPosition.y
                  + EYE_LEVEL_OFFSET
                  + direction.y * distance
                  - 0.9,
                z: currentPose.feetPosition.z + direction.z * distance,
              },
              healthPoints: 1,
              behaviour: undefined,
            }),
          )
          markSessionDirty()
          renderPlayerUi(Effect.runSync(world.inventory.snapshot))
          return gameplaySnapshot()
        },
      },
    },
    {
      namespace: 'persistence',
      commands: { flush: requestFlush },
    },
  ])
  if (Either.isLeft(registry)) {
    failBoot('QA registry rejected', describeQaApiError(registry.left))
    return
  }
  installQaApi(globalThis as unknown as Record<string, unknown>, registry.right)

  window.setInterval(requestBackgroundFlush, AUTOSAVE_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') requestBackgroundFlush()
  })
  // IndexedDB cannot be made synchronous during pagehide; this is best-effort.
  // Periodic publication persists the advancing clock even without gameplay mutations.
  window.addEventListener('pagehide', requestBackgroundFlush)

  // -------------------------------------------------------------------------
  // 6. The frame
  // -------------------------------------------------------------------------

  const runFrame = game.runFrameWith(BrowserClockLayer)

  // Time is read through the Port, not from `performance`. `apps/web/clock.ts`
  // is the only file allowed the raw reading and `pnpm check:deps` enforces it.
  const readNow = (): number => Effect.runSync(browserClock.monotonicSecs)

  let previousSecs: number | undefined
  let framesThisWindow = 0
  let windowStartedAtSecs = readNow()
  let framesTotal = 0

  document.body.setAttribute('data-mc-compose-boot', 'running')

  const tick = (): void => {
    const nowSecs = readNow()
    const raw = previousSecs === undefined ? FIRST_FRAME_SECS : nowSecs - previousSecs
    previousSecs = nowSecs
    const deltaSecs = clampDelta(raw)

    // -----------------------------------------------------------------------
    // The player, moved and stopped by the world
    // -----------------------------------------------------------------------
    //
    // WIRING, NOT A RULE. Every decision here belongs to a module and is called
    // rather than made: `resolvePlayerMovement` and `applyGravity` are
    // mx-gameplay's, the pose lives in its `PlayerService`, and the camera is
    // mc-render's mirror of that pose. What this loop contributes is the order.
    //
    // THE DELTA IS ALREADY CLAMPED to `MAX_FRAME_SECS` above, and that clamp is
    // now load-bearing twice over: it was there so a backgrounded tab does not
    // return with a multi-second step, and it is also what keeps the resolver
    // out of its tunnelling regime — `resolvePlayerMovement` resolves the box at
    // the final position only, so a step large enough to jump a block sees
    // nothing. mx-gameplay's own test states that limit.
    const walk = Effect.runSync(inputApi.snapshot)
    const foodOutcome = Effect.runSync(world.vitals.advanceFoodTimer(deltaSecs))
    if (foodOutcome.signal !== 'none') markSessionDirty()

    const dead = playerIsDead()
    if (dead) {
      if (inventoryOpen) setInventoryOpen(false)
      if (document.pointerLockElement === canvas) document.exitPointerLock()
    }

    if (!dead && Effect.runSync(inputApi.wasActionJustTriggered('openInventory'))) {
      setInventoryOpen(!inventoryOpen)
    }

    if (!dead && !inventoryOpen) {
      selectedHotbarIndex = selectedHotbarAfterInput(
        selectedHotbarIndex,
        walk.wheelSteps,
        (action) => Effect.runSync(inputApi.wasActionJustTriggered(action)),
        wrapHotbarSelection,
      )
    }

    const held = (action: Parameters<typeof inputApi.isActionActive>[0]): number =>
      !dead && !inventoryOpen && Effect.runSync(inputApi.isActionActive(action)) ? 1 : 0

    const looked =
      !dead && !inventoryOpen && (walk.pointerDelta.x !== 0 || walk.pointerDelta.y !== 0)
    if (!dead && !inventoryOpen) {
      Effect.runSync(playerApi.look(-walk.pointerDelta.x * LOOK_SENSITIVITY, -walk.pointerDelta.y * LOOK_SENSITIVITY))
    }
    const pose = Effect.runSync(playerApi.pose)

    let resolvedFeet = pose.feetPosition
    if (dead) {
      playerVelocityY = 0
      grounded = false
    } else {
      const forward = held('moveForward') - held('moveBackward')
      const strafe = held('moveRight') - held('moveLeft')
      // Horizontal only, regardless of pitch: looking down and walking forward
      // must not drive the player into the ground.
      const sinYaw = Math.sin(pose.yawRadians)
      const cosYaw = Math.cos(pose.yawRadians)

      playerVelocityY = grounded && held('jump') > 0
        ? JUMP_SPEED_M_PER_S
        : applyGravity(playerVelocityY, deltaSecs)

      const resolved = resolvePlayerMovement(
        {
          centre: {
            x: pose.feetPosition.x,
            y: pose.feetPosition.y + PLAYER_HALF_HEIGHT,
            z: pose.feetPosition.z,
          },
          velocity: {
            x: (-sinYaw * forward + cosYaw * strafe) * WALK_SPEED_M_PER_S,
            y: playerVelocityY,
            z: (-cosYaw * forward - sinYaw * strafe) * WALK_SPEED_M_PER_S,
          },
        },
        deltaSecs,
        isBlockSolid,
      )

      resolvedFeet = {
        x: resolved.body.centre.x,
        y: resolved.body.centre.y - PLAYER_HALF_HEIGHT,
        z: resolved.body.centre.z,
      }
      const horizontalDistance = Math.hypot(
        resolvedFeet.x - pose.feetPosition.x,
        resolvedFeet.z - pose.feetPosition.z,
      )
      if (horizontalDistance > 0) {
        Effect.runSync(world.vitals.addExhaustion(horizontalDistance * WALK_EXHAUSTION_PER_METRE))
      }
      grounded = resolved.isGrounded
      playerVelocityY = resolved.body.velocity.y
    }

    const moved =
      resolvedFeet.x !== pose.feetPosition.x ||
      resolvedFeet.y !== pose.feetPosition.y ||
      resolvedFeet.z !== pose.feetPosition.z
    Effect.runSync(playerApi.moveTo(resolvedFeet))
    if (looked || moved) markSessionDirty()

    // Gameplay resolves mob-versus-block priority atomically so one click
    // cannot enqueue both interactions.
    if (!dead && !inventoryOpen && Effect.runSync(inputApi.wasActionJustTriggered('attack'))) {
      const result = Effect.runSync(
        requestTargetedPrimaryAttack(
          gameplayState,
          world.chunkStore,
          world.entities,
          playerApi,
        ),
      )
      if (result._tag === 'Block') {
        breaksRequested += 1
        canvas.setAttribute('data-breaks-requested', String(breaksRequested))
        markSessionDirty()
      } else if (result._tag === 'Melee') {
        markSessionDirty()
      }
    }

    if (!dead && !inventoryOpen && Effect.runSync(inputApi.wasActionJustTriggered('use'))) {
      const inventoryBeforeUse = Effect.runSync(world.inventory.snapshot)
      requestPlacementFromSelectedSlot(
        inventoryBeforeUse.slots,
        selectedHotbarIndex,
        isPlaceableItem,
        (heldItem) => {
          const target = Effect.runSync(
            requestTargetedBlockPlacement(
              gameplayState,
              world.chunkStore,
              playerApi,
              heldItem,
            ),
          )
          if (Option.isSome(target)) {
            placementsRequested += 1
            canvas.setAttribute('data-placements-requested', String(placementsRequested))
            markSessionDirty()
          }
        },
      )
    }

    // Stream from where the player ACTUALLY ended up, not from where they
    // asked to go: a player stopped by a wall should not load the chunks behind
    // it.
    Effect.runSync(Ref.set(gameplayState.targetPosition, resolvedFeet))
    Effect.runSync(time.advance(deltaSecs))
    Effect.runSync(Ref.set(gameplayState.timeOfDay, Effect.runSync(time.timeOfDay)))
    Effect.runSync(streamAround(resolvedFeet.x, resolvedFeet.z))
    canvas.setAttribute(
      'data-player-feet',
      `${resolvedFeet.x.toFixed(2)},${resolvedFeet.y.toFixed(2)},${resolvedFeet.z.toFixed(2)}`,
    )
    canvas.setAttribute('data-player-grounded', String(grounded))

    const outcome = Effect.runSyncExit(runFrame(deltaSecs))

    if (Exit.isFailure(outcome)) {
      // A stage's error channel is `never`, so reaching here means a DEFECT.
      // Stopping the loop is deliberate: a defect that repeats sixty times a
      // second buries its own first occurrence in the console.
      failBoot('a frame stage defected', outcome.cause)
      return
    }

    const playerDamages = Effect.runSync(drainPlayerDamages(gameplayState))
    for (const event of playerDamages) {
      Effect.runSync(world.vitals.damage(event.damage))
    }
    if (playerDamages.length > 0) {
      markSessionDirty()
      if (playerIsDead()) {
        setInventoryOpen(false)
        if (document.pointerLockElement === canvas) document.exitPointerLock()
      }
    }

    const mobDrops = Effect.runSync(drainMobDrops(gameplayState))
    if (mobDrops.length > 0) {
      Effect.runSync(spawnMobDrops(world.entities, mobDrops))
      markSessionDirty()
    }
    for (const drop of mobDrops) {
      nextMobDropId += 1
      observedMobDrops.push({ ...drop, renderId: `mob-drop-${nextMobDropId}` })
    }

    Effect.runSync(worldRenderer.syncEntities(entityRenderProjection()))
    renderPlayerUi(Effect.runSync(world.inventory.snapshot))

    framesTotal += 1
    framesThisWindow += 1

    const windowSecs = nowSecs - windowStartedAtSecs
    if (windowSecs >= FPS_WINDOW_SECS) {
      fpsValue.textContent = String(Math.round(framesThisWindow / windowSecs))
      framesThisWindow = 0
      windowStartedAtSecs = nowSecs
    }

    // Readable by a test without a QA command: the frame count IS the claim
    // that the loop is running, and docs/e2e-triage.md #4 is exactly that claim.
    document.body.setAttribute('data-frames', String(framesTotal))

    requestAnimationFrame(tick)
  }

  requestAnimationFrame(tick)
}

boot().catch((error: unknown) => {
  failBoot('boot threw', error)
})
