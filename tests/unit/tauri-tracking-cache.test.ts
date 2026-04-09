import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

describe('tauri tracking cache adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('forwards cache read and write through the Tauri boundary', async () => {
    const { createTauriTrackingCache } = await import(
      '../../src/infrastructure/tracking-cache/tauri-tracking-cache'
    )

    invokeMock.mockResolvedValueOnce('{"cached":true}')
    invokeMock.mockResolvedValueOnce('/tmp/tracking-cache.json')

    const cache = createTauriTrackingCache()

    await expect(cache.read()).resolves.toBe('{"cached":true}')
    await expect(cache.write('{"cached":true}')).resolves.toBe('/tmp/tracking-cache.json')

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'read_tracking_cache')
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'write_tracking_cache', {
      contents: '{"cached":true}',
    })
  })
})
