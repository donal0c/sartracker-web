import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'
import type { AppSettingsDraft } from '../../src/features/settings/settings-types'

const mocks = vi.hoisted(() => ({
  loadAppSettings: vi.fn(),
  saveAppSettings: vi.fn(),
  testTrackingConnection: vi.fn(),
  getAppRuntimeController: vi.fn(),
  readCoordinateDisplayMode: vi.fn(),
  persistCoordinateDisplayMode: vi.fn(),
  isTauriRuntimeAvailable: vi.fn(),
  isElectronRuntimeAvailable: vi.fn(),
}))

vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: mocks.loadAppSettings,
  saveAppSettings: mocks.saveAppSettings,
  testTrackingConnection: mocks.testTrackingConnection,
}))

vi.mock('../../src/features/runtime/app-runtime-controller', () => ({
  getAppRuntimeController: mocks.getAppRuntimeController,
}))

vi.mock('../../src/lib/coordinate-preferences', () => ({
  readCoordinateDisplayMode: mocks.readCoordinateDisplayMode,
  persistCoordinateDisplayMode: mocks.persistCoordinateDisplayMode,
}))

vi.mock('../../src/lib/tauri-runtime', () => ({
  isTauriRuntimeAvailable: mocks.isTauriRuntimeAvailable,
}))

vi.mock('../../src/lib/desktop-runtime', () => ({
  isElectronRuntimeAvailable: mocks.isElectronRuntimeAvailable,
}))

