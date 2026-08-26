const { compareStringsByCodeUnit } = require('./deterministic-string-order.cjs')
const { readCoverageInventory } = require('./coverage-query.cjs')
const { findContainingOutingIndex } = require('./coverage-period-resolver.cjs')

/**
 * Records accepted position changes against their logical device-period chunks.
 * The caller owns the evidence transaction; this helper never scans positions.
 */
function recordAcceptedCoveragePositions(database, input) {
  if (input.positions.length === 0) {
    return { changeSeq: 0, affectedKeys: [] }
  }
  const resolvePeriod = createIndexedCoveragePeriodResolver(database, input.missionId)
  const affectedByIdentity = new Map()
  for (const position of input.positions) {
    const period = resolvePeriod(position.timestamp)
    const identity = createCoverageChunkIdentity(
      position.device_id,
      period.period_kind,
      period.period_id,
    )
    affectedByIdentity.set(identity, {
      mission_id: input.missionId,
      device_id: position.device_id,
      ...period,
    })
  }

  const upsertChunk = database.prepare(`INSERT INTO coverage_chunks (
      mission_id, device_id, period_kind, period_id,
      content_rev, built_rev, updated_at
    ) VALUES (?, ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(mission_id, device_id, period_kind, period_id) DO UPDATE SET
      content_rev = coverage_chunks.content_rev + 1,
      updated_at = excluded.updated_at`)
  const affectedKeys = [...affectedByIdentity.keys()].sort(compareStringsByCodeUnit)
  for (const identity of affectedKeys) {
    const key = affectedByIdentity.get(identity)
    upsertChunk.run(
      key.mission_id,
      key.device_id,
      key.period_kind,
      key.period_id,
      input.updatedAt,
    )
  }
  if (input.failAfterWrite === true) {
    throw new Error('Injected coverage ledger failure.')
  }
  return {
    changeSeq: bumpCoverageChangeSequence(database, input.missionId, input.updatedAt),
    affectedKeys,
  }
}

/**
 * Loads bounded outing metadata once and creates an O(log outings) resolver.
 * Outing mutations are serialized by the caller's database transaction, so
 * every lookup observes the same transactionally current half-open windows.
 */
function createIndexedCoveragePeriodResolver(database, missionId) {
  const outings = database.prepare(`SELECT id, started_at, ended_at FROM outings
    WHERE mission_id = ? ORDER BY started_at ASC, id ASC`).all(missionId)
  return (timestamp) => {
    const outingIndex = findContainingOutingIndex(outings, timestamp)
    return outingIndex === -1
      ? { period_kind: 'unassigned', period_id: '' }
      : { period_kind: 'outing', period_id: outings[outingIndex].id }
  }
}

