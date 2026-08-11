import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  auditRenderedCoordinateDeviation,
  auditRenderedExactGeoJsonFeatures,
  assertExactFixEvidenceChain,
  assertExactFixSequence,
  buildAllowlistedLiveExactFailureReport,
  buildAllowlistedLiveExactReport,
  createExactFixEvidence,
  createExactIdentityTimeEvidence,
  normalizeExactGeoJsonFeatures,
  normalizeExactProviderRows,
  normalizeExactStoredRows,
  parsePrivateTargetSelector,
  validateExactPageTraversal,
} from '../../build/breadcrumb-live-exact-proof-lib.js'

const targetDeviceId = '7'
const sourceRows = [
  {
    id: 901,
    deviceId: 7,
    latitude: 52.12345674,
    longitude: -9.12345674,
    fixTime: '2026-08-10T09:00:01+00:00',
    valid: true,
  },
  {
    id: 900,
    deviceId: 7,
    latitude: 52.12340001,
    longitude: -9.12340001,
    fixTime: '2026-08-10T09:00:00.000Z',
    valid: true,
  },
]

describe('private live exact target selector', () => {
  it('accepts only a single positive device ID in an owner-only regular file', () => {
    expect(parsePrivateTargetSelector('7\n', {
      mode: 0o100600,
      uid: 501,
      expectedUid: 501,
      isFile: true,
      isSymbolicLink: false,
    })).toBe('7')

    for (const invalid of [
      ['', 0o100600],
      ['7\n8\n', 0o100600],
      ['name', 0o100600],
      ['0', 0o100600],
      ['99999999999999999999999999', 0o100600],
      ['7', 0o100640],
    ] as const) {
      expect(() => parsePrivateTargetSelector(invalid[0], {
        mode: invalid[1],
        uid: 501,
        expectedUid: 501,
        isFile: true,
        isSymbolicLink: false,
      })).toThrow()
    }
  })

  it('rejects wrong ownership, symlinks, and non-regular files', () => {
    expect(() => parsePrivateTargetSelector('7', {
      mode: 0o100600,
      uid: 0,
      expectedUid: 501,
      isFile: true,
      isSymbolicLink: false,
    })).toThrow(/owner/iu)
    expect(() => parsePrivateTargetSelector('7', {
      mode: 0o120600,
      uid: 501,
      expectedUid: 501,
      isFile: false,
      isSymbolicLink: true,
    })).toThrow(/regular/iu)
  })
})

