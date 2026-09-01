import { createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  assertFieldScaleFixture,
  deriveLivenessEvidence,
  parseTerminalCleanupJournal,
  readLegacyArchiveMaintenanceProgress,
  runWithHeartbeatMonitor,
  scanEvidenceRoots,
  stageClosedFixture,
  startCurrentPositionProbe,
  waitForMaintenanceSettlement,
  writeQualificationEvidence,
} from '../../scripts/breadcrumb-pr6-qualification.mjs'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })))
})

describe('Breadcrumb PR6 scale-qualification coordinator [DON-252 / BCP-15]', () => {
  it('pins, hashes and streams a closed regular fixture into a mode-0600 copy', async () => {
    const root = await createTemporaryRoot()
    const fixturePath = path.join(root, 'field.sqlite')
    const destinationPath = path.join(root, 'profile', 'mission-store.sqlite')
    const bytes = Buffer.alloc(128 * 1024 + 31, 0x5a)
    await writeFile(fixturePath, bytes, { mode: 0o600 })

    const staged = await stageClosedFixture({ fixturePath, destinationPath })

    const digest = createHash('sha256').update(bytes).digest('hex')
    expect(staged).toMatchObject({
      copiedBeforeOpen: true,
      sourceWasRegularFile: true,
      sourceWasSymlink: false,
      sourceWalBytes: 0,
      sourceShmBytes: 0,
      sourceSha256Before: digest,
      copiedSha256: digest,
      sourceBytes: bytes.byteLength,
      copiedBytes: bytes.byteLength,
    })
    expect(await readFile(destinationPath)).toEqual(bytes)
    expect((await lstat(destinationPath)).mode & 0o777).toBe(0o600)
  })

  it('fails closed for a symlink fixture or non-empty SQLite sidecar', async () => {
    const root = await createTemporaryRoot()
    const fixturePath = path.join(root, 'field.sqlite')
    const realPath = path.join(root, 'real.sqlite')
    const destinationPath = path.join(root, 'profile', 'mission-store.sqlite')
    await writeFile(realPath, 'sqlite', { mode: 0o600 })
    await symlink(realPath, fixturePath)

    await expect(stageClosedFixture({ fixturePath, destinationPath })).rejects.toThrow(
      'closed regular file',
    )

    await rm(fixturePath)
    await writeFile(fixturePath, 'sqlite', { mode: 0o600 })
    await writeFile(`${fixturePath}-wal`, 'uncheckpointed', { mode: 0o600 })
    await expect(stageClosedFixture({ fixturePath, destinationPath })).rejects.toThrow(
      'sidecar',
    )
  })

  it('rejects a copied database fixture that is not itself greater than 2 GiB', () => {
    expect(() => assertFieldScaleFixture({
      sourceBytes: 2 * 1024 * 1024 * 1024,
      copiedBytes: 2 * 1024 * 1024 * 1024,
    })).toThrow(/2 GiB|field scale/iu)
    expect(assertFieldScaleFixture({
      sourceBytes: 2 * 1024 * 1024 * 1024 + 1,
      copiedBytes: 2 * 1024 * 1024 * 1024 + 1,
    })).toBe(true)
  })

  it('accepts only a terminal, exhaustive cleanup journal table cursor', () => {
    const row = {
      archive_id: 'archive-a',
      state: 'completed',
      progress_json: JSON.stringify({
        version: 1,
        archiveId: 'archive-a',
        ciphertextSha256: 'a'.repeat(64),
        sizeBytes: 2_147_483_649,
        finalizationEpoch: 44,
        verificationProofSha256: 'b'.repeat(64),
        tables: ['positions', 'devices'],
        tableIndex: 2,
        tableBatch: 0,
        deletedRows: 100,
      }),
    }

    expect(parseTerminalCleanupJournal(row, 'archive-a', ['positions', 'devices'])).toEqual({
      tables: ['positions', 'devices'],
      deletedRows: 100,
    })
    expect(() => parseTerminalCleanupJournal(
      { ...row, state: 'in_progress' },
      'archive-a',
      ['positions', 'devices'],
    ))
      .toThrow('terminal')
    expect(() => parseTerminalCleanupJournal({
      ...row,
      progress_json: row.progress_json.replace('"tableIndex":2', '"tableIndex":1'),
    }, 'archive-a', ['positions', 'devices'])).toThrow('exhaust')
    expect(() => parseTerminalCleanupJournal(
      row,
      'archive-a',
      ['positions', 'devices', 'markers'],
    )).toThrow(/complete|table plan/iu)
  })

  it('derives exact per-phase maxima and fails at the immutable 200 ms gate', () => {
    const measurements = Object.assign(Object.fromEntries(
      ['create', 'verify', 'restore', 'cleanup'].map((phase, index) => [phase, {
        heartbeatGapsMs: [50 + index, 80 + index],
        currentCadencesMs: [70 + index, 90 + index],
        durableLatenciesMs: [300, 100],
        durableWriteCount: 2,
        durableVisibleWrites: 2,
        durableBusyRetries: 1,
        currentWrites: 2,
        visibleWrites: 2,
      }]),
    ), { durableSettlementMs: 12 })

    expect(deriveLivenessEvidence(measurements)).toEqual({
      heartbeatMaxGapMs: 83,
      currentPositionMaxCadenceMs: 93,
      currentPositionsIndependent: true,
      durableMaxLatencyMs: 300,
      durableWriteCount: 8,
      durableVisibleWrites: 8,
      durableBusyRetries: 4,
      durableSettlementMs: 12,
      byPhase: {
        create: phaseEvidence(80, 90),
        verify: phaseEvidence(81, 91),
        restore: phaseEvidence(82, 92),
        cleanup: phaseEvidence(83, 93),
      },
    })

    measurements.cleanup.heartbeatGapsMs.push(200)
    expect(() => deriveLivenessEvidence(measurements)).toThrow('200 ms')
  })

  it('keeps current publication moving while durable persistence is pending', async () => {
    let releasePersistence: (() => void) | undefined
    const persistence = new Promise<void>((resolve) => {
      releasePersistence = resolve
    })
    const probe = startCurrentPositionProbe({
      store: {
        addPosition: vi.fn(() => persistence),
      },
      missionId: 'probe-mission',
      deviceId: 'probe-device',
      runId: 'probe-run',
    })
    probe.setPhase('create')

    await new Promise((resolve) => setTimeout(resolve, 180))
    releasePersistence?.()
    for (const phase of ['verify', 'restore', 'cleanup'] as const) {
      probe.setPhase(phase)
      await new Promise((resolve) => setTimeout(resolve, 60))
    }
    const result = await probe.stop()

    expect(result.byPhase.create.currentWrites).toBeGreaterThan(1)
    expect(result.byPhase.create.visibleWrites)
      .toBe(result.byPhase.create.currentWrites)
  })

  it('fails closed when the measured main event loop stalls despite off-thread durable ingest', async () => {
    const probe = startCurrentPositionProbe({
      store: { addPosition: vi.fn(async () => undefined) },
      missionId: 'probe-mission',
      deviceId: 'probe-device',
      runId: 'probe-run',
    })
    probe.setPhase('create')
    await new Promise((resolve) => setTimeout(resolve, 90))
    const blockedUntil = performance.now() + 240
    while (performance.now() < blockedUntil) { /* intentional event-loop stall */ }
    for (const phase of ['verify', 'restore', 'cleanup'] as const) {
      probe.setPhase(phase)
      await new Promise((resolve) => setTimeout(resolve, 70))
    }
    await expect(probe.stop()).rejects.toThrow('200 ms')
  })

  it('drains durable ingest through the qualification worker without blocking publication', async () => {
    const root = await createTemporaryRoot()
    const databasePath = path.join(root, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_seen TEXT,
        UNIQUE (mission_id, device_id),
        FOREIGN KEY (mission_id) REFERENCES missions(id)
      );
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        received_at TEXT,
        content_hash TEXT,
        source_kind TEXT,
        timestamp_source TEXT,
        timestamp_provenance_recorded_at TEXT,
        FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id)
      );
    `)
    database.prepare('INSERT INTO missions(id, status) VALUES (?, ?)').run('worker-mission', 'active')
    database.prepare(`INSERT INTO devices(id, mission_id, device_id, status)
      VALUES (?, ?, ?, ?)`).run('worker-device-row', 'worker-mission', 'worker-device', 'online')
    const store = {
      countPositions: vi.fn(() => database.prepare(
        'SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?',
      ).get('worker-mission', 'worker-device').count),
      latestPositions: vi.fn(() => database.prepare(
        `SELECT * FROM positions WHERE mission_id = ? AND device_id = ?
         ORDER BY timestamp DESC, id DESC LIMIT 1`,
      ).all('worker-mission', 'worker-device')),
    }
    const probe = startCurrentPositionProbe({
      store,
      missionId: 'worker-mission',
      deviceId: 'worker-device',
      runId: 'worker-run',
      databasePath,
    })
    try {
      for (const phase of ['create', 'verify', 'restore', 'cleanup'] as const) {
        probe.setPhase(phase)
        await new Promise((resolve) => setTimeout(resolve, 70))
      }
      const result = await probe.stop()
      const currentWrites = Object.values(result.byPhase)
        .reduce((total, phase) => total + phase.currentWrites, 0)
      expect(currentWrites).toBeGreaterThan(2)
      expect(result.durableWriteCount).toBe(currentWrites)
      expect(result.durableVisibleWrites).toBe(currentWrites)
      expect(result.durableMaxLatencyMs).toBeGreaterThanOrEqual(0)
      expect(result.durableSettlementMs).toBeGreaterThanOrEqual(0)
      expect(store.countPositions).toHaveBeenCalledWith('worker-mission', 'worker-device')
      expect(store.latestPositions).toHaveBeenCalledWith('worker-mission')
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?',
      ).get('worker-mission', 'worker-device').count).toBe(currentWrites)
    } finally {
      database.close()
    }
  })

  it('measures durable worker queue time from publication through acknowledgement', async () => {
    class DelayedAckWorker {
      listeners = new Map<string, ((value?: unknown) => void)[]>()

      on(event: string, listener: (value?: unknown) => void) {
        const existing = this.listeners.get(event) ?? []
        existing.push(listener)
        this.listeners.set(event, existing)
        return this
      }

      postMessage(message: { type?: string; position?: { source_position_id?: string } }) {
        if (message.type === 'position') {
          setTimeout(() => {
            for (const listener of this.listeners.get('message') ?? []) {
              listener({
                type: 'ack',
                sourcePositionId: message.position?.source_position_id,
                latencyMs: 1,
                busyRetries: 0,
              })
            }
          }, 300)
          return
        }
        if (message.type === 'stop') {
          for (const listener of this.listeners.get('message') ?? []) {
            listener({ type: 'stopped' })
          }
        }
      }

      terminate() { return Promise.resolve(0) }
    }

    const probe = startCurrentPositionProbe({
      store: {},
      missionId: 'queue-mission',
      deviceId: 'queue-device',
      runId: 'queue-run',
      databasePath: path.join(os.tmpdir(), 'queue-probe.sqlite'),
      createWorker: () => new DelayedAckWorker(),
    })
    probe.setPhase('create')
    await new Promise((resolve) => setTimeout(resolve, 90))
    for (const phase of ['verify', 'restore', 'cleanup'] as const) {
      probe.setPhase(phase)
      await new Promise((resolve) => setTimeout(resolve, 70))
    }

    const result = await probe.stop()

    expect(result.durableMaxLatencyMs).toBeGreaterThanOrEqual(250)
  })

  it('retries durable ingest while a concurrent cleanup transaction sustains SQLite contention', async () => {
    const root = await createTemporaryRoot()
    const databasePath = path.join(root, 'mission-store.sqlite')
    const database = new Database(databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.exec(`
      CREATE TABLE missions (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE devices (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_seen TEXT,
        UNIQUE (mission_id, device_id),
        FOREIGN KEY (mission_id) REFERENCES missions(id)
      );
      CREATE TABLE positions (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source_position_id TEXT,
        name TEXT,
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        altitude REAL,
        speed REAL,
        battery REAL,
        accuracy REAL,
        source TEXT,
        timestamp TEXT NOT NULL,
        data_origin TEXT NOT NULL,
        received_at TEXT,
        content_hash TEXT,
        source_kind TEXT,
        timestamp_source TEXT,
        timestamp_provenance_recorded_at TEXT,
        FOREIGN KEY (mission_id, device_id) REFERENCES devices(mission_id, device_id)
      );
    `)
    database.prepare('INSERT INTO missions(id, status) VALUES (?, ?)').run('busy-mission', 'active')
    database.prepare(`INSERT INTO devices(id, mission_id, device_id, status)
      VALUES (?, ?, ?, ?)`).run('busy-device-row', 'busy-mission', 'busy-device', 'online')
    database.exec('BEGIN IMMEDIATE')
    const releaseLock = setTimeout(() => database.exec('COMMIT'), 6_000)
    const store = {
      countPositions: vi.fn(() => database.prepare(
        'SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?',
      ).get('busy-mission', 'busy-device').count),
    }
    const probe = startCurrentPositionProbe({
      store,
      missionId: 'busy-mission',
      deviceId: 'busy-device',
      runId: 'busy-run',
      databasePath,
    })
    probe.setPhase('create')
    try {
      await new Promise((resolve) => setTimeout(resolve, 6_400))
      for (const phase of ['verify', 'restore', 'cleanup'] as const) {
        probe.setPhase(phase)
        await new Promise((resolve) => setTimeout(resolve, 70))
      }
      const result = await probe.stop()
      const currentWrites = Object.values(result.byPhase)
        .reduce((total, phase) => total + phase.currentWrites, 0)
      expect(currentWrites).toBeGreaterThan(1)
      expect(database.prepare(
        'SELECT COUNT(*) AS count FROM positions WHERE mission_id = ? AND device_id = ?',
      ).get('busy-mission', 'busy-device').count).toBe(currentWrites)
    } finally {
      clearTimeout(releaseLock)
      try { database.exec('ROLLBACK') } catch { /* transaction already released */ }
      database.close()
    }
  }, 15_000)

  it('fails closed when the durable worker exits before shutdown begins', async () => {
    class ExitingWorker {
      listeners = new Map<string, ((value?: unknown) => void)[]>()

      constructor() {
        setTimeout(() => {
          for (const listener of this.listeners.get('exit') ?? []) listener(1)
        }, 10)
      }

      on(event: string, listener: (value?: unknown) => void) {
        const existing = this.listeners.get(event) ?? []
        existing.push(listener)
        this.listeners.set(event, existing)
        return this
      }

      postMessage() {}

      terminate() { return Promise.resolve(0) }
    }

    const probe = startCurrentPositionProbe({
      store: {},
      missionId: 'probe-mission',
      deviceId: 'probe-device',
      runId: 'probe-run',
      databasePath: path.join(os.tmpdir(), 'probe.sqlite'),
      createWorker: () => new ExitingWorker(),
    })
    probe.setPhase('create')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const outcome = await Promise.race([
      probe.stop().then(() => 'resolved', (error: Error) => `rejected:${error.message}`),
      new Promise<string>((resolve) => setTimeout(() => resolve('timed-out'), 300)),
    ])
    expect(outcome).toMatch(/^rejected:/u)
  })

  it('waits beyond thirty minutes while exact durable maintenance cursors advance', async () => {
    let currentTimeMs = 0
    let cursor = 0

    const settled = await waitForMaintenanceSettlement('/unused.sqlite', {
      now: () => currentTimeMs,
      pollIntervalMs: 60_000,
      readState: () => maintenanceState(cursor, 31),
      wait: async () => {
        currentTimeMs += 60_000
        cursor += 1
      },
    })

    expect(currentTimeMs).toBe(31 * 60_000)
    expect(settled.settled).toBe(true)
  })

  it('reads a real fully settled schema-v13 maintenance snapshot', async () => {
    const root = await createTemporaryRoot()
    const databasePath = path.join(root, 'settled.sqlite')
    const database = new Database(databasePath)
    try {
      database.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata(key, value) VALUES
          ('schema_version', '13'),
          ('legacy_archive_registry_backfill_cursor', '0'),
          ('legacy_archive_registry_backfill_target', '0');
        CREATE TABLE legacy_mission_object_backfill_state (
          object_type TEXT PRIMARY KEY,
          scanned_through_id TEXT,
          scan_target_id TEXT
        );
        CREATE TABLE legacy_event_provenance_backfill_state (
          table_name TEXT PRIMARY KEY,
          scanned_through_id INTEGER,
          scan_target_id INTEGER
        );
        CREATE TABLE legacy_gpx_backfill_state (
          singleton INTEGER PRIMARY KEY,
          scanned_through_rowid INTEGER,
          scan_target_rowid INTEGER
        );
        INSERT INTO legacy_gpx_backfill_state VALUES (1, 0, 0);
        CREATE TABLE legacy_gpx_rowid_scan_state (
          singleton INTEGER PRIMARY KEY,
          low_scanned_through_rowid INTEGER,
          low_target_rowid INTEGER,
          high_scanned_through_rowid INTEGER,
          high_target_rowid INTEGER
        );
        INSERT INTO legacy_gpx_rowid_scan_state
          VALUES (1, 1, 1, 9007199254740991, 9007199254740991);
        CREATE TABLE gpx_import_source_receipts (status TEXT NOT NULL);
        CREATE TABLE mission_archives (availability TEXT NOT NULL);
      `)
    } finally {
      database.close()
    }

    await expect(waitForMaintenanceSettlement(databasePath)).resolves.toMatchObject({
      schemaVersion: 13,
      settled: true,
      progress: {
        archiveCursor: '0',
        archiveTarget: '0',
        legacyArchivePending: 0,
        unknownArchiveCustody: 0,
        unsettledCustody: 0,
      },
    })
  })

  it('fails after 120 seconds without semantic progress and ignores timestamp noise', async () => {
    let currentTimeMs = 0
    let timestampSequence = 0

    await expect(waitForMaintenanceSettlement('/unused.sqlite', {
      now: () => currentTimeMs,
      pollIntervalMs: 60_000,
      readState: () => ({
        ...maintenanceState(4, 10),
        observedAt: `2026-08-30T17:00:${String(timestampSequence++).padStart(2, '0')}.000Z`,
      }),
      wait: async () => { currentTimeMs += 60_000 },
    })).rejects.toThrow(/120 seconds|progress/iu)

    expect(currentTimeMs).toBe(120_000)
  })

  it('fails closed when the observation gap reaches 120 seconds before later progress', async () => {
    let currentTimeMs = 0
    let cursor = 4

    await expect(waitForMaintenanceSettlement('/unused.sqlite', {
      now: () => currentTimeMs,
      pollIntervalMs: 1_000,
      readState: () => maintenanceState(cursor, 6),
      wait: async () => {
        currentTimeMs += 120_000
        cursor += 1
      },
    })).rejects.toThrow(/120 seconds|progress/iu)
  })

  it('fails immediately for maintenance failures, cursor regression, or a cyclic state', async () => {
    const wait = vi.fn(async () => undefined)
    await expect(waitForMaintenanceSettlement('/unused.sqlite', {
      readState: () => maintenanceState(1, 10, ['legacy_evidence_backfill_failure']),
      wait,
    })).rejects.toThrow(/failure/iu)
    expect(wait).not.toHaveBeenCalled()

    let regressionIndex = 0
    const regressionStates = [1, 3, 2]
    await expect(waitForMaintenanceSettlement('/unused.sqlite', {
      now: () => regressionIndex * 1_000,
      pollIntervalMs: 1,
      readState: () => maintenanceState(regressionStates[regressionIndex] ?? 2, 10),
      wait: async () => { regressionIndex += 1 },
    })).rejects.toThrow(/regress/iu)

    let cycleIndex = 0
    const cycleStates = [1, 2, 1]
    await expect(waitForMaintenanceSettlement('/unused.sqlite', {
      now: () => cycleIndex * 1_000,
      pollIntervalMs: 1,
      readState: () => maintenanceState(cycleStates[cycleIndex] ?? 1, 10),
      wait: async () => { cycleIndex += 1 },
    })).rejects.toThrow(/cyclic|repeated/iu)
  })

  it('stops the migration heartbeat exactly once when the owned operation fails', async () => {
    const stop = vi.fn(() => 51)

    await expect(runWithHeartbeatMonitor(
      async () => { throw new Error('maintenance failed') },
      () => ({ stop }),
    )).rejects.toThrow('maintenance failed')

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('returns the migration heartbeat result while finally remains its sole stop owner', async () => {
    const stop = vi.fn(() => 51)

    await expect(runWithHeartbeatMonitor(
      async () => 'settled',
      () => ({ stop }),
    )).resolves.toEqual({
      result: 'settled',
      heartbeatMaxGapMs: 51,
    })

    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('reads legacy archive progress only from its fixed metadata cursor and target', () => {
    const preparedSql: string[] = []
    const metadata = new Map<string, string>()
    const database = {
      prepare(sql: string) {
        preparedSql.push(sql)
        if (!/FROM metadata/iu.test(sql) || /FROM mission_events/iu.test(sql)) {
          throw new Error('Qualifier attempted to scan mission evidence rows.')
        }
        return {
          get(key: string) {
            const value = metadata.get(key)
            return value === undefined ? undefined : { value }
          },
        }
      },
    }

    expect(readLegacyArchiveMaintenanceProgress(database)).toEqual({
      cursor: null,
      target: null,
      pending: 1,
    })

    metadata.set('legacy_archive_registry_backfill_cursor', '1000')
    metadata.set('legacy_archive_registry_backfill_target', '1002')
    expect(readLegacyArchiveMaintenanceProgress(database)).toEqual({
      cursor: '1000',
      target: '1002',
      pending: 1,
    })

    metadata.set('legacy_archive_registry_backfill_cursor', '1002')
    expect(readLegacyArchiveMaintenanceProgress(database)).toEqual({
      cursor: '1002',
      target: '1002',
      pending: 0,
    })
    expect(preparedSql.every((sql) => !/FROM mission_events/iu.test(sql))).toBe(true)
  })

  it('scans exact secrets and privacy canaries across stream chunk boundaries without paths', async () => {
    const root = await createTemporaryRoot()
    const reviewRoot = path.join(root, 'review')
    const sessionRoot = path.join(reviewRoot, 'session')
    await mkdir(sessionRoot, { recursive: true, mode: 0o700 })
    const secret = 'exact-ephemeral-secret'
    const canary = 'fixture-mission-000000000001'
    await writeFile(
      path.join(sessionRoot, 'mission-store.sqlite'),
      Buffer.concat([Buffer.alloc(64 * 1024 - 7, 0x78), Buffer.from(`${secret}:${canary}`)]),
      { mode: 0o600 },
    )

    const scan = await scanEvidenceRoots({
      roots: [{ label: 'archive-review-sessions', rootPath: reviewRoot }],
      secrets: [secret],
      privacyCanary: canary,
    })

    expect(scan.filesScanned).toBe(1)
    expect(scan.appAddressablePlaintextFiles).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(scan.secretMatches).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(scan.privacyMatches).toEqual([
      'archive-review-sessions/session/mission-store.sqlite',
    ])
    expect(JSON.stringify(scan)).not.toContain(root)
  })

  it('atomically writes new mode-0600 evidence and never overwrites prior proof', async () => {
    const root = await createTemporaryRoot()
    const evidencePath = path.join(root, 'evidence', 'qualification.json')
    const evidence = { schema: 'test', passed: true }

    await writeQualificationEvidence(evidencePath, evidence)

    expect(JSON.parse(await readFile(evidencePath, 'utf8'))).toEqual(evidence)
    expect((await lstat(evidencePath)).mode & 0o777).toBe(0o600)
    await expect(writeQualificationEvidence(evidencePath, { replaced: true }))
      .rejects.toThrow('already exists')
  })
})

/** Creates one isolated unit-test directory. */
async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'breadcrumb-pr6-qualification-test-'))
  temporaryRoots.push(root)
  await chmod(root, 0o700)
  return root
}

