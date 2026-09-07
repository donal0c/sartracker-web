import { spawn } from 'node:child_process'
import { readFileSync, unlinkSync } from 'node:fs'
import fsPromises, {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { EventEmitter, once } from 'node:events'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const fileSystemOverrides = await vi.hoisted(async () => {
  const native = (await import('node:fs/promises')).default
  const { syncBuiltinESMExports } = await import('node:module')
  const originalLstat = native.lstat
  const originalLink = native.link
  const overrides = {
    lstat: undefined as typeof native.lstat | undefined,
    link: undefined as typeof native.link | undefined,
    originalLstat,
    originalLink,
    restore: () => {
      native.lstat = originalLstat
      native.link = originalLink
      syncBuiltinESMExports()
    },
  }
  // Native .mjs imports capture these forwarding functions before the test
  // controls individual filesystem boundaries. All unselected calls stay real.
  native.lstat = ((...args: Parameters<typeof originalLstat>) =>
    (overrides.lstat ?? originalLstat)(...args)) as typeof originalLstat
  native.link = (...args: Parameters<typeof originalLink>) => (overrides.link ?? originalLink)(...args)
  syncBuiltinESMExports()
  return overrides
})

afterAll(() => fileSystemOverrides.restore())

import {
  cleanupArchiveLifecycleResources,
  closeRendererTransports,
  createArchiveLifecycleEvidenceValidationFailure,
  isExactLivenessParticipantReady,
  prepareArchiveLifecycleEvidenceDirectory,
  readArchiveReviewContent,
  selectExactRendererTarget,
  waitForActiveMission,
  waitForExactLivenessParticipant,
  withArchiveLifecycleWorkloadTimeout,
  writeArchiveLifecycleFailureReceipt,
  writeArchiveLifecycleSuccessReport,
} from '../../scripts/electron-archive-lifecycle-smoke.mjs'
import {
  consumeArchiveLifecycleSupervisorTerminalArtifact,
  createArchiveLifecycleSupervisorFailureReceipt,
  ensureArchiveLifecycleSupervisorTerminalArtifact,
  publishArchiveLifecycleSupervisorCanonicalArtifact,
  prepareArchiveLifecycleSupervisorTerminalRun as prepareArchiveLifecycleSupervisorTerminalRunRaw,
  readExactSourceIdentity,
  waitForArchiveLifecycleChildExit,
} from '../../scripts/electron-archive-lifecycle-smoke-ci.mjs'
import { createPackagedArchiveLifecycleV2Evidence } from '../fixtures/packaged-archive-lifecycle-v2'

const require = createRequire(import.meta.url)
const { encodeCleanupFailureDiagnosticToken } = require(
  '../../electron/archive-cleanup-failure.cjs',
) as {
  readonly encodeCleanupFailureDiagnosticToken: (diagnostic: unknown) => string
}

const runnerPath = path.resolve('scripts/electron-archive-lifecycle-smoke.mjs')
const ciRunnerPath = path.resolve('scripts/electron-archive-lifecycle-smoke-ci.mjs')
const workflowPath = path.resolve('.github/workflows/electron-linux-validation.yml')
const supervisorChildEvidenceDirectories = new Set<string>()
const supervisorLeaseDirectories = new Set<string>()

/** Tracks every random sibling staging directory so a failed test cannot retain private fixtures. */
async function prepareArchiveLifecycleSupervisorTerminalRun(
  input: Parameters<typeof prepareArchiveLifecycleSupervisorTerminalRunRaw>[0],
  dependencies?: Parameters<typeof prepareArchiveLifecycleSupervisorTerminalRunRaw>[1],
) {
  const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRunRaw(input, dependencies)
  supervisorChildEvidenceDirectories.add(terminalRun.childEvidenceDir)
  if (typeof terminalRun.leaseDir === 'string') {
    supervisorLeaseDirectories.add(terminalRun.leaseDir)
  }
  return terminalRun
}

afterEach(async () => {
  const ownedDirectories = [...supervisorChildEvidenceDirectories]
  const ownedLeaseDirectories = [...supervisorLeaseDirectories]
  supervisorChildEvidenceDirectories.clear()
  supervisorLeaseDirectories.clear()
  await Promise.all([...ownedDirectories, ...ownedLeaseDirectories].map((directory) =>
    rm(directory, { recursive: true, force: true })))
})

/** Creates a canonical-path temporary directory for supervisor boundary tests. */
async function createSupervisorTestDirectory(prefix: string) {
  return mkdtemp(path.join(await realpath(os.tmpdir()), prefix))
}

/** Reports whether one exact process identifier still accepts a signal-zero probe. */
function processExists(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Waits a short bounded interval for one test-owned child to be physically reaped. */
async function waitForTestChildExit(child: EventEmitter & {
  readonly exitCode?: number | null
  readonly signalCode?: NodeJS.Signals | null
}, timeoutMs: number) {
  if (child.exitCode !== null && child.exitCode !== undefined) return
  if (child.signalCode !== null && child.signalCode !== undefined) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      reject(new Error('Test-owned wrapper did not exit within its bound.'))
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', onExit)
  })
}

/** Builds one internally consistent terminal-receipt input for adversarial tests. */
function createFailureReceiptInput(
  evidenceDir: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    evidenceDir,
    error: new Error('Primary lifecycle failure.'),
    expectedHead: 'a'.repeat(40),
    observedLaunchCount: 1,
    processCleanupCompleted: true,
    profileCleanupCompleted: true,
    cleanupFailureCount: 0,
    cleanupFailures: [],
    secrets: [],
    sourceBefore: {
      head: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      clean: true,
    },
    startedAtMs: Date.now() - 10,
    ...overrides,
  }
}

/** Binds fixture success evidence to one exact supervisor invocation and current host. */
function createSupervisorSuccessEvidence(
  terminalRun: Readonly<{
    expectedHead: string
    expectedTree: string
    startedAtMs: number
  }>,
  overrides: Readonly<{
    startedAtMs?: number
    finishedAtMs?: number
    platform?: NodeJS.Platform
    architecture?: string
    nodeVersion?: string
  }> = {},
) {
  const evidence = createPackagedArchiveLifecycleV2Evidence()
  const startedAtMs = overrides.startedAtMs ?? terminalRun.startedAtMs + 1
  const finishedAtMs = overrides.finishedAtMs ?? startedAtMs + 1
  evidence.source = {
    ...(evidence.source as Record<string, unknown>),
    expectedHead: terminalRun.expectedHead,
    headBefore: terminalRun.expectedHead,
    headAfter: terminalRun.expectedHead,
    treeBefore: terminalRun.expectedTree,
    treeAfter: terminalRun.expectedTree,
  }
  evidence.run = {
    ...(evidence.run as Record<string, unknown>),
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    platform: overrides.platform ?? process.platform,
    architecture: overrides.architecture ?? os.arch(),
    nodeVersion: overrides.nodeVersion ?? process.version,
  }
  return evidence
}

