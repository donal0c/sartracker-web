import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PACKAGE_ADAPTER_CONTRACTS,
  executePackageVariant,
  copyStorageMissionFixture,
  buildArchiveFieldValidatorBinding,
  copyPagingFixture,
  buildArchiveSecurityValidatorBinding,
  retainArchiveReferencedFiles,
  retainCaptures,
  resolveProducerReportLocation,
  copyReplayScaleFixture,
  retainReplayOutingReferencedFile,
  retainLegacyReferencedFiles,
  validateOwnedProducerEvidencePath,
  validateRetainedPackage,
} from '../../scripts/qualification/package-adapter.mjs'

const sourceSha = 'a'.repeat(40)
const sourceTree = 'b'.repeat(40)
const executableSha = 'c'.repeat(64)
const asarSha = 'd'.repeat(64)
let temporaryRoot: string | undefined

it('binds retained producer output to this attempt under its campaign lease', () => {
  const attempt = '/owned/campaign/attempts/attempt-123'
  const evidence = '/owned/campaign/leases/lease-1/fixtures/attempt-123-unique/package-runtime/evidence'
  expect(validateOwnedProducerEvidencePath(evidence, attempt)).toBe(evidence)
  expect(() => validateOwnedProducerEvidencePath(evidence.replace('attempt-123-unique', 'other-attempt'), attempt)).toThrow()
  expect(() => validateOwnedProducerEvidencePath(evidence.replace('/owned/campaign/', '/borrowed/campaign/'), attempt)).toThrow()
})

it('does not admit an unbound adjacent storage fixture manifest', async () => {
  const fixture = await createDefinition()
  await writeFile(`${fixture.fixturePath}.manifest.json`, 'unbound replacement')
  const destination = path.join(temporaryRoot!, 'copy')
  await mkdir(destination)
  const copied = await copyStorageMissionFixture({ runtimeInputs: fixture.definition.runtimeInputs }, destination)
  await expect(readFile(`${copied.destination}.manifest.json`)).rejects.toThrow()
  expect(sha256(await readFile(copied.destination))).toBe(fixture.fixtureSha)
})

it('binds the field C20/C22 archive oracle to the observed runtime', () => {
  const binding = buildArchiveFieldValidatorBinding('C22', {
    sourceSha,
    evidenceDirectory: '/owned/evidence',
  }, { executableSha256: 'f'.repeat(64), asarSha256: '1'.repeat(64) })
  expect(binding).toEqual({
    contractId: 'C22',
    sourceSha,
    appSha256: 'f'.repeat(64),
    asarSha256: '1'.repeat(64),
    evidencePath: '/owned/evidence',
  })
})

it('binds C21 runtime paths to the independently observed packaged executable', () => {
  const binding = buildArchiveSecurityValidatorBinding({
    runtime: { appAsarPath: '/producer/app.asar', executablePath: '/producer/sartracker-web' },
  }, { sourceSha, sourceTree, bindingProofMode: 'installed-deb' }, {
    executableSha256: executableSha,
    asarSha256: asarSha,
  }, {
    observations: [{ executablePath: '/observed/sartracker-web' }],
  })
  expect(binding.runtime).toEqual({
    tier: 'packaged-module',
    sourceRoot: null,
    appAsarPath: '/observed/resources/app.asar',
    appAsarSha256: asarSha,
    executablePath: '/observed/sartracker-web',
    executableSha256: executableSha,
  })
  expect(binding.caseIds).toHaveLength(25)
})

it('copies the exact bound paging fixture before launch and rejects changed bytes', async () => {
    const fixture = await createDefinition()
    const runtimeDirectory = path.join(temporaryRoot!, 'paging-runtime')
    await mkdir(runtimeDirectory)
    const context = { runtimeInputs: { config: { fixtures: {
      'paging-960k': { path: fixture.fixturePath, bytes: 30, sha256: fixture.fixtureSha },
    } } } }
    await expect(copyPagingFixture(context, runtimeDirectory, 'paging-960k')).resolves.toMatchObject({
      destination: path.join(runtimeDirectory, 'paging-960k.sqlite'),
      sha256: fixture.fixtureSha,
    })
    await writeFile(fixture.fixturePath, 'changed paging fixture')
    await expect(copyPagingFixture(context, runtimeDirectory, 'paging-960k')).rejects.toThrow(/changed|bound/iu)
})

