import { useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TILE_SOURCES, type TileSource } from './tile-sources';

// Kerry / MacGillycuddy's Reeks defaults
const DEFAULT_CENTER: [number, number] = [-9.70, 51.97]; // [lng, lat]
const DEFAULT_ZOOM = 12;
const MIN_ZOOM = 8;
const MAX_ZOOM = 18;

interface MapViewProps {
  basemap: string;
  onMouseMove?: (lng: number, lat: number) => void;
}

function makeStyle(source: TileSource): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: source.tiles,
        tileSize: source.tileSize,
        maxzoom: source.maxzoom,
        attribution: source.attribution,
      },
    },
    layers: [
      {
        id: 'basemap-layer',
        type: 'raster',
        source: 'basemap',
      },
    ],
  };
}

export default function MapView({ basemap, onMouseMove }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Stable callback ref for mouse handler
  const onMouseMoveRef = useRef(onMouseMove);
  onMouseMoveRef.current = onMouseMove;

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return;

    const source = TILE_SOURCES[basemap] ?? TILE_SOURCES.opentopomap;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: makeStyle(source),
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

    map.on('mousemove', (e) => {
      onMouseMoveRef.current?.(e.lngLat.lng, e.lngLat.lat);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Only run on mount — basemap changes handled in next effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switch basemap without recreating the map
  const prevBasemapRef = useRef(basemap);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || basemap === prevBasemapRef.current) return;
    prevBasemapRef.current = basemap;

    const source = TILE_SOURCES[basemap];
    if (!source) return;

    // Preserve center + zoom across style change
    const center = map.getCenter();
    const zoom = map.getZoom();

    map.setStyle(makeStyle(source));

    map.once('style.load', () => {
      map.setCenter(center);
      map.setZoom(zoom);
    });
  }, [basemap]);

  return (
    <div
      ref={containerRef}
      data-testid="map-container"
      style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
    />
  );
}
