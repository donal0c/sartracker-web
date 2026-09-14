export type LegacyRosterAttestationInput = {
  readonly mission_id: string
  readonly participant_id: string
  readonly member_device_ids: readonly string[]
  readonly resolution: 'attested-empty' | 'supplied-members'
  readonly confirmed_by: string
  readonly reason: string
  readonly confirmed: true
}
export function normalizeLegacyRosterAttestation(input: LegacyRosterAttestationInput): LegacyRosterAttestationInput & {
  readonly original_starting_member_device_ids_json: null
}
export function readLegacyRosterAttestation(events: readonly {
  readonly id: string
  readonly mission_id: string
  readonly event_type: string
  readonly details_json: string | null
  readonly timestamp: string
}[], missionId: string, participantId: string): {
  attestedMemberDeviceIdsJson?: string
  attestationError?: string
}
