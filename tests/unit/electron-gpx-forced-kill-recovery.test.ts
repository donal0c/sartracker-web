import { fork, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3') as new (path: string, options?: Readonly<Record<string, unknown>>) => {
  close(): void
  prepare(sql: string): {
    get(...params: readonly unknown[]): Record<string, unknown> | undefined
  }
}
const { createElectronMissionStore } = require('../../electron/mission-store.cjs') as {
  readonly createElectronMissionStore: (options: Readonly<Record<string, unknown>>) => {
    createMission(input: { readonly name: string }): Promise<{ readonly id: string }>
    prepareClose(): Promise<void>
    close(): void
  }
}

describe('GPX import forced-kill recovery [DON-274]', () => {
  let root: string | null = null
  let child: ChildProcess | null = null

  afterEach(async () => {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    child = null
    if (root !== null) await rm(root, { recursive: true, force: true })
    root = null
  })

  for (const phase of ['pending', 'retained'] as const) {
    it(`recovers an actual SIGKILL after the source receipt becomes ${phase}`, async () => {
      root = await mkdtemp(path.join(tmpdir(), `sartracker-gpx-kill-${phase}-`))
      const store = createElectronMissionStore({ userDataPath: root, readAdminRoster: async () => [] })
      const mission = await store.createMission({ name: `Forced kill ${phase}` })
      await store.prepareClose()
      store.close()
      const sourcePath = path.join(root, `${phase}.gpx`)
      await writeFile(sourcePath, `<gpx version="1.1"><trk><trkseg>
        <trkpt lat="52" lon="-9.7"/><trkpt lat="52.01" lon="-9.71"/>
      </trkseg></trk></gpx>`)

      child = fork(
        path.join(process.cwd(), 'tests/fixtures/gpx-import-kill-child.cjs'),
        [root, mission.id, sourcePath, phase],
        { silent: true },
      )
      await waitForReceiptStatus(path.join(root, 'mission-store.sqlite'), phase, child)
      child.kill('SIGKILL')
      const [, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null]
      expect(signal).toBe('SIGKILL')

      const recoveredStore = createElectronMissionStore({
        userDataPath: root,
        readAdminRoster: async () => [],
      })
      await recoveredStore.prepareClose()
      recoveredStore.close()
      const database = new Database(path.join(root, 'mission-store.sqlite'), { readonly: true })
      const failure = database.prepare(`SELECT content_sha256, source_bytes_base64, reason
        FROM gpx_import_failures WHERE mission_id = ?`).get(mission.id)
      const receipt = database.prepare(`SELECT status FROM gpx_import_source_receipts
        WHERE mission_id = ?`).get(mission.id)
      database.close()

      expect(receipt).toMatchObject({ status: 'failed' })
      expect(failure?.reason).toMatch(phase === 'retained'
        ? /after source bytes were retained/u
        : /before source bytes were retained/u)
      if (phase === 'retained') {
        expect(failure?.content_sha256).toMatch(/^[a-f0-9]{64}$/u)
        expect(failure?.source_bytes_base64).toBeTypeOf('string')
      } else {
        expect(failure?.content_sha256).toBeNull()
        expect(failure?.source_bytes_base64).toBeNull()
      }
    }, 15_000)
  }
})

/** Waits until the child has durably reached the requested receipt lifecycle state. */
async function waitForReceiptStatus(
  databasePath: string,
  expectedStatus: 'pending' | 'retained',
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`GPX import child exited before ${expectedStatus} receipt evidence was observed.`)
    }
    try {
      const database = new Database(databasePath, { readonly: true, fileMustExist: true })
      const row = database.prepare(`SELECT status FROM gpx_import_source_receipts
        ORDER BY updated_at DESC LIMIT 1`).get()
      database.close()
      if (row?.status === expectedStatus) return
    } catch {
      // The child may still be opening the existing store.
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for durable ${expectedStatus} GPX receipt evidence.`)
}
