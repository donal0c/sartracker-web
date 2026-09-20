import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { validateArchiveSecurityReceipt } from '../../scripts/qualification/archive-security-receipts.mjs'

const repositoryRoot = path.resolve('.')
const probePath = path.join(repositoryRoot, 'scripts', 'qualification', 'archive-security-probe.cjs')
const SOURCE_SHA = 'a'.repeat(40)

type JsonObject = Record<string, unknown>

/** Runs only the explicitly marked source-calibration probe. */
function sourceReport(): JsonObject {
  return JSON.parse(execFileSync(process.execPath, [
    probePath,
    '--source-root', repositoryRoot,
    '--source-sha', SOURCE_SHA,
  ], { cwd: repositoryRoot, encoding: 'utf8' })) as JsonObject
}

/** Builds the controller-owned binding from independently inspected facts. */
function expectedBinding(report: JsonObject): JsonObject {
  const runtime = report.runtime as JsonObject
  const corpus = report.corpus as JsonObject
  return {
    proofMode: 'source-calibration',
    sourceSha: SOURCE_SHA,
    corpusId: corpus.id,
    caseIds: corpus.caseIds,
    runtime: {
      tier: 'source-calibration',
      sourceRoot: repositoryRoot,
      executablePath: runtime.executablePath,
      executableSha256: runtime.executableSha256,
      appAsarPath: null,
      appAsarSha256: null,
    },
  }
}

