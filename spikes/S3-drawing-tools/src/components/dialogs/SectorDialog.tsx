import { useState } from 'react';
import { useApp } from '../../lib/store';
import { generateId } from '../../lib/id';
import { geodesicSectorPoints } from '../../lib/geodesic';
import type { SearchSectorFeature } from '../../lib/types';

interface Props {
  center: [number, number]; // [lon, lat]
  onClose: () => void;
}

export function SectorDialog({ center, onClose }: Props) {
  const { dispatch } = useApp();
  const [name, setName] = useState('Search Sector');
  const [startBearing, setStartBearing] = useState(0);
  const [endBearing, setEndBearing] = useState(90);
  const [radius, setRadius] = useState(1000);

  const handleCreate = () => {
    const [lon, lat] = center;
    const pts = geodesicSectorPoints(lon, lat, startBearing, endBearing, radius, 36);

    const feature: SearchSectorFeature = {
      id: generateId('ss'),
      type: 'search-sector',
      name,
      centerLon: lon,
      centerLat: lat,
      startBearing,
      endBearing,
      radiusM: radius,
      createdAt: Date.now(),
      geojson: {
        type: 'Feature',
        properties: { name, startBearing, endBearing, radius },
        geometry: {
          type: 'Polygon',
          coordinates: [pts],
        },
      },
    };

    dispatch({ type: 'ADD_FEATURE', feature });
    onClose();
  };

  return (
    <div className="dialog-overlay" data-testid="sector-dialog">
      <div className="dialog">
        <h3>Search Sector</h3>
        <div className="dialog-body">
          <label>
            Name: <input data-testid="sec-name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label>
            Start Bearing (°):
            <input data-testid="sec-start" type="number" min={0} max={360} step={1} value={startBearing}
              onChange={e => setStartBearing(Number(e.target.value))} />
          </label>
          <label>
            End Bearing (°):
            <input data-testid="sec-end" type="number" min={0} max={360} step={1} value={endBearing}
              onChange={e => setEndBearing(Number(e.target.value))} />
          </label>
          <label>
            Radius (m):
            <input data-testid="sec-radius" type="number" min={10} max={100000} value={radius}
              onChange={e => setRadius(Number(e.target.value))} />
          </label>
          <div className="center-display">
            Center: {center[1].toFixed(5)}°N, {Math.abs(center[0]).toFixed(5)}°W
          </div>
        </div>
        <div className="dialog-actions">
          <button data-testid="sec-cancel" onClick={onClose}>Cancel</button>
          <button data-testid="sec-create" className="primary" onClick={handleCreate}>Create Sector</button>
        </div>
      </div>
    </div>
  );
}
