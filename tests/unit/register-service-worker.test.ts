import { registerServiceWorker } from '../../src/lib/register-service-worker'

describe('service worker registration', () => {
  const originalServiceWorker = navigator.serviceWorker

  afterEach(() => {
    if (originalServiceWorker === undefined) {
      delete (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer }).serviceWorker
      return
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker,
    })
  })

  it('registers the service worker when supported', async () => {
    const register = vi.fn().mockResolvedValue(undefined)

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })

    await registerServiceWorker()

    expect(register).toHaveBeenCalledWith('/sw.js')
  })

  it('warns instead of crashing when registration fails', async () => {
    const register = vi.fn().mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })

    await expect(registerServiceWorker()).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Service worker registration failed.', expect.any(Error))

    warn.mockRestore()
  })
})