it('copies the exact bound replay-scale fixture through the standalone SQLite boundary', async () => {
    const fixture = await createDefinition()
    const runtimeDirectory = path.join(temporaryRoot!, 'replay-runtime')
    await mkdir(runtimeDirectory)
    const context = { runtimeInputs: { config: { fixtures: {
      'replay-960k': { path: fixture.fixturePath, bytes: 30, sha256: fixture.fixtureSha },
    } } } }
    await expect(copyReplayScaleFixture(context, runtimeDirectory, 'replay-960k')).resolves.toMatchObject({
      destination: path.join(runtimeDirectory, 'replay-960k.sqlite'),
      sha256: fixture.fixtureSha,
    })
    await writeFile(fixture.fixturePath, 'changed replay fixture')
    await expect(copyReplayScaleFixture(context, runtimeDirectory, 'replay-960k')).rejects.toThrow(/changed|bound/iu)
})

it('rejects an unbound storage sidecar before creating a disposable database copy', async () => {
    const fixture = await createDefinition()
    const runtimeDirectory = path.join(temporaryRoot!, 'storage-runtime')
    await mkdir(runtimeDirectory)
    await writeFile(`${fixture.fixturePath}-wal`, 'unbound WAL sidecar')
    const context = { runtimeInputs: fixture.definition.runtimeInputs }
    const destination = path.join(runtimeDirectory, 'storageMission.sqlite')
    await expect(copyStorageMissionFixture(context, runtimeDirectory)).rejects.toThrow(/sidecar/iu)
    await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('retains every fixed C19 default-profile source and restart database by report identity', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-legacy-reference-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  const fixturePath = path.join(evidenceDirectory, 'source.sqlite')
  const migratedPath = path.join(evidenceDirectory, 'migrated.sqlite')
  const restartedPath = path.join(evidenceDirectory, 'restarted.sqlite')
  await writeFile(fixturePath, 'legacy source')
  await writeFile(migratedPath, 'legacy migrated')
  await writeFile(restartedPath, 'legacy restarted')
  const retained = await retainLegacyReferencedFiles({
    variantId: 'legacy-v11-50k',
    report: {
      fixture: { path: fixturePath },
      migrated: { path: migratedPath },
      restartedFile: { path: restartedPath },
    },
    evidenceDirectory,
    attemptDirectory,
  })
  expect(retained.map((entry) => entry.key)).toEqual(['fixture', 'migrated', 'restartedFile'])
  await expect(readFile(path.join(attemptDirectory, 'legacy-source.sqlite'), 'utf8')).resolves.toBe('legacy source')
  await expect(readFile(path.join(attemptDirectory, 'legacy-migrated.sqlite'), 'utf8')).resolves.toBe('legacy migrated')
  await expect(readFile(path.join(attemptDirectory, 'legacy-restarted.sqlite'), 'utf8')).resolves.toBe('legacy restarted')
})

it('retains the fixed C10 replay outing source fixture by explicit report identity', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-replay-outing-reference-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  const fixturePath = path.join(evidenceDirectory, 'source.sqlite')
  await writeFile(fixturePath, 'replay outing source')
  const fixtureSha = sha256(await readFile(fixturePath))
  const retained = await retainReplayOutingReferencedFile({
    report: { fixture: { path: fixturePath, bytes: 20, sha256: fixtureSha } },
    evidenceDirectory,
    attemptDirectory,
  })
  expect(retained).toEqual({ path: 'replay-outing-source.sqlite', sha256: fixtureSha, bytes: 20 })
  await expect(readFile(path.join(attemptDirectory, retained.path), 'utf8')).resolves.toBe('replay outing source')
})

