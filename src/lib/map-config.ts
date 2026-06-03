export type BasemapId =
  | 'opentopomap'
  | 'esri_topo'
  | 'openstreetmap'
  | 'esri_satellite'

export type OfficialMapId =
  | 'official_discovery_topo'
  | 'official_premium_basemap'
  | 'official_aerial_imagery'
  | 'official_high_resolution_imagery'

export type MapCatalogueItemId = BasemapId | OfficialMapId
export type MapCatalogueAvailability = 'available' | 'not_configured'
export type MapCatalogueGroupId = 'official' | 'public-fallback'

export type Basemap = {
  readonly id: BasemapId
  readonly label: string
  readonly attribution: string
  readonly tiles: readonly [string]
  readonly tileSize: 256
  readonly maxZoom: number
}

export type MapCatalogueItem = {
  readonly id: MapCatalogueItemId
  readonly label: string
  readonly description: string
  readonly availability: MapCatalogueAvailability
  readonly basemapId?: BasemapId
}

export type MapCatalogueGroup = {
  readonly id: MapCatalogueGroupId
  readonly label: string
  readonly items: readonly MapCatalogueItem[]
}

export const DEFAULT_BASEMAP_ID: BasemapId = 'opentopomap'
export const DEFAULT_OFFICIAL_BASEMAP_ID: OfficialMapId = 'official_discovery_topo'
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

export const MAP_CATALOGUE_GROUPS: readonly MapCatalogueGroup[] = [
  {
    id: 'official',
    label: 'Official maps',
    items: [
      {
        id: 'official_discovery_topo',
        label: 'Discovery Topo',
        description: 'Default official operational map when licensed maps are configured.',
        availability: 'not_configured',
      },
      {
        id: 'official_premium_basemap',
        label: 'Premium Basemap',
        description: 'Clean official reference basemap.',
        availability: 'not_configured',
      },
      {
        id: 'official_aerial_imagery',
        label: 'Aerial Imagery',
        description: 'Official imagery reference layer.',
        availability: 'not_configured',
      },
      {
        id: 'official_high_resolution_imagery',
        label: 'High-Resolution Imagery',
        description: 'High-resolution imagery reference layer.',
        availability: 'not_configured',
      },
    ],
  },
  {
    id: 'public-fallback',
    label: 'Public fallback maps',
    items: BASEMAPS.map((basemap) => ({
      id: basemap.id,
      label: basemap.label,
      description: 'Public fallback map source.',
      availability: 'available' as const,
      basemapId: basemap.id,
    })),
  },
] as const

/**
 * Resolves the safe default map id for the configured catalogue state.
 */
export function getDefaultBasemapIdForCatalogue(
  availability: 'official' | 'public-fallback',
): BasemapId | OfficialMapId {
  if (availability === 'official') {
    return DEFAULT_OFFICIAL_BASEMAP_ID
  }

  return DEFAULT_BASEMAP_ID
}

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
