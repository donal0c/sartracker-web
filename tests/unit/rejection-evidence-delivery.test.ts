import { describe, expect, it, vi } from 'vitest'

import {
  REJECTION_EVIDENCE_DELIVERY_BATCH_HYPOTHESIS,
  REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS,
  createRejectionEvidenceDelivery,
} from '../../src/features/tracking/rejection-evidence-delivery'
import type { CurrentPositionRejection } from '../../src/features/tracking/ingest-health'

describe('rejection evidence delivery [DON-268]', () => {
  it('seals mission observation acceptance while finalization is in progress', async () => {
    const persisted: string[] = []
    let releaseFinalization: (() => void) | undefined
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: vi.fn(async (input) => {
          persisted.push(...input.rejections.map((entry) => entry.anomalyKey))
          return {
            acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
            health: healthy(),
          }
        }),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
    })
    delivery.record([createRejection('source:before')], observation('mission-1'))

    const finalization = delivery.runWithMissionFinalizationFence(
      'mission-1',
      () => new Promise<string>((resolve) => {
        releaseFinalization = () => resolve('finalized')
      }),
    )
    await vi.waitFor(() => expect(releaseFinalization).toBeTypeOf('function'))
    expect(persisted).toEqual(['source:before'])

    expect(() => delivery.record(
      [createRejection('source:during')],
      observation('mission-1'),
    )).toThrow(/acceptance.*sealed/iu)
    expect(persisted).toEqual(['source:before'])

    releaseFinalization?.()
    await expect(finalization).resolves.toBe('finalized')
  })

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
        recordIngestRejections,
      },
      applyRejections: () => sequence.push('visible'),
      applyEvidenceHealth: vi.fn(),
      createDeliveryId: () => 'delivery-1',
    })
    const rejection = createRejection('source:123')

    delivery.record([rejection, rejection], observation('mission-1'))
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

  it('blocks completeness synchronously while rejected evidence is still renderer-held', async () => {
    let acknowledge: ((value: {
      acknowledgedDeliveryIds: string[]
      health: ReturnType<typeof healthy>
    }) => void) | undefined
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: () => new Promise((resolve) => {
          acknowledge = resolve
        }),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: () => 'delivery-1',
    })

    delivery.record([createRejection('source:pending')], observation('mission-1'))

    expect(applyEvidenceHealth).toHaveBeenCalledWith(expect.objectContaining({
      state: 'degraded',
      reason: 'renderer_evidence_pending',
      pendingCount: 1,
    }))
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf('function'))
    acknowledge?.({ acknowledgedDeliveryIds: ['delivery-1'], health: healthy() })
    await vi.waitFor(() => expect(applyEvidenceHealth).toHaveBeenLastCalledWith(healthy()))
  })

  it('never downgrades an existing critical evidence failure while renderer evidence is pending', () => {
    const criticalHealth = {
      ...healthy(),
      state: 'critical' as const,
      reason: 'outbox_corrupt_record',
      corruptCount: 1,
    }
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: async () => new Promise(() => undefined),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      readEvidenceHealth: () => criticalHealth,
    })

    delivery.record([createRejection('source:pending')], observation('mission-1'))

    expect(applyEvidenceHealth).toHaveBeenCalledWith(expect.objectContaining({
      state: 'critical',
      reason: 'outbox_corrupt_record',
      corruptCount: 1,
      pendingCount: 1,
    }))
  })

  it('does not let one mission acknowledgement clear another mission pending warning', async () => {
    const acknowledgements = new Map<string, (value: {
      acknowledgedDeliveryIds: string[]
      health: ReturnType<typeof healthy>
    }) => void>()
    const recordIngestRejections = vi.fn((input: {
      readonly mission_id: string
      readonly rejections: readonly { readonly deliveryId: string }[]
    }) => new Promise<{
      acknowledgedDeliveryIds: string[]
      health: ReturnType<typeof healthy>
    }>((resolve) => {
      acknowledgements.set(input.mission_id, resolve)
    }))
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: { recordIngestRejections },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: (missionId) => `delivery-${missionId}`,
    })

    delivery.record([createRejection('source:a')], observation('mission-a'))
    await vi.waitFor(() => expect(acknowledgements.has('mission-a')).toBe(true))
    delivery.record([createRejection('source:b')], observation('mission-b'))
    acknowledgements.get('mission-a')?.({
      acknowledgedDeliveryIds: ['delivery-mission-a'],
      health: healthy(),
    })
    await vi.waitFor(() => expect(acknowledgements.has('mission-b')).toBe(true))

    expect(applyEvidenceHealth).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'degraded',
      reason: 'renderer_evidence_pending',
      pendingCount: 1,
    }))

    acknowledgements.get('mission-b')?.({
      acknowledgedDeliveryIds: ['delivery-mission-b'],
      health: healthy(),
    })
  })

  it('does not let one mission healthy ACK clear another mission durable critical health', async () => {
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: vi.fn(async (input) => ({
          acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
          health: input.mission_id === 'mission-b'
            ? {
                ...healthy(),
                state: 'critical' as const,
                reason: 'outbox_corrupt_record',
                corruptCount: 1,
              }
            : healthy(),
        })),
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: (missionId) => `delivery-${missionId}`,
    })

    delivery.record([createRejection('source:b')], observation('mission-b'))
    await delivery.flushMission('mission-b')
    expect(applyEvidenceHealth).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'critical', reason: 'outbox_corrupt_record', corruptCount: 1,
    }))

    delivery.record([createRejection('source:a')], observation('mission-a'))
    await delivery.flushMission('mission-a')

    expect(applyEvidenceHealth).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'critical', reason: 'outbox_corrupt_record', corruptCount: 1,
    }))
  })

  it('keeps unacknowledged unique evidence bounded and retries it on the next poll', async () => {
    const recordIngestRejections = vi
      .fn()
      .mockResolvedValueOnce({ acknowledgedDeliveryIds: [], health: degraded() })
      .mockResolvedValueOnce({ acknowledgedDeliveryIds: ['delivery-1'], health: healthy() })
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections,
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
      createDeliveryId: () => 'delivery-1',
    })

    delivery.record([createRejection('source:123')], observation('mission-1'))
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(1))
    delivery.record([], observation('mission-1'))
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
        recordIngestRejections: async (input) => {
          calls.push(input.rejections[0]?.deliveryId ?? '')
          return { acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId), health: healthy() }
        },
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
    })

    delivery.record([createRejection('source:123')], observation('mission-1'))
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    delivery.record([createRejection('source:123')], observation('mission-1'))
    await vi.waitFor(() => expect(calls).toHaveLength(2))

    expect(calls[0]).toBe(calls[1])
  })

  it('delivers a unique-evidence storm in bounded batches without dropping records', async () => {
    const deliveredIds: string[] = []
    const recordIngestRejections = vi.fn(async (input: {
      readonly rejections: readonly { readonly deliveryId: string }[]
    }) => {
      deliveredIds.push(...input.rejections.map((entry) => entry.deliveryId))
      return {
        acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
        health: healthy(),
      }
    })
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections,
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
      createDeliveryId: (_missionId, _anomalyKey, index) => `delivery-${index}`,
    })
    const rejections = Array.from(
      { length: REJECTION_EVIDENCE_DELIVERY_BATCH_HYPOTHESIS + 1 },
      (_, index) => createRejection(`content:${index}`),
    )

    delivery.record(rejections, observation('mission-1'))

    await vi.waitFor(() => expect(deliveredIds).toHaveLength(rejections.length))
    expect(recordIngestRejections.mock.calls.every(
      ([input]) => input.rejections.length <= REJECTION_EVIDENCE_DELIVERY_BATCH_HYPOTHESIS,
    )).toBe(true)
  })

  it('bounds renderer memory and durably marks evidence loss before refusing overflow', async () => {
    const recordIngestEvidenceLoss = vi.fn().mockResolvedValue({
      ...healthy(),
      state: 'critical',
      reason: 'renderer_pending_capacity_exhausted',
    })
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: async () => new Promise(() => undefined),
        recordIngestEvidenceLoss,
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
    })
    const rejections = Array.from(
      { length: REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS + 1 },
      (_unused, index) => createRejection(`content:${index}`),
    )

    delivery.record(rejections, observation('mission-1'))

    await vi.waitFor(() => expect(recordIngestEvidenceLoss).toHaveBeenCalledWith({
      mission_id: 'mission-1',
      reason: 'renderer_pending_capacity_exhausted',
    }))
    expect(applyEvidenceHealth).toHaveBeenCalledWith(expect.objectContaining({
      state: 'critical',
      reason: 'renderer_pending_capacity_exhausted',
      pendingCount: REJECTION_EVIDENCE_PENDING_MEMORY_CAP_HYPOTHESIS,
    }))
  })

  it('captures mission identity at observation time and never cross-deduplicates missions', async () => {
    const calls: Array<{ readonly mission_id: string; readonly deliveryId: string }> = []
    const delivery = createRejectionEvidenceDelivery({
      missionStore: {
        recordIngestRejections: async (input) => {
          calls.push({
            mission_id: input.mission_id,
            deliveryId: input.rejections[0]?.deliveryId ?? '',
          })
          return {
            acknowledgedDeliveryIds: input.rejections.map((entry) => entry.deliveryId),
            health: healthy(),
          }
        },
      },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
    })
    const rejection = createRejection('source:123')

    delivery.record([rejection], observation('mission-a'))
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    delivery.record([rejection], observation('mission-b'))
    await vi.waitFor(() => expect(calls).toHaveLength(2))

    expect(calls.map((call) => call.mission_id)).toEqual(['mission-a', 'mission-b'])
    expect(calls[0]?.deliveryId).not.toBe(calls[1]?.deliveryId)
  })

  it('backs off when an acknowledgement does not match pending evidence', async () => {
    const retryCallbacks: Array<() => void> = []
    const recordIngestRejections = vi.fn().mockResolvedValue({
      acknowledgedDeliveryIds: ['unknown-delivery'],
      health: healthy(),
    })
    const delivery = createRejectionEvidenceDelivery({
      missionStore: { recordIngestRejections },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
      setTimeout: ((callback: () => void) => {
        retryCallbacks.push(callback)
        return 1
      }) as unknown as typeof globalThis.setTimeout,
      clearTimeout: vi.fn(),
    })

    delivery.record([createRejection('source:123')], observation('mission-1'))
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledTimes(1))

    await vi.waitFor(() => expect(retryCallbacks).toHaveLength(1))
    await Promise.resolve()
    expect(recordIngestRejections).toHaveBeenCalledTimes(1)
  })

  it('does not claim mission completeness is blocked for pre-mission polling rejections', () => {
    const applyEvidenceHealth = vi.fn()
    const delivery = createRejectionEvidenceDelivery({
      missionStore: { recordIngestRejections: vi.fn() },
      applyRejections: vi.fn(),
      applyEvidenceHealth,
    })

    delivery.record([createRejection('source:123')], {
      missionId: null,
      observedAt: '2026-08-22T10:00:00.000Z',
    })

    expect(applyEvidenceHealth).not.toHaveBeenCalled()
  })

  it('drains renderer-held evidence before disposal completes', async () => {
    let resolveDelivery: ((value: {
      acknowledgedDeliveryIds: string[]
      health: ReturnType<typeof healthy>
    }) => void) | undefined
    const recordIngestRejections = vi.fn(() => new Promise<{
      acknowledgedDeliveryIds: string[]
      health: ReturnType<typeof healthy>
    }>((resolve) => {
      resolveDelivery = resolve
    }))
    const delivery = createRejectionEvidenceDelivery({
      missionStore: { recordIngestRejections },
      applyRejections: vi.fn(),
      applyEvidenceHealth: vi.fn(),
      createDeliveryId: () => 'delivery-1',
    })

    delivery.record([createRejection('source:123')], observation('mission-1'))
    await vi.waitFor(() => expect(recordIngestRejections).toHaveBeenCalledOnce())
    const disposal = delivery.dispose()
    let disposed = false
    void disposal.then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)

    resolveDelivery?.({ acknowledgedDeliveryIds: ['delivery-1'], health: healthy() })
    await expect(disposal).resolves.toBeUndefined()
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

  function observation(missionId: string) {
    return {
      missionId,
      observedAt: '2026-08-22T10:00:00.000Z',
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
      conflictDeviceIds: [],
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
