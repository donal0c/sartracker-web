import { describe, expect, it } from 'vitest'

import { runOwnedProcess } from '../../scripts/qualification/owned-process.mjs'

const node = process.execPath

describe('qualification owned process runner', () => {
  it.each([31, 32])('accepts output at or exactly at the byte cap (%i bytes)', async (size) => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', `process.stdout.write('x'.repeat(${size}))`],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      maxOutputBytes: 32,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.outputOverflowed).toBe(false)
    expect(Buffer.byteLength(result.stdout)).toBe(size)
    expect(result.processError).toBe(null)
  })

  it('caps retained output bytes and fails closed on overflow', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', "process.stdout.write('x'.repeat(200))"],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      maxOutputBytes: 32,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
    })

    expect(result.outputOverflowed).toBe(true)
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(32)
    expect(result.processError).toMatch(/output|capture|limit/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it('retains observation failures and terminates the owned producer', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 1_000,
      terminationGraceMs: 100,
      observe: async () => {
        throw new Error('synthetic observation failure')
      },
      observeIntervalMs: 10,
    })

    expect(result.observationErrors).toContain('synthetic observation failure')
    expect(result.processError).toMatch(/observation/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it('does not let a hung observer bypass the producer timeout', async () => {
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', 'setTimeout(() => {}, 10_000)'],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 100,
      cleanupTimeoutMs: 500,
      terminationGraceMs: 50,
      observe: () => new Promise(() => {}),
      observeIntervalMs: 10,
    })

    expect(result.timedOut).toBe(true)
    expect(result.observationErrors.join(' ')).toMatch(/did not complete/iu)
    expect(result.processError).toMatch(/observation|timeout/iu)
    expect(result.zeroDescendantsAfterRun).toBe(true)
  })

  it.skipIf(process.platform === 'win32')('cleans a same-group child after normal parent exit', async () => {
    const source = [
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { stdio: 'ignore' }); child.unref()",
    ].join(';')
    const result = await runOwnedProcess({
      file: node,
      args: ['-e', source],
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5_000,
      cleanupTimeoutMs: 2_000,
      terminationGraceMs: 100,
    })

    expect(result.exitCode).toBe(0)
    expect(result.zeroDescendantsAfterRun).toBe(true)
    expect(result.ownedPidsAfterExit).toEqual([])
  })
})
