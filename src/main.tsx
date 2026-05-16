import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { bootstrapAppRuntime } from './features/runtime/bootstrap-app-runtime'

void bootstrapAppRuntime()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
