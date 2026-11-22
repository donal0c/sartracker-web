/**
 * Whole-trail check [DON-338, SAR-FIELD-002].
 *
 * The team reported (August, and again on the November Dublin test) that a
 * trail split at 10,000 points and could only be shown in parts. Whatever
 * display the operator chooses, every stored fix must lie on something the map
 * has actually drawn for that device at the same time: a trail line, a dot or,
 * for the whole-history layer, the purple line.
 *
 * What is drawn is read with MapLibre's queryRenderedFeatures after fitting
 * the map to the whole route, so a layer that is hidden, filtered out or never
 * loaded counts as not drawn. Stored fixes come from SQLite.
 */

import { NotTested, ProductFailure } from './results.mjs'

/**
 * Every UI hook the check depends on, in one place. The DON-338 fix (piece 1)
 * may reword the dots status or rename a control; change it here only.
 */
export const WHOLE_TRAIL_UI = Object.freeze({
  /** Side panel that holds the coverage panel and the dots status (DON-341). */
  trackingPanel: 'tracking',
  /** The team's path into dots: "Inspect exact fixes" on the coverage panel. */
  showDots: 'coverage-inspect-exact-fixes',
  /** The dots status line ("showing N of M" today; "dots show N of M exact fixes" after the fix). */
  dotsSummary: 'exact-breadcrumb-dot-page-summary',
  /** Shown instead of the summary when the dots query fails. */
  dotsUnavailable: 'exact-breadcrumb-dots-unavailable',
  /** Earlier page button. If the fix removes paging this may be absent; the check then says so. */
  earlier: 'exact-breadcrumb-dots-earlier',
  /** Coverage panel and its "All mission history shown" state. */
  coveragePanel: 'coverage-status-panel',
  coverageComplete: 'coverage-complete',
  /** Style layers that draw the operator's trail (line and dots); device markers are excluded by featureKind. */
  trailLayerPattern: '^tracking-',
  /** Style layers that draw the purple whole-history line. */
  coverageLayerPattern: '^coverage-.*-(line|point)$',
})

/** Matches "10,000 of 25,000" in the dots status, whatever words surround it. */
const DOTS_COUNT_PATTERN = /(\d[\d,]*)\s+of\s+(\d[\d,]*)/u
const DEFAULT_TOLERANCE_METRES = 60
const METRES_PER_DEGREE_LAT = 110_574
const METRES_PER_DEGREE_LON_EQUATOR = 111_320

/**
 * Parses the dots status text into the shown and total counts.
 *
 * @param {string} text
 * @returns {{shown: number, total: number} | null}
 */
export function parseDotSummary(text) {
  const match = DOTS_COUNT_PATTERN.exec(String(text ?? ''))
  if (match === null) return null
  const shown = Number(match[1].replace(/,/gu, ''))
  const total = Number(match[2].replace(/,/gu, ''))
  return Number.isSafeInteger(shown) && Number.isSafeInteger(total) ? { shown, total } : null
}

/**
 * Fits the map to the given bounds without animation. Self-contained: runs in the page.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {any} [win]
 * @returns {boolean} false when there is no map to fit
 */
export function fitMapToBounds(bounds, win = globalThis) {
  const map = win.__SARTRACKER_MAP__
  if (map === undefined || map === null) return false
  map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], { animate: false, padding: 40 })
  return true
}

/**
 * Reads what the map has drawn for each device, split into the operator's
 * trail layers and the whole-history layers. Self-contained: runs in the page.
 * Returns null when the map cannot be read.
 *
 * @param {{trailLayerPattern: string, coverageLayerPattern: string}} options
 * @param {any} [win]
 * @returns {{settled: boolean, metresPerPixel: number, trailLayers: string[], coverageLayers: string[],
 *   trail: Record<string, {lines: number[][][], points: number[][]}>,
 *   coverage: Record<string, {lines: number[][][], points: number[][]}>} | null}
 */
export function readRenderedTrails(options, win = globalThis) {
  try {
    const map = win.__SARTRACKER_MAP__
    if (map === undefined || map === null) return null
    const trailPattern = new RegExp(options.trailLayerPattern, 'u')
    const coveragePattern = new RegExp(options.coverageLayerPattern, 'u')
    const drawnLayers = (pattern) => (map.getStyle()?.layers ?? [])
      .filter((layer) => pattern.test(layer.id) && (layer.type === 'line' || layer.type === 'circle'))
      .filter((layer) => map.getLayoutProperty(layer.id, 'visibility') !== 'none')
      .map((layer) => layer.id)
    const collect = (layerIds) => {
      const byDevice = {}
      if (layerIds.length === 0) return byDevice
      for (const feature of map.queryRenderedFeatures({ layers: layerIds })) {
        const props = feature.properties ?? {}
        if (props.featureKind === 'device') continue
        const deviceId = props.deviceId ?? props.device_id
        if (deviceId === undefined || deviceId === null) continue
        const entry = (byDevice[String(deviceId)] ??= { lines: [], points: [] })
        const geometry = feature.geometry
        if (geometry.type === 'LineString') entry.lines.push(geometry.coordinates)
        else if (geometry.type === 'MultiLineString') entry.lines.push(...geometry.coordinates)
        else if (geometry.type === 'Point') entry.points.push(geometry.coordinates)
        else if (geometry.type === 'MultiPoint') entry.points.push(...geometry.coordinates)
      }
      return byDevice
    }
    const trailLayers = drawnLayers(trailPattern)
    const coverageLayers = drawnLayers(coveragePattern)
    const latitude = map.getCenter().lat
    return {
      settled: map.loaded() === true,
      metresPerPixel: (40_075_016.686 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** map.getZoom()),
      trailLayers,
      coverageLayers,
      trail: collect(trailLayers),
      coverage: collect(coverageLayers),
    }
  } catch {
    return null
  }
}

