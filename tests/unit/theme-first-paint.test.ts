import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applySavedTheme } from '../../src/lib/theme-preference'

/**
 * The saved theme must be on <html> before the browser paints anything, or a
 * light-theme operator sees a black flash at every launch (DON-344). The module
 * bundle runs too late to guarantee that, so index.html carries a tiny inline
 * script in <head>, ahead of every stylesheet and module script.
 */
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')
const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? ''
const inline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/.exec(head)

function runInlineScript(): void {
  new Function(inline?.[1] ?? '')()
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.themeReadFailed
})

describe('theme before first paint', () => {
  it('sets the theme from an inline <head> script, before any stylesheet or module script', () => {
    expect(inline, 'index.html <head> must hold an inline theme script').not.toBeNull()
    const scriptAt = head.indexOf(inline![0])
    for (const later of [/<link[^>]+rel="stylesheet"/, /<script[^>]+type="module"/, /<style/]) {
      const match = later.exec(head)
      if (match !== null) expect(scriptAt).toBeLessThan(match.index)
    }
    expect(html.indexOf('<script type="module"')).toBeGreaterThan(html.indexOf('</head>'))
  })

  it.each([['true', 'light'], ['false', 'standard'], [null, 'light'], ['yes', 'light']] as const)(
    'agrees with the app for saved value %s',
    (saved, expected) => {
      if (saved !== null) localStorage.setItem('sartracker:high-contrast', saved)
      runInlineScript()
      expect(document.documentElement.dataset.theme).toBe(expected)
      delete document.documentElement.dataset.theme
      applySavedTheme()
      expect(document.documentElement.dataset.theme).toBe(expected)
    },
  )

  it('falls back to the light default when storage is unavailable, and records the failure', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable') })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => runInlineScript()).not.toThrow()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.dataset.themeReadFailed).toBe('true')
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('could not read the saved theme'), expect.any(Error))
  })
})
