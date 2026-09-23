import type maplibregl from 'maplibre-gl'

import { createMapOverlaySyncWarning, type MapOverlayFamily, type MapOverlaySyncRegistrationId } from '../../lib/map-health'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'
import { useMapOverlayWarningStore } from './map-overlay-warning-store'
import { registerMapStyleSync, type MapStyleSyncOptions } from './map-style-sync'

/**
 * Registers one map overlay sync and exposes persistent failures as a bounded,
 * sanitized warning that clears only after this registration synchronizes.
 */
export function registerMapOverlaySync(
  map: maplibregl.Map,
  registrationId: MapOverlaySyncRegistrationId,
  family: MapOverlayFamily,
  synchronize: (signal: AbortSignal) => void | Promise<void>,
  options: Pick<MapStyleSyncOptions, 'onStyleUnavailable'> = {},
): () => void {
  return registerMapStyleSync(map, synchronize, {
    ...options,
    onPersistentFailure: (consecutiveFailures) => {
      const warning = createMapOverlaySyncWarning(registrationId, family)
      if (!useMapOverlayWarningStore.getState().raiseWarning(warning)) return
      void recordDiagnosticEvent({
        level: 'warn',
        category: 'map',
        event: 'map_overlay_sync_failed',
        fields: { registrationId, overlayFamily: family, consecutiveFailures },
      })
    },
    onSynchronized: () => {
      if (!useMapOverlayWarningStore.getState().clearWarning(registrationId)) return
      void recordDiagnosticEvent({
        level: 'info',
        category: 'map',
        event: 'map_overlay_sync_recovered',
        fields: { registrationId, overlayFamily: family },
      })
    },
  })
}
