import { afterEach, expect, it, vi } from 'vitest'
import { projectReplayMapAsync } from '../../src/features/mission-review/project-replay-map-async'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('terminates and settles a superseded worker even while awaiting its reply', async () => {
  vi.useFakeTimers()
  const terminate = vi.fn()
  vi.stubGlobal('Worker', class { postMessage() {} terminate = terminate })
  let current = true
  const promise = projectReplayMapAsync([], [], () => current)
  const outcome = promise.catch((error: Error) => error.message)
  current = false
  await vi.advanceTimersByTimeAsync(100)
  expect(terminate).toHaveBeenCalledOnce()
  await expect(outcome).resolves.toContain('superseded')
})
