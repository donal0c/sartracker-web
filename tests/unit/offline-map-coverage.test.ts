import { describe, expect, it } from 'vitest'

import {
  buildOfflineCoverageTileUrls,
  createErroredOfflineMapCoverage,
  createUnavailableOfflineMapCoverage,
  createUncheckedOfflineMapCoverage,
  describeOfflineMapCoverage,
  getTileCoordinatesForBounds,
  latitudeToTileY,
  longitudeToTileX,
} from '../../src/features/map/offline-map-coverage'

describe('offline map coverage', () => {
  it('starts unchecked with operator preflight guidance', () => {
    expect(createUncheckedOfflineMapCoverage()).toEqual({
      cachedTiles: null,
      detail: 'Check the current map view before relying on offline tiles.',
      label: 'Current view not checked',
      status: 'unchecked',
      tone: 'neutral',
      totalTiles: null,
      zoom: null,
    })
  })

  it('describes complete current-view coverage', () => {
    expect(
      describeOfflineMapCoverage({
        basemapLabel: 'OpenTopoMap',
        cachedTiles: 4,
        totalTiles: 4,
        zoom: 12,
      }),
    ).toEqual({
      cachedTiles: 4,
      detail: '4/4 OpenTopoMap tiles cached for z12.',
      label: 'Current view cached',
      status: 'complete',
      tone: 'success',
      totalTiles: 4,
      zoom: 12,
    })
  })

  it('describes missing current-view coverage as dangerous', () => {
    expect(
      describeOfflineMapCoverage({
        basemapLabel: 'OpenTopoMap',
        cachedTiles: 0,
        totalTiles: 4,
        zoom: 12,
      }),
    ).toEqual({
      cachedTiles: 0,
      detail: '0/4 OpenTopoMap tiles cached for z12.',
      label: 'Current view not cached',
      status: 'missing',
      tone: 'danger',
      totalTiles: 4,
      zoom: 12,
    })
  })

  it('describes partial current-view coverage as a warning', () => {
    expect(
      describeOfflineMapCoverage({
        basemapLabel: 'OpenTopoMap',
        cachedTiles: 2,
        totalTiles: 4,
        zoom: 12,
      }),
    ).toEqual({
      cachedTiles: 2,
      detail: '2/4 OpenTopoMap tiles cached for z12.',
      label: 'Current view partially cached',
      status: 'partial',
      tone: 'warning',
      totalTiles: 4,
      zoom: 12,
    })
  })

  it('describes unavailable and errored coverage checks explicitly', () => {
    expect(createUnavailableOfflineMapCoverage('Cache inspection is disabled.')).toEqual({
      cachedTiles: null,
      detail: 'Cache inspection is disabled.',
      label: 'Coverage check unavailable',
      status: 'unavailable',
      tone: 'danger',
      totalTiles: null,
      zoom: null,
    })
    expect(createErroredOfflineMapCoverage()).toEqual({
      cachedTiles: null,
      detail: 'Tile cache coverage could not be checked. Keep network available.',
      label: 'Coverage check failed',
      status: 'error',
      tone: 'danger',
      totalTiles: null,
      zoom: null,
    })
  })

  it('converts coordinates into Web Mercator tile indexes', () => {
    expect(longitudeToTileX(-9.7, 12)).toBe(1937)
    expect(latitudeToTileY(51.97, 12)).toBe(1353)
  })

  it('clamps invalid coordinate inputs before converting to tile indexes', () => {
    expect(longitudeToTileX(Number.POSITIVE_INFINITY, 12)).toBe(2048)
    expect(longitudeToTileX(Number.NaN, 12)).toBe(2048)
    expect(latitudeToTileY(Number.POSITIVE_INFINITY, 12)).toBe(2048)
    expect(latitudeToTileY(Number.NaN, 12)).toBe(2048)
  })

  it('builds every tile coordinate intersecting a normal viewport bounds', () => {
    expect(
      getTileCoordinatesForBounds(
        {
          east: -9.65,
          north: 52,
          south: 51.95,
          west: -9.75,
        },
        12,
      ),
    ).toEqual([
      { x: 1937, y: 1352, z: 12 },
      { x: 1937, y: 1353, z: 12 },
      { x: 1938, y: 1352, z: 12 },
      { x: 1938, y: 1353, z: 12 },
    ])
  })

  it('builds basemap-specific tile URLs for the current coverage bounds', () => {
    expect(
      buildOfflineCoverageTileUrls(
        'esri_topo',
        {
          east: -9.65,
          north: 52,
          south: 51.95,
          west: -9.75,
        },
        12,
      ),
    ).toEqual([
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/1352/1937',
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/1353/1937',
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/1352/1938',
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/12/1353/1938',
    ])
  })
})
