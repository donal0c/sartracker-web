// V1 regression coverage (sartracker-web-8gw):
// Pin the integration contract that a just-clicked visibility toggle is not
// silently overwritten by an in-flight stale catalog refresh. This wires the
// real layer-catalog runtime, the layer-catalog store (which hydrates the
// flat visibility store), and the layer-filter-panel adapter helper together
// so a regression in any single component shows up here.
//
// Without this guard, a fix in the catalog controller could be subtly broken
// by a change in the catalog store's hydration timing, or a future panel
// rewrite could push to the visibility store before the controller persists,
// re-introducing the original lost-toggle bug.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { applyLayerCatalogController, applyLayerCatalogRuntime, useLayerCatalogStore } from '../../src/features/layers/layer-catalog-store'
import { startLayerCatalogRuntime } from '../../src/features/layers/start-layer-catalog-runtime'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import { applyVisibilityForNodeIds, collectSubtreeNodeIds } from '../../src/features/layers/layer-visibility-service'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import type { Device } from '../../src/infrastructure/mission-store/tauri-mission-store'

function deferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
}

function upsertEntry(
  entries: readonly LayerCatalogMetadataEntry[],
  nextEntry: LayerCatalogMetadataEntry,
): readonly LayerCatalogMetadataEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.nodeId === nextEntry.nodeId)
  if (existingIndex === -1) {
    return [...entries, nextEntry]
  }

  return entries.map((entry, index) => (index === existingIndex ? nextEntry : entry))
}

function createDevice(deviceId: string, name: string): Device {
  return {
    id: `device-${deviceId}`,
    mission_id: 'mission-1',
    device_id: deviceId,
    name,
    color: '#38bdf8',
    last_seen: '2026-04-10T10:00:00.000Z',
    status: 'online',
  }
}

describe('layer catalog stale-refresh integration with visibility store', () => {
  afterEach(() => {
    useLayerVisibilityStore.setState(useLayerVisibilityStore.getInitialState())
    useLayerCatalogStore.setState({
      missionId: null,
      root: useLayerCatalogStore.getInitialState().root,
      metadataEntries: [],
      loading: false,
      error: null,
      selectedNodeId: null,
      controller: null,
    })
  })

  it('keeps the just-clicked visibility off in the flat store even when a stale refresh resolves after the click', async () => {
    let entries: readonly LayerCatalogMetadataEntry[] = []
    const staleMetadata = deferredPromise<readonly LayerCatalogMetadataEntry[]>()
    let metadataMode: 'fresh' | 'stale' = 'fresh'

    const layerCatalogStore = {
      listMetadata: vi.fn().mockImplementation(async () => {
        if (metadataMode === 'stale') {
          return staleMetadata.promise
        }
        return entries
      }),
      upsertMetadata: vi.fn().mockImplementation(async (input) => {
        const nextEntry: LayerCatalogMetadataEntry = {
          missionId: input.missionId,
          nodeId: input.nodeId,
          parentNodeId: input.parentNodeId,
          nodeKind: input.nodeKind,
          alias: input.alias ?? null,
          isFavorite: input.isFavorite ?? false,
          isVisible: input.isVisible ?? true,
          displayOrder: input.displayOrder ?? 0,
          metadataJson: input.metadataJson ?? null,
          updatedAt: '2026-04-10T10:00:00.000Z',
        }
        entries = upsertEntry(entries, nextEntry)
        return nextEntry
      }),
    }

    const controller = await startLayerCatalogRuntime({
      layerCatalogStore,
      applyRuntime: applyLayerCatalogRuntime,
    })
    applyLayerCatalogController(controller)

    // Initial fresh refresh seeds the catalog with two devices visible.
    await controller.refreshCatalog({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team'), createDevice('bravo', 'Bravo Team')],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
    })

    const visibilityState = useLayerVisibilityStore.getState()
    expect(visibilityState.hiddenDeviceIds).toEqual([])

    // A fresh refresh begins (e.g. the bridge re-runs because tracking devices changed).
    metadataMode = 'stale'
    const stalenessRefreshPromise = controller.refreshCatalog({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team'), createDevice('bravo', 'Bravo Team')],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
    })
    await Promise.resolve()

    // Operator clicks Bravo's visibility toggle while the refresh is pending.
    // This mirrors the production layer-filter-panel adapter exactly:
    //   1. persist via the controller (one promise per descendant)
    //   2. immediately push to the flat visibility store
    const root = useLayerCatalogStore.getState().root
    const nodeIds = collectSubtreeNodeIds(root, 'feature:device:bravo')
    void Promise.all(nodeIds.map((nodeId) => controller.setNodeVisibility(nodeId, false)))
    applyVisibilityForNodeIds(root, nodeIds, false, useLayerVisibilityStore.getState())

    // Verify the immediate push reached the flat store before any catalog rebuild.
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toContain('bravo')

    // Now the stale refresh finally resolves with the pre-click metadata snapshot.
    // The controller MUST discard the stale result, so the rebuild that follows
    // the persisted click MUST be the one that wins.
    staleMetadata.resolve([])
    await stalenessRefreshPromise
    // Drain any microtasks scheduled by the persist+rebuild path.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The catalog tree must reflect the click (bravo hidden), and the visibility
    // store must agree — that is the contract operators rely on.
    const finalRoot = useLayerCatalogStore.getState().root
    const bravoNode = finalRoot.children
      .flatMap((group) => group.children)
      .flatMap((layer) => layer.children)
      .find((node) => node.id === 'feature:device:bravo')
    expect(bravoNode?.isVisible).toBe(false)
    expect(useLayerVisibilityStore.getState().hiddenDeviceIds).toContain('bravo')
  })
})
