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
 * WHY THREE MODULES AND NOT SIX — read this before adding a fourth
 * ---------------------------------------------------------------------------
 *
 * `mc-render`, `mx-ui` and `mx-redstone` are composed. `mx-gameplay` and
 * `mx-multiplayer` are NOT, and the reason is a measurement rather than a
 * preference:
 *
 *   - `gameplayModule` is `GameModule<never, never, never, ChunkStore |
 *     EntityManager | InventoryService>`. Registering it requires all three.
 *   - `multiplayerModule` requires `TransportPort`.
 *   - The ONLY implementations of any of the four in the organisation are in
 *     `mx-gameplay/test/support/*-double.ts` and
 *     `mx-multiplayer`'s test support. They are test doubles, and none is
 *     exported from a package's public API (`exports` is `"." : "./index.ts"`).
 *
 * A host that supplied its own `ChunkStore` would be writing the world's
 * storage in the composition layer, which is the exact failure
 * `domain/composition.ts` exists to prevent, and `InventoryService` is mc-sim's
 * — which `pnpm check:deps` refuses to let this repository import at all.
 * docs/e2e-triage.md §4.3 reached this same wall from the other side and called
 * it "設計上の未決事項"; this file is where that undecided item stops being
 * theoretical.
 *
 * COMPOSING A FAKE INSTEAD IS THE ONE THING THAT MUST NOT HAPPEN HERE.
 * docs/testing.md §3.4: 偽物のモジュールを4つ作って合成すれば、検証されるのは偽物である
 * — a green lamp with nothing behind it.
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
 * WHAT IS ON THE SCREEN, precisely: the sky colour mc-render clears to
 * (`SKY_CLEAR_COLOR`, transcribed from the reference's `SKY_COLOR_DAY`), and
 * nothing else. No chunk geometry reaches the renderer because no world reaches
 * this page — `mc-worldgen` and `mc-meshing` are not among the three siblings
 * `vite.config.ts` can resolve, and for the reason stated under "WHY THREE
 * MODULES AND NOT SIX" they cannot be: registering `gameplayModule` needs a
 * `ChunkStore` and the only implementations in the organisation are test
 * doubles. So #1 passes for the reason it names — a WebGL2 context exists and
 * is active — and the picture is a blue field. That is the honest state and it
 * is worth having: it is the difference between "no context" and "no content",
 * and until now those two were indistinguishable from this page.
 */
import * as THREE from 'three'
import { Effect, Either, Exit, Layer, Scope } from 'effect'
import { browserInputLayer, makeWorldRenderer, renderModule } from '@nerima-games/mc-render'
import {
  createCrosshairView,
  createHudView,
  hudViewModel,
  spawnSnapshot,
  uiModule,
} from '@nerima-games/mx-ui'
import { redstoneModule } from '@nerima-games/mx-redstone'
import {
  composeGame,
  EMPTY_MODULE_LAYER,
  registerModule,
  type GameModule,
} from '../../domain/composition'
import { DeltaTimeSecs } from "@nerima-games/mc-kernel"
import { buildQaRegistry, describeQaApiError, installQaApi } from '../../domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'

/**
 * plan.md §3.4's measured clamp, applied by the DELTA'S PRODUCER.
 *
 * `@nerima-games/mc-kernel` is explicit that this is not part of the
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
  const fpsValue = requireElement('fps-value')
  const stageList = requireElement('stage-order')

  // -------------------------------------------------------------------------
  // 1. Platform adapters
  // -------------------------------------------------------------------------

  // The scope stays open for the life of the page ON PURPOSE. `browserInputLayer`
  // is `Layer.scoped` and removes its listeners when the scope closes; closing
  // it here would install the listeners and immediately take them away.
  const scope = Effect.runSync(Scope.make())

  const inputLayer = browserInputLayer({
    targets: { window, document },
    canvas,
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

  // `renderModule()` is called for its `frameStages` only; its `layers` field
  // is replaced by the browser adapter. The module's own header sanctions
  // exactly this: "Pass it where `InputServiceLayer()` would go — `renderModule`'s
  // `layers` is the same tag."
  //
  // The third argument is the `DrawPort` that `render:draw` calls. Its default
  // is `NO_DRAW_TARGET`, which is what every Node consumer gets and what this
  // page got until the renderer existed.
  const render = renderModule(undefined, undefined, worldRenderer)

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

  const modules: ReadonlyArray<GameModule> = [registeredRender, registeredUi, registeredRedstone]

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
  createCrosshairView(document, hudParent, motion)

  // The spawn snapshot, once. `ui:hud-sync` re-projects it every frame from the
  // module's own Ref; this first call is only so that the HUD is not blank
  // between mount and the first frame.
  hud.render(hudViewModel(spawnSnapshot))

  // -------------------------------------------------------------------------
  // 5. QA surface
  // -------------------------------------------------------------------------

  // EMPTY, and that is the honest state. `domain/qa-api.ts`: "compose does not
  // author commands" — a namespace belongs to the module that owns the state it
  // exposes, and no composed module contributes one yet. Publishing the empty
  // registry still proves the install path ran, which is a boot milestone the
  // smoke tests can read.
  const registry = buildQaRegistry([])
  if (Either.isLeft(registry)) {
    failBoot('QA registry rejected', describeQaApiError(registry.left))
    return
  }
  installQaApi(globalThis as unknown as Record<string, unknown>, registry.right)

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

    const outcome = Effect.runSyncExit(runFrame(clampDelta(raw)))

    if (Exit.isFailure(outcome)) {
      // A stage's error channel is `never`, so reaching here means a DEFECT.
      // Stopping the loop is deliberate: a defect that repeats sixty times a
      // second buries its own first occurrence in the console.
      failBoot('a frame stage defected', outcome.cause)
      return
    }

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
