import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { createPackage, extractFile } from '@electron/asar'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSyntheticViewRequest,
  createSyntheticMbtilesPackage,
  createSyntheticRasterTilePng,
  comparePackagedRuntimeEntries,
  expectedOfficialMapSource,
  installOfficialMapRenderCapture,
  resetOfficialMapsSettings,
  isCanonicalOfficialRasterTemplate,
  isOfficialRasterSourceReady,
  registerPassiveRendererDiagnostics,
  waitForRenderedEvidence,
  SYNTHETIC_TARGET_TILE,
} from '../../build/electron-official-map-qualification-smoke-lib.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('official map qualification smoke fixtures', () => {
  it('creates a real SQLite MBTiles package with a bounded synthetic tile grid', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sartracker-war11-smoke-'))
    roots.push(root)
    const packagePath = path.join(root, 'valid.mbtiles')
    const fixture = createSyntheticMbtilesPackage(packagePath)
    const database = new Database(packagePath, { readonly: true, fileMustExist: true })
    try {
      expect(fixture.tileCount).toBe(81)
      expect(database.prepare('SELECT COUNT(*) AS count FROM tiles').get().count).toBe(81)
      expect(database.prepare('SELECT COUNT(*) AS count FROM metadata').get().count).toBe(5)
      expect(readFileSync(packagePath).byteLength).toBeGreaterThan(0)
    } finally {
      database.close()
    }
  })

  it('can remove exactly the target tile while preserving package metadata and bounds', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sartracker-war11-smoke-'))
    roots.push(root)
    const packagePath = path.join(root, 'missing-target.mbtiles')
    const fixture = createSyntheticMbtilesPackage(packagePath, { missingTile: true })
    const database = new Database(packagePath, { readonly: true, fileMustExist: true })
    try {
      const row = database.prepare(
        'SELECT tile_data AS bytes FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?',
      ).get(SYNTHETIC_TARGET_TILE.z, SYNTHETIC_TARGET_TILE.x, 2 ** SYNTHETIC_TARGET_TILE.z - 1 - SYNTHETIC_TARGET_TILE.y)
      expect(row).toBeUndefined()
      expect(fixture.bounds).toBeDefined()
      expect(fixture.tileBytes).toEqual(createSyntheticRasterTilePng('a'))
    } finally {
      database.close()
    }
  })

  it('builds an exact one-tile current-view request for the native checker', () => {
    const request = buildSyntheticViewRequest()
    expect(request).toMatchObject({ mapId: 'official_discovery_topo', zoom: 12 })
    expect(request.bounds.west).toBeLessThan(request.bounds.east)
    expect(request.bounds.south).toBeLessThan(request.bounds.north)
  })

  it('keeps the packaged smoke bound to the official discovery source template', () => {
    expect(expectedOfficialMapSource()).toEqual({
      id: 'official_discovery_topo',
      template: 'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png',
    })
  })

  it('resets provider settings before synthetic package registration', () => {
    const current = {
      officialMaps: {
        sourceType: 'mapgenie_file',
        sourcePath: '/private/provider.json',
        status: 'configured',
        availableSources: ['official_discovery_topo'],
        serviceCount: 1,
        packages: [{ packagePath: '/private/old.mbtiles' }],
      },
      dataSource: { providerType: 'none' },
    }
    expect(resetOfficialMapsSettings(current)).toMatchObject({
      officialMaps: {
        sourceType: 'none',
        sourcePath: '',
        status: 'not_configured',
        availableSources: [],
        serviceCount: 0,
        packages: [],
      },
    })
  })

  it('rejects stale ASAR runtime bytes while accepting an exact synthetic match', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sartracker-war11-asar-'))
    const archivePath = `${root}.asar`
    roots.push(root, archivePath)
    const files = {
      'electron/official-map-proxy.cjs': 'source-v1',
      'shared/gpx-source-scalars.mjs': 'shared-v1',
      'dist/index.html': 'index-v1',
      'dist/assets/index.js': 'bundle-v1',
      'dist/assets/map.css': 'css-v1',
      'dist/manual/index.html': 'manual-v1',
      'dist/sw.js': 'service-worker-v1',
    }
    for (const [relativePath, contents] of Object.entries(files)) {
      const filePath = path.join(root, relativePath)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, contents)
    }
    await createPackage(root, archivePath)
    const expected = Object.fromEntries(Object.entries(files).map(([relativePath, contents]) => [relativePath, hash(contents)]))
    const actual = Object.fromEntries(Object.keys(files).map((relativePath) => [relativePath, hash(extractFile(archivePath, relativePath))]))
    expect(comparePackagedRuntimeEntries(expected, expected)).toEqual({
      matched: true,
      fileCount: 7,
    })

    expect(comparePackagedRuntimeEntries(expected, actual)).toEqual({ matched: true, fileCount: 7 })
    expect(() => comparePackagedRuntimeEntries({
      ...expected,
      'dist/assets/map.css': hash('css-v2'),
    }, actual)).toThrow(/dist\/assets\/map\.css/u)
    expect(() => comparePackagedRuntimeEntries(expected, {
      ...actual,
      'dist/images/unexpected.png': hash('extra'),
    })).toThrow(/extra/u)
    expect(() => comparePackagedRuntimeEntries({
      ...expected,
      'dist/manual/missing.html': hash('missing'),
    }, actual)).toThrow(/missing/u)
  })

  it('accepts only the canonical official raster template and numeric revision query', () => {
    expect(isCanonicalOfficialRasterTemplate(
      'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png',
    )).toBe(true)
    expect(isCanonicalOfficialRasterTemplate(
      'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=123',
    )).toBe(true)
    for (const value of [
      'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=abc',
      'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=1&revision=2',
      'sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=1&extra=2',
      'sartracker-official-map://tile/wrong/{z}/{x}/{y}.png',
      'https://example.test/{z}/{x}/{y}.png',
    ]) expect(isCanonicalOfficialRasterTemplate(value)).toBe(false)
  })

  it('gates source readiness on the exact loaded raster source despite a globally dirty map', () => {
    expect(isOfficialRasterSourceReady({
      mapLoaded: false,
      selectedSourceId: 'official_discovery_topo',
      selectedSource: {
        type: 'raster',
        tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=123'],
      },
      officialSourceLoaded: true,
    })).toBe(true)
  })

  it('captures only from the actual render listener and skips isSourceLoaded when the source is absent', () => {
    const fake = createRenderCaptureFake()
    const state = installOfficialMapRenderCapture({
      key: 'capture',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 1_000,
      runtime: fake,
    })
    expect(fake.readPixels).toBe(0)
    fake.map.emit('render')
    expect(fake.readPixels).toBeGreaterThan(0)
    expect(state.latest).toMatchObject({
      capturedAtRender: true,
      selectedSourceId: null,
      officialSourceLoaded: false,
    })
    state.cleanup?.()
    expect(fake.renderListeners).toBe(0)
    expect(fake.clearTimeoutCalls).toBe(1)
    const readsAfterCleanup = fake.readPixels
    fake.map.emit('render')
    expect(fake.readPixels).toBe(readsAfterCleanup)
  })

  it('does not allocate a queued renderer capture after its absolute setup deadline', () => {
    const fake = createRenderCaptureFake()
    expect(() => installOfficialMapRenderCapture({
      key: 'capture',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() - 1,
      runtime: fake,
    })).toThrow(/setup deadline/u)
    expect(fake.renderListeners).toBe(0)
    expect(fake.setTimeoutCalls).toBe(0)
    expect(Reflect.get(fake.window, 'capture')).toBeUndefined()
  })

  it('bounds capture setup and still requires confirmed cleanup', async () => {
    let stopped = false
    await expect(waitForRenderedEvidence({
      startCapture: async () => new Promise((resolve) => setTimeout(resolve, 50)),
      readEvidence: async () => null,
      predicate: () => true,
      stopCapture: async () => {
        stopped = true
        return { cleaned: true }
      },
      timeoutMs: 10,
      label: 'setup stall',
    })).rejects.toThrow(/capture setup timed out/u)
    expect(stopped).toBe(true)
  })

  it('times out an absent frame and removes the render callback and timer', async () => {
    let stopped = false
    await expect(waitForRenderedEvidence({
      startCapture: async () => undefined,
      readEvidence: async () => null,
      predicate: () => true,
      stopCapture: async () => {
        stopped = true
        return { cleaned: true }
      },
      timeoutMs: 20,
      pollMs: 1,
      label: 'absent frame',
    })).rejects.toThrow(/did not produce the expected rendered evidence/u)
    expect(stopped).toBe(true)
  })

  it('accepts a render-callback frame with a dirty global map and cleans up after success', async () => {
    let frame = null
    let renderCallback: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let timerCleared = false
    const evidence = {
      capturedAtRender: true,
      mapLoaded: false,
      selectedSourceId: 'official_discovery_topo',
      selectedSource: {
        type: 'raster',
        tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png?revision=123'],
      },
      officialSourceLoaded: true,
    }
    const result = await waitForRenderedEvidence({
      startCapture: async () => {
        renderCallback = () => { frame = evidence }
        timer = setTimeout(() => renderCallback?.(), 5)
      },
      readEvidence: async () => frame,
      predicate: (value) => value.capturedAtRender === true && isOfficialRasterSourceReady(value),
      stopCapture: async () => {
        renderCallback = null
        if (timer !== undefined) clearTimeout(timer)
        timerCleared = true
        return { cleaned: true }
      },
      timeoutMs: 100,
      pollMs: 1,
      label: 'render callback',
    })
    expect(result).toBe(evidence)
    expect(renderCallback).toBeNull()
    expect(timerCleared).toBe(true)
  })

  it('bounds a late evidence read and still reports cleanup failure visibly', async () => {
    let stopped = false
    await expect(waitForRenderedEvidence({
      startCapture: async () => undefined,
      readEvidence: async () => new Promise((resolve) => setTimeout(() => resolve(null), 50)),
      predicate: () => false,
      stopCapture: async () => {
        stopped = true
        return { cleaned: false }
      },
      timeoutMs: 10,
      label: 'late read',
    })).rejects.toThrow(/capture cleanup did not confirm/u)
    expect(stopped).toBe(true)
  })

  it('captures passive renderer diagnostics and removes both listeners', () => {
    const page = createDiagnosticPageFake()
    const entries: Array<Record<string, unknown>> = []
    const cleanup = registerPassiveRendererDiagnostics(page, () => 'test-phase', entries, () => entries.length + 1)
    page.emit('console', {type: () => 'warning', text: () => 'synthetic warning'})
    page.emit('pageerror', new Error('synthetic page error'))
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({source: 'renderer-console', type: 'warning', message: 'synthetic warning'})
    expect(entries[1]).toMatchObject({source: 'renderer-pageerror', type: 'pageerror', message: 'synthetic page error'})
    expect(cleanup()).toEqual({ cleaned: true })
    page.emit('console', {type: () => 'error', text: () => 'after cleanup'})
    expect(entries).toHaveLength(2)
  })
})

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function createDiagnosticPageFake() {
  const listeners = new Map<string, Set<(value: unknown) => void>>()
  return {
    on(event: string, listener: (value: unknown) => void) {
      const eventListeners = listeners.get(event) ?? new Set<(value: unknown) => void>()
      eventListeners.add(listener)
      listeners.set(event, eventListeners)
    },
    off(event: string, listener: (value: unknown) => void) {
      listeners.get(event)?.delete(listener)
    },
    emit(event: string, value: unknown) {
      listeners.get(event)?.forEach((listener) => listener(value))
    },
  }
}

