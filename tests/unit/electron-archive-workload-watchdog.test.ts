import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { deriveArchiveWorkloadWatchdogMs } = require('../../electron/archive-workload-watchdog.cjs') as {
  deriveArchiveWorkloadWatchdogMs: (progress: unknown, baselineMs: number) => number
}

describe('archive workload watchdog', () => {
  it('extends only silent native validation phases according to workload bytes', () => {
    expect(deriveArchiveWorkloadWatchdogMs({ phase: 'sqlite', unit: 'bytes', total: 8 * 1024 ** 3 }, 60_000)).toBe(2_108_000)
    expect(deriveArchiveWorkloadWatchdogMs({ phase: 'validate', unit: 'bytes', total: 1 }, 90_000)).toBe(90_000)
    expect(deriveArchiveWorkloadWatchdogMs({ phase: 'encrypt', unit: 'bytes', total: 8 * 1024 ** 3 }, 60_000)).toBe(60_000)
  })

  it.each([null, {}, { phase: 'sqlite', unit: 'rows', total: 100 }, ...[0, -1, NaN, Infinity, 1.5, '100', Number.MAX_SAFE_INTEGER + 1].map((total) => ({ phase: 'sqlite', unit: 'bytes', total }))])('retains the baseline for invalid workload metadata %#', (progress) => {
    expect(deriveArchiveWorkloadWatchdogMs(progress, 60_000)).toBe(60_000)
  })
})
