import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Fixed packaged C02 variants. The inventory is deliberately exhaustive for this producer. */
export const C02_LIFECYCLE_VARIANTS = Object.freeze([
  'graceful-close',
  'reload',
  'renderer-crash',
  'main-sigkill',
  'pending-finalize',
])

/**
 * Independently validates one packaged C02 lifecycle receipt.
 *
 * The validator consumes raw process, mission, audit and recovery observations. A
 * producer result or family-level boolean is never sufficient to establish a pass.
 */
export async function validateC02LifecycleReceipt(report, expected) {
  assertObject(report, 'C02 report')
  assertObject(expected, 'C02 expected input')
  assert.equal(report.schemaVersion, 1, 'C02 receipt schema must be v1.')
  assert.equal(report.contractId, 'C02', 'C02 receipt contract identity is invalid.')
  assert.ok(C02_LIFECYCLE_VARIANTS.includes(report.variantId), 'C02 receipt variant is not fixed.')
  assert.equal(report.variantId, expected.variantId, 'C02 receipt variant differs from the planned variant.')
  assert.equal(report.proofMode, 'packaged-electron', 'C02 requires packaged Electron evidence.')
  assert.equal(report.result, 'pass', 'C02 producer did not report a terminal pass.')
  assert.equal(report.failure, null, 'C02 receipt contains a producer failure.')

  assert.equal(report.source?.head, expected.sourceSha, 'C02 source head is not bound to the expected source.')
  assert.equal(report.source?.dirty, false, 'C02 packaged evidence requires a clean source tree.')
  assertHex(report.source?.head, 40, 'C02 source head')
  assertBoundEvidencePath(report.profile?.path, expected.evidencePath, 'C02 profile')
  assert.equal(report.profile?.removed, true, 'C02 disposable profile was not removed.')
  assert.equal(report.cleanup?.applicationClosed, true, 'C02 application cleanup was not observed.')
  assert.equal(report.cleanup?.profileRemoved, true, 'C02 profile cleanup was not observed.')

  const launches = report.runtime?.launches
  assert.ok(Array.isArray(launches) && launches.length >= 2, 'C02 requires before and recovery process observations.')
  const pids = new Set()
  for (const launch of launches) {
    assertObject(launch, 'C02 launch observation')
    assert.ok(Number.isSafeInteger(launch.pid) && launch.pid > 0, 'C02 launch PID is invalid.')
    assert.ok(!pids.has(launch.pid), 'C02 reused a process identity across lifecycle phases.')
    pids.add(launch.pid)
    assert.equal(launch.executableSha256, expected.appSha256, 'C02 executable identity differs from the expected package.')
    assert.equal(launch.asarSha256, expected.asarSha256, 'C02 ASAR identity differs from the expected package.')
    assertBoundEvidencePath(launch.userDataPath, expected.evidencePath, 'C02 launch profile')
  }

  const mission = report.mission
  assertObject(mission, 'C02 mission facts')
  assertNonEmptyString(mission.id, 'C02 mission identity')
  assertObject(mission.snapshots, 'C02 mission snapshots')
  const before = mission.snapshots.before
  const afterRecovery = mission.snapshots.afterRecovery
  assert.equal(before?.id, mission.id, 'C02 before snapshot mission identity differs.')
  assert.equal(afterRecovery?.id, mission.id, 'C02 recovery snapshot mission identity differs.')
  assertObject(mission.audit, 'C02 audit facts')
  assertAuditInventory(mission.audit.before, mission.id, 'before')
  assertAuditInventory(mission.audit.afterRecovery, mission.id, 'afterRecovery')
  assertExactlyOneCreated(mission.audit.before, 'C02 before snapshot')
  assertExactlyOneCreated(mission.audit.afterRecovery, 'C02 recovery snapshot')

  switch (report.variantId) {
    case 'graceful-close':
      validateGracefulClose(report)
      break
    case 'reload':
      validateReload(report)
      break
    case 'renderer-crash':
      validateRendererCrash(report)
      break
    case 'main-sigkill':
      validateMainSigkill(report)
      break
    case 'pending-finalize':
      await validatePendingFinalize(report, mission.id, expected.evidencePath)
      break
    default:
      throw new Error(`Unsupported C02 variant: ${report.variantId}`)
  }

  return {
    status: 'PASS',
    contractId: 'C02',
    variantId: report.variantId,
    proofMode: report.proofMode,
    missionId: mission.id,
    observedLaunches: launches.length,
    outcome: report.variantId === 'pending-finalize' && report.pendingFinalize?.blocked === true
      ? 'safe-blocked'
      : 'recovered',
  }
}

