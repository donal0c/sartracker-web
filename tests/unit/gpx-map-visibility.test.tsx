// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GpxImportPanel } from '../../src/components/gpx-import-panel'
import { describeGpxMapVisibility } from '../../src/features/gpx/gpx-map-visibility'
import { useGpxStore } from '../../src/features/gpx/gpx-store'
import type { GpxRuntimeController } from '../../src/features/gpx/start-gpx-runtime'
import { GPX_TRACKS_GROUP_NODE_ID, getGpxImportFeatureNodeId, getGpxImportLayerNodeId } from '../../src/features/layers/layer-catalog-ids'
import { useLayerCatalogStore } from '../../src/features/layers/layer-catalog-store'
import { buildLayerCatalogTree } from '../../src/features/layers/layer-catalog-builder'
import { useLayerVisibilityStore } from '../../src/features/layers/layer-visibility-store'
import type { GpxTrackImport } from '../../src/infrastructure/mission-store/tauri-mission-store'

const source = vi.hoisted(() => ({ chooseFilePaths: vi.fn(), chooseDirectoryPath: vi.fn(), listDirectoryPaths: vi.fn() }))
vi.mock('../../src/infrastructure/gpx-import-source/desktop-gpx-import-source', () => ({ createDesktopGpxImportSource: () => source }))
vi.mock('../../src/lib/desktop-runtime', () => ({ isElectronRuntimeAvailable: () => true }))
vi.mock('../../src/lib/tauri-runtime', () => ({ isTauriRuntimeAvailable: () => false }))

function track(id: string): GpxTrackImport {
  return {
    id, mission_id: 'mission-a', source_path: `/tracks/${id}.gpx`, file_name: `${id}.gpx`, display_name: `Track ${id}`,
    geometry_json: '{"type":"MultiLineString","coordinates":[[[-9,52],[-9.1,52.1]]]}', metadata_json: null,
  } as GpxTrackImport
}

describe('GPX track map visibility [DON-319]', () => {
  it('says whether a track is drawn, from the same state the map uses', () => {
    expect(describeGpxMapVisibility('a', { gpxTracks: true }, [])).toBe('on_map')
    expect(describeGpxMapVisibility('a', { gpxTracks: true }, ['a'])).toBe('track_hidden')
    expect(describeGpxMapVisibility('a', { gpxTracks: false }, [])).toBe('group_hidden')
  })
})

/** A layer catalog that contains the given imports, as the app builds it. */
function catalogWith(imports: GpxTrackImport[]) {
  return buildLayerCatalogTree({ missionId: 'mission-a', devices: [], markers: [], drawings: [], helicopters: [],
    gpxImports: imports, measurements: [], metadataEntries: [] })
}

