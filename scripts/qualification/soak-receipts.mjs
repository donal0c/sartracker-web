import {
  buildTrackingSoakVerdict,
  createTrackingSoakProfile,
} from '../../build/electron-tracking-soak-lib.js'
import { validateCompetingOperationEvidence } from './competing-operation-probe.mjs'

const SHA256 = /^[a-f0-9]{64}$/u
const SUPPORTED_CONTRACTS = new Set(['C04', 'C24', 'C25'])
const WORKLOAD_CLASSES = new Set(['ci', 'long-duration', 'field-scale'])
const PACKAGE_TIERS = new Set(['ci-appimage', 'installed-deb', 'unpacked-electron'])
const NORMAL_PREFIX_BATCH = 480

/** Return the fixed source barrier placement used by the packaged priority lane. */
export function expectedSoakPrioritySource(contractId, profile, workloadClass) {
  if (contractId === 'C25') return null
  if (contractId !== 'C04' && contractId !== 'C24') {
    throw new Error('Priority source barriers are only defined for C04 and C24.')
  }
  if (profile === null || typeof profile !== 'object' ||
      !Number.isSafeInteger(profile.deviceCount) || !Number.isSafeInteger(profile.actualBatches)) {
    throw new Error('Priority source barrier binding requires an immutable soak profile.')
  }
  return Object.freeze({
    // C24 defers its operation-phase barrier until the complete CI/field
    // population is present; C04 observes its priority lane at batch three.
    batch: contractId === 'C24' ? profile.actualBatches : 3,
    versionCount: 2,
  })
}

/** Mandatory packaged soak variants; one valid variant never closes this family map. */
export const SOAK_MANDATORY_VARIANTS = Object.freeze({
  C04: Object.freeze([
    { variantId: 'ci', proofMode: 'ci-appimage' },
    { variantId: 'priority-100', proofMode: 'ci-appimage' },
    { variantId: 'ci-installed', proofMode: 'installed-deb' },
    { variantId: 'priority-100-installed', proofMode: 'installed-deb' },
  ].map(Object.freeze)),
  C24: Object.freeze(['ci', 'field-960k', 'field-2m', 'field-local-1gib'].flatMap((variantId) => [
    Object.freeze({ variantId, proofMode: 'ci-appimage' }),
    Object.freeze({ variantId: `${variantId}-installed`, proofMode: 'installed-deb' }),
  ])),
  C25: Object.freeze([
    { variantId: 'normal', proofMode: 'ci-appimage' },
    { variantId: 'extended', proofMode: 'ci-appimage' },
    { variantId: 'field-960k', proofMode: 'ci-appimage' },
    { variantId: 'field-2m', proofMode: 'ci-appimage' },
    { variantId: 'field-local-1gib', proofMode: 'ci-appimage' },
    { variantId: 'field-device-modes', proofMode: 'ci-appimage' },
    { variantId: 'normal-installed', proofMode: 'installed-deb' },
    { variantId: 'extended-installed', proofMode: 'installed-deb' },
    { variantId: 'field-960k-installed', proofMode: 'installed-deb' },
    { variantId: 'field-2m-installed', proofMode: 'installed-deb' },
    { variantId: 'field-local-1gib-installed', proofMode: 'installed-deb' },
    { variantId: 'field-device-modes-installed', proofMode: 'installed-deb' },
  ].map(Object.freeze)),
})

const UNCOVERED_AXES = Object.freeze({
  C04: Object.freeze([
    'current-position visibility versus held historical work is not independently recorded',
    '100-device and bounded live-provider variants are absent from the producer',
    'browser, exact AppImage and installed-deb variants require separate adapters',
  ]),
  C24: Object.freeze([
    'the fixed CI operation phase covers representative public surfaces only; 960k/2m/1GiB/3.7GB scale and cold/warm package variants remain separate',
    'DON-249/250/251 integrity, retention and background scheduling capabilities are product-owner blockers and are not claimed by this receipt',
    'live-provider, browser, exact AppImage and installed-deb evidence remain separate campaign variants',
  ]),
  C25: Object.freeze([
    'field variants provide 100 devices, 12 synthetic outings and 960k/2m position rows; the existing 2GiB maximum resident ceiling accepts lower observed memory',
    'the local-1GiB and field-3.7GB fixture identities are synthetic bound inputs; original field-host execution remains external',
    'the 12 outings are closed synthetic windows and do not establish a twelve-day wall-clock/provider history',
    'stationary/stale-device and archive-failure/restart lanes are deterministic synthetic provider evidence; live provider and original-machine behavior remain separate',
    'installed-deb/AppImage parity and same-profile Mint evidence are absent; archive evidence remains synthetic',
    'one extended report does not replace the separate five-day, fourteen-day and field-scale campaign rows',
  ]),
})

/** Identify a record without accepting arrays at an evidence boundary. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Require a plain object before reading an evidence boundary. */
function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

/** Require a nonempty bounded string for an independently bound identity. */
function text(value, label) {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 || value.length > 256) {
    throw new Error(`${label} must be a bounded nonempty string.`)
  }
  return value
}

/** Require one of the closed values used by the qualification boundary. */
function choice(value, allowed, label) {
  text(value, label)
  if (!allowed.has(value)) throw new Error(`${label} is not an allowed value.`)
  return value
}

/** Require a finite integer in the independent campaign binding. */
function integer(value, label, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}.`)
  }
  return value
}

/** Require a SHA-256 identity without accepting a report-provided prefix. */
function sha256(value, label) {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest.`)
  return value
}

