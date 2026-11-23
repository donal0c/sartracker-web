import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../../src/components/theme-toggle'

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme })

it('switches to the light theme, names it, and persists the operator choice', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  const button = host.querySelector('button')!
  expect(button.textContent).toBe('Theme: Dark')
  act(() => button.click())
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.textContent).toBe('Theme: Light')
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('sartracker:high-contrast')).toBe('true')
  act(() => button.click())
  expect(document.documentElement.dataset.theme).toBe('standard')
  expect(localStorage.getItem('sartracker:high-contrast')).toBe('false')
  act(() => root.unmount())
})

it('opens on the light theme for an operator who chose High contrast before', () => {
  localStorage.setItem('sartracker:high-contrast', 'true')
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  expect(host.querySelector('button')!.textContent).toBe('Theme: Light')
  expect(document.documentElement.dataset.theme).toBe('light')
  act(() => root.unmount())
})

it('keeps the applied theme and exposes a failed preference write', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  act(() => host.querySelector('button')!.click())
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not save')
  act(() => root.unmount())
})
