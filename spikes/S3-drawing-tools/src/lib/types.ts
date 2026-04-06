/** All drawing feature types in the SAR tracker */
export type FeatureType =
  | 'line'
  | 'search-area'
  | 'range-ring'
  | 'bearing-line'
  | 'search-sector'
  | 'measurement'
  | 'marker';

/** Marker subtypes */
export type MarkerType = 'ipp' | 'clue' | 'hazard' | 'casualty';

/** Search area status */
export type SearchAreaStatus = 'Planned' | 'Assigned' | 'InProgress' | 'Completed' | 'Cleared';

/** Active tool in the toolbar */
export type ActiveTool =
  | 'select'
  | 'line'
  | 'polygon'
  | 'range-ring'
  | 'bearing-line'
  | 'sector'
  | 'measure'
  | 'marker'
  | null;

/** Base properties for all drawn features */
export interface BaseFeature {
  id: string;
  type: FeatureType;
  name: string;
  notes?: string;
  createdAt: number;
}

export interface LineFeature extends BaseFeature {
  type: 'line';
  distanceM: number;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
}

export interface SearchAreaFeature extends BaseFeature {
  type: 'search-area';
  team?: string;
  status: SearchAreaStatus;
  priority: number;
  poaPercent?: number;
  terrainType?: string;
  areaSqM: number;
  geojson: GeoJSON.Feature<GeoJSON.Polygon>;
}

export interface RangeRingFeature extends BaseFeature {
  type: 'range-ring';
  centerLon: number;
  centerLat: number;
  radii: number[]; // metres
  labels: string[];
  colors: string[];
  lpbCategory?: string;
  geojson: GeoJSON.Feature<GeoJSON.Polygon>[];
}

export interface BearingLineFeature extends BaseFeature {
  type: 'bearing-line';
  originLon: number;
  originLat: number;
  trueBearing: number;
  distanceM: number;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
}

export interface SearchSectorFeature extends BaseFeature {
  type: 'search-sector';
  centerLon: number;
  centerLat: number;
  startBearing: number;
  endBearing: number;
  radiusM: number;
  geojson: GeoJSON.Feature<GeoJSON.Polygon>;
}

export interface MeasurementFeature extends BaseFeature {
  type: 'measurement';
  distanceM: number;
  bearing: number;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
}

export interface MarkerFeature extends BaseFeature {
  type: 'marker';
  markerType: MarkerType;
  lon: number;
  lat: number;
  geojson: GeoJSON.Feature<GeoJSON.Point>;
}

export type DrawingFeature =
  | LineFeature
  | SearchAreaFeature
  | RangeRingFeature
  | BearingLineFeature
  | SearchSectorFeature
  | MeasurementFeature
  | MarkerFeature;
