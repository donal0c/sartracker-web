import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runGpxEvidenceImportInWorker } = require('../../electron/gpx-evidence-import-runner.cjs') as {
  runGpxEvidenceImportInWorker(input: Readonly<Record<string, unknown>>): Promise<unknown> & {
    workerExited: Promise<void>
  }
}
const { validateGpxImportEnvelope } = require('../../electron/gpx-import-envelope.cjs') as {
  validateGpxImportEnvelope(input: Readonly<Record<string, unknown>>): {
    readonly missionId: string
    readonly paths: readonly string[]
  }
}

describe('GPX evidence import worker runner [DON-277]', () => {
  it('passes the foreground admission counter into the worker and rejects malformed counters', async () => {
    const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    worker.terminate = vi.fn(async () => 0)
    const createWorker = vi.fn(() => worker)
    const result = runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite', missionId: 'mission-1', paths: ['/tmp/evidence.gpx'],
      foregroundWriterBuffer: buffer, createWorker,
    })
    worker.emit('message', { type: 'complete', imports: [], failures: [] })
    worker.emit('exit', 0)
    await result
    expect(createWorker).toHaveBeenCalledWith(expect.objectContaining({
      workerData: expect.objectContaining({ foregroundWriterBuffer: buffer }),
    }))
    expect(() => runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite', missionId: 'mission-1', paths: ['/tmp/evidence.gpx'],
      foregroundWriterBuffer: new SharedArrayBuffer(8), createWorker,
    })).toThrow(/counter/)
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('trims bounded mission and path scalars only after raw envelope admission', () => {
    expect(validateGpxImportEnvelope({
      missionId: '  mission-1  ',
      paths: ['  /tmp/evidence.gpx  '],
    })).toEqual({ missionId: 'mission-1', paths: ['/tmp/evidence.gpx'] })

    const maximumMissionId = 'm'.repeat(1_000)
    const maximumPath = `/${'x'.repeat(4_095)}`
    expect(validateGpxImportEnvelope({
      missionId: maximumMissionId,
      paths: [maximumPath],
    })).toEqual({ missionId: maximumMissionId, paths: [maximumPath] })
  })

  it('carries only a boolean watched-folder retired-source option [DON-320]', () => {
    expect(validateGpxImportEnvelope({
      missionId: 'mission-1', paths: ['/watch/a.gpx'], skipRetiredSources: true,
    })).toEqual({ missionId: 'mission-1', paths: ['/watch/a.gpx'], skipRetiredSources: true })
    expect(validateGpxImportEnvelope({
      missionId: 'mission-1', paths: ['/watch/a.gpx'], skipRetiredSources: false,
    })).toEqual({ missionId: 'mission-1', paths: ['/watch/a.gpx'] })
    expect(() => validateGpxImportEnvelope({
      missionId: 'mission-1', paths: ['/watch/a.gpx'], skipRetiredSources: 1,
    })).toThrow(/retired-source option/u)
  })

  it('rejects non-object import envelopes and oversized mission or path scalars before worker creation', () => {
    const createWorker = vi.fn()

    expect(() => runGpxEvidenceImportInWorker([])).toThrow(/payload.*object/iu)
    expect(() => runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite',
      missionId: 'm'.repeat(1_001),
      paths: ['/tmp/evidence.gpx'],
      createWorker,
    })).toThrow(/mission ID.*1000/iu)
    expect(() => runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite',
      missionId: 'mission-1',
      paths: [`/${'x'.repeat(4_096)}`],
      createWorker,
    })).toThrow(/path.*4096/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('rejects more than 100 paths without constructing an import worker', () => {
    const createWorker = vi.fn()

    expect(() => runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite',
      missionId: 'mission-1',
      paths: Array.from({ length: 101 }, (_, index) => `/tmp/${index}.gpx`),
      createWorker,
    })).toThrow(/path count.*between 1 and 100/iu)
    expect(createWorker).not.toHaveBeenCalled()
  })

  it('settles the worker-exit join when worker construction fails synchronously', async () => {
    const constructionFailure = new Error('worker construction failed')
    const importResult = runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite',
      missionId: 'mission-1',
      paths: ['/tmp/evidence.gpx'],
      createWorker: () => { throw constructionFailure },
    })

    await expect(importResult).rejects.toBe(constructionFailure)
    await expect(Promise.race([
      importResult.workerExited.then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ])).resolves.toBe('settled')
  })

  it('terminates and joins an import worker when shutdown cancels it', async () => {
    const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
    const terminate = vi.fn(async () => {
      queueMicrotask(() => worker.emit('exit', 1))
      return 1
    })
    worker.terminate = terminate
    const controller = new AbortController()
    const importResult = runGpxEvidenceImportInWorker({
      databasePath: '/tmp/unused.sqlite',
      missionId: 'mission-1',
      paths: ['/tmp/evidence.gpx'],
      signal: controller.signal,
      createWorker: () => worker,
    })

    controller.abort()
    await expect(importResult).rejects.toMatchObject({ name: 'AbortError' })
    await importResult.workerExited
    expect(terminate).toHaveBeenCalledOnce()
  })

  describe('inactivity watchdog [DON-350] [M-36]', () => {
    /** A mock worker that the test drives message by message. */
    function createMockWorker() {
      const worker = new EventEmitter() as EventEmitter & { terminate: () => Promise<number> }
      worker.terminate = vi.fn(async () => {
        queueMicrotask(() => worker.emit('exit', 1))
        return 1
      })
      return worker
    }

    it('keeps a long batch alive while the worker keeps reporting progress', async () => {
      vi.useFakeTimers()
      try {
        const worker = createMockWorker()
        const result = runGpxEvidenceImportInWorker({
          databasePath: '/tmp/unused.sqlite', missionId: 'mission-1', paths: ['/tmp/a.gpx', '/tmp/b.gpx'],
          createWorker: () => worker,
        })
        for (let elapsed = 0; elapsed < 200_000; elapsed += 10_000) {
          await vi.advanceTimersByTimeAsync(10_000)
          worker.emit('message', { type: 'heartbeat' })
        }
        worker.emit('message', { type: 'complete', imports: [], failures: [] })
        worker.emit('exit', 0)
        await expect(result).resolves.toMatchObject({ imports: [], failures: [] })
        expect(worker.terminate).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    it('stops a worker that has gone quiet and says it stalled, not that it was large', async () => {
      vi.useFakeTimers()
      try {
        const worker = createMockWorker()
        const result = runGpxEvidenceImportInWorker({
          databasePath: '/tmp/unused.sqlite', missionId: 'mission-1', paths: ['/tmp/a.gpx'],
          createWorker: () => worker,
          inactivityTimeoutMs: 5_000,
        })
        const settled = result.then(() => null, (error: unknown) => error)
        worker.emit('message', { type: 'progress', completed: 0, total: 1 })
        await vi.advanceTimersByTimeAsync(4_000)
        worker.emit('message', { type: 'heartbeat' })
        await vi.advanceTimersByTimeAsync(4_000)
        expect(worker.terminate).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1_500)
        expect(worker.terminate).toHaveBeenCalledTimes(1)
        expect(String(await settled)).toMatch(/stopped responding for 5 s/u)
        await result.workerExited
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
