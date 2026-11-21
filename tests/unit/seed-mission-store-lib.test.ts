import { describe, expect, it } from 'vitest'

import {
  FIELD_COUNT_LIMITS,
  FIELD_SHAPE_FIXTURE_GENERATOR_VERSION,
  FIXTURE_GENERATOR_VERSION,
  LEGACY_FIXTURE_GENERATOR_VERSION,
  buildFixtureManifest,
  createBreadcrumbProgrammeScenario,
  createDeterministicId,
  createFieldShapeScenario,
  createFixturePlan,
  fieldShapeFix,
  fieldShapeWriteBatches,
  fixtureManifestPath,
  fixtureGeneratorVersionForPlan,
  listFixturePresets,
  parseSeedMissionStoreArgs,
} from '../../build/seed-mission-store-lib.js'

describe('mission-store fixture plans [DON-242]', () => {
  it.each([
    ['bcp-960k-paging', 960_000],
    ['bcp-2m-paging', 2_000_000],
    ['bcp-field-37gb', 4_000_000],
  ])('declares %s as a separate synthetic complete-backfill paging scenario [DON-254]', (preset, positionCount) => {
    const plan = createFixturePlan(preset)
    expect(plan).toMatchObject({ positionCount, backfillScenario: 'synthetic-complete' })
    expect(fixtureGeneratorVersionForPlan(plan)).toBe(6)
    expect(createBreadcrumbProgrammeScenario(plan).participantBackfillWindows.every((window) => window.completed)).toBe(true)
    expect(createBreadcrumbProgrammeScenario(createFixturePlan('bcp-960k')).participantBackfillWindows.filter((window) => !window.completed)).toHaveLength(1)
    expect(buildFixtureManifest({ plan, databaseBytes: 4_000_000_000,
      rowCounts: { positions: positionCount, deviceUpdatedEvents: 0, positionRecordedEvents: 0, backupEvents: 0 },
      tableBytes: {},
    }).workload.backfillScenario).toBe('synthetic-complete')
    expect(createFixturePlan('bcp-960k')).not.toHaveProperty('backfillScenario')
    expect(createFixturePlan('bcp-2m')).not.toHaveProperty('backfillScenario')
    for (const scenarioPlan of [plan, createFixturePlan('bcp-960k'), createFixturePlan('bcp-2m')]) {
      const manifest = buildFixtureManifest({ plan: scenarioPlan, databaseBytes: 4_000_000_000,
        rowCounts: {}, tableBytes: {}, scenario: createBreadcrumbProgrammeScenario(scenarioPlan) })
      expect(manifest.scenario.participantBackfillWindows).toEqual([
        { deviceId: 'synthetic-device-096', completed: true },
        { deviceId: 'synthetic-device-095', completed: scenarioPlan.backfillScenario === 'synthetic-complete' },
      ])
    }
  })
  it('defines bounded field paging from BCP fixes and declared historical audit records [DON-254]', () => {
    const plan = createFixturePlan('bcp-field-37gb')
    expect(plan).toMatchObject({
      mode: 'breadcrumb-programme', positionCount: 4_000_000,
      deviceCount: 100, activePositionDeviceCount: 100, outingCount: 12,
      minimumDatabaseBytes: 3_700_000_000,
      legacyPositionAudit: true,
      positionRecordedEventCount: 3_999_988,
    })
    expect(plan.positionCount - 12).toBeLessThanOrEqual(4_000_000)
    expect(fixtureGeneratorVersionForPlan(plan)).toBe(6)
    expect(fixtureGeneratorVersionForPlan(createFixturePlan('bcp-2m'))).toBe(5)
    expect(fixtureGeneratorVersionForPlan(createFixturePlan('field'))).toBe(2)
    expect(() => buildFixtureManifest({ plan, databaseBytes: 3_699_999_999, rowCounts: {} }))
      .toThrow(/minimum.*3700000000/iu)
    expect(buildFixtureManifest({
      plan, databaseBytes: 3_700_000_000, rowCounts: {
        positions: 4_000_000, deviceUpdatedEvents: 0, positionRecordedEvents: 3_999_988, backupEvents: 0,
      }, tableBytes: {},
    })).toMatchObject({
      generatorVersion: 6, syntheticDataOnly: true,
      workload: { storageProfile: 'synthetic-beta11-position-audit-echoes',
        minimumDatabaseBytes: 3_700_000_000, realPositionRows: 4_000_000, redundantTelemetryRows: 3_999_988 },
    })
  })
  it('defines byte-scale presets for developer, CI, local, and field validation', () => {
    expect(createFixturePlan('small')).toMatchObject({
      preset: 'small',
      mode: 'target-size',
      targetBytes: 8 * 1024 * 1024,
    })
    expect(createFixturePlan('ci')).toMatchObject({
      preset: 'ci',
      mode: 'target-size',
      targetBytes: 128 * 1024 * 1024,
    })
    expect(createFixturePlan('local')).toMatchObject({
      preset: 'local',
      mode: 'target-size',
      targetBytes: 1024 * 1024 * 1024,
    })
    expect(createFixturePlan('field')).toMatchObject({
      preset: 'field',
      mode: 'target-size',
      targetBytes: 3_700_000_000,
      restartCheckpointsDays: [1, 3, 5, 7, 10, 12, 14],
    })
  })

  it('models a 32-device five-day mission at the production polling cadence', () => {
    const plan = createFixturePlan('mission-5d')

    expect(plan).toMatchObject({
      preset: 'mission-5d',
      mode: 'duration',
      durationDays: 5,
      deviceCount: 32,
      activePositionDeviceCount: 8,
      pollIntervalMs: 5_000,
      autosaveIntervalMs: 30_000,
      pollCount: 86_400,
      deviceUpdatedEventCount: 2_764_800,
      positionCount: 691_200,
      positionRecordedEventCount: 691_200,
      backupEventCount: 14_400,
      restartCheckpointsDays: [1, 2, 3, 4],
    })
  })

  it('models the rare fourteen-day extended mission without resetting accumulated data', () => {
    const plan = createFixturePlan('mission-14d')

    expect(plan).toMatchObject({
      preset: 'mission-14d',
      mode: 'duration',
      durationDays: 14,
      deviceCount: 32,
      pollCount: 241_920,
      deviceUpdatedEventCount: 7_741_440,
      positionCount: 1_935_360,
      positionRecordedEventCount: 1_935_360,
      backupEventCount: 40_320,
      restartCheckpointsDays: [1, 3, 5, 7, 10, 12],
    })
  })

  it('defines the exact normal-envelope and headroom breadcrumb programme fixtures [DON-272]', () => {
    expect(listFixturePresets()).toEqual(expect.arrayContaining(['bcp-960k', 'bcp-2m']))
    expect(createFixturePlan('bcp-960k')).toMatchObject({
      mode: 'breadcrumb-programme',
      positionCount: 960_000,
      deviceCount: 100,
      groupCount: 12,
      outingCount: 12,
      qualification: 'normal-envelope',
    })
    expect(createFixturePlan('bcp-2m')).toMatchObject({
      mode: 'breadcrumb-programme',
      positionCount: 2_000_000,
      deviceCount: 100,
      groupCount: 12,
      outingCount: 12,
      qualification: 'headroom-renderer-rejection',
    })
  })

  it('builds twelve non-overlapping outings with midnight crossings and an uneven 100-device roster [DON-272]', () => {
    const scenario = createBreadcrumbProgrammeScenario(createFixturePlan('bcp-960k'))

    expect(scenario.groupSizes).toEqual([12, 11, 10, 9, 9, 8, 8, 7, 7, 7, 6, 6])
    expect(scenario.groupSizes.reduce((total, size) => total + size, 0)).toBe(100)
    expect(scenario.selectedGroupCount).toBe(11)
    expect(scenario.activeParticipantCount).toBe(100)
    expect(scenario.outings).toHaveLength(12)
    expect(scenario.outings.filter((outing) => outing.crossesMidnight)).toHaveLength(5)
    for (let index = 1; index < scenario.outings.length; index += 1) {
      expect(scenario.outings[index]!.startedAt >= scenario.outings[index - 1]!.endedAt).toBe(true)
    }
    expect(scenario.stationaryCases).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'attention' }),
      expect.objectContaining({ kind: 'slow-walker-near-miss' }),
      expect.objectContaining({ kind: 'teleport-outlier-inside-run' }),
    ]))
  })

  it('rejects unknown presets rather than silently generating the wrong workload', () => {
    expect(() => createFixturePlan('unknown')).toThrow(/Unknown mission-store fixture preset/u)
  })
})

