import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

// Audit M-44: the single rolling backup mirror must never be replaced by a
// copy whose pages are damaged. Audit M-42: the rolling backup must not fill
// the disk the live store needs. Both run against the real Electron store.

type Store = {
  readonly createMission: (input: { readonly name: string }) => Promise<{ readonly id: string }>
  readonly upsertDevicesBulk: (input: {
    readonly mission_id: string
    readonly devices: readonly {
      readonly device_id: string
      readonly name: string
      readonly color: string
      readonly status: string
    }[]
  }) => Promise<unknown>
  readonly syncBackup: (trigger?: string) => Promise<string>
  readonly prepareClose: () => Promise<void>
  readonly close: () => void
  readonly listMissionEvents: (missionId: string) => Promise<readonly {
    readonly event_type: string
    readonly details_json: string | null
  }[]>
}

type StatfsResult = { readonly bavail: bigint; readonly bsize: bigint }

type BackupFaultInjection = {
  readonly corruptTemporaryBtreePageBeforeIntegrityCheck?: boolean
  readonly availableBackupBytes?: number
  readonly failTemporaryCleanup?: boolean
  readonly statfs?: (directoryPath: string) => Promise<StatfsResult>
}

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (file: string, options?: { readonly readonly?: boolean }) => {
  readonly pragma: (source: string) => readonly { readonly quick_check?: string; readonly integrity_check?: string }[]
  readonly exec: (sql: string) => void
  readonly prepare: (sql: string) => { readonly run: (...args: unknown[]) => unknown }
  readonly unsafeMode: (on: boolean) => void
  readonly close: () => void
}
const { statSync } = require('node:fs') as typeof import('node:fs')
const {
  createElectronMissionStore,
  computeBackupRequiredFreeBytes,
} = require('../../electron/mission-store.cjs') as {
  readonly computeBackupRequiredFreeBytes: (input: {
    readonly databaseBytes: number
    readonly walBytes: number
  }) => number
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly backupFaultInjection?: BackupFaultInjection
  }) => Store
}

let directory: string | undefined
let store: Store | undefined

afterEach(async () => {
  vi.restoreAllMocks()
  await store?.prepareClose()
  store?.close()
  store = undefined
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

/** Opens a real store in a fresh user-data folder. */
async function open(backupFaultInjection?: BackupFaultInjection): Promise<Store> {
  directory ??= await mkdtemp(path.join(tmpdir(), 'sartracker-backup-mirror-'))
  store = createElectronMissionStore({
    userDataPath: directory,
    ...(backupFaultInjection === undefined ? {} : { backupFaultInjection }),
  })
  return store
}

/** Reopens the same user-data folder with different backup fault injection. */
async function reopen(backupFaultInjection?: BackupFaultInjection): Promise<Store> {
  await store?.prepareClose()
  store?.close()
  store = undefined
  return open(backupFaultInjection)
}

function mirrorPath(): string {
  return path.join(directory!, 'mission-store.backup.sqlite')
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256').update(await readFile(filePath)).digest('hex')
}

function integrityOf(filePath: string): string {
  const database = new Database(filePath, { readonly: true })
  try {
    return database.pragma('integrity_check').map((row) => row.integrity_check).join('\n')
  } finally {
    database.close()
  }
}

async function temporaryCopies(): Promise<readonly string[]> {
  return (await readdir(directory!)).filter((name) => name.includes('mission-store.backup.sqlite.tmp'))
}

describe('rolling backup mirror integrity [M-44]', () => {
  it('keeps the last good mirror when the new copy has a damaged page behind a valid header', async () => {
    const first = await open()
    const mission = await first.createMission({ name: 'Mirror Integrity Mission' })
    await first.syncBackup('interval')
    const goodHash = await sha256(mirrorPath())
    expect(integrityOf(mirrorPath())).toBe('ok')
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const damaged = await reopen({ corruptTemporaryBtreePageBeforeIntegrityCheck: true })

    await expect(damaged.syncBackup('interval')).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY_FAILED',
      message: expect.stringMatching(/integrity check.*last good backup was kept/i),
    })
    expect(await sha256(mirrorPath())).toBe(goodHash)
    expect(integrityOf(mirrorPath())).toBe('ok')
    expect(await temporaryCopies()).toEqual([])
    const events = (await damaged.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(events).toContain('mission_backup_integrity_failed')
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/mission backup refused/i))
  })
})