describe('packaged archive-lifecycle process-faithful liveness runner [DON-252 / BCP-15]', () => {
  it('owns one exact-source timeout receipt when the lifecycle child cannot report', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-supervisor-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      expect(terminalRun.childEvidenceDir).not.toBe(evidenceDir)
      expect(path.dirname(terminalRun.childEvidenceDir)).toBe(path.dirname(evidenceDir))
      expect((await lstat(evidenceDir)).mode & 0o777).toBe(0o700)
      expect((await lstat(terminalRun.childEvidenceDir)).mode & 0o777).toBe(0o700)
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_timeout',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      const failurePath = path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-failure.json',
      )
      const identity = await lstat(failurePath)
      const serialized = await readFile(failurePath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect(terminal).toEqual({ kind: 'failure', path: failurePath, published: true })
      expect(identity.isFile()).toBe(true)
      expect(identity.isSymbolicLink()).toBe(false)
      expect(identity.mode & 0o777).toBe(0o600)
      expect((await readdir(evidenceDir)).sort()).toEqual([
        '.electron-archive-lifecycle-terminal-owner.json',
        `.electron-archive-lifecycle-terminal-run-owner-${terminalRun.runId}.json`,
        'electron-archive-lifecycle-smoke-failure.json',
      ].sort())
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        proofKind: 'packaged-electron-archive-lifecycle-failure-v1',
        source: {
          expectedHead: source.expectedHead,
          expectedTree: source.expectedTree,
          headBefore: source.observedHead,
          treeBefore: source.observedTree,
          worktreeCleanBefore: true,
        },
        failure: {
          classification: 'archive_lifecycle_child_timeout',
        },
        cleanup: {
          processCleanupCompleted: false,
          profileCleanupCompleted: false,
        },
        verdict: { passed: false },
      })
      expect(serialized.length).toBeLessThan(8_000)
      expect(serialized).not.toMatch(/stack|passphrase|recoveryCode|missionId|\/tmp\//u)

      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source: { ...source, expectedTree: 'c'.repeat(40) },
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })).rejects.toThrow(/exact source|terminal run/iu)
      expect(await readFile(failurePath, 'utf8')).toBe(serialized)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('preserves child evidence and fails closed for contradictory terminal ownership', async () => {
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const successDir = await createSupervisorTestDirectory('sartracker-lifecycle-success-')
    const contradictoryDir = await createSupervisorTestDirectory(
      'sartracker-lifecycle-contradictory-',
    )
    try {
      const successRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: successDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const successPath = path.join(
        successDir,
        'electron-archive-lifecycle-smoke-report.json',
      )
      const successEvidence = createSupervisorSuccessEvidence(successRun)
      const successContents = `${JSON.stringify(successEvidence, null, 2)}\n`
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: successRun.childEvidenceDir,
        evidence: successEvidence,
      })

      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir: successDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: successRun.startedAtMs,
        terminalRun: successRun,
      })).resolves.toEqual({ kind: 'success', path: successPath, published: true })
      expect(await readFile(successPath, 'utf8')).toBe(successContents)
      expect((await readdir(successDir)).sort()).toEqual([
        '.electron-archive-lifecycle-terminal-owner.json',
        `.electron-archive-lifecycle-terminal-run-owner-${successRun.runId}.json`,
        'electron-archive-lifecycle-smoke-report.json',
      ].sort())
      await expect(access(path.join(
        successDir,
        'electron-archive-lifecycle-smoke-failure.json',
      ))).rejects.toMatchObject({ code: 'ENOENT' })

      const contradictoryRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: contradictoryDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeFile(path.join(
        contradictoryRun.childEvidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ), successContents, { mode: 0o600 })
      await writeFile(path.join(
        contradictoryRun.childEvidenceDir,
        'electron-archive-lifecycle-smoke-failure.json',
      ), '{"verdict":{"passed":false}}\n', { mode: 0o600 })
      const contradictory = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir: contradictoryDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: contradictoryRun.startedAtMs,
        terminalRun: contradictoryRun,
      }, { readSourceIdentity: async () => source })
      expect(contradictory).toMatchObject({ kind: 'failure', published: true })
      expect(JSON.parse(await readFile(contradictory.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
        verdict: { passed: false },
      })
    } finally {
      await Promise.all([
        rm(successDir, { recursive: true, force: true }),
        rm(contradictoryDir, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects a stale prior-head artifact instead of accepting filename presence', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-stale-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const staleEvidence = createPackagedArchiveLifecycleV2Evidence()
      staleEvidence.source = {
        ...(staleEvidence.source as Record<string, unknown>),
        expectedHead: 'c'.repeat(40),
        headBefore: 'c'.repeat(40),
        headAfter: 'c'.repeat(40),
        treeBefore: 'd'.repeat(40),
        treeAfter: 'd'.repeat(40),
      }
      await writeFile(path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ), `${JSON.stringify(staleEvidence)}\n`, { mode: 0o600 })
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await expect(access(path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ))).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(path.join(
        terminalRun.childEvidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ), `${JSON.stringify(staleEvidence)}\n`, { mode: 0o600 })

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(terminal).toMatchObject({ kind: 'failure', published: true })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        source: {
          expectedHead: source.expectedHead,
          expectedTree: source.expectedTree,
          treeBefore: source.observedTree,
        },
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('does not let a late child replace a supervisor-owned timeout receipt', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-late-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_timeout',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      const supervisorReceipt = await readFile(terminal.path, 'utf8')

      await expect(writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createPackagedArchiveLifecycleV2Evidence(),
      })).resolves.toBe(path.join(
        terminalRun.childEvidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ))
      expect(await readFile(terminal.path, 'utf8')).toBe(supervisorReceipt)
      await expect(access(path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ))).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(terminalRun.childEvidenceDir)).resolves.toBeUndefined()
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects an exact-source fake success that has not passed the full evidence gate', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-fake-pass-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeFile(path.join(
        terminalRun.childEvidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      ), `${JSON.stringify({
        schemaVersion: 2,
        proofKind: 'packaged-electron-archive-lifecycle-v2',
        source: {
          expectedHead: source.expectedHead,
          headBefore: source.expectedHead,
          headAfter: source.expectedHead,
          treeBefore: source.expectedTree,
          treeAfter: source.expectedTree,
          worktreeCleanBefore: true,
          worktreeCleanAfter: true,
        },
        verdict: { passed: true },
      })}\n`, { mode: 0o600 })

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(terminal).toMatchObject({ kind: 'failure', published: true })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('never promotes staged success after nonzero exit and preserves valid staged failure', async () => {
    const successDir = await createSupervisorTestDirectory('sartracker-lifecycle-exit-success-')
    const failureDir = await createSupervisorTestDirectory('sartracker-lifecycle-exit-failure-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const successRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: successDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: successRun.childEvidenceDir,
        evidence: createPackagedArchiveLifecycleV2Evidence(),
      })
      const rejectedSuccess = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir: successDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: successRun.startedAtMs,
        terminalRun: successRun,
      }, { readSourceIdentity: async () => source })
      expect(rejectedSuccess.kind).toBe('failure')
      expect(JSON.parse(await readFile(rejectedSuccess.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })

      const failureRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: failureDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const diagnosticError = new Error('External liveness gate failed.')
      Object.defineProperty(diagnosticError, 'archiveLifecycleDiagnostics', {
        value: Object.freeze({
          activePhase: 'restore',
          errorKinds: Object.freeze(['operation_deadline_exceeded']),
        }),
      })
      const stagedFailurePath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(failureRun.childEvidenceDir, { error: diagnosticError }),
      )
      const stagedFailure = await readFile(stagedFailurePath, 'utf8')
      const preservedFailure = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir: failureDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: failureRun.startedAtMs,
        terminalRun: failureRun,
      })
      expect(preservedFailure).toMatchObject({ kind: 'failure', published: true })
      expect(await readFile(preservedFailure.path, 'utf8')).toBe(stagedFailure)
    } finally {
      await Promise.all([
        rm(successDir, { recursive: true, force: true }),
        rm(failureDir, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects an already-owned canonical success after a later observed nonzero exit', async () => {
    const evidenceDir = await createSupervisorTestDirectory(
      'sartracker-lifecycle-owned-success-nonzero-',
    )
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createSupervisorSuccessEvidence(terminalRun),
      })
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })).resolves.toMatchObject({ kind: 'success' })

      for (const outcome of [
        {
          childExitCode: 1,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
        },
        {
          childExitCode: null,
          failureClassification: 'archive_lifecycle_child_timeout',
        },
        {
          childExitCode: null,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
        },
      ] as const) {
        await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
          ...outcome,
          evidenceDir,
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        })).rejects.toThrow(/success.*exit|outcome.*success/iu)
      }
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects staged success from a prior run on another supported host', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-prior-success-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createSupervisorSuccessEvidence(terminalRun, {
          startedAtMs: terminalRun.startedAtMs - 1,
          platform: process.platform === 'darwin' ? 'linux' : 'darwin',
          architecture: os.arch() === 'arm64' ? 'x64' : 'arm64',
        }),
      })

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(terminal.kind).toBe('failure')
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('rejects a staged child failure whose run began before its supervisor invocation', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-prior-failure-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        terminalRun.childEvidenceDir,
        { startedAtMs: terminalRun.startedAtMs - 1 },
      ))

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it.each([
    { kind: 'success', timestamp: 'startedAt', startOffsetMs: 11, endOffsetMs: 12 },
    { kind: 'success', timestamp: 'finishedAt', startOffsetMs: 1, endOffsetMs: 11 },
    { kind: 'failure', timestamp: 'startedAt', startOffsetMs: 11, endOffsetMs: 12 },
    { kind: 'failure', timestamp: 'failedAt', startOffsetMs: 1, endOffsetMs: 11 },
  ] as const)(
    'rejects staged $kind evidence whose $timestamp is later than the ensure observation',
    async ({ kind, startOffsetMs, endOffsetMs }) => {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-future-run-')
      const source = {
        expectedHead: 'a'.repeat(40),
        expectedTree: 'b'.repeat(40),
        observedHead: 'a'.repeat(40),
        observedTree: 'b'.repeat(40),
        worktreeClean: true,
      }
      const supervisorStartedAtMs = Date.now() - 100
      const observedAtMs = supervisorStartedAtMs + 10
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: supervisorStartedAtMs,
        })
        const childStartedAtMs = supervisorStartedAtMs + startOffsetMs
        const childEndedAtMs = supervisorStartedAtMs + endOffsetMs
        if (kind === 'success') {
          await writeArchiveLifecycleSuccessReport({
            evidenceDir: terminalRun.childEvidenceDir,
            evidence: createSupervisorSuccessEvidence(terminalRun, {
              startedAtMs: childStartedAtMs,
              finishedAtMs: childEndedAtMs,
            }),
          })
        } else {
          const failurePath = await writeArchiveLifecycleFailureReceipt(
            createFailureReceiptInput(terminalRun.childEvidenceDir),
          )
          const failure = JSON.parse(await readFile(failurePath, 'utf8'))
          failure.run.startedAt = new Date(childStartedAtMs).toISOString()
          failure.run.failedAt = new Date(childEndedAtMs).toISOString()
          failure.run.durationMs = childEndedAtMs - childStartedAtMs
          await writeFile(failurePath, `${JSON.stringify(failure)}\n`, { mode: 0o600 })
        }

        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode: kind === 'success' ? 0 : 1,
          evidenceDir,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        }, {
          nowMs: () => observedAtMs,
          readSourceIdentity: async () => source,
        })

        expect(terminal.kind).toBe('failure')
        expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
          failure: { classification: 'archive_lifecycle_child_unreported_failure' },
        })
      } finally {
        await rm(evidenceDir, { recursive: true, force: true })
      }
    },
  )

  it.each([
    { name: 'success', childExitCode: 0, stagedKind: 'success' },
    { name: 'failure', childExitCode: 1, stagedKind: 'failure' },
  ] as const)(
    'removes private staged $name evidence only after a reaped child has canonical ownership',
    async ({ childExitCode, stagedKind }) => {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-staging-clean-')
      const source = {
        expectedHead: 'a'.repeat(40),
        expectedTree: 'b'.repeat(40),
        observedHead: 'a'.repeat(40),
        observedTree: 'b'.repeat(40),
        worktreeClean: true,
      }
      let childEvidenceDir: string | null = null
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: Date.now() - 25,
        })
        childEvidenceDir = terminalRun.childEvidenceDir
        const privateStagingMarker = 'raw-private-staging-marker-must-not-survive'
        await writeFile(
          path.join(terminalRun.childEvidenceDir, 'child-private-debug.txt'),
          privateStagingMarker,
          { mode: 0o600 },
        )
        if (stagedKind === 'success') {
          await writeArchiveLifecycleSuccessReport({
            evidenceDir: terminalRun.childEvidenceDir,
            evidence: createSupervisorSuccessEvidence(terminalRun),
          })
        } else {
          await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
            terminalRun.childEvidenceDir,
            { startedAtMs: terminalRun.startedAtMs + 1 },
          ))
        }

        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode,
          evidenceDir,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        })
        await expect(access(terminal.path)).resolves.toBeUndefined()
        expect(await readFile(terminal.path, 'utf8')).not.toContain(privateStagingMarker)
        await expect(access(terminalRun.childEvidenceDir)).rejects.toMatchObject({ code: 'ENOENT' })
      } finally {
        await Promise.all([
          rm(evidenceDir, { recursive: true, force: true }),
          childEvidenceDir === null
            ? Promise.resolve()
            : rm(childEvidenceDir, { recursive: true, force: true }),
        ])
      }
    },
  )

  it('keeps owned success hidden until private staging cleanup succeeds', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-hidden-success-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const successPath = path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-report.json',
      )
      const pending = await publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun))}\n`,
        kind: 'success',
        terminalRun,
        deferSuccessName: true,
      })
      expect(pending).toMatchObject({ kind: 'success', pending: true })
      await expect(access(successPath)).rejects.toMatchObject({ code: 'ENOENT' })

      await rm(terminalRun.childEvidenceDir, { recursive: true, force: true })
      await writeFile(terminalRun.childEvidenceDir, 'unsafe staging residue', { mode: 0o600 })
      const input = {
        childExitCode: 0,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      } as const
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(input))
        .rejects.toThrow(/canonical evidence is durable.*cleanup is incomplete/iu)
      await expect(access(successPath)).rejects.toMatchObject({ code: 'ENOENT' })

      await rm(terminalRun.childEvidenceDir, { force: true })
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(input))
        .resolves.toMatchObject({ kind: 'success', path: successPath, published: false })
      await expect(access(successPath)).resolves.toBeUndefined()
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('keeps a separate live lease through terminal consumption after staging cleanup', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-live-lease-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createSupervisorSuccessEvidence(terminalRun),
      })
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        childSettled: true,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })
      await expect(access(terminalRun.childEvidenceDir)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(access(terminalRun.leaseDir)).resolves.toBeUndefined()

      const successorSource = {
        expectedHead: 'c'.repeat(40),
        expectedTree: 'd'.repeat(40),
        observedHead: 'c'.repeat(40),
        observedTree: 'd'.repeat(40),
        worktreeClean: true,
      }
      await expect(prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source: successorSource,
        startedAtMs: Date.now(),
      })).rejects.toThrow(/active|live.*lease|owner.*alive/iu)
      await expect(access(terminal.path)).resolves.toBeUndefined()

      await expect(consumeArchiveLifecycleSupervisorTerminalArtifact({
        terminal,
        terminalRun,
      })).resolves.toMatchObject({ kind: 'success', path: terminal.path })
      await expect(consumeArchiveLifecycleSupervisorTerminalArtifact({
        terminal,
        terminalRun,
      })).resolves.toMatchObject({ kind: 'success', path: terminal.path })
      await expect(access(terminalRun.leaseDir)).resolves.toBeUndefined()

      await expect(prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now(),
      }, { isSupervisorProcessAlive: () => false })).rejects.toThrow(/same.*head|unchanged/iu)

      const successor = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source: successorSource,
        startedAtMs: Date.now(),
      }, { isSupervisorProcessAlive: () => false })
      expect(successor.expectedHead).toBe(successorSource.expectedHead)
      await expect(access(terminal.path)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('rejects a dead active lease instead of erasing crash-bound terminal state', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-dead-active-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await rm(terminalRun.childEvidenceDir, { recursive: true, force: true })
      const sentinel = path.join(evidenceDir, 'crash-bound-sentinel')
      await writeFile(sentinel, 'preserve', { mode: 0o600 })

      await expect(prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source: {
          expectedHead: 'c'.repeat(40),
          expectedTree: 'd'.repeat(40),
          observedHead: 'c'.repeat(40),
          observedTree: 'd'.repeat(40),
          worktreeClean: true,
        },
        startedAtMs: Date.now(),
      }, { isSupervisorProcessAlive: () => false })).rejects.toThrow(/active|unresolved|consumed/iu)
      await expect(readFile(sentinel, 'utf8')).resolves.toBe('preserve')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('reclaims a consumed lease only while its prior canonical terminal remains exact', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-consumed-exact-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createSupervisorSuccessEvidence(terminalRun),
      })
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        childSettled: true,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })
      await consumeArchiveLifecycleSupervisorTerminalArtifact({ terminal, terminalRun })
      await writeFile(terminal.path, '{"verdict":{"passed":true}}\n', { mode: 0o600 })

      await expect(prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source: {
          expectedHead: 'c'.repeat(40),
          expectedTree: 'd'.repeat(40),
          observedHead: 'c'.repeat(40),
          observedTree: 'd'.repeat(40),
          worktreeClean: true,
        },
        startedAtMs: Date.now(),
      }, { isSupervisorProcessAlive: () => false })).rejects.toThrow(
        /terminal|evidence|schema|source|contents/iu,
      )
      await expect(readFile(terminal.path, 'utf8'))
        .resolves.toBe('{"verdict":{"passed":true}}\n')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('fails terminal consumption when the canonical evidence directory is rebound', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-dir-rebound-')
    const displacedDir = `${evidenceDir}-displaced`
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir: terminalRun.childEvidenceDir,
        evidence: createSupervisorSuccessEvidence(terminalRun),
      })
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        childSettled: true,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })
      await rename(evidenceDir, displacedDir)
      await mkdir(evidenceDir, { mode: 0o700 })

      await expect(consumeArchiveLifecycleSupervisorTerminalArtifact({
        terminal,
        terminalRun,
      })).rejects.toThrow(/directory.*identity|evidence.*changed/iu)
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        rm(displacedDir, { recursive: true, force: true }),
      ])
    }
  })

  it('preserves a precreated empty private evidence directory inode for supervisor staging', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-prepared-child-')
    try {
      await chmod(evidenceDir, 0o700)
      const before = await lstat(evidenceDir)

      await prepareArchiveLifecycleEvidenceDirectory(
        evidenceDir,
        [],
        { prepared: true },
      )

      const after = await lstat(evidenceDir)
      expect(after.dev).toBe(before.dev)
      expect(after.ino).toBe(before.ino)
      await writeFile(path.join(evidenceDir, 'unexpected'), 'do not erase', { mode: 0o600 })
      await expect(prepareArchiveLifecycleEvidenceDirectory(
        evidenceDir,
        [],
        { prepared: true },
      )).rejects.toThrow(/empty|prepared/iu)
      await expect(readFile(path.join(evidenceDir, 'unexpected'), 'utf8'))
        .resolves.toBe('do not erase')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('blocks a second run while exact-boundary child staging remains unresolved', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-stale-staging-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const firstRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const rawPrivatePath = path.join(firstRun.childEvidenceDir, 'raw-private.txt')
      await writeFile(rawPrivatePath, 'must remain isolated', { mode: 0o600 })

      await expect(prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now(),
      })).rejects.toThrow(
        /staging.*unresolved|child.*evidence.*exists|active.*run|lease.*active owner/iu,
      )
      await expect(readFile(rawPrivatePath, 'utf8')).resolves.toBe('must remain isolated')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it.each(['success', 'failure'] as const)(
    'rejects multiply-linked staged %s evidence and owns a fixed failure instead',
    async (stagedKind) => {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-staged-link-')
      const source = {
        expectedHead: 'a'.repeat(40),
        expectedTree: 'b'.repeat(40),
        observedHead: 'a'.repeat(40),
        observedTree: 'b'.repeat(40),
        worktreeClean: true,
      }
      let externalPath: string | null = null
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: Date.now() - 25,
        })
        const stagedPath = stagedKind === 'success'
          ? await writeArchiveLifecycleSuccessReport({
              evidenceDir: terminalRun.childEvidenceDir,
              evidence: createSupervisorSuccessEvidence(terminalRun),
            })
          : await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
              terminalRun.childEvidenceDir,
              { startedAtMs: terminalRun.startedAtMs + 1 },
            ))
        externalPath = path.join(
          path.dirname(evidenceDir),
          `.${path.basename(evidenceDir)}-${stagedKind}-external.json`,
        )
        await link(stagedPath, externalPath)

        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode: stagedKind === 'success' ? 0 : 1,
          evidenceDir,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        }, { readSourceIdentity: async () => source })
        expect(terminal.kind).toBe('failure')
        expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
          failure: { classification: 'archive_lifecycle_child_unreported_failure' },
        })
        const ownerIdentity = await lstat(path.join(
          evidenceDir,
          '.electron-archive-lifecycle-terminal-owner.json',
        ))
        const runOwnerIdentity = await lstat(path.join(
          evidenceDir,
          `.electron-archive-lifecycle-terminal-run-owner-${terminalRun.runId}.json`,
        ))
        const verdictIdentity = await lstat(terminal.path)
        expect(ownerIdentity.nlink).toBe(3)
        expect(runOwnerIdentity.nlink).toBe(3)
        expect(verdictIdentity.nlink).toBe(3)
      } finally {
        await Promise.all([
          rm(evidenceDir, { recursive: true, force: true }),
          externalPath === null ? Promise.resolve() : rm(externalPath, { force: true }),
        ])
      }
    },
  )

  it('rejects a canonical terminal inode with an unowned hardlink', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-owner-link-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let externalPath: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const input = {
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      } as const
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(
        input,
        { readSourceIdentity: async () => source },
      )).resolves.toMatchObject({ kind: 'failure' })
      const ownerPath = path.join(
        evidenceDir,
        '.electron-archive-lifecycle-terminal-owner.json',
      )
      externalPath = path.join(
        path.dirname(evidenceDir),
        `.${path.basename(evidenceDir)}-external-owner.json`,
      )
      await link(ownerPath, externalPath)

      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(input))
        .rejects.toThrow(/link|ownership.*topology|unexpected.*filesystem/iu)
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        externalPath === null ? Promise.resolve() : rm(externalPath, { force: true }),
      ])
    }
  })

  it('fails closed after canonical ownership when staging cleanup fails and recovers on retry', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-clean-retry-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      await rm(terminalRun.childEvidenceDir, { recursive: true, force: true })
      await writeFile(terminalRun.childEvidenceDir, 'unsafe staging residue', { mode: 0o600 })
      const input = {
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      } as const

      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(
        input,
        { readSourceIdentity: async () => source },
      )).rejects.toThrow(/canonical evidence is durable.*cleanup is incomplete/iu)
      await expect(access(path.join(
        evidenceDir,
        '.electron-archive-lifecycle-terminal-owner.json',
      ))).resolves.toBeUndefined()
      await expect(access(path.join(
        evidenceDir,
        'electron-archive-lifecycle-smoke-failure.json',
      ))).resolves.toBeUndefined()

      await rm(terminalRun.childEvidenceDir, { force: true })
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact(input))
        .resolves.toMatchObject({ kind: 'failure', published: false })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('rejects staged evidence for unknown, timeout, and exit-verdict mismatch outcomes', async () => {
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const cases = [
      {
        childExitCode: null,
        classification: 'archive_lifecycle_child_unreported_failure',
        stagedKind: 'success',
      },
      {
        childExitCode: null,
        classification: 'archive_lifecycle_child_timeout',
        stagedKind: 'success',
      },
      {
        childExitCode: 0,
        classification: 'archive_lifecycle_child_unreported_failure',
        stagedKind: 'failure',
      },
    ] as const

    for (const outcome of cases) {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-outcome-')
      let childEvidenceDir: string | null = null
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: Date.now() - 25,
        })
        childEvidenceDir = terminalRun.childEvidenceDir
        if (outcome.stagedKind === 'success') {
          await writeArchiveLifecycleSuccessReport({
            evidenceDir: terminalRun.childEvidenceDir,
            evidence: createPackagedArchiveLifecycleV2Evidence(),
          })
        } else {
          await writeArchiveLifecycleFailureReceipt(
            createFailureReceiptInput(terminalRun.childEvidenceDir),
          )
        }
        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode: outcome.childExitCode,
          evidenceDir,
          failureClassification: outcome.classification,
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        }, { readSourceIdentity: async () => source })
        expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
          failure: { classification: outcome.classification },
        })
      } finally {
        await Promise.all([
          rm(evidenceDir, { recursive: true, force: true }),
          childEvidenceDir === null
            ? Promise.resolve()
            : rm(childEvidenceDir, { recursive: true, force: true }),
        ])
      }
    }
  })

  it('rejects private or path-bearing fields in staged child failure evidence', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-private-fail-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const stagedPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(terminalRun.childEvidenceDir),
      )
      const hostile = JSON.parse(await readFile(stagedPath, 'utf8'))
      hostile.failure.recoveryCode = 'must-not-be-promoted'
      hostile.cleanup.profilePath = '/tmp/private-profile'
      await writeFile(stagedPath, `${JSON.stringify(hostile)}\n`, { mode: 0o600 })

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      const canonical = await readFile(terminal.path, 'utf8')
      expect(terminal.kind).toBe('failure')
      expect(canonical).not.toContain('must-not-be-promoted')
      expect(canonical).not.toContain('/tmp/private-profile')
      expect(JSON.parse(canonical)).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('canonicalizes validated staged failure JSON so duplicate keys cannot retain private bytes', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-duplicate-fail-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const stagedPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(terminalRun.childEvidenceDir),
      )
      const staged = await readFile(stagedPath, 'utf8')
      const privateValue = '/Users/private/operator/recovery-code.txt'
      const duplicateKey = staged.replace(
        '"message": "Primary lifecycle failure."',
        `"message": "${privateValue}",\n    "message": "Primary lifecycle failure."`,
      )
      await writeFile(stagedPath, duplicateKey, { mode: 0o600 })

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      })
      const canonical = await readFile(terminal.path, 'utf8')
      expect(terminal.kind).toBe('failure')
      expect(canonical).not.toContain(privateValue)
      expect(JSON.parse(canonical)).toMatchObject({
        failure: {
          classification: 'lifecycle_failure',
          message: 'Primary lifecycle failure.',
        },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('rejects malformed staged failure unions and publishes only the fixed fallback', async () => {
    type MutableFailureReceipt = Record<string, unknown> & {
      cleanup: Record<string, unknown> & { failures: Array<Record<string, unknown>> }
      failure: Record<string, unknown>
      run: Record<string, unknown>
    }
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const cleanupDetail = () => ({
      step: 'restarted_launch_stop',
      classification: 'cleanup_failure',
      message: 'Launch stop failed.',
      archiveLifecycleDiagnostics: null,
    })
    const cases: ReadonlyArray<{
      readonly name: string
      readonly mutate: (receipt: MutableFailureReceipt) => void
      readonly transform?: (serialized: string) => string
    }> = [
      {
        name: 'unknown root field',
        mutate: (receipt) => { receipt.privateField = 'must-not-survive' },
      },
      {
        name: 'unknown nested diagnostic field',
        mutate: (receipt) => {
          receipt.failure.classification = 'external_liveness_gate_failure'
          receipt.failure.archiveLifecycleDiagnostics = {
            activePhase: 'restore',
            currentFixContinuity: { profilePath: 'must-not-survive' },
          }
        },
      },
      {
        name: 'path in an allow-listed diagnostic field',
        mutate: (receipt) => {
          receipt.failure.classification = 'external_liveness_gate_failure'
          receipt.failure.archiveLifecycleDiagnostics = {
            activePhase: '/Users/private/operator/profile',
          }
        },
      },
      {
        name: 'diagnostic array beyond producer bound',
        mutate: (receipt) => {
          receipt.failure.classification = 'external_liveness_gate_failure'
          receipt.failure.archiveLifecycleDiagnostics = {
            errorKinds: Array.from({ length: 17 }, () => 'operation_deadline_exceeded'),
          }
        },
      },
      {
        name: 'diagnostic nesting beyond producer bound',
        mutate: (receipt) => {
          receipt.failure.classification = 'external_liveness_gate_failure'
          receipt.failure.archiveLifecycleDiagnostics = {
            currentFixContinuity: {
              currentFixContinuity: {
                currentFixContinuity: {
                  currentFixContinuity: {
                    currentFixContinuity: { activePhase: 'restore' },
                  },
                },
              },
            },
          }
        },
      },
      {
        name: 'non-finite parsed number',
        mutate: () => undefined,
        transform: (serialized) => serialized.replace(
          /"durationMs": \d+/u,
          '"durationMs": 1e9999',
        ),
      },
      {
        name: 'closed-gate count mismatch',
        mutate: (receipt) => {
          receipt.failure.classification = 'evidence_validation_failure'
          receipt.failure.closedGateFailures = {
            failureCount: 2,
            reasons: ['One retained reason.'],
          }
        },
      },
      {
        name: 'duplicate cleanup steps',
        mutate: (receipt) => {
          receipt.cleanup.cleanupFailureCount = 2
          receipt.cleanup.failures = [cleanupDetail(), cleanupDetail()]
          receipt.cleanup.processCleanupCompleted = false
          receipt.cleanup.profileCleanupCompleted = false
        },
      },
      {
        name: 'misindexed unreadable cleanup placeholder',
        mutate: (receipt) => {
          receipt.cleanup.cleanupFailureCount = 1
          receipt.cleanup.failures = [{
            ...cleanupDetail(),
            step: 'cleanup_detail_unreadable_1',
          }]
          receipt.cleanup.processCleanupCompleted = false
          receipt.cleanup.profileCleanupCompleted = false
        },
      },
      {
        name: 'malformed cleanup diagnostic',
        mutate: (receipt) => {
          receipt.failure.classification = 'cleanup_failure'
          receipt.failure.cleanupDiagnostic = {
            substage: 'journal_initialize',
            causeClass: 'sqlite_busy',
            tableName: null,
            cursor: null,
            workerExit: { observed: true, event: 'private_event', code: 0 },
          }
        },
      },
      {
        name: 'contradictory cleanup completion',
        mutate: (receipt) => {
          receipt.cleanup.cleanupFailureCount = 1
          receipt.cleanup.failures = [cleanupDetail()]
          receipt.cleanup.processCleanupCompleted = false
          receipt.cleanup.profileCleanupCompleted = true
        },
      },
      {
        name: 'home-relative path',
        mutate: (receipt) => { receipt.failure.message = 'Could not inspect ~/private/profile.' },
      },
    ]

    for (const invalidCase of cases) {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-invalid-union-')
      let childEvidenceDir: string | null = null
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: Date.now() - 25,
        })
        childEvidenceDir = terminalRun.childEvidenceDir
        const stagedPath = await writeArchiveLifecycleFailureReceipt(
          createFailureReceiptInput(terminalRun.childEvidenceDir),
        )
        const receipt = JSON.parse(await readFile(stagedPath, 'utf8')) as MutableFailureReceipt
        invalidCase.mutate(receipt)
        const serialized = `${JSON.stringify(receipt, null, 2)}\n`
        await writeFile(
          stagedPath,
          invalidCase.transform?.(serialized) ?? serialized,
          { mode: 0o600 },
        )

        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode: 1,
          evidenceDir,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        }, { readSourceIdentity: async () => source })
        const canonical = await readFile(terminal.path, 'utf8')
        expect(terminal.kind, invalidCase.name).toBe('failure')
        expect(JSON.parse(canonical), invalidCase.name).toMatchObject({
          failure: { classification: 'archive_lifecycle_child_unreported_failure' },
        })
        expect(canonical, invalidCase.name).not.toContain('must-not-survive')
        expect(canonical, invalidCase.name).not.toContain('/Users/private')
        expect(canonical, invalidCase.name).not.toContain('~/private')
      } finally {
        await Promise.all([
          rm(evidenceDir, { recursive: true, force: true }),
          childEvidenceDir === null
            ? Promise.resolve()
            : rm(childEvidenceDir, { recursive: true, force: true }),
        ])
      }
    }
  })

  it('preserves every legitimate staged child failure union after a reaped nonzero exit', async () => {
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const livenessError = new Error('External liveness gate failed.')
    Object.defineProperty(livenessError, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        activePhase: 'restore',
        errorKinds: Object.freeze(['operation_deadline_exceeded']),
      }),
    })
    const timeoutError = await withArchiveLifecycleWorkloadTimeout(
      new Promise(() => undefined),
      1,
      'Archive-lifecycle workload timed out.',
    ).catch((error: unknown) => error) as Error
    Object.defineProperty(timeoutError, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({ activePhase: 'cleanup' }),
    })
    const cleanupDiagnostic = Object.freeze({
      substage: 'journal_initialize',
      causeClass: 'sqlite_busy',
      tableName: null,
      cursor: null,
      workerExit: Object.freeze({ observed: true, event: 'message', code: 0 }),
    })
    const cleanupError = new Error(
      `Mission archive operation failed safely [`
      + `${encodeCleanupFailureDiagnosticToken(cleanupDiagnostic)}] (ARCHIVE_CLEANUP_FAILED).`,
    )
    const variants: ReadonlyArray<{
      readonly name: string
      readonly overrides: Record<string, unknown>
    }> = [
      { name: 'generic lifecycle', overrides: {} },
      { name: 'cleanup diagnostic', overrides: { error: cleanupError } },
      { name: 'external liveness', overrides: { error: livenessError } },
      { name: 'workload with diagnostics', overrides: { error: timeoutError } },
      {
        name: 'readable closed gate',
        overrides: { closedGateFailures: ['Cleanup liveness evidence was not closed.'] },
      },
      { name: 'unreadable closed gate', overrides: { closedGateFailures: [] } },
      {
        name: 'secondary cleanup failure',
        overrides: {
          cleanupFailureCount: 1,
          cleanupFailures: [{
            step: 'restarted_launch_stop',
            error: new Error('Launch stop failed.'),
          }],
          processCleanupCompleted: false,
          profileCleanupCompleted: false,
        },
      },
    ]

    for (const variant of variants) {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-valid-union-')
      let childEvidenceDir: string | null = null
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir,
          source,
          startedAtMs: Date.now() - 25,
        })
        childEvidenceDir = terminalRun.childEvidenceDir
        const stagedPath = await writeArchiveLifecycleFailureReceipt(
          createFailureReceiptInput(terminalRun.childEvidenceDir, variant.overrides),
        )
        const staged = await readFile(stagedPath, 'utf8')
        const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
          childExitCode: 1,
          evidenceDir,
          failureClassification: 'archive_lifecycle_child_unreported_failure',
          source,
          startedAtMs: terminalRun.startedAtMs,
          terminalRun,
        })
        expect(terminal.kind, variant.name).toBe('failure')
        expect(await readFile(terminal.path, 'utf8'), variant.name).toBe(staged)
      } finally {
        await Promise.all([
          rm(evidenceDir, { recursive: true, force: true }),
          childEvidenceDir === null
            ? Promise.resolve()
            : rm(childEvidenceDir, { recursive: true, force: true }),
        ])
      }
    }
  })

  it.each(['expected-verdict', 'mixed-scan', 'anchor-disappears', 'alias-swap', 'name-never-settles', 'unknown-link', 'opposite-verdict', 'replacement', 'mode', 'size'] as const)(
    'revalidates the complete topology after a mid-read change: %s', async (change) => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-link-settlement-')
    const source = {
      expectedHead: 'a'.repeat(40), expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40), observedTree: 'b'.repeat(40), worktreeClean: true,
    }
    let observer: Awaited<ReturnType<typeof open>> | null = null
    let restoreRead = () => undefined
    let restoreStat = () => undefined
    let restoreLink = () => undefined
    let linkAttempts = 0
    let anchorRemoved = false
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir, source, startedAtMs: Date.now() - 25,
      })
      const contents = `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun))}\n`
      await publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents, kind: 'success', terminalRun, deferSuccessName: change !== 'alias-swap',
      })
      const ownerPath = path.join(evidenceDir, '.electron-archive-lifecycle-terminal-owner.json')
      const canonicalPath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-report.json')
      const runOwnerPath = path.join(evidenceDir, `.electron-archive-lifecycle-terminal-run-owner-${terminalRun.runId}.json`)
      const ownerIdentity = await lstat(ownerPath)
      expect(ownerIdentity.nlink).toBe(change === 'alias-swap' ? 3 : 2)
      observer = await open(ownerPath, 'r')
      const prototype = Object.getPrototypeOf(observer) as Pick<typeof observer, 'readFile'>
      const original = prototype.readFile
      let linked = false
      const spy = vi.spyOn(prototype, 'readFile').mockImplementation(async function (
        this: NonNullable<typeof observer>, ...args: Parameters<typeof original>
      ) {
        const result = await original.apply(this, args)
        const identity = await this.stat()
        if (!linked && change !== 'mixed-scan' && change !== 'name-never-settles'
          && identity.dev === ownerIdentity.dev && identity.ino === ownerIdentity.ino) {
          linked = true
          if (change === 'expected-verdict' || change === 'anchor-disappears') await link(ownerPath, canonicalPath)
          else if (change === 'alias-swap') {
            await unlink(canonicalPath)
            await link(ownerPath, path.join(evidenceDir, 'unknown-alias.json'))
            await writeFile(canonicalPath, contents, { mode: 0o600 })
          }
          else if (change === 'unknown-link') await link(ownerPath, path.join(evidenceDir, 'unknown-alias.json'))
          else if (change === 'opposite-verdict') {
            await link(ownerPath, path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json'))
          } else if (change === 'replacement') {
            await unlink(ownerPath)
            await writeFile(ownerPath, contents, { mode: 0o600 })
          } else if (change === 'mode') await chmod(ownerPath, 0o400)
          else await writeFile(ownerPath, `${contents}\n`, { mode: 0o600 })
        }
        return result
      })
      restoreRead = () => { spy.mockRestore() }
      if (change === 'mixed-scan' || change === 'anchor-disappears') {
        const originalStat = fileSystemOverrides.originalLstat
        let ownerReads = 0
        let finishScan = () => undefined
        const scanReady = new Promise<void>((resolve) => { finishScan = resolve })
        fileSystemOverrides.lstat = (async (...args: Parameters<typeof originalStat>) => {
          const name = String(args[0])
          if (name === ownerPath) {
            ownerReads += 1
            if (change === 'anchor-disappears' && ownerReads === 3) {
              for (const alias of [ownerPath, runOwnerPath, canonicalPath]) unlinkSync(alias)
              anchorRemoved = true
            }
            const result = await originalStat.apply(fsPromises, args)
            if (change === 'mixed-scan' && ownerReads === 1) {
              await link(ownerPath, canonicalPath)
              linked = true
              finishScan()
            }
            return result
          }
          if (change === 'mixed-scan' && [runOwnerPath, canonicalPath,
            path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')].includes(name)) {
            await scanReady
          }
          return originalStat.apply(fsPromises, args)
        }) as typeof originalStat
        restoreStat = () => { fileSystemOverrides.lstat = undefined }
      }
      if (change === 'name-never-settles') {
        const originalLink = fileSystemOverrides.originalLink
        fileSystemOverrides.link = async (...args: Parameters<typeof originalLink>) => {
          if (String(args[1]) === canonicalPath) {
            linkAttempts += 1
            if (linkAttempts > 25) throw new Error('Synthetic test stopped unbounded publication.')
            await originalLink(...args)
            await unlink(canonicalPath)
            linked = true
            return
          }
          return originalLink(...args)
        }
        restoreLink = () => { fileSystemOverrides.link = undefined }
      }
      const publication = publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents, kind: 'success', terminalRun,
      })
      if (change === 'expected-verdict' || change === 'mixed-scan') {
        await expect(publication).resolves.toMatchObject({ kind: 'success', path: canonicalPath })
        expect((await lstat(canonicalPath)).nlink).toBe(3)
      } else {
        await expect(publication).rejects.toThrow(change === 'name-never-settles' ? /bounded budget/ : undefined)
        if (change === 'name-never-settles') expect(linkAttempts).toBeLessThanOrEqual(21)
        if (change !== 'alias-swap') await expect(access(canonicalPath)).rejects.toThrow()
      }
      expect(linked).toBe(true)
      if (change === 'anchor-disappears') expect(anchorRemoved).toBe(true)
    } finally {
      restoreRead()
      restoreStat()
      restoreLink()
      await observer?.close()
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it.each(['owner-and-verdict-added', 'restored-alias', 'restored-mode', 'restored-size', 'restored-name'] as const)(
    'does not forget an observed topology transition: %s', async (change) => {
      const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-observed-transition-')
      const source = {
        expectedHead: 'a'.repeat(40), expectedTree: 'b'.repeat(40),
        observedHead: 'a'.repeat(40), observedTree: 'b'.repeat(40), worktreeClean: true,
      }
      let injected = false
      try {
        const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
          evidenceDir, source, startedAtMs: Date.now() - 25,
        })
        const contents = `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun))}\n`
        await publishArchiveLifecycleSupervisorCanonicalArtifact({ contents, kind: 'success', terminalRun })
        const ownerPath = path.join(evidenceDir, '.electron-archive-lifecycle-terminal-owner.json')
        const canonicalPath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-report.json')
        const runOwnerPath = path.join(evidenceDir, `.electron-archive-lifecycle-terminal-run-owner-${terminalRun.runId}.json`)
        const originalStat = fileSystemOverrides.originalLstat
        let canonicalReads = 0
        let finishScan = () => undefined
        const scanReady = new Promise<void>((resolve) => { finishScan = resolve })
        if (change === 'owner-and-verdict-added') {
          await unlink(ownerPath)
          await unlink(canonicalPath)
        }
        fileSystemOverrides.lstat = (async (...args: Parameters<typeof originalStat>) => {
          const name = String(args[0])
          if (change === 'owner-and-verdict-added' && !injected && name === ownerPath) {
            const missing = await originalStat(...args).catch((error: unknown) => error)
            await link(runOwnerPath, ownerPath)
            await link(ownerPath, canonicalPath)
            injected = true
            finishScan()
            throw missing
          }
          if (change === 'owner-and-verdict-added' && name !== ownerPath
            && [runOwnerPath, canonicalPath, path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')].includes(name)) {
            await scanReady
          }
          if (name === canonicalPath && ++canonicalReads === 2 && change !== 'owner-and-verdict-added') {
            injected = true
            if (change === 'restored-mode') {
              await chmod(canonicalPath, 0o400)
              const changed = await originalStat(...args)
              await chmod(canonicalPath, 0o600)
              return changed
            }
            if (change === 'restored-size') {
              await writeFile(canonicalPath, `${contents}\n`)
              const changed = await originalStat(...args)
              await writeFile(canonicalPath, contents)
              return changed
            }
            const saved = path.join(evidenceDir, 'saved-alias.json')
            await rename(canonicalPath, saved)
            if (change === 'restored-alias') {
              await writeFile(canonicalPath, contents, { mode: 0o600 })
              const changed = await originalStat(...args)
              await unlink(canonicalPath)
              await rename(saved, canonicalPath)
              return changed
            }
            const missing = await originalStat(...args).catch((error: unknown) => error)
            await rename(saved, canonicalPath)
            throw missing
          }
          return originalStat(...args)
        }) as typeof originalStat
        const publication = publishArchiveLifecycleSupervisorCanonicalArtifact({ contents, kind: 'success', terminalRun })
        if (change === 'owner-and-verdict-added') {
          await expect(publication).resolves.toMatchObject({ kind: 'success', path: canonicalPath })
        } else {
          await expect(publication).rejects.toThrow()
        }
        expect(injected).toBe(true)
      } finally {
        fileSystemOverrides.lstat = undefined
        await rm(evidenceDir, { recursive: true, force: true })
      }
    },
  )

  it('serializes opposite canonical publishers through one ownership inode', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-owner-race-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const successContents = `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun))}\n`
      const failureContents = `${JSON.stringify(createArchiveLifecycleSupervisorFailureReceipt({
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
      }))}\n`
      const outcomes = await Promise.all([
        publishArchiveLifecycleSupervisorCanonicalArtifact({
          contents: successContents,
          kind: 'success',
          terminalRun,
        }),
        publishArchiveLifecycleSupervisorCanonicalArtifact({
          contents: failureContents,
          kind: 'failure',
          terminalRun,
        }),
      ])
      const entries = await readdir(evidenceDir)
      const named = entries.filter((entry) => !entry.startsWith('.'))
      const ownerPath = path.join(
        evidenceDir,
        '.electron-archive-lifecycle-terminal-owner.json',
      )
      const runOwnerPath = path.join(
        evidenceDir,
        `.electron-archive-lifecycle-terminal-run-owner-${terminalRun.runId}.json`,
      )

      expect(new Set(outcomes.map((outcome) => outcome.kind)).size).toBe(1)
      expect(named).toHaveLength(1)
      expect(entries).toContain(path.basename(ownerPath))
      expect(entries).toContain(path.basename(runOwnerPath))
      const ownerIdentity = await lstat(ownerPath)
      const runOwnerIdentity = await lstat(runOwnerPath)
      const namedIdentity = await lstat(path.join(evidenceDir, named[0] ?? ''))
      expect(ownerIdentity.isFile()).toBe(true)
      expect(ownerIdentity.isSymbolicLink()).toBe(false)
      expect(ownerIdentity.mode & 0o777).toBe(0o600)
      expect(namedIdentity.dev).toBe(ownerIdentity.dev)
      expect(namedIdentity.ino).toBe(ownerIdentity.ino)
      expect(runOwnerIdentity.dev).toBe(ownerIdentity.dev)
      expect(runOwnerIdentity.ino).toBe(ownerIdentity.ino)
      expect(await readFile(path.join(evidenceDir, named[0] ?? ''), 'utf8'))
        .toBe(await readFile(ownerPath, 'utf8'))
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('rejects a canonical winner outside the caller frozen observation', async () => {
    const evidenceDir = await createSupervisorTestDirectory(
      'sartracker-lifecycle-frozen-publication-',
    )
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const supervisorStartedAtMs = Date.now() - 100
    const observedAtMs = supervisorStartedAtMs + 10
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: supervisorStartedAtMs,
      })
      const futureContents = `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun, {
        startedAtMs: observedAtMs + 1,
        finishedAtMs: observedAtMs + 2,
      }))}\n`
      await expect(publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: futureContents,
        kind: 'success',
        terminalRun,
      })).resolves.toMatchObject({ kind: 'success' })

      const observedContents = `${JSON.stringify(createSupervisorSuccessEvidence(terminalRun, {
        startedAtMs: supervisorStartedAtMs + 1,
        finishedAtMs: supervisorStartedAtMs + 2,
      }))}\n`
      await expect(publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: observedContents,
        kind: 'success',
        terminalRun,
      }, { observedAtMs })).rejects.toThrow(/observation|later than|supervisor run/iu)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('allows only the immutable active lease owner to ensure or publish canonical evidence', async () => {
    const evidenceDir = await createSupervisorTestDirectory(
      'sartracker-lifecycle-invocation-race-',
    )
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const supervisorStartedAtMs = Date.now() - 25
    const observedAtMs = Date.now() + 1_000
    try {
      const successRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: supervisorStartedAtMs,
      })
      const failureRun = Object.freeze({
        ...successRun,
        runId: '11111111-1111-4111-8111-111111111111',
      })
      expect(successRun.runId).not.toBe(failureRun.runId)
      const successContents = `${JSON.stringify(createSupervisorSuccessEvidence(successRun))}\n`
      const failureContents = `${JSON.stringify(createArchiveLifecycleSupervisorFailureReceipt({
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: failureRun.startedAtMs,
      }))}\n`
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 1,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: failureRun.startedAtMs,
        terminalRun: failureRun,
      }, { nowMs: () => observedAtMs })).rejects.toThrow(/active.*lease.*owner/iu)
      await expect(
        publishArchiveLifecycleSupervisorCanonicalArtifact({
          contents: failureContents,
          kind: 'failure',
          terminalRun: failureRun,
        }, { observedAtMs }),
      ).rejects.toThrow(/active.*lease.*owner/iu)
      expect(await readdir(evidenceDir)).toEqual([])

      await expect(publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: successContents,
        kind: 'success',
        terminalRun: successRun,
      }, { observedAtMs })).resolves.toMatchObject({ kind: 'success' })
      expect(await readdir(evidenceDir)).toEqual(expect.arrayContaining([
        '.electron-archive-lifecycle-terminal-owner.json',
        `.electron-archive-lifecycle-terminal-run-owner-${successRun.runId}.json`,
        'electron-archive-lifecycle-smoke-report.json',
      ]))
      expect(await readdir(evidenceDir)).not.toContain(
        `.electron-archive-lifecycle-terminal-run-owner-${failureRun.runId}.json`,
      )
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('rejects an unowned named artifact and recovers a name missing after owner claim', async () => {
    const unownedDir = await createSupervisorTestDirectory('sartracker-lifecycle-unowned-')
    const recoveryDir = await createSupervisorTestDirectory('sartracker-lifecycle-owner-recovery-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let unownedChildEvidenceDir: string | null = null
    let recoveryChildEvidenceDir: string | null = null
    try {
      const unownedRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: unownedDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      unownedChildEvidenceDir = unownedRun.childEvidenceDir
      const unownedSuccessContents = `${JSON.stringify(
        createSupervisorSuccessEvidence(unownedRun),
      )}\n`
      await writeFile(path.join(
        unownedDir,
        'electron-archive-lifecycle-smoke-report.json',
      ), unownedSuccessContents, { mode: 0o600 })
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir: unownedDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: unownedRun.startedAtMs,
        terminalRun: unownedRun,
      })).rejects.toThrow(/ownership/iu)

      const recoveryRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir: recoveryDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      recoveryChildEvidenceDir = recoveryRun.childEvidenceDir
      const recoverySuccessContents = `${JSON.stringify(
        createSupervisorSuccessEvidence(recoveryRun),
      )}\n`
      const canonicalRecoverySuccessContents = `${JSON.stringify(
        JSON.parse(recoverySuccessContents),
        null,
        2,
      )}\n`
      const ownerPath = path.join(
        recoveryDir,
        '.electron-archive-lifecycle-terminal-owner.json',
      )
      const published = await publishArchiveLifecycleSupervisorCanonicalArtifact({
        contents: recoverySuccessContents,
        kind: 'success',
        terminalRun: recoveryRun,
      })
      await Promise.all([rm(published.path), rm(ownerPath)])
      const recovered = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir: recoveryDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: recoveryRun.startedAtMs,
        terminalRun: recoveryRun,
      })
      expect(recovered).toMatchObject({ kind: 'success', published: false })
      expect(await readFile(recovered.path, 'utf8')).toBe(canonicalRecoverySuccessContents)
      expect((await lstat(recovered.path)).ino).toBe((await lstat(ownerPath)).ino)
      await writeFile(path.join(
        recoveryDir,
        'electron-archive-lifecycle-smoke-failure.json',
      ), `${JSON.stringify(createArchiveLifecycleSupervisorFailureReceipt({
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: recoveryRun.startedAtMs,
      }))}\n`, { mode: 0o600 })
      await expect(ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: 0,
        evidenceDir: recoveryDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: recoveryRun.startedAtMs,
        terminalRun: recoveryRun,
      })).rejects.toThrow(/exactly one terminal evidence artifact/iu)
    } finally {
      await Promise.all([
        rm(unownedDir, { recursive: true, force: true }),
        rm(recoveryDir, { recursive: true, force: true }),
        unownedChildEvidenceDir === null
          ? Promise.resolve()
          : rm(unownedChildEvidenceDir, { recursive: true, force: true }),
        recoveryChildEvidenceDir === null
          ? Promise.resolve()
          : rm(recoveryChildEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('records independently observed source drift instead of copying expected identity', async () => {
    const expectedHead = 'a'.repeat(40)
    const expectedTree = 'b'.repeat(40)
    const observedHead = 'c'.repeat(40)
    const observedTree = 'd'.repeat(40)
    const execute = vi.fn(async (_command: string, args: readonly string[]) => ({
      stdout: args[0] === 'status'
        ? `# branch.oid ${observedHead}\n1 .M N... 100644 100644 100644 ${observedHead} ${observedHead} changed-file\n`
        : args[1] === `${expectedHead}^{tree}`
        ? `${expectedTree}\n`
        : args[1] === `${observedHead}^{tree}`
          ? `${observedTree}\n`
          : '',
    }))

    await expect(readExactSourceIdentity(expectedHead, {
      execFile: execute,
    })).resolves.toEqual({
      expectedHead,
      expectedTree,
      observedHead,
      observedTree,
      worktreeClean: false,
    })
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('represents a failed coherent source observation as unknown and dirty', async () => {
    const expectedHead = 'a'.repeat(40)
    const expectedTree = 'b'.repeat(40)
    const execute = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[1] === `${expectedHead}^{tree}`) return { stdout: `${expectedTree}\n` }
      throw new Error('Injected coherent status observation failure.')
    })

    await expect(readExactSourceIdentity(expectedHead, {
      execFile: execute,
    })).resolves.toEqual({
      expectedHead,
      expectedTree,
      observedHead: null,
      observedTree: null,
      worktreeClean: false,
    })
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('re-observes coherent source provenance immediately before publishing fallback', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-source-refresh-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    const refreshed = {
      ...source,
      observedHead: 'c'.repeat(40),
      observedTree: 'd'.repeat(40),
      worktreeClean: false,
    }
    const readSourceIdentity = vi.fn(async () => refreshed)
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_timeout',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity })
      expect(readSourceIdentity).toHaveBeenCalledOnce()
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        source: {
          expectedHead: source.expectedHead,
          expectedTree: source.expectedTree,
          headBefore: refreshed.observedHead,
          treeBefore: refreshed.observedTree,
          worktreeCleanBefore: false,
        },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes unknown dirty fallback provenance when the final source read fails', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-source-unknown-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, {
        readSourceIdentity: async () => {
          throw new Error('Injected final source observation failure.')
        },
      })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        source: {
          expectedHead: source.expectedHead,
          expectedTree: source.expectedTree,
          headBefore: null,
          treeBefore: null,
          worktreeCleanBefore: false,
        },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('classifies an unreported lifecycle child without projecting its private error', () => {
    const receipt = createArchiveLifecycleSupervisorFailureReceipt({
      failureClassification: 'archive_lifecycle_child_unreported_failure',
      source: {
        expectedHead: 'a'.repeat(40),
        expectedTree: 'b'.repeat(40),
        observedHead: null,
        observedTree: null,
        worktreeClean: false,
      },
      startedAtMs: Date.now() - 10,
    })

    expect(receipt).toMatchObject({
      failure: {
        classification: 'archive_lifecycle_child_unreported_failure',
        message: 'Archive-lifecycle child did not publish terminal evidence.',
      },
      cleanup: {
        processCleanupCompleted: false,
        profileCleanupCompleted: false,
      },
    })
    expect(JSON.stringify(receipt)).not.toMatch(/message.*synthetic|stack|\/Users\//u)
  })

  it('keeps the timeout verdict but removes staging when SIGKILL is reaped inside the bound', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-timeout-reaped-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    vi.useFakeTimers()
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      await writeFile(
        path.join(terminalRun.childEvidenceDir, 'raw-private-staging.txt'),
        'must be removed after the child is reaped',
        { mode: 0o600 },
      )
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 100, {
        platform: 'win32',
        reapTimeoutMs: 5_000,
      })
      const failurePromise = waiting.catch((error: unknown) => error as Error & {
        readonly archiveLifecycleChildSettled?: boolean
        readonly archiveLifecycleSupervisorClassification?: string
      })

      await vi.advanceTimersByTimeAsync(100)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      child.emit('exit', null, 'SIGKILL')
      const failure = await failurePromise
      expect(failure.archiveLifecycleSupervisorClassification)
        .toBe('archive_lifecycle_child_timeout')
      expect(failure.archiveLifecycleChildSettled).toBe(true)
      vi.useRealTimers()

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        childSettled: failure.archiveLifecycleChildSettled,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_timeout',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_timeout' },
      })
      await expect(access(terminalRun.childEvidenceDir)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      vi.useRealTimers()
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('marks a spawn failure settled and removes its unused staging after fallback ownership', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-spawn-failed-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    let childEvidenceDir: string | null = null
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      childEvidenceDir = terminalRun.childEvidenceDir
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 60_000)
      const failurePromise = waiting.catch((error: unknown) => error as Error & {
        readonly archiveLifecycleChildSettled?: boolean
      })
      child.emit('error', new Error('synthetic spawn failure'))
      const failure = await failurePromise
      expect(failure.archiveLifecycleChildSettled).toBe(true)

      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        childSettled: failure.archiveLifecycleChildSettled,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(JSON.parse(await readFile(terminal.path, 'utf8'))).toMatchObject({
        failure: { classification: 'archive_lifecycle_child_unreported_failure' },
      })
      await expect(access(terminalRun.childEvidenceDir)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await Promise.all([
        rm(evidenceDir, { recursive: true, force: true }),
        childEvidenceDir === null
          ? Promise.resolve()
          : rm(childEvidenceDir, { recursive: true, force: true }),
      ])
    }
  })

  it('kills and rejects a CI lifecycle child that never exits by the outer workload deadline', async () => {
    vi.useFakeTimers()
    try {
      const timeoutMs = 30 * 60_000
      const reapTimeoutMs = 5_000
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        unref: vi.fn(),
      })
      const waiting = waitForArchiveLifecycleChildExit(child, timeoutMs, {
        reapTimeoutMs,
        platform: 'win32',
      })
      const failure = waiting.catch((error: unknown) => error as Error)
      let settled = false
      void waiting.finally(() => { settled = true }).catch(() => undefined)

      await vi.advanceTimersByTimeAsync(timeoutMs - 1)
      expect(child.kill).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)

      expect(child.kill).toHaveBeenCalledOnce()
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(child.unref).not.toHaveBeenCalled()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(reapTimeoutMs - 1)
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect((await failure).message).toBe(
        `CI packaged archive-lifecycle smoke exceeded its ${timeoutMs} ms child deadline.`,
      )
      expect(child.unref).toHaveBeenCalledOnce()
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds reaping when the direct child kill returns false or throws', async () => {
    vi.useFakeTimers()
    try {
      for (const [index, kill] of [
        vi.fn(() => false),
        vi.fn(() => { throw new Error('synthetic kill failure') }),
      ].entries()) {
        const child = Object.assign(new EventEmitter(), { kill, pid: 12_340 + index })
        const killProcess = vi.fn(() => { throw new Error('synthetic group kill failure') })
        const waiting = waitForArchiveLifecycleChildExit(child, 20, {
          killProcess,
          reapTimeoutMs: 10,
          platform: 'linux',
        })
        const failure = waiting.catch((error: unknown) => error as Error)
        let settled = false
        void waiting.finally(() => { settled = true }).catch(() => undefined)

        await vi.advanceTimersByTimeAsync(20)
        expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
        expect(kill).toHaveBeenCalledWith('SIGKILL')
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(10)
        expect((await failure).message).toMatch(/child deadline/iu)
        expect(settled).toBe(true)
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('refuses to settle an exited POSIX group leader while a surviving member remains', async () => {
    vi.useFakeTimers()
    try {
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid: 23_401,
        unref: vi.fn(),
      })
      const killProcess = vi.fn((_pid: number, signal: number | NodeJS.Signals) => {
        if (signal === 0) return true
        return true
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 60_000, {
        killProcess,
        platform: 'linux',
        reapTimeoutMs: 50,
      })
      const failurePromise = waiting.catch((error: unknown) => error as Error & {
        readonly archiveLifecycleChildSettled?: boolean
      })

      child.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(0)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 0)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
      await vi.advanceTimersByTimeAsync(50)

      const failure = await failurePromise
      expect(failure).toMatchObject({
        archiveLifecycleChildSettled: false,
        message: expect.stringMatching(/process group.*active|group.*settle/iu),
      })
      expect(child.unref).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('retains private staging when an exited POSIX process group cannot be proven empty', async () => {
    const evidenceDir = await createSupervisorTestDirectory('sartracker-lifecycle-group-live-')
    const source = {
      expectedHead: 'a'.repeat(40),
      expectedTree: 'b'.repeat(40),
      observedHead: 'a'.repeat(40),
      observedTree: 'b'.repeat(40),
      worktreeClean: true,
    }
    try {
      const terminalRun = await prepareArchiveLifecycleSupervisorTerminalRun({
        evidenceDir,
        source,
        startedAtMs: Date.now() - 25,
      })
      const privateMarkerPath = path.join(terminalRun.childEvidenceDir, 'private-residual.txt')
      await writeFile(privateMarkerPath, 'retain until group settlement is proven', { mode: 0o600 })
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid: 23_406,
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 60_000, {
        killProcess: () => true,
        platform: 'linux',
        reapTimeoutMs: 1,
      })
      const failurePromise = waiting.catch((error: unknown) => error as Error & {
        readonly archiveLifecycleChildSettled?: boolean
      })
      child.emit('exit', 1, null)
      const failure = await failurePromise

      expect(failure.archiveLifecycleChildSettled).toBe(false)
      const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({
        childExitCode: null,
        childSettled: failure.archiveLifecycleChildSettled,
        evidenceDir,
        failureClassification: 'archive_lifecycle_child_unreported_failure',
        source,
        startedAtMs: terminalRun.startedAtMs,
        terminalRun,
      }, { readSourceIdentity: async () => source })
      expect(terminal.kind).toBe('failure')
      await expect(readFile(privateMarkerPath, 'utf8'))
        .resolves.toBe('retain until group settlement is proven')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('reaps an abnormal exited POSIX process group before reporting its exit code', async () => {
    vi.useFakeTimers()
    try {
      let groupKilled = false
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid: 23_402,
      })
      const killProcess = vi.fn((_pid: number, signal: number | NodeJS.Signals) => {
        if (signal === 'SIGKILL') {
          groupKilled = true
          return true
        }
        if (!groupKilled) return true
        throw Object.assign(new Error('group is empty'), { code: 'ESRCH' })
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 60_000, {
        killProcess,
        platform: 'linux',
        reapTimeoutMs: 50,
      })

      child.emit('exit', 1, null)
      await vi.advanceTimersByTimeAsync(25)

      await expect(waiting).resolves.toBe(1)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 0)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the same POSIX group proof when exit was observed before waiting began', async () => {
    vi.useFakeTimers()
    try {
      let groupKilled = false
      const child = Object.assign(new EventEmitter(), {
        exitCode: 1,
        kill: vi.fn(() => true),
        pid: 23_405,
      })
      const killProcess = vi.fn((_pid: number, signal: number | NodeJS.Signals) => {
        if (signal === 'SIGKILL') {
          groupKilled = true
          return true
        }
        if (!groupKilled) return true
        throw Object.assign(new Error('group is empty'), { code: 'ESRCH' })
      })

      const waiting = waitForArchiveLifecycleChildExit(child, 60_000, {
        killProcess,
        platform: 'linux',
        reapTimeoutMs: 50,
      })
      await vi.advanceTimersByTimeAsync(25)

      await expect(waiting).resolves.toBe(1)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 0)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a zero exit when residual POSIX group members had to be killed', async () => {
    vi.useFakeTimers()
    try {
      let groupKilled = false
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid: 23_403,
      })
      const killProcess = vi.fn((_pid: number, signal: number | NodeJS.Signals) => {
        if (signal === 'SIGKILL') {
          groupKilled = true
          return true
        }
        if (!groupKilled) return true
        throw Object.assign(new Error('group is empty'), { code: 'ESRCH' })
      })
      const waiting = waitForArchiveLifecycleChildExit(child, 60_000, {
        killProcess,
        platform: 'linux',
        reapTimeoutMs: 50,
      })
      const failurePromise = waiting.catch((error: unknown) => error as Error & {
        readonly archiveLifecycleChildSettled?: boolean
      })

      child.emit('exit', 0, null)
      await vi.advanceTimersByTimeAsync(25)

      const failure = await failurePromise
      expect(failure).toMatchObject({
        archiveLifecycleChildSettled: true,
        message: expect.stringMatching(/process group.*after.*success|group.*success/iu),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the CI lifecycle child deadline when the child exits normally', async () => {
    vi.useFakeTimers()
    try {
      const timeoutMs = 30 * 60_000
      const child = Object.assign(new EventEmitter(), {
        kill: vi.fn(() => true),
        pid: 23_404,
      })
      const killProcess = vi.fn(() => {
        throw Object.assign(new Error('group is empty'), { code: 'ESRCH' })
      })
      const waiting = waitForArchiveLifecycleChildExit(child, timeoutMs, {
        killProcess,
        platform: 'linux',
      })

      child.emit('exit', 0, null)

      await expect(waiting).resolves.toBe(0)
      expect(killProcess).toHaveBeenCalledWith(-child.pid, 0)
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(timeoutMs)
      expect(child.kill).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets the CI wrapper exit after an unkillable detached child reaches the reap deadline', async () => {
    const moduleUrl = pathToFileURL(ciRunnerPath).href
    const fixtureSource = `
      import { spawn } from 'node:child_process'
      import { waitForArchiveLifecycleChildExit } from ${JSON.stringify(moduleUrl)}
      const child = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
        detached: true,
        stdio: 'ignore',
      })
      process.stdout.write(String(child.pid) + '\\n')
      child.kill = () => false
      await waitForArchiveLifecycleChildExit(child, 20, {
        platform: 'win32',
        reapTimeoutMs: 20,
      }).catch(() => undefined)
    `
    const wrapper = spawn(
      process.execPath,
      ['--input-type=module', '-e', fixtureSource],
      { stdio: ['ignore', 'pipe', 'ignore'] },
    )
    let longLivedChildPid: number | null = null
    try {
      const [pidChunk] = await once(wrapper.stdout, 'data')
      longLivedChildPid = Number(String(pidChunk).trim())
      if (longLivedChildPid === null
        || !Number.isSafeInteger(longLivedChildPid) || longLivedChildPid <= 0) {
        throw new Error('Live-handle fixture returned an invalid child process identifier.')
      }

      await expect(waitForTestChildExit(wrapper, 250)).resolves.toBeUndefined()
      expect(processExists(longLivedChildPid)).toBe(true)
    } finally {
      if (wrapper.exitCode === null && wrapper.signalCode === null) wrapper.kill('SIGKILL')
      if (longLivedChildPid !== null) {
        try {
          process.kill(longLivedChildPid, 'SIGKILL')
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe('ESRCH')
        }
      }
    }
  })

  it.skipIf(process.platform === 'win32')(
    'kills a non-packaged POSIX child process group and reaps its long-lived grandchild',
    async () => {
      const fixtureSource = `
        const { spawn } = require('node:child_process')
        const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => undefined, 1000)'], {
          stdio: 'ignore',
        })
        process.stdout.write(JSON.stringify({
          childPid: process.pid,
          grandchildPid: grandchild.pid,
        }) + '\\n')
        setInterval(() => undefined, 1000)
      `
      const child = spawn(process.execPath, ['-e', fixtureSource], {
        detached: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      let childPid = child.pid ?? null
      try {
        const [pidChunk] = await once(child.stdout, 'data')
        const pids = JSON.parse(String(pidChunk)) as {
          readonly childPid: number
          readonly grandchildPid: number
        }
        childPid = pids.childPid
        const waiting = waitForArchiveLifecycleChildExit(child, 50, { reapTimeoutMs: 2_000 })
        const observed = await waiting.catch((error: unknown) => ({
          error,
          childAlive: processExists(pids.childPid),
          grandchildAlive: processExists(pids.grandchildPid),
        }))

        expect(observed).toMatchObject({
          error: expect.objectContaining({
            message: expect.stringMatching(/child deadline/iu),
          }),
          childAlive: false,
          grandchildAlive: false,
        })
      } finally {
        if (childPid !== null) {
          try {
            process.kill(-childPid, 'SIGKILL')
          } catch (error) {
            expect((error as NodeJS.ErrnoException).code).toBe('ESRCH')
          }
        }
      }
    },
  )

  it('spawns the POSIX lifecycle runner as its own process-group leader', () => {
    const source = readFileSync(ciRunnerPath, 'utf8')

    expect(source).toContain("detached: process.platform !== 'win32'")
  })

  it('freshens canonical evidence and assigns private child staging before spawn', () => {
    const source = readFileSync(ciRunnerPath, 'utf8')
    const freshBoundary = source.indexOf(
      'await prepareArchiveLifecycleSupervisorTerminalRun({',
    )
    const stagedInvocation = source.indexOf(
      'evidenceDir: terminalRun.childEvidenceDir',
      freshBoundary,
    )
    const preparedInvocation = source.indexOf('preparedEvidence: true', stagedInvocation)
    const spawnBoundary = source.indexOf('const child = spawn(command, args, {')
    const settlementObservation = source.indexOf(
      'childSettled = !childCreated || error?.archiveLifecycleChildSettled === true',
      spawnBoundary,
    )
    const settlementHandoff = source.indexOf('childSettled,', settlementObservation)

    expect(freshBoundary).toBeGreaterThan(0)
    expect(stagedInvocation).toBeGreaterThan(freshBoundary)
    expect(preparedInvocation).toBeGreaterThan(stagedInvocation)
    expect(spawnBoundary).toBeGreaterThan(preparedInvocation)
    expect(settlementObservation).toBeGreaterThan(spawnBoundary)
    expect(settlementHandoff).toBeGreaterThan(settlementObservation)
  })

  it('consumes a checked success terminal under the live supervisor lease before returning', () => {
    const source = readFileSync(ciRunnerPath, 'utf8')
    const terminalBoundary = source.indexOf(
      'const terminal = await ensureArchiveLifecycleSupervisorTerminalArtifact({',
    )
    const successKindCheck = source.indexOf("if (terminal.kind !== 'success')", terminalBoundary)
    const successConsume = source.indexOf(
      'await consumeArchiveLifecycleSupervisorTerminalArtifact({ terminal, terminalRun })',
      successKindCheck,
    )
    const mainEnd = source.indexOf('\n}', successConsume)

    expect(terminalBoundary).toBeGreaterThan(0)
    expect(successKindCheck).toBeGreaterThan(terminalBoundary)
    expect(successConsume).toBeGreaterThan(successKindCheck)
    expect(mainEnd).toBeGreaterThan(successConsume)
  })

  it('bounds lifecycle CDP calls before, during, and after active liveness monitoring', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const seed = source.indexOf('withArchiveLifecycleWorkloadTimeout(seedAndFinishMission(')
    const probe = source.indexOf('livenessProbe = createPackagedLivenessProbe', seed)
    const restartRead = source.indexOf(
      'livenessProbe.guardOperation(readRetainedArchive(',
      probe,
    )
    const finished = source.indexOf('const liveness = await livenessProbe.finish()', restartRead)
    const postCleanup = source.indexOf(
      'withArchiveLifecycleWorkloadTimeout(assertPostCleanupState({',
      finished,
    )

    expect(seed).toBeGreaterThan(0)
    expect(probe).toBeGreaterThan(seed)
    expect(restartRead).toBeGreaterThan(probe)
    expect(finished).toBeGreaterThan(restartRead)
    expect(postCleanup).toBeGreaterThan(finished)
  })

  it('classifies a bounded workload timeout separately while retaining liveness diagnostics', async () => {
    vi.useFakeTimers()
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-workload-timeout-'))
    try {
      const workload = withArchiveLifecycleWorkloadTimeout(
        new Promise<never>(() => undefined),
        25,
        'Archive-lifecycle synthetic workload timed out.',
      )
      const failure = workload.catch((error: unknown) => error as Error & { code?: string })

      await vi.advanceTimersByTimeAsync(25)
      const error = await failure
      expect(error.code).toBe('ARCHIVE_LIFECYCLE_WORKLOAD_TIMEOUT')
      Object.defineProperty(error, 'archiveLifecycleDiagnostics', {
        value: Object.freeze({
          errorKinds: Object.freeze(['operation_deadline_exceeded']),
          activePhase: 'restore',
        }),
      })
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.failure).toMatchObject({
        classification: 'workload_timeout',
        archiveLifecycleDiagnostics: {
          errorKinds: ['operation_deadline_exceeded'],
          activePhase: 'restore',
        },
      })
    } finally {
      vi.useRealTimers()
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it.each([
    { invalid: undefined },
    { invalid: Number.NaN },
    { invalid: Number.POSITIVE_INFINITY },
    { invalid: 1n },
    { invalid: new Date('2026-09-07T00:00:00.000Z') },
    { invalid: new Map([['key', 'value']]) },
    { invalid: { toJSON: () => null } },
  ])('rejects values JSON would silently drop or change during Review export: $invalid', async ({ invalid }) => {
    const previousBridge = Object.getOwnPropertyDescriptor(window, 'sartrackerElectron')
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { archiveReview: { read: async () => ({ breadcrumbCount: 2, invalid }) } },
    })
    const page = {
      evaluate: async (operation: (request: unknown) => Promise<unknown>, request: unknown) => operation(request),
    }
    try {
      await expect(readArchiveReviewContent(page, {
        sessionId: 'session-1',
        missionId: 'mission-1',
        selectedTime: '2026-09-07T00:00:00.000Z',
      })).rejects.toThrow('Archive Review evidence contains a non-JSON value.')
    } finally {
      if (previousBridge === undefined) Reflect.deleteProperty(window, 'sartrackerElectron')
      else Object.defineProperty(window, 'sartrackerElectron', previousBridge)
    }
  })

  it('streams Review reads as bounded renderer transfers instead of one aggregate response', async () => {
    const requests: Array<{ readonly method: string; readonly requestId: string }> = []
    const transferredValues: unknown[] = []
    let activeTransfers = 0
    let maximumActiveTransfers = 0
    const auditEvents = [{
      id: 'audit-1',
      details: { text: 'Dún "test"\nline', optional: null, active: false, count: 0 },
    }]
    const responses: Record<string, unknown[]> = {
      readMissionReview: [{ breadcrumbCount: 2, auditEvents }],
      readMissionReplay: [{
        totalTrackCount: 2,
        totalObjectCount: 2,
        availableOutingTotalCount: 2,
        replayGeneration: 7,
        tracks: [{ id: 'track-1' }],
        objects: [{ id: 'object-1' }],
        availableOutingIds: ['outing-1'],
        nextCursor: 'track-next',
        nextObjectCursor: 'object-next',
        availableOutingNextCursor: 'outing-next',
      }],
      readMissionReplayTrackChunk: [{
        tracks: [{ id: 'track-2' }],
        nextCursor: null,
      }],
      readMissionReplayObjectChunk: [{
        objects: [{ id: 'object-2' }],
        nextObjectCursor: null,
      }],
      readMissionReplayFilterPage: [{
        entries: [{ id: 'outing-2' }],
        nextCursor: null,
      }],
      listMissions: [[{ id: 'mission-1' }]],
      recordMutationDenied: [true],
    }
    const previousBridge = Object.getOwnPropertyDescriptor(window, 'sartrackerElectron')
    const archiveRead = vi.fn(async (
      request: { readonly method: string; readonly requestId: string },
    ) => {
      requests.push(request)
      if (request.method === 'upsertMarker') {
        throw new Error('Archive Review is read-only.')
      }
      return responses[request.method]?.shift()
    })
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: { archiveReview: { read: archiveRead } },
    })
    const page = {
      evaluate: vi.fn(async (
        operation: (request: unknown) => Promise<unknown>,
        request: { readonly method: string; readonly requestId: string },
      ) => {
        activeTransfers += 1
        maximumActiveTransfers = Math.max(maximumActiveTransfers, activeTransfers)
        try {
          await Promise.resolve()
          const transferred = await operation(request)
          transferredValues.push(transferred)
          return transferred
        } finally {
          activeTransfers -= 1
        }
      }),
    }

    let review
    try {
      review = await readArchiveReviewContent(page, {
        sessionId: 'session-1',
        missionId: 'mission-1',
        selectedTime: '2026-08-29T08:00:00.000Z',
      })
    } finally {
      if (previousBridge === undefined) {
        Reflect.deleteProperty(window, 'sartrackerElectron')
      } else {
        Object.defineProperty(window, 'sartrackerElectron', previousBridge)
      }
    }

    expect(maximumActiveTransfers).toBe(1)
    // Full JSON-safe pages must cross CDP as primitives so Playwright does not
    // recursively re-encode thousands of row fields on the observed renderer.
    expect(transferredValues.map((value) => typeof value)).toEqual([
      'string', 'string', 'string', 'string', 'string', 'string', 'boolean', 'string',
    ])
    expect(requests.map((request) => request.method)).toEqual([
      'readMissionReview',
      'readMissionReplay',
      'readMissionReplayTrackChunk',
      'readMissionReplayObjectChunk',
      'readMissionReplayFilterPage',
      'listMissions',
      'upsertMarker',
      'recordMutationDenied',
    ])
    expect(new Set(requests.map((request) => request.requestId)).size).toBe(requests.length)
    expect(review).toEqual({
      reviewResult: { breadcrumbCount: 2, auditEvents },
      replayResult: {
        query: {
          missionId: 'mission-1',
          selectedTime: '2026-08-29T08:00:00.000Z',
          timezone: 'Europe/Dublin',
          trackLimit: 1_000,
          objectLimit: 100,
        },
        initial: {
          totalTrackCount: 2,
          totalObjectCount: 2,
          availableOutingTotalCount: 2,
          replayGeneration: 7,
          tracks: [{ id: 'track-1' }],
          objects: [{ id: 'object-1' }],
          availableOutingIds: ['outing-1'],
          nextCursor: 'track-next',
          nextObjectCursor: 'object-next',
          availableOutingNextCursor: 'outing-next',
        },
        trackPages: [{
          request: {
            missionId: 'mission-1',
            selectedTime: '2026-08-29T08:00:00.000Z',
            timezone: 'Europe/Dublin',
            trackLimit: 1_000,
            objectLimit: 100,
            cursor: 'track-next',
          },
          result: { tracks: [{ id: 'track-2' }], nextCursor: null },
        }],
        objectPages: [{
          request: {
            missionId: 'mission-1',
            selectedTime: '2026-08-29T08:00:00.000Z',
            timezone: 'Europe/Dublin',
            trackLimit: 1_000,
            objectLimit: 100,
            objectCursor: 'object-next',
            replayGeneration: 7,
          },
          result: { objects: [{ id: 'object-2' }], nextObjectCursor: null },
        }],
        outingFilterPages: [{
          request: {
            missionId: 'mission-1',
            selectedTime: '2026-08-29T08:00:00.000Z',
            timezone: 'Europe/Dublin',
            trackLimit: 1_000,
            objectLimit: 100,
            filterKind: 'outing',
            filterCursor: 'outing-next',
            filterLimit: 100,
            filterSearch: '',
          },
          result: { entries: [{ id: 'outing-2' }], nextCursor: null },
        }],
      },
      missions: [{ id: 'mission-1' }],
      mutationDenied: true,
      denialAudited: true,
    })
  })

  it('settles both independent renderer transports when either close rejects', async () => {
    const workflowClose = vi.fn().mockRejectedValue(new Error('workflow close failed'))
    const livenessClose = vi.fn().mockRejectedValue(new Error('liveness close failed'))

    await expect(closeRendererTransports({
      browser: { close: workflowClose },
      livenessBrowser: { close: livenessClose },
    })).resolves.toBeUndefined()

    expect(workflowClose).toHaveBeenCalledOnce()
    expect(livenessClose).toHaveBeenCalledOnce()
  })

  it('bounds each renderer transport close before process cleanup continues', async () => {
    vi.useFakeTimers()
    try {
      const workflowClose = vi.fn(async () => undefined)
      const livenessClose = vi.fn(() => new Promise<void>(() => undefined))
      let settled = false
      const closing = closeRendererTransports({
        browser: { close: workflowClose },
        livenessBrowser: { close: livenessClose },
      }, { timeoutMs: 25 }).then(() => { settled = true })

      await Promise.resolve()
      expect(workflowClose).toHaveBeenCalledOnce()
      expect(livenessClose).toHaveBeenCalledOnce()
      expect(settled).toBe(false)
      await vi.advanceTimersByTimeAsync(25)
      await closing
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('selects the same exact renderer target across independent CDP clients', async () => {
    const workflowPage = { name: 'workflow', targetId: 'target-2' }
    const wrongPage = { name: 'wrong', targetId: 'target-1' }
    const exactPage = { name: 'exact', targetId: 'target-2' }
    const context = (pages: Array<{ readonly targetId: string }>) => ({
      pages: () => pages,
      newCDPSession: async (page: { readonly targetId: string }) => ({
        send: async () => ({ targetInfo: { targetId: page.targetId } }),
        detach: async () => undefined,
      }),
    })

    await expect(selectExactRendererTarget(
      context([workflowPage]),
      workflowPage,
      context([wrongPage, exactPage]),
    )).resolves.toBe(exactPage)
  })

  it('fails closed when the exact renderer target is missing or ambiguous', async () => {
    const workflowPage = { targetId: 'target-2' }
    const context = (pages: Array<{ readonly targetId: string }>) => ({
      pages: () => pages,
      newCDPSession: async (page: { readonly targetId: string }) => ({
        send: async () => ({ targetInfo: { targetId: page.targetId } }),
        detach: async () => undefined,
      }),
    })

    await expect(selectExactRendererTarget(
      context([workflowPage]),
      workflowPage,
      context([{ targetId: 'target-1' }]),
    )).rejects.toThrow(/exact renderer target/iu)
    await expect(selectExactRendererTarget(
      context([workflowPage]),
      workflowPage,
      context([{ targetId: 'target-2' }, { targetId: 'target-2' }]),
    )).rejects.toThrow(/exact renderer target/iu)
  })

  it('does not arm liveness from the participant empty-state placeholder', () => {
    const exactParticipant = {
      kind: 'device',
      removed_at: null,
      traccar_device_id: '991',
    }
    const exactRenderedParticipant = {
      kind: 'device',
      traccarDeviceId: '991',
    }

    expect(isExactLivenessParticipantReady({
      renderedParticipants: [],
      participants: [exactParticipant],
    }, 991)).toBe(false)
    expect(isExactLivenessParticipantReady({
      renderedParticipants: [exactRenderedParticipant],
      participants: [exactParticipant],
    }, 991)).toBe(true)
    for (const snapshot of [
      {
        renderedParticipants: [{ ...exactRenderedParticipant, traccarDeviceId: '992' }],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [{ kind: 'group', traccarDeviceId: null }],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [exactRenderedParticipant, exactRenderedParticipant],
        participants: [exactParticipant],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, traccar_device_id: '992' }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, removed_at: '2026-09-05T01:40:35.000Z' }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [{ ...exactParticipant, kind: 'group', traccar_device_id: null }],
      },
      {
        renderedParticipants: [exactRenderedParticipant],
        participants: [exactParticipant, { ...exactParticipant }],
      },
    ]) {
      expect(isExactLivenessParticipantReady(snapshot, 991)).toBe(false)
    }

    const source = readFileSync(runnerPath, 'utf8')
    const participantWait = source.slice(
      source.indexOf('async function waitForExactLivenessParticipant('),
      source.indexOf('/** Waits until the backend and renderer agree', source.indexOf(
        'async function waitForExactLivenessParticipant(',
      )),
    )
    expect(participantWait).toContain("querySelectorAll(':scope > .sar-readout')")
    expect(participantWait).toContain("getAttribute('data-participant-kind')")
    expect(participantWait).toContain("getAttribute('data-traccar-device-id')")
    expect(participantWait).toContain('.listMissionParticipants?.(expectedMissionId)')
    expect(participantWait).toContain('isExactLivenessParticipantReady(')
    expect(participantWait).not.toContain('.children.length')
  })

  it('fails closed when the participant readiness IPC read never settles', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        evaluate: vi.fn(() => new Promise(() => undefined)),
      }
      const readiness = waitForExactLivenessParticipant(
        page,
        '00000000-0000-4000-8000-000000000001',
        991,
        30,
      )
      const rejection = expect(readiness).rejects.toThrow(
        'Archive-lifecycle liveness participant readiness read timed out.',
      )

      await vi.advanceTimersByTimeAsync(31)
      await rejection
      expect(page.evaluate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('hydrates the recovered participant before launch-two liveness attachment', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const restartStart = source.indexOf('restartedLaunch = await launchPackagedApp')
    const resume = source.indexOf('await resumeLivenessMission(', restartStart)
    const attach = source.indexOf('await livenessProbe.attachLaunch(restartedLaunch)', restartStart)
    const restoredOperation = source.indexOf(
      'const resumedRestoreOperation = await livenessProbe.beginPhaseOperation(',
      restartStart,
    )
    const restoredOperationCompleted = source.indexOf(
      'completePhaseOperation(resumedRestoreOperation)',
      restoredOperation,
    )
    const restoredOperationFlow = source.slice(restoredOperation, restoredOperationCompleted)

    expect(restartStart).toBeGreaterThan(0)
    expect(resume).toBeGreaterThan(restartStart)
    expect(source.slice(resume, attach)).toContain('livenessMission.mission.id')
    expect(attach).toBeGreaterThan(resume)
    expect(restoredOperation).toBeGreaterThan(attach)
    expect(restoredOperationCompleted).toBeGreaterThan(restoredOperation)
    expect(restoredOperationFlow).toContain('waitForOperationFreshSample(')
    expect(restoredOperationFlow).toContain('resumedRestoreOperation,')
    expect(restoredOperationFlow).toContain('options.timeoutMs,')
    expect(restoredOperationFlow).not.toContain('waitForPhaseSample(')
  })

  it('rejects a same-name active mission decoy after restart', async () => {
    const expectedMissionId = '00000000-0000-4000-8000-000000000001'
    const page = {
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000002',
        name: 'Packaged Archive Liveness Probe',
        status: 'active',
      })),
    }

    await expect(waitForActiveMission(
      page,
      'Packaged Archive Liveness Probe',
      30_000,
      expectedMissionId,
    )).rejects.toThrow('exact expected identity')
    expect(page.waitForFunction).toHaveBeenCalledWith(
      expect.any(Function),
      { name: 'Packaged Archive Liveness Probe', id: expectedMissionId },
      { timeout: expect.any(Number) },
    )
    const timeout = page.waitForFunction.mock.calls[0]?.[2]?.timeout
    expect(timeout).toBeGreaterThan(0)
    expect(timeout).toBeLessThanOrEqual(30_000)
  })

  it('accepts the exact active mission identity after restart', async () => {
    const expectedMission = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Packaged Archive Liveness Probe',
      status: 'active',
    }
    const page = {
      waitForFunction: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => expectedMission),
    }

    await expect(waitForActiveMission(
      page,
      expectedMission.name,
      30_000,
      expectedMission.id,
    )).resolves.toEqual(expectedMission)
  })

  it('fails closed when the active mission confirmation IPC read never settles', async () => {
    vi.useFakeTimers()
    try {
      const page = {
        waitForFunction: vi.fn(async () => undefined),
        evaluate: vi.fn(() => new Promise(() => undefined)),
      }
      const readiness = waitForActiveMission(
        page,
        'Packaged Archive Liveness Probe',
        30,
        '00000000-0000-4000-8000-000000000001',
      )
      const rejection = expect(readiness).rejects.toThrow(
        'Archive-lifecycle liveness mission confirmation read timed out.',
      )

      await vi.advanceTimersByTimeAsync(31)
      await rejection
      expect(page.waitForFunction).toHaveBeenCalledTimes(1)
      expect(page.evaluate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the real packaged tracking and MapLibre path under two external watchdogs', () => {
    const source = readFileSync(runnerPath, 'utf8')

    expect(source).toContain('startArchiveLifecycleLivenessMockTraccarServer')
    expect(source).toContain('SARTRACKER_ELECTRON_SOAK_POLL_INTERVAL_MS')
    expect(source).toContain('`--inspect=${inspectorPort}`')
    expect(source).toContain('connectMainInspector')
    expect(source).toContain('installRendererLivenessProbe')
    expect(source).toContain("getSource('tracking')")
    expect(source).toContain('source.updateData =')
    expect(source).toContain('requestAnimationFrame')
    expect(source).toContain("mainInspector.evaluate('process.uptime()')")
  })

  it('emits the strict v2 phase aggregate and never substitutes direct database timing', () => {
    const source = readFileSync(runnerPath, 'utf8')

    expect(source).toContain('schemaVersion: 2')
    expect(source).toContain("proofKind: 'packaged-electron-archive-lifecycle-v2'")
    expect(source).toContain("provenance: 'packaged-electron-external-watchdog-v1'")
    expect(source).toContain("mode: 'time-compressed-validation'")
    for (const field of [
      'sampleCount',
      'currentFixMaxGapMs',
      'sourceToRendererMaxMs',
      'requestToRendererMaxMs',
      'mainWatchdogMaxGapMs',
      'rendererFrameMaxGapMs',
    ]) expect(source).toContain(field)
    for (const phase of ['create', 'verify', 'restore', 'cleanup']) {
      expect(source).toContain(`'${phase}'`)
    }
    expect(source).not.toContain('inspectDatabase(')
  })

  it('binds the post-cleanup archive review to a fresh restore operation', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const reviewStart = source.indexOf('const secondReview =')
    const reviewEnd = source.indexOf('const postCleanup =', reviewStart)
    const reviewFlow = source.slice(
      source.lastIndexOf("await livenessProbe.setPhase('cleanup')", reviewStart),
      reviewEnd,
    )
    const restoreBaselineRead = reviewFlow.indexOf(
      'const restoreSamplesBeforePostCleanupReview =',
    )
    const restorePhaseStart = reviewFlow.indexOf("await livenessProbe.setPhase('restore')")
    const restoreBaselineWait = reviewFlow.indexOf(
      'restoreSamplesBeforePostCleanupReview + 1',
    )
    const reviewOperationStart = reviewFlow.indexOf('const secondReviewOperation =')

    expect(reviewStart).toBeGreaterThan(0)
    expect(reviewEnd).toBeGreaterThan(reviewStart)
    expect(restoreBaselineRead).toBeGreaterThan(0)
    expect(restorePhaseStart).toBeGreaterThan(restoreBaselineRead)
    expect(restoreBaselineWait).toBeGreaterThan(restorePhaseStart)
    expect(reviewOperationStart).toBeGreaterThan(restoreBaselineWait)
    expect(reviewFlow).toContain('const secondReviewOperation = await livenessProbe.beginPhaseOperation(')
    expect(reviewFlow).toContain("'review_after_cleanup'")
    expect(reviewFlow).toContain('), secondReviewOperation)')
    expect(reviewFlow).toContain('completePhaseOperation(secondReviewOperation)')
  })

  it('binds every archive workload to its fixed diagnostic operation kind', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const finalizeStart = source.indexOf('const [createOperation, verifyOperation] =')
    const finalizeEnd = source.indexOf('completePhaseOperation(verifyOperation)', finalizeStart)
    const finalizeFlow = source.slice(finalizeStart, finalizeEnd)
    expect(finalizeStart).toBeGreaterThan(0)
    expect(finalizeEnd).toBeGreaterThan(finalizeStart)
    expect(finalizeFlow).toMatch(/\[\s*'create',\s*'verify',?\s*\]/su)
    expect(finalizeFlow).toMatch(/\[\s*'finalize_archive',\s*'verify_archive',?\s*\]/su)
    expect(finalizeFlow).toContain('guardOperation(finalizeAndVerifyArchive(')

    for (const binding of [
      {
        variable: 'firstReviewOperation',
        phase: 'restore',
        kind: 'review_before_cleanup',
        workload: 'guardOperation(runReadOnlyReview(',
      },
      {
        variable: 'interruptedRestoreOperation',
        phase: 'restore',
        kind: 'interrupt_decrypt',
        workload: 'guardOperation(interruptRestoreAtDecrypt(',
      },
      {
        variable: 'resumedRestoreOperation',
        phase: 'restore',
        kind: 'resume_interrupted_restore',
        workload: 'guardOperation(',
      },
      {
        variable: 'cleanupOperation',
        phase: 'cleanup',
        kind: 'cleanup_pending_restore',
        workload: 'guardOperation(runCleanup(',
      },
      {
        variable: 'secondReviewOperation',
        phase: 'restore',
        kind: 'review_after_cleanup',
        workload: 'guardOperation(runReadOnlyReview(',
      },
    ]) {
      const start = source.indexOf(`const ${binding.variable} =`)
      const end = source.indexOf(`completePhaseOperation(${binding.variable})`, start)
      const flow = source.slice(start, end)
      expect(start).toBeGreaterThan(0)
      expect(end).toBeGreaterThan(start)
      expect(flow).toMatch(new RegExp(
        `beginPhaseOperation\\(\\s*'${binding.phase}',\\s*'${binding.kind}',?\\s*\\)`,
        'su',
      ))
      expect(flow).toContain(binding.workload)
    }
  })

  it('ends terminal liveness monitoring before unrelated post-cleanup inspection', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const reviewCompleted = source.indexOf('completePhaseOperation(secondReviewOperation)')
    const detached = source.indexOf('livenessProbe.detachLaunch(restartedLaunch)', reviewCompleted)
    const postCleanup = source.indexOf('assertPostCleanupState({', reviewCompleted)

    expect(reviewCompleted).toBeGreaterThan(0)
    expect(detached).toBeGreaterThan(reviewCompleted)
    expect(postCleanup).toBeGreaterThan(detached)
  })

  it('publishes and always uploads one bounded failure receipt', () => {
    const source = readFileSync(runnerPath, 'utf8')
    const workflow = readFileSync(workflowPath, 'utf8')
    const protectedSetupStart = source.indexOf('let profileCleanupCompleted = false')
    const lifecycleTry = source.indexOf('try {', protectedSetupStart)
    const profileAllocation = source.indexOf('userDataDir = await mkdtemp', lifecycleTry)
    const packagedArchiveCheck = source.indexOf(
      'packagedApplicationArchivePath = resolvePackagedApplicationArchivePath',
      lifecycleTry,
    )
    const cleanupLoop = source.indexOf(
      'const cleanup = await cleanupArchiveLifecycleResources({',
      lifecycleTry,
    )
    const failurePublish = source.indexOf(
      'writeArchiveLifecycleFailureReceipt({',
      cleanupLoop,
    )

    expect(source).toContain('electron-archive-lifecycle-smoke-failure.json')
    expect(source).toContain('writeArchiveLifecycleFailureReceipt')
    expect(source).toContain('archiveLifecycleDiagnostics')
    expect(source).toContain('closedGateFailures,')
    expect(lifecycleTry).toBeGreaterThan(protectedSetupStart)
    expect(profileAllocation).toBeGreaterThan(lifecycleTry)
    expect(packagedArchiveCheck).toBeGreaterThan(profileAllocation)
    expect(cleanupLoop).toBeGreaterThan(packagedArchiveCheck)
    expect(failurePublish).toBeGreaterThan(cleanupLoop)
    expect(workflow).toContain(
      'tmp/breadcrumb-pr6-packaged-archive-smoke/electron-archive-lifecycle-smoke-failure.json',
    )
    expect(source).not.toContain('}).catch(() => null)')
    expect(workflow).toContain('Verify archive lifecycle terminal evidence')
    expect(workflow).toContain('terminalArtifacts.length !== 1')
  })

  it('keeps the disposable profile and retry ownership after a launch stop failure', async () => {
    const launchStopFailure = new Error('Electron shutdown timed out.')
    const removeProfile = vi.fn(async () => undefined)
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-cleanup-'))
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-owned',
      removeProfile,
      steps: [
        { name: 'liveness_probe_stop', blocksProfileCleanup: false, run: async () => undefined },
        {
          name: 'restarted_launch_stop',
          blocksProfileCleanup: true,
          run: async () => { throw launchStopFailure },
        },
        { name: 'mock_server_close', blocksProfileCleanup: false, run: async () => undefined },
      ],
    })

    expect(removeProfile).not.toHaveBeenCalled()
    expect(cleanup).toMatchObject({
      failure: launchStopFailure,
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
      cleanupFailureCount: 1,
      cleanupFailures: [{
        step: 'restarted_launch_stop',
        error: launchStopFailure,
      }],
    })

    try {
      const failurePath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      expect(JSON.parse(await readFile(failurePath, 'utf8'))).toMatchObject({
        cleanup: {
          cleanupFailureCount: 1,
          failures: [{
            step: 'restarted_launch_stop',
            classification: 'cleanup_failure',
            message: 'Electron shutdown timed out.',
            archiveLifecycleDiagnostics: null,
          }],
          processCleanupCompleted: false,
          profileCleanupCompleted: false,
        },
        verdict: { passed: false },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }

    const source = readFileSync(runnerPath, 'utf8')
    expect(source).toContain('if (cleanup.processCleanupCompleted) activeLaunch = null')
  })

  it('counts only a genuinely new liveness finalization failure during cleanup', async () => {
    const primaryFailure = new Error('Primary liveness failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['source_identity_left_pending_at_operation_start'],
        activePhase: 'create',
      }),
    })
    const evolvedFailure = new Error('Evolved liveness stop failure.')
    Object.defineProperty(evolvedFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: [
          'current_fix_not_observed_before_gate',
          'source_identity_left_pending_at_operation_start',
        ],
        activePhase: 'create',
      }),
    })
    const removeProfile = vi.fn(async () => undefined)
    const repeated = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-repeat',
      removeProfile,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw primaryFailure },
      }],
    })

    expect(repeated).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 0,
      cleanupFailures: [],
      processCleanupCompleted: true,
      profileCleanupCompleted: true,
    })

    const withNewFailure = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-new-stop',
      removeProfile,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw evolvedFailure },
      }],
    })
    expect(withNewFailure).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{
        step: 'liveness_probe_stop',
        error: evolvedFailure,
      }],
      processCleanupCompleted: true,
      profileCleanupCompleted: true,
    })
    expect(readFileSync(runnerPath, 'utf8')).toContain(
      'run: () => livenessProbe?.stop(lifecycleFailure)',
    )
  })

  it('does not suppress a primary error object replayed by a different cleanup step', async () => {
    const primaryFailure = new Error('Primary lifecycle failure.')
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-launch-replay',
      removeProfile: async () => undefined,
      steps: [{
        name: 'restarted_launch_stop',
        blocksProfileCleanup: true,
        run: async () => { throw primaryFailure },
      }],
    })

    expect(cleanup).toMatchObject({
      failure: primaryFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{ step: 'restarted_launch_stop', error: primaryFailure }],
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
    })
  })

  it('normalizes null and undefined cleanup-step rejections into non-null failures', async () => {
    const removeProfile = vi.fn(async () => undefined)
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-nullish-steps',
      removeProfile,
      steps: [
        {
          name: 'liveness_probe_stop',
          blocksProfileCleanup: false,
          run: async () => { throw null },
        },
        {
          name: 'restarted_launch_stop',
          blocksProfileCleanup: true,
          run: async () => Promise.reject(undefined),
        },
      ],
    })

    expect(removeProfile).not.toHaveBeenCalled()
    expect(cleanup.failure).toBeInstanceOf(Error)
    expect(cleanup.cleanupFailures).toHaveLength(2)
    expect(cleanup.cleanupFailures).toEqual([
      {
        step: 'liveness_probe_stop',
        error: expect.objectContaining({
          message: expect.stringMatching(/liveness_probe_stop.*without a reason/iu),
        }),
      },
      {
        step: 'restarted_launch_stop',
        error: expect.objectContaining({
          message: expect.stringMatching(/restarted_launch_stop.*without a reason/iu),
        }),
      },
    ])
    expect(cleanup).toMatchObject({
      cleanupFailureCount: 2,
      processCleanupCompleted: false,
      profileCleanupCompleted: false,
    })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('normalizes a %s profile-removal rejection', async (_label, rejection) => {
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-nullish-profile',
      removeProfile: async () => Promise.reject(rejection),
      steps: [],
    })

    expect(cleanup.failure).toBeInstanceOf(Error)
    expect(cleanup.cleanupFailures).toEqual([{
      step: 'profile_removal',
      error: expect.objectContaining({
        message: expect.stringMatching(/profile_removal.*without a reason/iu),
      }),
    }])
    expect(cleanup).toMatchObject({
      cleanupFailureCount: 1,
      processCleanupCompleted: true,
      profileCleanupCompleted: false,
    })
  })

  it('publishes an evolved liveness cleanup failure with its latest diagnostics', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-details-'))
    const primaryFailure = new Error('Initial renderer collection failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'create',
        rendererCdpFailure: {
          stage: 'snapshot_collection',
          causeClass: 'deadline_exceeded',
        },
      }),
    })
    const evolvedFailure = new Error('Liveness finalization recorded another gate.')
    Object.defineProperty(evolvedFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: [
          'current_fix_not_observed_before_gate',
          'renderer_cdp_watchdog_failed',
        ],
        activePhase: 'create',
        rendererCdpFailure: {
          stage: 'snapshot_collection',
          causeClass: 'deadline_exceeded',
        },
      }),
    })
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-details',
      removeProfile: async () => undefined,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw evolvedFailure },
      }],
    })

    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup).toEqual({
        cleanupFailureCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        failures: [
          {
            step: 'liveness_probe_stop',
            classification: 'external_liveness_gate_failure',
            message: 'Liveness finalization recorded another gate.',
            archiveLifecycleDiagnostics: {
              errorKinds: [
                'current_fix_not_observed_before_gate',
                'renderer_cdp_watchdog_failed',
              ],
              activePhase: 'create',
              rendererCdpFailure: {
                stage: 'snapshot_collection',
                causeClass: 'deadline_exceeded',
              },
            },
          },
        ],
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes a new same-kind CDP failure from liveness stop', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-cdp-'))
    const primaryFailure = new Error('Initial renderer collection failure.')
    Object.defineProperty(primaryFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'create',
      }),
    })
    const sameKindCdpFailure = new Error(
      'Archive-lifecycle renderer collection failed during liveness stop.',
      { cause: primaryFailure },
    )
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: primaryFailure,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-cdp',
      removeProfile: async () => undefined,
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => { throw sameKindCdpFailure },
      }],
    })

    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: cleanup.failure,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: cleanup.processCleanupCompleted,
        profileCleanupCompleted: cleanup.profileCleanupCompleted,
        cleanupFailureCount: cleanup.cleanupFailureCount,
        cleanupFailures: cleanup.cleanupFailures,
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup.failures).toEqual([{
        step: 'liveness_probe_stop',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle renderer collection failed during liveness stop.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('retains profile-removal failure attribution and bounds cleanup step names', async () => {
    const profileFailure = new Error('Disposable profile removal failed.')
    const cleanup = await cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: '/tmp/sartracker-pr6-archive-smoke-profile-failure',
      removeProfile: async () => { throw profileFailure },
      steps: [{
        name: 'liveness_probe_stop',
        blocksProfileCleanup: false,
        run: async () => undefined,
      }],
    })

    expect(cleanup).toMatchObject({
      failure: profileFailure,
      cleanupFailureCount: 1,
      cleanupFailures: [{ step: 'profile_removal', error: profileFailure }],
      processCleanupCompleted: true,
      profileCleanupCompleted: false,
    })
    await expect(cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: null,
      removeProfile: async () => undefined,
      steps: [{
        name: '../private-profile',
        blocksProfileCleanup: false,
        run: async () => undefined,
      }],
    })).rejects.toThrow(/cleanup inputs are invalid/iu)
    await expect(cleanupArchiveLifecycleResources({
      failure: null,
      profilePath: null,
      removeProfile: async () => undefined,
      steps: Array.from({ length: 9 }, (_entry, index) => ({
        name: `cleanup_step_${index}`,
        blocksProfileCleanup: false,
        run: async () => undefined,
      })),
    })).rejects.toThrow(/cleanup inputs are invalid/iu)
  })

  it('rejects inconsistent cleanup failure counts and details', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-mismatch-'))
    try {
      await expect(writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Lifecycle failed.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })).rejects.toThrow(/cleanup failure count.*details/iu)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('redacts custody values and local paths from cleanup failure details', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-redaction-'))
    const secret = 'Secondary Cleanup Secret 2026!'
    const privatePath = '/Users/Private Operator/Builds/SAR Tracker.app/Contents/Resources/app.asar'
    const cleanupFailure = new Error(`Cleanup failed for ${secret} at '${privatePath}'`)
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['renderer_cdp_watchdog_failed'],
        activePhase: 'restore',
        privatePath,
      }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Primary lifecycle failure.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        secrets: [secret],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect(receipt.cleanup.failures[0]).toMatchObject({
        step: 'liveness_probe_stop',
        classification: 'external_liveness_gate_failure',
        message: "Cleanup failed for [REDACTED] at '[PATH]'",
        archiveLifecycleDiagnostics: {
          errorKinds: ['renderer_cdp_watchdog_failed'],
          activePhase: 'restore',
        },
      })
      expect(receipt.cleanup.failures[0].archiveLifecycleDiagnostics).not.toHaveProperty(
        'privatePath',
      )
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain(privatePath)
      expect(serialized).not.toContain('Private Operator')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('globally bounds nested diagnostic array fan-out', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-bounds-'))
    let nestedDiagnostics: unknown = 'renderer_cdp_watchdog_failed'
    for (let depth = 0; depth < 6; depth += 1) {
      nestedDiagnostics = Array(16).fill(nestedDiagnostics)
    }
    const cleanupFailure = new Error('Bound nested diagnostic evidence.')
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({ operations: nestedDiagnostics }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Primary lifecycle failure.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 1,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 1,
        cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')

      expect(serialized.length).toBeLessThan(8_000)
      expect(JSON.parse(serialized).cleanup.failures).toHaveLength(1)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes a bounded receipt when failure and detail accessors are hostile', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-failure-'))
    const hostileFailure = new Proxy({}, {
      get: () => { throw new Error('hostile failure getter') },
      getOwnPropertyDescriptor: () => { throw new Error('hostile descriptor getter') },
      getPrototypeOf: () => { throw new Error('hostile prototype getter') },
    })
    const hostileDetail = new Proxy({
      step: 'liveness_probe_stop',
      error: hostileFailure,
    }, {
      get: (_target, property, receiver) => {
        if (property === 'error') throw new Error('hostile cleanup detail getter')
        return Reflect.get(_target, property, receiver)
      },
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          error: hostileFailure,
          cleanupFailureCount: 1,
          cleanupFailures: [hostileDetail],
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.failure).toEqual({
        classification: 'lifecycle_failure',
        message: 'Archive-lifecycle failure did not expose a safe message.',
        archiveLifecycleDiagnostics: null,
      })
      expect(receipt.cleanup.failures).toEqual([{
        step: 'cleanup_detail_unreadable_0',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle cleanup failure detail was unreadable.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes when the bounded cleanup-detail array proxy is revoked', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-details-'))
    const details = Proxy.revocable([
      { step: 'liveness_probe_stop', error: new Error('Stop failed.') },
    ], {})
    details.revoke()
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          cleanupFailureCount: 1,
          cleanupFailures: details.proxy,
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.cleanup.failures).toEqual([{
        step: 'cleanup_detail_unreadable_0',
        classification: 'cleanup_failure',
        message: 'Archive-lifecycle cleanup failure detail was unreadable.',
        archiveLifecycleDiagnostics: null,
      }])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('bounds hostile diagnostic arrays, getters, proxies, and cycles', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-diagnostics-'))
    const hostileArray = new Proxy([], {
      get: (_target, property, receiver) => {
        if (property === 'length') throw new Error('hostile array length')
        return Reflect.get(_target, property, receiver)
      },
    })
    const cycle: Record<string, unknown> = {
      errorKinds: ['renderer_cdp_watchdog_failed'],
      operations: hostileArray,
    }
    Object.defineProperty(cycle, 'activePhase', {
      enumerable: true,
      get: () => { throw new Error('hostile diagnostic getter') },
    })
    const diagnosticProxy = new Proxy(cycle, {
      getOwnPropertyDescriptor: (target, property) => {
        if (property === 'phaseMetrics') throw new Error('hostile diagnostic descriptor')
        return Reflect.getOwnPropertyDescriptor(target, property)
      },
    })
    cycle.currentFixContinuity = diagnosticProxy
    const cleanupFailure = new Error('Diagnostic projection must stay bounded.')
    Object.defineProperty(cleanupFailure, 'archiveLifecycleDiagnostics', {
      value: diagnosticProxy,
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          cleanupFailureCount: 1,
          cleanupFailures: [{ step: 'liveness_probe_stop', error: cleanupFailure }],
        },
      ))
      const serialized = await readFile(reportPath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect(serialized.length).toBeLessThan(8_000)
      expect(receipt.cleanup.failures[0]).toMatchObject({
        classification: 'external_liveness_gate_failure',
        archiveLifecycleDiagnostics: {
          errorKinds: ['renderer_cdp_watchdog_failed'],
          currentFixContinuity: null,
          operations: [],
        },
      })
      expect(receipt.cleanup.failures[0].archiveLifecycleDiagnostics).not.toHaveProperty(
        'activePhase',
      )
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('replaces an oversized or throwing message getter with a bounded fallback', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-hostile-message-'))
    const oversizedMessage = {}
    Object.defineProperty(oversizedMessage, 'message', {
      get: () => 'x'.repeat(10_000),
    })
    const throwingMessage = {}
    Object.defineProperty(throwingMessage, 'message', {
      get: () => { throw new Error('hostile message getter') },
    })
    try {
      const oversizedPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error: oversizedMessage },
      ))
      const oversizedReceipt = JSON.parse(await readFile(oversizedPath, 'utf8'))
      expect(oversizedReceipt.failure.message).toBe(
        'Archive-lifecycle failure message exceeded the bounded evidence limit.',
      )

      const throwingPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error: throwingMessage },
      ))
      const throwingReceipt = JSON.parse(await readFile(throwingPath, 'utf8'))
      expect(throwingReceipt.failure.message).toBe(
        'Archive-lifecycle failure did not expose a safe message.',
      )

      const emptyPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { error: new Error('') },
      ))
      const emptyReceipt = JSON.parse(await readFile(emptyPath, 'utf8'))
      expect(emptyReceipt.failure.message).toBe(
        'Archive-lifecycle failure did not expose a safe message.',
      )
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('atomically publishes exactly one success or failure terminal artifact', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-terminal-'))
    const successPath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-report.json')
    const failurePath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')
    try {
      await writeFile(failurePath, '{"stale":true}\n', { mode: 0o600 })
      await writeArchiveLifecycleSuccessReport({
        evidenceDir,
        evidence: { verdict: { passed: true } },
      })

      expect(JSON.parse(await readFile(successPath, 'utf8'))).toEqual({
        verdict: { passed: true },
      })
      await expect(access(failurePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await readdir(evidenceDir)).filter((entry) => entry.startsWith('.'))).toEqual([])

      await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Lifecycle failed.'),
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 2,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      await expect(access(successPath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(JSON.parse(await readFile(failurePath, 'utf8'))).toMatchObject({
        verdict: { passed: false },
      })
      expect((await readdir(evidenceDir)).filter((entry) => entry.startsWith('.'))).toEqual([])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('retains bounded final evidence-validation reasons in the failure receipt', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-validation-failure-'))
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          closedGateFailures: [
            'Cleanup renderer-frame maximum gap must be finite, non-negative, and less than 200 ms.',
          ],
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.failure).toEqual({
        classification: 'evidence_validation_failure',
        message: 'Primary lifecycle failure.',
        archiveLifecycleDiagnostics: null,
        closedGateFailures: {
          failureCount: 1,
          reasons: [
            'Cleanup renderer-frame maximum gap must be finite, non-negative, and less than 200 ms.',
          ],
        },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('carries validator reasons through secondary cleanup failure into the receipt', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-validation-flow-'))
    const evidence = createPackagedArchiveLifecycleV2Evidence()
    const cleanupLiveness = (
      (evidence.liveness as Record<string, unknown>).byPhase as Record<string, unknown>
    ).cleanup as Record<string, unknown>
    cleanupLiveness.rendererFrameMaxGapMs = 200
    const validationFailure = createArchiveLifecycleEvidenceValidationFailure(evidence)
    expect(validationFailure).not.toBeNull()
    const cleanupFailure = new Error('Secondary cleanup failure.')
    try {
      const cleanup = await cleanupArchiveLifecycleResources({
        failure: validationFailure?.error,
        profilePath: null,
        removeProfile: async () => undefined,
        steps: [{
          name: 'restarted_launch_stop',
          blocksProfileCleanup: true,
          run: async () => { throw cleanupFailure },
        }],
      })
      expect(cleanup.failure).toBe(validationFailure?.error)

      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        {
          error: cleanup.failure,
          closedGateFailures: validationFailure?.closedGateFailures,
          cleanupFailureCount: cleanup.cleanupFailureCount,
          cleanupFailures: cleanup.cleanupFailures,
          processCleanupCompleted: cleanup.processCleanupCompleted,
          profileCleanupCompleted: cleanup.profileCleanupCompleted,
        },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect(receipt.failure.closedGateFailures).toEqual({
        failureCount: 1,
        reasons: [
          'Cleanup renderer-frame maximum gap must be finite, non-negative, and less than 200 ms.',
        ],
      })
      expect(receipt.cleanup).toMatchObject({
        cleanupFailureCount: 1,
        processCleanupCompleted: false,
        profileCleanupCompleted: false,
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('caps, redacts, and safely bounds retained final-validator reasons', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-validation-bounds-'))
    const secret = 'synthetic-custody-secret'
    const reasons = Array.from({ length: 20 }, (_entry, index) => `Gate ${index} failed.`)
    reasons[0] = `Gate ${secret} failed at "/tmp/private-archive.json".`
    reasons[1] = 'x'.repeat(5_000)
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(createFailureReceiptInput(
        evidenceDir,
        { closedGateFailures: reasons, secrets: [secret] },
      ))
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))
      const serialized = JSON.stringify(receipt)

      expect(receipt.failure.closedGateFailures).toEqual({
        failureCount: 20,
        reasons: [
          'Gate [REDACTED] failed at "[PATH]".',
          'Archive-lifecycle failure message exceeded the bounded evidence limit.',
          ...reasons.slice(2, 16),
        ],
      })
      expect(serialized).not.toContain(secret)
      expect(serialized.length).toBeLessThan(8_000)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('publishes a bounded sentinel for malformed final-validator reason collections', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-validation-invalid-'))
    const sentinel = 'Archive-lifecycle closed-gate failure details were unreadable.'
    const throwingEntries = new Proxy(['Valid reason.'], {
      get: (target, property, receiver) => {
        if (property === '0') throw new Error('hostile reason getter')
        return Reflect.get(target, property, receiver)
      },
    })
    const revokedEntries = Proxy.revocable(['Valid reason.'], {})
    revokedEntries.revoke()
    const throwingInput = createFailureReceiptInput(evidenceDir)
    Object.defineProperty(throwingInput, 'closedGateFailures', {
      get: () => { throw new Error('hostile collection getter') },
    })
    try {
      for (const [input, expectedFailureCount] of [
        [createFailureReceiptInput(evidenceDir, { closedGateFailures: [] }), null],
        [createFailureReceiptInput(evidenceDir, {
          closedGateFailures: ['Valid reason.', 42],
        }), 2],
        [createFailureReceiptInput(evidenceDir, { closedGateFailures: throwingEntries }), 1],
        [createFailureReceiptInput(evidenceDir, {
          closedGateFailures: revokedEntries.proxy,
        }), null],
        [throwingInput, null],
      ]) {
        const reportPath = await writeArchiveLifecycleFailureReceipt(input)
        const receipt = JSON.parse(await readFile(reportPath, 'utf8'))
        expect(receipt.failure.classification).toBe('evidence_validation_metadata_failure')
        expect(receipt.failure.closedGateFailures).toMatchObject({
          failureCount: expectedFailureCount,
          metadataReadable: false,
        })
        expect(receipt.failure.closedGateFailures.reasons).toContain(sentinel)
      }
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('does not leave a partial success artifact when atomic publication fails', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-atomic-'))
    const failurePath = path.join(evidenceDir, 'electron-archive-lifecycle-smoke-failure.json')
    const publicationFailure = new Error('Injected terminal rename failure.')
    try {
      await writeFile(failurePath, '{"stale":true}\n', { mode: 0o600 })
      await expect(writeArchiveLifecycleSuccessReport({
        evidenceDir,
        evidence: { verdict: { passed: true } },
      }, {
        rename: async () => { throw publicationFailure },
      })).rejects.toBe(publicationFailure)

      expect(await readFile(failurePath, 'utf8')).toBe('{"stale":true}\n')
      expect(await readdir(evidenceDir)).toEqual([
        'electron-archive-lifecycle-smoke-failure.json',
      ])
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('atomically writes a sanitized mode-0600 liveness failure receipt', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-failure-'))
    const secret = 'Synthetic Receipt Secret 2026!'
    const error = new Error(`Gate failed for ${secret} at ${evidenceDir}/private-profile`)
    Object.defineProperty(error, 'archiveLifecycleDiagnostics', {
      value: Object.freeze({
        errorKinds: ['operation_fresh_current_fix_missing'],
        activePhase: 'create',
        activeLaunchNumber: 2,
        currentFixContinuity: null,
        currentFixTimeout: null,
        invalidRendererFrame: Object.freeze({
          phase: 'create',
          gapMs: -0.625,
          gapType: 'negative',
        }),
        rendererCurrentFixMonotonicTail: Object.freeze({
          phase: 'restore',
          gapMs: 240,
        }),
        sourceCadence: Object.freeze({
          latestReceivedSequence: 13,
          latestAcknowledgedSequence: 13,
          pendingCount: 0,
          latestRequestStartedAtMs: 1_000,
          latestEmittedAtMs: 1_001,
          latestRequestAgeMs: 240,
          latestSourceAgeMs: 239,
          oldestPendingRequestAgeMs: null,
          oldestPendingSourceAgeMs: null,
          auditedAtMs: 1_240,
        }),
        operationCount: 1,
        operationOverflowCount: 0,
        operations: Object.freeze([Object.freeze({
          phase: 'restore',
          kind: 'review_before_cleanup',
          startedAtMs: 1_010,
          endedAtMs: 1_090,
          startSourceSequence: 12,
          endSourceSequence: 13,
          phaseSampleCountAtStart: 4,
          phaseSampleDelta: 1,
          freshSampleCount: 0,
        })]),
        phaseMetrics: Object.freeze({}),
      }),
    })
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error,
        expectedHead: 'a'.repeat(40),
        observedLaunchCount: 2,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        cleanupFailures: [],
        secrets: [secret],
        sourceBefore: {
          head: 'a'.repeat(40),
          tree: 'b'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const receipt = JSON.parse(await readFile(reportPath, 'utf8'))

      expect((await lstat(reportPath)).mode & 0o777).toBe(0o600)
      expect(receipt).toMatchObject({
        schemaVersion: 1,
        proofKind: 'packaged-electron-archive-lifecycle-failure-v1',
        failure: {
          classification: 'external_liveness_gate_failure',
          archiveLifecycleDiagnostics: {
            errorKinds: ['operation_fresh_current_fix_missing'],
            activePhase: 'create',
            invalidRendererFrame: {
              phase: 'create',
              gapMs: -0.625,
              gapType: 'negative',
            },
            rendererCurrentFixMonotonicTail: {
              phase: 'restore',
              gapMs: 240,
            },
            sourceCadence: {
              latestReceivedSequence: 13,
              latestAcknowledgedSequence: 13,
              pendingCount: 0,
              latestRequestAgeMs: 240,
              latestSourceAgeMs: 239,
            },
            operations: [{
              phase: 'restore',
              kind: 'review_before_cleanup',
              startedAtMs: 1_010,
              endedAtMs: 1_090,
              startSourceSequence: 12,
              endSourceSequence: 13,
              phaseSampleCountAtStart: 4,
              phaseSampleDelta: 1,
              freshSampleCount: 0,
            }],
          },
        },
        cleanup: { profileCleanupCompleted: true },
        verdict: { passed: false },
      })
      expect(JSON.stringify(receipt)).not.toContain(secret)
      expect(JSON.stringify(receipt)).not.toContain(evidenceDir)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('preserves the exact sanitized cleanup cause from an Electron-serialized failure', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-cleanup-diagnostic-'))
    const secret = 'Synthetic Cleanup Secret 2026!'
    const diagnostic = Object.freeze({
      substage: 'journal_initialize',
      causeClass: 'sqlite_busy',
      tableName: null,
      cursor: null,
      workerExit: Object.freeze({ observed: true, event: 'message', code: 0 }),
    })
    const token = encodeCleanupFailureDiagnosticToken(diagnostic)
    const error = new Error(
      `Error invoking remote method: Mission archive operation failed safely [${token}] `
      + '(ARCHIVE_CLEANUP_FAILED).\n    at evaluate (:291:30)',
    )
    Object.defineProperty(error, 'privateCause', {
      value: `${secret} /Users/private/mission.sqlite`,
    })

    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(evidenceDir, {
          error,
          observedLaunchCount: 2,
          secrets: [secret],
        }),
      )
      const serialized = await readFile(reportPath, 'utf8')
      const receipt = JSON.parse(serialized)

      expect((await lstat(reportPath)).mode & 0o777).toBe(0o600)
      expect(receipt.failure).toEqual({
        classification: 'cleanup_failure',
        message: error.message,
        archiveLifecycleDiagnostics: null,
        cleanupDiagnostic: diagnostic,
      })
      expect(serialized).not.toMatch(/Synthetic Cleanup|private|mission\.sqlite/iu)
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('redacts quoted and unquoted POSIX, Windows, and UNC paths', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-spaced-path-'))
    const privatePath = '/Users/Private Operator/Builds/SAR Tracker.app/Contents/Resources/app.asar'
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error(`ENOENT: no such file, lstat '${privatePath}'`),
        expectedHead: 'e'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'e'.repeat(40),
          tree: 'f'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const serialized = await readFile(reportPath, 'utf8')

      expect(serialized).not.toContain(privatePath)
      expect(serialized).not.toContain('Private Operator')
      expect(serialized).not.toContain('Tracker.app')
      expect(JSON.parse(serialized)).toMatchObject({
        failure: { message: "ENOENT: no such file, lstat '[PATH]'" },
      })

      const unquotedReportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error(`Could not inspect ${privatePath} while publishing evidence.`),
        expectedHead: 'e'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'e'.repeat(40),
          tree: 'f'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })
      const unquotedReceipt = JSON.parse(await readFile(unquotedReportPath, 'utf8'))

      expect(unquotedReceipt.failure.message).toBe('Could not inspect [PATH]')
      expect(JSON.stringify(unquotedReceipt)).not.toContain('Private Operator')
      expect(JSON.stringify(unquotedReceipt)).not.toContain('Tracker.app')

      const windowsPath = String.raw`C:\Users\Private Operator\Builds\SAR Tracker.exe`
      const uncPath = String.raw`\\rescue-server\Private Operator\SAR Tracker\profile`
      const windowsReportPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(evidenceDir, {
          error: new Error(`Could not inspect "${windowsPath}" or ${uncPath}`),
        }),
      )
      const windowsSerialized = await readFile(windowsReportPath, 'utf8')
      const windowsReceipt = JSON.parse(windowsSerialized)

      expect(windowsReceipt.failure.message).toBe('Could not inspect "[PATH]" or [PATH]')
      expect(windowsSerialized).not.toContain(windowsPath)
      expect(windowsSerialized).not.toContain(uncPath)
      expect(windowsSerialized).not.toContain('Private Operator')

      const rootedWindowsPath = String.raw`\Users\Private Operator\SAR Tracker\profile`
      const boundaryReportPath = await writeArchiveLifecycleFailureReceipt(
        createFailureReceiptInput(evidenceDir, {
          error: new Error(
            `Could not inspect '${rootedWindowsPath}'; fallback [${windowsPath}]`,
          ),
        }),
      )
      const boundarySerialized = await readFile(boundaryReportPath, 'utf8')

      expect(boundarySerialized).not.toContain(rootedWindowsPath)
      expect(boundarySerialized).not.toContain(windowsPath)
      expect(boundarySerialized).not.toContain('Private Operator')
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })

  it('writes a setup-failure receipt before custody values exist', async () => {
    const evidenceDir = await mkdtemp(path.join(os.tmpdir(), 'sartracker-lifecycle-setup-failure-'))
    try {
      const reportPath = await writeArchiveLifecycleFailureReceipt({
        evidenceDir,
        error: new Error('Packaged application archive is unavailable.'),
        expectedHead: 'c'.repeat(40),
        observedLaunchCount: 0,
        processCleanupCompleted: true,
        profileCleanupCompleted: true,
        cleanupFailureCount: 0,
        cleanupFailures: [],
        secrets: [],
        sourceBefore: {
          head: 'c'.repeat(40),
          tree: 'd'.repeat(40),
          clean: true,
        },
        startedAtMs: Date.now() - 10,
      })

      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toMatchObject({
        failure: { classification: 'lifecycle_failure' },
        cleanup: { profileCleanupCompleted: true },
        verdict: { passed: false },
      })
    } finally {
      await rm(evidenceDir, { recursive: true, force: true })
    }
  })
})
