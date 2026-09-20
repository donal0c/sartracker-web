import { describe, expect, it } from 'vitest'

import {
  C24_INVALID_DIAGNOSTIC_FILE_NAME,
  collectFaultStages,
  projectCompetingMapFaultOperation,
  validateCompetingOperationEvidence,
} from '../../scripts/qualification/competing-operation-probe.mjs'

const PHASES = [
  'gpxTimed',
  'gpxUntimed',
  'archiveCreate',
  'archiveVerify',
  'archiveReview',
  'archiveRestore',
  'archiveCleanup',
  'diagnostics',
  'mapFault',
] as const

function operation(operationId: string, requestId: string) {
  return {
    operationId,
    requestIds: [requestId],
    startedAt: '2026-09-20T10:00:00.000Z',
    endedAt: '2026-09-20T10:00:01.000Z',
    status: 'completed',
    stages: [
      { stage: 'start', requestId, observedAt: '2026-09-20T10:00:00.000Z' },
      { stage: 'steady', requestId, observedAt: '2026-09-20T10:00:00.500Z' },
      { stage: 'complete', requestId, observedAt: '2026-09-20T10:00:01.000Z' },
    ],
  }
}

function validReport() {
  const phases = Object.fromEntries(PHASES.map((phase, index) => [
    phase,
    operation(`op-${phase}`, `req-${index}`),
  ])) as Record<string, Record<string, unknown>>
  phases.gpxTimed = {
    ...phases.gpxTimed,
    source: { kind: 'timed', basename: 'c24-timed.gpx', bytes: 219, sha256: 'a'.repeat(64) },
    import: { importId: 'import-timed', accepted: 1, failures: 0 },
  }
  phases.gpxUntimed = {
    ...phases.gpxUntimed,
    source: { kind: 'untimed', basename: 'c24-untimed.gpx', bytes: 204, sha256: 'b'.repeat(64) },
    import: { importId: 'import-untimed', accepted: 1, failures: 0 },
  }
  phases.archiveCreate = {
    ...phases.archiveCreate,
    archive: { id: 'archive-1', missionId: 'finished-mission', status: 'verified', availability: 'present' },
  }
  phases.archiveVerify = {
    ...phases.archiveVerify,
    archive: { id: 'archive-1', missionId: 'finished-mission', verified: true, immutable: true },
  }
  phases.archiveReview = {
    ...phases.archiveReview,
    review: { sessionId: 'review-1', missionId: 'finished-mission', nonEmpty: true, mutationDenied: true, closed: true, breadcrumbCount: 0, trackCount: 2, objectCount: 0 },
  }
  phases.archiveRestore = {
    ...phases.archiveRestore,
    restore: { sessionId: 'review-1', archiveId: 'archive-1', missionId: 'finished-mission', identityMatched: true, plaintextResidual: 'permission_restricted_session_open' },
  }
  phases.archiveCleanup = {
    ...phases.archiveCleanup,
    cleanup: { archiveId: 'archive-1', completed: true, storageState: 'archived', freshCredentialGate: true, movedRows: 4, reviewClosed: true },
  }
  phases.diagnostics = {
    ...phases.diagnostics,
    fault: { requested: 'invalid-file-name', fileName: C24_INVALID_DIAGNOSTIC_FILE_NAME, rejected: true, errorObserved: true, requestId: 'req-7' },
    recovery: { requested: 'valid-file-name', exported: true, pathBasename: 'c24-diagnostics-recovery.txt' },
  }
  phases.mapFault = {
    ...phases.mapFault,
    fault: { attempted: true, throwHookHit: true, requestId: 'req-8', startedAt: '2026-09-20T10:00:00.000Z', warningText: 'Mission overlay could not be rendered.', operatorWarningVisible: true, recoveryObserved: true, consoleOnly: false, cleanupRestored: true },
  }
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

const expected = {
  missionId: 'active-mission',
  archiveMissionId: 'finished-mission',
  timedImportId: 'import-timed',
  untimedImportId: 'import-untimed',
  archiveId: 'archive-1',
}

describe('C24 competing operation evidence', () => {
  it('accepts complete raw operation identities and returns a non-flag receipt', () => {
    const receipt = validateCompetingOperationEvidence(validReport(), expected)

    expect(receipt).toMatchObject({ status: 'PASS', contractId: 'C24', missionId: 'active-mission' })
    expect(receipt).not.toHaveProperty('passed', true)
    expect(receipt.observedPhases).toEqual(PHASES)
  })

  it('rejects an empty operation or a substituted import identity', () => {
    const report = validReport()
    report.phases.gpxTimed = { ...report.phases.gpxTimed, import: { importId: 'other', accepted: 0, failures: 0 } }

    expect(() => validateCompetingOperationEvidence(report, expected)).toThrow(/timed GPX|import identity|accepted/u)
  })

  it('rejects a boolean-only archive nonEmpty marker without retained replay counts', () => {
    const report = validReport()
    report.phases.archiveReview = {
      ...report.phases.archiveReview,
      review: { sessionId: 'review-1', missionId: 'finished-mission', nonEmpty: true, mutationDenied: true },
    }

    expect(() => validateCompetingOperationEvidence(report, expected)).toThrow(/archive review/u)
  })

  it('rejects hard-coded stage names without raw observations', () => {
    const report = validReport()
    report.faultStages = ['start', 'steady', 'fail', 'cleanup'] as never

    expect(() => validateCompetingOperationEvidence(report, expected)).toThrow(/fault stage/u)
  })

  it('rejects a console-only map fault or archive cleanup with no moved rows', () => {
    const report = validReport()
    report.phases.mapFault = {
      ...report.phases.mapFault,
      fault: { attempted: true, throwHookHit: true, warningText: 'overlay', operatorWarningVisible: false, recoveryObserved: true, consoleOnly: true },
    }
    expect(() => validateCompetingOperationEvidence(report, expected)).toThrow(/map fault/u)

    const second = validReport()
    second.phases.archiveCleanup = {
      ...second.phases.archiveCleanup,
      cleanup: { archiveId: 'archive-1', completed: true, storageState: 'archived', freshCredentialGate: true, movedRows: 0 },
    }
    expect(() => validateCompetingOperationEvidence(second, expected)).toThrow(/cleanup/u)
  })

  it('retains the actual map producer stage order and derives wall-clock timestamps from monotonic facts', () => {
    const projected = projectCompetingMapFaultOperation({
      requestId: 'req-map',
      startedAtMs: 1000,
      completedAtMs: 1400,
      status: 'fulfilled',
      stages: [
        { stage: 'start', atMs: 1000 },
        { stage: 'fault', atMs: 1100 },
        { stage: 'steady', atMs: 1200 },
        { stage: 'recovery', atMs: 1300 },
        { stage: 'cleanup', atMs: 1400 },
      ],
      observed: { attempted: true },
      cleanup: { restored: true },
      screenshotPath: '/owned/c24/map.png',
    }, 1_700_000_000_000)

    expect(projected.stages.map((stage: { stage: string }) => stage.stage)).toEqual([
      'start', 'fail', 'steady', 'recovery', 'complete',
    ])
    expect(projected.stages.map((stage: { monotonicAtMs: number }) => stage.monotonicAtMs)).toEqual([1000, 1100, 1200, 1300, 1400])
    expect(projected.stages[0].observedAt).toBe('2023-11-14T22:13:20.000Z')
    expect(projected.stages.at(-1)?.observedAt).toBe('2023-11-14T22:13:20.400Z')
  })

  it('retains cleanup when the producer emits completion rather than a literal cleanup name', () => {
    const stages = collectFaultStages(
      { operationId: 'diagnostics', stages: [{ stage: 'start', requestId: 'd', observedAt: '2026-09-20T10:00:00.000Z' }, { stage: 'complete', requestId: 'd', observedAt: '2026-09-20T10:00:01.000Z' }] },
      { operationId: 'map', stages: [{ stage: 'start', requestId: 'm', observedAt: '2026-09-20T10:00:00.000Z' }, { stage: 'fail', requestId: 'm', observedAt: '2026-09-20T10:00:00.500Z' }, { stage: 'complete', requestId: 'm', observedAt: '2026-09-20T10:00:01.000Z' }] },
    )

    expect(stages.map((stage: { stage: string }) => stage.stage)).toContain('cleanup')
  })
})
