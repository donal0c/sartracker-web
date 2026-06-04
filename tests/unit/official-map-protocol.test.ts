import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerOfficialMapProtocol } from '../../src/features/map/official-map-protocol'

describe('official map MapLibre protocol', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('registers a MapLibre protocol that loads official tile bytes through Electron preload', async () => {
    const addProtocol = vi.fn()
    const removeProtocol = vi.fn()
    const fetchOfficialMapTile = vi.fn().mockResolvedValue({
      contentType: 'image/png',
      bytesBase64: 'AQIDBA==',
    })
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { fetchOfficialMapTile },
    })

    const unregister = registerOfficialMapProtocol({ addProtocol, removeProtocol })

    expect(addProtocol).toHaveBeenCalledOnce()
    const [, loadTile] = addProtocol.mock.calls[0]!
    await expect(
      loadTile({ url: 'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png' }),
    ).resolves.toEqual({
      data: Uint8Array.from([1, 2, 3, 4]).buffer,
    })
    expect(fetchOfficialMapTile).toHaveBeenCalledWith(
      'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png',
    )

    unregister()
    expect(removeProtocol).toHaveBeenCalledWith('sartracker-official-map')
  })

  it('fails loudly when official tiles are requested outside Electron', async () => {
    const addProtocol = vi.fn()

    registerOfficialMapProtocol({ addProtocol, removeProtocol: vi.fn() })

    const [, loadTile] = addProtocol.mock.calls[0]!
    await expect(
      loadTile({ url: 'sartracker-official-map://tile/official_discovery_topo/12/1935/1344.png' }),
    ).rejects.toThrow('Electron official map bridge is not available.')
  })
})