/** Builds one expected phase liveness projection. */
function phaseEvidence(heartbeatMaxGapMs: number, currentPositionMaxCadenceMs: number) {
  return {
    heartbeatMaxGapMs,
    currentPositionMaxCadenceMs,
    durableMaxLatencyMs: 300,
    durableWriteCount: 2,
    durableVisibleWrites: 2,
    durableBusyRetries: 1,
    currentWrites: 2,
    visibleWrites: 2,
  }
}

/** Builds one exact semantic maintenance cursor snapshot without timestamp noise. */
function maintenanceState(cursor: number, target: number, failureMarkers: string[] = []) {
  return {
    schemaVersion: 13,
    failureMarkers,
    settled: cursor === target,
    progress: {
      schemaVersion: 13,
      objectCursors: [],
      eventCursors: [{ key: 'mission_events', cursor: String(cursor), target: String(target) }],
      safeGpx: { cursor: '0', target: '0' },
      unsafeGpx: {
        lowCursor: '1',
        lowTarget: '1',
        highCursor: '9007199254740991',
        highTarget: '9007199254740991',
      },
      receiptPending: 0,
      archiveCursor: '0',
      archiveTarget: '0',
      legacyArchivePending: 0,
      unknownArchiveCustody: 0,
      unsettledCustody: 0,
    },
  }
}