it('retains each source and migrated file in the fixed C19 schema matrix', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-legacy-schema-reference-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  const cases = []
  for (const version of [1, 2]) {
    const sourcePath = path.join(evidenceDirectory, `schema-${version}-source.sqlite`)
    const migratedPath = path.join(evidenceDirectory, `schema-${version}-migrated.sqlite`)
    await writeFile(sourcePath, `schema ${version} source`)
    await writeFile(migratedPath, `schema ${version} migrated`)
    cases.push({ version, source: { path: sourcePath }, migrated: { path: migratedPath } })
  }
  const retained = await retainLegacyReferencedFiles({
    variantId: 'legacy-schema-matrix', report: { cases }, evidenceDirectory, attemptDirectory,
  })
  expect(retained.map((entry) => entry.key)).toEqual([
    'schema-1-source', 'schema-1-migrated', 'schema-2-source', 'schema-2-migrated',
  ])
  expect(retained.every((entry) => entry.path.startsWith('legacy-schema-'))).toBe(true)
})

it('retains only explicit archive source/restored oracle references', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-archive-reference-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  const sourcePath = path.join(evidenceDirectory, 'source.sqlite')
  const restoredPath = path.join(evidenceDirectory, 'restored.sqlite')
  await writeFile(sourcePath, 'source oracle')
  await writeFile(restoredPath, 'restored oracle')
  const retained = await retainArchiveReferencedFiles({
    report: {
      archive: { sourcePath, restoredPath },
      unrelatedPath: path.join(evidenceDirectory, 'must-not-copy.txt'),
    },
    evidenceDirectory,
    attemptDirectory,
  })
  expect(retained.map((entry) => entry.kind)).toEqual(['source', 'restored'])
  await expect(readFile(path.join(attemptDirectory, 'archive-source-oracle.sqlite'), 'utf8')).resolves.toBe('source oracle')
  await expect(readFile(path.join(attemptDirectory, 'archive-restored-oracle.sqlite'), 'utf8')).resolves.toBe('restored oracle')
  expect(retained.every((entry) => entry.path.startsWith('archive-'))).toBe(true)
})

it('retains explicit capture failures instead of silently dropping unsafe image evidence', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-capture-retention-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  await writeFile(path.join(evidenceDirectory, 'valid.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  await writeFile(path.join(evidenceDirectory, 'forged.png'), 'not an image')
  await writeFile(path.join(evidenceDirectory, 'oversized.jpg'), Buffer.alloc(25 * 1024 * 1024 + 1, 0xff))
  const outside = path.join(temporaryRoot, 'outside.png')
  await writeFile(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  await symlink(outside, path.join(evidenceDirectory, 'linked.webp'))

  const retained = await retainCaptures([evidenceDirectory], attemptDirectory)

  expect(retained.captures).toHaveLength(1)
  expect(retained.captures[0].name).toBe('package-ui-valid.png')
  expect(retained.captureFailures).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'package-ui-forged.png', reason: 'invalid-image-header' }),
    expect.objectContaining({ name: 'package-ui-oversized.jpg', reason: 'capture-too-large' }),
    expect.objectContaining({ name: 'package-ui-linked.webp', reason: 'capture-is-symlink' }),
  ]))
  expect(retained.captureFailures).toHaveLength(3)
})

it('rejects archive oracle references that escape or use symlinks', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-archive-reference-boundary-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(evidenceDirectory)
  await mkdir(attemptDirectory)
  const outsidePath = path.join(temporaryRoot, 'outside.sqlite')
  await writeFile(outsidePath, 'outside')
  await expect(retainArchiveReferencedFiles({
    report: { archive: { sourcePath: outsidePath } }, evidenceDirectory, attemptDirectory,
  })).rejects.toThrow(/escaped/iu)
  const symlinkPath = path.join(evidenceDirectory, 'source.sqlite')
  await symlink(outsidePath, symlinkPath)
  await expect(retainArchiveReferencedFiles({
    report: { archive: { sourcePath: symlinkPath } }, evidenceDirectory, attemptDirectory,
  })).rejects.toThrow(/regular|symlink/iu)
})