/** Validates the normal close boundary and an independently observed recovery launch. */
function validateGracefulClose(report) {
  assert.equal(report.fault?.requested, 'graceful-window-close', 'C02 graceful-close request was not recorded.')
  assert.equal(report.fault?.observed, true, 'C02 graceful close was not observed.')
  assertProcessExit(report.fault?.process, 0, null, 'C02 graceful close')
  assert.equal(report.fault?.recoveryState?.uncleanShutdown, false, 'C02 graceful close was classified as unclean.')
  assert.equal(report.fault?.recoveryNotice, false, 'C02 graceful close rendered an unexpected crash recovery notice.')
  assert.equal(report.mission.snapshots.before.status, 'active', 'C02 graceful close did not begin with an active mission.')
  assert.equal(report.mission.snapshots.afterRecovery.status, 'active', 'C02 graceful close changed the recoverable mission state.')
}

/** Validates a renderer reload through the main-process teardown fence. */
function validateReload(report) {
  assert.equal(report.fault?.requested, 'renderer-reload', 'C02 reload request was not recorded.')
  assert.equal(report.fault?.observed, true, 'C02 renderer reload was not observed.')
  assert.equal(report.fault?.pageRecovered, true, 'C02 renderer reload did not recover a page.')
  assert.equal(report.fault?.recoveryState?.uncleanShutdown, false, 'C02 renderer reload was classified as an unclean app shutdown.')
  assert.equal(report.fault?.recoveryNotice, false, 'C02 renderer reload rendered an unexpected crash recovery notice.')
  assert.ok(['active', 'paused'].includes(report.mission.snapshots.afterRecovery.status), 'C02 renderer reload changed the mission into an unsafe state.')
}

/** Validates a genuine Electron render-process-gone fault and its recovery notice. */
function validateRendererCrash(report) {
  assert.equal(report.fault?.requested, 'renderer-forceful-crash', 'C02 did not request a renderer process crash.')
  assert.equal(report.fault?.observed, true, 'C02 renderer crash was not observed.')
  assert.ok(['crashed', 'killed', 'oom', 'abnormal-exit'].includes(report.fault?.renderer?.reason),
    'C02 renderer evidence does not contain a genuine render-process-gone reason.')
  assert.ok(Number.isInteger(report.fault?.renderer?.exitCode), 'C02 renderer crash exit code is missing.')
  assert.equal(report.fault?.recoveryState?.uncleanShutdown, true, 'C02 renderer crash did not produce unclean recovery state.')
  assert.equal(report.fault?.recoveryNotice, true, 'C02 renderer crash did not render the recovery notice.')
  assert.ok(typeof report.fault?.recoveryState?.lastCrash?.summary === 'string',
    'C02 renderer crash recovery did not retain the crash summary.')
  assert.ok(['active', 'paused'].includes(report.mission.snapshots.afterRecovery.status), 'C02 renderer crash changed the mission into an unsafe state.')
}

/** Validates an actual main-process SIGKILL and a later clean recovery launch. */
function validateMainSigkill(report) {
  assert.equal(report.fault?.requested, 'main-process-sigkill', 'C02 main SIGKILL request was not recorded.')
  assert.equal(report.fault?.observed, true, 'C02 main SIGKILL was not observed.')
  assertProcessExit(report.fault?.process, null, 'SIGKILL', 'C02 main SIGKILL')
  assert.equal(report.fault?.recoveryState?.uncleanShutdown, true, 'C02 main SIGKILL did not produce unclean recovery state.')
  assert.equal(report.fault?.recoveryNotice, true, 'C02 main SIGKILL did not render the recovery notice.')
  assert.ok(['active', 'paused'].includes(report.mission.snapshots.afterRecovery.status), 'C02 main SIGKILL changed the mission into an unsafe state.')
}

