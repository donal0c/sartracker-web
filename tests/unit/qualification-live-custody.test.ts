import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

import { hashLiveConfigDirectory } from '../../scripts/qualification/live-config-identity.mjs'
import { hashCandidateFile } from '../../scripts/qualification/candidate-artifacts.mjs'
import { executeLiveVariant } from '../../scripts/qualification/live-adapter.mjs'

let temporaryRoot: string | undefined

afterEach(async () => {
  vi.clearAllMocks()
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('live adapter cleanup custody', () => {
  it('does not remove live evidence directories after a launched cleanup-unproven producer', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-custody-'))
    const attemptDirectory = path.join(temporaryRoot, 'attempt')
    const workDirectory = path.join(temporaryRoot, 'work')
    await mkdir(attemptDirectory)
    await mkdir(workDirectory)
    const artifactPath = path.join(temporaryRoot, 'candidate.AppImage')
    await writeFile(artifactPath, 'candidate')
    const liveConfigPath = path.join(temporaryRoot, 'live-config')
    await mkdir(liveConfigPath)
    await writeFile(path.join(liveConfigPath, 'credentials.json'), '{}')
    await writeFile(path.join(liveConfigPath, 'settings.json'), '{}')
    const liveSelectorPath = path.join(temporaryRoot, 'live-selector.json')
    await writeFile(liveSelectorPath, '{}')
    const artifact = { role: 'ci-appimage', ...(await hashCandidateFile(artifactPath)) }
    const liveConfig = await hashLiveConfigDirectory(liveConfigPath)
    const liveSelector = await hashCandidateFile(liveSelectorPath)
    const evidenceDirectory = path.join(workDirectory, 'live-evidence')
    const privateVisualDirectory = path.join(workDirectory, 'private-visual')
    await mkdir(evidenceDirectory)
    await mkdir(privateVisualDirectory)
    preparePackageRuntime.mockResolvedValue({
      proofMode: 'ci-appimage',
      launchPath: artifactPath,
      artifactSha256: artifact.sha256,
      executableSha256: 'c'.repeat(64),
      asarSha256: 'd'.repeat(64),
      environment: {},
      installedExecutablePath: null,
    })
    runOwnedProcess.mockResolvedValue({
      supervisorPid: 123,
      zeroDescendantsAfterRun: false,
      observationResults: [],
      observationErrors: [],
      ownedPidsAfterExit: [456],
      descendantsAfterExit: [456],
      processError: 'cleanup failed',
      stdout: '',
      stderr: '',
      exitCode: null,
      signal: null,
      timedOut: false,
      outputOverflowed: false,
    })

    await expect(executeLiveVariant({
      normalized: {
        identities: { source: { sha: 'a'.repeat(40) }, candidate: { version: '0.1.0-beta.13', artifacts: [artifact] } },
        runtimeInputs: {
          schema: 'sartracker-bound-runtime-inputs-v1',
          config: { fixtures: {
            'live-config': { path: liveConfig.path, bytes: liveConfig.bytes, sha256: liveConfig.sha256 },
            'live-selector': liveSelector,
          } },
        },
      },
      binding: {
        contractId: 'C05', variantId: 'live-custody', proofMode: 'ci-appimage', liveAccess: 'GET_ONLY',
        command: ['node', 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'],
      },
      attemptDirectory,
      workDirectory,
    })).rejects.toMatchObject({
      code: 'OWNED_PROCESS_CLEANUP_BLOCKED',
      adapterId: 'live.get-only',
      resourceCleanupBlocked: true,
    })
    expect((await lstat(evidenceDirectory)).isDirectory()).toBe(true)
    expect((await lstat(privateVisualDirectory)).isDirectory()).toBe(true)
    expect(runOwnedProcess).toHaveBeenCalledOnce()
  })
})
