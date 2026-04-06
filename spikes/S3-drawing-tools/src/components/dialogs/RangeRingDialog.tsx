import { useState } from 'react';
import { useApp } from '../../lib/store';
import { generateId } from '../../lib/id';
import { geodesicCirclePoints } from '../../lib/geodesic';
import { LPB_CATEGORIES, LPB_RING_COLORS } from '../../lib/lpb-data';
import type { RangeRingFeature } from '../../lib/types';

interface Props {
  center: [number, number]; // [lon, lat]
  onClose: () => void;
}

export function RangeRingDialog({ center, onClose }: Props) {
  const { dispatch } = useApp();
  const [mode, setMode] = useState<'manual' | 'lpb'>('manual');
  const [radius, setRadius] = useState(1000);
  const [ringCount, setRingCount] = useState(3);
  const [lpbCategory, setLpbCategory] = useState('hiker');
  const [name, setName] = useState('Range Rings');

  const handleCreate = () => {
    const [lon, lat] = center;
    let radii: number[];
    let labels: string[];
    let colors: string[];
    let catLabel: string | undefined;

    if (mode === 'lpb') {
      const cat = LPB_CATEGORIES[lpbCategory];
      radii = [cat.distances.p25, cat.distances.p50, cat.distances.p75, cat.distances.p95];
      labels = ['25%', '50%', '75%', '95%'];
      colors = [LPB_RING_COLORS.p25, LPB_RING_COLORS.p50, LPB_RING_COLORS.p75, LPB_RING_COLORS.p95];
      catLabel = cat.label;
    } else {
      radii = Array.from({ length: ringCount }, (_, i) => ((i + 1) * radius) / ringCount);
      labels = radii.map(r => `${r}m`);
      colors = radii.map((_, i) => {
        const t = i / Math.max(ringCount - 1, 1);
        return `hsl(${30 - t * 20}, 90%, ${55 - t * 10}%)`;
      });
    }

    // Generate GeoJSON for each ring (outer to inner for correct rendering)
    const geojsonFeatures = radii.map((r, i) => {
      const pts = geodesicCirclePoints(lon, lat, r, 64);
      return {
        type: 'Feature' as const,
        properties: { radius: r, label: labels[i], color: colors[i] },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [pts],
        },
      };
    });

    const feature: RangeRingFeature = {
      id: generateId('rr'),
      type: 'range-ring',
      name: mode === 'lpb' ? `LPB: ${catLabel}` : name,
      centerLon: lon,
      centerLat: lat,
      radii,
      labels,
      colors,
      lpbCategory: mode === 'lpb' ? lpbCategory : undefined,
      createdAt: Date.now(),
      geojson: geojsonFeatures,
    };

    dispatch({ type: 'ADD_FEATURE', feature });
    onClose();
  };

  return (
    <div className="dialog-overlay" data-testid="range-ring-dialog">
      <div className="dialog">
        <h3>Range Rings</h3>
        <div className="dialog-body">
          <div className="radio-group">
            <label>
              <input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} />
              Manual
            </label>
            <label>
              <input type="radio" checked={mode === 'lpb'} onChange={() => setMode('lpb')} />
              Lost Person Behavior
            </label>
          </div>

          {mode === 'manual' ? (
            <>
              <label>
                Name: <input data-testid="rr-name" value={name} onChange={e => setName(e.target.value)} />
              </label>
              <label>
                Radius (m):
                <input data-testid="rr-radius" type="number" min={10} max={100000} value={radius}
                  onChange={e => setRadius(Number(e.target.value))} />
              </label>
              <label>
                Number of rings:
                <input data-testid="rr-count" type="number" min={1} max={10} value={ringCount}
                  onChange={e => setRingCount(Number(e.target.value))} />
              </label>
            </>
          ) : (
            <label>
              Subject Category:
              <select data-testid="rr-lpb-category" value={lpbCategory}
                onChange={e => setLpbCategory(e.target.value)}>
                {Object.entries(LPB_CATEGORIES).map(([key, cat]) => (
                  <option key={key} value={key}>{cat.label}</option>
                ))}
              </select>
            </label>
          )}

          <div className="center-display">
            Center: {center[1].toFixed(5)}°N, {Math.abs(center[0]).toFixed(5)}°W
          </div>
        </div>
        <div className="dialog-actions">
          <button data-testid="rr-cancel" onClick={onClose}>Cancel</button>
          <button data-testid="rr-create" className="primary" onClick={handleCreate}>Create Rings</button>
        </div>
      </div>
    </div>
  );
}
