import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string, options?: { readonly readonly?: boolean }) => {
  close(): void
  prepare(sql: string): {
    get(...params: readonly unknown[]): Record<string, unknown> | undefined
    all(...params: readonly unknown[]): readonly Record<string, unknown>[]
  }
}

type ImportResult = {
  readonly imports: readonly { readonly id: string; readonly revision_sequence?: number }[]
  readonly unchanged?: readonly string[]
  readonly failures: readonly { readonly sourcePath: string; readonly reason: string }[]
}

type RunnerInput = Readonly<Record<string, unknown>> & { readonly signal?: AbortSignal }
type Runner = (input: RunnerInput) => Promise<unknown> & { readonly workerExited?: Promise<void> }

type Store = {
  prepareClose(): Promise<void>
  close(): void
  info(): Promise<{ readonly database_path: string }>
  createMission(input: { readonly name: string }): Promise<{ readonly id: string }>
  finishMission(missionId: string): Promise<{ readonly status: string }>
  importGpxEvidencePaths(input: {
    readonly missionId: string
    readonly paths: readonly string[]
    readonly skipRetiredSources?: boolean
  }): Promise<ImportResult>
  listGpxImportIssues(input: { readonly missionId: string; readonly limit?: number }): Promise<{
    readonly entries: readonly Readonly<Record<string, unknown>>[]
  }>
  listGpxMapProjectionPage(input: { readonly missionId: string; readonly cursor?: string }): Promise<{
    readonly entries: readonly { readonly id: string }[]
    readonly nextCursor: string | null
    readonly totalActive: number
  }>
}

const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: {
    readonly userDataPath: string
    readonly runGpxEvidenceImportInWorker?: Runner
    readonly gpxEvidenceImportFaultInjection?: Readonly<Record<string, unknown>>
  }) => Store
}
const { runGpxEvidenceImportInWorker } = require('../../electron/gpx-evidence-import-runner.cjs') as {
  readonly runGpxEvidenceImportInWorker: Runner
}

/** A small, fully dated synthetic track; no real mission data. */
function gpxTrack(name: string, points: number, offset = 0): string {
  const trkpts = Array.from({ length: points }, (_unused, index) => {
    const at = new Date(Date.UTC(2026, 10, 21, 9, 0, index + offset)).toISOString()
    return `<trkpt lat="${(52 + (index + offset) / 100_000).toFixed(6)}" lon="${(-9.7 - (index + offset) / 100_000).toFixed(6)}"><time>${at}</time></trkpt>`
  }).join('\n')
  return `<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name><trkseg>\n${trkpts}\n</trkseg></trk></gpx>`
}