/** Returns a deep mutable copy for deliberate receipt mutation tests. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('C21 archive-security probe and receipt', () => {
  it('accepts the exact bounded corpus while retaining an explicit coverage gap', () => {
    const report = sourceReport()
    const result = validateArchiveSecurityReceipt(report, expectedBinding(report))

    expect(result).toMatchObject({
      contractId: 'C21',
      proofMode: 'source-calibration',
      status: 'PASS_WITH_GAPS',
      valid: true,
      passed: true,
      complete: false,
      releaseEligible: false,
      corpusId: 'sararch2-frame-mutation-v1',
    })
    expect(result.caseIds).toEqual([
      'valid-roundtrip', 'recovery-roundtrip', 'machine-slot-unlock', 'wrong-key', 'flip',
      'truncate', 'append', 'duplicate-frame', 'reorder-frame', 'missing-key-slot',
      'duplicate-key-slot', 'slot-replacement', 'unavailable-key-slot', 'splice-frame',
      'mission-header-swap', 'epoch-header-swap', 'entry-boundary-duplicate',
      'entry-boundary-index-gap', 'legacy-v1-roundtrip', 'legacy-v1-mutant',
      'manifest-inventory-extra', 'registry-ciphertext-swap',
      'archive-replaced-during-verify', 'same-open-file-replacement',
      'cross-process-custody-reconciliation',
    ])
    expect(result.coverageGaps).toEqual([])
    expect(result.cases).toHaveLength(25)
    for (const validId of ['valid-roundtrip', 'recovery-roundtrip', 'machine-slot-unlock', 'legacy-v1-roundtrip']) {
      expect(result.cases.find((entry) => entry.id === validId)).toMatchObject({
        result: { accepted: true, code: 'PASS' },
        original: { unchanged: true },
      })
    }
    for (const entry of result.cases.filter((candidate) => !['valid-roundtrip', 'recovery-roundtrip', 'machine-slot-unlock', 'legacy-v1-roundtrip', 'unavailable-key-slot'].includes(candidate.id))) {
      expect(entry.result.accepted).toBe(false)
      expect(entry.result.code).toMatch(/ARCHIVE_|SARARCH2_/u)
      expect(entry.original.unchanged).toBe(true)
      expect(entry.plaintext.retainedBytes).toBe(0)
      expect(entry.plaintext.residueDetected).toBe(false)
    }
    expect(result.cases.find((entry) => entry.id === 'same-open-file-replacement')).toMatchObject({
      kind: 'custody',
      result: { code: 'ARCHIVE_CUSTODY_IDENTITY_CHANGED' },
      custody: { inspected: true, identityChanged: true, callbackRan: false },
    })
    expect(result.cases.find((entry) => entry.id === 'registry-ciphertext-swap')).toMatchObject({
      kind: 'custody',
      result: { code: 'ARCHIVE_CUSTODY_REGISTRY_MISMATCH' },
      custody: { reconciliationOutcome: 'available', reconciliationWorkerExited: false },
    })
    expect(result.cases.find((entry) => entry.id === 'cross-process-custody-reconciliation')).toMatchObject({
      kind: 'custody',
      result: { code: 'ARCHIVE_CUSTODY_REGISTRY_MISMATCH' },
      custody: { reconciliationOutcome: 'available', reconciliationWorkerExited: true },
    })
    expect(result.cases.find((entry) => entry.id === 'unavailable-key-slot')).toMatchObject({
      kind: 'key-slot',
      result: { accepted: false, code: null, classification: 'key-slot-unavailable', name: 'TypeError' },
      plaintext: { observedBytes: 0, retainedBytes: 0, residueDetected: false },
    })
    expect(result.cases.find((entry) => entry.id === 'manifest-inventory-extra')).toMatchObject({
      kind: 'mutation',
      result: { accepted: false, code: 'ARCHIVE_VERIFY_ENTRY_MISMATCH' },
      plaintext: { observedBytes: 0, retainedBytes: 0, residueDetected: false },
    })
    expect(result.cases.find((entry) => entry.id === 'legacy-v1-mutant')).toMatchObject({
      kind: 'legacy',
      result: { accepted: false, code: 'LEGACY_ARCHIVE_CORRUPT_ENTRY' },
      plaintext: { observedBytes: 0, retainedBytes: 0, residueDetected: false },
    })
    expect(result.secretCanaryScan).toEqual({ passphrase: false, recoveryCode: false })
  }, 30_000)

  it('rejects missing, duplicate, reordered, or unexpected corpus identities', () => {
    const report = sourceReport()
    const expected = expectedBinding(report)
    const missing = copy(report)
    missing.cases = (missing.cases as JsonObject[]).slice(1)
    expect(validateArchiveSecurityReceipt(missing, expected).valid).toBe(false)

    const duplicate = copy(report)
    duplicate.cases = [...(duplicate.cases as JsonObject[]), (duplicate.cases as JsonObject[])[0]]
    expect(validateArchiveSecurityReceipt(duplicate, expected).valid).toBe(false)

    const forged = copy(report)
    const cases = forged.cases as JsonObject[]
    cases.find((entry) => entry.id === 'flip')!.result = { accepted: true, code: 'PASS' }
    expect(validateArchiveSecurityReceipt(forged, expected).valid).toBe(false)
  }, 30_000)

  it('rejects forged digest, parser code, plaintext residue, and original immutability facts', () => {
    const report = sourceReport()
    const expected = expectedBinding(report)
    const mutations = [
      (value: JsonObject) => { value.fixture = { ...(value.fixture as JsonObject), archiveSha256: 'b'.repeat(64) } },
      (value: JsonObject) => {
        const entry = (value.cases as JsonObject[]).find((candidate) => candidate.id === 'flip')!
        entry.result = { ...(entry.result as JsonObject), code: 'PASS' }
      },
      (value: JsonObject) => {
        const entry = (value.cases as JsonObject[]).find((candidate) => candidate.id === 'append')!
        entry.plaintext = { ...(entry.plaintext as JsonObject), retainedBytes: 1 }
      },
      (value: JsonObject) => {
        const entry = (value.cases as JsonObject[]).find((candidate) => candidate.id === 'truncate')!
        entry.original = { ...(entry.original as JsonObject), unchanged: false }
      },
    ]
    for (const mutate of mutations) {
      const mutated = copy(report)
      mutate(mutated)
      expect(validateArchiveSecurityReceipt(mutated, expected).valid).toBe(false)
    }
  }, 30_000)

  it('never treats source calibration as packaged-module evidence', () => {
    const report = sourceReport()
    const expected = expectedBinding(report)
    expected.proofMode = 'packaged-module'
    ;(expected.runtime as JsonObject).tier = 'packaged-module'
    expect(validateArchiveSecurityReceipt(report, expected)).toMatchObject({
      status: 'INVALID_EVIDENCE',
      valid: false,
      releaseEligible: false,
    })
  }, 30_000)

  it('does not accept a report that substitutes an unbound secret or plaintext claim', () => {
    const report = sourceReport()
    const expected = expectedBinding(report)
    const forged = copy(report)
    forged.secretCanaryScan = { passphrase: true, recoveryCode: false }
    expect(validateArchiveSecurityReceipt(forged, expected).valid).toBe(false)
    const leaked = copy(report)
    leaked.cases[0].plaintext.observedSha256 = 'c'.repeat(64)
    expect(validateArchiveSecurityReceipt(leaked, expected).valid).toBe(false)
  }, 30_000)

  it('requires the remaining structural and legacy gaps to stay explicit', () => {
    const report = sourceReport()
    const expected = expectedBinding(report)
    const undeclared = copy(report)
    delete (undeclared.corpus as JsonObject).missingStructuralCases
    expect(validateArchiveSecurityReceipt(undeclared, expected).valid).toBe(false)
  }, 30_000)
})
