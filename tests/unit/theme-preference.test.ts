import { afterEach, expect, it, vi } from 'vitest'
import { applySavedTheme, readTheme, readThemePreference, saveTheme, THEME_KEY } from '../../src/lib/theme-preference'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeReadFailed
})

it('opens a fresh profile, with nothing saved, in the light theme (the default)', () => {
  expect(readTheme()).toBe('light')
  applySavedTheme()
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('keeps the saved key, so an operator who chose High contrast or Light stays light', () => {
  expect(THEME_KEY).toBe('sartracker:high-contrast')
  localStorage.setItem('sartracker:high-contrast', 'true')
  expect(readTheme()).toBe('light')
})

it('keeps an explicit dark choice dark', () => {
  // 'false' is only written by pressing the toggle: either Dark after DON-344, or
  // High contrast turned on and off again before it. Both mean "not light".
  localStorage.setItem(THEME_KEY, 'false')
  expect(readTheme()).toBe('standard')
  applySavedTheme()
  expect(document.documentElement.dataset.theme).toBe('standard')
})

it('treats anything unexpected as the light default', () => {
  for (const value of ['', 'light', 'TRUE', 'yes']) {
    localStorage.setItem(THEME_KEY, value)
    expect(readTheme(), value).toBe('light')
  }
})

it('falls back to light when storage cannot be read, and says so', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  expect(readThemePreference()).toEqual({ theme: 'light', readFailed: true })
  expect(() => applySavedTheme()).not.toThrow()
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(document.documentElement.dataset.themeReadFailed).toBe('true')
  expect(logged).toHaveBeenCalledWith(expect.stringContaining('could not read the saved theme'), expect.any(Error))
})

it('saves the choice under the existing key and reports a failed write', () => {
  expect(saveTheme('light')).toBe(true)
  expect(localStorage.getItem(THEME_KEY)).toBe('true')
  expect(saveTheme('standard')).toBe(true)
  expect(localStorage.getItem(THEME_KEY)).toBe('false')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
  expect(saveTheme('light')).toBe(false)
})
