type ParticipantMissionContext = {
  readonly currentMission: { readonly id: string } | null
  readonly recoverableMission: { readonly id: string } | null
  readonly governanceMission: { readonly id: string } | null
}

/**
 * Resolves the mission whose participant scope controls the operational map.
 * An active or recoverable mission outranks an unrelated mission opened only
 * for governance review.
 */
export function resolveParticipantMissionId(
  context: ParticipantMissionContext,
): string | null {
  return context.currentMission?.id
    ?? context.recoverableMission?.id
    ?? context.governanceMission?.id
    ?? null
}
