import { validateCiArtifactProvenance } from './candidate-artifacts.mjs'

/** Require successful tag-driven release CI for the exact already-bound artifact ZIP. */
export function validateReleaseCiEvidence(evidence, expected) {
  if (evidence?.run?.path !== '.github/workflows/electron-release.yml') {
    throw new Error('C27 requires the tag-driven release workflow, not ordinary source validation.')
  }
  const provenance = validateCiArtifactProvenance(evidence.run, evidence.artifact, expected)
  if (provenance.archiveSha256 !== expected.archive?.sha256 || provenance.archiveBytes !== expected.archive?.bytes) {
    throw new Error('Release CI archive differs from the immutable candidate archive.')
  }
  return provenance
}

/** Derive CI read identities from immutable candidate inputs rather than release-note assertions. */
export function releaseCiExpectation(definition) {
  const ci = definition.runtimeInputs?.config?.ci
  const expected = { sourceSha: definition.identities?.source?.sha,
    version: definition.identities?.candidate?.version, runId: ci?.provenance?.runId,
    runAttempt: ci?.provenance?.runAttempt, artifactId: ci?.provenance?.artifactId, archive: ci?.archive }
  if (![expected.runId, expected.runAttempt, expected.artifactId].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('C27 requires bound release CI identifiers.')
  }
  return expected
}
