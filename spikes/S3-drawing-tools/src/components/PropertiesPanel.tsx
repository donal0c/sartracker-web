import { useApp } from '../lib/store';
import type { DrawingFeature } from '../lib/types';

export function PropertiesPanel() {
  const { state, dispatch } = useApp();
  const feature = state.features.find(f => f.id === state.selectedFeatureId);

  if (!feature) return null;

  return (
    <div className="properties-panel" data-testid="properties-panel">
      <div className="panel-header">
        <h3>{feature.name}</h3>
        <button
          className="close-btn"
          data-testid="panel-close"
          onClick={() => dispatch({ type: 'SELECT_FEATURE', id: null })}
        >
          ✕
        </button>
      </div>
      <div className="panel-body">
        <div className="prop-row">
          <span className="prop-label">Type:</span>
          <span className="prop-value">{feature.type}</span>
        </div>
        {renderFeatureProps(feature)}
        {feature.notes && (
          <div className="prop-row">
            <span className="prop-label">Notes:</span>
            <span className="prop-value">{feature.notes}</span>
          </div>
        )}
      </div>
      <div className="panel-footer">
        <button
          className="delete-btn"
          data-testid="delete-feature"
          onClick={() => dispatch({ type: 'REMOVE_FEATURE', id: feature.id })}
        >
          Delete Feature
        </button>
      </div>
    </div>
  );
}

function renderFeatureProps(feature: DrawingFeature) {
  switch (feature.type) {
    case 'line':
      return (
        <div className="prop-row">
          <span className="prop-label">Distance:</span>
          <span className="prop-value">{formatDistance(feature.distanceM)}</span>
        </div>
      );
    case 'search-area':
      return (
        <>
          <div className="prop-row">
            <span className="prop-label">Area:</span>
            <span className="prop-value">{formatArea(feature.areaSqM)}</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Status:</span>
            <span className="prop-value">{feature.status}</span>
          </div>
          {feature.team && (
            <div className="prop-row">
              <span className="prop-label">Team:</span>
              <span className="prop-value">{feature.team}</span>
            </div>
          )}
          {feature.poaPercent !== undefined && (
            <div className="prop-row">
              <span className="prop-label">POA:</span>
              <span className="prop-value">{feature.poaPercent}%</span>
            </div>
          )}
        </>
      );
    case 'range-ring':
      return (
        <>
          <div className="prop-row">
            <span className="prop-label">Center:</span>
            <span className="prop-value">{feature.centerLat.toFixed(5)}, {feature.centerLon.toFixed(5)}</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Rings:</span>
            <span className="prop-value">{feature.radii.map(r => formatDistance(r)).join(', ')}</span>
          </div>
          {feature.lpbCategory && (
            <div className="prop-row">
              <span className="prop-label">LPB Category:</span>
              <span className="prop-value">{feature.lpbCategory}</span>
            </div>
          )}
        </>
      );
    case 'bearing-line':
      return (
        <>
          <div className="prop-row">
            <span className="prop-label">Bearing:</span>
            <span className="prop-value">{feature.trueBearing.toFixed(1)}° T</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Distance:</span>
            <span className="prop-value">{formatDistance(feature.distanceM)}</span>
          </div>
        </>
      );
    case 'search-sector':
      return (
        <>
          <div className="prop-row">
            <span className="prop-label">Start Bearing:</span>
            <span className="prop-value">{feature.startBearing.toFixed(1)}°</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">End Bearing:</span>
            <span className="prop-value">{feature.endBearing.toFixed(1)}°</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Radius:</span>
            <span className="prop-value">{formatDistance(feature.radiusM)}</span>
          </div>
        </>
      );
    case 'measurement':
      return (
        <>
          <div className="prop-row">
            <span className="prop-label">Distance:</span>
            <span className="prop-value">{formatDistance(feature.distanceM)}</span>
          </div>
          <div className="prop-row">
            <span className="prop-label">Bearing:</span>
            <span className="prop-value">{feature.bearing.toFixed(1)}°</span>
          </div>
        </>
      );
    case 'marker':
      return (
        <div className="prop-row">
          <span className="prop-label">Type:</span>
          <span className="prop-value">{feature.markerType.toUpperCase()}</span>
        </div>
      );
    default:
      return null;
  }
}

function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${m.toFixed(0)} m`;
}

function formatArea(sqM: number): string {
  if (sqM >= 10000) return `${(sqM / 10000).toFixed(2)} ha`;
  return `${sqM.toFixed(0)} m²`;
}
