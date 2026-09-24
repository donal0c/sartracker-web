import type maplibregl from 'maplibre-gl'

import { createMapOverlaySyncWarning, type MapOverlayFamily, type MapOverlaySyncRegistrationId } from '../../lib/map-health'
import { recordDiagnosticEvent } from '../diagnostics/diagnostic-event-log'
import { useMapOverlayWarningStore } from './map-overlay-warning-store'
import {
  registerMapStyleSync,
  type MapStyleSyncFailureState,
  type MapStyleSyncOptions,
} from './map-style-sync'

const failureStatesByMap = new WeakMap<maplibregl.Map, Map<MapOverlaySyncRegistrationId, MapStyleSyncFailureState>>()

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
  const failureState = getFailureState(map, registrationId)
  return registerMapStyleSync(map, synchronize, {
    ...options,
    failureState,
    onPersistentFailure: ({ consecutiveFailures, errorClass }) => {
      const warning = createMapOverlaySyncWarning(registrationId, family)
      if (!useMapOverlayWarningStore.getState().raiseWarning(warning)) return
      void recordDiagnosticEvent({
        level: 'warn',
        category: 'map',
        event: 'map_overlay_sync_failed',
        fields: { registrationId, overlayFamily: family, consecutiveFailures, errorClass },
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

/** Returns the failure streak shared by quick re-registrations of this map overlay. */
function getFailureState(
  map: maplibregl.Map,
  registrationId: MapOverlaySyncRegistrationId,
): MapStyleSyncFailureState {
  let failureStates = failureStatesByMap.get(map)
  if (failureStates === undefined) {
    failureStates = new Map()
    failureStatesByMap.set(map, failureStates)
  }

  let failureState = failureStates.get(registrationId)
  if (failureState === undefined) {
    failureState = { consecutiveFailures: 0, persistentFailureReported: false }
    failureStates.set(registrationId, failureState)
  }
  return failureState
}
