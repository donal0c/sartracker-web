import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import {
  buildPackageManifestEntry,
  buildReadinessCertificate,
  checkManifestCoverage,
  classifyPackageCategory,
  type PackageManifestCoverageCheck,
} from '../features/map/official-map-manifest'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  createSettingsDraft,
  type AppSettingsDraft,
  type CoordinateDisplayMode,
  type OfficialMapPackageSettings,
} from '../features/settings/settings-types'
import {
  HOSTED_TRACCAR_HTTPS_BASE_URL,
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
import { exportDiagnosticsReport } from '../infrastructure/support-report/tauri-support-report-store'
import {
  persistCoordinateDisplayMode,
  readCoordinateDisplayMode,
} from '../lib/coordinate-preferences'
import { isElectronRuntimeAvailable } from '../lib/desktop-runtime'
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
  const [choosingOfficialMapSource, setChoosingOfficialMapSource] = useState(false)
  const [choosingOfficialMapPackage, setChoosingOfficialMapPackage] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [coordinateDisplayMode, setCoordinateDisplayMode] = useState(readCoordinateDisplayMode)
  const [coordinatorRosterText, setCoordinatorRosterText] = useState('')
  const [adminRosterText, setAdminRosterText] = useState('')
  const [baselineCloseSnapshot, setBaselineCloseSnapshot] = useState<string | null>(null)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
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
          const loadedDraft = createSettingsDraft(settings)
          const loadedCoordinateDisplayMode = readCoordinateDisplayMode()
          setDraft(loadedDraft)
          setCoordinatorRosterText(formatRosterInput(settings.missionDefaults.coordinatorRoster))
          setAdminRosterText(formatRosterInput(settings.missionDefaults.adminRoster))
          setCoordinateDisplayMode(loadedCoordinateDisplayMode)
          setBaselineCloseSnapshot(createSettingsCloseSnapshot(loadedDraft, loadedCoordinateDisplayMode))
          setShowDiscardConfirmation(false)
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
      onClose={handleRequestClose}
      maxWidth="max-w-3xl"
    >
      <WorkspaceHeader
        subtitle="Settings Workspace"
        titleId={SETTINGS_WORKSPACE_TITLE_ID}
        title="Operational Settings"
        onClose={handleRequestClose}
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
                        Hosted browser testing must use the HTTPS Traccar provider base URL. Direct HTTP Traccar server URLs are blocked by browsers from this HTTPS app.
                      </p>
                      <button
                        className="sar-button mt-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                        data-testid="use-hosted-traccar-https"
                        onClick={() =>
                          updateDraft(setDraft, (current) => ({
                            ...current,
                            dataSource: {
                              ...current.dataSource,
                              providerType: 'traccar_http',
                              baseUrl: settingsValidationContext.hostedRecommendedBaseUrl,
                            },
                          }))
                        }
                        type="button"
                      >
                        Use HTTPS Traccar
                      </button>
                    </div>
                  ) : null}

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
                description="The standard Kerry/West operating-area package is recommended for most operations. Mission-area or national packages can be imported for specific deployments but are larger and should be prepared in advance."
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

                  {isElectronRuntimeAvailable() ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <button
                        className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
                        data-testid="choose-official-map-source-file"
                        disabled={choosingOfficialMapSource}
                        onClick={() => {
                          void handleChooseOfficialMapSourceFile()
                        }}
                        type="button"
                      >
                        {choosingOfficialMapSource ? 'Choosing…' : 'Choose MapGenie File'}
                      </button>
                      <button
                        className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
                        data-testid="choose-official-map-package"
                        disabled={choosingOfficialMapPackage}
                        onClick={() => {
                          void handleChooseOfficialMapPackage()
                        }}
                        type="button"
                      >
                        {choosingOfficialMapPackage ? 'Choosing…' : 'Add Discovery Package'}
                      </button>
                    </div>
                  ) : null}

                  <OfficialMapPackageStatus
                    draft={draft}
                    onRemove={(packageId) =>
                      updateDraft(setDraft, (current) => ({
                        ...current,
                        officialMaps: {
                          ...current.officialMaps,
                          packages: current.officialMaps.packages.filter(
                            (mapPackage) => mapPackage.id !== packageId,
                          ),
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
          <div className="space-y-3">
            <p className="text-[11px] text-stone-500">
              Secrets stay out of mission SQLite and browser storage.
            </p>
            {showDiscardConfirmation ? (
              <div
                aria-describedby="settings-discard-confirmation-description"
                aria-labelledby="settings-discard-confirmation-title"
                className="border border-amber-500/50 bg-amber-950/50 p-3 text-sm text-amber-100"
                data-testid="settings-discard-confirmation"
                role="alertdialog"
              >
                <p className="font-semibold" id="settings-discard-confirmation-title">
                  Discard unsaved settings?
                </p>
                <p className="mt-1 text-xs text-amber-100/80" id="settings-discard-confirmation-description">
                  Unsaved operational settings will be lost.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="sar-button px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                    data-testid="settings-keep-editing"
                    onClick={() => setShowDiscardConfirmation(false)}
                    type="button"
                  >
                    Keep Editing
                  </button>
                  <button
                    className="border border-rose-400/60 bg-rose-950/70 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-100"
                    data-testid="settings-discard-changes"
                    onClick={handleDiscardChanges}
                    type="button"
                  >
                    Discard Changes
                  </button>
                </div>
              </div>
            ) : null}
          </div>
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

  function handleRequestClose(): void {
    if (!hasUnsavedSettingsDraft()) {
      onClose()
      return
    }

    setShowDiscardConfirmation(true)
  }

  function handleDiscardChanges(): void {
    setShowDiscardConfirmation(false)
    onClose()
  }

  function hasUnsavedSettingsDraft(): boolean {
    if (draft === null || baselineCloseSnapshot === null) {
      return false
    }

    return createSettingsCloseSnapshot(draft, coordinateDisplayMode) !== baselineCloseSnapshot
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
      const savedDraft = createSettingsDraft(saved)
      setDraft(savedDraft)
      setBaselineCloseSnapshot(createSettingsCloseSnapshot(savedDraft, coordinateDisplayMode))
      setShowDiscardConfirmation(false)
      const controller = getAppRuntimeController()
      onClose()
      if (controller !== null) {
        window.setTimeout(() => {
          void controller.reloadSettings({ forceConnect }).catch((reloadError: unknown) => {
            console.error('Runtime settings reload failed after saving settings.', reloadError)
          })
        }, 0)
      }
    } catch (saveError) {
      setError(toErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function handleChooseOfficialMapSourceFile(): Promise<void> {
    setChoosingOfficialMapSource(true)
    setError(null)
    setFeedback(null)

    try {
      const chooser = window.sartrackerElectron?.chooseOfficialMapSourceFilePath
      if (chooser === undefined) {
        throw new Error('Official map source file chooser is only available in the Electron app.')
      }
      const sourcePath = await chooser()
      if (sourcePath !== null) {
        updateDraft(setDraft, (current) => ({
          ...current,
          officialMaps: {
            ...current.officialMaps,
            sourceType: 'mapgenie_file',
            sourcePath,
          },
        }))
      }
    } catch (chooseError) {
      setError(toErrorMessage(chooseError))
    } finally {
      setChoosingOfficialMapSource(false)
    }
  }

  async function handleChooseOfficialMapPackage(): Promise<void> {
    setChoosingOfficialMapPackage(true)
    setError(null)
    setFeedback(null)

    try {
      const chooser = window.sartrackerElectron?.chooseOfficialMapPackagePath
      if (chooser === undefined) {
        throw new Error('Official map package chooser is only available in the Electron app.')
      }
      const importer = window.sartrackerElectron?.importOfficialMapPackage
      if (importer === undefined) {
        throw new Error('Official map package import is only available in the Electron app.')
      }
      const packagePath = await chooser()
      if (packagePath !== null) {
        const imported = await importer({
          sourcePath: packagePath,
          mapId: 'official_discovery_topo',
        })
        updateDraft(setDraft, (current) => ({
          ...current,
          officialMaps: {
            ...current.officialMaps,
            packages: addPendingOfficialMapPackage({
              packages: current.officialMaps.packages,
              packagePath: imported.packagePath,
              message: imported.message,
              sizeBytes: imported.sizeBytes,
            }),
          },
        }))
      }
    } catch (chooseError) {
      setError(toErrorMessage(chooseError))
    } finally {
      setChoosingOfficialMapPackage(false)
    }
  }
}

function OfficialMapPackageStatus({
  draft,
  onRemove,
}: {
  readonly draft: AppSettingsDraft
  readonly onRemove: (packageId: string) => void
}) {
  const packages = draft.officialMaps.packages
  const readyCount = packages.filter((mapPackage) => mapPackage.status === 'ready').length
  const [coverageChecks, setCoverageChecks] = useState<Record<string, PackageManifestCoverageCheck>>({})
  const [exporting, setExporting] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<string | null>(null)

  function handleCoverageCheck(mapPackage: OfficialMapPackageSettings): void {
    const map = (window as Window & { __SARTRACKER_MAP__?: { getBounds: () => { getWest: () => number; getSouth: () => number; getEast: () => number; getNorth: () => number } } }).__SARTRACKER_MAP__
    if (map === undefined) {
      setCoverageChecks((prev) => ({
        ...prev,
        [mapPackage.id]: {
          packageId: mapPackage.id,
          status: 'unknown',
          tone: 'neutral',
          label: 'Map not ready',
          detail: 'The map must be loaded to check coverage against the current view.',
        },
      }))
      return
    }

    try {
      const bounds = map.getBounds()
      const result = checkManifestCoverage(mapPackage, {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
      })
      setCoverageChecks((prev) => ({ ...prev, [mapPackage.id]: result }))
    } catch {
      setCoverageChecks((prev) => ({
        ...prev,
        [mapPackage.id]: {
          packageId: mapPackage.id,
          status: 'unknown',
          tone: 'neutral',
          label: 'Map not ready',
          detail: 'The map must be loaded to check coverage against the current view.',
        },
      }))
    }
  }

  async function handleExportCertificate(): Promise<void> {
    setExporting(true)
    setExportFeedback(null)

    try {
      const generatedAt = new Date().toISOString()
      const certificate = buildReadinessCertificate(packages, generatedAt)
      const fileName = `readiness-certificate-${generatedAt.replaceAll(':', '-').replaceAll('.', '-')}.txt`
      const exportedPath = await exportDiagnosticsReport(fileName, certificate.reportText)
      setExportFeedback(`Certificate exported: ${exportedPath}`)
    } catch {
      setExportFeedback('Export failed. Try again or use the diagnostics workspace.')
    } finally {
      setExporting(false)
    }
  }

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
        <>
          <div className="mt-3 grid gap-3">
            {packages.map((mapPackage) => (
              <OfficialMapPackageManifestCard
                key={mapPackage.id}
                mapPackage={mapPackage}
                coverageCheck={coverageChecks[mapPackage.id] ?? null}
                onCheckCoverage={() => handleCoverageCheck(mapPackage)}
                onRemove={() => onRemove(mapPackage.id)}
              />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              className="sar-button px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="export-readiness-certificate"
              disabled={exporting}
              onClick={() => { void handleExportCertificate() }}
              type="button"
            >
              {exporting ? 'Exporting…' : 'Export Readiness Certificate'}
            </button>
            {exportFeedback !== null ? (
              <span className="text-xs text-stone-300" data-testid="certificate-export-feedback">
                {exportFeedback}
              </span>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function OfficialMapPackageManifestCard({
  mapPackage,
  coverageCheck,
  onCheckCoverage,
  onRemove,
}: {
  readonly mapPackage: OfficialMapPackageSettings
  readonly coverageCheck: PackageManifestCoverageCheck | null
  readonly onCheckCoverage: () => void
  readonly onRemove: () => void
}) {
  const manifest = buildPackageManifestEntry(mapPackage)
  const categoryInfo = classifyPackageCategory(mapPackage.sizeBytes)

  return (
    <div
      className="border border-[var(--sar-line)] bg-stone-950/45 px-3 py-3 text-xs"
      data-testid={`package-manifest-${mapPackage.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-stone-100">{manifest.mapLabel}</p>
          <p className="mt-0.5 text-stone-400">{manifest.sourceType} · {manifest.tileFormat}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`border px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${packageCategoryBadgeClass(categoryInfo.tone)}`}
            data-testid={`package-category-${mapPackage.id}`}
          >
            {categoryInfo.label}
          </span>
          <span className={`border px-2 py-1 font-black uppercase tracking-[0.12em] ${officialPackageStatusClass(mapPackage.status)}`}>
            {formatOfficialPackageStatus(mapPackage.status)}
          </span>
        </div>
      </div>

      {categoryInfo.tone === 'warning' ? (
        <div
          className="mt-2 border border-amber-400/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-100"
          data-testid={`package-warning-${mapPackage.id}`}
        >
          {categoryInfo.guidance}
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-stone-400" data-testid={`package-guidance-${mapPackage.id}`}>
          {categoryInfo.guidance}
        </p>
      )}

      {manifest.statusMessage !== '' && manifest.status !== 'ready' ? (
        <p className="mt-2 text-stone-300">{manifest.statusMessage}</p>
      ) : null}

      <dl className="mt-2 grid gap-x-4 gap-y-1 text-stone-300 md:grid-cols-3" data-testid={`package-manifest-details-${mapPackage.id}`}>
        <div>
          <dt className="font-semibold text-stone-400">Zoom range</dt>
          <dd>{manifest.zoomRangeDisplay}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Tile count</dt>
          <dd>{manifest.tileCount > 0 ? manifest.tileCount.toLocaleString() : 'Unknown'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Package size</dt>
          <dd>{manifest.sizeDisplay}</dd>
        </div>
        {manifest.bounds !== null ? (
          <div className="md:col-span-3">
            <dt className="font-semibold text-stone-400">Coverage bounds</dt>
            <dd>{manifest.bounds.summary}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold text-stone-400">Created</dt>
          <dd>{manifest.createdAtDisplay}</dd>
        </div>
        <div>
          <dt className="font-semibold text-stone-400">Verified</dt>
          <dd>{manifest.verifiedAtDisplay}</dd>
        </div>
      </dl>

      {coverageCheck !== null ? (
        <div
          className={`mt-2 border px-3 py-2 ${coverageCheckClass(coverageCheck.tone)}`}
          data-testid={`coverage-check-result-${mapPackage.id}`}
        >
          <p className="font-semibold">{coverageCheck.label}</p>
          <p className="mt-0.5 text-stone-300">{coverageCheck.detail}</p>
        </div>
      ) : null}

      <div className="mt-2 flex gap-2">
        <button
          className="sar-button px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
          data-testid={`check-coverage-${mapPackage.id}`}
          onClick={onCheckCoverage}
          type="button"
        >
          Check View Coverage
        </button>
        <button
          className="sar-button px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
          data-testid={`remove-official-map-package-${mapPackage.id}`}
          onClick={onRemove}
          type="button"
        >
          Remove
        </button>
      </div>
    </div>
  )
}

function coverageCheckClass(tone: PackageManifestCoverageCheck['tone']): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/40 bg-emerald-950/40 text-emerald-100'
    case 'danger':
      return 'border-rose-400/40 bg-rose-950/40 text-rose-100'
    default:
      return 'border-stone-500/40 bg-stone-900/40 text-stone-200'
  }
}

function packageCategoryBadgeClass(tone: 'success' | 'warning' | 'neutral'): string {
  switch (tone) {
    case 'success':
      return 'border-emerald-400/50 bg-emerald-950/50 text-emerald-200'
    case 'warning':
      return 'border-amber-400/50 bg-amber-950/50 text-amber-200'
    default:
      return 'border-sky-400/50 bg-sky-950/50 text-sky-200'
  }
}

function addPendingOfficialMapPackage(input: {
  readonly packages: AppSettingsDraft['officialMaps']['packages']
  readonly packagePath: string
  readonly message: string
  readonly sizeBytes: number
}): AppSettingsDraft['officialMaps']['packages'] {
  const normalizedPath = input.packagePath.trim()
  if (normalizedPath === '') {
    return input.packages
  }

  const pendingPackage: AppSettingsDraft['officialMaps']['packages'][number] = {
    id: 'official_discovery_topo-pending',
    sourceType: 'mbtiles',
    mapId: 'official_discovery_topo',
    packagePath: normalizedPath,
    status: 'pending',
    bounds: null,
    minZoom: null,
    maxZoom: null,
    tileCount: 0,
    tileFormat: '',
    sizeBytes: input.sizeBytes,
    createdAt: '',
    verifiedAt: '',
    message: `${input.message} Pending validation after save.`,
  }

  return [
    ...input.packages.filter(
      (mapPackage) =>
        mapPackage.mapId !== pendingPackage.mapId ||
        mapPackage.packagePath !== pendingPackage.packagePath,
    ),
    pendingPackage,
  ]
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

/**
 * Creates the normalized snapshot used to decide whether closing Settings would
 * discard operator edits.
 */
function createSettingsCloseSnapshot(
  draft: AppSettingsDraft,
  coordinateDisplayMode: CoordinateDisplayMode,
): string {
  return JSON.stringify({
    draft,
    coordinateDisplayMode,
  })
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
    case 'pending':
      return 'Pending'
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
    case 'pending':
      return 'border-sky-300/60 bg-sky-950/50 text-sky-100'
    case 'ready':
      return 'border-emerald-300/60 bg-emerald-950/50 text-emerald-100'
    case 'missing':
    case 'invalid':
      return 'border-rose-300/60 bg-rose-950/50 text-rose-50'
  }
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
    hostedRecommendedBaseUrl: HOSTED_TRACCAR_HTTPS_BASE_URL,
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}
