import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createStorageDiagnostics, formatStorageDiagnostics } = require(
  '../../electron/storage-diagnostics.cjs',
) as {
  readonly createStorageDiagnostics: (options: StorageDiagnosticsOptions) => StorageDiagnostics
  readonly formatStorageDiagnostics: (snapshot: StorageDiagnosticsSnapshot) => string
}

type RuntimeEntry = {
  readonly level: string
  readonly event: string
  readonly fields?: Record<string, unknown>
}

type StorageOperation = {
  readonly id: string
  readonly type: 'backup'
  readonly requestedAtMs: number
}

type StorageDiagnosticsSnapshot = {
  readonly version: number
  readonly schemaVersion: number | null
  readonly validation: null | {
    readonly preset: string
    readonly generatorVersion: number
    readonly fixtureSha256: string
  }
  readonly activeOperation: null | {
    readonly type: string
    readonly stage: string
  }
  readonly previousInterruptedOperation: null | {
    readonly type: string
    readonly stage: string
  }
  readonly lastCompletedOperation: null | {
    readonly type: string
    readonly totalDurationMs: number
  }
  readonly fileSizes: Record<string, number>
  readonly mission: {
    readonly configuredPollIntervalMs: number | null
    readonly observedPollCount: number
    readonly currentDeviceCount: number
    readonly peakDeviceCount: number
    readonly insertedPositionCount: number
    readonly changedDeviceEventCount: number
    readonly restartCount: number
  }
}

type StorageDiagnosticsOptions = {
  readonly userDataPath: string
  readonly runtimeLog: {
    readonly appendDurable: (entry: RuntimeEntry) => Promise<void>
  }
  readonly now?: () => string
  readonly monotonicNow?: () => number
  readonly createId?: () => string
}

type StorageDiagnostics = {
  readonly initialize: () => Promise<void>
  readonly configureStore: (input: { readonly schemaVersion: number }) => Promise<void>
  readonly createOperation: (type: 'backup') => StorageOperation
  readonly requested: (
    operation: StorageOperation,
    input: { readonly queueDepth: number; readonly trigger?: string },
  ) => Promise<void>
  readonly started: (operation: StorageOperation) => Promise<void>
  readonly phase: (
    operation: StorageOperation,
    stage: 'copied' | 'validation_started' | 'validated' | 'renamed',
  ) => Promise<void>
  readonly completed: (operation: StorageOperation) => Promise<void>
  readonly failed: (
    operation: StorageOperation,
    input: { readonly stage: string; readonly errorName: string },
  ) => Promise<void>
  readonly startMission: (input: {
    readonly startedAt: string
  }) => Promise<void>
  readonly configurePolling: (input: { readonly configuredPollIntervalMs: number }) => Promise<void>
  readonly recordRestart: () => Promise<void>
  readonly recordTrackingBatch: (input: {
    readonly durationMs: number
    readonly deviceCount: number
    readonly changedDeviceEventCount: number
    readonly observedAt: string
  }) => Promise<void>
  readonly recordInsertedPositions: (input: {
    readonly durationMs: number
    readonly insertedPositionCount: number
    readonly positionTelemetryEventCount: number
  }) => Promise<void>
  readonly readSupportSnapshot: () => Promise<StorageDiagnosticsSnapshot>
}

