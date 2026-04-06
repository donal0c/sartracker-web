import { useState, useEffect, useCallback } from 'react';

const CACHE_NAME = 'sartracker-tiles-v1';

// Kerry mountains bounding box for pre-caching
const KERRY_BOUNDS = {
  latMin: 51.8,
  latMax: 52.1,
  lonMin: -10.1,
  lonMax: -9.5,
};

function lon2tile(lon: number, zoom: number): number {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}

function lat2tile(lat: number, zoom: number): number {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
}

/**
 * Generate tile coordinates for a bounding box at given zoom levels.
 */
export function getTilesForBounds(
  bounds: typeof KERRY_BOUNDS,
  zoomLevels: number[]
): Array<{ z: number; x: number; y: number }> {
  const tiles: Array<{ z: number; x: number; y: number }> = [];

  for (const z of zoomLevels) {
    const xMin = lon2tile(bounds.lonMin, z);
    const xMax = lon2tile(bounds.lonMax, z);
    const yMin = lat2tile(bounds.latMax, z); // Note: y is inverted
    const yMax = lat2tile(bounds.latMin, z);

    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x, y });
      }
    }
  }

  return tiles;
}

interface CacheStatusProps {
  basemap: string;
}

export default function CacheStatus({ basemap }: CacheStatusProps) {
  const [online, setOnline] = useState(navigator.onLine);
  const [caching, setCaching] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const precacheKerry = useCallback(async () => {
    setCaching(true);
    setProgress({ done: 0, total: 0 });

    try {
      const cache = await caches.open(CACHE_NAME);
      const zoomLevels = [10, 11, 12, 13, 14, 15];
      const tiles = getTilesForBounds(KERRY_BOUNDS, zoomLevels);
      const total = tiles.length;
      setProgress({ done: 0, total });

      // Use the OpenTopoMap template — most useful for SAR
      const template = 'https://tile.opentopomap.org/{z}/{x}/{y}.png';

      let done = 0;
      // Process in batches of 6 to avoid hammering the server
      const batchSize = 6;
      for (let i = 0; i < tiles.length; i += batchSize) {
        const batch = tiles.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ({ z, x, y }) => {
            const url = template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
            try {
              const response = await fetch(url);
              if (response.ok) {
                await cache.put(url, response);
              }
            } catch {
              // Skip failed tiles
            }
            done++;
            setProgress({ done, total });
          })
        );
      }
    } catch (err) {
      console.error('Pre-cache failed:', err);
    } finally {
      setCaching(false);
    }
  }, []);

  return (
    <div
      data-testid="cache-status"
      style={{
        position: 'absolute',
        top: 10,
        left: 50,
        zIndex: 1,
        background: 'rgba(255,255,255,0.92)',
        borderRadius: 6,
        padding: '6px 10px',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <span
        data-testid="online-status"
        style={{ color: online ? '#16a34a' : '#dc2626', fontWeight: 600 }}
      >
        {online ? 'Online' : 'Offline (cached tiles)'}
      </span>
      <button
        data-testid="precache-btn"
        onClick={precacheKerry}
        disabled={caching}
        style={{
          background: caching ? '#9ca3af' : '#2563eb',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '4px 8px',
          cursor: caching ? 'default' : 'pointer',
          fontSize: 12,
        }}
      >
        {caching
          ? `Caching... ${progress ? `${progress.done}/${progress.total}` : ''}`
          : 'Pre-cache Kerry'}
      </button>
    </div>
  );
}
