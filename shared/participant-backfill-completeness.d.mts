export type BackfillParticipant = {
  missionId: string
  kind: 'device' | 'group'
  deviceId?: string | null | undefined
  teamId?: string | null | undefined
  effectiveFrom: string
  addedAt: string
  startingMemberDeviceIdsJson?: string | null | undefined
  attestedMemberDeviceIdsJson?: string
  attestationError?: string
}

export type BackfillMembershipEvent = {
  missionId: string
  teamId: string
  deviceId: string
  change: 'member' | 'left'
  observedAt: string
  sequence?: number | null
}

export type BackfillCheckpoint = {
  missionId: string
  deviceId: string
  windowFrom: string
  windowTo: string
  reconciledUntil: string
  completed: number
}

export type BackfillScope = 'exact' | 'inferred' | 'attested' | 'unknown'

export type BackfillCompleteness = {
  error?: string
  scope: BackfillScope
  memberDeviceIds: readonly string[]
  completedMemberDeviceIds: readonly string[]
  complete: boolean
}

export function parseStartingMemberDeviceIds(serialized: string): readonly string[]

export function resolveParticipantBackfillScope(input: {
  participant: BackfillParticipant
  checkpoints: readonly BackfillCheckpoint[]
  membershipEvents: readonly BackfillMembershipEvent[]
}): {
  scope: BackfillScope
  memberDeviceIds: readonly string[]
  error?: string
}

export function evaluateParticipantBackfill(input: {
  participant: BackfillParticipant
  checkpoints: readonly BackfillCheckpoint[]
  membershipEvents: readonly BackfillMembershipEvent[]
}): BackfillCompleteness
