import { useEffect, useMemo, useRef, useState } from 'react'

import { getAppRuntimeController } from '../features/runtime/app-runtime-controller'
import { WorkspaceOverlay, WorkspaceHeader } from './workspace-overlay'
import {
  createSettingsDraft,
  type AppSettingsDraft,
  type CoordinateDisplayMode,
} from '../features/settings/settings-types'
import type { SettingsFocusTarget } from '../features/settings/settings-workspace-store'
import {
  HOSTED_TRACCAR_HTTPS_BASE_URL,
  formatRosterInput,
  type SettingsValidationContext,
  validateSettingsDraft,
} from '../features/settings/settings-validation'
import {
  SETTINGS_SECTIONS,
  countValidationErrorsBySection,
  initialSettingsSection,
  type SettingsSectionId,
} from '../features/settings/settings-sections'
import { describeTrackingStopOnSave } from '../features/settings/settings-save-intent'
import { useSettingsApplyStore } from '../features/settings/settings-apply-store'
import {
  loadAppSettings,
  saveAppSettings,
  testTrackingConnection,
} from '../infrastructure/settings-store/tauri-settings-store'
import {
  persistCoordinateDisplayMode,
  readCoordinateDisplayMode,
} from '../lib/coordinate-preferences'
import { isTauriRuntimeAvailable } from '../lib/tauri-runtime'
import { useParticipantStore } from '../features/participants/participant-store'
import { AdvancedSection } from './settings/advanced-section'
import { MappingSection } from './settings/mapping-section'
import { MissionDefaultsSection } from './settings/mission-defaults-section'
import { SettingsApplyFailureNotice } from './settings/settings-apply-failure-notice'
import { SettingsSectionNav } from './settings/settings-section-nav'
import { TrackingSourcesSection } from './settings/tracking-sources-section'
import { WeatherLinksSection } from './settings/weather-links-section'

type SettingsWorkspaceProps = {
  readonly open: boolean
  readonly onClose: () => void
  /** Field to focus once settings have loaded, e.g. when a governance decision needs an admin. */
  readonly focusTarget?: SettingsFocusTarget | null
}

/** A save the operator must confirm because it would stop live tracking. */
type PendingTrackingStop = {
  readonly forceConnect: boolean
  readonly reason: string
}

const SETTINGS_WORKSPACE_TITLE_ID = 'settings-workspace-title'

/**
 * Renders the operator Settings workspace as a menu of five sections
 * [DON-343]. Edits in every section share one draft, so switching sections
 * never loses an edit and the unsaved-edits warning covers all of them.
 */
