import { createDiagnosticState } from '../../build/electron-repair-train-d-smoke-lib.js'

/** Builds a complete terminal receipt fixture with no Electron dependency. */
export function createTrainDReceipt() {
  const profile = '/tmp/repair-train-d-profile'
  const livePath = `${profile}/mission-store.sqlite`
  const backupPath = `${profile}/mission-store.backup.sqlite`
  const diagnostics = () => createDiagnosticState()
  const close = () => ({
    requestedAt: '2026-09-14T10:00:00.000Z',
    exitObservedAt: '2026-09-14T10:00:01.000Z',
    stderrDrainedAt: '2026-09-14T10:00:02.000Z',
    graceful: true,
    exitCode: 0,
    signal: null,
    diagnostics: diagnostics(),
  })
  const firstPage = {
    kind: 'areas',
    generation: 4,
    totalCount: 26,
    entryCount: 25,
    firstEntry: { id: 'repair-train-d-area-00', name: 'AUD-09 area 00' },
    lastEntry: { id: 'repair-train-d-area-24', name: 'AUD-09 area 24' },
    nextCursor: 'cursor',
  }
  const secondPage = {
    ...firstPage,
    entryCount: 1,
    firstEntry: { id: 'repair-train-d-area-25', name: 'AUD-09 area 25' },
    lastEntry: { id: 'repair-train-d-area-25', name: 'AUD-09 area 25' },
    nextCursor: null,
  }
  const readonly = {
    live: {
      path: livePath,
      integrity: 'ok',
      generation: 4,
      searchOperationsGeneration: 4,
      searchAreaCount: 26,
      backupSyncEventCount: 1,
    },
    backup: {
      path: backupPath,
      integrity: 'ok',
      generation: 4,
      searchOperationsGeneration: 4,
      searchAreaCount: 26,
      backupSyncEventCount: 0,
    },
  }
  return {
    result: 'pass',
    failures: [],
    source: { dirty: false, head: 'sha', tree: 'tree' },
    profile,
    profileRetention: { status: 'removed' },
    package: {
      packagedInputsMatch: true,
      archivePath: '/tmp/app.asar',
      windowAttestation: { hasTraccarHttpBridge: true },
    },
    provider: {
      origin: 'http://127.0.0.1:1234',
      heldHistoryRequests: 1,
      historyHoldEvidence: {
        method: 'GET',
        path: '/api/positions',
        deviceId: '22',
        from: '2026-09-13T03:00:00.000Z',
        to: '2026-09-13T05:00:00.000Z',
        isHistory: true,
        status: 503,
      },
    },
    launches: [
      { label: 'initial', pid: 101, close: close() },
      { label: 'restart', pid: 102, close: close() },
    ],
    phases: {
      aud08: {
        missionId: 'mission-aud08',
        progressScreenshot: '/tmp/evidence/aud08-readded-group-progress.png',
        screenshot: '/tmp/evidence/aud08-readded-group-pending.png',
        finishBlockedSurface: 'Participant history backfill is incomplete; keep the mission active.',
        readdedPending: {
          participants: [{
            kind: 'group',
            mission_id: 'mission-aud08',
            removed_at: null,
            effective_from: '2026-09-13T03:30:00.000Z',
            backfill_member_count: 2,
            backfill_completed_count: 1,
          }],
          checkpoints: [
            { mission_id: 'mission-aud08', traccar_device_id: '11', completed: 1 },
            { mission_id: 'mission-aud08', traccar_device_id: '22', completed: 0 },
          ],
        },
        automaticBackfill: {
          initialCheckpointCompleted: true,
          readdedSuccessfulMember: '11',
          readdedHeldMember: '22',
          providerHistoryHoldObserved: 1,
          readdWindow: {
            from: '2026-09-13T03:30:00.000Z',
            to: '2026-09-13T04:00:00.000Z',
          },
          successfulHistoryRequest: {
            method: 'GET',
            path: '/api/positions',
            isHistory: true,
            deviceId: '11',
            status: 200,
            from: '2026-09-13T03:30:00.000Z',
            to: '2026-09-13T04:00:00.000Z',
          },
          currentRequestsBeforeHold: 1,
          currentRequestsAfterHold: 3,
        },
      },
      aud09: {
        firstPage,
        secondPage,
        backupPath,
        readonly,
        screenshot: '/tmp/evidence/aud09-search-operations-after-backup.png',
      },
      restart: {
        participant: {
          mission: { id: 'mission-aud08', status: 'active' },
          participants: [{
            kind: 'group',
            mission_id: 'mission-aud08',
            removed_at: null,
            backfill_member_count: 2,
            backfill_completed_count: 1,
          }],
          checkpoints: [{ mission_id: 'mission-aud08', traccar_device_id: '22', completed: 0 }],
        },
        secondPage,
        readonly,
        screenshot: '/tmp/evidence/restart-participant-and-search-cursor.png',
      },
    },
    scenarioResults: { aud08: 'pass', aud09: 'pass', restart: 'pass' },
    scenarioResult: 'pass',
    diagnosticResult: 'pass',
    diagnosticBlockers: [],
  }
}
