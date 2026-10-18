import { mkdtemp, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createRuntimeLog } = require('../../electron/runtime-log.cjs') as {
  readonly createRuntimeLog: (options: { readonly userDataPath: string; readonly now?: () => string }) => RuntimeLog
}
const { createStorageDiagnostics } = require('../../electron/storage-diagnostics.cjs') as {
  readonly createStorageDiagnostics: (options: {
    readonly userDataPath: string
    readonly runtimeLog: RuntimeLog
    readonly now: () => string
    readonly monotonicNow: () => number
  }) => StorageDiagnostics
}

type RuntimeEntry = { readonly ts: string; readonly level: string; readonly event: string }
type RuntimeLog = {
  readonly append: (input: { level: string; event: string; fields?: Record<string, unknown> }) => Promise<void>
  readonly appendDurable: (input: { level: string; event: string; fields?: Record<string, unknown> }) => Promise<void>
  readonly readSupportEntries: (options?: {
    readonly recentLimit?: number
    readonly warningLimit?: number
  }) => Promise<readonly RuntimeEntry[]>
  readonly logFilePath: string
}
type StorageDiagnostics = {
  readonly recordTrackingBatch: (input: {
    durationMs: number; deviceCount: number; changedDeviceEventCount: number; observedAt: string
  }) => Promise<void>
  readonly recordInsertedPositions: (input: {
    durationMs: number; insertedPositionCount: number; positionTelemetryEventCount: number
  }) => Promise<void>
  readonly recordSlowWrite: (input: { totalMs: number; bodyMs: number; commitMs: number }) => Promise<void>
  readonly flushTrackingSummary: () => Promise<void>
}

const MINUTE_MS = 60_000
const START_MS = Date.UTC(2026, 9, 18, 9, 0, 0)

let userDataPath: string | null = null

afterEach(async () => {
  if (userDataPath !== null) await rm(userDataPath, { recursive: true, force: true })
  userDataPath = null
})

/**
 * The 18 Oct normal-profile soak wrote ~270 tracking entries a second, which rotated
 * the 1 MB runtime log in ~20 s and dropped a 2.4 s freeze warning from the support
 * bundle within the same launch [DON-336]. This drives the production log and
 * diagnostics with two hours of tracking, including a minute at soak rate, and
 * requires the first warning to still reach the support bundle.
 */
it('keeps a warning from two hours earlier in the support bundle under tracking load [DON-336]', async () => {
  userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-log-retention-'))
  let clockMs = START_MS
  const now = () => new Date(clockMs).toISOString()
  const runtimeLog = createRuntimeLog({ userDataPath, now })
  const diagnostics = createStorageDiagnostics({ userDataPath, runtimeLog, now, monotonicNow: () => clockMs })

  await diagnostics.recordSlowWrite({ totalMs: 2_400, bodyMs: 40, commitMs: 2_360 })

  for (let minute = 0; minute < 120; minute += 1) {
    // Burst at soak rate in one minute; otherwise a 32-device team polled every 10 s.
    const writesThisMinute = minute === 60 ? 16_000 : 12
    for (let write = 0; write < writesThisMinute; write += 1) {
      clockMs = START_MS + minute * MINUTE_MS + Math.floor((write * MINUTE_MS) / writesThisMinute)
      if (write % 2 === 0) {
        await diagnostics.recordTrackingBatch({
          durationMs: 18, deviceCount: 32, changedDeviceEventCount: 32, observedAt: now(),
        })
      }
      await diagnostics.recordInsertedPositions({
        durationMs: 4, insertedPositionCount: 32, positionTelemetryEventCount: 0,
      })
    }
    if (minute % 5 === 0) {
      // A backup cycle logs ~9 info entries every few minutes.
      for (let entry = 0; entry < 9; entry += 1) {
        await runtimeLog.append({ level: 'info', event: 'storage_backup_phase', fields: {
          operationId: '00000000-0000-4000-8000-000000000000', stage: 'copied', durationMs: 120,
          databaseBytes: 250_000_000, walBytes: 4_000_000,
        } })
      }
    }
  }
  clockMs = START_MS + 120 * MINUTE_MS
  await diagnostics.flushTrackingSummary()

  const entries = await runtimeLog.readSupportEntries({ recentLimit: 1000, warningLimit: 500 })
  expect(entries[0]).toMatchObject({ level: 'warn', event: 'storage_slow_write', ts: new Date(START_MS).toISOString() })
  expect(entries.filter((entry) => entry.event === 'storage_tracking_summary').length).toBeGreaterThanOrEqual(119)
  // Two hours of load stays far inside one 1 MB file, so nothing was rotated away.
  expect((await stat(runtimeLog.logFilePath)).size).toBeLessThan(200_000)
}, 120_000)