/** Validate the independent expected facts before they can influence a verdict. */
function validateExpected(contractId, expected) {
  if (!SUPPORTED_CONTRACTS.has(contractId)) throw new Error('Soak receipt contract must be C04, C24, or C25.')
  object(expected, 'Expected soak binding')
  const profile = createTrackingSoakProfile(expected.profileName)
  const source = object(expected.source, 'Expected source binding')
  integer(source.baseTimeMs, 'Expected source baseTimeMs')
  integer(source.intervalMs, 'Expected source intervalMs', 1)
  integer(source.normalPrefixBatch, 'Expected source normalPrefixBatch', 1)
  if (source.normalPrefixBatch !== NORMAL_PREFIX_BATCH) throw new Error('Expected source normalPrefixBatch is not the frozen 480-batch boundary.')
  sha256(source.fullSha256, 'Expected source fullSha256')
  sha256(source.normalPrefixSha256, 'Expected source normalPrefixSha256')
  const artifact = object(expected.artifact, 'Expected artifact binding')
  text(artifact.basename, 'Expected artifact basename')
  sha256(artifact.sha256, 'Expected artifact sha256')
  choice(artifact.packageTier, PACKAGE_TIERS, 'Expected package tier')
  if (expected.variantId !== undefined) {
    text(expected.variantId, 'Expected variant ID')
    const required = SOAK_MANDATORY_VARIANTS[contractId].find((entry) => entry.variantId === expected.variantId)
    if (required === undefined || required.proofMode !== artifact.packageTier) {
      throw new Error('Expected soak variant or package tier is not in the mandatory family map.')
    }
  }
  const process = object(expected.process, 'Expected process binding')
  text(process.tier, 'Expected process tier')
  sha256(process.executableSha256, 'Expected process executableSha256')

  const platform = object(expected.platform, 'Expected platform binding')
  text(platform.os, 'Expected platform OS')
  text(platform.architecture, 'Expected platform architecture')
  const workload = object(expected.workload, 'Expected workload binding')
  choice(workload.class, WORKLOAD_CLASSES, 'Expected workload class')
  integer(workload.minimumEquivalentProductionPolls, 'Expected minimum equivalent production polls', 1)
  integer(workload.minimumDeviceCount, 'Expected minimum device count', 1)
  if (workload.class === 'field-scale') {
    integer(workload.minimumPositionRows, 'Expected minimum field position rows', 1)
    integer(workload.expectedOutingCount, 'Expected field outing count', 1)
    integer(workload.maximumResidentBytes, 'Expected maximum resident bytes', 1)
    integer(workload.minimumFixtureBytes, 'Expected minimum fixture bytes', 1)
    text(workload.fixturePreset, 'Expected fixture preset')
    if (isRecord(workload.deviceModes)) {
      for (const mode of ['moving', 'stationary', 'stale']) integer(workload.deviceModes[mode], `Expected ${mode} device count`)
      if (workload.deviceModes.moving + workload.deviceModes.stationary + workload.deviceModes.stale !== workload.minimumDeviceCount) {
        throw new Error('Expected field device modes must partition the minimum device count.')
      }
    }
    if (profile.staleDeviceCount > 0 && (!isRecord(workload.deviceModes)
        || workload.deviceModes.moving !== profile.movingDeviceCount
        || workload.deviceModes.stationary !== profile.stationaryDeviceCount
        || workload.deviceModes.stale !== profile.staleDeviceCount)) {
      throw new Error('Expected stationary/stale field device modes are not bound to the profile.')
    }
    const fixture = object(workload.fieldFixture, 'Expected field fixture binding')
    text(fixture.basename, 'Expected field fixture basename')
    integer(fixture.bytes, 'Expected field fixture bytes', workload.minimumFixtureBytes)
    sha256(fixture.sha256, 'Expected field fixture sha256')
    if (fixture.preset !== workload.fixturePreset) throw new Error('Expected field fixture preset differs from the workload binding.')
  }
  if (workload.class === 'long-duration') {
    integer(workload.minimumArchiveCycles, 'Expected minimum archive cycles', 1)
  }
  if (contractId === 'C25' && workload.class === 'ci') {
    throw new Error('C25 long-duration/field-scale binding cannot use the CI workload class.')
  }
  if (contractId === 'C24') {
    integer(workload.minimumArchiveCycles, 'Expected C24 archive cycles', 1)
  }
  if (contractId === 'C04' && workload.class !== 'ci' || contractId === 'C24' && workload.class === 'long-duration') {
    throw new Error(`${contractId} soak binding must declare the CI workload class for this producer.`)
  }
  let prioritySource = null
  if (source.prioritySource !== undefined) {
    const supplied = object(source.prioritySource, 'Expected source prioritySource')
    integer(supplied.batch, 'Expected source priority batch', 1)
    integer(supplied.versionCount, 'Expected source priority versionCount', 1)
    if (supplied.versionCount !== 2) throw new Error('Expected source priority versionCount is not the frozen two-barrier protocol.')
    prioritySource = expectedSoakPrioritySource(contractId, profile, workload.class)
    if (supplied.batch !== prioritySource.batch) {
      throw new Error('Expected source priority batch is not the fixed phase boundary for this contract/workload.')
    }
  }

  const missionModel = object(expected.missionModel, 'Expected mission model binding')
  if (typeof missionModel.enabled !== 'boolean') throw new Error('Expected mission model enabled flag is invalid.')
  integer(missionModel.expectedParticipantRows, 'Expected participant rows')
  integer(missionModel.expectedParticipantAddedEvents, 'Expected participant-added events')
  const thresholds = object(expected.thresholds, 'Expected timing threshold binding')
  if (!Number.isFinite(thresholds.freezeThresholdMs) || thresholds.freezeThresholdMs <= 0
      || !Number.isFinite(thresholds.mainStallThresholdMs) || thresholds.mainStallThresholdMs <= 0) {
    throw new Error('Expected timing thresholds are invalid.')
  }
  return {
    contractId,
    profile,
    source: {
      ...source,
      prioritySource,
      expectedPositionRows: profile.expectedPositionRows +
        (prioritySource === null ? 0 : profile.deviceCount * prioritySource.versionCount),
    },
    artifact,
    process,
    platform,
    workload,
    missionModel,
    thresholds,
    ...(expected.variantId === undefined ? {} : { variantId: expected.variantId }),
  }
}

