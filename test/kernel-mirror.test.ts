/**
 * The host's use of mc-kernel is pinned against kernel's documented shape.
 *
 * Keeping these assertions at the dependency boundary makes an upgrade
 * explicit. The roster has already broken this contract twice: mc-sim's copy
 * once carried a one-field `ClockService` where kernel's carries two, and
 * mc-physics refined `DeltaTimeSecs` to the frame-loop clamp `[0.001, 0.05]`
 * where kernel refines it to "finite and non-negative".
 *
 * Neither divergence is visible to `tsc`. A brand is keyed by its STRING
 * (`Brand.Brand<'DeltaTimeSecs'>`), so an independently declared shape and
 * kernel's original are one type however differently they validate; a
 * `Context.Tag` is keyed by its string too, so independently declared Ports
 * can become one service at runtime. Both are failures a type checker is
 * structurally unable to catch, which is why they are asserted here.
 *
 * mc-compose is the stage PROVIDER: it has to discharge `FrameServices`, and
 * it cannot discharge what it cannot name.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import {
  DeltaTimeSecs,
  ClockPort,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  monotonicSecs,
  MonotonicTimeSecs,
  wallClockEpochMillis,
  type ClockService,
  type FrameServices,
} from '@nerima-games/mc-kernel'

const FIXED_AT = {
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
}

describe('the host uses kernel’s branded contracts', () => {
  // REGRESSION: kernel (mc-kernel/domain/quantities.ts) refines DeltaTimeSecs
  // to "finite and non-negative" and says a ZERO delta is legal, because a
  // frame may be scheduled twice inside one clock tick. The [0.001, 0.05] clamp
  // of plan.md §3.4 is a FRAME-LOOP concern applied at the boundary by whoever
  // produces the delta — never a property of the quantity, and emphatically not
  // something this repository applies while passing it along.
  it.effect('DeltaTimeSecs is finite and non-negative — kernel’s refinement, not the clamp', () =>
    Effect.sync(() => {
      expect(DeltaTimeSecs(0)).toBe(0)
      expect(DeltaTimeSecs(0.0001)).toBe(0.0001)
      expect(DeltaTimeSecs(30)).toBe(30)
      expect(() => DeltaTimeSecs(-0.000_001)).toThrow()
      expect(() => DeltaTimeSecs(Number.NaN)).toThrow()
      expect(() => DeltaTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('MonotonicTimeSecs is finite and non-negative', () =>
    Effect.sync(() => {
      expect(MonotonicTimeSecs(0)).toBe(0)
      expect(() => MonotonicTimeSecs(-1)).toThrow()
      expect(() => MonotonicTimeSecs(Number.POSITIVE_INFINITY)).toThrow()
    }),
  )

  it.effect('EpochMillis is a safe integer', () =>
    Effect.sync(() => {
      expect(EpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000)
      expect(() => EpochMillis(1.5)).toThrow()
      expect(() => EpochMillis(Number.MAX_VALUE)).toThrow()
    }),
  )
})

describe('the independent Clock Port shape matches kernel’s', () => {
  // REGRESSION — the exact failure mc-sim's mirror once had. Effect resolves a
  // Tag by its TEXTUAL KEY, so a Layer built against an independent one-field
  // shape satisfies kernel's two-field tag and the missing field reads `undefined` in
  // a repository that never saw this file. tsc cannot see it; this can.
  it.effect('carries kernel’s tag string, so it IS kernel’s service at runtime', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('REGRESSION: ClockService has BOTH readings, not just the one compose uses', () =>
    Effect.gen(function* () {
      /** Kernel's shape, restated from `mc-kernel/domain/clock.ts`. */
      type KernelClockService = {
        readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>
        readonly wallClockEpochMillis: Effect.Effect<EpochMillis>
      }

      const asKernel: KernelClockService = fixedClock(FIXED_AT)
      const asIndependentShape: ClockService = {
        monotonicSecs: Effect.succeed(MonotonicTimeSecs(0)),
        wallClockEpochMillis: Effect.succeed(EpochMillis(0)),
      }

      const fields = ['monotonicSecs', 'wallClockEpochMillis']
      expect(Object.keys(asKernel).sort()).toStrictEqual(fields)
      expect(Object.keys(asIndependentShape).sort()).toStrictEqual(fields)

      expect(yield* monotonicSecs.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(1_234.5)
      expect(yield* wallClockEpochMillis.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(
        1_700_000_000_000,
      )
    }),
  )
})

describe('FrameServices matches kernel’s settled answer', () => {
  // REGRESSION: kernel froze `FrameServices = ClockPort` after the vertical
  // slice spike. This repository is the one that has to SUPPLY it, so a mirror
  // that drifted narrow would silently stop discharging part of the frame's
  // requirement — and an independently declared contract that drifted wide would demand something no host
  // has. `Exclude` in both directions is what makes this an equality.
  it.effect('is exactly ClockPort — no wider, no narrower', () =>
    Effect.sync(() => {
      type NoWider = Exclude<FrameServices, ClockPort>
      type NoNarrower = Exclude<ClockPort, FrameServices>
      const widerIsEmpty: NoWider extends never ? true : false = true
      const narrowerIsEmpty: NoNarrower extends never ? true : false = true

      expect(widerIsEmpty).toBe(true)
      expect(narrowerIsEmpty).toBe(true)
    }),
  )

  it.effect('a Layer<FrameServices> is exactly what discharges a frame', () =>
    Effect.gen(function* () {
      const services: Layer.Layer<FrameServices> = FixedClockLayer(FIXED_AT)
      const discharged: Effect.Effect<MonotonicTimeSecs, never, never> = Effect.provide(
        monotonicSecs,
        services,
      )
      expect(yield* discharged).toBe(1_234.5)
    }),
  )
})
