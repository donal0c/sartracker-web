import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateReplayReceipt } from '../../scripts/qualification/replay-receipts.mjs'
import { createReplayGeometryFixture } from '../../scripts/qualification/replay-probe-fixture.mjs'
import { isExpectedBlockedReplayRequest } from '../../scripts/qualification/replay-probe-diagnostics.mjs'

/** Synthetic raw replay observations; they are not packaged execution evidence. */
function report() {
  const geometry = (offset: number) => {
    const ring = Array.from({ length: 2000 }, (_, index) => [-9.7 + offset + Math.cos(index * Math.PI / 1000) * .01, 52 + Math.sin(index * Math.PI / 1000) * .01])
    ring.push(ring[0])
    return JSON.stringify({ type: 'Polygon', coordinates: [ring] })
  }
  const lane = (geometryJson: string) => {
    const serialized = JSON.stringify({ geometry_json: geometryJson })
    return { serialized, fragments: Math.ceil(serialized.length / 16384), expectedHash: createHash('sha256').update(serialized).digest('hex') }
  }
  const source = { initialGeometry: geometry(0), updatedGeometry: geometry(.002),
    knownBeforeUpdate: '2026-09-19T10:00:00.000Z', knownAfterUpdate: '2026-09-19T10:00:01.000Z' }
  return { schemaVersion: 2, source, liveOld: lane(source.initialGeometry), liveUpdated: lane(source.updatedGeometry),
    archiveOld: lane(source.initialGeometry), archiveUpdated: lane(source.updatedGeometry),
    rendererDiagnostics: { errors: [] as string[], unexpectedRequestFailures: [] as { url: string; failure: string }[], blockedNetworkRequestCount: 0 },
    maximumFrameGapMs: 20, frameCount: 60, measurementDurationMs: 1000,
    popupText: 'Large retained search area', popupColor: 'rgb(28, 25, 23)' }
}

describe('retained packaged replay oracle', () => {
  it('allows only explicitly blocked HTTP network requests, never local assets or other network errors', () => {
    expect(isExpectedBlockedReplayRequest('https://tiles.example/1.png', 'net::ERR_BLOCKED_BY_CLIENT')).toBe(true)
    expect(isExpectedBlockedReplayRequest('file:///app/replay.js', 'net::ERR_BLOCKED_BY_CLIENT')).toBe(false)
    expect(isExpectedBlockedReplayRequest('https://tiles.example/1.png', 'net::ERR_FAILED')).toBe(false)
    expect(isExpectedBlockedReplayRequest('invalid-url', 'net::ERR_BLOCKED_BY_CLIENT')).toBe(false)
  })
  it('passes exact host-generated fixture bytes across the renderer boundary', () => {
    const expected = report().source
    expect(createReplayGeometryFixture()).toEqual({
      initialGeometry: expected.initialGeometry, updatedGeometry: expected.updatedGeometry,
    })
  })
  it('recomputes both known-at-time geometries and live/archive equality', () => {
    expect(validateReplayReceipt(report())).toMatchObject({ passed: true, status: 'PASS' })
  })
  it('rejects a nonfatal renderer error even when geometry and map assertions passed', () => {
    const value = report()
    value.rendererDiagnostics.errors.push('Uncaught renderer exception')
    expect(validateReplayReceipt(value).passed).toBe(false)
  })
  it('rejects unexpected local request failures and missing diagnostic observations', () => {
    const value = report()
    value.rendererDiagnostics.unexpectedRequestFailures.push({ url: 'file:///app/assets/replay.js', failure: 'net::ERR_FILE_NOT_FOUND' })
    expect(validateReplayReceipt(value).passed).toBe(false)
    expect(validateReplayReceipt({ ...report(), rendererDiagnostics: undefined }).passed).toBe(false)
  })
  it.each(['liveOld', 'liveUpdated', 'archiveOld', 'archiveUpdated'] as const)('rejects changed raw %s bytes even with a forged pass flag', (lane) => {
    const changed = report()
    changed[lane].serialized = '{}'
    expect(validateReplayReceipt({ ...changed, passed: true }).passed).toBe(false)
  })
  it('rejects collapsed history, altered source oracle and a 200ms frame gap', () => {
    const changed = report()
    changed.liveOld = changed.liveUpdated
    expect(validateReplayReceipt(changed).passed).toBe(false)
    const sourceChanged = report()
    sourceChanged.source.initialGeometry = sourceChanged.source.updatedGeometry
    expect(validateReplayReceipt(sourceChanged).passed).toBe(false)
    expect(validateReplayReceipt({ ...report(), maximumFrameGapMs: 200 }).passed).toBe(false)
  })
  it('rejects an unrepresentative responsiveness sample even when the maximum gap is low', () => {
    expect(validateReplayReceipt({ ...report(), frameCount: 2 }).passed).toBe(false)
    expect(validateReplayReceipt({ ...report(), measurementDurationMs: 100 }).passed).toBe(false)
  })
})
