import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import Database from 'better-sqlite3'

export const SYNTHETIC_MAP_ID = 'official_discovery_topo'
export const SYNTHETIC_TILE_ZOOM = 12
export const SYNTHETIC_TILE_GRID = Object.freeze({
  minX: 1931,
  maxX: 1939,
  minY: 1348,
  maxY: 1356,
})
export const SYNTHETIC_TARGET_TILE = Object.freeze({ z: SYNTHETIC_TILE_ZOOM, x: 1935, y: 1352 })
export const SYNTHETIC_PACKAGE_BOUNDS = Object.freeze(tileGridBounds(SYNTHETIC_TILE_GRID))

/** Returns the production official-map source identity expected in a rendered style. */
export function expectedOfficialMapSource(mapId = SYNTHETIC_MAP_ID) {
  return {
    id: mapId,
    template: `sartracker-official-map://tile/${mapId}/{z}/{x}/{y}.png`,
  }
}

/** Accepts the production official tile template with no query or one numeric revision query. */
export function isCanonicalOfficialRasterTemplate(template, mapId = SYNTHETIC_MAP_ID) {
  if (typeof template !== 'string') return false
  const canonical = expectedOfficialMapSource(mapId).template
  if (template === canonical) return true
  const revisionPrefix = `${canonical}?revision=`
  return template.startsWith(revisionPrefix) && /^\d+$/u.test(template.slice(revisionPrefix.length))
}

/** Gates renderer readiness on the exact official raster source, independent of global map dirtiness. */
export function isOfficialRasterSourceReady(evidence, mapId = SYNTHETIC_MAP_ID) {
  return evidence?.selectedSourceId === mapId
    && evidence.officialSourceLoaded === true
    && evidence.selectedSource?.type === 'raster'
    && Array.isArray(evidence.selectedSource.tiles)
    && evidence.selectedSource.tiles.length === 1
    && isCanonicalOfficialRasterTemplate(evidence.selectedSource.tiles[0], mapId)
}

/** Installs the serializable MapLibre render callback used by the packaged smoke. */
export function installOfficialMapRenderCapture({ key, sourceId, deadlineAt, runtime }) {
  const targetWindow = runtime?.window ?? globalThis.window
  const targetDocument = runtime?.document ?? globalThis.document
  const map = runtime?.map ?? targetWindow.__SARTRACKER_MAP__
  if (Date.now() >= deadlineAt) throw new Error('Map render capture setup deadline was exceeded.')
  const previous = targetWindow[key]
  previous?.cleanup?.()
  const state = {
    frameCount: 0,
    latest: null,
    timer: null,
    cleanup: null,
    cleaned: false,
  }
  const capture = () => {
    const canvas = targetDocument.querySelector('.maplibregl-canvas')
    const context = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl')
    const debug = context?.getExtension('WEBGL_debug_renderer_info')
    const sampledPixels = []
    const hatchPixels = []
    const backgroundPixels = []
    if (canvas !== null && context !== null && context !== undefined) {
      const centerX = Math.floor(canvas.width / 2)
      const centerY = Math.floor(canvas.height / 2)
      for (let offsetX = -128; offsetX <= 128; offsetX += 16) {
        for (let offsetY = -128; offsetY <= 128; offsetY += 16) {
          const pixel = new Uint8Array(4)
          context.readPixels(
            Math.max(0, Math.min(canvas.width - 1, centerX + offsetX)),
            Math.max(0, Math.min(canvas.height - 1, canvas.height - 1 - (centerY + offsetY))),
            1,
            1,
            context.RGBA,
            context.UNSIGNED_BYTE,
            pixel,
          )
          const values = [...pixel]
          sampledPixels.push(values)
          if (colourNear(values, [0xbc, 0xb7, 0xaa, 0xff], 16)) hatchPixels.push(values)
          if (colourNear(values, [0xe9, 0xe7, 0xe0, 0xff], 16)) backgroundPixels.push(values)
        }
      }
    }
    const style = map.getStyle?.()
    const source = style?.sources?.[sourceId]
    const bounds = map.getBounds?.()
    state.frameCount += 1
    state.latest = {
      capturedAtRender: true,
      capturePhase: 'map-render-callback',
      frameCount: state.frameCount,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      mapLoaded: map.loaded?.() ?? false,
      officialSourceLoaded: source === undefined ? false : map.isSourceLoaded?.(sourceId) ?? false,
      selectedSourceId: source === undefined ? null : sourceId,
      renderer: debug === null || context === null || debug === undefined
        ? ''
        : String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL) ?? ''),
      sourceCount: Object.keys(style?.sources ?? {}).length,
      selectedSource: source === undefined ? null : {
        type: source.type,
        tiles: Array.isArray(source.tiles) ? [...source.tiles] : [],
      },
      viewport: bounds === undefined ? null : {
        west: bounds.getWest(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        north: bounds.getNorth(),
        zoom: map.getZoom(),
      },
      sampledPixels,
      hatchPixels,
      backgroundPixels,
    }
  }
  const onRender = () => capture()
  const cleanup = () => {
    map.off('render', onRender)
    if (state.timer !== null) targetWindow.clearTimeout(state.timer)
    state.timer = null
    state.cleaned = true
  }
  state.cleanup = cleanup
  state.timer = targetWindow.setTimeout(cleanup, Math.max(0, deadlineAt - Date.now()))
  targetWindow[key] = state
  map.on('render', onRender)
  map.triggerRepaint?.()

  function colourNear(pixel, expected, tolerance) {
    return pixel.length === 4 && expected.every((value, index) => Math.abs(pixel[index] - value) <= tolerance)
  }

  return state
}