describe('independent real-provider exact-fix oracle', () => {
  it('uses the durable lexical source identity tie-break used by exact keyset pages', () => {
    const tiedRows = [
      {
        deviceId: targetDeviceId,
        sourcePositionId: '10',
        timestamp: '2026-08-10T09:00:00.000Z',
        lat: 52.1,
        lon: -9.1,
      },
      {
        deviceId: targetDeviceId,
        sourcePositionId: '2',
        timestamp: '2026-08-10T09:00:00.000Z',
        lat: 52.2,
        lon: -9.2,
      },
    ]

    expect(() => assertExactFixSequence(tiedRows, 'Numeric-looking source tie'))
      .not.toThrow()
    expect(() => assertExactFixSequence([...tiedRows].reverse(), 'Reversed source tie'))
      .toThrow(/stable chronological identity order/iu)
  })

  it('keeps provider, SQLite, exact-page, and exact source coordinates on one exact HMAC', () => {
    const provider = normalizeExactProviderRows(sourceRows, targetDeviceId)
    const stored = normalizeExactStoredRows([
      {
        source_position_id: '900',
        device_id: '7',
        lat: 52.12340001,
        lon: -9.12340001,
        timestamp: '2026-08-10T09:00:00.000Z',
      },
      {
        source_position_id: '901',
        device_id: '7',
        lat: 52.12345674,
        lon: -9.12345674,
        timestamp: '2026-08-10T09:00:01.000Z',
      },
    ], targetDeviceId)
    const geoJson = normalizeExactGeoJsonFeatures({
      type: 'FeatureCollection',
      features: stored.map((row) => ({
        type: 'Feature',
        id: `${row.deviceId}:id:${row.sourcePositionId}`,
        geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
        properties: {
          featureKind: 'breadcrumb',
          deviceId: row.deviceId,
          sourcePositionId: row.sourcePositionId,
          timestamp: row.timestamp,
        },
      })),
    }, targetDeviceId)
    const key = randomBytes(32)
    const chain = {
      provider: createExactFixEvidence(provider, key),
      sqlite: createExactFixEvidence(stored, key),
      exactPages: createExactFixEvidence([...stored].reverse(), key),
      exactGeoJson: createExactFixEvidence(geoJson, key),
    }

    expect(new Set(Object.values(chain).map((entry) => entry.hmacSha256))).toHaveLength(1)
    expect(assertExactFixEvidenceChain(chain)).toEqual({
      count: 2,
      hmacSha256: chain.provider.hmacSha256,
      matched: true,
    })
  })

  it('accepts measured MapLibre quantization only within both metre and pixel bounds', () => {
    const source = normalizeExactStoredRows([{
      source_position_id: '900',
      device_id: targetDeviceId,
      lat: 52.1234,
      lon: -9.1234,
      timestamp: '2026-08-10T09:00:00.000Z',
    }, {
      source_position_id: '901',
      device_id: targetDeviceId,
      lat: 52.1235,
      lon: -9.1235,
      timestamp: '2026-08-10T09:00:01.000Z',
    }], targetDeviceId)
    const rendered = [
      {
        ...source[0]!,
        lat: source[0]!.lat + 0.00005,
        screenDisplacementX: 0.060423,
        screenDisplacementY: 0.060423,
      },
      {
        ...source[1]!,
        lon: source[1]!.lon + 0.00001,
        screenDisplacementX: 0.01,
        screenDisplacementY: 0.005,
      },
    ]
    const key = randomBytes(32)

    expect(createExactIdentityTimeEvidence(rendered, key)).toEqual(
      createExactIdentityTimeEvidence(source, key),
    )
    expect(auditRenderedCoordinateDeviation(source, rendered)).toMatchObject({
      joinedFixCount: 2,
      missingFixCount: 0,
      conflictingFixCount: 0,
      metreLimit: 8,
      perAxisPixelLimit: 0.0625,
      radialPixelLimit: Math.SQRT2 / 16,
      metres: {
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: expect.any(Number),
      },
      screenPixels: {
        p50: expect.any(Number),
        p95: expect.any(Number),
        max: Math.hypot(0.060423, 0.060423),
      },
      screenPixelAxes: { maxX: 0.060423, maxY: 0.060423 },
    })
    expect(() => auditRenderedCoordinateDeviation(source, [
      { ...rendered[0]!, screenDisplacementX: 0.062501 },
      rendered[1]!,
    ])).toThrow('RENDERED_COORDINATE_DEVIATION_EXCEEDED')
    expect(() => auditRenderedCoordinateDeviation(source, [
      { ...rendered[0]!, lat: source[0]!.lat + 0.001 },
      rendered[1]!,
    ])).toThrow('RENDERED_COORDINATE_DEVIATION_EXCEEDED')
  })

  it('keeps literal source Feature.id strict but audits rendered identities from properties', () => {
    const stored = normalizeExactStoredRows([{
      source_position_id: '900',
      device_id: targetDeviceId,
      lat: 52.12340001,
      lon: -9.12340001,
      timestamp: '2026-08-10T09:00:00.000Z',
    }, {
      source_position_id: '901',
      device_id: targetDeviceId,
      lat: 52.12345674,
      lon: -9.12345674,
      timestamp: '2026-08-10T09:00:01.000Z',
    }], targetDeviceId)
    const sourceFeatures = stored.map((row) => ({
      type: 'Feature',
      id: `${row.deviceId}:id:${row.sourcePositionId}`,
      geometry: { type: 'Point', coordinates: [row.lon, row.lat] },
      properties: {
        featureKind: 'breadcrumb',
        deviceId: row.deviceId,
        sourcePositionId: row.sourcePositionId,
        timestamp: row.timestamp,
      },
    }))

    expect(() => normalizeExactGeoJsonFeatures({
      type: 'FeatureCollection',
      features: [{ ...sourceFeatures[0], id: undefined }],
    }, targetDeviceId)).toThrow(/invalid/iu)

    const rendered = auditRenderedExactGeoJsonFeatures([
      { ...sourceFeatures[0], id: undefined },
      { ...sourceFeatures[0], id: 900 },
      sourceFeatures[1],
    ], targetDeviceId)
    expect(rendered.fixes).toEqual(stored)
    expect(rendered.diagnostics).toEqual({
      renderedFeatureCount: 3,
      uniqueFixCount: 2,
      duplicateTileCopyCount: 1,
      missingFeatureIdCount: 1,
      numericFeatureIdCount: 1,
      stringFeatureIdCount: 1,
      otherFeatureIdCount: 0,
      mismatchedStringFeatureIdCount: 0,
      conflictingDuplicateCount: 0,
    })
  })

  it('rejects rendered identity mismatches and conflicting tile copies with sanitized codes', () => {
    const base = {
      type: 'Feature',
      id: `${targetDeviceId}:id:900`,
      geometry: { type: 'Point', coordinates: [-9.1, 52.1] },
      properties: {
        featureKind: 'breadcrumb',
        deviceId: targetDeviceId,
        sourcePositionId: '900',
        timestamp: '2026-08-10T09:00:00.000Z',
      },
    }
    let mismatchError: unknown
    try {
      auditRenderedExactGeoJsonFeatures([
        { ...base, id: 'sensitive-wrong-id' },
      ], targetDeviceId)
    } catch (error) {
      mismatchError = error
    }
    expect(mismatchError).toMatchObject({
      message: 'RENDERED_EXPLICIT_ID_MISMATCH',
      diagnostics: {
        renderedFeatureCount: 1,
        stringFeatureIdCount: 1,
        mismatchedStringFeatureIdCount: 1,
      },
    })
    expect(JSON.stringify(mismatchError)).not.toContain('sensitive-wrong-id')
    expect(() => auditRenderedExactGeoJsonFeatures([
      base,
      { ...base, geometry: { type: 'Point', coordinates: [-9.2, 52.1] } },
    ], targetDeviceId)).toThrow('RENDERED_DUPLICATE_PAYLOAD_CONFLICT')
    expect(() => auditRenderedExactGeoJsonFeatures([{
      ...base,
      properties: { ...base.properties, sourcePositionId: '' },
    }], targetDeviceId)).toThrow('RENDERED_FEATURE_INVALID')
  })

  it('fails closed on invalid, duplicate, conflicting, or non-target provider fixes', () => {
    expect(() => normalizeExactProviderRows([
      ...sourceRows,
      { ...sourceRows[0], id: 901 },
    ], targetDeviceId)).toThrow(/duplicate/iu)
    expect(() => normalizeExactProviderRows([
      { ...sourceRows[0], valid: false },
    ], targetDeviceId)).toThrow(/valid/iu)
    expect(() => normalizeExactProviderRows([
      { ...sourceRows[0], deviceId: 8 },
    ], targetDeviceId)).toThrow(/target/iu)
    expect(() => normalizeExactProviderRows([
      { ...sourceRows[0], fixTime: undefined },
    ], targetDeviceId)).toThrow(/fixTime/iu)
    expect(() => normalizeExactProviderRows([
      { ...sourceRows[0], fixTime: '2026-02-31T09:00:00.000Z' },
    ], targetDeviceId)).toThrow(/timestamp/iu)
    expect(() => normalizeExactProviderRows([
      { ...sourceRows[0], latitude: 91 },
    ], targetDeviceId)).toThrow(/latitude/iu)
  })

  it('fails closed when any downstream lane omits or changes a fix', () => {
    const key = randomBytes(32)
    const providerRows = normalizeExactProviderRows(sourceRows, targetDeviceId)
    const expected = createExactFixEvidence(providerRows, key)
    const changed = createExactFixEvidence([
      { ...providerRows[0], lat: providerRows[0]!.lat + 0.0000002 },
      providerRows[1]!,
    ], key)

    expect(() => assertExactFixEvidenceChain({
      provider: expected,
      sqlite: expected,
      exactPages: expected,
      exactGeoJson: changed,
    })).toThrow(/exactGeoJson/iu)
  })
})

