import { useEffect, useMemo, useState, type ReactNode } from 'react'

import { useMissionStore } from '../features/mission/mission-store'
import { isMissionModelEnabled } from '../features/runtime/mission-model-flag'
import {
  participantRequestedEarlierHistory,
  resolveParticipantEffectiveFrom,
  type ParticipantHistoryStart,
} from '../features/participants/participant-history-start'
import { useParticipantStore } from '../features/participants/participant-store'
import { useParticipantSelectionViewModel } from '../features/participants/use-participant-selection-view-model'
import { LegacyRosterRecoveryForm } from '../features/participants/legacy-roster-recovery-form'
import { removalPeopleCount, removalPromptText } from '../features/participants/participant-removal-prompt'
import type { ParticipantProvenance } from '../infrastructure/mission-store/tauri-mission-store'

const COORDINATOR_ACTOR = 'Mission coordinator'
const NO_EARLIER_HISTORY_STATUS = 'History: from when added; no earlier history requested'
const NO_EARLIER_POSITIONS_PLAIN = 'Positions from when added; no earlier ones asked for'

type ParticipantControlsSectionProps = {
  readonly phase: 'idle' | 'active' | 'paused' | 'recovery'
  /** True when the operator has entered a start offset (lookback) on the start step. */
  readonly lookbackRequested?: boolean
  /** Simplified workspace: plain words, with individual devices tucked behind the groups. */
  readonly variant?: 'standard' | 'simplified'
  /**
   * During a mission, which part to render: `warnings` (always on screen) or
   * `admin` (the list and add form, folded behind "Change who's taking part").
   * Omitted renders both together (DON-368).
   */
  readonly part?: 'warnings' | 'admin'
}