describe('seed mission-store CLI contract [DON-242]', () => {
  it('parses generation, cache reuse, and copy-on-test options', () => {
    expect(
      parseSeedMissionStoreArgs([
        '--preset',
        'field',
        '--output',
        '/fixtures/field/mission-store.sqlite',
        '--copy-to',
        '/runs/beta11/user-data/mission-store.sqlite',
        '--force',
      ]),
    ).toEqual({
      preset: 'field',
      outputPath: '/fixtures/field/mission-store.sqlite',
      copyToPath: '/runs/beta11/user-data/mission-store.sqlite',
      force: true,
      listPresets: false,
    })
  })

  it('supports listing presets without requiring an output path', () => {
    expect(parseSeedMissionStoreArgs(['--list-presets'])).toEqual({
      preset: undefined,
      outputPath: undefined,
      copyToPath: undefined,
      force: false,
      listPresets: true,
    })
  })

  it('fails closed when generation arguments are incomplete', () => {
    expect(() => parseSeedMissionStoreArgs(['--preset', 'field'])).toThrow('--output')
    expect(() => parseSeedMissionStoreArgs(['--output', '/tmp/store.sqlite'])).toThrow(
      '--preset',
    )
    expect(() => parseSeedMissionStoreArgs(['--wat'])).toThrow('Unknown argument')
  })
})

