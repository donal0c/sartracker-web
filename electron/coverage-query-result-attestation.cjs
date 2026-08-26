const {
  readCoverageClaimSnapshot,
  readCoverageInventory,
} = require('./coverage-query.cjs')
const {
  createCoverageChunkIdentity,
} = require('./coverage-worker-envelope.cjs')

/** Reads only device x period identities, never mission position rows. */
function readCurrentCoverageInventory(database, missionId) {
  return new Set(readCoverageInventory(database, missionId).map((key) =>
    createCoverageChunkIdentity(key)))
}

/** Proves that a worker inventory exactly covers current canonical metadata. */
function assertCoverageResultInventory(database, missionId, chunks, readKey, label) {
  if (!Array.isArray(chunks)) {
    throw new Error(`Coverage ${label} result inventory is invalid.`)
  }
  const expected = readCurrentCoverageInventory(database, missionId)
  const observed = new Set()
  for (const chunk of chunks) {
    const key = readKey(chunk)
    if (key === null || typeof key !== 'object' || Array.isArray(key)) {
      throw new Error(`Coverage ${label} result inventory is invalid.`)
    }
    const identity = createCoverageChunkIdentity(key)
    if (!expected.has(identity) || observed.has(identity)) {
      throw new Error(`Coverage ${label} result inventory diverged from canonical metadata.`)
    }
    observed.add(identity)
  }
  if (observed.size !== expected.size) {
    throw new Error(`Coverage ${label} result inventory omitted canonical chunks.`)
  }
}

/** Proves manifest outing descriptors exactly match current bounded SQLite metadata. */
function assertCoverageManifestOutings(database, missionId, outings) {
  if (!Array.isArray(outings)) {
    throw new Error('Coverage manifest outing metadata is invalid.')
  }
  const expected = database.prepare(`SELECT id, label, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`).all(missionId)
  if (outings.length !== expected.length) {
    throw new Error('Coverage manifest outing metadata diverged from canonical metadata.')
  }
  for (let index = 0; index < expected.length; index += 1) {
    const observed = outings[index]
    const canonical = expected[index]
    if (
      observed?.id !== canonical.id ||
      observed?.label !== canonical.label ||
      observed?.started_at !== canonical.started_at ||
      observed?.ended_at !== canonical.ended_at
    ) {
      throw new Error('Coverage manifest outing metadata diverged from canonical metadata.')
    }
  }
}

/** Derives worker-result cardinality from current bounded mission metadata. */
function readCoverageQueryResultLimits(database, query) {
  if (query.kind === 'enumerate' || query.kind === 'manifest') {
    const maxChunks = readCoverageInventory(database, query.missionId).length
    if (query.kind === 'enumerate') return { maxChunks }
    const outingCount = database.prepare(`SELECT COUNT(*) AS count FROM outings
      WHERE mission_id = ?`).get(query.missionId)
    return { maxChunks, maxOutings: Number(outingCount?.count ?? 0) }
  }
  if (query.kind === 'invalidation-analysis') {
    const invalidation = database.prepare(`SELECT mission_id FROM coverage_invalidations
      WHERE id = ? AND drained_at IS NULL`).get(query.invalidationId)
    if (invalidation === undefined) return { maxAffectedKeys: 0 }
    const inventory = readCoverageInventory(database, invalidation.mission_id)
    const deviceCount = new Set(inventory.map((key) => key.device_id)).size
    return { maxAffectedKeys: inventory.length + deviceCount }
  }
  return {}
}

/** Proves a worker claim exactly matches a bounded direct ledger snapshot. */
function assertCoverageClaimMatchesDatabase(database, input, claim) {
  const expected = readCoverageClaimSnapshot(database, input)
  if (claim.changeSeq !== expected.changeSeq) {
    return expected
  }
  const same =
    claim.databaseReady === expected.databaseReady &&
    Array.isArray(claim.blockers) &&
    Array.isArray(claim.chunkRevisions) &&
    JSON.stringify(claim.blockers) === JSON.stringify(expected.blockers) &&
    JSON.stringify(claim.chunkRevisions) === JSON.stringify(expected.chunkRevisions)
  if (!same) {
    throw new Error('Coverage claim result diverged from current ledger metadata.')
  }
  return expected
}

module.exports = {
  assertCoverageClaimMatchesDatabase,
  assertCoverageManifestOutings,
  assertCoverageResultInventory,
  readCoverageQueryResultLimits,
  readCurrentCoverageInventory,
}
