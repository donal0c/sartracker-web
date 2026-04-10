import { describe, expect, it, vi } from 'vitest'

import { startLayerCatalogRuntime } from '../../src/features/layers/start-layer-catalog-runtime'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import type {
  Device,
  Marker,
} from '../../src/infrastructure/mission-store/tauri-mission-store'

describe('startLayerCatalogRuntime', () => {
  it('persists feature-item aliases with the correct parent layer id', async () => {
    const upsertMetadata = vi.fn().mockImplementation(async (input) => ({
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
    }))
    const runtime = await startLayerCatalogRuntime({
      layerCatalogStore: {
        listMetadata: vi.fn().mockResolvedValue([]),
        upsertMetadata,
      },
      applyRuntime: vi.fn(),
    })

    await runtime.refreshCatalog({
      missionId: 'mission-1',
      devices: [],
      markers: [createMarker()],
      drawings: [],
    })
    await runtime.renameNode('feature:marker:marker-1', 'Primary clue')

    expect(upsertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'feature:marker:marker-1',
        parentNodeId: 'layer:markers:clues',
        nodeKind: 'feature_item',
        alias: 'Primary clue',
      }),
    )
  })

  it('persists explicit child order for a parent node', async () => {
    let entries: readonly LayerCatalogMetadataEntry[] = []
    const layerCatalogStore = {
      listMetadata: vi.fn().mockImplementation(async () => entries),
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

    const runtime = await startLayerCatalogRuntime({
      layerCatalogStore,
      applyRuntime: vi.fn(),
    })

    await runtime.refreshCatalog({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team'), createDevice('bravo', 'Bravo Team')],
      markers: [],
      drawings: [],
    })
    await runtime.reorderNode('layer:tracking:devices', [
      'feature:device:bravo',
      'feature:device:alpha',
    ])

    expect(layerCatalogStore.upsertMetadata).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nodeId: 'feature:device:bravo',
        displayOrder: 0,
      }),
    )
    expect(layerCatalogStore.upsertMetadata).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        nodeId: 'feature:device:alpha',
        displayOrder: 1,
      }),
    )
  })
})

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
    created_at: '2026-04-10T10:00:00.000Z',
    updated_at: '2026-04-10T10:00:00.000Z',
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
  }
}
