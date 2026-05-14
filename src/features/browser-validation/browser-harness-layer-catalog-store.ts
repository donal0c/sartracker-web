import type {
  LayerCatalogMetadataEntry,
  UpsertLayerCatalogMetadataInput,
} from '../layers/layer-catalog-types'

const BROWSER_LAYER_CATALOG_STORAGE_KEY = 'sartracker:browser-layer-catalog'
const BROWSER_HARNESS_STORAGE_KEY = 'sartracker:browser-harness'

type BrowserLayerCatalogState = Record<string, readonly LayerCatalogMetadataEntry[]>

export type BrowserHarnessLayerCatalogStore = {
  readonly listMetadata: (missionId: string) => Promise<readonly LayerCatalogMetadataEntry[]>
  readonly upsertMetadata: (
    input: UpsertLayerCatalogMetadataInput,
  ) => Promise<LayerCatalogMetadataEntry>
  readonly clearMetadata: (missionId: string) => Promise<void>
}

/**
 * Returns a layer-catalog store backed purely by browser sessionStorage so the
 * harness never imports Tauri infrastructure. The persistence shape matches the
 * non-Tauri fallback of the production adapter, preserving existing browser
 * harness data while keeping the Tauri adapter out of the harness import graph.
 */
export function getBrowserHarnessLayerCatalogStore(): BrowserHarnessLayerCatalogStore {
  return {
    listMetadata: async (missionId) => readState()[missionId] ?? [],
    upsertMetadata: async (input) => {
      ensureMissionMutable(input.missionId)

      const current = readState()
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

      const existing = current[input.missionId] ?? []
      const existingIndex = existing.findIndex((entry) => entry.nodeId === nextEntry.nodeId)
      const nextEntries =
        existingIndex === -1
          ? [...existing, nextEntry]
          : existing.map((entry, index) => (index === existingIndex ? nextEntry : entry))

      writeState({ ...current, [input.missionId]: nextEntries })
      return nextEntry
    },
    clearMetadata: async (missionId) => {
      ensureMissionMutable(missionId)
      const current = readState()
      if (!(missionId in current)) {
        return
      }

      const next = { ...current }
      delete next[missionId]
      writeState(next)
    },
  }
}

function readState(): BrowserLayerCatalogState {
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

function writeState(state: BrowserLayerCatalogState): void {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(BROWSER_LAYER_CATALOG_STORAGE_KEY, JSON.stringify(state))
}

function ensureMissionMutable(missionId: string): void {
  if (typeof window === 'undefined') {
    return
  }

  const raw = window.sessionStorage.getItem(BROWSER_HARNESS_STORAGE_KEY)
  if (raw === null) {
    return
  }

  try {
    const parsed = JSON.parse(raw) as {
      missions?: readonly { readonly id: string; readonly status: string }[]
    }
    const mission = parsed.missions?.find((candidate) => candidate.id === missionId)
    if (mission?.status === 'finished' || mission?.status === 'finalized') {
      throw new Error(
        `Cannot write data to finished mission ${missionId}; resume the mission or unlock it first.`,
      )
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error
    }
  }
}
