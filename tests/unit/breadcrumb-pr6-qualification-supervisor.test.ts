import { EventEmitter } from 'node:events'
import {
  access,
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

type QualificationSupervisor = Readonly<{
  waitForBreadcrumbPr6QualificationChildExit: (
    child: EventEmitter & {
      readonly pid?: number
      readonly exitCode?: number | null
      readonly signalCode?: NodeJS.Signals | null
      readonly kill: (signal: NodeJS.Signals) => boolean
      readonly unref?: () => void
    },
    timeoutMs: number,
    dependencies?: Readonly<{
      readonly reapTimeoutMs?: number
      readonly platform?: NodeJS.Platform
      readonly killProcess?: (pid: number, signal: NodeJS.Signals) => boolean
    }>,
  ) => Promise<number>
  createQualificationSupervisorFailureReceipt: (input: Readonly<{
    expectedRepositoryHead: string
    expectedRepositoryTree: string
    observedRepositoryHead: string | null
    observedRepositoryTree: string | null
    runId: string
    startedAt: string
    runtime: QualificationRuntime
  }>) => Readonly<Record<string, unknown>>
  prepareQualificationSupervisorTerminalRun: (input: Readonly<{
    evidencePath: string
    expectedRepositoryHead: string
    expectedRepositoryTree: string
  }>, dependencies?: Readonly<{
    isSupervisorProcessAlive?: (pid: number, hostname: string) => boolean
    readSupervisorProcessInstance?: (pid: number) => Promise<string | null>
  }>) => Promise<QualificationTerminalRun>
  ensureQualificationSupervisorTerminalArtifact: (
    input: Readonly<{
      childExitCode: number | null
      evidencePath: string
      expectedRepositoryHead: string
      expectedRepositoryTree: string
      terminalRun: QualificationTerminalRun
    }>,
    dependencies?: Readonly<{
      readObservedRepositoryIdentity?: () => Promise<Readonly<{
        head: string
        tree: string
        clean?: boolean
      }> | null>
    }>,
  ) => Promise<Readonly<{
    kind: 'success' | 'failure'
    path: string
    published: boolean
  }>>
  publishQualificationSupervisorCanonicalArtifact: (input: Readonly<{
    contents: string
    deferSuccessName?: boolean
    kind: 'success' | 'failure'
    terminalRun: QualificationTerminalRun
  }>) => Promise<Readonly<{
    kind: 'success' | 'failure'
    path: string
    published: boolean
  }>>
  assertQualificationSupervisorTerminalOutcome: (
    kind: 'success' | 'failure',
    childExitCode: number | null,
  ) => void
}>

type QualificationTerminalRun = Readonly<{
  evidencePath: string
  childEvidencePath: string
  expectedRepositoryHead: string
  expectedRepositoryTree: string
  runId: string
  startedAt: string
  runtime: QualificationRuntime
}>

type QualificationRuntime = Readonly<{
  hostname: string
  platform: string
  release: string
  architecture: string
  cpuCount: number
  totalMemoryBytes: number
  nodeVersion: string
}>

type QualificationChild = Readonly<{
  createQualificationDiagnostics: (input: Readonly<{
    runId: string
    expectedRepositoryHead: string
    expectedRepositoryTree: string
  }>) => QualificationDiagnostics
  createQualificationFailureReceipt: (input: Readonly<{
    diagnostics: unknown
    error: Error
    expectedRepositoryHead: string
    observedRepositoryHead: string
    expectedRepositoryTree: string
    observedRepositoryTree: string
    profileCleanupCompleted: boolean
    runStartedAt: string
  }>) => Readonly<Record<string, unknown>>
}>

type QualificationDiagnostics = Readonly<{
  recordPrimaryFailure: (
    error: Error,
    context?: Readonly<{ stage?: string; gate?: string }>,
  ) => void
}>

type MutableQualificationFailureReceipt = {
  run: { runId: string; recordedAt: string }
  failure: { topLevelCode: string; causeCode: string }
  diagnostics: {
    secondaryFailures: unknown
    primaryFailure: null | { topLevelCode: string; causeCode: string }
  }
}

const supervisorPath = path.resolve('scripts/breadcrumb-pr6-qualification-ci.mjs')

afterEach(() => {
  vi.useRealTimers()
})

describe('Breadcrumb PR6 field-qualification process supervisor [DON-252 / BCP-15]', () => {
  it('never accepts canonical success for an unreaped or unsuccessful child outcome', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor

    expect(() => supervisor.assertQualificationSupervisorTerminalOutcome('success', null))
      .toThrow(/success.*reaped.*zero|outcome/iu)
    expect(() => supervisor.assertQualificationSupervisorTerminalOutcome('success', 1))
      .toThrow(/success.*reaped.*zero|outcome/iu)
    expect(() => supervisor.assertQualificationSupervisorTerminalOutcome('success', 0))
      .not.toThrow()
    expect(() => supervisor.assertQualificationSupervisorTerminalOutcome('failure', null))
      .not.toThrow()
  })

  it('bounds an unreporting child, reaps its POSIX group, and owns one sanitized fallback receipt', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), {
      pid: 12_345,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
      unref: vi.fn(),
    })
    const killProcess = vi.fn(() => true)
    const waiting = supervisor.waitForBreadcrumbPr6QualificationChildExit(child, 20, {
      reapTimeoutMs: 10,
      platform: 'linux',
      killProcess,
    })
    const failure = waiting.catch((error: unknown) => error as Error)

    await vi.advanceTimersByTimeAsync(20)
    expect(killProcess).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
    expect(child.kill).not.toHaveBeenCalled()
    expect(child.unref).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10)
    expect((await failure).message).toMatch(/qualification.*child.*deadline/iu)
    expect(child.unref).toHaveBeenCalledOnce()

    const fallbackChild = Object.assign(new EventEmitter(), {
      pid: 23_456,
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
      unref: vi.fn(),
    })
    const fallbackKillProcess = vi.fn(() => { throw new Error('group signal unavailable') })
    const fallbackWaiting = supervisor.waitForBreadcrumbPr6QualificationChildExit(
      fallbackChild,
      20,
      { reapTimeoutMs: 10, platform: 'linux', killProcess: fallbackKillProcess },
    )
    const fallbackFailure = fallbackWaiting.catch((error: unknown) => error as Error)
    await vi.advanceTimersByTimeAsync(20)
    expect(fallbackKillProcess).toHaveBeenCalledWith(-fallbackChild.pid, 'SIGKILL')
    expect(fallbackChild.kill).toHaveBeenCalledWith('SIGKILL')
    await vi.advanceTimersByTimeAsync(10)
    await fallbackFailure

    const receipt = supervisor.createQualificationSupervisorFailureReceipt({
      expectedRepositoryHead: 'a'.repeat(40),
      expectedRepositoryTree: 'b'.repeat(40),
      observedRepositoryHead: null,
      observedRepositoryTree: null,
      runId: 'q-11111111-1111-4111-8111-111111111111',
      startedAt: new Date().toISOString(),
      runtime: qualificationTestRuntime(),
    })
    expect(receipt).toMatchObject({
      schema: 'sartracker-breadcrumb-pr6-qualification-failure-v2',
      failure: {
        topLevelCode: 'TEARDOWN_FAILED',
      },
      diagnostics: {
        lastPhase: 'teardown',
        teardownStatus: 'incomplete',
      },
      cleanup: {
        profileCleanupCompleted: false,
      },
    })
    expect(JSON.stringify(receipt)).not.toMatch(/message|stack|passphrase|recoveryCode|\/tmp\//u)

    const packageDocument = JSON.parse(await readFile(path.resolve('package.json'), 'utf8')) as {
      readonly scripts?: Readonly<Record<string, string>>
    }
    expect(packageDocument.scripts?.['breadcrumb-pr6:qualify'])
      .toBe('node scripts/breadcrumb-pr6-qualification-ci.mjs')
    expect(await readFile(supervisorPath, 'utf8'))
      .toContain("detached: process.platform !== 'win32'")
  })

  it('keeps a timed-out child terminally failed when it exits during the reap window', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-timeout-reaped-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const privatePath = path.join(path.dirname(terminalRun.childEvidencePath), 'raw-private')
      await writeFile(privatePath, '/tmp/private-after-timeout.sqlite', { mode: 0o600 })
      const child = Object.assign(new EventEmitter(), {
        pid: 34_567,
        exitCode: null,
        signalCode: null,
        kill: vi.fn(() => true),
        unref: vi.fn(),
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const waiting = supervisor.waitForBreadcrumbPr6QualificationChildExit(child, 20, {
        reapTimeoutMs: 10,
        platform: 'linux',
        killProcess: vi.fn(() => true),
      })
      const failure = waiting.catch((error: unknown) => error as Error)
      await vi.advanceTimersByTimeAsync(20)
      child.emit('exit', 0)
      expect((await failure).message).toMatch(/qualification.*child.*deadline/iu)
      vi.useRealTimers()

      const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: null,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => ({
          head: expectedRepositoryHead,
          tree: expectedRepositoryTree,
          clean: true,
        }),
      })

      expect(terminal.kind).toBe('failure')
      await expect(access(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await lstat(path.dirname(terminalRun.childEvidencePath))).mode & 0o777).toBe(0o500)
      expect(JSON.parse(await readFile(privatePath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
    } finally {
      vi.useRealTimers()
      await chmod(path.dirname(evidencePath), 0o700).catch(() => undefined)
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('gives the parent sole terminal ownership while an unreaped child publishes late success', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-supervisor-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)
    let allowFallbackPublication: (() => void) | undefined
    let observeFallbackRead: (() => void) | undefined
    const fallbackReadStarted = new Promise<void>((resolve) => { observeFallbackRead = resolve })
    const fallbackPublicationAllowed = new Promise<void>((resolve) => {
      allowFallbackPublication = resolve
    })

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      expect(terminalRun.childEvidencePath).not.toBe(evidencePath)
      expect((await lstat(path.dirname(terminalRun.childEvidencePath))).mode & 0o777).toBe(0o700)

      const fallback = supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: null,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => {
          observeFallbackRead?.()
          await fallbackPublicationAllowed
          return { head: expectedRepositoryHead, tree: expectedRepositoryTree }
        },
      })
      await fallbackReadStarted

      const privateValue = '/tmp/private-late-child-success.sqlite'
      const privateTemporaryValue = 'raw-private-publication-buffer'
      const privateTemporaryPath = path.join(
        path.dirname(terminalRun.childEvidencePath),
        '.qualification.json.tmp-late-child',
      )
      await writeFile(terminalRun.childEvidencePath, `${JSON.stringify({
        schema: 'sartracker-breadcrumb-pr6-qualification-v2',
        source: {
          repositoryHead: expectedRepositoryHead,
          repositoryHeadAfterRun: expectedRepositoryHead,
          repositoryTree: expectedRepositoryTree,
          repositoryTreeAfterRun: expectedRepositoryTree,
          repositoryDirtyBefore: false,
          repositoryDirtyAfter: false,
        },
        privatePath: privateValue,
      })}\n`, { mode: 0o600 })
      await writeFile(privateTemporaryPath, privateTemporaryValue, { mode: 0o600 })
      allowFallbackPublication?.()

      const terminal = await fallback
      const firstReceipt = await readFile(terminal.path, 'utf8')
      const ownerPath = path.join(root, '.qualification.json.terminal-owner.json')
      const [ownerIdentity, failureIdentity] = await Promise.all([
        lstat(ownerPath),
        lstat(`${evidencePath}.failure.json`),
      ])

      expect(terminal).toEqual({
        kind: 'failure',
        path: `${evidencePath}.failure.json`,
        published: true,
      })
      expect(await readFile(terminal.path, 'utf8')).toBe(firstReceipt)
      expect(firstReceipt).not.toContain(privateValue)
      const sealedStaging = await lstat(path.dirname(terminalRun.childEvidencePath))
      expect(sealedStaging.isDirectory()).toBe(true)
      expect(sealedStaging.mode & 0o777).toBe(0o500)
      expect(await readFile(terminalRun.childEvidencePath, 'utf8')).not.toContain(privateValue)
      expect(JSON.parse(await readFile(terminalRun.childEvidencePath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
      expect(await readFile(privateTemporaryPath, 'utf8')).not.toContain(privateTemporaryValue)
      expect(JSON.parse(await readFile(privateTemporaryPath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
      expect((ownerIdentity.mode & 0o777)).toBe(0o600)
      expect(failureIdentity.ino).toBe(ownerIdentity.ino)
      expect(await readdir(root)).toEqual(expect.arrayContaining([
        '.qualification.json.terminal-owner.json',
        'qualification.json.failure.json',
      ]))
      await expect(access(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects evidence basenames in every derived or private supervisor namespace', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-reserved-name-',
    )))
    await chmod(root, 0o700)
    const uuid = '11111111-1111-4111-8111-111111111111'
    const reservedBasenames = [
      'qualification.json.failure.json',
      '.qualification.json.terminal-owner.json',
      '.breadcrumb-pr6-qualification-staging-owner.json',
      `.breadcrumb-pr6-qualification-child-${uuid}`,
      `.breadcrumb-pr6-terminal-123-${uuid}.tmp`,
      `.breadcrumb-pr6-neutralizer-${uuid}`,
      `.breadcrumb-pr6-tombstone-123-${uuid}.tmp`,
      `.breadcrumb-pr6-artifact-123-${uuid}.tmp`,
      'qualification.json.FAILURE.JSON',
      '.QUALIFICATION.json.TERMINAL-OWNER.JSON',
      '.BREADCRUMB-PR6-QUALIFICATION-STAGING-OWNER.JSON',
      `.BREADCRUMB-PR6-QUALIFICATION-CHILD-${uuid}`,
      `.BREADCRUMB-PR6-TERMINAL-123-${uuid}.TMP`,
    ]

    try {
      for (const basename of reservedBasenames) {
        await expect(supervisor.prepareQualificationSupervisorTerminalRun({
          evidencePath: path.join(root, basename),
          expectedRepositoryHead: 'a'.repeat(40),
          expectedRepositoryTree: 'b'.repeat(40),
        })).rejects.toThrow(/boundary|reserved|staging|namespace/iu)
      }
      expect(await readdir(root)).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('never relinks a prior owner-shaped success as a later run canonical name', async () => {
    const qualificationLibraryPath = '../../build/breadcrumb-pr6-qualification-lib.js'
    vi.resetModules()
    vi.doMock(qualificationLibraryPath, async () => {
      const actual = await vi.importActual<Record<string, unknown>>(qualificationLibraryPath)
      return {
        ...actual,
        validateBreadcrumbPr6QualificationEvidence: (
          evidence: { source: { repositoryTree: string } },
          expectedRepositoryHead: string,
        ) => ({
          passed: true,
          repositoryHead: expectedRepositoryHead,
          repositoryTree: evidence.source.repositoryTree,
        }),
      }
    })
    const supervisor = await import(
      `${pathToFileURL(supervisorPath).href}?namespace-collision`
    ) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-namespace-collision-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const priorEvidencePath = path.join(root, '.qualification.json.terminal-owner.json')
    const priorOwnerPath = path.join(
      root,
      '..qualification.json.terminal-owner.json.terminal-owner.json',
    )
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)
    const priorStartedAt = new Date().toISOString()
    const priorSuccess = {
      schema: 'sartracker-breadcrumb-pr6-qualification-v2',
      run: {
        runId: 'q-55555555-5555-4555-8555-555555555555',
        startedAt: priorStartedAt,
        completedAt: priorStartedAt,
      },
      machine: qualificationTestRuntime(),
      source: {
        repositoryHead: expectedRepositoryHead,
        repositoryHeadAfterRun: expectedRepositoryHead,
        repositoryTree: expectedRepositoryTree,
        repositoryTreeAfterRun: expectedRepositoryTree,
        repositoryDirtyBefore: false,
        repositoryDirtyAfter: false,
      },
    }

    try {
      await writeFile(priorOwnerPath, `${JSON.stringify(priorSuccess)}\n`, { mode: 0o600 })
      await link(priorOwnerPath, priorEvidencePath)
      const priorIdentity = await lstat(priorOwnerPath)

      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })).rejects.toThrow(/identity|link|owner|source|terminal/iu)

      await expect(access(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await lstat(priorEvidencePath)).ino).toBe(priorIdentity.ino)
      expect((await lstat(priorOwnerPath)).nlink).toBe(2)
    } finally {
      vi.doUnmock(qualificationLibraryPath)
      vi.resetModules()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers the verdict name from its owner inode and removes reaped child staging', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-recovery-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      await writeFile(terminalRun.childEvidencePath, '{"invalid":"child"}\n', { mode: 0o600 })
      const receipt = supervisor.createQualificationSupervisorFailureReceipt({
        expectedRepositoryHead,
        expectedRepositoryTree,
        observedRepositoryHead: expectedRepositoryHead,
        observedRepositoryTree: expectedRepositoryTree,
        runId: terminalRun.runId,
        startedAt: terminalRun.startedAt,
        runtime: terminalRun.runtime,
      })
      const published = await supervisor.publishQualificationSupervisorCanonicalArtifact({
        contents: `${JSON.stringify(receipt)}\n`,
        kind: 'failure',
        terminalRun,
      })
      const ownerPath = path.join(root, '.qualification.json.terminal-owner.json')
      const ownerIdentity = await lstat(ownerPath)
      await unlink(published.path)

      const recovered = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: 1,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      })

      expect(recovered).toMatchObject({ kind: 'failure', published: false })
      expect((await lstat(recovered.path)).ino).toBe(ownerIdentity.ino)
      await expect(access(path.dirname(terminalRun.childEvidencePath)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('recovers a prior crashed run owner name without accepting it for a new run', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-prior-owner-recovery-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const failurePath = `${evidencePath}.failure.json`
    const ownerPath = path.join(root, '.qualification.json.terminal-owner.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const priorRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const receipt = supervisor.createQualificationSupervisorFailureReceipt({
        expectedRepositoryHead,
        expectedRepositoryTree,
        observedRepositoryHead: expectedRepositoryHead,
        observedRepositoryTree: expectedRepositoryTree,
        runId: priorRun.runId,
        startedAt: priorRun.startedAt,
        runtime: priorRun.runtime,
      })
      await supervisor.publishQualificationSupervisorCanonicalArtifact({
        contents: `${JSON.stringify(receipt)}\n`,
        kind: 'failure',
        terminalRun: priorRun,
      })
      const ownerIdentity = await lstat(ownerPath)
      await unlink(failurePath)

      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead: 'c'.repeat(40),
        expectedRepositoryTree: 'd'.repeat(40),
      })).rejects.toThrow(/identity|run|terminal/iu)

      expect((await lstat(failurePath)).ino).toBe(ownerIdentity.ino)
      expect((await lstat(ownerPath)).ino).toBe(ownerIdentity.ino)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('canonicalizes exact-source staged child failure only after a matching reaped exit', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const child = await import(pathToFileURL(path.resolve(
      'scripts/breadcrumb-pr6-qualification.mjs',
    )).href) as QualificationChild
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-child-failure-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const diagnostics = child.createQualificationDiagnostics({
        runId: terminalRun.runId,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const childFailure = Object.assign(new Error('bounded failure'), { code: 'SQLITE_BUSY' })
      diagnostics.recordPrimaryFailure(childFailure)
      const receipt = child.createQualificationFailureReceipt({
        diagnostics,
        error: childFailure,
        expectedRepositoryHead,
        observedRepositoryHead: expectedRepositoryHead,
        expectedRepositoryTree,
        observedRepositoryTree: expectedRepositoryTree,
        profileCleanupCompleted: true,
        runStartedAt: terminalRun.startedAt,
      })
      const privateValue = '/tmp/private-duplicate-key-value.sqlite'
      const serialized = JSON.stringify(receipt)
      await writeFile(
        `${terminalRun.childEvidencePath}.failure.json`,
        `{"source":{"evidencePath":"${privateValue}"},${serialized.slice(1)}\n`,
        { mode: 0o600 },
      )

      const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: 1,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => ({
          head: expectedRepositoryHead,
          tree: expectedRepositoryTree,
          clean: true,
        }),
      })
      const canonical = await readFile(terminal.path, 'utf8')

      expect(terminal).toMatchObject({ kind: 'failure', published: true })
      expect(JSON.parse(canonical)).toEqual(receipt)
      expect(canonical).not.toContain(privateValue)
      await expect(access(path.dirname(terminalRun.childEvidencePath)))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps a reaped child receipt recoverable until canonical ownership is durable', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const child = await import(pathToFileURL(path.resolve(
      'scripts/breadcrumb-pr6-qualification.mjs',
    )).href) as QualificationChild
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-preserve-staging-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const receipt = createBoundChildFailureReceipt(child, terminalRun)
      const stagedFailurePath = `${terminalRun.childEvidencePath}.failure.json`
      await writeFile(stagedFailurePath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 })

      await expect(supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: 1,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => {
          await chmod(root, 0o500)
          return { head: expectedRepositoryHead, tree: expectedRepositoryTree, clean: true }
        },
      })).rejects.toMatchObject({ code: 'EACCES' })

      await chmod(root, 0o700)
      expect(JSON.parse(await readFile(stagedFailurePath, 'utf8'))).toEqual(receipt)
      expect((await lstat(path.dirname(stagedFailurePath))).isDirectory()).toBe(true)
      await expect(access(`${evidencePath}.failure.json`))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await chmod(root, 0o700).catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps success pending and hidden until staging cleanup completes', async () => {
    const qualificationLibraryPath = '../../build/breadcrumb-pr6-qualification-lib.js'
    vi.resetModules()
    vi.doMock(qualificationLibraryPath, async () => {
      const actual = await vi.importActual<Record<string, unknown>>(qualificationLibraryPath)
      return {
        ...actual,
        validateBreadcrumbPr6QualificationEvidence: (
          evidence: { source: { repositoryTree: string } },
          expectedRepositoryHead: string,
        ) => ({
          passed: true,
          repositoryHead: expectedRepositoryHead,
          repositoryTree: evidence.source.repositoryTree,
        }),
      }
    })
    const supervisor = await import(
      `${pathToFileURL(supervisorPath).href}?pending-success`
    ) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-pending-success-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const ownerPath = path.join(root, '.qualification.json.terminal-owner.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const success = {
        schema: 'sartracker-breadcrumb-pr6-qualification-v2',
        run: {
          runId: terminalRun.runId,
          startedAt: terminalRun.startedAt,
          completedAt: terminalRun.startedAt,
        },
        machine: terminalRun.runtime,
        source: {
          repositoryHead: expectedRepositoryHead,
          repositoryHeadAfterRun: expectedRepositoryHead,
          repositoryTree: expectedRepositoryTree,
          repositoryTreeAfterRun: expectedRepositoryTree,
          repositoryDirtyBefore: false,
          repositoryDirtyAfter: false,
        },
      }
      await writeFile(terminalRun.childEvidencePath, `${JSON.stringify(success)}\n`, {
        mode: 0o600,
      })
      const childDirectory = path.dirname(terminalRun.childEvidencePath)
      const input = {
        childExitCode: 0,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      } as const

      await expect(supervisor.publishQualificationSupervisorCanonicalArtifact({
        contents: `${JSON.stringify(success)}\n`,
        deferSuccessName: true,
        kind: 'success',
        terminalRun,
      })).resolves.toMatchObject({ kind: 'success', path: ownerPath })
      await rm(childDirectory, { recursive: true, force: true })
      await writeFile(childDirectory, 'unsafe child staging replacement', { mode: 0o600 })

      await expect(supervisor.ensureQualificationSupervisorTerminalArtifact(input))
        .rejects.toThrow(/ownership is durable.*staging cleanup is incomplete/iu)
      await expect(access(ownerPath)).resolves.toBeUndefined()
      await expect(access(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' })

      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead: 'c'.repeat(40),
        expectedRepositoryTree: 'd'.repeat(40),
      })).rejects.toThrow(/identity|source|terminal|staging.*unresolved/iu)
      await expect(access(evidencePath)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(childDirectory, 'utf8')).toBe('unsafe child staging replacement')

      await unlink(childDirectory)
      await expect(supervisor.ensureQualificationSupervisorTerminalArtifact(input))
        .resolves.toMatchObject({ kind: 'success', path: evidencePath })
      const ownerIdentity = await lstat(ownerPath)
      await unlink(evidencePath)
      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead: 'c'.repeat(40),
        expectedRepositoryTree: 'd'.repeat(40),
      })).rejects.toThrow(/identity|source|terminal/iu)
      expect((await lstat(evidencePath)).ino).toBe(ownerIdentity.ino)
    } finally {
      vi.doUnmock(qualificationLibraryPath)
      vi.resetModules()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects future or structurally malformed child failure receipts', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const child = await import(pathToFileURL(path.resolve(
      'scripts/breadcrumb-pr6-qualification.mjs',
    )).href) as QualificationChild
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    for (const mutate of [
      (receipt: MutableQualificationFailureReceipt) => {
        receipt.run.recordedAt = '2099-01-01T00:00:00.000Z'
      },
      (receipt: MutableQualificationFailureReceipt) => {
        receipt.diagnostics.secondaryFailures = 'not-an-array'
        receipt.diagnostics.primaryFailure = null
      },
      (receipt: MutableQualificationFailureReceipt) => {
        receipt.failure.causeCode = 'INVENTED_CAUSE'
        if (receipt.diagnostics.primaryFailure !== null) {
          receipt.diagnostics.primaryFailure.causeCode = 'INVENTED_CAUSE'
        }
      },
    ]) {
      const root = await realpath(await mkdtemp(path.join(
        os.tmpdir(),
        'breadcrumb-pr6-qualification-invalid-child-',
      )))
      await chmod(root, 0o700)
      const evidencePath = path.join(root, 'qualification.json')
      try {
        const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
          evidencePath,
          expectedRepositoryHead,
          expectedRepositoryTree,
        })
        const receipt = structuredClone(
          createBoundChildFailureReceipt(child, terminalRun),
        ) as unknown as MutableQualificationFailureReceipt
        mutate(receipt)
        await writeFile(
          `${terminalRun.childEvidencePath}.failure.json`,
          `${JSON.stringify(receipt)}\n`,
          { mode: 0o600 },
        )

        const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
          childExitCode: 1,
          evidencePath,
          expectedRepositoryHead,
          expectedRepositoryTree,
          terminalRun,
        }, {
          readObservedRepositoryIdentity: async () => ({
            head: expectedRepositoryHead,
            tree: expectedRepositoryTree,
            clean: true,
          }),
        })
        const canonical = JSON.parse(await readFile(terminal.path, 'utf8')) as {
          failure: { causeCode: string }
        }
        expect(canonical.failure.causeCode).toBe('QUALIFICATION_CHILD_UNREPORTED_FAILURE')
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })

  it('freezes one parent observation across source reads and fallback publication', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-frozen-observation-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)
    const initialTime = new Date('2026-09-07T08:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(initialTime)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: null,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => {
          vi.setSystemTime(new Date(initialTime.getTime() + 60_000))
          return { head: expectedRepositoryHead, tree: expectedRepositoryTree, clean: true }
        },
      })
      const receipt = JSON.parse(await readFile(terminal.path, 'utf8')) as {
        run: { startedAt: string; recordedAt: string }
      }

      expect(receipt.run.recordedAt).toBe(terminalRun.startedAt)
    } finally {
      vi.useRealTimers()
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not age a future same-run owner into validity during source refresh', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-future-owner-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const ownerPath = path.join(root, '.qualification.json.terminal-owner.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)
    const initialTime = new Date('2026-09-07T08:00:00.000Z')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(initialTime)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      await expect(supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: null,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => {
          vi.setSystemTime(new Date(initialTime.getTime() + 60_000))
          const futureOwner = supervisor.createQualificationSupervisorFailureReceipt({
            expectedRepositoryHead,
            expectedRepositoryTree,
            observedRepositoryHead: expectedRepositoryHead,
            observedRepositoryTree: expectedRepositoryTree,
            runId: terminalRun.runId,
            startedAt: terminalRun.startedAt,
            runtime: terminalRun.runtime,
          })
          await writeFile(ownerPath, `${JSON.stringify(futureOwner, null, 2)}\n`, { mode: 0o600 })
          return { head: expectedRepositoryHead, tree: expectedRepositoryTree, clean: true }
        },
      })).rejects.toThrow(/identity|time|terminal/iu)
      await expect(access(`${evidencePath}.failure.json`))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      vi.useRealTimers()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a hard-linked cross-run child receipt', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const child = await import(pathToFileURL(path.resolve(
      'scripts/breadcrumb-pr6-qualification.mjs',
    )).href) as QualificationChild
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-hard-link-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const staleReceipt = structuredClone(
        createBoundChildFailureReceipt(child, terminalRun),
      ) as unknown as MutableQualificationFailureReceipt
      staleReceipt.run.runId = 'q-99999999-9999-4999-8999-999999999999'
      const stalePath = path.join(root, 'stale-cross-run-receipt.json')
      await writeFile(stalePath, `${JSON.stringify(staleReceipt)}\n`, { mode: 0o600 })
      await link(stalePath, `${terminalRun.childEvidencePath}.failure.json`)

      const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: 1,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => ({
          head: expectedRepositoryHead,
          tree: expectedRepositoryTree,
          clean: true,
        }),
      })
      const canonical = JSON.parse(await readFile(terminal.path, 'utf8')) as {
        failure: { causeCode: string }
      }

      expect(canonical.failure.causeCode).toBe('QUALIFICATION_CHILD_UNREPORTED_FAILURE')
      expect((await lstat(stalePath, { bigint: true })).nlink).toBe(1n)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not accept another concurrent run as this run terminal evidence', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-cross-run-owner-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const firstRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const secondRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const firstReceipt = supervisor.createQualificationSupervisorFailureReceipt({
        expectedRepositoryHead,
        expectedRepositoryTree,
        observedRepositoryHead: expectedRepositoryHead,
        observedRepositoryTree: expectedRepositoryTree,
        runId: firstRun.runId,
        startedAt: firstRun.startedAt,
        runtime: firstRun.runtime,
      })
      await supervisor.publishQualificationSupervisorCanonicalArtifact({
        contents: `${JSON.stringify(firstReceipt)}\n`,
        kind: 'failure',
        terminalRun: firstRun,
      })

      await expect(supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: 1,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun: secondRun,
      })).rejects.toThrow(/identity|run|start|runtime|terminal/iu)
      expect((await lstat(path.dirname(secondRun.childEvidencePath))).isDirectory()).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('neutralizes many staged entries and supports a long legal evidence filename', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-many-staged-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, `${'q'.repeat(220)}.json`)
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const terminalRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const childDirectory = path.dirname(terminalRun.childEvidencePath)
      for (let index = 0; index < 65; index += 1) {
        await writeFile(path.join(childDirectory, `raw-${index}`), `private-${index}`, {
          mode: 0o600,
        })
      }

      const terminal = await supervisor.ensureQualificationSupervisorTerminalArtifact({
        childExitCode: null,
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
        terminalRun,
      }, {
        readObservedRepositoryIdentity: async () => ({
          head: expectedRepositoryHead,
          tree: expectedRepositoryTree,
          clean: true,
        }),
      })
      const stagedEntries = await readdir(childDirectory)

      expect(terminal.kind).toBe('failure')
      expect((await lstat(childDirectory)).mode & 0o777).toBe(0o500)
      expect(stagedEntries.length).toBeGreaterThanOrEqual(67)
      for (const entry of stagedEntries) {
        expect(JSON.parse(await readFile(path.join(childDirectory, entry), 'utf8')))
          .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
      }
    } finally {
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reconciles raw staging left by an interrupted prior supervisor', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-orphan-staging-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const interruptedRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const interruptedDirectory = path.dirname(interruptedRun.childEvidencePath)
      const rawPath = path.join(interruptedDirectory, '.qualification.json.tmp-crashed-child')
      await writeFile(rawPath, '/tmp/private-crashed-child.sqlite', { mode: 0o600 })

      await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      }, {
        isSupervisorProcessAlive: () => false,
      })

      expect((await lstat(interruptedDirectory)).mode & 0o777).toBe(0o500)
      expect(JSON.parse(await readFile(rawPath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
    } finally {
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('blocks a new run while an exact child staging name is not a directory', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-unresolved-child-path-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const unresolvedPath = path.join(
      root,
      '.breadcrumb-pr6-qualification-child-44444444-4444-4444-8444-444444444444',
    )
    await writeFile(unresolvedPath, '/tmp/private-unresolved-staging.sqlite', { mode: 0o600 })

    try {
      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead: 'a'.repeat(40),
        expectedRepositoryTree: 'b'.repeat(40),
      })).rejects.toThrow(/child staging.*unresolved|unresolved.*child staging/iu)

      expect(await readFile(unresolvedPath, 'utf8'))
        .toBe('/tmp/private-unresolved-staging.sqlite')
      expect((await readdir(root)).filter((entry) => (
        entry.startsWith('.breadcrumb-pr6-qualification-child-')
      ))).toEqual([path.basename(unresolvedPath)])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('treats an expired same-host marker as stale despite PID reuse', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-pid-reuse-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-07T08:00:00.000Z'))

    try {
      const interruptedRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const interruptedDirectory = path.dirname(interruptedRun.childEvidencePath)
      const rawPath = path.join(interruptedDirectory, 'raw-before-pid-reuse')
      await writeFile(rawPath, '/tmp/private-before-pid-reuse.sqlite', { mode: 0o600 })
      vi.advanceTimersByTime(12 * 60 * 60_000 + 5_001)

      await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      }, {
        isSupervisorProcessAlive: () => true,
      })

      expect((await lstat(interruptedDirectory)).mode & 0o777).toBe(0o500)
      expect(JSON.parse(await readFile(rawPath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
    } finally {
      vi.useRealTimers()
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a live reused PID whose process-instance token changed', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-process-instance-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const interruptedRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const interruptedDirectory = path.dirname(interruptedRun.childEvidencePath)
      const rawPath = path.join(interruptedDirectory, 'raw-before-process-instance-change')
      await writeFile(rawPath, '/tmp/private-before-process-instance-change.sqlite', {
        mode: 0o600,
      })

      await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      }, {
        isSupervisorProcessAlive: () => true,
        readSupervisorProcessInstance: async () => (
          'local:22222222-2222-4222-8222-222222222222'
        ),
      })

      expect((await lstat(interruptedDirectory)).mode & 0o777).toBe(0o500)
      expect(JSON.parse(await readFile(rawPath, 'utf8')))
        .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
    } finally {
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not classify a live owner as stale while its process instance is unavailable', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-process-instance-unavailable-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const expectedRepositoryHead = 'a'.repeat(40)
    const expectedRepositoryTree = 'b'.repeat(40)

    try {
      const interruptedRun = await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      })
      const interruptedDirectory = path.dirname(interruptedRun.childEvidencePath)
      const rawPath = path.join(interruptedDirectory, 'raw-before-instance-read-failure')
      await writeFile(rawPath, '/tmp/private-before-instance-read-failure.sqlite', {
        mode: 0o600,
      })
      const readSupervisorProcessInstance = vi.fn()
        .mockResolvedValueOnce('local:33333333-3333-4333-8333-333333333333')
        .mockResolvedValueOnce(null)

      await expect(supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead,
        expectedRepositoryTree,
      }, {
        isSupervisorProcessAlive: () => true,
        readSupervisorProcessInstance,
      })).rejects.toThrow(/process instance.*temporarily unavailable/iu)

      expect((await lstat(interruptedDirectory)).mode & 0o777).toBe(0o700)
      expect(await readFile(rawPath, 'utf8'))
        .toBe('/tmp/private-before-instance-read-failure.sqlite')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('neutralizes malformed, wrong-mode, and symlinked staging owner markers', async () => {
    const supervisor = await import(pathToFileURL(supervisorPath).href) as QualificationSupervisor
    const root = await realpath(await mkdtemp(path.join(
      os.tmpdir(),
      'breadcrumb-pr6-qualification-malformed-markers-',
    )))
    await chmod(root, 0o700)
    const evidencePath = path.join(root, 'qualification.json')
    const markerName = '.breadcrumb-pr6-qualification-staging-owner.json'
    const childDirectories = [
      path.join(root, '.breadcrumb-pr6-qualification-child-11111111-1111-4111-8111-111111111111'),
      path.join(root, '.breadcrumb-pr6-qualification-child-22222222-2222-4222-8222-222222222222'),
      path.join(root, '.breadcrumb-pr6-qualification-child-33333333-3333-4333-8333-333333333333'),
    ]
    const symlinkTarget = path.join(root, 'outside-marker-target')

    try {
      for (const childDirectory of childDirectories) {
        await mkdir(childDirectory, { mode: 0o700 })
        await writeFile(path.join(childDirectory, 'raw-private'), '/tmp/private.sqlite', {
          mode: 0o600,
        })
      }
      await writeFile(path.join(childDirectories[0], markerName), '', { mode: 0o600 })
      await writeFile(path.join(childDirectories[1], markerName), '{}\n', { mode: 0o644 })
      await writeFile(symlinkTarget, 'outside private marker data', { mode: 0o600 })
      await symlink(symlinkTarget, path.join(childDirectories[2], markerName))

      await supervisor.prepareQualificationSupervisorTerminalRun({
        evidencePath,
        expectedRepositoryHead: 'a'.repeat(40),
        expectedRepositoryTree: 'b'.repeat(40),
      }, {
        isSupervisorProcessAlive: () => false,
      })

      for (const childDirectory of childDirectories) {
        expect((await lstat(childDirectory)).mode & 0o777).toBe(0o500)
        expect(JSON.parse(await readFile(path.join(childDirectory, markerName), 'utf8')))
          .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
        expect(JSON.parse(await readFile(path.join(childDirectory, 'raw-private'), 'utf8')))
          .toEqual({ schema: 'sartracker-breadcrumb-pr6-staging-tombstone-v1' })
      }
      expect(await readFile(symlinkTarget, 'utf8')).toBe('outside private marker data')
    } finally {
      for (const entry of await readdir(root).catch(() => [])) {
        if (entry.startsWith('.breadcrumb-pr6-qualification-child-')) {
          await chmod(path.join(root, entry), 0o700).catch(() => undefined)
        }
      }
      await rm(root, { recursive: true, force: true })
    }
  })
})

