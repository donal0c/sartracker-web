import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import {
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
})

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
})