function createRenderCaptureFake() {
  const renderListeners = new Set<() => void>()
  let readPixels = 0
  let clearTimeoutCalls = 0
  let setTimeoutCalls = 0
  const context = {
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    getExtension: () => null,
    readPixels: () => { readPixels += 1 },
  }
  const map = {
    on(event: string, listener: () => void) { if (event === 'render') renderListeners.add(listener) },
    off(event: string, listener: () => void) { if (event === 'render') renderListeners.delete(listener) },
    emit(event: string) { if (event === 'render') renderListeners.forEach((listener) => listener()) },
    triggerRepaint() {},
    getStyle: () => ({sources: {}}),
    getBounds: () => ({getWest: () => 0, getSouth: () => 0, getEast: () => 1, getNorth: () => 1}),
    getZoom: () => 1,
    loaded: () => false,
    isSourceLoaded: () => { throw new Error('isSourceLoaded must not be called for an absent source') },
  }
  const canvas = {
    width: 256,
    height: 256,
    getContext: () => context,
  }
  const document = { querySelector: () => canvas }
  const window = {
    setTimeout(callback: () => void, delay: number) {
      setTimeoutCalls += 1
      return globalThis.setTimeout(callback, delay)
    },
    clearTimeout(timer: ReturnType<typeof setTimeout>) {
      clearTimeoutCalls += 1
      globalThis.clearTimeout(timer)
    },
  }
  return {
    map,
    document,
    window,
    get readPixels() { return readPixels },
    get clearTimeoutCalls() { return clearTimeoutCalls },
    get setTimeoutCalls() { return setTimeoutCalls },
    get renderListeners() { return renderListeners.size },
  }
}
