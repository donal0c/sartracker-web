import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ARCHIVE_KILL_MATRIX_CASES,
  ARCHIVE_LIFECYCLE_PHASES,
  buildBreadcrumbPr6KillMatrixReport,
  captureArchiveKillMatrixBaseline,
  parseBreadcrumbPr6KillMatrixArgs,
  resolveArchiveKillMatrixSelection,
  runArchiveKillCase,
} from '../../build/breadcrumb-pr6-kill-matrix-lib.js'
import * as killMatrix from '../../build/breadcrumb-pr6-kill-matrix-lib.js'

const require = createRequire(import.meta.url)
const { listArchiveInventoryForSchema } = require('../../electron/archive-inventory.cjs') as {
  readonly listArchiveInventoryForSchema: (
    schemaVersion: number,
  ) => ReadonlyArray<Readonly<{ tableName: string; decision: string }>>
}
const temporaryDirectories = new Set<string>()
const temporaryFiles = new Set<string>()

/** Builds one closed parent-observed fact set for forged-evidence regressions. */
function parentFacts(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  const inventoryTables = listArchiveInventoryForSchema(13).map((entry, index) => ({
    tableName: entry.tableName,
    decision: entry.decision,
    rowCount: 0,
    contentSha256: String((index % 9) + 1).repeat(64),
  }))
  const inventoryDigest = createHash('sha256')
    .update(JSON.stringify(inventoryTables), 'utf8')
    .digest('hex')
  return {
    custody: {
      applicable: true,
      archiveIdMatched: true,
      missionIdMatched: true,
      status: 'verified',
      availability: 'present',
      registryCiphertextSha256: 'a'.repeat(64),
      diskCiphertextSha256: 'a'.repeat(64),
      registrySizeBytes: 4096,
      diskSizeBytes: 4096,
      registeredArchiveCount: 1,
      diskArchiveCount: 1,
      unregisteredArchiveCount: 0,
      registryFileIdentityMatched: true,
      verificationProofFileIdentityMatched: true,
      activeOperationPresent: false,
      blockingConflictPresent: false,
      inspectionErrorCode: null,
    },
    cleanupEligibility: {
      eligible: false,
      blockers: ['fresh_non_machine_unlock_required'],
      storageState: 'live',
    },
    cleanup: null,
    inventory: {
      declarationCount: 49,
      baselineDigestSha256: inventoryDigest,
      observedDigestSha256: inventoryDigest,
      changedTables: [],
      unexpectedChangedTables: [],
      baselineTables: inventoryTables,
      observedTables: inventoryTables,
    },
    mission: {
      idMatched: true,
      status: 'finalized',
      stableCoreMatched: true,
      eventPrefixMatched: true,
      baselineEventRowCount: 3,
      observedEventRowCount: 5,
    },
    residue: { entryCount: 0, fileCount: 0, scannedByteCount: 0, secretMatchCount: 0 },
    review: {
      attempted: true,
      openedAuditCount: 1,
      readMethod: 'listMissions',
      readMissionMatched: true,
      closedAuditCount: 1,
    },
    ...overrides,
  }
}

/** Builds one exact clean repository capture for report-only unit tests. */
function repositoryState(clean = true): Readonly<Record<string, unknown>> {
  return {
    headSha: '1'.repeat(40),
    treeSha: '2'.repeat(40),
    clean,
    statusSha256: '3'.repeat(64),
    workspaceSha256: '4'.repeat(64),
    harnessFiles: [
      'build/breadcrumb-pr6-kill-matrix-lib.js',
      'scripts/breadcrumb-pr6-kill-matrix.mjs',
      'tests/fixtures/breadcrumb-pr6-kill-child.cjs',
      'tests/unit/breadcrumb-pr6-kill-matrix-lib.test.ts',
    ].map((relativePath, index) => ({
      relativePath,
      sha256: String(index + 5).repeat(64),
    })),
  }
}

/** Builds closed invocation flags for one focused report. */
function invocation(
  caseIds: readonly string[],
  protocolSelfTest = false,
): Readonly<Record<string, unknown>> {
  return {
    caseIds,
    keepWorkRoot: false,
    protocolSelfTest,
    reportPathExplicit: true,
    timeoutMs: 120_000,
    workRootExplicit: true,
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
  for (const file of temporaryFiles) rmSync(file, { force: true })
  temporaryFiles.clear()
})

