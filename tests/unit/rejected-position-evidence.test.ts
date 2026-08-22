import { describe, expect, it } from 'vitest'

import {
  REJECTED_POSITION_EVIDENCE_MAX_BYTES_HYPOTHESIS,
  createRejectedPositionEvidence,
} from '../../src/features/tracking/rejected-position-evidence'

describe('rejected position canonical evidence [DON-268]', () => {
  it('keys a rejection by exact source identity when one is available', () => {
    const result = createRejectedPositionEvidence({
      id: 123,
      deviceId: 44,
      latitude: 'not-a-coordinate',
      longitude: -9.5,
      fixTime: '2026-08-22T10:00:00Z',
    })

    expect(result.sourcePositionId).toBe('123')
    expect(result.anomalyKey).toBe('source:123')
    expect(result.canonicalEvidence).toMatchObject({
      source_position_id: '123',
      device_id: '44',
      latitude: 'not-a-coordinate',
      longitude: -9.5,
      fix_time: '2026-08-22T10:00:00Z',
    })
  })

  it('uses order-independent deterministic content identity without a source id', () => {
    const first = createRejectedPositionEvidence({
      latitude: 52,
      longitude: -9,
      attributes: { alarm: 'test', batteryLevel: 50 },
    })
    const reordered = createRejectedPositionEvidence({
      attributes: { batteryLevel: 50, alarm: 'test' },
      longitude: -9,
      latitude: 52,
    })

    expect(reordered.anomalyKey).toBe(first.anomalyKey)
    expect(first.anomalyKey).toMatch(/^content:[a-f0-9]{16}$/u)
  })

  it('bounds retained canonical evidence while still fingerprinting the whole parsed row', () => {
    const huge = 'x'.repeat(REJECTED_POSITION_EVIDENCE_MAX_BYTES_HYPOTHESIS * 4)
    const result = createRejectedPositionEvidence({
      latitude: huge,
      longitude: -9,
    })

    const serialized = JSON.stringify(result.canonicalEvidence)
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      REJECTED_POSITION_EVIDENCE_MAX_BYTES_HYPOTHESIS,
    )
    expect(serialized).not.toContain(huge)
    expect(result.anomalyKey).toMatch(/^content:[a-f0-9]{16}$/u)
  })
})
