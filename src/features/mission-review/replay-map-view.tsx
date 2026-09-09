import { useEffect, useRef, useState } from 'react'
import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import type { ReplayMapState } from './load-replay-map'
import { createRasterStyle } from '../map/map-style'
import { readStoredBasemap } from '../../lib/map-preferences'
import { ensureMarkerImages } from '../markers/sync-marker-overlay'

/** Owns an isolated read-only map; never changes operational map or mission stores. */
export function ReplayMapView({ evidence }: { readonly evidence: ReplayMapState }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [hidden, setHidden] = useState<readonly string[]>([])
  useEffect(() => {
    if (container.current === null) return
    const map = new maplibregl.Map({ container: container.current, style: createRasterStyle(readStoredBasemap()), center: [-9.7, 52], zoom: 10, attributionControl: {} })
    const abort = new AbortController()
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl())
    map.on('error', () => setError('Some map content could not be rendered. Check the basemap and retry the selected time.'))
    map.on('style.load', () => {
      map.addSource('review-evidence', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({ id: 'review-fill', type: 'fill', source: 'review-evidence', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': ['coalesce', ['get', 'fillColor'], '#fbbf24'], 'fill-opacity': 0.2 } })
      map.addLayer({ id: 'review-lines', type: 'line', source: 'review-evidence', filter: ['!=', '$type', 'Point'], paint: { 'line-color': ['coalesce', ['get', 'strokeColor'], '#fbbf24'], 'line-width': ['coalesce', ['get', 'width'], 3] } })
      map.addLayer({ id: 'review-points', type: 'circle', source: 'review-evidence', filter: ['==', '$type', 'Point'], paint: {
        'circle-radius': ['match', ['get', 'category'], 'current', 7, 'objects', 6, 3],
        'circle-color': ['match', ['get', 'category'], 'current', '#38bdf8', 'gpx', '#c084fc', 'objects', '#fbbf24', '#fb923c'],
        'circle-stroke-width': 1, 'circle-stroke-color': '#0c0a09',
      } })
      map.addLayer({ id: 'review-labels', type: 'symbol', source: 'review-evidence',
        layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-allow-overlap': true },
        paint: { 'text-color': '#111827', 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
      })
      void ensureMarkerImages(map, abort.signal).then(() => {
        if (abort.signal.aborted) return
        map.addLayer({ id: 'review-marker-icons', type: 'symbol', source: 'review-evidence', filter: ['has', 'iconId'],
          layout: { 'icon-image': ['get', 'iconId'], 'icon-allow-overlap': true, 'icon-ignore-placement': true } })
        setReady(true)
      }).catch(() => { if (!abort.signal.aborted) { setError('Marker symbols could not be loaded. Re-seek the selected time.'); setReady(true) } })
      map.on('click', (event) => {
        const hits = map.queryRenderedFeatures(event.point, { layers: ['review-points', 'review-fill', 'review-lines'] })
        const feature = hits[0]
        if (!feature) return
        new maplibregl.Popup({ className: 'text-stone-900' }).setLngLat(event.lngLat).setText(`${feature.properties?.label ?? feature.properties?.objectName ?? 'Evidence'} ${feature.properties?.time ?? ''}`).addTo(map)
      })
    })
    return () => { abort.abort(); mapRef.current = null; map.remove() }
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const url = evidence.data ? URL.createObjectURL(evidence.data.blob) : null
    ;(map.getSource('review-evidence') as GeoJSONSource).setData(url ?? { type: 'FeatureCollection', features: [] })
    const bounds = evidence.data?.bounds
    if (bounds) map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 40, maxZoom: 15, duration: 0 })
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [ready, evidence.data])
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    for (const id of ['review-fill', 'review-lines', 'review-points']) {
      const geometryFilter: maplibregl.ExpressionSpecification = id === 'review-fill' ? ['==', ['geometry-type'], 'Polygon'] : id === 'review-lines' ? ['!=', ['geometry-type'], 'Point'] : ['==', ['geometry-type'], 'Point']
      map.setFilter(id, ['all', geometryFilter, ['!', ['in', ['get', 'category'], ['literal', hidden]]]])
    }
    map.setFilter('review-points', ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'featureKind'], 'label'], ['!', ['in', ['get', 'category'], ['literal', hidden]]]])
    map.setFilter('review-labels', ['all', ['==', ['geometry-type'], 'Point'], ['any', ['==', ['get', 'featureKind'], 'label'], ['has', 'iconId'], ['==', ['get', 'category'], 'current']], ['!', ['in', ['get', 'category'], ['literal', hidden]]]])
    if (map.getLayer('review-marker-icons')) map.setFilter('review-marker-icons', ['all', ['has', 'iconId'], ['!', ['in', ['get', 'category'], ['literal', hidden]]]])
  }, [ready, hidden])
  return <section className="space-y-3" data-testid="mission-replay-map">
    <p role={evidence.status === 'error' ? 'alert' : 'status'}>{evidence.message}</p>
    {evidence.status === 'loading' && <p>{evidence.loaded.toLocaleString()} / {evidence.total.toLocaleString()} records loaded; map reconstruction is not complete.</p>}
    {evidence.data !== null && <p>{evidence.loaded.toLocaleString()} / {evidence.total.toLocaleString()} selected-time records read.</p>}
    <div className="flex flex-wrap gap-4">
      {(['breadcrumbs', 'current', 'gpx', 'objects'] as const).map((category) => <label key={category} className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!hidden.includes(category)} onChange={(event) => setHidden(event.target.checked ? hidden.filter((value) => value !== category) : [...hidden, category])} />
        {category === 'current' ? 'Current at selected time' : category === 'gpx' ? 'Dated GPX' : category === 'objects' ? 'Markers and drawings' : 'Breadcrumbs'}
      </label>)}
    </div>
    {error && <p role="alert" className="text-amber-200">{error}</p>}
    <div ref={container} className="h-[28rem] w-full rounded-xl border border-stone-600" aria-label="Read-only selected mission evidence map" />
    <p className="text-xs text-stone-300">Historical evidence only. Blue positions are last known at the selected time, not live locations. Purple dots have source GPX timestamps; undated GPX is static outing evidence outside precise replay. Click a point to inspect its identity and time.</p>
  </section>
}
