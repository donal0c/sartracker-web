import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  DRAWING_FILL_LAYER_ID,
  DRAWING_LINE_CASING_LAYER_ID,
  DRAWING_LINE_LAYER_ID,
  DRAWING_POINT_LAYER_ID,
  syncDrawingOverlay,
} from '../../src/features/drawings/sync-drawing-overlay'
import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'

/**
 * Tests for the drawing overlay layer configuration.
 *
 * Two life-safety concerns are pinned here:
 * 1. Normal display must be clean — no per-vertex marker dots on rings,
 *    sectors, or search-area outlines.
 * 2. Filters must use modern expression syntax. MapLibre 5 silently DROPS a
 *    filter that nests the legacy `$type` selector inside an `['all', …]`
 *    expression, which previously left the geometry-point and visibility
 *    filters unapplied.
 */

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
  const filters = new Map<string, unknown>()
  const layerOrder: string[] = []

  return {
    layers,
    sources,
    filters,
    layerOrder,
    getLayer: vi.fn((id: string) => (layers.has(id) ? { id } : undefined)),
    getSource: vi.fn((id: string) => (sources.has(id) ? { setData: vi.fn() } : undefined)),
    addLayer: vi.fn((spec: LayerSpec, beforeId?: string) => {
      layers.set(spec.id, spec)
      if (beforeId !== undefined && layerOrder.includes(beforeId)) {
        layerOrder.splice(layerOrder.indexOf(beforeId), 0, spec.id)
      } else {
        layerOrder.push(spec.id)
      }
    }),
    addSource: vi.fn((id: string, config: unknown) => {
      sources.set(id, config)
    }),
    setFilter: vi.fn((id: string, filter: unknown) => {
      filters.set(id, filter)
    }),
  }
}

const VISIBLE_TYPES: Record<Drawing['type'], boolean> = {
  line: true,
  search_area: true,
  range_ring: true,
  bearing_line: true,
  search_sector: true,
  text_label: true,
}

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

describe('drawing overlay layer configuration', () => {
  let map: ReturnType<typeof createMockMap>

  beforeEach(() => {
    map = createMockMap()
    syncDrawingOverlay(map as never, [], [], VISIBLE_TYPES, null)
  })

  it('never uses the legacy $type selector in any layer filter', () => {
    for (const [, filter] of map.filters) {
      assertNoLegacyTypeSelector(filter)
    }
  })

  it('restricts the visible point layer to intentional geometry points only', () => {
    const filter = map.filters.get(DRAWING_POINT_LAYER_ID)
    // The point circle layer must constrain to Point geometry kind AND the
    // intentional geometry featureKind so it never draws a dot per vertex.
    const serialized = JSON.stringify(filter)
    expect(serialized).toContain('geometry-type')
    expect(serialized).toContain('Point')
    expect(serialized).toContain('geometry')
  })

  it('draws a dark casing below drawing lines for cross-basemap legibility', () => {
    const casing = map.layers.get(DRAWING_LINE_CASING_LAYER_ID)
    const line = map.layers.get(DRAWING_LINE_LAYER_ID)
    expect(casing).toBeDefined()
    expect(casing?.paint?.['line-color']).toBe('#020617')
    // The casing must be wider than the coloured stroke so it reads as a halo.
    // Width is a `case` expression that adds to the per-feature width.
    const casingWidth = JSON.stringify(casing?.paint?.['line-width'])
    expect(casingWidth).toContain('+')
    expect(line).toBeDefined()
  })

  it('renders both line and polygon-boundary geometry through the line layer', () => {
    // The line layer should match all geometry features (not only LineString)
    // so search-area / sector polygon outlines get a crisp stroke + casing.
    const filter = map.filters.get(DRAWING_LINE_LAYER_ID)
    const serialized = JSON.stringify(filter)
    expect(serialized).not.toContain('LineString')
    expect(serialized).toContain('geometry')
  })

  it('keeps the fill layer constrained to polygon geometry via expression syntax', () => {
    const filter = map.filters.get(DRAWING_FILL_LAYER_ID)
    const serialized = JSON.stringify(filter)
    expect(serialized).toContain('geometry-type')
    expect(serialized).toContain('Polygon')
  })

  it('hides a drawing type when its visibility filter excludes it', () => {
    map = createMockMap()
    syncDrawingOverlay(
      map as never,
      [],
      [],
      { ...VISIBLE_TYPES, search_area: false },
      null,
    )

    const fillFilter = JSON.stringify(map.filters.get(DRAWING_FILL_LAYER_ID))
    // search_area excluded means it must not be in the visible-types literal
    expect(fillFilter).not.toContain('search_area')
    expect(fillFilter).toContain('range_ring')
  })
})
