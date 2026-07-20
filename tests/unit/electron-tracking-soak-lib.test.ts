import { describe, expect, it } from 'vitest'

import {
  buildTrackingSoakVerdict,
  buildTrackingGrowthEvidence,
  createTrackingSoakProfile,
  parseTrackingSoakRuntimeLog,
  parseTrackingSoakArgs,
} from '../../build/electron-tracking-soak-lib.js'

describe('Electron packaged tracking soak helpers [DON-246]', () => {
  it('defines deterministic CI, five-day, and fourteen-day profiles', () => {
    expect(createTrackingSoakProfile('ci')).toMatchObject({
      name: 'ci',
      deviceCount: 32,
      actualBatches: 6,
      productionPollsPerBatch: 180,
      equivalentProductionPolls: 1_080,
      expectedPositionRows: 8_664,
      restartCheckpoints: [3],
      recommendedPollIntervalMs: 25,
    })
    expect(createTrackingSoakProfile('normal')).toMatchObject({
      name: 'normal',
      actualBatches: 480,
      equivalentProductionPolls: 86_400,
      expectedPositionRows: 691_224,
      restartCheckpoints: [240],
      recommendedPollIntervalMs: 250,
    })
    expect(createTrackingSoakProfile('extended')).toMatchObject({
      name: 'extended',
      actualBatches: 1_344,
      equivalentProductionPolls: 241_920,
      expectedPositionRows: 1_935_384,
      restartCheckpoints: [448, 896],
      recommendedPollIntervalMs: 250,
    })
  })

  it('uses a garbage-collection-safe default cadence for full packaged profiles', () => {
    expect(parseTrackingSoakArgs(['--app', '/tmp/app', '--profile', 'extended']).pollIntervalMs).toBe(250)
  })

  it('parses a fail-closed packaged-runner command line', () => {
    expect(
      parseTrackingSoakArgs([
        '--app',
        '/tmp/SAR.AppImage',
        '--profile',
        'normal',
        '--evidence',
        '/tmp/evidence',
        '--poll-interval-ms',
        '25',
        '--timeout-ms',
        '60000',
        '--',
        '--ozone-platform=x11',
      ]),
    ).toEqual({
      appPath: '/tmp/SAR.AppImage',
      profile: createTrackingSoakProfile('normal'),
      evidenceDir: '/tmp/evidence',
      pollIntervalMs: 25,
      timeoutMs: 60_000,
      freezeThresholdMs: 1_000,
      extraArgs: ['--ozone-platform=x11'],
    })
  })

  it('rejects missing apps, unknown profiles, and unsafe acceleration values', () => {
    expect(() => parseTrackingSoakArgs([])).toThrow(/--app/i)
    expect(() =>
      parseTrackingSoakArgs(['--app', '/tmp/app', '--profile', 'monthly']),
    ).toThrow(/profile/i)
    expect(() =>
      parseTrackingSoakArgs(['--app', '/tmp/app', '--poll-interval-ms', '4']),
    ).toThrow(/poll interval/i)
  })

  it('passes only complete, responsive, zero-redundancy reports', () => {
    const profile = createTrackingSoakProfile('ci')
    const verdict = buildTrackingSoakVerdict({
      profile,
      observedBatches: profile.actualBatches,
      deviceRows: profile.deviceCount,
      positionRows: profile.expectedPositionRows,
      deviceCreatedEvents: profile.deviceCount,
      deviceUpdatedEvents: 0,
      positionRecordedEvents: 0,
      operationalMissionEvents: 9,
      declaredOperationalEventBudget: 9,
      unexplainedMissionEvents: 0,
      restartCheckpointsPassed: profile.restartCheckpoints.length,
      backupCycles: 2,
      mainHeartbeatSamples: 40,
      mainHeartbeatErrors: 0,
      mainMaximumMs: 14,
      rendererSamples: 40,
      rendererMaximumMs: 22,
      rendererCrashes: 0,
      operatorInteractionSamples: 4,
      operatorInteractionErrors: 0,
      operatorInteractionMaximumMs: 120,
      maximumProcessTreeResidentBytes: 500_000_000,
      freezeThresholdMs: 1_000,
      integrityResult: 'ok',
      walCheckpointBusy: 0,
      supportBundleInspected: true,
      supportBundleRedacted: true,
      runtimeLogBytes: 24_000,
      supportBundleBytes: 18_000,
    })

    expect(verdict).toEqual({
      valid: true,
      passed: true,
      failureReasons: [],
      redundantTelemetrySlopeRowsPerEquivalentPoll: 0,
      operationalPositionSlopeRowsPerEquivalentPoll:
        profile.expectedPositionRows / profile.equivalentProductionPolls,
    })
  })

  it('fails reliably when redundant events return or required evidence is absent', () => {
    const profile = createTrackingSoakProfile('ci')
    const verdict = buildTrackingSoakVerdict({
      profile,
      observedBatches: profile.actualBatches,
      deviceRows: profile.deviceCount,
      positionRows: profile.expectedPositionRows - 1,
      deviceCreatedEvents: profile.deviceCount,
      deviceUpdatedEvents: 1,
      positionRecordedEvents: 4,
      operationalMissionEvents: 1,
      declaredOperationalEventBudget: 1,
      unexplainedMissionEvents: 1,
      restartCheckpointsPassed: 0,
      backupCycles: 0,
      mainHeartbeatSamples: 0,
      mainHeartbeatErrors: 1,
      mainMaximumMs: 1_500,
      rendererSamples: 0,
      rendererMaximumMs: 0,
      rendererCrashes: 1,
      maximumProcessTreeResidentBytes: 3_000_000_000,
      freezeThresholdMs: 1_000,
      integrityResult: 'not ok',
      walCheckpointBusy: 1,
      supportBundleInspected: false,
      supportBundleRedacted: false,
      runtimeLogBytes: 0,
      supportBundleBytes: 0,
    })

    expect(verdict.valid).toBe(false)
    expect(verdict.passed).toBe(false)
    expect(verdict.redundantTelemetrySlopeRowsPerEquivalentPoll).toBe(5 / 1_080)
    expect(verdict.failureReasons.join('\n')).toMatch(
      /position rows|device_updated|position_recorded|restart|backup|heartbeat|integrity|WAL|support bundle/i,
    )
  })

  it('fails when the renderer clock and IPC are alive but operator controls are unresponsive [DON-247]', () => {
    const profile = createTrackingSoakProfile('ci')
    const verdict = buildTrackingSoakVerdict({
      profile,
      observedBatches: profile.actualBatches,
      deviceRows: profile.deviceCount,
      positionRows: profile.expectedPositionRows,
      deviceCreatedEvents: profile.deviceCount,
      deviceUpdatedEvents: 0,
      positionRecordedEvents: 0,
      operationalMissionEvents: 9,
      declaredOperationalEventBudget: 9,
      unexplainedMissionEvents: 0,
      restartCheckpointsPassed: profile.restartCheckpoints.length,
      backupCycles: 2,
      mainHeartbeatSamples: 40,
      mainHeartbeatErrors: 0,
      mainMaximumMs: 14,
      rendererSamples: 40,
      rendererMaximumMs: 22,
      rendererCrashes: 0,
      operatorInteractionSamples: 0,
      operatorInteractionErrors: 1,
      operatorInteractionMaximumMs: 1_500,
      maximumProcessTreeResidentBytes: 500_000_000,
      freezeThresholdMs: 1_000,
      integrityResult: 'ok',
      walCheckpointBusy: 0,
      supportBundleInspected: true,
      supportBundleRedacted: true,
      runtimeLogBytes: 24_000,
      supportBundleBytes: 18_000,
    })

    expect(verdict.passed).toBe(false)
    expect(verdict.failureReasons.join('\n')).toMatch(/operator interaction/i)
  })

  it('reports separate operational and redundant slopes between durable checkpoints', () => {
    expect(
      buildTrackingGrowthEvidence([
        { equivalentProductionPolls: 540, databaseBytes: 1_000, positionRows: 4_344, redundantEventRows: 0 },
        { equivalentProductionPolls: 1_080, databaseBytes: 2_000, positionRows: 8_664, redundantEventRows: 0 },
      ]),
    ).toEqual({
      checkpoints: [
        { equivalentProductionPolls: 540, databaseBytes: 1_000, positionRows: 4_344, redundantEventRows: 0 },
        { equivalentProductionPolls: 1_080, databaseBytes: 2_000, positionRows: 8_664, redundantEventRows: 0 },
      ],
      intervals: [{
        fromEquivalentProductionPolls: 540,
        toEquivalentProductionPolls: 1_080,
        databaseBytesPerEquivalentPoll: 1_000 / 540,
        positionRowsPerEquivalentPoll: 8,
        redundantEventRowsPerEquivalentPoll: 0,
      }],
    })
  })

  it('extracts backup and persistence timing trends from bounded runtime logs', () => {
    const evidence = parseTrackingSoakRuntimeLog([
      '{"event":"storage_backup_completed","totalDurationMs":24,"databaseBytes":4096}',
      'malformed line',
      '{"event":"storage_tracking_positions_completed","durationMs":19,"insertedPositionCount":1440}',
      '{"event":"storage_backup_completed","totalDurationMs":31,"databaseBytes":2654208}',
    ].join('\n'))

    expect(evidence).toEqual({
      backupCycles: [
        { totalDurationMs: 24, databaseBytes: 4_096 },
        { totalDurationMs: 31, databaseBytes: 2_654_208 },
      ],
      trackingPositionBatches: [
        { durationMs: 19, insertedPositionCount: 1_440 },
      ],
      backupDurationTrendMs: 7,
    })
  })
})
