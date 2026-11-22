import { StrictMode } from 'react'

import App from '../../App'
import { OperationalShellErrorBoundary } from '../../components/operational-shell-error-boundary'
import { RendererMountedSignal } from './renderer-mounted-signal'

type RendererRootProps = {
  /** Test seam for the desktop bridge; defaults to the real one. */
  readonly bridge?: { readonly signalRendererMounted?: () => void }
}

/**
 * The whole renderer tree mounted by `main.tsx` [DON-354]. The mount signal
 * sits outside the error boundary: it proves the scripts loaded and a screen
 * committed, so a render fault is revealed on screen rather than left hidden.
 *
 * @returns The app with its startup mount signal.
 */
export function RendererRoot(props: RendererRootProps) {
  return (
    <StrictMode>
      <OperationalShellErrorBoundary>
        <App />
      </OperationalShellErrorBoundary>
      <RendererMountedSignal {...('bridge' in props ? { bridge: props.bridge } : {})} />
    </StrictMode>
  )
}
