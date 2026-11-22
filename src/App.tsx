import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'

import { DrawingRuntimeBridge } from './features/drawings/drawing-runtime-bridge'
import { DiagnosticsRuntimeBridge } from './features/diagnostics/diagnostics-runtime-bridge'
import { DrawingDialog } from './components/drawing-dialog'
import { CoordinateConverterDialog } from './components/coordinate-converter-dialog'
import { LayerCatalogRuntimeBridge } from './features/layers/layer-catalog-runtime-bridge'
import { MarkerDialog } from './components/marker-dialog'
import { MarkerStatusBanner } from './components/marker-status-banner'
import { MarkerRuntimeBridge } from './features/markers/marker-runtime-bridge'
import { OutingRuntimeBridge } from './features/outings/outing-runtime-bridge'
import { ParticipantRuntimeBridge } from './features/participants/participant-runtime-bridge'
import { MeasurementRuntimeBridge } from './features/measurements/measurement-runtime-bridge'
import { MissionReviewRuntimeBridge } from './features/mission-review/mission-review-runtime-bridge'
import { exportSupportBundle } from './infrastructure/support-report/tauri-support-report-store'
import { useSettingsWorkspaceStore } from './features/settings/settings-workspace-store'
import { GpxRuntimeBridge } from './features/gpx/gpx-runtime-bridge'
import { HelicopterRuntimeBridge } from './features/helicopters/helicopter-runtime-bridge'
import { useMissionStore } from './features/mission/mission-store'
import { shouldEnableMissionBrowserHarness } from './features/mission/mission-browser-harness'
import { MapErrorBoundary } from './components/map-error-boundary'
import {
  selectLifecycleBackupFailureAlert,
  selectAutosaveWarning,
  useAutosaveStatusStore,
} from './features/persistence/autosave-status-store'
import {
  type RuntimeBootPhase,
  useRuntimeBootStore,
} from './features/runtime/runtime-boot-store'
import { reloadRuntimeFaultShell } from './features/runtime/runtime-fault-reload'
import { APP_VERSION } from './lib/app-version'
import { SimplifiedWorkspace } from './components/workspace/simplified-workspace'
import { DESKTOP_PANEL_ARRANGEMENT } from './features/workspace/panel-arrangement'
import { shouldUseClassicLayoutFixture } from './features/workspace/classic-layout-fixture'
import { WeatherMenu } from './components/weather-menu'
import { LazyScreenBoundary } from './components/lazy-screen-boundary'
import { scopeAutosaveWarningToMission } from './features/persistence/autosave-warning-scope'
import { useFocusModeStore } from './features/focus-mode/focus-mode-store'

// Settings stays mounted so its open/close behaviour is unchanged; only its
// code is split out of the default application chunk.
const SettingsWorkspace = lazy(async () => {
  const module = await import('./components/settings-workspace')

  return { default: module.SettingsWorkspace }
})
const DiagnosticsWorkspace = lazy(async () => {
  const module = await import('./components/diagnostics-workspace')

  return { default: module.DiagnosticsWorkspace }
})
const DevicesWorkspace = lazy(async () => {
  const module = await import('./components/devices-workspace')

  return { default: module.DevicesWorkspace }
})
const MissionReviewWorkspace = lazy(async () => {
  const module = await import('./components/mission-review-workspace')

  return { default: module.MissionReviewWorkspace }
})
const MapView = lazy(async () => {
  const module = await import('./components/map-view')

  return { default: module.MapView }
})

// TEMPORARY, browser-test harness only: the old screen never loads in the
// packaged app, so it lives in its own chunk, out of first paint (DON-353).
const ClassicLayoutFixture = lazy(async () => {
  const module = await import('./components/classic-layout-fixture-screen')

  return { default: module.ClassicLayoutFixture }
})

