import { useApp } from '../lib/store';
import type { ActiveTool, MarkerType } from '../lib/types';

const TOOLS: { tool: ActiveTool; label: string; icon: string }[] = [
  { tool: 'select', label: 'Select', icon: '👆' },
  { tool: 'line', label: 'Line', icon: '📏' },
  { tool: 'polygon', label: 'Search Area', icon: '⬡' },
  { tool: 'range-ring', label: 'Range Rings', icon: '◎' },
  { tool: 'bearing-line', label: 'Bearing', icon: '➤' },
  { tool: 'sector', label: 'Sector', icon: '◔' },
  { tool: 'measure', label: 'Measure', icon: '📐' },
  { tool: 'marker', label: 'Marker', icon: '📍' },
];

const MARKER_TYPES: { type: MarkerType; label: string; color: string }[] = [
  { type: 'ipp', label: 'IPP/LKP', color: '#3b82f6' },
  { type: 'clue', label: 'Clue', color: '#f97316' },
  { type: 'hazard', label: 'Hazard', color: '#ef4444' },
  { type: 'casualty', label: 'Casualty', color: '#dc2626' },
];

export function Toolbar() {
  const { state, dispatch } = useApp();

  return (
    <div className="toolbar" data-testid="toolbar">
      <div className="toolbar-title">SAR Drawing Tools</div>
      <div className="toolbar-buttons">
        {TOOLS.map(({ tool, label, icon }) => (
          <button
            key={tool}
            className={`tool-btn ${state.activeTool === tool ? 'active' : ''}`}
            data-testid={`tool-${tool}`}
            onClick={() => dispatch({ type: 'SET_TOOL', tool: state.activeTool === tool ? null : tool })}
            title={label}
          >
            <span className="tool-icon">{icon}</span>
            <span className="tool-label">{label}</span>
          </button>
        ))}
      </div>
      {state.activeTool === 'marker' && (
        <div className="marker-type-selector" data-testid="marker-type-selector">
          {MARKER_TYPES.map(({ type, label, color }) => (
            <button
              key={type}
              className={`marker-type-btn ${state.markerType === type ? 'active' : ''}`}
              data-testid={`marker-type-${type}`}
              style={{ borderColor: color }}
              onClick={() => dispatch({ type: 'SET_MARKER_TYPE', markerType: type })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {state.activeTool && (
        <div className="tool-hint">
          {getToolHint(state.activeTool)}
        </div>
      )}
    </div>
  );
}

function getToolHint(tool: ActiveTool): string {
  switch (tool) {
    case 'select': return 'Click a feature to select it';
    case 'line': return 'Click to add points. Double-click to finish.';
    case 'polygon': return 'Click to add vertices. Double-click to finish.';
    case 'range-ring': return 'Click to set center point';
    case 'bearing-line': return 'Click to set origin point';
    case 'sector': return 'Click center, then drag for radius and angle';
    case 'measure': return 'Click start point, then click end point';
    case 'marker': return 'Click to place marker';
    default: return '';
  }
}
