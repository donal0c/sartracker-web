import { describe, expect, it } from 'vitest'

import {
  deriveSoakFamilyCoverage,
  validateSoakContractEvidence,
} from '../../scripts/qualification/soak-receipts.mjs'
import { C24_INVALID_DIAGNOSTIC_FILE_NAME } from '../../scripts/qualification/competing-operation-probe.mjs'

const fullSha256 = 'a'.repeat(64)
const normalPrefixSha256 = 'b'.repeat(64)
const artifactSha256 = 'c'.repeat(64)
const baseTimeMs = 1_700_000_000_000
const intervalMs = 25

const expected = {
  profileName: 'ci',
  source: {
    baseTimeMs,
    intervalMs,
    normalPrefixBatch: 480,
    fullSha256,
    normalPrefixSha256,
  },
  artifact: {
    basename: 'SAR.AppImage',
    sha256: artifactSha256,
    packageTier: 'ci-appimage',
  },
  process: {
    tier: 'packaged-electron',
    executableSha256: artifactSha256,
  },
  platform: {
    os: 'Linux 6.1.0',
    architecture: 'x64',
  },
  workload: {
    class: 'ci',
    minimumEquivalentProductionPolls: 1_080,
    minimumDeviceCount: 32,
  },
  missionModel: {
    enabled: false,
    expectedParticipantRows: 32,
    expectedParticipantAddedEvents: 32,
  },
  thresholds: { freezeThresholdMs: 1_000, mainStallThresholdMs: 200 },
}

const c24Expected = {
  ...expected,
  workload: {
    ...expected.workload,
    minimumArchiveCycles: 2,
  },
}

const c24ArchiveEvidence = {
  archiveCycles: {
    expectedCount: 2,
    completedCount: 2,
    entries: [
      { observedWhileTracking: true, missionStatusBefore: 'finished', missionStatusAfter: 'finalized', archiveStatus: 'verified', archiveAvailability: 'present', createProgressPhases: ['encrypt'], verifyProgressPhases: ['verified'] },
      { observedWhileTracking: true, missionStatusBefore: 'finished', missionStatusAfter: 'finalized', archiveStatus: 'verified', archiveAvailability: 'present', createProgressPhases: ['encrypt'], verifyProgressPhases: ['verified'] },
    ],
  },
  archiveFailureRecovery: {
    observedWhileTracking: true,
    observedAfterRestart: true,
    failureAttempted: true,
    failureRejected: true,
    recoverySucceeded: true,
    missionStatusAfter: 'finalized',
    archiveStatus: 'verified',
    archiveAvailability: 'present',
    createProgressPhases: ['encrypt'],
    verifyProgressPhases: ['verified'],
  },
}

