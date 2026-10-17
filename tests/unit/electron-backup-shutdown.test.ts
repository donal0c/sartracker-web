import { createRequire } from 'node:module'
import { access, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const fileSystem = require('node:fs/promises') as typeof import('node:fs/promises')
type DiagnosticOperation = { readonly id: string; readonly type: 'backup'; readonly requestedAtMs: number }
type Store = {
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly finishMission: (missionId: string) => Promise<unknown>
  readonly getMission: (missionId: string) => Promise<{ readonly status: string }>
  readonly getIngestEvidenceHealth: (missionId: string) => Promise<unknown>
  readonly finalizeMission: (missionId: string) => Promise<{ readonly mission: { readonly status: string } }>
  readonly createMissionArchive: (missionId: string) => Promise<unknown>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly details_json: string | null
  }[]>
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly gpxShutdownJoinTimeoutMs?: number
    readonly storageDiagnostics: ReturnType<typeof diagnostics>
    readonly backupFaultInjection?: { readonly afterTemporaryBackup: boolean }
    readonly finalizeMissionFaultInjection?: { readonly afterArchiveSucceededEvent: boolean }
    readonly readArchiveFile?: (archivePath: string) => Promise<Buffer>
  }) => Store
}
let directory: string | undefined
let store: Store | undefined
const releases: (() => void)[] = []

afterEach(async () => {
  releases.splice(0).forEach(release => release())
  vi.restoreAllMocks()
  await store?.prepareClose()
  store?.close()
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
})

