import { describe, expect, it, vi } from 'vitest'

import {
  REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS,
  createRejectionEvidenceDelivery,
} from '../../src/features/tracking/rejection-evidence-delivery'
import type { CurrentPositionRejection } from '../../src/features/tracking/ingest-health'

describe('rejection evidence delivery [DON-268]', () => {
  it('publishes current rejection health synchronously and delivers unique evidence asynchronously', async () => {
    const sequence: string[] = []
    const recordIngestRejections = vi.fn(async () => {
      sequence.push('persisted')
      return {
        acknowledgedDeliveryIds: ['delivery-1'],
        health: healthy(),
      }
    })
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        getActiveMission: async () => ({ id: 'mission-1' }),
        recordIngestRejections,
      },
      applyRejections: () => sequence.push('visible'),
      applyEvidenceHealth: vi.fn(),
      createDeliveryId: () => 'delivery-1',
    })
    const rejection = createRejection('source:123')

    delivery.record([rejection, rejection])
    sequence.push('returned')

    expect(sequence.slice(0, 2)).toEqual(['visible', 'returned'])
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(1))
    expect(recordIngestRejections).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      rejections: [expect.objectContaining({
        deliveryId: 'delivery-1',
        anomalyKey: 'source:123',
      })],
    })
  })

  it('keeps unacknowledged unique evidence bounded and retries it on the next poll', async () => {
    const recordIngestRejections = vi
      .fn()
      .mockResolvedValueOnce({ acknowledgedDeliveryIds: [], health: degraded() })
      .mockResolvedValueOnce({ acknowledgedDeliveryIds: ['delivery-1'], health: healthy() })
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        getActiveMission: async () => ({ id: 'mission-1' }),
        recordIngestRejections,
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: () => 'delivery-1',
    })

    delivery.record([createRejection('source:123')])
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(1))
    delivery.record([])
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(2))

    expect(recordIngestRejections.mock.calls[1]?.[0].rejections).toEqual([
      expect.objectContaining({ deliveryId: 'delivery-1' }),
    ])
    expect(applyEvidenceHealth).toHaveBeenLastCalledWith(healthy())
  })

  it('uses one stable delivery identity for repeated retrieval of the same rejection', async () => {
    const calls: string[] = []
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        getActiveMission: async () => ({ id: 'mission-1' }),
        recordIngestRejections: async (input) => {
          calls.push(input.rejections[0]?.deliveryId ?? '')
          return { acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId), health: healthy() }
        },
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
    })

    delivery.record([createRejection('source:123')])
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    delivery.record([createRejection('source:123')])
    await vi.waitFor(() => expect(calls).toHaveLength(2))

    expect(calls[0]).toBe(calls[1])
  })

  it('surfaces the honest memory-overflow boundary instead of silently growing', async () => {
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        getActiveMission: async () => ({ id: 'mission-1' }),
        recordIngestRejections: async () => new Promise(() => undefined),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: (_anomalyKey, index) => `delivery-${index}`,
    })
    const rejections = Array.from(
      { length: REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS + 1 },
      (_, index) => createRejection(`content:${index}`),
    )

    delivery.record(rejections)

    expect(applyEvidenceHealth).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'critical',
        reason: 'renderer_pending_capacity_exhausted',
      }),
    )
  })

  function createRejection(anomalyKey: string): CurrentPositionRejection {
    return {
      deviceId: 'tracker-1',
      reason: 'invalid_coordinates',
      rowIndex: 1,
      anomalyKey,
      sourcePositionId: anomalyKey.startsWith('source:') ? '123' : null,
      canonicalEvidence: {
        content_fingerprint: '0123456789abcdef',
        source_position_id: '123',
        device_id: 'tracker-1',
        latitude: 200,
      },
    }
  }

  function healthy() {
    return {
      state: 'healthy' as const,
      reason: null,
      pendingCount: 0,
      corruptCount: 0,
      conflictCount: 0,
      rejectedCount: 1,
      affectedDeviceCount: 1,
    }
  }

  function degraded() {
    return {
      ...healthy(),
      state: 'degraded' as const,
      reason: 'ledger_projection_failed',
      pendingCount: 1,
    }
  }
})
