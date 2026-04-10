import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {
  shouldEnableMissionBrowserHarness,
  startMissionBrowserHarness,
} from './features/mission/mission-browser-harness'
import { applyAppRuntimeController } from './features/runtime/app-runtime-controller'
import { startAppRuntime } from './features/runtime/start-app-runtime'

void startAppRuntime().then((controller) => {
  if (controller !== null) {
    applyAppRuntimeController(controller)
  }
})

if (shouldEnableMissionBrowserHarness()) {
  void startMissionBrowserHarness()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
