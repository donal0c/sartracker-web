import path from 'node:path'

export const FIXTURE_GENERATOR_VERSION = 2

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
    deviceCount: DEFAULT_DEVICE_COUNT,
    activePositionDeviceCount: DEFAULT_ACTIVE_POSITION_DEVICE_COUNT,
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

/** Shapes the durable manifest written beside every generated fixture. */
export function buildFixtureManifest(input) {
  const plan = input.plan
  const rowCounts = input.rowCounts
  const redundantTelemetryRows =
    rowCounts.deviceUpdatedEvents +
    rowCounts.positionRecordedEvents +
    rowCounts.backupEvents

  return {
    generatorVersion: FIXTURE_GENERATOR_VERSION,
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
  }
}

/** Resolves a copy destination beside a userData directory when helpful to runners. */
export function fixtureCopyDestination(copyToPath) {
  return path.resolve(copyToPath)
}
