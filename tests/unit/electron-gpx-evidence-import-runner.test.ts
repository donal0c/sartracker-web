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
})