/** Waits for render evidence through the same bounded lifecycle used by the packaged smoke. */
export async function waitForRenderedEvidence({
  startCapture,
  readEvidence,
  predicate,
  stopCapture,
  timeoutMs = 10_000,
  pollMs = 250,
  cleanupTimeoutMs = 1_000,
  label = 'Rendered evidence',
}) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  let result = null
  let bodyError = null
  let cleanupError = null
  const runBounded = async (operation, message, operationDeadline) => {
    const remaining = operationDeadline - Date.now()
    if (remaining <= 0) throw new Error(message)
    let timer
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), remaining)
        }),
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
  try {
    await runBounded(
      () => startCapture(deadline),
      `${label} capture setup timed out.`,
      deadline,
    )
    while (Date.now() < deadline) {
      latest = await runBounded(
        readEvidence,
        `${label} evidence read timed out.`,
        deadline,
      )
      if (Date.now() <= deadline && latest !== null && latest !== undefined && predicate(latest)) {
        result = latest
        break
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)))
    }
    if (result === null) {
      throw new Error(`${label} did not produce the expected rendered evidence: ${JSON.stringify(latest)}`)
    }
  } catch (error) {
    bodyError = error
  }
  if (bodyError === null && result === null) {
    bodyError = new Error(`${label} did not produce the expected rendered evidence: ${JSON.stringify(latest)}`)
  }
  try {
    const cleanupDeadline = Date.now() + cleanupTimeoutMs
    const cleanupResult = await runBounded(
      stopCapture,
      `${label} capture cleanup timed out.`,
      cleanupDeadline,
    )
    if (cleanupResult?.cleaned !== true) {
      throw new Error(`${label} capture cleanup did not confirm listener/timer removal.`)
    }
  } catch (error) {
    cleanupError = error
  }
  if (bodyError !== null && cleanupError !== null) {
    throw new Error(`${bodyError instanceof Error ? bodyError.message : String(bodyError)}; ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
  }
  if (bodyError !== null) throw bodyError
  if (cleanupError !== null) throw cleanupError
  return result
}

/** Registers passive renderer diagnostics and returns a cleanup function for the page listeners. */
export function registerPassiveRendererDiagnostics(page, getPhase, entries, nextSequence = () => entries.length + 1) {
  const onConsole = (message) => {
    entries.push({
      sequence: nextSequence(),
      time: new Date().toISOString(),
      phase: getPhase(),
      source: 'renderer-console',
      type: message.type(),
      message: message.text(),
    })
  }
  const onPageError = (error) => {
    entries.push({
      sequence: nextSequence(),
      time: new Date().toISOString(),
      phase: getPhase(),
      source: 'renderer-pageerror',
      type: 'pageerror',
      message: error instanceof Error ? error.message : String(error),
    })
  }
  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  return () => {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    return { cleaned: true }
  }
}

/** Builds the safe no-provider settings patch used before synthetic package registration. */
export function resetOfficialMapsSettings(current) {
  if (current === null || typeof current !== 'object') {
    throw new Error('Current settings are required before resetting official maps.')
  }
  return {
    ...current,
    officialMaps: {
      ...current.officialMaps,
      sourceType: 'none',
      sourcePath: '',
      status: 'not_configured',
      availableSources: [],
      serviceCount: 0,
      username: '',
      message: 'Official maps are not configured.',
      packages: [],
    },
  }
}

/** Compares the relevant packaged runtime hash set with the frozen source/build hash set. */
export function comparePackagedRuntimeEntries(expected, actual) {
  const expectedNames = Object.keys(expected).sort()
  const actualNames = Object.keys(actual).sort()
  const missing = expectedNames.filter((name) => actual[name] === undefined)
  const extra = actualNames.filter((name) => expected[name] === undefined)
  const mismatched = expectedNames.filter((name) => actual[name] !== undefined && actual[name] !== expected[name])
  if (missing.length > 0 || extra.length > 0 || mismatched.length > 0) {
    throw new Error(JSON.stringify({ missing, extra, mismatched }))
  }
  return { matched: true, fileCount: expectedNames.length }
}

/** Creates a valid synthetic MBTiles package containing only generated opaque raster pixels. */
export function createSyntheticMbtilesPackage(packagePath, options = {}) {
  const missingTile = options.missingTile ?? false
  const tileBytes = options.tileBytes ?? createSyntheticRasterTilePng(options.variant ?? 'a')
  const bounds = options.bounds ?? SYNTHETIC_PACKAGE_BOUNDS
  rmSync(packagePath, { force: true })
  mkdirSync(path.dirname(packagePath), { recursive: true })
  const database = new Database(packagePath)
  try {
    database.exec(`
      CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE tiles (
        zoom_level INTEGER NOT NULL,
        tile_column INTEGER NOT NULL,
        tile_row INTEGER NOT NULL,
        tile_data BLOB NOT NULL
      );
      CREATE UNIQUE INDEX tiles_address ON tiles (zoom_level, tile_column, tile_row);
    `)
    const metadata = database.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)')
    metadata.run('name', 'SAR Tracker synthetic official map qualification package')
    metadata.run('format', 'png')
    metadata.run('bounds', [bounds.west, bounds.south, bounds.east, bounds.north].join(','))
    metadata.run('minzoom', String(SYNTHETIC_TILE_ZOOM))
    metadata.run('maxzoom', String(SYNTHETIC_TILE_ZOOM))
    const insertTile = database.prepare(
      'INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
    )
    for (let x = SYNTHETIC_TILE_GRID.minX; x <= SYNTHETIC_TILE_GRID.maxX; x += 1) {
      for (let y = SYNTHETIC_TILE_GRID.minY; y <= SYNTHETIC_TILE_GRID.maxY; y += 1) {
        if (missingTile && x === SYNTHETIC_TARGET_TILE.x && y === SYNTHETIC_TARGET_TILE.y) continue
        insertTile.run(SYNTHETIC_TILE_ZOOM, x, xyzToTmsY(SYNTHETIC_TILE_ZOOM, y), Buffer.from(tileBytes))
      }
    }
  } finally {
    database.close()
  }
  return {
    packagePath,
    mapId: SYNTHETIC_MAP_ID,
    bounds,
    targetTile: SYNTHETIC_TARGET_TILE,
    tileBytes: Buffer.from(tileBytes),
    tileCount: (SYNTHETIC_TILE_GRID.maxX - SYNTHETIC_TILE_GRID.minX + 1)
      * (SYNTHETIC_TILE_GRID.maxY - SYNTHETIC_TILE_GRID.minY + 1)
      - (missingTile ? 1 : 0),
  }
}

/** Produces a request envelope matching the renderer's native current-view check. */
export function buildSyntheticViewRequest() {
  const tileBounds = xyzTileBounds(
    SYNTHETIC_TARGET_TILE.z,
    SYNTHETIC_TARGET_TILE.x,
    SYNTHETIC_TARGET_TILE.y,
  )
  const epsilon = 1e-7
  return {
    mapId: SYNTHETIC_MAP_ID,
    bounds: {
      west: tileBounds.west + epsilon,
      south: tileBounds.south + epsilon,
      east: tileBounds.east - epsilon,
      north: tileBounds.north - epsilon,
    },
    zoom: SYNTHETIC_TILE_ZOOM,
  }
}

/** Returns the synthetic tile's exact WGS84 footprint. */
export function xyzTileBounds(z, x, y) {
  const dimension = 2 ** z
  const longitude = (column) => (column / dimension) * 360 - 180
  const latitude = (row) =>
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / dimension))) * 180) / Math.PI
  return {
    west: longitude(x),
    south: latitude(y + 1),
    east: longitude(x + 1),
    north: latitude(y),
  }
}

/** Generates two visually distinct opaque PNG variants for same-path replacement checks. */
export function createSyntheticRasterTilePng(variant = 'a') {
  const palette = variant === 'b'
    ? { background: [0x24, 0x4f, 0x45, 0xff], accent: [0xf0, 0xc9, 0x4d, 0xff] }
    : { background: [0x2c, 0x3e, 0x67, 0xff], accent: [0x72, 0xd2, 0xb6, 0xff] }
  const rowBytes = 256 * 4
  const scanlines = Buffer.alloc((rowBytes + 1) * 256)
  for (let y = 0; y < 256; y += 1) {
    const rowOffset = y * (rowBytes + 1)
    for (let x = 0; x < 256; x += 1) {
      const pixel = (x + y) % 32 < 2 ? palette.accent : palette.background
      scanlines[rowOffset + 1 + x * 4] = pixel[0]
      scanlines[rowOffset + 2 + x * 4] = pixel[1]
      scanlines[rowOffset + 3 + x * 4] = pixel[2]
      scanlines[rowOffset + 4 + x * 4] = pixel[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(256, 0)
  ihdr.writeUInt32BE(256, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Converts one XYZ row to the MBTiles TMS row convention. */
function xyzToTmsY(z, y) {
  return 2 ** z - 1 - y
}

/** Computes bounds around the bounded synthetic tile grid. */
function tileGridBounds(grid) {
  const west = xyzTileBounds(SYNTHETIC_TILE_ZOOM, grid.minX, grid.maxY).west
  const south = xyzTileBounds(SYNTHETIC_TILE_ZOOM, grid.minX, grid.maxY).south
  const east = xyzTileBounds(SYNTHETIC_TILE_ZOOM, grid.maxX, grid.minY).east
  const north = xyzTileBounds(SYNTHETIC_TILE_ZOOM, grid.maxX, grid.minY).north
  return { west, south, east, north }
}

/** Encodes one PNG chunk and CRC without using a third-party image codec. */
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const chunk = Buffer.alloc(12 + data.length)
  chunk.writeUInt32BE(data.length, 0)
  typeBytes.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length)
  return chunk
}

/** Calculates a standard PNG CRC for generated synthetic fixtures. */
function crc32(bytes) {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
  }
  return (value ^ 0xffffffff) >>> 0
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
