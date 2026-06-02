import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { openExternalUrl } from '../../src/infrastructure/url-opener/open-external-url'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../src/lib/tauri-runtime', () => ({
  isTauriRuntimeAvailable: vi.fn(() => false),
}))

vi.mock('../../src/lib/desktop-runtime', () => ({
  isElectronRuntimeAvailable: vi.fn(() => false),
}))

describe('openExternalUrl', () => {
  let windowOpenSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
  })

  afterEach(() => {
    windowOpenSpy.mockRestore()
  })

  it('rejects empty URLs', async () => {
    await expect(openExternalUrl('')).rejects.toThrow('URL is required.')
    await expect(openExternalUrl('   ')).rejects.toThrow('URL is required.')
  })

  it('rejects non-http/https schemes', async () => {
    await expect(openExternalUrl('javascript:alert(1)')).rejects.toThrow('URL scheme must be http:// or https://')
    await expect(openExternalUrl('ftp://example.com')).rejects.toThrow('URL scheme must be http:// or https://')
  })

  it('opens https URLs via window.open in browser mode', async () => {
    await openExternalUrl('https://www.met.ie')
    expect(windowOpenSpy).toHaveBeenCalledWith('https://www.met.ie', '_blank', 'noopener,noreferrer')
  })

  it('opens http URLs via window.open in browser mode', async () => {
    await openExternalUrl('http://yr.no/weather')
    expect(windowOpenSpy).toHaveBeenCalledWith('http://yr.no/weather', '_blank', 'noopener,noreferrer')
  })

  it('trims whitespace from the URL', async () => {
    await openExternalUrl('  https://www.met.ie  ')
    expect(windowOpenSpy).toHaveBeenCalledWith('https://www.met.ie', '_blank', 'noopener,noreferrer')
  })

  it('uses Tauri invoke when Tauri runtime is available', async () => {
    const { isTauriRuntimeAvailable } = await import('../../src/lib/tauri-runtime')
    const { invoke } = await import('@tauri-apps/api/core')

    vi.mocked(isTauriRuntimeAvailable).mockReturnValue(true)
    vi.mocked(invoke).mockResolvedValue(undefined)

    await openExternalUrl('https://www.met.ie')

    expect(invoke).toHaveBeenCalledWith('open_external_url', { url: 'https://www.met.ie' })
    expect(windowOpenSpy).not.toHaveBeenCalled()

    vi.mocked(isTauriRuntimeAvailable).mockReturnValue(false)
  })
})
