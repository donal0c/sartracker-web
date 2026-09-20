#!/usr/bin/env node
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { validateReplayReceipt } from './qualification/replay-receipts.mjs'
import { createReplayGeometryFixture } from './qualification/replay-probe-fixture.mjs'
import { isExpectedBlockedReplayRequest } from './qualification/replay-probe-diagnostics.mjs'
import { buildReplayMapLaunchArgs } from './qualification/replay-map-launch.mjs'

const executablePath = process.argv[2]
const evidence = path.resolve(process.argv[3] ?? 'tmp/batch2-packaged-proof')
if (!path.isAbsolute(executablePath ?? '')) throw new Error('Supply an absolute packaged executable path.')
await mkdir(evidence, { recursive: true })
const profile = await mkdtemp(path.join(evidence, '.profile-replay-'))
let app
const rendererErrors = []
const rendererRequestsFailed = []
let blockedNetworkRequestCount = 0
try {
  // Match the Linux validation host's attested Mesa/ANGLE path. Chromium's
  // default selection failed WebGL context creation in retained CI 35492584673.
  const launchArgs = buildReplayMapLaunchArgs(process.platform)
  app = await electron.launch({ executablePath, args: launchArgs, env: { ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' } })
  const page = await app.firstWindow()
  page.on('pageerror', (error) => {
    if (rendererErrors.length < 100) rendererErrors.push((error.stack ?? error.message).slice(0, 16_384))
  })
  page.on('crash', () => { rendererErrors.push('Renderer process crashed.') })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown'
    if (isExpectedBlockedReplayRequest(request.url(), failure)) {
      blockedNetworkRequestCount += 1
      return
    }
    if (rendererRequestsFailed.length < 100) rendererRequestsFailed.push({
      url: request.url().slice(0, 16_384), failure: failure.slice(0, 16_384),
    })
  })
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined) })
  await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
  const seeded = await page.evaluate(async (fixture) => {
    const store = window.sartrackerElectron.missionStore
    const mission = await store.createMission({ name: 'Replay geometry proof', start_time: new Date(Date.now() - 60_000).toISOString() })
    const geometry = fixture.initialGeometry
    const drawing = await store.upsertDrawing({ mission_id: mission.id, type: 'search_area', name: 'Large retained search area', color: '#ff7700', display_order: 1, geometry_json: geometry })
    const knownBeforeUpdate = new Date().toISOString()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const updatedGeometry = fixture.updatedGeometry
    await store.upsertDrawing({ id: drawing.id, mission_id: mission.id, type: 'search_area', name: 'Large retained search area', color: '#ff7700', display_order: 1, geometry_json: updatedGeometry })
    const knownAfterUpdate = new Date().toISOString()
    await store.finishMission(mission.id)
    return { missionId: mission.id, drawingId: drawing.id, initialGeometry: geometry, geometry: updatedGeometry,
      knownBeforeUpdate, knownAfterUpdate }
  }, createReplayGeometryFixture())
  const selectedTime = seeded.knownAfterUpdate
  /** Exercises the public live or archive preload bridge and validates every detail fragment. */
  const readGeometry = async (sessionId = null, time = selectedTime, geometry = seeded.geometry) => page.evaluate(async ({ seeded, selectedTime, sessionId, geometry }) => {
    const bridge = window.sartrackerElectron
    const read = (method, query) => sessionId === null ? bridge.missionStore[method](query, crypto.randomUUID())
      : bridge.archiveReview.read({ sessionId, requestId: crypto.randomUUID(), method, input: query })
    const query = { missionId: seeded.missionId, selectedTime, timezone: 'Europe/Dublin', trackLimit: 1000, objectLimit: 100 }
    const first = await read('readMissionReplay', query)
    const object = first.objects.find((item) => item.object_id === seeded.drawingId)
    if (object?.state._state_details_omitted !== true) throw new Error('Large retained object was not summarized.')
    let offset = 0
    let serialized = ''
    let fragments = 0
    while (offset !== null) {
      const page = await read('readMissionReplayObjectChunk', { ...query, replayGeneration: first.replayGeneration,
        objectDetails: { objectType: 'drawing', objectId: seeded.drawingId, offset } })
      const detail = page.objectDetails
      if (detail.offset !== offset || detail.fragment.length > 16384 || detail.fragment.length === 0) throw new Error('Invalid fragment.')
      serialized += detail.fragment
      offset = detail.nextOffset
      fragments++
      if (fragments > 100) throw new Error('Continuation did not terminate.')
    }
    if (JSON.parse(serialized).geometry_json !== geometry) throw new Error('Retained known-at-time geometry changed.')
    return { serialized, fragments, expectedHash: object.state._state_sha256 }
  }, { seeded, selectedTime: time, sessionId, geometry })
  const liveOld = await readGeometry(null, seeded.knownBeforeUpdate, seeded.initialGeometry)
  const live = await readGeometry()
  expect(createHash('sha256').update(live.serialized).digest('hex')).toBe(live.expectedHash)
  await page.reload()
  await page.evaluate(() => new Promise((resolve) => {
    const evidence = { maximumGapMs: 0, previous: 0, frameCount: 0, startedAt: 0, frameId: 0 }
    window.__replayFrameProof = evidence
    /** Measures renderer response while the additional review map is opened and populated. */
    const frame = (time) => {
      if (evidence.startedAt === 0) evidence.startedAt = time
      if (evidence.previous) evidence.maximumGapMs = Math.max(evidence.maximumGapMs, time - evidence.previous)
      evidence.previous = time
      evidence.frameCount += 1
      evidence.frameId = requestAnimationFrame(frame)
      resolve()
    }
    evidence.frameId = requestAnimationFrame(frame)
  }))
  await page.getByTestId('open-mission-review-workspace').click()
  await page.getByRole('button', { name: 'Replay', exact: true }).click()
  await page.getByTestId('mission-replay-seek').click()
  const map = page.getByTestId('mission-replay-map')
  await expect(map).toContainText('Selected-time dated evidence loaded', { timeout: 30_000 })
  await expect(async () => {
    await map.locator('canvas').click({ force: true })
    await expect(map.locator('.maplibregl-popup-content')).toContainText('Large retained search area')
  }).toPass({ timeout: 15_000 })
  const popupText = await map.locator('.maplibregl-popup-content').innerText()
  const popupColor = await map.locator('.maplibregl-popup-content').evaluate((element) => getComputedStyle(element).color)
  expect(popupColor).toBe('rgb(28, 25, 23)')
  await page.evaluate(() => new Promise((resolve) => {
    const waitForMinimumSample = () => {
      const evidence = window.__replayFrameProof
      if (evidence.frameCount >= 60 && evidence.previous - evidence.startedAt >= 1_000) {
        resolve()
        return
      }
      requestAnimationFrame(waitForMinimumSample)
    }
    waitForMinimumSample()
  }))
  const frameEvidence = await page.evaluate(() => {
    cancelAnimationFrame(window.__replayFrameProof.frameId)
    return {
      maximumFrameGapMs: window.__replayFrameProof.maximumGapMs,
      frameCount: window.__replayFrameProof.frameCount,
      measurementDurationMs: window.__replayFrameProof.previous - window.__replayFrameProof.startedAt,
    }
  })
  expect(frameEvidence.maximumFrameGapMs).toBeLessThan(200)
  await map.screenshot({ path: path.join(evidence, 'packaged-replay-map.png') })
  const archive = await page.evaluate(async (missionId) => {
    const store = window.sartrackerElectron.missionStore
    const issued = await store.issueMissionArchiveRecoveryCode(missionId)
    return (await store.finalizeMission(missionId, { operationId: issued.operationId,
      recoveryCode: issued.recoveryCode, passphrase: 'Synthetic replay map proof passphrase 2026!' })).archive
  }, seeded.missionId)
  const opened = await page.evaluate(async (archiveId) => window.sartrackerElectron.archiveReview.open({
    operationId: crypto.randomUUID(), archiveId, containerVersion: 2, slotType: 'passphrase', secret: 'Synthetic replay map proof passphrase 2026!',
  }), archive.id)
  let archived
  let archiveOld
  try {
    archived = await readGeometry(opened.sessionId)
    archiveOld = await readGeometry(opened.sessionId, seeded.knownBeforeUpdate, seeded.initialGeometry)
  }
  finally { await page.evaluate((sessionId) => window.sartrackerElectron.archiveReview.close({ sessionId }), opened.sessionId) }
  expect(archived.serialized).toBe(live.serialized)
  await page.screenshot({ path: path.join(evidence, 'packaged-shell.png') })
  const report = { schemaVersion: 2, executablePath,
    rendererDiagnostics: { errors: rendererErrors, unexpectedRequestFailures: rendererRequestsFailed, blockedNetworkRequestCount },
    source: { initialGeometry: seeded.initialGeometry, updatedGeometry: seeded.geometry,
      knownBeforeUpdate: seeded.knownBeforeUpdate, knownAfterUpdate: seeded.knownAfterUpdate },
    liveOld, liveUpdated: live, archiveOld, archiveUpdated: archived, popupText, popupColor,
    liveFragments: live.fragments, archiveFragments: archived.fragments, stateSha256: live.expectedHash,
    maximumFrameGapMs: frameEvidence.maximumFrameGapMs,
    frameCount: frameEvidence.frameCount,
    measurementDurationMs: frameEvidence.measurementDurationMs,
    boundary: 'Packaged public preload, live SQLite and independently verified encrypted archive; synthetic geometry. Native replay map rendered and selected the retained large search area.' }
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  const validation = validateReplayReceipt(report)
  if (!validation.passed) throw new Error(validation.failureReasons.join('; '))
} catch (error) {
  await writeFile(path.join(evidence, 'renderer-errors.json'), JSON.stringify(rendererErrors, null, 2))
  await writeFile(path.join(evidence, 'renderer-requests-failed.json'), JSON.stringify(rendererRequestsFailed, null, 2))
  if (app) {
    const page = await app.firstWindow()
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => undefined)
    console.error((await page.locator('body').innerText().catch(() => '')).slice(-4000))
  }
  throw error
} finally {
  if (app) await app.close()
  await rm(profile, { recursive: true, force: true })
}