/** Compare the producer profile with the immutable profile from the existing soak library. */
function profileFailures(actual, expected) {
  const failures = []
  const fields = [
    'name', 'deviceCount', 'movingDeviceCount', 'stationaryDeviceCount', 'staleDeviceCount', 'durationDays', 'actualBatches',
    'productionPollsPerBatch', 'equivalentProductionPolls', 'expectedPositionRows',
    'recommendedPollIntervalMs',
  ]
  for (const field of fields) {
    if (actual?.[field] !== expected[field]) failures.push(`Profile ${field} is not independently bound.`)
  }
  if (expected.outingCount > 0 && actual?.outingCount !== expected.outingCount) {
    failures.push('Profile outing count is not independently bound.')
  }
  if (JSON.stringify(actual?.restartCheckpoints) !== JSON.stringify(expected.restartCheckpoints)) {
    failures.push('Profile restart checkpoints are not independently bound.')
  }
  return failures
}

/** Revalidate source counts and digests without consulting report.positionTruth claims. */
function sourceFailures(report, binding) {
  const failures = []
  const profile = binding.profile
  const databaseTruth = report?.database?.positionTruth
  const summaryTruth = report?.positionTruth?.actual
  if (JSON.stringify(databaseTruth) !== JSON.stringify(summaryTruth)) {
    failures.push('Database and top-level actual position truth disagree.')
  }
  const full = databaseTruth?.full
  const normalPrefix = databaseTruth?.normalPrefix
  const normalPrefixRows = Math.min(profile.actualBatches, binding.source.normalPrefixBatch) *
    profile.productionPollsPerBatch * profile.movingDeviceCount +
    (profile.deviceCount - profile.movingDeviceCount)
  if (full?.rowCount !== binding.source.expectedPositionRows || full?.missingSourcePositionIdentityRows !== 0
      || full?.sha256 !== binding.source.fullSha256) {
    failures.push('Full persisted position truth does not match the independently bound source.')
  }
  if (normalPrefix?.rowCount !== normalPrefixRows || normalPrefix?.missingSourcePositionIdentityRows !== 0
      || normalPrefix?.sha256 !== binding.source.normalPrefixSha256
      || databaseTruth?.normalPrefixBatch !== binding.source.normalPrefixBatch) {
    failures.push('Normal-prefix position truth does not match the independently bound source.')
  }
  if (report?.fixtureClock?.baseTimeMs !== binding.source.baseTimeMs
      || report?.fixtureClock?.intervalMs !== binding.source.intervalMs) {
    failures.push('Fixture clock is not bound to the independent source facts.')
  }
  return failures
}

/** Require package/process and threshold receipts which the current producer does not yet emit. */
function runtimeBindingFailures(report, binding) {
  const failures = []
  if (report?.app?.basename !== binding.artifact.basename || report?.app?.sha256 !== binding.artifact.sha256) {
    failures.push('Packaged artifact basename or SHA-256 is not independently bound.')
  }
  if (report?.package?.tier !== binding.artifact.packageTier) {
    failures.push('Independent package tier evidence is missing or differs.')
  }
  if (report?.process?.tier !== binding.process.tier
      || report?.process?.executableSha256 !== binding.process.executableSha256) {
    failures.push('Independent launched-process tier or executable identity is missing or differs.')
  }
  if (report?.platform?.os !== binding.platform.os || report?.platform?.architecture !== binding.platform.architecture) {
    failures.push('Platform identity is not independently bound.')
  }
  if (report?.thresholds?.freezeThresholdMs !== binding.thresholds.freezeThresholdMs
      || report?.thresholds?.mainStallThresholdMs !== binding.thresholds.mainStallThresholdMs) {
    failures.push('Timing threshold identity is not retained by the report.')
  }
  return failures
}

