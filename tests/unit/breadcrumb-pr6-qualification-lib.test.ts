import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
  MAX_ARCHIVE_PROCESS_RSS_BYTES,
  MAX_MAIN_CADENCE_MS,
  MIN_ARCHIVE_CIPHERTEXT_BYTES,
  MIN_FIELD_FIXTURE_BYTES,
  REQUIRED_SCRYPT_MAXMEM_BYTES,
  parseBreadcrumbPr6QualificationArgs,
  validateBreadcrumbPr6QualificationEvidence,
} from '../../build/breadcrumb-pr6-qualification-lib.js'

const require = createRequire(import.meta.url)
const { canonicalJson } = require('../../electron/archive-container.cjs') as {
  readonly canonicalJson: (value: unknown) => string
}
const { listArchiveInventoryForSchema } = require('../../electron/archive-inventory.cjs') as {
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
  ) => readonly { readonly tableName: string }[]
}

const HEAD = 'a'.repeat(40)
const TREE = 'b'.repeat(40)
const ARCHIVE_ID = '22222222-2222-4222-8222-222222222222'
const REQUEST_EVENT_ID = '33333333-3333-4333-8333-333333333333'
const CREATION_OPERATION_ID = '44444444-4444-4444-8444-444444444444'
const ARCHIVE_BYTES = MIN_ARCHIVE_CIPHERTEXT_BYTES + 1
const REPLAY_STRATEGY =
  'mission-start-finish-fence-midpoints-exhaustive-pages-and-outing-filters-v3'

