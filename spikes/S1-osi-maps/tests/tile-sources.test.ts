import { describe, it, expect } from 'vitest';
import {
  TILE_SOURCES,
  BASEMAP_IDS,
  DEFAULT_BASEMAP,
  buildTileUrl,
  tileCacheKey,
} from '../src/tile-sources';

describe('TILE_SOURCES', () => {
  it('contains all four expected basemaps', () => {
    expect(BASEMAP_IDS).toEqual(['opentopomap', 'esri_topo', 'openstreetmap', 'esri_satellite']);
  });

  it('defaults to opentopomap', () => {
    expect(DEFAULT_BASEMAP).toBe('opentopomap');
  });

  it('all sources have required fields', () => {
    for (const id of BASEMAP_IDS) {
      const source = TILE_SOURCES[id];
      expect(source.id).toBe(id);
      expect(source.name).toBeTruthy();
      expect(source.tiles.length).toBeGreaterThan(0);
      expect(source.tileSize).toBe(256);
      expect(source.maxzoom).toBeGreaterThanOrEqual(17);
    }
  });
});

describe('buildTileUrl', () => {
  it('constructs OpenTopoMap URL correctly', () => {
    const url = buildTileUrl('https://tile.opentopomap.org/{z}/{x}/{y}.png', 12, 2045, 1356);
    expect(url).toBe('https://tile.opentopomap.org/12/2045/1356.png');
  });

  it('constructs ESRI URL with {z}/{y}/{x} order correctly', () => {
    const template =
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}';
    const url = buildTileUrl(template, 14, 8010, 5432);
    expect(url).toBe(
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/14/5432/8010'
    );
  });

  it('constructs OSM URL correctly', () => {
    const url = buildTileUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 10, 500, 340);
    expect(url).toBe('https://tile.openstreetmap.org/10/500/340.png');
  });
});

describe('tileCacheKey', () => {
  it('generates deterministic keys', () => {
    const key1 = tileCacheKey('opentopomap', 12, 2045, 1356);
    const key2 = tileCacheKey('opentopomap', 12, 2045, 1356);
    expect(key1).toBe(key2);
    expect(key1).toBe('tile:opentopomap:12:2045:1356');
  });

  it('generates different keys for different tiles', () => {
    const key1 = tileCacheKey('opentopomap', 12, 2045, 1356);
    const key2 = tileCacheKey('opentopomap', 12, 2046, 1356);
    expect(key1).not.toBe(key2);
  });

  it('generates different keys for different sources', () => {
    const key1 = tileCacheKey('opentopomap', 12, 2045, 1356);
    const key2 = tileCacheKey('esri_topo', 12, 2045, 1356);
    expect(key1).not.toBe(key2);
  });
});
