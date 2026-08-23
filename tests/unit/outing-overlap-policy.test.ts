import { createRequire } from 'node:module'

import vectors from '../fixtures/outing-window-vectors.json'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { outingWindowsOverlap } = require('../../electron/outing-overlap-policy.cjs') as {
  readonly outingWindowsOverlap: (
    left: { readonly started_at: string; readonly ended_at: string | null },
    right: { readonly started_at: string; readonly ended_at: string | null },
  ) => boolean
}

describe('Electron outing overlap policy', () => {
  it.each(vectors)('$name', ({ left, right, overlaps }) => {
    expect(outingWindowsOverlap(left, right)).toBe(overlaps)
  })
})
