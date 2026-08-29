/**
 * The shared quantity and service contracts come directly from mc-kernel.
 *
 * These assertions protect the integration boundary that mc-compose supplies:
 * frame deltas use kernel's refinement, the host clock has both readings, and
 * the frame environment is exactly the kernel ClockPort.
 */
import { describe, expect, it } from '@effect/vitest'
import {
  ClockPort,
  DeltaTimeSecs,
  EpochMillis,
  FixedClockLayer,
  fixedClock,
  monotonicSecs,
  MonotonicTimeSecs,
  wallClockEpochMillis,
  type ClockService,
  type FrameServices,
} from '@nerima-games/mc-kernel'
import { Effect, Layer } from 'effect'

const FIXED_AT = {
  monotonicSecs: MonotonicTimeSecs(1_234.5),
  wallClockEpochMillis: EpochMillis(1_700_000_000_000),
}

describe('mc-kernel quantity contracts', () => {
  it.effect('DeltaTimeSecs is finite and non-negative — not the frame clamp', () =>
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

describe('mc-kernel ClockPort contract', () => {
  it.effect('uses the published service tag', () =>
    Effect.sync(() => {
      expect(ClockPort.key).toBe('@nerima-games/mc-kernel/ClockPort')
    }),
  )

  it.effect('exposes both clock readings', () =>
    Effect.gen(function* () {
      const service: ClockService = fixedClock(FIXED_AT)
      const fields = ['monotonicSecs', 'wallClockEpochMillis']
      expect(Object.keys(service).sort()).toStrictEqual(fields)

      expect(yield* monotonicSecs.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(1_234.5)
      expect(yield* wallClockEpochMillis.pipe(Effect.provide(FixedClockLayer(FIXED_AT)))).toBe(
        1_700_000_000_000,
      )
    }),
  )
})

describe('mc-kernel FrameServices contract', () => {
  it.effect('is exactly ClockPort', () =>
    Effect.sync(() => {
      type NoWider = Exclude<FrameServices, ClockPort>
      type NoNarrower = Exclude<ClockPort, FrameServices>
      const widerIsEmpty: NoWider extends never ? true : false = true
      const narrowerIsEmpty: NoNarrower extends never ? true : false = true

      expect(widerIsEmpty).toBe(true)
      expect(narrowerIsEmpty).toBe(true)
    }),
  )

  it.effect('a fixed ClockPort layer discharges a frame', () =>
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
