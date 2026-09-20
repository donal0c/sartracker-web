// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { validateArchiveFieldFacts } from '../../scripts/qualification/archive-field-receipts.mjs'

describe('large archive fixed admission predicate', () => {
  it('binds actual ciphertext threshold separately from source size and refuses development proof', () => {
    const expected = { contractId: 'C20', sourceSha: 'a'.repeat(40), appSha256: 'b'.repeat(64), asarSha256: 'c'.repeat(64), evidencePath: '/owned/evidence' }
    const report = { schemaVersion: 1, proofKind: 'packaged-large-archive-v1', contractId: 'C20-C22', variantId: 'field-archive-37gb',
      developmentTestHarness: false, source: { head: expected.sourceSha, expectedHead: expected.sourceSha,
        observedHead: expected.sourceSha, dirty: false, manifest: [{ relativePath: 'electron/main.cjs', sha256: 'f'.repeat(64), sizeBytes: 1 }] }, runtime: { executableSha256: expected.appSha256, asarSha256: expected.asarSha256 },
      sourceFixture: { preset: 'field', sourceBytes: 3700000000, sourceSha256: 'd'.repeat(64) },
      archive: { archiveId: 'archive-1', ciphertextBytes: 3500000000, thresholdBytes: 3500000000, ciphertextSha256: 'e'.repeat(64), containerVersion: 2, verified: true },
      reviewRestore: { opened: true, immutable: true, verified: true, mutationDenied: true, plaintextCleanupComplete: true },
      cleanup: { applicationClosed: true, profileRemoved: true, reviewClosed: true, plaintextRemoved: true }, failure: null }
    expect(validateArchiveFieldFacts(report, expected)).toBeUndefined()
    expect(() => validateArchiveFieldFacts({ ...report, developmentTestHarness: true }, expected)).toThrow()
    expect(() => validateArchiveFieldFacts({ ...report, archive: { ...report.archive, ciphertextBytes: 2 * 1024 ** 3 } }, expected)).toThrow(/ciphertext/)
    expect(() => validateArchiveFieldFacts({ ...report, archive: { ...report.archive, thresholdBytes: 1 } }, expected)).toThrow(/ciphertext/)
    expect(() => validateArchiveFieldFacts({ ...report, cleanup: { ...report.cleanup, plaintextRemoved: false } }, expected)).toThrow(/cleanup/)
    expect(() => validateArchiveFieldFacts(report, { ...expected, sourceSha: 'f'.repeat(40) })).toThrow(/identity/)
    for (const source of [{ ...report.source, observedHead: 'f'.repeat(40) },
      { ...report.source, observedHead: undefined }, { ...report.source, expectedHead: 'f'.repeat(40) },
      { ...report.source, dirty: true }, { ...report.source, dirty: undefined },
      { ...report.source, manifest: [] }]) {
      for (const contractId of ['C20', 'C22']) {
        expect(() => validateArchiveFieldFacts({ ...report, source }, { ...expected, contractId })).toThrow(/identity/iu)
      }
    }
  })
})
