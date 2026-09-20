import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { buildAllowlistedLiveExactReport } from '../../build/breadcrumb-live-exact-proof-lib.js'
import {
  executeLiveVariant,
  validateRetainedLive,
} from '../../scripts/qualification/live-adapter.mjs'

const artifactSha = 'a'.repeat(64)
const sourceSha = 'b'.repeat(40)
const version = '0.1.0-beta.13'
const binding = {
  contractId: 'C05',
  variantId: 'fix-time-ingest',
  proofMode: 'ci-appimage',
  liveAccess: 'GET_ONLY',
  command: ['node', 'scripts/release-smoke/breadcrumb-live-exact-smoke.mjs'],
}
let temporaryRoot: string | undefined

/** Hash exact retained JSON bytes. */
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Build a privacy-safe exact live report with no operational coordinates or credentials. */
function liveReport() {
  const count = 8941
  const hmacSha256 = 'c'.repeat(64)
  const value = buildAllowlistedLiveExactReport({
    artifactSha256: artifactSha,
    expectedVersion: version,
    fixEvidence: { count, hmacSha256, matched: true },
    renderedIdentityTimeEvidence: { count, hmacSha256, matched: true },
    renderedCoordinateDeviation: {
      joinedFixCount: count,
      missingFixCount: 0,
      conflictingFixCount: 0,
      metreLimit: 8,
      perAxisPixelLimit: 0.0625,
      radialPixelLimit: Math.SQRT2 / 16,
      metres: { p50: 0, p95: 1, max: 2 },
      screenPixels: { p50: 0, p95: 0.01, max: 0.02 },
      screenPixelAxes: { maxX: 0.01, maxY: 0.01 },
    },
    pageCount: 1,
    maximumPageCount: count,
    returnedToLatest: true,
    baselineBreadcrumbPointCount: 0,
    lookbackHours: 48,
    exactPageLimit: 10000,
    providerGetOnly: true,
    sqliteIntegrityOk: true,
    screenshotSha256: 'd'.repeat(64),
    sourceFetchMs: 1,
    sqliteReadMs: 1,
    exactPageMs: 1,
    geoJsonMs: 1,
    renderedMapMs: 1,
    renderedAudit: {
      renderedFeatureCount: count,
      uniqueFixCount: count,
      duplicateTileCopyCount: 0,
      missingFeatureIdCount: count,
      numericFeatureIdCount: 0,
      stringFeatureIdCount: 0,
      otherFeatureIdCount: 0,
      mismatchedStringFeatureIdCount: 0,
      conflictingDuplicateCount: 0,
    },
  })
  return {
    ...value,
    schemaVersion: 2,
    oracleInputs: {
      fixStages: Object.fromEntries(['provider', 'sqlite', 'exactPages', 'exactGeoJson'].map((key) => [key, { count, hmacSha256 }])),
      sourceIdentityTime: { count, hmacSha256 },
      renderedIdentityTime: { count, hmacSha256 },
    },
  }
}

/** Build immutable normalized runtime inputs with two private live fixture roles. */
function normalized() {
  const liveConfig = { path: '/private/live-config', bytes: 12, sha256: 'e'.repeat(64) }
  const liveSelector = { path: '/private/live-selector.json', bytes: 13, sha256: 'f'.repeat(64) }
  const artifact = { role: 'ci-appimage', path: '/owned/candidate.AppImage', bytes: 123, sha256: artifactSha }
  return {
    identities: {
      source: { sha: sourceSha },
      candidate: { version, artifacts: [artifact] },
    },
    runtimeInputs: {
      schema: 'sartracker-bound-runtime-inputs-v1',
      config: { fixtures: { 'live-config': liveConfig, 'live-selector': liveSelector } },
      fixtures: { 'live-config': liveConfig, 'live-selector': liveSelector },
    },
  }
}

