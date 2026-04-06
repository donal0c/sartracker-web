import { useState, useEffect, useCallback } from 'react';
import { wgs84ToITM, formatITM } from '../lib/geodesic';

interface Coords {
  lat: number;
  lon: number;
  easting: number;
  northing: number;
}

export function CoordinateBar() {
  const [coords, setCoords] = useState<Coords | null>(null);

  const handleMouseMove = useCallback((e: CustomEvent<{ lat: number; lon: number }>) => {
    const { lat, lon } = e.detail;
    const { easting, northing } = wgs84ToITM(lon, lat);
    setCoords({ lat, lon, easting, northing });
  }, []);

  useEffect(() => {
    window.addEventListener('map-mousemove', handleMouseMove as EventListener);
    return () => window.removeEventListener('map-mousemove', handleMouseMove as EventListener);
  }, [handleMouseMove]);

  if (!coords) {
    return (
      <div className="coordinate-bar" data-testid="coordinate-bar">
        <span className="coord-label">WGS84:</span> <span className="coord-value">—</span>
        <span className="coord-separator">|</span>
        <span className="coord-label">ITM:</span> <span className="coord-value">—</span>
      </div>
    );
  }

  return (
    <div className="coordinate-bar" data-testid="coordinate-bar">
      <span className="coord-label">WGS84:</span>
      <span className="coord-value" data-testid="coord-wgs84">
        {coords.lat.toFixed(6)}°N, {Math.abs(coords.lon).toFixed(6)}°{coords.lon < 0 ? 'W' : 'E'}
      </span>
      <span className="coord-separator">|</span>
      <span className="coord-label">ITM:</span>
      <span className="coord-value" data-testid="coord-itm">
        {formatITM(coords.easting, coords.northing)}
      </span>
    </div>
  );
}
