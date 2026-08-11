/**
 * Claims one harness-owned browser click without forgiving any concurrent input.
 * Product observation starts immediately after click delivery and runs alongside
 * the audit confirmation so proof overhead cannot inflate publication timing.
 */
export async function performOwnedHarnessClick(input) {
  validateInput(input)
  const consumedSequence = input.auditState.lastSequence
  const before = await input.readAudit().catch(() => {
    throw createAuditFailure()
  })
  assertNoPendingInput(before, consumedSequence)

  const clickStartedAtEpochMs = Date.now()
  await input.click()
  let observationPromise
  try {
    observationPromise = Promise.resolve(
      typeof input.observeAfterClick === 'function'
        ? input.observeAfterClick()
        : undefined,
    )
  } catch (error) {
    observationPromise = Promise.reject(error)
  }
  observationPromise.catch(() => undefined)

  const auditStartedAt = performance.now()
  try {
    const after = await input.readAudit().catch(() => {
      throw createAuditFailure()
    })
    const sequence = assertExactOwnedInput(
      after,
      consumedSequence,
      input.expectedTestId,
    )
    const acknowledged = await input.acknowledgeAudit(sequence).catch(() => {
      throw createAuditFailure()
    })
    if (acknowledged !== true) {
      throw createAuditFailure()
    }
    input.auditState.lastSequence = sequence
    return {
      sequence,
      expectedTestId: input.expectedTestId,
      clickStartedAtEpochMs,
      auditConfirmationDurationMs: performance.now() - auditStartedAt,
      observation: await observationPromise,
    }
  } catch (error) {
    await observationPromise.catch(() => undefined)
    throw error
  }
}

/** Requires a clean cursor before a harness action begins. */
function assertNoPendingInput(audit, consumedSequence) {
  const lastSequence = normalizeSequence(audit?.lastSequence)
  const events = normalizeEvents(audit?.events, consumedSequence)
  if (
    lastSequence !== consumedSequence ||
    audit?.droppedEventCount !== 0 ||
    events.length !== 0
  ) {
    throw createAuditFailure()
  }
}

/** Requires exactly one new trusted event at the expected first path test-id. */
function assertExactOwnedInput(audit, consumedSequence, expectedTestId) {
  const lastSequence = normalizeSequence(audit?.lastSequence)
  const events = normalizeEvents(audit?.events, consumedSequence)
  const expectedSequence = consumedSequence + 1
  const event = events[0]
  if (
    lastSequence !== expectedSequence ||
    audit?.droppedEventCount !== 0 ||
    events.length !== 1 ||
    event?.sequence !== expectedSequence ||
    event?.trusted !== true ||
    event?.pathTestIds?.[0] !== expectedTestId
  ) {
    throw createAuditFailure()
  }
  return expectedSequence
}

/** Returns only new, sequence-bearing audit events. */
function normalizeEvents(events, consumedSequence) {
  return Array.isArray(events)
    ? events.filter(
        (event) =>
          Number.isSafeInteger(event?.sequence) &&
          event.sequence > consumedSequence,
      )
    : []
}

/** Converts an audit sequence to one nonnegative safe integer or null. */
function normalizeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** Validates the proof-only ownership boundary without target whitelisting. */
function validateInput(input) {
  if (
    input === null ||
    typeof input !== 'object' ||
    input.auditState === null ||
    typeof input.auditState !== 'object' ||
    !Number.isSafeInteger(input.auditState.lastSequence) ||
    input.auditState.lastSequence < 0 ||
    typeof input.expectedTestId !== 'string' ||
    !/^[a-z0-9-]{1,80}$/u.test(input.expectedTestId) ||
    typeof input.readAudit !== 'function' ||
    typeof input.acknowledgeAudit !== 'function' ||
    typeof input.click !== 'function'
  ) {
    throw createAuditFailure()
  }
}

/** Creates one static, allowlisted harness-audit failure. */
function createAuditFailure() {
  const error = new Error('Tracking soak owned harness click was not verified.')
  error.trackingSoakAuditFailure = {
    failureClass: 'owned_harness_click_unverified',
  }
  return error
}