/** Validates a kill at a real archive phase and the subsequent durable finalization. */
async function validatePendingFinalize(report, missionId, evidencePath) {
  assert.equal(report.fault?.requested, 'main-process-sigkill-at-finalize-phase', 'C02 pending-finalize kill boundary is invalid.')
  assert.equal(report.fault?.observed, true, 'C02 pending-finalize SIGKILL was not observed.')
  assertProcessExit(report.fault?.process, null, 'SIGKILL', 'C02 pending-finalize SIGKILL')
  assert.equal(report.fault?.recoveryState?.uncleanShutdown, true, 'C02 pending-finalize kill did not produce unclean recovery state.')
  assert.equal(report.fault?.recoveryNotice, true, 'C02 pending-finalize kill did not render the recovery notice.')
  assert.equal(report.fault?.evidenceHealthWarning, true, 'C02 pending-finalize evidence-health warning was not rendered.')
  const pending = report.pendingFinalize
  assertObject(pending, 'C02 pending-finalize facts')
  assertNonEmptyString(pending.operationId, 'C02 pending-finalize operation identity')
  assert.ok(['preflight', 'snapshot', 'extract', 'attachments', 'digest', 'encrypt', 'sync', 'keys', 'sqlite', 'inventory', 'gpx', 'replay'].includes(pending.phase),
    'C02 pending-finalize phase is not a real archive phase.')
  assert.equal(pending.boundaryObserved, true, 'C02 pending-finalize boundary was not independently observed.')
  assert.equal(pending.recoveryAttempted, true, 'C02 pending-finalize recovery was not attempted.')
  assertObject(pending.evidenceHealthBeforeRetry, 'C02 pending-finalize evidence health')
  assert.equal(pending.evidenceHealthBeforeRetry.state, 'critical', 'C02 pending-finalize evidence health was not critical.')
  assert.equal(pending.evidenceHealthBeforeRetry.reason, 'renderer_pending_evidence_lost', 'C02 pending-finalize evidence-loss reason differs.')
  assertObject(pending.evidenceLossMarker, 'C02 pending-finalize evidence-loss marker')
  assertBoundEvidencePath(pending.evidenceLossMarker.path, evidencePath, 'C02 evidence-loss marker')
  const markerBytes = await readFile(pending.evidenceLossMarker.path)
  assert.equal(pending.evidenceLossMarker.bytes, markerBytes.byteLength, 'C02 evidence-loss marker byte count differs.')
  const marker = JSON.parse(markerBytes.toString('utf8'))
  assert.deepEqual(marker.reasons, ['renderer_pending_evidence_lost'], 'C02 evidence-loss marker reason differs.')
  assert.ok(Number.isSafeInteger(marker.lossGeneration) && marker.lossGeneration > 0, 'C02 evidence-loss marker generation is invalid.')
  assert.equal(pending.evidenceLossMarker.sha256, sha256(markerBytes), 'C02 evidence-loss marker digest differs.')
  assert.equal(pending.settled, false, 'C02 pending-finalize unexpectedly settled through an unresolved evidence fence.')
  assert.equal(pending.blocked, true, 'C02 pending-finalize safe blocked outcome was not recorded.')
  assert.equal(pending.finalMission?.id, missionId, 'C02 pending-finalize recovered mission identity differs.')
  assert.equal(pending.finalMission?.status, 'finished', 'C02 pending-finalize did not preserve the finished mission.')
  assert.match(pending.retry?.error ?? '', /ARCHIVE_EVIDENCE_HEALTH_BLOCKED/u, 'C02 pending-finalize retry did not retain the evidence-health refusal.')
  assertAuditInventory(pending.audit, missionId, 'pending-finalize')
  for (const eventType of ['mission_finalize_requested', 'mission_archive_failed']) {
    assert.equal(pending.audit.filter((event) => event.event_type === eventType).length, 1,
      `C02 pending-finalize must retain exactly one ${eventType} event.`)
  }
  assert.equal(pending.audit.filter((event) => event.event_type === 'mission_finalized').length, 0,
    'C02 pending-finalize must not finalize through the unresolved evidence fence.')
}

/** Requires one exact process termination identity. */
function assertProcessExit(process, exitCode, signal, label) {
  assertObject(process, `${label} process observation`)
  assert.equal(process.exitCode, exitCode, `${label} exit code differs.`)
  assert.equal(process.signal, signal, `${label} signal differs.`)
}

/** Checks an audit list without trusting a producer count or boolean. */
function assertAuditInventory(events, missionId, label) {
  assert.ok(Array.isArray(events) && events.length > 0, `C02 ${label} audit inventory is empty.`)
  const ids = new Set()
  for (const event of events) {
    assertObject(event, `C02 ${label} audit event`)
    assertNonEmptyString(event.id, `C02 ${label} audit event identity`)
    assert.ok(!ids.has(event.id), `C02 ${label} audit event is duplicated.`)
    ids.add(event.id)
    assert.equal(event.mission_id, missionId, `C02 ${label} audit event is scoped to another mission.`)
    assertNonEmptyString(event.event_type, `C02 ${label} audit event type`)
  }
}

/** Requires exactly one mission-created event in each retained raw inventory. */
function assertExactlyOneCreated(events, label) {
  assert.equal(events.filter((event) => event.event_type === 'mission_created').length, 1,
    `${label} must contain exactly one mission_created event.`)
}

/** Ensures a retained path remains inside the evidence lease. */
function assertBoundEvidencePath(value, evidencePath, label) {
  assert.ok(typeof value === 'string' && path.isAbsolute(value), `${label} must be absolute.`)
  const root = path.resolve(evidencePath)
  const actual = path.resolve(value)
  assert.ok(actual === root || actual.startsWith(`${root}${path.sep}`), `${label} escapes evidence custody.`)
}

/** Validates one hexadecimal identity with a fixed width. */
function assertHex(value, length, label) {
  assert.ok(typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(value), `${label} is not a fixed hexadecimal identity.`)
}

/** Hashes a retained evidence file without trusting its reported digest. */
function sha256(fileBytes) {
  return createHash('sha256').update(fileBytes).digest('hex')
}

/** Requires a bounded non-empty string. */
function assertNonEmptyString(value, label) {
  assert.ok(typeof value === 'string' && value.trim() !== '', `${label} is missing.`)
}

/** Requires a plain record rather than an array or primitive. */
function assertObject(value, label) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is invalid.`)
}
