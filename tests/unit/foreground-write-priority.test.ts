import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { waitForForegroundWrites } = require('../../electron/foreground-write-priority.cjs') as {
  waitForForegroundWrites: (buffer: SharedArrayBuffer, signal?: AbortSignal) => Promise<void>
}

afterEach(() => vi.useRealTimers())

it('holds the next background page while admitted foreground writes remain', async () => {
  vi.useFakeTimers()
  const buffer = new SharedArrayBuffer(4)
  const pending = new Int32Array(buffer)
  Atomics.store(pending, 0, 2)
  const advancePage = vi.fn()
  const turn = waitForForegroundWrites(buffer).then(advancePage)
  await vi.advanceTimersByTimeAsync(50)
  expect(advancePage).not.toHaveBeenCalled()
  Atomics.sub(pending, 0, 1)
  await vi.advanceTimersByTimeAsync(50)
  expect(advancePage).not.toHaveBeenCalled()
  Atomics.sub(pending, 0, 1)
  await vi.advanceTimersByTimeAsync(5)
  await turn
  expect(advancePage).toHaveBeenCalledOnce()
})

it('returns control for cancellation even if foreground admission never empties', async () => {
  vi.useFakeTimers()
  const buffer = new SharedArrayBuffer(4)
  Atomics.store(new Int32Array(buffer), 0, 1)
  const controller = new AbortController()
  const turn = waitForForegroundWrites(buffer, controller.signal)
  controller.abort()
  await vi.advanceTimersByTimeAsync(5)
  await turn
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects a malformed shared counter before background work starts', async () => {
  await expect(waitForForegroundWrites(new SharedArrayBuffer(8))).rejects.toThrow(/counter/)
})