describe('mission-store fixture identity and manifest [DON-242]', () => {
  it('creates stable, readable synthetic identifiers', () => {
    expect(createDeterministicId('event', 42)).toBe('fixture-event-000000000042')
    expect(createDeterministicId('position', 9_876_543_210)).toBe(
      'fixture-position-009876543210',
    )
  })

  it('uses a sidecar path that cannot be mistaken for the SQLite database', () => {
    expect(fixtureManifestPath('/fixtures/mission-store.sqlite')).toBe(
      '/fixtures/mission-store.sqlite.manifest.json',
    )
  })

  it('reports operational data and redundant telemetry separately', () => {
    const manifest = buildFixtureManifest({
      plan: createFixturePlan('mission-5d'),
      schemaVersion: 4,
      databaseBytes: 123_456,
      sha256: 'a'.repeat(64),
      rowCounts: {
        missions: 1,
        devices: 32,
        positions: 691_200,
        missionEvents: 4_161_601,
        deviceCreatedEvents: 32,
        deviceUpdatedEvents: 2_764_800,
        positionRecordedEvents: 691_200,
        backupEvents: 14_400,
        restartCheckpointEvents: 4,
        operationalEvents: 1,
      },
      tableBytes: {
        missions: 4_096,
        devices: 8_192,
        positions: 50_000,
        mission_events: 60_000,
        other: 1_168,
      },
    })

    expect(manifest.generatorVersion).toBe(LEGACY_FIXTURE_GENERATOR_VERSION)
    expect(manifest.syntheticDataOnly).toBe(true)
    expect(manifest.workload.simulatedMissionDays).toBe(5)
    expect(manifest.workload.realPositionRows).toBe(691_200)
    expect(manifest.workload.redundantTelemetryRows).toBe(3_470_400)
    expect(manifest.database.sha256).toBe('a'.repeat(64))
    expect(manifest.rows.byEventType.device_updated).toBe(2_764_800)
    expect(manifest.rows.byEventType.fixture_restart_checkpoint).toBe(4)
    expect(manifest.bytes.byTable.mission_events).toBe(60_000)
  })

  it('records participant, outing, anomaly, and external-evidence boundaries for BCP manifests [DON-272]', () => {
    const plan = createFixturePlan('bcp-960k')
    const scenario = createBreadcrumbProgrammeScenario(plan)
    const manifest = buildFixtureManifest({
      plan,
      schemaVersion: 9,
      databaseBytes: 123,
      sha256: 'b'.repeat(64),
      rowCounts: {
        missions: 2, devices: 101, positions: 960_000, missionEvents: 20,
        deviceCreatedEvents: 0, deviceUpdatedEvents: 0, positionRecordedEvents: 0,
        backupEvents: 0, restartCheckpointEvents: 11, operationalEvents: 20,
        outings: 12, missionTeams: 11, missionParticipants: 16,
        groupMembershipEvents: 96, participantBackfillCheckpoints: 2,
        ingestAnomalies: 5,
      },
      tableBytes: { positions: 100, other: 23 },
      scenario,
    })

    expect(manifest.scenario).toMatchObject({
      outingCount: 12,
      groupCount: 12,
      selectedGroupCount: 11,
      acceptedPositionCount: 960_000,
      legacyNoOutingMissionCount: 1,
      gpxEvidenceBoundary: 'deferred-to-pr4-not-faked',
    })
    expect(manifest.generatorVersion).toBe(FIXTURE_GENERATOR_VERSION)
    expect(manifest.rows.byTable).toMatchObject({
      outings: 12,
      mission_teams: 11,
      mission_participants: 16,
      participant_backfill_checkpoints: 2,
      ingest_anomalies: 5,
    })
  })
})

