#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { hashCandidateFile } from './candidate-artifacts.mjs'
import { validateMarkerAttachmentReceipt } from './marker-attachment-receipts.mjs'
import { closeMarkerAttachmentApplication } from './marker-attachment-close.mjs'

const require = createRequire(import.meta.url)
const { readArchiveContainer, readArchivePreamble } = require('../../electron/archive-container.cjs')
const { unwrapMissionArchiveKey, zeroBuffer } = require('../../electron/archive-crypto.cjs')

const ORIGINAL_ATTACHMENT = Buffer.from('C12 original attachment bytes', 'utf8')
const REPLACEMENT_ATTACHMENT = Buffer.from('C12 replacement attachment bytes', 'utf8')
const ATTACHMENT_FILE_NAME = 'same-name.txt'
const MARKER_KINDS = Object.freeze(['ipp_lkp', 'clue', 'hazard', 'casualty'])
const SHA1 = /^[a-f0-9]{40}$/u
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const ARCHIVE_REVIEW_READINESS_TIMEOUT_MS = 60_000

/** Execute the fixed C12 marker and attachment producer; the development flag is API-only and never a CLI option. */
export async function runMarkerAttachmentProbe(input, { developmentTestHarness = false } = {}) {
  const options = normalizeOptions(input)
  await mkdir(options.evidence, { recursive: true })
  const profile = await mkdtemp(path.join(options.evidence, '.profile-c12-'))
  let app

  try {
    const launchArgs = process.platform === 'linux'
      ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
      : []
    if (developmentTestHarness) launchArgs.unshift(path.join(projectRoot, 'electron/main.cjs'))
    const launchEnvironment = {
      ...process.env,
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
    }
    if (developmentTestHarness) delete launchEnvironment.ELECTRON_RENDERER_URL
    app = await electron.launch({
    executablePath: options.app, args: launchArgs, env: launchEnvironment,
    })
  const page = await app.firstWindow()
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined) })
  await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
  await page.screenshot({ path: path.join(options.evidence, 'marker-attachment-runtime.png'), fullPage: true })
  await page.getByTestId('mission-name-input').fill('C12 synthetic marker attachment proof')
  await page.getByTestId('mission-start-btn').click()

  const runtimeIdentity = await readPackagedRuntimeIdentity(app, { developmentTestHarness })

  let seededPromiseError
  const seededPromise = page.evaluate(async ({ markerKinds, original, replacement, fileName }) => {
    const bridge = window.sartrackerElectron
    if (bridge?.missionStore === undefined || typeof bridge.ingestMarkerAttachment !== 'function') {
      throw new Error('Marker and attachment preload APIs are unavailable.')
    }
    const mission = (await bridge.missionStore.listMissions())
      .find((entry) => entry.name === 'C12 synthetic marker attachment proof')
    if (!mission) throw new Error('C12 UI-created mission is unavailable to the public bridge.')
    const attachmentOne = await bridge.ingestMarkerAttachment({
      missionId: mission.id,
      fileName,
      bytesBase64: original,
    })
    const attachmentTwo = await bridge.ingestMarkerAttachment({
      missionId: mission.id,
      fileName,
      bytesBase64: replacement,
    })
    if (typeof attachmentOne !== 'string' || typeof attachmentTwo !== 'string'
        || attachmentOne === attachmentTwo) {
      throw new Error('Marker attachment ingest did not create two distinct stored paths.')
    }

    const markerRows = []
    for (const [index, type] of markerKinds.entries()) {
      const common = {
        mission_id: mission.id,
        type,
        name: `C12 ${type} original`,
        description: `Synthetic ${type} marker`,
        lat: 52.0599 + index * 0.001,
        lon: -9.5045 - index * 0.001,
        irish_grid_e: 480000 + index,
        irish_grid_n: 580000 + index,
        display_order: index,
        updated_by: 'C12 synthetic coordinator',
      }
      const created = await bridge.missionStore.upsertMarker(
        type === 'clue' ? { ...common, attachment_path: attachmentOne } : common,
      )
      const updated = await bridge.missionStore.upsertMarker({
        ...common,
        id: created.id,
        name: `C12 ${type} edited`,
        description: `Synthetic edited ${type} marker`,
        ...(type === 'clue' ? { attachment_path: attachmentTwo } : {}),
      })
      markerRows.push({
        type,
        markerId: created.id,
        lifecycle: ['created', 'updated', 'retired'],
        versionOperations: [],
        versionCount: 0,
        activeAfterRetire: false,
        updatedIdMatches: updated.id === created.id,
      })
    }
    window.__C12_MARKERS_READY__ = true
    await new Promise((resolve) => { window.__C12_MARKERS_RELEASE__ = resolve })
    for (const markerRow of markerRows) {
      const retired = await bridge.missionStore.deleteMarker(markerRow.markerId)
      markerRow.activeAfterRetire = retired === true
        && (await bridge.missionStore.listMarkers(mission.id)).some((marker) => marker.id === markerRow.markerId)
    }
    const activeMarkerCountAfterRetire = (await bridge.missionStore.listMarkers(mission.id)).length
    const auditEvents = await bridge.missionStore.listAuditEvents(mission.id, {
      includeTelemetry: false,
      limit: 5_000,
    })
    for (const markerRow of markerRows) {
      const relevantEvents = auditEvents
        .filter((event) => ['marker_created', 'marker_updated', 'marker_deleted'].includes(event.event_type))
        .filter((event) => {
          try {
            const details = typeof event.details_json === 'string'
              ? JSON.parse(event.details_json)
              : event.details
            return details?.marker_id === markerRow.markerId
          } catch {
            return false
          }
        })
        .reverse()
      const operations = relevantEvents
        .map((event) => ({ marker_created: 'created', marker_updated: 'updated', marker_deleted: 'retired' })[event.event_type])
      if (relevantEvents.length !== 3 || operations.length !== 3 || new Set(operations).size !== 3) {
        throw new Error(`C12 marker audit lifecycle is incomplete for ${markerRow.type}.`)
      }
      markerRow.auditEvents = relevantEvents.map((event) => ({
        id: event.id,
        eventType: event.event_type,
        timestamp: event.timestamp,
      }))
      markerRow.versionOperations = operations
      markerRow.versionCount = operations.length
    }
    window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
      phase: 'finishMission',
      startedAt: Date.now(),
    }
    const finished = await bridge.missionStore.finishMission(mission.id)
    window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
      phase: 'issueMissionArchiveRecoveryCode',
      startedAt: Date.now(),
    }
    const issued = await bridge.missionStore.issueMissionArchiveRecoveryCode(mission.id)
    window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
      phase: 'finalizeMission',
      startedAt: Date.now(),
    }
    const finalized = await bridge.missionStore.finalizeMission(mission.id, {
      operationId: issued.operationId,
      recoveryCode: issued.recoveryCode,
      passphrase: 'C12 synthetic marker proof passphrase 2026!',
    })
    const archive = finalized?.archive
    if (archive?.mission_id !== mission.id || archive.container_version !== 2) {
      throw new Error('C12 marker probe did not finalize the encrypted mission archive.')
    }
    window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
      phase: 'archiveReview.open',
      startedAt: Date.now(),
    }
    const opened = await bridge.archiveReview.open({
      operationId: crypto.randomUUID(),
      archiveId: archive.id,
      containerVersion: 2,
      slotType: 'passphrase',
      secret: 'C12 synthetic marker proof passphrase 2026!',
    })
    let attachmentReferences
    let review
    let openedAttachment = false
    let closed = false
    try {
      window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
        phase: 'listArchiveAttachmentPage',
        startedAt: Date.now(),
      }
      attachmentReferences = await bridge.archiveReview.read({
        sessionId: opened.sessionId,
        requestId: crypto.randomUUID(),
        method: 'listArchiveAttachmentPage',
        input: { missionId: mission.id, cursor: null, limit: 100 },
      })
      window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
        phase: 'readMissionReview',
        startedAt: Date.now(),
      }
      review = await bridge.archiveReview.read({
        sessionId: opened.sessionId,
        requestId: crypto.randomUUID(),
        method: 'readMissionReview',
        input: { missionId: mission.id, includeTelemetry: false, auditLimit: 5_001 },
      })
      const target = attachmentReferences?.entries?.find((entry) => entry.referenceKind === 'marker_version')
      if (!target) throw new Error('C12 archive review did not expose a marker-version attachment reference.')
      window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
        phase: 'openAttachment',
        startedAt: Date.now(),
        referenceKind: target.referenceKind,
        referenceId: target.referenceId,
      }
      openedAttachment = await bridge.archiveReview.read({
        sessionId: opened.sessionId,
        requestId: crypto.randomUUID(),
        method: 'openAttachment',
        input: {
          missionId: mission.id,
          attachmentPath: target.attachmentPath,
          referenceKind: target.referenceKind,
          referenceId: target.referenceId,
        },
      }) === true
      window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ = {
        phase: 'settled',
        settledAt: Date.now(),
        referenceKind: target.referenceKind,
        referenceId: target.referenceId,
        openedAttachment,
      }
      window.__C12_ARCHIVE_REVIEW_READY__ = {
        sessionId: opened.sessionId,
        archivePath: archive.archive_path,
        storedPaths: [attachmentOne, attachmentTwo],
        target,
      }
      await new Promise((resolve) => { window.__C12_ARCHIVE_REVIEW_RELEASE__ = resolve })
    } finally {
      await bridge.archiveReview.close({ sessionId: opened.sessionId })
      closed = true
    }
    return {
      missionId: mission.id,
      markerRows,
      activeMarkerCountAfterRetire,
      finished: finished?.status === 'finished',
      archive: {
        finalized: finalized?.mission?.status === 'finalized',
        containerVersion: archive.container_version,
        immutable: archive.status === 'verified',
        verified: archive.status === 'verified',
        review: {
          opened: opened?.immutable === true,
          closed,
          immutable: opened?.immutable === true,
          attachmentReferences: attachmentReferences?.entries ?? [],
          totalCount: attachmentReferences?.totalCount ?? -1,
          missionCount: Array.isArray(review?.missions) ? review.missions.length : -1,
        },
      },
      attachments: [
        { version: 'original', fileName, storedBasename: attachmentOne.split('/').at(-1) },
        { version: 'replacement', fileName, storedBasename: attachmentTwo.split('/').at(-1) },
      ],
      storedPaths: [attachmentOne, attachmentTwo],
      archivePath: archive.archive_path,
      openedAttachment,
    }
  }, {
    markerKinds: MARKER_KINDS,
    original: ORIGINAL_ATTACHMENT.toString('base64'),
    replacement: REPLACEMENT_ATTACHMENT.toString('base64'),
    fileName: ATTACHMENT_FILE_NAME,
  }).catch((error) => {
    seededPromiseError = error
    return null
  })

  const sourceTree = process.env.EXPECTED_SOURCE_TREE
  if (!SHA1.test(options.expectedHead) || !SHA1.test(sourceTree ?? '')) {
    throw new Error('C12 marker probe requires exact expected source head and tree bindings.')
  }
  await waitForMarkersReady(page)
  await page.getByTestId('sidebar-tab-tools').click()
  await page.getByTestId('drawing-toolbar-expand').click()
  await page.getByTestId('drawing-tool-marker_at_grid').click({ force: true })
  await page.getByTestId('marker-at-grid-panel').waitFor({ state: 'visible' })
  await page.getByTestId('marker-at-grid-reference-input').fill('Q 99842 04015')
  await page.getByTestId('marker-at-grid-create-btn').click()
  await page.getByTestId('marker-dialog').waitFor({ state: 'visible' })
  await page.getByTestId('marker-dialog').getByRole('button', { name: 'Cancel' }).click()
  await page.getByTestId('sidebar-tab-layers').click()
  await page.getByTestId('layer-refresh-btn').click()
  await page.getByTestId('layer-expand-all-btn').click()
  for (const markerKind of MARKER_KINDS) {
    const markerRow = page.getByTestId('layer-tree').getByText(`C12 ${markerKind} edited`, { exact: true })
    await markerRow.waitFor({ timeout: 60_000 })
    await markerRow.scrollIntoViewIfNeeded()
    await markerRow.screenshot({ path: path.join(options.evidence, `marker-attachment-${markerKind}.png`) })
  }
  const layerTree = page.getByTestId('layer-tree')
  await layerTree.evaluate((element) => { element.scrollTop = element.scrollHeight })
  await layerTree.screenshot({ path: path.join(options.evidence, 'marker-attachment-layer-tree.png') })
  await page.screenshot({ path: path.join(options.evidence, 'marker-attachment-markers.png'), fullPage: true })
  await page.evaluate(() => { window.__C12_MARKERS_RELEASE__?.() })
  const ready = await waitForArchiveReviewReady(page, () => seededPromiseError)
  assertInsideProfile(ready.archivePath, profile)
  for (const storedPath of ready.storedPaths) assertInsideProfile(storedPath, profile)
  const storedFacts = await Promise.all(ready.storedPaths.map((filePath) => readAttachmentIdentity(filePath)))
  const archiveFacts = await readArchiveAttachmentFacts(ready.archivePath, storedFacts.map((fact) => fact.basename))
  const restoredFacts = await waitForRestoredAttachments(profile, ready.sessionId, archiveFacts)
  await page.evaluate(() => { window.__C12_ARCHIVE_REVIEW_RELEASE__?.() })
  const seeded = await seededPromise
  if (seeded === null) throw seededPromiseError ?? new Error('C12 marker lifecycle failed in the renderer.')
  const report = {
    schemaVersion: 1,
    schema: 'sartracker-marker-attachment-probe-v1',
    proofMode: developmentTestHarness
      ? 'development-electron-marker-attachment'
      : 'packaged-electron-marker-attachment',
    developmentTestHarness,
    proofTier: runtimeIdentity.tier,
    source: { head: options.expectedHead, tree: sourceTree },
    artifact: {
      executableSha256: runtimeIdentity.executableSha256,
      archiveSha256: runtimeIdentity.appAsarSha256,
    },
    mission: {
      missionId: seeded.missionId,
      finished: seeded.finished,
      activeMarkerCountAfterRetire: seeded.activeMarkerCountAfterRetire,
    },
    markers: seeded.markerRows,
    attachments: seeded.attachments.map((entry, index) => ({
      ...entry,
      stored: { bytes: storedFacts[index].bytes, sha256: storedFacts[index].sha256 },
      archive: archiveFacts[index],
      restored: {
        basename: restoredFacts[index].basename,
        sourceBasename: restoredFacts[index].sourceBasename,
        entryName: restoredFacts[index].entryName,
        bytes: restoredFacts[index].bytes,
        sha256: restoredFacts[index].sha256,
      },
    })),
    archive: seeded.archive,
    boundary: developmentTestHarness
      ? 'Development Electron marker kinds and attachment archive custody only; not candidate package proof or field qualification.'
      : 'Synthetic packaged marker kinds and attachment archive custody only; no field proof claim.',
  }
  if (!SHA1.test(report.source.head) || !SHA1.test(report.source.tree)) throw new Error('C12 source identity is invalid.')
  if (!/^[a-f0-9]{64}$/u.test(report.artifact.executableSha256)
      || (!developmentTestHarness && !/^[a-f0-9]{64}$/u.test(report.artifact.archiveSha256))
      || seeded.openedAttachment !== true) throw new Error('C12 runtime or attachment-review identity is incomplete.')
  await writeFile(path.join(options.evidence, 'marker-attachment-receipt.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  const validation = validateMarkerAttachmentReceipt(report, {
    proofMode: report.proofMode,
    source: { expectedHead: report.source.head, tree: report.source.tree },
    artifact: {
      packagedExecutableSha256: report.artifact.executableSha256,
      packagedApplicationArchiveSha256: report.artifact.archiveSha256,
    },
    workload: { markerKinds: MARKER_KINDS, attachmentFileName: ATTACHMENT_FILE_NAME },
  })
  if (!developmentTestHarness && !validation.passed) throw new Error(validation.failureReasons.join('; '))
  return report
  } finally {
  try {
    if (app) await closeMarkerAttachmentApplication(app)
  } finally {
    await rm(profile, { recursive: true, force: true })
  }
}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runMarkerAttachmentProbe(parseArguments(process.argv.slice(2)))
}

