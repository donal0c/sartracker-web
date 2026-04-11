import { invoke } from '@tauri-apps/api/core'

import { isTauriRuntimeAvailable } from '../../lib/tauri-runtime'
import type {
  LayerCatalogMetadataEntry,
  UpsertLayerCatalogMetadataInput,
} from '../../features/layers/layer-catalog-types'

const BROWSER_LAYER_CATALOG_STORAGE_KEY = 'sartracker:browser-layer-catalog'

type BrowserLayerCatalogState = Record<string, readonly LayerCatalogMetadataEntry[]>
type RawLayerCatalogMetadataEntry = {
  readonly mission_id: string
  readonly node_id: string
  readonly parent_node_id: string | null
  readonly node_kind: LayerCatalogMetadataEntry['nodeKind']
  readonly alias: string | null
  readonly is_favorite: boolean
  readonly is_visible: boolean
  readonly display_order: number
  readonly metadata_json: string | null
  readonly updated_at: string
}

export type LayerCatalogStore = {
  readonly listMetadata: (missionId: string) => Promise<readonly LayerCatalogMetadataEntry[]>
  readonly upsertMetadata: (
    input: UpsertLayerCatalogMetadataInput,
  ) => Promise<LayerCatalogMetadataEntry>
  readonly clearMetadata: (missionId: string) => Promise<void>
}

export function createTauriLayerCatalogStore(): LayerCatalogStore {
  return {
    listMetadata: listLayerCatalogMetadata,
    upsertMetadata: upsertLayerCatalogMetadata,
    clearMetadata: clearLayerCatalogMetadata,
  }
}

export async function listLayerCatalogMetadata(
  missionId: string,
): Promise<readonly LayerCatalogMetadataEntry[]> {
  if (isTauriRuntimeAvailable()) {
    const entries = await invoke<readonly RawLayerCatalogMetadataEntry[]>(
      'list_layer_catalog_entries',
      { missionId },
    )
    return entries.map(fromRawEntry)
  }

  return readBrowserCatalogState()[missionId] ?? []
}

export async function upsertLayerCatalogMetadata(
  input: UpsertLayerCatalogMetadataInput,
): Promise<LayerCatalogMetadataEntry> {
  if (isTauriRuntimeAvailable()) {
    const entry = await invoke<RawLayerCatalogMetadataEntry>('upsert_layer_catalog_entry', {
      input: {
        mission_id: input.missionId,
        node_id: input.nodeId,
        parent_node_id: input.parentNodeId,
        node_kind: input.nodeKind,
        alias: input.alias ?? null,
        is_favorite: input.isFavorite ?? false,
        is_visible: input.isVisible ?? true,
        display_order: input.displayOrder ?? 0,
        metadata_json: input.metadataJson ?? null,
      },
    })
    return fromRawEntry(entry)
  }

  ensureBrowserMissionMutable(input.missionId)

  const current = readBrowserCatalogState()
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
    updatedAt: new Date().toISOString(),
  }
  const nextMissionEntries = upsertEntry(current[input.missionId] ?? [], nextEntry)
  writeBrowserCatalogState({
    ...current,
    [input.missionId]: nextMissionEntries,
  })
  return nextEntry
}

export async function clearLayerCatalogMetadata(missionId: string): Promise<void> {
  if (isTauriRuntimeAvailable()) {
    await invoke('clear_layer_catalog_entries', { missionId })
    return
  }

  ensureBrowserMissionMutable(missionId)
  const current = readBrowserCatalogState()
  if (!(missionId in current)) {
    return
  }

  const next = { ...current }
  delete next[missionId]
  writeBrowserCatalogState(next)
}

function fromRawEntry(entry: RawLayerCatalogMetadataEntry): LayerCatalogMetadataEntry {
  return {
    missionId: entry.mission_id,
    nodeId: entry.node_id,
    parentNodeId: entry.parent_node_id,
    nodeKind: entry.node_kind,
    alias: entry.alias,
    isFavorite: entry.is_favorite,
    isVisible: entry.is_visible,
    displayOrder: entry.display_order,
    metadataJson: entry.metadata_json,
    updatedAt: entry.updated_at,
  }
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

function readBrowserCatalogState(): BrowserLayerCatalogState {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.sessionStorage.getItem(BROWSER_LAYER_CATALOG_STORAGE_KEY)
    if (raw === null) {
      return {}
    }

    return JSON.parse(raw) as BrowserLayerCatalogState
  } catch {
    return {}
  }
}

function writeBrowserCatalogState(state: BrowserLayerCatalogState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(BROWSER_LAYER_CATALOG_STORAGE_KEY, JSON.stringify(state))
}

function ensureBrowserMissionMutable(missionId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const raw = window.sessionStorage.getItem('sartracker:browser-harness')
  if (raw === null) {
    return
  }

  try {
    const parsed = JSON.parse(raw) as {
      missions?: readonly { readonly id: string; readonly status: string }[]
    }
    const mission = parsed.missions?.find((candidate) => candidate.id === missionId)
    if (mission?.status === 'finalized') {
      throw new Error('Finalized missions are read-only until an admin unlocks them.')
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
  }
}