it('requires exactly one fresh C15 run directory before flattening its report', async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-map-run-'))
  const evidenceDirectory = path.join(temporaryRoot, 'evidence')
  await mkdir(evidenceDirectory)
  await mkdir(path.join(evidenceDirectory, 'run-fresh123'))
  await expect(resolveProducerReportLocation(
    'C15', evidenceDirectory, path.join(evidenceDirectory, 'summary.json'),
  )).resolves.toEqual({
    reportPath: path.join(evidenceDirectory, 'run-fresh123', 'summary.json'),
    captureDirectories: [path.join(evidenceDirectory, 'run-fresh123')],
  })
  await mkdir(path.join(evidenceDirectory, 'run-stale456'))
  await expect(resolveProducerReportLocation(
    'C15', evidenceDirectory, path.join(evidenceDirectory, 'summary.json'),
  )).rejects.toThrow(/exactly one fresh/iu)
})

/** Hash exact bytes used by the retained-package fixture. */
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Build the bounded C18 definition/input fixture without a live Linux runtime. */
async function createDefinition() {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-package-adapter-'))
  const artifactPath = path.join(temporaryRoot, 'candidate.AppImage')
  const fixturePath = path.join(temporaryRoot, 'storage-mission.sqlite')
  const artifactBytes = Buffer.from('synthetic appimage bytes', 'utf8')
  const fixtureBytes = Buffer.from('synthetic sqlite fixture bytes', 'utf8')
  await writeFile(artifactPath, artifactBytes)
  await writeFile(fixturePath, fixtureBytes)
  const artifactSha = sha256(artifactBytes)
  const fixtureSha = sha256(fixtureBytes)
  const installer = { role: 'ci-appimage', path: artifactPath, bytes: artifactBytes.length, sha256: artifactSha }
  const fixture = { path: fixturePath, bytes: fixtureBytes.length, sha256: fixtureSha }
  return {
    artifactPath,
    fixturePath,
    artifactSha,
    fixtureSha,
    definition: {
      schema: 'sartracker-qualification-campaign-definition-v1',
      definitionDigest: 'e'.repeat(64),
      identities: {
        source: { sha: sourceSha, tree: sourceTree, dirty: false },
        candidate: {
          version: '0.1.0-beta.13',
          artifacts: [{ ...installer, ciRunId: 123, localBuild: false }],
        },
      },
      runtimeInputs: {
        config: {
          schema: 'sartracker-candidate-runtime-inputs-v1',
          ci: {
            provenance: { sourceSha, runId: 123, runAttempt: 1, artifactId: 456 },
            installers: [installer],
          },
          installedExecutablePath: '/opt/SAR/sartracker-web',
          fixtures: { 'storage-mission': fixture },
        },
      },
    },
  }
}

