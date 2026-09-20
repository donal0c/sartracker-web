import { describe, expect, it } from 'vitest'

import {
  BACKUP_FAULT_VARIANTS,
  buildStorageKillProbeOracleInput,
  buildStorageKillProbeVerdict,
  buildStorageBackupFaultOracleInput,
  buildStorageBackupFaultVerdict,
  parseStorageKillProbeArgs,
} from '../../build/electron-storage-diagnostics-kill-probe-lib.js'

describe('packaged storage diagnostics kill probe [DON-244]', () => {
  it('publishes the fixed C18 backup fault variant inventory', () => {
    expect(BACKUP_FAULT_VARIANTS).toEqual([
      'disk-full',
      'permission',
      'corrupt-temp',
      'busy-wal',
      'concurrent-writes',
      'worker-crash',
      'stale-good-mirror',
    ])
  })

  it('accepts only a fixed backup variant when explicitly requested', () => {
    expect(parseStorageKillProbeArgs([
      '--app', '/opt/sartracker.AppImage', '--fixture', '/fixtures/s.sqlite',
      '--variant', 'worker-crash',
    ]).variant).toBe('worker-crash')
    expect(() => parseStorageKillProbeArgs([
      '--app', '/a', '--fixture', '/f', '--variant', 'invented-pass',
    ])).toThrow(/unknown.*variant/iu)
    expect(parseStorageKillProbeArgs([
      '--app', '/a', '--fixture', '/f', '--variant', 'disk-full',
      '--enospc-mount', '/mnt/c18-quota',
    ]).enospcMount).toBe('/mnt/c18-quota')
  })

  it('independently accepts a concrete permission failure only with mirror custody facts', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'permission',
      outcome: 'failed',
      error: { name: 'Error', code: 'EACCES' },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      temporaryFilesAfter: [],
      permission: {
        attempted: true, observed: true, restored: true,
        denial: {
          independentWriteAttempted: true,
          observedCode: 'EACCES',
          target: 'store-directory',
          modeBefore: 0o700,
          modeDenied: 0o500,
          modeRestored: 0o700,
        },
      },
    })
    expect(buildStorageBackupFaultVerdict(raw)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('rejects permission claims without the independent same-directory denial', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'permission', outcome: 'failed',
      error: { name: 'SqliteError', code: null, message: 'unable to open database file' },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      temporaryFilesAfter: [],
      permission: { attempted: true, observed: true, restored: true },
    })
    const verdict = buildStorageBackupFaultVerdict(raw)
    expect(verdict.passed).toBe(false)
    expect(verdict.failures.join(' ')).toMatch(/independent|denial|permission/iu)
  })

  it('accepts SQLite cannot-open only when the independent denial is observed', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'permission', outcome: 'failed',
      error: { name: 'SqliteError', code: null, message: 'SQLite backup worker failed: unable to open database file' },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 4096, integrity: 'ok' },
      temporaryFilesAfter: [],
      permission: {
        attempted: true, observed: true, restored: true,
        denial: {
          independentWriteAttempted: true,
          observedCode: 'EACCES',
          target: 'store-directory',
          modeBefore: 0o700,
          modeDenied: 0o500,
          modeRestored: 0o700,
        },
      },
    })
    expect(buildStorageBackupFaultVerdict(raw)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('rejects a forged green fault result and reports unavailable disk-full honestly', () => {
    const forged = buildStorageBackupFaultOracleInput({
      variant: 'worker-crash', outcome: 'completed',
      worker: { attempted: true, crashed: false },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 1, integrity: 'ok' },
      mirrorAfter: { sha256: 'b'.repeat(64), bytes: 1, integrity: 'ok' },
      temporaryFilesAfter: [],
    })
    expect(buildStorageBackupFaultVerdict({ ...forged, verdict: { passed: true } }).passed).toBe(false)

    const unavailable = buildStorageBackupFaultOracleInput({
      variant: 'disk-full', outcome: 'unavailable',
      precondition: { kind: 'bounded-enospc', observed: false, reason: 'No bounded quota supplied.' },
    })
    expect(buildStorageBackupFaultVerdict(unavailable)).toMatchObject({
      passed: false, status: 'UNAVAILABLE', unavailable: true,
    })

    const concrete = buildStorageBackupFaultOracleInput({
      variant: 'disk-full', outcome: 'failed',
      precondition: {
        kind: 'bounded-enospc', status: 'READY', observed: true,
        deviceDistinct: true, totalBytes: 64 * 1024 * 1024,
        availableBytes: 8 * 1024 * 1024, reason: 'bounded test volume',
      },
      diskFull: { fillerAttempted: true, observedEnospc: true, backupErrorObserved: true },
      error: { name: 'Error', code: 'ENOSPC' },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 1, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 1, integrity: 'ok' },
      temporaryFilesAfter: [],
    })
    expect(buildStorageBackupFaultVerdict(concrete)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('requires stale-good-mirror evidence to show source change and unchanged valid mirror', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'stale-good-mirror', outcome: 'failed',
      error: { name: 'Error', code: 'INJECTED_BACKUP_INTERRUPTION' },
      sourceBefore: { sha256: 'a'.repeat(64), bytes: 10 },
      sourceAfter: { sha256: 'b'.repeat(64), bytes: 11 },
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      temporaryFilesAfter: [],
      staleMirror: true,
    })
    expect(buildStorageBackupFaultVerdict(raw)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('requires the production temporary-snapshot sanity rejection facts', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'corrupt-temp', outcome: 'failed',
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      temporaryFilesAfter: [],
      snapshot: { temporaryCorrupted: true, sanityRejected: true },
    })
    expect(buildStorageBackupFaultVerdict(raw)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('requires held-WAL release and two serialized concurrent backup completions', () => {
    const mirror = { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' }
    expect(buildStorageBackupFaultVerdict(buildStorageBackupFaultOracleInput({
      variant: 'busy-wal', outcome: 'completed', mirrorBefore: mirror, mirrorAfter: mirror,
      temporaryFilesAfter: [], busyWal: { writeTransactionHeld: true, backupCompleted: true, released: true },
    }))).toMatchObject({ passed: true, status: 'PASS' })
    expect(buildStorageBackupFaultVerdict(buildStorageBackupFaultOracleInput({
      variant: 'concurrent-writes', outcome: 'completed',
      sourceBefore: { sha256: 'a'.repeat(64), bytes: 10 },
      sourceAfter: { sha256: 'b'.repeat(64), bytes: 11 },
      mirrorBefore: mirror, mirrorAfter: { sha256: 'b'.repeat(64), bytes: 11, integrity: 'ok' },
      temporaryFilesAfter: [], concurrentWrites: {
        attemptedCount: 2,
        completedCount: 2,
        serialized: true,
        mutationKind: 'add-mission-participant',
        acceptedMutationCount: 2,
        durableRowCount: 2,
        auditEventCount: 2,
        postMutationBackupCompleted: true,
        retryCompleted: true,
      },
    }))).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('rejects two concurrent backups that contain no accepted domain mutation facts', () => {
    const mirror = { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' }
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'concurrent-writes', outcome: 'completed',
      sourceBefore: { sha256: 'a'.repeat(64), bytes: 10 },
      sourceAfter: { sha256: 'b'.repeat(64), bytes: 11 },
      mirrorBefore: mirror, mirrorAfter: { sha256: 'b'.repeat(64), bytes: 11, integrity: 'ok' },
      temporaryFilesAfter: [],
      concurrentWrites: { attemptedCount: 2, completedCount: 2, serialized: true },
    })
    const verdict = buildStorageBackupFaultVerdict(raw)
    expect(verdict.passed).toBe(false)
    expect(verdict.failures.join(' ')).toMatch(/mutation|domain|participant/iu)
  })

  it('requires a real crashed worker and absent target for worker-crash', () => {
    const raw = buildStorageBackupFaultOracleInput({
      variant: 'worker-crash', outcome: 'failed',
      mirrorBefore: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      mirrorAfter: { sha256: 'a'.repeat(64), bytes: 10, integrity: 'ok' },
      temporaryFilesAfter: [], worker: { attempted: true, crashed: true, targetAbsent: true },
    })
    expect(buildStorageBackupFaultVerdict(raw)).toMatchObject({ passed: true, status: 'PASS' })
  })

  it('parses the packaged app, fixture, evidence, timeout, and Electron arguments', () => {
    expect(
      parseStorageKillProbeArgs([
        '--app',
        '/opt/sartracker.AppImage',
        '--fixture',
        '/fixtures/field.sqlite',
        '--evidence',
        '/evidence/kill-probe',
        '--timeout-ms',
        '180000',
        '--',
        '--no-sandbox',
        '--ozone-platform=x11',
      ]),
    ).toEqual({
      appPath: '/opt/sartracker.AppImage',
      fixturePath: '/fixtures/field.sqlite',
      evidenceDir: '/evidence/kill-probe',
      timeoutMs: 180_000,
      postRestartObservationMs: 35_000,
      extraArgs: ['--no-sandbox', '--ozone-platform=x11'],
    })
  })

  it('fails closed for missing inputs and invalid timeout values', () => {
    expect(() => parseStorageKillProbeArgs(['--fixture', '/f'])).toThrow('--app')
    expect(() => parseStorageKillProbeArgs(['--app', '/a'])).toThrow('--fixture')
    expect(() =>
      parseStorageKillProbeArgs(['--app', '/a', '--fixture', '/f', '--timeout-ms', '0']),
    ).toThrow('--timeout-ms')
  })

  it('passes only when the flushed operation-start marker survives restart and bundle export', () => {
    const verdict = buildStorageKillProbeVerdict({
      beforeKill: {
        activeOperation: { type: 'backup', stage: 'started' },
      },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { type: 'backup', stage: 'started' },
      },
      runtimeLog: [
        '{"event":"storage_backup_started"}',
        '{"event":"storage_previous_run_interrupted"}',
        '{"event":"storage_main_event_loop_summary"}',
      ].join('\n'),
      supportBundle: [
        '[storage-diagnostics]',
        'previous interrupted operation: backup started',
        'validation fixture preset: field',
        'event loop latest maximum delay ms: 5120',
      ].join('\n'),
      forbiddenValues: ['Private Mission Name', '/home/operator/private.sqlite'],
    })

    expect(verdict).toEqual({ passed: true, failures: [] })
  })

  it('builds bounded redacted oracle inputs with exact markers and numeric metrics', () => {
    const oracleInput = buildStorageKillProbeOracleInput({
      beforeKill: { activeOperation: { id: 'private-operation-id', type: 'backup', stage: 'started', startedAt: 'private-time' } },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { id: 'private-operation-id', type: 'backup', stage: 'started', startedAt: 'private-time' },
      },
      runtimeLog: [
        '{"event":"storage_backup_started","fields":{"operationId":"private-operation-id"}}',
        '{"event":"storage_previous_run_interrupted","fields":{"mission":"private"}}',
        '{"event":"storage_main_event_loop_summary","fields":{"maximumDelayMs":5120}}',
      ].join('\n'),
      supportBundle: [
        '[storage-diagnostics]',
        'previous interrupted operation: backup started',
        'event loop latest maximum delay ms: 5120',
        'private mission name must not be copied',
      ].join('\n'),
      forbiddenValues: ['Private Mission Name', '/home/operator/private.sqlite'],
    })

    expect(oracleInput).toMatchObject({
      schemaVersion: 1,
      redaction: 'bounded-marker-and-metric-extract-v1',
      beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { type: 'backup', stage: 'started' },
      },
      runtimeLog: {
        markers: [
          'storage_backup_started',
          'storage_previous_run_interrupted',
          'storage_main_event_loop_summary',
        ],
        evidence: expect.stringContaining('storage_backup_started'),
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      supportBundle: {
        requiredLines: [
          '[storage-diagnostics]',
          'previous interrupted operation: backup started',
          'event loop latest maximum delay ms: 5120',
        ],
        eventLoopLatestMaximumDelayMs: 5120,
        bytes: expect.any(Number),
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
      privacy: [
        {
          label: 'forbidden-value-1',
          valueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          matchCount: 0,
        },
        {
          label: 'forbidden-value-2',
          valueSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          matchCount: 0,
        },
      ],
    })
    expect(JSON.stringify(oracleInput)).not.toContain('private-operation-id')
    expect(JSON.stringify(oracleInput)).not.toContain('private mission name')
  })

  it('recomputes the existing oracle directly from the bounded structured input', () => {
    const oracleInput = buildStorageKillProbeOracleInput({
      beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { type: 'backup', stage: 'started' },
      },
      runtimeLog: 'storage_backup_started\nstorage_previous_run_interrupted\nstorage_main_event_loop_summary',
      supportBundle: '[storage-diagnostics]\nprevious interrupted operation: backup started\nevent loop latest maximum delay ms: 5120',
    })

    expect(buildStorageKillProbeVerdict(oracleInput)).toEqual({ passed: true, failures: [] })
  })

  it('rejects structured oracle input when a required marker or metric is absent', () => {
    const oracleInput = buildStorageKillProbeOracleInput({
      beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
      afterRestart: { activeOperation: null, previousInterruptedOperation: { type: 'backup', stage: 'started' } },
      runtimeLog: 'storage_backup_started',
      supportBundle: '[storage-diagnostics]\nprevious interrupted operation: backup started',
    })

    const verdict = buildStorageKillProbeVerdict(oracleInput)
    expect(verdict.passed).toBe(false)
    expect(verdict.failures.join(' ')).toMatch(/runtime log|event loop/iu)
  })

  it('treats a structured forbidden-value match count as a recomputable privacy failure', () => {
    const oracleInput = buildStorageKillProbeOracleInput({
      beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
      afterRestart: { activeOperation: null, previousInterruptedOperation: { type: 'backup', stage: 'started' } },
      runtimeLog: 'storage_backup_started\nstorage_previous_run_interrupted\nstorage_main_event_loop_summary',
      supportBundle: '[storage-diagnostics]\nprevious interrupted operation: backup started\nevent loop latest maximum delay ms: 5120',
      forbiddenValues: ['private-value'],
    })
    const leaked = {
      ...oracleInput,
      privacy: [{ ...oracleInput.privacy[0], matchCount: 1 }],
    }

    const verdict = buildStorageKillProbeVerdict(leaked)
    expect(verdict.passed).toBe(false)
    expect(verdict.failures.join(' ')).toMatch(/forbidden|privacy/iu)
  })

  it('reports missing lifecycle evidence and sensitive leakage as blocking failures', () => {
    const verdict = buildStorageKillProbeVerdict({
      beforeKill: { activeOperation: null },
      afterRestart: { previousInterruptedOperation: null },
      runtimeLog: '',
      supportBundle: 'Private Mission Name',
      forbiddenValues: ['Private Mission Name'],
    })

    expect(verdict.passed).toBe(false)
    expect(verdict.failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining('before kill'),
        expect.stringContaining('after restart'),
        expect.stringContaining('runtime log'),
        expect.stringContaining('support bundle'),
        expect.stringContaining('forbidden value'),
      ]),
    )
  })
})
