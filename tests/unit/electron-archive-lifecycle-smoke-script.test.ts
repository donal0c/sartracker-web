import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const runnerPath = path.resolve('scripts/electron-archive-lifecycle-smoke.mjs')

describe('packaged archive-lifecycle process-faithful liveness runner [DON-252 / BCP-15]', () => {
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

    expect(reviewStart).toBeGreaterThan(0)
    expect(reviewEnd).toBeGreaterThan(reviewStart)
    expect(reviewFlow).toContain("await livenessProbe.setPhase('restore')")
    expect(reviewFlow).toContain("beginPhaseOperation('restore')")
    expect(reviewFlow).toContain('), secondReviewOperation)')
    expect(reviewFlow).toContain('completePhaseOperation(secondReviewOperation)')
  })
})
