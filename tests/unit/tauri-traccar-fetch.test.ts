import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { createTauriTraccarFetch } from '../../src/infrastructure/traccar-http/tauri-traccar-fetch'

describe('tauri traccar fetch', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('routes Traccar requests through the Tauri reqwest command', async () => {
    invokeMock.mockResolvedValueOnce({
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'application/json',
        'set-cookie': 'JSESSIONID=session-123; Path=/',
      },
      body: '[{"id":1,"name":"Team 1"}]',
    })

    const fetch = createTauriTraccarFetch({ timeoutMs: 12_000 })
    const response = await fetch('http://traccar.test:8082/api/devices', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Cookie: 'JSESSIONID=session-123',
      },
    })

    expect(invokeMock).toHaveBeenCalledWith('traccar_http_request', {
      input: {
        url: 'http://traccar.test:8082/api/devices',
        method: 'GET',
        headers: {
          accept: 'application/json',
          cookie: 'JSESSIONID=session-123',
        },
        body: null,
        timeoutMs: 12_000,
      },
    })
    expect(response.ok).toBe(true)
    expect(response.headers.get('set-cookie')).toBe('JSESSIONID=session-123; Path=/')
    await expect(response.json()).resolves.toEqual([{ id: 1, name: 'Team 1' }])
  })
})