/**
 * Bounds of every stored fix, for fitting the map to the whole route.
 *
 * @param {{lat: number, lon: number}[]} fixes
 */
export function routeBounds(fixes) {
  if (fixes.length === 0) throw new NotTested('The seeded mission has no stored fixes; the whole-trail check proves nothing.')
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const fix of fixes) {
    west = Math.min(west, fix.lon)
    east = Math.max(east, fix.lon)
    south = Math.min(south, fix.lat)
    north = Math.max(north, fix.lat)
  }
  return { west, south, east, north }
}

/**
 * Finds stored fixes that nothing drawn for their device passes near, grouped
 * into continuous stretches an operator would recognise.
 *
 * @param {Record<string, {lines: number[][][], points: number[][]}>} drawn by device id
 * @param {{deviceId: string, lat: number, lon: number, time: number}[]} stored every stored fix
 * @param {{names?: Record<string, string>, toleranceMetres?: number, layer: string}} options
 * @returns {{deviceId: string, missing: number, total: number, finding: string}[]}
 */
export function trailGapFindings(drawn, stored, { names = {}, toleranceMetres = DEFAULT_TOLERANCE_METRES, layer }) {
  const byDevice = new Map()
  for (const fix of stored) {
    if (!byDevice.has(fix.deviceId)) byDevice.set(fix.deviceId, [])
    byDevice.get(fix.deviceId).push(fix)
  }
  const results = []
  const clock = (ms) => new Date(ms).toISOString().slice(11, 19)
  for (const [deviceId, fixes] of byDevice) {
    fixes.sort((a, b) => a.time - b.time)
    const label = names[deviceId] ?? `device ${deviceId}`
    const index = createGeometryIndex(drawn[deviceId] ?? { lines: [], points: [] }, fixes[0].lat, toleranceMetres)
    const stretches = []
    let current = null
    let missing = 0
    for (const fix of fixes) {
      if (index.near(fix)) {
        current = null
        continue
      }
      missing += 1
      if (current === null) {
        current = { from: fix.time, to: fix.time, count: 0 }
        stretches.push(current)
      }
      current.to = fix.time
      current.count += 1
    }
    if (missing === 0) continue
    const shown = stretches.slice(0, 3)
      .map((stretch) => `${stretch.count.toLocaleString('en-GB')} from ${clock(stretch.from)} to ${clock(stretch.to)} UTC`)
      .join('; ')
    const more = stretches.length > 3 ? `; and ${stretches.length - 3} more stretches` : ''
    results.push({
      deviceId,
      missing,
      total: fixes.length,
      finding: `${label}: ${missing.toLocaleString('en-GB')} of ${fixes.length.toLocaleString('en-GB')} stored fixes are not on the ${layer} (${shown}${more})`,
    })
  }
  return results
}

/**
 * A coarse grid over drawn geometry in local metres, so each fix is checked
 * against nearby segments only.
 */
