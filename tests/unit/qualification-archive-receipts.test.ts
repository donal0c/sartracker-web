import { describe, expect, it } from 'vitest'

import {
  PACKAGED_LIFECYCLE_HEAD,
  PACKAGED_LIFECYCLE_SHA256,
  PACKAGED_LIFECYCLE_TREE,
  createPackagedArchiveLifecycleV2Evidence,
} from '../../tests/fixtures/packaged-archive-lifecycle-v2'
import { validateArchiveContractEvidence } from '../../scripts/qualification/archive-receipts.mjs'

const expected = {
  source: {
    expectedHead: PACKAGED_LIFECYCLE_HEAD,
    tree: PACKAGED_LIFECYCLE_TREE,
  },
  artifact: {
    packagedExecutableSha256: PACKAGED_LIFECYCLE_SHA256,
    packagedApplicationArchiveSha256: PACKAGED_LIFECYCLE_SHA256,
  },
  workload: {
    missionId: 'mission-packaged-proof',
    seededPositionRows: 4_096,
    seededReplayObjectRows: 202,
    seededOutingChoices: 101,
  },
  proofMode: 'packaged-electron-unpacked',
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    ...createPackagedArchiveLifecycleV2Evidence(),
    ...overrides,
  }
}

describe('candidate archive contract receipt validation', () => {
  it.each(['ci-appimage', 'installed-deb'])('retains independently observed %s tier rather than relabelling it unpacked', (proofMode) => {
    const launchPath = proofMode === 'ci-appimage' ? '/owned/candidate.AppImage' : '/opt/SAR/sartracker'
    const runtime = { proofMode, launchPath, installedExecutablePath: proofMode === 'installed-deb' ? launchPath : undefined,
      artifactSha256: PACKAGED_LIFECYCLE_SHA256, executableSha256: PACKAGED_LIFECYCLE_SHA256, asarSha256: PACKAGED_LIFECYCLE_SHA256 }
    const observation = { pid: 101, startTicks: '12345', mainProcess: true, descendantOfRunner: true, launchPath,
      executablePath: proofMode === 'installed-deb' ? launchPath : '/owned/appimage/sartracker',
      artifactSha256: PACKAGED_LIFECYCLE_SHA256, executableSha256: PACKAGED_LIFECYCLE_SHA256, asarSha256: PACKAGED_LIFECYCLE_SHA256,
      appImagePath: proofMode === 'ci-appimage' ? launchPath : null }
    const binding = { ...expected, proofMode, runtime: { expected: runtime, observations: [observation] } }
    expect(validateArchiveContractEvidence('C22', report(), binding)).toMatchObject({ valid: true, proofMode })
    binding.runtime.observations[0].asarSha256 = 'f'.repeat(64)
    expect(validateArchiveContractEvidence('C22', report(), binding).valid).toBe(false)
  })
  it('validates C20 against independent integrity, custody, replay and cleanup predicates', () => {
    const result = validateArchiveContractEvidence('C20', report(), expected)

    expect(result).toMatchObject({
      contractId: 'C20',
      status: 'PASS',
      valid: true,
      passed: true,
      releaseEligible: false,
      proofMode: 'packaged-electron-unpacked',
      predicates: { integrity: true, custody: true, replay: true, cleanup: true },
    })
    expect(result.failureReasons).toEqual([])
  })

  it('validates C22 through its own restore, review, revision and cleanup predicates', () => {
    const result = validateArchiveContractEvidence('C22', report(), expected)

    expect(result).toMatchObject({
      contractId: 'C22',
      status: 'PASS',
      valid: true,
      passed: true,
      predicates: { integrity: true, custody: true, replay: true, cleanup: true },
    })
  })

  it.each([
    ['source head', { source: { ...expected.source, expectedHead: 'd'.repeat(40) } }],
    ['source tree', { source: { ...expected.source, tree: 'd'.repeat(40) } }],
    ['executable artifact', { artifact: { ...expected.artifact, packagedExecutableSha256: 'd'.repeat(64) } }],
    ['application artifact', { artifact: { ...expected.artifact, packagedApplicationArchiveSha256: 'd'.repeat(64) } }],
    ['mission workload', { workload: { ...expected.workload, missionId: 'other-mission' } }],
    ['row workload', { workload: { ...expected.workload, seededPositionRows: 4_097 } }],
  ])('rejects independently mismatched %s identity', (_label, expectedOverride) => {
    const result = validateArchiveContractEvidence('C20', report(), {
      ...expected,
      ...expectedOverride,
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.failureReasons.join(' ')).toMatch(/identity|workload|source|artifact/iu)
  })

  it('rejects a schema-v1 report even when the producer verdict says passed', () => {
    const result = validateArchiveContractEvidence('C20', report({
      schemaVersion: 1,
      proofKind: 'packaged-electron-archive-lifecycle-v1',
      verdict: { passed: true, failureReasons: [] },
    }), expected)

    expect(result.valid).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/schema.*2|v2/iu)
  })

  it('does not trust the embedded passed flag when replay evidence is wrong', () => {
    const original = createPackagedArchiveLifecycleV2Evidence()
    const tampered = {
      ...original,
      reviewBeforeCleanup: { ...original.reviewBeforeCleanup, replayTrackCount: 1 },
      verdict: { passed: true, failureReasons: [] },
    }
    const result = validateArchiveContractEvidence('C20', tampered, expected)

    expect(result.valid).toBe(false)
    expect(result.passed).toBe(false)
    expect(result.predicates.replay).toBe(false)
  })

  it('checks archive integrity independently of the embedded producer verdict', () => {
    const original = createPackagedArchiveLifecycleV2Evidence()
    const tampered = {
      ...original,
      archive: { ...original.archive, statusAfterIndependentVerify: 'failed' },
      verdict: { passed: true, failureReasons: [] },
    }
    const result = validateArchiveContractEvidence('C20', tampered, expected)

    expect(result.valid).toBe(false)
    expect(result.predicates.integrity).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/lifecycle producer gate|archive.*integrity/iu)
  })

  it('checks custody independently of the embedded producer verdict', () => {
    const original = createPackagedArchiveLifecycleV2Evidence()
    const tampered = {
      ...original,
      privacy: { ...original.privacy, exactSecretMatches: 1 },
      verdict: { passed: true, failureReasons: [] },
    }
    const result = validateArchiveContractEvidence('C20', tampered, expected)

    expect(result.valid).toBe(false)
    expect(result.predicates.custody).toBe(false)
  })

  it('rejects cleanup evidence independently when live rows remain', () => {
    const original = createPackagedArchiveLifecycleV2Evidence()
    const tampered = {
      ...original,
      cleanup: { ...original.cleanup, remainingBreadcrumbRows: 1 },
      verdict: { passed: true, failureReasons: [] },
    }
    const result = validateArchiveContractEvidence('C22', tampered, expected)

    expect(result.valid).toBe(false)
    expect(result.predicates.cleanup).toBe(false)
  })

  it('reports the concrete missing independent C21 producer', () => {
    const result = validateArchiveContractEvidence('C21', report(), expected)

    expect(result).toMatchObject({
      contractId: 'C21',
      status: 'ENVIRONMENT_BLOCKED',
      valid: false,
      passed: false,
      releaseEligible: false,
    })
    expect(result.failureReasons.join(' ')).toMatch(/C21|independent|hostile|key|custody/iu)
  })

  it('does not upgrade the unpacked producer to installed-deb proof', () => {
    const result = validateArchiveContractEvidence('C22', report(), {
      ...expected,
      proofMode: 'installed-deb',
    })

    expect(result.valid).toBe(false)
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.failureReasons.join(' ')).toMatch(/expected binding has missing/iu)
  })
})
