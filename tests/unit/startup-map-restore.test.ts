import { describe, expect, it } from 'vitest'

import { resolveStartupMapRestore } from '../../src/features/map/startup-map-restore'
import {
  DEFAULT_APP_SETTINGS,
  type OfficialMapPackageSettings,
  type OfficialMapSettings,
} from '../../src/features/settings/settings-types'

/** Builds one registered Discovery package in the given verified state. */
function discoveryPackage(status: OfficialMapPackageSettings['status']): OfficialMapPackageSettings {
  return {
    id: 'package-1',
    sourceType: 'mbtiles',
    mapId: 'official_discovery_topo',
    packagePath: '/maps/discovery.mbtiles',
    status,
    bounds: null,
    minZoom: 6,
    maxZoom: 16,
    tileCount: 100,
    tileFormat: 'png',
    createdAt: '2026-09-30T00:00:00.000Z',
    verifiedAt: status === 'ready' ? '2026-10-01T00:00:00.000Z' : '',
    message: '',
  }
}

/** Official-map settings holding the given packages. */
function officialMaps(packages: readonly OfficialMapPackageSettings[]): OfficialMapSettings {
  return { ...DEFAULT_APP_SETTINGS.officialMaps, packages }
}

describe('startup map restore [DON-304]', () => {
  it('restores Discovery when its package is verified ready', () => {
    expect(resolveStartupMapRestore({
      storedMapId: 'official_discovery_topo',
      officialMaps: officialMaps([discoveryPackage('ready')]),
    })).toEqual({ kind: 'restore', mapId: 'official_discovery_topo' })
  })

  it('falls back visibly, naming the map and the fallback, when the package is missing', () => {
    const result = resolveStartupMapRestore({
      storedMapId: 'official_discovery_topo',
      officialMaps: officialMaps([discoveryPackage('missing')]),
    })

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') return
    expect(result.message).toMatch(/Discovery Topo/u)
    expect(result.message).toMatch(/cannot be found/u)
    expect(result.message).toMatch(/showing OpenTopoMap/u)
  })

  it('falls back visibly when the package is unreadable or changed', () => {
    const result = resolveStartupMapRestore({
      storedMapId: 'official_discovery_topo',
      officialMaps: officialMaps([discoveryPackage('invalid')]),
    })

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') return
    expect(result.message).toMatch(/unreadable or changed/u)
  })

  it('falls back visibly when no package is registered, even with an online source configured', () => {
    // Field use is often off-network; only a verified local package is restored.
    const result = resolveStartupMapRestore({
      storedMapId: 'official_discovery_topo',
      officialMaps: {
        ...officialMaps([]),
        status: 'configured',
        availableSources: ['official_discovery_topo'],
      },
    })

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') return
    expect(result.message).toMatch(/no verified offline package/u)
  })

  it('leaves the startup map alone for a public or absent preference', () => {
    expect(resolveStartupMapRestore({
      storedMapId: 'openstreetmap',
      officialMaps: officialMaps([discoveryPackage('ready')]),
    })).toEqual({ kind: 'none' })
    expect(resolveStartupMapRestore({
      storedMapId: null,
      officialMaps: officialMaps([discoveryPackage('ready')]),
    })).toEqual({ kind: 'none' })
  })

  it('falls back visibly when settings could not be read', () => {
    const result = resolveStartupMapRestore({
      storedMapId: 'official_discovery_topo',
      officialMaps: null,
    })

    expect(result.kind).toBe('unavailable')
    if (result.kind !== 'unavailable') return
    expect(result.message).toMatch(/settings could not be read/u)
  })
})
