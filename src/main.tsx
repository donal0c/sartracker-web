import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { bootstrapAppRuntime } from './features/runtime/bootstrap-app-runtime'
import { installAppRuntimeTeardown } from './features/runtime/install-app-runtime-teardown'

const runtimeBootstrapPromise = bootstrapAppRuntime()
installAppRuntimeTeardown({
  bootstrapPromise: runtimeBootstrapPromise,
})
void runtimeBootstrapPromise

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
