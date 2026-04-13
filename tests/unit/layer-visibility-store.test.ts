import { describe, expect, it } from 'vitest'

import {
  isDeviceVisible,
  isMarkerVisible,
  isDrawingVisible,
  isMarkerTypeVisible,
  useLayerVisibilityStore,
} from '../../src/features/layers/layer-visibility-store'
import type { Drawing, Marker } from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('layer visibility store', () => {
  it('starts with all layer categories visible', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    expect(isMarkerTypeVisible(state.markerTypeVisibility, 'clue')).toBe(true)
    expect(state.groupVisibility.mapTools).toBe(true)
    expect(state.drawingTypeVisibility.search_area).toBe(true)
    expect(state.breadcrumbsVisible).toBe(true)
    expect(state.measurementsVisible).toBe(true)
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

  it('can hide an individual marker item', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()
    const marker = createMarker()

    state.toggleMarkerVisibility(marker.id)
    expect(
      isMarkerVisible(
        useLayerVisibilityStore.getState().markerTypeVisibility,
        useLayerVisibilityStore.getState().hiddenMarkerIds,
        marker,
      ),
    ).toBe(false)
  })

  it('hydrates flat visibility state from the persisted layer catalog tree', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    state.hydrateCatalogVisibility('mission-1', {
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
              id: 'layer:markers:clues',
              kind: 'layer',
              layerKey: 'marker_clue',
              label: 'Clues',
              alias: null,
              displayLabel: 'Clues',
              isFavorite: false,
              isVisible: true,
              displayOrder: 15,
              parentId: 'group:map-tools',
              summary: { totalCount: 1, visibleCount: 0 },
              children: [
                {
                  id: 'feature:marker:marker-1',
                  kind: 'feature_item',
                  label: 'Boot Print',
                  alias: null,
                  displayLabel: 'Boot Print',
                  isFavorite: false,
                  isVisible: false,
                  displayOrder: 1,
                  parentId: 'layer:markers:clues',
                  entity: {
                    type: 'marker',
                    marker: createMarker(),
                  },
                },
              ],
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
            {
              id: 'layer:map-tools:measurements',
              kind: 'layer',
              layerKey: 'measurement',
              label: 'Measurements',
              alias: null,
              displayLabel: 'Measurements',
              isFavorite: false,
              isVisible: true,
              displayOrder: 30,
              parentId: 'group:map-tools',
              summary: { totalCount: 0, visibleCount: 0 },
              children: [],
            },
          ],
        },
      ],
    })

    const hydratedState = useLayerVisibilityStore.getState()
    expect(hydratedState.hiddenDeviceIds).toEqual(['alpha'])
    expect(hydratedState.groupVisibility.tracking).toBe(true)
    expect(hydratedState.groupVisibility.mapTools).toBe(true)
    expect(hydratedState.markerTypeVisibility.hazard).toBe(false)
    expect(hydratedState.hiddenMarkerIds).toEqual(['marker-1'])
    expect(hydratedState.hiddenDrawingIds).toEqual(['drawing-1'])
    expect(hydratedState.breadcrumbsVisible).toBe(true)
    expect(hydratedState.measurementsVisible).toBe(true)
  })
  it('re-derives visibility from the catalog tree on every hydration call', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    const tree = createMinimalTree()

    state.hydrateCatalogVisibility('mission-1', tree)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)

    // Direct store mutation is overwritten by next hydration because
    // the catalog tree is the source of truth for visibility.
    useLayerVisibilityStore.getState().setMarkerTypeVisibility('clue', false)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(false)

    useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-1', tree)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)
  })

  it('propagates tree visibility changes to the store on same-mission hydration', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    const treeV1 = createMinimalTree()
    state.hydrateCatalogVisibility('mission-1', treeV1)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)

    // Simulate a tree toggle: clue layer is now hidden in the catalog
    const treeV2 = createMinimalTree()
    const clueLayer = treeV2.children[0]!.children[0]!
    ;(clueLayer as { isVisible: boolean }).isVisible = false

    useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-1', treeV2)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(false)
  })

  it('hydrates parent group visibility as a first-class runtime boundary', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())

    const tree = createMinimalTree()
    const mapToolsGroup = tree.children[0]
    if (mapToolsGroup === undefined) {
      throw new Error('Expected minimal tree to include the map-tools group.')
    }

    ;(mapToolsGroup as { isVisible: boolean }).isVisible = false

    useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-1', tree)

    expect(useLayerVisibilityStore.getState().groupVisibility.mapTools).toBe(false)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)
  })

  it('preserves references when hydrating unchanged tree for performance', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    const tree = createMinimalTree()
    state.hydrateCatalogVisibility('mission-1', tree)
    const first = useLayerVisibilityStore.getState()

    // Re-hydrate with identical tree — references should be preserved
    useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-1', tree)
    const second = useLayerVisibilityStore.getState()

    expect(second.hiddenDeviceIds).toBe(first.hiddenDeviceIds)
    expect(second.markerTypeVisibility).toBe(first.markerTypeVisibility)
    expect(second.drawingTypeVisibility).toBe(first.drawingTypeVisibility)
  })

  it('always rehydrates when missionId is null (idle state)', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    const tree = createMinimalTree()

    state.hydrateCatalogVisibility(null, tree)
    useLayerVisibilityStore.getState().setMarkerTypeVisibility('clue', false)

    useLayerVisibilityStore.getState().hydrateCatalogVisibility(null, tree)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)
  })

  it('hides GPX imports when the parent layer is hidden', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    state.hydrateCatalogVisibility('mission-gpx', {
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
          id: 'group:gpx-tracks',
          kind: 'group',
          groupKey: 'gpx_tracks',
          label: 'GPX Tracks',
          alias: null,
          displayLabel: 'GPX Tracks',
          isFavorite: false,
          isVisible: true,
          displayOrder: 40,
          parentId: 'root:mission-catalog',
          children: [
            {
              id: 'layer:gpx:import-1',
              kind: 'layer',
              layerKey: 'gpx_tracks',
              label: 'Track Alpha',
              alias: null,
              displayLabel: 'Track Alpha',
              isFavorite: false,
              isVisible: false,
              displayOrder: 10,
              parentId: 'group:gpx-tracks',
              summary: { totalCount: 1, visibleCount: 0 },
              children: [
                {
                  id: 'feature:gpx:import-1',
                  kind: 'feature_item',
                  label: 'Track Alpha',
                  alias: null,
                  displayLabel: 'Track Alpha',
                  isFavorite: false,
                  isVisible: true,
                  displayOrder: 1,
                  parentId: 'layer:gpx:import-1',
                  entity: {
                    type: 'gpx_import',
                    gpxImport: {
                      id: 'import-1',
                      mission_id: 'mission-gpx',
                      source_path: '/tmp/track.gpx',
                      file_name: 'track.gpx',
                      display_name: 'Track Alpha',
                      geometry_json: '{}',
                      metadata_json: null,
                      created_at: '2026-04-10T00:00:00.000Z',
                      updated_at: '2026-04-10T00:00:00.000Z',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(useLayerVisibilityStore.getState().hiddenGpxImportIds).toEqual(['import-1'])
  })

  it('hides all devices when the entire device layer is hidden', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    state.hydrateCatalogVisibility('mission-dev', {
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
              isVisible: false,
              displayOrder: 10,
              parentId: 'group:tracking',
              summary: { totalCount: 2, visibleCount: 0 },
              children: [
                {
                  id: 'feature:device:alpha',
                  kind: 'feature_item',
                  label: 'Alpha',
                  alias: null,
                  displayLabel: 'Alpha',
                  isFavorite: false,
                  isVisible: true,
                  displayOrder: 1,
                  parentId: 'layer:tracking:devices',
                  entity: {
                    type: 'device',
                    device: {
                      id: 'device-alpha',
                      mission_id: 'mission-dev',
                      device_id: 'alpha',
                      name: 'Alpha',
                      color: '#38bdf8',
                      last_seen: null,
                      status: 'online',
                    },
                  },
                },
                {
                  id: 'feature:device:bravo',
                  kind: 'feature_item',
                  label: 'Bravo',
                  alias: null,
                  displayLabel: 'Bravo',
                  isFavorite: false,
                  isVisible: true,
                  displayOrder: 2,
                  parentId: 'layer:tracking:devices',
                  entity: {
                    type: 'device',
                    device: {
                      id: 'device-bravo',
                      mission_id: 'mission-dev',
                      device_id: 'bravo',
                      name: 'Bravo',
                      color: '#f87171',
                      last_seen: null,
                      status: 'online',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    })

    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['alpha', 'bravo'])
  })

  it('rehydrates when the mission changes', () => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    const state = useLayerVisibilityStore.getState()

    const tree = createMinimalTree()

    state.hydrateCatalogVisibility('mission-1', tree)
    useLayerVisibilityStore.getState().setMarkerTypeVisibility('clue', false)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(false)

    useLayerVisibilityStore.getState().hydrateCatalogVisibility('mission-2', tree)
    expect(useLayerVisibilityStore.getState().markerTypeVisibility.clue).toBe(true)
  })
})

function createMinimalTree(): import('../../src/features/layers/layer-catalog-types').LayerCatalogRootNode {
  return {
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
            id: 'layer:markers:clues',
            kind: 'layer',
            layerKey: 'marker_clue',
            label: 'Clues',
            alias: null,
            displayLabel: 'Clues',
            isFavorite: false,
            isVisible: true,
            displayOrder: 15,
            parentId: 'group:map-tools',
            summary: { totalCount: 0, visibleCount: 0 },
            children: [],
          },
        ],
      },
    ],
  }
}

function createMarker(): Marker {
  return {
    id: 'marker-1',
    mission_id: 'mission-1',
    type: 'clue',
    name: 'Boot Print',
    description: null,
    lat: 52,
    lon: -9.7,
    irish_grid_e: 496584,
    irish_grid_n: 591256,
    created_at: '2026-04-09T00:00:00.000Z',
    updated_at: '2026-04-09T00:00:00.000Z',
    display_order: 1,
    subject_category: null,
    clue_type: 'Footprint',
    confidence: 0.5,
    found_by: 'Team 2',
    hazard_type: null,
    severity: null,
    condition: null,
    treatment: null,
    evacuation_priority: null,
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
  }
}

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
