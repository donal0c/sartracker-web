import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateReplayReceipt } from '../../scripts/qualification/replay-receipts.mjs'
import { createReplayGeometryFixture } from '../../scripts/qualification/replay-probe-fixture.mjs'

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
    maximumFrameGapMs: 20, popupText: 'Large retained search area', popupColor: 'rgb(28, 25, 23)' }
}

describe('retained packaged replay oracle', () => {
  it('passes exact host-generated fixture bytes across the renderer boundary', () => {
    const expected = report().source
    expect(createReplayGeometryFixture()).toEqual({
      initialGeometry: expected.initialGeometry, updatedGeometry: expected.updatedGeometry,
    })
  })
  it('recomputes both known-at-time geometries and live/archive equality', () => {
    expect(validateReplayReceipt(report())).toMatchObject({ passed: true, status: 'PASS' })
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
})