/** Parse only the fixed reviewed marker-probe CLI. */
function parseArguments(argv) {
  const values = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!['--app', '--evidence', '--expected-head'].includes(flag)) throw new Error(`Unknown C12 marker probe option: ${flag}`)
    const value = argv[++index]
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing value for ${flag}.`)
    if (values[flag] !== undefined) throw new Error(`Duplicate C12 marker probe option: ${flag}`)
    values[flag] = value
  }
  if (!path.isAbsolute(values['--app'] ?? '') || !path.isAbsolute(values['--evidence'] ?? '')) {
    throw new Error('C12 marker probe requires absolute --app and --evidence paths.')
  }
  if (!SHA1.test(values['--expected-head'] ?? '')) throw new Error('C12 marker probe requires an exact --expected-head SHA.')
  return normalizeOptions({ app: values['--app'], evidence: values['--evidence'], expectedHead: values['--expected-head'] })
}

/** Validate the API-only producer options shared by CLI and development harness calls. */
function normalizeOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || !path.isAbsolute(input.app ?? '') || !path.isAbsolute(input.evidence ?? '')
      || !SHA1.test(input.expectedHead ?? '')) {
    throw new Error('C12 marker probe requires absolute app/evidence paths and an exact expected-head SHA.')
  }
  return { app: input.app, evidence: input.evidence, expectedHead: input.expectedHead }
}

/** Hash the exact packaged Electron executable and app.asar observed by the main process. */
async function readPackagedRuntimeIdentity(app, { developmentTestHarness = false } = {}) {
  const observed = await app.evaluate(({ app: runningApp }) => ({
    appPath: runningApp.getAppPath(),
    isPackaged: runningApp.isPackaged,
    executablePath: process.execPath,
  }))
  if (!path.isAbsolute(observed.executablePath)
      || (!developmentTestHarness && (observed.isPackaged !== true || !path.isAbsolute(observed.appPath)
        || !observed.appPath.endsWith('.asar')))) {
    throw new Error('C12 requires a packaged Electron ASAR runtime.')
  }
  const executable = await hashCandidateFile(observed.executablePath)
  const archive = developmentTestHarness ? null : await hashCandidateFile(observed.appPath)
  return Object.freeze({
    tier: developmentTestHarness ? 'development-electron' : 'packaged-electron',
    appAsarSha256: archive?.sha256 ?? null,
    executableSha256: executable.sha256,
  })
}

/** Wait for the renderer to confirm that read-only archive review opened one attachment. */
export async function waitForArchiveReviewReady(page, readFailure = () => null) {
  const deadline = Date.now() + ARCHIVE_REVIEW_READINESS_TIMEOUT_MS
  while (Date.now() < deadline) {
    const failure = readFailure()
    if (failure !== null && failure !== undefined) throw failure
    const ready = await page.evaluate(() => window.__C12_ARCHIVE_REVIEW_READY__ ?? null)
    if (ready !== null && ready.openedAttachment !== false) return ready
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const operationState = await page.evaluate(() => window.__C12_ARCHIVE_REVIEW_OPERATION_STATE__ ?? null)
  throw createArchiveReviewReadinessTimeoutError(operationState)
}

/** Create a bounded, stage-specific readiness error without retaining private paths. */
export function createArchiveReviewReadinessTimeoutError(operationState, now = Date.now()) {
  const message = 'C12 archive review did not expose its bounded attachment-open readiness.'
  const pendingPhases = new Set([
    'finishMission',
    'issueMissionArchiveRecoveryCode',
    'finalizeMission',
    'archiveReview.open',
    'listArchiveAttachmentPage',
    'readMissionReview',
    'openAttachment',
  ])
  if (!pendingPhases.has(operationState?.phase)
      || !Number.isSafeInteger(operationState.startedAt)
      || !Number.isSafeInteger(now)
      || now < operationState.startedAt) {
    return new Error(message)
  }
  const elapsed = now - operationState.startedAt
  const reference = operationState.phase === 'openAttachment'
    ? ` (${operationState.referenceKind ?? 'unknown'}/${operationState.referenceId ?? 'unknown'})`
    : ''
  const error = new Error(`${message} ${operationState.phase} remained pending for ${elapsed}ms${reference}.`)
  error.code = 'C12_ATTACHMENT_OPEN_TIMEOUT'
  return error
}

/** Wait for the public mission UI refresh boundary before retaining marker-state evidence. */
async function waitForMarkersReady(page) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await page.evaluate(() => window.__C12_MARKERS_READY__ === true)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('C12 marker lifecycle did not reach its UI screenshot boundary.')
}

/** Re-hash each restored attachment from the owned archive-review session directory. */
async function waitForRestoredAttachments(profile, sessionId, archiveFacts) {
  const deadline = Date.now() + 60_000
  const directory = path.join(profile, 'archive-review', sessionId, 'attachments')
  while (Date.now() < deadline) {
    try {
      const identities = await Promise.all(archiveFacts.map(async (archiveFact) => {
        const basename = path.basename(archiveFact.entryName)
        const identity = await readAttachmentIdentity(path.join(directory, basename))
        if (identity.basename !== basename) throw new Error('Restored attachment basename changed.')
        return { ...identity, sourceBasename: archiveFact.sourceBasename, entryName: archiveFact.entryName }
      }))
      return identities
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error('C12 archive review did not retain the expected restored attachment bytes.')
}

/** Read one bounded app-owned attachment identity without retaining private path data. */
async function readAttachmentIdentity(filePath) {
  const identity = await hashCandidateFile(filePath)
  return Object.freeze({ basename: path.basename(filePath), bytes: identity.bytes, sha256: identity.sha256 })
}

/** Stream authenticated SARARCH2 members without retaining the whole encrypted archive. */
async function readArchiveAttachmentFacts(archivePath, basenames) {
  const preambleStream = createReadStream(archivePath)
  let preamble
  try {
    preamble = await readArchivePreamble(preambleStream)
  } finally {
    preambleStream.destroy()
  }
  const passphraseSlot = preamble.keySlots.find((slot) => slot.slotType === 'passphrase')
  if (passphraseSlot === undefined) throw new Error('C12 archive does not contain a passphrase key slot.')
  const secret = Buffer.from('C12 synthetic marker proof passphrase 2026!', 'utf8')
  let missionArchiveKey
  try {
    missionArchiveKey = await unwrapMissionArchiveKey({
      slot: passphraseSlot,
      secret,
      headerDigest: preamble.headerDigest,
    })
  } finally {
    zeroBuffer(secret)
  }
  const expected = new Set(basenames)
  const found = new Map()
  let active = null
  const archiveStream = createReadStream(archivePath)
  try {
    await readArchiveContainer({
      readable: archiveStream,
      missionArchiveKey,
      onEntryStart: (entry) => {
        if (!entry.name.startsWith('attachments/')) return
        const entryBasename = path.basename(entry.name)
        const sourceBasename = [...expected].find((basename) => entryBasename.endsWith(`-${basename}`))
        if (sourceBasename === undefined) return
        active = { entry, sourceBasename, bytes: 0, hash: createHash('sha256') }
      },
      onEntryChunk: (entry, chunk) => {
        if (active?.entry !== entry) return
        active.hash.update(chunk)
        active.bytes += chunk.byteLength
      },
      onEntryEnd: (entry) => {
        if (active?.entry !== entry) return
        found.set(active.sourceBasename, Object.freeze({
          entryName: entry.name,
          sourceBasename: active.sourceBasename,
          bytes: active.bytes,
          sha256: active.hash.digest('hex'),
        }))
        active = null
      },
    })
  } finally {
    archiveStream.destroy()
    zeroBuffer(missionArchiveKey)
  }
  return basenames.map((basename) => {
    const fact = found.get(basename)
    if (fact === undefined) throw new Error(`C12 archive is missing attachment entry ${basename}.`)
    return fact
  })
}

/** Keep renderer-reported custody inputs below this probe's owned disposable profile. */
function assertInsideProfile(candidate, profile) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) throw new Error('C12 custody path is not absolute.')
  const relative = path.relative(path.resolve(profile), path.resolve(candidate))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('C12 custody path escaped the owned disposable profile.')
  }
}
