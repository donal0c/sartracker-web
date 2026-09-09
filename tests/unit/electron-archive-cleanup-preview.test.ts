import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
import { Worker } from 'node:worker_threads'
const require = createRequire(import.meta.url)
const { normalizeCleanupPreview } = require('../../electron/archive-cleanup-preview.cjs') as {
  normalizeCleanupPreview: (value: unknown, missionId: string) => unknown
}

it('can be imported by another worker without executing the preview entry point', async () => {
  const modulePath = require.resolve('../../electron/archive-cleanup-preview.cjs')
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    require(workerData.modulePath); parentPort.postMessage('imported');`, {
    eval: true, workerData: { modulePath },
  })
  const result = new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
  await expect(result).resolves.toBe('imported')
  await new Promise((resolve) => worker.once('exit', resolve))
})

it('accepts only mission-bound consistent row totals from the preview worker', () => {
  const value = { missionId: 'm', totalRows: 5, tables: [{ tableName: 'positions', rowCount: 5 }] }
  expect(normalizeCleanupPreview(value, 'm')).toEqual(value)
  for (const invalid of [{ ...value, missionId: 'other' }, { ...value, totalRows: 6 },
    { ...value, tables: [{ tableName: '../private', rowCount: 5 }] },
    { ...value, tables: [{ tableName: 'positions', rowCount: -1 }] }]) {
    expect(() => normalizeCleanupPreview(invalid, 'm')).toThrow()
  }
})
