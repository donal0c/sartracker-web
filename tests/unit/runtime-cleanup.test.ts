import { expect, it, vi } from 'vitest'
import { createRuntimeCleanup } from '../../src/features/runtime/runtime-cleanup'

it('attempts all cleanup in order, shares an in-flight attempt and retries only failed steps', async () => {
  const order: string[] = []
  const failed = vi.fn().mockImplementationOnce(() => { order.push('failure'); throw new Error('stop failed') })
    .mockImplementationOnce(() => { order.push('retry') })
  const cleanup = createRuntimeCleanup([
    () => { order.push('before') }, failed, () => { order.push('after') },
  ])
  const first = cleanup()
  expect(cleanup()).toBe(first)
  await expect(first).rejects.toThrow('stop failed')
  expect(order).toEqual(['before', 'failure', 'after'])
  await cleanup()
  await cleanup()
  expect(order).toEqual(['before', 'failure', 'after', 'retry'])
})
