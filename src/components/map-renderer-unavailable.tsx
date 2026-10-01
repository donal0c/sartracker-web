import { useEffect, useState } from 'react'

import { describeRendererFailure } from '../features/map/describe-renderer-failure'

/** How long a requested restart may take before the panel says it did not happen. */
const RESTART_CONFIRMATION_MS = 60_000

type GpuRenderingState = {
  readonly softwareRendering: boolean
  readonly problem: string | null
}

type MapRendererUnavailableProps = {
  /** The renderer's own failure text, shown so support can identify the cause. */
  readonly reason: string
}

/**
 * Replaces the map area when the map renderer cannot start (WebGL unavailable
 * or GPU blocklisted). The rest of the shell keeps working. The operator may
 * choose to restart with software rendering; it is never automatic [DON-288].
 */
export function MapRendererUnavailable({ reason }: MapRendererUnavailableProps) {
  const bridge = typeof window === 'undefined' ? undefined : window.sartrackerElectron
  const canRestart = bridge?.restartWithSoftwareRendering !== undefined
  const [gpuState, setGpuState] = useState<GpuRenderingState | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [restartStalled, setRestartStalled] = useState(false)

  useEffect(() => {
    let cancelled = false
    const readState = bridge?.readGpuRenderingState
    if (readState === undefined) return
    void readState()
      .then((state) => { if (!cancelled) setGpuState(state) })
      .catch(() => { if (!cancelled) setGpuState({ softwareRendering: false, problem: null }) })
    return () => { cancelled = true }
  }, [bridge])

  const softwareRenderingOn = gpuState?.softwareRendering === true

  /** Remembers the operator's choice and restarts the app through a clean quit. */
  const restart = async () => {
    setRestarting(true)
    setRestartError(null)
    setRestartStalled(false)
    try {
      await bridge?.restartWithSoftwareRendering?.()
      // A successful restart ends this window. Still here means shutdown was
      // refused (its own message explains why), so allow another try.
      window.setTimeout(() => {
        setRestartStalled(true)
        setRestarting(false)
      }, RESTART_CONFIRMATION_MS)
    } catch (error) {
      setRestartError(error instanceof Error ? error.message : String(error))
      setRestarting(false)
    }
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-stone-950 p-6"
      data-testid="map-renderer-unavailable"
      role="alert"
    >
      <div className="max-w-xl space-y-3 border border-rose-300/75 bg-stone-900 p-5 text-sm text-stone-100">
        <p className="text-base font-bold text-rose-100">
          The map cannot be shown: this computer's graphics (WebGL) are unavailable or blocked.
        </p>
        <p>Tracking, devices and mission records still work. Use the panels and Devices list while the map is unavailable.</p>
        {softwareRenderingOn ? (
          <p className="text-amber-100">
            Software rendering is already on and the map still cannot start. Export a support bundle from
            Settings and contact support.
          </p>
        ) : canRestart ? (
          <>
            <p>
              SAR Tracker can restart and draw the map in software instead. It may be slower. Your mission is
              saved first, and the app remembers this choice for later starts.
            </p>
            <button
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-stone-950 disabled:opacity-40"
              data-testid="restart-with-software-rendering"
              disabled={restarting || gpuState === null}
              onClick={() => void restart()}
              type="button"
            >
              Restart with software rendering
            </button>
          </>
        ) : null}
        {gpuState?.problem ? <p className="text-amber-100">{gpuState.problem}</p> : null}
        {restartError === null ? null : (
          <p className="font-bold text-rose-100">Could not restart with software rendering: {restartError}</p>
        )}
        {restartStalled ? (
          <p className="font-bold text-rose-100">SAR Tracker did not restart. Read any message it showed, then try again.</p>
        ) : null}
        <p className="break-words text-xs text-stone-400">Cause: {describeRendererFailure(reason)}</p>
      </div>
    </div>
  )
}