describe('Breadcrumb PR6 qualification evidence contract [DON-252 / BCP-15]', () => {
  it('pins both the database fixture and ciphertext gates above 2 GiB', () => {
    expect(MIN_FIELD_FIXTURE_BYTES).toBe(2 * 1024 * 1024 * 1024)
    expect(MIN_ARCHIVE_CIPHERTEXT_BYTES).toBe(2 * 1024 * 1024 * 1024)
  })

  it('accepts only absolute paths, mission identity and explicit head without CLI secrets', () => {
    expect(parseBreadcrumbPr6QualificationArgs([
      '--fixture', '/fixtures/field.sqlite',
      '--evidence', '/evidence/pr6.json',
      '--mission-id', 'fixture-mission-000000000001',
      '--expected-head', HEAD,
    ])).toEqual({
      fixturePath: '/fixtures/field.sqlite',
      evidencePath: '/evidence/pr6.json',
      missionId: 'fixture-mission-000000000001',
      expectedRepositoryHead: HEAD,
    })

    for (const argv of [
      ['--fixture', 'relative.sqlite', '--evidence', '/evidence/pr6.json', '--mission-id', 'm', '--expected-head', HEAD],
      ['--fixture', '/fixtures/field.sqlite', '--evidence', 'relative.json', '--mission-id', 'm', '--expected-head', HEAD],
      ['--fixture', '/fixtures/field.sqlite', '--evidence', '/evidence/pr6.json', '--mission-id', 'm'],
      ['--fixture', '/fixtures/field.sqlite', '--evidence', '/evidence/pr6.json', '--mission-id', 'm', '--expected-head', HEAD, '--passphrase', 'secret'],
      ['--fixture', '/fixtures/field.sqlite', '--evidence', '/evidence/pr6.json', '--mission-id', 'mission\u0000id', '--expected-head', HEAD],
    ]) {
      expect(() => parseBreadcrumbPr6QualificationArgs(argv)).toThrow()
    }
  })

  it('accepts one exact-head, exact-tree, exhaustive lifecycle proof with derived gates', () => {
    expect(validateBreadcrumbPr6QualificationEvidence(validEvidence(), HEAD)).toMatchObject({
      passed: true,
      repositoryHead: HEAD,
      repositoryTree: TREE,
      ciphertextBytes: ARCHIVE_BYTES,
      tableCount: 49,
      replaySampleCount: 5,
      peakArchiveProcessRssBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES,
      heartbeatMaxGapMs: MAX_MAIN_CADENCE_MS - 1,
      currentPositionMaxCadenceMs: MAX_MAIN_CADENCE_MS - 1,
    })
  })

  it.each([
    ['wrong exact head', (value: QualificationEvidence) => { value.source.repositoryHead = 'c'.repeat(40) }],
    ['head changed during run', (value: QualificationEvidence) => { value.source.repositoryHeadAfterRun = 'c'.repeat(40) }],
    ['tree changed during run', (value: QualificationEvidence) => { value.source.repositoryTreeAfterRun = 'c'.repeat(40) }],
    ['dirty source', (value: QualificationEvidence) => { value.source.repositoryDirtyAfter = true }],
    ['run timestamps reversed', (value: QualificationEvidence) => { value.run.completedAt = '2026-08-29T09:59:59.000Z' }],
    ['machine is not Linux', (value: QualificationEvidence) => { value.machine.platform = 'darwin' }],
    ['fixture path leaked', (value: QualificationEvidence) => { value.flags.fixtureBasename = '/home/donal/field.sqlite' }],
    ['mission flag differs', (value: QualificationEvidence) => { value.flags.missionId = 'other-mission' }],
    ['heartbeat gate weakened', (value: QualificationEvidence) => { value.flags.heartbeatHardGateMs = 201 }],
    ['fixture opened in place', (value: QualificationEvidence) => { value.fixture.copiedBeforeOpen = false }],
    ['source fixture has WAL bytes', (value: QualificationEvidence) => { value.fixture.sourceWalBytes = 1 }],
    ['source fixture changed', (value: QualificationEvidence) => { value.fixture.sourceSha256After = 'f'.repeat(64) }],
    ['copied fixture differs', (value: QualificationEvidence) => { value.fixture.copiedSha256 = 'f'.repeat(64) }],
    ['fixture is not field scale', (value: QualificationEvidence) => {
      value.fixture.sourceBytes = MIN_FIELD_FIXTURE_BYTES
      value.fixture.copiedBytes = MIN_FIELD_FIXTURE_BYTES
    }],
    ['wrong schema', (value: QualificationEvidence) => { value.migration.schemaVersion = 12 }],
    ['migration heartbeat too slow', (value: QualificationEvidence) => {
      value.migration.heartbeatMaxGapMs = MAX_MAIN_CADENCE_MS
    }],
    ['backfill unsettled', (value: QualificationEvidence) => { value.migration.backfillsSettled = false }],
    ['migration failure marker', (value: QualificationEvidence) => { value.migration.failureMarkers = ['failed'] }],
    ['ciphertext not over 2 GiB', (value: QualificationEvidence) => { value.archive.sizeBytes = MIN_ARCHIVE_CIPHERTEXT_BYTES }],
    ['archive not verified', (value: QualificationEvidence) => { value.archive.status = 'sealed' }],
    ['archive unavailable', (value: QualificationEvidence) => { value.archive.availability = 'missing' }],
    ['verification proof digest differs', (value: QualificationEvidence) => { value.completeness.verificationProofSha256 = 'f'.repeat(64) }],
    ['proof not exhaustive', (value: QualificationEvidence) => { value.completeness.verificationProof.exhaustive = false }],
    ['ciphertext proof not matched', (value: QualificationEvidence) => {
      value.completeness.verificationProof.layers.ciphertext.matched = false
    }],
    ['table ledger incomplete', (value: QualificationEvidence) => {
      value.completeness.verificationProof.tables.pop()
      refreshProofDigest(value)
    }],
    ['Replay pages not exhausted', (value: QualificationEvidence) => {
      value.completeness.verificationProof.replaySemantic.samples[0].sampledTrackCount = 1
      refreshProofDigest(value)
    }],
    ['cleanup incomplete', (value: QualificationEvidence) => { value.cleanup.state = 'in_progress' }],
    ['cleanup gate bypassed', (value: QualificationEvidence) => { value.cleanup.preCredentialBlockers = [] }],
    ['cleanup review lease absent', (value: QualificationEvidence) => { value.cleanup.reviewLeaseHeld = false }],
    ['live rows remain', (value: QualificationEvidence) => { value.cleanup.deletedTableRowsRemain = 1 }],
    ['mission stub absent', (value: QualificationEvidence) => { value.cleanup.retainedMissionStub = false }],
    ['archive bytes changed', (value: QualificationEvidence) => { value.cleanup.archiveSha256After = 'f'.repeat(64) }],
    ['review before cleanup mutable', (value: QualificationEvidence) => { value.reviewBeforeCleanup.readOnly = false }],
    ['review after cleanup differs', (value: QualificationEvidence) => { value.reviewAfterCleanup.replayDigest = 'f'.repeat(64) }],
    ['review residual not visible', (value: QualificationEvidence) => { value.reviewBeforeCleanup.openResidualFileCount = 0 }],
    ['review plaintext canary not observed', (value: QualificationEvidence) => {
      value.reviewBeforeCleanup.openPrivacyCanaryDetected = false
    }],
    ['review residual remains', (value: QualificationEvidence) => { value.reviewAfterCleanup.plaintextSweptAfterClose = false }],
    ['heartbeat too slow', (value: QualificationEvidence) => { value.liveness.heartbeatMaxGapMs = MAX_MAIN_CADENCE_MS }],
    ['current cadence too slow', (value: QualificationEvidence) => { value.liveness.currentPositionMaxCadenceMs = MAX_MAIN_CADENCE_MS }],
    ['durable settle exceeded', (value: QualificationEvidence) => { value.liveness.durableSettlementMs = 120_001 }],
    ['durable write missing', (value: QualificationEvidence) => { value.liveness.durableVisibleWrites = 0 }],
    ['durable retry count mismatch', (value: QualificationEvidence) => { value.liveness.durableBusyRetries = 1 }],
    ['no writes during restore', (value: QualificationEvidence) => { value.liveness.byPhase.restore.currentWrites = 0 }],
    ['write not visible', (value: QualificationEvidence) => { value.liveness.byPhase.cleanup.visibleWrites = 0 }],
    ['RSS too high', (value: QualificationEvidence) => { value.resources.peakProcessRssBytes = MAX_ARCHIVE_PROCESS_RSS_BYTES + 1 }],
    ['RSS measurement overstated', (value: QualificationEvidence) => { value.resources.measurement = 'worker_only_rss' }],
    ['plaintext residue remains', (value: QualificationEvidence) => {
      value.residue.appAddressablePlaintextFiles = ['verification/mission-store.sqlite']
    }],
    ['unreadable residue file', (value: QualificationEvidence) => { value.residue.unreadableFiles = ['review/session'] }],
    ['secret residue remains', (value: QualificationEvidence) => { value.residue.secretMatches = ['runtime.log:passphrase'] }],
    ['privacy residue remains', (value: QualificationEvidence) => { value.residue.privacyMatches = ['review/canary'] }],
    ['forensic erasure overclaim', (value: QualificationEvidence) => { value.residue.claimsForensicSecureErasure = true }],
    ['KDF weakened', (value: QualificationEvidence) => { value.kdf.profile.N = 65_536 }],
    ['KDF not measured', (value: QualificationEvidence) => { value.kdf.measuredOnHost = false }],
  ])('rejects %s', (_label, mutate) => {
    const evidence = validEvidence()
    mutate(evidence)
    expect(() => validateBreadcrumbPr6QualificationEvidence(evidence, HEAD)).toThrow()
  })
})

