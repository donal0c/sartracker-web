import type { MissionStore } from './tauri-mission-store'
import { createBreadcrumbQueryClient } from './breadcrumb-query-client'

/**
 * Creates the Electron-backed mission store adapter.
 */
export function createElectronMissionStore(): MissionStore {
  const bridge = window.sartrackerElectron
  if (bridge === undefined) {
    throw new Error('Electron mission store bridge is not available.')
  }
  return { ...bridge.missionStore, ...createBreadcrumbQueryClient(bridge.missionStore) }
}
