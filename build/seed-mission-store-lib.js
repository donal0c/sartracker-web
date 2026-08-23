import path from 'node:path'

export const FIXTURE_GENERATOR_VERSION = 4
export const LEGACY_FIXTURE_GENERATOR_VERSION = 2

const DAY_MS = 24 * 60 * 60 * 1000
const MIB = 1024 * 1024
const GIB = 1024 * MIB
const DEFAULT_DEVICE_COUNT = 32
const DEFAULT_ACTIVE_POSITION_DEVICE_COUNT = 8
const DEFAULT_POLL_INTERVAL_MS = 5_000
const DEFAULT_AUTOSAVE_INTERVAL_MS = 30_000

const PRESET_DEFINITIONS = Object.freeze({
  small: {
    mode: 'target-size',
    targetBytes: 8 * MIB,
  },
  ci: {
    mode: 'target-size',
    targetBytes: 128 * MIB,
  },
  local: {
    mode: 'target-size',
    targetBytes: GIB,
  },
  field: {
    mode: 'target-size',
    targetBytes: 3_700_000_000,
    restartCheckpointsDays: [1, 3, 5, 7, 10, 12, 14],
  },
  'mission-5d': {
    mode: 'duration',
    durationDays: 5,
    restartCheckpointsDays: [1, 2, 3, 4],
  },
  'mission-14d': {
    mode: 'duration',
    durationDays: 14,
    restartCheckpointsDays: [1, 3, 5, 7, 10, 12],
  },
  'bcp-960k': {
    mode: 'breadcrumb-programme',
    positionCount: 960_000,
    durationDays: 12,
    deviceCount: 100,
    activePositionDeviceCount: 100,
    groupCount: 12,
    outingCount: 12,
    qualification: 'normal-envelope',
    restartCheckpointsDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
  'bcp-2m': {
    mode: 'breadcrumb-programme',
    positionCount: 2_000_000,
    durationDays: 12,
    deviceCount: 100,
    activePositionDeviceCount: 100,
    groupCount: 12,
    outingCount: 12,
    qualification: 'headroom-renderer-rejection',
    restartCheckpointsDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
})

/** Returns the supported deterministic fixture preset names in display order. */
export function listFixturePresets() {
  return Object.keys(PRESET_DEFINITIONS)
}

/**
 * Builds an immutable fixture plan. Duration presets model the previously observed
 * beta.11 write amplification: one device heartbeat per device per poll, a position
 * plus redundant audit echo for eight active devices, and one backup event per
 * autosave interval. Target-size presets use the same ratios until the requested
 * on-disk size is reached.
 */
export function createFixturePlan(preset) {
  const definition = PRESET_DEFINITIONS[preset]
  if (definition === undefined) {
    throw new Error(
      `Unknown mission-store fixture preset: ${String(preset)}. Expected one of ${listFixturePresets().join(', ')}.`,
    )
  }

  const base = {
    preset,
    mode: definition.mode,
    deviceCount: definition.deviceCount ?? DEFAULT_DEVICE_COUNT,
    activePositionDeviceCount:
      definition.activePositionDeviceCount ?? DEFAULT_ACTIVE_POSITION_DEVICE_COUNT,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    autosaveIntervalMs: DEFAULT_AUTOSAVE_INTERVAL_MS,
    restartCheckpointsDays: [...(definition.restartCheckpointsDays ?? [])],
  }

  if (definition.mode === 'target-size') {
    return Object.freeze({
      ...base,
      targetBytes: definition.targetBytes,
      durationDays: null,
      pollCount: null,
      deviceUpdatedEventCount: null,
      positionCount: null,
      positionRecordedEventCount: null,
      backupEventCount: null,
    })
  }

  if (definition.mode === 'breadcrumb-programme') {
    const pollCount = Math.ceil(
      definition.positionCount / definition.activePositionDeviceCount,
    )
    return Object.freeze({
      ...base,
      durationDays: definition.durationDays,
      targetBytes: null,
      pollCount,
      positionCount: definition.positionCount,
      deviceUpdatedEventCount: 0,
      positionRecordedEventCount: 0,
      backupEventCount: 0,
      pollIntervalMs: Math.floor(
        (definition.durationDays * DAY_MS) / pollCount,
      ),
      groupCount: definition.groupCount,
      outingCount: definition.outingCount,
      qualification: definition.qualification,
      missionModelScenario: true,
    })
  }

  const pollCount = Math.floor((definition.durationDays * DAY_MS) / base.pollIntervalMs)
  const backupEventCount = Math.floor(
    (definition.durationDays * DAY_MS) / base.autosaveIntervalMs,
  )
  const positionCount = pollCount * base.activePositionDeviceCount

  return Object.freeze({
    ...base,
    durationDays: definition.durationDays,
    targetBytes: null,
    pollCount,
    deviceUpdatedEventCount: pollCount * base.deviceCount,
    positionCount,
    positionRecordedEventCount: positionCount,
    backupEventCount,
  })
}

/** Builds the deterministic outing/team truth shared by both BCP fixture sizes. */
export function createBreadcrumbProgrammeScenario(plan) {
  if (plan?.mode !== 'breadcrumb-programme') {
    throw new Error('Breadcrumb programme scenario requires a breadcrumb-programme fixture plan.')
  }
  const outingDefinitions = [
    [0, 18, 5],
    [1, 20, 8],
    [2, 7, 12],
    [3, 19, 7],
    [4, 8, 10],
    [5, 21, 6],
    [6, 6, 12],
    [7, 18, 9],
    [8, 8, 12],
    [9, 17, 10],
    [10, 7, 11],
    [11, 16, 7],
  ]
  const originMs = Date.parse('2026-01-01T00:00:00.000Z')
  const outings = outingDefinitions.map(([day, hour, durationHours], index) => {
    const startedAtMs = originMs + day * DAY_MS + hour * 60 * 60 * 1000
    const endedAtMs = startedAtMs + durationHours * 60 * 60 * 1000
    return Object.freeze({
      id: createDeterministicId('outing', index),
      label: `SYNTHETIC OUTING ${String(index + 1).padStart(2, '0')}`,
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      crossesMidnight:
        new Date(startedAtMs).getUTCDate() !== new Date(endedAtMs).getUTCDate(),
    })
  })
  return Object.freeze({
    acceptedPositionCount: plan.positionCount,
    qualification: plan.qualification,
    groupCount: 12,
    selectedGroupCount: 11,
    activeParticipantCount: 100,
    groupSizes: Object.freeze([12, 11, 10, 9, 9, 8, 8, 7, 7, 7, 6, 6]),
    outingCount: outings.length,
    outings: Object.freeze(outings),
    legacyNoOutingMissionCount: 1,
    participantBackfillWindows: Object.freeze([
      Object.freeze({ deviceId: 'synthetic-device-096', completed: true }),
      Object.freeze({ deviceId: 'synthetic-device-095', completed: false }),
    ]),
    stationaryCases: Object.freeze([
      Object.freeze({ deviceId: 'synthetic-device-001', kind: 'attention' }),
      Object.freeze({ deviceId: 'synthetic-device-002', kind: 'slow-walker-near-miss' }),
      Object.freeze({ deviceId: 'synthetic-device-003', kind: 'jitter-near-miss' }),
      Object.freeze({ deviceId: 'synthetic-device-004', kind: 'teleport-outlier-inside-run' }),
    ]),
    injections: Object.freeze({
      exactDuplicates: 4,
      conflicts: 2,
      rejected: 3,
      lateOutOfOrder: 8,
    }),
    gpxEvidenceBoundary: 'deferred-to-pr4-not-faked',
  })
}

/** Parses the intentionally small, fail-closed fixture-generator CLI. */
export function parseSeedMissionStoreArgs(argv) {
  const args = {
    preset: undefined,
    outputPath: undefined,
    copyToPath: undefined,
    force: false,
    listPresets: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = () => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`${token} requires a value.`)
      }
      index += 1
      return value
    }

    switch (token) {
      case '--preset':
        args.preset = nextValue()
        break
      case '--output':
        args.outputPath = nextValue()
        break
      case '--copy-to':
        args.copyToPath = nextValue()
        break
      case '--force':
        args.force = true
        break
      case '--list-presets':
        args.listPresets = true
        break
      default:
        throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!args.listPresets) {
    if (args.preset === undefined) {
      throw new Error('--preset <name> is required.')
    }
    createFixturePlan(args.preset)
    if (args.outputPath === undefined) {
      throw new Error('--output <mission-store.sqlite> is required.')
    }
  }

  return args
}

