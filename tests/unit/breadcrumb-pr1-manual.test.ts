import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('PR-1 operator manual [DON-268] [DON-269]', () => {
  it('documents immutable evidence, degraded health, and stationary attention with screenshots', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    expect(manual).toContain('first accepted fix')
    expect(manual).toContain('Finalization and archive export remain blocked')
    expect(manual).toContain('Attention is not an emergency declaration')
    for (const asset of [
      'tracking-degraded-evidence-conflict.png',
      'tracking-stationary-attention-map.png',
      'tracking-stationary-attention-workspace.png',
    ]) {
      expect(existsSync(`public/manual/assets/${asset}`)).toBe(true)
    }
  })
})
