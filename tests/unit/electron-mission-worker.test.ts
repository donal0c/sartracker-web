import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { Worker } = require('../../electron/mission-worker.cjs') as typeof import('node:worker_threads')

it('contains excessive JavaScript heap allocation to the worker and reports its exit', async () => {
  const worker = new Worker('const retained = []; for (;;) retained.push(new Array(16384).fill(Math.random()));', { eval: true })
  const failure = new Promise<Error>((resolve) => worker.once('error', resolve))
  const exit = new Promise<number>((resolve) => worker.once('exit', resolve))
  try {
    expect(worker.resourceLimits.maxOldGenerationSizeMb).toBeGreaterThan(0)
    await expect(failure).resolves.toMatchObject({ code: 'ERR_WORKER_OUT_OF_MEMORY' })
    await expect(exit).resolves.toBe(1)
  } finally { await worker.terminate() }
}, 15_000)
