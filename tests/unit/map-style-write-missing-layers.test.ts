import { describe, expect, it, vi } from 'vitest'

import { syncGpxOverlay } from '../../src/features/gpx/sync-gpx-overlay'
import { syncHelicopterOverlay } from '../../src/features/helicopters/sync-helicopter-overlay'
import {
  getMarkerLabelLayerId,
  getMarkerSymbolLayerId,
  MARKER_TYPES,
  syncMarkerOverlay,
} from '../../src/features/markers/sync-marker-overlay'

type LayerSpec = {
  readonly id: string
  readonly filter?: unknown
  readonly paint?: Record<string, unknown>
}

function createMockMap(missingLayerIds: readonly string[]) {
  const missing = new Set(missingLayerIds)
  const layers = new Map<string, LayerSpec>()
  const sources = new Map<string, { readonly setData: ReturnType<typeof vi.fn> }>()

  return {
    getLayer: vi.fn((layerId: string) => (layers.has(layerId) ? { id: layerId } : undefined)),
    getSource: vi.fn((sourceId: string) => sources.get(sourceId)),
    addSource: vi.fn((sourceId: string) => {
      sources.set(sourceId, { setData: vi.fn() })
    }),
    addLayer: vi.fn((layer: LayerSpec) => {
      if (!missing.has(layer.id)) {
        layers.set(layer.id, { ...layer })
      }
    }),
    hasImage: vi.fn(() => true),
    getFilter: vi.fn((layerId: string) => {
      const layer = layers.get(layerId)
      if (layer === undefined) {
        throw new TypeError(`Missing layer ${layerId}`)
      }
      return layer.filter
    }),
    setFilter: vi.fn((layerId: string, filter: unknown) => {
      const layer = layers.get(layerId)
      if (layer !== undefined) {
        layers.set(layerId, { ...layer, filter })
      }
    }),
  }
}

describe('overlay synchronization with transiently missing layers', () => {
  it('continues marker visibility synchronization after one symbol layer is rejected', async () => {
    const missingLayerId = getMarkerSymbolLayerId(MARKER_TYPES[0]!)
    const map = createMockMap([missingLayerId])

    await syncMarkerOverlay(
      map as never,
      [],
      { ipp_lkp: true, clue: true, hazard: true, casualty: true },
      [],
      new AbortController().signal,
    )

    expect(map.setFilter).toHaveBeenCalledWith(
      getMarkerLabelLayerId(MARKER_TYPES[0]!),
      expect.anything(),
    )
    expect(map.setFilter).toHaveBeenCalledWith(
      getMarkerSymbolLayerId(MARKER_TYPES[1]!),
      expect.anything(),
    )
  })

  it('completes GPX synchronization when its line layer is not yet available', () => {
    const map = createMockMap(['mission-gpx-imports-line'])

    expect(() => syncGpxOverlay(map as never, [], [])).not.toThrow()
    expect(map.setFilter).not.toHaveBeenCalled()
  })

  it('continues helicopter visibility synchronization after its symbol layer is rejected', async () => {
    const map = createMockMap(['mission-helicopters-symbol'])

    await syncHelicopterOverlay(
      map as never,
      [],
      { slot_1: true, slot_2: true, slot_3: true, slot_4: true },
      [],
      new AbortController().signal,
    )

    expect(map.setFilter).toHaveBeenCalledWith('mission-helicopters-label', expect.anything())
  })
})
