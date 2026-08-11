import { describe, expect, it } from 'vitest'

import {
  auditIndependentExactSoakPage,
  createExactSoakMismatchObservation,
  createExactSoakPageEvidenceAccumulator,
  createExactSoakPageTiming,
  createExactSoakTraversalAccumulator,
  createIndependentExactSoakOracle,
  createTrackingSoakFixtureClock,
  normalizeExactSoakSourcePage,
  validateExtendedExactSoakProof,
} from '../../build/electron-tracking-soak-exact-proof-lib.js'
import { createTrackingSoakProfile } from '../../build/electron-tracking-soak-lib.js'

describe('fourteen-day packaged exact-dot soak oracle [DON-260]', () => {
  it('records one mission-scoped fixture clock for both mock and independent oracle', () => {
    const profile = createTrackingSoakProfile('extended')
    const recordedNowMs = Date.parse('2026-08-10T12:00:00.000Z')
    const clock = createTrackingSoakFixtureClock(profile, recordedNowMs)

    expect(clock.recordedNow).toBe('2026-08-10T12:00:00.000Z')
    expect(clock.baseTime).toBe('2026-08-08T13:00:00.000Z')
    expect(clock.missionOffsetHours).toBe(48)
    expect(clock.intervalMs).toBeGreaterThan(0)
    expect(clock.intervalMs).toBeLessThan(5_000)
    expect(Date.parse(clock.finalTime)).toBeLessThanOrEqual(
      recordedNowMs - 4 * 60 * 60 * 1_000,
    )
    expect(Date.parse(clock.baseTime)).toBeGreaterThan(
      recordedNowMs - 48 * 60 * 60 * 1_000,
    )
    const latestQualifiedRecentFromMs =
      recordedNowMs + clock.maximumQualifiedWallElapsedMs -
      clock.recentWindowMs
    expect(latestQualifiedRecentFromMs).toBeGreaterThan(clock.finalTimeMs)
    expect(clock.recentWindowSeparationMs).toBe(
      latestQualifiedRecentFromMs - clock.finalTimeMs,
    )
    expect(clock.recentWindowSeparationMs).toBeGreaterThanOrEqual(
      2 * 60 * 60 * 1_000,
    )
  })

  it('independently maps the full 1,935,384-fix formula into 194 bounded pages', () => {
    const profile = createTrackingSoakProfile('extended')
    const clock = createTrackingSoakFixtureClock(
      profile,
      Date.parse('2026-08-10T12:00:00.000Z'),
    )
    const oracle = createIndependentExactSoakOracle({
      ...profile,
      baseTimeMs: clock.baseTimeMs,
      intervalMs: clock.intervalMs,
      maximumBatches: profile.actualBatches,
      pageLimit: 10_000,
    })

    expect(oracle.totalFixCount).toBe(1_935_384)
    expect(oracle.pageCount).toBe(194)
    const latest = oracle.createPage(0)
    const oldest = oracle.createPage(193)
    expect(latest).toHaveLength(10_000)
    expect(oldest).toHaveLength(5_384)
    expect(oldest.slice(0, 2)).toMatchObject([
      {
        sourcePositionId: '1001000',
        deviceId: '1',
        timestamp: clock.baseTime,
      },
      {
        sourcePositionId: '10000',
        deviceId: '10',
        timestamp: clock.baseTime,
      },
    ])
    expect(oldest[0]?.lat).toBeCloseTo(52.000101, 12)
    expect(oldest[0]?.lon).toBeCloseTo(-9.000101, 12)
    expect(oldest[1]?.lat).toBeCloseTo(52.001, 12)
    expect(oldest[1]?.lon).toBeCloseTo(-9.001, 12)
    expect(latest.at(-1)).toMatchObject({
      sourcePositionId: '1344008179',
      deviceId: '8',
      timestamp: clock.finalTime,
    })
  })

  it('streams exact source pages without retaining the full trail and proves no gaps or duplicates', () => {
    const oracle = createIndependentExactSoakOracle({
      deviceCount: 3,
      movingDeviceCount: 2,
      productionPollsPerBatch: 2,
      maximumBatches: 2,
      baseTimeMs: Date.parse('2026-08-10T00:00:00.000Z'),
      intervalMs: 5_000,
      pageLimit: 4,
    })
    const accumulator = createExactSoakTraversalAccumulator(oracle)
    expect(auditIndependentExactSoakPage(oracle, 0, oracle.createPage(0))).toMatchObject({
      pageIndexFromLatest: 0,
      positionCount: 4,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
    for (let pageIndex = 0; pageIndex < oracle.pageCount; pageIndex += 1) {
      accumulator.addPage(pageIndex, oracle.createPage(pageIndex))
    }

    expect(accumulator.finish()).toMatchObject({
      passed: true,
      totalFixCount: 9,
      pageCount: 3,
      maximumPageCount: 4,
      gapCount: 0,
      duplicateCount: 0,
      exactIdentityTimeCoordinateMatch: true,
      expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      ranges: [
        { pageIndexFromLatest: 0, positionCount: 4 },
        { pageIndexFromLatest: 1, positionCount: 4 },
        { pageIndexFromLatest: 2, positionCount: 1 },
      ],
    })
  })

  it('streams compact formula-exact page evidence and keeps proof confirmation outside product timing', () => {
    const oracle = createIndependentExactSoakOracle({
      deviceCount: 3,
      movingDeviceCount: 2,
      productionPollsPerBatch: 2,
      maximumBatches: 2,
      baseTimeMs: Date.parse('2026-08-10T00:00:00.000Z'),
      intervalMs: 5_000,
      pageLimit: 4,
    })
    const accumulator = createExactSoakPageEvidenceAccumulator(oracle)
    for (let pageIndex = 0; pageIndex < oracle.pageCount; pageIndex += 1) {
      const evidence = auditIndependentExactSoakPage(
        oracle,
        pageIndex,
        oracle.createPage(pageIndex),
      )
      accumulator.addPageEvidence(pageIndex, evidence)
    }
    expect(accumulator.finish()).toMatchObject({
      passed: true,
      totalFixCount: 9,
      pageCount: 3,
      gapCount: 0,
      duplicateCount: 0,
      exactIdentityTimeCoordinateMatch: true,
      expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      observedSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    })

    const changedEvidence = auditIndependentExactSoakPage(
      oracle,
      0,
      oracle.createPage(0),
    )
    expect(() => createExactSoakPageEvidenceAccumulator(oracle)
      .addPageEvidence(0, {
        ...changedEvidence,
        sha256: '0'.repeat(64),
      })).toThrow(/formula truth/iu)
    expect(() => createExactSoakPageEvidenceAccumulator(oracle)
      .addPageEvidence(1, auditIndependentExactSoakPage(
        oracle,
        1,
        oracle.createPage(1),
      ))).toThrow(/sequence/iu)

    expect(createExactSoakPageTiming({
      pageStartedAtEpochMs: 1_000,
      sourceReadStartedAtEpochMs: 1_050,
      firstFormulaExactSampledAtEpochMs: 1_100,
      stableVerificationDurationMs: 1_500,
    })).toEqual({
      publicationDurationMs: 50,
      pageActionDurationMs: 100,
      stableVerificationDurationMs: 1_500,
      proofOverheadDurationMs: 1_450,
    })
    expect(() => createExactSoakPageTiming({
      pageStartedAtEpochMs: 1_000,
      sourceReadStartedAtEpochMs: 1_050,
      firstFormulaExactSampledAtEpochMs: 1_150,
      stableVerificationDurationMs: 50,
    })).toThrow(/timing evidence/iu)
  })

  it('fails closed on an out-of-sequence page, changed fix, or nonliteral source feature ID', () => {
    const oracle = createIndependentExactSoakOracle({
      deviceCount: 3,
      movingDeviceCount: 2,
      productionPollsPerBatch: 2,
      maximumBatches: 2,
      baseTimeMs: Date.parse('2026-08-10T00:00:00.000Z'),
      intervalMs: 5_000,
      pageLimit: 4,
    })
    expect(() => createExactSoakTraversalAccumulator(oracle).addPage(
      1,
      oracle.createPage(1),
    )).toThrow(/sequence/iu)

    const changed = oracle.createPage(0)
    changed[0] = { ...changed[0]!, lat: changed[0]!.lat + 0.000001 }
    expect(() => createExactSoakTraversalAccumulator(oracle).addPage(0, changed))
      .toThrow(/identity.*time.*coordinate/iu)

    const row = oracle.createPage(0)[0]!
    expect(() => normalizeExactSoakSourcePage({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: undefined,
        geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
        properties: {
          featureKind: 'breadcrumb',
          deviceId: row.deviceId,
          sourcePositionId: row.sourcePositionId,
          timestamp: row.timestamp,
        },
      }],
    })).toThrow(/literal feature identity/iu)
  })

  it('bounds and sanitizes exact-page publication mismatch evidence [DON-260]', () => {
    const timestamp = '2026-08-10T00:00:00.000Z'
    const collection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'device-1:id:123',
        geometry: { type: 'Point', coordinates: [-9.1, 52.1] },
        properties: {
          featureKind: 'breadcrumb',
          deviceId: 'device-1',
          sourcePositionId: '123',
          timestamp,
        },
      }],
    }
    const observation = createExactSoakMismatchObservation({
      collection,
      summaryText:
        `Showing 1 exact fixes of 2 — ${timestamp} to ${timestamp}`,
      baselineBreadcrumbPointCount: 0,
      loading: false,
      refreshing: null,
      unavailable: false,
    })

    expect(observation).toEqual({
      loading: false,
      refreshing: null,
      unavailable: false,
      baselineBreadcrumbPointCount: 0,
      source: {
        valid: true,
        positionCount: 1,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        range: {
          fromTimestamp: timestamp,
          toTimestamp: timestamp,
          firstSourcePositionId: '123',
          lastSourcePositionId: '123',
        },
      },
      operator: {
        valid: true,
        pagePositionCount: 1,
        totalPositionCount: 2,
        fromTimestamp: timestamp,
        toTimestamp: timestamp,
      },
    })

    const longIdentity = '1'.repeat(64)
    const sanitized = createExactSoakMismatchObservation({
      collection: {
        ...collection,
        features: [{
          ...collection.features[0],
          id: `device-1:id:${longIdentity}`,
          properties: {
            ...collection.features[0].properties,
            sourcePositionId: longIdentity,
          },
        }],
      },
      summaryText: '',
      baselineBreadcrumbPointCount: 0,
      loading: false,
      refreshing: null,
      unavailable: false,
    })
    expect(sanitized.source.range.firstSourcePositionId).toBeNull()
    expect(JSON.stringify(sanitized)).not.toContain(longIdentity)
  })

  it('revalidates the complete 393-observation extended release gate instead of trusting a boolean', () => {
    const profile = createTrackingSoakProfile('extended')
    const fixtureClock = createTrackingSoakFixtureClock(
      profile,
      Date.parse('2026-08-10T12:00:00.000Z'),
    )
    const pageEvidence = {
      positionCount: 10_000,
      sha256: 'a'.repeat(64),
      range: {
        positionCount: 10_000,
        fromTimestamp: '2026-08-10T00:00:00.000Z',
        toTimestamp: '2026-08-10T01:00:00.000Z',
        firstSourcePositionId: '1',
        lastSourcePositionId: '2',
      },
    }
    const rss = {
      sampleCount: 2,
      sampleIntervalMs: 250,
      maximumProcessTreeResidentBytes: 500_000_000,
    }
    const latest = (
      launchNumber: number,
      totalPositionCount = profile.expectedPositionRows,
    ) => ({
      passed: true,
      launchNumber,
      totalPositionCount,
      pageCount: Math.ceil(totalPositionCount / 10_000),
      latestPage: pageEvidence,
      baselineBreadcrumbPointCount: 0,
      exactDotQueryDurationMs: 100,
      exactDotPublicationDurationMs: 150,
      exactDotPageDurationMs: 200,
      rss: { ...rss, launchNumber },
    })
    const checkpointFixCounts = profile.restartCheckpoints.map(
      (checkpoint) =>
        checkpoint * profile.productionPollsPerBatch * profile.movingDeviceCount +
        (profile.deviceCount - profile.movingDeviceCount),
    )
    const proof = {
      required: true,
      passed: true,
      fixtureClock,
      directIpcLatestAudits: [
        {
          boundary: `checkpoint-${profile.restartCheckpoints[0]}-before-restart`,
          ...latest(1, checkpointFixCounts[0]),
        },
        {
          boundary: `checkpoint-${profile.restartCheckpoints[0]}-after-restart`,
          ...latest(2, checkpointFixCounts[0]),
        },
        {
          boundary: `checkpoint-${profile.restartCheckpoints[1]}-before-restart`,
          ...latest(2, checkpointFixCounts[1]),
        },
        {
          boundary: `checkpoint-${profile.restartCheckpoints[1]}-after-restart`,
          ...latest(3, checkpointFixCounts[1]),
        },
        { boundary: 'final-before-traversal', ...latest(3) },
        { boundary: 'final-after-traversal', ...latest(3) },
      ],
      restartAudits: profile.restartCheckpoints.map((checkpoint, index) => ({
        checkpoint,
        passed: true,
        beforeRestart: latest(index + 1, checkpointFixCounts[index]),
        afterRestart: latest(index + 2, checkpointFixCounts[index]),
      })),
      finalTraversal: {
        passed: true,
        totalFixCount: profile.expectedPositionRows,
        pageCount: 194,
        maximumPageCount: 10_000,
        gapCount: 0,
        duplicateCount: 0,
        exactIdentityTimeCoordinateMatch: true,
        expectedSha256: 'b'.repeat(64),
        observedSha256: 'b'.repeat(64),
        ranges: Array.from({ length: 194 }, (_entry, pageIndexFromLatest) => ({
          pageIndexFromLatest,
          positionCount: pageIndexFromLatest === 193 ? 5_384 : 10_000,
        })),
      },
      returnedToLatest: true,
      earlierDisabledAtOldest: true,
      laterDisabledAtLatest: true,
      baselineBreadcrumbPointCount: 0,
      explicitPageObservationCount: 393,
      directIpcQueryCount: 6,
      outwardTraversalDurationMs: 50_000,
      laterTraversalDurationMs: 100_000,
      unavailableCount: 0,
      failureCount: 0,
      unexplainedPublicationCount: 0,
      metrics: {
        exactDotDirectIpcQueryDurationMs: { count: 6, p95Ms: 500, maxMs: 1_000 },
        exactDotPublicationDurationMs: { count: 393, p95Ms: 700, maxMs: 1_200 },
        exactDotPageDurationMs: { count: 393, p95Ms: 900, maxMs: 1_500 },
        exactDotStableVerificationDurationMs: {
          count: 393,
          p95Ms: 1_100,
          maxMs: 1_800,
        },
        exactDotFingerprintDurationMs: {
          count: 393,
          p95Ms: 500,
          maxMs: 900,
        },
        exactDotProofOverheadDurationMs: {
          count: 393,
          p95Ms: 1_000,
          maxMs: 1_700,
        },
        proofWallDurationMs: 170_000,
        rssSampleIntervalMs: 250,
        rss: { ...rss, launchNumber: 3 },
      },
    }

    expect(validateExtendedExactSoakProof(proof, profile)).toEqual({
      passed: true,
      failureReasons: [],
    })
    expect(validateExtendedExactSoakProof({
      ...proof,
      passed: true,
      explicitPageObservationCount: 392,
      metrics: {
        ...proof.metrics,
        exactDotPageDurationMs: { count: 392, p95Ms: 2_001, maxMs: 5_001 },
      },
    }, profile).failureReasons.join('\n')).toMatch(/393|p95|5,000/iu)
    expect(validateExtendedExactSoakProof({
      ...proof,
      directIpcQueryCount: 5,
      metrics: {
        ...proof.metrics,
        exactDotDirectIpcQueryDurationMs: {
          count: 5,
          p95Ms: 500,
          maxMs: 1_000,
        },
      },
    }, profile).failureReasons.join('\n')).toMatch(/six|6 direct/iu)
    for (const key of [
      'exactDotStableVerificationDurationMs',
      'exactDotFingerprintDurationMs',
      'exactDotProofOverheadDurationMs',
    ]) {
      const metrics = { ...proof.metrics }
      delete metrics[key]
      expect(validateExtendedExactSoakProof({
        ...proof,
        metrics,
      }, profile).failureReasons.join('\n')).toMatch(/proof|393|evidence/iu)
    }
    expect(validateExtendedExactSoakProof({
      ...proof,
      metrics: {
        ...proof.metrics,
        exactDotStableVerificationDurationMs: {
          count: 393,
          p95Ms: 2_500,
          maxMs: 3_000,
        },
      },
    }, profile).passed).toBe(true)
    expect(validateExtendedExactSoakProof({
      ...proof,
      metrics: { ...proof.metrics, proofWallDurationMs: Number.NaN },
    }, profile).failureReasons.join('\n')).toMatch(/proof wall/iu)
    expect(validateExtendedExactSoakProof({
      ...proof,
      fixtureClock: {
        ...fixtureClock,
        finalTimeMs: fixtureClock.recordedNowMs - 60 * 60 * 1_000,
        finalTime: new Date(
          fixtureClock.recordedNowMs - 60 * 60 * 1_000,
        ).toISOString(),
      },
    }, profile).failureReasons.join('\n')).toMatch(/fixture clock|recent window/iu)
  })
})
