import path from 'node:path'

export const FIXTURE_GENERATOR_VERSION = 5
export const PAGING_FIXTURE_GENERATOR_VERSION = 6
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
  'bcp-field-37gb': {
    mode: 'breadcrumb-programme',
    positionCount: 4_000_000,
    durationDays: 12,
    deviceCount: 100,
    activePositionDeviceCount: 100,
    groupCount: 12,
    outingCount: 12,
    qualification: 'field-paging-synthetic-historical-audit',
    minimumDatabaseBytes: 3_700_000_000,
    legacyPositionAudit: true,
    backfillScenario: 'synthetic-complete',
    restartCheckpointsDays: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  },
})

// Paging admission requires complete backfill; the original mixed-state BCP
// profiles remain unchanged for incomplete-history regression coverage.
const PAGING_PRESET_DEFINITIONS = Object.freeze({
  'bcp-960k-paging': { ...PRESET_DEFINITIONS['bcp-960k'], backfillScenario: 'synthetic-complete' },
  'bcp-2m-paging': { ...PRESET_DEFINITIONS['bcp-2m'], backfillScenario: 'synthetic-complete' },
})

export const FIELD_SHAPE_FIXTURE_GENERATOR_VERSION = 7
const HOUR_MS = 60 * 60 * 1000
const FIELD_SHAPE_START_MS = Date.parse('2026-01-10T06:00:00.000Z')
/** Metres of northward travel per 3 s of elapsed time: about a slow search walk. */
const FIELD_SHAPE_LAT_STEP_PER_3S = 0.00001

/**
 * Every count or time limit in the position pipeline that could truncate,
 * thin or split what the operator sees (DON-338 investigation, limits table).
 * Field-shape presets are built to sit beyond each one, so a test or smoke on
 * them meets the limit instead of stopping just short of it, as the earlier
 * 9,600-per-device fixtures did.
 */
export const FIELD_COUNT_LIMITS = Object.freeze({
  /** Exact dot page, all devices together: exact-breadcrumb-dot-controller.ts, breadcrumb-dot-query.cjs. */
  exactDotPage: 10_000,
  /** Live trail line points kept per device: breadcrumb-accumulator.ts. */
  liveLinePerDevice: 5_000,
  /** A time gap longer than this starts a new line segment: coverage-tile-worker.cjs, tracking-geojson.ts. */
  lineBreakMs: 30 * 60 * 1000,
  /** One provider history window: breadcrumb-history-reconciler.ts. */
  historyWindowMs: 2 * HOUR_MS,
  /** One store write batch: split-history-chunk.ts. */
  writeBatchRows: 256,
})

/**
 * Field-shaped presets for DON-338 and its testing gap (LIF-1). Synthetic
 * coordinates only. Each device walks north with a gentle meander from its own
 * origin; its position is a pure function of elapsed time, so a gap in
 * reporting shows as a jump in the trail, as it does in the field.
 */
const FIELD_SHAPE_PRESET_DEFINITIONS = Object.freeze({
  // The team's report: one phone, all day, a fix every 3 s, no gaps.
  'field-trail-12k': {
    devices: [{ fixCount: 12_000, cadenceMs: 3_000 }],
  },
  // One phone well past every count limit, with a dropout over 30 minutes and
  // a block of fixes the phone uploaded two hours late.
  'field-trail-25k': {
    devices: [{
      fixCount: 25_000,
      cadenceMs: 3_000,
      gap: { afterFix: 9_000, durationMs: 45 * 60 * 1000 },
      lateBlock: { fromFix: 15_000, fixCount: 600, delayMs: 2 * HOUR_MS },
    }],
  },
  // A full team for 12 hours: one fast phone over the dot page on its own,
  // 33 more at 10 s, one with a dropout and one with a late upload.
  'field-34-devices': {
    devices: Array.from({ length: 34 }, (_, index) => ({
      fixCount: index === 0 ? 14_400 : 4_320,
      cadenceMs: index === 0 ? 3_000 : 10_000,
      ...(index === 1 ? { gap: { afterFix: 2_000, durationMs: 45 * 60 * 1000 } } : {}),
      ...(index === 2 ? { lateBlock: { fromFix: 3_000, fixCount: 360, delayMs: 2 * HOUR_MS } } : {}),
    })),
  },
})

/** Returns the supported deterministic fixture preset names in display order. */
export function listFixturePresets() {
  return [
    ...Object.keys(PRESET_DEFINITIONS),
    ...Object.keys(PAGING_PRESET_DEFINITIONS),
    ...Object.keys(FIELD_SHAPE_PRESET_DEFINITIONS),
  ]
}

/** Returns the provider-style device id of one field-shape device. */
export function fieldShapeDeviceId(deviceIndex) {
  return String(7001 + deviceIndex)
}

/**
 * Builds the frozen plan for one field-shape preset.
 *
 * @param {string} preset
 * @param {{devices: object[]}} definition
 */
