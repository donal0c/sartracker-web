import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
  analyzeBreadcrumbCheckpointProgress,
  analyzeBreadcrumbRequestCoverage,
  analyzeTransientHistoryRetries,
  buildBreadcrumb36HourProofVerdict,
  buildBreadcrumb36HourRenderedOracle,
  buildBreadcrumbRestartProofVerdict,
  createPersistedBreadcrumbEvidence,
  createRenderedBreadcrumbEvidence,
  verifyBreadcrumbRuntimeConfiguration,
  parseBreadcrumb36HourProofArgs,
  summarizeBreadcrumbRequestLedger,
} from '../../build/electron-breadcrumb-36h-proof-lib.js'
import {
  buildBreadcrumb36HourTruthEvidence,
  createBreadcrumb36HourProfile,
  createBreadcrumb36HourSourceDatabase,
} from '../../build/breadcrumb-36h-mock-traccar.js'
import { createBreadcrumbAccumulator } from '../../src/features/tracking/breadcrumb-accumulator'

const require = createRequire(import.meta.url)
const { listBreadcrumbPositions } = require('../../electron/breadcrumb-query.cjs') as {
  readonly listBreadcrumbPositions: (
    database: ReturnType<typeof createBreadcrumb36HourSourceDatabase>,
    missionId: string,
    perDeviceLimit: number,
  ) => {
    readonly positions: readonly PersistedSelectorPosition[]
    readonly deviceTotals: readonly { readonly device_id: string; readonly total: number }[]
    readonly deviceSelections: readonly {
      readonly device_id: string
      readonly geometryErrorBoundMetres: number | null
      readonly timeBucketWidthMs: number | null
      readonly spatialBucketWidthDegrees: number | null
      readonly targetGeometryErrorSatisfied: boolean
    }[]
  }
}

type PersistedSelectorPosition = {
  readonly source_position_id: string
  readonly device_id: string
  readonly lat: number
  readonly lon: number
  readonly timestamp: string
  readonly data_origin: 'live'
}

