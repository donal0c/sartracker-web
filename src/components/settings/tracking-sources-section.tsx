import type { AppSettingsDraft } from '../../features/settings/settings-types'
import type { SettingsValidationContext } from '../../features/settings/settings-validation'
import type { NormalizedTraccarGroup } from '../../features/tracking/tracking-types'
import { DefaultParticipantGroupField } from '../default-participant-group-field'
import {
  ChoiceButton,
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

type TrackingSourcesSectionProps = {
  readonly draft: AppSettingsDraft
  readonly setDraft: SettingsDraftSetter
  readonly validationErrors: SettingsValidationErrors
  readonly availableTraccarGroups: readonly NormalizedTraccarGroup[]
  readonly validationContext: SettingsValidationContext | undefined
}

/**
 * Tracking sources: the team's default Traccar group, pre-ticked at Start
 * (SAR-QA-026), then the Traccar connection and how often it is polled.
 */
export function TrackingSourcesSection(props: TrackingSourcesSectionProps) {
  const { draft, setDraft, validationErrors, validationContext } = props
  return (
    <>
      <SettingsGroup
        title="Team default group"
        description="Set your team's Traccar group once. It is ticked automatically when a new mission starts."
      >
        <DefaultParticipantGroupField
          groups={props.availableTraccarGroups}
          onChange={(value) =>
            updateDraft(setDraft, (current) => ({
              ...current,
              missionDefaults: { ...current.missionDefaults, defaultParticipantGroup: value },
            }))
          }
          value={draft.missionDefaults.defaultParticipantGroup ?? null}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Traccar connection"
        description="Where live positions come from. Secrets stay out of mission SQLite and browser storage."
        testId="settings-data-sources"
      >
        {validationContext?.hostedBrowserMode === true ? (
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
                    baseUrl: validationContext.hostedRecommendedBaseUrl,
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
              testId="settings-provider-none"
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
              testId="settings-provider-traccar"
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
      </SettingsGroup>

      <SettingsGroup
        title="Connecting and polling"
        description="Auto-connect decides only whether tracking starts when the app opens. Saving settings later keeps a connection that is already live."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <ToggleField
            checked={draft.dataSource.autoConnect}
            label="Auto-connect on startup"
            testId="settings-auto-connect"
            onChange={(checked) =>
              updateDraft(setDraft, (current) => ({
                ...current,
                dataSource: { ...current.dataSource, autoConnect: checked },
              }))
            }
          />
          <ToggleField
            checked={draft.missionDefaults.autoRefreshEnabled}
            label="Auto-refresh enabled"
            testId="settings-auto-refresh-enabled"
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
        </div>
      </SettingsGroup>
    </>
  )
}
