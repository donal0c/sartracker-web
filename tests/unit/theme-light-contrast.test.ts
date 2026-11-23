import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACCENT_HUES, resolvePaletteHex, type Shade, type ThemedHue } from '../../src/lib/theme-palette'

/**
 * WCAG AA contrast for the light theme (DON-344, SAR-QA-029): body text 4.5:1,
 * large/bold status words and UI component borders 3:1. Colours are read from
 * the shipped stylesheet and palette, not restated here.
 */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const css = readFileSync(resolve(__dirname, '../../src/index.css'), 'utf8')

/** Reads `--name: #hex` declarations from one rule block of index.css. */
function tokens(selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`)
  expect(at, `index.css must define ${selector}`).toBeGreaterThanOrEqual(0)
  const block = css.slice(at, css.indexOf('}', at))
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]))
}

const sar = tokens(":root[data-theme='light']")
const sarDark = tokens(':root')
const ws = tokens("[data-theme='light'] [data-panel-arrangement]")
const light = (hue: ThemedHue, shade: Shade) => resolvePaletteHex('light', hue, shade)

describe('light theme contrast (WCAG AA)', () => {
  it('uses a light grey background, not black', () => {
    for (const bg of [sar['--sar-panel'], sar['--sar-ink'], ws['--ws-bg']]) expect(luminance(bg ?? '#000000')).toBeGreaterThan(0.7)
  })

  it('keeps every text token at 4.5:1 on every panel background', () => {
    const backgrounds = ['--sar-ink', '--sar-panel', '--sar-panel-raised', '--sar-panel-sunken'].map((k) => sar[k]!)
    for (const text of ['--sar-text', '--sar-text-strong', '--sar-text-muted', '--sar-text-dim']) {
      for (const bg of backgrounds) expect(contrast(sar[text]!, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
    for (const text of ['--ws-text', '--ws-muted']) {
      for (const bg of [ws['--ws-bg']!, ws['--ws-raised']!]) expect(contrast(ws[text]!, bg), `${text} on ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws borders strong enough to see (3:1)', () => {
    expect(contrast(sar['--sar-line']!, sar['--sar-panel']!)).toBeGreaterThanOrEqual(3)
    expect(contrast(ws['--ws-line']!, ws['--ws-bg']!)).toBeGreaterThanOrEqual(3)
    expect(contrast(light('stone', '700'), light('stone', '950'))).toBeGreaterThanOrEqual(3)
  })

  it('keeps the neutral text classes readable on the light panels', () => {
    for (const shade of ['50', '100', '200', '300', '400', '500'] as const) {
      for (const bg of ['950', '900'] as const) {
        expect(contrast(light('stone', shade), light('stone', bg)), `stone-${shade} on stone-${bg}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('keeps accent status text (amber warnings, rose failures, emerald OK) readable', () => {
    for (const hue of ACCENT_HUES) {
      for (const shade of ['50', '100', '200', '300'] as const) {
        expect(contrast(light(hue, shade), light('stone', '950')), `${hue}-${shade}`).toBeGreaterThanOrEqual(4.5)
      }
      expect(contrast(light(hue, '400'), light('stone', '950')), `${hue}-400`).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the safety status words in the top bar readable', () => {
    for (const name of ['--ws-ok', '--ws-warning', '--ws-danger']) {
      expect(contrast(ws[name]!, ws['--ws-bg']!), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('keeps the top-bar status words readable when the mission button is hovered', () => {
    for (const name of ['--ws-ok', '--ws-warning', '--ws-caution', '--ws-danger']) {
      expect(contrast(ws[name]!, ws['--ws-raised']!), `${name} on hover`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws the keyboard focus outline at 3:1 on the light panels', () => {
    const focus = sar['--sar-focus']
    expect(focus, 'light theme must define --sar-focus').toBeDefined()
    expect(css).toMatch(/:focus-visible \{ outline: 3px solid var\(--sar-focus\)/)
    for (const bg of ['--sar-ink', '--sar-panel', '--sar-panel-raised', '--sar-panel-sunken']) {
      expect(contrast(focus!, sar[bg]!), `focus on ${bg}`).toBeGreaterThanOrEqual(3)
    }
    expect(contrast(focus!, light('rose', '950')), 'focus on the startup fault card').toBeGreaterThanOrEqual(3)
    expect(sarDark['--sar-focus'], 'dark theme keeps its yellow focus outline').toBe('#facc15')
  })
})

/** Background colours declared inside one rule or keyframes block of index.css. */
function blockBackgrounds(opener: string, from = 0): string[] {
  const at = css.indexOf(opener, from)
  expect(at, `index.css must contain ${opener}`).toBeGreaterThanOrEqual(0)
  let depth = 0
  let end = at
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++
    if (css[i] === '}' && --depth === 0) { end = i; break }
  }
  return [...css.slice(at, end).matchAll(/background:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1]!)
}

describe('alarm words stay readable through the flash (WCAG AA 4.5:1)', () => {
  // The paused banner detail, the paused chip heading and the tracking
  // evidence-loss warning are small text; every frame of the flash, the
  // resting colour and the reduced-motion colour must carry white words.
  const reducedMotion = css.indexOf('@media (prefers-reduced-motion: reduce)')

  it('paused banner and tracking warning: every red frame carries white text', () => {
    const frames = [
      ...blockBackgrounds('@keyframes sar-paused-flash'),
      ...blockBackgrounds('.sar-status-chip-paused {'),
      ...blockBackgrounds('.sar-status-chip-paused {', reducedMotion),
      ...blockBackgrounds('.sar-status-alert-panel {', reducedMotion),
      ...blockBackgrounds('.sar-status-chip-alert,', reducedMotion),
    ]
    expect(frames.length).toBeGreaterThanOrEqual(5)
    for (const bg of frames) expect(contrast('#ffffff', bg), `white on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('paused Resume button: every frame carries its light label', () => {
    const frames = [...blockBackgrounds('@keyframes sar-resume-flash'), ...blockBackgrounds('.sar-action-resume-paused {'), ...blockBackgrounds('.sar-action-resume-paused:hover')]
    for (const bg of frames) expect(contrast('#fff7ed', bg), `label on ${bg}`).toBeGreaterThanOrEqual(4.5)
  })

  it('the paused detail and tracking warning use fixed white, not a themed palette class', () => {
    const panel = readFileSync(resolve(__dirname, '../../src/components/mission-control-panel.tsx'), 'utf8')
    expect(panel).not.toMatch(/leading-snug text-red-50/)
    for (const rule of ['.sar-status-chip-paused {', '.sar-status-alert-panel {', '.sar-status-chip-alert {']) {
      const at = css.indexOf(rule)
      expect(css.slice(at, css.indexOf('}', at))).toMatch(/color: #ffffff;/)
    }
  })
})

