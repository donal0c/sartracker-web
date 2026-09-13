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
  const scope = resolveParticipantScope(input)
  if (scope.scope === 'unknown') {
    return {
      scope: 'unknown',
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
function resolveParticipantScope(input) {
  const participant = input.participant
  if (participant.kind === 'device') {
    if (typeof participant.deviceId !== 'string' || participant.deviceId.trim() === '') {
      return { scope: 'unknown', memberDeviceIds: [] }
    }
    return { scope: 'exact', memberDeviceIds: [participant.deviceId.trim()] }
  }

  if (participant.startingMemberDeviceIdsJson !== null
    && participant.startingMemberDeviceIdsJson !== undefined) {
    return {
      scope: 'exact',
      memberDeviceIds: parseStartingMemberDeviceIds(
        participant.startingMemberDeviceIdsJson,
      ),
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
  const events = input.membershipEvents
    .filter((event) =>
      event.missionId === participant.missionId &&
      event.teamId === teamId &&
      (event.change === 'member' || event.change === 'left') &&
      parseTimestamp(event.observedAt) !== null &&
      parseTimestamp(event.observedAt) <= addedAt)
    .toSorted((left, right) => {
      const timeOrder = parseTimestamp(left.observedAt) - parseTimestamp(right.observedAt)
      if (timeOrder !== 0) return timeOrder
      return (left.sequence ?? 0) - (right.sequence ?? 0)
    })

  const latestByDevice = new Map()
  for (const event of events) latestByDevice.set(event.deviceId, event.change)
  const memberIds = new Set(
    [...latestByDevice]
      .filter(([, change]) => change === 'member')
      .map(([deviceId]) => deviceId),
  )

  // All changes recorded at the participant boundary are retained. A legacy
  // row cannot prove whether a same-timestamp remove preceded or followed the
  // participant insert, so dropping either side would risk false completion.
  for (const event of events) {
    if (parseTimestamp(event.observedAt) === addedAt) memberIds.add(event.deviceId)
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
    const reconciledUntil = parseTimestamp(checkpoint.reconciledUntil)
    if (reconciledUntil === null) return false
    if (checkpoint.completed !== 1) return false
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