describe('packaged Electron 36-hour breadcrumb proof helpers', () => {
  it('parses an explicit packaged-proof command line with the field-scale deadline', () => {
    expect(
      parseBreadcrumb36HourProofArgs([
        '--app',
        '/tmp/SAR.AppImage',
        '--evidence',
        '/tmp/evidence',
        '--latency-ms',
        '25',
        '--',
        '--ozone-platform=x11',
      ]),
    ).toEqual({
      appPath: '/tmp/SAR.AppImage',
      evidenceDir: '/tmp/evidence',
      normalPollIntervalMs: 30_000,
      reconciliationTimeoutMs: 60_000,
      persistenceTimeoutMs: 120_000,
      latencyMs: 25,
      extraArgs: ['--ozone-platform=x11'],
    })
  })

  it('uses enough default mock latency to make the mid-backfill kill deterministic', () => {
    expect(parseBreadcrumb36HourProofArgs([
      '--app',
      '/tmp/SAR.AppImage',
    ]).latencyMs).toBe(20)
  })

  it('proves per-device interval coverage and reports exact gaps', () => {
    const ledger = [
      historyEntry(1, '2026-08-08T00:00:00.000Z', '2026-08-08T02:00:00.000Z'),
      historyEntry(1, '2026-08-08T02:00:00.000Z', '2026-08-08T04:00:00.000Z'),
      historyEntry(2, '2026-08-08T00:00:00.000Z', '2026-08-08T01:00:00.000Z'),
      historyEntry(2, '2026-08-08T02:00:00.000Z', '2026-08-08T04:00:00.000Z'),
    ]

    const coverage = analyzeBreadcrumbRequestCoverage({
      requestLedger: ledger,
      deviceIds: [1, 2],
      requiredFrom: '2026-08-08T00:00:00.000Z',
      requiredTo: '2026-08-08T04:00:00.000Z',
    })

    expect(coverage.complete).toBe(false)
    expect(coverage.completeDeviceCount).toBe(1)
    expect(coverage.incompleteDeviceIds).toEqual([2])
    expect(coverage.devices[1]).toMatchObject({
      deviceId: 2,
      requestCount: 2,
      gaps: [
        {
          from: '2026-08-08T01:00:00.000Z',
          to: '2026-08-08T02:00:00.000Z',
        },
      ],
    })
  })

  it('builds compatible exact persisted and rendered evidence', () => {
    const persisted = createPersistedBreadcrumbEvidence([
      {
        source_position_id: '2000000',
        device_id: '2',
        timestamp: '2026-08-08T00:00:00.000Z',
        lat: 52.2,
        lon: -9.2,
      },
      {
        source_position_id: '1000000',
        device_id: '1',
        timestamp: '2026-08-08T00:00:00.000Z',
        lat: 52.1,
        lon: -9.1,
      },
    ])
    const rendered = createRenderedBreadcrumbEvidence({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { featureKind: 'breadcrumbLine', deviceId: '2' },
          geometry: { type: 'LineString', coordinates: [[-9.2, 52.2], [-9.21, 52.21]] },
        },
        {
          type: 'Feature',
          properties: { featureKind: 'device', deviceId: '1' },
          geometry: { type: 'Point', coordinates: [-9.1, 52.1] },
        },
        {
          type: 'Feature',
          properties: { featureKind: 'breadcrumbLine', deviceId: '1' },
          geometry: { type: 'LineString', coordinates: [[-9.1, 52.1], [-9.11, 52.11]] },
        },
      ],
    })

    expect(persisted).toMatchObject({
      rowCount: 2,
      missingSourceIdentityRows: 0,
      deviceCounts: { '1': 1, '2': 1 },
    })
    expect(persisted.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(rendered).toMatchObject({
      featureCount: 2,
      coordinateCount: 4,
      deviceCount: 2,
      deviceCoordinateCounts: { '1': 2, '2': 2 },
      sourceIdentityExposed: false,
    })
    expect(rendered.coordinateSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(rendered.deviceCoordinateSha256).toEqual({
      '1': expect.stringMatching(/^[a-f0-9]{64}$/u),
      '2': expect.stringMatching(/^[a-f0-9]{64}$/u),
    })
  })

  it('derives the canonical bounded render oracle with the production CJS selector', () => {
    const profile = createBreadcrumb36HourProfile()
    const window = {
      from: profile.sourceFrom,
      to: '2026-08-08T08:00:00.000Z',
    }
    const first = buildBreadcrumb36HourRenderedOracle(profile, window)
    const second = buildBreadcrumb36HourRenderedOracle(profile, window)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      selector: 'electron/breadcrumb-query.cjs#listBreadcrumbPositions',
      perDeviceLimit: 5_000,
      droppedPositionCount: 0,
      sourceDeviceCount: 32,
      rendered: {
        featureCount: 32,
        deviceCount: 32,
      },
    })
    expect(first.retainedIdentityCount).toBe(first.rendered.coordinateCount)
    expect(first.retainedIdentitySha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(first.devices.find((device) => device.deviceId === '1')).toMatchObject({
      sourcePositionCount: 5_761,
      retainedPositionCount: expect.any(Number),
      targetGeometryErrorSatisfied: true,
    })
    expect(first.devices.find((device) => device.deviceId === '1')?.retainedPositionCount)
      .toBeLessThanOrEqual(5_000)
    expect(first.devices.every((device) =>
      device.geometryErrorBoundMetres !== null &&
      device.geometryErrorBoundMetres <= 25
    )).toBe(true)
  })

  it('uses the exact mission-owned window when mission creation excludes first fixes', () => {
    const profile = createBreadcrumb36HourProfile()
    const missionWindow = {
      from: '2026-08-08T00:00:01.000Z',
      to: profile.sourceNow,
    }
    const sourceTruth = buildBreadcrumb36HourTruthEvidence(profile, missionWindow)
    const oracle = buildBreadcrumb36HourRenderedOracle(profile, missionWindow)

    expect(sourceTruth.totalPositionCount).toBe(279_936)
    expect(oracle).toMatchObject({
      from: missionWindow.from,
      to: missionWindow.to,
      sourcePositionCount: 279_936,
      retainedIdentityCount: 104_268,
      rendered: {
        coordinateCount: 104_268,
        coordinateSha256: '5ff9f1586b3775525a37fb61758425a08071ac6eadc7c5a434c558f045d7d242',
      },
    })
    expect(oracle.sourcePositionCount).toBe(sourceTruth.totalPositionCount)
    expect(oracle.devices.find((device) => device.deviceId === '1')?.firstSourcePositionId)
      .toBe('1000001')
    expect(oracle.devices.find((device) => device.deviceId === '9')?.firstSourcePositionId)
      .toBe('9000001')
    expect(oracle.devices.find((device) => device.deviceId === '25')?.firstSourcePositionId)
      .toBe('25000001')
  }, 15_000)

  it('matches the dynamic packaged window against the independent TypeScript accumulator', () => {
    const profile = createBreadcrumb36HourProfile({
      sourceNow: '2026-08-09T21:40:03.038Z',
    })
    const missionWindow = {
      from: '2026-08-08T09:40:05.235Z',
      to: profile.sourceNow,
    }
    const sourceDatabase = createBreadcrumb36HourSourceDatabase(profile, missionWindow)
    const persistedSelection = listBreadcrumbPositions(
      sourceDatabase,
      'source-truth',
      5_000,
    )
    const rawPositions = profile.devices.flatMap((device) =>
      [...sourceDatabase.prepare(
        'SELECT * FROM positions WHERE mission_id = ? AND device_id = ?',
      ).iterate('source-truth', String(device.id))].map(toNormalizedPosition),
    )
    const independent = createBreadcrumbAccumulator().append(rawPositions)
    const independentIds = independent.positions.map((position) => position.id)
    const persistedIds = persistedSelection.positions.map(
      (position) => position.source_position_id,
    )

    expect(rawPositions).toHaveLength(279_936)
    expect(independentIds).toEqual(persistedIds)
    expect(independent.positions).toHaveLength(104_270)
    expect(independent.metadata.deviceBudgets.every((budget) =>
      budget.geometryErrorBoundMetres !== null &&
      budget.geometryErrorBoundMetres <= 25 &&
      budget.targetGeometryErrorSatisfied
    )).toBe(true)

    const totalsByDevice = Object.fromEntries(
      persistedSelection.deviceTotals.map((entry) => [entry.device_id, entry.total]),
    )
    const metadataByDevice = Object.fromEntries(
      persistedSelection.deviceSelections.map((entry) => [entry.device_id, {
        geometryErrorBoundMetres: entry.geometryErrorBoundMetres,
        targetGeometryErrorSatisfied: entry.targetGeometryErrorSatisfied,
        timeBucketWidthMs: entry.timeBucketWidthMs,
        spatialBucketWidthDegrees: entry.spatialBucketWidthDegrees,
      }]),
    )
    const restarted = createBreadcrumbAccumulator().reset(
      persistedSelection.positions.map(toNormalizedPosition),
      totalsByDevice,
      metadataByDevice,
    )
    expect(restarted.positions.map((position) => position.id)).toEqual(persistedIds)
    expect(restarted.metadata.totalObserved).toBe(279_936)
  }, 30_000)

  it('fails if reconciliation exceeds the field-scale one-minute deadline', () => {
    const valid = createValidVerdictInput()
    expect(buildBreadcrumb36HourProofVerdict(valid)).toMatchObject({
      passed: true,
      failureReasons: [],
    })

    const coupled = buildBreadcrumb36HourProofVerdict({
      ...valid,
      timings: { ...valid.timings, fullReconciliationMs: 60_001 },
    })
    expect(coupled.passed).toBe(false)
    expect(coupled.failureReasons.join('\n')).toMatch(/full reconciliation.*60000/u)
  })

  it('rejects rendered output that is stable and non-empty but differs from source truth', () => {
    const valid = createValidVerdictInput()
    const wrong = buildBreadcrumb36HourProofVerdict({
      ...valid,
      rendered: {
        ...valid.rendered,
        coordinateSha256: 'c'.repeat(64),
        deviceCoordinateSha256: { '1': 'c'.repeat(64) },
      },
    })

    expect(wrong.passed).toBe(false)
    expect(wrong.failureReasons.join('\n')).toMatch(/rendered.*oracle|coordinate digest/u)
  })

  it('separates global traffic from the strict history-worker concurrency bound', () => {
    const valid = createValidVerdictInput()
    expect(buildBreadcrumb36HourProofVerdict({
      ...valid,
      requestEvidence: {
        ...valid.requestEvidence,
        maximumConcurrentRequests: 40,
        maximumConcurrentHistoryRequests: 8,
      },
    }).passed).toBe(true)

    const unboundedHistory = buildBreadcrumb36HourProofVerdict({
      ...valid,
      requestEvidence: {
        ...valid.requestEvidence,
        maximumConcurrentRequests: 40,
        maximumConcurrentHistoryRequests: 9,
      },
    })
    expect(unboundedHistory.failureReasons.join('\n')).toMatch(/history request concurrency/u)
  })

  it('verifies the seeded settings through the packaged runtime bridge without exposing the secret', () => {
    expect(verifyBreadcrumbRuntimeConfiguration({
      runtime: {
        trackingPollIntervalMs: 30_000,
        trackingConfig: {
          baseUrl: 'http://127.0.0.1:43123',
          email: 'breadcrumb-proof@example.invalid',
          password: 'synthetic-breadcrumb-proof-secret',
        },
      },
      expectedBaseUrl: 'http://127.0.0.1:43123',
      expectedPollIntervalMs: 30_000,
      expectedEmail: 'breadcrumb-proof@example.invalid',
      expectedSecret: 'synthetic-breadcrumb-proof-secret',
    })).toEqual({
      trackingConfigured: true,
      trackingPollIntervalMs: 30_000,
      baseUrl: 'http://127.0.0.1:43123',
      authMode: 'basic',
      email: 'breadcrumb-proof@example.invalid',
      secretPresent: true,
    })

    expect(() => verifyBreadcrumbRuntimeConfiguration({
      runtime: {
        trackingPollIntervalMs: 5_000,
        trackingConfig: null,
      },
      expectedBaseUrl: 'http://127.0.0.1:43123',
      expectedPollIntervalMs: 30_000,
      expectedEmail: 'breadcrumb-proof@example.invalid',
      expectedSecret: 'synthetic-breadcrumb-proof-secret',
    })).toThrow(/runtime poll interval/u)
  })

  it('matches a deterministic failed history window to its later successful retry', () => {
    const evidence = analyzeTransientHistoryRetries([
      {
        sequence: 1,
        kind: 'history',
        deviceId: 1,
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-08T02:00:00.000Z',
        outcome: 'failure',
        httpStatus: 503,
      },
      {
        sequence: 2,
        kind: 'history',
        deviceId: 2,
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-08T02:00:00.000Z',
        outcome: 'success',
        httpStatus: 200,
      },
      {
        sequence: 3,
        kind: 'history',
        deviceId: 1,
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-08T02:00:00.000Z',
        outcome: 'success',
        httpStatus: 200,
      },
    ])

    expect(evidence).toEqual({
      failedRequestCount: 1,
      retriedFailureCount: 1,
      allFailuresRetried: true,
      failures: [{
        failedSequence: 1,
        retrySequence: 3,
        deviceId: 1,
        from: '2026-08-08T00:00:00.000Z',
        to: '2026-08-08T02:00:00.000Z',
        failedHttpStatus: 503,
      }],
    })
  })

  it('summarizes request latency, throughput, and scheduler gaps without hiding failures', () => {
    const summary = summarizeBreadcrumbRequestLedger([
      {
        sequence: 1,
        kind: 'history',
        startedAtMs: 1_000,
        completedAtMs: 1_025,
        durationMs: 25,
        outcome: 'success',
        httpStatus: 200,
        returnedCount: 1_440,
      },
      {
        sequence: 2,
        kind: 'history',
        startedAtMs: 1_010,
        completedAtMs: 1_040,
        durationMs: 30,
        outcome: 'failure',
        httpStatus: 503,
        returnedCount: 0,
      },
      {
        sequence: 3,
        kind: 'history',
        startedAtMs: 6_100,
        completedAtMs: 6_120,
        durationMs: 20,
        outcome: 'success',
        httpStatus: 200,
        returnedCount: 240,
      },
      {
        sequence: 4,
        kind: 'devices',
        startedAtMs: 6_120,
        completedAtMs: 6_140,
        durationMs: 20,
        outcome: 'success',
        httpStatus: 200,
        returnedCount: 0,
      },
    ], { bucketMs: 5_000 })

    expect(summary).toMatchObject({
      requestCount: 4,
      successfulRequestCount: 3,
      failedRequestCount: 1,
      elapsedMs: 5_140,
      byKind: {
        history: {
          requestCount: 3,
          successfulRequestCount: 2,
          failedRequestCount: 1,
          returnedPositionCount: 1_680,
          latencyMs: { min: 20, p50: 25, p95: 30, max: 30 },
          requestStartGapMs: { min: 10, p50: 2_550, p95: 5_090, max: 5_090 },
        },
      },
      historyStartBuckets: [
        { offsetFromFirstHistoryStartMs: 0, requestCount: 2 },
        { offsetFromFirstHistoryStartMs: 5_000, requestCount: 1 },
      ],
    })
  })

  it('reports durable checkpoint coverage and remaining hours per device', () => {
    const progress = analyzeBreadcrumbCheckpointProgress({
      checkpoints: [
        {
          mission_id: 'mission-1',
          device_id: '1',
          history_from: '2026-08-08T00:00:00.000Z',
          reconciled_until: '2026-08-08T04:00:00.000Z',
          updated_at: '2026-08-08T04:00:01.000Z',
        },
        {
          mission_id: 'mission-1',
          device_id: '2',
          history_from: '2026-08-08T00:00:00.000Z',
          reconciled_until: '2026-08-08T06:00:00.000Z',
          updated_at: '2026-08-08T06:00:01.000Z',
        },
      ],
      deviceIds: [1, 2, 3],
      requiredFrom: '2026-08-08T00:00:00.000Z',
      requiredTo: '2026-08-08T06:00:00.000Z',
    })

    expect(progress).toMatchObject({
      requiredDeviceCount: 3,
      checkpointedDeviceCount: 2,
      completedDeviceCount: 1,
      remainingDeviceCount: 2,
      totalCoveredMs: 10 * 60 * 60 * 1_000,
      totalRemainingMs: 8 * 60 * 60 * 1_000,
      devices: [
        { deviceId: 1, coveredMs: 4 * 60 * 60 * 1_000, remainingMs: 2 * 60 * 60 * 1_000, complete: false },
        { deviceId: 2, coveredMs: 6 * 60 * 60 * 1_000, remainingMs: 0, complete: true },
        { deviceId: 3, coveredMs: 0, remainingMs: 6 * 60 * 60 * 1_000, complete: false },
      ],
    })
  })

  it('fails closed unless crash recovery and the completed restart preserve exact evidence', () => {
    const valid = createValidRestartVerdictInput()
    expect(buildBreadcrumbRestartProofVerdict(valid)).toEqual({
      passed: true,
      failureReasons: [],
    })

    const corrupted = buildBreadcrumbRestartProofVerdict({
      ...valid,
      postCompletionPersisted: {
        ...valid.postCompletionPersisted,
        sha256: 'c'.repeat(64),
      },
      postCompletionRendered: {
        ...valid.postCompletionRendered,
        coordinateSha256: 'd'.repeat(64),
      },
    })
    expect(corrupted.passed).toBe(false)
    expect(corrupted.failureReasons.join('\n')).toMatch(/persisted.*digest|rendered.*digest/u)
  })
})

