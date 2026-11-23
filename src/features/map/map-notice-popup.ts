import maplibregl from 'maplibre-gl'

/**
 * Opens a plain-text notice in a MapLibre popup (DON-344).
 *
 * MapLibre draws its popup white in both themes, so the words use the fixed
 * dark `.sar-map-popup` colour rather than a themed palette class, which the
 * light theme would turn pale and unreadable on white.
 */
export function openMapNotice(
  map: maplibregl.Map,
  lngLat: maplibregl.LngLatLike,
  text: string,
  options: { readonly closeOnClick?: boolean } = {},
): maplibregl.Popup {
  return new maplibregl.Popup({ className: 'sar-map-popup', closeOnClick: options.closeOnClick ?? true })
    .setLngLat(lngLat)
    .setText(text)
    .addTo(map)
}
