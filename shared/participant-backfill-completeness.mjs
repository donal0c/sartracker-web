/** Parses and validates an immutable starting-member JSON array. */
export function parseStartingMemberDeviceIds(serialized) {
  let value
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('Stored group starting-member snapshot is invalid.')
  }
  if (!Array.isArray(value) || value.some((deviceId) =>
    typeof deviceId !== 'string' || deviceId.trim() === '')) {
    throw new Error('Stored group starting-member snapshot is invalid.')
  }
  return [...new Set(value.map((deviceId) => deviceId.trim()))].sort()
}

/** Evaluates a participant's fixed backfill coverage and legacy scope provenance. */
export function evaluateParticipantBackfill(input) {
  const scope = resolveParticipantBackfillScope(input)
  if (scope.scope === 'unknown') {
    return {
      scope: 'unknown',
      ...(scope.error === undefined ? {} : { error: scope.error }),
      memberDeviceIds: [],
      completedMemberDeviceIds: [],
      complete: false,
    }
  }

  const completedMemberDeviceIds = scope.memberDeviceIds.filter((deviceId) =>
    hasContiguousCompletedCoverage(
      input.participant,
      deviceId,
      input.checkpoints,
    ))
  return {
    scope: scope.scope,
    memberDeviceIds: scope.memberDeviceIds,
    completedMemberDeviceIds,
    complete: completedMemberDeviceIds.length === scope.memberDeviceIds.length,
  }
}

/** Resolves exact new-row scope or a conservative, explicitly inferred legacy scope. */
export function resolveParticipantBackfillScope(input) {
  const participant = input.participant
  if (participant.attestationError) {
    return { scope: 'unknown', memberDeviceIds: [], error: participant.attestationError }
  }
  if (participant.kind === 'device') {
    if (typeof participant.deviceId !== 'string' || participant.deviceId.trim() === '') {
      return { scope: 'unknown', memberDeviceIds: [] }
    }
    return { scope: 'exact', memberDeviceIds: [participant.deviceId.trim()] }
  }

  if (participant.startingMemberDeviceIdsJson !== null
    && participant.startingMemberDeviceIdsJson !== undefined) {
    try {
      const startingMemberDeviceIds = parseStartingMemberDeviceIds(
        participant.startingMemberDeviceIdsJson,
      )
      return {
        scope: 'exact',
        memberDeviceIds: mergeHistoricallyRequiredMemberDeviceIds(
          input,
          startingMemberDeviceIds,
        ),
      }
    } catch {
      return { scope: 'unknown', memberDeviceIds: [], error: 'Stored group starting-member snapshot is invalid. Retain this mission and repair its roster before finishing.' }
    }
  }

  if (participant.attestedMemberDeviceIdsJson !== undefined) {
    try {
      const start = parseTimestamp(participant.effectiveFrom)
      const end = parseTimestamp(participant.addedAt)
      if (start === null || end === null || start > end) throw new Error('Invalid original interval.')
      return { scope: 'attested', memberDeviceIds: mergeHistoricallyRequiredMemberDeviceIds(input,
        parseStartingMemberDeviceIds(participant.attestedMemberDeviceIdsJson)) }
    } catch {
      return { scope: 'unknown', memberDeviceIds: [], error: 'Stored roster attestation is invalid.' }
    }
  }

  const teamId = participant.teamId
  if (typeof teamId !== 'string' || teamId.trim() === '') {
    return { scope: 'unknown', memberDeviceIds: [] }
  }
  const addedAt = parseTimestamp(participant.addedAt)
  const effectiveFrom = parseTimestamp(participant.effectiveFrom)
  if (addedAt === null || effectiveFrom === null || effectiveFrom > addedAt) {
    return { scope: 'unknown', memberDeviceIds: [] }
  }
  const events = listMembershipEventsThrough(input, participant.missionId, teamId, addedAt)

  const latestByDevice = new Map()
  for (const event of events) latestByDevice.set(event.deviceId, event.change)
  const memberIds = new Set(
    [...latestByDevice]
      .filter(([, change]) => change === 'member')
      .map(([deviceId]) => deviceId),
  )

  // Every membership change in the backdated interval is retained. A legacy
  // row cannot prove whether a departure preceded or followed the participant
  // insert, so dropping an in-window departure would risk false completion.
  for (const event of events) {
    const observedAt = parseTimestamp(event.observedAt)
    if (observedAt >= effectiveFrom && observedAt <= addedAt) {
      memberIds.add(event.deviceId)
    }
  }

  const eventDeviceIds = new Set(events.map((event) => event.deviceId))
  for (const checkpoint of input.checkpoints) {
    const checkpointFrom = parseTimestamp(checkpoint.windowFrom)
    const checkpointTo = parseTimestamp(checkpoint.windowTo)
    if (
      checkpoint.missionId === participant.missionId &&
      checkpointFrom !== null &&
      checkpointTo !== null &&
      checkpointFrom >= effectiveFrom &&
      checkpointTo === addedAt &&
      eventDeviceIds.has(checkpoint.deviceId)
    ) {
      memberIds.add(checkpoint.deviceId)
    }
  }

  // A left-only history cannot prove that this participant ever covered a
  // device. Treat it as unknown rather than turning an empty candidate set
  // into a finishable legacy group.
  if (memberIds.size === 0) {
    return { scope: 'unknown', memberDeviceIds: [] }
  }
  return {
    scope: 'inferred',
    memberDeviceIds: [...memberIds].sort(),
  }
}

