import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { createElectronMissionStore } from '../../src/infrastructure/mission-store/electron-mission-store'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs')
const { startBreadcrumbQuerySession } = require('../../electron/breadcrumb-query-session.cjs')
const { createBreadcrumbQuerySessionRegistry } = require('../../electron/breadcrumb-query-session-registry.cjs')
const { registerBreadcrumbQueryIpcHandlers } = require('../../electron/breadcrumb-query-ipc.cjs')

describe('canonical transport native SQLite/worker and production bridge harness', () => {
  it('rejects the old 103626-row reply and carries the identical snapshot through bounded pulls during writes and restart', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'sar-transport-scale-'))
    const databasePath = path.join(directory, 'mission.sqlite')
    const db = new Database(databasePath)
    let registry: ReturnType<typeof createBreadcrumbQuerySessionRegistry> | undefined
    try {
      db.pragma('journal_mode = WAL')
      db.exec(`CREATE TABLE positions (id TEXT PRIMARY KEY, mission_id TEXT, device_id TEXT,
        source_position_id TEXT, timestamp TEXT, timestamp_source TEXT, lat REAL, lon REAL,
        altitude REAL, speed REAL, battery REAL, accuracy REAL, name TEXT, data_origin TEXT,
        received_at TEXT, content_hash TEXT)`)
      const insert = db.prepare("INSERT INTO positions VALUES (?, 'mission-a', ?, ?, ?, 'fix', ?, -9, ?, 0.125, 97, NULL, ?, 'live', NULL, 'immutable-hash')")
      db.transaction(() => {
        for (let index = 0; index < 103_626; index += 1) {
          insert.run(`row-${index}`, `device-${index % 32}`, `source-${index}`,
            new Date(1_700_000_000_000 + index * 1_000).toISOString(), 52 + index % 100 / 100_000,
            index === 19 ? Infinity : null, index === 33 ? 'Oversized 🧭\n"source" '.repeat(6000) : `Éire ${index}`)
        }
      })()
      const expected = listBreadcrumbPositions(db, 'mission-a', 5_000)
      expect(expected.positions).toHaveLength(103_626)
      const oldWorker = path.join(directory, 'old-whole-result.cjs')
      await writeFile(oldWorker, `const {parentPort,workerData,threadId}=require('node:worker_threads');
        const Database=require(${JSON.stringify(require.resolve('better-sqlite3'))});
        const {listBreadcrumbPositions}=require(${JSON.stringify(path.resolve('electron/breadcrumb-query.cjs'))});
        const db=new Database(workerData.databasePath);
        parentPort.postMessage({type:'complete',workerThreadId:threadId,...listBreadcrumbPositions(db,workerData.missionId,workerData.perDeviceLimit)});
        db.close();parentPort.close();`)
      await expect(startBreadcrumbQuerySession({ databasePath, missionId: 'mission-a', perDeviceLimit: 5000, workerPath: oldWorker }))
        .rejects.toThrow(/invalid frame or session message/)
      registry = createBreadcrumbQuerySessionRegistry({ databasePath })
      const handlers = new Map<string, (event: unknown, query: unknown) => Promise<unknown>>()
      const channels = { startChannel: 'sartracker:mission-store:start-breadcrumb-query',
        readChannel: 'sartracker:mission-store:read-breadcrumb-query-frame',
        finishChannel: 'sartracker:mission-store:finish-breadcrumb-query',
        cancelChannel: 'sartracker:mission-store:cancel-breadcrumb-query' }
      registerBreadcrumbQueryIpcHandlers({ ...channels,
        ipcMain: { handle: (channel: string, handler: (event: unknown, query: unknown) => Promise<unknown>) => handlers.set(channel, handler) },
        validateIpcSender: () => undefined,
        missionStore: { startBreadcrumbQuery: registry.start, readBreadcrumbQueryFrame: registry.read,
          finishBreadcrumbQuery: registry.finish, cancelBreadcrumbQuery: registry.cancel, breadcrumbQueryCompletion: registry.completion },
      })
      const sender = Object.assign(new EventEmitter(), { id: 41 })
      let frames = 0
      let outstanding = 0
      let maximumOutstanding = 0
      let maximumPayload = 0
      let changed = false
      let bridge: typeof window.sartrackerElectron
      runInNewContext(await readFile('electron/preload.cjs', 'utf8'), {
        process: { platform: 'linux' }, TextEncoder, window: { addEventListener: vi.fn() },
        require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: typeof bridge) => { bridge = value } },
          ipcRenderer: { on: vi.fn(), send: vi.fn(), sendSync: vi.fn(), removeListener: vi.fn(),
            invoke: async (channel: string, query: unknown) => {
              outstanding += 1
              maximumOutstanding = Math.max(maximumOutstanding, outstanding)
              try {
                const value = await handlers.get(channel)!({ sender }, structuredClone(query))
                if (channel === channels.startChannel && !changed) {
                  db.prepare("UPDATE positions SET name = 'changed after snapshot' WHERE id='row-0'").run()
                  changed = true
                }
                if (channel === channels.readChannel) {
                  const frame = value as { payload: string }
                  maximumPayload = Math.max(maximumPayload, frame.payload.length)
                  expect(frame.payload.length).toBeLessThanOrEqual(32_768)
                  frames += 1
                }
                return structuredClone(value)
              } finally { outstanding -= 1 }
            } },
        }),
      })
      Object.defineProperty(window, 'sartrackerElectron', { configurable: true, value: bridge })
      const client = createElectronMissionStore()
      const actual = await client.listBreadcrumbPositions!('mission-a', 5_000, 'scale-first')
      expect(actual).toEqual(expected)
      expect(frames).toBeGreaterThan(100)
      expect(maximumPayload).toBe(32_768)
      expect(maximumOutstanding).toBe(1)
      expect(registry.activeCount).toBe(0)
      expect(sender.listenerCount('destroyed')).toBe(0)
      const restarted = await client.listBreadcrumbPositions!('mission-a', 5_000, 'scale-restart')
      expect(restarted).toEqual(listBreadcrumbPositions(db, 'mission-a', 5_000))
      expect(restarted.positions[0]?.name).toBe('changed after snapshot')
    } finally {
      await registry?.shutdown()
      db.close()
      Reflect.deleteProperty(window, 'sartrackerElectron')
      await rm(directory, { recursive: true, force: true })
    }
  }, 60_000)
})
