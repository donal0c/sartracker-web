import { describe, expect, it } from 'vitest'

import {
  buildPackageManifestEntry,
  buildReadinessCertificate,
  checkManifestCoverage,
} from '../../src/features/map/official-map-manifest'
import type { OfficialMapPackageSettings } from '../../src/features/settings/settings-types'

function createReadyPackage(
  overrides?: Partial<OfficialMapPackageSettings>,
): OfficialMapPackageSettings {
  return {
    id: 'official_discovery_topo-abc123',
    sourceType: 'mbtiles',
    mapId: 'official_discovery_topo',
    packagePath: '/private/path/to/package.mbtiles',
    status: 'ready',
    bounds: [-10.8, 51.2, -9.2, 52.5],
    minZoom: 7,
    maxZoom: 16,
    tileCount: 48200,
    tileFormat: 'png',
    sizeBytes: 524288000,
    createdAt: '2026-05-15T10:30:00.000Z',
    verifiedAt: '2026-06-01T14:00:00.000Z',
    message: 'Package verified and ready.',
    ...overrides,
  }
}

describe('official map manifest', () => {
  describe('buildPackageManifestEntry', () => {
    it('builds a complete manifest entry from a ready package', () => {
      const entry = buildPackageManifestEntry(createReadyPackage())

      expect(entry.id).toBe('official_discovery_topo-abc123')
      expect(entry.mapLabel).toBe('Discovery Topo')
      expect(entry.mapId).toBe('official_discovery_topo')
      expect(entry.status).toBe('ready')
      expect(entry.sourceType).toBe('MBTiles')
      expect(entry.tileFormat).toBe('PNG')
      expect(entry.tileCount).toBe(48200)
      expect(entry.minZoom).toBe(7)
      expect(entry.maxZoom).toBe(16)
      expect(entry.zoomRangeDisplay).toBe('z7 – z16')
      expect(entry.sizeBytes).toBe(524288000)
      expect(entry.sizeDisplay).toBe('500.0 MB')
      expect(entry.statusMessage).toBe('Package verified and ready.')
    })

    it('formats bounds as human-readable coordinates', () => {
      const entry = buildPackageManifestEntry(createReadyPackage())

      expect(entry.bounds).not.toBeNull()
      expect(entry.bounds!.west).toBe('10.8000°W')
      expect(entry.bounds!.south).toBe('51.2000°N')
      expect(entry.bounds!.east).toBe('9.2000°W')
      expect(entry.bounds!.north).toBe('52.5000°N')
      expect(entry.bounds!.summary).toContain('51.2000°N')
      expect(entry.bounds!.summary).toContain('52.5000°N')
      expect(entry.bounds!.summary).toContain('10.8000°W')
      expect(entry.bounds!.summary).toContain('9.2000°W')
    })

    it('returns null bounds for a package without bounds', () => {
      const entry = buildPackageManifestEntry(createReadyPackage({ bounds: null }))

      expect(entry.bounds).toBeNull()
    })

    it('formats timestamps as readable dates', () => {
      const entry = buildPackageManifestEntry(createReadyPackage())

      expect(entry.createdAtDisplay).not.toBe('Not recorded')
      expect(entry.verifiedAtDisplay).not.toBe('Not recorded')
    })

    it('shows Not recorded for empty timestamps', () => {
      const entry = buildPackageManifestEntry(
        createReadyPackage({ createdAt: '', verifiedAt: '' }),
      )

      expect(entry.createdAtDisplay).toBe('Not recorded')
      expect(entry.verifiedAtDisplay).toBe('Not recorded')
    })

    it('formats zero-size as Unknown', () => {
      const entry = buildPackageManifestEntry(createReadyPackage({ sizeBytes: 0 }))

      expect(entry.sizeDisplay).toBe('Unknown')
    })

    it('formats undefined size as Unknown', () => {
      const entry = buildPackageManifestEntry(createReadyPackage({ sizeBytes: undefined }))

      expect(entry.sizeDisplay).toBe('Unknown')
    })

    it('formats kilobyte-range sizes', () => {
      const entry = buildPackageManifestEntry(createReadyPackage({ sizeBytes: 51200 }))

      expect(entry.sizeDisplay).toBe('50.0 KB')
    })

    it('formats gigabyte-range sizes', () => {
      const entry = buildPackageManifestEntry(
        createReadyPackage({ sizeBytes: 2147483648 }),
      )

      expect(entry.sizeDisplay).toBe('2.00 GB')
    })

    it('handles only minZoom set', () => {
      const entry = buildPackageManifestEntry(
        createReadyPackage({ minZoom: 5, maxZoom: null }),
      )

      expect(entry.zoomRangeDisplay).toBe('z5+')
    })

    it('handles only maxZoom set', () => {
      const entry = buildPackageManifestEntry(
        createReadyPackage({ minZoom: null, maxZoom: 14 }),
      )

      expect(entry.zoomRangeDisplay).toBe('up to z14')
    })

    it('handles neither zoom set', () => {
      const entry = buildPackageManifestEntry(
        createReadyPackage({ minZoom: null, maxZoom: null }),
      )

      expect(entry.zoomRangeDisplay).toBe('Unknown')
    })

    it('formats empty tile format as Unknown', () => {
      const entry = buildPackageManifestEntry(createReadyPackage({ tileFormat: '' }))

      expect(entry.tileFormat).toBe('Unknown')
    })

    it('never exposes the private package path', () => {
      const entry = buildPackageManifestEntry(createReadyPackage())

      const serialized = JSON.stringify(entry)
      expect(serialized).not.toContain('/private/path')
      expect(serialized).not.toContain('package.mbtiles')
    })
  })

  describe('checkManifestCoverage', () => {
    const viewInsideBounds = { west: -10.5, south: 51.5, east: -9.5, north: 52.0 }
    const viewOutsideBounds = { west: -8.0, south: 53.0, east: -7.0, north: 54.0 }
    const viewPartiallyOutside = { west: -11.0, south: 51.0, east: -9.5, north: 52.0 }

    it('reports covered when the view is fully inside package bounds', () => {
      const result = checkManifestCoverage(createReadyPackage(), viewInsideBounds)

      expect(result.status).toBe('covered')
      expect(result.tone).toBe('success')
      expect(result.label).toBe('View covered')
      expect(result.detail).toContain('fully inside')
    })

    it('reports outside when the view extends beyond package bounds', () => {
      const result = checkManifestCoverage(createReadyPackage(), viewOutsideBounds)

      expect(result.status).toBe('outside')
      expect(result.tone).toBe('danger')
      expect(result.label).toBe('View outside package')
      expect(result.detail).toContain('extends beyond')
    })

    it('reports outside when the view partially overlaps', () => {
      const result = checkManifestCoverage(createReadyPackage(), viewPartiallyOutside)

      expect(result.status).toBe('outside')
      expect(result.tone).toBe('danger')
    })

    it('reports unknown for a missing package', () => {
      const result = checkManifestCoverage(
        createReadyPackage({ status: 'missing' }),
        viewInsideBounds,
      )

      expect(result.status).toBe('unknown')
      expect(result.tone).toBe('neutral')
      expect(result.detail).toContain('missing')
    })

    it('reports unknown for an invalid package', () => {
      const result = checkManifestCoverage(
        createReadyPackage({ status: 'invalid' }),
        viewInsideBounds,
      )

      expect(result.status).toBe('unknown')
      expect(result.tone).toBe('neutral')
      expect(result.detail).toContain('invalid')
    })

    it('reports unknown for a pending package', () => {
      const result = checkManifestCoverage(
        createReadyPackage({ status: 'pending' }),
        viewInsideBounds,
      )

      expect(result.status).toBe('unknown')
      expect(result.tone).toBe('neutral')
    })

    it('reports unknown when bounds are null even if status is ready', () => {
      const result = checkManifestCoverage(
        createReadyPackage({ bounds: null }),
        viewInsideBounds,
      )

      expect(result.status).toBe('unknown')
      expect(result.tone).toBe('neutral')
      expect(result.detail).toContain('bounds are not recorded')
    })

    it('returns the package id for correlation', () => {
      const result = checkManifestCoverage(createReadyPackage(), viewInsideBounds)

      expect(result.packageId).toBe('official_discovery_topo-abc123')
    })
  })

  describe('buildReadinessCertificate', () => {
    const generatedAt = '2026-06-06T12:00:00.000Z'

    it('builds a certificate with correct counts', () => {
      const packages = [
        createReadyPackage(),
        createReadyPackage({ id: 'pkg-2', status: 'missing', message: 'File not found.' }),
      ]
      const cert = buildReadinessCertificate(packages, generatedAt)

      expect(cert.packageCount).toBe(2)
      expect(cert.readyCount).toBe(1)
      expect(cert.entries).toHaveLength(2)
    })

    it('generates human-readable report text', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.reportText).toContain('SAR Tracker — Official Map Readiness Certificate')
      expect(cert.reportText).toContain('Packages registered: 1')
      expect(cert.reportText).toContain('Packages ready: 1')
      expect(cert.reportText).toContain('Discovery Topo')
      expect(cert.reportText).toContain('Ready')
    })

    it('includes safety disclaimer in the report', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.reportText).toContain('SAFETY')
      expect(cert.reportText).toContain('does not guarantee coverage')
    })

    it('never includes private paths in the report', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.reportText).not.toContain('/private/path')
      expect(cert.reportText).not.toContain('package.mbtiles')
    })

    it('never includes credentials or URLs in the report', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.reportText).not.toContain('mapgenie')
      expect(cert.reportText).not.toContain('password')
      expect(cert.reportText).not.toContain('http')
    })

    it('handles empty package list gracefully', () => {
      const cert = buildReadinessCertificate([], generatedAt)

      expect(cert.packageCount).toBe(0)
      expect(cert.readyCount).toBe(0)
      expect(cert.entries).toHaveLength(0)
      expect(cert.reportText).toContain('No official map packages are registered')
    })

    it('includes bounds in the certificate entries', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.entries[0]!.bounds).toContain('51.2000°N')
      expect(cert.entries[0]!.bounds).toContain('10.8000°W')
    })

    it('shows Unknown bounds for packages without bounds', () => {
      const cert = buildReadinessCertificate(
        [createReadyPackage({ bounds: null })],
        generatedAt,
      )

      expect(cert.entries[0]!.bounds).toBe('Unknown')
    })

    it('formats certificate entry status correctly', () => {
      const packages = [
        createReadyPackage({ id: '1', status: 'ready' }),
        createReadyPackage({ id: '2', status: 'missing' }),
        createReadyPackage({ id: '3', status: 'invalid' }),
        createReadyPackage({ id: '4', status: 'pending' }),
      ]
      const cert = buildReadinessCertificate(packages, generatedAt)

      expect(cert.entries[0]!.status).toBe('Ready')
      expect(cert.entries[1]!.status).toBe('Missing')
      expect(cert.entries[2]!.status).toBe('Unreadable')
      expect(cert.entries[3]!.status).toBe('Pending validation')
    })

    it('reports size in human-readable format', () => {
      const cert = buildReadinessCertificate([createReadyPackage()], generatedAt)

      expect(cert.entries[0]!.size).toBe('500.0 MB')
    })
  })
})
