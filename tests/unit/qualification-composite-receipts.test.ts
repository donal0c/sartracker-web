import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { parseArgs } from '../../scripts/qualification/composite-probe.mjs'
import { C28_VARIANT_AXIS_MAP } from '../../scripts/qualification/composite-coverage.mjs'
import { validateCompositeReceipt, validateCompositeVariantReceipt } from '../../scripts/qualification/composite-receipts.mjs'

type JsonObject = Record<string, unknown>

const repoRoot = path.resolve(process.cwd())
const sourceFiles = [
  'electron/main.cjs',
  'electron/preload.cjs',
  'electron/mission-store.cjs',
]
const sourceManifest = sourceFiles.map((relativePath) => {
  const bytes = readFileSync(path.join(repoRoot, relativePath))
  return {
    relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
})
const expected = {
  appPath: '/tmp/sartracker/SARTracker.AppImage',
  appSha256: 'a'.repeat(64),
  sourceHead: 'b'.repeat(40),
  sourceRoot: repoRoot,
  sourceManifest,
  evidencePath: '/tmp/sartracker-evidence',
  profilePath: '/tmp/sartracker-evidence/.profile-composite',
}
const retainedPackagedAppPath = path.join(expected.evidencePath, 'retained-packaged-app.asar')
const retainedPackagedAppBytes = Buffer.from('generic-retained-asar-fixture\n', 'utf8')
mkdirSync(expected.evidencePath, { recursive: true })
writeFileSync(retainedPackagedAppPath, retainedPackagedAppBytes, { mode: 0o600 })

function phaseFacts(missionId = 'mission-c28') {
  return {
    settingsBootstrap: {
      supported: true,
      settingsLoaded: true,
      runtimeBootstrapLoaded: true,
      networkConfiguration: 'blocked',
    },
    missionOutingParticipants: {
      supported: true,
      missionId,
      outingId: 'outing-c28',
      missionStatus: 'active',
      outingEnded: true,
      participantCount: 1,
      participantIds: ['participant-c28'],
      backfillCompleted: true,
      backfillCheckpointCount: 1,
    },
    gpxDatedUndated: {
      supported: true,
      missionId,
      dated: { importId: 'gpx-dated', timingClass: 'fully_dated', pointCount: 2, sourceSha256: '1'.repeat(64) },
      undated: { importId: 'gpx-undated', timingClass: 'undated', pointCount: 2, sourceSha256: '2'.repeat(64) },
      fixtureResidualEntries: 0,
    },
    markerSearch: {
      supported: true,
      missionId,
      markerId: 'marker-c28',
      searchAreaId: 'area-c28',
      assignmentId: 'assignment-c28',
      searchPassId: 'pass-c28',
      markerCount: 1,
      searchAreaCount: 1,
      searchPassCount: 1,
    },
    coverageReplay: {
      supported: true,
      missionId,
      coverage: { changeSeq: 3, enumerated: true, pendingInvalidation: false, backfillIncomplete: false, chunkCount: 1, acceptedFixCount: 2 },
      replay: {
        missionId,
        selectedTime: '2026-09-19T19:30:00.000Z',
        replayGeneration: 3,
        totalTrackCount: 4,
        staticGpxPointCount: 2,
        objectCount: 3,
      },
    },
    pauseRestart: {
      supported: true,
      missionId,
      pausedStatus: 'paused',
      restartedStatus: 'paused',
      resumedStatus: 'active',
      sameMission: true,
      firstPid: 101,
      restartPid: 103,
      observedUserDataPath: expected.profilePath,
    },
    finishFinalizeArchive: {
      supported: true,
      missionId,
      finishedStatus: 'finished',
      finalizedStatus: 'finalized',
      archiveId: 'archive-c28',
      archiveVersion: 2,
      archiveStatus: 'verified',
      archiveAvailability: 'present',
      ciphertextSha256: '3'.repeat(64),
      verify: { verified: true, archiveId: 'archive-c28', ciphertextSha256: '3'.repeat(64) },
    },
    archiveReviewRestore: {
      supported: true,
      review: {
        closed: true,
        immutable: true,
        missionCount: 1,
        missionIdMatched: true,
        mutationDenied: true,
        opened: true,
        replayMissionId: missionId,
        replayTrackCount: 4,
        verified: true,
      },
      restore: {
        archiveId: 'archive-c28',
        cleanupComplete: true,
        committed: true,
        missionId,
        returnedMissionId: missionId,
        returnedStatus: 'finished',
        status: 'finished',
        storageState: 'live',
      },
      reviewExecuted: true,
      restoreExecuted: true,
      missingProducer: null,
    },
    sanitizedDiagnostics: {
      supported: true,
      requested: true,
      exported: true,
      sanitized: true,
      containsSecret: false,
      containsProfilePath: false,
      exactSecretMatches: 0,
      adversarialMatchCount: 0,
      pathWithinProfile: true,
    },
  }
}

function report(): JsonObject {
  const missionId = 'mission-c28'
  return {
    schemaVersion: 1,
    proofKind: 'packaged-composite-v1',
    contractId: 'C28',
    source: {
      expectedHead: expected.sourceHead,
      observedHead: expected.sourceHead,
      dirty: false,
      manifest: sourceManifest,
    },
    app: {
      path: expected.appPath,
      sha256: expected.appSha256,
      sizeBytes: 1234,
      packagedAppPath: '/tmp/sartracker/app.asar',
      packagedAppSha256: createHash('sha256').update(retainedPackagedAppBytes).digest('hex'),
      retainedPackagedAppPath,
      retainedPackagedAppSha256: createHash('sha256').update(retainedPackagedAppBytes).digest('hex'),
    },
    invocation: {
      app: '--app', evidence: '--evidence', expectedHead: '--expected-head',
      networkBlocked: true, userDataPath: expected.profilePath,
    },
    profile: {
      path: expected.profilePath,
      userDataPath: expected.profilePath,
      observedUserDataPaths: [expected.profilePath, expected.profilePath],
      removed: true,
      usedSystemUserProfile: false,
      sameProfileAcrossPhases: true,
    },
    mission: {
      missionId,
      nameSha256: '4'.repeat(64),
      phaseMissionIds: [missionId, missionId, missionId, missionId, missionId, missionId],
    },
    phases: phaseFacts(missionId),
    diagnostics: {
      requested: true, exported: true, sanitized: true,
      containsSecret: false, containsProfilePath: false, exactSecretMatches: 0,
      adversarialMatchCount: 0,
    },
    network: { blocked: true, httpRequests: 0, httpsRequests: 0 },
    run: { startedAt: '2026-09-19T19:00:00.000Z', finishedAt: '2026-09-19T19:01:00.000Z', firstPid: 101, restartPid: 103 },
    stderr: { sha256: '5'.repeat(64), byteLength: 0, lines: [] },
    gaps: [],
  }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('C28 composite packaged receipt', () => {
  it('accepts the fixed CLI and independently bound routine-path receipt', () => {
    expect(parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
    ])).toEqual({
      appPath: expected.appPath,
      evidencePath: expected.evidencePath,
      expectedHead: expected.sourceHead,
      variant: 'routine',
    })
    expect(validateCompositeReceipt(report(), expected)).toMatchObject({
      contractId: 'C28', status: 'PASS', valid: true, passed: true,
      complete: true, releaseEligible: false,
      failureReasons: [],
    })
  })

  it('accepts only the closed reviewed variant enum', () => {
    expect(parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
      '--variant', 'archive-revision-supplement',
    ]).variant).toBe('archive-revision-supplement')
    expect(() => parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
      '--variant', 'invented-variant',
    ])).toThrow(/fixed reviewed variant map/u)
  })

  it('revalidates the retained ASAR bytes after the transient runtime path is gone', () => {
    rmSync('/tmp/sartracker/app.asar', { force: true })
    expect(validateCompositeReceipt(report(), expected)).toMatchObject({ valid: true, status: 'PASS' })

    const original = readFileSync(retainedPackagedAppPath)
    writeFileSync(retainedPackagedAppPath, Buffer.from('tampered retained app\n', 'utf8'), { mode: 0o600 })
    expect(validateCompositeReceipt(report(), expected).valid).toBe(false)
    writeFileSync(retainedPackagedAppPath, original, { mode: 0o600 })
  })

  it('accepts only fixed packaged family selectors for the composite producer', () => {
    expect(parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
      '--family-contract', 'C03',
    ]).familyContract).toBe('C03')
    expect(() => parseArgs([
      '--app', expected.appPath,
      '--evidence', expected.evidencePath,
      '--expected-head', expected.sourceHead,
      '--family-contract', 'C28',
    ])).toThrow(/fixed family map/u)
  })

  it('keeps the C28 producer receipt valid for a fixed family extension', () => {
    const familyReport = copy(report())
    familyReport.familyContract = 'C11'
    const marker = familyReport.phases.markerSearch as JsonObject
    marker.searchPassCount = 50_000
    marker.passOutcomes = [
      { passId: 'pass-full', assignmentId: 'assignment-c28', outcome: 'full' },
      { passId: 'pass-partial', assignmentId: 'assignment-c28', outcome: 'partial' },
      { passId: 'pass-aborted', assignmentId: 'assignment-c28', outcome: 'aborted' },
    ]
    marker.passPaging = {
      totalCount: 50_000,
      complete: true,
      pageCount: 1_000,
      sequenceSha256: 'a'.repeat(64),
    }
    expect(validateCompositeReceipt(familyReport, expected)).toMatchObject({
      valid: true, passed: true, complete: true, failureReasons: [],
    })
  })

  it('keeps the unpacked development harness outside packaged evidence', async () => {
    const { runCompositeProbe } = await import('../../scripts/qualification/composite-probe.mjs')
    await expect(runCompositeProbe({
      appPath: expected.appPath,
      evidencePath: expected.evidencePath,
      expectedHead: expected.sourceHead,
      developmentTestHarness: false,
    })).rejects.toThrow(/developmentTestHarness/u)
  })

  it.each([
    ['forged finalized phase', (value: JsonObject) => {
      ;((value.phases as JsonObject).finishFinalizeArchive as JsonObject).archiveStatus = 'verified'
      ;((value.phases as JsonObject).finishFinalizeArchive as JsonObject).archiveId = null
    }],
    ['source manifest substitution', (value: JsonObject) => {
      ;(((value.source as JsonObject).manifest as JsonObject[])[0]).sha256 = 'f'.repeat(64)
    }],
    ['artifact substitution', (value: JsonObject) => {
      ;(value.app as JsonObject).sha256 = 'e'.repeat(64)
    }],
    ['cross-phase mission substitution', (value: JsonObject) => {
      ;((value.phases as JsonObject).coverageReplay as JsonObject).missionId = 'other-mission'
    }],
    ['participant backfill predicate forgery', (value: JsonObject) => {
      ;((value.phases as JsonObject).missionOutingParticipants as JsonObject).backfillCompleted = false
    }],
    ['correction cleanup predicate forgery', (value: JsonObject) => {
      ;(((value.phases as JsonObject).archiveReviewRestore as JsonObject).restore as JsonObject).cleanupComplete = false
    }],
    ['unsanitized diagnostics', (value: JsonObject) => {
      ;(value.diagnostics as JsonObject).containsSecret = true
    }],
    ['completed network egress', (value: JsonObject) => {
      ;(value.network as JsonObject).httpsRequests = 1
    }],
  ])('rejects %s', (_label, mutate) => {
    const mutated = copy(report())
    mutate(mutated)
    expect(validateCompositeReceipt(mutated, expected).valid).toBe(false)
  })

  it('rejects unsupported phases without a concrete missing producer and rejects profile escape', () => {
    const missingGap = copy(report())
    ;(missingGap.phases as JsonObject).archiveReviewRestore = {
      supported: false,
      review: null,
      restore: null,
      reviewExecuted: false,
      restoreExecuted: false,
      missingProducer: 'No bounded correction-restore producer is registered for this composite probe.',
    }
    missingGap.gaps = [{ phase: 'archiveReviewRestore', reason: '' }]
    expect(validateCompositeReceipt(missingGap, expected).valid).toBe(false)

    const escaped = copy(report())
    ;(escaped.profile as JsonObject).observedUserDataPaths = ['/tmp/operator-profile', expected.profilePath]
    expect(validateCompositeReceipt(escaped, expected).valid).toBe(false)
  })

  it('validates the field-scale seed variant against fixed axes and actual workload facts', () => {
    const variantReport = copy(report())
    variantReport.variant = {
      variantId: 'field-scale-seed',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-seed']],
      missingAxes: [],
      facts: {
        deviceCount: 100,
        outingCount: 12,
        positionCount: 100,
        participantCount: 100,
        backfillCheckpointCount: 100,
      },
    }

    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'field-scale-seed',
    })).toMatchObject({
      valid: true, complete: true, status: 'PASS',
      variant: { variantId: 'field-scale-seed' },
    })
  })

  it('rejects forged field-scale seed counts and producer family flags', () => {
    const variantReport = copy(report())
    variantReport.variant = {
      variantId: 'field-scale-seed',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-seed']],
      missingAxes: [],
      familyComplete: true,
      facts: {
        deviceCount: 1,
        outingCount: 12,
        positionCount: 1,
        participantCount: 1,
        backfillCheckpointCount: 1,
      },
    }

    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'field-scale-seed',
    }).valid).toBe(false)
  })

  it('rejects canonical field-scale facts without an independently bound source fixture', () => {
    const variantReport = copy(report())
    variantReport.variant = {
      variantId: 'field-scale-960k',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['field-scale-960k']],
      missingAxes: [],
      facts: {
        appDeviceCount: 100,
        appOutingCount: 12,
        appPositionCount: 959988,
        fixtureManifestPath: '/tmp/source-fixture/bcp-960k.sqlite.manifest.json',
        fixtureManifestSha256: 'a'.repeat(64),
        fixturePath: '/tmp/source-fixture/bcp-960k.sqlite',
        fixtureSha256: 'b'.repeat(64),
        preset: 'bcp-960k',
        sourceInventory: { primary: { id: 'fixture-mission-000000000001', start_time: '2026-01-01T00:00:00.000Z', positionCount: 959988 }, fixturePositionCount: 960000, legacyPositionCount: 12 },
        sourceLegacyPositionCount: 12,
        sourcePositionCount: 960000,
      },
    }

    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'field-scale-960k',
    }).valid).toBe(false)
  })

  it('validates an actual rejection boundary without treating a generic flag as fault evidence', () => {
    const variantReport = copy(report())
    variantReport.variant = {
      variantId: 'failure-injection',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['failure-injection']],
      missingAxes: [],
      facts: {
        operation: 'addPosition.invalid-latitude',
        rejected: true,
        beforeCount: 2,
        afterCount: 2,
        mutationPreserved: true,
        errorName: 'Error',
        errorCode: null,
        errorMessage: 'Position latitude must be a finite value between -90 and 90.',
        errorMessageSha256: createHash('sha256').update('Position latitude must be a finite value between -90 and 90.').digest('hex'),
      },
    }

    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'failure-injection',
    }).valid).toBe(true)
  })

  it('requires phase-specific failure facts and an unchanged serialized state boundary', () => {
    const variantReport = copy(report())
    const state = JSON.stringify({ mission: { id: 'mission-c28', status: 'finished' }, positionCount: 2 })
    const errorMessage = 'Mission is already finished.'
    variantReport.variant = {
      variantId: 'failure-finish-finalize-archive',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['failure-finish-finalize-archive']],
      missingAxes: [],
      facts: {
        phase: 'finishFinalizeArchive',
        operation: 'finalizeMission.invalid-recovery',
        rejected: true,
        beforeState: state,
        afterState: state,
        beforeStateSha256: createHash('sha256').update(state).digest('hex'),
        afterStateSha256: createHash('sha256').update(state).digest('hex'),
        mutationPreserved: true,
        errorName: 'Error',
        errorCode: null,
        errorMessage,
        errorMessageSha256: createHash('sha256').update(errorMessage).digest('hex'),
      },
    }
    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'failure-finish-finalize-archive',
    }).valid).toBe(true)

    const forged = copy(variantReport)
    ;((forged.variant as JsonObject).facts as JsonObject).mutationPreserved = false
    expect(validateCompositeVariantReceipt(forged, {
      ...expected,
      variantId: 'failure-finish-finalize-archive',
    }).valid).toBe(false)
  })

  it('requires a real predecessor-linked revision and supplement', () => {
    const variantReport = copy(report())
    variantReport.variant = {
      variantId: 'archive-revision-supplement',
      coveredAxes: [...C28_VARIANT_AXIS_MAP['archive-revision-supplement']],
      missingAxes: [],
      facts: {
        firstArchiveId: 'archive-c28',
        secondArchiveId: 'archive-c28-revision-2',
        previousArchiveId: 'archive-c28',
        previousArchiveSha256: '7'.repeat(64),
        revisionSequence: 2,
        revisionCount: 2,
        supplementAuthority: 'C28 Composite Admin',
        supplementReason: 'C28 composite correction restore proof',
        archiveCount: 2,
        predecessorStatus: 'superseded',
      },
    }

    expect(validateCompositeVariantReceipt(variantReport, {
      ...expected,
      variantId: 'archive-revision-supplement',
    }).valid).toBe(true)
  })
})

afterAll(() => {
  rmSync(expected.evidencePath, { recursive: true, force: true })
})