/** Merges a new selection's observed roster with retained history in its fixed interval. */
function mergeHistoricallyRequiredMemberDeviceIds(input, startingMemberDeviceIds) {
  const participant = input.participant
  const start = parseTimestamp(participant.effectiveFrom)
  const end = parseTimestamp(participant.addedAt)
  if (start === null || end === null || start > end) return [...startingMemberDeviceIds]

  const memberDeviceIds = new Set(startingMemberDeviceIds)
  const events = listMembershipEventsThrough(input, participant.missionId, participant.teamId, end)
  const historicallyKnownTeamDeviceIds = new Set()
  for (const event of events) {
    const observedAt = parseTimestamp(event.observedAt)
    if (typeof event.deviceId !== 'string' || event.deviceId.trim() === '') continue
    const deviceId = event.deviceId.trim()
    historicallyKnownTeamDeviceIds.add(deviceId)
    if (observedAt === null || observedAt < start || observedAt > end) continue
    memberDeviceIds.add(deviceId)
  }

  // A retained checkpoint is evidence that a historically observed team
  // member was required in this interval even when departure predates it.
  for (const checkpoint of input.checkpoints) {
    if (checkpoint.missionId !== participant.missionId) continue
    const windowFrom = parseTimestamp(checkpoint.windowFrom)
    const windowTo = parseTimestamp(checkpoint.windowTo)
    if (windowFrom === null || windowTo === null || windowTo <= windowFrom) continue
    if (windowTo <= start || windowFrom >= end) continue
    if (typeof checkpoint.deviceId !== 'string' || checkpoint.deviceId.trim() === '') continue
    const deviceId = checkpoint.deviceId.trim()
    if (historicallyKnownTeamDeviceIds.has(deviceId)) memberDeviceIds.add(deviceId)
  }
  return [...memberDeviceIds].sort()
}

/** Returns same-team membership changes through a participant's boundary. */
function listMembershipEventsThrough(input, missionId, teamId, end) {
  return input.membershipEvents
    .filter((event) =>
      event.missionId === missionId &&
      event.teamId === teamId &&
      (event.change === 'member' || event.change === 'left') &&
      parseTimestamp(event.observedAt) !== null &&
      parseTimestamp(event.observedAt) <= end)
    .toSorted((left, right) => {
      const timeOrder = parseTimestamp(left.observedAt) - parseTimestamp(right.observedAt)
      if (timeOrder !== 0) return timeOrder
      return (left.sequence ?? 0) - (right.sequence ?? 0)
    })
}

/** Checks that completed windows cover the full participant interval without a gap. */
function hasContiguousCompletedCoverage(participant, deviceId, checkpoints) {
  const start = parseTimestamp(participant.effectiveFrom)
  const end = parseTimestamp(participant.addedAt)
  if (start === null || end === null || start > end) return false
  if (start === end) return true

  const intervals = []
  for (const checkpoint of checkpoints) {
    if (checkpoint.missionId !== participant.missionId || checkpoint.deviceId !== deviceId) {
      continue
    }
    const windowFrom = parseTimestamp(checkpoint.windowFrom)
    const windowTo = parseTimestamp(checkpoint.windowTo)
    if (windowFrom === null || windowTo === null) return false
    if (windowTo <= start || windowFrom >= end) continue
    if (windowTo <= windowFrom) return false
    if (checkpoint.completed !== 1) continue
    const reconciledUntil = parseTimestamp(checkpoint.reconciledUntil)
    if (reconciledUntil === null) return false
    if (reconciledUntil !== windowTo) return false
    intervals.push({
      from: Math.max(start, windowFrom),
      to: Math.min(end, windowTo),
    })
  }

  intervals.sort((left, right) => left.from - right.from || left.to - right.to)
  let coveredUntil = start
  for (const interval of intervals) {
    if (interval.from > coveredUntil) return false
    coveredUntil = Math.max(coveredUntil, interval.to)
    if (coveredUntil >= end) return true
  }
  return false
}

/** Parses one persisted timestamp into milliseconds, returning null on invalid input. */
function parseTimestamp(value) {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}
