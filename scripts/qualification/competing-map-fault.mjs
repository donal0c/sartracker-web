import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { exerciseOverlayFailure } from './map-surface-probe.mjs'

/** Exercise the actual overlay failure in the currently tracked app and always remove its hook. */
export async function runCompetingMapFault({ page, evidenceDir }) {
  if (!path.isAbsolute(evidenceDir ?? '')) throw new Error('Map fault evidence directory must be absolute.')
  const lines = []
  const onConsole = (message) => { if (lines.length < 200) lines.push(message.text().slice(0, 600)) }
  const stages = []
  const observeStage = (stage) => stages.push({ stage, atMs: performance.now() })
  const result = {
    name: 'mapFault', requestId: randomUUID(), startedAtMs: performance.now(), completedAtMs: null,
    status: 'rejected', stages, observed: null, cleanup: { restored: false },
    screenshotPath: path.join(evidenceDir, 'map-surface-overlay-failure.png'), error: null,
  }
  page.on('console', onConsole)
  observeStage('start')
  try {
    result.observed = await exerciseOverlayFailure(page, lines, evidenceDir, observeStage)
    result.status = 'fulfilled'
  } catch (error) {
    result.error = String(error?.message ?? error).slice(0, 500)
    observeStage('fail')
  } finally {
    try {
      result.cleanup = await page.evaluate(() => {
        const map = window.__SARTRACKER_MAP__
        const state = window.__C14_OVERLAY_FAILURE__
        if (!map) return { restored: false }
        if (state !== undefined) {
          map.addSource = state.originalAddSource
          delete window.__C14_OVERLAY_FAILURE__
          map.fire('idle')
        }
        return { restored: window.__C14_OVERLAY_FAILURE__ === undefined
          && typeof map.addSource === 'function' && map.addSource.name !== 'addSourceWithSyntheticFailure' }
      })
      if (!result.cleanup.restored) {
        result.status = 'rejected'
        result.error ??= 'Map fault hook cleanup could not be established.'
      }
    } catch (error) {
      result.status = 'rejected'
      result.error ??= String(error?.message ?? error).slice(0, 500)
    }
    page.off('console', onConsole)
    observeStage('cleanup')
    result.completedAtMs = performance.now()
  }
  return result
}
