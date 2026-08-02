import { describe, expect, it } from 'vitest'

import { createLatestStatePersistence } from '../../apps/multiplayer-server/main'

const deferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('latest multiplayer state persistence', () => {
  it('coalesces updates queued behind an active write to the latest state', async () => {
    const firstWrite = deferred<void>()
    const writes: number[] = []
    const persistence = createLatestStatePersistence(async (state: number) => {
      writes.push(state)
      if (writes.length === 1) await firstWrite.promise
    })

    persistence.request(1)
    await Promise.resolve()
    persistence.request(2)
    persistence.request(3)
    firstWrite.resolve()
    await persistence.drain()

    expect(writes).toEqual([1, 3])
  })

  it('drains an update requested while the previous write is settling', async () => {
    const firstWrite = deferred<void>()
    const writes: string[] = []
    const persistence = createLatestStatePersistence(async (state: string) => {
      writes.push(state)
      if (state === 'first') await firstWrite.promise
    })

    persistence.request('first')
    const draining = persistence.drain()
    persistence.request('latest')
    firstWrite.resolve()
    await draining

    expect(writes).toEqual(['first', 'latest'])
  })

  it('reports the latest failure and clears it after a successful retry', async () => {
    let shouldFail = true
    const persistence = createLatestStatePersistence(async () => {
      if (shouldFail) throw new Error('disk unavailable')
    })

    persistence.request(1)
    await expect(persistence.drain()).rejects.toThrow('disk unavailable')

    shouldFail = false
    await expect(persistence.drain()).resolves.toBeUndefined()
  })

  it('reserves the writer before a synchronous reentrant request', async () => {
    let persistence!: ReturnType<typeof createLatestStatePersistence<number>>
    let active = 0
    let maxActive = 0
    const writes: number[] = []
    persistence = createLatestStatePersistence(async (state) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      writes.push(state)
      if (state === 1) persistence.request(2)
      await Promise.resolve()
      active -= 1
    })

    persistence.request(1)
    await persistence.drain()

    expect(writes).toEqual([1, 2])
    expect(maxActive).toBe(1)
  })

  it('persists undefined when it is a valid state value', async () => {
    const writes: Array<number | undefined> = []
    const persistence = createLatestStatePersistence<number | undefined>(async (state) => {
      writes.push(state)
    })

    persistence.request(undefined)
    await persistence.drain()

    expect(writes).toEqual([undefined])
  })
})
