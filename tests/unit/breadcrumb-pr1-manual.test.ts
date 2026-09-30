import { existsSync, readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PR-1 operator manual [DON-268] [DON-269]', () => {
  it('documents stationary attention, tracking loss and the warnings volunteers must act on, with screenshots', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    expect(manual).toContain('not an emergency declaration')
    expect(manual).toContain('Disconnected · retrying')
    expect(manual).toContain('MISSION BREADCRUMB STORAGE FAILED')
    expect(manual).toContain('TRACKING REPLACEMENT EVIDENCE UNSETTLED')
    for (const asset of [
      'tracking-offline.png',
      'stationary-attention-map.png',
      'stationary-attention-devices.png',
    ]) {
      expect(existsSync(`public/manual/assets/${asset}`)).toBe(true)
      expect(manual).toContain(`assets/${asset}`)
    }
  })

  it('references only screenshots that exist and ships no unreferenced screenshots', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const referenced = new Set(
      [...manual.matchAll(/assets\/([a-z0-9-]+\.png)/gu)].map((match) => match[1]!),
    )
    expect(referenced.size).toBeGreaterThan(0)
    for (const asset of referenced) {
      expect(existsSync(`public/manual/assets/${asset}`), asset).toBe(true)
    }
    const shipped = readdirSync('public/manual/assets').filter((name) => name.endsWith('.png'))
    expect(shipped.filter((name) => !referenced.has(name))).toEqual([])
  })
})
