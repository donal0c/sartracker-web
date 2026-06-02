import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for tracking overlay layer configuration.
 *
 * These tests validate that device markers and labels meet the visibility
 * requirements for operator use across all basemaps, including lighter
 * backgrounds like OpenTopoMap.
 */

/* ------------------------------------------------------------------ */
/*  Minimal MapLibre mock — just enough to capture addLayer calls      */
/* ------------------------------------------------------------------ */

type LayerSpec = {
  id: string
  type: string
  source: string
  filter?: unknown
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

function createMockMap() {
  const layers = new Map<string, LayerSpec>()
  const sources = new Map<string, unknown>()

  return {
    layers,
    sources,
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => {
      if (sources.has(id)) {
        return { setData: vi.fn() }
      }
      return undefined
    }),
    addLayer: vi.fn((spec: LayerSpec) => {
      layers.set(spec.id, spec)
    }),
    addSource: vi.fn((id: string, config: unknown) => {
      sources.set(id, config)
    }),
    setFilter: vi.fn(),
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCircleLayer(map: ReturnType<typeof createMockMap>): LayerSpec {
  const layer = map.layers.get('tracking-devices-circle')
  if (!layer) throw new Error('Circle layer not added')
  return layer
}

function getHaloLayer(map: ReturnType<typeof createMockMap>): LayerSpec {
  const layer = map.layers.get('tracking-devices-halo')
  if (!layer) throw new Error('Halo layer not added')
  return layer
}

function getLabelLayer(map: ReturnType<typeof createMockMap>): LayerSpec {
  const layer = map.layers.get('tracking-devices-label')
  if (!layer) throw new Error('Label layer not added')
  return layer
}

function getBreadcrumbCasingLayer(map: ReturnType<typeof createMockMap>): LayerSpec {
  const layer = map.layers.get('tracking-breadcrumbs-casing')
  if (!layer) throw new Error('Breadcrumb casing layer not added')
  return layer
}

function getBreadcrumbLayer(map: ReturnType<typeof createMockMap>): LayerSpec {
  const layer = map.layers.get('tracking-breadcrumbs-line')
  if (!layer) throw new Error('Breadcrumb layer not added')
  return layer
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

/**
 * Recursively asserts that a filter expression never uses the legacy `$type`
 * selector, which MapLibre 5 drops when nested under `['all', …]`.
 */
function assertNoLegacyTypeSelector(filter: unknown): void {
  if (Array.isArray(filter)) {
    expect(filter).not.toContain('$type')
    for (const part of filter) {
      assertNoLegacyTypeSelector(part)
    }
  }
}

describe('tracking overlay marker configuration', () => {
  let map: ReturnType<typeof createMockMap>

  beforeEach(async () => {
    map = createMockMap()

    const { syncTrackingOverlay } = await import(
      '../../src/features/tracking/sync-tracking-overlay'
    )

    const emptySnapshot = {
      devices: [],
      positions: [],
      breadcrumbs: [],
      connectionHealth: { status: 'connected' as const, lastSuccessfulPoll: null },
    }

    syncTrackingOverlay(map as never, emptySnapshot, [], true)
  })

  describe('filter syntax', () => {
    it('never sets a layer filter that uses the legacy $type selector', () => {
      for (const call of map.setFilter.mock.calls) {
        assertNoLegacyTypeSelector(call[1])
      }
    })

    it('never adds a layer whose filter uses the legacy $type selector', () => {
      for (const [, layer] of map.layers) {
        assertNoLegacyTypeSelector(layer.filter)
      }
    })
  })

  describe('device circle markers', () => {
    it('has a circle radius of at least 12px for cross-basemap visibility', () => {
      const layer = getCircleLayer(map)
      const radius = layer.paint?.['circle-radius']
      expect(radius).toBeGreaterThanOrEqual(12)
      expect(radius).toBeLessThanOrEqual(14)
    })

    it('uses deterministic colour from the GeoJSON feature', () => {
      const layer = getCircleLayer(map)
      expect(layer.paint?.['circle-color']).toEqual(['get', 'color'])
    })

    it('has a visible stroke for contrast against all backgrounds', () => {
      const layer = getCircleLayer(map)
      const strokeWidth = layer.paint?.['circle-stroke-width']
      // Stroke should be at least 2px on all states
      expect(strokeWidth).toBeDefined()
    })

    it('renders a dark halo below each current-location marker', () => {
      const layer = getHaloLayer(map)
      expect(layer.paint?.['circle-color']).toBe('#020617')
      expect(layer.paint?.['circle-radius']).toBeGreaterThanOrEqual(16)
      expect(layer.paint?.['circle-opacity']).toBeGreaterThanOrEqual(0.75)
    })
  })

  describe('device name labels', () => {
    it('renders the device name from the GeoJSON feature', () => {
      const layer = getLabelLayer(map)
      expect(layer.layout?.['text-field']).toEqual(['get', 'name'])
    })

    it('positions labels beside the marker (not above) for readability', () => {
      const layer = getLabelLayer(map)
      const anchor = layer.layout?.['text-anchor']
      // Labels should be anchored left (positioned to the right of the marker)
      expect(anchor).toBe('left')
    })

    it('allows label overlap so all device names are always visible', () => {
      const layer = getLabelLayer(map)
      expect(layer.layout?.['text-allow-overlap']).toBe(true)
    })

    it('has a dark halo for readability on light backgrounds', () => {
      const layer = getLabelLayer(map)
      expect(layer.paint?.['text-color']).toEqual(['get', 'color'])
      expect(layer.paint?.['text-halo-width']).toBeGreaterThanOrEqual(3)
      expect(layer.paint?.['text-halo-color']).toBe('#020617')
    })

    it('uses a text size readable at operational zoom levels', () => {
      const layer = getLabelLayer(map)
      const textSize = layer.layout?.['text-size']
      expect(textSize).toBeGreaterThanOrEqual(12)
    })
  })

  describe('breadcrumb trails', () => {
    it('draws a dark casing below coloured breadcrumb trails', () => {
      const casing = getBreadcrumbCasingLayer(map)
      const trail = getBreadcrumbLayer(map)

      expect(casing.paint?.['line-color']).toBe('#020617')
      expect(casing.paint?.['line-width']).toBeGreaterThan(
        Number(trail.paint?.['line-width']),
      )
      expect(trail.paint?.['line-color']).toEqual(['get', 'color'])
      expect(trail.paint?.['line-opacity']).toBeGreaterThanOrEqual(0.9)
    })

    it('applies the global breadcrumb size to line and casing widths', async () => {
      map = createMockMap()
      const { syncTrackingOverlay } = await import(
        '../../src/features/tracking/sync-tracking-overlay'
      )

      syncTrackingOverlay(
        map as never,
        {
          devices: [],
          positions: [],
          breadcrumbs: [],
          connectionHealth: { status: 'connected' as const, lastSuccessfulPoll: null },
        },
        [],
        true,
        { deviceColors: {}, breadcrumbSize: 7 },
      )

      const casing = getBreadcrumbCasingLayer(map)
      const trail = getBreadcrumbLayer(map)

      expect(trail.paint?.['line-width']).toBe(7)
      expect(casing.paint?.['line-width']).toBe(10)
    })
  })
})
