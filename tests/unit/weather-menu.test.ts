import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_APP_SETTINGS } from '../../src/features/settings/settings-types'

const mocks = vi.hoisted(() => ({
  loadAppSettings: vi.fn(),
  openExternalUrl: vi.fn(),
}))

vi.mock('../../src/infrastructure/settings-store/tauri-settings-store', () => ({
  loadAppSettings: mocks.loadAppSettings,
}))

vi.mock('../../src/infrastructure/url-opener/open-external-url', () => ({
  openExternalUrl: mocks.openExternalUrl,
}))

describe('WeatherMenu [DON-340]', () => {
  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(() => {
    if (root !== null) act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
    vi.clearAllMocks()
  })

  async function renderOpenMenu(): Promise<HTMLElement> {
    const { WeatherMenu } = await import('../../src/components/weather-menu')
    mocks.loadAppSettings.mockResolvedValue({
      ...DEFAULT_APP_SETTINGS,
      weather: { links: [{ name: 'Met Éireann', url: 'https://www.met.ie' }] },
    })
    // The top bar clips overflow; the menu must not live inside it.
    host = document.createElement('div')
    host.style.overflow = 'hidden'
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(React.createElement(WeatherMenu))
    })
    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-testid="weather-menu-trigger"]')?.click()
    })
    await act(async () => {
      await Promise.resolve()
    })
    const menu = document.querySelector<HTMLElement>('[data-testid="weather-menu"]')
    if (menu === null) throw new Error('weather menu did not open')
    return menu
  }

  it('renders the open menu outside the clipping top bar, fixed on screen', async () => {
    const menu = await renderOpenMenu()
    expect(host?.contains(menu)).toBe(false)
    expect(menu.parentElement).toBe(document.body)
    expect(menu.className).toContain('fixed')
  })

  it('opens a link and closes the menu', async () => {
    mocks.openExternalUrl.mockResolvedValue(undefined)
    await renderOpenMenu()
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="weather-link-open-0"]')?.click()
    })
    expect(mocks.openExternalUrl).toHaveBeenCalledWith('https://www.met.ie')
    expect(document.querySelector('[data-testid="weather-menu"]')).toBeNull()
  })

  it('tells the operator when a link cannot be opened instead of failing silently', async () => {
    mocks.openExternalUrl.mockRejectedValue(new Error('This address is not one of the weather links saved in Settings, so it was not opened.'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await renderOpenMenu()
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="weather-link-open-0"]')?.click()
    })
    const notice = document.querySelector('[data-testid="weather-menu-open-error"]')
    expect(notice?.getAttribute('role')).toBe('alert')
    expect(notice?.textContent).toContain('Met Éireann could not be opened')
    expect(notice?.textContent).toContain('not one of the weather links saved in Settings')
    consoleError.mockRestore()
  })

  it('closes on Escape', async () => {
    await renderOpenMenu()
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(document.querySelector('[data-testid="weather-menu"]')).toBeNull()
  })
})
