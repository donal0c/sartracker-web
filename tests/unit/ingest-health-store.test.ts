import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyCurrentPositionRejections,
  applyIngestEvidenceHealth,
  useIngestHealthStore,
} from '../../src/features/tracking/ingest-health-store'

describe('current-position ingest health store', () => {
  beforeEach(() => {
    useIngestHealthStore.setState(useIngestHealthStore.getInitialState())
  })

  it('aggregates rejection reasons per device and includes unidentified rows [DON-267]', () => {
    applyCurrentPositionRejections([
      { deviceId: 'device-1', reason: 'invalid_coordinates', rowIndex: 1 },
      { deviceId: 'device-1', reason: 'invalid_timestamp', rowIndex: 2 },
      { deviceId: null, reason: 'invalid_identity', rowIndex: 3 },
    ])

    expect(useIngestHealthStore.getState().summary).toEqual({
      totalRejected: 3,
      affectedDeviceCount: 1,
      unidentifiedRejected: 1,
      byDevice: {
        'device-1': {
          count: 2,
          lastReason: 'invalid_timestamp',
        },
      },
    })
  })

  it('clears rejection warnings after a clean current-position poll [DON-267]', () => {
    applyCurrentPositionRejections([
      { deviceId: 'device-1', reason: 'invalid_coordinates', rowIndex: 1 },
    ])
    applyCurrentPositionRejections([])

    expect(useIngestHealthStore.getState().summary.totalRejected).toBe(0)
    expect(useIngestHealthStore.getState().summary.byDevice).toEqual({})
  })

  it('keeps durable evidence health independent from the latest clean poll [DON-268]', () => {
    applyIngestEvidenceHealth({
      state: 'degraded',
      reason: 'projection_failed',
      pendingCount: 1,
      corruptCount: 0,
      conflictCount: 1,
      rejectedCount: 2,
      affectedDeviceCount: 2,
      conflictDeviceIds: ['device-1'],
    })
    applyCurrentPositionRejections([])

    expect(useIngestHealthStore.getState().evidenceHealth).toMatchObject({
      state: 'degraded',
      reason: 'projection_failed',
      pendingCount: 1,
      conflictDeviceIds: ['device-1'],
    })
  })
})