/** Require raw field-scale custody facts without accepting a producer verdict flag. */
function fieldResourceFailures(report, binding) {
  if (binding.workload.class !== 'field-scale') return []
  const failures = []
  const raw = report?.rawResourceMetrics
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['Field-scale raw resource metrics are missing.']
  }
  const profile = raw.profile
  if (profile?.name !== binding.profile.name || profile?.deviceCount !== binding.profile.deviceCount ||
      profile?.equivalentProductionPolls !== binding.profile.equivalentProductionPolls ||
      profile?.expectedPositionRows !== binding.profile.expectedPositionRows ||
      profile?.outingCount !== binding.workload.expectedOutingCount ||
      profile?.movingDeviceCount !== binding.profile.movingDeviceCount ||
      profile?.stationaryDeviceCount !== binding.profile.stationaryDeviceCount ||
      profile?.staleDeviceCount !== binding.profile.staleDeviceCount ||
      profile?.durationDays !== binding.profile.durationDays) {
    failures.push('Field-scale raw profile facts are not independently bound.')
  }
  const modes = report?.workloadModes
  if (modes?.durationDays !== binding.profile.durationDays
      || modes?.moving !== binding.profile.movingDeviceCount
      || modes?.stationary !== binding.profile.stationaryDeviceCount
      || modes?.stale !== binding.profile.staleDeviceCount) {
    failures.push('Field-scale moving/stationary/stale workload modes are not independently bound.')
  }
  const database = raw.database
  const requiredDatabaseFields = ['positionRows', 'outingRows', 'databaseFileBytes', 'walFileBytes', 'shmFileBytes']
  for (const field of requiredDatabaseFields) {
    if (!Number.isSafeInteger(database?.[field]) || database[field] < 0) {
      failures.push(`Field-scale raw database ${field} is missing.`)
    }
  }
  if (database?.positionRows !== binding.source.expectedPositionRows) {
    failures.push('Field-scale raw position rows do not match the independently bound variant.')
  }
  if (database?.outingRows !== binding.workload.expectedOutingCount) {
    failures.push('Field-scale outing rows do not match the independently bound count.')
  }
  const fixture = raw.fieldFixture
  if (fixture?.basename !== binding.workload.fieldFixture.basename
      || fixture?.bytes !== binding.workload.fieldFixture.bytes
      || fixture?.sha256 !== binding.workload.fieldFixture.sha256
      || fixture?.preset !== binding.workload.fixturePreset
      || fixture?.minimumBytes !== binding.workload.minimumFixtureBytes) {
    failures.push('Field-scale raw fixture custody does not match the independently bound storage fixture.')
  }
  const fixtureLoad = raw.fieldFixtureLoad
  if (!isRecord(fixtureLoad)
      || fixtureLoad.runtimeDatabaseBasename !== 'mission-store.sqlite'
      || fixtureLoad.runtimeDatabaseBytes !== binding.workload.fieldFixture.bytes
      || fixtureLoad.runtimeDatabaseSha256 !== binding.workload.fieldFixture.sha256
      || typeof fixtureLoad.fixtureMissionId !== 'string'
      || fixtureLoad.fixtureMissionStatusBefore !== 'active'
      || fixtureLoad.fixtureMissionStatusAfter !== 'finished'
      || typeof fixtureLoad.workloadMissionId !== 'string') {
    failures.push('Field-scale fixture was not shown loaded into the runtime database and exercised before the workload mission.')
  }
  const process = raw.process
  if (!Number.isSafeInteger(process?.maximumResidentBytes) || process.maximumResidentBytes < 0 ||
      !Number.isSafeInteger(process?.sampleCount) || process.sampleCount < 1) {
    failures.push('Field-scale raw process resource metrics are missing.')
  } else if (process.maximumResidentBytes > binding.workload.maximumResidentBytes) {
    failures.push('Field-scale raw resident bytes exceed the independently bound maximum resident budget.')
  }
  return failures
}

/** Require archive cycles that ran alongside the active long-duration mission. */
function archiveCycleFailures(report, binding) {
  const requiredFor = binding.contractId === 'C24' ? 'C24' : 'long-duration C25'
  if (binding.workload.class !== 'long-duration' && binding.contractId !== 'C24') return []
  const archive = report?.archiveCycles
  if (archive === null || typeof archive !== 'object' || Array.isArray(archive)) {
    return [`${requiredFor} archive-cycle observations are missing.`]
  }
  const expectedCount = binding.workload.minimumArchiveCycles
  const entries = archive.entries
  const failures = []
  if (!Number.isSafeInteger(archive.expectedCount) || archive.expectedCount !== expectedCount) {
    failures.push(`${requiredFor} archive-cycle expected count is not independently bound.`)
  }
  if (!Number.isSafeInteger(archive.completedCount) || archive.completedCount < expectedCount) {
    failures.push(`${requiredFor} archive cycles require at least ${expectedCount} completed cycles.`)
  }
  if (!Array.isArray(entries) || entries.length < expectedCount) {
    failures.push(`${requiredFor} archive-cycle entries are incomplete.`)
    return failures
  }
  for (const [index, entry] of entries.slice(0, expectedCount).entries()) {
    if (entry?.observedWhileTracking !== true || entry?.missionStatusBefore !== 'finished'
        || entry?.missionStatusAfter !== 'finalized' || entry?.archiveStatus !== 'verified'
        || entry?.archiveAvailability !== 'present' || !Array.isArray(entry?.createProgressPhases)
        || !Array.isArray(entry?.verifyProgressPhases)) {
      failures.push(`${requiredFor} archive cycle ${index + 1} is not a verified while-tracking cycle.`)
    }
  }
  const recovery = report?.archiveFailureRecovery
  if (recovery?.observedWhileTracking !== true || recovery?.observedAfterRestart !== true
      || recovery?.failureAttempted !== true || recovery?.failureRejected !== true
      || recovery?.recoverySucceeded !== true || recovery?.missionStatusAfter !== 'finalized'
      || recovery?.archiveStatus !== 'verified' || recovery?.archiveAvailability !== 'present'
      || !Array.isArray(recovery?.createProgressPhases) || !Array.isArray(recovery?.verifyProgressPhases)) {
    failures.push(`${requiredFor} archive failure/restart recovery evidence is incomplete.`)
  }
  return failures
}