describe('Electron storage diagnostics [DON-244]', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('flushes a bounded backup lifecycle before blocking phases and records numeric timings', async () => {
    const harness = await createHarness()
    await harness.diagnostics.initialize()
    const operation = harness.diagnostics.createOperation('backup')

    await harness.diagnostics.requested(operation, { queueDepth: 1, trigger: 'interval' })
    harness.advance(25)
    await harness.diagnostics.started(operation)
    harness.advance(2_500)
    await harness.diagnostics.phase(operation, 'copied')
    harness.advance(10)
    await harness.diagnostics.phase(operation, 'validation_started')
    harness.advance(6_250)
    await harness.diagnostics.phase(operation, 'validated')
    harness.advance(5)
    await harness.diagnostics.phase(operation, 'renamed')
    harness.advance(5)
    await harness.diagnostics.completed(operation)

    expect(harness.entries.map((entry) => entry.event)).toEqual([
      'storage_backup_requested',
      'storage_backup_started',
      'storage_backup_copied',
      'storage_backup_validation_started',
      'storage_backup_validated',
      'storage_backup_renamed',
      'storage_backup_completed',
    ])
    expect(harness.entries[0]?.fields).toMatchObject({ trigger: 'interval' })
    expect(harness.entries[1]?.fields).toMatchObject({ queueWaitMs: 25 })
    expect(harness.entries[4]?.fields).toMatchObject({ phaseDurationMs: 6_250 })

    const snapshot = await harness.diagnostics.readSupportSnapshot()
    expect(snapshot.activeOperation).toBeNull()
    expect(snapshot.lastCompletedOperation).toMatchObject({
      type: 'backup',
      totalDurationMs: 8_795,
    })
    expect((await stat(path.join(userDataPath!, 'storage-diagnostics.json'))).size).toBeLessThan(16_384)
  })

  it('survives forced termination and reports the previous incomplete phase after restart', async () => {
    const first = await createHarness()
    await first.diagnostics.initialize()
    const operation = first.diagnostics.createOperation('backup')
    await first.diagnostics.started(operation)
    first.advance(100)
    await first.diagnostics.phase(operation, 'validation_started')

    const secondEntries: RuntimeEntry[] = []
    const second = createStorageDiagnostics({
      userDataPath: userDataPath!,
      runtimeLog: {
        appendDurable: async (entry) => {
          secondEntries.push(entry)
        },
      },
      now: () => '2026-07-10T13:00:00.000Z',
      monotonicNow: () => 0,
      createId: () => 'next-operation',
    })
    await second.initialize()

    const snapshot = await second.readSupportSnapshot()
    expect(snapshot.activeOperation).toBeNull()
    expect(snapshot.previousInterruptedOperation).toMatchObject({
      type: 'backup',
      stage: 'validation_started',
    })
    expect(secondEntries).toContainEqual(
      expect.objectContaining({ event: 'storage_previous_run_interrupted' }),
    )
  })

  it('keeps only sanitized counts, timings, and known file-size labels in support output', async () => {
    const harness = await createHarness()
    await writeFile(path.join(userDataPath!, 'mission-store.sqlite'), 'database')
    await writeFile(path.join(userDataPath!, 'mission-store.sqlite-wal'), 'wal')
    await writeFile(path.join(userDataPath!, 'mission-store.backup.sqlite'), 'backup')
    await harness.diagnostics.configurePolling({
      configuredPollIntervalMs: 30_000,
    })
    await harness.diagnostics.configureStore({ schemaVersion: 4 })
    await harness.diagnostics.startMission({ startedAt: '2026-07-09T10:00:00.000Z' })
    await harness.diagnostics.recordRestart()
    await harness.diagnostics.recordTrackingBatch({
      durationMs: 18,
      deviceCount: 32,
      changedDeviceEventCount: 7,
      observedAt: '2026-07-10T12:00:00.000Z',
    })
    await harness.diagnostics.recordTrackingBatch({
      durationMs: 22,
      deviceCount: 30,
      changedDeviceEventCount: 2,
      observedAt: '2026-07-10T12:00:30.000Z',
    })
    await harness.diagnostics.recordInsertedPositions({
      durationMs: 12,
      insertedPositionCount: 5,
      positionTelemetryEventCount: 5,
    })

    const snapshot = await harness.diagnostics.readSupportSnapshot()
    expect(snapshot.mission).toMatchObject({
      configuredPollIntervalMs: 30_000,
      observedPollCount: 2,
      currentDeviceCount: 30,
      peakDeviceCount: 32,
      insertedPositionCount: 5,
      changedDeviceEventCount: 9,
      restartCount: 1,
      positionTelemetryEventCount: 5,
    })
    expect(snapshot.fileSizes).toMatchObject({ databaseBytes: 8, walBytes: 3, backupBytes: 6 })
    expect(snapshot.schemaVersion).toBe(4)

    const output = formatStorageDiagnostics(snapshot)
    expect(output).toContain('[storage-diagnostics]')
    expect(output).toContain('schema version: 4')
    expect(output).toContain('inserted positions: 5')
    expect(output).toContain('position telemetry events: 5')
    expect(output).toContain('observed polling cadence ms: 30000')
    expect(output).not.toMatch(
      /mission-store|\/home|device[_ -]?id|latitude|longitude|coordinates?|provider/iu,
    )
  })

  it('records failures without persisting arbitrary error text or operational identity', async () => {
    const harness = await createHarness()
    const operation = harness.diagnostics.createOperation('backup')
    await harness.diagnostics.started(operation)
    await harness.diagnostics.failed(operation, {
      stage: 'validation_started',
      errorName: 'SqliteError',
    })

    const state = await readFile(path.join(userDataPath!, 'storage-diagnostics.json'), 'utf8')
    expect(state).toContain('SqliteError')
    expect(state).not.toContain('/home/operator')
    expect(state).not.toContain('mission-123')
    expect(harness.entries.at(-1)).toMatchObject({
      level: 'error',
      event: 'storage_backup_failed',
    })
  })

  it('uses the first restart of an existing mission as the earliest available growth checkpoint', async () => {
    const harness = await createHarness()
    const databasePath = path.join(userDataPath!, 'mission-store.sqlite')
    await writeFile(databasePath, '12345678')

    await harness.diagnostics.recordRestart({ startedAt: '2026-07-09T10:00:00.000Z' })
    await writeFile(databasePath, '1234567890')

    const snapshot = await harness.diagnostics.readSupportSnapshot()
    expect(snapshot.mission).toMatchObject({
      restartCount: 1,
      databaseGrowthBytes: 2,
    })
  })

  it('includes allow-listed fixture metadata only when explicit validation mode is enabled', async () => {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-storage-validation-'))
    await writeFile(
      path.join(userDataPath, 'mission-store.sqlite.manifest.json'),
      JSON.stringify({
        generatorVersion: 2,
        preset: 'field',
        syntheticDataOnly: true,
        database: { sha256: 'a'.repeat(64), privatePath: '/home/operator/private.sqlite' },
        secret: 'must-not-appear',
      }),
    )
    const diagnostics = createStorageDiagnostics({
      userDataPath,
      validationMode: true,
      runtimeLog: { appendDurable: async () => undefined },
    } as StorageDiagnosticsOptions & { readonly validationMode: true })

    const snapshot = await diagnostics.readSupportSnapshot()
    expect(snapshot.validation).toEqual({
      preset: 'field',
      generatorVersion: 2,
      fixtureSha256: 'a'.repeat(64),
    })
    expect(JSON.stringify(snapshot)).not.toContain('privatePath')
    expect(JSON.stringify(snapshot)).not.toContain('must-not-appear')
    expect(formatStorageDiagnostics(snapshot)).toContain('validation fixture preset: field')
  })

  it('distinguishes unavailable measurements from a real numeric zero in support output', () => {
    const output = formatStorageDiagnostics({} as StorageDiagnosticsSnapshot)
    expect(output).toContain('schema version: unknown')
    expect(output).toContain('configured polling cadence ms: not configured')
    expect(output).toContain('observed polling cadence ms: not observed')
    expect(output).toContain('event loop latest maximum delay ms: not observed')
  })

  async function createHarness() {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-storage-diagnostics-'))
    const entries: RuntimeEntry[] = []
    let monotonicMs = 1_000
    let id = 0
    const diagnostics = createStorageDiagnostics({
      userDataPath,
      runtimeLog: {
        appendDurable: vi.fn(async (entry: RuntimeEntry) => {
          entries.push(entry)
        }),
      },
      now: () => new Date(Date.UTC(2026, 6, 10, 12, 0, 0, monotonicMs)).toISOString(),
      monotonicNow: () => monotonicMs,
      createId: () => `operation-${(id += 1)}`,
    })
    return {
      diagnostics,
      entries,
      advance: (milliseconds: number) => {
        monotonicMs += milliseconds
      },
    }
  }
})
