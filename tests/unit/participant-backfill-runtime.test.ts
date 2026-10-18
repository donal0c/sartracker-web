import { describe, expect, it, vi } from 'vitest'

import { runParticipantBackfillPass } from '../../src/features/participants/participant-backfill-runtime'
import type { ParticipantBackfillCheckpoint } from '../../src/infrastructure/mission-store/tauri-mission-store'

const CHECKPOINT: ParticipantBackfillCheckpoint = {
  mission_id: 'mission-1',
  traccar_device_id: 'device-1',
  window_from: '2026-08-23T00:00:00.000Z',
  window_to: '2026-08-23T05:00:00.000Z',
  reconciled_until: '2026-08-23T00:00:00.000Z',
  completed: 0,
  updated_at: '2026-08-23T05:00:00.000Z',
}

describe('participant backfill runtime [DON-271]', () => {
  it('settles mixed-row rejection evidence before advancing a complete checkpoint [DON-267] [SAR-QA-021]', async () => {
    const accepted = position('2026-08-23T01:00:00.000Z')
    const rejection = {
      deviceId: 'device-1',
      reason: 'invalid_timestamp' as const,
      rowIndex: 1,
      anomalyKey: 'source:missing-fix-time',
      sourcePositionId: 'missing-fix-time',
      canonicalEvidence: { source_position_id: 'missing-fix-time', device_id: 'device-1' },
    }
    const lifecycle: string[] = []

    await runParticipantBackfillPass({
      checkpoint: { ...CHECKPOINT, window_to: '2026-08-23T02:00:00.000Z' },
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({
        accepted: [accepted],
        rejected: [rejection],
      }),
      recordRejections: vi.fn(async () => {
        lifecycle.push('rejection-durable')
      }),
      persistChunk: vi.fn(async () => {
        lifecycle.push('position-durable')
      }),
      updateCheckpoint: vi.fn(async (input) => {
        expect(input.completed).toBe(true)
        lifecycle.push('checkpoint-complete')
      }),
    })

    expect(lifecycle).toEqual([
      'rejection-durable',
      'position-durable',
      'checkpoint-complete',
    ])
  })

  it('advances only one bounded two-hour chunk and preserves the fixed window edges', async () => {
    const getBreadcrumbsWithReport = vi.fn().mockResolvedValue({
      accepted: [position('2026-08-23T01:00:00.000Z')],
      rejected: [],
    })
    const persistChunk = vi.fn().mockResolvedValue(undefined)
    const updateCheckpoint = vi.fn().mockResolvedValue(undefined)

    await runParticipantBackfillPass({
      checkpoint: CHECKPOINT,
      getBreadcrumbsWithReport,
      persistChunk,
      updateCheckpoint,
    })

    expect(getBreadcrumbsWithReport).toHaveBeenCalledWith(
      'device-1',
      new Date('2026-08-23T00:00:00.000Z'),
      new Date('2026-08-23T02:00:00.000Z'),
      undefined,
    )
    expect(updateCheckpoint).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      traccar_device_id: 'device-1',
      window_from: CHECKPOINT.window_from,
      window_to: CHECKPOINT.window_to,
      reconciled_until: '2026-08-23T02:00:00.000Z',
      completed: false,
    })
  })

  it('resumes from reconciled_until and completes only at the immutable upper edge', async () => {
    const checkpoint = {
      ...CHECKPOINT,
      reconciled_until: '2026-08-23T04:00:00.000Z',
    }
    const updateCheckpoint = vi.fn().mockResolvedValue(undefined)

    await runParticipantBackfillPass({
      checkpoint,
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({ accepted: [], rejected: [] }),
      persistChunk: vi.fn().mockResolvedValue(undefined),
      updateCheckpoint,
    })

    expect(updateCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      window_from: CHECKPOINT.window_from,
      window_to: CHECKPOINT.window_to,
      reconciled_until: CHECKPOINT.window_to,
      completed: true,
    }))
  })

  it('does not advance the checkpoint when persistence fails', async () => {
    const updateCheckpoint = vi.fn()
    await expect(runParticipantBackfillPass({
      checkpoint: CHECKPOINT,
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({
        accepted: [position('2026-08-23T01:00:00.000Z')],
        rejected: [],
      }),
      persistChunk: vi.fn().mockRejectedValue(new Error('store unavailable')),
      updateCheckpoint,
    })).rejects.toThrow('store unavailable')
    expect(updateCheckpoint).not.toHaveBeenCalled()
  })

  it('writes a full two-hour window in ordered store calls of at most 256 fixes [DON-313]', async () => {
    // A 1 Hz tracker fills the two-hour chunk with 7,200 fixes. One store call
    // is one synchronous SQLite transaction on the Electron main thread.
    const accepted = oneHertzPositions('2026-08-23T00:00:01.000Z', 7_200)
    const persistChunk = vi.fn().mockResolvedValue(undefined)
    const updateCheckpoint = vi.fn().mockResolvedValue(undefined)

    await runParticipantBackfillPass({
      checkpoint: CHECKPOINT,
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({ accepted, rejected: [] }),
      persistChunk,
      updateCheckpoint,
    })

    const calls = persistChunk.mock.calls.map(([input]) => input as {
      positions: readonly { source_position_id: string }[]
      checkpoints: readonly unknown[]
    })
    expect(calls).toHaveLength(Math.ceil(7_200 / 256))
    for (const call of calls) {
      expect(call.positions.length).toBeLessThanOrEqual(256)
      expect(call.checkpoints).toEqual([])
    }
    expect(calls.flatMap((call) => call.positions.map((p) => p.source_position_id)))
      .toEqual(accepted.map((p) => p.id))
    expect(updateCheckpoint).toHaveBeenCalledOnce()
    expect(updateCheckpoint.mock.invocationCallOrder[0])
      .toBeGreaterThan(persistChunk.mock.invocationCallOrder.at(-1)!)
  })

  it('leaves the checkpoint unmoved when a later piece fails, so the whole chunk is retried [DON-313]', async () => {
    const updateCheckpoint = vi.fn()
    const persistChunk = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk busy'))
    await expect(runParticipantBackfillPass({
      checkpoint: CHECKPOINT,
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({
        accepted: oneHertzPositions('2026-08-23T00:00:01.000Z', 1_000),
        rejected: [],
      }),
      persistChunk,
      updateCheckpoint,
    })).rejects.toThrow('disk busy')
    expect(persistChunk).toHaveBeenCalledTimes(2)
    expect(updateCheckpoint).not.toHaveBeenCalled()
  })

  it('filters any provider rows outside the fixed chunk before persistence', async () => {
    const persistChunk = vi.fn().mockResolvedValue(undefined)
    await runParticipantBackfillPass({
      checkpoint: CHECKPOINT,
      getBreadcrumbsWithReport: vi.fn().mockResolvedValue({
        accepted: [
          position('2026-08-22T23:59:59.000Z'),
          position('2026-08-23T01:00:00.000Z'),
          position('2026-08-23T02:00:01.000Z'),
        ],
        rejected: [],
      }),
      persistChunk,
      updateCheckpoint: vi.fn().mockResolvedValue(undefined),
    })
    expect(persistChunk.mock.calls[0]?.[0].positions).toEqual([
      expect.objectContaining({
        source_position_id: '2026-08-23T01:00:00.000Z',
        timestamp: '2026-08-23T01:00:00.000Z',
      }),
    ])
  })
})

/** Creates consecutive one-second fixes starting at the given instant. */
function oneHertzPositions(firstTimestamp: string, count: number) {
  const first = Date.parse(firstTimestamp)
  return Array.from({ length: count }, (_, index) =>
    position(new Date(first + index * 1_000).toISOString()))
}

function position(timestamp: string) {
  return {
    id: timestamp,
    device_id: 'device-1',
    lat: 52,
    lon: -9,
    altitude: null,
    speed: null,
    battery: null,
    accuracy: null,
    timestamp,
    timestamp_source: 'fix' as const,
    source: 'traccar',
    data_origin: 'live' as const,
    cache_age_seconds: null,
    device_cache_stale: false,
  }
}