function competingOperationEvidence() {
  const phases = Object.fromEntries(['gpxTimed', 'gpxUntimed', 'archiveCreate', 'archiveVerify', 'archiveReview', 'archiveRestore', 'archiveCleanup', 'diagnostics', 'mapFault'].map((phase, index) => [
    phase,
    {
      operationId: `op-${phase}`,
      requestIds: [`req-${index}`],
      startedAt: '2026-09-20T10:00:00.000Z',
      endedAt: '2026-09-20T10:00:01.000Z',
      status: 'completed',
      stages: [
        { stage: 'start', requestId: `req-${index}`, observedAt: '2026-09-20T10:00:00.000Z' },
        { stage: 'steady', requestId: `req-${index}`, observedAt: '2026-09-20T10:00:00.500Z' },
        { stage: 'complete', requestId: `req-${index}`, observedAt: '2026-09-20T10:00:01.000Z' },
      ],
    },
  ])) as Record<string, Record<string, unknown>>
  phases.gpxTimed = { ...phases.gpxTimed, source: { kind: 'timed', basename: 'c24-timed.gpx', bytes: 219, sha256: 'a'.repeat(64) }, import: { importId: 'import-timed', accepted: 1, failures: 0 } }
  phases.gpxUntimed = { ...phases.gpxUntimed, source: { kind: 'untimed', basename: 'c24-untimed.gpx', bytes: 204, sha256: 'b'.repeat(64) }, import: { importId: 'import-untimed', accepted: 1, failures: 0 } }
  phases.archiveCreate = { ...phases.archiveCreate, archive: { id: 'archive-1', missionId: 'finished-mission', status: 'verified', availability: 'present' } }
  phases.archiveVerify = { ...phases.archiveVerify, archive: { id: 'archive-1', missionId: 'finished-mission', verified: true, immutable: true } }
  phases.archiveReview = { ...phases.archiveReview, review: { sessionId: 'review-1', missionId: 'finished-mission', nonEmpty: true, mutationDenied: true, breadcrumbCount: 0, trackCount: 2, objectCount: 0 } }
  phases.archiveRestore = { ...phases.archiveRestore, restore: { sessionId: 'review-1', archiveId: 'archive-1', missionId: 'finished-mission', identityMatched: true, plaintextResidual: 'permission_restricted_session_open' } }
  phases.archiveCleanup = { ...phases.archiveCleanup, cleanup: { archiveId: 'archive-1', completed: true, storageState: 'archived', freshCredentialGate: true, movedRows: 4, reviewClosed: true } }
  phases.diagnostics = { ...phases.diagnostics, fault: { requested: 'invalid-file-name', fileName: C24_INVALID_DIAGNOSTIC_FILE_NAME, rejected: true, errorObserved: true, requestId: 'req-7' }, recovery: { requested: 'valid-file-name', exported: true, pathBasename: 'c24-diagnostics-recovery.txt' } }
  phases.mapFault = { ...phases.mapFault, fault: { attempted: true, throwHookHit: true, requestId: 'req-8', startedAt: '2026-09-20T10:00:00.000Z', warningRegistrationId: 'markers', warningText: 'Markers overlay could not be rendered.', operatorWarningVisible: true, recoveryObserved: true, warningClearedAfterRecovery: true, consoleOnly: false, cleanupRestored: true } }
  return {
    schemaVersion: 1,
    schema: 'sartracker-competing-operation-v1',
    contractId: 'C24',
    missionId: 'active-mission',
    archiveMissionId: 'finished-mission',
    activeMission: { id: 'active-mission', status: 'active', observedAt: '2026-09-20T10:00:00.000Z' },
    phases,
    faultStages: [
      { stage: 'start', operationId: 'op-diagnostics', observedAt: '2026-09-20T10:00:00.000Z', requestId: 'req-7' },
      { stage: 'steady', operationId: 'op-diagnostics', observedAt: '2026-09-20T10:00:00.500Z', requestId: 'req-7' },
      { stage: 'fail', operationId: 'op-diagnostics', observedAt: '2026-09-20T10:00:00.700Z', requestId: 'req-7' },
      { stage: 'cleanup', operationId: 'op-mapFault', observedAt: '2026-09-20T10:00:01.000Z', requestId: 'req-8' },
    ],
  }
}

