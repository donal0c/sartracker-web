import { useState, useCallback } from 'react';
import MapView from './MapView';
import BasemapSwitcher from './BasemapSwitcher';
import CoordinateDisplay from './CoordinateDisplay';
import CacheStatus from './CacheStatus';
import { useBasemap } from './use-basemap';

export default function App() {
  const { basemap, setBasemap } = useBasemap();
  const [cursor, setCursor] = useState<{ lat: number; lng: number } | null>(null);

  const handleMouseMove = useCallback((lng: number, lat: number) => {
    setCursor({ lat, lng });
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <MapView basemap={basemap} onMouseMove={handleMouseMove} />
      <BasemapSwitcher selected={basemap} onSelect={setBasemap} />
      <CacheStatus basemap={basemap} />
      <CoordinateDisplay lat={cursor?.lat ?? null} lng={cursor?.lng ?? null} />
    </div>
  );
}
