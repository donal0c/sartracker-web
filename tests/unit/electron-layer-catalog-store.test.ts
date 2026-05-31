import { afterEach, describe, expect, it, vi } from 'vitest'

import { createElectronLayerCatalogStore } from '../../src/infrastructure/layer-catalog-store/electron-layer-catalog-store'

describe('Electron layer catalog store adapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the typed preload layer catalog bridge', async () => {
    const bridgeStore = {
      listMetadata: vi.fn().mockResolvedValue([]),
      upsertMetadata: vi.fn(),
      clearMetadata: vi.fn(),
    }
    vi.stubGlobal('window', {
      sartrackerElectron: {
        layerCatalogStore: bridgeStore,
      },
    })

    const store = createElectronLayerCatalogStore()

    expect(await store.listMetadata('mission-1')).toEqual([])
    expect(bridgeStore.listMetadata).toHaveBeenCalledWith('mission-1')
  })

  it('fails loudly when the Electron bridge is unavailable', () => {
    vi.stubGlobal('window', {})

    expect(() => createElectronLayerCatalogStore()).toThrow(
      'Electron layer catalog bridge is not available.',
    )
  })
})
