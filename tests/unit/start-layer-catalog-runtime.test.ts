import { describe, expect, it, vi } from 'vitest'

import { startLayerCatalogRuntime } from '../../src/features/layers/start-layer-catalog-runtime'
import type { LayerCatalogMetadataEntry } from '../../src/features/layers/layer-catalog-types'
import type {
  Device,
  Helicopter,
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
      helicopters: [],
      gpxImports: [],
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
      helicopters: [],
      gpxImports: [],
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

  it('persists helicopter feature-item aliases with the canonical helicopter layer parent', async () => {
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
      markers: [],
      drawings: [],
      helicopters: [createHelicopter()],
      gpxImports: [],
    })
    await runtime.renameNode('feature:helicopter:heli-1', 'Primary air asset')

    expect(upsertMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'feature:helicopter:heli-1',
        parentNodeId: 'layer:helicopters:slot-2',
        nodeKind: 'feature_item',
        alias: 'Primary air asset',
      }),
    )
  })

  it('ignores stale refresh results that resolve after a visibility mutation', async () => {
    const applyRuntime = vi.fn()
    const staleMetadata = deferredPromise<readonly LayerCatalogMetadataEntry[]>()
    let entries: readonly LayerCatalogMetadataEntry[] = []
    let metadataMode: 'fresh' | 'stale' = 'fresh'

    const runtime = await startLayerCatalogRuntime({
      layerCatalogStore: {
        listMetadata: vi.fn().mockImplementation(async () => {
          if (metadataMode === 'stale') {
            return staleMetadata.promise
          }

          if (entries.length > 0) {
            return entries
          }

          return []
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
      },
      applyRuntime,
    })

    await runtime.refreshCatalog({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team')],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
    })

    metadataMode = 'stale'
    const refreshPromise = runtime.refreshCatalog({
      missionId: 'mission-1',
      devices: [createDevice('alpha', 'Alpha Team')],
      markers: [],
      drawings: [],
      helicopters: [],
      gpxImports: [],
    })

    await Promise.resolve()
    await runtime.setNodeVisibility('feature:device:alpha', false)
    staleMetadata.resolve([])
    await refreshPromise

    const latestRuntime = applyRuntime.mock.calls.at(-1)?.[0]
    expect(latestRuntime.root.children[0]?.children[0]?.children[0]?.isVisible).toBe(false)
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

function deferredPromise<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })

  return { promise, resolve, reject }
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
    updated_by: null,
    coordinator_ids: null,
    attachment_path: null,
  }
}

function createHelicopter(): Helicopter {
  return {
    id: 'heli-1',
    mission_id: 'mission-1',
    slot_key: 'slot_2',
    call_sign: 'Rescue 115',
    hex_id: '4CA999',
    lat: 52.1,
    lon: -9.6,
    altitude: 1400,
    speed: 110,
    heading: 220,
    last_update: '2026-04-11T10:00:00.000Z',
    created_at: '2026-04-11T09:55:00.000Z',
    updated_at: '2026-04-11T10:00:00.000Z',
  }
}
