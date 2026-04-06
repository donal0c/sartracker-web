import { useState } from 'react';
import { useApp } from '../../lib/store';
import { generateId } from '../../lib/id';
import { geodesicPolygonArea } from '../../lib/geodesic';
import type { SearchAreaFeature, SearchAreaStatus } from '../../lib/types';

interface Props {
  vertices: Array<[number, number]>;
  onClose: () => void;
}

const STATUSES: SearchAreaStatus[] = ['Planned', 'Assigned', 'InProgress', 'Completed', 'Cleared'];
const TERRAIN_TYPES = ['Open', 'Woodland', 'Urban', 'Rocky', 'Bog', 'River', 'Coastal', 'Mountain'];

export function SearchAreaDialog({ vertices, onClose }: Props) {
  const { dispatch } = useApp();
  const [name, setName] = useState('Search Area');
  const [team, setTeam] = useState('');
  const [status, setStatus] = useState<SearchAreaStatus>('Planned');
  const [priority, setPriority] = useState(2);
  const [poaPercent, setPoaPercent] = useState(0);
  const [terrainType, setTerrainType] = useState('');
  const [notes, setNotes] = useState('');

  const ring = [...vertices, vertices[0]]; // close the ring
  const areaSqM = geodesicPolygonArea(ring);

  const handleCreate = () => {
    const feature: SearchAreaFeature = {
      id: generateId('sa'),
      type: 'search-area',
      name,
      team: team || undefined,
      status,
      priority,
      poaPercent,
      terrainType: terrainType || undefined,
      notes: notes || undefined,
      areaSqM,
      createdAt: Date.now(),
      geojson: {
        type: 'Feature',
        properties: { name, team, status, priority, poaPercent, terrainType, areaSqM },
        geometry: {
          type: 'Polygon',
          coordinates: [ring],
        },
      },
    };
    dispatch({ type: 'ADD_FEATURE', feature });
    onClose();
  };

  return (
    <div className="dialog-overlay" data-testid="search-area-dialog">
      <div className="dialog">
        <h3>Search Area Properties</h3>
        <div className="dialog-body">
          <label>
            Name: <input data-testid="sa-name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label>
            Team: <input data-testid="sa-team" value={team} onChange={e => setTeam(e.target.value)} />
          </label>
          <label>
            Status:
            <select data-testid="sa-status" value={status} onChange={e => setStatus(e.target.value as SearchAreaStatus)}>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Priority:
            <input data-testid="sa-priority" type="number" min={1} max={5} value={priority}
              onChange={e => setPriority(Number(e.target.value))} />
          </label>
          <label>
            POA (%):
            <input data-testid="sa-poa" type="number" min={0} max={100} value={poaPercent}
              onChange={e => setPoaPercent(Number(e.target.value))} />
          </label>
          <label>
            Terrain:
            <select data-testid="sa-terrain" value={terrainType} onChange={e => setTerrainType(e.target.value)}>
              <option value="">--</option>
              {TERRAIN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>
            Notes: <textarea data-testid="sa-notes" value={notes} onChange={e => setNotes(e.target.value)} />
          </label>
          <div className="area-display" data-testid="sa-area">
            Area: {areaSqM >= 10000 ? `${(areaSqM / 10000).toFixed(2)} ha` : `${areaSqM.toFixed(0)} m²`}
            {areaSqM >= 1000000 && ` (${(areaSqM / 1000000).toFixed(2)} km²)`}
          </div>
        </div>
        <div className="dialog-actions">
          <button data-testid="sa-cancel" onClick={onClose}>Cancel</button>
          <button data-testid="sa-create" className="primary" onClick={handleCreate}>Create Area</button>
        </div>
      </div>
    </div>
  );
}
