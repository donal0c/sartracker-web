const {
  createCoverageChunkIdentity,
} = require('./coverage-worker-envelope.cjs')

/** Requires worker content evidence for every requested chunk revision. */
function assertCoverageBuildCoverage(requiredIdentities, builds) {
  const observed = new Set(builds.map((build) => createCoverageChunkIdentity(build.key)))
  for (const identity of requiredIdentities) {
    if (!observed.has(identity)) {
      throw invalidBuildAttestation('Coverage required tile build evidence is missing.')
    }
  }
}

/** Binds tile-worker build metadata to independently computed exact SQLite summaries. */
function assertCoverageBuildSummaries(builds, summaries) {
  if (!Array.isArray(summaries) || summaries.length !== builds.length) {
    throw invalidBuildAttestation(
      'Coverage tile build exact summary set diverged from worker evidence.',
    )
  }
  const expected = new Map(summaries.map((summary) => [
    createCoverageChunkIdentity(summary.key),
    summary,
  ]))
  for (const build of builds) {
    const summary = expected.get(createCoverageChunkIdentity(build.key))
    if (
      summary === undefined ||
      summary.contentRev !== build.contentRev ||
      summary.fix_count !== build.fixCount ||
      summary.fix_digest !== build.fixDigest ||
      summary.min_ts !== build.minTs ||
      summary.max_ts !== build.maxTs
    ) {
      throw invalidBuildAttestation(
        'Coverage tile build exact summary diverged from worker evidence.',
      )
    }
  }
}

/** Creates the stable semantic worker-protocol failure family. */
function invalidBuildAttestation(message) {
  const error = new Error(message)
  error.code = 'coverage-build-attestation'
  return error
}

module.exports = {
  assertCoverageBuildCoverage,
  assertCoverageBuildSummaries,
}