describe('GPX panel shows when tracks are hidden on the map [DON-319]', () => {
  let host: HTMLDivElement
  let root: Root
  const setNodeVisibilities = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    useGpxStore.setState({ activeMissionId: 'mission-a', imports: [track('a'), track('b')], outings: [], watchedDirectories: [],
      importIssues: [], importPageNumber: 1, hasMoreImports: false, loadingMoreImports: false,
      hasMoreImportIssues: false, importing: false, loading: false, error: null, controller: null })
    useLayerCatalogStore.setState({ controller: { setNodeVisibilities } as never, root: catalogWith([track('a'), track('b')]) })
    useLayerVisibilityStore.setState({
      groupVisibility: { ...useLayerVisibilityStore.getState().groupVisibility, gpxTracks: false },
      hiddenGpxImportIds: ['b'],
    })
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  const text = (testId: string) => host.querySelector(`[data-testid="${testId}"]`)?.textContent ?? ''

  it('counts tracks on the map honestly and marks each hidden one', () => {
    act(() => root.render(createElement(GpxImportPanel)))

    expect(text('gpx-import-panel')).toContain('2 listed · 0 on map, 2 hidden in Layers')
    expect(text('gpx-import-panel')).not.toContain('2 shown')
    expect(text('gpx-map-visibility-a')).toContain('Hidden on map')
    expect(text('gpx-map-visibility-b')).toContain('Hidden on map')
  })

  it('shows a hidden track on the map and persists the choice', async () => {
    act(() => root.render(createElement(GpxImportPanel)))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-show-on-map-b"]')?.click() })

    expect(useLayerVisibilityStore.getState().groupVisibility.gpxTracks).toBe(true)
    expect(useLayerVisibilityStore.getState().hiddenGpxImportIds).not.toContain('b')
    expect(setNodeVisibilities).toHaveBeenCalledWith(
      [GPX_TRACKS_GROUP_NODE_ID, getGpxImportLayerNodeId('b'), getGpxImportFeatureNodeId('b')], true)
    expect(text('gpx-map-visibility-b')).not.toContain('Hidden on map')
  })

  it('shows a newly imported track at once, saving the group even if Layers does not list the track yet', async () => {
    source.chooseFilePaths.mockResolvedValue(['/tracks/c.gpx'])
    useLayerVisibilityStore.setState({ hiddenGpxImportIds: [] })
    // Created by this import (it may land on another page, so Layers may never list it here).
    const importPaths = vi.fn().mockImplementation(async () => ({ outcome: 'imported', imports: [{ id: 'c', imported_at: new Date().toISOString() }] }))
    useGpxStore.setState({ controller: { importPaths } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-import-files"]')?.click() })
    await act(async () => undefined)

    expect(useLayerVisibilityStore.getState().groupVisibility.gpxTracks).toBe(true)
    // A new track has no saved hide; only the group needs saving.
    expect(setNodeVisibilities).toHaveBeenCalledWith([GPX_TRACKS_GROUP_NODE_ID], true)
    expect(text('gpx-import-status')).not.toMatch(/could not be saved/iu)
  })

  it('never re-shows a track hidden just after it was imported', async () => {
    const justNow = new Date(Date.now() - 200).toISOString()
    useLayerVisibilityStore.setState({
      groupVisibility: { ...useLayerVisibilityStore.getState().groupVisibility, gpxTracks: true },
      hiddenGpxImportIds: ['b'],
    })
    const rescanWatchedDirectories = vi.fn().mockResolvedValue({ outcome: 'imported', imports: [{ id: 'b', imported_at: justNow }] })
    useGpxStore.setState({ watchedDirectories: ['/tracks'], controller: { rescanWatchedDirectories } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-rescan-watches"]')?.click() })
    await act(async () => undefined)

    expect(useLayerVisibilityStore.getState().hiddenGpxImportIds).toContain('b')
    expect(setNodeVisibilities).not.toHaveBeenCalled()
  })

  it('does not un-hide tracks when a rescan returns existing ones, on any page', async () => {
    // GPX Tracks deliberately off, and 'b' individually hidden.
    useLayerVisibilityStore.setState({
      groupVisibility: { ...useLayerVisibilityStore.getState().groupVisibility, gpxTracks: false },
      hiddenGpxImportIds: ['b'],
    })
    // Existing tracks, including one on another page ('z'), come back from a rescan.
    const old = '2026-09-30T10:00:00.000Z'
    const rescanWatchedDirectories = vi.fn().mockResolvedValue({ outcome: 'imported', imports: [
      { id: 'a', imported_at: old }, { id: 'b', imported_at: old }, { id: 'z', imported_at: old },
    ] })
    useGpxStore.setState({ watchedDirectories: ['/tracks'], controller: { rescanWatchedDirectories } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-rescan-watches"]')?.click() })
    await act(async () => undefined)

    expect(useLayerVisibilityStore.getState().groupVisibility.gpxTracks).toBe(false)
    expect(useLayerVisibilityStore.getState().hiddenGpxImportIds).toContain('b')
    expect(setNodeVisibilities).not.toHaveBeenCalled()
  })

  it('says so when the "show on map" choice cannot be saved', async () => {
    setNodeVisibilities.mockRejectedValueOnce(new Error('disk unavailable'))
    act(() => root.render(createElement(GpxImportPanel)))

    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-show-on-map-b"]')?.click() })
    await act(async () => undefined)

    expect(text('gpx-import-status')).toMatch(/could not be saved.*disk unavailable/iu)
    // The recovery the message offers is actually there.
    expect(text('gpx-map-visibility-b')).toContain('not saved')
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="gpx-save-visibility-b"]')?.click() })
    await act(async () => undefined)
    expect(setNodeVisibilities).toHaveBeenCalledTimes(2)
    expect(text('gpx-map-visibility-b')).not.toContain('not saved')
  })
})