describe('watched GPX rescans and interrupted batches [DON-350]', () => {
  let userDataPath: string | null = null
  let store: Store | null = null

  afterEach(async () => {
    await store?.prepareClose()
    store?.close()
    store = null
    if (userDataPath !== null) await rm(userDataPath, { recursive: true, force: true })
    userDataPath = null
  })

  async function createStore(options: Omit<Parameters<typeof createElectronMissionStore>[0], 'userDataPath'> = {}) {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-don-350-'))
    store = createElectronMissionStore({ userDataPath, ...options })
    return store
  }

  async function countRows(missionId: string) {
    const db = new Database((await store!.info()).database_path, { readonly: true })
    try {
      const count = (sql: string) => Number(db.prepare(sql).get(missionId)?.count)
      return {
        batches: count('SELECT COUNT(*) AS count FROM gpx_import_batches WHERE mission_id = ?'),
        receipts: count('SELECT COUNT(*) AS count FROM gpx_import_source_receipts WHERE mission_id = ?'),
        revisions: count('SELECT COUNT(*) AS count FROM gpx_import_revisions WHERE mission_id = ?'),
        events: count('SELECT COUNT(*) AS count FROM mission_events WHERE mission_id = ?'),
      }
    } finally {
      db.close()
    }
  }

  it('a rescan of unchanged files adds no batch, receipt, revision or event, and reports them as unchanged [M-38] [M-37]', async () => {
    await createStore()
    const mission = await store!.createMission({ name: 'Unchanged watched folder' })
    const watch = path.join(userDataPath!, 'watch')
    await import('node:fs/promises').then((fs) => fs.mkdir(watch))
    const alpha = path.join(watch, 'alpha.gpx')
    const bravo = path.join(watch, 'bravo.gpx')
    await writeFile(alpha, gpxTrack('Alpha', 5_000))
    await writeFile(bravo, gpxTrack('Bravo', 5_000, 10))

    const first = await store!.importGpxEvidencePaths({ missionId: mission.id, paths: [alpha, bravo], skipRetiredSources: true })
    expect(first.imports).toHaveLength(2)
    const afterFirst = await countRows(mission.id)

    for (let scan = 0; scan < 2; scan += 1) {
      const again = await store!.importGpxEvidencePaths({ missionId: mission.id, paths: [alpha, bravo], skipRetiredSources: true })
      expect(again.imports).toEqual([])
      expect(again.failures).toEqual([])
      expect(again.unchanged).toEqual([alpha, bravo])
    }
    expect(await countRows(mission.id)).toEqual(afterFirst)

    // New bytes are never hidden: one grown file gives one revision and one batch.
    await appendFile(bravo, '\n<!-- device sync -->\n')
    await writeFile(bravo, gpxTrack('Bravo', 5_100, 10))
    const grown = await store!.importGpxEvidencePaths({ missionId: mission.id, paths: [alpha, bravo], skipRetiredSources: true })
    expect(grown.imports).toEqual([expect.objectContaining({ revision_sequence: 2 })])
    expect(grown.unchanged).toEqual([alpha])
    const afterGrowth = await countRows(mission.id)
    expect(afterGrowth.batches).toBe(afterFirst.batches + 1)
    expect(afterGrowth.receipts).toBe(afterFirst.receipts + 1)
    expect(afterGrowth.revisions).toBe(afterFirst.revisions + 1)
  }, 60_000)

  it('a deliberate import of the same files still reaches the worker and its audit trail', async () => {
    await createStore()
    const mission = await store!.createMission({ name: 'Deliberate re-import' })
    const alpha = path.join(userDataPath!, 'alpha.gpx')
    await writeFile(alpha, gpxTrack('Alpha', 10))
    await store!.importGpxEvidencePaths({ missionId: mission.id, paths: [alpha] })
    const before = await countRows(mission.id)
    const again = await store!.importGpxEvidencePaths({ missionId: mission.id, paths: [alpha] })
    expect(again.imports).toHaveLength(1)
    expect((await countRows(mission.id)).batches).toBe(before.batches + 1)
  })

  it('settles a batch whose worker stalled, without a restart, so Finish works and the operator is told what imported [M-36]', async () => {
    const stalledRunner: Runner = (input) => runGpxEvidenceImportInWorker({ ...input, inactivityTimeoutMs: 5_000 })
    await createStore({
      runGpxEvidenceImportInWorker: stalledRunner,
      // The second file freezes right after its bytes are retained, like a worker that hangs mid-batch.
      gpxEvidenceImportFaultInjection: { pauseAfter: 'retained', pauseAtPathIndex: 1 },
    })
    const mission = await store!.createMission({ name: 'Stalled import' })
    const paths = ['one', 'two', 'three'].map((name) => path.join(userDataPath!, `${name}.gpx`))
    for (const [index, sourcePath] of paths.entries()) await writeFile(sourcePath, gpxTrack(`Team ${index}`, 20, index * 100))

    await expect(store!.importGpxEvidencePaths({ missionId: mission.id, paths }))
      .rejects.toThrow(/stopped responding[\s\S]*1 of 3 GPX files were imported/u)

    const db = new Database((await store!.info()).database_path, { readonly: true })
    try {
      expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_batches
        WHERE mission_id = ? AND status = 'running'`).get(mission.id)).toEqual({ count: 0 })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_source_receipts
        WHERE mission_id = ? AND status IN ('pending', 'retained')`).get(mission.id)).toEqual({ count: 0 })
      expect(db.prepare(`SELECT COUNT(*) AS count FROM gpx_import_revisions
        WHERE mission_id = ? AND import_state = 'staging'`).get(mission.id)).toEqual({ count: 0 })
      expect(db.prepare(`SELECT status, completed_files, failed_files FROM gpx_import_batches
        WHERE mission_id = ?`).get(mission.id)).toEqual({ status: 'interrupted', completed_files: 1, failed_files: 2 })
      // The interrupted file's exact bytes stay retained as a reviewable failure.
      expect(db.prepare(`SELECT source_bytes_base64 IS NOT NULL AS retained FROM gpx_import_failures
        WHERE mission_id = ? AND source_path = ?`).get(mission.id, paths[1])).toEqual({ retained: 1 })
    } finally {
      db.close()
    }
    const issues = await store!.listGpxImportIssues({ missionId: mission.id, limit: 100 })
    expect(issues.entries).toHaveLength(2)
    await expect(store!.finishMission(mission.id)).resolves.toMatchObject({ status: expect.any(String) })
  }, 60_000)

  it('serves a map projection that holds every active import [M-87]', async () => {
    await createStore()
    const mission = await store!.createMission({ name: 'Many tracks' })
    const paths = Array.from({ length: 30 }, (_unused, index) => path.join(userDataPath!, `team-${String(index).padStart(2, '0')}.gpx`))
    for (const [index, sourcePath] of paths.entries()) await writeFile(sourcePath, gpxTrack(`Team ${index}`, 3, index * 10))
    await store!.importGpxEvidencePaths({ missionId: mission.id, paths })

    const drawn: string[] = []
    let cursor: string | undefined
    let totalActive = 0
    do {
      const page = await store!.listGpxMapProjectionPage({ missionId: mission.id, ...(cursor === undefined ? {} : { cursor }) })
      drawn.push(...page.entries.map((entry) => entry.id))
      totalActive = page.totalActive
      cursor = page.nextCursor ?? undefined
    } while (cursor !== undefined)
    expect(totalActive).toBe(30)
    expect(new Set(drawn).size).toBe(30)
  }, 60_000)
})