describe('backup shutdown ownership [DON-329]', () => {
  it.each(['requested', 'renamed', 'completed'] as const)(
    'joins an admitted backup through the %s diagnostic boundary', async (boundary) => {
      const held = deferred()
      const reached = deferred()
      const telemetry = diagnostics()
      if (boundary === 'renamed') {
        telemetry.phase.mockImplementation(async (_operation, stage) => {
          if (stage === 'renamed') { reached.resolve(); await held.promise }
        })
      } else {
        telemetry[boundary].mockImplementation(async () => { reached.resolve(); await held.promise })
      }
      directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-quit-'))
      store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry })
      const mission = await store.createMission({ name: 'Synthetic backup shutdown' })
      const backup = store.syncBackup('manual')
      releases.push(held.resolve)
      await reached.promise
      let closed = false
      const closing = store.prepareClose().then(() => { closed = true })
      try {
        await new Promise(resolve => setTimeout(resolve, 25))
        expect(closed).toBe(false)
        await expect(store.syncBackup('interval')).rejects.toThrow(/shut|clos/i)
        expect(telemetry.requested).toHaveBeenCalledOnce()
      } finally {
        held.resolve()
        await backup
        await closing
      }
      expect(telemetry.completed).toHaveBeenCalledOnce()
      expect((await store.listMissionEvents(mission.id)).map(event => event.event_type))
        .toContain('mission_backup_synced')
      expect((await readFile(path.join(directory, 'mission-store.backup.sqlite'))).subarray(0, 16).toString())
        .toBe('SQLite format 3\0')
    },
  )

  it('bounds the join and allows a later shutdown retry after the backup settles', async () => {
    const held = deferred()
    const reached = deferred()
    const telemetry = diagnostics()
    telemetry.requested.mockImplementation(async () => { reached.resolve(); await held.promise })
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-quit-timeout-'))
    store = createElectronMissionStore({
      userDataPath: directory, storageDiagnostics: telemetry, gpxShutdownJoinTimeoutMs: 15,
    })
    await store.createMission({ name: 'Synthetic delayed backup' })
    const backup = store.syncBackup('manual')
    releases.push(held.resolve)
    await reached.promise
    try {
      await expect(store.prepareClose()).rejects.toThrow(/safe shutdown deadline/)
      expect(telemetry.recordBackupShutdownTimeout).toHaveBeenCalledWith({ pendingBackupCount: 1 })
      expect(() => store!.close()).toThrow(/backup.*pending|backup.*active/i)
    } finally {
      held.resolve()
      await backup
    }
    await expect(store.syncBackup('manual')).rejects.toMatchObject({
      name: 'AbortError', code: 'BACKUP_SHUTDOWN_CANCELLED',
    })
    await expect(store.prepareClose()).resolves.toBeUndefined()
    expect(telemetry.completed).toHaveBeenCalledOnce()
  })

  it.each(['finalize', 'direct archive'] as const)(
    'treats shutdown during %s evidence admission as cancellation without false archive failure', async (kind) => {
      const telemetry = diagnostics()
      directory = await mkdtemp(path.join(tmpdir(), 'sartracker-archive-admission-quit-'))
      store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry })
      const mission = await store.createMission({ name: 'Synthetic archive admission race' })
      await store.finishMission(mission.id)
      await store.getIngestEvidenceHealth(mission.id)
      const gate = holdNextOutboxDirectoryRead(directory)
      const archive = kind === 'finalize'
        ? store.finalizeMission(mission.id)
        : store.createMissionArchive(mission.id)
      const archiveOutcome = archive.catch((error: unknown) => error)
      await gate.reached
      const closing = store.prepareClose().then(() => null, (error: unknown) => error)
      gate.release()

      expect(await archiveOutcome).toMatchObject({
        name: 'AbortError',
        code: kind === 'finalize' ? 'ARCHIVE_CANCELLED' : 'BACKUP_SHUTDOWN_CANCELLED',
      })
      expect(await closing).toBeNull()
      expect(telemetry.requested).not.toHaveBeenCalled()
      const eventTypes = (await store.listMissionEvents(mission.id)).map(event => event.event_type)
      expect(eventTypes).not.toContain('mission_archive_failed')
      if (kind === 'finalize') expect(eventTypes).not.toContain('mission_finalize_requested')
      expect(readFinalizationFence(directory, mission.id)).toBeUndefined()
      expect(await store.getMission(mission.id)).toMatchObject({ status: 'finished' })
    },
  )

  it('preserves an existing finalization recovery fence when shutdown refuses its replacement backup', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-finalize-recovery-quit-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: diagnostics(),
      finalizeMissionFaultInjection: { afterArchiveSucceededEvent: true } })
    const mission = await store.createMission({ name: 'Synthetic protected finalization retry' })
    await store.finishMission(mission.id)
    await expect(store.finalizeMission(mission.id)).rejects.toThrow(/Injected finalize interruption/)
    const fence = readFinalizationFence(directory, mission.id)
    expect(fence).toBeDefined()
    await store.prepareClose()
    store.close()
    store = undefined

    const reached = deferred()
    const held = deferred()
    releases.push(held.resolve)
    let rejectedArchive: string | undefined
    const telemetry = diagnostics()
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry,
      readArchiveFile: async (archivePath) => {
        rejectedArchive = archivePath
        reached.resolve()
        await held.promise
        return readFile(archivePath)
      } })
    const retry = store.finalizeMission(mission.id).catch((error: unknown) => error)
    await reached.promise
    expect(readFinalizationFence(directory, mission.id)).toEqual(fence)
    const closing = store.prepareClose().then(() => null, (error: unknown) => error)
    if (rejectedArchive === undefined) throw new Error('Expected the recoverable archive read.')
    await rm(rejectedArchive)
    held.resolve()

    expect(await retry).toMatchObject({ name: 'AbortError', code: 'BACKUP_SHUTDOWN_CANCELLED' })
    expect(await closing).toBeNull()
    expect(readFinalizationFence(directory, mission.id)).toEqual(fence)
    expect((await store.listMissionEvents(mission.id)).map(event => event.event_type))
      .not.toContain('mission_archive_failed')
    expect(telemetry.requested).not.toHaveBeenCalled()
    store.close()
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: diagnostics() })
    await expect(store.finalizeMission(mission.id)).resolves.toMatchObject({ mission: { status: 'finalized' } })
    expect(readFinalizationFence(directory, mission.id)).toBeUndefined()
  })

  it('still audits and surfaces an admitted finalization backup failure during shutdown', async () => {
    const reached = deferred()
    const held = deferred()
    releases.push(held.resolve)
    const telemetry = diagnostics()
    telemetry.requested.mockImplementation(async () => { reached.resolve(); await held.promise })
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-finalize-backup-failure-quit-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry,
      backupFaultInjection: { afterTemporaryBackup: true } })
    const mission = await store.createMission({ name: 'Synthetic admitted finalization backup failure' })
    await store.finishMission(mission.id)
    const finalization = store.finalizeMission(mission.id).catch((error: unknown) => error)
    await reached.promise
    const closing = store.prepareClose().then(() => null, (error: unknown) => error)
    held.resolve()

    expect(await finalization).toBeInstanceOf(Error)
    expect(await closing).toMatchObject({ message: 'Injected backup interruption after temporary backup.' })
    expect((await store.listMissionEvents(mission.id)).filter(event => event.event_type === 'mission_archive_failed'))
      .toHaveLength(1)
    expect(readFinalizationFence(directory, mission.id)).toBeUndefined()
    expect(telemetry.failed).toHaveBeenCalledOnce()
  })

  it('settles a failed admitted backup and preserves its failure diagnostic before close', async () => {
    const telemetry = diagnostics()
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-quit-failure-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry,
      backupFaultInjection: { afterTemporaryBackup: true } })
    await store.createMission({ name: 'Synthetic failed backup' })
    const backup = store.syncBackup('manual')
    const failed = expect(backup).rejects.toThrow(/Injected backup interruption/)
    await store.prepareClose()
    await failed
    expect(telemetry.failed).toHaveBeenCalledOnce()
    expect(telemetry.completed).not.toHaveBeenCalled()
  })

  it('drains every already-admitted backup in order, including delayed request diagnostics', async () => {
    const held = deferred()
    const telemetry = diagnostics()
    telemetry.requested.mockImplementation(async () => held.promise)
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-quit-queue-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry })
    const mission = await store.createMission({ name: 'Synthetic queued backups' })
    const first = store.syncBackup('manual')
    const second = store.syncBackup('interval')
    const closing = store.prepareClose()
    releases.push(held.resolve)
    try {
      await expect(store.syncBackup()).rejects.toThrow(/shutting down/)
    } finally {
      held.resolve()
      await Promise.all([first, second, closing])
    }
    expect(telemetry.completed.mock.calls.map(call => call[0].id)).toEqual(['backup-1', 'backup-2'])
    expect((await store.listMissionEvents(mission.id)).filter(event => event.event_type === 'mission_backup_synced'))
      .toHaveLength(2)
  })

  it('records a post-rename audit failure while retaining the valid mirror', async () => {
    const telemetry = diagnostics()
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-audit-failure-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry })
    await store.createMission({ name: 'Synthetic backup audit failure' })
    const database = new Database(path.join(directory, 'mission-store.sqlite'))
    try {
      database.exec(`CREATE TRIGGER test_backup_audit_failure BEFORE INSERT ON mission_events
        WHEN NEW.event_type = 'mission_backup_synced'
        BEGIN SELECT RAISE(ABORT, 'injected backup audit failure'); END`)
    } finally { database.close() }

    await expect(store.syncBackup('manual')).rejects.toThrow(/injected backup audit failure/)

    expect(telemetry.failed).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stage: 'renamed' }))
    expect(telemetry.completed).not.toHaveBeenCalled()
    expect((await readFile(path.join(directory, 'mission-store.backup.sqlite'))).subarray(0, 16).toString())
      .toBe('SQLite format 3\0')
  })
})

