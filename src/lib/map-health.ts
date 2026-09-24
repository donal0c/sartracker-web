export type MapHealthStatus = 'loading' | 'ready' | 'degraded'

export type MapOverlayFamily =
  | 'tracking'
  | 'coverage'
  | 'markers'
  | 'drawings'
  | 'gpx'
  | 'measurements'
  | 'helicopter'
  | 'coordinate-target'

export type MapOverlaySyncRegistrationId =
  | 'tracking'
  | 'coverage'
  | 'markers'
  | 'drawings'
  | 'drawing-preview'
  | 'gpx'
  | 'helicopters'
  | 'measurements'
  | 'measurement-preview'
  | 'coordinate-target'

export type MapOverlaySyncWarning = {
  readonly registrationId: MapOverlaySyncRegistrationId
  readonly family: MapOverlayFamily
  readonly message: string
}

export type MapHealth = {
  readonly status: MapHealthStatus
  readonly message: string
  /** Overlay warnings are independent of basemap tile health. */
  readonly overlayWarnings?: readonly MapOverlaySyncWarning[]
}

const MAP_OVERLAY_FAMILY_LABELS: Readonly<Record<MapOverlayFamily, string>> = {
  tracking: 'Team positions and breadcrumbs',
  coverage: 'Coverage',
  markers: 'Markers',
  drawings: 'Drawings',
  gpx: 'GPX',
  measurements: 'Measurements',
  helicopter: 'Helicopter',
  'coordinate-target': 'Coordinate target',
}

/** Creates a fixed, sanitized warning for one map overlay synchronization registration. */
export function createMapOverlaySyncWarning(
  registrationId: MapOverlaySyncRegistrationId,
  family: MapOverlayFamily,
): MapOverlaySyncWarning {
  const familyLabel = MAP_OVERLAY_FAMILY_LABELS[family]
  return {
    registrationId,
    family,
    message: `${familyLabel} overlay may be missing or stale. SAR Tracker is retrying. If it remains unavailable, verify against an independent operational source, open Diagnostics and export a report, and stop or revert if you are uncertain.`,
  }
}

/**
 * Creates the loading state shown while a basemap is being applied.
 */
export function createLoadingMapHealth(basemapLabel: string): MapHealth {
  return {
    status: 'loading',
    message: `Loading ${basemapLabel} basemap`,
  }
}

/**
 * Creates the ready state shown once the basemap has settled.
 */
export function createReadyMapHealth(basemapLabel: string): MapHealth {
  return {
    status: 'ready',
    message: `${basemapLabel} basemap ready`,
  }
}

/**
 * Creates the degraded state shown when map rendering or tile loading fails.
 */
export function createDegradedMapHealth(
  basemapLabel: string,
  detail = 'Some tiles failed to load',
): MapHealth {
  return {
    status: 'degraded',
    message: `${basemapLabel} degraded: ${detail}`,
  }
}
