import type { LayerCatalogStore } from './tauri-layer-catalog-store'

/**
 * Creates the Electron-backed layer catalog metadata adapter.
 */
export function createElectronLayerCatalogStore(): LayerCatalogStore {
  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron layer catalog bridge is not available.')
  }
  return bridge.layerCatalogStore
}
