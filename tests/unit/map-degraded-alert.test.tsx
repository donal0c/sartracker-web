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
    expect(markup).toContain('role="region"')
    expect(markup).toContain('aria-label="Active map alerts, 1 overlay warning"')
    expect(markup).toContain('tabindex="0"')
    // DON-369: the warnings sit above the coordinate bar, the map scale and any GPX notice, in their own band.
    expect(markup).toContain('max-h-[min(50%,calc(100%-var(--sar-coordinate-bar-height,72px)-var(--sar-map-scale-gap)-var(--sar-map-scale-height)-var(--sar-gpx-notice-reserve,0px)-1.5rem))]')
    expect(markup).toContain('bottom-[calc(var(--sar-coordinate-bar-height,72px)+var(--sar-map-scale-gap)+var(--sar-map-scale-height)+var(--sar-gpx-notice-reserve,0px)+0.5rem)]')
    expect(markup).toContain('overflow-y-auto')
    expect(markup).toContain('data-testid="map-overlay-warning-markers"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Markers overlay may be missing or stale')
    expect(markup).not.toContain('data-testid="map-health-degraded"')
    expect(markup).not.toContain('type="button"')
  })
})

describe('startup map notice [DON-304]', () => {
  it('shows why the stored official map was not restored, even when the basemap is healthy', () => {
    const markup = renderToStaticMarkup(
      <MapDegradedAlert
        mapHealth={{
          status: 'ready',
          message: 'OpenTopoMap basemap ready',
          startupMapNotice: 'Discovery Topo unavailable: its offline package cannot be found — showing OpenTopoMap.',
        } as MapHealth}
        offlineReadiness={{ tone: 'success', label: 'Offline map ready' } as OfflineMapReadiness}
      />,
    )

    expect(markup).toContain('data-testid="map-startup-notice"')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('Discovery Topo unavailable')
  })
})
