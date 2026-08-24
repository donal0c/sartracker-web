import { useMemo, useState } from 'react'

import { isMissionModelEnabled } from '../features/runtime/mission-model-flag'
import { useParticipantStore } from '../features/participants/participant-store'
import { useParticipantSelectionViewModel } from '../features/participants/use-participant-selection-view-model'

const COORDINATOR_ACTOR = 'Mission coordinator'

type ParticipantControlsSectionProps = {
  readonly phase: 'idle' | 'active' | 'paused' | 'recovery'
}

/** Renders explicit mission-start selection and append-only participant management. */
export function ParticipantControlsSection({ phase }: ParticipantControlsSectionProps) {
  const selection = useParticipantSelectionViewModel()
  const controller = useParticipantStore((state) => state.controller)
  const participants = useParticipantStore((state) => state.participants)
  const availableDevices = useParticipantStore((state) => state.availableDevices)
  const availableGroups = useParticipantStore((state) => state.availableGroups)
  const membershipNotices = useParticipantStore((state) => state.membershipNotices)
  const envelope = useParticipantStore((state) => state.envelope)
  const saving = useParticipantStore((state) => state.saving)
  const rosterError = useParticipantStore((state) => state.rosterError)
  const error = useParticipantStore((state) => state.error)
  const [addKind, setAddKind] = useState<'device' | 'group'>('device')
  const [addRef, setAddRef] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState('')

  const activeParticipants = useMemo(
    () => participants.filter((participant) => participant.removed_at === null),
    [participants],
  )

  if (!isMissionModelEnabled()) return null

  if (phase === 'idle') {
    return (
      <section className="space-y-3 border-t border-[var(--sar-line)] pt-4" data-testid="participant-selection-step">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-300">
              Mission participants
            </p>
            <p className="mt-1 text-xs leading-relaxed text-stone-300">
              Select the Traccar groups and individual devices taking part. Nothing is pre-selected.
            </p>
          </div>
          <span className="sar-status-chip px-2 py-1 font-mono text-[11px]" data-testid="participant-selected-count">
            {selection.selectedDeviceCount} selected
          </span>
        </div>

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

        <div className="grid gap-3 sm:grid-cols-2">
          <ParticipantPickerList
            emptyText="No Traccar groups are available. Device-level selection remains available."
            heading="Groups"
            items={selection.availableGroups.map((group) => ({
              id: group.groupId,
              label: group.name,
              detail: `${group.currentMemberCount} current members`,
              selected: group.selected,
              onToggle: () => selection.toggleGroup(group.groupId),
            }))}
            testId="participant-group-picker"
          />
          <ParticipantPickerList
            emptyText="No device roster is available. You may start with none and add participants after reconnecting."
            heading="Devices"
            items={selection.availableDevices.map((device) => ({
              id: device.deviceId,
              label: device.name,
              detail: `${device.deviceId}${device.reportingNow ? ' · reporting now' : ''}${device.coveredBySelectedGroup ? ' · included by selected group' : ''}`,
              selected: device.selected,
              disabled: device.coveredBySelectedGroup,
              onToggle: () => selection.toggleDevice(device.deviceId),
            }))}
            testId="participant-device-picker"
          />
        </div>
        {selection.selectedDeviceCount === 0 ? (
          <p className="text-xs text-stone-300" data-testid="participant-none-selected-notice">
            No participants selected. The mission may start, but reporting devices will remain outside mission evidence and off the operational map until a coordinator adds them.
          </p>
        ) : null}
      </section>
    )
  }

  return (
    <section className="sar-module space-y-3 p-3" data-testid="participant-management">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-amber-300">Participants</p>
        <span className="font-mono text-[11px] text-stone-200">{envelope.activeDeviceCount} active devices</span>
      </div>
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
        <button className="sar-button px-2 py-1 text-xs" onClick={() => controller?.clearMembershipNotices()} type="button">
          Acknowledge membership notices
        </button>
      ) : null}
      {error !== null ? <p className="text-xs text-rose-300">{error}</p> : null}

      <div className="space-y-2" data-testid="participant-active-list">
        {activeParticipants.length === 0 ? (
          <p className="text-xs text-stone-300">No mission participants are currently selected.</p>
        ) : activeParticipants.map((participant) => (
          <div className="sar-readout flex items-start justify-between gap-3 p-2" key={participant.id}>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-stone-100">
                {participant.kind === 'group'
                  ? participant.team_name ?? participant.traccar_group_id
                  : deviceLabel(participant.traccar_device_id, availableDevices)}
              </p>
              <p className="mt-1 text-[11px] text-stone-300">
                {participant.kind} · {participant.provenance} · effective {formatTimestamp(participant.effective_from)}
              </p>
              {participant.kind === 'device' && participant.backfill_completed !== undefined ? (
                <p className="mt-1 text-[11px] text-stone-300" data-testid="participant-backfill-status">
                  History backfill: {participant.backfill_completed === 1 ? 'complete' : 'pending / retrying'}
                </p>
              ) : null}
              {participant.kind === 'group' &&
              (participant.backfill_member_count ?? 0) > 0 ? (
                <p className="mt-1 text-[11px] text-stone-300" data-testid="participant-backfill-status">
                  History backfill: {formatGroupBackfillStatus(participant)}
                </p>
              ) : null}
            </div>
            <button
              className="sar-action-danger px-2 py-1 text-[11px]"
              disabled={saving}
              onClick={() => void controller?.removeParticipant(
                participant.id,
                COORDINATOR_ACTOR,
                'Coordinator removed participant',
              )}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-2 border-t border-[var(--sar-line)] pt-3 sm:grid-cols-2">
        <select className="sar-input px-2 py-2 text-xs" data-testid="participant-add-kind" onChange={(event) => {
          setAddKind(event.target.value as 'device' | 'group')
          setAddRef('')
        }} value={addKind}>
          <option value="device">Individual device</option>
          <option value="group">Traccar group</option>
        </select>
        <select className="sar-input px-2 py-2 text-xs" data-testid="participant-add-ref" onChange={(event) => setAddRef(event.target.value)} value={addRef}>
          <option value="">Choose…</option>
          {(addKind === 'device' ? availableDevices : availableGroups).map((item) => {
            const id = 'device_id' in item ? item.device_id : item.group_id
            return <option key={id} value={id}>{item.name}</option>
          })}
        </select>
        <label className="text-[11px] text-stone-300 sm:col-span-2">
          Effective from (optional; defaults to now)
          <input className="sar-input mt-1 w-full px-2 py-2 text-xs" data-testid="participant-effective-from" onChange={(event) => setEffectiveFrom(event.target.value)} type="datetime-local" value={effectiveFrom} />
        </label>
        <button
          className="sar-action-primary px-3 py-2 text-xs font-bold sm:col-span-2"
          data-testid="participant-add-btn"
          disabled={saving || addRef === ''}
          onClick={() => {
            const group = availableGroups.find((candidate) => candidate.group_id === addRef)
            void controller?.addParticipant({
              kind: addKind,
              ref: addKind === 'group'
                ? { traccar_group_id: addRef, name: group?.name ?? addRef }
                : addRef,
              confirmed_by: COORDINATOR_ACTOR,
              ...(effectiveFrom === '' ? {} : { effective_from: new Date(effectiveFrom).toISOString() }),
            }).then((result) => {
              if (result !== null) {
                setAddRef('')
                setEffectiveFrom('')
              }
            })
          }}
          type="button"
        >
          Add participant
        </button>
      </div>
    </section>
  )
}

function formatGroupBackfillStatus(participant: {
  readonly backfill_member_count?: number | null
  readonly backfill_completed_count?: number | null
}): string {
  const total = participant.backfill_member_count ?? 0
  const completed = participant.backfill_completed_count ?? 0
  return completed === total
    ? `complete for ${total}/${total} starting group members`
    : `pending / retrying for ${total - completed}/${total} starting group members`
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
