/** Validates the coordinator's explicit, non-observational legacy roster resolution. */
export function normalizeLegacyRosterAttestation(input) {
  const requiredText = (value, label) => {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required.`)
    if (value.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      throw new Error(`${label} contains unsupported characters or exceeds 4000 characters.`)
    }
    return value.trim()
  }
  if (!Array.isArray(input?.member_device_ids)) throw new Error('Attested member device ids are required.')
  if (input.member_device_ids.length > 4096) throw new Error('Roster attestation exceeds 4096 member device ids.')
  if (input.confirmed !== true) throw new Error('Explicit coordinator confirmation is required.')
  const ids = [...new Set(input.member_device_ids.map((id) => requiredText(id, 'Device id')))].sort()
  if ((input.resolution !== 'attested-empty' && input.resolution !== 'supplied-members')
    || (input.resolution === 'attested-empty') !== (ids.length === 0)) {
    throw new Error('Roster resolution must explicitly confirm empty membership or supply member device ids.')
  }
  return {
    mission_id: requiredText(input.mission_id, 'Mission id'),
    participant_id: requiredText(input.participant_id, 'Participant id'),
    member_device_ids: ids,
    resolution: input.resolution,
    confirmed: true,
    confirmed_by: requiredText(input.confirmed_by, 'Coordinator name'),
    reason: requiredText(input.reason, 'Recovery reason'),
    original_starting_member_device_ids_json: null,
  }
}

/** Reads an append-only attestation without rewriting the participant's original snapshot. */
export function readLegacyRosterAttestation(events, missionId, participantId) {
  try {
    const matches = events.filter((event) => event.mission_id === missionId
      && event.event_type === 'participant_roster_attested'
      && event.id === `participant-roster-attestation:${participantId}`)
      .map((event) => ({ event, details: JSON.parse(event.details_json) }))
    if (matches.length === 0) return {}
    if (matches.length !== 1) throw new Error('Conflicting roster attestations.')
    const { event, details } = matches[0]
    const normalized = normalizeLegacyRosterAttestation(details)
    if (normalized.mission_id !== missionId || normalized.participant_id !== participantId
      || details.original_starting_member_device_ids_json !== null
      || !Number.isFinite(Date.parse(event.timestamp))) throw new Error('Invalid roster attestation.')
    return { attestedMemberDeviceIdsJson: JSON.stringify(normalized.member_device_ids) }
  } catch {
    return { attestationError: 'Stored roster attestation is invalid. Retain this mission and repair its audit evidence before finishing.' }
  }
}
