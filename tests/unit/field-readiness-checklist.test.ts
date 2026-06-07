import { describe, expect, it } from 'vitest'

import {
  buildFieldReadinessChecklist,
  type FieldReadinessInput,
} from '../../src/features/map/field-readiness-checklist'
import type { OfficialMapPackageSettings, OfficialMapSettings } from '../../src/features/settings/settings-types'

function createReadyPackage(overrides?: Partial<OfficialMapPackageSettings>): OfficialMapPackageSettings {
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

function createOfficialMaps(overrides?: Partial<OfficialMapSettings>): OfficialMapSettings {
  return {
    sourceType: 'mapgenie_file',
    sourcePath: '',
    status: 'configured',
    username: 'admin',
    availableSources: ['official_discovery_topo'],
    serviceCount: 1,
    message: '',
    packages: [createReadyPackage()],
    ...overrides,
  }
}

function createInput(overrides?: Partial<FieldReadinessInput>): FieldReadinessInput {
  return {
    activeMapId: 'official_discovery_topo',
    officialMaps: createOfficialMaps(),
    viewBounds: { west: -10.5, south: 51.5, east: -9.5, north: 52.0 },
    ...overrides,
  }
}

describe('field readiness checklist', () => {
  describe('all checks pass', () => {
    it('returns field ready verdict when package is ready and view is covered', () => {
      const result = buildFieldReadinessChecklist(createInput())

      expect(result.verdict).toBe('ready')
      expect(result.tone).toBe('success')
      expect(result.summaryLabel).toBe('Field ready')
      expect(result.items).toHaveLength(4)
      expect(result.items.every((item) => item.passed)).toBe(true)
    })

    it('includes last verified timestamp from ready package', () => {
      const result = buildFieldReadinessChecklist(createInput())

      expect(result.lastVerifiedAt).toBe('2026-06-01T14:00:00.000Z')
    })
  })

  describe('package not ready', () => {
    it('returns not field ready when no packages are registered', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({ packages: [] }),
        }),
      )

      expect(result.verdict).toBe('not_ready')
      expect(result.tone).toBe('danger')
      expect(result.summaryLabel).toBe('Not field ready')
    })

    it('returns not field ready when package is missing', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            packages: [createReadyPackage({ status: 'missing' })],
          }),
        }),
      )

      expect(result.verdict).toBe('not_ready')
      expect(result.tone).toBe('danger')
      const packageItem = result.items.find((i) => i.id === 'package_ready')
      expect(packageItem?.passed).toBe(false)
      expect(packageItem?.detail).toContain('missing')
    })

    it('returns not field ready when package is invalid/unreadable', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            packages: [createReadyPackage({ status: 'invalid' })],
          }),
        }),
      )

      expect(result.verdict).toBe('not_ready')
      expect(result.tone).toBe('danger')
      const packageItem = result.items.find((i) => i.id === 'package_ready')
      expect(packageItem?.detail).toContain('unreadable')
    })

    it('returns not field ready when active map is a public fallback', () => {
      const result = buildFieldReadinessChecklist(
        createInput({ activeMapId: 'opentopomap' }),
      )

      expect(result.verdict).toBe('not_ready')
      expect(result.tone).toBe('danger')
      const packageItem = result.items.find((i) => i.id === 'package_ready')
      expect(packageItem?.passed).toBe(false)
      expect(packageItem?.detail).toContain('public fallback')
    })
  })

  describe('view coverage', () => {
    it('passes when view is inside package bounds', () => {
      const result = buildFieldReadinessChecklist(createInput())
      const coverageItem = result.items.find((i) => i.id === 'view_covered')

      expect(coverageItem?.passed).toBe(true)
      expect(coverageItem?.detail).toContain('inside')
    })

    it('fails when view extends beyond package bounds', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          viewBounds: { west: -11.5, south: 51.0, east: -9.0, north: 53.0 },
        }),
      )
      const coverageItem = result.items.find((i) => i.id === 'view_covered')

      expect(coverageItem?.passed).toBe(false)
      expect(coverageItem?.detail).toContain('beyond')
    })

    it('fails when view bounds are not available', () => {
      const result = buildFieldReadinessChecklist(
        createInput({ viewBounds: null }),
      )
      const coverageItem = result.items.find((i) => i.id === 'view_covered')

      expect(coverageItem?.passed).toBe(false)
      expect(coverageItem?.detail).toContain('not available')
    })

    it('fails when no ready package has bounds', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            packages: [createReadyPackage({ bounds: null })],
          }),
        }),
      )
      const coverageItem = result.items.find((i) => i.id === 'view_covered')

      expect(coverageItem?.passed).toBe(false)
    })
  })

  describe('source fallback', () => {
    it('passes with ready package and online source configured', () => {
      const result = buildFieldReadinessChecklist(createInput())
      const fallbackItem = result.items.find((i) => i.id === 'source_fallback')

      expect(fallbackItem?.passed).toBe(true)
      expect(fallbackItem?.detail).toContain('Online MapGenie source')
    })

    it('passes with ready package even without online source', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            status: 'not_configured',
            availableSources: [],
          }),
        }),
      )
      const fallbackItem = result.items.find((i) => i.id === 'source_fallback')

      expect(fallbackItem?.passed).toBe(true)
      expect(fallbackItem?.detail).toContain('not required')
    })

    it('fails with online source but no ready package', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({ packages: [] }),
        }),
      )
      const fallbackItem = result.items.find((i) => i.id === 'source_fallback')

      expect(fallbackItem?.passed).toBe(false)
      expect(fallbackItem?.detail).toContain('Network-dependent')
    })

    it('fails with neither package nor online source', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            status: 'not_configured',
            availableSources: [],
            packages: [],
          }),
        }),
      )
      const fallbackItem = result.items.find((i) => i.id === 'source_fallback')

      expect(fallbackItem?.passed).toBe(false)
      expect(fallbackItem?.detail).toContain('No offline package or online source')
    })
  })

  describe('last verified', () => {
    it('passes when package has a verified timestamp', () => {
      const result = buildFieldReadinessChecklist(createInput())
      const verifiedItem = result.items.find((i) => i.id === 'last_verified')

      expect(verifiedItem?.passed).toBe(true)
      expect(verifiedItem?.detail).toContain('Last verified')
    })

    it('fails when package has no verified timestamp', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({
            packages: [createReadyPackage({ verifiedAt: '' })],
          }),
        }),
      )
      const verifiedItem = result.items.find((i) => i.id === 'last_verified')

      expect(verifiedItem?.passed).toBe(false)
      expect(verifiedItem?.detail).toContain('not been verified')
    })

    it('fails when no ready package exists', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({ packages: [] }),
        }),
      )
      const verifiedItem = result.items.find((i) => i.id === 'last_verified')

      expect(verifiedItem?.passed).toBe(false)
    })
  })

  describe('overall verdict logic', () => {
    it('returns partially ready when package is ready but view is outside bounds', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          viewBounds: { west: -11.5, south: 51.0, east: -9.0, north: 53.0 },
        }),
      )

      expect(result.verdict).toBe('not_ready')
      expect(result.tone).toBe('warning')
      expect(result.summaryLabel).toBe('Partially ready')
    })

    it('returns danger tone when package itself is not ready', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({ packages: [] }),
        }),
      )

      expect(result.tone).toBe('danger')
    })

    it('returns null lastVerifiedAt when no ready package', () => {
      const result = buildFieldReadinessChecklist(
        createInput({
          officialMaps: createOfficialMaps({ packages: [] }),
        }),
      )

      expect(result.lastVerifiedAt).toBeNull()
    })
  })
})