/** Creates one real child receipt bound to the supervisor-owned run identity. */
function createBoundChildFailureReceipt(
  child: QualificationChild,
  terminalRun: QualificationTerminalRun,
): Readonly<Record<string, unknown>> {
  const runId = terminalRun.runId
  const startedAt = terminalRun.startedAt
  const diagnostics = child.createQualificationDiagnostics({
    runId,
    expectedRepositoryHead: terminalRun.expectedRepositoryHead,
    expectedRepositoryTree: terminalRun.expectedRepositoryTree,
  })
  const childFailure = Object.assign(new Error('bounded failure'), { code: 'SQLITE_BUSY' })
  diagnostics.recordPrimaryFailure(childFailure)
  return child.createQualificationFailureReceipt({
    diagnostics,
    error: childFailure,
    expectedRepositoryHead: terminalRun.expectedRepositoryHead,
    observedRepositoryHead: terminalRun.expectedRepositoryHead,
    expectedRepositoryTree: terminalRun.expectedRepositoryTree,
    observedRepositoryTree: terminalRun.expectedRepositoryTree,
    profileCleanupCompleted: true,
    runStartedAt: startedAt,
  })
}

/** Snapshots the same exact local runtime contract as the coordinator. */
function qualificationTestRuntime(): QualificationRuntime {
  return {
    hostname: os.hostname(),
    platform: process.platform,
    release: os.release(),
    architecture: os.arch(),
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
  }
}