describe('orphaned backup temporary files [DON-329]', () => {
  const orphanName = 'mission-store.backup.sqlite.tmp-2c2780e7-2ec4-4684-9ab8-658ebca72bd1'

  it('cleans only app-owned regular temporary sets after successful primary open', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-orphans-'))
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: diagnostics() })
    await store.createMission({ name: 'Synthetic startup cleanup' })
    await store.syncBackup()
    await store.prepareClose()
    store.close()
    store = undefined
    const mirrorBefore = await readFile(path.join(directory, 'mission-store.backup.sqlite'))
    const names = [orphanName, `${orphanName}-wal`, `${orphanName}-shm`]
    for (const name of names) await writeFile(path.join(directory, name), 'orphaned copy')
    const protectedNames = ['mission-store.backup.sqlite.tmp-not-a-uuid', `${orphanName}.recovery`]
    for (const name of protectedNames) await writeFile(path.join(directory, name), 'preserve')

    const telemetry = diagnostics()
    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: telemetry })
    await store.prepareClose()

    for (const name of names) await expect(access(path.join(directory, name))).rejects.toThrow()
    for (const name of protectedNames) expect(await readFile(path.join(directory, name), 'utf8')).toBe('preserve')
    expect(await readFile(path.join(directory, 'mission-store.backup.sqlite'))).toEqual(mirrorBefore)
    expect(telemetry.recordBackupTemporaryCleanup).toHaveBeenCalledWith(expect.objectContaining({
      removedFileCount: 3, removedBytes: Buffer.byteLength('orphaned copy') * 3,
    }))
  })

  it('preserves an entire candidate set containing a symlink and does not follow it', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-orphan-link-'))
    const target = path.join(directory, 'operator-recovery.sqlite')
    await writeFile(target, 'recovery material')
    await writeFile(path.join(directory, orphanName), 'temporary copy')
    await symlink(target, path.join(directory, `${orphanName}-wal`))

    store = createElectronMissionStore({ userDataPath: directory, storageDiagnostics: diagnostics() })
    await store.prepareClose()

    expect(await readFile(target, 'utf8')).toBe('recovery material')
    expect(await readFile(path.join(directory, orphanName), 'utf8')).toBe('temporary copy')
    await expect(access(path.join(directory, `${orphanName}-wal`))).resolves.toBeUndefined()
  })

  it('preserves every candidate when the primary cannot open', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'sartracker-backup-orphan-corrupt-'))
    await writeFile(path.join(directory, 'mission-store.sqlite'), 'not a SQLite primary')
    await writeFile(path.join(directory, orphanName), 'potential recovery material')

    expect(() => createElectronMissionStore({ userDataPath: directory!, storageDiagnostics: diagnostics() }))
      .toThrow()

    expect(await readFile(path.join(directory, orphanName), 'utf8')).toBe('potential recovery material')
  })
})

