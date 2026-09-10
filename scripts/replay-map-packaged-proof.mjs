#!/usr/bin/env node
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const executablePath = process.argv[2]
const evidence = path.resolve(process.argv[3] ?? 'tmp/batch2-packaged-proof')
if (!path.isAbsolute(executablePath ?? '')) throw new Error('Supply an absolute packaged executable path.')
await mkdir(evidence, { recursive: true })
const profile = await mkdtemp(path.join(tmpdir(), 'sar-replay-map-proof-'))
let app
try {
  app = await electron.launch({ executablePath, env: { ...process.env,
    SARTRACKER_ELECTRON_USER_DATA_PATH: profile, SARTRACKER_ELECTRON_BLOCK_NETWORK: '1' } })
  const page = await app.firstWindow()
  page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined) })
  await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
  const seeded = await page.evaluate(async () => {
    const store = window.sartrackerElectron.missionStore
    const mission = await store.createMission({ name: 'Replay geometry proof', start_time: new Date(Date.now() - 60_000).toISOString() })
    const ring = Array.from({ length: 2000 }, (_, i) => [-9.7 + Math.cos(i * Math.PI / 1000) * 0.01, 52 + Math.sin(i * Math.PI / 1000) * 0.01])
    ring.push(ring[0])
    const geometry = JSON.stringify({ type: 'Polygon', coordinates: [ring] })
    const drawing = await store.upsertDrawing({ mission_id: mission.id, type: 'search_area', name: 'Large retained search area', color: '#ff7700', display_order: 1, geometry_json: geometry })
    await store.finishMission(mission.id)
    return { missionId: mission.id, drawingId: drawing.id, geometry }
  })
  const selectedTime = new Date().toISOString()
  /** Exercises the public live or archive preload bridge and validates every detail fragment. */
  const readGeometry = async (sessionId = null) => page.evaluate(async ({ seeded, selectedTime, sessionId }) => {
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
    if (JSON.parse(serialized).geometry_json !== seeded.geometry) throw new Error('Retained geometry changed.')
    return { serialized, fragments, expectedHash: object.state._state_sha256 }
  }, { seeded, selectedTime, sessionId })
  const live = await readGeometry()
  expect(createHash('sha256').update(live.serialized).digest('hex')).toBe(live.expectedHash)
  await page.reload()
  await page.evaluate(() => new Promise((resolve) => {
    const evidence = { maximumGapMs: 0, previous: 0, frameId: 0 }
    window.__replayFrameProof = evidence
    /** Measures renderer response while the additional review map is opened and populated. */
    const frame = (time) => {
      if (evidence.previous) evidence.maximumGapMs = Math.max(evidence.maximumGapMs, time - evidence.previous)
      evidence.previous = time
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
  expect(await map.locator('.maplibregl-popup-content').evaluate((element) => getComputedStyle(element).color)).toBe('rgb(28, 25, 23)')
  const maximumFrameGapMs = await page.evaluate(() => {
    cancelAnimationFrame(window.__replayFrameProof.frameId)
    return window.__replayFrameProof.maximumGapMs
  })
  expect(maximumFrameGapMs).toBeLessThan(200)
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
  try { archived = await readGeometry(opened.sessionId) }
  finally { await page.evaluate((sessionId) => window.sartrackerElectron.archiveReview.close({ sessionId }), opened.sessionId) }
  expect(archived.serialized).toBe(live.serialized)
  await page.screenshot({ path: path.join(evidence, 'packaged-shell.png') })
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify({ passed: true, executablePath,
    liveFragments: live.fragments, archiveFragments: archived.fragments, stateSha256: live.expectedHash, maximumFrameGapMs,
    boundary: 'Packaged public preload, live SQLite and independently verified encrypted archive; synthetic geometry. Native replay map rendered and selected the retained large search area.' }, null, 2))
} catch (error) {
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
