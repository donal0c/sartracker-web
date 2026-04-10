import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type LayerTreeUiState = {
  readonly panelExpanded: boolean
  readonly searchQuery: string
  readonly expandedNodeIds: readonly string[]
  readonly setPanelExpanded: (expanded: boolean) => void
  readonly setSearchQuery: (query: string) => void
  readonly toggleNodeExpanded: (nodeId: string) => void
  readonly setNodeExpanded: (nodeId: string, expanded: boolean) => void
  readonly resetExpandedNodeIds: (nodeIds: readonly string[]) => void
}

const DEFAULT_EXPANDED_NODE_IDS = [
  'group:tracking',
  'group:map-tools',
  'layer:tracking:devices',
  'layer:markers:ipp-lkp',
  'layer:markers:clues',
  'layer:markers:hazards',
  'layer:markers:casualties',
  'layer:drawings:line',
  'layer:drawings:search-area',
  'layer:drawings:range-ring',
  'layer:drawings:bearing-line',
  'layer:drawings:search-sector',
  'layer:drawings:text-label',
] as const

export const useLayerTreeUiStore = create<LayerTreeUiState>()(
  persist(
    (set) => ({
      panelExpanded: true,
      searchQuery: '',
      expandedNodeIds: [...DEFAULT_EXPANDED_NODE_IDS],
      setPanelExpanded: (expanded) => set({ panelExpanded: expanded }),
      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleNodeExpanded: (nodeId) =>
        set((state) => ({
          expandedNodeIds: state.expandedNodeIds.includes(nodeId)
            ? state.expandedNodeIds.filter((candidate) => candidate !== nodeId)
            : [...state.expandedNodeIds, nodeId],
        })),
      setNodeExpanded: (nodeId, expanded) =>
        set((state) => ({
          expandedNodeIds: expanded
            ? state.expandedNodeIds.includes(nodeId)
              ? state.expandedNodeIds
              : [...state.expandedNodeIds, nodeId]
            : state.expandedNodeIds.filter((candidate) => candidate !== nodeId),
        })),
      resetExpandedNodeIds: (nodeIds) => set({ expandedNodeIds: [...nodeIds] }),
    }),
    {
      name: 'sartracker:layer-tree-ui',
      partialize: (state) => ({
        panelExpanded: state.panelExpanded,
        expandedNodeIds: state.expandedNodeIds,
      }),
    },
  ),
)
