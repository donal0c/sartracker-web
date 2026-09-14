import { expect, it } from 'vitest'
import { readLegacyRosterAttestation } from '../../shared/legacy-roster-attestation.mjs'

it('isolates malformed attestation JSON using participant identity outside its payload', () => {
  const events = [{ id: 'participant-roster-attestation:damaged', mission_id: 'mission',
    event_type: 'participant_roster_attested', timestamp: '2026-09-13T10:00:00Z', details_json: '{' }]
  expect(readLegacyRosterAttestation(events, 'mission', 'healthy')).toEqual({})
  expect(readLegacyRosterAttestation(events, 'mission', 'damaged')).toMatchObject({ attestationError: expect.any(String) })
})
