import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { createPollingManager } from '../../src/features/tracking/polling-manager'
import { startCoverageRuntime } from '../../src/features/tracking/start-coverage-runtime'
import { useMissionStore } from '../../src/features/mission/mission-store'
import { useTrackingStore, applyTrackingStatus } from '../../src/features/tracking/tracking-store'
import { useCoverageStore } from '../../src/features/tracking/coverage-store'
import { useIngestHealthStore } from '../../src/features/tracking/ingest-health-store'
import { CoverageStatusPanel } from '../../src/components/coverage-status-panel'
import type { CoverageManifest, CoverageClaim, CoverageChunkKey } from '../../src/infrastructure/mission-store/tauri-mission-store'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { readCoverageManifestSnapshot, readCoverageClaimSnapshot } = require('../../electron/coverage-query.cjs')
const cleanups: (() => void)[] = []
afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup())
  useMissionStore.setState(useMissionStore.getInitialState())
  useTrackingStore.setState(useTrackingStore.getInitialState())
  useCoverageStore.setState(useCoverageStore.getInitialState())
  useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
})

it('must revoke all-mission-history completion when actual history reconciliation fails', async () => {
  const database = new Database(':memory:')
  cleanups.push(() => database.close())
  // Reuse the repository's exact query-test schema, then model a valid already-built history.
  const queryTest = readFileSync('tests/unit/electron-coverage-query.test.ts', 'utf8')
  const schema = queryTest.slice(queryTest.indexOf('function createSchema(')).match(/database\.exec\(`([\s\S]*?)`\)/u)?.[1]
  expect(schema).toBeDefined()
  database.exec(schema)
  database.exec(`
    INSERT INTO tracking_history_checkpoints VALUES ('mission-1', '1', '2026-08-24T08:00:00.000Z', '2026-08-24T09:00:00.000Z', '2026-08-24T09:00:00.000Z', '2026-08-24T09:00:00.000Z', '2026-08-24T08:00:00.000Z');
    INSERT INTO devices VALUES ('device-row-1', 'mission-1', '1');
    INSERT INTO mission_participants VALUES ('participant-1', 'mission-1', 'device', '1', NULL, NULL);
    INSERT INTO participant_backfill_checkpoints VALUES ('mission-1', 1);
    INSERT INTO positions VALUES ('position-1', 'mission-1', '1', '1', '2026-08-24T08:00:00.000Z', 52, -9.7, 'fix');
    INSERT INTO positions VALUES ('position-100', 'mission-1', '1', '100', '2026-08-24T09:00:00.000Z', 52.001, -9.701, 'fix');
    INSERT INTO coverage_chunks VALUES ('mission-1', '1', 'unassigned', '', 1, 1, 2, 'digest', '2026-08-24T08:00:00.000Z', '2026-08-24T09:00:00.000Z', '2026-08-24T09:00:00.000Z');
    UPDATE coverage_missions SET enumerated = 1;
  `)
  const readManifest = () => readCoverageManifestSnapshot(database, { missionId: 'mission-1' }) as CoverageManifest
  const missionStore = {
    readCoverageManifest: vi.fn(async () => readManifest()),
    readCoverageClaim: vi.fn(async (query: { missionId: string; selectedKeys: readonly CoverageChunkKey[] }) => readCoverageClaimSnapshot(database, query) as CoverageClaim),
    syncCoverageTileCatalog: vi.fn(async () => ({
      activationId: 'audit-stage', periods: [{ periodKey: 'unassigned\u0000', revisionDigest: 'revision-1' }],
      delivered: readManifest().chunks.map(({ key, contentRev }) => ({ key, contentRev })),
    })),
    activateCoverageTileCatalog: vi.fn(async () => true),
    finalizeCoverageTileCatalog: vi.fn(async () => true),
    discardCoverageTileCatalog: vi.fn(async () => true),
    cancelCoverageQuery: vi.fn(async () => true),
  }
  useMissionStore.setState({ phase: 'active', currentMission: {
    id: 'mission-1', name: 'Audit', status: 'active', start_time: '2026-08-24T08:00:00.000Z',
    pause_time: null, finish_time: null, paused_seconds: 0, notes: null, schema_version: 10,
  } })
  const stopCoverage = startCoverageRuntime(missionStore, {
    enabled: true, rendererGeneration: 'audit-r1',
    subscribeCoverageChanged: () => () => undefined,
    schedulePeriodicRefresh: () => () => undefined,
  })
  cleanups.push(stopCoverage)
  await vi.waitFor(() => {
    const state = useCoverageStore.getState().state
    expect(state.status !== 'inactive' && state.tileCatalog !== null).toBe(true)
  })
  const delivery = useCoverageStore.getState()
  if (delivery.state.status !== 'inactive' && delivery.state.tileCatalog !== null) {
    await delivery.controller?.notifyCatalogApplied(delivery.state.tileCatalog)
  }
  await vi.waitFor(() => expect(useCoverageStore.getState().state).toMatchObject({
    status: 'complete', deliveredFixCount: 2, totalFixCount: 2,
  }))

  let pollingMode: 'active' | 'paused' | 'idle' = 'active'
  const getBreadcrumbs = vi.fn(async () => { throw new Error('Provider history unavailable') })
  const poller = createPollingManager({
    authenticate: vi.fn(async () => undefined),
    getDevices: vi.fn(async () => [{ device_id: '1', name: 'Alpha', status: 'online' as const,
      last_seen: null, unique_id: null, category: null, group_id: null }]),
    getCurrentPositions: vi.fn(async () => [{ id: '100', device_id: '1', lat: 52.001, lon: -9.701,
      timestamp: '2026-08-24T09:00:00.000Z', timestamp_source: 'fix' as const, fix_time_unverified: false,
      altitude: null, speed: null, battery: null, accuracy: 4, source: 'traccar', data_origin: 'live' as const,
      cache_age_seconds: null, device_cache_stale: false }]),
    getBreadcrumbs,
  }, {
    intervalMs: 5000, staleThresholdMs: 60000,
    getHistoryResetKey: () => 'mission-1',
    getPollingMode: () => pollingMode,
    getInitialBreadcrumbFrom: () => new Date('2026-08-24T08:00:00.000Z'),
    persistHistoryRequest: async (request) => {
      database.prepare('UPDATE tracking_history_checkpoints SET requested_until = MAX(requested_until, ?) WHERE mission_id = ? AND device_id = ?')
        .run(request.requestedUntil, request.expectedMissionId, request.deviceId)
    },
    getInitialHistoryCheckpoints: async () => {
      const checkpoint = database.prepare('SELECT history_from, reconciled_until FROM tracking_history_checkpoints WHERE mission_id = ? AND device_id = ?').get('mission-1', '1')
      return { '1': { historyFrom: checkpoint.history_from, reconciledUntil: checkpoint.reconciled_until } }
    },
    getParticipantDeviceIds: () => ['1'],
    onSnapshot: (snapshot) => useTrackingStore.getState().applySnapshot(snapshot),
    onStatusChange: applyTrackingStatus,
    now: () => new Date('2026-08-24T10:00:00.000Z'),
  })
  cleanups.push(() => poller.stop())
  poller.start()
  await vi.waitFor(() => expect(useTrackingStore.getState().status.warning).toContain('history incomplete'))
  await useCoverageStore.getState().controller?.refresh()
  const coverage = useCoverageStore.getState().state
  const html = renderToStaticMarkup(createElement(CoverageStatusPanel, {
    state: coverage, omittedDeviceCount: 0, omittedOutingCount: 0, unassignedOmitted: false,
    onRetry: () => undefined, onInspectExactFixes: () => undefined,
  }))
  expect(coverage).toMatchObject({ status: 'partial', deliveredFixCount: 2, totalFixCount: 2 })
  expect(html).not.toContain('All mission history shown')
  expect(html).toContain('Saved history has not been reconciled through the mission window')
  expect(useTrackingStore.getState().snapshot.positions).toHaveLength(1)

  applyTrackingStatus({ ...useTrackingStore.getState().status, warning: 'CONNECTION RESTORED' })
  await useCoverageStore.getState().controller?.refresh()
  expect(useCoverageStore.getState().state).toMatchObject({ status: 'partial', blockers: ['history_reconciliation_incomplete'] })
  for (const mode of ['paused', 'idle'] as const) {
    pollingMode = mode
    poller.requestPollNow()
    await vi.waitFor(() => expect(useTrackingStore.getState().status.warning).toBe(mode === 'paused'
      ? 'Live refresh suspended while mission is paused.' : 'Waiting for an active mission.'))
    await useCoverageStore.getState().controller?.refresh()
    expect(useCoverageStore.getState().state).toMatchObject({ status: 'partial', blockers: ['history_reconciliation_incomplete'] })
  }
  database.exec(`UPDATE mission_participants SET removed_at='2026-08-24T10:00:00.000Z'`)
  await poller.stop()
  stopCoverage()
  const stopReopened = startCoverageRuntime(missionStore, { enabled: true, rendererGeneration: 'reopened',
    subscribeCoverageChanged: () => () => undefined, schedulePeriodicRefresh: () => () => undefined })
  cleanups.push(stopReopened)
  await vi.waitFor(() => {
    const state = useCoverageStore.getState().state
    expect(state.status !== 'inactive' && state.tileCatalog !== null).toBe(true)
  })
  const reopened = useCoverageStore.getState()
  if (reopened.state.status !== 'inactive' && reopened.state.tileCatalog) await reopened.controller?.notifyCatalogApplied(reopened.state.tileCatalog)
  await vi.waitFor(() => expect(useCoverageStore.getState().state).toMatchObject({ status: 'partial', blockers: ['history_reconciliation_incomplete'] }))
  database.exec(`UPDATE tracking_history_checkpoints SET reconciled_until='2026-08-24T10:00:00.000Z'`)
  await useCoverageStore.getState().controller?.refresh()
  expect(useCoverageStore.getState().state).toMatchObject({ status: 'complete', blockers: [], deliveredFixCount: 2, totalFixCount: 2 })
}, 10000)
