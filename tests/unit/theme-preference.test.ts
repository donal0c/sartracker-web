import { afterEach, expect, it, vi } from 'vitest'
import { applySavedTheme, readTheme, saveTheme, THEME_KEY } from '../../src/lib/theme-preference'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme })

it('keeps the saved key, so an operator who chose High contrast now gets the light theme', () => {
  expect(THEME_KEY).toBe('sartracker:high-contrast')
  localStorage.setItem('sartracker:high-contrast', 'true')
  expect(readTheme()).toBe('light')
  applySavedTheme()
  expect(document.documentElement.dataset.theme).toBe('light')
})

it('stays on the standard dark theme when nothing, or anything unexpected, is saved', () => {
  expect(readTheme()).toBe('standard')
  for (const value of ['false', '', 'light', 'TRUE']) {
    localStorage.setItem(THEME_KEY, value)
    expect(readTheme()).toBe('standard')
  }
  applySavedTheme()
  expect(document.documentElement.dataset.theme).toBe('standard')
})

it('keeps startup available when preference storage cannot be read', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
  expect(() => applySavedTheme()).not.toThrow()
  expect(document.documentElement.dataset.theme).toBe('standard')
})

it('saves the choice under the existing key and reports a failed write', () => {
  expect(saveTheme('light')).toBe(true)
  expect(localStorage.getItem(THEME_KEY)).toBe('true')
  expect(saveTheme('standard')).toBe(true)
  expect(localStorage.getItem(THEME_KEY)).toBe('false')
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full') })
  expect(saveTheme('light')).toBe(false)
})
