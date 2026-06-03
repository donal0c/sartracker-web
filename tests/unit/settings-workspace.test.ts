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
