// @vitest-environment node
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

type JsonObject = Record<string, unknown>

const require = createRequire(import.meta.url)
const { validateLegacyRecoveryReport } = require('../../build/legacy-recovery-report-validation.js') as {
  validateLegacyRecoveryReport(
    report: unknown,
    options?: { readonly expectedSourceSha?: string; readonly projectRoot?: string },
  ): readonly string[]
}

const projectRoot = path.resolve('.')
const expectedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim()
const expectedSourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {
  cwd: projectRoot,
  encoding: 'utf8',
}).trim()
const reportFixturePath = 'docs/evidence/legacy-object-recovery/claude-remediation/native-final-report.json'

/** Reads the retained native report into a synthetic current-source fixture. */
function syntheticReport(): JsonObject {
  const report = JSON.parse(readFileSync(reportFixturePath, 'utf8')) as JsonObject
  report.sourceHead = expectedSourceSha
  report.sourceTree = expectedSourceTree
  report.sourceDirty = false
  report.proofTier = 'diagnostic-only second disposable mission store using packaged production store/runner via an injected factory; no default app wiring or operator-load qualification'
  report.probeSource = {
    scriptSha256: sha256File('scripts/electron-legacy-object-recovery-smoke.mjs'),
    mainTimerSha256: sha256File('build/main-event-loop-probe.js'),
    custodyOracleSha256: sha256File('build/electron-legacy-object-recovery-custody.js'),
  }
  const firstLaunch = objectAt(report, 'firstLaunch')
  const packagedFiles = objectAt(objectAt(report, 'packaged'), 'files')
  for (const relativePath of Object.keys(packagedFiles)) {
    const hash = sha256File(relativePath)
    packagedFiles[relativePath] = { checkoutSha256: hash, packagedSha256: hash }
  }
  const checkpointPath = 'electron/legacy-evidence-backfill-checkpoint.cjs'
  const checkpointHash = sha256File(checkpointPath)
  packagedFiles[checkpointPath] = { checkoutSha256: checkpointHash, packagedSha256: checkpointHash }
  const restart = objectAt(report, 'restart')
  restart.openTimer = structuredClone(objectAt(firstLaunch, 'mainTimer'))
  return report
}

