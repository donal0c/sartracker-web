#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  finalizeAndVerifyArchive,
  readArchiveReviewContent,
} from '../electron-archive-lifecycle-smoke.mjs'
import { runCompetingMapFault } from './competing-map-fault.mjs'

const PHASES = Object.freeze([
  'gpxTimed',
  'gpxUntimed',
  'archiveCreate',
  'archiveVerify',
  'archiveReview',
  'archiveRestore',
  'archiveCleanup',
  'diagnostics',
  'mapFault',
])
export const C24_COMPETING_PHASES = PHASES
const STAGES = Object.freeze(['start', 'steady', 'complete'])
const FAULT_STAGES = Object.freeze(['start', 'steady', 'fail', 'cleanup'])
const SHA256 = /^[a-f0-9]{64}$/u
const C24_DIAGNOSTIC_CONTENT = 'SAR Tracker C24 bounded diagnostic probe\n'
export const C24_INVALID_DIAGNOSTIC_FILE_NAME = ' '

/**
 * Run the fixed C24 operation set against an already seeded active mission.
 *
 * The helper deliberately accepts a Playwright page rather than an arbitrary
 * command or source path. GPX inputs are created in the owned evidence
 * directory, archive work uses the existing public archive bridge, and the map
 * fault is the same scoped overlay failure used by the C14 producer. Secrets
 * are accepted only for the in-memory bridge call and never enter the report.
 *
 * @param {object} input operation probe input
 * @param {object} input.page Playwright page connected to the exact candidate
 * @param {string} input.missionId active mission identity
 * @param {string} input.evidenceDir controller-owned evidence directory
 * @param {object} input.expected fixed archive/liveness expectations
 * @returns {Promise<Readonly<Record<string, unknown>>>} bounded raw report
 */