describe('rolling backup mirror integrity with a damaged primary [M-44]', () => {
  it('does not let a primary with a damaged page behind a valid header replace the last good mirror', async () => {
    const first = await open()
    const mission = await first.createMission({ name: 'Damaged Primary Mission' })
    // Enough device rows that the middle page of the file is a live table page.
    await first.upsertDevicesBulk({
      mission_id: mission.id,
      devices: Array.from({ length: 2_000 }, (_, index) => ({
        device_id: `filler-${index}`,
        name: `Filler tracker ${index} ${'x'.repeat(200)}`,
        color: '#00AAFF',
        status: 'online',
      })),
    })
    await first.syncBackup('interval')
    const goodHash = await sha256(mirrorPath())
    await first.prepareClose()
    first.close()
    store = undefined
    await damageMiddlePageOf(path.join(directory!, 'mission-store.sqlite'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const damaged = await open()

    await expect(damaged.syncBackup('interval')).rejects.toMatchObject({ code: 'BACKUP_INTEGRITY_FAILED' })
    expect(await sha256(mirrorPath())).toBe(goodHash)
    expect(integrityOf(mirrorPath())).toBe('ok')
    expect(mission.id).toBeTruthy()
  })
})

describe('rolling backup mirror integrity with index damage [M-44]', () => {
  it('does not let a primary whose index disagrees with its table replace the last good mirror', async () => {
    const first = await open()
    await first.createMission({ name: 'Index Damage Mission' })
    await first.syncBackup('interval')
    const goodHash = await sha256(mirrorPath())
    await first.prepareClose()
    first.close()
    store = undefined
    const primaryPath = path.join(directory!, 'mission-store.sqlite')
    damageIndexOf(primaryPath)
    // quick_check passes this damage: the b-trees are well formed, but the
    // index no longer matches its rows, so indexed lookups silently miss rows.
    expect(quickCheckOf(primaryPath)).toBe('ok')
    expect(integrityOf(primaryPath)).toMatch(/missing from index/u)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const damaged = await open()

    await expect(damaged.syncBackup('interval')).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY_FAILED',
      message: expect.stringMatching(/missing from index/u),
    })
    expect(await sha256(mirrorPath())).toBe(goodHash)
    expect(await temporaryCopies()).toEqual([])
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/mission backup refused/i))
  })
})

describe('rolling backup refusal when cleanup also fails [M-44]', () => {
  it('keeps the integrity refusal, its log and its audit event when removing the copy fails', async () => {
    const first = await open()
    const mission = await first.createMission({ name: 'Cleanup Failure Mission' })
    await first.syncBackup('interval')
    const goodHash = await sha256(mirrorPath())
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const damaged = await reopen({
      corruptTemporaryBtreePageBeforeIntegrityCheck: true,
      failTemporaryCleanup: true,
    })

    await expect(damaged.syncBackup('interval')).rejects.toMatchObject({
      code: 'BACKUP_INTEGRITY_FAILED',
      message: expect.stringMatching(/last good backup was kept/i),
    })
    expect(await sha256(mirrorPath())).toBe(goodHash)
    const events = (await damaged.listMissionEvents(mission.id)).map((event) => event.event_type)
    expect(events).toContain('mission_backup_integrity_failed')
    expect(errors).toHaveBeenCalledWith(expect.stringMatching(/mission backup refused/i))
    expect(errors).toHaveBeenCalledWith(
      expect.stringMatching(/temporary backup copy could not be removed/i),
    )
  })
})

/** Adds a small indexed table, then rewrites the index definition so its entries no longer match. */
function damageIndexOf(filePath: string): void {
  const database = new Database(filePath)
  try {
    database.exec('CREATE TABLE m44_probe(a INTEGER); CREATE INDEX m44_probe_a ON m44_probe(a);')
    const insert = database.prepare('INSERT INTO m44_probe VALUES (?)')
    for (let index = 0; index < 50; index += 1) insert.run(index)
    database.unsafeMode(true)
    database.exec('PRAGMA writable_schema = ON')
    database.prepare(
      "UPDATE sqlite_schema SET sql = 'CREATE INDEX m44_probe_a ON m44_probe(a + 1)' WHERE name = 'm44_probe_a'",
    ).run()
  } finally {
    database.close()
  }
}

function quickCheckOf(filePath: string): string {
  const database = new Database(filePath, { readonly: true })
  try {
    return database.pragma('quick_check').map((row) => row.quick_check).join('\n')
  } finally {
    database.close()
  }
}

/** Overwrites 64 bytes inside the middle page of a closed SQLite file, header untouched. */
async function damageMiddlePageOf(filePath: string): Promise<void> {
  const bytes = await readFile(filePath)
  const encodedPageSize = bytes.readUInt16BE(16)
  const pageSize = encodedPageSize === 1 ? 65_536 : encodedPageSize
  const pageCount = bytes.readUInt32BE(28)
  const middlePage = Math.max(2, Math.floor(pageCount / 2))
  bytes.fill(0xff, (middlePage - 1) * pageSize + 8, (middlePage - 1) * pageSize + 72)
  await writeFile(filePath, bytes)
}

