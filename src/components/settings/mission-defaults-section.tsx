import type { Ref } from 'react'

import type { AppSettingsDraft } from '../../features/settings/settings-types'
import { normalizeRosterInput } from '../../features/settings/settings-validation'
import {
  NumberField,
  SettingsGroup,
  TextAreaField,
} from './settings-fields'
import {
  parseInteger,
  updateDraft,
  type SettingsDraftSetter,
  type SettingsValidationErrors,
} from '../../features/settings/settings-draft-edit'

type MissionDefaultsSectionProps = {
  readonly draft: AppSettingsDraft
  readonly setDraft: SettingsDraftSetter
  readonly validationErrors: SettingsValidationErrors
  readonly coordinatorRosterText: string
  readonly onCoordinatorRosterTextChange: (value: string) => void
  readonly adminRosterText: string
  readonly onAdminRosterTextChange: (value: string) => void
  readonly adminRosterFieldRef: Ref<HTMLTextAreaElement>
}

/**
 * Mission defaults: who may coordinate or administer missions, and when a still
 * device is flagged for attention. These apply to every new mission.
 */
export function MissionDefaultsSection({
  draft,
  setDraft,
  validationErrors,
  coordinatorRosterText,
  onCoordinatorRosterTextChange,
  adminRosterText,
  onAdminRosterTextChange,
  adminRosterFieldRef,
}: MissionDefaultsSectionProps) {
  return (
    <>
      <SettingsGroup
        title="Rosters"
        description="Names offered when a mission starts, and who can approve governance decisions. One name per line."
        testId="settings-rosters"
      >
        <TextAreaField
          label="Coordinator roster"
          testId="settings-coordinator-roster"
          value={coordinatorRosterText}
          onChange={(value) => {
            onCoordinatorRosterTextChange(value)
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
          ref={adminRosterFieldRef}
          label="Admin roster"
          testId="settings-admin-roster"
          value={adminRosterText}
          onChange={(value) => {
            onAdminRosterTextChange(value)
            updateDraft(setDraft, (current) => ({
              ...current,
              missionDefaults: {
                ...current.missionDefaults,
                adminRoster: normalizeRosterInput(value),
              },
            }))
          }}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Stationary attention"
        description="When a device that has not moved is flagged for a coordinator's attention."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <NumberField
            label="Stationary attention window (minutes)"
            testId="settings-stationary-heartbeat"
            value={String(draft.missionDefaults.stationaryAttentionHeartbeatMinutes ?? 20)}
            error={validationErrors.stationaryAttentionHeartbeatMinutes}
            onChange={(value) => updateDraft(setDraft, (current) => ({
              ...current,
              missionDefaults: { ...current.missionDefaults, stationaryAttentionHeartbeatMinutes: parseInteger(value, current.missionDefaults.stationaryAttentionHeartbeatMinutes ?? 20) },
            }))}
          />
          <NumberField
            label="Stationary movement floor (metres)"
            testId="settings-stationary-movement-floor"
            value={String(draft.missionDefaults.stationaryAttentionMovementFloorM ?? 15)}
            error={validationErrors.stationaryAttentionMovementFloorM}
            onChange={(value) => updateDraft(setDraft, (current) => ({
              ...current,
              missionDefaults: { ...current.missionDefaults, stationaryAttentionMovementFloorM: parseInteger(value, current.missionDefaults.stationaryAttentionMovementFloorM ?? 15) },
            }))}
          />
        </div>
        <p
          className="text-xs leading-relaxed text-stone-300"
          data-testid="settings-stationary-attention-note"
        >
          Stationary attention is accuracy-aware derived guidance. It does not alter or hide the accepted tracker fix.
        </p>
      </SettingsGroup>
    </>
  )
}