/** Creates a stable identifier that is explicitly synthetic in SQLite evidence. */
export function createDeterministicId(kind, index) {
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9-]*$/u.test(kind)) {
    throw new Error('Fixture identifier kind must be a lowercase token.')
  }
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new Error('Fixture identifier index must be a non-negative safe integer.')
  }
  return `fixture-${kind}-${String(index).padStart(12, '0')}`
}

/** Returns the JSON sidecar path associated with a generated SQLite fixture. */
export function fixtureManifestPath(databasePath) {
  return `${databasePath}.manifest.json`
}

/** Keeps established field-scale fixture caches compatible across BCP-only generator changes. */
export function fixtureGeneratorVersionForPlan(plan) {
  return plan.mode === 'breadcrumb-programme'
    ? FIXTURE_GENERATOR_VERSION
    : LEGACY_FIXTURE_GENERATOR_VERSION
}

/** Shapes the durable manifest written beside every generated fixture. */
export function buildFixtureManifest(input) {
  const plan = input.plan
  const rowCounts = input.rowCounts
  const redundantTelemetryRows =
    rowCounts.deviceUpdatedEvents +
    rowCounts.positionRecordedEvents +
    rowCounts.backupEvents

  const manifest = {
    generatorVersion: fixtureGeneratorVersionForPlan(plan),
    syntheticDataOnly: true,
    preset: plan.preset,
    schemaVersion: input.schemaVersion,
    workload: {
      mode: plan.mode,
      simulatedMissionDays: plan.durationDays,
      deviceCount: plan.deviceCount,
      activePositionDeviceCount: plan.activePositionDeviceCount,
      pollIntervalMs: plan.pollIntervalMs,
      autosaveIntervalMs: plan.autosaveIntervalMs,
      pollCount: plan.pollCount,
      restartCheckpointsDays: [...plan.restartCheckpointsDays],
      realPositionRows: rowCounts.positions,
      redundantTelemetryRows,
    },
    database: {
      bytes: input.databaseBytes,
      sha256: input.sha256,
    },
    rows: {
      totalMissionEvents: rowCounts.missionEvents,
      byTable: {
        missions: rowCounts.missions,
        devices: rowCounts.devices,
        positions: rowCounts.positions,
        mission_events: rowCounts.missionEvents,
        ...(input.scenario === undefined
          ? {}
          : {
              outings: rowCounts.outings,
              mission_teams: rowCounts.missionTeams,
              mission_participants: rowCounts.missionParticipants,
              mission_group_membership_events: rowCounts.groupMembershipEvents,
              participant_backfill_checkpoints: rowCounts.participantBackfillCheckpoints,
              ingest_anomalies: rowCounts.ingestAnomalies,
            }),
      },
      byEventType: {
        device_created: rowCounts.deviceCreatedEvents,
        device_updated: rowCounts.deviceUpdatedEvents,
        position_recorded: rowCounts.positionRecordedEvents,
        mission_backup_synced: rowCounts.backupEvents,
        fixture_restart_checkpoint: rowCounts.restartCheckpointEvents ?? 0,
        operational: rowCounts.operationalEvents,
      },
    },
    bytes: {
      byTable: { ...input.tableBytes },
    },
    ...(input.scenario === undefined ? {} : { scenario: input.scenario }),
  }
  return manifest
}

/** Resolves a copy destination beside a userData directory when helpful to runners. */
export function fixtureCopyDestination(copyToPath) {
  return path.resolve(copyToPath)
}