/** Builds the exact durable verifier proof shape used by qualification. */
function verificationProof() {
  const tables = listArchiveInventoryForSchema(13).map((declaration, index) => ({
    tableName: declaration.tableName,
    rowCount: index,
    contentSha256: createHash('sha256').update(declaration.tableName).digest('hex'),
  }))
  const samples = Array.from({ length: 5 }, (_value, index) => ({
    selectedTime: `2026-08-29T1${index}:00:00.000Z`,
    semanticSha256: createHash('sha256').update(`sample-${index}`).digest('hex'),
    sampledOutingFilterCount: index,
    totalOutingFilterCount: index,
    sampledObjectCount: index + 1,
    totalObjectCount: index + 1,
    sampledTrackCount: index + 2,
    totalTrackCount: index + 2,
  }))
  const rawReplayProof = {
    proof_version: 3,
    sample_count: samples.length,
    sample_strategy: REPLAY_STRATEGY,
    samples: samples.map((sample) => ({
      selected_time: sample.selectedTime,
      semantic_sha256: sample.semanticSha256,
      sampled_outing_filter_count: sample.sampledOutingFilterCount,
      sampled_object_count: sample.sampledObjectCount,
      sampled_track_count: sample.sampledTrackCount,
      total_outing_filter_count: sample.totalOutingFilterCount,
      total_object_count: sample.totalObjectCount,
      total_track_count: sample.totalTrackCount,
    })),
  }
  return {
    proofVersion: 1,
    exhaustive: true,
    archiveId: ARCHIVE_ID,
    archiveKind: 'finalized',
    archiveRelativePath: `${ARCHIVE_ID}.sararch`,
    missionId: 'fixture-mission-000000000001',
    requestEventRowid: 42,
    requestEventId: REQUEST_EVENT_ID,
    creationOperationId: CREATION_OPERATION_ID,
    protectedFinalizationEpoch: null,
    createdAt: '2026-08-29T19:00:00.000Z',
    previousArchiveSha256: null,
    containerVersion: 2,
    schemaVersion: 13,
    inventoryVersion: 1,
    ciphertextSha256: '2'.repeat(64),
    sizeBytes: ARCHIVE_BYTES,
    frameCount: 300,
    headerSha256: '3'.repeat(64),
    manifestSha256: '4'.repeat(64),
    custodyFileIdentity: {
      changedTimeNanoseconds: '200',
      device: '1',
      inode: '2',
      linkCount: 1,
      modifiedTimeNanoseconds: '100',
      sizeBytes: ARCHIVE_BYTES,
    },
    layers: {
      ciphertext: { exhaustive: true, matched: true },
      authenticatedFrames: { exhaustive: true, matched: true },
      entries: { exhaustive: true, matched: true, count: 4 },
      inventory: { exhaustive: true, matched: true, tableCount: 49 },
      gpxSourceBytes: {
        exhaustive: true,
        matched: true,
        recordCount: 0,
        exactBytesCount: 0,
        legacyHashOnlyCount: 0,
        legacyUnavailableCount: 0,
        failureUnavailableCount: 0,
        exactSourceCustodyComplete: true,
      },
      attachments: { exhaustive: true, matched: true, count: 0 },
    },
    tables,
    tableLedgerSha256: createHash('sha256').update(canonicalJson(tables)).digest('hex'),
    replaySemantic: {
      sampled: true,
      matched: true,
      sampleCount: samples.length,
      sampleStrategy: REPLAY_STRATEGY,
      baselineSha256: createHash('sha256')
        .update(canonicalJson(rawReplayProof)).digest('hex'),
      samples,
    },
    durationMs: 9_000,
    plaintextSweepConfirmed: true,
  }
}

