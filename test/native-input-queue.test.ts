import { describe, expect, it } from 'vitest'
import {
  consumeNativeInput,
  EMPTY_NATIVE_INPUT_QUEUE,
  enqueueNativeMouseButton,
} from '../apps/web/native-input-queue'

describe('native input queue', () => {
  it('keeps separate counts for attack and use buttons', () => {
    const queued = [0, 2, 2, 0].reduce(
      (state, button) => enqueueNativeMouseButton(state, button),
      EMPTY_NATIVE_INPUT_QUEUE,
    )

    expect(queued).toEqual({ attack: 2, use: 2 })
  })

  it('consumes only one queued action at a time', () => {
    const queued = enqueueNativeMouseButton(
      enqueueNativeMouseButton(EMPTY_NATIVE_INPUT_QUEUE, 2),
      2,
    )

    const first = consumeNativeInput(queued, 'use')
    const second = consumeNativeInput(first.state, 'use')
    const third = consumeNativeInput(second.state, 'use')

    expect(first).toEqual({ triggered: true, state: { attack: 0, use: 1 } })
    expect(second).toEqual({ triggered: true, state: { attack: 0, use: 0 } })
    expect(third).toEqual({ triggered: false, state: { attack: 0, use: 0 } })
  })

  it('consumes queued attacks independently from use actions', () => {
    const queued = enqueueNativeMouseButton(EMPTY_NATIVE_INPUT_QUEUE, 0)

    expect(consumeNativeInput(queued, 'attack')).toEqual({
      triggered: true,
      state: { attack: 0, use: 0 },
    })
  })

  it('ignores non-gameplay mouse buttons', () => {
    expect(enqueueNativeMouseButton(EMPTY_NATIVE_INPUT_QUEUE, 1))
      .toBe(EMPTY_NATIVE_INPUT_QUEUE)
  })
})
