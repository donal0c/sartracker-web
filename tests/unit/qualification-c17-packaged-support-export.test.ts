import { describe, expect, it } from 'vitest'

import { C17_CANARY_IDS } from '../../scripts/qualification/composite-family-receipts.mjs'
import { createC17PackagedSupportExportReceipt } from '../../scripts/qualification/verify-c17-packaged-support-export.mjs'

describe('C17 packaged support-export development receipt', () => {
  it('records zero canaries without treating intentional coverage gaps as qualification', () => {
    const receipt = createC17PackagedSupportExportReceipt({
      sourceHead: '6c57cbf4d66a61e98ca57e27358bc885e19c0d58',
      appSha256: 'a'.repeat(64),
      validation: {
        status: 'PASS',
        valid: true,
        complete: true,
        coverageComplete: true,
        coverageGaps: [],
        failureReasons: [],
        phaseFacts: {
          sanitized: true,
          containsSecret: false,
          containsProfilePath: false,
          exactSecretMatches: 0,
          adversarialMatchCount: 0,
          canaryCount: C17_CANARY_IDS.length,
          positiveControlIds: [...C17_CANARY_IDS],
          sourceCorpusReceiptPath: '/tmp/c17-evidence/c17-source-corpus-receipt.json',
          sourceCorpusReceiptSha256: 'd'.repeat(64),
          outputScanIdentity: {
            schema: 'sartracker-c17-output-scan-identity-v1',
            sourceHead: '6c57cbf4d66a61e98ca57e27358bc885e19c0d58',
            appSha256: 'a'.repeat(64),
            exportedPath: '/tmp/c17-profile/diagnostics-reports/c17-diagnostics-support.txt',
            retainedOutputPath: '/tmp/c17-evidence/c17-sanitized-output.txt',
            scanLimitBytes: 1_048_576,
            outputScanComplete: true,
            outputBytesScanned: 1234,
            outputByteLength: 1234,
            outputSha256: 'b'.repeat(64),
            retainedScanComplete: true,
            retainedBytesScanned: 1234,
            retainedOutputByteLength: 1234,
            retainedOutputSha256: 'b'.repeat(64),
            exactBytesMatch: true,
          },
          leakedCanaryIds: [],
          outputByteLength: 1234,
          outputWithinLimit: true,
          exportedPath: '/tmp/c17-profile/diagnostics-reports/c17-diagnostics-support.txt',
          retainedOutputPath: '/tmp/c17-evidence/c17-sanitized-output.txt',
          retainedCanaryManifestPath: '/tmp/c17-evidence/c17-canary-manifest.txt',
          outputSha256: 'b'.repeat(64),
          canaryManifestSha256: 'c'.repeat(64),
        },
      },
    })

    expect(receipt.zeroCanary).toBe(true)
    expect(receipt.diagnostics.containsSecret).toBe(false)
    expect(receipt.diagnostics.containsProfilePath).toBe(false)
    expect(receipt.diagnostics.secretAbsent).toBe(true)
    expect(receipt.diagnostics.profilePathAbsent).toBe(true)
    expect(receipt.complete).toBe(true)
    expect(receipt.coverageComplete).toBe(true)
    expect(receipt.coverageGaps).toEqual([])
    expect(receipt.qualificationExecuted).toBe(false)
    expect(receipt.releaseEligible).toBe(false)
    expect(receipt.canaryCount).toBe(C17_CANARY_IDS.length)
    expect(receipt.positiveControlIds).toEqual(C17_CANARY_IDS)
    expect(receipt.outputSha256).toBe('b'.repeat(64))
    expect(receipt.canaryManifestSha256).toBe('c'.repeat(64))
    expect(receipt.sourceCorpusReceiptPath).toBe('/tmp/c17-evidence/c17-source-corpus-receipt.json')
    expect(receipt.sourceCorpusReceiptSha256).toBe('d'.repeat(64))
    expect(receipt.outputScanIdentity).toMatchObject({ exactBytesMatch: true })
    expect(receipt.exportedPath).toContain('c17-diagnostics-support.txt')
  })

  it('fails closed when a packaged canary is retained', () => {
    const receipt = createC17PackagedSupportExportReceipt({
      sourceHead: '6c57cbf4d66a61e98ca57e27358bc885e19c0d58',
      appSha256: 'b'.repeat(64),
      validation: {
        status: 'FAIL',
        valid: false,
        complete: false,
        coverageComplete: false,
        coverageGaps: [],
        failureReasons: ['C17 canary leaked.'],
        phaseFacts: {
          sanitized: false,
          containsSecret: true,
          containsProfilePath: true,
          exactSecretMatches: 1,
          adversarialMatchCount: 1,
          canaryCount: C17_CANARY_IDS.length,
          leakedCanaryIds: ['nested-array-secret'],
          outputByteLength: 1234,
          outputWithinLimit: true,
        },
      },
    })

    expect(receipt.zeroCanary).toBe(false)
    expect(receipt.diagnostics.containsSecret).toBe(true)
    expect(receipt.diagnostics.containsProfilePath).toBe(true)
    expect(receipt.diagnostics.leakedCanaryIds).toEqual(['nested-array-secret'])
    expect(receipt.failureReasons).toEqual(['C17 canary leaked.'])
  })
})
