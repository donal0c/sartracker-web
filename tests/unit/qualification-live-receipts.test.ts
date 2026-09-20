import { describe, expect, it } from 'vitest'
import { buildAllowlistedLiveExactReport } from '../../build/breadcrumb-live-exact-proof-lib.js'
import { validateLiveExactReceipt } from '../../scripts/qualification/live-receipts.mjs'

/** Privacy-safe synthetic evidence only; no operational coordinates or credentials. */
function report() {
  const count = 8941, hmacSha256 = 'c'.repeat(64)
  const value = buildAllowlistedLiveExactReport({ artifactSha256: 'a'.repeat(64), expectedVersion: '0.1.0-beta.13',
    fixEvidence: { count, hmacSha256, matched: true }, renderedIdentityTimeEvidence: { count, hmacSha256, matched: true },
    renderedCoordinateDeviation: { joinedFixCount: count, missingFixCount: 0, conflictingFixCount: 0,
      metreLimit: 8, perAxisPixelLimit: 0.0625, radialPixelLimit: Math.SQRT2 / 16,
      metres: { p50: 0, p95: 1, max: 2 }, screenPixels: { p50: 0, p95: 0.01, max: 0.02 }, screenPixelAxes: { maxX: 0.01, maxY: 0.01 } },
    pageCount: 1, maximumPageCount: count, returnedToLatest: true, baselineBreadcrumbPointCount: 0,
    lookbackHours: 48, exactPageLimit: 10000, providerGetOnly: true, sqliteIntegrityOk: true,
    screenshotSha256: 'b'.repeat(64), sourceFetchMs: 1, sqliteReadMs: 1, exactPageMs: 1, geoJsonMs: 1, renderedMapMs: 1,
    renderedAudit: { renderedFeatureCount: count, uniqueFixCount: count, duplicateTileCopyCount: 0,
      missingFeatureIdCount: count, numericFeatureIdCount: 0, stringFeatureIdCount: 0, otherFeatureIdCount: 0,
      mismatchedStringFeatureIdCount: 0, conflictingDuplicateCount: 0 },
  })
  return { ...value, schemaVersion: 2, oracleInputs: {
    fixStages: Object.fromEntries(['provider','sqlite','exactPages','exactGeoJson'].map((key) => [key, { count, hmacSha256 }])),
    sourceIdentityTime: { count, hmacSha256 }, renderedIdentityTime: { count, hmacSha256 },
  } }
}
const expected = { artifactSha256: 'a'.repeat(64), version: '0.1.0-beta.13' }

describe('retained independent privacy-safe live receipt', () => {
  it('recomputes every lane comparison instead of trusting the matched flag', () => {
    expect(validateLiveExactReceipt(report(), expected).status).toBe('PASS')
    const value = report()
    value.oracleInputs.fixStages.sqlite.hmacSha256 = 'd'.repeat(64)
    expect(() => validateLiveExactReceipt(value, expected)).toThrow(/stage/iu)
  })
  it('rejects legacy collapsed facts, private additions and source/rendered identity-time disagreement', () => {
    expect(() => validateLiveExactReceipt({ ...report(), schemaVersion: 1 }, expected)).toThrow()
    expect(() => validateLiveExactReceipt({ ...report(), coordinates: [52,-9] }, expected)).toThrow()
    const value = report()
    value.oracleInputs.renderedIdentityTime.hmacSha256 = 'd'.repeat(64)
    expect(() => validateLiveExactReceipt(value, expected)).toThrow(/identity/iu)
  })
  it('does not transfer a live result between installer bytes or versions', () => {
    expect(() => validateLiveExactReceipt(report(), { ...expected, artifactSha256: 'e'.repeat(64) })).toThrow()
    expect(() => validateLiveExactReceipt(report(), { ...expected, version: '0.1.0-beta.14' })).toThrow()
  })
})
