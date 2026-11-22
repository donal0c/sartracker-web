import { useEffect } from 'react'

/** The part of the desktop bridge that confirms the first screen mounted. */
type RendererMountedBridge = {
  readonly signalRendererMounted?: () => void
}

type RendererMountedSignalProps = {
  /** Defaults to the desktop bridge; undefined in a plain browser. */
  readonly bridge?: RendererMountedBridge
}

/**
 * Confirms to the main process that the first screen committed [DON-354].
 * Render it beside the app root: effects run only after a successful commit,
 * so a failed script load or a crash while rendering the first screen never
 * sends the signal, and startup then shows its visible fault screen instead
 * of a blank window.
 *
 * @returns Nothing visible.
 */
export function RendererMountedSignal(props: RendererMountedSignalProps): null {
  const bridge = 'bridge' in props ? props.bridge : window.sartrackerElectron
  useEffect(() => {
    bridge?.signalRendererMounted?.()
  }, [bridge])
  return null
}
