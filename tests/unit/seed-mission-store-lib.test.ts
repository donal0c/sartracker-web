import { describe, expect, it } from 'vitest'

import {
  FIXTURE_GENERATOR_VERSION,
  buildFixtureManifest,
  createDeterministicId,
  createFixturePlan,
  fixtureManifestPath,
  parseSeedMissionStoreArgs,
} from '../../build/seed-mission-store-lib.js'

describe('mission-store fixture plans [DON-242]', () => {
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

    expect(manifest.generatorVersion).toBe(FIXTURE_GENERATOR_VERSION)
    expect(manifest.syntheticDataOnly).toBe(true)
    expect(manifest.workload.simulatedMissionDays).toBe(5)
    expect(manifest.workload.realPositionRows).toBe(691_200)
    expect(manifest.workload.redundantTelemetryRows).toBe(3_470_400)
    expect(manifest.database.sha256).toBe('a'.repeat(64))
    expect(manifest.rows.byEventType.device_updated).toBe(2_764_800)
    expect(manifest.rows.byEventType.fixture_restart_checkpoint).toBe(4)
    expect(manifest.bytes.byTable.mission_events).toBe(60_000)
  })
})
