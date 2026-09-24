#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashCandidateFile } from './candidate-artifacts.mjs'
import { validateMapSurface, validateMapSurfaceFacts } from './map-surface-receipts.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const C14_MISSION_NAME = 'C14 map surface proof'

/** Execute the fixed C14 packaged map/layer surface producer. */
export async function runMapSurfaceProbe(input, { developmentTestHarness = false } = {}) {
  const options = normalizeOptions(input)
  await mkdir(options.evidence, { recursive: true, mode: 0o700 })
  const profile = await mkdtemp(path.join(options.evidence, '.profile-c14-'))
  const report = {
    schema: 'sartracker-map-surface-v1',
    contractId: 'C14',
    developmentTestHarness,
    runtime: null,
    persisted: { before: null, after: null },
    map: { before: null, after: null },
    visibility: { marker: null, drawing: null },
    focus: null,
    overlayFailure: null,
    cleanup: { applicationClosed: false, profileRemoved: false },
    failure: null,
    validation: null,
  }
  let app
  let page
  let failure
  const consoleLines = []
  try {
    const args = process.platform === 'linux'
      ? ['--no-sandbox', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE']
      : []
    if (developmentTestHarness) args.unshift(path.join(projectRoot, 'electron/main.cjs'))
    const env = {
      ...process.env,
      SARTRACKER_ELECTRON_USER_DATA_PATH: profile,
      SARTRACKER_ELECTRON_BLOCK_NETWORK: '1',
    }
    delete env.ELECTRON_RENDERER_URL
    app = await electron.launch({ executablePath: options.app, args, env, timeout: 30_000 })
    const runtime = await app.evaluate(({ app: runningApp }) => ({
      executable: process.execPath,
      appPath: runningApp.getAppPath(),
      isPackaged: runningApp.isPackaged,
      profile: runningApp.getPath('userData'),
    }))
    if (runtime.profile !== profile || (!developmentTestHarness && (!runtime.isPackaged || !runtime.appPath.endsWith('.asar')))) {
      throw new Error('C14 runtime or disposable profile identity differs.')
    }
    report.runtime = {
      tier: developmentTestHarness ? 'development-electron' : 'packaged-electron',
      executableSha256: (await hashCandidateFile(runtime.executable)).sha256,
      asarSha256: developmentTestHarness ? null : (await hashCandidateFile(runtime.appPath)).sha256,
    }
    page = await app.firstWindow()
    page.on('console', (message) => {
      if (consoleLines.length < 200) consoleLines.push(message.text().slice(0, 600))
    })
    page.on('dialog', (dialog) => { void dialog.accept().catch(() => undefined) })
    page.setDefaultTimeout(20_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
    await page.screenshot({ path: path.join(options.evidence, 'map-surface-runtime.png'), fullPage: true })

    await page.getByTestId('mission-name-input').fill(C14_MISSION_NAME)
    await page.getByTestId('mission-start-btn').click()
    await page.getByTestId('mission-control').waitFor()
    const missionId = await page.evaluate(async (name) => {
      const missions = await window.sartrackerElectron.missionStore.listMissions()
      const mission = missions.find((candidate) => candidate.name === name)
      if (!mission) throw new Error('C14 mission was not visible through the public bridge.')
      return mission.id
    }, C14_MISSION_NAME)
    await seedMapEvidence(page)
    await page.reload()
    await page.getByTestId('app-shell').waitFor({ timeout: 60_000 })
    const recovery = page.getByTestId('mission-recovery-dialog')
    if (await recovery.count() > 0 && await recovery.isVisible()) {
      await recovery.getByRole('button', { name: 'Resume' }).click()
    }
    await page.waitForFunction(() => window.__SARTRACKER_MAP__ !== undefined)
    await page.waitForFunction(() => {
      const map = window.__SARTRACKER_MAP__
      const sources = map?.getStyle()?.sources ?? {}
      return sources['mission-markers']?.type === 'geojson' && sources['mission-drawings']?.type === 'geojson'
    })

    report.persisted.before = await readPersistedSnapshot(page, missionId)
    const marker = report.persisted.before.markers.find((candidate) => candidate.name === 'C14 marker')
    const drawing = report.persisted.before.drawings.find((candidate) => candidate.name === 'C14 line')
    if (!marker || !drawing) throw new Error('C14 UI-created marker or drawing was not persisted.')
    report.map.before = await readMapSnapshot(page)
    await page.getByTestId('sidebar-tab-layers').click()
    const markerToggle = page.getByTestId(`layer-visibility-feature-marker-${marker.id}`)
    const drawingToggle = page.getByTestId(`layer-visibility-feature-drawing-${drawing.id}`)
    await markerToggle.waitFor()
    await drawingToggle.waitFor()
    await markerToggle.click()
    await page.waitForFunction((id) => JSON.stringify(window.__SARTRACKER_MAP__?.getFilter('mission-markers-symbol-ipp_lkp') ?? '').includes(id), marker.id)
    const markerHidden = true
    await markerToggle.click()
    await page.waitForFunction((id) => !JSON.stringify(window.__SARTRACKER_MAP__?.getFilter('mission-markers-symbol-ipp_lkp') ?? '').includes(id), marker.id)
    await drawingToggle.click()
    await page.waitForFunction((id) => JSON.stringify(window.__SARTRACKER_MAP__?.getFilter('mission-drawings-line') ?? '').includes(id), drawing.id)
    const drawingHidden = true
    await drawingToggle.click()
    await page.waitForFunction((id) => !JSON.stringify(window.__SARTRACKER_MAP__?.getFilter('mission-drawings-line') ?? '').includes(id), drawing.id)
    report.visibility = {
      marker: { id: marker.id, hiddenObserved: markerHidden, restored: true, sourceRetained: await sourceContains(page, 'mission-markers', marker.id, 'markerId') },
      drawing: { id: drawing.id, hiddenObserved: drawingHidden, restored: true, sourceRetained: await sourceContains(page, 'mission-drawings', drawing.id, 'drawingId') },
    }

    await page.getByTestId('basemap-menu-toggle').click()
    await page.getByTestId('basemap-btn-esri_topo').click()
    await page.waitForFunction(() => {
      const map = window.__SARTRACKER_MAP__
      const sources = map?.getStyle()?.sources ?? {}
      const basemap = Object.keys(sources).find((id) => !['mission-markers', 'mission-drawings'].includes(id))
      return basemap === 'esri_topo' && sources['mission-markers']?.type === 'geojson' && sources['mission-drawings']?.type === 'geojson'
    })
    await page.getByTestId('focus-mode-toggle').click()
    await page.getByTestId('focus-mode-coordinate-mirror').waitFor()
    report.focus = { before: false, activeObserved: true, coordinateMirrorVisible: true, restored: true }
    await page.getByTestId('focus-mode-toggle').click()
    await page.getByTestId('focus-mode-coordinate-mirror').waitFor({ state: 'hidden' })

    report.overlayFailure = await exerciseOverlayFailure(page, consoleLines, options.evidence)
    report.map.after = await readMapSnapshot(page)
    report.persisted.after = await readPersistedSnapshot(page, missionId)
  } catch (error) {
    failure = error
    report.failure = error instanceof Error ? error.message.slice(0, 1000) : 'C14 map producer failed.'
    if (page) await page.screenshot({ path: path.join(options.evidence, 'map-surface-failure.png'), fullPage: true, timeout: 5_000 }).catch(() => undefined)
  } finally {
    if (app) {
      try {
        await app.close()
        report.cleanup.applicationClosed = true
      } catch (error) {
        failure ??= error
      }
    }
    if (report.cleanup.applicationClosed) {
      try {
        await rm(profile, { recursive: true })
        report.cleanup.profileRemoved = true
      } catch (error) {
        failure ??= error
      }
    }
    if (failure === undefined && report.failure === null) {
      try {
        report.validation = developmentTestHarness
          ? validateMapSurfaceFacts(report)
          : validateMapSurface(report)
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 1000) : 'C14 map report validation failed.'
        report.validation = { status: 'FAIL', error: message }
        if (!developmentTestHarness) {
          failure = error
          report.failure = message
        }
      }
    }
    if (failure && report.validation === null) {
      report.validation = { status: 'FAIL', error: report.failure }
    }
    await writeFile(path.join(options.evidence, 'map-surface-report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  }
  if (failure) throw failure
  return report
}

async function seedMapEvidence(page) {
  const canvas = page.locator('.maplibregl-canvas').first()
  await page.getByTestId('drawing-toolbar-expand').click()
  await page.getByTestId('drawing-tool-line').click({ force: true })
  await canvas.click({ position: { x: 420, y: 240 }, force: true })
  await canvas.click({ position: { x: 560, y: 300 }, force: true })
  await canvas.click({ position: { x: 560, y: 300 }, button: 'right', force: true })
  await page.getByTestId('drawing-dialog').waitFor()
  await page.getByTestId('drawing-name-input').fill('C14 line')
  await page.getByTestId('drawing-save-btn').click()
  await page.getByTestId('drawing-dialog').waitFor({ state: 'hidden' })

  await page.getByTestId('drawing-tool-marker_at_grid').click({ force: true })
  await page.getByTestId('marker-at-grid-reference-input').fill('V 80 84')
  await page.getByTestId('marker-at-grid-create-btn').click()
  await page.getByTestId('marker-dialog').waitFor()
  await page.getByTestId('marker-name-input').fill('C14 marker')
  await page.getByTestId('marker-save-btn').click()
  await page.getByTestId('marker-dialog').waitFor({ state: 'hidden' })
}

async function readPersistedSnapshot(page, missionId) {
  return page.evaluate(async (id) => {
    const bridge = window.sartrackerElectron.missionStore
    const [markers, drawings] = await Promise.all([bridge.listMarkers(id), bridge.listDrawings(id)])
    return {
      missionId: id,
      markers: markers.map((marker) => ({ id: marker.id, type: marker.type, name: marker.name, lat: marker.lat, lon: marker.lon })),
      drawings: drawings.map((drawing) => ({ id: drawing.id, type: drawing.type, name: drawing.name, geometry: JSON.parse(drawing.geometry_json) })),
      digest: JSON.stringify({
        markers: markers.map((marker) => [marker.id, marker.type, marker.name, marker.lat, marker.lon]).sort(),
        drawings: drawings.map((drawing) => [drawing.id, drawing.type, drawing.name, drawing.geometry_json]).sort(),
      }),
    }
  }, missionId)
}

async function readMapSnapshot(page) {
  return page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    if (!map) throw new Error('C14 MapLibre instance was unavailable.')
    const style = map.getStyle()
    const sourceIds = ['mission-markers', 'mission-drawings']
    const sources = sourceIds.map((id) => {
      const source = style.sources[id]
      const raw = map.getSource(id)?.serialize?.()?.data ?? source?.data
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw
      return {
        id,
        type: source?.type ?? 'missing',
        features: Array.isArray(data?.features) ? data.features.map((feature) => ({
          geometry: feature.geometry,
          properties: {
            markerId: feature.properties?.markerId ?? null,
            markerType: feature.properties?.markerType ?? null,
            drawingId: feature.properties?.drawingId ?? null,
            drawingType: feature.properties?.drawingType ?? null,
            featureKind: feature.properties?.featureKind ?? null,
            name: feature.properties?.name ?? null,
          },
        })) : [],
      }
    })
    return {
      basemapId: Object.keys(style.sources).find((id) => !sourceIds.includes(id)) ?? '',
      sources,
      overlayLayerIds: style.layers.filter((layer) => sourceIds.includes(layer.source)).map((layer) => layer.id),
    }
  })
}

async function sourceContains(page, sourceId, id, property) {
  return page.evaluate(({ sourceId, id, property }) => {
    const source = window.__SARTRACKER_MAP__?.getStyle().sources[sourceId]
    const raw = window.__SARTRACKER_MAP__?.getSource(sourceId)?.serialize?.()?.data ?? source?.data
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw
    return data?.features?.some((feature) => feature.properties?.[property] === id) === true
  }, { sourceId, id, property })
}

/** Inject one persistent overlay fault and observe its warning and recovery surfaces. */
export async function exerciseOverlayFailure(page, consoleLines, evidenceDirectory, onStage = () => {}) {
  const injection = await page.evaluate(() => {
    const map = window.__SARTRACKER_MAP__
    if (!map) throw new Error('C14 map was unavailable for failure injection.')
    const baselineWarningTexts = [...document.querySelectorAll('[data-testid="map-health-degraded"], [data-testid="map-offline-warning"], [data-testid^="map-overlay-warning-"]')]
      .map((element) => element.textContent?.trim() ?? '')
      .filter((text) => text.length > 0)
    const originalAddSource = map.addSource
    const state = { baselineWarningTexts, originalAddSource, throwHookHit: false }
    window.__C14_OVERLAY_FAILURE__ = state
    map.addSource = function addSourceWithSyntheticFailure(id, source, ...rest) {
      if (id === 'mission-markers') {
        state.throwHookHit = true
        throw new Error('C14 synthetic persistent overlay sync failure')
      }
      return originalAddSource.call(this, id, source, ...rest)
    }
    const markerLayers = map.getStyle().layers?.filter((layer) => layer.source === 'mission-markers') ?? []
    for (const layer of markerLayers) {
      if (map.getLayer(layer.id)) map.removeLayer(layer.id)
    }
    if (map.getSource('mission-markers')) map.removeSource('mission-markers')
    map.fire('style.load')
    return { throwHookHit: state.throwHookHit }
  })
  if (injection.throwHookHit) onStage('fault')
  await new Promise((resolve) => setTimeout(resolve, 500))
  if (!injection.throwHookHit && await page.evaluate(() => window.__C14_OVERLAY_FAILURE__?.throwHookHit === true)) {
    onStage('fault')
  }
  onStage('steady')
  await page.screenshot({ path: path.join(evidenceDirectory, 'map-surface-overlay-failure.png'), fullPage: true })
  const result = await page.evaluate(async () => {
    const map = window.__SARTRACKER_MAP__
    const state = window.__C14_OVERLAY_FAILURE__
    if (!map || state === undefined) throw new Error('C14 overlay failure state was lost.')
    const markerWarning = document.querySelector('[data-testid="map-overlay-warning-markers"]')
    const warningText = markerWarning?.textContent?.trim() ?? null
    const operatorWarningVisible = warningText !== null
      && /markers\s+overlay/iu.test(warningText)
      && !/tile|basemap|map.*degraded/iu.test(warningText)
    map.addSource = state.originalAddSource
    map.fire('idle')
    await new Promise((resolve) => window.setTimeout(resolve, 750))
    const recoveryObserved = map.getStyle().sources['mission-markers']?.type === 'geojson'
      && map.getStyle().sources['mission-drawings']?.type === 'geojson'
    const warningClearedAfterRecovery = recoveryObserved
      && document.querySelector('[data-testid="map-overlay-warning-markers"]') === null
    delete window.__C14_OVERLAY_FAILURE__
    return { attempted: true, throwHookHit: state.throwHookHit, baselineWarningTexts: state.baselineWarningTexts,
      warningRegistrationId: markerWarning === null ? null : 'markers', warningText, operatorWarningVisible,
      recoveryObserved, warningClearedAfterRecovery, consoleOnly: false }
  })
  result.consoleOnly = result.throwHookHit === true
    && consoleLines.some((line) => /Map overlay synchronization failed/u.test(line))
    && !result.operatorWarningVisible
  if (result.recoveryObserved) onStage('recovery')
  return result
}

function normalizeOptions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || !path.isAbsolute(input.app ?? '') || !path.isAbsolute(input.evidence ?? '')) {
    throw new Error('C14 map probe requires absolute app and evidence paths.')
  }
  return { app: input.app, evidence: input.evidence }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('C14 map probe requires exactly app and evidence paths.')
  await runMapSurfaceProbe({ app: process.argv[2], evidence: process.argv[3] }).catch((error) => {
    console.error(String(error.message).slice(0, 1500))
    process.exitCode = 1
  })
}
