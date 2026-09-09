import { afterEach, expect, it, vi } from 'vitest'
import { applySavedTheme } from '../../src/lib/theme-preference'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme })

it('applies saved contrast synchronously without mounting the ready application', () => {
  localStorage.setItem('sartracker:high-contrast', 'true')
  applySavedTheme()
  expect(document.documentElement.dataset.theme).toBe('high-contrast')
})

it('keeps startup available when preference storage cannot be read', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
  expect(() => applySavedTheme()).not.toThrow()
  expect(document.documentElement.dataset.theme).toBe('standard')
})