function createFieldShapePlan(preset, definition) {
  const devices = definition.devices.map((device, index) => {
    if (device.gap !== undefined && device.gap.durationMs <= FIELD_COUNT_LIMITS.lineBreakMs) {
      throw new Error(`Field-shape preset ${preset} gap must exceed the 30-minute line break.`)
    }
    if (device.lateBlock !== undefined
        && device.lateBlock.fromFix + device.lateBlock.fixCount > device.fixCount) {
      throw new Error(`Field-shape preset ${preset} late block runs past the device's last fix.`)
    }
    return Object.freeze({
      deviceIndex: index,
      deviceId: fieldShapeDeviceId(index),
      name: `SYNTHETIC SEARCHER ${String(index + 1).padStart(2, '0')}`,
      fixCount: device.fixCount,
      cadenceMs: device.cadenceMs,
      gap: device.gap === undefined ? null : Object.freeze({ ...device.gap }),
      lateBlock: device.lateBlock === undefined ? null : Object.freeze({ ...device.lateBlock }),
    })
  })
  const lastFixMs = Math.max(...devices.map((device) => fieldShapeFixTimeMs(device, device.fixCount - 1)))
  return Object.freeze({
    preset,
    mode: 'field-shape',
    deviceCount: devices.length,
    activePositionDeviceCount: devices.length,
    pollIntervalMs: Math.min(...devices.map((device) => device.cadenceMs)),
    autosaveIntervalMs: DEFAULT_AUTOSAVE_INTERVAL_MS,
    restartCheckpointsDays: [],
    targetBytes: null,
    durationDays: (lastFixMs - FIELD_SHAPE_START_MS) / DAY_MS,
    pollCount: Math.max(...devices.map((device) => device.fixCount)),
    positionCount: devices.reduce((sum, device) => sum + device.fixCount, 0),
    deviceUpdatedEventCount: 0,
    positionRecordedEventCount: 0,
    backupEventCount: 0,
    missionStartTime: new Date(FIELD_SHAPE_START_MS).toISOString(),
    fieldDevices: Object.freeze(devices),
  })
}

/** Fix time in ms of one field-shape fix: cadence steps, plus the gap once passed. */
function fieldShapeFixTimeMs(device, fixIndex) {
  const gapMs = device.gap !== null && fixIndex >= device.gap.afterFix ? device.gap.durationMs : 0
  return FIELD_SHAPE_START_MS + (fixIndex + 1) * device.cadenceMs + gapMs
}

/**
 * Returns one deterministic synthetic fix of a field-shape device.
 *
 * @param {ReturnType<typeof createFixturePlan>} plan a field-shape plan
 * @param {number} deviceIndex
 * @param {number} fixIndex 0-based, in fix-time order
 * @returns {{sourcePositionId: string, deviceId: string, lat: number, lon: number, timestamp: string, receivedAt: string, late: boolean}}
 */
export function fieldShapeFix(plan, deviceIndex, fixIndex) {
  const device = plan?.fieldDevices?.[deviceIndex]
  if (device === undefined) throw new Error(`Field-shape device ${deviceIndex} is not in this plan.`)
  if (!Number.isSafeInteger(fixIndex) || fixIndex < 0 || fixIndex >= device.fixCount) {
    throw new Error(`Field-shape fix index ${fixIndex} is outside 0..${device.fixCount - 1}.`)
  }
  const timeMs = fieldShapeFixTimeMs(device, fixIndex)
  const steps = (timeMs - FIELD_SHAPE_START_MS) / 3_000
  const late = device.lateBlock !== null
    && fixIndex >= device.lateBlock.fromFix
    && fixIndex < device.lateBlock.fromFix + device.lateBlock.fixCount
  return {
    sourcePositionId: String((deviceIndex + 1) * 10_000_000 + fixIndex),
    deviceId: device.deviceId,
    lat: Number((53.0 + deviceIndex * 0.002 + steps * FIELD_SHAPE_LAT_STEP_PER_3S).toFixed(7)),
    lon: Number((-6.4 + deviceIndex * 0.003 + 0.002 * Math.sin(steps / 400)).toFixed(7)),
    timestamp: new Date(timeMs).toISOString(),
    receivedAt: new Date(timeMs + (late ? device.lateBlock.delayMs : 0)).toISOString(),
    late,
  }
}

/**
 * Yields every fix of a field-shape plan in the order a provider would
 * deliver it: each device's prompt fixes in time order, then the late-uploaded
 * blocks last, in batches no larger than the store's write batch.
 *
 * @param {ReturnType<typeof createFixturePlan>} plan a field-shape plan
 * @param {number} [batchSize]
 * @returns {Generator<ReturnType<typeof fieldShapeFix>[]>}
 */
