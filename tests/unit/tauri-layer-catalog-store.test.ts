import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

vi.mock('../../src/lib/tauri-runtime', () => ({
  isTauriRuntimeAvailable: () => true,
}))

describe('tauri layer catalog store adapter', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('maps layer catalog commands through the Tauri boundary', async () => {
    const { createTauriLayerCatalogStore } = await import(
      '../../src/infrastructure/layer-catalog-store/tauri-layer-catalog-store'
    )

    invokeMock.mockResolvedValueOnce([
      {
        mission_id: 'mission-1',
        node_id: 'group:tracking',
        parent_node_id: 'root:mission-catalog',
        node_kind: 'group',
        alias: 'Tracking Ops',
        is_favorite: true,
        is_visible: true,
        display_order: 1,
        metadata_json: null,
        updated_at: '2026-04-10T10:00:00.000Z',
      },
    ])
    invokeMock.mockResolvedValueOnce({
      mission_id: 'mission-1',
      node_id: 'layer:markers:clues',
      parent_node_id: 'group:map-tools',
      node_kind: 'layer',
      alias: null,
      is_favorite: false,
      is_visible: false,
      display_order: 2,
      metadata_json: null,
      updated_at: '2026-04-10T10:05:00.000Z',
    })

    const store = createTauriLayerCatalogStore()

    await expect(store.listMetadata('mission-1')).resolves.toEqual([
      {
        missionId: 'mission-1',
        nodeId: 'group:tracking',
        parentNodeId: 'root:mission-catalog',
        nodeKind: 'group',
        alias: 'Tracking Ops',
        isFavorite: true,
        isVisible: true,
        displayOrder: 1,
        metadataJson: null,
        updatedAt: '2026-04-10T10:00:00.000Z',
      },
    ])

    await expect(
      store.upsertMetadata({
        missionId: 'mission-1',
        nodeId: 'layer:markers:clues',
        parentNodeId: 'group:map-tools',
        nodeKind: 'layer',
        isVisible: false,
        displayOrder: 2,
      }),
    ).resolves.toEqual({
      missionId: 'mission-1',
      nodeId: 'layer:markers:clues',
      parentNodeId: 'group:map-tools',
      nodeKind: 'layer',
      alias: null,
      isFavorite: false,
      isVisible: false,
      displayOrder: 2,
      metadataJson: null,
      updatedAt: '2026-04-10T10:05:00.000Z',
    })

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_layer_catalog_entries', {
      missionId: 'mission-1',
    })
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'upsert_layer_catalog_entry', {
      input: {
        mission_id: 'mission-1',
        node_id: 'layer:markers:clues',
        parent_node_id: 'group:map-tools',
        node_kind: 'layer',
        alias: null,
        is_favorite: false,
        is_visible: false,
        display_order: 2,
        metadata_json: null,
      },
    })
  })
})
