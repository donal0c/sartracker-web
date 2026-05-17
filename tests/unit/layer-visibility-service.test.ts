import { describe, expect, it, vi } from 'vitest'

import { applyVisibilityForNodeIds, collectSubtreeNodeIds, type LayerVisibilityStoreAdapter } from '../../src/features/layers/layer-visibility-service'
import type { LayerCatalogRootNode } from '../../src/features/layers/layer-catalog-types'

describe('layer visibility service', () => {
  it('collects subtree ids for branch nodes', () => {
    const root = createRoot()
    expect(collectSubtreeNodeIds(root, 'layer:tracking:devices')).toEqual([
      'layer:tracking:devices',
      'feature:device:alpha',
      'feature:device:bravo',
    ])
  })

  it('returns empty ids for unknown nodes', () => {
    expect(collectSubtreeNodeIds(createRoot(), 'layer:missing')).toEqual([])
  })

  it('updates feature-item visibility and marker/drawing layer visibility', () => {
    const store = createStoreAdapter({
      hiddenDeviceIds: ['alpha'],
      hiddenMarkerIds: ['marker-1'],
      hiddenDrawingIds: ['drawing-1'],
    })

    applyVisibilityForNodeIds(
      createRoot(),
      [
        'feature:device:alpha',
        'feature:marker:marker-1',
        'feature:drawing:drawing-1',
        'layer:markers:hazards',
        'layer:drawings:line',
      ],
      true,
      store,
    )

    expect(store.toggleDeviceVisibility).toHaveBeenCalledWith('alpha')
    expect(store.toggleMarkerVisibility).toHaveBeenCalledWith('marker-1')
    expect(store.toggleDrawingVisibility).toHaveBeenCalledWith('drawing-1')
    expect(store.setMarkerTypeVisibility).toHaveBeenCalledWith('hazard', true)
    expect(store.setDrawingTypeVisibility).toHaveBeenCalledWith('line', true)
  })

  it('handles tracking/devices branch and measurement/breadcrumb layers', () => {
    const store = createStoreAdapter()
    const root = createRoot()

    applyVisibilityForNodeIds(
      root,
      [
        'layer:tracking:devices',
        'layer:tracking:breadcrumbs',
        'layer:map-tools:measurements',
      ],
      false,
      store,
    )

    expect(store.hideAllDevices).toHaveBeenCalledWith(['alpha', 'bravo'])
    expect(store.setBreadcrumbsVisible).toHaveBeenCalledWith(false)
    expect(store.setMeasurementsVisible).toHaveBeenCalledWith(false)
  })

  it('handles group, helicopter, and GPX visibility nodes without waiting for hydration', () => {
    const store = createStoreAdapter({
      hiddenHelicopterIds: ['heli-1'],
      hiddenGpxImportIds: ['import-1'],
    })
    const root = createRoot()

    applyVisibilityForNodeIds(
      root,
      [
        'group:helicopters',
        'group:gpx-tracks',
        'layer:helicopters:slot-1',
        'feature:helicopter:heli-1',
        'layer:gpx:import-1',
        'feature:gpx:import-1',
      ],
      true,
      store,
    )

    expect(store.setGroupVisibility).toHaveBeenCalledWith('helicopters', true)
    expect(store.setGroupVisibility).toHaveBeenCalledWith('gpxTracks', true)
    expect(store.setHelicopterSlotVisibility).toHaveBeenCalledWith('slot_1', true)
    expect(store.toggleHelicopterVisibility).toHaveBeenCalledWith('heli-1')
    expect(store.toggleGpxImportVisibility).toHaveBeenCalledWith('import-1')
  })

  it('ignores unknown structural nodes without mutating store', () => {
    const store = createStoreAdapter()
    applyVisibilityForNodeIds(createRoot(), ['group:unknown', 'layer:unknown', 'feature:unknown:test'], false, store)

    expect(store.toggleDeviceVisibility).not.toHaveBeenCalled()
    expect(store.toggleMarkerVisibility).not.toHaveBeenCalled()
    expect(store.toggleDrawingVisibility).not.toHaveBeenCalled()
    expect(store.toggleHelicopterVisibility).not.toHaveBeenCalled()
    expect(store.toggleGpxImportVisibility).not.toHaveBeenCalled()
    expect(store.setMarkerTypeVisibility).not.toHaveBeenCalled()
    expect(store.setDrawingTypeVisibility).not.toHaveBeenCalled()
    expect(store.setHelicopterSlotVisibility).not.toHaveBeenCalled()
    expect(store.setGroupVisibility).not.toHaveBeenCalled()
    expect(store.hideAllDevices).not.toHaveBeenCalled()
  })
})

function createStoreAdapter(
  overrides: Partial<Pick<
    LayerVisibilityStoreAdapter,
    | 'hiddenDeviceIds'
    | 'hiddenMarkerIds'
    | 'hiddenDrawingIds'
    | 'hiddenHelicopterIds'
    | 'hiddenGpxImportIds'
  >> = {},
): LayerVisibilityStoreAdapter {
  return {
    hiddenDeviceIds: overrides.hiddenDeviceIds ?? [],
    hiddenMarkerIds: overrides.hiddenMarkerIds ?? [],
    hiddenDrawingIds: overrides.hiddenDrawingIds ?? [],
    hiddenHelicopterIds: overrides.hiddenHelicopterIds ?? [],
    hiddenGpxImportIds: overrides.hiddenGpxImportIds ?? [],
    toggleDeviceVisibility: vi.fn(),
    toggleMarkerVisibility: vi.fn(),
    toggleDrawingVisibility: vi.fn(),
    toggleHelicopterVisibility: vi.fn(),
    toggleGpxImportVisibility: vi.fn(),
    setMarkerTypeVisibility: vi.fn(),
    setDrawingTypeVisibility: vi.fn(),
    setHelicopterSlotVisibility: vi.fn(),
    setGroupVisibility: vi.fn(),
    setBreadcrumbsVisible: vi.fn(),
    setMeasurementsVisible: vi.fn(),
    showAllDevices: vi.fn(),
    hideAllDevices: vi.fn(),
  }
}

function createRoot(): LayerCatalogRootNode {
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
            summary: { totalCount: 2, visibleCount: 2 },
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
                    mission_id: 'mission-1',
                    device_id: 'alpha',
                    name: 'Alpha',
                    color: '#0ea5e9',
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
                    mission_id: 'mission-1',
                    device_id: 'bravo',
                    name: 'Bravo',
                    color: '#f97316',
                    last_seen: null,
                    status: 'online',
                  },
                },
              },
            ],
          },
          {
            id: 'layer:tracking:breadcrumbs',
            kind: 'layer',
            layerKey: 'tracking_breadcrumbs',
            label: 'Breadcrumbs',
            alias: null,
            displayLabel: 'Breadcrumbs',
            isFavorite: false,
            isVisible: true,
            displayOrder: 20,
            parentId: 'group:tracking',
            summary: { totalCount: 0, visibleCount: 0 },
            children: [],
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
            id: 'layer:map-tools:measurements',
            kind: 'layer',
            layerKey: 'measurement',
            label: 'Measurements',
            alias: null,
            displayLabel: 'Measurements',
            isFavorite: false,
            isVisible: true,
            displayOrder: 10,
            parentId: 'group:map-tools',
            summary: { totalCount: 0, visibleCount: 0 },
            children: [],
          },
        ],
      },
    ],
  }
}
