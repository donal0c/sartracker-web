import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

import {
  analyzeBreadcrumbCheckpointProgress,
  analyzeBreadcrumbRequestCoverage,
  analyzeTransientHistoryRetries,
  buildBreadcrumb36HourProofVerdict,
  buildBreadcrumb36HourRenderedOracle,
  buildBreadcrumb36HourVariableSpeedEvidence,
  buildBreadcrumbRestartProofVerdict,
  cleanupOwnedProcess,
  createPersistedBreadcrumbEvidence,
  createRenderedBreadcrumbEvidence,
  MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES,
  MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN,
  MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS,
  measureExactBreadcrumbDotRenderedDeviation,
  normalizeRenderedExactBreadcrumbDotFeaturesForAudit,
  verifyBreadcrumbRuntimeConfiguration,
  parseBreadcrumb36HourProofArgs,
  processExited,
  summarizeBreadcrumbRequestLedger,
} from '../../build/electron-breadcrumb-36h-proof-lib.js'
import * as breadcrumbProofModule from '../../build/electron-breadcrumb-36h-proof-lib.js'
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
        '--post-completion-restarts',
        '3',
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
      postCompletionRestartCount: 3,
      extraArgs: ['--ozone-platform=x11'],
    })
  })

  it('uses enough default mock latency to make the mid-backfill kill deterministic', () => {
    const parsed = parseBreadcrumb36HourProofArgs([
      '--app',
      '/tmp/SAR.AppImage',
    ])

    expect(parsed.latencyMs).toBe(20)
    expect(parsed.postCompletionRestartCount).toBe(3)
  })

  it('rejects an unbounded post-completion restart count', () => {
    expect(() => parseBreadcrumb36HourProofArgs([
      '--app',
      '/tmp/SAR.AppImage',
      '--post-completion-restarts',
      '11',
    ])).toThrow('--post-completion-restarts')
  })

  it('treats either an exit code or terminating signal as process completion', () => {
    expect(processExited({ exitCode: null, signalCode: null })).toBe(false)
    expect(processExited({ exitCode: 0, signalCode: null })).toBe(true)
    expect(processExited({ exitCode: null, signalCode: 'SIGKILL' })).toBe(true)
  })

  it('owns failed-launch cleanup through SIGKILL and records the terminating signal', async () => {
    const child = {
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn((signal: NodeJS.Signals) => {
        if (signal === 'SIGKILL') child.signalCode = signal
        return true
      }),
    }
    const waitForExit = vi.fn().mockResolvedValue(undefined)

    await expect(cleanupOwnedProcess(child, { waitForExit })).resolves.toEqual({
      exitCode: null,
      signalCode: 'SIGKILL',
      cleanupComplete: true,
    })
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
    expect(waitForExit).toHaveBeenCalledTimes(2)
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
    expect(first.dotRendered).toMatchObject({
      featureCount: first.retainedIdentityCount,
      coordinateCount: first.retainedIdentityCount,
      deviceCount: 32,
    })
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

  it('proves bounded exact-dot pages independently against raw persisted truth', () => {
    const profile = createBreadcrumb36HourProfile()
    const missionWindow = {
      from: '2026-08-08T00:00:01.000Z',
      to: profile.sourceNow,
    }
    const sourceTruth = buildBreadcrumb36HourTruthEvidence(profile, missionWindow)
    const buildExactBreadcrumbDotPageOracle = (
      breadcrumbProofModule as typeof breadcrumbProofModule & {
        readonly buildBreadcrumb36HourExactDotPageOracle?: (
          proofProfile: ReturnType<typeof createBreadcrumb36HourProfile>,
          window: { readonly from: string; readonly to: string },
          options: { readonly pageLimit: number },
        ) => {
          readonly pageLimit: number
          readonly totalPositionCount: number
          readonly pageCount: number
          readonly activePage: {
            readonly pagePositionCount: number
            readonly renderedFeatureCount: number
          }
          readonly pageUnion: {
            readonly rawPositionCount: number
            readonly renderedPositionCount: number
            readonly rawSourceTruthSha256: string
            readonly renderedSourceTruthSha256: string
          }
          readonly pages: readonly {
            readonly raw: { readonly positionCount: number; readonly sha256: string }
            readonly rendered: {
              readonly featureCount: number
              readonly coordinateCount: number
              readonly sourceTruthSha256: string
            }
          }[]
        }
      }
    ).buildBreadcrumb36HourExactDotPageOracle
    expect(buildExactBreadcrumbDotPageOracle).toBeTypeOf('function')
    if (buildExactBreadcrumbDotPageOracle === undefined) {
      throw new Error('The packaged proof requires an independent exact-dot page oracle.')
    }
    const oracle = buildExactBreadcrumbDotPageOracle(
      profile,
      missionWindow,
      { pageLimit: 10_000 },
    )

    expect(sourceTruth.totalPositionCount).toBe(279_936)
    expect(oracle).toMatchObject({
      pageLimit: 10_000,
      totalPositionCount: sourceTruth.totalPositionCount,
      pageCount: 28,
      activePage: {
        pagePositionCount: 10_000,
        renderedFeatureCount: 10_000,
      },
      pageUnion: {
        rawPositionCount: sourceTruth.totalPositionCount,
        renderedPositionCount: sourceTruth.totalPositionCount,
      },
    })
    expect(oracle.pageUnion.rawSourceTruthSha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(oracle.pageUnion.renderedSourceTruthSha256).toBe(
      oracle.pageUnion.rawSourceTruthSha256,
    )
    expect(oracle.activePage.pagePositionCount).toBeLessThanOrEqual(10_000)
    expect(oracle.pages).toHaveLength(28)
    for (const page of oracle.pages) {
      expect(page.raw.positionCount).toBeGreaterThan(0)
      expect(page.raw.positionCount).toBeLessThanOrEqual(10_000)
      expect(page.rendered).toMatchObject({
        featureCount: page.raw.positionCount,
        coordinateCount: page.raw.positionCount,
        sourceTruthSha256: page.raw.sha256,
      })
    }
  })

  it('uses the production code-unit device ordering at exact-page tie boundaries', () => {
    const profile = createBreadcrumb36HourProfile()
    const tiedWindow = {
      from: profile.sourceFrom,
      to: profile.sourceFrom,
    }
    const pageLimit = 10
    const source = createBreadcrumb36HourSourceDatabase(profile, tiedWindow)
    const deviceTotals = source.prepare(
      'SELECT device_id, COUNT(*) AS total FROM positions GROUP BY device_id',
    ).all() as readonly { readonly device_id: string }[]
    const rows = deviceTotals.flatMap((device) => [
      ...source.prepare(
        'SELECT * FROM positions WHERE mission_id = ? AND device_id = ?',
      ).iterate('source-truth', device.device_id),
    ] as PersistedSelectorPosition[])
    rows.sort((left, right) =>
      compareCodeUnits(left.timestamp, right.timestamp) ||
      compareCodeUnits(left.device_id, right.device_id) ||
      compareCodeUnits(left.source_position_id, right.source_position_id),
    )
    const expectedPage = rows.slice(-pageLimit)
    const expectedDigest = createHash('sha256')
    for (const position of expectedPage) {
      expectedDigest.update([
        position.device_id,
        position.source_position_id,
        position.timestamp,
        position.lat.toFixed(7),
        position.lon.toFixed(7),
      ].join('|') + '\n')
    }

    const oracle = buildExactDotOracle(profile, tiedWindow, pageLimit)
    expect(oracle.pages[0]).toMatchObject({
      raw: {
        positionCount: pageLimit,
        sha256: expectedDigest.digest('hex'),
      },
    })
  })

  it('uses durable source identity for same-device same-timestamp exact-page boundaries', () => {
    const profile = createBreadcrumb36HourProfile()
    const timestamp = profile.sourceFrom
    const rows = [
      createExactOracleRow(41, 'source-z', timestamp, 52.0000001),
      createExactOracleRow(42, 'source-a', timestamp, 52.0000002),
      createExactOracleRow(43, 'source-m', timestamp, 52.0000003),
    ]
    const sourceDatabase = {
      prepare: (query: string) => {
        if (query.includes('GROUP BY device_id')) {
          return { all: () => [{ device_id: '1', total: rows.length }] }
        }
        if (query.includes('device_id = ?')) {
          return { iterate: () => rows.values() }
        }
        throw new Error(`Unexpected exact-oracle query: ${query}`)
      },
    }
    const buildExactBreadcrumbDotPageOracle = (
      breadcrumbProofModule as typeof breadcrumbProofModule & {
        readonly buildBreadcrumb36HourExactDotPageOracle: (
          proofProfile: ReturnType<typeof createBreadcrumb36HourProfile>,
          window: { readonly from: string; readonly to: string },
          options: {
            readonly pageLimit: number
            readonly sourceDatabase: typeof sourceDatabase
          },
        ) => {
          readonly totalPositionCount: number
          readonly pages: readonly {
            readonly raw: { readonly positionCount: number; readonly sha256: string }
          }[]
        }
      }
    ).buildBreadcrumb36HourExactDotPageOracle
    const expectedLatest = [rows[2]!, rows[0]!]
    const expectedDigest = createHash('sha256')
    for (const row of expectedLatest) {
      expectedDigest.update([
        row.device_id,
        row.source_position_id,
        row.timestamp,
        row.lat.toFixed(7),
        row.lon.toFixed(7),
      ].join('|') + '\n')
    }

    const oracle = buildExactBreadcrumbDotPageOracle(
      profile,
      { from: timestamp, to: timestamp },
      { pageLimit: 2, sourceDatabase },
    )

    expect(oracle.totalPositionCount).toBe(3)
    expect(oracle.pages[0]).toMatchObject({
      raw: {
        positionCount: 2,
        sha256: expectedDigest.digest('hex'),
      },
    })
  })

  it('drives the packaged dot proof from the exact-page oracle and dedicated exact MapLibre source', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )

    expect(packagedProofSource).toContain('buildBreadcrumb36HourExactDotPageOracle')
    expect(packagedProofSource).toContain("getSource('tracking-breadcrumb-dots-exact')")
    expect(packagedProofSource).not.toContain(
      'expectedDots: renderedOracle.dotRendered',
    )
  })

  it('runs the 36-hour catch-up with dot mode already active', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const firstDotModeActivation = packagedProofSource.indexOf(
      "getByTestId('breadcrumb-mode-dots')",
    )
    const missionStart = packagedProofSource.indexOf(
      "getByTestId('mission-start-btn')",
    )

    expect(firstDotModeActivation).toBeGreaterThan(-1)
    expect(missionStart).toBeGreaterThan(-1)
    expect(firstDotModeActivation).toBeLessThan(missionStart)
  })

  it('reactivates and verifies exact dot mode after crash recovery before measuring milestones', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const recoveryResume = packagedProofSource.indexOf(
      "recordPhase('recoveredMissionResumed')",
    )
    const recoveryClock = packagedProofSource.indexOf(
      'const recoveryObservedFromMs = Date.now()',
    )
    const recoveryDotActivation = packagedProofSource.indexOf(
      'await activateExactBreadcrumbDotProofMode({',
      recoveryResume,
    )
    const milestoneMeasurement = packagedProofSource.indexOf(
      'const milestones = await waitForTrackingMilestones({',
      recoveryResume,
    )
    const activationStart = packagedProofSource.indexOf(
      'async function activateExactBreadcrumbDotProofMode',
    )
    const activationEnd = packagedProofSource.indexOf(
      'async function captureStableBreadcrumbDotEvidence',
      activationStart,
    )
    const activationSource = packagedProofSource.slice(activationStart, activationEnd)

    expect(recoveryClock).toBeGreaterThan(-1)
    expect(recoveryResume).toBeGreaterThan(recoveryClock)
    expect(recoveryDotActivation).toBeGreaterThan(recoveryResume)
    expect(milestoneMeasurement).toBeGreaterThan(recoveryDotActivation)
    expect(activationSource).toContain("getByTestId('breadcrumb-mode-dots')")
    expect(activationSource).toContain("getByTestId('breadcrumb-size-label')")
    expect(activationSource).toContain("getByTestId('exact-breadcrumb-dot-page-summary')")
    expect(activationSource).toContain('readExactBreadcrumbDotSourceCollection')
    expect(activationSource).toContain("selectedMode: 'dots'")
    expect(activationSource).toContain('sizeLabel: String(sizeLabelText).trim()')
    expect(activationSource).not.toContain('selectedModeLabel:')
  })

  it('proves the latest exact-dot page before the line oracle on every cold restart', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const restartLoop = packagedProofSource.indexOf(
      'restartIndex <= options.postCompletionRestartCount',
    )
    const restartResume = packagedProofSource.indexOf(
      'const postRestartMission = await resumeRecoveredMission(',
      restartLoop,
    )
    const dotsActivation = packagedProofSource.indexOf(
      'await activateExactBreadcrumbDotProofMode({',
      restartResume,
    )
    const latestDots = packagedProofSource.indexOf(
      'await captureLatestExactBreadcrumbDotEvidence({',
      dotsActivation,
    )
    const lineActivation = packagedProofSource.indexOf(
      'await activateBreadcrumbLineProofMode(launch.page)',
      latestDots,
    )
    const lineEvidence = packagedProofSource.indexOf(
      'const postCompletionRenderedEvidence = await waitForStableSerializedTrackingEvidence({',
      lineActivation,
    )

    expect(restartResume).toBeGreaterThan(restartLoop)
    expect(dotsActivation).toBeGreaterThan(restartResume)
    expect(latestDots).toBeGreaterThan(dotsActivation)
    expect(lineActivation).toBeGreaterThan(latestDots)
    expect(lineEvidence).toBeGreaterThan(lineActivation)
    expect(packagedProofSource).toContain('historyCheckpoints: finalHistoryCheckpoints')
  })

  it('measures the first breadcrumb from the exact source while catch-up is in dot mode', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const milestoneStart = packagedProofSource.indexOf(
      'async function waitForTrackingMilestones',
    )
    const milestoneEnd = packagedProofSource.indexOf(
      'async function waitForMidBackfillCheckpoint',
      milestoneStart,
    )
    const milestoneSource = packagedProofSource.slice(milestoneStart, milestoneEnd)

    expect(milestoneSource).toContain('readExactBreadcrumbDotSourceCollection')
  })

  it('captures the bounded line oracle only after line mode is active', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const firstRenderedEvidence = packagedProofSource.indexOf('const firstRendered =')
    const firstLineModeActivation = packagedProofSource.indexOf(
      "getByTestId('breadcrumb-mode-line')",
    )

    expect(firstRenderedEvidence).toBeGreaterThan(-1)
    expect(firstLineModeActivation).toBeGreaterThan(-1)
    expect(firstLineModeActivation).toBeLessThan(firstRenderedEvidence)
  })

  it('audits the live exact dot layer and captures Dots evidence before switching to Line', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const renderedLayerAudit = packagedProofSource.indexOf('queryRenderedFeatures(undefined')
    const dotsScreenshot = packagedProofSource.indexOf(
      'packaged-36-hour-exact-dots-complete.png',
    )
    const firstLineModeActivation = packagedProofSource.indexOf(
      "getByTestId('breadcrumb-mode-line')",
    )

    expect(renderedLayerAudit).toBeGreaterThan(-1)
    expect(packagedProofSource).toContain("layers: ['tracking-breadcrumbs-dots']")
    expect(dotsScreenshot).toBeGreaterThan(-1)
    expect(dotsScreenshot).toBeLessThan(firstLineModeActivation)
  })

  it('fits every exact page before the rendered-layer audit and records attributable failure evidence', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const waitStart = packagedProofSource.indexOf(
      'async function waitForStableExactBreadcrumbDotPage',
    )
    const waitEnd = packagedProofSource.indexOf(
      'async function readRenderedExactBreadcrumbDotLayerCollection',
      waitStart,
    )
    const waitSource = packagedProofSource.slice(waitStart, waitEnd)
    const sourceRead = waitSource.indexOf('readExactBreadcrumbDotSourceCollection')
    const fitPage = waitSource.indexOf('fitExactBreadcrumbDotPageForRenderedAudit')
    const renderedRead = waitSource.indexOf(
      'readRenderedExactBreadcrumbDotLayerCollection',
    )
    const failureStart = packagedProofSource.indexOf(
      'async function captureFailureRuntimeEvidence',
    )
    const failureEnd = packagedProofSource.indexOf(
      'async function closeLaunch',
      failureStart,
    )
    const failureSource = packagedProofSource.slice(failureStart, failureEnd)
    const failureReportStart = packagedProofSource.indexOf(
      "if (runError !== null && report === null)",
    )
    const failureReportEnd = packagedProofSource.indexOf(
      "await rm(userDataRoot",
      failureReportStart,
    )
    const failureReportSource = packagedProofSource.slice(
      failureReportStart,
      failureReportEnd,
    )

    expect(sourceRead).toBeGreaterThan(-1)
    expect(fitPage).toBeGreaterThan(sourceRead)
    expect(renderedRead).toBeGreaterThan(fitPage)
    expect(packagedProofSource).toContain('map.fitBounds')
    expect(packagedProofSource).toContain("map.once('render'")
    expect(packagedProofSource).not.toContain("map.once('idle'")
    expect(failureSource).toContain('exactBreadcrumbDots')
    expect(failureSource).toContain('readExactBreadcrumbDotSourceCollection')
    expect(failureSource).toContain('readRenderedExactBreadcrumbDotLayerCollection')
    expect(failureReportSource).toContain('exactDotOracle,')
  })

  it('sorts observed exact-page identities with explicit code-unit ordering', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const comparatorStart = packagedProofSource.indexOf(
      'function compareExactBreadcrumbDotEvidenceRows',
    )
    const comparatorEnd = packagedProofSource.indexOf(
      'function exactDotPageEvidenceMatches',
      comparatorStart,
    )
    const comparatorSource = packagedProofSource.slice(comparatorStart, comparatorEnd)

    expect(comparatorSource).toContain('compareProofCodeUnits')
    expect(comparatorSource).not.toContain('localeCompare')
  })

  it('derives stable rendered identities from exact properties without trusting MapLibre id transport', () => {
    const exactFeature = (
      sourcePositionId: string,
      id: string | number | undefined,
    ) => ({
      type: 'Feature' as const,
      ...(id === undefined ? {} : { id }),
      geometry: { type: 'Point' as const, coordinates: [-9.7, 52.2] },
      properties: {
        deviceId: '7',
        featureKind: 'breadcrumb',
        sourcePositionId,
        timestamp: '2026-08-10T22:00:00.000Z',
      },
    })
    const audit = normalizeRenderedExactBreadcrumbDotFeaturesForAudit([
      exactFeature('source-a', undefined),
      exactFeature('source-b', 42),
      exactFeature('source-c', '7:id:source-c'),
      exactFeature('source-a', undefined),
      {
        ...exactFeature('source-a', undefined),
        geometry: { type: 'Point' as const, coordinates: [-9.71, 52.21] },
      },
      exactFeature('source-d', 'wrong-explicit-id'),
    ])

    expect(audit).toMatchObject({
      rawFeatureCount: 6,
      derivedIdentityCount: 6,
      duplicateDerivedIdentityCount: 2,
      duplicateConflictCount: 1,
      explicitStringIdMismatchCount: 1,
      identityValidationErrorCount: 2,
      idTypeCounts: {
        undefined: 3,
        number: 1,
        string: 2,
        other: 0,
      },
    })
    expect(audit.features.map((feature) => feature.id)).toEqual([
      '7:id:source-a',
      '7:id:source-b',
      '7:id:source-c',
      '7:id:source-d',
    ])
  })

  it('joins rendered dots to source identity/time and bounds MapLibre coordinate quantization', () => {
    const source = [
      createExactRenderedAuditFeature('source-a', 52, 0, 0),
      createExactRenderedAuditFeature('source-b', 52.001, 0, 0),
    ]
    const withinBound = [
      createExactRenderedAuditFeature('source-a', 52.00004, 0.06, 0.06),
      createExactRenderedAuditFeature('source-b', 52.00105, 0.05, 0.03),
    ]
    const measured = measureExactBreadcrumbDotRenderedDeviation(source, withinBound)

    expect(MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_METRES).toBe(8)
    expect(MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_PER_AXIS).toBe(1 / 16)
    expect(MAX_RENDERED_EXACT_DOT_COORDINATE_ERROR_SCREEN_PIXELS_EUCLIDEAN).toBe(
      Math.SQRT2 / 16,
    )
    expect(measured).toMatchObject({
      passed: true,
      comparedIdentityCount: 2,
      missingIdentityCount: 0,
      unexpectedIdentityCount: 0,
      timestampConflictCount: 0,
      coordinateConflictCount: 0,
      maximumAllowedMetres: 8,
      maximumAllowedScreenPixelsPerAxis: 1 / 16,
      maximumAllowedScreenPixelsEuclidean: Math.SQRT2 / 16,
    })
    expect(measured.metres.p50).toBeGreaterThan(4)
    expect(measured.metres.max).toBeLessThan(6)
    expect(measured.screenPixels.x).toEqual({ p50: 0.05, p95: 0.05, max: 0.06 })
    expect(measured.screenPixels.y).toEqual({ p50: 0.03, p95: 0.03, max: 0.06 })
    expect(measured.screenPixels.euclidean.max).toBeCloseTo(Math.hypot(0.06, 0.06))
    expect(measured.screenPixels.euclidean.max).toBeGreaterThan(1 / 16)
    expect(measured.worstMetreIdentity).toBe('7:id:source-b')
    expect(measured.worstScreenPixelIdentity).toBe('7:id:source-a')

    const beyondBound = measureExactBreadcrumbDotRenderedDeviation(source, [
      createExactRenderedAuditFeature('source-a', 52.00009, 0.03, 0.03),
      createExactRenderedAuditFeature('source-b', 52.001, 0.063, 0),
    ])
    expect(beyondBound.passed).toBe(false)
    expect(beyondBound.metres.max).toBeGreaterThan(8)
    expect(beyondBound.screenPixels.x.max).toBeGreaterThan(1 / 16)

    const beyondYAxisBound = measureExactBreadcrumbDotRenderedDeviation(source, [
      createExactRenderedAuditFeature('source-a', 52, 0, 0.063),
      createExactRenderedAuditFeature('source-b', 52.001, 0, 0),
    ])
    expect(beyondYAxisBound.passed).toBe(false)
    expect(beyondYAxisBound.screenPixels.y.max).toBeGreaterThan(1 / 16)
  })

  it('records the operator-visible exact page count and range instead of copying oracle totals', () => {
    const packagedProofSource = readFileSync(
      'scripts/electron-breadcrumb-36h-proof.mjs',
      'utf8',
    )
    const captureStart = packagedProofSource.indexOf(
      'async function captureStableBreadcrumbDotEvidence',
    )
    const captureEnd = packagedProofSource.indexOf(
      'async function waitForStableExactBreadcrumbDotPage',
      captureStart,
    )
    const captureSource = packagedProofSource.slice(captureStart, captureEnd)

    expect(captureSource).toContain("getByTestId('exact-breadcrumb-dot-page-summary')")
    expect(captureSource).not.toContain(
      'totalPositionCount: input.exactDotOracle.totalPositionCount',
    )
    expect(captureSource).toMatch(/pagePositionCount|observedPagePositionCount/u)
    expect(captureSource).toMatch(/fromTimestamp|observedFromTimestamp/u)
    expect(captureSource).toMatch(/toTimestamp|observedToTimestamp/u)
  })

  it('does not amplify source gaps on a 120–145 km/h vehicle leg', () => {
    const profile = createBreadcrumb36HourProfile()
    const missionWindow = {
      from: '2026-08-08T00:00:01.000Z',
      to: profile.sourceNow,
    }
    const evidence = buildBreadcrumb36HourVariableSpeedEvidence(
      profile,
      missionWindow,
    )

    expect(evidence).toMatchObject({
      deviceId: '1',
      slow: {
        minimumSpeedKmh: 12,
        maximumSpeedKmh: 12,
        sourcePositionCount: 720,
      },
      fast: {
        minimumSpeedKmh: 120,
        maximumSpeedKmh: 145,
        sourcePositionCount: 720,
        omittedSourcePositionCount: 0,
      },
    })
    expect(evidence.fast.maximumSourceGapMetres).toBeGreaterThan(160)
    expect(evidence.fast.maximumSourceGapMetres).toBeLessThan(205)
    expect(evidence.fast.maximumRenderedGapInflation).toBeLessThanOrEqual(1.01)
    expect(evidence.fast.retainedPositionCount).toBe(
      evidence.fast.sourcePositionCount,
    )
  }, 15_000)

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
      retainedIdentityCount: 103_617,
      rendered: {
        coordinateCount: 103_617,
        coordinateSha256: '45864c0d357fd6d076d4eca64736ecf1bc2338b841f4bbeca88cffd3373b68f7',
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
    expect(independent.positions).toHaveLength(103_617)
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

  it('fails closed unless final history checkpoints exactly cover the mission device window', () => {
    const valid = createValidVerdictInput()
    expect(buildBreadcrumb36HourProofVerdict(valid).passed).toBe(true)

    const missingDevice = buildBreadcrumb36HourProofVerdict({
      ...valid,
      historyCheckpoints: {
        ...valid.historyCheckpoints,
        checkpoints: valid.historyCheckpoints.checkpoints.slice(0, 1),
      },
    })
    expect(missingDevice.passed).toBe(false)
    expect(missingDevice.failureReasons.join('\n')).toMatch(/checkpoint.*missing|checkpoint.*scope/iu)

    const invalidScope = buildBreadcrumb36HourProofVerdict({
      ...valid,
      historyCheckpoints: {
        ...valid.historyCheckpoints,
        checkpoints: valid.historyCheckpoints.checkpoints.map((checkpoint, index) =>
          index === 0
            ? {
                ...checkpoint,
                mission_id: 'other-mission',
                history_from: '2026-08-08T00:00:01.000Z',
                reconciled_until: '2026-08-09T11:59:59.999Z',
              }
            : checkpoint),
      },
    })
    expect(invalidScope.passed).toBe(false)
    expect(invalidScope.failureReasons.join('\n')).toMatch(/checkpoint.*invalid|checkpoint.*incomplete/iu)
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

  it('rejects a Line status lower bound above authoritative persisted source truth', () => {
    const valid = createValidVerdictInput()
    expect(buildBreadcrumb36HourProofVerdict(valid).passed).toBe(true)

    const inflatedLineTotal = buildBreadcrumb36HourProofVerdict({
      ...valid,
      rendered: {
        ...valid.rendered,
        reportedTotalObserved: valid.sourceTruth.totalPositionCount + 1,
      },
    })

    expect(inflatedLineTotal.passed).toBe(false)
    expect(inflatedLineTotal.failureReasons.join('\n')).toMatch(
      /line.*known fixes.*source truth|reported.*line.*total/iu,
    )
  })

  it('fails closed when the independent exact-dot oracle is absent', () => {
    const valid = createValidVerdictInput()
    const missingExactOracle = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle: undefined,
      renderedDots: {
        ...valid.renderedOracle.dotRendered,
        stable: true,
      },
    })

    expect(missingExactOracle.passed).toBe(false)
    expect(missingExactOracle.failureReasons.join('\n')).toMatch(
      /independent exact.*oracle|exact.*oracle.*required/iu,
    )
  })

  it('rejects missing packaged dots and any amplified high-speed source gap', () => {
    const valid = createValidVerdictInput()
    const wrong = buildBreadcrumb36HourProofVerdict({
      ...valid,
      renderedDots: {
        ...valid.renderedDots,
        coordinateSha256: 'd'.repeat(64),
      },
      variableSpeedEvidence: {
        ...valid.variableSpeedEvidence,
        fast: {
          ...valid.variableSpeedEvidence.fast,
          retainedPositionCount: 719,
          omittedSourcePositionCount: 1,
          maximumRenderedGapInflation: 2,
        },
      },
    })

    expect(wrong.passed).toBe(false)
    expect(wrong.failureReasons.join('\n')).toMatch(/dot.*oracle|high-speed/u)
  })

  it('fails closed on missing, duplicate, or changed fixes in the exact-dot page union', () => {
    const valid = createValidVerdictInput()
    const exactDotOracle = {
      pageLimit: 60,
      totalPositionCount: 100,
      pageCount: 2,
      pageUnion: {
        rawPositionCount: 100,
        rawSourceTruthSha256: 'e'.repeat(64),
      },
      pages: [
        { raw: { positionCount: 60, sha256: 'f'.repeat(64), identityTimestampSha256: '1'.repeat(64) } },
        { raw: { positionCount: 40, sha256: '0'.repeat(64), identityTimestampSha256: '2'.repeat(64) } },
      ],
    }
    const renderedDots = {
      stable: true,
      pageLimit: 60,
      totalPositionCount: 100,
      pageCount: 2,
      maximumPagePositionCount: 60,
      maximumPageObservedMs: 1_000,
      duplicateFeatureIdCount: 0,
      uniqueFeatureIdCount: 100,
      invalidFeatureCount: 0,
      returnedToLatest: true,
      returnNavigation: [{ pageIndex: 0, observedMs: 500 }],
      supportingScreenshot: 'packaged-36-hour-exact-dots-complete.png',
      pageUnion: {
        renderedPositionCount: 100,
        renderedSourceTruthSha256: 'e'.repeat(64),
      },
      pages: [
        {
          featureCount: 60,
          coordinateCount: 60,
          sourceTruthSha256: 'f'.repeat(64),
          identityTimestampSha256: '1'.repeat(64),
          invalidFeatureCount: 0,
          fromTimestamp: null,
          toTimestamp: null,
          operatorPage: {
            pagePositionCount: 60,
            totalPositionCount: 100,
            fromTimestamp: null,
            toTimestamp: null,
          },
          renderedLayer: {
            featureCount: 60,
            coordinateCount: 60,
            sourceTruthSha256: 'f'.repeat(64),
            identityTimestampSha256: '1'.repeat(64),
            invalidFeatureCount: 0,
            rawRenderedFeatureCount: 60,
            duplicateRenderedFeatureCount: 0,
            duplicateConflictCount: 0,
            coordinateDeviation: createPassingRenderedCoordinateDeviation(60),
          },
        },
        {
          featureCount: 40,
          coordinateCount: 40,
          sourceTruthSha256: '0'.repeat(64),
          identityTimestampSha256: '2'.repeat(64),
          invalidFeatureCount: 0,
          fromTimestamp: null,
          toTimestamp: null,
          operatorPage: {
            pagePositionCount: 40,
            totalPositionCount: 100,
            fromTimestamp: null,
            toTimestamp: null,
          },
          renderedLayer: {
            featureCount: 40,
            coordinateCount: 40,
            sourceTruthSha256: '0'.repeat(64),
            identityTimestampSha256: '2'.repeat(64),
            invalidFeatureCount: 0,
            rawRenderedFeatureCount: 40,
            duplicateRenderedFeatureCount: 0,
            duplicateConflictCount: 0,
            coordinateDeviation: createPassingRenderedCoordinateDeviation(40),
          },
        },
      ],
    }

    const quantizedVerdict = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots,
    })
    expect(quantizedVerdict.failureReasons).toEqual([])
    expect(quantizedVerdict.passed).toBe(true)

    const duplicate = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots: {
        ...renderedDots,
        duplicateFeatureIdCount: 1,
        uniqueFeatureIdCount: 99,
      },
    })
    expect(duplicate.passed).toBe(false)
    expect(duplicate.failureReasons.join('\n')).toMatch(/missing, duplicate, or changed/u)

    const hiddenFromRenderedLayer = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots: {
        ...renderedDots,
        pages: [
          {
            ...renderedDots.pages[0],
            renderedLayer: {
              ...renderedDots.pages[0]!.renderedLayer,
              featureCount: 59,
            },
          },
          renderedDots.pages[1],
        ],
      },
    })
    expect(hiddenFromRenderedLayer.passed).toBe(false)
    expect(hiddenFromRenderedLayer.failureReasons.join('\n')).toMatch(/exact breadcrumb-dot pages/iu)

    const conflictingRenderedTileCopy = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots: {
        ...renderedDots,
        pages: renderedDots.pages.map((page, index) => index === 0
          ? {
              ...page,
              renderedLayer: {
                ...page.renderedLayer,
                rawRenderedFeatureCount: page.featureCount + 1,
                duplicateRenderedFeatureCount: 1,
                duplicateConflictCount: 1,
              },
            }
          : page),
      },
    })
    expect(conflictingRenderedTileCopy.passed).toBe(false)
    expect(conflictingRenderedTileCopy.failureReasons.join('\n')).toMatch(/exact breadcrumb-dot pages/iu)

    const incompleteReturnNavigation = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots: {
        ...renderedDots,
        returnNavigation: [],
      },
    })
    expect(incompleteReturnNavigation.passed).toBe(false)
    expect(incompleteReturnNavigation.failureReasons.join('\n')).toMatch(/return.*navigation/iu)
  })

  it('accepts only bounded rendered tile quantization while source coordinates remain exact', () => {
    const valid = createValidVerdictInput()
    const identityDigests = ['1'.repeat(64), '2'.repeat(64)]
    const exactDotOracle = {
      ...valid.exactDotOracle,
      pages: valid.exactDotOracle.pages.map((page, index) => ({
        raw: {
          ...page.raw,
          identityTimestampSha256: identityDigests[index],
        },
      })),
    }
    const renderedDots = {
      ...valid.renderedDots,
      pages: valid.renderedDots.pages.map((page, index) => ({
        ...page,
        identityTimestampSha256: identityDigests[index],
        renderedLayer: {
          ...page.renderedLayer,
          sourceTruthSha256: 'quantized-coordinate-digest',
          identityTimestampSha256: identityDigests[index],
          coordinateDeviation: createPassingRenderedCoordinateDeviation(
            page.featureCount,
          ),
        },
      })),
    }

    const quantizedCoordinateVerdict = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots,
    })
    expect(quantizedCoordinateVerdict.failureReasons).toEqual([])
    expect(quantizedCoordinateVerdict.passed).toBe(true)

    const beyondBound = buildBreadcrumb36HourProofVerdict({
      ...valid,
      exactDotOracle,
      renderedDots: {
        ...renderedDots,
        pages: renderedDots.pages.map((page, index) => index === 0
          ? {
              ...page,
              renderedLayer: {
                ...page.renderedLayer,
                coordinateDeviation: {
                  ...page.renderedLayer.coordinateDeviation,
                  passed: false,
                  metres: {
                    ...page.renderedLayer.coordinateDeviation.metres,
                    max: 8.01,
                  },
                },
              },
            }
          : page),
      },
    })
    expect(beyondBound.passed).toBe(false)
    expect(beyondBound.failureReasons.join('\n')).toMatch(/exact breadcrumb-dot pages/iu)
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
      missionId: 'mission-1',
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

    const frozenReportShape = buildBreadcrumbRestartProofVerdict({
      ...valid,
      postCompletionExactDots: {
        ...valid.postCompletionExactDots,
        modeActivation: {
          observedMs: 597,
          selectedModeLabel: '8px dot diameter',
          sourceFeatureCount: 60,
          operatorPage: valid.postCompletionExactDots.operatorPage,
        },
      },
    })
    expect(frozenReportShape).toEqual({ passed: true, failureReasons: [] })

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

    const missingExactDots = buildBreadcrumbRestartProofVerdict({
      ...valid,
      postCompletionExactDots: undefined,
    })
    expect(missingExactDots.passed).toBe(false)
    expect(missingExactDots.failureReasons.join('\n')).toMatch(/restart.*exact.*dot/iu)

    const changedExactDots = buildBreadcrumbRestartProofVerdict({
      ...valid,
      postCompletionExactDots: {
        ...valid.postCompletionExactDots,
        sourceTruthSha256: 'f'.repeat(64),
      },
    })
    expect(changedExactDots.passed).toBe(false)
    expect(changedExactDots.failureReasons.join('\n')).toMatch(/restart.*exact.*dot/iu)

    const wrongMode = buildBreadcrumbRestartProofVerdict({
      ...valid,
      postCompletionExactDots: {
        ...valid.postCompletionExactDots,
        modeActivation: {
          selectedMode: 'line',
          sizeLabel: '8px dot diameter',
        },
      },
    })
    expect(wrongMode.passed).toBe(false)
    expect(wrongMode.failureReasons.join('\n')).toMatch(/restart.*exact.*dot/iu)
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

