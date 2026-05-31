import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createElectronTrackingCache } from '../../src/infrastructure/tracking-cache/electron-tracking-cache'

describe('electron tracking cache adapter', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('delegates tracking cache reads and writes through the preload bridge', async () => {
    const readTrackingCache = vi.fn().mockResolvedValue('{"cached":true}')
    const writeTrackingCache = vi.fn().mockResolvedValue('/home/user/.config/sartracker/tracking-cache.json')
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        readTrackingCache,
        writeTrackingCache,
      },
    })

    const cache = createElectronTrackingCache()

    await expect(cache.read()).resolves.toBe('{"cached":true}')
    await expect(cache.write('{"cached":true}')).resolves.toBe('/home/user/.config/sartracker/tracking-cache.json')
    expect(readTrackingCache).toHaveBeenCalledWith()
    expect(writeTrackingCache).toHaveBeenCalledWith('{"cached":true}')
  })
})
