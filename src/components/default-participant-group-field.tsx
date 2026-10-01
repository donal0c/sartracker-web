import type { DefaultParticipantGroup } from '../features/settings/settings-types'
import type { NormalizedTraccarGroup } from '../features/tracking/tracking-types'

type DefaultParticipantGroupFieldProps = {
  readonly value: DefaultParticipantGroup | null
  readonly groups: readonly NormalizedTraccarGroup[]
  readonly onChange: (value: DefaultParticipantGroup | null) => void
}

/**
 * Chooses the team's own Traccar group, pre-ticked at Start and still
 * untickable there [DON-296]. A saved group the server no longer lists stays
 * visible so the choice is never silently dropped.
 */
export function DefaultParticipantGroupField({ value, groups, onChange }: DefaultParticipantGroupFieldProps) {
  const savedMissing = value !== null && !groups.some((group) => group.group_id === value.groupId)
  return (
    <label className="block space-y-2">
      <span className="sar-section-label">Team default group</span>
      <select
        className="sar-input w-full px-3 py-2 text-sm"
        data-testid="settings-default-participant-group"
        onChange={(event) => {
          const chosen = groups.find((group) => group.group_id === event.target.value)
          if (chosen !== undefined) onChange({ groupId: chosen.group_id, name: chosen.name })
          else if (event.target.value === '') onChange(null)
        }}
        value={value?.groupId ?? ''}
      >
        <option value="">None (nothing pre-ticked)</option>
        {groups.map((group) => <option key={group.group_id} value={group.group_id}>{group.name}</option>)}
        {savedMissing ? <option value={value.groupId}>{`${value.name} (not on the tracking server now)`}</option> : null}
      </select>
      <span className="block text-xs text-stone-400">
        {groups.length === 0
          ? 'Connect to Traccar to list its groups, then choose your team here.'
          : 'This group is ticked at Start for every new mission. The coordinator can untick it.'}
      </span>
    </label>
  )
}
