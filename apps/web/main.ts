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
 * There is no renderer, and the page says so
 * ---------------------------------------------------------------------------
 *
 * mc-render draws nothing yet. `render:draw` is
 * `Ref.update(state.framesDrawn, (drawn) => drawn + 1)` and the repository has
 * no `three` dependency and no `getContext` call anywhere — its THREE.js
 * surface is a documented FIRST CUT seam, not code. So this page creates NO
 * WebGL context, and `docs/e2e-triage.md` #1 (`WebGL2 canvas is present and
 * active`) stays unmet. The canvas below exists because the pointer-lock target
 * and the click-landing vocabulary are real and need an element; it is
 * deliberately never given a drawing context, because a `getContext('webgl2')`
 * placed here to make a test green would be this repository drawing, and it
 * would make #1 pass while asserting nothing about mc-render.
 */
import { Effect, Either, Exit, Layer, Scope } from 'effect'
import { browserInputLayer, renderModule } from '@nerima-games/mc-render'
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
import { DeltaTimeSecs } from '../../domain/kernel-vocabulary'
import { buildQaRegistry, describeQaApiError, installQaApi } from '../../domain/qa-api'
import { BrowserClockLayer, browserClock } from './clock'

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

const requireElement = (id: string): HTMLElement => {
  const element = document.getElementById(id)
  if (element === null) {
    throw new Error(`index.html is missing #${id}`)
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
  const canvas = requireElement('game-canvas')
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

  // `renderModule()` is called for its `frameStages` only; its `layers` field
  // is replaced by the browser adapter. The module's own header sanctions
  // exactly this: "Pass it where `InputServiceLayer()` would go — `renderModule`'s
  // `layers` is the same tag."
  const render = renderModule()

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
