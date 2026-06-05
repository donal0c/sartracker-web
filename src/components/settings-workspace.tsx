import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  createSettingsDraft,
  type AppSettingsDraft,
} from '../features/settings/settings-types'
import {
  HOSTED_TRACCAR_PROXY_BASE_URL,
  MAX_WEATHER_LINKS,
  formatRosterInput,
  normalizeRosterInput,
  type SettingsValidationContext,
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
import { getRenderableMapLabel } from '../lib/map-config'
import { isTauriRuntimeAvailable } from '../lib/tauri-runtime'

type SettingsWorkspaceProps = {
  readonly open: boolean
  readonly onClose: () => void
}

const SETTINGS_WORKSPACE_TITLE_ID = 'settings-workspace-title'

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
  const [coordinatorRosterText, setCoordinatorRosterText] = useState('')
  const [adminRosterText, setAdminRosterText] = useState('')
  const settingsValidationContext = useMemo(createSettingsValidationContext, [])

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
          setCoordinatorRosterText(formatRosterInput(settings.missionDefaults.coordinatorRoster))
          setAdminRosterText(formatRosterInput(settings.missionDefaults.adminRoster))
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
    () => (draft === null ? {} : validateSettingsDraft(draft, settingsValidationContext)),
    [draft, settingsValidationContext],
  )

  return (
    <WorkspaceOverlay
      labelledBy={SETTINGS_WORKSPACE_TITLE_ID}
      open={open}
      onClose={onClose}
      maxWidth="max-w-3xl"
    >
      <WorkspaceHeader
        subtitle="Settings Workspace"
        titleId={SETTINGS_WORKSPACE_TITLE_ID}
        title="Operational Settings"
        onClose={onClose}
      />

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6" data-testid="settings-workspace">
          {loading || draft === null ? (
            <div className="sar-module p-5 text-sm text-stone-200">
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
                  value={coordinatorRosterText}
                  onChange={(value) => {
                    setCoordinatorRosterText(value)
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: {
                        ...current.missionDefaults,
                        coordinatorRoster: normalizeRosterInput(value),
                      },
                    }))
                  }}
                />
                <TextAreaField
                  label="Admin roster"
                  testId="settings-admin-roster"
                  value={adminRosterText}
                  onChange={(value) => {
                    setAdminRosterText(value)
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      missionDefaults: {
                        ...current.missionDefaults,
                        adminRoster: normalizeRosterInput(value),
                      },
                    }))
                  }}
                />

                <div className="space-y-2">
                  <p className="sar-section-label">
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
                  {settingsValidationContext?.hostedBrowserMode === true ? (
                    <div
                      className="sar-inline-alert px-4 py-3 text-sm leading-relaxed"
                      data-testid="hosted-traccar-url-guidance"
                    >
                      <p>
                        Hosted browser testing must use the HTTPS proxy as the Traccar provider base URL. Direct HTTP Traccar server URLs are blocked by browsers from this HTTPS app.
                      </p>
                      <button
                        className="sar-button mt-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                        data-testid="use-hosted-traccar-proxy"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: {
                              ...current.dataSource,
                              providerType: 'traccar_http',
                              baseUrl: settingsValidationContext.hostedProxyBaseUrl,
                            },
                          }))
                        }
                        type="button"
                      >
                        Use Hosted Proxy
                      </button>
                    </div>
                  ) : null}

                  <OfficialMapPackageStatus draft={draft} />

                  <div className="space-y-2">
                    <p className="sar-section-label">
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
                    <p className="sar-section-label">
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

              <Section
                title="Official Maps"
                description="Licensed map access stays local. Configure the MapGenie source file in Electron/local app builds."
              >
                <div className="space-y-4">
                  <div
                    className="border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-200"
                    data-testid="official-map-source-status"
                  >
                    <p className="font-semibold text-stone-100">{draft.officialMaps.message}</p>
                    <dl className="mt-2 grid gap-2 text-xs text-stone-300 md:grid-cols-3">
                      <div>
                        <dt className="sar-section-label">Status</dt>
                        <dd>{formatOfficialMapStatus(draft.officialMaps.status)}</dd>
                      </div>
                      <div>
                        <dt className="sar-section-label">Username</dt>
                        <dd>{draft.officialMaps.username || 'Not configured'}</dd>
                      </div>
                      <div>
                        <dt className="sar-section-label">Services</dt>
                        <dd>{draft.officialMaps.serviceCount}</dd>
                      </div>
                    </dl>
                  </div>

                  {settingsValidationContext?.hostedBrowserMode === true ? (
                    <div
                      className="sar-inline-alert px-4 py-3 text-sm leading-relaxed"
                      data-testid="hosted-official-map-guidance"
                    >
                      Hosted browser testing does not load private MapGenie credentials or licensed map files. Official maps stay not configured here unless a controlled hosted test source is added later.
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <p className="sar-section-label">Official map source</p>
                    <div className="flex gap-3">
                      <ChoiceButton
                        active={draft.officialMaps.sourceType === 'none'}
                        label="None"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            officialMaps: {
                              ...current.officialMaps,
                              sourceType: 'none',
                              sourcePath: '',
                            },
                          }))
                        }
                      />
                      <ChoiceButton
                        active={draft.officialMaps.sourceType === 'mapgenie_file'}
                        label="MapGenie file"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            officialMaps: {
                              ...current.officialMaps,
                              sourceType: 'mapgenie_file',
                            },
                          }))
                        }
                      />
                    </div>
                  </div>

                  <TextField
                    label="MapGenie source file"
                    testId="official-map-source-path"
                    value={draft.officialMaps.sourcePath}
                    error={undefined}
                    onChange={(value) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        officialMaps: {
                          ...current.officialMaps,
                          sourceType: value.trim() === '' ? current.officialMaps.sourceType : 'mapgenie_file',
                          sourcePath: value,
                        },
                      }))
                    }
                  />
                </div>
              </Section>

              <Section
                title="Weather Links"
                description="External weather resources only. SAR Tracker does not fetch, parse, or forecast weather."
              >
                {draft.weather.links.length === 0 ? (
                  <div
                    className="border border-dashed border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-300"
                    data-testid="weather-links-empty"
                  >
                    No weather links configured. Add named links such as Met Éireann for quick access from the top mast.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {draft.weather.links.map((link, index) => (
                      <div
                        className="grid gap-3 border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] p-3 md:grid-cols-[1fr_1.6fr_auto]"
                        key={index}
                      >
                        <TextField
                          label="Name"
                          testId={`weather-link-name-${index}`}
                          value={link.name}
                          error={validationErrors[`weather.links.${index}.name`]}
                          onChange={(value) =>
                            updateDraft(setDraft, (current) => ({
                              ...current,
                              weather: {
                                links: current.weather.links.map((existing, linkIndex) =>
                                  linkIndex === index ? { ...existing, name: value } : existing,
                                ),
                              },
                            }))
                          }
                        />
                        <TextField
                          label="External URL"
                          testId={`weather-link-url-${index}`}
                          value={link.url}
                          error={validationErrors[`weather.links.${index}.url`]}
                          onChange={(value) =>
                            updateDraft(setDraft, (current) => ({
                              ...current,
                              weather: {
                                links: current.weather.links.map((existing, linkIndex) =>
                                  linkIndex === index ? { ...existing, url: value } : existing,
                                ),
                              },
                            }))
                          }
                        />
                        <button
                          className="sar-button self-end px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                          data-testid={`weather-link-remove-${index}`}
                          onClick={() =>
                            updateDraft(setDraft, (current) => ({
                              ...current,
                              weather: {
                                links: current.weather.links.filter((_, linkIndex) => linkIndex !== index),
                              },
                            }))
                          }
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {validationErrors['weather.links'] ? (
                  <p className="text-xs font-semibold text-rose-300">
                    {validationErrors['weather.links']}
                  </p>
                ) : null}
                <button
                  className="sar-button px-4 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
                  data-testid="weather-link-add"
                  disabled={draft.weather.links.length >= MAX_WEATHER_LINKS}
                  onClick={() =>
                    updateDraft(setDraft, (current) => ({
                      ...current,
                      weather: {
                        links: [...current.weather.links, { name: '', url: '' }],
                      },
                    }))
                  }
                  type="button"
                >
                  Add Weather Link
                </button>
              </Section>

              <Section title="Advanced Settings" description="Reserved repair and support actions.">
                <button
                  className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-500 disabled:opacity-45"
                  disabled
                  type="button"
                >
                  Repair Layer Structure (M21)
                </button>
              </Section>

              {(error ?? feedback) ? (
                <div
                  className={`border px-4 py-3 text-sm ${
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

        <footer className="sar-workspace-footer flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-stone-500">
            Secrets stay out of mission SQLite and browser storage.
          </p>
          <div className="flex flex-wrap gap-3 sm:justify-end">
            <button
              className="sar-button px-4 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
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
              className="sar-button px-4 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="settings-save"
              disabled={draft === null || saving || Object.keys(validationErrors).length > 0}
              onClick={() => {
                void handleSave(false)
              }}
              type="button"
            >
              {saving ? 'Saving…' : 'Save & Close'}
            </button>
            <button
              className="sar-action-primary px-4 py-2 text-[11px] font-bold uppercase tracking-wider transition disabled:opacity-40"
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
              {saving ? 'Saving…' : 'Save, Connect & Close'}
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
      onClose()
    } catch (saveError) {
      setError(toErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }
}

function OfficialMapPackageStatus({ draft }: { readonly draft: AppSettingsDraft }) {
  const packages = draft.officialMaps.packages
  const readyCount = packages.filter((mapPackage) => mapPackage.status === 'ready').length

  return (
    <div
      className="border border-[var(--sar-line)] bg-[var(--sar-panel-sunken)] px-4 py-3 text-sm text-stone-200"
      data-testid="official-map-package-status"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-stone-100">Official offline packages</p>
        <span className="text-xs font-bold text-stone-300">
          {readyCount}/{packages.length} ready
        </span>
      </div>
      {packages.length === 0 ? (
        <p className="mt-2 text-xs text-stone-300">
          No local official map package is registered. Electron can still use a configured online MapGenie source when available.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {packages.map((mapPackage) => (
            <div
              className="grid gap-2 border border-[var(--sar-line)] bg-stone-950/45 px-3 py-2 text-xs md:grid-cols-[1.2fr_auto_auto]"
              key={mapPackage.id}
            >
              <div>
                <p className="font-semibold text-stone-100">
                  {getRenderableMapLabel(mapPackage.mapId)}
                </p>
                <p className="mt-0.5 text-stone-300">
                  {formatOfficialPackageDetail(mapPackage)}
                </p>
              </div>
              <span className={`self-start border px-2 py-1 font-black uppercase tracking-[0.12em] ${officialPackageStatusClass(mapPackage.status)}`}>
                {formatOfficialPackageStatus(mapPackage.status)}
              </span>
              <span className="self-start text-right font-semibold text-stone-300">
                {formatPackageVerifiedAt(mapPackage.verifiedAt)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Section(props: {
  readonly title: string
  readonly description: string
  readonly children: ReactNode
}) {
  return (
    <section className="sar-module p-5">
      <div className="mb-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wider text-stone-100">
          {props.title}
        </h3>
        <p className="sar-helper-text mt-1">{props.description}</p>
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
      <span className="sar-section-label">
        {props.label}
      </span>
      <input
        className="sar-input w-full px-3 py-2 text-sm"
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
      <span className="sar-section-label">
        {props.label}
      </span>
      <textarea
        className="sar-input min-h-24 w-full px-3 py-2 text-sm"
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
    <label className="sar-toggle flex items-center justify-between gap-4 px-3 py-2">
      <span className="text-sm text-stone-100">{props.label}</span>
      <input
        checked={props.checked}
        className="h-4 w-4 cursor-pointer accent-amber-400"
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
      className={`border px-3 py-2 text-[11px] font-bold uppercase tracking-wider transition ${
        props.active
          ? 'border-amber-300/50 bg-amber-500 text-stone-950'
          : 'sar-button'
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

function formatOfficialMapStatus(status: AppSettingsDraft['officialMaps']['status']): string {
  switch (status) {
    case 'configured':
      return 'Configured'
    case 'missing':
      return 'Missing'
    case 'invalid':
      return 'Invalid'
    default:
      return 'Not configured'
  }
}

function formatOfficialPackageStatus(
  status: AppSettingsDraft['officialMaps']['packages'][number]['status'],
): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'missing':
      return 'Missing'
    case 'invalid':
      return 'Unreadable'
  }
}

function officialPackageStatusClass(
  status: AppSettingsDraft['officialMaps']['packages'][number]['status'],
): string {
  switch (status) {
    case 'ready':
      return 'border-emerald-300/60 bg-emerald-950/50 text-emerald-100'
    case 'missing':
    case 'invalid':
      return 'border-rose-300/60 bg-rose-950/50 text-rose-50'
  }
}

function formatOfficialPackageDetail(
  mapPackage: AppSettingsDraft['officialMaps']['packages'][number],
): string {
  if (mapPackage.status !== 'ready') {
    return mapPackage.message
  }

  return [
    mapPackage.tileCount > 0 ? `${mapPackage.tileCount.toLocaleString()} tiles` : 'tile count unavailable',
    formatPackageZoomRange(mapPackage),
    mapPackage.tileFormat !== '' ? mapPackage.tileFormat.toUpperCase() : 'format unknown',
  ].join(' · ')
}

function formatPackageZoomRange(
  mapPackage: AppSettingsDraft['officialMaps']['packages'][number],
): string {
  if (mapPackage.minZoom !== null && mapPackage.maxZoom !== null) {
    return `z${mapPackage.minZoom}-z${mapPackage.maxZoom}`
  }
  return 'zoom range unavailable'
}

function formatPackageVerifiedAt(value: string): string {
  if (value.trim() === '') {
    return 'Not verified'
  }
  return `Verified ${new Date(value).toLocaleDateString()}`
}

function createSettingsValidationContext(): SettingsValidationContext | undefined {
  if (typeof window === 'undefined' || isTauriRuntimeAvailable()) {
    return undefined
  }

  if (window.location.protocol !== 'https:') {
    return undefined
  }

  return {
    hostedBrowserMode: true,
    hostedProxyBaseUrl: HOSTED_TRACCAR_PROXY_BASE_URL,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
