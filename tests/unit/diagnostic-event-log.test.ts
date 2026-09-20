import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearDiagnosticEvents,
  formatDiagnosticEvents,
  readDiagnosticEvents,
  recordDiagnosticEvent,
} from '../../src/features/diagnostics/diagnostic-event-log'

describe('diagnostic event log', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    Reflect.deleteProperty(window, 'sartrackerElectron')
  })

  it('stores sanitized map/tracking breadcrumbs without precise coordinates, secrets, or private paths', async () => {
    await recordDiagnosticEvent({
      ts: '2026-06-22T15:00:00.000Z',
      level: 'info',
      category: 'map',
      event: 'marker_saved',
      fields: {
        markerType: 'clue',
        lat: 52.0599,
        lon: -9.5045,
        coordinates: [-9.5045, 52.0599],
        packagePath: '/Users/operator/Maps/reeks-standard-60km-z16.mbtiles',
        apiToken: 'field-secret',
      },
    })

    const events = readDiagnosticEvents()

    expect(events).toEqual([
      {
        ts: '2026-06-22T15:00:00.000Z',
        level: 'info',
        category: 'map',
        event: 'marker_saved',
        fields: {
          markerType: 'clue',
          lat: '[coordinate-redacted]',
          lon: '[coordinate-redacted]',
          coordinates: '[coordinate-redacted]',
          packagePath: '/Users/[redacted]',
          apiToken: '[redacted]',
        },
      },
    ])
    expect(JSON.stringify(events)).not.toContain('52.0599')
    expect(JSON.stringify(events)).not.toContain('-9.5045')
    expect(JSON.stringify(events)).not.toContain('operator')
    expect(JSON.stringify(events)).not.toContain('field-secret')
  })

  it('recursively sanitizes coordinates, secrets, and private paths inside nested renderer fields [WAR04-PRV-03]', async () => {
    await recordDiagnosticEvent({
      ts: '2026-09-17T11:00:00.000Z',
      level: 'warn',
      category: 'tracking',
      event: 'nested_tracking_fault',
      fields: {
        context: {
          position: { latitude: 52.0599, longitude: -9.5045 },
          authorization: 'Bearer field-secret',
          profilePath: '/Users/operator/Library/Application Support/SAR Tracker',
        },
      },
    })

    const serialized = JSON.stringify(readDiagnosticEvents())
    expect(serialized).toContain('[coordinate-redacted]')
    expect(serialized).toContain('[redacted]')
    expect(serialized).toContain('/Users/[redacted]')
    expect(serialized).not.toContain('52.0599')
    expect(serialized).not.toContain('-9.5045')
    expect(serialized).not.toContain('field-secret')
    expect(serialized).not.toContain('operator')
  })

  it('redacts sensitive values repeated inside nested arrays and encoded fields [DON-237]', async () => {
    const secret = 'C17-Renderer-Nested-Array-Secret-9!'
    const profilePath = '/tmp/c17-private-profile/mission-store.sqlite'

    await recordDiagnosticEvent({
      ts: '2026-09-20T12:00:00.000Z',
      level: 'error',
      category: 'runtime',
      event: 'c17_adversarial_corpus',
      fields: {
        context: {
          token: secret,
          profilePath,
          values: [secret, profilePath],
        },
        encodedContext: JSON.stringify({
          token: secret,
          profilePath,
          values: [secret, profilePath],
        }),
      },
    })

    const serialized = JSON.stringify(readDiagnosticEvents())
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain(profilePath)
    expect(serialized).toContain('[redacted]')
  })

  it('fails visibly and bounds oversized encoded diagnostic values [DON-237]', async () => {
    const secret = 'C17-Oversized-Encoded-Secret-9!'
    const encoded = JSON.stringify({ token: secret, padding: 'x'.repeat(40_000) })

    await recordDiagnosticEvent({
      ts: '2026-09-20T12:01:00.000Z',
      level: 'error',
      category: 'runtime',
      event: 'c17_oversized_encoded_payload',
      fields: { encoded },
    })

    const serialized = JSON.stringify(readDiagnosticEvents())
    expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[redacted-structured-value-too-large]')
  })

  it('writes Electron breadcrumbs through the preload bridge while keeping browser fallback history', async () => {
    const recordDiagnosticEventBridge = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: {
        recordDiagnosticEvent: recordDiagnosticEventBridge,
      },
    })

    await recordDiagnosticEvent({
      ts: '2026-06-22T15:03:00.000Z',
      level: 'warn',
      category: 'tracking',
      event: 'tracking_status_changed',
      fields: {
        mode: 'offline',
        consecutiveFailures: 2,
      },
    })

    expect(recordDiagnosticEventBridge).toHaveBeenCalledWith({
      ts: '2026-06-22T15:03:00.000Z',
      level: 'warn',
      category: 'tracking',
      event: 'tracking_status_changed',
      fields: {
        mode: 'offline',
        consecutiveFailures: 2,
      },
    })
    expect(readDiagnosticEvents()).toHaveLength(1)
  })

  it('formats only events inside an incident window', async () => {
    await recordDiagnosticEvent({
      ts: '2026-06-22T14:10:00.000Z',
      level: 'info',
      category: 'map',
      event: 'outside_before',
    })
    await recordDiagnosticEvent({
      ts: '2026-06-22T15:05:00.000Z',
      level: 'info',
      category: 'tracking',
      event: 'inside_window',
      fields: { devices: 4 },
    })
    await recordDiagnosticEvent({
      ts: '2026-06-22T16:00:00.000Z',
      level: 'info',
      category: 'map',
      event: 'outside_after',
    })

    const report = formatDiagnosticEvents(readDiagnosticEvents(), {
      incidentAt: '2026-06-22T15:00:00.000Z',
      beforeMinutes: 30,
      afterMinutes: 30,
    })

    expect(report).toContain('[diagnostic-breadcrumbs]')
    expect(report).toContain('inside_window')
    expect(report).toContain('"devices":4')
    expect(report).not.toContain('outside_before')
    expect(report).not.toContain('outside_after')
  })

  it('clears browser diagnostic breadcrumbs for tests and harness resets', async () => {
    await recordDiagnosticEvent({
      ts: '2026-06-22T15:00:00.000Z',
      level: 'info',
      category: 'map',
      event: 'basemap_changed',
    })

    clearDiagnosticEvents()

    expect(readDiagnosticEvents()).toEqual([])
  })
})
