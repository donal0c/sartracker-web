/** Mission status enum */
export type MissionStatus = 'active' | 'paused' | 'finished';

/** Marker types matching SAR operations */
export type MarkerType = 'ipp_lkp' | 'clue' | 'hazard' | 'casualty';

/** Drawing types matching SAR operations */
export type DrawingType = 'line' | 'search_area' | 'range_ring' | 'bearing_line' | 'sector';

export interface Mission {
  id: string;
  name: string;
  status: MissionStatus;
  start_time: string;
  pause_time: string | null;
  finish_time: string | null;
  notes: string | null;
  schema_version: number;
}

export interface Device {
  id: string;
  mission_id: string;
  device_id: string;
  name: string;
  color: string;
  last_seen: string;
}

export interface Position {
  id: string;
  mission_id: string;
  device_id: string;
  lat: number;
  lon: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  bearing: number | null;
  battery: number | null;
  timestamp: string;
}

export interface PositionInput {
  lat: number;
  lon: number;
  altitude?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  bearing?: number | null;
  battery?: number | null;
  timestamp?: string;
}

export interface Marker {
  id: string;
  mission_id: string;
  type: MarkerType;
  name: string;
  lat: number;
  lon: number;
  description: string | null;
  subject_category: string | null;
  confidence: number | null;
  found_by: string | null;
  grid_reference: string | null;
  created_at: string;
}

export interface MarkerInput {
  type: MarkerType;
  name: string;
  lat: number;
  lon: number;
  description?: string | null;
  subject_category?: string | null;
  confidence?: number | null;
  found_by?: string | null;
  grid_reference?: string | null;
}

export interface MarkerUpdate {
  type?: MarkerType;
  name?: string;
  lat?: number;
  lon?: number;
  description?: string | null;
  subject_category?: string | null;
  confidence?: number | null;
  found_by?: string | null;
  grid_reference?: string | null;
}

export interface Drawing {
  id: string;
  mission_id: string;
  type: DrawingType;
  name: string;
  geojson: string;
  metadata_json: string | null;
  created_at: string;
}

export interface DrawingInput {
  type: DrawingType;
  name: string;
  geojson: string;
  metadata_json?: string | null;
}

export interface DrawingUpdate {
  type?: DrawingType;
  name?: string;
  geojson?: string;
  metadata_json?: string | null;
}

export interface MissionEvent {
  id: string;
  mission_id: string;
  event_type: string;
  timestamp: string;
  details_json: string | null;
}