/** Build a synthetic report-shaped fixture; it is never a qualification receipt. */
function report(overrides: Record<string, unknown> = {}) {
  const profile = {
    name: 'ci', deviceCount: 32, movingDeviceCount: 8, stationaryDeviceCount: 24, staleDeviceCount: 0, durationDays: null, actualBatches: 6,
    productionPollsPerBatch: 180, equivalentProductionPolls: 1_080,
    expectedPositionRows: 8_664, restartCheckpoints: [3], recommendedPollIntervalMs: 25,
  }
  const events = { mission_created: 1, device_created: 32, mission_backup_synced: 2 }
  const sourceTruth = {
    full: { rowCount: 8_664, missingSourcePositionIdentityRows: 0, sha256: fullSha256 },
    normalPrefix: { rowCount: 8_664, missingSourcePositionIdentityRows: 0, sha256: normalPrefixSha256 },
    normalPrefixBatch: 480,
  }
  const currentIds = Array.from({ length: 32 }, (_, index) => String(index + 1))
  const sourceRows = currentIds.map((deviceId) => ({
    deviceId,
    sourcePositionId: `p-${deviceId}`,
  }))
  const sourceRowsHold = currentIds.map((deviceId) => ({
    deviceId,
    sourcePositionId: `h-${deviceId}`,
  }))
  const sourceRowsReconnect = currentIds.map((deviceId) => ({
    deviceId,
    sourcePositionId: `r-${deviceId}`,
  }))
  const sourceCurrentResponses = [
    { status: 200, kind: 'current', sourceResponseSequence: 1, sourceArrivalAtMs: 1_000, sourcePositions: sourceRows },
    { status: 200, kind: 'current', sourceResponseSequence: 2, sourceArrivalAtMs: 1_010, sourcePositions: sourceRowsHold },
    { status: 200, kind: 'current', sourceResponseSequence: 3, sourceArrivalAtMs: 1_020, sourcePositions: sourceRowsReconnect },
  ]
  const sourceCurrentObservations = [
    { label: 'initial-current', observedAtMs: 1_025, positionBindings: sourceRows,
      matchedSourceArrivals: sourceRows.map((row) => ({ ...row, sourceResponseSequence: 1, sourceArrivalAtMs: 1_000, latencyMs: 25 })) },
    { label: 'history-hold-current', observedAtMs: 1_035, positionBindings: sourceRowsHold,
      matchedSourceArrivals: sourceRowsHold.map((row) => ({ ...row, sourceResponseSequence: 2, sourceArrivalAtMs: 1_010, latencyMs: 25 })) },
    { label: 'current-reconnect', observedAtMs: 1_045, positionBindings: sourceRowsReconnect,
      matchedSourceArrivals: sourceRowsReconnect.map((row) => ({ ...row, sourceResponseSequence: 3, sourceArrivalAtMs: 1_020, latencyMs: 25 })) },
  ]
  const sourceToCurrentLatencyMs = sourceCurrentObservations.slice(1).flatMap((observation) =>
    observation.matchedSourceArrivals.map((match) => match.latencyMs))
  const priorityFaultEvidence = {
    schemaVersion: 1,
    status: 'observed',
    source: {
      expectedDeviceCount: 32,
      expectedDeviceIds: currentIds,
      historyHoldStatus: 503,
      currentOfflineStatus: 503,
      currentReconnectStatus: 200,
      currentRequestDurationsMs: [4, 5, 6],
      currentResponses: sourceCurrentResponses,
      provider: { currentSuccesses: 2, currentFailures: 1, heldHistoryRequests: 1 },
    },
    packaged: {
      initial: { count: 32, deviceIds: currentIds, sourcePositionIds: currentIds.map((id) => `p-${id}`), timestampCount: 32,
        observedAtMs: 1_025, positionBindings: sourceRows },
      currentWhileHistoryHeld: { count: 32, deviceIds: currentIds, sourcePositionIds: currentIds.map((id) => `h-${id}`), timestampCount: 32,
        observedAtMs: 1_035, positionBindings: sourceRowsHold },
      currentAfterReconnect: { count: 32, deviceIds: currentIds, sourcePositionIds: currentIds.map((id) => `r-${id}`), timestampCount: 32,
        observedAtMs: 1_045, positionBindings: sourceRowsReconnect },
      visibility: [
        { deviceId: '1', action: 'hide', checkedBefore: true, checkedAfter: false, durationMs: 8 },
        { deviceId: '1', action: 'show', checkedBefore: false, checkedAfter: true, durationMs: 8 },
      ],
    },
    operations: {
      competingHistoryAndCurrent: true,
      cancellation: {
        operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', started: true, startDurationMs: 4,
        cancelRequested: true, cancelAccepted: true, queryOutcome: 'cancelled', positionCount: null,
        clientSurface: 'packaged-electron-mission-store-exact-dot-page',
        queryApi: 'listExactBreadcrumbDotPage',
        queryErrorName: 'AbortError', queryErrorClass: 'breadcrumb-query-cancelled',
        querySettled: true, cleanupCompleted: true,
      },
      faultStages: [
        { sequence: 1, stage: 'start', operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', observedAt: '2026-09-20T10:00:00.000Z', outcome: 'started' },
        { sequence: 2, stage: 'steady', operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', observedAt: '2026-09-20T10:00:00.500Z', outcome: 'in-flight' },
        { sequence: 3, stage: 'cancel', operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', observedAt: '2026-09-20T10:00:00.700Z', outcome: 'accepted' },
        { sequence: 4, stage: 'fail', operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', observedAt: '2026-09-20T10:00:00.800Z', outcome: 'cancelled' },
        { sequence: 5, stage: 'cleanup', operationId: 'priority-breadcrumb-test', requestId: 'priority-breadcrumb-test', observedAt: '2026-09-20T10:00:01.000Z', outcome: 'settled' },
      ],
      competingOperationBinding: { missionId: 'active-mission', archiveMissionId: 'finished-mission' },
      competingOperationEvidence: competingOperationEvidence(),
      representativePhases: {
        coverage: { status: 'fulfilled', durationMs: 5, resultShape: { enumerated: true, chunkCount: 0 } },
        replay: { status: 'fulfilled', durationMs: 6, resultShape: { replayGeneration: 1, trackCount: 0 } },
        gpx: { status: 'fulfilled', durationMs: 7, resultShape: { importCount: 0, issueCount: 0 } },
        archive: { status: 'fulfilled', durationMs: 8, resultShape: { archiveCount: 0 } },
        backup: { status: 'fulfilled', durationMs: 9, resultShape: { resultKind: 'string' } },
        export: { status: 'fulfilled', durationMs: 10, resultShape: { resultKind: 'string' } },
      },
    },
    sourceCurrentObservations,
    sourceToCurrentLatencyMs,
  }
  return {
    schemaVersion: 1,
    issue: 'DON-246',
    profile,
    fixtureClock: { baseTimeMs, intervalMs },
    app: { basename: 'SAR.AppImage', sha256: artifactSha256 },
    package: { tier: 'ci-appimage' },
    process: { tier: 'packaged-electron', executableSha256: artifactSha256 },
    platform: { os: 'Linux 6.1.0', architecture: 'x64' },
    thresholds: { freezeThresholdMs: 1_000, mainStallThresholdMs: 200 },
    mockTraccar: { completedBatches: 6 },
    missionModel: {
      enabled: false, expectedParticipantRows: 32, expectedParticipantAddedEvents: 32,
      persistedParticipantRows: 32, persistedTeamRows: 0,
    },
    database: {
      deviceRows: 32, participantRows: 32, teamRows: 0, positionRows: 8_664,
      events, operationalMissionEvents: 35, participantBackfillCompletedEvents: 0,
      unexplainedMissionEvents: 0, positionTruth: sourceTruth,
      integrityResult: 'ok', walCheckpoint: { busy: 0 },
    },
    positionTruth: {
      actual: sourceTruth,
      exactMatch: false,
      normalPrefixExactMatch: false,
    },
    responsiveness: {
      mainProcess: { count: 40, maxMs: 14 },
      independentMainEventLoops: [
        { intervalMs: 50, samples: 10, startedAtMs: 0, stoppedAtMs: 600, maximumGapMs: 60 },
        { intervalMs: 50, samples: 10, startedAtMs: 0, stoppedAtMs: 600, maximumGapMs: 60 },
      ],
      renderer: { count: 40, maxMs: 22 },
      operatorInteractions: {
        count: 4, maxMs: 1_200, errors: 0,
        actionTiming: { count: 8, maxMs: 650 },
        externalActionTiming: { count: 8, maxMs: 700 },
      },
    },
    priorityFaultEvidence,
    rawResourceMetrics: {
      resourceDistributions: { cpuProcessMs: [2, 3, 4], storageBytes: [1_024, 2_048] },
    },
    processMemory: { maximumProcessTreeResidentBytes: 500_000_000 },
    rendererCrashes: 0,
    webGlRendererAttestation: { passed: true },
    boundedEvidence: { runtimeLogBytes: 24_000, supportBundleBytes: 18_000, supportBundleRedacted: true },
    restartCheckpointsPassed: 1,
    launches: [
      { rendererSampleCount: 20, mainHeartbeatErrors: 0 },
      { rendererSampleCount: 20, mainHeartbeatErrors: 0 },
    ],
    verdict: { passed: false, failureReasons: ['producer claim is ignored'] },
    ...overrides,
  }
}

describe('qualification soak receipt validators', () => {
  it.each(['C04', 'C24'])('recomputes %s from report predicates instead of verdict.passed', (contractId) => {
    const result = validateSoakContractEvidence(contractId, report(contractId === 'C24' ? c24ArchiveEvidence : {}), { ...(contractId === 'C24' ? c24Expected : expected), variantId: 'ci' })
    expect(result.passed).toBe(true)
    expect(result.recomputedVerdict.passed).toBe(true)
    expect(result.coverageComplete).toBe(true)
    expect(result.qualificationEligible).toBe(true)
    expect(result.familyCoverageComplete).toBe(false)
    expect(result.uncoveredAxes).toEqual([])
    if (contractId === 'C04') {
      expect(result.familyMissingVariants).toEqual([
        { variantId: 'priority-100', proofMode: 'ci-appimage' },
        { variantId: 'ci-installed', proofMode: 'installed-deb' },
        { variantId: 'priority-100-installed', proofMode: 'installed-deb' },
      ])
    }
  })

  it('rejects a forged passing verdict when a raw predicate fails', () => {
    const tampered = report()
    tampered.verdict.passed = true
    tampered.database.positionRows = 8_663
    const result = validateSoakContractEvidence('C04', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/position rows/iu)
  })

  it('accounts for exactly bound priority barrier rows in full truth', () => {
    const candidate = report()
    const fullTruth = {
      ...candidate.database.positionTruth,
      full: { ...candidate.database.positionTruth.full, rowCount: 8_728 },
    }
    candidate.database.positionRows = 8_728
    candidate.database.positionTruth = fullTruth
    candidate.positionTruth = { ...candidate.positionTruth, actual: fullTruth }
    candidate.priorityFaultEvidence.source.prioritySource = { batch: 3, versionCount: 2 }
    const bound = {
      ...expected,
      source: {
        ...expected.source,
        prioritySource: { batch: 3, versionCount: 2 },
      },
    }

    const accepted = validateSoakContractEvidence('C04', candidate, bound)
    expect(accepted.passed).toBe(true)
    expect(accepted.recomputedVerdict.passed).toBe(true)

    const forged = report()
    forged.database.positionRows = 8_728
    forged.database.positionTruth = fullTruth
    forged.positionTruth = { ...forged.positionTruth, actual: fullTruth }
    forged.priorityFaultEvidence.source.prioritySource = { batch: 3, versionCount: 1 }
    const rejected = validateSoakContractEvidence('C04', forged, bound)
    expect(rejected.passed).toBe(false)
    expect(rejected.failureReasons.join('\n')).toMatch(/priority|barrier|source truth/iu)
  })

  it('requires independent priority and fault observations for C04/C24', () => {
    const missing = validateSoakContractEvidence('C04', report({ priorityFaultEvidence: undefined }), expected)
    expect(missing.passed).toBe(false)
    expect(missing.failureReasons.join('\n')).toMatch(/priority|history|current/iu)

    const tampered = report({
      priorityFaultEvidence: {
        ...report().priorityFaultEvidence,
        source: { ...report().priorityFaultEvidence.source, currentOfflineStatus: 200 },
      },
    })
    const result = validateSoakContractEvidence('C04', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/offline|503|fault/iu)
  })

  it('rejects HTTP request duration relabeled as source-to-current latency', () => {
    const tampered = report({
      priorityFaultEvidence: {
        ...report().priorityFaultEvidence,
        source: {
          ...report().priorityFaultEvidence.source,
          currentResponses: undefined,
        },
        sourceCurrentObservations: undefined,
      },
    })
    const result = validateSoakContractEvidence('C04', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/source.*current|arrival|observation/iu)
  })

  it('uses the earliest arrival for a new source identity instead of a later repeated poll', () => {
    const candidate = report()
    const evidence = candidate.priorityFaultEvidence
    const repeated = {
      status: 200,
      kind: 'current',
      sourceResponseSequence: 4,
      sourceArrivalAtMs: 1_030,
      sourcePositions: evidence.source.currentResponses[1].sourcePositions,
    }
    evidence.source.currentResponses = [...evidence.source.currentResponses, repeated]
    const repeatedMatches = evidence.sourceCurrentObservations[1].matchedSourceArrivals.map((match) => ({
      ...match,
      sourceResponseSequence: 4,
      sourceArrivalAtMs: 1_030,
      latencyMs: 5,
    }))
    evidence.sourceCurrentObservations[1] = {
      ...evidence.sourceCurrentObservations[1],
      matchedSourceArrivals: repeatedMatches,
    }
    evidence.sourceToCurrentLatencyMs = [
      ...evidence.sourceToCurrentLatencyMs.slice(0, 32),
      ...repeatedMatches.map((match) => match.latencyMs),
      ...evidence.sourceToCurrentLatencyMs.slice(64),
    ]
    const result = validateSoakContractEvidence('C04', candidate, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/earliest|source arrivals|recomputed/iu)
  })

  it('rejects an accepted cancellation after the breadcrumb query already fulfilled', () => {
    const tampered = report({
      priorityFaultEvidence: {
        ...report().priorityFaultEvidence,
        operations: {
          ...report().priorityFaultEvidence.operations,
          cancellation: {
            ...report().priorityFaultEvidence.operations.cancellation,
            queryOutcome: 'fulfilled',
            positionCount: 16,
          },
        },
      },
    })
    const result = validateSoakContractEvidence('C04', tampered, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/in-flight|cancelled|AbortError/iu)
  })

  it('rejects cancellation evidence from an injected or unspecified client surface', () => {
    const candidate = report()
    candidate.priorityFaultEvidence.operations.cancellation.clientSurface = 'checkout-injected-breadcrumb-client'
    const result = validateSoakContractEvidence('C04', candidate, expected)
    expect(result.failureReasons.join('\n')).toContain(
      'Priority-fault competing operation did not retain a real in-flight cancellation, settled AbortError outcome and cleanup observations.',
    )
  })

  it('rejects priority stages that are not bound to the real operation and request', () => {
    const candidate = report()
    candidate.priorityFaultEvidence.operations.faultStages[2] = {
      sequence: 3,
      stage: 'cancel',
      operationId: 'different-operation',
      requestId: 'different-request',
      observedAt: '2026-09-20T10:00:00.700Z',
      outcome: 'accepted',
    }
    const result = validateSoakContractEvidence('C04', candidate, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/stage.*bound|cancelled operation/iu)
  })

  it('rejects a steady record that claims the query was already settled', () => {
    const candidate = report()
    candidate.priorityFaultEvidence.operations.faultStages[1].outcome = 'already-settled'
    const result = validateSoakContractEvidence('C04', candidate, expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/steady.*outcome|in-flight/iu)
  })

  it('accepts equal wall-clock stage timestamps when explicit sequence is retained', () => {
    const candidate = report()
    for (const stage of candidate.priorityFaultEvidence.operations.faultStages.slice(2)) {
      stage.observedAt = '2026-09-20T10:00:00.700Z'
    }
    const result = validateSoakContractEvidence('C04', candidate, expected)
    expect(result.passed).toBe(true)
  })

  it('requires raw CPU and storage distributions for C24', () => {
    const result = validateSoakContractEvidence('C24', report({ ...c24ArchiveEvidence,
      rawResourceMetrics: { resourceDistributions: { cpuProcessMs: [], storageBytes: [] } },
    }), c24Expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/CPU|storage|I\/O|resource/iu)
  })

  it('requires every C24 operation phase independently of the producer verdict', () => {
    const missing = validateSoakContractEvidence('C24', report({ ...c24ArchiveEvidence,
      priorityFaultEvidence: {
        ...report().priorityFaultEvidence,
        operations: {
          ...report().priorityFaultEvidence.operations,
          competingOperationBinding: undefined,
          competingOperationEvidence: undefined,
        },
      },
    }), c24Expected)
    expect(missing.passed).toBe(false)
    expect(missing.failureReasons.join('\n')).toMatch(/competing-operation|mission binding|phase/iu)

    const tampered = validateSoakContractEvidence('C24', report({ ...c24ArchiveEvidence,
      priorityFaultEvidence: {
        ...report().priorityFaultEvidence,
        operations: {
          ...report().priorityFaultEvidence.operations,
          competingOperationEvidence: {
            ...report().priorityFaultEvidence.operations.competingOperationEvidence,
            phases: {
              ...report().priorityFaultEvidence.operations.competingOperationEvidence.phases,
              archiveReview: {
                ...report().priorityFaultEvidence.operations.competingOperationEvidence.phases.archiveReview,
                review: { sessionId: 'review-1', missionId: 'finished-mission', nonEmpty: true, mutationDenied: false, breadcrumbCount: 0, trackCount: 0, objectCount: 0 },
              },
            },
          },
        },
      },
    }), c24Expected)
    expect(tampered.passed).toBe(false)
    expect(tampered.failureReasons.join('\n')).toMatch(/archive review|empty|mutable|competing-operation/iu)
  })

  it('rejects a CI profile when C25 is bound to long-duration evidence', () => {
    const longExpected = {
      ...expected,
      workload: {
        class: 'long-duration',
        minimumEquivalentProductionPolls: 241_920,
        minimumDeviceCount: 32,
        minimumArchiveCycles: 2,
      },
    }
    const result = validateSoakContractEvidence('C25', report(), longExpected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/C25|long-duration|CI|profile/iu)
  })

  it('requires archive cycles retained while the long-duration tracking mission is active', () => {
    const longExpected = {
      ...expected,
      profileName: 'normal',
      workload: {
        class: 'long-duration',
        minimumEquivalentProductionPolls: 86_400,
        minimumDeviceCount: 32,
        minimumArchiveCycles: 2,
      },
      missionModel: {
        enabled: true,
        expectedParticipantRows: 32,
        expectedParticipantAddedEvents: 0,
      },
    }
    const result = validateSoakContractEvidence('C25', report(), longExpected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/archive[- ]cycle|archive.*tracking/iu)
  })

  it('keeps family completeness separate from one valid C25 variant', () => {
    const one = deriveSoakFamilyCoverage('C25', [{
      contractId: 'C25', variantId: 'normal', proofMode: 'ci-appimage', passed: true,
    }])
    expect(one.coverageComplete).toBe(false)
    expect(one.missingVariants).toHaveLength(11)

    const complete = deriveSoakFamilyCoverage('C25', [
      ...one.requiredVariants.map((entry) => ({
        contractId: 'C25', variantId: entry.variantId, proofMode: entry.proofMode, passed: true,
      })),
    ])
    expect(complete.coverageComplete).toBe(true)
    expect(complete.missingVariants).toEqual([])
  })

  it('requires an archive failure to be rejected and recovered after a restart', () => {
    const longExpected = {
      ...expected,
      profileName: 'normal',
      workload: {
        class: 'long-duration',
        minimumEquivalentProductionPolls: 86_400,
        minimumDeviceCount: 32,
        minimumArchiveCycles: 2,
      },
      missionModel: {
        enabled: true,
        expectedParticipantRows: 32,
        expectedParticipantAddedEvents: 0,
      },
    }
    const result = validateSoakContractEvidence('C25', report({
      archiveCycles: {
        expectedCount: 2,
        completedCount: 2,
        entries: [
          { observedWhileTracking: true, missionStatusBefore: 'finished', missionStatusAfter: 'finalized', archiveStatus: 'verified', archiveAvailability: 'present', createProgressPhases: ['encrypt'], verifyProgressPhases: ['verified'] },
          { observedWhileTracking: true, missionStatusBefore: 'finished', missionStatusAfter: 'finalized', archiveStatus: 'verified', archiveAvailability: 'present', createProgressPhases: ['encrypt'], verifyProgressPhases: ['verified'] },
        ],
      },
    }), longExpected)
    expect(result.failureReasons.join('\n')).toMatch(/archive.*failure|recovery/iu)
  })

  it('rejects a field-scale binding when the source workload is below its independent minimum', () => {
    const fieldExpected = {
      ...expected,
      workload: {
        class: 'field-scale',
        minimumEquivalentProductionPolls: 241_920,
        minimumDeviceCount: 100,
        minimumPositionRows: 2_000_000,
        expectedOutingCount: 12,
        maximumResidentBytes: 2_147_483_648,
        minimumFixtureBytes: 3_700_000_000,
        fixturePreset: 'field',
        fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field' },
      },
    }
    const result = validateSoakContractEvidence('C25', report(), fieldExpected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/field-scale|device|poll/iu)
    const c24 = validateSoakContractEvidence('C24', report(c24ArchiveEvidence), {
      ...fieldExpected, workload: { ...fieldExpected.workload, minimumArchiveCycles: 2 },
    })
    expect(c24.failureReasons).toContain('C24 competing operations did not observe the complete field workload before starting.')
  })

  it('requires retained field-scale outing and raw resource metrics', () => {
    const fieldExpected = {
      ...expected,
      profileName: 'field-960k',
      workload: {
        class: 'field-scale',
        minimumEquivalentProductionPolls: 9_600,
        minimumDeviceCount: 100,
        minimumPositionRows: 960_000,
        expectedOutingCount: 12,
        maximumResidentBytes: 2_147_483_648,
        minimumFixtureBytes: 3_700_000_000,
        fixturePreset: 'field',
        fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field' },
      },
      missionModel: {
        enabled: true,
        expectedParticipantRows: 100,
        expectedParticipantAddedEvents: 0,
      },
    }
    const result = validateSoakContractEvidence('C25', report(), fieldExpected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/raw resource metrics|outing/iu)
  })

  it('accepts resident memory below the 2GiB ceiling and rejects only over-budget memory', () => {
    const fieldExpected = {
      ...expected,
      profileName: 'field-960k',
      workload: {
        class: 'field-scale',
        minimumEquivalentProductionPolls: 9_600,
        minimumDeviceCount: 100,
        minimumPositionRows: 960_000,
        expectedOutingCount: 12,
        maximumResidentBytes: 2_147_483_648,
        minimumFixtureBytes: 3_700_000_000,
        fixturePreset: 'field',
        fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field' },
      },
      missionModel: {
        enabled: true,
        expectedParticipantRows: 100,
        expectedParticipantAddedEvents: 0,
      },
    }
    const raw = {
      profile: {
        name: 'field-960k', deviceCount: 100, movingDeviceCount: 100, stationaryDeviceCount: 0, staleDeviceCount: 0, durationDays: 12, equivalentProductionPolls: 9_600,
        expectedPositionRows: 960_000, outingCount: 12,
      },
      database: {
        positionRows: 960_000, outingRows: 12, databaseFileBytes: 480_000_000,
        walFileBytes: 0, shmFileBytes: 0,
      },
      process: { maximumResidentBytes: 512_000_000, sampleCount: 4 },
      fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field', minimumBytes: 3_700_000_000 },
      fieldFixtureLoad: {
        runtimeDatabaseBasename: 'mission-store.sqlite',
        runtimeDatabaseBytes: 3_700_000_000,
        runtimeDatabaseSha256: 'd'.repeat(64),
        fixtureMissionId: 'fixture-mission-000000000001',
        fixtureMissionStatusBefore: 'active',
        fixtureMissionStatusAfter: 'finished',
        workloadMissionId: 'synthetic-workload-mission',
      },
    }
    const below = validateSoakContractEvidence('C25', report({ rawResourceMetrics: raw }), fieldExpected)
    expect(below.failureReasons.join('\n')).not.toMatch(/resident bytes.*(?:below|threshold)|resident.*budget/iu)

    const above = validateSoakContractEvidence('C25', report({
      rawResourceMetrics: {
        ...raw,
        process: { maximumResidentBytes: 2_147_483_649, sampleCount: 4 },
      },
    }), fieldExpected)
    expect(above.failureReasons.join('\n')).toMatch(/resident.*(?:maximum|budget|ceiling)|(?:maximum|budget|ceiling).*resident/iu)
  })

  it('requires the bound field fixture to be loaded and then used by the workload mission', () => {
    const fieldExpected = {
      ...expected,
      profileName: 'field-960k',
      workload: {
        class: 'field-scale',
        minimumEquivalentProductionPolls: 9_600,
        minimumDeviceCount: 100,
        minimumPositionRows: 960_000,
        expectedOutingCount: 12,
        maximumResidentBytes: 2_147_483_648,
        minimumFixtureBytes: 3_700_000_000,
        fixturePreset: 'field',
        fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field' },
      },
      missionModel: { enabled: true, expectedParticipantRows: 100, expectedParticipantAddedEvents: 0 },
    }
    const raw = {
      profile: {
        name: 'field-960k', deviceCount: 100, movingDeviceCount: 100, stationaryDeviceCount: 0, staleDeviceCount: 0, durationDays: 12, equivalentProductionPolls: 9_600,
        expectedPositionRows: 960_000, outingCount: 12,
      },
      database: { positionRows: 960_000, outingRows: 12, databaseFileBytes: 480_000_000, walFileBytes: 0, shmFileBytes: 0 },
      process: { maximumResidentBytes: 512_000_000, sampleCount: 4 },
      fieldFixture: { basename: 'field.sqlite', bytes: 3_700_000_000, sha256: 'd'.repeat(64), preset: 'field', minimumBytes: 3_700_000_000 },
      fieldFixtureLoad: { runtimeDatabaseBasename: 'mission-store.sqlite', runtimeDatabaseBytes: 3_700_000_000, runtimeDatabaseSha256: 'd'.repeat(64), fixtureMissionId: 'fixture-mission-000000000001', fixtureMissionStatusBefore: 'active', fixtureMissionStatusAfter: 'finished', workloadMissionId: 'synthetic-workload-mission' },
    }
    const missing = validateSoakContractEvidence('C25', report({ rawResourceMetrics: { ...raw, fieldFixtureLoad: undefined } }), fieldExpected)
    expect(missing.failureReasons.join('\n')).toMatch(/loaded|fixture.*workload|runtime database/iu)
    const valid = validateSoakContractEvidence('C25', report({ rawResourceMetrics: raw }), fieldExpected)
    expect(valid.failureReasons.join('\n')).not.toMatch(/loaded|fixture.*workload|runtime database/iu)
  })

  it('fails closed when independent package or process-tier facts are absent', () => {
    const result = validateSoakContractEvidence('C04', report({ package: undefined, process: undefined }), expected)
    expect(result.passed).toBe(false)
    expect(result.failureReasons.join('\n')).toMatch(/package|process|tier/iu)
  })

  it('rejects an unsupported contract and malformed independent source binding', () => {
    expect(() => validateSoakContractEvidence('C03', report(), expected)).toThrow(/C04|C24|C25/iu)
    expect(() => validateSoakContractEvidence('C04', report(), {
      ...expected,
      source: { ...expected.source, fullSha256: 'bad' },
    })).toThrow(/source|sha|binding/iu)
  })
})