export function* fieldShapeWriteBatches(plan, batchSize = FIELD_COUNT_LIMITS.writeBatchRows) {
  if (plan?.mode !== 'field-shape') throw new Error('Field-shape write batches need a field-shape plan.')
  for (const late of [false, true]) {
    for (const device of plan.fieldDevices) {
      let batch = []
      for (let fixIndex = 0; fixIndex < device.fixCount; fixIndex += 1) {
        const fix = fieldShapeFix(plan, device.deviceIndex, fixIndex)
        if (fix.late !== late) continue
        batch.push(fix)
        if (batch.length === batchSize) {
          yield batch
          batch = []
        }
      }
      if (batch.length > 0) yield batch
    }
  }
}

/**
 * The truth a check compares against: per device, how many fixes, the first
 * and last fix times, and where the gap and late block are.
 *
 * @param {ReturnType<typeof createFixturePlan>} plan a field-shape plan
 */
export function createFieldShapeScenario(plan) {
  if (plan?.mode !== 'field-shape') throw new Error('Field-shape scenario needs a field-shape plan.')
  const devices = plan.fieldDevices.map((device) => {
    const first = fieldShapeFix(plan, device.deviceIndex, 0)
    const last = fieldShapeFix(plan, device.deviceIndex, device.fixCount - 1)
    return Object.freeze({
      deviceId: device.deviceId,
      name: device.name,
      fixCount: device.fixCount,
      cadenceMs: device.cadenceMs,
      firstTimestamp: first.timestamp,
      lastTimestamp: last.timestamp,
      gap: device.gap === null ? null : Object.freeze({
        from: fieldShapeFix(plan, device.deviceIndex, device.gap.afterFix - 1).timestamp,
        to: fieldShapeFix(plan, device.deviceIndex, device.gap.afterFix).timestamp,
      }),
      lateBlock: device.lateBlock === null ? null : Object.freeze({
        fixCount: device.lateBlock.fixCount,
        from: fieldShapeFix(plan, device.deviceIndex, device.lateBlock.fromFix).timestamp,
        to: fieldShapeFix(plan, device.deviceIndex, device.lateBlock.fromFix + device.lateBlock.fixCount - 1).timestamp,
        delayMs: device.lateBlock.delayMs,
      }),
    })
  })
  return Object.freeze({
    syntheticCoordinatesOnly: true,
    missionStartTime: plan.missionStartTime,
    acceptedPositionCount: plan.positionCount,
    devices: Object.freeze(devices),
  })
}

/**
 * Builds an immutable fixture plan. Duration presets model the previously observed
 * beta.11 write amplification: one device heartbeat per device per poll, a position
 * plus redundant audit echo for eight active devices, and one backup event per
 * autosave interval. Target-size presets use the same ratios until the requested
 * on-disk size is reached.
 */
export function createFixturePlan(preset) {
  if (Object.hasOwn(FIELD_SHAPE_PRESET_DEFINITIONS, preset)) {
    return createFieldShapePlan(preset, FIELD_SHAPE_PRESET_DEFINITIONS[preset])
  }
  const definition = PRESET_DEFINITIONS[preset] ?? PAGING_PRESET_DEFINITIONS[preset]
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
      positionRecordedEventCount: definition.legacyPositionAudit ? definition.positionCount - 12 : 0,
      backupEventCount: 0,
      pollIntervalMs: Math.floor(
        (definition.durationDays * DAY_MS) / pollCount,
      ),
      groupCount: definition.groupCount,
      outingCount: definition.outingCount,
      qualification: definition.qualification,
      missionModelScenario: true,
      ...(definition.backfillScenario ? { backfillScenario: definition.backfillScenario } : {}),
      ...(definition.legacyPositionAudit ? {
        legacyPositionAudit: true,
        minimumDatabaseBytes: definition.minimumDatabaseBytes,
      } : {}),
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
      Object.freeze({ deviceId: 'synthetic-device-095', completed: plan.backfillScenario === 'synthetic-complete' }),
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
  if (plan.mode === 'field-shape') return FIELD_SHAPE_FIXTURE_GENERATOR_VERSION
  if (plan.backfillScenario === 'synthetic-complete') return PAGING_FIXTURE_GENERATOR_VERSION
  return plan.mode === 'breadcrumb-programme'
    ? FIXTURE_GENERATOR_VERSION
    : LEGACY_FIXTURE_GENERATOR_VERSION
}

/** Shapes the durable manifest written beside every generated fixture. */
export function buildFixtureManifest(input) {
  const plan = input.plan
  if (plan.minimumDatabaseBytes !== undefined && input.databaseBytes < plan.minimumDatabaseBytes) {
    throw new Error(`Generated fixture is below its minimum ${plan.minimumDatabaseBytes} database bytes.`)
  }
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
      ...(plan.backfillScenario ? { backfillScenario: plan.backfillScenario } : {}),
      ...(plan.legacyPositionAudit ? {
        storageProfile: 'synthetic-beta11-position-audit-echoes',
        minimumDatabaseBytes: plan.minimumDatabaseBytes,
      } : {}),
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
