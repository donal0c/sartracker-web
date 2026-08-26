const { isStrictTrackingTimestamp } = require('./tracking-timestamp.cjs')
const { createCoverageTileCatalog } = require('./coverage-tile-catalog.cjs')

/** Creates the collision-free identity shared by coverage worker envelopes. */
function createCoverageChunkIdentity(key) {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

/** Validates and copies one mission identity before worker allocation. */
function normalizeCoverageMissionId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
    throw new Error('Coverage mission ID is invalid.')
  }
  return value
}

/** Validates and copies one tagged logical coverage identity. */
function normalizeCoverageChunkKey(value) {
  if (
    !isPlainRecord(value) ||
    typeof value.device_id !== 'string' ||
    value.device_id.length < 1 ||
    value.device_id.length > 100 ||
    !['outing', 'unassigned'].includes(value.period_kind) ||
    typeof value.period_id !== 'string' ||
    value.period_id.length > 100 ||
    (value.period_kind === 'outing' && value.period_id.length < 1) ||
    (value.period_kind === 'unassigned' && value.period_id !== '')
  ) {
    throw new Error('Coverage chunk key is invalid.')
  }
  return {
    device_id: value.device_id,
    period_kind: value.period_kind,
    period_id: value.period_id,
  }
}

/** Validates a unique key array before it can be structured-cloned to a worker. */
function normalizeCoverageSelectedKeys(value, maximumCount = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value)) throw new Error('Coverage selected keys are invalid.')
  if (value.length > maximumCount) {
    throw new Error('Coverage selected keys exceed the current mission inventory.')
  }
  const identities = new Set()
  return value.map((candidate) => {
    const key = normalizeCoverageChunkKey(candidate)
    const identity = createCoverageChunkIdentity(key)
    if (identities.has(identity)) throw new Error('Duplicate coverage chunk key is invalid.')
    identities.add(identity)
    return key
  })
}

/** Validates and copies a unique revision-bound catalog request. */
function normalizeCoverageCatalogInput(value, maximumCount = Number.MAX_SAFE_INTEGER) {
  if (!isPlainRecord(value)) throw new Error('Coverage tile catalog request is invalid.')
  const missionId = normalizeCoverageMissionId(value.missionId)
  if (!Array.isArray(value.chunks)) throw new Error('Coverage catalog chunks are invalid.')
  if (value.chunks.length > maximumCount) {
    throw new Error('Coverage catalog chunks exceed the current mission inventory.')
  }
  const identities = new Set()
  const chunks = value.chunks.map((candidate) => {
    if (!isPlainRecord(candidate)) throw new Error('Coverage catalog chunk is invalid.')
    const key = normalizeCoverageChunkKey(candidate.key)
    const identity = createCoverageChunkIdentity(key)
    if (identities.has(identity)) throw new Error('Duplicate coverage chunk key is invalid.')
    identities.add(identity)
    if (!Number.isSafeInteger(candidate.contentRev) || candidate.contentRev < 1) {
      throw new Error('Coverage catalog content revision is invalid.')
    }
    return { key, contentRev: candidate.contentRev }
  })
  return { missionId, chunks }
}

/**
 * Validates and copies the complete tile-worker result before main-isolate
 * ledger application. Every returned build and delivery must be authorized by
 * exactly one normalized request descriptor.
 */
function normalizeCoverageCatalogWorkerResult(input, value) {
  if (!isPlainRecord(value)) throw invalidCatalogResult('result is not an object')
  const stageId = normalizeCoverageStageId(value.stageId)
  const requested = new Map(input.chunks.map((descriptor) => [
    createCoverageChunkIdentity(descriptor.key), descriptor,
  ]))
  const delivered = normalizeWorkerDescriptors(value.delivered, requested)
  const builds = normalizeWorkerBuilds(value.builds, requested)
  const periods = normalizeWorkerPeriods(value.periods, input)
  return { stageId, periods, delivered, builds }
}

/** Validates that worker delivery attestation exactly covers the request. */
function normalizeWorkerDescriptors(value, requested) {
  if (!Array.isArray(value) || value.length > requested.size) {
    throw invalidCatalogResult('delivered descriptors are unbounded')
  }
  const seen = new Set()
  const descriptors = value.map((candidate) => {
    if (!isPlainRecord(candidate)) throw invalidCatalogResult('delivered descriptor is invalid')
    const key = normalizeResultKey(candidate.key)
    const identity = createCoverageChunkIdentity(key)
    const expected = requested.get(identity)
    if (
      expected === undefined ||
      seen.has(identity) ||
      candidate.contentRev !== expected.contentRev
    ) {
      throw invalidCatalogResult('delivered descriptor diverged from the request')
    }
    seen.add(identity)
    return { key, contentRev: candidate.contentRev }
  })
  if (seen.size !== requested.size) {
    throw invalidCatalogResult('delivered descriptors are incomplete')
  }
  return descriptors
}

