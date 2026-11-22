import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { canTrustGpxStatFingerprint } = require('../../electron/gpx-watched-fingerprint.cjs') as {
  readonly canTrustGpxStatFingerprint: (
    stat: { readonly mtimeMs: number; readonly ctimeMs: number },
    verifiedAtMs: number,
  ) => boolean
}

const verifiedAt = Date.parse('2026-11-21T10:00:00.000Z')

describe('when a watched file may skip re-hashing [DON-350] [M-38]', () => {
  it('trusts fine-grained timestamps on a file last changed well before it was hashed', () => {
    expect(canTrustGpxStatFingerprint({ mtimeMs: verifiedAt - 60_000.357, ctimeMs: verifiedAt - 60_000.357 }, verifiedAt)).toBe(true)
  })

  it('always re-hashes on FAT-style whole-second timestamps (Garmin SD cards), where ctime is not real', () => {
    expect(canTrustGpxStatFingerprint({ mtimeMs: verifiedAt - 60_000, ctimeMs: verifiedAt - 60_000 }, verifiedAt)).toBe(false)
  })

  it('always re-hashes on exFAT-style 10 ms timestamps', () => {
    expect(canTrustGpxStatFingerprint({ mtimeMs: verifiedAt - 60_010, ctimeMs: verifiedAt - 60_010 }, verifiedAt)).toBe(false)
  })

  it('rejects stats it cannot read as numbers', () => {
    expect(canTrustGpxStatFingerprint({ mtimeMs: Number.NaN, ctimeMs: verifiedAt - 60_000.357 }, verifiedAt)).toBe(false)
  })

  it('re-hashes a file changed within 2 s of the last hash, inside one coarse timestamp tick', () => {
    expect(canTrustGpxStatFingerprint({ mtimeMs: verifiedAt - 1_500.25, ctimeMs: verifiedAt - 1_500.25 }, verifiedAt)).toBe(false)
  })
})
