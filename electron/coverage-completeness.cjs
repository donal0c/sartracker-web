/** Calculates selected-scope progress without treating built state as delivery. */
function calculateCoverageProgress(input) {
  let deliveredFixes = 0
  let totalFixes = 0
  for (const chunk of input.chunks) {
    const fresh = chunk.builtRev === chunk.contentRev
    const count = fresh && chunk.fixCount !== null
      ? normalizeCount(chunk.fixCount, 'built fix count')
      : normalizeCount(chunk.exactCount, 'exact fix count')
    totalFixes += count
    if (fresh && input.delivered[chunk.key] === chunk.contentRev) {
      deliveredFixes += count
    }
  }
  return {
    deliveredFixes,
    totalFixes,
    percent: calculateHonestPercent(deliveredFixes, totalFixes),
  }
}

/** Evaluates the full database-snapshot and renderer-attestation claim gate. */
function evaluateCoverageClaim(input) {
  const blockers = []
  if (input.enumerated !== true) blockers.push('not_enumerated')
  if (input.pendingInvalidation === true) blockers.push('pending_invalidation')
  if (input.chunks.some((chunk) => chunk.builtRev !== chunk.contentRev)) {
    blockers.push('chunk_not_fresh')
  }
  if (input.chunks.some((chunk) => input.delivered[chunk.key] !== chunk.contentRev)) {
    blockers.push('chunk_not_delivered')
  }
  if (input.ingestOutboxPending === true) blockers.push('ingest_outbox_pending')
  if (input.ingestHealth !== 'healthy') blockers.push('ingest_health_degraded')
  if (input.backfillIncomplete === true) blockers.push('backfill_incomplete')
  if (input.missionId !== input.expectedMissionId) blockers.push('mission_mismatch')
  if (input.generation !== input.expectedGeneration) blockers.push('generation_mismatch')

  return {
    complete: blockers.length === 0,
    blockers,
    progress: calculateCoverageProgress(input),
    changeSeq: input.changeSeq,
    chunkRevisions: input.chunks.map((chunk) => ({
      key: chunk.key,
      contentRev: chunk.contentRev,
    })),
  }
}

/** Returns a percentage that cannot round incomplete evidence up to 100%. */
function calculateHonestPercent(deliveredFixes, totalFixes) {
  if (totalFixes === 0) return 100
  if (deliveredFixes >= totalFixes) return 100
  return Math.min(99, Math.floor((deliveredFixes / totalFixes) * 100))
}

/** Normalizes one SQLite-derived count before it enters operator progress. */
function normalizeCount(value, label) {
  const count = Number(value)
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Coverage ${label} is invalid.`)
  }
  return count
}

module.exports = {
  calculateCoverageProgress,
  evaluateCoverageClaim,
}
