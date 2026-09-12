// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GpxImportPanel } from '../../src/components/gpx-import-panel'
import { useGpxStore } from '../../src/features/gpx/gpx-store'
import type { GpxImportOperationResult, GpxRuntimeController } from '../../src/features/gpx/start-gpx-runtime'

const source = vi.hoisted(() => ({ chooseFilePaths: vi.fn(), chooseDirectoryPath: vi.fn(), listDirectoryPaths: vi.fn() }))
vi.mock('../../src/infrastructure/gpx-import-source/desktop-gpx-import-source', () => ({ createDesktopGpxImportSource: () => source }))
vi.mock('../../src/lib/desktop-runtime', () => ({ isElectronRuntimeAvailable: () => true }))
vi.mock('../../src/lib/tauri-runtime', () => ({ isTauriRuntimeAvailable: () => false }))

describe('GPX operator action results [DON-274]', () => {
  let host: HTMLDivElement
  let root: Root
  beforeEach(() => {
    vi.clearAllMocks()
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    useGpxStore.setState({ activeMissionId: 'mission-a', imports: [], outings: [], watchedDirectories: ['/tracks'],
      importIssues: [], importPageNumber: 1, hasMoreImports: false, loadingMoreImports: false,
      hasMoreImportIssues: false, importing: false, loading: false, error: null, controller: null })
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })

  it('keeps a newer refused rescan status when an older import finishes', async () => {
    let finish: (value: GpxImportOperationResult) => void = () => { throw new Error('Import was not started') }
    const importPaths = vi.fn(() => new Promise<GpxImportOperationResult>((resolve) => { finish = resolve }))
    source.chooseFilePaths.mockResolvedValue(['/tracks/a.gpx'])
    useGpxStore.setState({ controller: { importPaths,
      rescanWatchedDirectories: vi.fn().mockResolvedValue({ outcome: 'refused', imports: [] }),
    } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))
    await click('gpx-import-files')
    expect(importPaths).toHaveBeenCalledOnce()
    await click('gpx-rescan-watches')
    expect(status()).toContain('Retry after it finishes')
    await act(async () => { finish({ outcome: 'imported', imports: [{ id: 'a' }] }) })
    expect(status()).toContain('Retry after it finishes')
    expect(status()).not.toContain('found no new')
  })

  it('does not dispatch a held chooser selection into another mission', async () => {
    let choose: (paths: string[]) => void = () => { throw new Error('Chooser was not opened') }
    source.chooseFilePaths.mockImplementation(() => new Promise<string[]>((resolve) => { choose = resolve }))
    const importPaths = vi.fn().mockResolvedValue({ outcome: 'imported', imports: [{ id: 'a' }] })
    useGpxStore.setState({ controller: { importPaths } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))
    await click('gpx-import-files')
    act(() => useGpxStore.setState({ activeMissionId: 'mission-b' }))
    await act(async () => { choose(['/tracks/a.gpx']) })
    expect(importPaths).not.toHaveBeenCalled()
    expect(status()).toContain('mission changed')
  })

  it('does not dispatch a folder read that finishes in another mission', async () => {
    let finishRead: (paths: string[]) => void = () => { throw new Error('Directory was not read') }
    source.chooseDirectoryPath.mockResolvedValue('/tracks')
    source.listDirectoryPaths.mockImplementation(() => new Promise<string[]>((resolve) => { finishRead = resolve }))
    const importPaths = vi.fn().mockResolvedValue({ outcome: 'imported', imports: [{ id: 'a' }] })
    useGpxStore.setState({ controller: { importPaths } as unknown as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))
    await click('gpx-import-folder')
    act(() => useGpxStore.setState({ activeMissionId: 'mission-b' }))
    await act(async () => { finishRead(['/tracks/a.gpx']) })
    expect(importPaths).not.toHaveBeenCalled()
    expect(status()).toContain('mission changed')
  })

  it('reports a failed watched-folder chooser without throwing from its error handler', async () => {
    source.chooseDirectoryPath.mockRejectedValue(new Error('Chooser unavailable'))
    useGpxStore.setState({ controller: {} as GpxRuntimeController })
    act(() => root.render(createElement(GpxImportPanel)))
    await click('gpx-watch-folder')
    expect(status()).toContain('Chooser unavailable')
  })

  /** Performs a real DOM click and drains the handler's settled microtasks. */
  async function click(testId: string): Promise<void> {
    await act(async () => { (host.querySelector(`[data-testid="${testId}"]`) as HTMLButtonElement).click() })
  }
  /** Reads the rendered operator status rather than internal component state. */
  function status(): string { return host.querySelector('[data-testid="gpx-import-status"]')?.textContent ?? '' }
})
