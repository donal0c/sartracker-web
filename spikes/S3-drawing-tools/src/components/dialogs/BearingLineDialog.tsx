import { useState } from 'react';
import { useApp } from '../../lib/store';
import { generateId } from '../../lib/id';
import { geodesicBearingEndpoint, magneticToTrue, trueToMagnetic, IRELAND_MAGNETIC_DECLINATION } from '../../lib/geodesic';
import type { BearingLineFeature } from '../../lib/types';

interface Props {
  origin: [number, number]; // [lon, lat]
  onClose: () => void;
}

export function BearingLineDialog({ origin, onClose }: Props) {
  const { dispatch } = useApp();
  const [name, setName] = useState('Bearing Line');
  const [bearingType, setBearingType] = useState<'true' | 'magnetic'>('true');
  const [bearing, setBearing] = useState(0);
  const [distance, setDistance] = useState(1000);
  const [distUnit, setDistUnit] = useState<'m' | 'km'>('m');

  const trueBearing = bearingType === 'magnetic' ? magneticToTrue(bearing) : bearing;
  const magneticBearing = bearingType === 'true' ? trueToMagnetic(bearing) : bearing;
  const distanceM = distUnit === 'km' ? distance * 1000 : distance;

  const handleCreate = () => {
    const [lon, lat] = origin;
    const endpoint = geodesicBearingEndpoint(lon, lat, trueBearing, distanceM);

    const label = `${trueBearing.toFixed(1)}° T / ${magneticBearing.toFixed(1)}° M — ${distanceM >= 1000 ? `${(distanceM / 1000).toFixed(1)}km` : `${distanceM}m`}`;

    const feature: BearingLineFeature = {
      id: generateId('bl'),
      type: 'bearing-line',
      name,
      originLon: lon,
      originLat: lat,
      trueBearing,
      distanceM,
      createdAt: Date.now(),
      geojson: {
        type: 'Feature',
        properties: { name, trueBearing, magneticBearing: magneticBearing, distanceM, label },
        geometry: {
          type: 'LineString',
          coordinates: [[lon, lat], endpoint],
        },
      },
    };

    dispatch({ type: 'ADD_FEATURE', feature });
    onClose();
  };

  return (
    <div className="dialog-overlay" data-testid="bearing-line-dialog">
      <div className="dialog">
        <h3>Bearing Line</h3>
        <div className="dialog-body">
          <label>
            Name: <input data-testid="bl-name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <div className="radio-group">
            <label>
              <input type="radio" checked={bearingType === 'true'} onChange={() => setBearingType('true')} />
              True North
            </label>
            <label>
              <input type="radio" checked={bearingType === 'magnetic'} onChange={() => setBearingType('magnetic')} />
              Magnetic
            </label>
          </div>
          <label>
            Bearing (°):
            <input data-testid="bl-bearing" type="number" min={0} max={360} step={0.1} value={bearing}
              onChange={e => setBearing(Number(e.target.value))} />
          </label>
          <div className="bearing-conversion" data-testid="bl-conversion">
            {bearingType === 'true'
              ? `Magnetic: ${magneticBearing.toFixed(1)}° (declination ${IRELAND_MAGNETIC_DECLINATION}°)`
              : `True: ${trueBearing.toFixed(1)}° (declination ${IRELAND_MAGNETIC_DECLINATION}°)`}
          </div>
          <div className="distance-input">
            <label>
              Distance:
              <input data-testid="bl-distance" type="number" min={1} max={100000} value={distance}
                onChange={e => setDistance(Number(e.target.value))} />
            </label>
            <select data-testid="bl-unit" value={distUnit} onChange={e => setDistUnit(e.target.value as 'm' | 'km')}>
              <option value="m">metres</option>
              <option value="km">kilometres</option>
            </select>
          </div>
          <div className="origin-display">
            Origin: {origin[1].toFixed(5)}°N, {Math.abs(origin[0]).toFixed(5)}°W
          </div>
        </div>
        <div className="dialog-actions">
          <button data-testid="bl-cancel" onClick={onClose}>Cancel</button>
          <button data-testid="bl-create" className="primary" onClick={handleCreate}>Create Bearing Line</button>
        </div>
      </div>
    </div>
  );
}