function buildExactDotOracle(
  profile: ReturnType<typeof createBreadcrumb36HourProfile>,
  window: { readonly from: string; readonly to: string },
  pageLimit: number,
): {
  readonly pages: readonly {
    readonly raw: { readonly positionCount: number; readonly sha256: string }
  }[]
} {
  const builder = (
    breadcrumbProofModule as typeof breadcrumbProofModule & {
      readonly buildBreadcrumb36HourExactDotPageOracle?: (
        proofProfile: ReturnType<typeof createBreadcrumb36HourProfile>,
        proofWindow: { readonly from: string; readonly to: string },
        options: { readonly pageLimit: number },
      ) => {
        readonly pages: readonly {
          readonly raw: { readonly positionCount: number; readonly sha256: string }
        }[]
      }
    }
  ).buildBreadcrumb36HourExactDotPageOracle
  if (builder === undefined) {
    throw new Error('The packaged proof requires an independent exact-dot page oracle.')
  }
  return builder(profile, window, { pageLimit })
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function createExactOracleRow(
  sqliteRowId: number,
  sourcePositionId: string,
  timestamp: string,
  latitude: number,
): PersistedSelectorPosition & { readonly sqlite_row_id: number } {
  return {
    sqlite_row_id: sqliteRowId,
    source_position_id: sourcePositionId,
    device_id: '1',
    lat: latitude,
    lon: -9.7 - sqliteRowId / 10_000_000,
    timestamp,
    data_origin: 'live',
  }
}

function createExactRenderedAuditFeature(
  sourcePositionId: string,
  latitude: number,
  auditScreenPixelErrorX: number,
  auditScreenPixelErrorY: number,
) {
  return {
    type: 'Feature' as const,
    id: `7:id:${sourcePositionId}`,
    geometry: {
      type: 'Point' as const,
      coordinates: [-9.7, latitude],
    },
    properties: {
      deviceId: '7',
      featureKind: 'breadcrumb',
      sourcePositionId,
      timestamp: '2026-08-10T22:00:00.000Z',
    },
    auditScreenPixelErrorX,
    auditScreenPixelErrorY,
  }
}

function createPassingRenderedCoordinateDeviation(comparedIdentityCount = 60) {
  return {
    passed: true,
    comparedIdentityCount,
    missingIdentityCount: 0,
    unexpectedIdentityCount: 0,
    timestampConflictCount: 0,
    coordinateConflictCount: 0,
    invalidIdentityCount: 0,
    duplicateIdentityCount: 0,
    maximumAllowedMetres: 8,
    maximumAllowedScreenPixelsPerAxis: 1 / 16,
    maximumAllowedScreenPixelsEuclidean: Math.SQRT2 / 16,
    metres: { p50: 4.8, p95: 7.2, max: 7.4 },
    screenPixels: {
      x: { p50: 0.03, p95: 0.05, max: 0.06 },
      y: { p50: 0.02, p95: 0.04, max: 0.05 },
      euclidean: { p50: 0.039, p95: 0.067, max: 0.078 },
    },
    worstMetreIdentity: '7:id:source-b',
    worstScreenPixelIdentity: '7:id:source-a',
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
    historyCheckpoints: {
      missionId: 'mission-1',
      requiredDeviceIds: ['1', '2'],
      requiredFrom: '2026-08-08T00:00:00.000Z',
      requiredTo: '2026-08-09T12:00:00.000Z',
      integrityResult: 'ok',
      checkpoints: ['1', '2'].map((deviceId) => ({
        mission_id: 'mission-1',
        device_id: deviceId,
        history_from: '2026-08-08T00:00:00.000Z',
        reconciled_until: '2026-08-09T12:00:00.000Z',
        updated_at: '2026-08-09T12:00:01.000Z',
      })),
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
      reportedTotalObserved: 100,
      coordinateSha256: 'b'.repeat(64),
      deviceCoordinateCounts: { '1': 50_000 },
      deviceCoordinateSha256: { '1': 'b'.repeat(64) },
      stable: true,
    },
    renderedDots: {
      stable: true,
      pageLimit: 60,
      totalPositionCount: 100,
      pageCount: 2,
      maximumPagePositionCount: 60,
      maximumPageObservedMs: 1_000,
      duplicateFeatureIdCount: 0,
      uniqueFeatureIdCount: 100,
      invalidFeatureCount: 0,
      returnedToLatest: true,
      returnNavigation: [{ pageIndex: 0, observedMs: 500 }],
      supportingScreenshot: 'packaged-36-hour-exact-dots-complete.png',
      pageUnion: {
        renderedPositionCount: 100,
        renderedSourceTruthSha256: 'e'.repeat(64),
      },
      pages: [
        {
          featureCount: 60,
          coordinateCount: 60,
          sourceTruthSha256: 'f'.repeat(64),
          identityTimestampSha256: '1'.repeat(64),
          invalidFeatureCount: 0,
          fromTimestamp: null,
          toTimestamp: null,
          operatorPage: {
            pagePositionCount: 60,
            totalPositionCount: 100,
            fromTimestamp: null,
            toTimestamp: null,
          },
          renderedLayer: {
            featureCount: 60,
            coordinateCount: 60,
            sourceTruthSha256: 'f'.repeat(64),
            identityTimestampSha256: '1'.repeat(64),
            invalidFeatureCount: 0,
            rawRenderedFeatureCount: 60,
            duplicateRenderedFeatureCount: 0,
            duplicateConflictCount: 0,
            coordinateDeviation: createPassingRenderedCoordinateDeviation(60),
          },
        },
        {
          featureCount: 40,
          coordinateCount: 40,
          sourceTruthSha256: '0'.repeat(64),
          identityTimestampSha256: '2'.repeat(64),
          invalidFeatureCount: 0,
          fromTimestamp: null,
          toTimestamp: null,
          operatorPage: {
            pagePositionCount: 40,
            totalPositionCount: 100,
            fromTimestamp: null,
            toTimestamp: null,
          },
          renderedLayer: {
            featureCount: 40,
            coordinateCount: 40,
            sourceTruthSha256: '0'.repeat(64),
            identityTimestampSha256: '2'.repeat(64),
            invalidFeatureCount: 0,
            rawRenderedFeatureCount: 40,
            duplicateRenderedFeatureCount: 0,
            duplicateConflictCount: 0,
            coordinateDeviation: createPassingRenderedCoordinateDeviation(40),
          },
        },
      ],
    },
    exactDotOracle: {
      pageLimit: 60,
      totalPositionCount: 100,
      pageCount: 2,
      pageUnion: {
        rawPositionCount: 100,
        rawSourceTruthSha256: 'e'.repeat(64),
      },
      pages: [
        {
          raw: {
            positionCount: 60,
            sha256: 'f'.repeat(64),
            identityTimestampSha256: '1'.repeat(64),
          },
        },
        {
          raw: {
            positionCount: 40,
            sha256: '0'.repeat(64),
            identityTimestampSha256: '2'.repeat(64),
          },
        },
      ],
    },
    variableSpeedEvidence: {
      deviceId: '1',
      slow: {
        sourcePositionCount: 720,
        retainedPositionCount: 720,
        omittedSourcePositionCount: 0,
        maximumRenderedGapInflation: 1,
      },
      fast: {
        minimumSpeedKmh: 120,
        maximumSpeedKmh: 145,
        sourcePositionCount: 720,
        retainedPositionCount: 720,
        omittedSourcePositionCount: 0,
        maximumRenderedGapInflation: 1,
      },
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
      dotRendered: {
        featureCount: 50_000,
        coordinateCount: 50_000,
        deviceCount: 32,
        coordinateSha256: 'c'.repeat(64),
        deviceCoordinateCounts: { '1': 50_000 },
        deviceCoordinateSha256: { '1': 'c'.repeat(64) },
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
    reportedTotalObserved: 100,
    coordinateSha256: 'b'.repeat(64),
    stable: true,
  }
  const exactDotOracle = {
    totalPositionCount: 100,
    pages: [{
      raw: {
        positionCount: 60,
        sha256: 'e'.repeat(64),
        identityTimestampSha256: 'f'.repeat(64),
      },
    }],
  }
  const postCompletionExactDots = {
    observedMs: 1_500,
    modeActivation: {
      selectedMode: 'dots',
      sizeLabel: '8px dot diameter',
    },
    stable: true,
    featureCount: 60,
    coordinateCount: 60,
    sourceTruthSha256: 'e'.repeat(64),
    identityTimestampSha256: 'f'.repeat(64),
    invalidFeatureCount: 0,
    fromTimestamp: '2026-08-09T10:00:00.000Z',
    toTimestamp: '2026-08-09T12:00:00.000Z',
    operatorPage: {
      pagePositionCount: 60,
      totalPositionCount: 100,
      fromTimestamp: '2026-08-09T10:00:00.000Z',
      toTimestamp: '2026-08-09T12:00:00.000Z',
    },
    renderedLayer: {
      featureCount: 60,
      coordinateCount: 60,
      identityTimestampSha256: 'f'.repeat(64),
      invalidFeatureCount: 0,
      rawRenderedFeatureCount: 60,
      duplicateRenderedFeatureCount: 0,
      duplicateConflictCount: 0,
      coordinateDeviation: createPassingRenderedCoordinateDeviation(60),
    },
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
    exactDotOracle,
    postCompletionExactDots,
    restoredMissionMatches: true,
    postCompletionRenderMs: 2_000,
  }
}
