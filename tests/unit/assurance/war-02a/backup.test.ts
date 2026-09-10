// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FaultPlan } from './fault-plan'
import { createFaultFileSystem } from './fault-filesystem'
import { loadIsolatedCommonJs } from './isolated-commonjs'
import { createGate, VirtualScheduler } from './virtual-scheduler'
import { createSqliteBackupAdapter } from './sqlite-backup-adapter'
import type { MissionStoreModule } from './production-contracts'

const require = createRequire(import.meta.url)
const sourceFile = require.resolve('../../../../electron/mission-store.cjs')
const Database = require('better-sqlite3') as new (file: string, options: { readonly: boolean; fileMustExist: boolean }) => {
  prepare: (sql: string) => { all: () => { name: string }[] }
  close: () => void
}

/** Reads actual SQLite rows independently of the backup adapter and byte oracle. */
function missionNames(file: string): string[] {
  const database = new Database(file, { readonly: true, fileMustExist: true })
  try { return database.prepare('SELECT name FROM missions ORDER BY name').all().map((row) => row.name) }
  finally { database.close() }
}

describe('WAR-02A rolling SQLite backup', () => {
  for (const operation of ['sqlite.backup', 'file.rename']) {
    for (const boundary of ['before', 'after'] as const) {
      for (const code of ['EIO', 'ENOSPC', 'INTERRUPTED'] as const) {
        it(`historical backup atomicity: ${code} ${boundary} ${operation} retains a whole mirror`, async () => {
          const root = await mkdtemp(path.join(tmpdir(), 'war02a-backup-'))
          let store: Awaited<ReturnType<MissionStoreModule['createElectronMissionStore']>> | undefined
          try {
            let plan = new FaultPlan()
            const mirror = path.join(root, 'mission-store.backup.sqlite')
            const adapter = createSqliteBackupAdapter(() => plan)
            const negative = process.env.WAR02A_NEGATIVE_CONTROL === 'backup-direct-target'
            const module = loadIsolatedCommonJs<MissionStoreModule>(sourceFile, {
              'node:fs/promises': createFaultFileSystem(root, () => plan),
              './sqlite-backup-runner.cjs': { runSqliteBackupInWorker: adapter.run },
            }, negative ? {
              from: 'const temporaryPath = `${backupPath}.tmp-${randomUUID()}`',
              to: 'const temporaryPath = backupPath',
            } : undefined)
            store = await module.createElectronMissionStore({ userDataPath: root })
            const first = await store.createMission({ name: 'Before backup' })
            await store.syncBackup()
            const before = await readFile(mirror)
            expect(missionNames(mirror)).toEqual(['Before backup'])
            // Real SQLite contents now differ; the mirror must still retain its prior bytes.
            await store.finishMission(first.id)
            const second = await store.createMission({ name: 'After backup' })
            plan = new FaultPlan({ operation, boundary, occurrence: 1, code })
            await expect(store.syncBackup()).rejects.toMatchObject({ code })
            plan.assertTriggered()
            const retained = await readFile(mirror).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null
              throw error
            })
            if (operation === 'file.rename' && boundary === 'after') {
              expect(retained).not.toEqual(before)
              expect(missionNames(mirror)).toEqual(['After backup', 'Before backup'])
            } else {
              expect(retained, 'prior mirror bytes must survive failed replacement').toEqual(before)
              expect(missionNames(mirror)).toEqual(['Before backup'])
            }
            expect((await store.listMissionEvents(second.id)).map((event) => event.event_type)).not.toContain('mission_backup_synced')
            expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
          } finally {
            await store?.close()
            await rm(root, { recursive: true, force: true })
          }
        })
      }
    }
  }

  it('delivers completed native backup at an explicit worker-completion event', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'war02a-worker-'))
    let store: Awaited<ReturnType<MissionStoreModule['createElectronMissionStore']>> | undefined
    try {
      const gate = createGate<void>('worker-completion')
      const clock = new VirtualScheduler()
      const adapter = createSqliteBackupAdapter(() => new FaultPlan(), gate)
      const module = loadIsolatedCommonJs<MissionStoreModule>(sourceFile, {
        './sqlite-backup-runner.cjs': { runSqliteBackupInWorker: adapter.run },
      })
      store = await module.createElectronMissionStore({ userDataPath: root })
      await store.createMission({ name: 'Held completion' })
      const backup = store.syncBackup()
      await gate.entered
      await expect(readFile(path.join(root, 'mission-store.backup.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
      clock.schedule('worker-completion', 20, () => { gate.release() })
      clock.advanceTo(20)
      await backup
      gate.assertSettled()
      clock.assertIdle()
      expect(missionNames(path.join(root, 'mission-store.backup.sqlite'))).toEqual(['Held completion'])
    } finally {
      await store?.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
