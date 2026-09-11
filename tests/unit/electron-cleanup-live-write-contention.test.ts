import { assertReleaseResponsiveness } from '../support/release-responsiveness'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
type RecordValue = Readonly<Record<string, unknown>>
type Store = {
  createMission: (input: RecordValue) => Promise<{ id: string }>
  finishMission: (missionId: string) => Promise<unknown>
  finalizeMission: (missionId: string, custody: RecordValue, context: RecordValue) => Promise<{ archive: { id: string } }>
  upsertDevicesBulk: (input: RecordValue) => Promise<unknown>
  upsertDevice: (input: RecordValue) => Promise<unknown>
  addPosition: (input: RecordValue) => Promise<unknown>
  addPositionsBulk: (input: RecordValue) => Promise<unknown>
  persistTrackingHistoryBatch: (input: RecordValue) => Promise<unknown>
  persistTrackingPositionsBulk: (input: RecordValue) => Promise<unknown>
  readCoverageManifest: (missionId: string, requestId: string) => Promise<{ chunks: readonly { key: RecordValue; contentRev: number }[] }>
  readCoverageChunk: (input: RecordValue, requestId: string) => Promise<unknown>
  syncCoverageTileCatalog: (input: RecordValue, requestId?: string) => Promise<unknown>
  cancelCoverageQuery: (requestId: string) => Promise<boolean>
  listIngestAnomalies: (missionId: string) => Promise<readonly unknown[]>
  startMissionCleanup: (input: RecordValue, context: RecordValue) => Promise<{ state: string }>
  prepareClose: () => Promise<void>
  close: () => void
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  createElectronMissionStore: (input: { userDataPath: string; startArchiveCleanupWorker: (input: RecordValue) => Promise<unknown> }) => Store
}
const { startArchiveCleanupWorker } = require('../../electron/archive-cleanup-runner.cjs') as {
  startArchiveCleanupWorker: (input: RecordValue & { createWorker: (input: { workerPath: string; workerData: RecordValue }) => Worker }) => Promise<unknown>
}
const Database = require('better-sqlite3') as new (file: string, options: RecordValue) => {
  prepare: (sql: string) => { get: (...values: readonly unknown[]) => RecordValue; all: (...values: readonly unknown[]) => readonly RecordValue[] }
  close: () => void
}

