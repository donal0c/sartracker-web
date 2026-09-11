import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createElectronMissionStore } = require('../../electron/mission-store.cjs')
const Database = require('better-sqlite3')

it.each(['complete', 'shutdown'] as const)('keeps the main loop below 200 ms when startup archive bookkeeping meets a background SQLite writer during %s [DON-254]', async (mode) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'sar-startup-contention-'))
  const gate = new Int32Array(new SharedArrayBuffer(8))
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads')
    const Database = require('better-sqlite3')
    const gate = new Int32Array(workerData.gate)
    parentPort.postMessage('ready')
    Atomics.wait(gate, 0, 0, 5000)
    const db = new Database(workerData.databasePath)
    db.exec('BEGIN IMMEDIATE')
    Atomics.store(gate, 1, 1)
    Atomics.notify(gate, 1)
    Atomics.wait(gate, 0, 1, 350)
    db.exec('ROLLBACK')
    db.close()
    parentPort.close()
  `, { eval: true, workerData: { gate: gate.buffer, databasePath: path.join(directory, 'mission-store.sqlite') } })
  const exited = new Promise<void>((resolve, reject) => {
    worker.once('error', reject)
    worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Lock worker exited ${code}`)))
  })
  void exited.catch(() => undefined)
  let store: { prepareClose(): Promise<void>; close(): void } | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let shutdown: Promise<void> | undefined
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined
  let inspection: ReturnType<typeof Database> | undefined
  try {
    await new Promise<void>(resolve => worker.once('message', () => resolve()))
    store = createElectronMissionStore({ userDataPath: directory })
    inspection = new Database(path.join(directory, 'mission-store.sqlite'))
    inspection.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('legacy_archive_registry_backfill_failure', 'old marker')
    inspection.prepare('INSERT INTO metadata (key, value) VALUES (?, ?)').run('archive_registry_reconciliation_failure', 'old marker')
    Atomics.store(gate, 0, 1)
    Atomics.notify(gate, 0)
    // Test setup waits for independently owned SQLite contention before measuring the main loop.
    if (Atomics.load(gate, 1) === 0) Atomics.wait(gate, 1, 0, 5_000)
    expect(Atomics.load(gate, 1)).toBe(1)
    let previous = performance.now()
    let maximumGapMs = 0
    const cpu = process.cpuUsage()
    heartbeat = setInterval(() => {
      const now = performance.now()
      maximumGapMs = Math.max(maximumGapMs, now - previous)
      previous = now
    }, 10)
    if (mode === 'shutdown') shutdownTimer = setTimeout(() => {
      shutdown = store!.prepareClose()
      void shutdown.catch(() => undefined)
    }, 25)
    await exited
    await shutdown
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const remaining = inspection.prepare(`SELECT key FROM metadata WHERE key IN (
        'legacy_archive_registry_backfill_failure', 'archive_registry_reconciliation_failure')`).all()
      if (mode === 'shutdown' || remaining.length === 0) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(inspection.prepare("SELECT value FROM metadata WHERE key = 'legacy_archive_registry_backfill_cursor'").get()).toEqual({ value: '0' })
    expect(inspection.prepare("SELECT value FROM metadata WHERE key = 'legacy_archive_registry_backfill_failure'").get()).toBeUndefined()
    if (mode === 'complete') expect(inspection.prepare("SELECT value FROM metadata WHERE key = 'archive_registry_reconciliation_failure'").get()).toBeUndefined()
    else expect(shutdown).toBeDefined()
    const used = process.cpuUsage(cpu)
    const evidence = { maximumGapMs, processCpuMs: (used.user + used.system) / 1000 }
    process.stdout.write(`Startup SQLite contention: ${JSON.stringify(evidence)}\n`)
    expect(maximumGapMs, JSON.stringify(evidence)).toBeLessThan(200)
  } finally {
    clearInterval(heartbeat)
    clearTimeout(shutdownTimer)
    Atomics.store(gate, 0, 2)
    Atomics.notify(gate, 0)
    await worker.terminate()
    await store?.prepareClose()
    store?.close()
    inspection?.close()
    await rm(directory, { recursive: true, force: true })
  }
})
