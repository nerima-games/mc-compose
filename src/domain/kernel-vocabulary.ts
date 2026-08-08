/**
 * PROVISIONAL LOCAL MIRROR OF `@nerima-games/mc-kernel`.
 *
 * ---------------------------------------------------------------------------
 * This module is scheduled for deletion. Do not build on it.
 * ---------------------------------------------------------------------------
 *
 * plan.md §6 Step 3 publishes the repositories bottom-up, so nothing is on
 * GitHub Packages yet and mc-compose cannot `import ... from
 * '@nerima-games/mc-kernel'`. The declarations mc-compose needs from kernel are
 * therefore mirrored here, verbatim in shape and semantics, from
 * `mc-kernel/domain/{quantities,clock,frame}.ts`.
 *
 * WHEN mc-kernel IS PUBLISHED:
 *   1. add `@nerima-games/mc-kernel` to `package.json#dependencies`;
 *   2. delete this file;
 *   3. repoint every `from './kernel-vocabulary'` at `'@nerima-games/mc-kernel'`.
 * `test/kernel-mirror.test.ts` is what makes step 3 safe to attempt.
 *
 * ---------------------------------------------------------------------------
 * Why mc-compose mirrors the Clock Port WHOLE, when mx-* deliberately do not
 * ---------------------------------------------------------------------------
 *
 * The experience modules (`mx-gameplay`, `mx-redstone`, `mx-ui`) set
 * `FrameServices = never` in their own mirrors and say so explicitly: they are
 * stage AUTHORS, an `Effect<void, never, never>` is assignable wherever
 * `Effect<void, never, ClockPort>` is wanted, and restating a `Context.Tag`
 * they never construct would buy them nothing.
 *
 * mc-compose is the stage PROVIDER. It has to be able to accept a stage written
 * against kernel's real contract — `Effect<void, never, ClockPort>` — and then
 * DISCHARGE that requirement, which is impossible without naming the Tag. The
 * previous local `StageRegistration` dropped the R channel entirely
 * (`Effect<void>`); R does not erase itself, so kernel's stage was simply not
 * assignable, and `composeGame` compiled only because all three mx-* mirrors
 * happened to say `never`. All three commit to deleting those files the moment
 * kernel publishes, at which point compose would have stopped compiling.
 *
 * Effect resolves Tags by their TEXTUAL KEY, so a mirror built from
 * `'@nerima-games/mc-kernel/ClockPort'` IS kernel's service at runtime. That is
 * what makes the mirror sound — and it is also why it must be mirrored WHOLE: a
 * narrower `ClockService` would satisfy the same tag with a field missing, and
 * the hole would open in a repository that never saw this file. mc-sim's mirror
 * carries the identical reasoning in its own header.
 */
import { Brand, Context, Effect, Layer } from 'effect'

/** The floor of the non-negative range every quantity below is checked against. */
const MIN_SECONDS = 0

// ---------------------------------------------------------------------------
// Quantities — mirrors mc-kernel/domain/quantities.ts
// ---------------------------------------------------------------------------

/**
 * Elapsed simulation time for one frame, in seconds. Finite and non-negative.
 * A zero delta is legal: a frame may be scheduled twice inside one clock tick.
 *
 * BRANDED, and that matters here more than anywhere else in the roster: this
 * repository owns the one call site in the whole build that actually invokes
 * `StageRegistration.run`. An unbranded `number` there means every stage in
 * every module is handed a value nobody validated.
 *
 * plan.md §3.4 records the reference implementation's measured clamp
 * (`min(max(0.001, raw), 0.05)`, first frame 0.016). THAT CLAMP IS NOT PART OF
 * THE BRAND, and it is not applied by mc-compose. It is a simulation invariant
 * belonging to whoever produces the delta; the brand only refuses values that
 * are not a duration at all.
 */
export type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>

export const DeltaTimeSecs = Brand.refined<DeltaTimeSecs>(
  (value) => Number.isFinite(value) && value >= MIN_SECONDS,
  (value) => Brand.error(`DeltaTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A reading from a monotonic clock, in seconds. Never decreases; the origin is
 * unspecified, so only differences are meaningful. Comes from `ClockPort`.
 */
export type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>

export const MonotonicTimeSecs = Brand.refined<MonotonicTimeSecs>(
  (value) => Number.isFinite(value) && value >= MIN_SECONDS,
  (value) => Brand.error(`MonotonicTimeSecs must be a finite, non-negative number of seconds, received ${value}`),
)

/**
 * A wall-clock reading: milliseconds since the Unix epoch. Only for values a
 * human reads or that must survive a save/load round trip — never for
 * durations, because it can jump in either direction.
 *
 * Mirrored solely so that `ClockService` below has kernel's real shape.
 */
export type EpochMillis = number & Brand.Brand<'EpochMillis'>

export const EpochMillis = Brand.refined<EpochMillis>(
  (value) => Number.isSafeInteger(value),
  (value) => Brand.error(`EpochMillis must be a safe integer number of milliseconds, received ${value}`),
)

// ---------------------------------------------------------------------------
// Clock Port — mirrors mc-kernel/domain/clock.ts
// ---------------------------------------------------------------------------

export type ClockService = {
  /** Monotonic reading. Only differences between readings are meaningful. */
  readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
  /** Wall-clock reading. Never use for durations. */
  readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
}

export class ClockPort extends Context.Tag('@nerima-games/mc-kernel/ClockPort')<ClockPort, ClockService>() {}

/** A clock frozen at one instant. Platform-independent, hence shippable by kernel. */
export const fixedClock = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): ClockService => ({
  monotonicSecs: Effect.succeed(at.monotonicSecs),
  wallClockEpochMillis: Effect.succeed(at.wallClockEpochMillis),
})

/** `fixedClock` as a Layer, for deterministic tests and replays. */
export const FixedClockLayer = (at: {
  readonly monotonicSecs: MonotonicTimeSecs
  readonly wallClockEpochMillis: EpochMillis
}): Layer.Layer<ClockPort> => Layer.succeed(ClockPort, fixedClock(at))

/** Read the monotonic clock. The only sanctioned answer to "what time is it?". */
export const monotonicSecs: Effect.Effect<MonotonicTimeSecs, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.monotonicSecs,
)

/** Read the wall clock. Only for human-facing or persisted values. */
export const wallClockEpochMillis: Effect.Effect<EpochMillis, never, ClockPort> = Effect.flatMap(
  ClockPort,
  (clock) => clock.wallClockEpochMillis,
)

// ---------------------------------------------------------------------------
// Frame contract — mirrors mc-kernel/domain/frame.ts
// ---------------------------------------------------------------------------

/**
 * The context every frame stage may assume is present. Kernel's answer, settled
 * by the vertical-slice spike: `ClockPort`, and nothing else.
 *
 * Widening it is a breaking change for stage PROVIDERS, which is this
 * repository — `runFrameWith` below is the one place that has to supply it.
 */
export type FrameServices = ClockPort
