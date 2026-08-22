import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  canonicalizeAcceptedPosition,
  classifyPositionIngest,
} = require('../../electron/position-ingest-policy.cjs') as {
  readonly canonicalizeAcceptedPosition: (input: Record<string, unknown>) => {
    readonly payload: Record<string, unknown>
    readonly contentHash: string
  }
  readonly classifyPositionIngest: (input: {
    readonly existing: Record<string, unknown> | undefined
    readonly incoming: Record<string, unknown>
  }) => { readonly decision: 'insert' | 'duplicate' | 'conflict'; readonly contentHash: string }
}

describe('position ingest policy [DON-268]', () => {
  const accepted = {
    source_position_id: 'source-1',
    device_id: 'tracker-1',
    name: 'Tracker One',
    lat: 52.0599,
    lon: -9.5045,
    altitude: 312.5,
    speed: 4.2,
    battery: 83,
    accuracy: 6,
    source: 'osmand',
    timestamp: '2026-08-22T10:00:00.000Z',
  }

  it('classifies an identical repeated source delivery as idempotent', () => {
    const canonical = canonicalizeAcceptedPosition(accepted)

    expect(classifyPositionIngest({
      existing: { ...accepted, content_hash: canonical.contentHash },
      incoming: accepted,
    })).toEqual({
      decision: 'duplicate',
      contentHash: canonical.contentHash,
    })
  })

  it('classifies same source identity with different canonical content as conflict', () => {
    expect(classifyPositionIngest({
      existing: accepted,
      incoming: { ...accepted, lat: 52.5 },
    }).decision).toBe('conflict')
  })

  it('fails closed when a versioned stored hash disagrees with the stored row', () => {
    expect(classifyPositionIngest({
      existing: { ...accepted, content_hash: `v1:${'0'.repeat(64)}` },
      incoming: accepted,
    }).decision).toBe('conflict')
  })

  it('does not treat receipt time or live/history transport origin as source content', () => {
    const first = canonicalizeAcceptedPosition({
      ...accepted,
      received_at: '2026-08-22T10:00:01.000Z',
      data_origin: 'live',
    })
    const repeated = canonicalizeAcceptedPosition({
      ...accepted,
      received_at: '2026-08-22T10:20:01.000Z',
      data_origin: 'cache',
    })

    expect(repeated).toEqual(first)
  })

  it('versions the persisted canonical hash contract', () => {
    expect(canonicalizeAcceptedPosition(accepted).contentHash).toMatch(/^v1:[a-f0-9]{64}$/u)
  })

  it('keeps late and out-of-order valid fixes on the insert path', () => {
    expect(classifyPositionIngest({
      existing: undefined,
      incoming: accepted,
    }).decision).toBe('insert')
  })
})
