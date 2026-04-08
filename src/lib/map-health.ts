export type MapHealthStatus = 'loading' | 'ready' | 'degraded'

export type MapHealth = {
  readonly status: MapHealthStatus
  readonly message: string
}

export function createLoadingMapHealth(basemapLabel: string): MapHealth {
  return {
    status: 'loading',
    message: `Loading ${basemapLabel} basemap`,
  }
}

export function createReadyMapHealth(basemapLabel: string): MapHealth {
  return {
    status: 'ready',
    message: `${basemapLabel} basemap ready`,
  }
}

export function createDegradedMapHealth(
  basemapLabel: string,
  detail = 'Some tiles failed to load',
): MapHealth {
  return {
    status: 'degraded',
    message: `${basemapLabel} degraded: ${detail}`,
  }
}