/** Build the structured C18 producer report that the existing validator understands. */
function c18Report(artifactSha: string, fixtureSha: string) {
  return {
    schemaVersion: 2,
    schema: 'sartracker-storage-diagnostics-kill-probe-v2',
    issue: 'DON-244',
    app: { basename: 'candidate.AppImage', sha256: artifactSha },
    fixture: { basename: 'storage-mission.sqlite', bytes: 31, sha256: fixtureSha },
    platform: { os: 'Linux', architecture: 'x64', node: 'v22.0.0' },
    killedAt: { type: 'backup', stage: 'started' },
    recoveredAs: { type: 'backup', stage: 'started' },
    supportBundleBasename: 'storage-diagnostics-kill-support-bundle.txt',
    privacyChecks: [{ label: 'forbidden-value-1', absent: true }],
    oracleInput: {
      schemaVersion: 1,
      redaction: 'bounded-marker-and-metric-extract-v1',
      beforeKill: { activeOperation: { type: 'backup', stage: 'started' } },
      afterRestart: {
        activeOperation: null,
        previousInterruptedOperation: { type: 'backup', stage: 'started' },
      },
      runtimeLog: {
        markers: ['storage_backup_started', 'storage_previous_run_interrupted', 'storage_main_event_loop_summary'],
        evidence: 'storage_backup_started\nstorage_previous_run_interrupted\nstorage_main_event_loop_summary',
        bytes: 123,
        sha256: asarSha,
      },
      supportBundle: {
        requiredLines: [
          '[storage-diagnostics]',
          'previous interrupted operation: backup started',
          'event loop latest maximum delay ms: 5120',
        ],
        evidence: '[storage-diagnostics]\nprevious interrupted operation: backup started\nevent loop latest maximum delay ms: 5120',
        eventLoopLatestMaximumDelayMs: 5120,
        bytes: 123,
        sha256: asarSha,
      },
      privacy: [{ label: 'forbidden-value-1', valueSha256: asarSha, matchCount: 0 }],
    },
    verdict: { passed: true, failures: [] },
  }
}

/** Build a bounded C18 permission-fault matrix report for retained revalidation. */
function c18FaultReport(artifactSha: string, fixtureSha: string) {
  const file = { sha256: 'e'.repeat(64), bytes: 31, integrity: 'ok' }
  return {
    schemaVersion: 1,
    schema: 'sartracker-storage-backup-fault-matrix-v1',
    contractId: 'C18',
    variant: 'permission',
    source: { sha256: fixtureSha },
    app: { sha256: artifactSha },
    runtime: { proofMode: 'packaged-module', executableSha256: executableSha, asarSha256: asarSha },
    cleanup: { applicationClosed: true, appProfileRemoved: true },
    releaseEligible: false,
    oracleInput: {
      schemaVersion: 1,
      redaction: 'bounded-backup-fault-facts-v1',
      variant: 'permission',
      outcome: 'failed',
      error: { name: 'Error', code: 'EACCES', messageClass: 'sqlite-cannot-open-database' },
      sourceBefore: file,
      sourceAfter: file,
      mirrorBefore: file,
      mirrorAfter: file,
      temporaryFilesAfter: [],
      permission: {
        attempted: true, observed: true, restored: true,
        denial: {
          independentWriteAttempted: true, observedCode: 'EACCES', target: 'store-directory',
          modeBefore: 0o700, modeDenied: 0o500, modeRestored: 0o700,
        },
      },
      snapshot: null,
      busyWal: null,
      concurrentWrites: null,
      worker: null,
      staleMirror: false,
      diskFull: null,
      precondition: null,
    },
  }
}

/** Build retained process observations for the exact AppImage launcher proof. */
function runtimeObservations(artifactSha: string) {
  const observation = {
    pid: 123,
    startTicks: '456',
    launchPath: '/owned/runtime/candidate.AppImage',
    executablePath: '/tmp/.mount_candidate/sartracker-web',
    executableSha256: executableSha,
    asarSha256: asarSha,
    artifactSha256: artifactSha,
    appImagePath: '/owned/runtime/candidate.AppImage',
    mainProcess: true,
    descendantOfRunner: true,
  }
  return {
    schema: 'sartracker-package-runtime-observations-v1',
    proofMode: 'ci-appimage',
    launchPath: observation.launchPath,
    artifactSha256: artifactSha,
    executableSha256: executableSha,
    asarSha256: asarSha,
    observations: [observation],
    restartCount: 0,
    descendantsAfterExit: [],
    zeroDescendantsAfterRun: true,
  }
}