/** Validates bounded build metadata before it can reach a main-isolate transaction. */
function normalizeWorkerBuilds(value, requested) {
  if (!Array.isArray(value) || value.length > requested.size) {
    throw invalidCatalogResult('build descriptors are unbounded')
  }
  const seen = new Set()
  return value.map((candidate) => {
    if (!isPlainRecord(candidate)) throw invalidCatalogResult('build descriptor is invalid')
    const key = normalizeResultKey(candidate.key)
    const identity = createCoverageChunkIdentity(key)
    const expected = requested.get(identity)
    if (
      expected === undefined ||
      seen.has(identity) ||
      candidate.contentRev !== expected.contentRev ||
      !Number.isSafeInteger(candidate.fixCount) ||
      candidate.fixCount < 0 ||
      typeof candidate.fixDigest !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(candidate.fixDigest) ||
      !isOptionalCoverageTimestamp(candidate.minTs) ||
      !isOptionalCoverageTimestamp(candidate.maxTs)
    ) {
      throw invalidCatalogResult('build descriptor diverged from the request')
    }
    seen.add(identity)
    return {
      key,
      contentRev: candidate.contentRev,
      fixCount: candidate.fixCount,
      fixDigest: candidate.fixDigest,
      minTs: candidate.minTs,
      maxTs: candidate.maxTs,
    }
  })
}

/** Validates bounded period metadata and exact requested contributors. */
function normalizeWorkerPeriods(value, input) {
  const requestedPeriods = new Map(
    createCoverageTileCatalog(input).periods.map((period) => [period.periodKey, period]),
  )
  if (!Array.isArray(value) || value.length > requestedPeriods.size) {
    throw invalidCatalogResult('period descriptors are unbounded')
  }
  const seen = new Set()
  const periods = value.map((candidate) => {
    if (
      !isPlainRecord(candidate) ||
      typeof candidate.periodKey !== 'string' ||
      candidate.periodKey.length < 1 ||
      candidate.periodKey.length > 201 ||
      typeof candidate.revisionDigest !== 'string' ||
      candidate.revisionDigest.length < 1 ||
      candidate.revisionDigest.length > 100 ||
      !Array.isArray(candidate.contributors)
    ) {
      throw invalidCatalogResult('period descriptor is invalid')
    }
    const expected = requestedPeriods.get(candidate.periodKey)
    if (expected === undefined || seen.has(candidate.periodKey)) {
      throw invalidCatalogResult('period descriptor diverged from the request')
    }
    const contributors = new Set(candidate.contributors)
    const expectedContributors = new Set(expected.contributors)
    if (
      candidate.revisionDigest !== expected.revisionDigest ||
      contributors.size !== expectedContributors.size ||
      candidate.contributors.length !== expectedContributors.size ||
      candidate.contributors.some((contributor) =>
        typeof contributor !== 'string' || !expectedContributors.has(contributor))
    ) {
      throw invalidCatalogResult('period descriptor diverged from the request')
    }
    seen.add(candidate.periodKey)
    return {
      periodKey: candidate.periodKey,
      revisionDigest: expected.revisionDigest,
      contributors: [...expected.contributors],
    }
  })
  if (seen.size !== requestedPeriods.size) {
    throw invalidCatalogResult('period descriptors are incomplete')
  }
  return periods
}

/** Converts a key validation failure into the worker-result error boundary. */
function normalizeResultKey(value) {
  try {
    return normalizeCoverageChunkKey(value)
  } catch {
    throw invalidCatalogResult('chunk key is invalid')
  }
}

/** Validates the opaque stage token minted by one long-lived tile worker. */
function normalizeCoverageStageId(value) {
  if (
    typeof value !== 'string' ||
    value.length > 100 ||
    !/^coverage-stage-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[1-9][0-9]*$/u.test(value)
  ) {
    throw invalidCatalogResult('stage ID is invalid')
  }
  return value
}

/** Returns whether a build bound is absent or one strict tracking timestamp. */
function isOptionalCoverageTimestamp(value) {
  return value === null || isStrictTrackingTimestamp(value)
}

/** Creates the stable error family used for untrusted worker output. */
function invalidCatalogResult(reason) {
  return new Error(`Coverage catalog worker result is invalid: ${reason}.`)
}

/** Returns whether a structured-clone value is one plain record. */
function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  createCoverageChunkIdentity,
  normalizeCoverageCatalogInput,
  normalizeCoverageCatalogWorkerResult,
  normalizeCoverageChunkKey,
  normalizeCoverageMissionId,
  normalizeCoverageSelectedKeys,
}
