import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  loadAppSettings,
  loadRuntimeBootstrapSettings,
  saveAppSettings,
  testTrackingConnection,
} from '../../src/infrastructure/settings-store/tauri-settings-store'
import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'

describe('browser settings store', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('uses the operator-entered Traccar password for testing and runtime bootstrap without localStorage persistence', async () => {
    const requests: Request[] = []
    const originalFetch = window.fetch
    window.fetch = (async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)

      if (request.url === 'http://traccar.test:8082/api/session') {
        return new Response(JSON.stringify({ id: 4, email: 'apiuser' }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'JSESSIONID=session-123; Path=/',
          },
        })
      }

      if (request.url === 'http://traccar.test:8082/api/devices') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('not found', { status: 404 })
    }) as typeof window.fetch

    try {
      window.localStorage.clear()
      const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
      draft.dataSource.providerType = 'traccar_http'
      draft.dataSource.baseUrl = 'http://traccar.test:8082'
      draft.dataSource.email = 'apiuser'
      draft.dataSource.secretInput = 'secret-pass'

      const connection = await testTrackingConnection(draft)
      expect(connection).toEqual({ ok: true, message: 'Connection successful.' })

      await saveAppSettings(draft)
      const runtime = await loadRuntimeBootstrapSettings(true)

      expect(runtime.trackingConfig).toEqual({
        baseUrl: 'http://traccar.test:8082',
        email: 'apiuser',
        password: 'secret-pass',
      })
      expect(window.localStorage.getItem('sartracker:browser-settings')).not.toContain('secret-pass')
      await expect(requests[0].text()).resolves.toBe('email=apiuser&password=secret-pass')
      expect(requests[1].headers.get('authorization')).toBe('Basic YXBpdXNlcjpzZWNyZXQtcGFzcw==')
    } finally {
      window.fetch = originalFetch
      window.localStorage.clear()
    }
  })

  it('routes Electron validation connection tests through the preload bridge', async () => {
    const traccarHttpRequest = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '[]',
    })
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { traccarHttpRequest },
    })
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.dataSource.providerType = 'traccar_http'
    draft.dataSource.baseUrl = 'https://kmrtsar.eu'
    draft.dataSource.email = 'sean'
    draft.dataSource.secretInput = 'sean'

    const connection = await testTrackingConnection(draft)

    expect(connection).toEqual({ ok: true, message: 'Connection successful.' })
    expect(traccarHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://kmrtsar.eu/api/session',
        method: 'POST',
        body: 'email=sean&password=sean',
      }),
    )
    expect(traccarHttpRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://kmrtsar.eu/api/devices',
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Basic c2VhbjpzZWFu' },
      }),
    )
  })

  it('delegates Electron settings persistence and runtime bootstrap to the preload bridge', async () => {
    const saved = {
      ...DEFAULT_APP_SETTINGS,
      dataSource: {
        ...DEFAULT_APP_SETTINGS.dataSource,
        providerType: 'traccar_http' as const,
        baseUrl: 'https://kmrtsar.eu',
        email: 'sean',
        secretPresent: true,
      },
    }
    const loadAppSettingsBridge = vi.fn().mockResolvedValue(saved)
    const saveAppSettingsBridge = vi.fn().mockResolvedValue(saved)
    const loadRuntimeBootstrapSettingsBridge = vi.fn().mockResolvedValue({
      autosaveEnabled: true,
      autosaveIntervalMs: 30_000,
      trackingPollIntervalMs: 30_000,
      trackingCacheEnabled: true,
      trackingConfig: {
        baseUrl: 'https://kmrtsar.eu',
        email: 'sean',
        password: 'sean',
      },
    })
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        loadAppSettings: loadAppSettingsBridge,
        saveAppSettings: saveAppSettingsBridge,
        loadRuntimeBootstrapSettings: loadRuntimeBootstrapSettingsBridge,
        traccarHttpRequest: vi.fn(),
      },
    })
    window.localStorage.clear()

    const draft = createSettingsDraft(saved)
    draft.dataSource.secretInput = 'sean'

    await expect(loadAppSettings()).resolves.toEqual(saved)
    await expect(saveAppSettings(draft)).resolves.toEqual(saved)
    await expect(loadRuntimeBootstrapSettings(true)).resolves.toMatchObject({
      trackingConfig: {
        baseUrl: 'https://kmrtsar.eu',
        email: 'sean',
        password: 'sean',
      },
    })

    expect(saveAppSettingsBridge).toHaveBeenCalledWith(draft)
    expect(loadRuntimeBootstrapSettingsBridge).toHaveBeenCalledWith(true)
    expect(window.localStorage.getItem('sartracker:browser-settings')).toBeNull()
  })

  it('persists configured weather links in browser validation settings', async () => {
    window.localStorage.clear()
    const draft = createSettingsDraft(DEFAULT_APP_SETTINGS)
    draft.weather.links = [
      { name: 'Met Éireann', url: 'https://www.met.ie/' },
      { name: 'Mountain Forecast', url: 'https://mountain-forecast.example.com/kerry' },
    ]

    await saveAppSettings(draft)

    expect(await loadAppSettings()).toMatchObject({
      weather: {
        links: [
          { name: 'Met Éireann', url: 'https://www.met.ie' },
          { name: 'Mountain Forecast', url: 'https://mountain-forecast.example.com/kerry' },
        ],
      },
    })
    window.localStorage.clear()
  })
})