/** Builds one complete passing machine-readable reference-host proof. */
function validEvidence() {
  const proof = verificationProof()
  return {
    schema: 'sartracker-breadcrumb-pr6-qualification-v1',
    run: {
      runId: '11111111-1111-4111-8111-111111111111',
      startedAt: '2026-08-29T10:00:00.000Z',
      completedAt: '2026-08-29T11:00:00.000Z',
      durationMs: 3_600_000,
      phaseDurationsMs: {
        migration: 1_000,
        create: 1_000_000,
        verify: 1_000_000,
        restore: 500_000,
        cleanup: 500_000,
      },
    },
    source: {
      repositoryHead: HEAD,
      repositoryHeadAfterRun: HEAD,
      repositoryTree: TREE,
      repositoryTreeAfterRun: TREE,
      repositoryDirtyBefore: false,
      repositoryDirtyAfter: false,
    },
    machine: {
      hostname: 'donal-Precision-5570',
      platform: 'linux',
      release: '7.0.0-28-generic',
      architecture: 'x64',
      cpuCount: 20,
      totalMemoryBytes: 33_303_212_032,
      nodeVersion: 'v22.18.0',
    },
    flags: {
      fixtureBasename: 'mission-store.sqlite',
      missionId: 'fixture-mission-000000000001',
      timezone: 'UTC',
      heartbeatHardGateMs: MAX_MAIN_CADENCE_MS,
      currentCadenceHardGateMs: MAX_MAIN_CADENCE_MS,
      rssLimitBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES,
    },
    fixture: {
      copiedBeforeOpen: true,
      sourceWasRegularFile: true,
      sourceWasSymlink: false,
      sourceWalBytes: 0,
      sourceShmBytes: 0,
      sourceSha256Before: '1'.repeat(64),
      sourceSha256After: '1'.repeat(64),
      copiedSha256: '1'.repeat(64),
      sourceBytes: 3_704_676_352,
      copiedBytes: 3_704_676_352,
    },
    migration: {
      schemaVersion: 13,
      durationMs: 1_000,
      heartbeatMaxGapMs: 100,
      backfillsSettled: true,
      failureMarkers: [] as string[],
    },
    archive: {
      archiveId: proof.archiveId,
      archiveKind: proof.archiveKind,
      archiveRelativePath: proof.archiveRelativePath,
      missionId: proof.missionId,
      requestEventRowid: proof.requestEventRowid,
      requestEventId: proof.requestEventId,
      creationOperationId: proof.creationOperationId,
      protectedFinalizationEpoch: proof.protectedFinalizationEpoch,
      createdAt: proof.createdAt,
      previousArchiveSha256: proof.previousArchiveSha256,
      containerVersion: proof.containerVersion,
      schemaVersion: proof.schemaVersion,
      inventoryVersion: proof.inventoryVersion,
      ciphertextSha256: proof.ciphertextSha256,
      sizeBytes: proof.sizeBytes,
      frameCount: proof.frameCount,
      headerSha256: proof.headerSha256,
      manifestSha256: proof.manifestSha256,
      inventorySha256: '5'.repeat(64),
      entryCount: proof.layers.entries.count,
      tableCount: proof.layers.inventory.tableCount,
      status: 'verified',
      availability: 'present',
    },
    completeness: {
      verificationProofSha256: createHash('sha256').update(canonicalJson(proof)).digest('hex'),
      verificationProof: proof,
    },
    cleanup: {
      state: 'completed',
      storageState: 'archived',
      preCredentialBlockers: ['fresh_non_machine_unlock_required'],
      reviewLeaseHeld: true,
      deletedTableRowsRemain: 0,
      retainedMissionStub: true,
      retainedArchiveRegistry: true,
      archiveSha256After: proof.ciphertextSha256,
    },
    reviewBeforeCleanup: validReviewProof('6'.repeat(64)),
    reviewAfterCleanup: validReviewProof('6'.repeat(64)),
    liveness: {
      heartbeatMaxGapMs: MAX_MAIN_CADENCE_MS - 1,
      currentPositionMaxCadenceMs: MAX_MAIN_CADENCE_MS - 1,
      currentPositionsIndependent: true,
      durableMaxLatencyMs: 300,
      durableWriteCount: 4,
      durableVisibleWrites: 4,
      durableBusyRetries: 0,
      durableSettlementMs: 1,
      byPhase: {
        create: validPhaseLiveness(),
        verify: validPhaseLiveness(),
        restore: validPhaseLiveness(),
        cleanup: validPhaseLiveness(),
      },
    },
    resources: {
      measurement: 'whole_process_rss_conservative_worker_upper_bound',
      baselineProcessRssBytes: 100_000_000,
      peakProcessRssBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES,
      peakDeltaBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES - 100_000_000,
      linuxVmHwmBytes: MAX_ARCHIVE_PROCESS_RSS_BYTES,
      sampleCount: 100,
    },
    residue: {
      rootsChecked: ['archive-staging', 'verification-scratch', 'archive-review-sessions'],
      filesScanned: 10,
      bytesScanned: 1_000,
      unreadableFiles: [] as string[],
      appAddressablePlaintextFiles: [] as string[],
      secretMatches: [] as string[],
      privacyMatches: [] as string[],
      claimsForensicSecureErasure: false,
    },
    kdf: {
      measuredOnHost: true,
      durationMs: 10,
      profile: {
        version: 1,
        N: 131_072,
        r: 8,
        p: 1,
        keyLength: 32,
        saltBytes: 32,
        maxmem: REQUIRED_SCRYPT_MAXMEM_BYTES,
      },
    },
  }
}

/** Returns one closed archive-review lifecycle proof. */
function validReviewProof(replayDigest: string) {
  return {
    opened: true,
    readOnly: true,
    mutationDenied: true,
    replayPageCount: 1,
    replayDigest,
    openResidualFileCount: 1,
    openPrivacyCanaryDetected: true,
    closed: true,
    plaintextSweptAfterClose: true,
  }
}

/** Returns a current-position probe measurement below the hard gate. */
function validPhaseLiveness() {
  return {
    heartbeatMaxGapMs: MAX_MAIN_CADENCE_MS - 1,
    currentPositionMaxCadenceMs: MAX_MAIN_CADENCE_MS - 1,
    durableMaxLatencyMs: 300,
    durableWriteCount: 1,
    durableVisibleWrites: 1,
    durableBusyRetries: 0,
    currentWrites: 1,
    visibleWrites: 1,
  }
}

/** Rebinds the outer evidence digest after an intentional nested-proof mutation. */
function refreshProofDigest(value: QualificationEvidence) {
  value.completeness.verificationProofSha256 = createHash('sha256')
    .update(canonicalJson(value.completeness.verificationProof)).digest('hex')
}

type QualificationEvidence = ReturnType<typeof validEvidence>
