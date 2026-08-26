const { createHash } = require('node:crypto')

const { compareStringsByCodeUnit } = require('./deterministic-string-order.cjs')

/** Creates one revision-bound Candidate-B catalog grouped by logical period. */
function createCoverageTileCatalog(input) {
  const contributorsByPeriod = new Map()
  for (const chunk of input.chunks) {
    const periodKey = createPeriodKey(chunk.key)
    const contributors = contributorsByPeriod.get(periodKey) ?? []
    contributors.push(
      `${createChunkKey(chunk.key)}@${normalizeContentRevision(chunk.contentRev)}`,
    )
    contributorsByPeriod.set(periodKey, contributors)
  }
  const periods = [...contributorsByPeriod.entries()]
    .sort(([left], [right]) => compareStringsByCodeUnit(left, right))
    .map(([periodKey, contributors]) => {
      contributors.sort(compareStringsByCodeUnit)
      return {
        periodKey,
        revisionDigest: createHash('sha256')
          .update(contributors.join('\n'))
          .digest('hex')
          .slice(0, 20),
        contributors,
      }
    })
  return { missionId: input.missionId, periods }
}

/** Finds only chunk and period identities whose own revision set moved. */
function diffCoverageTileCatalog(before, after) {
  if (before.missionId !== after.missionId) {
    throw new Error('Coverage tile catalogs belong to different missions.')
  }
  const beforePeriods = new Map(before.periods.map((period) => [period.periodKey, period]))
  const afterPeriods = new Map(after.periods.map((period) => [period.periodKey, period]))
  const allPeriodKeys = new Set([...beforePeriods.keys(), ...afterPeriods.keys()])
  const invalidatedPeriodKeys = []
  const retainedPeriodKeys = []
  for (const periodKey of [...allPeriodKeys].sort(compareStringsByCodeUnit)) {
    if (
      beforePeriods.get(periodKey)?.revisionDigest ===
      afterPeriods.get(periodKey)?.revisionDigest
    ) {
      retainedPeriodKeys.push(periodKey)
    } else {
      invalidatedPeriodKeys.push(periodKey)
    }
  }
  const beforeChunks = readChunkRevisions(before)
  const afterChunks = readChunkRevisions(after)
  const changedChunkKeys = [...new Set([...beforeChunks.keys(), ...afterChunks.keys()])]
    .filter((key) => beforeChunks.get(key) !== afterChunks.get(key))
    .sort(compareStringsByCodeUnit)
  return { invalidatedPeriodKeys, retainedPeriodKeys, changedChunkKeys }
}

/** Selects cache files containing at least one changed logical chunk. */
function selectInvalidatedCoverageTilePaths(entries, changedChunkKeys) {
  const changed = new Set(changedChunkKeys)
  return entries
    .filter((entry) => entry.contributors.some((contributor) => {
      const revisionSeparator = contributor.lastIndexOf('@')
      return revisionSeparator > 0 && changed.has(contributor.slice(0, revisionSeparator))
    }))
    .map((entry) => entry.path)
    .sort(compareStringsByCodeUnit)
}

/** Creates the tagged logical chunk identity used by tiles and delivery claims. */
function createChunkKey(key) {
  return `${key.device_id}\u0000${key.period_kind}\u0000${key.period_id}`
}

/** Creates a tagged period identity that cannot collide with Unassigned. */
function createPeriodKey(key) {
  return `${key.period_kind}\u0000${key.period_id}`
}

function readChunkRevisions(catalog) {
  const revisions = new Map()
  for (const period of catalog.periods) {
    for (const contributor of period.contributors) {
      const separator = contributor.lastIndexOf('@')
      if (separator < 1) throw new Error('Coverage tile contributor is invalid.')
      revisions.set(contributor.slice(0, separator), contributor.slice(separator + 1))
    }
  }
  return revisions
}

function normalizeContentRevision(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Coverage tile content revision is invalid.')
  }
  return value
}

module.exports = {
  createChunkKey,
  createCoverageTileCatalog,
  createPeriodKey,
  diffCoverageTileCatalog,
  selectInvalidatedCoverageTilePaths,
}