/** Returns a mutable nested object for one test mutation. */
function objectAt(parent: JsonObject, key: string): JsonObject {
  const value = parent[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Fixture field ${key} is not an object.`)
  }
  return value as JsonObject
}

/** Computes the source hash that the CI validator must independently reproduce. */
function sha256File(relativePath: string): string {
  return createHash('sha256').update(readFileSync(path.join(projectRoot, relativePath))).digest('hex')
}

describe('legacy recovery terminal report validation [DON-254]', () => {
  it('accepts the retained complete report after binding it to current source', () => {
    expect(validateLegacyRecoveryReport(syntheticReport(), {
      expectedSourceSha,
      projectRoot,
    })).toEqual([])
  })

  it.each([
    ['failed report', (report: JsonObject) => { report.passed = false }],
    ['missing proof tier', (report: JsonObject) => { delete report.proofTier }],
    ['overstated proof tier', (report: JsonObject) => { report.proofTier = 'production operator-load qualified' }],
    ['wrong expected head', (report: JsonObject) => { report.sourceHead = '0'.repeat(40) }],
    ['wrong source tree', (report: JsonObject) => { report.sourceTree = '0'.repeat(40) }],
    ['dirty source', (report: JsonObject) => { report.sourceDirty = true }],
    ['missing worker completion', (report: JsonObject) => { objectAt(report, 'firstLaunch').workerCompletion = [] }],
    ['worker on caller thread', (report: JsonObject) => { objectAt(report, 'firstLaunch').workerCompletion = [{ workerThreadId: objectAt(report, 'firstLaunch').parentThreadId }] }],
    ['stopped worker', (report: JsonObject) => { (objectAt(report, 'firstLaunch').workerCompletion as JsonObject[])[0]!.stopped = true }],
    ['wrong observer realm', (report: JsonObject) => { objectAt(objectAt(report, 'firstLaunch'), 'observer').observerRealm = 'main-process' }],
    ['missing restart open timer', (report: JsonObject) => { delete objectAt(report, 'restart').openTimer }],
    ['missing post-settlement custody', (report: JsonObject) => { delete objectAt(report, 'restart').postSettlementCustody }],
    ['cleanup failure', (report: JsonObject) => { report.cleanupFailures = ['close failed'] }],
  ])('rejects %s', (_label, mutate) => {
    const report = syntheticReport()
    mutate(report)
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })).not.toEqual([])
  })

  it.each([
    'scriptSha256',
    'mainTimerSha256',
    'custodyOracleSha256',
  ])('rejects a mismatched %s', (key) => {
    const report = syntheticReport()
    objectAt(report, 'probeSource')[key] = '0'.repeat(64)
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })).toEqual([
      expect.stringMatching(new RegExp(key)),
    ])
  })

  it.each([
    ['baseline count', (rows: JsonObject) => { rows.markerCount = 49_999 }],
    ['baseline digest', (rows: JsonObject) => { rows.baselineDigest = '0'.repeat(64) }],
    ['marker digest', (rows: JsonObject) => { rows.markerDigest = '0'.repeat(64) }],
    ['missing custody rows', (rows: JsonObject) => { rows.missingCustody = 1 }],
    ['duplicate custody rows', (rows: JsonObject) => { rows.duplicateObjects = 1 }],
  ])('rejects a changed first-launch %s', (_label, mutate) => {
    const report = syntheticReport()
    mutate(objectAt(report, 'firstLaunch').rows as JsonObject)
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })).not.toEqual([])
  })

  it.each([
    ['first main timer threshold', (report: JsonObject) => { objectAt(objectAt(report, 'firstLaunch'), 'mainTimer').maximumGapMs = 200 }],
    ['restart open timer samples', (report: JsonObject) => { objectAt(objectAt(report, 'restart'), 'openTimer').samples = 0 }],
    ['restart open timing threshold', (report: JsonObject) => { objectAt(objectAt(report, 'restart'), 'openTimer').maximumGapMs = 200 }],
    ['restart mutation timer threshold', (report: JsonObject) => { objectAt(objectAt(objectAt(report, 'restart'), 'postSettlementMutation'), 'timer').maximumGapMs = 200 }],
    ['restart open call threshold', (report: JsonObject) => { objectAt(report, 'restart').openMs = 200 }],
  ])('rejects %s', (_label, mutate) => {
    const report = syntheticReport()
    mutate(report)
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })).not.toEqual([])
  })

  it('rejects an incomplete post-settlement mutation or nonzero close', () => {
    const report = syntheticReport()
    const restart = objectAt(report, 'restart')
    const mutation = objectAt(restart, 'postSettlementMutation')
    const custody = objectAt(restart, 'postSettlementCustody')
    custody.markerId = 'different-marker'
    objectAt(objectAt(report, 'firstLaunch'), 'appClose').code = 1
    mutation.markerId = ''
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot })).not.toEqual([])
  })

  it('rejects a missing report and an expected source SHA mismatch', () => {
    expect(validateLegacyRecoveryReport(undefined, { expectedSourceSha, projectRoot })).not.toEqual([])
    expect(validateLegacyRecoveryReport(syntheticReport(), {
      expectedSourceSha: '0'.repeat(40),
      projectRoot,
    })).toEqual([expect.stringMatching(/EXPECTED_SOURCE_SHA|checkout HEAD/i)])
  })

  it('rejects a packaged production file differing from the checkout', () => {
    const report = syntheticReport()
    const files = objectAt(objectAt(report, 'packaged'), 'files')
    objectAt(files, 'electron/mission-store.cjs').packagedSha256 = '0'.repeat(64)
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot }))
      .toEqual([expect.stringMatching(/Packaged source differs from checkout for electron\/mission-store.cjs/iu)])
  })

  it('rejects a report that does not bind the checkpoint implementation', () => {
    const report = syntheticReport()
    delete objectAt(objectAt(report, 'packaged'), 'files')['electron/legacy-evidence-backfill-checkpoint.cjs']
    expect(validateLegacyRecoveryReport(report, { expectedSourceSha, projectRoot }))
      .toEqual([expect.stringMatching(/missing for electron\/legacy-evidence-backfill-checkpoint\.cjs/iu)])
  })
})
