/**
 * Tile source definitions for SAR Tracker basemaps.
 *
 * Each source defines a raster tile URL template, attribution, and display metadata.
 * URL templates use {z}/{x}/{y} placeholders (MapLibre standard).
 */

export interface TileSource {
  id: string;
  name: string;
  tiles: string[];
  attribution: string;
  tileSize: number;
  maxzoom: number;
}

export const TILE_SOURCES: Record<string, TileSource> = {
  opentopomap: {
    id: 'opentopomap',
    name: 'OpenTopoMap',
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> contributors',
    tileSize: 256,
    maxzoom: 17,
  },
  esri_topo: {
    id: 'esri_topo',
    name: 'ESRI World Topo',
    tiles: [
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri, HERE, Garmin, USGS',
    tileSize: 256,
    maxzoom: 19,
  },
  openstreetmap: {
    id: 'openstreetmap',
    name: 'OpenStreetMap',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    tileSize: 256,
    maxzoom: 19,
  },
  esri_satellite: {
    id: 'esri_satellite',
    name: 'ESRI Satellite',
    tiles: [
      'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    attribution: '© Esri, Maxar, Earthstar Geographics',
    tileSize: 256,
    maxzoom: 19,
  },
};

export const DEFAULT_BASEMAP = 'opentopomap';
export const BASEMAP_IDS = Object.keys(TILE_SOURCES);

/**
 * Build a concrete tile URL from a template and z/x/y values.
 */
export function buildTileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/**
 * Generate a deterministic cache key for a tile request.
 */
export function tileCacheKey(sourceId: string, z: number, x: number, y: number): string {
  return `tile:${sourceId}:${z}:${x}:${y}`;
}

// --- GeoPackage / MBTiles Pipeline (placeholder) ---
//
// When the KMRT_package.gpkg file is available:
//
// 1. Convert GPKG to MBTiles:
//    ogr2ogr -f MBTILES kmrt.mbtiles KMRT_package.gpkg -dsco FORMAT=JPEG
//    -- or use GDAL for raster tiles: --
//    gdal_translate -of MBTILES KMRT_package.gpkg kmrt.mbtiles
//    gdaladdo kmrt.mbtiles 2 4 8 16
//
// 2. Serve via Tauri filesystem API:
//    - Register a custom protocol handler in Tauri (e.g., `mbtiles://`)
//    - Read tile bytes from MBTiles SQLite: SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?
//    - Return as image/jpeg response
//
// 3. Add to MapLibre as raster source:
//    map.addSource('local-osi', {
//      type: 'raster',
//      tiles: ['mbtiles://kmrt/{z}/{x}/{y}'],
//      tileSize: 256,
//    });
//
// Note: KMRT_package.gpkg is 1.25GB, EPSG:2157 (ITM), raster tiles, 9 zoom levels.
// The GPKG uses ITM projection — MapLibre expects EPSG:3857 (Web Mercator).
// gdal_translate can reproject during conversion:
//    gdalwarp -t_srs EPSG:3857 KMRT_package.gpkg kmrt_3857.gpkg
//    gdal_translate -of MBTILES kmrt_3857.gpkg kmrt.mbtiles
