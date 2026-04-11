import { useEffect, useMemo, useState } from 'react'

import { useDiagnosticsStore } from '../features/diagnostics/diagnostics-store'
import { useDiagnosticsWorkspaceStore } from '../features/diagnostics/diagnostics-workspace-store'

/**
 * Renders the operator diagnostics workspace and repair/export actions.
 */
export function DiagnosticsWorkspace() {
  const open = useDiagnosticsWorkspaceStore((state) => state.open)
  const closeWorkspace = useDiagnosticsWorkspaceStore((state) => state.closeWorkspace)
  const controller = useDiagnosticsStore((state) => state.controller)
  const snapshot = useDiagnosticsStore((state) => state.snapshot)
  const selectedMissionId = useDiagnosticsStore((state) => state.selectedMissionId)
  const loading = useDiagnosticsStore((state) => state.loading)
  const repairing = useDiagnosticsStore((state) => state.repairing)
  const exporting = useDiagnosticsStore((state) => state.exporting)
  const error = useDiagnosticsStore((state) => state.error)
  const runtimeFeedback = useDiagnosticsStore((state) => state.feedback)
  const exportPath = useDiagnosticsStore((state) => state.exportPath)
  const [localFeedback, setLocalFeedback] = useState<string | null>(null)

  useEffect(() => {
    if (!open || controller === null) {
      return
    }

    setLocalFeedback(null)
    void controller.load()
  }, [controller, open])

  const feedback = localFeedback ?? runtimeFeedback
  const missionOptions = useMemo(() => snapshot?.missionOptions ?? [], [snapshot])

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-stone-950/80 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-4xl flex-col border-l border-stone-800 bg-stone-950 shadow-2xl">
        <header className="flex items-center justify-between border-b border-stone-800 px-6 py-5">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-cyan-300/80">
              Diagnostics Workspace
            </p>
            <h2 className="mt-1 font-mono text-2xl font-bold text-stone-50">Operational Diagnostics</h2>
          </div>
          <button
            className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300"
            onClick={() => closeWorkspace()}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6" data-testid="diagnostics-workspace">
          {loading || snapshot === null ? (
            <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 text-sm text-stone-400">
              Loading diagnostics…
            </div>
          ) : (
            <div className="space-y-6">
              <section className="grid gap-4 lg:grid-cols-2">
                <DiagnosticsSection rows={snapshot.summaryRows} title="Summary" />
                <DiagnosticsSection rows={snapshot.storageRows} title="Storage Health" />
                <DiagnosticsSection rows={snapshot.trackingRows} title="Tracking Snapshot" />
                <DiagnosticsSection rows={snapshot.configurationRows} title="Configuration" />
              </section>

              <section className="rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Repair Tooling
                    </p>
                    <p className="text-sm text-stone-300">{snapshot.repair.targetMissionLabel}</p>
                    <p className="text-xs text-stone-500">
                      Cached controller snapshots are used here. No live network probes run from diagnostics.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-50"
                      data-testid="diagnostics-copy-report"
                      disabled={snapshot === null}
                      onClick={() => void handleCopy(snapshot.supportReport)}
                      type="button"
                    >
                      Copy Report
                    </button>
                    <button
                      className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-200 disabled:opacity-50"
                      data-testid="diagnostics-export-report"
                      disabled={exporting || snapshot === null}
                      onClick={() => {
                        setLocalFeedback(null)
                        void controller?.exportSupportReport()
                      }}
                      type="button"
                    >
                      {exporting ? 'Exporting...' : 'Export Report'}
                    </button>
                    <button
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 disabled:opacity-50"
                      data-testid="diagnostics-repair-layer-catalog"
                      disabled={!snapshot.repair.available || repairing}
                      onClick={() => {
                        setLocalFeedback(null)
                        void controller?.repairLayerCatalog()
                      }}
                      type="button"
                    >
                      {repairing ? 'Repairing...' : 'Reset Layer Catalog Metadata'}
                    </button>
                  </div>
                </div>

                {feedback !== null ? (
                  <p className="mt-4 text-sm text-emerald-300" data-testid="diagnostics-feedback">
                    {feedback}
                  </p>
                ) : null}
                {error !== null ? (
                  <p className="mt-4 text-sm text-rose-300" data-testid="diagnostics-error">
                    {error}
                  </p>
                ) : null}
                {exportPath !== null ? (
                  <p className="mt-3 break-all text-xs text-stone-400" data-testid="diagnostics-export-path">
                    {exportPath}
                  </p>
                ) : null}
              </section>

              <section className="rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Repair Target
                    </p>
                    <p className="mt-1 text-sm text-stone-300">
                      Select the mission whose saved layer metadata should be reset and rebuilt from canonical state.
                    </p>
                  </div>
                  <select
                    className="rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
                    data-testid="diagnostics-mission-select"
                    disabled={loading || controller === null}
                    onChange={(event) => {
                      setLocalFeedback(null)
                      void controller?.selectMission(event.target.value)
                    }}
                    value={selectedMissionId ?? ''}
                  >
                    {missionOptions.length === 0 ? (
                      <option value="">No missions available</option>
                    ) : (
                      missionOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </section>

              {snapshot.warnings.length > 0 ? (
                <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                    Warnings
                  </p>
                  <ul className="mt-3 space-y-2 text-sm text-amber-100">
                    {snapshot.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  Support Report Preview
                </p>
                <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-stone-800 bg-stone-950/70 p-4 text-xs text-stone-300">
                  {snapshot.supportReport}
                </pre>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  async function handleCopy(report: string): Promise<void> {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) {
      setLocalFeedback('Clipboard is unavailable in this environment.')
      return
    }

    await navigator.clipboard.writeText(report)
    setLocalFeedback('Diagnostics report copied to clipboard.')
    controller?.clearFeedback()
  }
}

function DiagnosticsSection(props: {
  readonly title: string
  readonly rows: readonly {
    readonly label: string
    readonly value: string
    readonly tone?: 'default' | 'success' | 'warning' | 'danger'
  }[]
}) {
  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-900/40 p-5">
      <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">{props.title}</p>
      <div className="mt-4 space-y-3">
        {props.rows.map((row) => (
          <div className="flex items-start justify-between gap-4 text-sm" key={`${props.title}-${row.label}`}>
            <span className="text-stone-400">{row.label}</span>
            <span className={rowToneClassName(row.tone)}>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function rowToneClassName(tone: 'default' | 'success' | 'warning' | 'danger' = 'default'): string {
  switch (tone) {
    case 'success':
      return 'text-emerald-300 text-right'
    case 'warning':
      return 'text-amber-200 text-right'
    case 'danger':
      return 'text-rose-300 text-right'
    default:
      return 'text-stone-100 text-right'
  }
}
