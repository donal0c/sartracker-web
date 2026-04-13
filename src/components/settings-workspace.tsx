import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  createSettingsDraft,
  type AppSettingsDraft,
} from '../features/settings/settings-types'
import {
  formatRosterInput,
  normalizeRosterInput,
  validateSettingsDraft,
} from '../features/settings/settings-validation'
import {
  loadAppSettings,
  saveAppSettings,
  testTrackingConnection,
} from '../infrastructure/settings-store/tauri-settings-store'
import {
  persistCoordinateDisplayMode,
  readCoordinateDisplayMode,
} from '../lib/coordinate-preferences'

type SettingsWorkspaceProps = {
  readonly open: boolean
  readonly onClose: () => void
}

/**
 * Renders the operator settings workspace used for standalone configuration parity.
 */
export function SettingsWorkspace({ open, onClose }: SettingsWorkspaceProps) {
  const [draft, setDraft] = useState<AppSettingsDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [coordinateDisplayMode, setCoordinateDisplayMode] = useState(readCoordinateDisplayMode)

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setFeedback(null)

    void loadAppSettings()
      .then((settings) => {
        if (!cancelled) {
          setDraft(createSettingsDraft(settings))
          setCoordinateDisplayMode(readCoordinateDisplayMode())
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(toErrorMessage(loadError))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open])

  const validationErrors = useMemo(
    () => (draft === null ? {} : validateSettingsDraft(draft)),
    [draft],
  )

  return (
    <WorkspaceOverlay open={open} onClose={onClose} maxWidth="max-w-3xl">
      <WorkspaceHeader
        subtitle="Settings Workspace"
        title="Operational Settings"
        onClose={onClose}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6" data-testid="settings-workspace">
          {loading || draft === null ? (
            <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 text-sm text-stone-400">
              Loading settings…
            </div>
          ) : (
            <>
              <Section title="Mission Defaults" description="Operational defaults reused across missions.">
                <div className="grid gap-4 md:grid-cols-2">
                  <ToggleField
                    checked={draft.missionDefaults.autoRefreshEnabled}
                    label="Auto-refresh enabled"
                    onChange={(checked) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        missionDefaults: { ...current.missionDefaults, autoRefreshEnabled: checked },
                      }))
                    }
                  />
                  <NumberField
                    label="Auto-refresh interval (seconds)"
                    testId="settings-auto-refresh-interval"
                    value={String(draft.missionDefaults.autoRefreshIntervalSeconds)}
                    error={validationErrors.autoRefreshIntervalSeconds}
                    onChange={(value) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        missionDefaults: {
                          ...current.missionDefaults,
                          autoRefreshIntervalSeconds: parseInteger(value, current.missionDefaults.autoRefreshIntervalSeconds),
                        },
                      }))
                    }
                  />
                  <ToggleField
                    checked={draft.missionDefaults.autoSaveEnabled}
                    label="Auto-save enabled"
                    onChange={(checked) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        missionDefaults: { ...current.missionDefaults, autoSaveEnabled: checked },
                      }))
                    }
                  />
                  <NumberField
                    label="Auto-save interval (seconds)"
                    testId="settings-auto-save-interval"
                    value={String(draft.missionDefaults.autoSaveIntervalSeconds)}
                    error={validationErrors.autoSaveIntervalSeconds}
                    onChange={(value) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        missionDefaults: {
                          ...current.missionDefaults,
                          autoSaveIntervalSeconds: parseInteger(value, current.missionDefaults.autoSaveIntervalSeconds),
                        },
                      }))
                    }
                  />
                </div>

                <TextField
                  label="Primary mission root"
                  testId="settings-primary-root"
                  value={draft.missionDefaults.primaryMissionRoot}
                  error={undefined}
                  onChange={(value) =>
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: { ...current.missionDefaults, primaryMissionRoot: value },
                    }))
                  }
                />
                <TextField
                  label="Backup mission root"
                  testId="settings-backup-root"
                  value={draft.missionDefaults.backupMissionRoot}
                  error={undefined}
                  onChange={(value) =>
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: { ...current.missionDefaults, backupMissionRoot: value },
                    }))
                  }
                />

                <TextAreaField
                  label="Coordinator roster"
                  testId="settings-coordinator-roster"
                  value={formatRosterInput(draft.missionDefaults.coordinatorRoster)}
                  onChange={(value) =>
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: {
                        ...current.missionDefaults,
                        coordinatorRoster: normalizeRosterInput(value),
                      },
                    }))
                  }
                />
                <TextAreaField
                  label="Admin roster"
                  testId="settings-admin-roster"
                  value={formatRosterInput(draft.missionDefaults.adminRoster)}
                  onChange={(value) =>
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: {
                        ...current.missionDefaults,
                        adminRoster: normalizeRosterInput(value),
                      },
                    }))
                  }
                />

                <div className="space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                    Coordinate display mode
                  </p>
                  <div className="flex gap-3">
                    <ChoiceButton
                      active={coordinateDisplayMode === 'wgs84_first'}
                      label="Lat/Lon first"
                      onClick={() => setCoordinateDisplayMode('wgs84_first')}
                    />
                    <ChoiceButton
                      active={coordinateDisplayMode === 'tm65_first'}
                      label="TM65 first"
                      onClick={() => setCoordinateDisplayMode('tm65_first')}
                    />
                  </div>
                </div>
              </Section>

              <Section title="Data Sources" description="Provider configuration and startup behavior.">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Provider
                    </p>
                    <div className="flex gap-3">
                      <ChoiceButton
                        active={draft.dataSource.providerType === 'none'}
                        label="None"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: {
                              ...current.dataSource,
                              providerType: 'none',
                              replayEnabled: false,
                              replayStart: '',
                            },
                          }))
                        }
                      />
                      <ChoiceButton
                        active={draft.dataSource.providerType === 'traccar_http'}
                        label="Traccar HTTP"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: { ...current.dataSource, providerType: 'traccar_http' },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <TextField
                    label="Provider base URL"
                    testId="settings-provider-url"
                    value={draft.dataSource.baseUrl}
                    error={validationErrors.baseUrl}
                    onChange={(value) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        dataSource: { ...current.dataSource, baseUrl: value },
                      }))
                    }
                  />

                  <div className="space-y-2">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
                      Authentication mode
                    </p>
                    <div className="flex gap-3">
                      <ChoiceButton
                        active={draft.dataSource.authMode === 'basic'}
                        label="Basic"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: { ...current.dataSource, authMode: 'basic', clearSecret: false },
                          }))
                        }
                      />
                      <ChoiceButton
                        active={draft.dataSource.authMode === 'bearer'}
                        label="Bearer"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: { ...current.dataSource, authMode: 'bearer', clearSecret: false },
                          }))
                        }
                      />
                    </div>
                  </div>

                  {draft.dataSource.authMode === 'basic' ? (
                    <TextField
                      label="Email"
                      testId="settings-provider-email"
                      value={draft.dataSource.email}
                      error={validationErrors.email}
                      onChange={(value) =>
                        updateDraft(setDraft, (current) => ({
                          ...current,
                          dataSource: { ...current.dataSource, email: value },
                        }))
                      }
                    />
                  ) : null}

                  <TextField
                    label={draft.dataSource.authMode === 'basic' ? 'Password' : 'Bearer token'}
                    testId="settings-provider-secret"
                    value={draft.dataSource.secretInput}
                    error={validationErrors.secretInput}
                    onChange={(value) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        dataSource: { ...current.dataSource, secretInput: value, clearSecret: false },
                      }))
                    }
                  />

                  <ToggleField
                    checked={draft.dataSource.secretPresent && !draft.dataSource.clearSecret}
                    label="Stored secret present"
                    disabled
                    onChange={() => undefined}
                  />
                  {draft.dataSource.secretPresent ? (
                    <ToggleField
                      checked={draft.dataSource.clearSecret}
                      label="Clear stored secret on save"
                      onChange={(checked) =>
                        updateDraft(setDraft, (current) => ({
                          ...current,
                          dataSource: { ...current.dataSource, clearSecret: checked },
                        }))
                      }
                    />
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <ToggleField
                      checked={draft.dataSource.autoConnect}
                      label="Auto-connect on startup"
                      onChange={(checked) =>
                        updateDraft(setDraft, (current) => ({
                          ...current,
                          dataSource: { ...current.dataSource, autoConnect: checked },
                        }))
                      }
                    />
                    <ToggleField
                      checked={draft.dataSource.trackingCacheEnabled}
                      label="Tracking cache enabled"
                      testId="settings-tracking-cache-enabled"
                      onChange={(checked) =>
                        updateDraft(setDraft, (current) => ({
                          ...current,
                          dataSource: { ...current.dataSource, trackingCacheEnabled: checked },
                        }))
                      }
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <ToggleField
                      checked={draft.dataSource.replayEnabled}
                      label="Replay defaults enabled"
                      disabled={draft.dataSource.providerType !== 'traccar_http'}
                      onChange={(checked) =>
                        updateDraft(setDraft, (current) => ({
                          ...current,
                          dataSource: { ...current.dataSource, replayEnabled: checked },
                        }))
                      }
                    />
                  </div>

                  {draft.dataSource.replayEnabled ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <TextField
                        label="Replay start"
                        testId="settings-replay-start"
                        type="datetime-local"
                        value={draft.dataSource.replayStart}
                        error={validationErrors.replayStart}
                        onChange={(value) =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: { ...current.dataSource, replayStart: value },
                          }))
                        }
                      />
                      <NumberField
                        label="Replay duration (hours)"
                        testId="settings-replay-duration"
                        value={String(draft.dataSource.replayDurationHours)}
                        error={validationErrors.replayDurationHours}
                        onChange={(value) =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: {
                              ...current.dataSource,
                              replayDurationHours: parseInteger(value, current.dataSource.replayDurationHours),
                            },
                          }))
                        }
                      />
                    </div>
                  ) : null}
                </div>
              </Section>

              <Section title="Advanced Settings" description="Reserved repair and support actions.">
                <button
                  className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-500"
                  disabled
                  type="button"
                >
                  Repair Layer Structure (M21)
                </button>
              </Section>

              {(error ?? feedback) ? (
                <div
                  className={`rounded-xl border px-4 py-3 text-sm ${
                    error
                      ? 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                      : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
                  }`}
                  data-testid="settings-feedback"
                >
                  {error ?? feedback}
                </div>
              ) : null}
            </>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-stone-800 px-6 py-4">
          <p className="text-[11px] text-stone-500">
            Secrets stay out of mission SQLite and browser storage.
          </p>
          <div className="flex gap-3">
            <button
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300 disabled:opacity-40"
              data-testid="settings-test-connection"
              disabled={draft === null || testing || Object.keys(validationErrors).length > 0}
              onClick={() => {
                if (draft !== null) {
                  void handleTestConnection(draft)
                }
              }}
              type="button"
            >
              {testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              className="rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-300 disabled:opacity-40"
              data-testid="settings-save"
              disabled={draft === null || saving || Object.keys(validationErrors).length > 0}
              onClick={() => {
                void handleSave(false)
              }}
              type="button"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="rounded-lg bg-amber-500 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-950 disabled:opacity-40"
              data-testid="settings-save-connect"
              disabled={
                draft === null ||
                saving ||
                Object.keys(validationErrors).length > 0 ||
                !draft.missionDefaults.autoRefreshEnabled
              }
              onClick={() => {
                void handleSave(true)
              }}
              type="button"
            >
              {saving ? 'Saving…' : 'Save & Connect'}
            </button>
          </div>
        </footer>
    </WorkspaceOverlay>
  )

  async function handleTestConnection(currentDraft: AppSettingsDraft): Promise<void> {
    setTesting(true)
    setError(null)
    setFeedback(null)

    try {
      const result = await testTrackingConnection(currentDraft)
      if (result.ok) {
        setFeedback(result.message)
      } else {
        setError(result.message)
      }
    } catch (testError) {
      setError(toErrorMessage(testError))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(forceConnect: boolean): Promise<void> {
    if (draft === null) {
      return
    }

    setSaving(true)
    setError(null)
    setFeedback(null)

    try {
      const saved = await saveAppSettings(draft)
      persistCoordinateDisplayMode(coordinateDisplayMode)
      setDraft(createSettingsDraft(saved))
      const controller = getAppRuntimeController()
      if (controller !== null) {
        await controller.reloadSettings({ forceConnect })
      }
      setFeedback(forceConnect ? 'Settings saved and tracking reloaded.' : 'Settings saved.')
    } catch (saveError) {
      setError(toErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }
}

function Section(props: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-stone-800 bg-stone-900/30 p-5">
      <div className="mb-4">
        <h3 className="font-bold uppercase tracking-wider text-stone-200 text-[12px]">
          {props.title}
        </h3>
        <p className="mt-1 text-sm text-stone-500">{props.description}</p>
      </div>
      <div className="space-y-4">{props.children}</div>
    </section>
  )
}

function TextField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
  readonly error: string | undefined
  readonly type?: string
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
        {props.label}
      </span>
      <input
        className="w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-500/50"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        type={props.type ?? 'text'}
        value={props.value}
      />
      {props.error ? <span className="text-xs text-rose-300">{props.error}</span> : null}
    </label>
  )
}

