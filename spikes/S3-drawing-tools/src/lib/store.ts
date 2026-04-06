/**
 * Simple state store for drawn features.
 * Uses React context + reducer pattern — no external deps.
 */
import { createContext, useContext } from 'react';
import type { DrawingFeature, ActiveTool, MarkerType } from './types';

export interface AppState {
  activeTool: ActiveTool;
  markerType: MarkerType;
  features: DrawingFeature[];
  selectedFeatureId: string | null;
  /** Pending dialog data — tool sets this, dialog consumes it */
  pendingDialog: PendingDialog | null;
}

export type PendingDialog =
  | { kind: 'search-area'; vertices: Array<[number, number]> }
  | { kind: 'range-ring'; center: [number, number] }
  | { kind: 'bearing-line'; origin: [number, number] }
  | { kind: 'sector'; center: [number, number]; startBearing: number; endBearing: number; radiusM: number }
  | { kind: 'marker'; point: [number, number] };

export type AppAction =
  | { type: 'SET_TOOL'; tool: ActiveTool }
  | { type: 'SET_MARKER_TYPE'; markerType: MarkerType }
  | { type: 'ADD_FEATURE'; feature: DrawingFeature }
  | { type: 'REMOVE_FEATURE'; id: string }
  | { type: 'SELECT_FEATURE'; id: string | null }
  | { type: 'SET_PENDING_DIALOG'; dialog: PendingDialog | null }
  | { type: 'UPDATE_FEATURE'; id: string; updates: Partial<DrawingFeature> };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.tool, selectedFeatureId: null };
    case 'SET_MARKER_TYPE':
      return { ...state, markerType: action.markerType };
    case 'ADD_FEATURE':
      return { ...state, features: [...state.features, action.feature], pendingDialog: null };
    case 'REMOVE_FEATURE':
      return {
        ...state,
        features: state.features.filter(f => f.id !== action.id),
        selectedFeatureId: state.selectedFeatureId === action.id ? null : state.selectedFeatureId,
      };
    case 'SELECT_FEATURE':
      return { ...state, selectedFeatureId: action.id };
    case 'SET_PENDING_DIALOG':
      return { ...state, pendingDialog: action.dialog };
    case 'UPDATE_FEATURE': {
      return {
        ...state,
        features: state.features.map(f =>
          f.id === action.id ? { ...f, ...action.updates } as DrawingFeature : f
        ),
      };
    }
    default:
      return state;
  }
}

export const initialState: AppState = {
  activeTool: null,
  markerType: 'ipp',
  features: [],
  selectedFeatureId: null,
  pendingDialog: null,
};

export const AppContext = createContext<{
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}>({ state: initialState, dispatch: () => {} });

export function useApp() {
  return useContext(AppContext);
}