/** Write a flat retained adapter receipt and its raw report/observations. */
async function writeRetainedFixture() {
  const fixture = await createDefinition()
  const attemptDirectory = path.join(temporaryRoot!, 'attempt')
  await mkdir(attemptDirectory)
  const report = c18Report(fixture.artifactSha, fixture.fixtureSha)
  const observations = runtimeObservations(fixture.artifactSha)
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
  const observationBytes = Buffer.from(`${JSON.stringify(observations, null, 2)}\n`, 'utf8')
  await writeFile(path.join(attemptDirectory, 'package-raw-report.json'), reportBytes)
  await writeFile(path.join(attemptDirectory, 'package-runtime-observations.json'), observationBytes)
  await writeFile(path.join(attemptDirectory, 'package-stdout.log'), '')
  await writeFile(path.join(attemptDirectory, 'package-stderr.log'), '')
  const receipt = {
    schema: 'sartracker-package-adapter-receipt-v1',
    contractId: 'C18',
    variantId: 'sqlite-recovery',
    proofMode: 'ci-appimage',
    definitionDigest: fixture.definition.definitionDigest,
    sourceSha,
    sourceTree,
    status: 'PASS',
    artifact: { role: 'ci-appimage', sha256: fixture.artifactSha, bytes: 24, basename: 'candidate.AppImage' },
    rawReportPath: 'package-raw-report.json',
    runtimeObservationsPath: 'package-runtime-observations.json',
    stdoutPath: 'package-stdout.log',
    stderrPath: 'package-stderr.log',
    rawReportSha256: sha256(reportBytes),
    runtimeObservationsSha256: sha256(observationBytes),
    runtime: observations,
    process: { exitCode: 0, signal: null, timedOut: false, processError: null, zeroDescendantsAfterRun: true },
    validation: { passed: true },
  }
  return { ...fixture, attemptDirectory, report, observations, receipt }
}

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('packaged qualification adapter', () => {
  it('exposes only reviewed packaged producer contracts and refuses missing runtime inputs', async () => {
    expect(PACKAGE_ADAPTER_CONTRACTS).toEqual(['C01', 'C02', 'C03', 'C05', 'C06', 'C07', 'C08', 'C09', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19', 'C20', 'C21', 'C22', 'C23', 'C26', 'C28'])
    await expect(executePackageVariant({
      normalized: {},
      binding: { contractId: 'C18', proofMode: 'ci-appimage' },
      attemptDirectory: '/owned/attempt',
      workDirectory: '/owned/work',
    })).rejects.toThrow(/runtime input|definition|binding/iu)
  })

  it('revalidates retained raw C18 report and actual runtime observations from flat attempt files', async () => {
    const fixture = await writeRetainedFixture()
    const result = await validateRetainedPackage(fixture.receipt, {
      contractId: 'C18',
      variantId: 'sqlite-recovery',
      proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('PASS')
    expect(result.validation.passed).toBe(true)
    expect(result.validation.predicates.recovery).toBe(true)
    expect(result.runtimeObservations.zeroDescendantsAfterRun).toBe(true)
  })

  it('rejects missing or failed retained process metadata', async () => {
    const fixture = await writeRetainedFixture()
    for (const process of [undefined, { ...fixture.receipt.process, processError: 'spawn failed' },
      { ...fixture.receipt.process, timedOut: undefined }]) {
      const result = await validateRetainedPackage({ ...fixture.receipt, process }, {
        contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
      }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
      expect(result.status).toBe('INVALID_EVIDENCE')
    }
  })

  it('keeps the full outer tier binding in retained receipt identity', async () => {
    const fixture = await writeRetainedFixture()
    await expect(validateRetainedPackage({ ...fixture.receipt, variantId: 'sqlite-recovery-installed' }, {
      contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })).rejects.toThrow(/bound|binding|definition/iu)
  })

  it('rejects a noncanonical installed launcher during retained package admission', async () => {
    const fixture = await writeRetainedFixture()
    fixture.definition.identities.candidate.artifacts[0].role = 'ci-deb'
    fixture.definition.runtimeInputs.config.ci.installers[0].role = 'ci-deb'
    fixture.definition.runtimeInputs.config.installedExecutablePath = '/opt/SAR Tracker Electron Validation/resources/app.asar'
    await expect(validateRetainedPackage({ ...fixture.receipt,
      proofMode: 'installed-deb', variantId: 'sqlite-recovery-installed',
      artifact: { ...fixture.receipt.artifact, role: 'ci-deb' },
    }, { contractId: 'C18', proofMode: 'installed-deb', variantId: 'sqlite-recovery-installed' },
    { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })).rejects.toThrow(/canonical.*launcher/iu)
  })

  it('revalidates retained C18 fault-matrix facts with the independent oracle', async () => {
    const fixture = await writeRetainedFixture()
    const report = c18FaultReport(fixture.artifactSha, fixture.fixtureSha)
    const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
    await writeFile(path.join(fixture.attemptDirectory, 'package-raw-report.json'), reportBytes)
    const receipt = {
      ...fixture.receipt,
      variantId: 'permission',
      rawReportSha256: sha256(reportBytes),
    }
    const result = await validateRetainedPackage(receipt, {
      contractId: 'C18', variantId: 'permission', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('PASS')
    expect(result.validation.predicates.oracle).toBe(true)
  })

  it('rejects passing C18 oracle facts for a different planned fault', async () => {
    const fixture = await writeRetainedFixture()
    const report = c18FaultReport(fixture.artifactSha, fixture.fixtureSha)
    const substituted = { ...report, oracleInput: { ...report.oracleInput,
      variant: 'busy-wal', outcome: 'completed', error: null,
      busyWal: { writeTransactionHeld: true, backupCompleted: true, released: true },
    } }
    const bytes = Buffer.from(`${JSON.stringify(substituted)}\n`)
    await writeFile(path.join(fixture.attemptDirectory, 'package-raw-report.json'), bytes)
    const result = await validateRetainedPackage({ ...fixture.receipt,
      variantId: 'permission', rawReportSha256: sha256(bytes),
    }, { contractId: 'C18', variantId: 'permission', proofMode: 'ci-appimage' },
    { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.validation.failureReasons.join(' ')).toMatch(/variant/iu)
  })

  it('re-reads raw observations instead of trusting retained validation or producer verdict', async () => {
    const fixture = await writeRetainedFixture()
    const tampered = { ...fixture.report, killedAt: { type: 'backup', stage: 'finished' }, verdict: { passed: true } }
    await writeFile(path.join(fixture.attemptDirectory, 'package-raw-report.json'), `${JSON.stringify(tampered)}\n`)
    const result = await validateRetainedPackage(fixture.receipt, {
      contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.validation.failureReasons.join(' ')).toMatch(/checkpoint|backup|recovery/iu)
  })

  it('rejects retained paths outside the owned attempt directory', async () => {
    const fixture = await writeRetainedFixture()
    await expect(validateRetainedPackage({ ...fixture.receipt, rawReportPath: '../outside.json' }, {
      contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })).rejects.toThrow(/inside|attempt|path/iu)
  })

  it('rejects process identity or descendant cleanup claims during retained validation', async () => {
    const fixture = await writeRetainedFixture()
    const tampered = { ...fixture.observations, zeroDescendantsAfterRun: false, descendantsAfterExit: [999] }
    await writeFile(path.join(fixture.attemptDirectory, 'package-runtime-observations.json'), `${JSON.stringify(tampered)}\n`)
    const result = await validateRetainedPackage(fixture.receipt, {
      contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.failureReasons.join(' ')).toMatch(/descendant|identity|runtime/iu)
  })

  it('does not treat an AppImage producer hash as the observed unpacked ELF hash', async () => {
    const fixture = await writeRetainedFixture()
    const changed = {
      ...fixture.receipt,
      runtime: { ...fixture.receipt.runtime, executableSha256: fixture.artifactSha },
    }
    const result = await validateRetainedPackage(changed, {
      contractId: 'C18', variantId: 'sqlite-recovery', proofMode: 'ci-appimage',
    }, { definition: fixture.definition, attemptDirectory: fixture.attemptDirectory })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.failureReasons.join(' ')).toMatch(/runtime|executable|identity/iu)
  })
})
