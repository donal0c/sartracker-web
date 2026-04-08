export type MapHealthStatus = 'loading' | 'ready' | 'degraded'

export type MapHealth = {
  readonly status: MapHealthStatus
  readonly message: string
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