function App() {
  const settingsOpen = useSettingsWorkspaceStore((state) => state.open)
  const settingsFocusTarget = useSettingsWorkspaceStore((state) => state.focusTarget)
  const closeSettingsWorkspace = useSettingsWorkspaceStore((state) => state.closeWorkspace)
  const [missionActionError, setMissionActionError] = useState<string | null>(null)
  const [missionDecisionOpen, setMissionDecisionOpen] = useState(false)
  const handleMissionActionError = useCallback((error: string | null) => {
    setMissionActionError(error)
  }, [])
  const browserTestingMode = shouldEnableMissionBrowserHarness()
  const classicLayoutFixture = shouldUseClassicLayoutFixture()
  const focusModeActive = useFocusModeStore((state) => state.active)
  const runtimeBootPhase = useRuntimeBootStore((state) => state.phase)
  const runtimeBootError = useRuntimeBootStore((state) => state.error)

  useEffect(() => {
    const timer = window.setInterval(() => {
      useAutosaveStatusStore.getState().markObservedElapsed({ elapsedMs: 1000 })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const map = (
    <Suspense
      fallback={
        <div className="flex h-full w-full items-center justify-center bg-stone-950 text-sm text-stone-400">
          Loading map shell...
        </div>
      }
    >
      <MapErrorBoundary>
        <MapView />
      </MapErrorBoundary>
    </Suspense>
  )

  if (runtimeBootPhase !== 'ready') {
    return (
      <RuntimeBootGate
        error={runtimeBootError}
        onReload={() => reloadRuntimeFaultShell()}
        phase={runtimeBootPhase}
      />
    )
  }

  return (
    <main
      className="sar-shell flex h-screen w-full flex-col overflow-hidden"
      data-focus-mode={classicLayoutFixture && focusModeActive ? 'true' : 'false'}
      data-testid="app-shell"
    >
      <DiagnosticsRuntimeBridge />
      <DrawingRuntimeBridge />
      <GpxRuntimeBridge />
      <HelicopterRuntimeBridge />
      <LayerCatalogRuntimeBridge />
      <MarkerRuntimeBridge />
      <OutingRuntimeBridge />
      <ParticipantRuntimeBridge />
      <MeasurementRuntimeBridge />
      <MissionReviewRuntimeBridge />

      {classicLayoutFixture ? (
        <LazyScreenBoundary screen="Old screen test fixture">
          <ClassicLayoutFixture
            actionError={missionActionError}
            browserTestingMode={browserTestingMode}
            decisionOpen={missionDecisionOpen}
            map={map}
            onActionErrorChange={handleMissionActionError}
            onDecisionOpenChange={setMissionDecisionOpen}
            renderSafetyBanner={(focusModeActive) => (
              <RuntimeSafetyBanner browserTestingMode={browserTestingMode} focusModeActive={focusModeActive} />
            )}
          />
        </LazyScreenBoundary>
      ) : (
        <SimplifiedWorkspace
          actionError={missionActionError}
          arrangement={DESKTOP_PANEL_ARRANGEMENT}
          decisionOpen={missionDecisionOpen}
          map={map}
          onActionErrorChange={handleMissionActionError}
          onDecisionOpenChange={setMissionDecisionOpen}
          // The old mast is gone, so the autosave warning shows in the safety banner.
          safetyBanner={<RuntimeSafetyBanner browserTestingMode={browserTestingMode} focusModeActive />}
          weather={<WeatherMenu />}
        />
      )}

      <DrawingDialog />
      <CoordinateConverterDialog />
      <MarkerDialog />
      <MarkerStatusBanner />
      {/* Opened on demand, so their code stays out of first paint; each stays mounted once loaded.
          A screen whose code fails to load shows a message; the rest of the app stays up. */}
      <LazyScreenBoundary screen="Devices"><DevicesWorkspace /></LazyScreenBoundary>
      <LazyScreenBoundary screen="Mission review"><MissionReviewWorkspace /></LazyScreenBoundary>
      <LazyScreenBoundary screen="Diagnostics"><DiagnosticsWorkspace /></LazyScreenBoundary>
      <LazyScreenBoundary screen="Settings">
        <SettingsWorkspace
          focusTarget={settingsFocusTarget}
          onClose={closeSettingsWorkspace}
          open={settingsOpen}
        />
      </LazyScreenBoundary>
    </main>
  )
}

export default App


/**
 * Blocks operator interaction until runtime startup either succeeds or fails visibly.
 */
export function RuntimeBootGate(props: {
  readonly phase: RuntimeBootPhase
  readonly error: string | null
  readonly onReload: () => void
}) {
  const reloadButtonRef = useRef<HTMLButtonElement>(null)
  const [exporting, setExporting] = useState(false)
  const [exportPath, setExportPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  useEffect(() => {
    if (props.phase === 'failed') {
      reloadButtonRef.current?.focus()
    }
  }, [props.phase])

  if (props.phase === 'booting') {
    return (
      <main
        className="sar-shell flex h-screen w-screen items-center justify-center"
        data-testid="runtime-booting-shell"
      >
        <div className="border border-[var(--sar-line)] bg-[var(--sar-panel)] px-6 py-5 text-center shadow-2xl">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-amber-300">
            SAR Tracker
          </p>
          <h1 className="mt-2 font-mono text-[22px] font-black text-stone-50">
            Preparing operational runtime
          </h1>
          <p aria-live="polite" className="mt-2 text-sm text-stone-400" role="status">
            Loading mission, tracking, and map services...
          </p>
        </div>
      </main>
    )
  }

  return (
    <main
      className="sar-shell flex h-screen w-screen items-center justify-center p-6"
      data-testid="runtime-failed-shell"
    >
      <section
        aria-describedby="runtime-fault-guidance runtime-fault-detail"
        aria-labelledby="runtime-fault-title"
        aria-live="assertive"
        className="max-w-xl border border-rose-300/40 bg-rose-950/30 p-6 shadow-2xl"
        role="alert"
      >
        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-rose-200">
          Startup fault
        </p>
        <h1
          className="mt-2 font-mono text-[24px] font-black text-stone-50"
          id="runtime-fault-title"
        >
          Runtime startup failed
        </h1>
        <p
          className="mt-3 text-sm leading-relaxed text-stone-200"
          id="runtime-fault-guidance"
        >
          SAR Tracker could not start the runtime services needed for mission
          operations. Before reloading, copy or screenshot this fault message if
          you are in an incident. Reload starts from a clean operational URL and
          removes browser testing flags.
        </p>
        <pre
          className="mt-4 whitespace-pre-wrap border border-rose-200/20 bg-stone-950/70 p-3 text-left text-xs text-rose-100"
          id="runtime-fault-detail"
        >
          {props.error ?? 'Unknown startup failure.'}
        </pre>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            autoFocus
            className="sar-action-primary px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em]"
            onClick={props.onReload}
            ref={reloadButtonRef}
            type="button"
          >
            Reload clean runtime
          </button>
          <button
            className="sar-button px-4 py-2 text-[12px] font-black uppercase tracking-[0.08em] disabled:opacity-50"
            data-testid="runtime-fault-export-support-bundle"
            disabled={exporting}
            onClick={() => void handleStartupFaultExport()}
            type="button"
          >
            {exporting ? 'Exporting...' : 'Export support bundle'}
          </button>
        </div>
        {exportPath !== null ? (
          <p
            className="mt-4 break-all text-xs text-emerald-200"
            data-testid="runtime-fault-export-path"
          >
            {exportPath}
          </p>
        ) : null}
        {exportError !== null ? (
          <p
            className="mt-4 text-xs text-rose-200"
            data-testid="runtime-fault-export-error"
          >
            {exportError}
          </p>
        ) : null}
      </section>
    </main>
  )

  async function handleStartupFaultExport(): Promise<void> {
    const generatedAt = new Date().toISOString()
    setExporting(true)
    setExportPath(null)
    setExportError(null)

    try {
      const path = await exportSupportBundle(
        `startup-fault-support-bundle-${safeRuntimeFaultTimestamp(generatedAt)}.txt`,
        buildStartupFaultSupportReport({
          generatedAt,
          appVersion: APP_VERSION,
          faultMessage: props.error ?? 'Unknown startup failure.',
          location: typeof window === 'undefined' ? 'unknown' : window.location.href,
          userAgent: typeof navigator === 'undefined' ? 'unknown' : navigator.userAgent,
        }),
      )
      setExportPath(path)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Startup fault support bundle export failed.')
    } finally {
      setExporting(false)
    }
  }
}

function buildStartupFaultSupportReport(input: {
  readonly generatedAt: string
  readonly appVersion: string
  readonly faultMessage: string
  readonly location: string
  readonly userAgent: string
}): string {
  return [
    'Startup Fault Support Bundle',
    `generated at: ${input.generatedAt}`,
    `app version: ${input.appVersion}`,
    `location: ${input.location}`,
    `user agent: ${input.userAgent}`,
    '',
    '[startup-fault]',
    'phase: failed',
    'fault message:',
    input.faultMessage,
  ].join('\n')
}

function safeRuntimeFaultTimestamp(input: string): string {
  return input.replace(/[:.]/g, '-')
}

export function RuntimeSafetyBanner(props: {
  readonly browserTestingMode: boolean
  readonly focusModeActive: boolean
}) {
  const currentMission = useMissionStore((state) => state.currentMission)
  const autosaveStatus = useAutosaveStatusStore()
  const lifecycleBackupFailure = selectLifecycleBackupFailureAlert(autosaveStatus)
  const autosaveWarning = scopeAutosaveWarningToMission(
    selectAutosaveWarning(autosaveStatus),
    currentMission,
  )
  const focusAutosaveWarning = props.focusModeActive ? autosaveWarning : null

  if (
    !props.browserTestingMode &&
    focusAutosaveWarning === null &&
    lifecycleBackupFailure === null
  ) {
    return null
  }

  return (
    <div
      className="border-b border-amber-400/55 bg-amber-400/15 px-5 py-2 text-[12px] font-semibold text-amber-100 shadow-[inset_0_-1px_rgba(0,0,0,0.4)]"
      data-testid="hosted-browser-testing-banner"
    >
      {props.browserTestingMode ? (
        <p>
          Browser testing mode: mission data is stored in this browser session. Use for team testing only, not live incidents.
        </p>
      ) : null}
      {focusAutosaveWarning === null ? null : (
        <p className="mt-1" data-testid="focus-autosave-warning" role="status">
          {focusAutosaveWarning}
        </p>
      )}
      {lifecycleBackupFailure === null ? null : (
        <div
          className="sar-inline-critical mt-2 p-3"
          data-testid="lifecycle-backup-failure-banner"
          role="alert"
        >
          <p className="font-black uppercase tracking-[0.1em]">
            Lifecycle backup failed
          </p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-rose-100">
            {lifecycleBackupFailure.reasonLabel}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed">
            SAR Tracker saved the mission state change, but the safety backup did not complete:
            {' '}
            {lifecycleBackupFailure.message}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-rose-100">
            Keep the app open, capture diagnostics, and do not treat the backup copy as current
            until this alert clears after a matching successful lifecycle backup.
          </p>
        </div>
      )}
    </div>
  )
}