describe('Breadcrumb PR6 real-process archive kill matrix helpers', () => {
  it('derives residue safety from parent-observed roots and rejects a forged child pass', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'restore.validate'),
      childFacts: { passed: true, plaintextResidualCount: 0 },
      parentFacts: parentFacts({
        residue: { entryCount: 1, fileCount: 1, secretMatchCount: 1 },
      }),
    })).toThrow(/app-addressable plaintext residue|secret residue/iu)
  })

  it('binds custody to the exact registry row, disk digest, size, and file identity', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'verify.proof'),
      childFacts: { passed: true, archiveCustodyReconciled: true },
      parentFacts: parentFacts({
        custody: {
          ...parentFacts().custody,
          diskCiphertextSha256: 'b'.repeat(64),
          registryCiphertextSha256: 'a'.repeat(64),
        },
      }),
    })).toThrow(/custody|registry|ciphertext/iu)
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'verify.proof'),
      childFacts: { passed: true, archiveCustodyReconciled: true },
      parentFacts: parentFacts({
        custody: {
          ...parentFacts().custody,
          registryFileIdentityMatched: false,
        },
      }),
    })).toThrow(/custody|file identity/iu)
  })

  it('uses current post-restart eligibility and not a forged preparation-time boolean', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'verify.verified'),
      childFacts: { cleanupBlockedBeforeVerification: true },
      parentFacts: parentFacts({
        cleanupEligibility: {
          eligible: false,
          blockers: ['archive_custody_mismatch'],
          storageState: 'live',
        },
      }),
    })).toThrow(/current.*eligibility|cleanup.*eligibility|custody/iu)
  })

  it('requires exhaustive cleanup row proof and a real post-cleanup Review cycle', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'cleanup.cleanup'),
      childFacts: { cleanupResumedToCompletion: true, archiveReviewable: true },
      parentFacts: parentFacts({
        cleanup: {
          journalState: 'completed',
          storageState: 'archived',
          declaredTableCount: 2,
          remainingRows: [{ tableName: 'positions', rowCount: 1 }],
        },
        review: {
          attempted: true,
          openedAuditCount: 1,
          readMethod: 'listMissions',
          readMissionMatched: true,
          closedAuditCount: 0,
        },
      }),
    })).toThrow(/cleanup.*row|review.*close|exhaustive/iu)
  })

  it('rejects cleanup rows that contradict the same observed 49-table snapshot', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    const facts = parentFacts()
    const inventory = facts.inventory as Readonly<Record<string, unknown>>
    const positionsIndex = (inventory.observedTables as Readonly<Record<string, unknown>>[])
      .findIndex((entry) => entry.tableName === 'positions')
    expect(positionsIndex).toBeGreaterThanOrEqual(0)
    const observedTables = (inventory.observedTables as Readonly<Record<string, unknown>>[])
      .map((entry, index) => index === positionsIndex
        ? { ...entry, rowCount: 1, contentSha256: 'e'.repeat(64) }
        : entry)
    const observedDigestSha256 = createHash('sha256')
      .update(JSON.stringify(observedTables), 'utf8')
      .digest('hex')
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'cleanup.cleanup'),
      childFacts: { action: 'cleanup_resume', outcome: 'completed' },
      parentFacts: {
        ...facts,
        inventory: {
          ...inventory,
          observedTables,
          observedDigestSha256,
          changedTables: ['positions'],
          unexpectedChangedTables: [],
        },
        cleanupEligibility: {
          eligible: false,
          blockers: ['cleanup_already_completed'],
          storageState: 'archived',
        },
        cleanup: {
          journalState: 'completed',
          storageState: 'archived',
          declaredTableCount: 1,
          declaredRows: [{
            tableName: 'positions',
            decision: 'mission_rows',
            rowCount: 0,
            zeroRequired: true,
          }],
          remainingRows: [],
          reconstructibleDerivedRows: [],
          postReviewRemainingRows: [],
        },
      },
    })).toThrow(/cleanup.*inventory|row.*contradict|observed/iu)
  })

  it('rejects a cleanup proof that omits tables from the exact schema-v13 cleanup plan', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'cleanup.cleanup'),
      childFacts: { action: 'cleanup_resume', outcome: 'completed' },
      parentFacts: parentFacts({
        cleanupEligibility: {
          eligible: false,
          blockers: ['cleanup_already_completed'],
          storageState: 'archived',
        },
        cleanup: {
          journalState: 'completed',
          storageState: 'archived',
          declaredTableCount: 1,
          declaredRows: [{
            tableName: 'positions',
            decision: 'mission_rows',
            rowCount: 0,
            zeroRequired: true,
          }],
          remainingRows: [],
          reconstructibleDerivedRows: [],
          postReviewRemainingRows: [],
        },
      }),
    })).toThrow(/exact.*cleanup plan|schema.*13.*cleanup|omits.*table/iu)
  })

  it('rejects fabricated and duplicate tables instead of treating any 49 names as schema v13', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    const definition = ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'restore.ready')
    const canonical = parentFacts()
    const canonicalInventory = canonical.inventory as Readonly<Record<string, unknown>>
    const fabricatedTables = (
      canonicalInventory.baselineTables as Readonly<Record<string, unknown>>[]
    ).map((entry, index) => index === 0
      ? { ...entry, tableName: 'fabricated_table' }
      : entry)
    const fabricatedDigest = createHash('sha256')
      .update(JSON.stringify(fabricatedTables), 'utf8')
      .digest('hex')
    const fabricated = {
      ...canonical,
      inventory: {
        ...canonicalInventory,
        baselineTables: fabricatedTables,
        observedTables: fabricatedTables,
        baselineDigestSha256: fabricatedDigest,
        observedDigestSha256: fabricatedDigest,
      },
    }
    expect(() => derive({ definition, childFacts: {}, parentFacts: fabricated }))
      .toThrow(/canonical|schema.*13|inventory.*table/iu)

    const inventory = canonical.inventory as Readonly<Record<string, unknown>>
    const baselineTables = [
      ...(inventory.baselineTables as Readonly<Record<string, unknown>>[]),
    ]
    baselineTables[48] = { ...baselineTables[0] }
    const observedTables = baselineTables.map((entry) => ({ ...entry }))
    const digest = createHash('sha256').update(JSON.stringify(baselineTables), 'utf8').digest('hex')
    expect(() => derive({
      definition,
      childFacts: {},
      parentFacts: {
        ...canonical,
        inventory: {
          ...inventory,
          baselineTables,
          observedTables,
          baselineDigestSha256: digest,
          observedDigestSha256: digest,
        },
      },
    })).toThrow(/duplicate|canonical|schema.*13/iu)
  })

  it('requires every one of the 49 authoritative table digests to preserve live payload', () => {
    const derive = Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>
    expect(() => derive({
      definition: ARCHIVE_KILL_MATRIX_CASES.find((entry) => entry.id === 'restore.ready'),
      childFacts: { liveMissionPreserved: true },
      parentFacts: parentFacts({
        inventory: {
          declarationCount: 49,
          baselineDigestSha256: 'c'.repeat(64),
          observedDigestSha256: 'd'.repeat(64),
          unexpectedChangedTables: ['positions'],
        },
      }),
    })).toThrow(/inventory|live mission|positions/iu)
  })
  it('freezes every currently emitted create, verify, restore and cleanup phase in order', () => {
    expect(ARCHIVE_LIFECYCLE_PHASES).toEqual({
      create: [
        'preflight',
        'snapshot',
        'extract',
        'sqlite',
        'proof',
        'attachments',
        'digest',
        'encrypt',
        'sync',
        'plaintext_cleanup',
        'staged',
        'publish',
        'seal',
      ],
      verify: [
        'preflight',
        'keys',
        'decrypt',
        'entries',
        'sqlite',
        'inventory',
        'gpx',
        'attachments',
        'replay',
        'plaintext_cleanup',
        'proof',
        'verified',
      ],
      restore: ['preflight', 'keys', 'ciphertext', 'decrypt', 'validate', 'ready'],
      cleanup: ['cleanup'],
    })
    expect(ARCHIVE_KILL_MATRIX_CASES).toHaveLength(32)
    expect(ARCHIVE_KILL_MATRIX_CASES.map((entry) => entry.id)).toEqual([
      ...ARCHIVE_LIFECYCLE_PHASES.create.map((phase) => `create.${phase}`),
      ...ARCHIVE_LIFECYCLE_PHASES.verify.map((phase) => `verify.${phase}`),
      ...ARCHIVE_LIFECYCLE_PHASES.restore.map((phase) => `restore.${phase}`),
      'cleanup.cleanup',
    ])
    expect(new Set(ARCHIVE_KILL_MATRIX_CASES.map((entry) => entry.operationId)).size)
      .toBe(ARCHIVE_KILL_MATRIX_CASES.length)
  })

  it('parses only bounded explicit qualification arguments and preserves matrix order', () => {
    expect(parseBreadcrumbPr6KillMatrixArgs([
      '--case',
      'restore.validate,create.preflight',
      '--report',
      '/tmp/pr6-kill-report.json',
      '--work-root',
      '/tmp/pr6-kill-work',
      '--timeout-ms',
      '12345',
      '--keep-work-root',
    ])).toEqual({
      caseIds: ['restore.validate', 'create.preflight'],
      keepWorkRoot: true,
      protocolSelfTest: false,
      reportPath: '/tmp/pr6-kill-report.json',
      timeoutMs: 12_345,
      workRoot: '/tmp/pr6-kill-work',
    })
    expect(resolveArchiveKillMatrixSelection([
      'restore.validate',
      'create.preflight',
    ]).map((entry) => entry.id)).toEqual([
      'create.preflight',
      'restore.validate',
    ])
    expect(() => parseBreadcrumbPr6KillMatrixArgs(['--case', 'verify.unknown']))
      .toThrow(/unknown archive kill case/iu)
    expect(() => parseBreadcrumbPr6KillMatrixArgs(['--timeout-ms', '0']))
      .toThrow(/timeout/iu)
    expect(() => parseBreadcrumbPr6KillMatrixArgs(['--report', 'relative.json']))
      .toThrow(/absolute/iu)
    expect(() => parseBreadcrumbPr6KillMatrixArgs(['--unexpected']))
      .toThrow(/unsupported/iu)
  })

  it('uses a real child process, observes SIGKILL, and accepts only restart evidence', async () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-kill-lib-'))
    temporaryDirectories.add(workRoot)
    const childPath = path.resolve('tests/fixtures/breadcrumb-pr6-kill-child.cjs')
    const definition = ARCHIVE_KILL_MATRIX_CASES.find(
      (entry) => entry.id === 'restore.validate',
    )
    expect(definition).toBeDefined()

    const evidence = await runArchiveKillCase({
      caseDefinition: definition,
      childPath,
      cwd: path.resolve('.'),
      runArgs: [
        '--action',
        'protocol-run',
        '--case',
        'restore.validate',
        '--root',
        workRoot,
      ],
      reconcileArgs: [
        '--action',
        'protocol-reconcile',
        '--case',
        'restore.validate',
        '--root',
        workRoot,
      ],
      protocolSelfTest: true,
      timeoutMs: 5_000,
    })

    expect(evidence).toMatchObject({
      caseId: 'restore.validate',
      lifecycle: 'restore',
      phase: 'validate',
      kill: {
        requestedSignal: 'SIGKILL',
        observedSignal: 'SIGKILL',
        exitCode: null,
      },
      phaseEvidence: {
        completed: 1,
        detail: 'protocol-checkpoint',
        sequence: 1,
        total: 1,
        unit: 'files',
      },
      restart: {
        childFacts: { action: 'protocol_restart', outcome: 'completed' },
        parentFacts: null,
        verdict: { proofTier: 'protocol_only' },
      },
      passed: true,
    })
    expect(evidence.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('fails closed when a restart child tries to inject its own safety assertions', async () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-kill-fail-'))
    temporaryDirectories.add(workRoot)
    const childPath = path.resolve('tests/fixtures/breadcrumb-pr6-kill-child.cjs')
    const definition = ARCHIVE_KILL_MATRIX_CASES.find(
      (entry) => entry.id === 'restore.validate',
    )
    expect(definition).toBeDefined()

    await expect(runArchiveKillCase({
      caseDefinition: definition,
      childPath,
      cwd: path.resolve('.'),
      runArgs: [
        '--action',
        'protocol-run',
        '--case',
        'restore.validate',
        '--root',
        workRoot,
      ],
      reconcileArgs: [
        '--action',
        'protocol-reconcile',
        '--case',
        'restore.validate',
        '--root',
        workRoot,
        '--forge-assertions',
      ],
      protocolSelfTest: true,
      timeoutMs: 5_000,
    })).rejects.toThrow(/unsupported fields|restart message/iu)
  })

  it('uses unique recovery custody per archive and finds exact secret residue itself', async () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-kill-secret-'))
    temporaryDirectories.add(workRoot)
    const childPath = path.resolve('tests/fixtures/breadcrumb-pr6-kill-child.cjs')
    const selected = resolveArchiveKillMatrixSelection([
      'create.preflight',
      'create.snapshot',
    ])
    const preparation = spawnSync(process.execPath, [
      childPath,
      '--action',
      'prepare',
      '--root',
      workRoot,
      '--cases',
      selected.map((entry) => entry.id).join(','),
    ], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 30_000 })
    expect(preparation.status, preparation.stderr).toBe(0)
    const baseline = captureArchiveKillMatrixBaseline({ root: workRoot, selectedCases: selected })
    const recoveryCodes = selected.map((entry) => baseline.cases[entry.id].recoveryCode)
    expect(new Set(recoveryCodes).size).toBe(2)
    expect(recoveryCodes.every((code) =>
      /^(?:[0-9A-HJKMNP-TV-Z]{5}-){7}[0-9A-HJKMNP-TV-Z]{5}$/u.test(code))).toBe(true)

    const definition = selected[0]
    const common = ['--case', definition.id, '--root', workRoot]
    await expect(runArchiveKillCase({
      caseDefinition: definition,
      childPath,
      cwd: path.resolve('.'),
      runArgs: [
        '--action',
        'run',
        ...common,
        '--operation-id',
        definition.operationId,
      ],
      reconcileArgs: [
        '--action',
        'reconcile',
        ...common,
        '--operation-id',
        definition.operationId,
        '--leave-known-residue',
      ],
      baseline: baseline.cases[definition.id],
      timeoutMs: 30_000,
    })).rejects.toThrow(/exact known secret residue/iu)
  })

  it('counts a hidden orphan archive as registry and disk custody drift', async () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-kill-orphan-'))
    temporaryDirectories.add(workRoot)
    const childPath = path.resolve('tests/fixtures/breadcrumb-pr6-kill-child.cjs')
    const selected = resolveArchiveKillMatrixSelection(['create.extract'])
    const preparation = spawnSync(process.execPath, [
      childPath,
      '--action',
      'prepare',
      '--root',
      workRoot,
      '--cases',
      'create.extract',
    ], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 30_000 })
    expect(preparation.status, preparation.stderr).toBe(0)
    const baseline = captureArchiveKillMatrixBaseline({ root: workRoot, selectedCases: selected })
    const definition = selected[0]
    const common = ['--case', definition.id, '--root', workRoot]
    await expect(runArchiveKillCase({
      caseDefinition: definition,
      childPath,
      cwd: path.resolve('.'),
      runArgs: [
        '--action', 'run', ...common, '--operation-id', definition.operationId,
      ],
      reconcileArgs: [
        '--action', 'reconcile', ...common, '--operation-id', definition.operationId,
        '--leave-hidden-archive',
      ],
      baseline: baseline.cases[definition.id],
      timeoutMs: 30_000,
    })).rejects.toThrow(/registry.*disk drift|unregistered archive/iu)
  })

  it('builds a stable allowlisted report and distinguishes focused proof from full qualification', () => {
    const definition = ARCHIVE_KILL_MATRIX_CASES.find(
      (entry) => entry.id === 'restore.validate',
    )
    expect(definition).toBeDefined()
    const observed = parentFacts()
    const centrallyDerived = (Reflect.get(killMatrix, 'deriveArchiveKillCaseVerdict') as (
      input: Readonly<Record<string, unknown>>,
    ) => Readonly<Record<string, unknown>>)({
      definition,
      childFacts: { action: 'startup_plaintext_sweep', outcome: 'completed' },
      parentFacts: observed,
    })
    const caseEvidence = {
      caseId: 'restore.validate',
      lifecycle: 'restore',
      phase: 'validate',
      kill: {
        requestedSignal: 'SIGKILL',
        observedSignal: 'SIGKILL',
        exitCode: null,
      },
      phaseEvidence: {
        sequence: 1,
        unit: 'files',
        completed: 1,
        total: 1,
        detail: 'sqlite-validated',
      },
      restart: {
        childFacts: { action: 'startup_plaintext_sweep', outcome: 'completed' },
        parentFacts: observed,
        verdict: centrallyDerived,
      },
      durationMs: 25,
      passed: true,
    }
    const first = buildBreadcrumbPr6KillMatrixReport({
      caseEvidence: [caseEvidence],
      completedAt: '2026-08-30T10:01:00.000Z',
      selectedCases: resolveArchiveKillMatrixSelection(['restore.validate']),
      startedAt: '2026-08-30T10:00:00.000Z',
      invocation: invocation(['restore.validate']),
      repositoryBefore: repositoryState(),
      repositoryAfter: repositoryState(),
    })
    const second = buildBreadcrumbPr6KillMatrixReport({
      caseEvidence: [{
        ...caseEvidence,
        durationMs: 999,
        phaseEvidence: {
          ...caseEvidence.phaseEvidence,
          sequence: 99,
          completed: 512,
          total: 1_024,
        },
      }],
      completedAt: '2026-08-30T12:01:00.000Z',
      selectedCases: resolveArchiveKillMatrixSelection(['restore.validate']),
      startedAt: '2026-08-30T12:00:00.000Z',
      invocation: invocation(['restore.validate']),
      repositoryBefore: repositoryState(),
      repositoryAfter: repositoryState(),
    })

    expect(first).toMatchObject({
      schemaVersion: 2,
      proof: 'breadcrumb-pr6-archive-lifecycle-sigkill-matrix',
      verdict: 'focused_pass',
      coverage: {
        complete: false,
        executedCaseCount: 1,
        requiredCaseCount: 32,
        selectedCaseCount: 1,
      },
      summary: { failedCaseCount: 0, passedCaseCount: 1 },
    })
    expect(first.structuralDigestSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(first.structuralDigestSha256).toBe(second.structuralDigestSha256)
    const structuralCases = first.cases.map((entry) => ({
      caseId: entry.caseId,
      lifecycle: entry.lifecycle,
      phase: entry.phase,
      kill: entry.kill,
      phaseCheckpoint: {
        unit: entry.phaseEvidence.unit,
        detail: entry.phaseEvidence.detail,
      },
      restart: entry.restart,
      passed: entry.passed,
    }))
    const runtimeBoundDigest = createHash('sha256').update(JSON.stringify({
      structuralCases,
      repository: first.repository,
      invocation: first.invocation,
      runtime: first.runtime,
    }), 'utf8').digest('hex')
    expect(first.structuralDigestSha256).toBe(runtimeBoundDigest)
    expect(JSON.stringify(first)).not.toMatch(/passphrase|recoveryCode|\/tmp\/secret/iu)

    const dirty = buildBreadcrumbPr6KillMatrixReport({
      caseEvidence: [caseEvidence],
      completedAt: '2026-08-30T10:01:00.000Z',
      selectedCases: resolveArchiveKillMatrixSelection(['restore.validate']),
      startedAt: '2026-08-30T10:00:00.000Z',
      invocation: invocation(['restore.validate']),
      repositoryBefore: repositoryState(false),
      repositoryAfter: repositoryState(false),
    })
    expect(dirty).toMatchObject({
      verdict: 'focused_pass_unbound',
      repository: { clean: false, stable: true },
    })
    expect(() => buildBreadcrumbPr6KillMatrixReport({
      caseEvidence: [caseEvidence],
      completedAt: '2026-08-30T10:01:00.000Z',
      selectedCases: resolveArchiveKillMatrixSelection(['restore.validate']),
      startedAt: '2026-08-30T10:00:00.000Z',
      invocation: invocation(['restore.validate']),
    })).toThrow(/repository state/iu)

    expect(() => buildBreadcrumbPr6KillMatrixReport({
      caseEvidence: [{
        ...caseEvidence,
        phaseEvidence: { ...caseEvidence.phaseEvidence, detail: 'passphrase' },
      }],
      completedAt: '2026-08-30T10:01:00.000Z',
      selectedCases: resolveArchiveKillMatrixSelection(['restore.validate']),
      startedAt: '2026-08-30T10:00:00.000Z',
      invocation: invocation(['restore.validate']),
      repositoryBefore: repositoryState(),
      repositoryAfter: repositoryState(),
    })).toThrow(/sensitive progress detail/iu)
  })

  it('runs a fast protocol self-test through the report-writing CLI without archive claims', () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-kill-cli-'))
    temporaryDirectories.add(workRoot)
    const reportPath = path.join(workRoot, 'report.json')
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/breadcrumb-pr6-kill-matrix.mjs'),
      '--protocol-self-test',
      '--case',
      'restore.validate',
      '--report',
      reportPath,
      '--work-root',
      path.join(workRoot, 'work'),
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      timeout: 10_000,
    })

    expect(result.status, result.stderr).toBe(0)
    expect(result.signal).toBeNull()
    expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
      proof: 'breadcrumb-pr6-archive-lifecycle-sigkill-matrix',
      verdict: 'protocol_self_test',
      coverage: { complete: false, executedCaseCount: 1 },
      protocolSelfTest: true,
      cases: [{
        caseId: 'restore.validate',
        kill: { observedSignal: 'SIGKILL' },
        passed: true,
      }],
    })
  })

  it('refuses to write qualification evidence inside the repository after final Git capture', () => {
    if (process.platform === 'win32') return
    const workRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-report-boundary-'))
    temporaryDirectories.add(workRoot)
    const reportPath = path.resolve(`breadcrumb-pr6-forged-report-${process.pid}.json`)
    temporaryFiles.add(reportPath)
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/breadcrumb-pr6-kill-matrix.mjs'),
      '--protocol-self-test',
      '--case',
      'restore.validate',
      '--report',
      reportPath,
      '--work-root',
      path.join(workRoot, 'work'),
    ], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 10_000 })
    expect(result.status).not.toBe(0)
    expect(readFileSync.bind(null, reportPath, 'utf8')).toThrow()
  })

  it('rejects a report-directory symlink whose real target is inside the repository', () => {
    if (process.platform === 'win32') return
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-report-alias-'))
    temporaryDirectories.add(externalRoot)
    const repositoryTarget = path.resolve(`breadcrumb-pr6-report-target-${process.pid}`)
    mkdirSync(repositoryTarget, { mode: 0o700 })
    temporaryDirectories.add(repositoryTarget)
    const alias = path.join(externalRoot, 'report-link')
    symlinkSync(repositoryTarget, alias, 'dir')
    const reportPath = path.join(alias, 'report.json')
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/breadcrumb-pr6-kill-matrix.mjs'),
      '--protocol-self-test',
      '--case',
      'restore.validate',
      '--report',
      reportPath,
      '--work-root',
      path.join(externalRoot, 'work'),
    ], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 10_000 })
    expect(result.status).not.toBe(0)
    expect(readFileSync.bind(null, reportPath, 'utf8')).toThrow()
  })

  it('rejects a report-directory symlink whose real target is the disposable work root', () => {
    if (process.platform === 'win32') return
    const externalRoot = mkdtempSync(path.join(tmpdir(), 'sartracker-pr6-work-alias-'))
    temporaryDirectories.add(externalRoot)
    const workRoot = path.join(externalRoot, 'work')
    mkdirSync(workRoot, { mode: 0o700 })
    const alias = path.join(externalRoot, 'report-link')
    symlinkSync(workRoot, alias, 'dir')
    const reportPath = path.join(alias, 'report.json')
    const result = spawnSync(process.execPath, [
      path.resolve('scripts/breadcrumb-pr6-kill-matrix.mjs'),
      '--protocol-self-test',
      '--case',
      'restore.validate',
      '--report',
      reportPath,
      '--work-root',
      workRoot,
    ], { cwd: path.resolve('.'), encoding: 'utf8', timeout: 10_000 })
    expect(result.status).not.toBe(0)
    expect(readFileSync.bind(null, reportPath, 'utf8')).toThrow()
  })
})