/** Renders explicit mission-start selection and append-only participant management. */
export function ParticipantControlsSection({ phase, lookbackRequested = false, variant = 'standard', part }: ParticipantControlsSectionProps) {
  const simplified = variant === 'simplified'
  const selection = useParticipantSelectionViewModel()
  const controller = useParticipantStore((state) => state.controller)
  const participants = useParticipantStore((state) => state.participants)
  const availableDevices = useParticipantStore((state) => state.availableDevices)
  const availableGroups = useParticipantStore((state) => state.availableGroups)
  const membershipNotices = useParticipantStore((state) => state.membershipNotices)
  const envelope = useParticipantStore((state) => state.envelope)
  const saving = useParticipantStore((state) => state.saving)
  const rosterError = useParticipantStore((state) => state.rosterError)
  const defaultGroupId = useParticipantStore((state) => state.defaultGroupId)
  const defaultGroupMissing = useParticipantStore((state) => state.defaultGroupMissing)
  const error = useParticipantStore((state) => state.error)
  const catalogueRefreshing = useParticipantStore((state) => state.catalogueRefreshing)
  const catalogueError = useParticipantStore((state) => state.catalogueError)
  const [addKind, setAddKind] = useState<'device' | 'group'>('device')
  const [addRef, setAddRef] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [historyStart, setHistoryStart] = useState<ParticipantHistoryStart | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  // Remove asks first (DON-373): the participant whose confirm is open, if any.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const missionStartTime = useMissionStore((state) => state.currentMission?.start_time ?? null)

  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.removed_at === null),
    [participants],
  )

  // Mission setup opening re-reads the Traccar groups, so a group created
  // since startup is selectable without restarting [DON-330].
  useEffect(() => {
    if (phase === 'idle' && controller !== null) void controller.refreshCatalogue()
  }, [phase, controller])

  if (!isMissionModelEnabled()) return null

  function chooseHistoryStart(choice: ParticipantHistoryStart): void {
    setHistoryStart(choice)
    setAddError(null)
  }

  if (phase === 'idle') {
    const defaultGroupTicked = defaultGroupId !== null && selection.availableGroups.some((group) => group.groupId === defaultGroupId && group.selected)
    return (
      <section className="space-y-3 border-t border-[var(--sar-line)] pt-4" data-testid="participant-selection-step">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-300">
              {simplified ? "Who's taking part" : 'Mission participants'}
            </p>
            {simplified ? null : <p className="mt-1 text-xs leading-relaxed text-stone-300">
              {defaultGroupId !== null && selection.availableGroups.some((group) => group.groupId === defaultGroupId && group.selected)
                ? "Select the Traccar groups and individual devices taking part. Your team's default group is ticked; untick it if it is not taking part."
                : 'Select the Traccar groups and individual devices taking part. Nothing is pre-selected.'}
            </p>}
          </div>
          {simplified && defaultGroupTicked ? null : <span className="sar-status-chip px-2 py-1 font-mono text-[11px]" data-testid="participant-selected-count">
            {selection.selectedDeviceCount} selected
          </span>}
        </div>

        <CatalogueRefreshStatus
          error={catalogueError}
          onRetry={() => void controller?.refreshCatalogue()}
          refreshing={catalogueRefreshing}
        />
        {selection.rosterError !== null ? (
          <p className="sar-inline-alert p-2 text-xs text-amber-200" data-testid="participant-roster-error">
            {selection.rosterError}
          </p>
        ) : null}
        {selection.identityWarning !== null ? (
          <p className="sar-inline-alert p-2 text-xs text-amber-200" data-testid="participant-identity-warning">
            {selection.identityWarning}
          </p>
        ) : null}
        {selection.envelopeWarning !== null ? (
          <p className="border border-rose-400/50 bg-rose-950/40 p-2 text-xs font-semibold text-rose-100" data-testid="participant-envelope-warning">
            {selection.envelopeWarning}
          </p>
        ) : null}

        {defaultGroupMissing ? (
          <p className="sar-inline-alert p-2 text-xs text-amber-200" data-testid="participant-default-group-missing">
            Your team&apos;s default group (set in Settings) is not on the tracking server, so nothing was pre-ticked. Choose the groups taking part below.
          </p>
        ) : null}
        {simplified && !defaultGroupTicked && defaultGroupId === null ? (
          <p className="text-[13px] text-stone-300" data-testid="ws-no-default-group">
            Tick your team below. To have it ticked each time, set your team&apos;s group in Settings.
          </p>
        ) : null}
        {simplified && defaultGroupTicked ? (
          <p className="sar-readout p-2 text-[15px] font-semibold" data-testid="ws-default-group-summary">
            ✓ {selection.availableGroups.filter((group) => group.selected).map((group) => group.name).join(', ')} ({selection.selectedDeviceCount} people)
          </p>
        ) : null}
        <ParticipantFold fold={simplified && defaultGroupTicked}>
        <div className={simplified ? 'space-y-3' : 'grid gap-3 sm:grid-cols-2'}>
          <ParticipantPickerList
            emptyText="No Traccar groups are available. Device-level selection remains available."
            heading="Groups"
            items={selection.availableGroups.map((group) => ({
              id: group.groupId,
              label: group.name,
              detail: `${group.currentMemberCount} current members${group.groupId === defaultGroupId ? ' · team default' : ''}`,
              selected: group.selected,
              onToggle: () => selection.toggleGroup(group.groupId),
            }))}
            testId="participant-group-picker"
          />
          {(() => {
            const devicePicker = <ParticipantPickerList
              emptyText="No device roster is available. You may start with none and add participants after reconnecting."
              heading="Devices"
              items={selection.availableDevices.map((device) => ({
                id: device.deviceId,
                label: device.name,
                detail: simplified
                  ? [device.reportingNow ? 'reporting now' : null, device.coveredBySelectedGroup ? 'in the group above' : null].filter(Boolean).join(' · ')
                  : `${device.deviceId}${device.reportingNow ? ' · reporting now' : ''}${device.coveredBySelectedGroup ? ' · included by selected group' : ''}`,
                selected: device.selected,
                disabled: device.coveredBySelectedGroup,
                onToggle: () => selection.toggleDevice(device.deviceId),
              }))}
              testId="participant-device-picker"
            />
            return simplified ? (
              <details data-testid="ws-pick-devices">
                <summary className="cursor-pointer select-none py-1 text-[13px] font-semibold text-stone-200">Add one person at a time</summary>
                <div className="mt-2">{devicePicker}</div>
              </details>
            ) : devicePicker
          })()}
        </div>
        </ParticipantFold>
        {lookbackRequested ? (
          <p className="sar-inline-alert p-2 text-xs text-amber-100" data-testid="participant-lookback-notice">
            {simplified
              ? 'Roll back only brings in earlier tracks for people ticked here before Start.'
              : 'Start offset: Earlier history is only fetched for participants selected here before Start. A participant added after Start needs History from: Mission start to include it.'}
          </p>
        ) : null}
        {selection.selectedDeviceCount === 0 ? (
          <p className="text-xs text-stone-300" data-testid="participant-none-selected-notice">
            {simplified
              ? 'Nobody ticked. You can still start, but nobody will show on the map until you add them.'
              : 'No participants selected. The mission may start, but reporting devices will remain outside mission evidence and off the operational map until a coordinator adds them.'}
          </p>
        ) : null}
      </section>
    )
  }

  const legacyRosters = participants.filter((participant) => participant.kind === 'group'
    && participant.starting_member_device_ids_json == null && participant.backfill_scope_unknown
    && !participant.backfill_scope_error)
  const removedGroupHistory = participants.filter((participant) => participant.removed_at !== null
    && (participant.backfill_scope_attested || participant.backfill_scope_unknown))
  // A group whose earlier positions could not be worked out is a problem the
  // operator must see, so in the simplified panel it sits above the fold. A
  // removed group counts too: Finish still waits for its history, and its own
  // line points to this warning.
  const groupHistoryProblems = simplified
    ? participants.filter((participant) => participant.kind === 'group' && Boolean(participant.backfill_scope_error))
    : []

  const warnings = (
    <>
      {envelope.warning !== null ? (
        <p className="border border-rose-400/50 bg-rose-950/40 p-2 text-xs font-semibold text-rose-100" data-testid="participant-envelope-warning">
          {envelope.warning}
        </p>
      ) : null}
      {rosterError !== null ? (
        <p className="sar-inline-alert p-2 text-xs text-amber-200" data-testid="participant-roster-error">
          {rosterError}
        </p>
      ) : null}
      {membershipNotices.map((notice) => (
        <p className="sar-inline-alert p-2 text-xs text-amber-100" key={notice} data-testid="participant-membership-notice">
          {notice}
        </p>
      ))}
      {membershipNotices.length > 0 ? (
        <button
          className="sar-button px-2 py-1 text-xs"
          data-testid="participant-membership-notices-ack"
          onClick={() => controller?.clearMembershipNotices()}
          type="button"
        >
          {simplified ? 'Got it' : 'Acknowledge membership notices'}
        </button>
      ) : null}
      {error !== null ? <p className="text-xs text-rose-300" data-testid="participant-error" role="alert">{error}</p> : null}
      {groupHistoryProblems.map((participant) => (
        <p className="sar-inline-alert p-2 text-xs text-amber-100" data-testid="participant-history-problem" key={participant.id}>
          Earlier positions for {participant.removed_at === null ? '' : 'removed group '}{participant.team_name ?? participant.traccar_group_id ?? 'this group'} could not be loaded: {participant.backfill_scope_error}
        </p>
      ))}
      {legacyRosters.map((participant) => (
        <LegacyRosterRecoveryForm key={participant.id} participant={participant} saving={saving}
          onConfirm={async (input) => controller?.resolveLegacyRoster(input) ?? null} />
      ))}
      {removedGroupHistory.map((participant) => <p className="text-xs" key={participant.id}>
          Removed group {participant.team_name ?? participant.mission_team_id}: {simplified ? formatGroupEarlierPositionsPlain(participant) : formatGroupBackfillStatus(participant)}
        </p>)}
    </>
  )

  if (part === 'warnings') {
    const anyWarning = envelope.warning !== null || rosterError !== null || membershipNotices.length > 0
      || error !== null || groupHistoryProblems.length > 0 || legacyRosters.length > 0 || removedGroupHistory.length > 0
    return anyWarning ? <div className="space-y-2" data-testid="participant-warnings">{warnings}</div> : null
  }

  return (
    <section className="sar-module space-y-3 p-3" data-testid="participant-management">
      {simplified ? null : <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-300">Participants</p>
        <span className="font-mono text-[11px] text-stone-200">{envelope.activeDeviceCount} active devices</span>
      </div>}
      {part === 'admin' ? null : warnings}

      <div className="space-y-2" data-testid="participant-active-list">
        {activeParticipants.length === 0 ? (
          <p className="text-xs text-stone-300">No mission participants are currently selected.</p>
        ) : activeParticipants.map((participant) => {
          const label = participant.kind === 'group'
            ? participant.team_name ?? participant.traccar_group_id ?? 'this group'
            : deviceLabel(participant.traccar_device_id, availableDevices)
          return (
          <div
            className="sar-readout flex flex-wrap items-start justify-between gap-3 p-2"
            data-participant-kind={participant.kind}
            data-traccar-device-id={participant.traccar_device_id ?? undefined}
            key={participant.id}
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-stone-100">{label}</p>
              <p className="mt-1 text-[11px] text-stone-300">
                {simplified
                  ? `${participant.kind === 'group' ? 'Group' : 'One person'}${plainProvenance(participant.provenance)} · from ${formatTimestamp(participant.effective_from)}`
                  : `${participant.kind} · ${participant.provenance} · effective ${formatTimestamp(participant.effective_from)}`}
              </p>
              {participant.kind === 'device' && participant.backfill_completed !== undefined ? (
                <p className="mt-1 text-[11px] text-stone-300" data-testid="participant-backfill-status">
                  {participantRequestedEarlierHistory(participant)
                    ? simplified
                      ? `Earlier positions: ${participant.backfill_completed === 1 ? 'loaded' : 'still loading'}`
                      : `History backfill: ${participant.backfill_completed === 1 ? 'complete' : 'pending / retrying'}`
                    : simplified ? NO_EARLIER_POSITIONS_PLAIN : NO_EARLIER_HISTORY_STATUS}
                </p>
              ) : null}
              {participant.kind === 'group' &&
              (typeof participant.backfill_member_count === 'number' ||
                participant.backfill_scope_unknown === true) ? (
                <p className="mt-1 text-[11px] text-stone-300" data-testid="participant-backfill-status">
                  {participantRequestedEarlierHistory(participant) ||
                    participant.backfill_scope_unknown === true ||
                    participant.backfill_scope_error
                    ? simplified ? formatGroupEarlierPositionsPlain(participant) : `History backfill: ${formatGroupBackfillStatus(participant)}`
                    : simplified ? NO_EARLIER_POSITIONS_PLAIN : NO_EARLIER_HISTORY_STATUS}
                </p>
              ) : null}
            </div>
            {confirmRemoveId === participant.id ? null : (
              <button
                className="sar-action-danger px-2 py-1 text-[11px]"
                data-testid={`participant-remove-${participant.id}`}
                disabled={saving}
                onClick={() => setConfirmRemoveId(participant.id)}
                type="button"
              >
                Remove
              </button>
            )}
            {confirmRemoveId === participant.id ? (
              <div
                className="w-full rounded-xl border border-rose-400/40 bg-rose-950/40 p-3 text-rose-100"
                data-testid="participant-remove-confirmation"
                role="group"
                aria-label={`Confirm removing ${label}`}
              >
                <p className="text-xs font-semibold">
                  {removalPromptText(label, removalPeopleCount(participant, availableDevices, catalogueError === null))}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    className="rounded-lg border border-rose-300/50 bg-rose-400/20 px-3 py-1.5 text-xs font-semibold text-rose-50"
                    data-testid="participant-remove-confirm-btn"
                    disabled={saving}
                    onClick={() => {
                      setConfirmRemoveId(null)
                      void controller?.removeParticipant(
                        participant.id,
                        COORDINATOR_ACTOR,
                        'Coordinator removed participant',
                      )
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                  <button
                    className="rounded-lg border border-stone-600 bg-stone-950 px-3 py-1.5 text-xs font-semibold text-stone-200"
                    data-testid="participant-remove-keep-btn"
                    onClick={() => setConfirmRemoveId(null)}
                    type="button"
                  >
                    Keep
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          )
        })}
      </div>

      <div className="grid gap-2 border-t border-[var(--sar-line)] pt-3 sm:grid-cols-2">
        <select className="sar-input px-2 py-2 text-xs" data-testid="participant-add-kind" onChange={(event) => {
          const nextKind = event.target.value as 'device' | 'group'
          setAddKind(nextKind)
          setAddRef('')
          // Opening Add group re-reads the Traccar groups [DON-330].
          if (nextKind === 'group') void controller?.refreshCatalogue()
        }} value={addKind}>
          <option value="device">{simplified ? 'One person' : 'Individual device'}</option>
          <option value="group">{simplified ? 'A group' : 'Traccar group'}</option>
        </select>
        {addKind === 'group' ? (
          <div className="sm:col-span-2">
            <CatalogueRefreshStatus
              error={catalogueError}
              onRetry={() => void controller?.refreshCatalogue()}
              refreshing={catalogueRefreshing}
            />
          </div>
        ) : null}
        <select className="sar-input px-2 py-2 text-xs" data-testid="participant-add-ref" onChange={(event) => setAddRef(event.target.value)} value={addRef}>
          <option value="">Choose…</option>
          {(addKind === 'device' ? availableDevices : availableGroups).map((item) => {
            const id = 'device_id' in item ? item.device_id : item.group_id
            return <option key={id} value={id}>{item.name}</option>
          })}
        </select>
        <fieldset className="space-y-1 text-[11px] text-stone-300 sm:col-span-2" data-testid="participant-history-start">
          <legend className="font-semibold text-stone-200">{simplified ? 'Show their positions from' : 'History from (required)'}</legend>
          <label className="flex items-center gap-2">
            <input checked={historyStart === 'mission-start'} data-testid="participant-history-start-mission" name="participant-history-start" onChange={() => chooseHistoryStart('mission-start')} type="radio" />
            Mission start{missionStartTime === null ? '' : ` (${formatTimestamp(missionStartTime)})`}
          </label>
          <label className="flex items-center gap-2">
            <input checked={historyStart === 'now'} data-testid="participant-history-start-now" name="participant-history-start" onChange={() => chooseHistoryStart('now')} type="radio" />
            Now (no earlier history)
          </label>
          <div className="flex items-center gap-2">
            <label className="flex shrink-0 items-center gap-2">
              <input checked={historyStart === 'custom'} data-testid="participant-history-start-custom" name="participant-history-start" onChange={() => chooseHistoryStart('custom')} type="radio" />
              Custom
            </label>
            <input aria-label="Custom history start time" className="sar-input min-w-0 flex-1 px-2 py-1 text-xs" data-testid="participant-effective-from" onChange={(event) => {
              setEffectiveFrom(event.target.value)
              chooseHistoryStart('custom')
            }} type="datetime-local" value={effectiveFrom} />
          </div>
        </fieldset>
        {addError !== null ? (
          <p className="text-xs text-rose-300 sm:col-span-2" data-testid="participant-add-error">{addError}</p>
        ) : null}
        <button
          className="sar-action-primary px-3 py-2 text-xs font-bold sm:col-span-2"
          data-testid="participant-add-btn"
          disabled={saving || addRef === '' || historyStart === null}
          onClick={() => {
            const resolution = resolveParticipantEffectiveFrom({
              choice: historyStart,
              missionStartTime,
              customLocalDateTime: effectiveFrom,
            })
            if (!resolution.ok) {
              setAddError(resolution.message)
              return
            }
            const group = availableGroups.find((candidate) => candidate.group_id === addRef)
            void controller?.addParticipant({
              ...(addKind === 'group'
                ? { kind: 'group', ref: { traccar_group_id: addRef, name: group?.name ?? addRef } } as const
                : { kind: 'device', ref: addRef } as const),
              confirmed_by: COORDINATOR_ACTOR,
              ...(resolution.effectiveFrom === undefined ? {} : { effective_from: resolution.effectiveFrom }),
            }).then((result) => {
              if (result !== null) {
                setAddRef('')
                setEffectiveFrom('')
                setHistoryStart(null)
              }
            })
          }}
          type="button"
        >
          {simplified ? 'Add' : 'Add participant'}
        </button>
      </div>
    </section>
  )
}

/** Tucks the pickers away once the team's default is ticked, without unmounting behaviour. */
function ParticipantFold(props: { readonly fold: boolean; readonly children: ReactNode }) {
  if (!props.fold) return props.children
  return (
    <details data-testid="ws-change-participants">
      <summary className="cursor-pointer select-none py-1 text-[13px] font-semibold text-stone-200">Change who&apos;s taking part</summary>
      <div className="mt-2">{props.children}</div>
    </details>
  )
}

/** Shows that the Traccar groups are being re-read, or why that failed, with Retry. */
function CatalogueRefreshStatus(props: {
  readonly refreshing: boolean
  readonly error: string | null
  readonly onRetry: () => void
}) {
  if (props.error !== null) {
    return (
      <div className="sar-inline-alert flex items-start justify-between gap-2 p-2 text-xs text-amber-200" data-testid="participant-catalogue-error" role="alert">
        <span>{props.error}</span>
        <button className="sar-button shrink-0 px-2 py-1 text-xs" data-testid="participant-catalogue-retry" onClick={props.onRetry} type="button">
          Retry
        </button>
      </div>
    )
  }
  if (props.refreshing) {
    return (
      <p className="text-[11px] text-stone-300" data-testid="participant-catalogue-loading" role="status">
        Refreshing Traccar groups…
      </p>
    )
  }
  return null
}

function formatGroupBackfillStatus(participant: {
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
  readonly backfill_scope_inferred?: boolean | null
  readonly backfill_scope_attested?: boolean
  readonly backfill_scope_unknown?: boolean | null
  readonly backfill_scope_error?: string | null
}): string {
  if (participant.backfill_scope_error) return participant.backfill_scope_error
  if (participant.backfill_scope_unknown === true) {
    return 'unknown historical group scope; review retained membership before finishing'
  }
  const total = participant.backfill_member_count ?? 0
  const completed = participant.backfill_completed_count ?? 0
  const memberLabel = participant.backfill_scope_attested === true
    ? 'coordinator-attested group members'
    : participant.backfill_scope_inferred === true
    ? 'reconstructed group members'
    : 'required group members'
  return completed === total
    ? `complete for ${total}/${total} ${memberLabel}`
    : `pending / retrying for ${total - completed}/${total} ${memberLabel}`
}

/**
 * How someone came to be on the mission, in plain words. A coordinator's own
 * choice needs no note; anything an older version decided stays visible (DON-368).
 */
function plainProvenance(provenance: ParticipantProvenance): string {
  if (provenance === 'grandfathered') return ' · carried over from an older version'
  if (provenance === 'legacy_auto') return ' · added automatically by an older version'
  return ''
}

/** The group history line in the simplified panel's plain words (DON-368). */
function formatGroupEarlierPositionsPlain(participant: Parameters<typeof formatGroupBackfillStatus>[0]): string {
  if (participant.backfill_scope_error) return 'Earlier positions: could not be loaded (see the warning above)'
  if (participant.backfill_scope_unknown === true) {
    return 'Earlier positions: who was in this group earlier is unknown; check before finishing'
  }
  const total = participant.backfill_member_count ?? 0
  const completed = participant.backfill_completed_count ?? 0
  // Where the member list came from stays on screen: it is provenance, not detail.
  const source = participant.backfill_scope_attested === true
    ? ' (members confirmed by a coordinator)'
    : participant.backfill_scope_inferred === true
    ? ' (members worked out from saved records)'
    : ''
  return completed === total
    ? `Earlier positions: loaded for ${total} ${total === 1 ? 'person' : 'people'}${source}`
    : `Earlier positions: loading for ${total - completed} of ${total} people${source}`
}

function ParticipantPickerList(props: {
  readonly heading: string
  readonly emptyText: string
  readonly testId: string
  readonly items: readonly {
    readonly id: string
    readonly label: string
    readonly detail: string
    readonly selected: boolean
    readonly disabled?: boolean
    readonly onToggle: () => void
  }[]
}) {
  return (
    <fieldset className="sar-readout max-h-44 space-y-2 overflow-y-auto p-2" data-testid={props.testId}>
      <legend className="px-1 text-[10px] font-bold uppercase tracking-[0.1em] text-stone-300">{props.heading}</legend>
      {props.items.length === 0 ? <p className="text-[11px] text-stone-300">{props.emptyText}</p> : props.items.map((item) => (
        <label className={`flex items-start gap-2 text-xs ${item.disabled === true ? 'cursor-not-allowed opacity-75' : 'cursor-pointer'}`} key={item.id}>
          <input checked={item.selected} disabled={item.disabled} onChange={item.onToggle} type="checkbox" />
          <span><span className="block font-semibold text-stone-100">{item.label}</span><span className="text-[11px] text-stone-300">{item.detail}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

function deviceLabel(
  deviceId: string | null,
  devices: readonly { readonly device_id: string; readonly name: string }[],
): string {
  if (deviceId === null) return 'Unknown device'
  return devices.find((device) => device.device_id === deviceId)?.name ?? deviceId
}

function formatTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString()
}
