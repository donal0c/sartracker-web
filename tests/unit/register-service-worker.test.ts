import { registerServiceWorker } from '../../src/lib/register-service-worker'

describe('service worker registration', () => {
  const originalServiceWorker = navigator.serviceWorker

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalServiceWorker === undefined) {
      Reflect.deleteProperty(navigator, 'serviceWorker')
      return
    }

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: originalServiceWorker,
    })
  })

  it.each(['file:', 'data:', 'about:'])('does not register in unsupported %s contexts', async (protocol) => {
    const register = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('location', { protocol })
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })

    await registerServiceWorker()

    expect(register).not.toHaveBeenCalled()
  })

  it.each(['http:', 'https:'])('registers the service worker in supported %s contexts', async (protocol) => {
    vi.stubGlobal('location', { protocol })
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
