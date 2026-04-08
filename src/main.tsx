import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { startMissionAutosave } from './features/persistence/mission-autosave'
import { createTauriMissionStore } from './infrastructure/mission-store/tauri-mission-store'
import { registerServiceWorker } from './lib/register-service-worker'
import { isTauriRuntimeAvailable } from './lib/tauri-runtime'

void registerServiceWorker()

if (isTauriRuntimeAvailable()) {
  startMissionAutosave(createTauriMissionStore())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