it.each(['devices', 'single-devices', 'positions', 'one-position', 'positions-bulk', 'history', 'conflict-position', 'coverage', 'coverage-manifest', 'coverage-page', 'coverage-stale', 'finished-devices', 'ordered-devices', 'cancel-coverage', 'shutdown-coverage'] as const)(
  'keeps live %s responsive and durable while the real cleanup worker owns the writer lock [DON-252]',
  async (kind) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'sartracker-cleanup-live-write-'))
    const gate = new Int32Array(new SharedArrayBuffer(8))
    let liveMissionId: string | undefined
    const store = createElectronMissionStore({
      userDataPath: directory,
      startArchiveCleanupWorker: (input) => startArchiveCleanupWorker({
        ...input,
        createWorker: ({ workerPath, workerData }) => new Worker(`
          const { workerData } = require('node:worker_threads')
          const Database = require('better-sqlite3')
          const original = Database.prototype.transaction
          const gate = new Int32Array(workerData.testGate)
          let immediate = false
          let held = false
          Database.prototype.transaction = function (callback) {
            const db = this
            const transaction = original.call(this, function (...args) {
              if (immediate && !held) {
                if (!db.inTransaction) throw new Error('Test requires an acquired transaction')
                held = true
                if (workerData.testVariant === 'coverage-stale') {
                  db.prepare('UPDATE coverage_chunks SET content_rev = content_rev + 1 WHERE mission_id = ?').run(workerData.testLiveMissionId)
                }
                if (workerData.testVariant === 'finished-devices') {
                  db.prepare("UPDATE missions SET status = 'finished' WHERE id = ?").run(workerData.testLiveMissionId)
                }
                Atomics.store(gate, 0, 1)
                // The worker owns release even if the main event loop blocks.
                Atomics.wait(gate, 1, 0, 700)
              }
              return Reflect.apply(callback, this, args)
            })
            const invoke = (...args) => transaction(...args)
            for (const mode of ['deferred', 'immediate', 'exclusive']) {
              invoke[mode] = (...args) => {
                immediate = mode === 'immediate'
                try { return transaction[mode](...args) }
                finally { immediate = false }
              }
            }
            return invoke
          }
          require(workerData.testWorkerPath)
        `, {
          eval: true,
          workerData: { ...workerData, testGate: gate.buffer, testWorkerPath: workerPath, testVariant: kind, testLiveMissionId: liveMissionId },
        }),
      }),
    })
    let cleanup: Promise<{ state: string }> | undefined
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let cancellationTimer: ReturnType<typeof setTimeout> | undefined
    let cancellation: Promise<unknown> | undefined
    try {
      const archived = await store.createMission({ name: 'Cleanup target' })
      await store.finishMission(archived.id)
      const custody = { passphrase: 'Four calm words 2026!', recoveryCode: '01234-56789-ABCDE-FGHJK-MNPQR-STVWX-YZ012-34567' }
      const finalized = await store.finalizeMission(archived.id, custody, {
        operationId: randomUUID(), onProgress: () => undefined,
      })
      const active = await store.createMission({ name: 'Live tracking mission' })
      liveMissionId = active.id
      const device = { device_id: 'tracker', name: 'Tracker', color: '#123456', status: 'online' }
      await store.upsertDevicesBulk({ mission_id: active.id, devices: [device] })
      const position = { device_id: device.device_id, lat: 52.1, lon: -9.2, timestamp: new Date().toISOString(), timestamp_source: 'fix' }
      await store.persistTrackingPositionsBulk({ mission_id: active.id, positions: [{ ...position, source_position_id: 'seed-fix' }] })
      if (kind === 'conflict-position') {
        await store.upsertDevice({ mission_id: active.id, ...device, device_id: 'conflicting-tracker', status: 'offline' })
      }
      const manifest = await store.readCoverageManifest(active.id, 'before-cleanup')
      const beforeInspection = new Database(path.join(directory, 'mission-store.sqlite'), { readonly: true })
      const buildEvidenceSql = 'SELECT built_rev, fix_digest, min_ts, max_ts FROM coverage_chunks WHERE mission_id = ? ORDER BY device_id, period_kind, period_id'
      const beforeBuildEvidence = beforeInspection.prepare(buildEvidenceSql).all(active.id)
      beforeInspection.close()
      cleanup = store.startMissionCleanup({
        missionId: archived.id, archiveId: finalized.archive.id,
        slotType: 'passphrase', secret: custody.passphrase,
      }, { operationId: randomUUID(), reviewActivity: false, onProgress: () => undefined })
      void cleanup.catch(() => undefined)
      const acquisitionDeadline = performance.now() + 10000
      while (Atomics.load(gate, 0) !== 1 && performance.now() < acquisitionDeadline) {
        await new Promise(resolve => setTimeout(resolve, 1))
      }
      expect(Atomics.load(gate, 0)).toBe(1)
      let previousBeat = performance.now()
      let maximumHeartbeatGapMs = 0
      heartbeat = setInterval(() => {
        const now = performance.now()
        maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, now - previousBeat)
        previousBeat = now
      }, 10)
      /** Starts the real public write/read API selected for this contention case. */
      function startContendedOperation(): Promise<unknown> {
        const positionBatch = { mission_id: active.id, positions: [{ ...position, source_position_id: 'new-fix' }] }
        switch (kind) {
          case 'single-devices':
            return store.upsertDevice({ mission_id: active.id, ...device, name: 'Updated tracker' })
          case 'devices':
          case 'finished-devices':
          case 'ordered-devices':
            return store.upsertDevicesBulk({ mission_id: active.id, devices: [{ ...device, name: 'Updated tracker' }] })
          case 'positions':
            return store.persistTrackingPositionsBulk(positionBatch)
          case 'one-position':
            return store.addPosition({ mission_id: active.id, ...position, source_position_id: 'new-fix' })
          case 'conflict-position':
            return store.addPosition({ mission_id: active.id, ...position, device_id: 'conflicting-tracker', lat: 53.1, source_position_id: 'seed-fix' })
          case 'positions-bulk':
            return store.addPositionsBulk(positionBatch)
          case 'history':
            return store.persistTrackingHistoryBatch({ ...positionBatch, checkpoints: [] })
          case 'coverage-manifest':
            return store.readCoverageManifest(active.id, 'during-cleanup')
          case 'coverage-page':
            return store.readCoverageChunk({ missionId: active.id, key: manifest.chunks[0]?.key, expectedContentRev: manifest.chunks[0]?.contentRev }, 'during-cleanup')
          default:
            return store.syncCoverageTileCatalog({ missionId: active.id, chunks: manifest.chunks.map(chunk => ({ key: chunk.key, contentRev: chunk.contentRev })) }, kind === 'shutdown-coverage' ? undefined : 'during-cleanup')
        }
      }
      const pending = startContendedOperation()
      const newer = kind === 'ordered-devices'
        ? store.upsertDevicesBulk({ mission_id: active.id, devices: [{ ...device, name: 'Newest tracker' }] })
        : undefined
      if (kind === 'cancel-coverage' || kind === 'shutdown-coverage') {
        cancellationTimer = setTimeout(() => {
          cancellation = kind === 'cancel-coverage'
            ? store.cancelCoverageQuery('during-cleanup') : store.prepareClose()
          void cancellation.catch(() => undefined)
        }, 50)
      }
      const outcome = await pending.then(() => ({ error: null }), (error: unknown) => ({ error }))
      maximumHeartbeatGapMs = Math.max(maximumHeartbeatGapMs, performance.now() - previousBeat)
      clearInterval(heartbeat)
      heartbeat = undefined
      if (kind === 'coverage-stale') expect(outcome.error).toMatchObject({ code: 'chunk-stale' })
      else if (kind === 'conflict-position') expect(outcome.error).toMatchObject({ message: expect.stringMatching(/owned by device tracker/) })
      else if (kind === 'finished-devices') expect(outcome.error).toMatchObject({ message: expect.stringMatching(/finished|writ|finaliz/i) })
      else if (kind === 'cancel-coverage' || kind === 'shutdown-coverage') {
        expect(outcome.error).toMatchObject({ name: 'AbortError' })
      } else expect(outcome.error).toBeNull()
      assertReleaseResponsiveness(() => expect(maximumHeartbeatGapMs).toBeLessThan(200))
      await newer
      await cancellation
      if (kind === 'shutdown-coverage') await cleanup.catch(() => undefined)
      else await expect(cleanup).resolves.toMatchObject({ state: 'completed' })
      const inspection = new Database(path.join(directory, 'mission-store.sqlite'), { readonly: true })
      try {
        if (kind.includes('devices')) {
          const expectedName = kind === 'finished-devices' ? 'Tracker' : kind === 'ordered-devices' ? 'Newest tracker' : 'Updated tracker'
          expect(inspection.prepare('SELECT name FROM devices WHERE mission_id = ? AND device_id = ?').get(active.id, device.device_id)).toMatchObject({ name: expectedName })
        } else if (['positions', 'one-position', 'positions-bulk', 'history'].includes(kind)) {
          expect(inspection.prepare('SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND source_position_id = ?').get(active.id, 'new-fix')).toMatchObject({ count: 1 })
        } else if (kind === 'conflict-position') {
          expect(inspection.prepare('SELECT device_id, lat FROM positions WHERE mission_id = ? AND source_position_id = ?').get(active.id, 'seed-fix')).toMatchObject({ device_id: 'tracker', lat: 52.1 })
          expect(inspection.prepare('SELECT status, last_seen FROM devices WHERE mission_id = ? AND device_id = ?').get(active.id, 'conflicting-tracker')).toMatchObject({ status: 'offline', last_seen: null })
          await expect(store.listIngestAnomalies(active.id)).resolves.toHaveLength(1)
        } else if (kind === 'coverage' || kind === 'coverage-page') {
          expect(inspection.prepare('SELECT COUNT(*) AS count FROM coverage_chunks WHERE mission_id = ? AND built_rev = content_rev').get(active.id).count).toBeGreaterThan(0)
        } else {
          expect(inspection.prepare(buildEvidenceSql).all(active.id)).toEqual(beforeBuildEvidence)
        }
      } finally { inspection.close() }
    } finally {
      clearInterval(heartbeat)
      clearTimeout(cancellationTimer)
      Atomics.store(gate, 1, 1)
      Atomics.notify(gate, 1)
      await cleanup?.catch(() => undefined)
      await cancellation?.catch(() => undefined)
      await store.prepareClose()
      store.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }, 30000,
)