describe('allowlisted archive evidence', () => {
  it('rebuilds a bounded exact-source failure report and rejects private extras', () => {
    const report = buildAllowlistedLiveExactFailureReport({
      artifactSha256: 'a'.repeat(64),
      expectedVersion: '0.1.0-beta.12.11',
      failureClass: 'EXACT_GEOJSON_PAGE_TIMEOUT',
      progress: {
        phase: 'exactGeoJson',
        direction: 'earlier',
        pageIndex: 1,
        completedPageCount: 1,
        targetActive: true,
        activeDeviceCount: 1,
        dotsActive: true,
        workspaceHidden: true,
        controllerState: 'ready',
        expectedPageCount: 346,
        expectedTotalCount: 10_346,
        mismatchObservationCount: 3,
        firstMismatch: {
          sourceAvailable: true,
          sourceValid: true,
          observedPageCount: 10_000,
          observedTotalCount: 10_346,
          targetFeatureCount: 10_000,
          otherFeatureCount: 0,
          baselineBreadcrumbPointCount: 0,
          countMatched: false,
          hmacMatched: false,
          rawDeviceId: '7',
          coordinates: [52.1, -9.1],
        },
        lastMismatch: {
          sourceAvailable: true,
          sourceValid: true,
          observedPageCount: 10_000,
          observedTotalCount: 10_346,
          targetFeatureCount: 10_000,
          otherFeatureCount: 0,
          baselineBreadcrumbPointCount: 0,
          countMatched: false,
          hmacMatched: false,
          rawName: 'Private target name',
        },
        actionFailure: {
          action: 'earlier',
          pageIndexFromLatest: 1,
          failureClass: 'click_timeout_or_interception',
          first: {
            bbox: { x: 12.125, y: 20, width: 80, height: 28 },
            intercept: {
              tag: 'aside',
              testId: 'device-active-toggle-1199891612',
              className: 'fixed inset-0',
            },
          },
          last: null,
          rawError: 'target 7 at 52.1,-9.1',
        },
        secret: 'must not survive',
      },
      credentials: 'must not survive',
    })

    expect(report).toEqual({
      schemaVersion: 1,
      proof: 'packaged-real-traccar-exact-breadcrumb-dots',
      result: 'fail',
      artifact: {
        sha256: 'a'.repeat(64),
        version: '0.1.0-beta.12.11',
      },
      failure: {
        failureClass: 'EXACT_GEOJSON_PAGE_TIMEOUT',
        phase: 'exactGeoJson',
        direction: 'earlier',
        pageIndex: 1,
        completedPageCount: 1,
        targetActive: true,
        activeDeviceCount: 1,
        dotsActive: true,
        workspaceHidden: true,
        controllerState: 'ready',
        expectedPageCount: 346,
        expectedTotalCount: 10_346,
        mismatchObservationCount: 3,
        firstMismatch: {
          sourceAvailable: true,
          sourceValid: true,
          observedPageCount: 10_000,
          observedTotalCount: 10_346,
          targetFeatureCount: 10_000,
          otherFeatureCount: 0,
          baselineBreadcrumbPointCount: 0,
          countMatched: false,
          hmacMatched: false,
        },
        lastMismatch: {
          sourceAvailable: true,
          sourceValid: true,
          observedPageCount: 10_000,
          observedTotalCount: 10_346,
          targetFeatureCount: 10_000,
          otherFeatureCount: 0,
          baselineBreadcrumbPointCount: 0,
          countMatched: false,
          hmacMatched: false,
        },
        actionFailure: {
          action: 'earlier',
          pageIndexFromLatest: 1,
          failureClass: 'click_timeout_or_interception',
          first: {
            bbox: { x: 12.125, y: 20, width: 80, height: 28 },
            intercept: {
              tag: 'aside',
              testId: null,
              className: 'fixed inset-0',
            },
          },
          last: null,
        },
      },
      safety: {
        providerGetOnly: true,
        privateTargetSelectorVerified: true,
        rawOperationalDataArchived: false,
      },
    })
    expect(JSON.stringify(report)).not.toMatch(
      /Private target|rawDeviceId|coordinates|credentials|secret|52\.1|-9\.1|1199891612/iu,
    )
  })

  it('emits only fixed-schema counts, hashes, booleans, durations, and artifact identity', () => {
    const digest = createHash('sha256').update('proof').digest('hex')
    const report = buildAllowlistedLiveExactReport({
      artifactSha256: 'a'.repeat(64),
      expectedVersion: '0.1.0-beta.13',
      fixEvidence: { count: 8_941, hmacSha256: digest, matched: true },
      renderedIdentityTimeEvidence: { count: 8_941, hmacSha256: digest, matched: true },
      renderedCoordinateDeviation: {
        joinedFixCount: 8_941,
        missingFixCount: 0,
        conflictingFixCount: 0,
        metreLimit: 8,
        perAxisPixelLimit: 0.0625,
        radialPixelLimit: Math.SQRT2 / 16,
        metres: { p50: 0.8, p95: 2.06, max: 7.40434 },
        screenPixels: { p50: 0.01, p95: 0.06, max: 0.08545 },
        screenPixelAxes: { maxX: 0.060423, maxY: 0.061 },
      },
      pageCount: 1,
      maximumPageCount: 8_941,
      returnedToLatest: true,
      baselineBreadcrumbPointCount: 0,
      lookbackHours: 48,
      exactPageLimit: 10_000,
      providerGetOnly: true,
      sqliteIntegrityOk: true,
      screenshotSha256: 'b'.repeat(64),
      sourceFetchMs: 300,
      sqliteReadMs: 12,
      exactPageMs: 90,
      geoJsonMs: 30,
      renderedMapMs: 40,
      renderedAudit: {
        renderedFeatureCount: 9_005,
        uniqueFixCount: 8_941,
        duplicateTileCopyCount: 64,
        missingFeatureIdCount: 8_941,
        numericFeatureIdCount: 0,
        stringFeatureIdCount: 64,
        otherFeatureIdCount: 0,
        mismatchedStringFeatureIdCount: 0,
        conflictingDuplicateCount: 0,
      },
    })

    expect(report).toEqual({
      schemaVersion: 1,
      proof: 'packaged-real-traccar-exact-breadcrumb-dots',
      result: 'pass',
      artifact: {
        sha256: 'a'.repeat(64),
        version: '0.1.0-beta.13',
      },
      workload: {
        lookbackHours: 48,
        fixCount: 8_941,
        exactPageLimit: 10_000,
        pageCount: 1,
        maximumPageCount: 8_941,
      },
      reconciliation: {
        algorithm: 'hmac-sha256-ephemeral-key-v1',
        hmacSha256: digest,
        sourceToRenderedMatched: true,
        returnedToLatest: true,
        baselineBreadcrumbPointCount: 0,
        mapLibreRenderedAudit: {
          renderedFeatureCount: 9_005,
          uniqueFixCount: 8_941,
          duplicateTileCopyCount: 64,
          missingFeatureIdCount: 8_941,
          numericFeatureIdCount: 0,
          stringFeatureIdCount: 64,
          otherFeatureIdCount: 0,
          mismatchedStringFeatureIdCount: 0,
          conflictingDuplicateCount: 0,
        },
        renderedIdentityTimeHmacSha256: digest,
        renderedCoordinateDeviation: {
          joinedFixCount: 8_941,
          missingFixCount: 0,
          conflictingFixCount: 0,
          metreLimit: 8,
          perAxisPixelLimit: 0.0625,
          radialPixelLimit: Math.SQRT2 / 16,
          metres: { p50: 0.8, p95: 2.06, max: 7.40434 },
          screenPixels: { p50: 0.01, p95: 0.06, max: 0.08545 },
          screenPixelAxes: { maxX: 0.060423, maxY: 0.061 },
        },
      },
      safety: {
        providerGetOnly: true,
        sqliteIntegrityOk: true,
        privateTargetSelectorVerified: true,
        rawOperationalDataArchived: false,
      },
      timingsMs: {
        sourceFetch: 300,
        sqliteRead: 12,
        exactPages: 90,
        exactGeoJson: 30,
        renderedMap: 40,
      },
      visual: {
        dotsScreenshotSha256: 'b'.repeat(64),
        archiveContainsScreenshot: false,
      },
    })

    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('deviceId')
    expect(serialized).not.toContain('deviceName')
    expect(serialized).not.toContain('latitude')
    expect(serialized).not.toContain('longitude')
    expect(serialized).not.toContain('missionId')
  })
})

