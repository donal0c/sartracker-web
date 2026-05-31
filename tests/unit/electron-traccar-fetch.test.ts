import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElectronTraccarFetch } from '../../src/infrastructure/traccar-http/electron-traccar-fetch'

describe('electron Traccar fetch adapter', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('routes Traccar HTTP through the typed Electron preload bridge', async () => {
    const traccarHttpRequest = vi.fn().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '[{"id":1}]',
    })
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { traccarHttpRequest },
    })

    const fetch = createElectronTraccarFetch({ timeoutMs: 12_000 })
    const response = await fetch('https://kmrtsar.eu/api/devices', {
      method: 'POST',
      headers: { Authorization: 'Basic abc123' },
      body: new URLSearchParams({ email: 'sean', password: 'sean' }),
    })

    expect(traccarHttpRequest).toHaveBeenCalledWith({
      url: 'https://kmrtsar.eu/api/devices',
      method: 'POST',
      headers: { authorization: 'Basic abc123' },
      body: 'email=sean&password=sean',
      timeoutMs: 12_000,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual([{ id: 1 }])
  })

  it('fails loudly when the Electron bridge is unavailable', async () => {
    const fetch = createElectronTraccarFetch()

    await expect(fetch('https://kmrtsar.eu/api/devices')).rejects.toThrow(
      'Electron Traccar bridge is not available.',
    )
  })
})
