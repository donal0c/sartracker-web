import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { runGpxEvidenceImportInWorker } = require('../../electron/gpx-evidence-import-runner.cjs') as {
  runGpxEvidenceImportInWorker(input: Readonly<Record<string, unknown>>): Promise<unknown> & {
    workerExited: Promise<void>
  }
}

describe('GPX evidence import worker runner [DON-277]', () => {
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
