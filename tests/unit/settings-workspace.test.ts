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
