import type { AppSettingsDraft } from '../../features/settings/settings-types'
import {
  NumberField,
  SettingsGroup,
  TextField,
  ToggleField,
} from './settings-fields'
import {
  parseInteger,
  updateDraft,
  type SettingsDraftSetter,
  type SettingsValidationErrors,
} from '../../features/settings/settings-draft-edit'

type AdvancedSectionProps = {
  readonly draft: AppSettingsDraft
  readonly setDraft: SettingsDraftSetter
  readonly validationErrors: SettingsValidationErrors
}

/**
 * Advanced: where mission data is stored and backed up, the tracking cache,
 * replay defaults, and repair actions. These protect mission data or are
 * rarely changed, so they sit away from everyday settings [DON-343].
 */
export function AdvancedSection({ draft, setDraft, validationErrors }: AdvancedSectionProps) {
  return (
    <>
      <div
        className="sar-inline-alert px-4 py-3 text-sm leading-relaxed"
        data-testid="settings-advanced-caution"
      >
        These settings protect mission data. Change them only when asked by support or your team lead.
      </div>

      <SettingsGroup
        title="Auto-save and storage"
        description="How often the open mission is saved, and where the mission file and its backup copy live."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleField
            checked={draft.missionDefaults.autoSaveEnabled}
            label="Auto-save enabled"
            testId="settings-auto-save-enabled"
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
      </SettingsGroup>

      <SettingsGroup
        title="Last known positions and replay"
        description="Keep the last good positions when Traccar is unreachable, and the default window for replaying past tracks."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleField
            checked={draft.dataSource.trackingCacheEnabled}
            label="Keep last known positions"
            testId="settings-tracking-cache-enabled"
            onChange={(checked) =>
              updateDraft(setDraft, (current) => ({
                ...current,
                dataSource: { ...current.dataSource, trackingCacheEnabled: checked },
              }))
            }
          />
          <ToggleField
            checked={draft.dataSource.replayEnabled}
            label="Replay defaults enabled"
            testId="settings-replay-enabled"
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
      </SettingsGroup>

      <SettingsGroup title="Repair" description="Reserved repair and support actions.">
        <button
          className="sar-button px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-stone-500 disabled:opacity-45"
          data-testid="settings-repair-layer-structure"
          disabled
          type="button"
        >
          Repair Layer Structure (M21)
        </button>
      </SettingsGroup>
    </>
  )
}
