import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../../src/components/theme-toggle'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme })

it('applies the selected theme and persists the actual operator toggle', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  const button = host.querySelector('button')!
  act(() => button.click())
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(document.documentElement.dataset.theme).toBe('high-contrast')
  expect(localStorage.getItem('sartracker:high-contrast')).toBe('true')
  act(() => root.unmount())
})

it('keeps the applied theme and exposes a failed preference write', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  act(() => host.querySelector('button')!.click())
  expect(document.documentElement.dataset.theme).toBe('high-contrast')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not save')
  act(() => root.unmount())
})