/** Creates a controllable asynchronous boundary without mocking the SQLite copy. */
function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

/** Pauses the real evidence queue after archive admission, without a production hook. */
function holdNextOutboxDirectoryRead(userDataPath: string) {
  const reached = deferred()
  const held = deferred()
  releases.push(held.resolve)
  const original = fileSystem.readdir.bind(fileSystem)
  let intercepted = false
  vi.spyOn(fileSystem, 'readdir').mockImplementation(async (...args) => {
    if (!intercepted && args[0] === path.join(userDataPath, 'ingest-anomaly-outbox')) {
      intercepted = true
      reached.resolve()
      await held.promise
    }
    return original(...args)
  })
  return { reached: reached.promise, release: held.resolve }
}

/** Observes the durable fence through a separate real SQLite connection. */
function readFinalizationFence(userDataPath: string, missionId: string): unknown {
  const database = new Database(path.join(userDataPath, 'mission-store.sqlite'), { readonly: true })
  try {
    return database.prepare('SELECT requested_at FROM mission_finalization_fences WHERE mission_id = ?').get(missionId)
  } finally { database.close() }
}

/** Supplies only bounded diagnostics; backup and audit writes remain real. */
function diagnostics() {
  let sequence = 0
  return {
    createOperation: (): DiagnosticOperation => ({ id: `backup-${++sequence}`, type: 'backup', requestedAtMs: 0 }),
    requested: vi.fn<(operation: DiagnosticOperation) => Promise<void>>(async () => undefined),
    started: vi.fn<(operation: DiagnosticOperation) => Promise<void>>(async () => undefined),
    phase: vi.fn<(operation: DiagnosticOperation, stage: string) => Promise<void>>(async () => undefined),
    completed: vi.fn<(operation: DiagnosticOperation) => Promise<void>>(async () => undefined),
    failed: vi.fn<(operation: DiagnosticOperation) => Promise<void>>(async () => undefined),
    recordBackupTemporaryCleanup: vi.fn<(input: Readonly<Record<string, number | boolean>>) => Promise<void>>(async () => undefined),
    recordBackupShutdownTimeout: vi.fn<(input: { readonly pendingBackupCount: number }) => Promise<void>>(async () => undefined),
    startMission: vi.fn(async () => undefined),
  }
}
