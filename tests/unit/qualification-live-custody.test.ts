import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const { runOwnedProcess, preparePackageRuntime } = vi.hoisted(() => ({
  runOwnedProcess: vi.fn(),
  preparePackageRuntime: vi.fn(),
}))

vi.mock('../../scripts/qualification/owned-process.mjs', () => ({ runOwnedProcess }))
vi.mock('../../scripts/qualification/package-runtime.mjs', () => ({
  preparePackageRuntime,
  observePackageProcesses: vi.fn(),
}))

import { executeLiveVariant } from '../../scripts/qualification/live-adapter.mjs'

let temporaryRoot: string | undefined

afterEach(async () => {
  vi.clearAllMocks()
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('retired packaged live exact smoke [DON-302]', () => {
  it('refuses to run, points to team-smoke live-traccar, and launches or writes nothing', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-retired-'))
    const attemptDirectory = path.join(temporaryRoot, 'attempt')
    const workDirectory = path.join(temporaryRoot, 'work')
    await mkdir(attemptDirectory)
    await mkdir(workDirectory)

    await expect(executeLiveVariant({
      normalized: {},
      binding: {
        contractId: 'C05', variantId: 'live', proofMode: 'ci-appimage', liveAccess: 'GET_ONLY',
        command: ['node', 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'],
      },
      attemptDirectory,
      workDirectory,
    })).rejects.toThrow(/retired.*team-smoke live-traccar/isu)

    expect(preparePackageRuntime).not.toHaveBeenCalled()
    expect(runOwnedProcess).not.toHaveBeenCalled()
    expect(await readdir(attemptDirectory)).toEqual([])
    expect(await readdir(workDirectory)).toEqual([])
  })
})