function createGeometryIndex(geometry, originLat, toleranceMetres) {
  const lonScale = METRES_PER_DEGREE_LON_EQUATOR * Math.cos((originLat * Math.PI) / 180)
  const project = ([lon, lat]) => [lon * lonScale, lat * METRES_PER_DEGREE_LAT]
  const cell = Math.max(toleranceMetres, 1)
  const grid = new Map()
  const add = (key, shape) => {
    if (!grid.has(key)) grid.set(key, [])
    grid.get(key).push(shape)
  }
  const keyOf = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`
  for (const point of geometry.points) {
    const [x, y] = project(point)
    add(keyOf(x, y), [x, y, x, y])
  }
  for (const line of geometry.lines) {
    for (let i = 0; i < line.length; i += 1) {
      const [x1, y1] = project(line[i])
      const [x2, y2] = i + 1 < line.length ? project(line[i + 1]) : [x1, y1]
      const minX = Math.floor(Math.min(x1, x2) / cell)
      const maxX = Math.floor(Math.max(x1, x2) / cell)
      const minY = Math.floor(Math.min(y1, y2) / cell)
      const maxY = Math.floor(Math.max(y1, y2) / cell)
      for (let gx = minX; gx <= maxX; gx += 1) {
        for (let gy = minY; gy <= maxY; gy += 1) add(`${gx}:${gy}`, [x1, y1, x2, y2])
      }
    }
  }
  return {
    near(fix) {
      const [x, y] = project([fix.lon, fix.lat])
      const gx = Math.floor(x / cell)
      const gy = Math.floor(y / cell)
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (const shape of grid.get(`${gx + dx}:${gy + dy}`) ?? []) {
            if (segmentDistance(x, y, shape) <= toleranceMetres) return true
          }
        }
      }
      return false
    },
  }
}

/** Distance in metres from (x, y) to the segment [x1, y1, x2, y2]. */
function segmentDistance(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared))
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
}

/**
 * Fits the map to the route, waits for it to settle, reads what is drawn and
 * fails the check if any stored fix is off the drawn trail. Every wait is
 * bounded: a page that never answers is missing evidence (NotTested), never a hang.
 *
 * @param {{evaluate: (fn: Function, arg?: any) => Promise<any>}} page
 * @param {{deviceId: string, lat: number, lon: number, time: number}[]} stored
 * @param {{step: string, names?: Record<string, string>, layers?: 'all' | 'trail' | 'coverage',
 *   settleTimeoutMs?: number, readTimeoutMs?: number, intervalMs?: number, ui?: typeof WHOLE_TRAIL_UI,
 *   nothingDrawnIsNotTested?: boolean}} options
 * @returns {Promise<{devices: number, fixes: number, layers: string[]}>}
 */
export async function verifyWholeTrailDrawn(page, stored, {
  step, names = {}, layers = 'all', settleTimeoutMs = 60_000, readTimeoutMs = 10_000, intervalMs = 1_000, ui = WHOLE_TRAIL_UI,
  nothingDrawnIsNotTested = false,
}) {
  const fitted = await boundedEvaluate(page, fitMapToBounds, routeBounds(stored), readTimeoutMs, step)
  if (fitted !== true) throw new NotTested(`${step}: the map could not be read (no map handle); the whole-trail check proves nothing.`)
  const startedAt = Date.now()
  let drawn = null
  for (;;) {
    drawn = await boundedEvaluate(page, readRenderedTrails,
      { trailLayerPattern: ui.trailLayerPattern, coverageLayerPattern: ui.coverageLayerPattern }, readTimeoutMs, step)
    if (drawn !== null && drawn.settled) break
    if (Date.now() - startedAt >= settleTimeoutMs) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  if (drawn === null) throw new NotTested(`${step}: the map's drawn features could not be read; the whole-trail check proves nothing.`)
  // 'all': the live trail keeps only each device's newest fixes (5,000 by
  // design), so the whole route is the live trail and the whole-history line together.
  const features = layers === 'coverage' ? drawn.coverage : layers === 'trail' ? drawn.trail : mergeDrawn(drawn.trail, drawn.coverage)
  const layerIds = layers === 'coverage' ? drawn.coverageLayers
    : layers === 'trail' ? drawn.trailLayers : [...drawn.trailLayers, ...drawn.coverageLayers]
  const layerName = layers === 'coverage' ? 'whole-history (purple) line' : layers === 'trail' ? 'live trail' : 'drawn trail'
  if (nothingDrawnIsNotTested && Object.keys(features).length === 0) {
    // The control step: nothing at all on the map means the seed or launch is
    // wrong, so the later dots result would mean nothing.
    throw new NotTested(`${step}: no ${layerName} was drawn for the seeded mission at all, so the whole-trail check proves nothing.`)
  }
  // Tile simplification at the fitted zoom moves a drawn line by up to a few pixels.
  const toleranceMetres = Math.max(DEFAULT_TOLERANCE_METRES, 4 * drawn.metresPerPixel)
  const findings = trailGapFindings(features, stored, { names, toleranceMetres, layer: layerName })
  if (findings.length > 0) {
    const settledNote = drawn.settled ? '' : ` (the map had not settled after ${Math.round(settleTimeoutMs / 1000)} s)`
    throw new ProductFailure(`${step}: ${findings.map((entry) => entry.finding).join('; ')}${settledNote} [DON-338]`)
  }
  return { devices: new Set(stored.map((fix) => fix.deviceId)).size, fixes: stored.length, layers: layerIds }
}

/**
 * Combines two per-device drawings into one.
 *
 * @param {Record<string, {lines: number[][][], points: number[][]}>} a
 * @param {Record<string, {lines: number[][][], points: number[][]}>} b
 */
export function mergeDrawn(a, b) {
  const merged = {}
  for (const source of [a, b]) {
    for (const [deviceId, shapes] of Object.entries(source ?? {})) {
      const entry = merged[deviceId] ?? (merged[deviceId] = { lines: [], points: [] })
      entry.lines.push(...shapes.lines)
      entry.points.push(...shapes.points)
    }
  }
  return merged
}

/**
 * Runs a self-contained function in the page, giving up after `timeoutMs`
 * without leaving a pending rejection behind.
 */
function boundedEvaluate(page, fn, arg, timeoutMs, step) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NotTested(`${step}: the page did not answer within ${timeoutMs / 1000} s.`)), timeoutMs)
    page.evaluate(fn, arg).then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(new NotTested(`${step}: reading the map failed: ${error?.message ?? error}`)) },
    )
  })
}
