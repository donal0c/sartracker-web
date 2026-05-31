export type MapRendererMode = 'maplibre' | 'leaflet'

const MAP_RENDERER_QUERY_PARAM = 'mapRenderer'

/**
 * Resolves the requested map renderer from an explicit URL feature flag.
 */
export function resolveMapRendererMode(search: string): MapRendererMode {
  const params = new URLSearchParams(search)
  return params.get(MAP_RENDERER_QUERY_PARAM) === 'leaflet' ? 'leaflet' : 'maplibre'
}

/**
 * Returns the active renderer mode for the current browser location.
 */
export function getMapRendererMode(): MapRendererMode {
  if (typeof window === 'undefined') {
    return 'maplibre'
  }

  return resolveMapRendererMode(window.location.search)
}
