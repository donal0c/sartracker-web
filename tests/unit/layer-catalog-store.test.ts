import { describe, expect, it } from 'vitest'

import {
  applyLayerCatalogRuntime,
  useLayerCatalogStore,
} from '../../src/features/layers/layer-catalog-store'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'

describe('layer catalog store', () => {
  it('hydrates visibility state when runtime snapshots are applied', () => {
    useLayerCatalogStore.setState(useLayerCatalogStore.getInitialState())
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())

    applyLayerCatalogRuntime({
      missionId: 'mission-1',
      metadataEntries: [],
      loading: false,
      error: null,
      selectedNodeId: null,
      root: {
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
            isVisible: false,
            displayOrder: 20,
            parentId: 'root:mission-catalog',
            children: [
              {
                id: 'layer:drawings:range-ring',
                kind: 'layer',
                layerKey: 'drawing_range_ring',
                label: 'Range Rings',
                alias: null,
                displayLabel: 'Range Rings',
                isFavorite: false,
                isVisible: true,
                displayOrder: 10,
                parentId: 'group:map-tools',
                summary: { totalCount: 0, visibleCount: 0 },
                children: [],
              },
              {
                id: 'layer:map-tools:measurements',
                kind: 'layer',
                layerKey: 'map_tools_measurements',
                label: 'Measurements',
                alias: null,
                displayLabel: 'Measurements',
                isFavorite: false,
                isVisible: false,
                displayOrder: 20,
                parentId: 'group:map-tools',
                summary: { totalCount: 0, visibleCount: 0 },
                children: [],
              },
            ],
          },
        ],
      },
    })

    const visibility = useLayerVisibilityStore.getState()
    expect(visibility.hydratedMissionId).toBe('mission-1')
    expect(visibility.hiddenDeviceIds).toEqual(['alpha'])
    expect(visibility.groupVisibility.mapTools).toBe(false)
    expect(visibility.drawingTypeVisibility.range_ring).toBe(true)
    expect(visibility.measurementsVisible).toBe(false)
  })
})
