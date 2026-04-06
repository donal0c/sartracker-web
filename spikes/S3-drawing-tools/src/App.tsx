import { useReducer } from 'react';
import { AppContext, appReducer, initialState } from './lib/store';
import { Toolbar } from './components/Toolbar';
import { MapView } from './components/MapView';
import { PropertiesPanel } from './components/PropertiesPanel';
import { CoordinateBar } from './components/CoordinateBar';
import { SearchAreaDialog } from './components/dialogs/SearchAreaDialog';
import { RangeRingDialog } from './components/dialogs/RangeRingDialog';
import { BearingLineDialog } from './components/dialogs/BearingLineDialog';
import { SectorDialog } from './components/dialogs/SectorDialog';
import { MarkerDialog } from './components/dialogs/MarkerDialog';

export default function App() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  const closeDialog = () => dispatch({ type: 'SET_PENDING_DIALOG', dialog: null });

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <div className="app-layout">
        <Toolbar />
        <div className="map-area">
          <MapView />
          <PropertiesPanel />
          <CoordinateBar />
        </div>

        {/* Modal dialogs */}
        {state.pendingDialog?.kind === 'search-area' && (
          <SearchAreaDialog vertices={state.pendingDialog.vertices} onClose={closeDialog} />
        )}
        {state.pendingDialog?.kind === 'range-ring' && (
          <RangeRingDialog center={state.pendingDialog.center} onClose={closeDialog} />
        )}
        {state.pendingDialog?.kind === 'bearing-line' && (
          <BearingLineDialog origin={state.pendingDialog.origin} onClose={closeDialog} />
        )}
        {state.pendingDialog?.kind === 'sector' && (
          <SectorDialog center={state.pendingDialog.center} onClose={closeDialog} />
        )}
        {state.pendingDialog?.kind === 'marker' && (
          <MarkerDialog point={state.pendingDialog.point} onClose={closeDialog} />
        )}
      </div>
    </AppContext.Provider>
  );
}
