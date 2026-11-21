import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import {
  getDeviceFeatureNodeId,
  TRACKING_DEVICES_LAYER_NODE_ID,
  TRACKING_GROUP_NODE_ID,
} from '../../src/features/layers/layer-catalog-ids'
import { setLayerSubtreeVisibility } from '../../src/features/layers/layer-subtree-visibility'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'

const root = buildLayerCatalogTree({
  missionId: 'mission-1', devices: [], markers: [], drawings: [], helicopters: [],
  gpxImports: [], measurements: [], metadataEntries: [],
  coverage: { devices: [], periods: [] },
})

afterEach(() => {
  useLayerVisibilityStore.getState().setGroupVisibility('tracking', true)
  useLayerVisibilityStore.setState({ hiddenDeviceIds: [] })
})

const device = (id: string) => ({
  id: `device-${id}`, mission_id: 'mission-1', device_id: id, name: `Team ${id}`,
  color: '#38bdf8', last_seen: '2026-04-10T10:00:00.000Z', status: 'online' as const,
})
const rootWithPeople = buildLayerCatalogTree({
  missionId: 'mission-1', devices: [device('1'), device('2')], markers: [], drawings: [], helicopters: [],
  gpxImports: [], measurements: [],
  // The Current Location layer itself was hidden on the old screen.
  metadataEntries: [{
    missionId: 'mission-1', nodeId: TRACKING_DEVICES_LAYER_NODE_ID, parentNodeId: TRACKING_GROUP_NODE_ID,
    nodeKind: 'layer', alias: null, isFavorite: false, isVisible: false, displayOrder: 10,
    metadataJson: null, updatedAt: '2026-04-10T10:00:00.000Z',
  }],
  coverage: { devices: [], periods: [] },
} as never)

describe('switching a layer on in the simplified workspace [DON-341]', () => {
  it('also switches its hidden Tracking group back on, so the map is not left empty', async () => {
    // The simplified Layers panel does not list the Tracking group, so a group
    // hidden on the old screen could otherwise never be switched back on.
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: true, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(true)
    expect(setNodeVisibilities).toHaveBeenCalledWith([TRACKING_GROUP_NODE_ID], true)
  })

  it('leaves the group alone when switching off, or when not asked to reveal', async () => {
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: true,
    })
    await setLayerSubtreeVisibility({
      root, controller: { setNodeVisibilities } as never,
      nodeId: TRACKING_DEVICES_LAYER_NODE_ID, visible: false, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(false)
    expect(setNodeVisibilities).not.toHaveBeenCalledWith([TRACKING_GROUP_NODE_ID], true)
  })

  it('switching one person on never switches on other hidden people', async () => {
    useLayerVisibilityStore.getState().setGroupVisibility('tracking', false)
    useLayerVisibilityStore.setState({ hiddenDeviceIds: ['1', '2'] })
    const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

    await setLayerSubtreeVisibility({
      root: rootWithPeople, controller: { setNodeVisibilities } as never,
      nodeId: getDeviceFeatureNodeId('1'), visible: true, revealAncestors: true,
    })

    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toEqual(['2'])
    expect(useLayerVisibilityStore.getState().groupVisibility.tracking).toBe(true)
  })
})
