import { describe, expect, it } from 'vitest'

import {
  ARCHIVE_CIPHERTEXT_MIN_BYTES,
  ARCHIVE_SOURCE_MIN_BYTES,
  FIELD_ARCHIVE_VARIANT,
  parseArgs,
  validateLargeArchiveProducerReceipt,
} from '../../scripts/qualification/composite-large-archive-probe.mjs'

type JsonObject = Record<string, unknown>

const root = '/tmp/c20-c22-large-archive'
const hash = 'a'.repeat(64)
const head = 'b'.repeat(40)

function report(): JsonObject {
  return {
    schemaVersion: 1,
    proofKind: 'packaged-large-archive-v1',
    contractId: 'C20-C22',
    variantId: FIELD_ARCHIVE_VARIANT,
    developmentTestHarness: false,
    source: {
      head,
      expectedHead: head,
      observedHead: head,
      dirty: false,
      manifest: [{ relativePath: 'electron/main.cjs', sha256: hash, sizeBytes: 10 }],
    },
    app: {
      path: `${root}/candidate.AppImage`,
      sha256: hash,
      sizeBytes: 20,
      packagedAppPath: `${root}/resources/app.asar`,
      packagedAppSha256: hash,
    },
    invocation: {
      app: '--app', evidence: '--evidence', expectedHead: '--expected-head', variant: FIELD_ARCHIVE_VARIANT,
      networkBlocked: true, userDataPath: `${root}/profile`,
    },
    profile: {
      path: `${root}/profile`, userDataPath: `${root}/profile`, observedUserDataPaths: [`${root}/profile`],
      removed: true, usedSystemUserProfile: false,
    },
    sourceFixture: {
      preset: 'field', path: `${root}/source/mission-store.sqlite`, privateCopyPath: `${root}/oracle/mission-store.sqlite`,
      manifestPath: `${root}/source/mission-store.sqlite.manifest.json`, sourceSha256: hash,
      privateCopySha256: hash, sourceBytes: ARCHIVE_SOURCE_MIN_BYTES, privateCopyBytes: ARCHIVE_SOURCE_MIN_BYTES,
      manifestSha256: hash, inventory: { primary: { id: 'fixture-mission-000000000001' } },
    },
    preArchive: {
      databasePath: `${root}/snapshots/prearchive-mission-store.sqlite`, closed: true, sidecarsAbsent: true,
      sha256: hash, bytes: 100, rowCounts: { missions: 1 }, tableDigests: { missions: hash },
    },
    sourceToPreArchive: {
      sourceDatabasePath: `${root}/oracle/mission-store.sqlite`,
      preArchiveDatabasePath: `${root}/snapshots/prearchive-mission-store.sqlite`,
      sourceMission: { id: 'fixture-mission-000000000001', status: 'active' },
      preArchiveMission: { id: 'fixture-mission-000000000001', status: 'finished' },
      changedFields: ['status', 'finish_time'],
      allowedMissionFields: ['status', 'pause_time', 'finish_time', 'paused_seconds'],
      unexpectedChangedFields: [],
    },
    archive: {
      archiveId: 'archive-1', archivePath: `${root}/ciphertext/archive-1.sararch`, runtimeArchivePath: `${root}/profile/archives/archive-1.sararch`,
      retainedCiphertextPath: `${root}/ciphertext/archive-1.sararch`, ciphertextSha256: hash,
      ciphertextBytes: ARCHIVE_CIPHERTEXT_MIN_BYTES, thresholdBytes: ARCHIVE_CIPHERTEXT_MIN_BYTES,
      containerVersion: 2, status: 'verified', availability: 'present', verified: true,
      retainedCiphertextSha256: hash, retainedCiphertextBytes: ARCHIVE_CIPHERTEXT_MIN_BYTES,
    },
    reviewRestore: {
      opened: true, immutable: true, verified: true, mutationDenied: true, restored: true,
      restoredDatabasePath: `${root}/snapshots/restored-mission-store.sqlite`, restoredClosed: true,
      restoredSidecarsAbsent: true, restoredSha256: hash, restoredBytes: 100,
      restoredRowCounts: { missions: 1 }, restoredTableDigests: { missions: hash },
      plaintextCleanupComplete: true, sessionClosed: true,
      allowlistedDifferences: { tables: ['mission_events', 'mission_archives'], reason: 'archive lifecycle and audit suffix' },
    },
    cleanup: { closeAttempted: true, closeSucceeded: true, profileRemovalAttempted: true, profileRemoved: true, applicationClosed: true, reviewClosed: true, plaintextRemoved: true, failure: null },
    preflight: { availableBytes: 64 * 1024 ** 3, minFreeBytes: 64 * 1024 ** 3, checkedPath: root },
    run: { proofMode: 'packaged-electron', executablePath: `${root}/candidate.AppImage`, executableSha256: hash, asarPath: `${root}/resources/app.asar`, asarSha256: hash, firstPid: 10, startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z' },
    runtime: { proofMode: 'packaged-electron', executablePath: `${root}/candidate.AppImage`, executableSha256: hash, asarPath: `${root}/resources/app.asar`, asarSha256: hash },
    mission: { missionId: 'fixture-mission-000000000001', startupRecovery: { missionId: 'fixture-mission-000000000001', sourceStatus: 'active', observedStatus: 'paused', startupPauseObserved: true, implicitResume: false } },
    inventory: { missionId: 'fixture-mission-000000000001', tables: [{ name: 'missions', sourceRows: 1, restoredRows: 1, sourceSha256: hash, restoredSourceSha256: hash }], extraEvents: [] },
    gaps: [],
  }
}

describe('composite large archive producer receipt', () => {
  it('parses only the fixed app/evidence/head/variant invocation', () => {
    expect(parseArgs([
      '--app', '/candidate.AppImage', '--evidence', '/tmp/evidence', '--expected-head', head,
    ])).toMatchObject({ variant: FIELD_ARCHIVE_VARIANT })
    expect(() => parseArgs([
      '--app', '/candidate.AppImage', '--evidence', '/tmp/evidence', '--expected-head', head,
      '--variant', 'field-scale-2m',
    ])).toThrow(/fixed field archive/u)
    expect(() => parseArgs([
      '--app', '/candidate.AppImage', '--evidence', '/tmp/evidence', '--expected-head', head,
      '--threshold-bytes', '1',
    ])).toThrow(/Unknown/u)
  })

  it('accepts the concrete closed source/archive/restore predicates', () => {
    const receipt = validateLargeArchiveProducerReceipt(report(), {
      appPath: `${root}/candidate.AppImage`, evidencePath: root, sourceHead: head,
    })
    expect(receipt).toMatchObject({ valid: true, complete: true, status: 'PASS', releaseEligible: false })
  })

  it.each([
    ['source bytes forged below the fixed field bound', (value: JsonObject) => {
      ;(value.sourceFixture as JsonObject).sourceBytes = ARCHIVE_SOURCE_MIN_BYTES - 1
    }],
    ['ciphertext bytes inferred from source size', (value: JsonObject) => {
      ;(value.archive as JsonObject).ciphertextBytes = ARCHIVE_SOURCE_MIN_BYTES
      ;(value.archive as JsonObject).thresholdBytes = ARCHIVE_SOURCE_MIN_BYTES
    }],
    ['caller lowers the ciphertext threshold', (value: JsonObject) => {
      ;(value.archive as JsonObject).thresholdBytes = 1
    }],
    ['prearchive and restored snapshots are the same path', (value: JsonObject) => {
      ;(value.reviewRestore as JsonObject).restoredDatabasePath = (value.preArchive as JsonObject).databasePath
    }],
    ['ciphertext is left only in the disposable profile', (value: JsonObject) => {
      ;(value.archive as JsonObject).archivePath = `${root}/profile/archives/archive-1.sararch`
      ;(value.archive as JsonObject).retainedCiphertextPath = `${root}/profile/archives/archive-1.sararch`
    }],
    ['plaintext cleanup is missing', (value: JsonObject) => {
      ;(value.reviewRestore as JsonObject).plaintextCleanupComplete = false
    }],
    ['independent inventory is missing', (value: JsonObject) => {
      delete value.inventory
    }],
    ['generic passed flag is the only evidence', (value: JsonObject) => {
      delete value.preArchive
      delete value.reviewRestore
      value.passed = true
    }],
  ])('rejects %s', (_label, mutate) => {
    const value = structuredClone(report()) as JsonObject
    mutate(value)
    expect(validateLargeArchiveProducerReceipt(value, {
      appPath: `${root}/candidate.AppImage`, evidencePath: root, sourceHead: head,
    }).valid).toBe(false)
  })
})