/** Build the existing pure verdict input from report observations, ignoring report.verdict. */
function verdictInput(report, binding, sourcePass) {
  const profile = profileWithPriorityBarrierRows(binding.profile, binding.source.prioritySource)
  const database = report?.database ?? {}
  const events = database.events ?? {}
  const missionModel = report?.missionModel ?? {}
  const responsiveness = report?.responsiveness ?? {}
  const mainProcess = responsiveness.mainProcess ?? {}
  const renderer = responsiveness.renderer ?? {}
  const operator = responsiveness.operatorInteractions ?? {}
  const actionTiming = operator.actionTiming ?? {}
  const externalActionTiming = operator.externalActionTiming ?? {}
  const backupCycles = Number(events.mission_backup_synced)
  const declaredOperationalEventBudget = profile.deviceCount + 1 +
    (binding.missionModel.enabled ? 1 : 0) +
    binding.missionModel.expectedParticipantAddedEvents +
    profile.restartCheckpoints.length * 2 +
    (profile.name === 'extended' ? profile.restartCheckpoints.length * 2 + 1 : 0) +
    profile.outingCount * 2 +
    Number(database.participantBackfillCompletedEvents) + backupCycles +
    (binding.contractId === 'C24' ? 2 : 0)
  return {
    profile,
    observedBatches: report?.mockTraccar?.completedBatches,
    deviceRows: database.deviceRows,
    positionRows: database.positionRows,
    deviceCreatedEvents: events.device_created,
    deviceUpdatedEvents: events.device_updated ?? 0,
    positionRecordedEvents: events.position_recorded ?? 0,
    operationalMissionEvents: database.operationalMissionEvents,
    declaredOperationalEventBudget,
    unexplainedMissionEvents: database.unexplainedMissionEvents,
    restartCheckpointsPassed: report?.restartCheckpointsPassed,
    backupCycles,
    mainHeartbeatSamples: mainProcess.count,
    mainHeartbeatErrors: report?.launches?.reduce((sum, launch) => sum + Number(launch?.mainHeartbeatErrors ?? 0), 0),
    mainEventLoopLaunches: responsiveness.independentMainEventLoops,
    mainMaximumMs: mainProcess.maxMs,
    mainStallThresholdMs: binding.thresholds.mainStallThresholdMs,
    rendererSamples: renderer.count,
    rendererLaunchSampleCounts: report?.launches?.map((launch) => launch?.rendererSampleCount ?? 0),
    rendererMaximumMs: renderer.maxMs,
    rendererCrashes: report?.rendererCrashes,
    operatorInteractionSamples: operator.count,
    operatorInteractionErrors: operator.errors,
    operatorInteractionMaximumMs: operator.maxMs,
    operatorActionSamples: actionTiming.count,
    operatorActionMaximumMs: actionTiming.maxMs,
    operatorExternalActionSamples: externalActionTiming.count,
    operatorExternalActionMaximumMs: externalActionTiming.maxMs,
    webGlRendererAttested: report?.webGlRendererAttestation?.passed,
    maximumProcessTreeResidentBytes: report?.processMemory?.maximumProcessTreeResidentBytes,
    freezeThresholdMs: binding.thresholds.freezeThresholdMs,
    integrityResult: database.integrityResult,
    walCheckpointBusy: database.walCheckpoint?.busy,
    supportBundleInspected: report?.boundedEvidence?.supportBundleRedacted !== undefined,
    supportBundleRedacted: report?.boundedEvidence?.supportBundleRedacted,
    runtimeLogBytes: report?.boundedEvidence?.runtimeLogBytes,
    supportBundleBytes: report?.boundedEvidence?.supportBundleBytes,
    positionTruthExactMatch: sourcePass.full,
    normalPrefixTruthExactMatch: sourcePass.normalPrefix,
    missingSourcePositionIdentityRows: databaseTruthMissingRows(database),
    exactDotProof: report?.exactDotProof,
    finalLineTotalAudit: report?.finalLineTotalAudit,
    // Keep the mission model check visible to callers without turning its
    // producer-declared booleans into the verdict authority.
    missionModelBindingPass: missionModel.enabled === binding.missionModel.enabled &&
      missionModel.expectedParticipantRows === binding.missionModel.expectedParticipantRows &&
      missionModel.expectedParticipantAddedEvents === binding.missionModel.expectedParticipantAddedEvents,
  }
}

/** Apply only the independently bound priority barrier rows to pure row-count predicates. */
function profileWithPriorityBarrierRows(profile, prioritySource) {
  if (prioritySource === null) return profile
  return {
    ...profile,
    expectedPositionRows: profile.expectedPositionRows + profile.deviceCount * prioritySource.versionCount,
  }
}

function databaseTruthMissingRows(database) {
  return database?.positionTruth?.full?.missingSourcePositionIdentityRows
}