/** Appends one durable O(1) outing invalidation and revokes existing claims. */
function appendCoverageInvalidation(database, input) {
  const range = deriveInvalidationRange(input.oldBounds, input.newBounds)
  database.prepare(`INSERT INTO coverage_invalidations (
      id, mission_id, reason, subject_outing_id,
      old_started_at, old_ended_at, new_started_at, new_ended_at,
      range_from, range_to, created_at, drained_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
    .run(
      input.id,
      input.missionId,
      input.reason,
      input.subjectOutingId,
      input.oldBounds?.started_at ?? null,
      input.oldBounds?.ended_at ?? null,
      input.newBounds?.started_at ?? null,
      input.newBounds?.ended_at ?? null,
      range.rangeFrom,
      range.rangeTo,
      input.createdAt,
    )
  if (input.failAfterWrite === true) {
    throw new Error('Injected coverage ledger failure.')
  }
  return {
    changeSeq: bumpCoverageChangeSequence(
      database,
      input.missionId,
      input.createdAt,
    ),
  }
}

/**
 * Applies a worker-computed invalidation result in one bounded transaction.
 * A pending row remains the structural completeness block until commit.
 */
function applyCoverageInvalidationDrain(database, input) {
  const apply = database.transaction(() => {
    const invalidation = database.prepare(`SELECT mission_id, drained_at
      FROM coverage_invalidations WHERE id = ?`).get(input.invalidationId)
    if (invalidation === undefined) {
      throw new Error(`Coverage invalidation not found: ${input.invalidationId}`)
    }
    if (invalidation.drained_at !== null) {
      return { applied: false, changeSeq: null }
    }

    const upsertChunk = database.prepare(`INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id,
        content_rev, built_rev, updated_at
      ) VALUES (?, ?, ?, ?, 1, NULL, ?)
      ON CONFLICT(mission_id, device_id, period_kind, period_id) DO UPDATE SET
        content_rev = coverage_chunks.content_rev + 1,
        updated_at = excluded.updated_at`)
    const seenKeys = new Set()
    for (const key of input.affectedKeys) {
      if (key.mission_id !== invalidation.mission_id) {
        throw new Error('Coverage invalidation drain contains a different mission.')
      }
      const identity = createCoverageChunkIdentity(
        key.device_id,
        key.period_kind,
        key.period_id,
      )
      if (seenKeys.has(identity)) continue
      seenKeys.add(identity)
      upsertChunk.run(
        key.mission_id,
        key.device_id,
        key.period_kind,
        key.period_id,
        input.drainedAt,
      )
    }
    if (input.failAfterChunkUpdates === true) {
      throw new Error('Injected invalidation drain failure.')
    }
    database.prepare(`UPDATE coverage_invalidations SET drained_at = ?
      WHERE id = ? AND drained_at IS NULL`)
      .run(input.drainedAt, input.invalidationId)
    return {
      applied: true,
      changeSeq: bumpCoverageChangeSequence(
        database,
        invalidation.mission_id,
        input.drainedAt,
      ),
    }
  })
  return apply()
}

/**
 * Establishes a bounded main-side invalidation floor before worker output may
 * authorize a durable drain. It never reads positions: over-dirtying every
 * canonical device in the affected periods is safe, while under-dirtying is not.
 */
function normalizeCoverageInvalidationDrain(database, invalidationId, analysis) {
  const invalidation = database.prepare(`SELECT mission_id, subject_outing_id,
      range_from, range_to
    FROM coverage_invalidations WHERE id = ?`).get(invalidationId)
  if (invalidation === undefined) {
    throw new Error(`Coverage invalidation not found: ${invalidationId}`)
  }
  if (
    analysis === null ||
    typeof analysis !== 'object' ||
    Array.isArray(analysis) ||
    analysis.invalidationId !== invalidationId ||
    !Array.isArray(analysis.affectedKeys)
  ) {
    throw new Error('Coverage invalidation analysis result is invalid.')
  }

  const affectedOutingIds = new Set([invalidation.subject_outing_id])
  for (const outing of database.prepare(`SELECT id, started_at, ended_at
    FROM outings WHERE mission_id = ? ORDER BY started_at ASC, id ASC`)
    .all(invalidation.mission_id)) {
    if (coverageOutingIntersectsInvalidation(outing, invalidation)) {
      affectedOutingIds.add(outing.id)
    }
  }
  const conservativeFloor = readCoverageInventory(database, invalidation.mission_id)
    .filter((key) => key.period_kind === 'unassigned' ||
      affectedOutingIds.has(key.period_id))
    .map((key) => ({ mission_id: invalidation.mission_id, ...key }))
  if (analysis.affectedKeys.length > conservativeFloor.length) {
    throw new Error('Coverage invalidation analysis exceeds current inventory.')
  }
  const allowed = new Set(conservativeFloor.map((key) =>
    createCoverageChunkIdentity(key.device_id, key.period_kind, key.period_id)))
  const seen = new Set()
  for (const key of analysis.affectedKeys) {
    if (
      key === null ||
      typeof key !== 'object' ||
      Array.isArray(key) ||
      key.mission_id !== invalidation.mission_id
    ) {
      throw new Error('Coverage invalidation analysis key is invalid.')
    }
    const identity = createCoverageChunkIdentity(
      key.device_id,
      key.period_kind,
      key.period_id,
    )
    if (!allowed.has(identity)) {
      throw new Error('Coverage invalidation analysis key is outside the affected inventory.')
    }
    if (seen.has(identity)) {
      throw new Error('Coverage invalidation analysis contains duplicate keys.')
    }
    seen.add(identity)
  }
  return conservativeFloor
}

/** Tests half-open current outing overlap with a captured invalidation union. */
function coverageOutingIntersectsInvalidation(outing, invalidation) {
  if (invalidation.range_to !== null && outing.started_at >= invalidation.range_to) {
    return false
  }
  return outing.ended_at === null || outing.ended_at > invalidation.range_from
}

/**
 * Commits the first canonical chunk enumeration atomically.
 * If mission evidence moved during the worker snapshot, new rows are pending
 * instead of inheriting stale metadata as a false fresh claim.
 */
function applyCoverageEnumeration(database, input) {
  const apply = database.transaction(() => {
    database.prepare(`INSERT INTO coverage_missions (
        mission_id, change_seq, enumerated, updated_at
      ) VALUES (?, 0, 0, ?)
      ON CONFLICT(mission_id) DO NOTHING`)
      .run(input.missionId, input.updatedAt)
    const mission = database.prepare(`SELECT change_seq, enumerated
      FROM coverage_missions WHERE mission_id = ?`).get(input.missionId)
    if (mission.enumerated === 1) {
      return { applied: false, changeSeq: mission.change_seq }
    }
    const snapshotMoved = mission.change_seq !== input.expectedChangeSeq
    const readChunk = database.prepare(`SELECT content_rev FROM coverage_chunks
      WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
    const insertChunk = database.prepare(`INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id,
        content_rev, built_rev, fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`)
    const applyFreshMetadata = database.prepare(`UPDATE coverage_chunks SET
        built_rev = content_rev,
        fix_count = ?, fix_digest = ?, min_ts = ?, max_ts = ?, updated_at = ?
      WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
    for (const chunk of input.chunks) {
      const existing = readChunk.get(
        input.missionId,
        chunk.device_id,
        chunk.period_kind,
        chunk.period_id,
      )
      if (existing === undefined) {
        insertChunk.run(
          input.missionId,
          chunk.device_id,
          chunk.period_kind,
          chunk.period_id,
          snapshotMoved ? null : 1,
          snapshotMoved ? null : chunk.fix_count,
          snapshotMoved ? null : chunk.fix_digest,
          snapshotMoved ? null : chunk.min_ts,
          snapshotMoved ? null : chunk.max_ts,
          input.updatedAt,
        )
      } else if (!snapshotMoved) {
        applyFreshMetadata.run(
          chunk.fix_count,
          chunk.fix_digest,
          chunk.min_ts,
          chunk.max_ts,
          input.updatedAt,
          input.missionId,
          chunk.device_id,
          chunk.period_kind,
          chunk.period_id,
        )
      }
    }
    if (input.failBeforeCommit === true) {
      throw new Error('Injected coverage enumeration failure.')
    }
    database.prepare(`UPDATE coverage_missions SET enumerated = 1
      WHERE mission_id = ?`).run(input.missionId)
    return {
      applied: true,
      changeSeq: bumpCoverageChangeSequence(
        database,
        input.missionId,
        input.updatedAt,
      ),
    }
  })
  return apply()
}

/** Applies a build only while the target logical chunk remains at its snapshot revision. */
function applyCoverageChunkBuild(database, input) {
  const result = database.prepare(`UPDATE coverage_chunks SET
      built_rev = ?, fix_count = ?, fix_digest = ?, min_ts = ?, max_ts = ?,
      updated_at = ?
    WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?
      AND content_rev = ?`)
    .run(
      input.expectedContentRev,
      input.fixCount,
      input.fixDigest,
      input.minTs,
      input.maxTs,
      input.updatedAt,
      input.missionId,
      input.deviceId,
      input.periodKind,
      input.periodId,
      input.expectedContentRev,
    )
  return result.changes === 1
}

/** Applies one worker result set atomically, with no per-chunk autocommits. */
function applyCoverageChunkBuilds(database, input) {
  const apply = database.transaction(() => {
    const rejectedChunkKeys = []
    for (const [index, build] of input.builds.entries()) {
      const applied = applyCoverageChunkBuild(database, {
        missionId: input.missionId,
        deviceId: build.key.device_id,
        periodKind: build.key.period_kind,
        periodId: build.key.period_id,
        expectedContentRev: build.contentRev,
        fixCount: build.fixCount,
        fixDigest: build.fixDigest,
        minTs: build.minTs,
        maxTs: build.maxTs,
        updatedAt: input.updatedAt,
      })
      if (!applied) {
        rejectedChunkKeys.push(createCoverageChunkIdentity(
          build.key.device_id,
          build.key.period_kind,
          build.key.period_id,
        ))
      }
      if (input.failAfterBuildIndex === index) {
        throw new Error('Injected coverage build batch failure.')
      }
    }
    return { rejectedChunkKeys }
  })
  return apply()
}

/**
 * Inserts missing canonical inventory from one exact manifest snapshot without
 * overwriting a write-path revision created concurrently.
 */
function applyCoverageManifestInventory(database, input) {
  const apply = database.transaction(() => {
    const mission = database.prepare(`SELECT change_seq FROM coverage_missions
      WHERE mission_id = ?`).get(input.missionId)
    if (mission === undefined || mission.change_seq !== input.expectedChangeSeq) {
      return 0
    }
    const existing = database.prepare(`SELECT 1 FROM coverage_chunks
      WHERE mission_id = ? AND device_id = ? AND period_kind = ? AND period_id = ?`)
    const devicesWithMissingInventory = new Set()
    for (const chunk of input.chunks) {
      if (existing.get(
        input.missionId,
        chunk.key.device_id,
        chunk.key.period_kind,
        chunk.key.period_id,
      ) === undefined) {
        devicesWithMissingInventory.add(chunk.key.device_id)
      }
    }
    const invalidateExistingDeviceChunks = database.prepare(`UPDATE coverage_chunks SET
      content_rev = content_rev + 1,
      built_rev = NULL,
      updated_at = ?
      WHERE mission_id = ? AND device_id = ?`)
    for (const deviceId of devicesWithMissingInventory) {
      invalidateExistingDeviceChunks.run(input.updatedAt, input.missionId, deviceId)
    }
    const insert = database.prepare(`INSERT INTO coverage_chunks (
        mission_id, device_id, period_kind, period_id,
        content_rev, built_rev, fix_count, fix_digest, min_ts, max_ts, updated_at
      ) VALUES (?, ?, ?, ?, 1, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(mission_id, device_id, period_kind, period_id) DO NOTHING`)
    let inserted = 0
    for (const chunk of input.chunks) {
      inserted += insert.run(
        input.missionId,
        chunk.key.device_id,
        chunk.key.period_kind,
        chunk.key.period_id,
        chunk.exactCount,
        chunk.exactDigest,
        chunk.exactMinTs,
        chunk.exactMaxTs,
        input.updatedAt,
      ).changes
    }
    return inserted
  })
  return apply()
}

/** Bumps the mission attestation stamp exactly once for an owning transaction. */
function bumpCoverageChangeSequence(database, missionId, updatedAt) {
  database.prepare(`INSERT INTO coverage_missions (
      mission_id, change_seq, enumerated, updated_at
    ) VALUES (?, 1, 0, ?)
    ON CONFLICT(mission_id) DO UPDATE SET
      change_seq = coverage_missions.change_seq + 1,
      updated_at = excluded.updated_at`)
    .run(missionId, updatedAt)
  const row = database.prepare(`SELECT change_seq FROM coverage_missions
    WHERE mission_id = ?`).get(missionId)
  return row.change_seq
}

/** Creates a stable tagged identity without allowing Unassigned collisions. */
function createCoverageChunkIdentity(deviceId, periodKind, periodId) {
  return `${deviceId}\u0000${periodKind}\u0000${periodId}`
}

/** Derives the deterministic union of the old and new half-open windows. */
function deriveInvalidationRange(oldBounds, newBounds) {
  const windows = [oldBounds, newBounds].filter((bounds) => bounds !== null)
  if (windows.length === 0) {
    throw new Error('Coverage invalidation requires an old or new outing window.')
  }
  const starts = windows.map((bounds) => bounds.started_at)
  const rangeFrom = starts.reduce((earliest, value) =>
    value < earliest ? value : earliest)
  const rangeTo = windows.some((bounds) => bounds.ended_at === null)
    ? null
    : windows
      .map((bounds) => bounds.ended_at)
      .reduce((latest, value) => value > latest ? value : latest)
  return { rangeFrom, rangeTo }
}

module.exports = {
  appendCoverageInvalidation,
  applyCoverageChunkBuild,
  applyCoverageChunkBuilds,
  applyCoverageEnumeration,
  applyCoverageInvalidationDrain,
  applyCoverageManifestInventory,
  bumpCoverageChangeSequence,
  createCoverageChunkIdentity,
  deriveInvalidationRange,
  normalizeCoverageInvalidationDrain,
  recordAcceptedCoveragePositions,
}
