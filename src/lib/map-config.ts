export type BasemapId =
  | 'opentopomap'
  | 'esri_topo'
  | 'openstreetmap'
  | 'esri_satellite'

export type Basemap = {
  readonly id: BasemapId
  readonly label: string
  readonly attribution: string
  readonly tiles: readonly [string]
  readonly tileSize: 256
  readonly maxZoom: number
}

export const DEFAULT_BASEMAP_ID: BasemapId = 'opentopomap'
export const MAP_CENTER: readonly [number, number] = [-9.7, 51.97]
export const MAP_DEFAULT_ZOOM = 12

export const BASEMAPS: readonly Basemap[] = [
  {
    id: 'opentopomap',
    label: 'OpenTopoMap',
    attribution: '© OpenTopoMap contributors',
    tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxZoom: 17,
  },
  {
    id: 'esri_topo',
    label: 'ESRI World Topo',
    attribution: '© Esri',
    tiles: [
      'https://services.arcgisonline.com/arcgis/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxZoom: 19,
  },
  {
    id: 'openstreetmap',
    label: 'OpenStreetMap',
    attribution: '© OpenStreetMap contributors',
    tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxZoom: 19,
  },
  {
    id: 'esri_satellite',
    label: 'ESRI Satellite',
    attribution: '© Esri',
    tiles: [
      'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    ],
    tileSize: 256,
    maxZoom: 19,
  },
] as const

/**
 * Resolves a basemap identifier to its locked configuration.
 */
export function getBasemapById(id: BasemapId): Basemap {
  const basemap = BASEMAPS.find((candidate) => candidate.id === id)

  if (!basemap) {
    throw new RangeError(`Unknown basemap id: ${id}`)
  }

  return basemap
}

/**
 * Expands a tile URL template with z/x/y coordinates.
 */
export function buildTileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
}