/** Recompute source-arrival to packaged latest-position latency by exact identity. */
function sourceCurrentLatencyFailures(evidence, expectedDeviceCount, thresholdMs) {
  const failures = []
  const source = evidence?.source
  const packaged = evidence?.packaged
  const responses = source?.currentResponses
  const snapshots = [packaged?.initial, packaged?.currentWhileHistoryHeld, packaged?.currentAfterReconnect]
  const observations = evidence?.sourceCurrentObservations
  if (!Array.isArray(responses) || responses.length === 0
      || !Array.isArray(observations) || observations.length !== snapshots.length) {
    return ['Independent source-arrival and packaged current-position observations are missing.']
  }
  const expectedDeviceIds = new Set(Array.from({ length: expectedDeviceCount }, (_, index) => String(index + 1)))
  const responseSequences = new Set()
  for (const response of responses) {
    if (response?.kind !== 'current' || (response.status !== 200 && response.status !== 503)) {
      failures.push('Source current response custody contains an unexpected provider status or kind.')
      continue
    }
    if (response.status === 503) {
      continue
    }
    if (response.status !== 200
        || !Number.isSafeInteger(response.sourceResponseSequence)
        || response.sourceResponseSequence < 1
        || responseSequences.has(response.sourceResponseSequence)
        || !Number.isSafeInteger(response.sourceArrivalAtMs)
        || !Array.isArray(response.sourcePositions)) {
      failures.push('Source current success custody is missing a unique sequence, arrival time or source positions.')
      continue
    }
    responseSequences.add(response.sourceResponseSequence)
    const seen = new Set()
    const seenDevices = new Set()
    for (const position of response.sourcePositions) {
      const key = `${position?.deviceId ?? ''}::${position?.sourcePositionId ?? ''}`
      if (typeof position?.deviceId !== 'string' || typeof position?.sourcePositionId !== 'string'
          || !expectedDeviceIds.has(position.deviceId) || seen.has(key)) {
        failures.push('Source current response contains an invalid or duplicate device/source-position identity.')
      }
      seen.add(key)
      seenDevices.add(position?.deviceId)
    }
    if (seenDevices.size !== expectedDeviceCount ||
        [...expectedDeviceIds].some((deviceId) => !seenDevices.has(deviceId))) {
      failures.push('Source current response does not contain exactly one source position for every expected device.')
    }
  }
  const derivedLatencies = []
  let previousSourceKeys = null
  let previousMaximumResponseSequence = 0
  for (const [index, snapshot] of snapshots.entries()) {
    const observation = observations[index]
    if (!isRecord(snapshot) || !Number.isSafeInteger(snapshot.observedAtMs)
        || !Array.isArray(snapshot.positionBindings) || snapshot.positionBindings.length !== expectedDeviceCount
        || !isRecord(observation) || observation.label !== ['initial-current', 'history-hold-current', 'current-reconnect'][index]
        || observation.observedAtMs !== snapshot.observedAtMs
        || JSON.stringify(observation.positionBindings) !== JSON.stringify(snapshot.positionBindings)
        || !Array.isArray(observation.matchedSourceArrivals)
        || observation.matchedSourceArrivals.length !== expectedDeviceCount) {
      failures.push(`Packaged current observation ${index + 1} is missing exact source-position bindings.`)
      continue
    }
    const observedKeys = new Set()
    const expectedMatches = []
    for (const position of snapshot.positionBindings) {
      const key = `${position?.deviceId ?? ''}::${position?.sourcePositionId ?? ''}`
      if (typeof position?.deviceId !== 'string' || typeof position?.sourcePositionId !== 'string'
          || !expectedDeviceIds.has(position.deviceId) || observedKeys.has(key)) {
        failures.push(`Packaged current observation ${index + 1} contains an invalid or duplicate identity.`)
        continue
      }
      observedKeys.add(key)
      if (observedKeys.size > expectedDeviceCount) {
        failures.push(`Packaged current observation ${index + 1} contains too many source identities.`)
      }
      const matching = responses
        .filter((response) => response.status === 200
          && response.sourceArrivalAtMs <= snapshot.observedAtMs
          && response.sourcePositions.some((sourcePosition) =>
            sourcePosition.deviceId === position.deviceId
            && sourcePosition.sourcePositionId === position.sourcePositionId))
        .sort((left, right) => left.sourceResponseSequence - right.sourceResponseSequence)
        .at(0)
      if (matching === undefined) {
        failures.push(`No source arrival precedes packaged current observation ${index + 1} for ${key}.`)
        continue
      }
      const latencyMs = snapshot.observedAtMs - matching.sourceArrivalAtMs
      if (!Number.isSafeInteger(latencyMs) || latencyMs < 0) {
        failures.push(`Source-to-current latency for ${key} is not a nonnegative bounded duration.`)
        continue
      }
      derivedLatencies.push(latencyMs)
      expectedMatches.push({
        deviceId: position.deviceId,
        sourcePositionId: position.sourcePositionId,
        sourceResponseSequence: matching.sourceResponseSequence,
        sourceArrivalAtMs: matching.sourceArrivalAtMs,
        latencyMs,
      })
    }
    const observedDeviceIds = new Set(snapshot.positionBindings.map((position) => position?.deviceId))
    if (observedDeviceIds.size !== expectedDeviceCount ||
        [...expectedDeviceIds].some((deviceId) => !observedDeviceIds.has(deviceId))) {
      failures.push(`Packaged current observation ${index + 1} does not contain exactly one row for every expected device.`)
    }
    if (JSON.stringify(observation.matchedSourceArrivals) !== JSON.stringify(expectedMatches)) {
      failures.push(`Packaged current observation ${index + 1} does not retain the independently recomputed source arrivals.`)
    }
    const currentSourceKeys = new Set(snapshot.positionBindings.map((position) =>
      `${position.deviceId}::${position.sourcePositionId}`))
    const currentMaximumResponseSequence = Math.max(
      ...expectedMatches.map((match) => match.sourceResponseSequence),
    )
    if (index > 0 && previousSourceKeys !== null
        && [...currentSourceKeys].every((key) => previousSourceKeys.has(key))) {
      failures.push(`Packaged current observation ${index + 1} did not contain a new source identity/version.`)
    }
    if (index > 0 && currentMaximumResponseSequence <= previousMaximumResponseSequence) {
      failures.push(`Packaged current observation ${index + 1} did not follow a newer source response.`)
    }
    previousSourceKeys = currentSourceKeys
    previousMaximumResponseSequence = currentMaximumResponseSequence
  }
  const measuredBarrierLatencies = derivedLatencies.filter((_, index) => index >= expectedDeviceCount)
  if (!Array.isArray(evidence.sourceToCurrentLatencyMs)
      || JSON.stringify(evidence.sourceToCurrentLatencyMs) !== JSON.stringify(measuredBarrierLatencies)) {
    failures.push('Source-to-current latency summary does not match the independently recomputed source arrivals.')
  }
  if (measuredBarrierLatencies.length !== expectedDeviceCount * 2 || measuredBarrierLatencies.some((value) => value >= thresholdMs)) {
    failures.push(`Independent source-to-current latency must have samples strictly below ${thresholdMs}ms.`)
  }
  return failures
}

