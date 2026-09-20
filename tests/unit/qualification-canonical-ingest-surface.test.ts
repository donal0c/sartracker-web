// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createAttentionScenario } from '../../scripts/qualification/attention-server.mjs'
import { validateCanonicalIngestSurface } from '../../scripts/qualification/canonical-ingest-receipts.mjs'

describe('packaged canonical ingest source oracle', () => {
  it('requires exact source fixTime and rejects server-time substitution, duplicate and lost rows', () => {
    const source = createAttentionScenario(1800000000000)
    const rows = [...source.stationary, source.stale].map(row => ({ source_position_id: String(row.id),
      device_id: String(row.deviceId), lat: row.latitude, lon: row.longitude, timestamp: row.fixTime,
      timestamp_source: 'fix', data_origin: 'live', source_kind: 'traccar' }))
    const facts = { source, durableBeforeAck: rows, durableAfterAck: rows, sourcePollsBeforeAck: 2, sourcePollsAfterAck: 3 }
    expect(validateCanonicalIngestSurface(facts).passed).toBe(true)
    expect(() => validateCanonicalIngestSurface({ ...facts, sourcePollsAfterAck: 2 })).toThrow(/repeated provider poll/)
    expect(() => validateCanonicalIngestSurface({ ...facts, durableAfterAck: rows.slice(1) })).toThrow()
    expect(() => validateCanonicalIngestSurface({ ...facts, durableBeforeAck: [...rows, rows[0]] })).toThrow()
    const changed = structuredClone(facts)
    changed.durableAfterAck[0].timestamp = source.stationary[0].serverTime
    expect(() => validateCanonicalIngestSurface(changed)).toThrow()
  })
})
