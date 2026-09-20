import { describe, expect, it } from 'vitest'

import { createC17PackagedSupportExportReceipt } from '../../scripts/qualification/verify-c17-packaged-support-export.mjs'

describe('C17 packaged support-export development receipt', () => {
  it('records zero canaries without treating intentional coverage gaps as qualification', () => {
    const receipt = createC17PackagedSupportExportReceipt({
      sourceHead: '6c57cbf4d66a61e98ca57e27358bc885e19c0d58',
      appSha256: 'a'.repeat(64),
      validation: {
        status: 'PASS',
        valid: true,
        complete: false,
        coverageComplete: false,
        coverageGaps: ['recursive-adversarial-corpus', 'bounded-output-scan-identity'],
        failureReasons: [],
        phaseFacts: {
          sanitized: true,
          containsSecret: false,
          containsProfilePath: false,
          exactSecretMatches: 0,
          adversarialMatchCount: 0,
          canaryCount: 6,
          leakedCanaryIds: [],
          outputByteLength: 1234,
          outputWithinLimit: true,
        },
      },
    })

    expect(receipt.zeroCanary).toBe(true)
    expect(receipt.complete).toBe(false)
    expect(receipt.coverageGaps).toEqual(['recursive-adversarial-corpus', 'bounded-output-scan-identity'])
    expect(receipt.qualificationExecuted).toBe(false)
    expect(receipt.releaseEligible).toBe(false)
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
          canaryCount: 6,
          leakedCanaryIds: ['nested-array-secret'],
          outputByteLength: 1234,
          outputWithinLimit: true,
        },
      },
    })

    expect(receipt.zeroCanary).toBe(false)
    expect(receipt.diagnostics.leakedCanaryIds).toEqual(['nested-array-secret'])
    expect(receipt.failureReasons).toEqual(['C17 canary leaked.'])
  })
})