/** Recompute packaged current/history priority facts from retained raw observations. */
function priorityFaultFailures(report, binding, contractId) {
  if (contractId !== 'C04' && contractId !== 'C24') return []
  const failures = []
  const evidence = report?.priorityFaultEvidence
  if (!isRecord(evidence) || evidence.schemaVersion !== 1 || evidence.status !== 'observed') {
    return ['C04/C24 priority-fault evidence is missing or was not observed.']
  }
  const source = evidence.source
  const packaged = evidence.packaged
  const expectedDeviceCount = binding.workload.minimumDeviceCount
  const expectedDeviceIds = Array.from({ length: expectedDeviceCount }, (_, index) => String(index + 1))
  if (binding.source.prioritySource !== null) {
    const observedPriority = source?.prioritySource
    if (!isRecord(observedPriority)
        || observedPriority.batch !== binding.source.prioritySource.batch
        || observedPriority.versionCount !== binding.source.prioritySource.versionCount) {
      failures.push('Priority source barrier batch/version is not independently bound to the fixed phase boundary.')
    }
  }
  if (!isRecord(source) || source.expectedDeviceCount !== expectedDeviceCount ||
      !Array.isArray(source.expectedDeviceIds) ||
      JSON.stringify([...source.expectedDeviceIds].sort()) !== JSON.stringify([...expectedDeviceIds].sort())) {
    failures.push('Priority-fault source device identity is not bound to the expected workload.')
  }
  if (source?.historyHoldStatus !== 503 || source?.currentOfflineStatus !== 503 || source?.currentReconnectStatus !== 200) {
    failures.push('Priority-fault provider did not retain independent history-hold, offline, and reconnect statuses.')
  }
  if (!isRecord(source?.provider) || source.provider.heldHistoryRequests < 1 ||
      source.provider.currentFailures < 1 || source.provider.currentSuccesses < 1) {
    failures.push('Priority-fault provider request counts do not prove held history with continued current polling.')
  }
  const snapshots = [packaged?.initial, packaged?.currentWhileHistoryHeld, packaged?.currentAfterReconnect]
  for (const [index, current] of snapshots.entries()) {
    if (!isRecord(current) || current.count < expectedDeviceCount || current.timestampCount < expectedDeviceCount ||
        !Array.isArray(current.deviceIds) || JSON.stringify([...new Set(current.deviceIds)].sort()) !== JSON.stringify([...expectedDeviceIds].sort())) {
      failures.push(`Priority-fault current snapshot ${index + 1} does not retain all expected device identities.`)
    }
  }
  const visibility = packaged?.visibility
  if (!Array.isArray(visibility) || visibility.length !== 2 ||
      visibility[0]?.deviceId !== '1' || visibility[0]?.action !== 'hide' || visibility[0]?.checkedBefore !== true || visibility[0]?.checkedAfter !== false ||
      visibility[1]?.deviceId !== '1' || visibility[1]?.action !== 'show' || visibility[1]?.checkedBefore !== false || visibility[1]?.checkedAfter !== true ||
      visibility.some((entry) => !Number.isFinite(entry?.durationMs) || entry.durationMs < 0)) {
    failures.push('Priority-fault packaged visibility evidence does not prove hide/show identity restoration.')
  }
  failures.push(...sourceCurrentLatencyFailures(
    evidence,
    expectedDeviceCount,
    binding.thresholds.mainStallThresholdMs,
  ))
  const operations = evidence.operations
  const cancellation = operations?.cancellation
  if (!isRecord(operations) || operations.competingHistoryAndCurrent !== true ||
      !isRecord(cancellation) || cancellation.started !== true || cancellation.cancelRequested !== true ||
      cancellation.clientSurface !== 'packaged-electron-mission-store-exact-dot-page' ||
      cancellation.queryApi !== 'listExactBreadcrumbDotPage' ||
      cancellation.cancelAccepted !== true || cancellation.queryOutcome !== 'cancelled'
      || cancellation.queryErrorClass !== 'breadcrumb-query-cancelled'
      || cancellation.positionCount !== null || cancellation.querySettled !== true
      || cancellation.cleanupCompleted !== true) {
    failures.push('Priority-fault competing operation did not retain a real in-flight cancellation, settled AbortError outcome and cleanup observations.')
  }
  const stages = Array.isArray(operations?.faultStages) ? new Set(operations.faultStages) : new Set()
  for (const stage of ['start', 'steady', 'cancel', 'fail', 'cleanup']) {
    if (!stages.has(stage)) failures.push(`Priority-fault operation stage ${stage} was not observed.`)
  }
  if (contractId === 'C24') {
    if (binding.workload.class === 'field-scale'
        && (!Number.isSafeInteger(evidence.workloadPositionRows)
          || evidence.workloadPositionRows < binding.workload.minimumPositionRows)) {
      failures.push('C24 competing operations did not observe the complete field workload before starting.')
    }
    const distributions = report?.rawResourceMetrics?.resourceDistributions
    if (!isRecord(distributions) || !Array.isArray(distributions.cpuProcessMs) || distributions.cpuProcessMs.length === 0 ||
        distributions.cpuProcessMs.some((value) => !Number.isFinite(value) || value < 0) ||
        !Array.isArray(distributions.storageBytes) || distributions.storageBytes.length === 0 ||
        distributions.storageBytes.some((value) => !Number.isSafeInteger(value) || value < 0)) {
      failures.push('C24 raw CPU and storage I/O distributions are missing or invalid.')
    }
  }
  return failures
}

