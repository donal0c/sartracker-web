import { wgs84ToTM65, formatIrishGridReference, formatWGS84 } from './coordinates';

interface CoordinateDisplayProps {
  lat: number | null;
  lng: number | null;
}

export default function CoordinateDisplay({ lat, lng }: CoordinateDisplayProps) {
  let wgs84Text = '—';
  let gridText = '—';

  if (lat !== null && lng !== null) {
    wgs84Text = formatWGS84(lat, lng);
    try {
      const [easting, northing] = wgs84ToTM65(lat, lng);
      gridText = formatIrishGridReference(easting, northing);
    } catch {
      gridText = 'Outside Irish Grid';
    }
  }

  return (
    <div
      data-testid="coordinate-display"
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1,
        background: 'rgba(0,0,0,0.75)',
        color: '#fff',
        padding: '4px 12px',
        fontFamily: 'monospace',
        fontSize: 13,
        display: 'flex',
        gap: 24,
      }}
    >
      <span data-testid="coords-wgs84">WGS84: {wgs84Text}</span>
      <span data-testid="coords-irish-grid">Irish Grid: {gridText}</span>
    </div>
  );
}
