import { useState } from 'react';
import { useApp } from '../../lib/store';
import { generateId } from '../../lib/id';
import type { MarkerFeature } from '../../lib/types';

interface Props {
  point: [number, number]; // [lon, lat]
  onClose: () => void;
}

const MARKER_LABELS = {
  ipp: 'IPP / Last Known Position',
  clue: 'Clue',
  hazard: 'Hazard',
  casualty: 'Casualty',
} as const;

export function MarkerDialog({ point, onClose }: Props) {
  const { state, dispatch } = useApp();
  const markerType = state.markerType;
  const [name, setName] = useState(MARKER_LABELS[markerType]);
  const [notes, setNotes] = useState('');

  const handleCreate = () => {
    const feature: MarkerFeature = {
      id: generateId('mk'),
      type: 'marker',
      name,
      markerType,
      lon: point[0],
      lat: point[1],
      notes: notes || undefined,
      createdAt: Date.now(),
      geojson: {
        type: 'Feature',
        properties: { name, markerType, notes },
        geometry: {
          type: 'Point',
          coordinates: point,
        },
      },
    };

    dispatch({ type: 'ADD_FEATURE', feature });
    onClose();
  };

  return (
    <div className="dialog-overlay" data-testid="marker-dialog">
      <div className="dialog">
        <h3>{MARKER_LABELS[markerType]}</h3>
        <div className="dialog-body">
          <label>
            Name: <input data-testid="mk-name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label>
            Notes: <textarea data-testid="mk-notes" value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          <div className="center-display">
            Position: {point[1].toFixed(5)}°N, {Math.abs(point[0]).toFixed(5)}°W
          </div>
        </div>
        <div className="dialog-actions">
          <button data-testid="mk-cancel" onClick={onClose}>Cancel</button>
          <button data-testid="mk-create" className="primary" onClick={handleCreate}>Place Marker</button>
        </div>
      </div>
    </div>
  );
}