describe('SettingsWorkspace', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) {
      act(() => root?.unmount())
    }
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('closes after a successful save', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockImplementation(async (draft: AppSettingsDraft) => ({
      ...DEFAULT_APP_SETTINGS,
      missionDefaults: draft.missionDefaults,
    }))
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    await waitForElement('[data-testid="settings-save"]')

    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(mocks.saveAppSettings).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closes after persisting settings without waiting for a slow reconnect', async () => {
    const onClose = vi.fn()
    const reloadSettings = vi.fn(() => new Promise<void>(() => undefined))
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue({ reloadSettings, dispose: vi.fn() })
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    await waitForElement('[data-testid="settings-save-connect"]')

    await act(async () => {
      getButton('[data-testid="settings-save-connect"]').click()
    })
    await flushMicrotasks()

    expect(mocks.saveAppSettings).toHaveBeenCalledOnce()
    expect(reloadSettings).toHaveBeenCalledWith({ forceConnect: true })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps the workspace open when save fails', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockRejectedValue(new Error('Settings store unavailable.'))
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    await waitForElement('[data-testid="settings-save"]')

    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Settings store unavailable.')
  })

  it('does not strip roster spaces while an operator is typing a name', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    const rosterInput = await waitForTextArea('[data-testid="settings-coordinator-roster"]')

    setTextAreaValue(rosterInput, 'Cathal ')

    expect(rosterInput.value).toBe('Cathal ')
  })

  it('keeps focus while an operator types weather link names and URLs', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    await waitForElement('[data-testid="settings-save"]')

    await act(async () => {
      getButton('[data-testid="weather-link-add"]').click()
    })

    const nameInput = await waitForInput('[data-testid="weather-link-name-0"]')
    nameInput.focus()
    setInputValue(nameInput, 'M')

    expect(document.activeElement).toBe(nameInput)

    setInputValue(nameInput, 'Met Éireann')
    expect(nameInput.value).toBe('Met Éireann')

    const urlInput = await waitForInput('[data-testid="weather-link-url-0"]')
    urlInput.focus()
    setInputValue(urlInput, 'met.ie')

    expect(document.activeElement).toBe(urlInput)
    expect(urlInput.value).toBe('met.ie')
  })

  it('shows official map source status and lets an admin enter a MapGenie source path', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      officialMaps: {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        sourceType: 'mapgenie_file',
        sourcePath: '/private/maps/mountainrescue_org.txt',
        status: 'configured',
        username: 'mountainrescue_org',
        availableSources: ['official_discovery_topo'],
        serviceCount: 1,
        message: 'Official Discovery Topo source configured.',
      },
    })
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))

    const sourcePathInput = await waitForInput('[data-testid="official-map-source-path"]')
    expect(document.body.textContent).toContain('Official Maps')
    expect(document.body.textContent).toContain('Official Discovery Topo source configured.')
    expect(document.body.textContent).toContain('mountainrescue_org')
    expect(sourcePathInput.value).toBe('/private/maps/mountainrescue_org.txt')

    setInputValue(sourcePathInput, '/Volumes/Untitled/mountainrescue_org.txt')

    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(mocks.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        officialMaps: expect.objectContaining({
          sourceType: 'mapgenie_file',
          sourcePath: '/Volumes/Untitled/mountainrescue_org.txt',
        }),
      }),
    )
  })

  it('shows sanitized official map package readiness in settings', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      officialMaps: {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        packages: [
          {
            id: 'official_discovery_topo-ready',
            sourceType: 'mbtiles',
            mapId: 'official_discovery_topo',
            packagePath: '/private/maps/reeks-standard-60km-z16.mbtiles',
            status: 'ready',
            bounds: [-10.25, 51.85, -9.45, 52.35],
            minZoom: 8,
            maxZoom: 16,
            tileCount: 31_729,
            tileFormat: 'png',
            createdAt: '2026-06-05T10:00:00.000Z',
            verifiedAt: '2026-06-05T10:11:12.000Z',
            message: 'Official Discovery Topo package is ready.',
          },
          {
            id: 'official_discovery_topo-missing',
            sourceType: 'mbtiles',
            mapId: 'official_discovery_topo',
            packagePath: '/private/maps/missing.mbtiles',
            status: 'missing',
            bounds: null,
            minZoom: null,
            maxZoom: null,
            tileCount: 0,
            tileFormat: '',
            createdAt: '',
            verifiedAt: '2026-06-05T10:12:12.000Z',
            message: 'Official map package file was not found.',
          },
        ],
      },
    })
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))

    const packageStatus = await waitForElement('[data-testid="official-map-package-status"]')
    expect(packageStatus.textContent).toContain('Official offline packages')
    expect(packageStatus.textContent).toContain('Discovery Topo')
    expect(packageStatus.textContent).toContain('Ready')
    expect(packageStatus.textContent).toContain('Missing')
    expect(packageStatus.textContent).toContain('31,729')
    expect(packageStatus.textContent).toContain('z8 – z16')
    expect(packageStatus.textContent).not.toContain('/private/maps')
    expect(packageStatus.textContent).not.toContain('reeks-standard-60km-z16.mbtiles')
  })

  it('lets an Electron admin choose a MapGenie source file and Discovery MBTiles package', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    const bridge = {
      chooseOfficialMapSourceFilePath: vi.fn().mockResolvedValue('/Volumes/team/mountainrescue_org.txt'),
      chooseOfficialMapPackagePath: vi.fn().mockResolvedValue('/Volumes/team/reeks-standard-60km-z16.mbtiles'),
      importOfficialMapPackage: vi.fn().mockResolvedValue({
        packagePath: '/Users/test/Library/Application Support/SAR Tracker/official-map-packages/official_discovery_topo.mbtiles',
        sizeBytes: 1_100_000_000,
        replacedExisting: false,
        message: 'Official map package copied into SAR Tracker storage.',
      }),
    }
    Object.defineProperty(window, 'sartrackerElectron', {
      configurable: true,
      value: bridge,
    })
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)
    mocks.isElectronRuntimeAvailable.mockReturnValue(true)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))

    await waitForElement('[data-testid="choose-official-map-source-file"]')
    await act(async () => {
      getButton('[data-testid="choose-official-map-source-file"]').click()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(bridge.chooseOfficialMapSourceFilePath).toHaveBeenCalledOnce()
    expect((await waitForInput('[data-testid="official-map-source-path"]')).value).toBe(
      '/Volumes/team/mountainrescue_org.txt',
    )

    await act(async () => {
      getButton('[data-testid="choose-official-map-package"]').click()
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(bridge.chooseOfficialMapPackagePath).toHaveBeenCalledOnce()
    expect(bridge.importOfficialMapPackage).toHaveBeenCalledWith({
      sourcePath: '/Volumes/team/reeks-standard-60km-z16.mbtiles',
      mapId: 'official_discovery_topo',
    })
    expect(document.body.textContent).toContain('Pending validation after save')
    expect(document.body.textContent).toContain('copied into SAR Tracker storage')

    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(mocks.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        officialMaps: expect.objectContaining({
          sourceType: 'mapgenie_file',
          sourcePath: '/Volumes/team/mountainrescue_org.txt',
          packages: [
            expect.objectContaining({
              sourceType: 'mbtiles',
              mapId: 'official_discovery_topo',
              packagePath: '/Users/test/Library/Application Support/SAR Tracker/official-map-packages/official_discovery_topo.mbtiles',
            }),
          ],
        }),
      }),
    )
  })

  it('lets an Electron admin remove a registered official map package before saving', async () => {
    const onClose = vi.fn()
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      officialMaps: {
        ...DEFAULT_APP_SETTINGS.officialMaps,
        packages: [
          {
            id: 'official_discovery_topo-ready',
            sourceType: 'mbtiles',
            mapId: 'official_discovery_topo',
            packagePath: '/private/app/official-map-packages/official_discovery_topo.mbtiles',
            status: 'ready',
            bounds: [-10.25, 51.85, -9.45, 52.35],
            minZoom: 9,
            maxZoom: 16,
            tileCount: 31_729,
            tileFormat: 'png',
            createdAt: '2026-06-05T10:00:00.000Z',
            verifiedAt: '2026-06-05T10:11:12.000Z',
            message: 'Official Discovery Topo package is ready.',
          },
        ],
      },
    })
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)
    mocks.isElectronRuntimeAvailable.mockReturnValue(true)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))

    await waitForElement('[data-testid="remove-official-map-package-official_discovery_topo-ready"]')
    await act(async () => {
      getButton('[data-testid="remove-official-map-package-official_discovery_topo-ready"]').click()
    })
    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(mocks.saveAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        officialMaps: expect.objectContaining({
          packages: [],
        }),
      }),
    )
  })

  function render(element: React.ReactElement): void {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => {
      root?.render(element)
    })
  }
})

async function waitForElement(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.querySelector(selector)
    if (element !== null) {
      return element
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Timed out waiting for ${selector}.`)
}

function getButton(selector: string): HTMLButtonElement {
  const element = document.querySelector(selector)
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Expected ${selector} to be a button.`)
  }
  return element
}

async function waitForTextArea(selector: string): Promise<HTMLTextAreaElement> {
  const element = await waitForElement(selector)
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected ${selector} to be a textarea.`)
  }
  return element
}

async function waitForInput(selector: string): Promise<HTMLInputElement> {
  const element = await waitForElement(selector)
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Expected ${selector} to be an input.`)
  }
  return element
}

function setInputValue(input: HTMLInputElement, value: string): void {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setTextAreaValue(input: HTMLTextAreaElement, value: string): void {
  act(() => {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}
