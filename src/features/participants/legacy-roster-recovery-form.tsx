import { useState } from 'react'
import type { MissionParticipant } from '../../infrastructure/mission-store/tauri-mission-store'
import type { LegacyRosterAttestationInput } from '../../../shared/legacy-roster-attestation.mjs'

/** Collects an explicit coordinator attestation without presenting it as observed membership. */
export function LegacyRosterRecoveryForm({ participant, saving, onConfirm }: {
  readonly participant: MissionParticipant
  readonly saving: boolean
  readonly onConfirm: (input: Omit<LegacyRosterAttestationInput, 'mission_id'>) => Promise<MissionParticipant | null>
}) {
  const [actor, setActor] = useState('')
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState<'' | 'attested-empty' | 'supplied-members'>('')
  const [members, setMembers] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const ids = [...new Set(members.split(/[\s,]+/).filter(Boolean))]
  const canSubmit = !saving && actor.trim() !== '' && reason.trim() !== '' && confirmed
    && (resolution === 'attested-empty' || (resolution === 'supplied-members' && ids.length > 0))
  return <fieldset className="sar-readout space-y-2 p-3" disabled={saving} data-testid="legacy-roster-recovery">
    <legend className="text-xs font-semibold">Resolve legacy roster: {participant.team_name ?? participant.mission_team_id}</legend>
    <p className="text-xs">Historical membership is unknown{participant.removed_at ? ' for this removed group' : ''}.
      This records your attestation separately and preserves the original evidence. Required history must complete before Finish.</p>
    <label className="block text-xs">Coordinator name
      <input className="sar-input block w-full" value={actor} onChange={(event) => setActor(event.target.value)} />
    </label>
    <label className="block text-xs">Recovery reason and evidence consulted
      <textarea className="sar-input block w-full" value={reason} onChange={(event) => setReason(event.target.value)} />
    </label>
    <label className="block text-xs">Roster resolution
      <select className="sar-input block w-full" value={resolution} onChange={(event) => {
        const value = event.target.value
        setResolution(value === 'attested-empty' || value === 'supplied-members' ? value : '')
        setConfirmed(false)
      }}>
        <option value="">Choose a resolution</option>
        <option value="supplied-members">Supply historical member device IDs</option>
        <option value="attested-empty">Attest that the historical roster was empty</option>
      </select>
    </label>
    {resolution === 'supplied-members' ? <label className="block text-xs">Historical device IDs (comma or space separated)
      <textarea className="sar-input block w-full" value={members} onChange={(event) => { setMembers(event.target.value); setConfirmed(false) }} />
    </label> : null}
    <label className="block text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
      I confirm this roster for the original interval {participant.effective_from} to {participant.added_at}.
      This attestation cannot be overwritten; any later correction requires separate audited repair.
    </label>
    <button className="sar-button px-2 py-1 text-xs" type="button" disabled={!canSubmit} data-testid="legacy-roster-confirm"
      onClick={() => {
        if (!canSubmit) return
        void onConfirm({ participant_id: participant.id, confirmed_by: actor.trim(), reason: reason.trim(),
          resolution, confirmed: true, member_device_ids: resolution === 'attested-empty' ? [] : ids })
      }}>Record coordinator attestation</button>
  </fieldset>
}