function NumberField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
  readonly error: string | undefined
}) {
  return <TextField {...props} type="number" />
}

function TextAreaField(props: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly testId?: string
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
        {props.label}
      </span>
      <textarea
        className="min-h-24 w-full rounded-lg border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100 outline-none focus:border-amber-500/50"
        data-testid={props.testId}
        onChange={(event) => props.onChange(event.target.value)}
        value={props.value}
      />
    </label>
  )
}

function ToggleField(props: {
  readonly label: string
  readonly checked: boolean
  readonly onChange: (checked: boolean) => void
  readonly disabled?: boolean
  readonly testId?: string
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-lg border border-stone-800 bg-stone-950/70 px-3 py-2">
      <span className="text-sm text-stone-200">{props.label}</span>
      <input
        checked={props.checked}
        data-testid={props.testId}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  )
}

function ChoiceButton(props: {
  readonly active: boolean
  readonly label: string
  readonly onClick: () => void
}) {
  return (
    <button
      className={`rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
        props.active
          ? 'bg-amber-500 text-stone-950'
          : 'border border-stone-700 bg-stone-900 text-stone-300'
      }`}
      onClick={props.onClick}
      type="button"
    >
      {props.label}
    </button>
  )
}

function updateDraft(
  setDraft: Dispatch<SetStateAction<AppSettingsDraft | null>>,
  updater: (current: AppSettingsDraft) => AppSettingsDraft,
) {
  setDraft((current) => (current === null ? current : updater(current)))
}

function parseInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