function historyEntry(deviceId: number, from: string, to: string) {
  return {
    kind: 'history',
    deviceId,
    from,
    to,
    outcome: 'success',
    httpStatus: 200,
  }
}

function toNormalizedPosition(position: PersistedSelectorPosition) {
  return {
    id: position.source_position_id,
    device_id: position.device_id,
    lat: position.lat,
    lon: position.lon,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    source: null,
    timestamp: position.timestamp,
    data_origin: position.data_origin,
  }
}

function createValidVerdictInput() {
  return {
    normalPollIntervalMs: 30_000,
    timings: {
      currentFixMs: 1_000,
      firstBreadcrumbMs: 2_000,
      fullReconciliationMs: 20_000,
      persistenceCompleteMs: 40_000,
    },
    coverage: {
      complete: true,
      incompleteDeviceIds: [],
    },
    requestEvidence: {
      deviceRequestCount: 1,
      maximumConcurrentRequests: 40,
      maximumConcurrentHistoryRequests: 8,
    },
    sourceTruth: {
      totalPositionCount: 100,
      sha256: 'a'.repeat(64),
    },
    persisted: {
      rowCount: 100,
      sha256: 'a'.repeat(64),
      missingSourceIdentityRows: 0,
      integrityResult: 'ok',
    },
    rendered: {
      featureCount: 32,
      coordinateCount: 50_000,
      deviceCount: 32,
      coordinateSha256: 'b'.repeat(64),
      deviceCoordinateCounts: { '1': 50_000 },
      deviceCoordinateSha256: { '1': 'b'.repeat(64) },
      stable: true,
    },
    renderedOracle: {
      droppedPositionCount: 0,
      sourcePositionCount: 100,
      sourceDeviceCount: 32,
      retainedIdentityCount: 50_000,
      rendered: {
        featureCount: 32,
        coordinateCount: 50_000,
        deviceCount: 32,
        coordinateSha256: 'b'.repeat(64),
        deviceCoordinateCounts: { '1': 50_000 },
        deviceCoordinateSha256: { '1': 'b'.repeat(64) },
      },
      devices: Array.from({ length: 32 }, (_, index) => ({
        deviceId: String(index + 1),
        geometryErrorBoundMetres: 20,
        targetGeometryErrorSatisfied: true,
      })),
    },
  }
}

function createValidRestartVerdictInput() {
  const persisted = {
    rowCount: 100,
    sha256: 'a'.repeat(64),
    missingSourceIdentityRows: 0,
    integrityResult: 'ok',
  }
  const rendered = {
    featureCount: 32,
    coordinateCount: 50_000,
    deviceCount: 32,
    coordinateSha256: 'b'.repeat(64),
    stable: true,
  }
  return {
    sourcePositionCount: 100,
    midBackfill: {
      persistedRowCount: 25,
      databaseIntegrityResult: 'ok',
      coverageComplete: false,
      processTerminated: true,
    },
    retryEvidence: {
      failedRequestCount: 1,
      retriedFailureCount: 1,
      allFailuresRetried: true,
      failures: [],
    },
    completedPersisted: persisted,
    postCompletionPersisted: { ...persisted },
    completedRendered: rendered,
    postCompletionRendered: { ...rendered },
    restoredMissionMatches: true,
    postCompletionRenderMs: 2_000,
  }
}
