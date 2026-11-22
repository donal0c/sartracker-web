import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'
import { useSettingsApplyStore } from '../../src/features/settings/settings-apply-store'
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
    useSettingsApplyStore.setState({ failure: null })
  })

  describe('menu of five sections [DON-343]', () => {
    it('shows a menu of the five sections and opens on Tracking sources with the default group', async () => {
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      render(React.createElement(SettingsWorkspace, { open: true, onClose: vi.fn() }))
      await waitForEnabledButton('[data-testid="settings-save"]')

      const items = [...document.querySelectorAll('[data-testid="settings-section-nav"] button')]
      expect(items.map((item) => item.textContent)).toEqual([
        expect.stringContaining('Mission defaults'),
        expect.stringContaining('Tracking sources'),
        expect.stringContaining('Mapping'),
        expect.stringContaining('Weather links'),
        expect.stringContaining('Advanced'),
      ])
      expect(getButton('[data-testid="settings-section-tracking-sources"]').getAttribute('aria-current')).toBe('page')
      expect(document.querySelector('[data-testid="settings-default-participant-group"]')).not.toBeNull()
      expect(document.querySelector('[data-testid="settings-provider-url"]')).not.toBeNull()
      // Other sections are not on the same long page any more.
      expect(document.querySelector('[data-testid="weather-link-add"]')).toBeNull()
      expect(document.querySelector('[data-testid="settings-auto-save-interval"]')).toBeNull()
    })

    it('puts every current setting in one of the five sections', async () => {
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      render(React.createElement(SettingsWorkspace, { open: true, onClose: vi.fn() }))
      await waitForEnabledButton('[data-testid="settings-save"]')

      const expected: Record<string, readonly string[]> = {
        'mission-defaults': ['settings-coordinator-roster', 'settings-admin-roster', 'settings-stationary-heartbeat', 'settings-stationary-movement-floor'],
        'tracking-sources': ['settings-default-participant-group', 'settings-provider-url', 'settings-provider-email', 'settings-provider-secret', 'settings-auto-connect', 'settings-auto-refresh-enabled', 'settings-auto-refresh-interval'],
        mapping: ['official-map-source-status', 'official-map-source-path', 'official-map-package-status', 'settings-coordinate-display-mode'],
        'weather-links': ['weather-link-add'],
        advanced: ['settings-auto-save-enabled', 'settings-auto-save-interval', 'settings-primary-root', 'settings-backup-root', 'settings-tracking-cache-enabled', 'settings-replay-enabled', 'settings-repair-layer-structure'],
      }
      for (const [section, testIds] of Object.entries(expected)) {
        await openSection(section)
        for (const testId of testIds) {
          expect(document.querySelector(`[data-testid="${testId}"]`), `${testId} in ${section}`).not.toBeNull()
        }
      }
    })

    it('keeps edits when moving between sections and still warns before discarding them', async () => {
      const onClose = vi.fn()
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await openSection('advanced')
      setInputValue(await waitForInput('[data-testid="settings-primary-root"]'), '/Volumes/MissionData')

      await openSection('weather-links')
      await openSection('advanced')
      expect((await waitForInput('[data-testid="settings-primary-root"]')).value).toBe('/Volumes/MissionData')

      await act(async () => {
        getButton('[data-testid="workspace-close-btn"]').click()
      })
      expect(document.querySelector('[data-testid="settings-discard-confirmation"]')).not.toBeNull()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('marks a section whose errors block saving', async () => {
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      render(React.createElement(SettingsWorkspace, { open: true, onClose: vi.fn() }))
      await openSection('weather-links')
      await act(async () => {
        getButton('[data-testid="weather-link-add"]').click()
      })
      setInputValue(await waitForInput('[data-testid="weather-link-url-0"]'), 'javascript:alert(1)')
      await openSection('tracking-sources')

      expect(getButton('[data-testid="settings-save"]').disabled).toBe(true)
      expect(document.querySelector('[data-testid="settings-section-weather-links-errors"]')?.textContent).toBe('2')
      expect(document.querySelector('[data-testid="settings-blocking-errors"]')?.textContent).toContain('Weather links')
    })

    it('opens on Mission defaults with the admin roster focused when asked', async () => {
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      const scrollIntoView = vi.fn()
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
      render(React.createElement(SettingsWorkspace, { open: true, onClose: vi.fn(), focusTarget: 'admin-roster' }))
      const adminRoster = await waitForTextArea('[data-testid="settings-admin-roster"]')
      expect(document.activeElement).toBe(adminRoster)
      expect(getButton('[data-testid="settings-section-mission-defaults"]').getAttribute('aria-current')).toBe('page')
      expect(scrollIntoView).toHaveBeenCalled()
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    })
  })

  describe('saving while tracking is live [DON-352, audit M-67]', () => {
    it('asks before a save that would stop live tracking, and saves only after confirmation', async () => {
      const onClose = vi.fn()
      const reloadSettings = vi.fn().mockResolvedValue(undefined)
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults({
        ...DEFAULT_APP_SETTINGS,
        dataSource: { ...DEFAULT_APP_SETTINGS.dataSource, providerType: 'traccar_http', baseUrl: 'https://traccar.example.org', secretPresent: true, email: 'ops@example.org' },
      })
      mocks.getAppRuntimeController.mockReturnValue({ reloadSettings, isTrackingConnected: () => true, dispose: vi.fn() })
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await waitForEnabledButton('[data-testid="settings-save"]')

      await act(async () => {
        getButton('[data-testid="settings-provider-none"]').click()
      })
      await act(async () => {
        getButton('[data-testid="settings-save"]').click()
      })

      const confirmation = document.querySelector('[data-testid="settings-stop-tracking-confirmation"]')
      expect(confirmation?.textContent).toContain('stop live tracking')
      expect(confirmation?.textContent).toContain('The tracking provider is set to None.')
      expect(mocks.saveAppSettings).not.toHaveBeenCalled()

      await act(async () => {
        getButton('[data-testid="settings-stop-tracking-confirm"]').click()
      })
      await flushMicrotasks()

      expect(mocks.saveAppSettings).toHaveBeenCalledOnce()
      expect(onClose).toHaveBeenCalledOnce()
      expect(reloadSettings).toHaveBeenCalledWith({ forceConnect: false })
    })

    it('saves without asking when tracking carries on', async () => {
      const onClose = vi.fn()
      const reloadSettings = vi.fn().mockResolvedValue(undefined)
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults({
        ...DEFAULT_APP_SETTINGS,
        dataSource: { ...DEFAULT_APP_SETTINGS.dataSource, providerType: 'traccar_http', baseUrl: 'https://traccar.example.org', secretPresent: true, email: 'ops@example.org', autoConnect: false },
      })
      mocks.getAppRuntimeController.mockReturnValue({ reloadSettings, isTrackingConnected: () => true, dispose: vi.fn() })
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await waitForEnabledButton('[data-testid="settings-save"]')

      await act(async () => {
        getButton('[data-testid="settings-save"]').click()
      })
      await flushMicrotasks()

      expect(document.querySelector('[data-testid="settings-stop-tracking-confirmation"]')).toBeNull()
      expect(onClose).toHaveBeenCalledOnce()
      expect(reloadSettings).toHaveBeenCalledWith({ forceConnect: false })
    })

    it('will not confirm a stop-tracking save once the draft has become invalid', async () => {
      const onClose = vi.fn()
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults({
        ...DEFAULT_APP_SETTINGS,
        dataSource: { ...DEFAULT_APP_SETTINGS.dataSource, providerType: 'traccar_http', baseUrl: 'https://traccar.example.org', secretPresent: true, email: 'ops@example.org' },
      })
      mocks.getAppRuntimeController.mockReturnValue({ reloadSettings: vi.fn(), isTrackingConnected: () => true, dispose: vi.fn() })
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await waitForEnabledButton('[data-testid="settings-save"]')
      await act(async () => {
        ;(await waitForInput('[data-testid="settings-auto-refresh-enabled"]')).click()
      })
      await act(async () => {
        getButton('[data-testid="settings-save"]').click()
      })
      expect(document.querySelector('[data-testid="settings-stop-tracking-confirmation"]')).not.toBeNull()

      setInputValue(await waitForInput('[data-testid="settings-provider-url"]'), 'not-a-url')
      const confirm = getButton('[data-testid="settings-stop-tracking-confirm"]')
      expect(confirm.disabled).toBe(true)
      await act(async () => {
        confirm.click()
      })
      await flushMicrotasks()

      expect(mocks.saveAppSettings).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('keeps the settings open when the operator chooses to keep editing', async () => {
      const onClose = vi.fn()
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults({
        ...DEFAULT_APP_SETTINGS,
        dataSource: { ...DEFAULT_APP_SETTINGS.dataSource, providerType: 'traccar_http', baseUrl: 'https://traccar.example.org', secretPresent: true, email: 'ops@example.org' },
      })
      mocks.getAppRuntimeController.mockReturnValue({ reloadSettings: vi.fn(), isTrackingConnected: () => true, dispose: vi.fn() })
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await waitForEnabledButton('[data-testid="settings-save"]')
      await act(async () => {
        getButton('[data-testid="settings-provider-none"]').click()
      })
      await act(async () => {
        getButton('[data-testid="settings-save"]').click()
      })
      await act(async () => {
        getButton('[data-testid="settings-stop-tracking-cancel"]').click()
      })

      expect(document.querySelector('[data-testid="settings-stop-tracking-confirmation"]')).toBeNull()
      expect(mocks.saveAppSettings).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    })

    it('shows the operator a failure to apply saved settings, not only the console', async () => {
      const onClose = vi.fn()
      const reloadSettings = vi.fn().mockRejectedValue(new Error('IPC down'))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
      arrangeDefaults()
      mocks.getAppRuntimeController.mockReturnValue({ reloadSettings, isTrackingConnected: () => false, dispose: vi.fn() })
      render(React.createElement(SettingsWorkspace, { open: true, onClose }))
      await waitForEnabledButton('[data-testid="settings-save"]')

      await act(async () => {
        getButton('[data-testid="settings-save"]').click()
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await flushMicrotasks()

      const notice = document.querySelector('[data-testid="settings-apply-failure"]')
      expect(notice?.getAttribute('role')).toBe('alert')
      expect(notice?.textContent).toContain('IPC down')
      expect(notice?.textContent).toContain('Settings were saved')
      consoleError.mockRestore()
    })
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
    await waitForEnabledButton('[data-testid="settings-save"]')

    await act(async () => {
      getButton('[data-testid="settings-save"]').click()
    })

    expect(mocks.saveAppSettings).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows operator-configurable stationary-attention hypotheses [DON-269]', async () => {
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)
    render(React.createElement(SettingsWorkspace, { open: true, onClose: vi.fn() }))
    await waitForEnabledButton('[data-testid="settings-save"]')
    await openSection('mission-defaults')
    expect(document.querySelector('[data-testid="settings-stationary-heartbeat"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="settings-stationary-movement-floor"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="settings-stationary-attention-note"]')?.textContent).toContain('attention')
  })

  it('closes after persisting settings without waiting for a slow reconnect', async () => {
    const onClose = vi.fn()
    const reloadSettings = vi.fn(() => new Promise<void>(() => undefined))
    const { SettingsWorkspace } = await import('../../src/components/settings-workspace')
    mocks.loadAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.saveAppSettings.mockResolvedValue(DEFAULT_APP_SETTINGS)
    mocks.getAppRuntimeController.mockReturnValue({ reloadSettings, isTrackingConnected: () => false, dispose: vi.fn() })
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)

    render(React.createElement(SettingsWorkspace, { open: true, onClose }))
    await waitForEnabledButton('[data-testid="settings-save-connect"]')

    await act(async () => {
      getButton('[data-testid="settings-save-connect"]').click()
    })
    await flushMicrotasks()

    expect(mocks.saveAppSettings).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
    expect(reloadSettings).toHaveBeenCalledWith({ forceConnect: true })
    expect(onClose.mock.invocationCallOrder[0]).toBeLessThan(
      reloadSettings.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
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
    await waitForEnabledButton('[data-testid="settings-save"]')

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
    await openSection('mission-defaults')
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
    await openSection('weather-links')
    await waitForEnabledButton('[data-testid="weather-link-add"]')

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
    await openSection('mapping')

    const sourcePathInput = await waitForInput('[data-testid="official-map-source-path"]')
    expect(document.body.textContent).toContain('Official maps')
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
    await openSection('mapping')

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
    await openSection('mapping')

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
    await openSection('mapping')

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

  function arrangeDefaults(settings = DEFAULT_APP_SETTINGS): void {
    mocks.loadAppSettings.mockResolvedValue(settings)
    mocks.saveAppSettings.mockResolvedValue(settings)
    mocks.getAppRuntimeController.mockReturnValue(null)
    mocks.readCoordinateDisplayMode.mockReturnValue('wgs84_first')
    mocks.isTauriRuntimeAvailable.mockReturnValue(false)
  }

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

async function waitForEnabledButton(selector: string): Promise<HTMLButtonElement> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = document.querySelector(selector)
    if (element instanceof HTMLButtonElement && !element.disabled) {
      return element
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Timed out waiting for enabled button ${selector}.`)
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

/** Selects a Settings section from the menu once settings have loaded. */
async function openSection(section: string): Promise<void> {
  const button = await waitForElement(`[data-testid="settings-section-${section}"]`)
  await act(async () => {
    ;(button as HTMLButtonElement).click()
  })
}
