import { describe, expect, it } from 'vitest'

import {
  loadRuntimeBootstrapSettings,
  saveAppSettings,
  testTrackingConnection,
} from '../../src/infrastructure/settings-store/tauri-settings-store'
import {
  createSettingsDraft,
  DEFAULT_APP_SETTINGS,
} from '../../src/features/settings/settings-types'

describe('browser settings store', () => {
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
})