export function SettingsWorkspace({ open, onClose, focusTarget = null }: SettingsWorkspaceProps) {
  const [draft, setDraft] = useState<AppSettingsDraft | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [coordinateDisplayMode, setCoordinateDisplayMode] = useState(readCoordinateDisplayMode)
  const availableTraccarGroups = useParticipantStore((state) => state.availableGroups)
  const [coordinatorRosterText, setCoordinatorRosterText] = useState('')
  const [adminRosterText, setAdminRosterText] = useState('')
  const [baselineCloseSnapshot, setBaselineCloseSnapshot] = useState<string | null>(null)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)
  const [pendingTrackingStop, setPendingTrackingStop] = useState<PendingTrackingStop | null>(null)
  const [activeSection, setActiveSection] = useState<SettingsSectionId>(() => initialSettingsSection(focusTarget))
  const settingsValidationContext = useMemo(createSettingsValidationContext, [])
  const adminRosterFieldRef = useRef<HTMLTextAreaElement>(null)
  const settingsLoaded = open && !loading && draft !== null

  useEffect(() => {
    if (open) {
      setActiveSection(initialSettingsSection(focusTarget))
    }
  }, [open, focusTarget])

  useEffect(() => {
    if (!settingsLoaded || focusTarget !== 'admin-roster') {
      return
    }

    const field = adminRosterFieldRef.current
    field?.scrollIntoView({ block: 'center' })
    field?.focus()
  }, [settingsLoaded, focusTarget])

  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    setFeedback(null)
    setPendingTrackingStop(null)

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
  const errorCounts = useMemo(() => countValidationErrorsBySection(validationErrors), [validationErrors])
  const blockingSections = SETTINGS_SECTIONS.filter((section) => errorCounts[section.id] > 0)
  const hasValidationErrors = Object.keys(validationErrors).length > 0

  return (
    <>
      <WorkspaceOverlay
        labelledBy={SETTINGS_WORKSPACE_TITLE_ID}
        open={open}
        onClose={handleRequestClose}
        maxWidth="max-w-5xl"
      >
        <WorkspaceHeader
          subtitle="Settings Workspace"
          titleId={SETTINGS_WORKSPACE_TITLE_ID}
          title="Operational Settings"
          onClose={handleRequestClose}
        />

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <SettingsSectionNav
            activeSection={activeSection}
            errorCounts={errorCounts}
            onSelect={setActiveSection}
          />
          <div
            className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6"
            data-active-section={activeSection}
            data-testid="settings-workspace"
          >
            {loading || draft === null ? (
              <div className="sar-module p-5 text-sm text-stone-200">
                Loading settings…
              </div>
            ) : (
              <>
                <SectionHeading section={activeSection} />
                {renderActiveSection(draft)}
                {(error ?? feedback) ? (
                  <div
                    className={`border px-4 py-3 text-sm ${
                      error
                        ? 'border-rose-500/40 bg-rose-950/40 text-rose-200'
                        : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-200'
                    }`}
                    data-testid="settings-feedback"
                    role={error ? 'alert' : 'status'}
                  >
                    {error ?? feedback}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <footer className="sar-workspace-footer flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            {blockingSections.length > 0 ? (
              <p className="text-xs font-semibold text-rose-300" data-testid="settings-blocking-errors">
                Fix before saving: {blockingSections.map((section) => section.label).join(', ')}.
              </p>
            ) : (
              <p className="text-[11px] text-stone-500">
                Secrets stay out of mission SQLite and browser storage.
              </p>
            )}
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
            {pendingTrackingStop !== null ? (
              <div
                aria-describedby="settings-stop-tracking-description"
                aria-labelledby="settings-stop-tracking-title"
                className="border border-rose-400/60 bg-rose-950/60 p-3 text-sm text-rose-50"
                data-testid="settings-stop-tracking-confirmation"
                role="alertdialog"
              >
                <p className="font-semibold" id="settings-stop-tracking-title">
                  Saving will stop live tracking.
                </p>
                <p className="mt-1 text-xs text-rose-50/85" id="settings-stop-tracking-description">
                  {pendingTrackingStop.reason} Saving these settings will stop live tracking now. Positions stop updating until tracking is switched back on.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="sar-button px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                    data-testid="settings-stop-tracking-cancel"
                    onClick={() => setPendingTrackingStop(null)}
                    type="button"
                  >
                    Keep Editing
                  </button>
                  <button
                    className="border border-rose-400/60 bg-rose-900/80 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-rose-50"
                    data-testid="settings-stop-tracking-confirm"
                    onClick={() => {
                      const confirmed = pendingTrackingStop
                      setPendingTrackingStop(null)
                      void saveAndApply(confirmed.forceConnect)
                    }}
                    type="button"
                  >
                    Stop Tracking and Save
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-3 sm:justify-end">
            <button
              className="sar-button px-4 py-2 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40"
              data-testid="settings-test-connection"
              disabled={draft === null || testing || hasValidationErrors}
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
              disabled={draft === null || saving || hasValidationErrors}
              onClick={() => handleSave(false)}
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
                hasValidationErrors ||
                !draft.missionDefaults.autoRefreshEnabled
              }
              onClick={() => handleSave(true)}
              type="button"
            >
              {saving ? 'Saving…' : 'Save, Connect & Close'}
            </button>
          </div>
        </footer>
      </WorkspaceOverlay>
      <SettingsApplyFailureNotice />
    </>
  )

  /** Renders the fields of the section chosen in the menu. */
  function renderActiveSection(currentDraft: AppSettingsDraft) {
    switch (activeSection) {
      case 'mission-defaults':
        return (
          <MissionDefaultsSection
            adminRosterFieldRef={adminRosterFieldRef}
            adminRosterText={adminRosterText}
            coordinatorRosterText={coordinatorRosterText}
            draft={currentDraft}
            onAdminRosterTextChange={setAdminRosterText}
            onCoordinatorRosterTextChange={setCoordinatorRosterText}
            setDraft={setDraft}
            validationErrors={validationErrors}
          />
        )
      case 'tracking-sources':
        return (
          <TrackingSourcesSection
            availableTraccarGroups={availableTraccarGroups}
            draft={currentDraft}
            setDraft={setDraft}
            validationContext={settingsValidationContext}
            validationErrors={validationErrors}
          />
        )
      case 'mapping':
        return (
          <MappingSection
            coordinateDisplayMode={coordinateDisplayMode}
            draft={currentDraft}
            onCoordinateDisplayModeChange={setCoordinateDisplayMode}
            onError={(message) => {
              setError(message)
              setFeedback(null)
            }}
            setDraft={setDraft}
            validationContext={settingsValidationContext}
          />
        )
      case 'weather-links':
        return (
          <WeatherLinksSection
            draft={currentDraft}
            setDraft={setDraft}
            validationErrors={validationErrors}
          />
        )
      case 'advanced':
        return (
          <AdvancedSection
            draft={currentDraft}
            setDraft={setDraft}
            validationErrors={validationErrors}
          />
        )
    }
  }

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

  /**
   * Starts a save, first asking the operator when the saved settings would
   * stop a tracking connection that is live now [DON-352, audit M-67].
   */
  function handleSave(forceConnect: boolean): void {
    if (draft === null) {
      return
    }
    const controller = getAppRuntimeController()
    const stopReason = controller?.isTrackingConnected() === true ? describeTrackingStopOnSave(draft) : null
    if (stopReason !== null) {
      setShowDiscardConfirmation(false)
      setPendingTrackingStop({ forceConnect, reason: stopReason })
      return
    }
    void saveAndApply(forceConnect)
  }

  /**
   * Saves the draft, closes Settings, then applies the saved settings to the
   * running app. A failure to apply is shown to the operator after Settings
   * has closed, never only logged.
   */
  async function saveAndApply(forceConnect: boolean): Promise<void> {
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
          controller.reloadSettings({ forceConnect }).then(
            () => useSettingsApplyStore.getState().clearFailure(),
            (reloadError: unknown) => {
              console.error('Runtime settings reload failed after saving settings.', reloadError)
              useSettingsApplyStore.getState().reportFailure(
                `Settings were saved but could not be applied to the running app: ${toErrorMessage(reloadError)} Open Devices and use Reconnect, or restart SAR Tracker.`,
              )
            },
          )
        }, 0)
      }
    } catch (saveError) {
      setError(toErrorMessage(saveError))
    } finally {
      setSaving(false)
    }
  }
}

/** The open section's title and what it holds. */
function SectionHeading({ section }: { readonly section: SettingsSectionId }) {
  const definition = SETTINGS_SECTIONS.find((candidate) => candidate.id === section)
  if (definition === undefined) {
    return null
  }
  return (
    <div data-testid="settings-section-heading">
      <h3 className="text-sm font-bold uppercase tracking-wider text-stone-100">{definition.label}</h3>
      <p className="sar-helper-text mt-1">{definition.description}</p>
    </div>
  )
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
