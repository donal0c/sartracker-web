import { describe, expect, it } from 'vitest'

import {
  isDeviceVisible,
  isDrawingVisible,
  isMarkerTypeVisible,
  useLayerVisibilityStore,
} from '../../src/features/layers/layer-visibility-store'
import type { Drawing } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('layer visibility store', () => {
  it('starts expanded with all marker and drawing types visible', () => {
    const state = useLayerVisibilityStore.getState()

    expect(state.panelExpanded).toBe(true)
    expect(isMarkerTypeVisible(state.markerTypeVisibility, 'clue')).toBe(true)
    expect(state.drawingTypeVisibility.search_area).toBe(true)
  })

  it('can hide and restore all current devices', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    state.hideAllDevices(['alpha', 'bravo'])
    expect(isDeviceVisible(useLayerVisibilityStore.getState().hiddenDeviceIds, 'alpha')).toBe(false)

    state.showAllDevices()
    expect(isDeviceVisible(useLayerVisibilityStore.getState().hiddenDeviceIds, 'alpha')).toBe(true)
  })

  it('can disable a marker type and hide an individual drawing', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()
    const drawing = createDrawing()

    state.setMarkerTypeVisibility('hazard', false)
    expect(isMarkerTypeVisible(useLayerVisibilityStore.getState().markerTypeVisibility, 'hazard')).toBe(false)

    state.toggleDrawingVisibility(drawing.id)
    expect(
      isDrawingVisible(
        useLayerVisibilityStore.getState().drawingTypeVisibility,
        useLayerVisibilityStore.getState().hiddenDrawingIds,
        drawing,
      ),
    ).toBe(false)
  })

  it('hydrates flat visibility state from the persisted layer catalog tree', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    state.hydrateCatalogVisibility({
      id: 'root:mission-catalog',
      kind: 'root',
      label: 'Mission Catalog',
      alias: null,
      displayLabel: 'Mission Catalog',
      isFavorite: false,
      isVisible: true,
      displayOrder: 0,
      parentId: null,
      children: [
        {
          id: 'group:tracking',
          kind: 'group',
          groupKey: 'tracking',
          label: 'Tracking',
          alias: null,
          displayLabel: 'Tracking',
          isFavorite: false,
          isVisible: true,
          displayOrder: 10,
          parentId: 'root:mission-catalog',
          children: [
            {
              id: 'layer:tracking:devices',
              kind: 'layer',
              layerKey: 'tracking_devices',
              label: 'People',
              alias: null,
              displayLabel: 'People',
              isFavorite: false,
              isVisible: true,
              displayOrder: 10,
              parentId: 'group:tracking',
              summary: { totalCount: 1, visibleCount: 0 },
              children: [
                {
                  id: 'feature:device:alpha',
                  kind: 'feature_item',
                  label: 'Alpha',
                  alias: null,
                  displayLabel: 'Alpha',
                  isFavorite: false,
                  isVisible: false,
                  displayOrder: 1,
                  parentId: 'layer:tracking:devices',
                  entity: {
                    type: 'device',
                    device: {
                      id: 'device-alpha',
                      mission_id: 'mission-1',
                      device_id: 'alpha',
                      name: 'Alpha',
                      color: '#38bdf8',
                      last_seen: null,
                      status: 'online',
                    },
                  },
                },
              ],
            },
          ],
        },
        {
          id: 'group:map-tools',
          kind: 'group',
          groupKey: 'map_tools',
          label: 'Map Tools',
          alias: null,
          displayLabel: 'Map Tools',
          isFavorite: false,
          isVisible: true,
          displayOrder: 20,
          parentId: 'root:mission-catalog',
          children: [
            {
              id: 'layer:markers:hazards',
              kind: 'layer',
              layerKey: 'marker_hazard',
              label: 'Hazards',
              alias: null,
              displayLabel: 'Hazards',
              isFavorite: false,
              isVisible: false,
              displayOrder: 10,
              parentId: 'group:map-tools',
              summary: { totalCount: 0, visibleCount: 0 },
              children: [],
            },
            {
              id: 'layer:drawings:search-area',
              kind: 'layer',
              layerKey: 'drawing_search_area',
              label: 'Search Areas',
              alias: null,
              displayLabel: 'Search Areas',
              isFavorite: false,
              isVisible: true,
              displayOrder: 20,
              parentId: 'group:map-tools',
              summary: { totalCount: 1, visibleCount: 0 },
              children: [
                {
                  id: 'feature:drawing:drawing-1',
                  kind: 'feature_item',
                  label: 'Sector Alpha',
                  alias: null,
                  displayLabel: 'Sector Alpha',
                  isFavorite: false,
                  isVisible: false,
                  displayOrder: 1,
                  parentId: 'layer:drawings:search-area',
                  entity: {
                    type: 'drawing',
                    drawing: createDrawing(),
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    const hydratedState = useLayerVisibilityStore.getState()
    expect(hydratedState.hiddenDeviceIds).toEqual(['alpha'])
    expect(hydratedState.markerTypeVisibility.hazard).toBe(false)
    expect(hydratedState.hiddenDrawingIds).toEqual(['drawing-1'])
  })
})

function createDrawing(): Drawing {
  return {
    id: 'drawing-1',
    mission_id: 'mission-1',
    type: 'search_area',
    name: 'Sector Alpha',
    description: null,
    color: null,
    width: null,
    distance_m: null,
    temporary_measure: null,
    label: null,
    display_order: 1,
    geometry_json: '{}',
    metadata_json: null,
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
  }
}