describe('rolling backup free-space preflight [M-42]', () => {
  it('pauses the backup before copying when free space is below the store size plus reserve, keeping the old mirror', async () => {
    const first = await open()
    const mission = await first.createMission({ name: 'Disk Nearly Full Mission' })
    await first.syncBackup('interval')
    const goodHash = await sha256(mirrorPath())
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const nearlyFull = await reopen({ availableBackupBytes: 1024 * 1024 })
    const syncedBefore = (await nearlyFull.listMissionEvents(mission.id))
      .filter((event) => event.event_type === 'mission_backup_synced').length

    await expect(nearlyFull.syncBackup('interval')).rejects.toMatchObject({
      code: 'BACKUP_INSUFFICIENT_SPACE',
      message: expect.stringMatching(/disk nearly full.*free space on this laptop/i),
    })
    expect(await sha256(mirrorPath())).toBe(goodHash)
    expect(await temporaryCopies()).toEqual([])
    const syncedAfter = (await nearlyFull.listMissionEvents(mission.id))
      .filter((event) => event.event_type === 'mission_backup_synced').length
    expect(syncedAfter).toBe(syncedBefore)
  })

  it('never creates a temporary copy when the first backup has too little space', async () => {
    const nearlyFull = await open({ availableBackupBytes: 0 })
    await nearlyFull.createMission({ name: 'First Backup Mission' })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(nearlyFull.syncBackup('interval')).rejects.toMatchObject({ code: 'BACKUP_INSUFFICIENT_SPACE' })
    await expect(access(mirrorPath())).rejects.toThrow()
    expect(await temporaryCopies()).toEqual([])
  })

  it('needs the database, the WAL and the larger of 256 MB or 10 % of the store', () => {
    const megabyte = 1024 * 1024
    expect(computeBackupRequiredFreeBytes({ databaseBytes: 0, walBytes: 0 })).toBe(256 * megabyte)
    expect(computeBackupRequiredFreeBytes({ databaseBytes: 100 * megabyte, walBytes: 5 * megabyte }))
      .toBe(105 * megabyte + 256 * megabyte)
    // At 2560 MB the 10 % reserve equals 256 MB; above it the fraction wins.
    expect(computeBackupRequiredFreeBytes({ databaseBytes: 2560 * megabyte, walBytes: 0 }))
      .toBe(2560 * megabyte + 256 * megabyte)
    expect(computeBackupRequiredFreeBytes({ databaseBytes: 4000 * megabyte, walBytes: 10 * megabyte }))
      .toBe(4010 * megabyte + 400 * megabyte)
  })

  it.each([
    ['exactly the required space', 0, true],
    ['one byte less than required', -1, false],
  ] as const)('reads free space through statfs and decides at the threshold: %s', async (_label, offset, passes) => {
    const statfs = async (): Promise<StatfsResult> => {
      // Measured at the same moment the store measures, so the threshold is exact.
      const databasePath = path.join(directory!, 'mission-store.sqlite')
      const sizeOf = (filePath: string): number => {
        try { return statSync(filePath).size } catch { return 0 }
      }
      const required = computeBackupRequiredFreeBytes({
        databaseBytes: sizeOf(databasePath),
        walBytes: sizeOf(`${databasePath}-wal`),
      })
      return { bavail: BigInt(required + offset), bsize: 1n }
    }
    const atThreshold = await open({ statfs })
    await atThreshold.createMission({ name: 'Threshold Mission' })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    if (passes) {
      await expect(atThreshold.syncBackup('interval')).resolves.toBe(mirrorPath())
    } else {
      await expect(atThreshold.syncBackup('interval')).rejects.toMatchObject({
        code: 'BACKUP_INSUFFICIENT_SPACE',
      })
      expect(await temporaryCopies()).toEqual([])
    }
  })

  it('continues the backup and logs it when free space cannot be read', async () => {
    const blind = await open({
      statfs: async () => { throw new Error('statfs unsupported on this volume') },
    })
    await blind.createMission({ name: 'No Statfs Mission' })
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await expect(blind.syncBackup('interval')).resolves.toBe(mirrorPath())
    expect(warnings).toHaveBeenCalledWith(
      expect.stringMatching(/could not check free disk space.*statfs unsupported/i),
    )
  })

  it('backs up normally when the real disk reports room', async () => {
    const roomy = await open()
    await roomy.createMission({ name: 'Roomy Mission' })

    await expect(roomy.syncBackup('interval')).resolves.toBe(mirrorPath())
    expect(integrityOf(mirrorPath())).toBe('ok')
    // The integrity check leaves no -wal or -shm sidecar of the temporary copy behind.
    expect(await temporaryCopies()).toEqual([])
  })
})