describe('exact-page traversal audit', () => {
  it('proves a bounded newest-to-oldest traversal covers every fix once', () => {
    const newest = Array.from({ length: 10_000 }, (_entry, index) => ({
      deviceId: targetDeviceId,
      sourcePositionId: String(index + 2),
      timestamp: new Date(Date.UTC(2026, 7, 10, 9, 0, index)).toISOString(),
      lat: 52,
      lon: -9,
    }))
    const oldest = [{
      deviceId: targetDeviceId,
      sourcePositionId: '1',
      timestamp: '2026-08-09T00:00:00.000Z',
      lat: 52,
      lon: -9,
    }]

    expect(validateExactPageTraversal([
      {
        positions: newest,
        totalPositionCount: 10_001,
        hasEarlier: true,
        hasLater: false,
        earlierCursor: 'earlier-newest',
        laterCursor: null,
      },
      {
        positions: oldest,
        totalPositionCount: 10_001,
        hasEarlier: false,
        hasLater: true,
        earlierCursor: null,
        laterCursor: 'later-oldest',
      },
    ], 10_001, 10_000)).toEqual({
      pageCount: 2,
      maximumPageCount: 10_000,
      totalPositionCount: 10_001,
    })
  })

  it('fails closed on missing fixes, repeated cursors, or incorrect page direction flags', () => {
    const position = {
      deviceId: targetDeviceId,
      sourcePositionId: '1',
      timestamp: '2026-08-09T00:00:00.000Z',
      lat: 52,
      lon: -9,
    }
    expect(() => validateExactPageTraversal([{
      positions: [position],
      totalPositionCount: 2,
      hasEarlier: false,
      hasLater: false,
      earlierCursor: null,
      laterCursor: null,
    }], 2, 10_000)).toThrow(/cover/iu)
    expect(() => validateExactPageTraversal([
      {
        positions: [position],
        totalPositionCount: 2,
        hasEarlier: true,
        hasLater: false,
        earlierCursor: 'same',
        laterCursor: null,
      },
      {
        positions: [{ ...position, sourcePositionId: '2' }],
        totalPositionCount: 2,
        hasEarlier: true,
        hasLater: true,
        earlierCursor: 'same',
        laterCursor: 'later',
      },
    ], 2, 10_000)).toThrow()
  })

  it('fails closed when one exact page is not in stable chronological identity order', () => {
    const older = {
      deviceId: targetDeviceId,
      sourcePositionId: '900',
      timestamp: '2026-08-10T09:00:00.000Z',
      lat: 52,
      lon: -9,
    }
    const newer = {
      ...older,
      sourcePositionId: '901',
      timestamp: '2026-08-10T09:00:01.000Z',
    }

    expect(() => validateExactPageTraversal([{
      positions: [newer, older],
      totalPositionCount: 2,
      hasEarlier: false,
      hasLater: false,
      earlierCursor: null,
      laterCursor: null,
    }], 2, 10_000)).toThrow(/order|chronolog/iu)
  })
})
