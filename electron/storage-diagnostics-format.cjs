const { createEmptyMissionState, number } = require('./storage-diagnostics-state.cjs')

/** Formats only stable numeric and enum fields for the incident support bundle. */
function formatStorageDiagnostics(snapshot) {
  const mission = snapshot.mission ?? createEmptyMissionState()
  const files = snapshot.fileSizes ?? {}
  const active = snapshot.activeOperation ?? null
  const interrupted = snapshot.previousInterruptedOperation ?? null
  const completed = snapshot.lastCompletedOperation ?? null
  const failed = snapshot.lastFailedOperation ?? null
  const eventLoop = snapshot.eventLoop ?? { latest: null, maximumObservedDelayMs: 0 }
  const validation = snapshot.validation ?? null
  return [
    '[storage-diagnostics]',
    `checkpoint version: ${number(snapshot.version)}`,
    `schema version: ${optionalNumber(snapshot.schemaVersion, 'unknown')}`,
    `validation mode: ${validation === null ? 'no' : 'yes'}`,
    `validation fixture preset: ${validation?.preset ?? 'none'}`,
    `validation generator version: ${number(validation?.generatorVersion)}`,
    `validation fixture sha256: ${validation?.fixtureSha256 ?? 'none'}`,
    `active operation: ${active === null ? 'none' : `${active.type} ${active.stage}`}`,
    `previous interrupted operation: ${interrupted === null ? 'none' : `${interrupted.type} ${interrupted.stage}`}`,
    `last completed operation: ${completed === null ? 'none' : completed.type}`,
    `last completed duration ms: ${number(completed?.totalDurationMs)}`,
    `last failed operation: ${failed === null ? 'none' : `${failed.type} ${failed.stage}`}`,
    `last failure category: ${failed?.errorName ?? 'none'}`,
    `database bytes: ${number(files.databaseBytes)}`,
    `wal bytes: ${number(files.walBytes)}`,
    `backup bytes: ${number(files.backupBytes)}`,
    `temporary snapshot bytes: ${number(files.temporarySnapshotBytes)}`,
    `temporary snapshot count: ${number(files.temporarySnapshotCount)}`,
    `elapsed duration ms: ${number(mission.elapsedDurationMs)}`,
    `configured polling cadence ms: ${optionalNumber(mission.configuredPollIntervalMs, 'not configured')}`,
    `observed polling cadence ms: ${optionalNumber(mission.observedPollCadenceMs, 'not observed')}`,
    `observed poll count: ${number(mission.observedPollCount)}`,
    `current device count: ${number(mission.currentDeviceCount)}`,
    `peak device count: ${number(mission.peakDeviceCount)}`,
    `inserted positions: ${number(mission.insertedPositionCount)}`,
    `changed device events: ${number(mission.changedDeviceEventCount)}`,
    `position telemetry events: ${number(mission.positionTelemetryEventCount)}`,
    `restart count: ${number(mission.restartCount)}`,
    `database growth bytes: ${number(mission.databaseGrowthBytes)}`,
    `event loop latest maximum delay ms: ${optionalNumber(eventLoop.latest?.maximumDelayMs, 'not observed')}`,
    `event loop peak delay ms: ${number(eventLoop.maximumObservedDelayMs)}`,
  ].join('\n')
}

function optionalNumber(input, fallback) {
  return input === null || input === undefined ? fallback : number(input)
}

module.exports = {
  formatStorageDiagnostics,
}
