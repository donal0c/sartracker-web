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
