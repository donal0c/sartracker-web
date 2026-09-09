import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createArchiveReviewWorkQueue } = require('../../electron/archive-review-work-queue.cjs') as {
  createArchiveReviewWorkQueue: () => {
    run: (factory: (signal: AbortSignal) => Promise<unknown>, signal?: AbortSignal) => Promise<unknown>
    close: () => Promise<void>
  }
}

it('retains a worker slot until physical exit and bounds queued admissions', async () => {
  const queue = createArchiveReviewWorkQueue()
  let exit = (): void => undefined
  const physicalExit = new Promise<void>((resolve) => { exit = resolve })
  const factory = vi.fn(() => Object.assign(Promise.resolve('result'), { workerExited: physicalExit }))
  const pending = Array.from({ length: 16 }, () => queue.run(factory))
  const outcomes = Promise.allSettled(pending)
  await expect(queue.run(factory)).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_BUSY' })
  await Promise.all(pending.slice(0, 2))
  expect(factory).toHaveBeenCalledTimes(2)
  exit()
  await outcomes
  expect(factory).toHaveBeenCalledTimes(16)
  await queue.close()
})

it('cancels queued work without starting a worker and joins running workers on close', async () => {
  const queue = createArchiveReviewWorkQueue()
  const running = vi.fn((signal: AbortSignal) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true })
  }))
  const one = queue.run(running)
  const two = queue.run(running)
  const controller = new AbortController()
  const queued = vi.fn(async () => undefined)
  const three = queue.run(queued, controller.signal)
  const outcomes = Promise.allSettled([one, two, three])
  controller.abort()
  await expect(three).rejects.toMatchObject({ name: 'AbortError' })
  expect(queued).not.toHaveBeenCalled()
  await queue.close()
  expect((await outcomes).map((result) => result.status)).toEqual(['rejected', 'rejected', 'rejected'])
  await expect(queue.run(queued)).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_CLOSED' })
})