/** Require raw results from the fixed C24 representative operations. */
function representativeOperationFailures(report, contractId) {
  if (contractId !== 'C24') return []
  const failures = []
  const operations = report?.priorityFaultEvidence?.operations
  const evidence = operations?.competingOperationEvidence
  const expected = operations?.competingOperationBinding
  if (!isRecord(evidence) || !isRecord(expected)
      || typeof expected.missionId !== 'string' || typeof expected.archiveMissionId !== 'string') {
    return ['C24 competing-operation evidence is missing its fixed mission binding and exact phase report.']
  }
  try {
    validateCompetingOperationEvidence(evidence, {
      missionId: expected.missionId,
      archiveMissionId: expected.archiveMissionId,
    })
  } catch (error) {
    failures.push(`C24 competing-operation evidence is invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  return failures
}

/** Validate one C04/C24/C25 report using independent workload and source facts. */
export function validateSoakContractEvidence(contractId, report, expected) {
  const binding = validateExpected(contractId, expected)
  const failures = []
  object(report, 'Soak report')
  if (report.schemaVersion !== 1 || report.issue !== 'DON-246') failures.push('Soak report schema or issue identity is invalid.')
  failures.push(...profileFailures(report.profile, binding.profile))
  if (binding.profile.equivalentProductionPolls < binding.workload.minimumEquivalentProductionPolls) {
    failures.push(`Profile does not meet the ${binding.workload.class} equivalent-poll minimum.`)
  }
  if (binding.profile.deviceCount < binding.workload.minimumDeviceCount) {
    failures.push(`Profile does not meet the ${binding.workload.class} device-count minimum.`)
  }
  if (report?.missionModel?.enabled !== binding.missionModel.enabled
      || report?.missionModel?.expectedParticipantRows !== binding.missionModel.expectedParticipantRows
      || report?.missionModel?.expectedParticipantAddedEvents !== binding.missionModel.expectedParticipantAddedEvents) {
    failures.push('Mission-model workload facts are not independently bound.')
  }
  failures.push(...sourceFailures(report, binding))
  failures.push(...runtimeBindingFailures(report, binding))
  failures.push(...fieldResourceFailures(report, binding))
  failures.push(...archiveCycleFailures(report, binding))
  failures.push(...priorityFaultFailures(report, binding, contractId))
  failures.push(...representativeOperationFailures(report, contractId))
  const sourcePass = {
    full: sourceFailures(report, binding).every((reason) => !reason.includes('Full persisted position truth')),
    normalPrefix: sourceFailures(report, binding).every((reason) => !reason.includes('Normal-prefix position truth')),
  }
  let recomputedVerdict
  try {
    recomputedVerdict = buildTrackingSoakVerdict(verdictInput(report, binding, sourcePass))
  } catch (error) {
    recomputedVerdict = {
      valid: false,
      passed: false,
      failureReasons: [`Could not recompute soak predicates: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  const verdictFailures = Array.isArray(recomputedVerdict.failureReasons)
    ? recomputedVerdict.failureReasons
    : ['Recomputed soak verdict has no failure list.']
  failures.push(...verdictFailures)
  const passed = failures.length === 0
  const familyCoverage = deriveSoakFamilyCoverage(contractId, [{
    contractId,
    variantId: binding.variantId,
    proofMode: binding.artifact.packageTier,
    passed,
  }])
  return Object.freeze({
    contractId,
    passed,
    valid: passed,
    variantComplete: passed,
    coverageComplete: passed,
    qualificationEligible: passed,
    familyCoverageComplete: familyCoverage.coverageComplete,
    familySatisfiedVariants: familyCoverage.satisfiedVariants,
    familyMissingVariants: familyCoverage.missingVariants,
    failureReasons: failures,
    recomputedVerdict,
    uncoveredAxes: passed ? [] : UNCOVERED_AXES[contractId],
  })
}

/** Derive family completeness from independently validated mandatory variant receipts. */
export function deriveSoakFamilyCoverage(contractId, receipts) {
  const required = SOAK_MANDATORY_VARIANTS[contractId]
  if (required === undefined) throw new Error('Soak family coverage contract is unsupported.')
  const entries = Array.isArray(receipts) ? receipts : []
  const satisfied = new Set(entries
    .filter((entry) => entry?.contractId === contractId && entry?.passed === true)
    .map((entry) => `${entry.variantId}:${entry.proofMode}`))
  const missing = required.filter((entry) => !satisfied.has(`${entry.variantId}:${entry.proofMode}`))
  return Object.freeze({
    contractId,
    coverageComplete: missing.length === 0,
    satisfiedVariants: Object.freeze(required.filter((entry) => satisfied.has(`${entry.variantId}:${entry.proofMode}`))),
    missingVariants: Object.freeze(missing),
    requiredVariants: Object.freeze(required),
  })
}
