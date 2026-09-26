import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getBrowserHarnessStore, readBrowserHarnessState, resetBrowserHarnessStore } from '../../src/features/browser-validation/browser-harness-store'

const start = '2026-09-26T08:00:00.000Z'
const end = '2026-09-26T09:00:00.000Z'

describe('browser testing history persistence', () => {
  beforeEach(() => resetBrowserHarnessStore())
  afterEach(() => vi.restoreAllMocks())

  it('records a request before admission, survives reload, and never supplies a durable restart frontier', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Browser history' })
    await store.persistTrackingHistoryBatch({ mission_id: mission.id, positions: [], checkpoints: [],
      requests: [{ device_id: '1', history_from: start, requested_until: end }] })
    resetBrowserHarnessStore(false)
    expect(readBrowserHarnessState().trackingHistoryReceipts).toEqual([
      { mission_id: mission.id, device_id: '1', requested_from: start, requested_until: end },
    ])
    expect(getBrowserHarnessStore()).not.toHaveProperty('listTrackingHistoryCheckpoints')
  })

  it('commits a chunk and its receipt in one write while retaining the existing 2000-row cap', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Browser bounded history' })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    write.mockClear()
    const positions = await store.persistTrackingHistoryBatch({ mission_id: mission.id,
      positions: Array.from({ length: 2100 }, (_, index) => ({ device_id: '1', lat: 52, lon: -9,
        timestamp: new Date(Date.parse(start) + index * 1000).toISOString(), timestamp_source: 'fix' as const })),
      checkpoints: [{ device_id: '1', history_from: start, reconciled_from: start, reconciled_until: end }],
    })
    expect(positions).toHaveLength(2100)
    expect(write).toHaveBeenCalledTimes(1)
    resetBrowserHarnessStore(false)
    expect(readBrowserHarnessState().positions).toHaveLength(2000)
    expect(readBrowserHarnessState().trackingHistoryReceipts?.[0]).toMatchObject({
      last_acknowledged_chunk: { history_from: start, reconciled_from: start, reconciled_until: end },
    })
    expect(getBrowserHarnessStore()).not.toHaveProperty('listTrackingHistoryCheckpoints')
  })

  it.each(['QuotaExceededError', 'SecurityError'])('rejects %s without acknowledging or changing memory or stored state', async (name) => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Browser failed history' })
    const before = readBrowserHarnessState()
    const saved = window.sessionStorage.getItem('sartracker:browser-harness')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Storage unavailable', name) })
    await expect(store.persistTrackingHistoryBatch({ mission_id: mission.id,
      positions: [{ device_id: '1', lat: 52, lon: -9, timestamp: start }],
      checkpoints: [{ device_id: '1', history_from: start, reconciled_until: end }],
      requests: [{ device_id: '1', history_from: start, requested_until: end }],
    })).rejects.toThrow('Storage unavailable')
    expect(readBrowserHarnessState()).toEqual(before)
    await expect(store.listPositions(mission.id)).resolves.toEqual([])
    expect(window.sessionStorage.getItem('sartracker:browser-harness')).toBe(saved)
  })

  it('commits the existing 500-row emergency cap only after the quota retry succeeds', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Browser emergency retention' })
    const write = vi.spyOn(Storage.prototype, 'setItem')
    write.mockImplementationOnce(() => { throw new DOMException('Storage full', 'QuotaExceededError') })
    await store.persistTrackingHistoryBatch({ mission_id: mission.id,
      positions: Array.from({ length: 600 }, (_, index) => ({ device_id: '1', lat: 52, lon: -9,
        timestamp: new Date(Date.parse(start) + index * 1000).toISOString() })),
      checkpoints: [], requests: [{ device_id: '1', history_from: start, requested_until: end }],
    })
    expect(write).toHaveBeenCalledTimes(2)
    expect(readBrowserHarnessState().positions).toHaveLength(500)
    await expect(store.listPositions(mission.id)).resolves.toHaveLength(500)
    resetBrowserHarnessStore(false)
    expect(readBrowserHarnessState().positions).toHaveLength(500)
    expect(readBrowserHarnessState().trackingHistoryReceipts?.[0]?.requested_until).toBe(end)
  })

  it('rejects invalid metadata atomically and keeps request bounds monotonic', async () => {
    const store = getBrowserHarnessStore()
    const mission = await store.createMission({ name: 'Browser metadata' })
    const request = { device_id: '1', history_from: start, requested_until: end }
    await store.persistTrackingHistoryBatch({ mission_id: mission.id, positions: [], checkpoints: [], requests: [request] })
    await store.persistTrackingHistoryBatch({ mission_id: mission.id, positions: [], checkpoints: [],
      requests: [{ ...request, history_from: '2026-09-26T08:30:00.000Z' }] })
    expect(readBrowserHarnessState().trackingHistoryReceipts?.[0]?.requested_from).toBe(start)
    const before = readBrowserHarnessState()
    await expect(store.persistTrackingHistoryBatch({ mission_id: mission.id, positions: [], checkpoints: [],
      requests: [{ ...request, requested_until: 'invalid' }] })).rejects.toThrow()
    expect(readBrowserHarnessState()).toEqual(before)
  })

  it.each(['2026-02-30T08:00:00.000Z', '2026-09-26T08:00:00', '2026-09-26'])(
    'rejects ambiguous or impossible history time %s before storage', async (invalidTime) => {
      const store = getBrowserHarnessStore()
      const mission = await store.createMission({ name: 'Browser strict receipt time' })
      const write = vi.spyOn(Storage.prototype, 'setItem')
      await expect(store.persistTrackingHistoryBatch({ mission_id: mission.id, positions: [], checkpoints: [],
        requests: [{ device_id: '1', history_from: invalidTime, requested_until: end }],
      })).rejects.toThrow()
      expect(write).not.toHaveBeenCalled()
    },
  )
})
