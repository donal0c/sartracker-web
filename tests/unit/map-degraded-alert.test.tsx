import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MapDegradedAlert } from '../../src/components/map-degraded-alert'
import { createMapOverlaySyncWarning, type MapHealth } from '../../src/lib/map-health'
import type { OfflineMapReadiness } from '../../src/features/map/offline-map-readiness'

describe('map overlay warning alert', () => {
  it('shows an overlay-specific alert while basemap health remains independent', () => {
    const warning = createMapOverlaySyncWarning('markers', 'markers')
    const mapHealth = {
      status: 'ready',
      message: 'OpenStreetMap basemap ready',
      overlayWarnings: [warning],
    } as MapHealth

    const markup = renderToStaticMarkup(
      <MapDegradedAlert
        mapHealth={mapHealth}
        offlineReadiness={{ tone: 'success', label: 'Offline map ready' } as OfflineMapReadiness}
      />,
    )

    expect(markup).toContain('data-testid="map-degraded-alert"')
    expect(markup).toContain('data-testid="map-overlay-warning-markers"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Markers overlay may be missing or stale')
    expect(markup).not.toContain('data-testid="map-health-degraded"')
    expect(markup).not.toContain('type="button"')
  })
})
