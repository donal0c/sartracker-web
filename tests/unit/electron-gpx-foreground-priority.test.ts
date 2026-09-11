import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')
const { createResponsiveMissionWriter } = require('../../electron/responsive-mission-writer.cjs')
const { runGpxEvidenceImportInWorker } = require('../../electron/gpx-evidence-import-runner.cjs')

it.each(['complete', 'cancel'] as const)('preserves foreground admission across the real GPX worker %s boundary [DON-254]', async (mode) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sar-gpx-priority-'))
  const store = createElectronMissionStore({ userDataPath: directory })
  const databasePath = path.join(directory, 'mission-store.sqlite')
  const foregroundDb = new Database(databasePath)
  const lockDb = new Database(databasePath)
  const writer = createResponsiveMissionWriter(foregroundDb)
  const controller = new AbortController()
  let importing: Promise<unknown> & { workerExited: Promise<void> } | undefined
  let current: Promise<unknown> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const mission = await store.createMission({ name: 'Actual GPX priority' })
    // This fixture tests the GPX worker against an independent writer, not startup sweeps.
    await store.prepareClose()
    store.close()
    const source = '<gpx version="1.1"><trk><trkseg><trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/></trkseg></trk></gpx>'
    const sourcePath = path.join(directory, 'priority.gpx')
    await writeFile(sourcePath, source)
    foregroundDb.exec('CREATE TABLE priority_probe (value TEXT)')
    lockDb.exec('BEGIN IMMEDIATE')
    current = writer.run(() => {
      expect(foregroundDb.prepare('SELECT COUNT(*) AS count FROM gpx_import_batches').get()).toEqual({ count: 0 })
      foregroundDb.prepare('INSERT INTO priority_probe VALUES (?)').run('current')
    })
    void current.catch(() => undefined)
    let entered = () => undefined
    const atBoundary = new Promise<void>((resolve, reject) => {
      entered = resolve
      timer = setTimeout(() => reject(new Error('GPX worker did not reach foreground arbitration.')), 3_000)
    })
    importing = runGpxEvidenceImportInWorker({
      databasePath, missionId: mission.id, paths: [sourcePath],
      foregroundWriterBuffer: writer.pendingBuffer,
      workerPath: path.resolve('tests/fixtures/gpx-foreground-priority-worker.cjs'),
      signal: controller.signal,
      onProgress: (progress: { completed: number }) => { if (progress.completed === 0) entered() },
    })
    void importing!.catch(() => undefined)
    await atBoundary
    clearTimeout(timer)
    expect(writer.pendingCount).toBe(1)
    expect(foregroundDb.prepare('SELECT COUNT(*) AS count FROM gpx_import_batches').get()).toEqual({ count: 0 })
    if (mode === 'cancel') {
      controller.abort()
      await expect(importing).rejects.toMatchObject({ name: 'AbortError' })
      await importing!.workerExited
    }
    lockDb.exec('ROLLBACK')
    await current
    if (mode === 'complete') {
      await expect(importing).resolves.toMatchObject({ imports: [expect.any(Object)], failures: [] })
      const revision = foregroundDb.prepare('SELECT source_bytes_base64, content_sha256 FROM gpx_import_revisions').get()
      expect(revision).toEqual({ source_bytes_base64: Buffer.from(source).toString('base64'),
        content_sha256: createHash('sha256').update(source).digest('hex') })
      expect(foregroundDb.prepare('SELECT lat, lon FROM gpx_evidence_points ORDER BY point_index').all()).toEqual([
        { lat: 52, lon: -9.7 }, { lat: 52.01, lon: -9.71 },
      ])
    } else {
      expect(foregroundDb.prepare('SELECT COUNT(*) AS count FROM gpx_import_batches').get()).toEqual({ count: 0 })
    }
    expect(foregroundDb.prepare('SELECT * FROM priority_probe').all()).toEqual([{ value: 'current' }])
    expect(foregroundDb.pragma('integrity_check', { simple: true })).toBe('ok')
  } finally {
    clearTimeout(timer)
    controller.abort()
    if (lockDb.inTransaction) lockDb.exec('ROLLBACK')
    await Promise.allSettled([current, importing, importing?.workerExited])
    await writer.close()
    foregroundDb.close(); lockDb.close()
    await store.prepareClose()
    store.close()
    await rm(directory, { recursive: true, force: true })
  }
})
