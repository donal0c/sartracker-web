import type maplibregl from 'maplibre-gl'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearDiagnosticEvents, readDiagnosticEvents } from '../../src/features/diagnostics/diagnostic-event-log'
import { registerMapOverlaySync } from '../../src/features/map/register-map-overlay-sync'
import { useMapOverlayWarningStore } from '../../src/features/map/map-overlay-warning-store'

type MapEventName = 'idle' | 'style.load' | 'styledataloading'
type MapEventListener = () => void

describe('registerMapOverlaySync', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    useMapOverlayWarningStore.setState({ warnings: [] })
    clearDiagnosticEvents()
  })

  it('retains failures across quick re-registration and records a sanitized error class', () => {
    vi.useFakeTimers()
    clearDiagnosticEvents()
    const map = createMapHarness()
    const synchronize = vi.fn(() => {
      throw new TypeError('Private map source at /users/operator/mission-data failed.')
    })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const dispose = registerMapOverlaySync(map, 'measurement-preview', 'measurements', synchronize)
      expect(useMapOverlayWarningStore.getState().warnings).toEqual([])
      dispose()
    }

    const disposeFailingRegistration = registerMapOverlaySync(
      map,
      'measurement-preview',
      'measurements',
      synchronize,
    )

    expect(useMapOverlayWarningStore.getState().warnings.map((warning) => warning.registrationId))
      .toEqual(['measurement-preview'])
    const failureEvents = readDiagnosticEvents().filter((event) => event.event === 'map_overlay_sync_failed')
    expect(failureEvents).toHaveLength(1)
    expect(failureEvents[0]?.fields).toMatchObject({
      registrationId: 'measurement-preview',
      overlayFamily: 'measurements',
      consecutiveFailures: 3,
      errorClass: 'TypeError',
    })
    expect(JSON.stringify(failureEvents)).not.toContain('Private map source')
    expect(JSON.stringify(failureEvents)).not.toContain('/users/operator/mission-data')

    disposeFailingRegistration()
    const disposeRecoveredRegistration = registerMapOverlaySync(map, 'measurement-preview', 'measurements', vi.fn())
    expect(useMapOverlayWarningStore.getState().warnings).toEqual([])
    expect(readDiagnosticEvents().filter((event) => event.event === 'map_overlay_sync_recovered')).toHaveLength(1)

    disposeRecoveredRegistration()
  })
})

/** Creates the minimal loaded style and event surface needed by map overlay sync. */
function createMapHarness(): maplibregl.Map {
  const listeners = new Map<MapEventName, Set<MapEventListener>>()
  return {
    getStyle: () => ({ layers: [{ id: 'base-layer' }], sources: {}, version: 8 }),
    off: (event: MapEventName, listener: MapEventListener) => listeners.get(event)?.delete(listener),
    on: (event: MapEventName, listener: MapEventListener) => {
      const eventListeners = listeners.get(event) ?? new Set<MapEventListener>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    },
  } as unknown as maplibregl.Map
}