/** Build a flat retained report/process receipt for validator-only tests. */
async function retainedFixture() {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-adapter-'))
  const attemptDirectory = path.join(temporaryRoot, 'attempt')
  await mkdir(attemptDirectory, { recursive: true })
  const reportBytes = Buffer.from(`${JSON.stringify(liveReport(), null, 2)}\n`, 'utf8')
  const process = {
    schema: 'sartracker-live-process-v1',
    exitCode: 0,
    signal: null,
    timedOut: false,
    processError: null,
    zeroDescendantsAfterRun: true,
    ownedPidsAfterExit: [],
    outputOverflowed: false,
    stdoutBytes: 0,
    stderrBytes: 0,
    runtimeIdentityObserved: true,
    runtimeObservations: [{
      pid: 123,
      startTicks: '456',
      artifactSha256: artifactSha,
      executableSha256: '1'.repeat(64),
      asarSha256: '2'.repeat(64),
      mainProcess: true,
      descendantOfRunner: true,
    }],
  }
  const processBytes = Buffer.from(`${JSON.stringify(process, null, 2)}\n`, 'utf8')
  await writeFile(path.join(attemptDirectory, 'live-report.json'), reportBytes, { flag: 'wx' })
  await writeFile(path.join(attemptDirectory, 'live-process.json'), processBytes, { flag: 'wx' })
  return {
    attemptDirectory,
    definition: normalized(),
    receipt: {
      schema: 'sartracker-live-receipt-v1',
      status: 'PASS',
      observed: {
        reportPath: path.join(attemptDirectory, 'live-report.json'),
        processPath: path.join(attemptDirectory, 'live-process.json'),
        reportSha256: sha256(reportBytes),
        process,
        validation: { status: 'PASS' },
      },
      evidence: ['live-report.json', 'live-process.json'],
      reportPath: path.join(attemptDirectory, 'live-report.json'),
      processPath: path.join(attemptDirectory, 'live-process.json'),
      releaseEligible: false,
    },
  }
}

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('packaged live GET-only adapter', () => {
  it('requires the immutable GET-only permission and rejects an unbound execution', async () => {
    await expect(executeLiveVariant({
      normalized: normalized(),
      binding: { ...binding, liveAccess: undefined },
      attemptDirectory: '/owned/attempt',
      workDirectory: '/owned/work',
    })).rejects.toThrow(/GET_ONLY|permission|live/iu)
  })

  it('revalidates the allowlisted report, process cleanup and exact candidate identity', async () => {
    const fixture = await retainedFixture()
    const result = await validateRetainedLive(fixture.receipt, binding, {
      definition: fixture.definition,
      attemptDirectory: fixture.attemptDirectory,
    })
    expect(result.status).toBe('PASS')
    expect(result.validation.passed).toBe(true)
    expect(result.validation.proofMode).toBe('packaged-live-get-only')
    expect(result.releaseEligible).toBe(false)
  })

  it('recomputes raw live facts instead of trusting the producer verdict', async () => {
    const fixture = await retainedFixture()
    const reportPath = path.join(fixture.attemptDirectory, 'live-report.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    report.oracleInputs.fixStages.sqlite.hmacSha256 = '1'.repeat(64)
    await writeFile(reportPath, `${JSON.stringify(report)}\n`)
    const result = await validateRetainedLive(fixture.receipt, binding, {
      definition: fixture.definition,
      attemptDirectory: fixture.attemptDirectory,
    })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.validation.failureReasons.join(' ')).toMatch(/live|stage|evidence/iu)
  })

  it('requires an independently observed exact package runtime', async () => {
    const fixture = await retainedFixture()
    const processPath = path.join(fixture.attemptDirectory, 'live-process.json')
    const process = JSON.parse(await readFile(processPath, 'utf8'))
    process.runtimeIdentityObserved = false
    await writeFile(processPath, `${JSON.stringify(process)}\n`)
    const result = await validateRetainedLive(fixture.receipt, binding, {
      definition: fixture.definition,
      attemptDirectory: fixture.attemptDirectory,
    })
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.validation.failureReasons.join(' ')).toMatch(/runtime/iu)
  })

  it('rejects private paths or reports that claim mutable live access', async () => {
    const fixture = await retainedFixture()
    await expect(validateRetainedLive({ ...fixture.receipt, reportPath: '../private/live-report.json' }, binding, {
      definition: fixture.definition,
      attemptDirectory: fixture.attemptDirectory,
    })).rejects.toThrow(/inside|attempt|path/iu)
    const reportPath = path.join(fixture.attemptDirectory, 'live-report.json')
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    report.safety.providerGetOnly = false
    await writeFile(reportPath, `${JSON.stringify(report)}\n`)
    const result = await validateRetainedLive(fixture.receipt, binding, {
      definition: fixture.definition,
      attemptDirectory: fixture.attemptDirectory,
    })
    expect(result.status).toBe('INVALID_EVIDENCE')
  })
})
