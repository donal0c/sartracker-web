import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  COMPOSITE_FAMILY_CONTRACTS,
  C17_CANARY_IDS,
  computeExpectedPassSequenceSha256,
  validateCompositeFamilyCoverage,
  validateCompositeFamilyReceipt,
} from '../../scripts/qualification/composite-family-receipts.mjs'
import { COMPOSITE_SOURCE_MANIFEST_PATHS } from '../../scripts/qualification/composite-manifest.mjs'
import {
  C17_ADVERSARIAL_CASE_IDS,
  C17_LONG_SECRET_KEY,
  C17_NUMERIC_SECRET,
  C17_SOURCE_CORPUS_TESTS,
} from '../../scripts/qualification/c17-adversarial-corpus.mjs'
import { buildC17OutputScanIdentity, scanC17OutputFileSync } from '../../scripts/qualification/c17-output-scan.mjs'
import { buildC17DiagnosticEvents, resolveArchivePreparation } from '../../scripts/qualification/composite-probe.mjs'

type JsonObject = Record<string, unknown>

const repoRoot = path.resolve(process.cwd())
const appPath = path.join(repoRoot, 'package.json')
const appBytes = readFileSync(appPath)
const packagedAppPath = path.join(os.tmpdir(), 'sartracker-family-receipt-test.asar')
const packagedAppBytes = Buffer.from('packaged-family-receipt-fixture\n', 'utf8')
writeFileSync(packagedAppPath, packagedAppBytes, { mode: 0o600 })
const retainedPackagedAppPath = '/tmp/sartracker-family-evidence/retained-packaged-app.asar'
mkdirSync(path.dirname(retainedPackagedAppPath), { recursive: true })
writeFileSync(retainedPackagedAppPath, packagedAppBytes, { mode: 0o600 })
const retainedDiagnosticPath = '/tmp/sartracker-family-evidence/c17-sanitized-output.txt'
const exportedDiagnosticPath = '/tmp/sartracker-family-evidence/.profile-composite/diagnostics-reports/c17-diagnostics-support.txt'
const retainedDiagnosticBytes = Buffer.from([
  'sanitized diagnostics',
  ...C17_CANARY_IDS.map((id) => `C17-CONTROL:${id}`),
  '',
].join('\n'), 'utf8')
const retainedCanaryManifestPath = '/tmp/sartracker-family-evidence/c17-canary-manifest.txt'
const retainedCanaryManifestBytes = Buffer.from([
  ...C17_CANARY_IDS,
].join('\n'), 'utf8')
const retainedPassPagesPath = '/tmp/sartracker-family-evidence/c11-pass-pages.ndjson'
const retainedPassPagesBytes = Buffer.from(Array.from({ length: 1_000 }, (_, pageIndex) => {
  const entries = Array.from({ length: 50 }, (_, offset) => {
    const index = pageIndex * 50 + offset
    return {
      id: index === 0 ? 'c28-pass' : `c11-pass-${String(index).padStart(5, '0')}`,
      assignment_id: 'c28-assignment',
      outcome: index === 1 ? 'partial' : index === 2 ? 'aborted' : 'full',
    }
  })
  return JSON.stringify({
    pageIndex,
    cursor: pageIndex === 0 ? null : `cursor-${pageIndex}`,
    nextCursor: pageIndex === 999 ? null : `cursor-${pageIndex + 1}`,
    totalCount: 50_000,
    entries,
  })
}).join('\n'), 'utf8')
mkdirSync(path.dirname(retainedDiagnosticPath), { recursive: true })
writeFileSync(retainedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
mkdirSync(path.dirname(exportedDiagnosticPath), { recursive: true })
writeFileSync(exportedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
writeFileSync(retainedCanaryManifestPath, retainedCanaryManifestBytes, { mode: 0o600 })
writeFileSync(retainedPassPagesPath, retainedPassPagesBytes, { mode: 0o600 })

const sourceFiles = [...COMPOSITE_SOURCE_MANIFEST_PATHS]
const sourceManifest = sourceFiles.map((relativePath) => {
  const bytes = readFileSync(path.join(repoRoot, relativePath))
  return {
    relativePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  }
})
const expectedBase = {
  appPath,
  appSha256: createHash('sha256').update(appBytes).digest('hex'),
  evidencePath: '/tmp/sartracker-family-evidence',
  profilePath: '/tmp/sartracker-family-evidence/.profile-composite',
  sourceHead: 'b'.repeat(40),
  sourceManifest,
  sourceRoot: repoRoot,
}
const sourceManifestSha256 = createHash('sha256').update(JSON.stringify(sourceManifest)).digest('hex')
const sourceCorpusReceiptPath = path.join(expectedBase.evidencePath, 'c17-source-corpus-receipt.json')
const sourceCorpusReceiptBytes = Buffer.from(`${JSON.stringify({
  schema: 'sartracker-c17-source-corpus-receipt-v1',
  sourceHead: expectedBase.sourceHead,
  appSha256: expectedBase.appSha256,
  sourceManifestSha256,
  status: 'PASS',
  complete: true,
  modes: ['renderer', 'electron-main'],
  corpusCaseIds: [...C17_ADVERSARIAL_CASE_IDS],
  tests: C17_SOURCE_CORPUS_TESTS.map((test) => ({ relativePath: test.path, name: test.name, passed: true })),
  totalPassedTests: 3,
  totalFailedTests: 0,
}, null, 2)}\n`, 'utf8')
writeFileSync(sourceCorpusReceiptPath, sourceCorpusReceiptBytes, { mode: 0o600 })

function c17OutputScanIdentity() {
  return buildC17OutputScanIdentity({
    sourceHead: expectedBase.sourceHead,
    appSha256: expectedBase.appSha256,
    exportedPath: exportedDiagnosticPath,
    retainedOutputPath: retainedDiagnosticPath,
    outputScan: scanC17OutputFileSync(exportedDiagnosticPath),
    retainedScan: scanC17OutputFileSync(retainedDiagnosticPath),
  })
}

function report(): JsonObject {
  const missionId = 'mission-family'
  const diagnostics = {
    requested: true,
    exported: true,
    exportedPath: exportedDiagnosticPath,
    sanitized: true,
    containsSecret: false,
    containsProfilePath: false,
    exactSecretMatches: 0,
    adversarialMatchCount: 0,
    canaryManifestSha256: createHash('sha256').update(retainedCanaryManifestBytes).digest('hex'),
    outputSha256: createHash('sha256').update(retainedDiagnosticBytes).digest('hex'),
    outputByteLength: retainedDiagnosticBytes.byteLength,
    canaryCount: C17_CANARY_IDS.length,
    positiveControlIds: [...C17_CANARY_IDS],
    outputWithinLimit: true,
    sourceCorpusReceiptPath,
    sourceCorpusReceiptSha256: createHash('sha256').update(sourceCorpusReceiptBytes).digest('hex'),
    outputScanIdentity: c17OutputScanIdentity(),
    retainedOutputPath: retainedDiagnosticPath,
    retainedCanaryManifestPath,
    leakedCanaryIds: [],
  }
  return {
    schemaVersion: 1,
    proofKind: 'packaged-composite-v1',
    contractId: 'C28',
    source: {
      expectedHead: expectedBase.sourceHead,
      observedHead: expectedBase.sourceHead,
      dirty: false,
      manifest: sourceManifest,
    },
    app: {
      path: expectedBase.appPath,
      sha256: expectedBase.appSha256,
      sizeBytes: appBytes.byteLength,
      packagedAppPath,
      packagedAppSha256: createHash('sha256').update(packagedAppBytes).digest('hex'),
      retainedPackagedAppPath,
      retainedPackagedAppSha256: createHash('sha256').update(packagedAppBytes).digest('hex'),
    },
    invocation: {
      app: '--app',
      evidence: '--evidence',
      expectedHead: '--expected-head',
      networkBlocked: true,
      userDataPath: expectedBase.profilePath,
    },
    profile: {
      path: expectedBase.profilePath,
      userDataPath: expectedBase.profilePath,
      observedUserDataPaths: [expectedBase.profilePath, expectedBase.profilePath],
      removed: true,
      usedSystemUserProfile: false,
      sameProfileAcrossPhases: true,
    },
    mission: {
      missionId,
      nameSha256: '1'.repeat(64),
      phaseMissionIds: [missionId, missionId, missionId],
    },
    phases: {
      missionOutingParticipants: {
        supported: true,
        missionId,
        outingId: 'outing-family',
        missionStatus: 'active',
        outingEnded: true,
        participantCount: 1,
        participantIds: ['participant-family'],
        backfillCompleted: true,
        backfillCheckpointCount: 1,
      },
      markerSearch: {
        supported: true,
        missionId,
        markerId: 'marker-family',
        searchAreaId: 'area-family',
        assignmentId: 'assignment-family',
        searchPassId: 'pass-family',
        markerCount: 1,
        searchAreaCount: 1,
        searchPassCount: 1,
      },
      sanitizedDiagnostics: {
        supported: true,
        ...diagnostics,
        pathWithinProfile: true,
      },
    },
    diagnostics,
    network: { blocked: true, httpRequests: 0, httpsRequests: 0 },
    run: {
      startedAt: '2026-09-19T19:00:00.000Z',
      finishedAt: '2026-09-19T19:01:00.000Z',
      firstPid: 101,
      restartPid: 103,
    },
    stderr: { sha256: '2'.repeat(64), byteLength: 0, lines: [] },
    gaps: [],
  }
}

function expected(contractId: 'C03' | 'C11' | 'C17') {
  return { ...expectedBase, contractId }
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('independent packaged composite family receipts', () => {
  it('builds the C17 event corpus from the supplied canaries without hidden outer-scope names', () => {
    const events = buildC17DiagnosticEvents({
      secret: 'base-secret',
      profilePath: '/tmp/c17-profile',
      timestamp: '2026-09-20T20:30:00.000Z',
      canaries: {
        eventPassword: 'event-password',
        directContentProfilePath: '/tmp/c17-profile/direct',
        eventNestedToken: 'nested-token',
        nestedArrayProfilePath: '/tmp/c17-profile/nested',
        nestedArraySecret: 'array-secret',
        eventAuthorizationHeader: 'authorization-header',
        eventQueryCredential: 'query-credential',
        urlCredentials: 'url-credentials',
      },
    })

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      ts: '2026-09-20T20:30:00.000Z',
      fields: {
        password: 'event-password',
        profilePath: '/tmp/c17-profile/direct',
        c17CanaryControlIds: expect.any(Array),
        nested: {
          token: 'nested-token',
          arrayToken: 'array-secret',
          path: '/tmp/c17-profile/nested',
          values: ['array-secret', '/tmp/c17-profile/nested'],
          headers: { Authorization: 'Bearer authorization-header' },
          queryUrl: 'https://host.example/api?session=query-credential',
        },
        recoveryCode: C17_NUMERIC_SECRET,
        [C17_LONG_SECRET_KEY]: 'base-secret-long-key-secret',
      },
    })
    expect(events[0]?.fields?.c17CanaryControlIds).toEqual(
      C17_CANARY_IDS.slice(4).map((id) => `C17-CONTROL:${id}`),
    )
    expect(events[1]).toMatchObject({
      fields: { providerUrl: 'https://operator:url-credentials@example.invalid/sar' },
    })
  })

  it('prepares archive only from active or paused state, with explicit finished revision reuse', () => {
    expect(resolveArchivePreparation({ status: 'active' })).toEqual({ shouldFinish: true, status: 'active' })
    expect(resolveArchivePreparation({ status: 'paused' })).toEqual({ shouldFinish: true, status: 'paused' })
    expect(resolveArchivePreparation({ status: 'finished' }, true)).toEqual({ shouldFinish: false, status: 'finished' })
    expect(() => resolveArchivePreparation({ status: 'finished' })).toThrow(/already finished/u)
    expect(() => resolveArchivePreparation({ status: 'finalized' }, true)).toThrow(/unexpected mission status/u)
  })

  it('validates C03 participant scope from actual C28 phase facts', () => {
    expect(validateCompositeFamilyReceipt(report(), expected('C03'))).toMatchObject({
      contractId: 'C03',
      producerContractId: 'C28',
      proofMode: 'packaged-composite',
      status: 'PASS',
      valid: true,
      evidenceComplete: true,
      complete: false,
      campaignEligible: false,
      sourceBrowserSubstitution: false,
    })
  })

  it('validates C11 search identity while exposing unexecuted family axes', () => {
    const receipt = validateCompositeFamilyReceipt(report(), expected('C11'))
    expect(receipt).toMatchObject({
      contractId: 'C11',
      producerContractId: 'C28',
      status: 'PASS',
      valid: true,
      evidenceComplete: true,
      complete: false,
      campaignEligible: false,
    })
    expect(receipt.coverageComplete).toBe(false)
    expect(receipt.coverageGaps).toEqual(expect.arrayContaining([
      'repeated-full-partial-aborted-pass-outcomes',
      '50000-pass-paging',
    ]))
  })

  it('validates C17 sanitized export facts and adversarial scan facts', () => {
    const receipt = validateCompositeFamilyReceipt(report(), expected('C17'))
    expect(receipt).toMatchObject({
      contractId: 'C17',
      producerContractId: 'C28',
      status: 'PASS',
      valid: true,
      evidenceComplete: true,
      complete: true,
      campaignEligible: false,
    })
  })

  it('validates retained C17 output after disposable profile cleanup', () => {
    const c17 = report()
    rmSync(expectedBase.profilePath, { recursive: true, force: true })
    try {
      expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
        valid: true,
        complete: true,
        coverageGaps: [],
      })
    } finally {
      mkdirSync(path.dirname(exportedDiagnosticPath), { recursive: true })
      writeFileSync(exportedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
    }
  })

  it('accepts C03 only when the independent outing, known-at-fix, and exclusion facts are retained', () => {
    const enriched = copy(report())
    ;(enriched.phases.missionOutingParticipants as JsonObject).outingCount = 12
    ;(enriched.phases.missionOutingParticipants as JsonObject).midnightCrossings = true
    ;(enriched.phases.missionOutingParticipants as JsonObject).scopeOracle = 'independent'
    ;(enriched.phases.missionOutingParticipants as JsonObject).knownAtFixTime = {
      scopeOracle: 'independent',
      selectedAt: '2026-01-01T00:00:00.000Z',
      selectedDeviceId: 'device-selected',
      lateFixAt: '2026-01-01T00:00:01.000Z',
      lateFixExcluded: true,
      selectedFixCount: 1,
      lateFixCount: 1,
      rawRows: [
        { sourcePositionId: 'selected-fix', timestamp: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-01T00:00:01.000Z', timestampSource: 'fix' },
        { sourcePositionId: 'late-fix', timestamp: '2025-12-31T23:59:59.000Z', receivedAt: '2026-01-01T00:00:02.000Z', timestampSource: 'fix' },
      ],
    }
    ;(enriched.phases.missionOutingParticipants as JsonObject).excludedDeviceId = 'device-excluded'
    ;(enriched.phases.missionOutingParticipants as JsonObject).excludedDeviceObserved = true
    ;(enriched.phases.missionOutingParticipants as JsonObject).excludedDevicePositionRows = 1
    ;(enriched.phases.missionOutingParticipants as JsonObject).excludedDeviceRowsInSelectedScope = 0
    expect(validateCompositeFamilyReceipt(enriched, expected('C03'))).toMatchObject({
      valid: true, complete: true, coverageComplete: true, coverageGaps: [],
    })
  })

  it('rejects C03 scope facts when the excluded device has retained rows', () => {
    const enriched = copy(report())
    Object.assign(enriched.phases.missionOutingParticipants as JsonObject, {
      outingCount: 12,
      midnightCrossings: true,
      scopeOracle: 'independent',
      knownAtFixTime: {
        scopeOracle: 'independent',
        selectedAt: '2026-01-01T00:00:00.000Z',
        selectedDeviceId: 'device-selected',
        lateFixAt: '2026-01-01T00:00:01.000Z',
        lateFixExcluded: true,
        selectedFixCount: 1,
        lateFixCount: 1,
        rawRows: [
          { sourcePositionId: 'selected-fix', timestamp: '2026-01-01T00:00:00.000Z', receivedAt: '2026-01-01T00:00:01.000Z', timestampSource: 'fix' },
          { sourcePositionId: 'late-fix', timestamp: '2025-12-31T23:59:59.000Z', receivedAt: '2026-01-01T00:00:02.000Z', timestampSource: 'fix' },
        ],
      },
      excludedDeviceId: 'device-excluded',
      excludedDeviceObserved: true,
      excludedDevicePositionRows: 1,
      excludedDeviceRowsInSelectedScope: 1,
    })
    const receipt = validateCompositeFamilyReceipt(enriched, expected('C03'))
    expect(receipt.valid).toBe(false)
    expect(receipt.failureReasons.join('\n')).toMatch(/excluded|known-at|scope/u)
  })

  it('accepts C11 only with independently retained repeated outcomes and complete paging facts', () => {
    const enriched = copy(report())
    Object.assign(enriched.phases.markerSearch as JsonObject, {
      assignmentId: 'c28-assignment',
      searchPassCount: 50_000,
      passOutcomes: [
        { passId: 'pass-full', assignmentId: 'c28-assignment', outcome: 'full' },
        { passId: 'pass-partial', assignmentId: 'c28-assignment', outcome: 'partial' },
        { passId: 'pass-aborted', assignmentId: 'c28-assignment', outcome: 'aborted' },
      ],
      passPaging: {
        totalCount: 50_000,
        complete: true,
        pageCount: 1000,
        sequenceSha256: computeExpectedPassSequenceSha256('c28-assignment'),
        rawPagesPath: retainedPassPagesPath,
        rawPagesSha256: createHash('sha256').update(retainedPassPagesBytes).digest('hex'),
        rawPageCount: 1000,
        rawRowCount: 50_000,
      },
    })
    expect(validateCompositeFamilyReceipt(enriched, expected('C11'))).toMatchObject({
      valid: true, complete: true, coverageComplete: true, coverageGaps: [],
    })
  })

  it('rejects forged C11 paging completion and C17 scanner identity', () => {
    const c11 = copy(report())
    Object.assign(c11.phases.markerSearch as JsonObject, {
      assignmentId: 'c28-assignment',
      searchPassCount: 50_000,
      passOutcomes: [
        { passId: 'pass-full', assignmentId: 'c28-assignment', outcome: 'full' },
        { passId: 'pass-partial', assignmentId: 'c28-assignment', outcome: 'partial' },
        { passId: 'pass-aborted', assignmentId: 'c28-assignment', outcome: 'aborted' },
      ],
      passPaging: { totalCount: 50_000, complete: true, pageCount: 2, sequenceSha256: 'a'.repeat(64) },
    })
    expect(validateCompositeFamilyReceipt(c11, expected('C11')).complete).toBe(false)

    const c17 = copy(report())
    Object.assign(c17.phases.sanitizedDiagnostics as JsonObject, {
      canaryManifestSha256: createHash('sha256').update(retainedCanaryManifestBytes).digest('hex'),
      outputSha256: createHash('sha256').update(retainedDiagnosticBytes).digest('hex'),
      outputByteLength: retainedDiagnosticBytes.byteLength,
      canaryCount: C17_CANARY_IDS.length,
      positiveControlIds: [...C17_CANARY_IDS],
      outputWithinLimit: true,
      retainedOutputPath: retainedDiagnosticPath,
      retainedCanaryManifestPath,
      leakedCanaryIds: [],
    })
    Object.assign(c17.diagnostics as JsonObject, c17.phases.sanitizedDiagnostics as JsonObject)
    const c17Receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
    expect(c17Receipt).toMatchObject({ complete: true, coverageComplete: true, coverageGaps: [] })
    ;(c17.phases.sanitizedDiagnostics as JsonObject).outputWithinLimit = false
    expect(validateCompositeFamilyReceipt(c17, expected('C17')).complete).toBe(false)
  })

  it('clears each C17 coverage gap only while its bound source and output proofs remain valid', () => {
    const c17 = copy(report())
    const phase = c17.phases.sanitizedDiagnostics as JsonObject
    expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
      valid: true,
      complete: true,
      coverageGaps: [],
    })

    phase.sourceCorpusReceiptSha256 = 'f'.repeat(64)
    let receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
    expect(receipt.complete).toBe(false)
    expect(receipt.coverageGaps).toContain('recursive-adversarial-corpus')
    expect(receipt.failureReasons.join('\n')).toMatch(/source corpus/i)

    phase.sourceCorpusReceiptSha256 = createHash('sha256').update(sourceCorpusReceiptBytes).digest('hex')
    phase.outputScanIdentity = { ...(phase.outputScanIdentity as JsonObject), exactBytesMatch: false }
    ;(c17.diagnostics as JsonObject).outputScanIdentity = phase.outputScanIdentity
    receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
    expect(receipt.complete).toBe(false)
    expect(receipt.coverageGaps).toContain('bounded-output-scan-identity')
    expect(receipt.failureReasons.join('\n')).toMatch(/output.*identity|byte/i)
  })

  it('rejects changed retained bytes and a missing source-corpus receipt', () => {
    const c17 = copy(report())
    const phase = c17.phases.sanitizedDiagnostics as JsonObject
    const changedBytes = Buffer.concat([retainedDiagnosticBytes, Buffer.from('changed')])
    try {
      writeFileSync(retainedDiagnosticPath, changedBytes, { mode: 0o600 })
      const receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
      expect(receipt.coverageGaps).toContain('bounded-output-scan-identity')
      expect(receipt.failureReasons.join('\n')).toMatch(/output.*identity|byte/i)
    } finally {
      writeFileSync(retainedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
    }

    phase.sourceCorpusReceiptPath = path.join(expectedBase.evidencePath, 'missing-c17-source-receipt.json')
    ;(c17.diagnostics as JsonObject).sourceCorpusReceiptPath = phase.sourceCorpusReceiptPath
    const receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
    expect(receipt.coverageGaps).toContain('recursive-adversarial-corpus')
    expect(receipt.failureReasons.join('\n')).toMatch(/source corpus/i)
  })

  it('independently binds C17 export paths and rejects a retained canary leak', () => {
    const c17 = copy(report())
    const phase = c17.phases.sanitizedDiagnostics as JsonObject
    Object.assign(phase, {
      canaryManifestSha256: createHash('sha256').update(retainedCanaryManifestBytes).digest('hex'),
      outputSha256: createHash('sha256').update(retainedDiagnosticBytes).digest('hex'),
      outputByteLength: retainedDiagnosticBytes.byteLength,
      canaryCount: C17_CANARY_IDS.length,
      positiveControlIds: [...C17_CANARY_IDS],
      outputWithinLimit: true,
      exportedPath: path.join(expectedBase.profilePath, 'diagnostics-reports', 'c17-diagnostics-support.txt'),
      retainedOutputPath: retainedDiagnosticPath,
      retainedCanaryManifestPath,
      leakedCanaryIds: [],
    })
    Object.assign(c17.diagnostics as JsonObject, phase)

    expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({ valid: true, complete: true })

    phase.exportedPath = path.join(expectedBase.evidencePath, 'wrong-export.txt')
    expect(validateCompositeFamilyReceipt(c17, expected('C17')).valid).toBe(false)

    phase.exportedPath = path.join(expectedBase.profilePath, 'diagnostics-reports', 'c17-diagnostics-support.txt')
    phase.pathWithinProfile = false
    expect(validateCompositeFamilyReceipt(c17, expected('C17')).valid).toBe(false)
    phase.pathWithinProfile = true
    const leaked = Buffer.from(`leaked ${'C28-Composite-Archive-9!x'}-event-password\n`, 'utf8')
    writeFileSync(retainedDiagnosticPath, leaked, { mode: 0o600 })
    phase.outputSha256 = createHash('sha256').update(leaked).digest('hex')
    phase.outputByteLength = leaked.byteLength
    ;(c17.diagnostics as JsonObject).outputSha256 = phase.outputSha256
    ;(c17.diagnostics as JsonObject).outputByteLength = phase.outputByteLength
    expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
      valid: false,
      status: 'INVALID_EVIDENCE',
    })
    writeFileSync(retainedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
  })

  it('rejects a zero-canary output when the nested-event positive controls are absent', () => {
    const c17 = copy(report())
    const phase = c17.phases.sanitizedDiagnostics as JsonObject
    phase.positiveControlIds = [...C17_CANARY_IDS.slice(0, 4)]
    ;(c17.diagnostics as JsonObject).positiveControlIds = [...C17_CANARY_IDS.slice(0, 4)]

    const receipt = validateCompositeFamilyReceipt(c17, expected('C17'))
    expect(receipt.valid).toBe(false)
    expect(receipt.failureReasons.join('\n')).toMatch(/positive.control|scanner/i)
  })

  it('keeps C17 invalid when retained raw bytes expose the fixed secret despite forged green scanner fields', () => {
    const c17 = copy(report())
    const rawLeak = Buffer.from(`nested values: ["${'C28-Composite-Archive-9!x'}"]\n`, 'utf8')
    const rawLeakPath = retainedDiagnosticPath
    writeFileSync(rawLeakPath, rawLeak, { mode: 0o600 })
    Object.assign(c17.phases.sanitizedDiagnostics as JsonObject, {
      sanitized: false,
      containsSecret: true,
      exactSecretMatches: 1,
      adversarialMatchCount: 1,
      canaryManifestSha256: createHash('sha256').update(retainedCanaryManifestBytes).digest('hex'),
      outputSha256: createHash('sha256').update(rawLeak).digest('hex'),
      outputByteLength: rawLeak.byteLength,
      canaryCount: C17_CANARY_IDS.length,
      positiveControlIds: [...C17_CANARY_IDS],
      outputWithinLimit: true,
      retainedOutputPath: rawLeakPath,
      retainedCanaryManifestPath,
      leakedCanaryIds: [],
    })
    Object.assign(c17.diagnostics as JsonObject, c17.phases.sanitizedDiagnostics as JsonObject)
    expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
      valid: false,
      status: 'FAIL',
      observedProductFailure: true,
      evidenceComplete: true,
    })
    ;(c17.app as JsonObject).sha256 = 'f'.repeat(64)
    expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
      valid: false,
      status: 'INVALID_EVIDENCE',
      observedProductFailure: false,
      evidenceComplete: false,
    })
    writeFileSync(retainedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
  })

  it.each([
    ['numeric recovery code', () => `recoveryCode: ${C17_NUMERIC_SECRET}\n`],
    ['profile path', () => `path: ${expectedBase.profilePath}/direct-content-profile\n`],
  ])('labels a C17 export leaking only the %s canary as an observed FAIL, not malformed evidence', (_label, leakText) => {
    const c17 = copy(report())
    const rawLeak = Buffer.from(leakText(), 'utf8')
    expect(rawLeak.toString('utf8')).not.toContain('C28-Composite-Archive-9!x')
    writeFileSync(retainedDiagnosticPath, rawLeak, { mode: 0o600 })
    Object.assign(c17.phases.sanitizedDiagnostics as JsonObject, {
      sanitized: false,
      canaryManifestSha256: createHash('sha256').update(retainedCanaryManifestBytes).digest('hex'),
      outputSha256: createHash('sha256').update(rawLeak).digest('hex'),
      outputByteLength: rawLeak.byteLength,
      canaryCount: C17_CANARY_IDS.length,
      positiveControlIds: [...C17_CANARY_IDS],
      outputWithinLimit: true,
      retainedOutputPath: retainedDiagnosticPath,
      retainedCanaryManifestPath,
      leakedCanaryIds: [],
    })
    Object.assign(c17.diagnostics as JsonObject, c17.phases.sanitizedDiagnostics as JsonObject)
    try {
      expect(validateCompositeFamilyReceipt(c17, expected('C17'))).toMatchObject({
        valid: false,
        status: 'FAIL',
        observedProductFailure: true,
        evidenceComplete: true,
      })
    } finally {
      writeFileSync(retainedDiagnosticPath, retainedDiagnosticBytes, { mode: 0o600 })
    }
  })

  it.each([
    ['source proof', 'C03', (value: JsonObject) => { value.proofKind = 'source-suite-v1' }],
    ['browser proof', 'C03', (value: JsonObject) => { value.proofKind = 'browser-suite-v1' }],
    ['mission substitution', 'C03', (value: JsonObject) => {
      ;((value.phases as JsonObject).missionOutingParticipants as JsonObject).missionId = 'other'
    }],
    ['marker count forgery', 'C11', (value: JsonObject) => {
      ;((value.phases as JsonObject).markerSearch as JsonObject).searchPassCount = 0
    }],
    ['diagnostic adversarial leak', 'C17', (value: JsonObject) => {
      ;((value.phases as JsonObject).sanitizedDiagnostics as JsonObject).adversarialMatchCount = 1
    }],
    ['artifact substitution', 'C03', (value: JsonObject) => {
      ;(value.app as JsonObject).sha256 = 'e'.repeat(64)
    }],
    ['profile substitution', 'C03', (value: JsonObject) => {
      ;((value.profile as JsonObject).observedUserDataPaths as string[])[0] = '/tmp/operator-profile'
    }],
    ['runtime identity substitution', 'C03', (value: JsonObject) => {
      ;((value.run as JsonObject).restartPid) = 101
    }],
  ])('rejects %s', (_label, contractId, mutate) => {
    const mutated = copy(report())
    mutate(mutated)
    expect(validateCompositeFamilyReceipt(mutated, expected(contractId as 'C03' | 'C11' | 'C17')).valid).toBe(false)
  })

  it('does not accept a generic family flag without the bound phase facts', () => {
    const forged = copy(report())
    delete forged.phases
    forged.familyComplete = true
    const receipt = validateCompositeFamilyReceipt(forged, expected('C03'))
    expect(receipt.valid).toBe(false)
    expect(receipt.failureReasons.join('\n')).toMatch(/phase|participant/u)
  })

  it('validates the retained ASAR copy after the transient runtime path disappears', () => {
    rmSync(packagedAppPath, { force: true })
    expect(validateCompositeFamilyReceipt(report(), expected('C03'))).toMatchObject({
      valid: true,
      status: 'PASS',
    })
  })

  it('allows a family-scoped receipt to end after its requested phase without a C28 restart phase', () => {
    const scoped = report()
    ;(scoped.run as JsonObject).restartPid = null
    expect(validateCompositeFamilyReceipt(scoped, expected('C11'))).toMatchObject({
      valid: true,
      status: 'PASS',
    })
  })

  it('validates all three contracts independently and preserves missing-contract gaps', () => {
    expect(COMPOSITE_FAMILY_CONTRACTS).toEqual(['C03', 'C11', 'C17'])
    const receipts = validateCompositeFamilyCoverage(report(), {
      C03: expected('C03'),
      C11: expected('C11'),
      C17: expected('C17'),
    })
    expect(Object.keys(receipts)).toEqual(COMPOSITE_FAMILY_CONTRACTS)
    expect(Object.values(receipts).every((value) => value.valid)).toBe(true)

    const missing = validateCompositeFamilyCoverage(report(), {
      C03: expected('C03'),
      C11: expected('C11'),
    })
    expect(missing.C17.valid).toBe(false)
    expect(missing.C17.failureReasons).toContain('C17 expected binding was not supplied.')
  })
})

afterAll(() => {
  rmSync(packagedAppPath, { force: true })
  rmSync(path.dirname(retainedDiagnosticPath), { recursive: true, force: true })
})
