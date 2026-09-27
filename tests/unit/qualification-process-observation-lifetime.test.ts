import { describe, expect, it, vi } from 'vitest'
import { observeWhileProcessExists } from '../../scripts/qualification/package-runtime.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { mkdtemp, writeFile, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** Model the exact filesystem error without depending on host process timing. */
function ioError(code: string) {
  return Object.assign(new Error(code), { code })
}

describe('package observation during process exit', () => {
  it('reproduces extracted ASAR removal between executable and ASAR hashes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sartracker-observer-exit-'))
    const executable = path.join(root, 'sartracker-web')
    const asar = path.join(root, 'app.asar')
    try {
      await writeFile(executable, 'synthetic executable')
      await writeFile(asar, 'synthetic ASAR')
      const result = await observeWhileProcessExists(123, async () => {
        await hashCandidateFile(executable)
        await unlink(asar)
        return hashCandidateFile(asar)
      }, async () => { throw ioError('ENOENT') })
      expect(result).toBeNull()
      await expect(observeWhileProcessExists(123, () => hashCandidateFile(asar),
        async () => ({ pid: 123, startTicks: '10' }))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it.each(['ENOENT', 'ESRCH'])('omits an incomplete sample only after confirmed process disappearance: %s', async code => {
    const sample = vi.fn().mockRejectedValue(ioError(code))
    const identity = vi.fn().mockRejectedValue(ioError('ENOENT'))
    await expect(observeWhileProcessExists(123, sample, identity)).resolves.toBeNull()
    expect(identity).toHaveBeenCalledWith(123)
  })
  it('retains a complete actual sample', async () => {
    const sample = { pid: 123, startTicks: '10' }
    const identity = vi.fn()
    await expect(observeWhileProcessExists(123, async () => sample, identity)).resolves.toBe(sample)
    expect(identity).not.toHaveBeenCalled()
  })
  it('rejects missing ASAR while the process remains alive or its PID was reused', async () => {
    const missing = ioError('ENOENT')
    for (const startTicks of ['10', '11']) {
      await expect(observeWhileProcessExists(123, async () => { throw missing },
        async () => ({ pid: 123, startTicks }))).rejects.toBe(missing)
    }
  })
  it.each(['EACCES', 'EIO', 'EPERM'])('does not hide unexpected sample errors after exit: %s', async code => {
    const error = ioError(code)
    const identity = vi.fn().mockRejectedValue(ioError('ENOENT'))
    await expect(observeWhileProcessExists(123, async () => { throw error }, identity)).rejects.toBe(error)
    expect(identity).not.toHaveBeenCalled()
  })
  it('does not hide a failed liveness check', async () => {
    const error = ioError('ENOENT')
    await expect(observeWhileProcessExists(123, async () => { throw error },
      async () => { throw ioError('EACCES') })).rejects.toThrow('EACCES')
  })
  it('does not hide identity or digest mismatch errors', async () => {
    const error = new Error('Process identity changed during observation.')
    const identity = vi.fn()
    await expect(observeWhileProcessExists(123, async () => { throw error }, identity)).rejects.toBe(error)
    expect(identity).not.toHaveBeenCalled()
  })
})