export async function runCompetingOperationProbe({ page, missionId, evidenceDir, expected }) {
  assertPage(page)
  assertAbsolute(missionId, 'missionId', false)
  assertAbsolute(evidenceDir, 'evidenceDir')
  const binding = normalizeExpected(expected, true)
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 })
  const fixtureDirectory = path.join(evidenceDir, 'competing-operation-fixtures')
  await mkdir(fixtureDirectory, { recursive: true, mode: 0o700 })
  const report = {
    schemaVersion: 1,
    schema: 'sartracker-competing-operation-v1',
    contractId: 'C24',
    missionId,
    archiveMissionId: binding.archiveMissionId,
    phases: {},
    faultStages: [],
    fixture: { directoryName: path.basename(fixtureDirectory), files: [] },
  }
  let archiveResult
  let reviewSessionId
  try {
    report.activeMission = await page.evaluate(async (selectedMissionId) => {
      const store = window.sartrackerElectron?.missionStore
      if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
      const mission = await store.getMission(selectedMissionId)
      if (mission?.id !== selectedMissionId || mission.status !== 'active') {
        throw new Error('C24 competing operations require one valid active mission.')
      }
      return { id: mission.id, status: mission.status, observedAt: new Date().toISOString() }
    }, missionId)
    const timed = await runGpxImport({
      page,
      missionId,
      fixtureDirectory,
      kind: 'timed',
      livenessProbe: binding.livenessProbe,
    })
    report.phases.gpxTimed = timed.operation
    report.fixture.files.push(timed.source)

    const untimed = await runGpxImport({
      page,
      missionId,
      fixtureDirectory,
      kind: 'untimed',
      livenessProbe: binding.livenessProbe,
    })
    report.phases.gpxUntimed = untimed.operation
    report.fixture.files.push(untimed.source)

    archiveResult = await runOperation({
      phase: 'archiveCreate',
      livenessPhases: ['create', 'verify'],
      livenessProbe: binding.livenessProbe,
      work: async () => {
        const finalized = await finalizeAndVerifyArchive(
          page,
          binding.archiveMissionId,
          binding.archiveSecret,
          (phase) => binding.livenessProbe?.setPhaseFromRenderer?.(phase),
        )
        if (finalized.archive?.mission_id !== binding.archiveMissionId) {
          throw new Error('C24 archive create returned a foreign mission identity.')
        }
        return {
          archive: {
            id: finalized.archive.id,
            missionId: finalized.archive.mission_id,
            status: finalized.archive.status,
            availability: finalized.archive.availability,
          },
          recoveryCodeIssued: typeof finalized.recoveryCode === 'string' && finalized.recoveryCode.length > 0,
        }
      },
    })
    report.phases.archiveCreate = archiveResult.operation
    const archive = archiveResult.operation.archive

    const verified = await runOperation({
      phase: 'archiveVerify',
      livenessPhase: 'verify',
      livenessProbe: binding.livenessProbe,
      work: async () => page.evaluate(async ({ missionId: selectedMissionId, archiveId }) => {
        const store = window.sartrackerElectron?.missionStore
        if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
        const [mission, archives] = await Promise.all([
          store.getMission(selectedMissionId),
          store.listMissionArchives(selectedMissionId),
        ])
        const retained = Array.isArray(archives) ? archives.find((candidate) => candidate.id === archiveId) : undefined
        return {
          archive: {
            id: retained?.id ?? null,
            missionId: retained?.mission_id ?? null,
            verified: retained?.status === 'verified',
            immutable: retained?.availability === 'present' && retained?.container_version === 2,
          },
          missionStatus: mission?.status ?? null,
        }
      }, { missionId: binding.archiveMissionId, archiveId: archive.id }),
    })
    report.phases.archiveVerify = verified.operation

    const restored = await runOperation({
      phase: 'archiveRestore',
      livenessPhase: 'restore',
      livenessProbe: binding.livenessProbe,
      work: async () => {
        const opened = await page.evaluate(async ({ archiveId, secret }) => {
          const archiveReview = window.sartrackerElectron?.archiveReview
          if (archiveReview === undefined) throw new Error('Archive-review preload bridge is unavailable.')
          return archiveReview.open({
            operationId: crypto.randomUUID(),
            archiveId,
            containerVersion: 2,
            slotType: 'passphrase',
            secret,
          })
        }, { archiveId: archive.id, secret: binding.archiveSecret })
        if (opened?.archiveId !== archive.id || opened?.missionId !== binding.archiveMissionId
          || opened?.verified !== true || opened?.immutable !== true) {
          throw new Error('C24 archive restore did not open the exact verified immutable archive.')
        }
        reviewSessionId = opened.sessionId
        return {
          restore: {
            sessionId: opened.sessionId,
            archiveId: opened.archiveId,
            missionId: opened.missionId,
            identityMatched: true,
            plaintextResidual: opened.plaintextResidual,
          },
        }
      },
    })
    report.phases.archiveRestore = restored.operation

    const reviewed = await runOperation({
      phase: 'archiveReview',
      livenessPhase: 'restore',
      livenessProbe: binding.livenessProbe,
      work: async () => {
        if (typeof reviewSessionId !== 'string' || reviewSessionId.length === 0) {
          throw new Error('C24 archive review has no retained restore session identity.')
        }
        const content = await readArchiveReviewContent(page, {
          sessionId: reviewSessionId,
          missionId: binding.archiveMissionId,
          selectedTime: binding.selectedTime ?? new Date().toISOString(),
        })
        const reviewResult = content?.reviewResult
        const replay = content?.replayResult?.initial
        const counts = {
          breadcrumbCount: reviewResult?.breadcrumbCount,
          trackCount: replay?.totalTrackCount,
          objectCount: replay?.totalObjectCount,
        }
        const nonEmpty = Object.values(counts).every((count) => Number.isSafeInteger(count) && count >= 0)
          && Object.values(counts).some((count) => count > 0)
        if (!nonEmpty || content?.mutationDenied !== true || content?.denialAudited !== true) {
          throw new Error('C24 archive review returned empty or mutable evidence.')
        }
        return {
          review: {
            sessionId: reviewSessionId,
            missionId: binding.archiveMissionId,
            nonEmpty,
            mutationDenied: content.mutationDenied === true,
            closed: false,
            breadcrumbCount: counts.breadcrumbCount,
            trackCount: counts.trackCount,
            objectCount: counts.objectCount,
          },
        }
      },
    })
    report.phases.archiveReview = reviewed.operation

    const cleaned = await runOperation({
      phase: 'archiveCleanup',
      livenessPhase: 'cleanup',
      livenessProbe: binding.livenessProbe,
      work: async () => {
        const closed = await page.evaluate(async (sessionId) => {
          const archiveReview = window.sartrackerElectron?.archiveReview
          if (archiveReview === undefined) throw new Error('Archive-review preload bridge is unavailable.')
          return archiveReview.close({ sessionId })
        }, reviewSessionId)
        reviewSessionId = undefined
        if (closed !== true) throw new Error('C24 archive review session did not close.')
        const cleanup = await page.evaluate(async (request) => {
          const store = window.sartrackerElectron?.missionStore
          if (store === undefined) throw new Error('Mission-store preload bridge is unavailable.')
          const eligibility = await store.getMissionCleanupEligibility({
            missionId: request.missionId,
            archiveId: request.archiveId,
          })
          const result = await store.startMissionCleanup({
            missionId: request.missionId,
            archiveId: request.archiveId,
            operationId: crypto.randomUUID(),
            slotType: 'passphrase',
            secret: request.secret,
            confirmation: request.missionName,
          })
          return { eligibility, result }
        }, {
          missionId: binding.archiveMissionId,
          archiveId: archive.id,
          missionName: binding.archiveMissionName,
          secret: binding.archiveSecret,
        })
        const blockers = cleanup.eligibility?.blockers
        if (cleanup.eligibility?.eligible !== false || cleanup.eligibility?.startableWithCredential !== true
          || JSON.stringify(blockers) !== JSON.stringify(['fresh_non_machine_unlock_required'])
          || cleanup.result?.state !== 'completed' || cleanup.result?.storageState !== 'archived'
          || !Number.isSafeInteger(cleanup.result?.movedRows) || cleanup.result.movedRows < 1) {
          throw new Error('C24 archive cleanup did not prove eligibility-gated movement of nonempty rows.')
        }
        return {
          cleanup: {
            archiveId: archive.id,
            completed: true,
            storageState: cleanup.result.storageState,
            freshCredentialGate: true,
            movedRows: cleanup.result.movedRows,
            reviewClosed: true,
          },
        }
      },
    })
    report.phases.archiveCleanup = cleaned.operation

    report.phases.diagnostics = (await runDiagnosticsFault({ page, livenessProbe: binding.livenessProbe })).operation
    const mapWallClockStartedAtMs = Date.now()
    const mapFault = await runCompetingMapFault({ page, evidenceDir })
    report.phases.mapFault = projectCompetingMapFaultOperation(mapFault, mapWallClockStartedAtMs)
    if (mapFault.status !== 'fulfilled') throw new Error(mapFault.error ?? 'C24 map fault operation was not completed.')
    report.faultStages = collectFaultStages(report.phases.diagnostics, report.phases.mapFault)
    report.fixture.files = report.fixture.files.map((file) => ({ ...file }))
    return Object.freeze(report)
  } finally {
    if (reviewSessionId !== undefined) {
      await page.evaluate(async (sessionId) => window.sartrackerElectron?.archiveReview?.close({ sessionId }), reviewSessionId).catch(() => undefined)
    }
    await writeFile(
      path.join(evidenceDir, 'competing-operation-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    ).catch(() => undefined)
  }
}

/** Validate the retained raw C24 operation facts independently of producer flags. */
export function validateCompetingOperationEvidence(report, expected) {
  const binding = normalizeExpected(expected, false)
  if (!isRecord(report) || report.schemaVersion !== 1 || report.schema !== 'sartracker-competing-operation-v1'
    || report.contractId !== 'C24') throw new Error('C24 competing-operation receipt schema is invalid.')
  if (report.missionId !== binding.missionId || report.archiveMissionId !== binding.archiveMissionId) {
    throw new Error('C24 competing-operation mission identity differs from the fixed binding.')
  }
  if (!isRecord(report.activeMission) || report.activeMission.id !== binding.missionId
    || report.activeMission.status !== 'active' || !validTimestamp(report.activeMission.observedAt)) {
    throw new Error('C24 competing-operation active mission was not observed through the public bridge.')
  }
  if (!isRecord(report.phases) || Object.keys(report.phases).sort().join('\0') !== [...PHASES].sort().join('\0')) {
    throw new Error('C24 competing-operation phase inventory is incomplete.')
  }
  for (const phase of PHASES) validateOperation(report.phases[phase], phase)
  validateGpxPhase(report.phases.gpxTimed, 'timed', binding.timedImportId)
  validateGpxPhase(report.phases.gpxUntimed, 'untimed', binding.untimedImportId)
  validateArchivePhases(report, binding)
  validateDiagnostics(report.phases.diagnostics)
  validateMapFault(report.phases.mapFault)
  validateFaultStages(report.faultStages)
  return Object.freeze({
    status: 'PASS',
    contractId: 'C24',
    missionId: binding.missionId,
    archiveMissionId: binding.archiveMissionId,
    observedPhases: [...PHASES],
    operationCount: PHASES.length,
    observedFaultStages: [...FAULT_STAGES],
    scope: 'bounded competing active-mission GPX, archive lifecycle, diagnostics fault, and map fault observations',
  })
}

/** Import one fixed nonempty GPX fixture through the public mission-store bridge. */
async function runGpxImport({ page, missionId, fixtureDirectory, kind, livenessProbe }) {
  const filename = `c24-${kind}.gpx`
  const filePath = path.join(fixtureDirectory, filename)
  const content = kind === 'timed' ? timedGpx() : untimedGpx()
  await writeFile(filePath, content, { flag: 'wx', mode: 0o600 })
  const source = { kind, basename: filename, bytes: Buffer.byteLength(content), sha256: sha256Text(content) }
  const result = await runOperation({
    phase: kind === 'timed' ? 'gpxTimed' : 'gpxUntimed',
    livenessPhase: 'create',
    livenessProbe,
    work: async () => {
      const imported = await page.evaluate(async (request) => {
        const store = window.sartrackerElectron?.missionStore
        if (store === undefined || typeof store.importGpxEvidencePaths !== 'function') {
          throw new Error('C24 GPX import preload bridge is unavailable.')
        }
        return store.importGpxEvidencePaths({ missionId: request.missionId, paths: [request.path] })
      }, { missionId, path: filePath })
      if (!Array.isArray(imported?.imports) || imported.imports.length !== 1
        || !Array.isArray(imported.failures) || imported.failures.length !== 0) {
        throw new Error(`C24 ${kind} GPX import did not produce one accepted import.`)
      }
      return {
        source,
        import: { importId: imported.imports[0].id, accepted: imported.imports.length, failures: imported.failures.length },
      }
    },
  })
  result.operation.source = source
  return { source, operation: result.operation }
}

/** Execute the diagnostics fault and its fixed recovery export. */
async function runDiagnosticsFault({ page, livenessProbe }) {
  const result = await runOperation({
    phase: 'diagnostics',
    livenessPhase: null,
    livenessProbe,
    work: async ({ observeStage, requestId }) => {
      const rejected = await page.evaluate(async ({ contents, fileName }) => {
        const exportDiagnostics = window.sartrackerElectron?.exportDiagnosticsReport
        if (typeof exportDiagnostics !== 'function') throw new Error('Diagnostics export preload bridge is unavailable.')
        try {
          await exportDiagnostics({ fileName, contents })
          return false
        } catch {
          return true
        }
      }, { contents: C24_DIAGNOSTIC_CONTENT, fileName: C24_INVALID_DIAGNOSTIC_FILE_NAME })
      if (rejected !== true) throw new Error('C24 diagnostics invalid-name fault was not rejected.')
      observeStage('fail')
      const recoveryPath = await page.evaluate(async (contents) => {
        const exportDiagnostics = window.sartrackerElectron?.exportDiagnosticsReport
        return exportDiagnostics({ fileName: 'c24-diagnostics-recovery.txt', contents })
      }, C24_DIAGNOSTIC_CONTENT)
      if (typeof recoveryPath !== 'string' || path.basename(recoveryPath) !== 'c24-diagnostics-recovery.txt') {
        throw new Error('C24 diagnostics recovery export did not return the fixed filename.')
      }
      observeStage('steady')
      await rm(recoveryPath, { force: true }).catch(() => undefined)
      observeStage('cleanup')
      return {
        fault: { requested: 'invalid-file-name', fileName: C24_INVALID_DIAGNOSTIC_FILE_NAME, rejected: true, errorObserved: true, requestId },
        recovery: { requested: 'valid-file-name', exported: true, pathBasename: path.basename(recoveryPath) },
      }
    },
  })
  return result
}

/** Project the independent map-fault helper without replacing its monotonic stage observations. */
export function projectCompetingMapFaultOperation(raw, wallClockStartedAtMs) {
  if (!isRecord(raw) || !nonEmpty(raw.requestId) || !Number.isFinite(raw.startedAtMs)
    || !Number.isFinite(raw.completedAtMs) || !Number.isFinite(wallClockStartedAtMs)
    || !Array.isArray(raw.stages)) throw new Error('C24 map-fault producer stage envelope is invalid.')
  const toObservedAt = (monotonicAtMs) => {
    if (!Number.isFinite(monotonicAtMs)) throw new Error('C24 map-fault monotonic stage timestamp is invalid.')
    return new Date(wallClockStartedAtMs + monotonicAtMs - raw.startedAtMs).toISOString()
  }
  const startedAt = toObservedAt(raw.startedAtMs)
  const endedAt = toObservedAt(raw.completedAtMs)
  const stages = Array.isArray(raw?.stages) ? raw.stages.map((stage) => ({
    stage: stage.stage === 'cleanup' ? 'complete' : stage.stage === 'fault' ? 'fail' : stage.stage,
    requestId: raw.requestId,
    observedAt: toObservedAt(stage.atMs),
    monotonicAtMs: stage.atMs,
  })) : []
  return {
    operationId: raw.requestId,
    requestIds: [raw.requestId],
    startedAt,
    endedAt,
    status: raw.status === 'fulfilled' ? 'completed' : 'failed',
    stages,
    fault: {
      ...raw.observed,
      requestId: raw.requestId,
      startedAt,
      rawStatus: raw.status,
      cleanupRestored: raw.cleanup?.restored === true,
      screenshotPath: typeof raw.screenshotPath === 'string' ? path.basename(raw.screenshotPath) : null,
    },
    rawStages: raw.stages,
  }
}

/** Run one operation with bounded timestamps, stage observations, and optional liveness fencing. */
async function runOperation({ phase, livenessPhase, livenessPhases, livenessProbe, work }) {
  const operationId = randomUUID()
  const requestId = randomUUID()
  const startedAt = new Date().toISOString()
  const stages = [{ stage: 'start', requestId, observedAt: startedAt }]
  let checkpoints = []
  try {
    const phases = Array.isArray(livenessPhases) ? livenessPhases : livenessPhase === null ? [] : [livenessPhase]
    if (livenessProbe !== undefined && phases.length > 0) {
      assertLivenessProbe(livenessProbe)
      await livenessProbe.setPhase(phases[0])
      checkpoints = phases.length === 1
        ? [await livenessProbe.beginPhaseOperation(phases[0], `c24_${phase}`)]
        : await livenessProbe.beginPhaseOperations(phases, phases.map(() => `c24_${phase}`))
    }
    const observeStage = (stage) => {
      if (!nonEmpty(stage)) throw new Error(`C24 ${phase} stage name is invalid.`)
      stages.push({ stage, requestId, observedAt: new Date().toISOString() })
    }
    const operation = () => work({ observeStage, requestId })
    const result = checkpoints.length === 0
      ? await operation()
      : await livenessProbe.guardOperation(operation(), checkpoints)
    if (!stages.some((stage) => stage.stage === 'steady')) {
      stages.push({ stage: 'steady', requestId, observedAt: new Date().toISOString() })
    }
    if (checkpoints.length > 0) {
      await livenessProbe.setPhase(phases.at(-1))
      for (const checkpoint of checkpoints) await livenessProbe.completePhaseOperation(checkpoint)
    }
    const endedAt = new Date().toISOString()
    stages.push({ stage: 'complete', requestId, observedAt: endedAt })
    return { operation: { operationId, requestIds: [requestId], startedAt, endedAt, status: 'completed', stages, ...result } }
  } catch (error) {
    if (!stages.some((stage) => stage.stage === 'fail')) {
      stages.push({ stage: 'fail', requestId, observedAt: new Date().toISOString() })
    }
    for (const checkpoint of checkpoints) await livenessProbe.endPhaseOperation(checkpoint).catch(() => undefined)
    throw error
  }
}

/** Collect only observed fault stages from the two fixed fault operations. */
export function collectFaultStages(diagnostics, mapFault) {
  const result = []
  for (const operation of [diagnostics, mapFault]) {
    const hasExplicitCleanup = operation.stages.some((stage) => stage.stage === 'cleanup')
    for (const stage of operation.stages) {
      if (stage.stage === 'complete' && hasExplicitCleanup) continue
      if (FAULT_STAGES.includes(stage.stage) || stage.stage === 'complete') result.push({
        stage: stage.stage === 'complete' ? 'cleanup' : stage.stage,
        operationId: operation.operationId,
        requestId: stage.requestId,
        observedAt: stage.observedAt,
      })
    }
  }
  return result
}

/** Validate the fixed expected binding shape without accepting arbitrary sources or commands. */
function normalizeExpected(expected, forRun) {
  if (!isRecord(expected) || !nonEmpty(expected.missionId) || !nonEmpty(expected.archiveMissionId)
    || forRun && (!nonEmpty(expected.archiveSecret) || !nonEmpty(expected.archiveMissionName))
    || !nonEmpty(expected.timedImportId) && expected.timedImportId !== undefined
    || !nonEmpty(expected.untimedImportId) && expected.untimedImportId !== undefined
    || !nonEmpty(expected.archiveId) && expected.archiveId !== undefined) {
    throw new Error('C24 expected binding is missing fixed mission, archive, or secret fields.')
  }
  return {
    missionId: expected.missionId,
    archiveMissionId: expected.archiveMissionId,
    archiveSecret: expected.archiveSecret,
    archiveMissionName: expected.archiveMissionName,
    timedImportId: expected.timedImportId,
    untimedImportId: expected.untimedImportId,
    archiveId: expected.archiveId,
    selectedTime: expected.selectedTime,
    livenessProbe: expected.livenessProbe,
  }
}

/** Validate one raw operation envelope and its observed lifecycle stages. */
function validateOperation(value, phase) {
  if (!isRecord(value) || !nonEmpty(value.operationId) || !Array.isArray(value.requestIds) || value.requestIds.length < 1
    || value.requestIds.some((id) => !nonEmpty(id)) || value.status !== 'completed'
    || !validTimestamp(value.startedAt) || !validTimestamp(value.endedAt) || Date.parse(value.endedAt) < Date.parse(value.startedAt)
    || !Array.isArray(value.stages)) throw new Error(`C24 ${phase} operation identity is incomplete.`)
  const names = value.stages.map((stage) => stage?.stage)
  for (const stage of STAGES) {
    const observed = value.stages.find((candidate) => candidate?.stage === stage)
    if (!isRecord(observed) || !nonEmpty(observed.requestId) || !validTimestamp(observed.observedAt)) {
      throw new Error(`C24 ${phase} operation stage ${stage} is not raw evidence.`)
    }
  }
  if (new Set(names).size !== names.length) throw new Error(`C24 ${phase} operation stages are duplicated.`)
}

/** Validate one fixed timed or untimed import identity. */
function validateGpxPhase(phase, kind, expectedImportId) {
  if (!isRecord(phase.source) || phase.source.kind !== kind || !nonEmpty(phase.source.basename)
    || !Number.isSafeInteger(phase.source.bytes) || phase.source.bytes < 1 || !SHA256.test(phase.source.sha256)
    || !isRecord(phase.import) || !nonEmpty(phase.import.importId) || phase.import.accepted !== 1 || phase.import.failures !== 0) {
    throw new Error(`C24 ${kind} GPX phase is empty or lacks raw import evidence.`)
  }
  if (expectedImportId !== undefined && phase.import.importId !== expectedImportId) {
    throw new Error(`C24 ${kind} GPX import identity differs from the fixed binding.`)
  }
}

/** Validate the independent archive create, verify, review, restore, and cleanup facts. */
function validateArchivePhases(report, expected) {
  const created = report.phases.archiveCreate.archive
  const verified = report.phases.archiveVerify.archive
  if (!isRecord(created) || created.id !== (expected.archiveId ?? created.id) || created.missionId !== expected.archiveMissionId
    || created.status !== 'verified' || created.availability !== 'present') throw new Error('C24 archive create evidence is not verified and present.')
  if (!isRecord(verified) || verified.id !== created.id || verified.missionId !== expected.archiveMissionId
    || verified.verified !== true || verified.immutable !== true) throw new Error('C24 archive verify evidence is incomplete.')
  const review = report.phases.archiveReview.review
  const reviewCounts = [review?.breadcrumbCount, review?.trackCount, review?.objectCount]
  if (!isRecord(review) || review.sessionId !== report.phases.archiveRestore.restore.sessionId
    || review.missionId !== expected.archiveMissionId || review.nonEmpty !== true || review.mutationDenied !== true
    || reviewCounts.some((count) => !Number.isSafeInteger(count) || count < 0)
    || !reviewCounts.some((count) => count > 0)) {
    throw new Error('C24 archive review evidence is empty, foreign, or mutable.')
  }
  const restore = report.phases.archiveRestore.restore
  if (!isRecord(restore) || restore.archiveId !== created.id || restore.missionId !== expected.archiveMissionId
    || restore.identityMatched !== true || restore.plaintextResidual !== 'permission_restricted_session_open') {
    throw new Error('C24 archive restore evidence is incomplete.')
  }
  const cleanup = report.phases.archiveCleanup.cleanup
  if (!isRecord(cleanup) || cleanup.archiveId !== created.id || cleanup.completed !== true
    || cleanup.storageState !== 'archived' || cleanup.freshCredentialGate !== true
    || !Number.isSafeInteger(cleanup.movedRows) || cleanup.movedRows < 1 || cleanup.reviewClosed !== true) {
    throw new Error('C24 archive cleanup evidence is empty or incomplete.')
  }
}

/** Validate the fixed invalid-name diagnostics fault and successful recovery export. */
function validateDiagnostics(phase) {
  const fault = phase.fault
  const recovery = phase.recovery
  if (!isRecord(fault) || fault.requested !== 'invalid-file-name' || fault.fileName !== C24_INVALID_DIAGNOSTIC_FILE_NAME
    || fault.rejected !== true || fault.errorObserved !== true
    || !nonEmpty(fault.requestId) || !isRecord(recovery) || recovery.requested !== 'valid-file-name'
    || recovery.exported !== true || recovery.pathBasename !== 'c24-diagnostics-recovery.txt') {
    throw new Error('C24 diagnostics fault or recovery evidence is incomplete.')
  }
}

/** Validate the distinct operator-visible MapLibre failure and recovery. */
function validateMapFault(phase) {
  const fault = phase.fault
  if (!isRecord(fault) || fault.attempted !== true || fault.throwHookHit !== true || fault.operatorWarningVisible !== true
    || fault.recoveryObserved !== true || fault.consoleOnly === true || fault.cleanupRestored !== true || !nonEmpty(fault.warningText)
    || !nonEmpty(fault.requestId) || !validTimestamp(fault.startedAt)) throw new Error('C24 map fault did not produce raw operator-visible recovery evidence.')
  if (!/overlay|layer|marker|mission/iu.test(fault.warningText) || /tile|basemap|map.*degraded/iu.test(fault.warningText)) {
    throw new Error('C24 map fault warning is not distinct from a basemap or tile warning.')
  }
}

/** Validate actual stage observations, rejecting the old hard-coded string list. */
function validateFaultStages(stages) {
  if (!Array.isArray(stages) || stages.length < FAULT_STAGES.length) throw new Error('C24 fault stage evidence is incomplete.')
  const observed = new Set()
  for (const stage of stages) {
    if (!isRecord(stage) || !FAULT_STAGES.includes(stage.stage) || !nonEmpty(stage.operationId)
      || !nonEmpty(stage.requestId) || !validTimestamp(stage.observedAt)) throw new Error('C24 fault stage is not raw evidence.')
    observed.add(stage.stage)
  }
  for (const stage of FAULT_STAGES) if (!observed.has(stage)) throw new Error(`C24 fault stage ${stage} was not observed.`)
}

/** Ensure a Playwright page-like object is present before any fixture is created. */
function assertPage(page) {
  if (!isRecord(page) || typeof page.evaluate !== 'function' || typeof page.screenshot !== 'function') {
    throw new Error('C24 competing-operation probe requires a Playwright page.')
  }
}

/** Require an absolute path or a bounded identity string. */
function assertAbsolute(value, label, absolute = true) {
  if (typeof value !== 'string' || value.length === 0 || absolute && !path.isAbsolute(value)) {
    throw new Error(`C24 ${label} must be ${absolute ? 'an absolute path' : 'a nonempty identity'}.`)
  }
}

/** Validate the small liveness interface supplied by the packaged runner. */
function assertLivenessProbe(probe) {
  if (!isRecord(probe) || typeof probe.setPhase !== 'function' || typeof probe.beginPhaseOperation !== 'function'
    || typeof probe.guardOperation !== 'function' || typeof probe.completePhaseOperation !== 'function'
    || typeof probe.endPhaseOperation !== 'function') throw new Error('C24 liveness probe does not expose the required operation fence.')
}

/** Produce fixed timed GPX content without accepting user-controlled source bytes. */
function timedGpx() {
  return '<?xml version="1.0"?><gpx version="1.1" creator="sartracker-c24"><trk><name>C24 timed</name><trkseg><trkpt lat="52.100000" lon="-9.700000"><time>2026-01-01T10:00:00.000Z</time></trkpt><trkpt lat="52.100100" lon="-9.700100"><time>2026-01-01T10:00:01.000Z</time></trkpt></trkseg></trk></gpx>\n'
}

/** Produce fixed untimed GPX content without accepting user-controlled source bytes. */
function untimedGpx() {
  return '<?xml version="1.0"?><gpx version="1.1" creator="sartracker-c24"><trk><name>C24 untimed</name><trkseg><trkpt lat="52.101000" lon="-9.701000"/><trkpt lat="52.101100" lon="-9.701100"/></trkseg></trk></gpx>\n'
}

/** Hash fixed text before it is sent through the public bridge. */
function sha256Text(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/** Recognize bounded plain records. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Recognize bounded nonempty text. */
function nonEmpty(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

/** Recognize canonical ISO timestamps. */
function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}
