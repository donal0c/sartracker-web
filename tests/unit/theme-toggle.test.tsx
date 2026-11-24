import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeToggle } from '../../src/components/theme-toggle'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeReadFailed
})

it('starts on the light default, offers dark for night use, and persists the choice', () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  const button = host.querySelector('button')!
  expect(button.textContent).toBe('Theme: Light')
  expect(button.getAttribute('aria-pressed')).toBe('true')
  expect(button.title).toBe('Switch to the dark theme for night use')
  act(() => button.click())
  expect(button.textContent).toBe('Theme: Dark')
  expect(button.getAttribute('aria-pressed')).toBe('false')
  expect(button.title).toBe('Switch to the light theme')
  expect(document.documentElement.dataset.theme).toBe('standard')
  expect(localStorage.getItem('sartracker:high-contrast')).toBe('false')
  act(() => button.click())
  expect(document.documentElement.dataset.theme).toBe('light')
  expect(localStorage.getItem('sartracker:high-contrast')).toBe('true')
  act(() => root.unmount())
})

it('opens on dark for an operator who chose dark', () => {
  localStorage.setItem('sartracker:high-contrast', 'false')
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  expect(host.querySelector('button')!.textContent).toBe('Theme: Dark')
  expect(document.documentElement.dataset.theme).toBe('standard')
  act(() => root.unmount())
})

it('keeps the applied theme and exposes a failed preference write', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  act(() => host.querySelector('button')!.click())
  expect(document.documentElement.dataset.theme).toBe('standard')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not save')
  act(() => root.unmount())
})

it('keeps a choice that could not be saved for the rest of the session when the menu reopens', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  const first = document.createElement('div')
  const firstRoot = createRoot(first)
  act(() => firstRoot.render(<ThemeToggle />))
  act(() => first.querySelector('button')!.click())
  act(() => firstRoot.unmount())
  // Reopening More mounts a fresh toggle; storage still holds no choice.
  const second = document.createElement('div')
  const secondRoot = createRoot(second)
  act(() => secondRoot.render(<ThemeToggle />))
  expect(second.querySelector('button')!.textContent).toBe('Theme: Dark')
  expect(document.documentElement.dataset.theme).toBe('standard')
  act(() => secondRoot.unmount())
})

it('says the startup read failed, and clears that once a new choice is saved', () => {
  document.documentElement.dataset.theme = 'light'
  document.documentElement.dataset.themeReadFailed = 'true'
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  expect(host.querySelector('[role="status"]')?.textContent).toBe('Could not read the saved theme at startup, so SAR Tracker opened in Light.')
  act(() => host.querySelector('button')!.click())
  expect(host.querySelector('button')!.textContent).toBe('Theme: Dark')
  expect(host.querySelector('[role="status"]')).toBeNull()
  expect(document.documentElement.dataset.themeReadFailed).toBeUndefined()
  act(() => root.unmount())
})

it('keeps the startup notice when the new choice could not be saved either', () => {
  document.documentElement.dataset.theme = 'light'
  document.documentElement.dataset.themeReadFailed = 'true'
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable') })
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(<ThemeToggle />))
  act(() => host.querySelector('button')!.click())
  expect(host.querySelector('[role="status"]')?.textContent).toContain('at startup')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not save')
  act(() => root.unmount())
})
