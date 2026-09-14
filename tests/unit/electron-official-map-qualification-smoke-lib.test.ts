import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { Evented } from 'maplibre-gl'
import { createPackage, extractFile } from '@electron/asar'
import { applyMapStylePreservingCamera } from '../../src/features/map/apply-map-style-preserving-camera'
import { afterEach, describe, expect, it } from 'vitest'

import {
  buildSyntheticViewRequest,
  createSyntheticMbtilesPackage,
  createSyntheticRasterTilePng,
  comparePackagedRuntimeEntries,
  expectedOfficialMapSource,
  installOfficialMapRenderCapture,
  installOfficialMapStyleSettlementCapture,
  isSyntheticTargetCamera,
  resetOfficialMapsSettings,
  isCanonicalOfficialRasterTemplate,
  isOfficialRasterSourceReady,
  registerPassiveRendererDiagnostics,
  runBoundedOfficialMapSelection,
  waitForRenderedEvidence,
  SYNTHETIC_TARGET_TILE,
} from '../../build/electron-official-map-qualification-smoke-lib.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('official map qualification smoke fixtures', () => {
  it.each(['restoration-before-target', 'target-before-restoration'] as const)(
    'waits for style restoration before accepting the target camera (%s)', async ordering => {
      const evented = new Evented()
      let camera = {
        center: [-9.7, 51.97] as [number, number],
        zoom: 12,
        bearing: 0,
        pitch: 0,
      }
      let style = {sources: {}}
      const sourceStyle = {
        sources: {
          official_discovery_topo: {
            type: 'raster',
            tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
          },
        },
      }
      const map = Object.assign(evented, {
        getCenter: () => ({lng: camera.center[0], lat: camera.center[1]}),
        getZoom: () => camera.zoom,
        getBearing: () => camera.bearing,
        getPitch: () => camera.pitch,
        getStyle: () => style,
        setStyle: () => { style = sourceStyle },
        jumpTo: (next: typeof camera) => { camera = next },
      })
      const runtime = {window: globalThis, map}
      const state = installOfficialMapStyleSettlementCapture({
        key: '__SARTRACKER_STYLE_SETTLEMENT_TEST__',
        sourceId: 'official_discovery_topo',
        deadlineAt: Date.now() + 1_000,
        runtime,
      })
      const defaultCamera = {...camera}
      const targetCamera = {center: [-9.74406, 51.99917] as [number, number], zoom: 11, bearing: 0, pitch: 0}
      applyMapStylePreservingCamera(map, sourceStyle)
      if (ordering === 'target-before-restoration') map.jumpTo(targetCamera)
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (ordering === 'restoration-before-target') {
        map.fire('style.load')
        await Promise.resolve()
      } else {
        await Promise.resolve()
        expect(state.latest).toBeNull()
        map.fire('styledata')
        await Promise.resolve()
        expect(state.latest).toBeNull()
        map.fire('style.load')
        await Promise.resolve()
      }
      expect(state.latest?.camera).toEqual({center: defaultCamera.center, zoom: defaultCamera.zoom, bearing: 0, pitch: 0})
      // The corrected smoke path always moves to the target after settlement,
      // regardless of which side of the production callback the first jump hit.
      map.jumpTo(targetCamera)
      expect(camera).toEqual(targetCamera)
      state.cleanup?.()
      expect(state.cleaned).toBe(true)
    },
  )

  it('does not accept an already-present source until style.load has crossed the observer', async () => {
    const evented = new Evented()
    const camera = {center: [-9.7, 51.97] as [number, number], zoom: 12}
    const style = {
      sources: {
        official_discovery_topo: {
          type: 'raster',
          tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
        },
      },
    }
    const map = Object.assign(evented, {
      getCenter: () => ({lng: camera.center[0], lat: camera.center[1]}),
      getZoom: () => camera.zoom,
      getBearing: () => 0,
      getPitch: () => 0,
      getStyle: () => style,
      setStyle: () => undefined,
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_ALREADY_PRESENT__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 1_000,
      runtime: {window: globalThis, map},
    })
    await Promise.resolve()
    expect(state.latest).toBeNull()
    map.setStyle(style)
    await Promise.resolve()
    expect(state.latest).toBeNull()
    map.fire('styledata')
    await Promise.resolve()
    expect(state.latest).toBeNull()
    map.fire('style.load')
    await Promise.resolve()
    expect(state.latest?.styleLoadCount).toBe(1)
    expect(state.cleaned).toBe(true)
  })

  it('observes a synchronous setStyle style.load event after helper registration', async () => {
    const evented = new Evented()
    let camera = {center: [-9.7, 51.97] as [number, number], zoom: 12}
    let style = {sources: {}}
    const sourceStyle = {
      sources: {
        official_discovery_topo: {
          type: 'raster',
          tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
        },
      },
    }
    const map = Object.assign(evented, {
      getCenter: () => ({lng: camera.center[0], lat: camera.center[1]}),
      getZoom: () => camera.zoom,
      getBearing: () => 0,
      getPitch: () => 0,
      getStyle: () => style,
      setStyle: () => {
        style = sourceStyle
        // Exercises the production helper's listener-before-setStyle order.
        map.fire('style.load')
      },
      jumpTo: (next: typeof camera) => { camera = next },
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_SYNC_SET_STYLE__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 1_000,
      runtime: {window: globalThis, map},
    })
    const targetCamera = {center: [-9.8876953125, 52.02545042919566] as [number, number], zoom: 11}
    try {
      applyMapStylePreservingCamera(map, sourceStyle)
      map.jumpTo(targetCamera)
      await Promise.resolve()
      expect(state.latest?.styleLoadCount).toBe(1)
      expect(state.latest?.camera).toEqual({center: targetCamera.center, zoom: 11, bearing: 0, pitch: 0})
    } finally {
      state.cleanup?.()
    }
  })

  it('does not accept synchronous setStyle styledata before style.load', async () => {
    const evented = new Evented()
    let style = {sources: {}}
    const sourceStyle = {
      sources: {
        official_discovery_topo: {
          type: 'raster',
          tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
        },
      },
    }
    const map = Object.assign(evented, {
      getCenter: () => ({lng: -9.7, lat: 51.97}),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      getStyle: () => style,
      setStyle: () => {
        style = sourceStyle
        map.fire('styledata')
      },
      jumpTo: () => undefined,
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_CROSS_TASK__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 1_000,
      runtime: {window: globalThis, map},
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      applyMapStylePreservingCamera(map, sourceStyle)
      await Promise.resolve()
      expect(state.latest).toBeNull()
    } finally {
      state.cleanup?.()
    }
  })

  it('restores the owned setStyle wrapper and rejects later events after a thrown switch', async () => {
    const evented = new Evented()
    const style = {
      sources: {
        official_discovery_topo: {
          type: 'raster',
          tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
        },
      },
    }
    const originalSetStyle = () => { throw new Error('synthetic setStyle failure') }
    const map = Object.assign(evented, {
      getCenter: () => ({lng: -9.7, lat: 51.97}),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      getStyle: () => style,
      setStyle: originalSetStyle,
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_THROWN_SET_STYLE__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 1_000,
      runtime: {window: globalThis, map},
    })
    expect(() => map.setStyle(style)).toThrow(/synthetic setStyle failure/u)
    expect(state.setStyleReturned).toBe(false)
    expect(map.setStyle).toBe(originalSetStyle)
    map.fire('styledata')
    await Promise.resolve()
    expect(state.latest).toBeNull()
    state.cleanup?.()
    expect(state.cleaned).toBe(true)
  })

  it('rejects non-finite or unexpected synthetic target cameras', () => {
    expect(isSyntheticTargetCamera({center: [Number.NaN, 51.99917], zoom: 11})).toBe(false)
    expect(isSyntheticTargetCamera({center: [-9.74406, 51.99917], zoom: Number.POSITIVE_INFINITY})).toBe(false)
    expect(isSyntheticTargetCamera({center: [-9.74406, 51.99917], zoom: 12})).toBe(false)
    expect(isSyntheticTargetCamera({center: [-9.8876953125, 52.02545042919566], zoom: 11})).toBe(true)
  })

  it('times out style settlement and removes its listener and timer', async () => {
    const evented = new Evented()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const window = {
      setTimeout(callback: () => void, delay: number) {
        const timer = setTimeout(() => {
          timers.delete(timer)
          callback()
        }, delay)
        timers.add(timer)
        return timer
      },
      clearTimeout(timer: ReturnType<typeof setTimeout>) {
        timers.delete(timer)
        clearTimeout(timer)
      },
    }
    const map = Object.assign(evented, {
      getStyle: () => ({sources: {}}),
      setStyle: () => undefined,
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_TIMEOUT__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 5,
      runtime: {window, map},
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(state.cleaned).toBe(true)
    expect(timers.size).toBe(0)
    expect(state.styleLoadCount).toBe(0)
  })

  it('does not admit a frame after the absolute style deadline when timer cleanup is delayed', async () => {
    const evented = new Evented()
    let style = {sources: {}}
    const sourceStyle = {
      sources: {
        official_discovery_topo: {
          type: 'raster',
          tiles: ['sartracker-official-map://tile/official_discovery_topo/{z}/{x}/{y}.png'],
        },
      },
    }
    const pendingTimers = new Set<number>()
    const window = {
      setTimeout: (callback: () => void) => {
        const token = pendingTimers.size + 1
        pendingTimers.add(token)
        void callback
        return token
      },
      clearTimeout: (token: number) => { pendingTimers.delete(token) },
    }
    const map = Object.assign(evented, {
      getCenter: () => ({lng: -9.7, lat: 51.97}),
      getZoom: () => 12,
      getBearing: () => 0,
      getPitch: () => 0,
      getStyle: () => style,
      setStyle: () => { style = sourceStyle; map.fire('styledata') },
    })
    const state = installOfficialMapStyleSettlementCapture({
      key: '__SARTRACKER_STYLE_SETTLEMENT_LATE_CAPTURE__',
      sourceId: 'official_discovery_topo',
      deadlineAt: Date.now() + 5,
      runtime: {window, map},
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    map.setStyle(sourceStyle)
    await Promise.resolve()
    expect(state.latest).toBeNull()
    state.cleanup?.()
    expect(pendingTimers.size).toBe(0)
  })

  it('bounds every operator-selection phase and cleans an installed observer on click failure', async () => {
    const phases: string[] = []
    const timeouts: number[] = []
    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() + 500,
      openMenu: async (timeout: number) => { phases.push('menu'); timeouts.push(timeout) },
      waitForMapButton: async (timeout: number) => { phases.push('button'); timeouts.push(timeout) },
      installObserver: async (timeout: number) => { phases.push('install'); timeouts.push(timeout) },
      clickMap: async (timeout: number) => {
        phases.push('click')
        timeouts.push(timeout)
        throw new Error('synthetic click failure')
      },
      waitForSettlement: async () => { phases.push('settlement'); return null },
      cleanupObserver: async () => { phases.push('cleanup'); return {cleaned: true} },
    })).rejects.toThrow(/synthetic click failure/u)
    expect(phases).toEqual(['menu', 'button', 'install', 'click', 'cleanup'])
    expect(timeouts.every((timeout) => timeout > 0 && timeout <= 500)).toBe(true)
    expect(timeouts[0]).toBeGreaterThanOrEqual(timeouts[1])
    expect(timeouts[1]).toBeGreaterThanOrEqual(timeouts[2])
    expect(timeouts[2]).toBeGreaterThanOrEqual(timeouts[3])
  })

  it('cleans after install or settlement rejection and keeps cleanup failure visible', async () => {
    const installPhases: string[] = []
    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() + 500,
      openMenu: async () => { installPhases.push('menu') },
      waitForMapButton: async () => { installPhases.push('button') },
      installObserver: async () => {
        installPhases.push('install')
        throw new Error('synthetic install failure')
      },
      clickMap: async () => { installPhases.push('click') },
      waitForSettlement: async () => { installPhases.push('settlement'); return null },
      cleanupObserver: async () => { installPhases.push('cleanup'); return {cleaned: true} },
    })).rejects.toThrow(/synthetic install failure/u)
    expect(installPhases).toEqual(['menu', 'button', 'install', 'cleanup'])

    const settlementPhases: string[] = []
    const settlementDeadlines: number[] = []
    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() + 500,
      openMenu: async () => { settlementPhases.push('menu') },
      waitForMapButton: async () => { settlementPhases.push('button') },
      installObserver: async (_timeout: number, deadline: number) => {
        settlementPhases.push('install')
        settlementDeadlines.push(deadline)
      },
      clickMap: async () => { settlementPhases.push('click') },
      waitForSettlement: async (deadline: number) => {
        settlementPhases.push('settlement')
        settlementDeadlines.push(deadline)
        throw new Error('synthetic settlement timeout')
      },
      cleanupObserver: async () => { settlementPhases.push('cleanup'); return {cleaned: true} },
    })).rejects.toThrow(/synthetic settlement timeout/u)
    expect(settlementPhases).toEqual(['menu', 'button', 'install', 'click', 'settlement', 'cleanup'])
    expect(settlementDeadlines[0]).toBe(settlementDeadlines[1])

    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() + 500,
      openMenu: async () => undefined,
      waitForMapButton: async () => undefined,
      installObserver: async () => undefined,
      clickMap: async () => { throw new Error('synthetic click failure') },
      waitForSettlement: async () => null,
      cleanupObserver: async () => ({cleaned: false}),
    })).rejects.toThrow(/synthetic click failure; Synthetic map style settlement cleanup/u)

    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() + 500,
      openMenu: async () => undefined,
      waitForMapButton: async () => undefined,
      installObserver: async () => undefined,
      clickMap: async () => { throw new Error('synthetic click timeout') },
      waitForSettlement: async () => null,
      cleanupObserver: async () => { throw new Error('synthetic cleanup timeout') },
    })).rejects.toThrow(/synthetic click timeout; synthetic cleanup timeout/u)
  })

  it('rejects an expired selection before touching the operator controls', async () => {
    const phases: string[] = []
    await expect(runBoundedOfficialMapSelection({
      deadlineAt: Date.now() - 1,
      openMenu: async () => { phases.push('menu') },
      waitForMapButton: async () => { phases.push('button') },
      installObserver: async () => { phases.push('install') },
      clickMap: async () => { phases.push('click') },
      waitForSettlement: async () => { phases.push('settlement'); return null },
      cleanupObserver: async () => { phases.push('cleanup'); return {cleaned: true} },
    })).rejects.toThrow(/deadline/u)
    expect(phases).toEqual([])
  })

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
