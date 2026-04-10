import { create } from 'zustand'

import type {
  LayerCatalogRuntimeState,
} from './start-layer-catalog-runtime'
import type { LayerCatalogRootNode } from './layer-catalog-types'
import type { LayerCatalogController } from './start-layer-catalog-runtime'
import { createEmptyLayerCatalogTree } from './layer-catalog-types'

type LayerCatalogStoreState = LayerCatalogRuntimeState & {
  readonly controller: LayerCatalogController | null
  readonly applyRuntime: (runtime: LayerCatalogRuntimeState) => void
  readonly applyController: (controller: LayerCatalogController) => void
}

const EMPTY_LAYER_CATALOG_ROOT: LayerCatalogRootNode = createEmptyLayerCatalogTree().root

const EMPTY_LAYER_CATALOG_RUNTIME: LayerCatalogRuntimeState = {
  missionId: null,
  root: EMPTY_LAYER_CATALOG_ROOT,
  metadataEntries: [],
  loading: false,
  error: null,
  selectedNodeId: null,
}

export const useLayerCatalogStore = create<LayerCatalogStoreState>((set) => ({
  ...EMPTY_LAYER_CATALOG_RUNTIME,
  controller: null,
  applyRuntime: (runtime) => set(runtime),
  applyController: (controller) => set({ controller }),
}))

export function applyLayerCatalogRuntime(runtime: LayerCatalogRuntimeState): void {
  useLayerCatalogStore.setState(runtime)
}

export function applyLayerCatalogController(controller: LayerCatalogController): void {
  useLayerCatalogStore.setState({ controller })
}
