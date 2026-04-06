import { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useApp } from '../lib/store';
import { geodesicDistance, geodesicBearing as computeBearing } from '../lib/geodesic';
import { generateId } from '../lib/id';
import type { LineFeature, MeasurementFeature, DrawingFeature } from '../lib/types';

// Kerry, Ireland
const DEFAULT_CENTER: [number, number] = [-9.70, 51.97];
const DEFAULT_ZOOM = 11;

export function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const { state, dispatch } = useApp();

  // Drawing state refs (not React state — these change on every mouse click)
  const linePoints = useRef<Array<[number, number]>>([]);
  const polygonPoints = useRef<Array<[number, number]>>([]);
  const measureStart = useRef<[number, number] | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');

    // Emit mouse position for coordinate bar
    map.on('mousemove', (e) => {
      window.dispatchEvent(new CustomEvent('map-mousemove', {
        detail: { lat: e.lngLat.lat, lon: e.lngLat.lng },
      }));
    });

    map.on('load', () => {
      // Drawing preview source (for in-progress line/polygon)
      map.addSource('drawing-preview', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'drawing-preview-line',
        type: 'line',
        source: 'drawing-preview',
        paint: { 'line-color': '#3b82f6', 'line-width': 2, 'line-dasharray': [4, 2] },
        filter: ['==', '$type', 'LineString'],
      });
      map.addLayer({
        id: 'drawing-preview-fill',
        type: 'fill',
        source: 'drawing-preview',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 },
        filter: ['==', '$type', 'Polygon'],
      });
      map.addLayer({
        id: 'drawing-preview-outline',
        type: 'line',
        source: 'drawing-preview',
        paint: { 'line-color': '#3b82f6', 'line-width': 2 },
        filter: ['==', '$type', 'Polygon'],
      });

      // Features source
      map.addSource('features', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Fill layer for polygons
      map.addLayer({
        id: 'features-fill',
        type: 'fill',
        source: 'features',
        paint: {
          'fill-color': ['coalesce', ['get', 'color'], '#3b82f6'],
          'fill-opacity': 0.25,
        },
        filter: ['==', '$type', 'Polygon'],
      });

      // Outline for polygons
      map.addLayer({
        id: 'features-outline',
        type: 'line',
        source: 'features',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#3b82f6'],
          'line-width': 2,
        },
        filter: ['==', '$type', 'Polygon'],
      });

      // Line layer
      map.addLayer({
        id: 'features-line',
        type: 'line',
        source: 'features',
        paint: {
          'line-color': ['coalesce', ['get', 'color'], '#ef4444'],
          'line-width': 2.5,
          'line-dasharray': ['case', ['==', ['get', 'dashed'], true], ['literal', [6, 3]], ['literal', [1, 0]]],
        },
        filter: ['==', '$type', 'LineString'],
      });

      // Point/marker layer
      map.addLayer({
        id: 'features-point',
        type: 'circle',
        source: 'features',
        paint: {
          'circle-radius': 8,
          'circle-color': ['coalesce', ['get', 'color'], '#3b82f6'],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
        filter: ['==', '$type', 'Point'],
      });

      // Labels
      map.addLayer({
        id: 'features-labels',
        type: 'symbol',
        source: 'features',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 12,
          'text-offset': [0, -1.5],
          'text-anchor': 'bottom',
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#1e293b',
          'text-halo-color': '#fff',
          'text-halo-width': 1.5,
        },
      });
    });

    mapRef.current = map;

    return () => { map.remove(); };
  }, []);

  // Sync features to map source whenever they change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const geojsonFeatures: GeoJSON.Feature[] = [];

    for (const feature of state.features) {
      if (feature.type === 'range-ring') {
        // Range rings have multiple GeoJSON features
        for (const gj of feature.geojson) {
          geojsonFeatures.push({
            ...gj,
            id: undefined,
            properties: {
              ...gj.properties,
              featureId: feature.id,
              featureType: feature.type,
            },
          });
        }
      } else {
        const gj = feature.geojson as GeoJSON.Feature;
        geojsonFeatures.push({
          ...gj,
          id: undefined,
          properties: {
            ...gj.properties,
            featureId: feature.id,
            featureType: feature.type,
            color: getFeatureColor(feature),
            dashed: feature.type === 'line' || feature.type === 'measurement',
            label: getFeatureLabel(feature),
          },
        });
      }
    }

    const src = map.getSource('features') as maplibregl.GeoJSONSource;
    if (src) {
      src.setData({ type: 'FeatureCollection', features: geojsonFeatures });
    }
  }, [state.features]);

  // Handle map click based on active tool
  const handleMapClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const map = mapRef.current;
    if (!map) return;

    switch (state.activeTool) {
      case 'select': {
        // Query features under click
        const features = map.queryRenderedFeatures(e.point, {
          layers: ['features-fill', 'features-line', 'features-point', 'features-outline'],
        });
        if (features.length > 0) {
          const fid = features[0].properties?.featureId;
          if (fid) dispatch({ type: 'SELECT_FEATURE', id: fid });
        } else {
          dispatch({ type: 'SELECT_FEATURE', id: null });
        }
        break;
      }

      case 'line': {
        linePoints.current.push(lngLat);
        updateLinePreview(map, linePoints.current);
        break;
      }

      case 'polygon': {
        polygonPoints.current.push(lngLat);
        updatePolygonPreview(map, polygonPoints.current);
        break;
      }

      case 'range-ring': {
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'range-ring', center: lngLat } });
        break;
      }

      case 'bearing-line': {
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'bearing-line', origin: lngLat } });
        break;
      }

      case 'sector': {
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'sector', center: lngLat, startBearing: 0, endBearing: 90, radiusM: 1000 } });
        break;
      }

      case 'measure': {
        if (!measureStart.current) {
          measureStart.current = lngLat;
          updateMeasurePreview(map, [lngLat]);
        } else {
          // Finish measurement
          const start = measureStart.current;
          const dist = geodesicDistance(start[0], start[1], lngLat[0], lngLat[1]);
          const bearing = computeBearing(start[0], start[1], lngLat[0], lngLat[1]);

          const feature: MeasurementFeature = {
            id: generateId('ms'),
            type: 'measurement',
            name: `${dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : dist.toFixed(0) + ' m'} @ ${bearing.toFixed(1)}°`,
            distanceM: dist,
            bearing,
            createdAt: Date.now(),
            geojson: {
              type: 'Feature',
              properties: { distance: dist, bearing, label: `${dist >= 1000 ? (dist / 1000).toFixed(2) + 'km' : dist.toFixed(0) + 'm'} ${bearing.toFixed(1)}°` },
              geometry: {
                type: 'LineString',
                coordinates: [start, lngLat],
              },
            },
          };

          dispatch({ type: 'ADD_FEATURE', feature });
          measureStart.current = null;
          clearPreview(map);
        }
        break;
      }

      case 'marker': {
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'marker', point: lngLat } });
        break;
      }
    }
  }, [state.activeTool, dispatch]);

  // Handle double-click to finish line/polygon
  const handleDblClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current;
    if (!map) return;

    if (state.activeTool === 'line' && linePoints.current.length >= 2) {
      e.preventDefault();
      const pts = [...linePoints.current];
      let totalDist = 0;
      for (let i = 1; i < pts.length; i++) {
        totalDist += geodesicDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      }

      const feature: LineFeature = {
        id: generateId('ln'),
        type: 'line',
        name: `Line ${totalDist >= 1000 ? (totalDist / 1000).toFixed(2) + 'km' : totalDist.toFixed(0) + 'm'}`,
        distanceM: totalDist,
        createdAt: Date.now(),
        geojson: {
          type: 'Feature',
          properties: { distance: totalDist, label: totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)}km` : `${totalDist.toFixed(0)}m` },
          geometry: { type: 'LineString', coordinates: pts },
        },
      };

      dispatch({ type: 'ADD_FEATURE', feature });
      linePoints.current = [];
      clearPreview(map);
    }

    if (state.activeTool === 'polygon' && polygonPoints.current.length >= 3) {
      e.preventDefault();
      const pts = [...polygonPoints.current];
      dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'search-area', vertices: pts } });
      polygonPoints.current = [];
      clearPreview(map);
    }
  }, [state.activeTool, dispatch]);

  // Attach/detach click handlers when tool changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Use BOTH MapLibre events (for real use) and native DOM events (for headless/testing)
    map.on('click', handleMapClick);
    map.on('dblclick', handleDblClick);

    // Native DOM fallback: fires when MapLibre's WebGL click doesn't
    const container = mapContainer.current;
    let clickHandledByMapLibre = false;

    const markHandled = () => { clickHandledByMapLibre = true; };
    map.on('click', markHandled);

    const nativeClickHandler = (e: MouseEvent) => {
      // Skip if MapLibre already handled this click
      if (clickHandledByMapLibre) {
        clickHandledByMapLibre = false;
        return;
      }
      // Convert pixel to lngLat
      const rect = container!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      try {
        const lngLat = map.unproject([x, y]);
        const syntheticEvent = {
          lngLat,
          point: { x, y },
          preventDefault: () => {},
        } as unknown as maplibregl.MapMouseEvent;
        handleMapClick(syntheticEvent);
      } catch {
        // map.unproject can fail if map isn't ready
      }
    };

    const nativeDblClickHandler = (e: MouseEvent) => {
      const rect = container!.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      try {
        const lngLat = map.unproject([x, y]);
        const syntheticEvent = {
          lngLat,
          point: { x, y },
          preventDefault: () => {},
        } as unknown as maplibregl.MapMouseEvent;
        handleDblClick(syntheticEvent);
      } catch {
        // ignore
      }
    };

    container?.addEventListener('click', nativeClickHandler);
    container?.addEventListener('dblclick', nativeDblClickHandler);

    // Set cursor based on tool
    const canvas = map.getCanvas();
    canvas.style.cursor = state.activeTool && state.activeTool !== 'select' ? 'crosshair' : '';

    // Clear in-progress drawing when tool changes
    linePoints.current = [];
    polygonPoints.current = [];
    measureStart.current = null;
    if (map.isStyleLoaded()) clearPreview(map);

    // Disable double-click zoom when drawing
    if (state.activeTool === 'line' || state.activeTool === 'polygon') {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }

    return () => {
      map.off('click', handleMapClick);
      map.off('click', markHandled);
      map.off('dblclick', handleDblClick);
      container?.removeEventListener('click', nativeClickHandler);
      container?.removeEventListener('dblclick', nativeDblClickHandler);
    };
  }, [state.activeTool, handleMapClick, handleDblClick]);

  // Transparent overlay captures clicks reliably in all environments
  // (WebGL-based MapLibre events don't fire in headless Chrome)
  const needsOverlay = state.activeTool !== null;

  const unprojectOrFallback = useCallback((e: React.MouseEvent<HTMLDivElement>): [number, number] => {
    const map = mapRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    try {
      const p = map!.unproject([x, y]);
      return [p.lng, p.lat];
    } catch {
      return map ? [map.getCenter().lng, map.getCenter().lat] : DEFAULT_CENTER;
    }
  }, []);

  const handleOverlayClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!map || !state.activeTool) return;
    const lngLat = unprojectOrFallback(e);

    switch (state.activeTool) {
      case 'select': {
        try {
          const rect = e.currentTarget.getBoundingClientRect();
          const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          const features = map.queryRenderedFeatures(pt as maplibregl.PointLike, {
            layers: ['features-fill', 'features-line', 'features-point', 'features-outline'],
          });
          if (features.length > 0) {
            const fid = features[0].properties?.featureId;
            if (fid) dispatch({ type: 'SELECT_FEATURE', id: fid });
          } else {
            dispatch({ type: 'SELECT_FEATURE', id: null });
          }
        } catch {
          dispatch({ type: 'SELECT_FEATURE', id: null });
        }
        break;
      }
      case 'line':
        linePoints.current.push(lngLat);
        if (map.isStyleLoaded()) updateLinePreview(map, linePoints.current);
        break;
      case 'polygon':
        polygonPoints.current.push(lngLat);
        if (map.isStyleLoaded()) updatePolygonPreview(map, polygonPoints.current);
        break;
      case 'range-ring':
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'range-ring', center: lngLat } });
        break;
      case 'bearing-line':
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'bearing-line', origin: lngLat } });
        break;
      case 'sector':
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'sector', center: lngLat, startBearing: 0, endBearing: 90, radiusM: 1000 } });
        break;
      case 'measure':
        if (!measureStart.current) {
          measureStart.current = lngLat;
        } else {
          const start = measureStart.current;
          const dist = geodesicDistance(start[0], start[1], lngLat[0], lngLat[1]);
          const bearing = computeBearing(start[0], start[1], lngLat[0], lngLat[1]);
          const feature: MeasurementFeature = {
            id: generateId('ms'),
            type: 'measurement',
            name: `${dist >= 1000 ? (dist / 1000).toFixed(2) + ' km' : dist.toFixed(0) + ' m'} @ ${bearing.toFixed(1)}°`,
            distanceM: dist,
            bearing,
            createdAt: Date.now(),
            geojson: {
              type: 'Feature',
              properties: { distance: dist, bearing, label: `${dist >= 1000 ? (dist / 1000).toFixed(2) + 'km' : dist.toFixed(0) + 'm'} ${bearing.toFixed(1)}°` },
              geometry: { type: 'LineString', coordinates: [start, lngLat] },
            },
          };
          dispatch({ type: 'ADD_FEATURE', feature });
          measureStart.current = null;
          if (map.isStyleLoaded()) clearPreview(map);
        }
        break;
      case 'marker':
        dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'marker', point: lngLat } });
        break;
    }
  }, [state.activeTool, dispatch, unprojectOrFallback]);

  const handleOverlayDblClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const map = mapRef.current;
    if (!map) return;

    if (state.activeTool === 'line' && linePoints.current.length >= 2) {
      e.preventDefault();
      const pts = [...linePoints.current];
      let totalDist = 0;
      for (let i = 1; i < pts.length; i++) {
        totalDist += geodesicDistance(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
      }
      const feature: LineFeature = {
        id: generateId('ln'),
        type: 'line',
        name: `Line ${totalDist >= 1000 ? (totalDist / 1000).toFixed(2) + 'km' : totalDist.toFixed(0) + 'm'}`,
        distanceM: totalDist,
        createdAt: Date.now(),
        geojson: {
          type: 'Feature',
          properties: { distance: totalDist, label: totalDist >= 1000 ? `${(totalDist / 1000).toFixed(2)}km` : `${totalDist.toFixed(0)}m` },
          geometry: { type: 'LineString', coordinates: pts },
        },
      };
      dispatch({ type: 'ADD_FEATURE', feature });
      linePoints.current = [];
      if (map.isStyleLoaded()) clearPreview(map);
    }

    if (state.activeTool === 'polygon' && polygonPoints.current.length >= 3) {
      e.preventDefault();
      const pts = [...polygonPoints.current];
      dispatch({ type: 'SET_PENDING_DIALOG', dialog: { kind: 'search-area', vertices: pts } });
      polygonPoints.current = [];
      if (map.isStyleLoaded()) clearPreview(map);
    }
  }, [state.activeTool, dispatch]);

  return (
    <div ref={mapContainer} className="map-container" data-testid="map">
      {needsOverlay && (
        <div
          className="map-click-overlay"
          data-testid="map-click-overlay"
          onClick={handleOverlayClick}
          onDoubleClick={handleOverlayDblClick}
        />
      )}
    </div>
  );
}

// Preview helpers
function updateLinePreview(map: maplibregl.Map, pts: Array<[number, number]>) {
  const src = map.getSource('drawing-preview') as maplibregl.GeoJSONSource;
  if (!src || pts.length < 1) return;

  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: pts },
    }],
  });
}

function updatePolygonPreview(map: maplibregl.Map, pts: Array<[number, number]>) {
  const src = map.getSource('drawing-preview') as maplibregl.GeoJSONSource;
  if (!src) return;

  const features: GeoJSON.Feature[] = [];

  if (pts.length >= 2) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: pts },
    });
  }

  if (pts.length >= 3) {
    features.push({
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] },
    });
  }

  src.setData({ type: 'FeatureCollection', features });
}

function updateMeasurePreview(map: maplibregl.Map, pts: Array<[number, number]>) {
  const src = map.getSource('drawing-preview') as maplibregl.GeoJSONSource;
  if (!src || pts.length < 1) return;

  src.setData({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: pts },
    }],
  });
}

function clearPreview(map: maplibregl.Map) {
  const src = map.getSource('drawing-preview') as maplibregl.GeoJSONSource;
  if (src) {
    src.setData({ type: 'FeatureCollection', features: [] });
  }
}

function getFeatureColor(feature: DrawingFeature): string {
  switch (feature.type) {
    case 'line': return '#ef4444';
    case 'search-area': return '#3b82f6';
    case 'bearing-line': return '#8b5cf6';
    case 'search-sector': return '#ef4444';
    case 'measurement': return '#f97316';
    case 'marker':
      switch (feature.markerType) {
        case 'ipp': return '#3b82f6';
        case 'clue': return '#f97316';
        case 'hazard': return '#ef4444';
        case 'casualty': return '#dc2626';
      }
      break;
    default: return '#3b82f6';
  }
  return '#3b82f6';
}

function getFeatureLabel(feature: DrawingFeature): string {
  switch (feature.type) {
    case 'line': return feature.geojson.properties?.label || '';
    case 'measurement': return feature.geojson.properties?.label || '';
    case 'bearing-line': return feature.geojson.properties?.label || '';
    case 'marker': return feature.name;
    case 'search-area': return feature.name;
    case 'search-sector': return feature.name;
    default: return '';
  }
}