describe('field-shape fixture plans beyond every count limit [DON-338]', () => {
  type FieldDevice = { deviceId: string, fixCount: number, cadenceMs: number, gap: unknown, lateBlock: unknown }
  const devicesOf = (preset: string) => (createFixturePlan(preset) as unknown as { fieldDevices: FieldDevice[] }).fieldDevices

  it('lists the field-shape presets and marks them with their own generator version', () => {
    expect(listFixturePresets()).toEqual(expect.arrayContaining(['field-trail-12k', 'field-trail-25k', 'field-34-devices']))
    for (const preset of ['field-trail-12k', 'field-trail-25k', 'field-34-devices']) {
      const plan = createFixturePlan(preset)
      expect(plan.mode).toBe('field-shape')
      expect(fixtureGeneratorVersionForPlan(plan)).toBe(FIELD_SHAPE_FIXTURE_GENERATOR_VERSION)
      expect(parseSeedMissionStoreArgs(['--preset', preset, '--output', '/tmp/x.sqlite']).preset).toBe(preset)
    }
  })

  it('puts one device past the exact-dot page and the live-line cap, the earlier fixtures stopped at 9,600', () => {
    for (const [preset, fixCount] of [['field-trail-12k', 12_000], ['field-trail-25k', 25_000], ['field-34-devices', 14_400]] as const) {
      const busiest = Math.max(...devicesOf(preset).map((device) => device.fixCount))
      expect(busiest).toBe(fixCount)
      expect(busiest).toBeGreaterThan(FIELD_COUNT_LIMITS.exactDotPage)
      expect(busiest).toBeGreaterThan(FIELD_COUNT_LIMITS.liveLinePerDevice)
      expect(devicesOf(preset)[0]!.cadenceMs).toBe(3_000)
    }
  })

  it('models the team shape: 34 devices over 12 hours, pooled well past the dot page', () => {
    const plan = createFixturePlan('field-34-devices')
    expect(plan.deviceCount).toBe(34)
    expect(plan.positionCount).toBe(14_400 + 33 * 4_320)
    expect(plan.positionCount).toBeGreaterThan(10 * FIELD_COUNT_LIMITS.exactDotPage)
    expect(plan.durationDays! * 24).toBeGreaterThanOrEqual(12)
  })

  it('places a dropout over the 30-minute line break and a late block longer than one write batch', () => {
    const plan = createFixturePlan('field-trail-25k')
    const scenario = createFieldShapeScenario(plan)
    const device = scenario.devices[0]!
    expect(Date.parse(device.gap!.to) - Date.parse(device.gap!.from)).toBeGreaterThan(FIELD_COUNT_LIMITS.lineBreakMs)
    expect(device.lateBlock!.fixCount).toBeGreaterThan(FIELD_COUNT_LIMITS.writeBatchRows)
    expect(device.lateBlock!.delayMs).toBeGreaterThanOrEqual(FIELD_COUNT_LIMITS.historyWindowMs)
    expect(Date.parse(device.lastTimestamp) - Date.parse(device.firstTimestamp)).toBeGreaterThan(20 * 60 * 60 * 1000)
    const many = createFieldShapeScenario(createFixturePlan('field-34-devices'))
    expect(many.devices.filter((entry) => entry.gap !== null)).toHaveLength(1)
    expect(many.devices.filter((entry) => entry.lateBlock !== null)).toHaveLength(1)
  })

  it('generates deterministic, synthetic, strictly time-ordered fixes with a visible jump across the gap', () => {
    const plan = createFixturePlan('field-trail-25k')
    expect(fieldShapeFix(plan, 0, 8_999)).toEqual(fieldShapeFix(createFixturePlan('field-trail-25k'), 0, 8_999))
    let previous = fieldShapeFix(plan, 0, 0)
    expect(previous.timestamp).toBe('2026-01-10T06:00:03.000Z')
    for (let index = 1; index < 25_000; index += 1) {
      const fix = fieldShapeFix(plan, 0, index)
      expect(Date.parse(fix.timestamp)).toBeGreaterThan(Date.parse(previous.timestamp))
      previous = fix
    }
    const before = fieldShapeFix(plan, 0, 8_999)
    const after = fieldShapeFix(plan, 0, 9_000)
    expect(Date.parse(after.timestamp) - Date.parse(before.timestamp)).toBe(45 * 60 * 1000 + 3_000)
    expect(after.lat - before.lat).toBeGreaterThan(0.008) // about a kilometre walked unseen
    expect(() => fieldShapeFix(plan, 0, 25_000)).toThrow(/outside/u)
    expect(() => fieldShapeFix(plan, 1, 0)).toThrow(/not in this plan/u)
  })

  it('delivers every fix exactly once in batches of at most 256, late blocks after everything newer', () => {
    const plan = createFixturePlan('field-trail-25k')
    const seen = new Set<string>()
    let sawLate = false
    for (const batch of fieldShapeWriteBatches(plan)) {
      expect(batch.length).toBeLessThanOrEqual(FIELD_COUNT_LIMITS.writeBatchRows)
      for (const fix of batch) {
        if (fix.late) sawLate = true
        else expect(sawLate, 'a prompt fix was delivered after a late one').toBe(false)
        expect(seen.has(fix.sourcePositionId)).toBe(false)
        seen.add(fix.sourcePositionId)
      }
    }
    expect(seen.size).toBe(25_000)
    expect(sawLate).toBe(true)
    expect(() => fieldShapeWriteBatches(createFixturePlan('small')).next()).toThrow(/field-shape plan/u)
  })
})
