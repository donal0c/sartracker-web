import { describe, expect, it, vi } from 'vitest'
import { persistHistoryChunkGroups } from '../../src/features/tracking/persist-history-chunk-groups'
import type { TrackingHistoryChunkPersistenceInput } from '../../src/features/tracking/polling-manager'

/** Creates complete chunks whose object identity also identifies their checkpoint. */
function chunk(deviceId: string, rows: number): TrackingHistoryChunkPersistenceInput {
  return {
    phase: 'initial', expectedMissionId: 'mission-1', deviceId,
    historyFrom: '2026-04-06T00:00:00.000Z',
    reconciledUntil: '2026-04-06T02:00:00.000Z',
    positions: Array.from({ length: rows }, (_, index) => ({
      id: `${deviceId}-${index}`, device_id: deviceId, lat: 53, lon: -7,
      altitude: null, speed: null, battery: null, accuracy: null,
      timestamp: '2026-04-06T01:00:00.000Z', source: null,
      data_origin: 'live', cache_age_seconds: null, device_cache_stale: false,
    })),
  }
}

/** Holds one admission without using elapsed-time assertions. */
function deferred() {
  let resolve = () => undefined as void
  const promise = new Promise<void>((settle) => { resolve = settle })
  return { promise, resolve }
}

describe('persistHistoryChunkGroups', () => {
  it('admits eight complete chunks as two 900-row groups, acknowledging before the between-group yield', async () => {
    const inputs = Array.from({ length: 8 }, (_, index) => chunk(String(index), 225))
    const first = deferred()
    const yieldGate = deferred()
    const onAcknowledged = vi.fn()
    const persistGroup = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined)
    const yieldBetweenGroups = vi.fn(() => {
      expect(onAcknowledged.mock.calls.map((call) => call[1])).toEqual([0, 1, 2, 3])
      return yieldGate.promise
    })
    const operation = persistHistoryChunkGroups({ inputs, persistGroup, onAcknowledged, yieldBetweenGroups })
    expect(persistGroup).toHaveBeenCalledExactlyOnceWith(inputs.slice(0, 4))
    expect(onAcknowledged).not.toHaveBeenCalled()
    expect(yieldBetweenGroups).not.toHaveBeenCalled()
    first.resolve()
    await vi.waitFor(() => expect(yieldBetweenGroups).toHaveBeenCalledOnce())
    expect(persistGroup).toHaveBeenCalledOnce()
    yieldGate.resolve()
    await expect(operation).resolves.toEqual(inputs.map(() => ({ status: 'fulfilled', value: undefined })))
    expect(persistGroup.mock.calls).toEqual([[inputs.slice(0, 4)], [inputs.slice(4)]])
    expect(onAcknowledged.mock.calls).toEqual(inputs.map((input, index) => [input, index, null]))
    expect(yieldBetweenGroups).toHaveBeenCalledOnce()
  })

  it('keeps four inclusive two-hour medium-rate fixture chunks in one transaction', async () => {
    const inputs = Array.from({ length: 4 }, (_, index) => chunk(String(index + 9), 241))
    const persistGroup = vi.fn().mockResolvedValue(undefined)
    const onAcknowledged = vi.fn()
    const yieldBetweenGroups = vi.fn().mockResolvedValue(undefined)
    await expect(persistHistoryChunkGroups({ inputs, persistGroup, onAcknowledged, yieldBetweenGroups }))
      .resolves.toEqual(inputs.map(() => ({ status: 'fulfilled', value: undefined })))
    expect(persistGroup).toHaveBeenCalledExactlyOnceWith(inputs)
    expect(onAcknowledged.mock.calls).toEqual(inputs.map((input, index) => [input, index, null]))
    expect(yieldBetweenGroups).not.toHaveBeenCalled()
  })

  it('retains empty checkpoints and an oversized singleton without splitting or reordering', async () => {
    const inputs = [chunk('empty-first', 0), chunk('large', 1025), chunk('empty-last', 0), chunk('last', 1)]
    const persistGroup = vi.fn().mockResolvedValue(undefined)
    const onAcknowledged = vi.fn()
    const yieldBetweenGroups = vi.fn().mockResolvedValue(undefined)
    await persistHistoryChunkGroups({ inputs, persistGroup, onAcknowledged, yieldBetweenGroups })
    expect(persistGroup.mock.calls).toEqual([[[inputs[0]]], [[inputs[1]]], [inputs.slice(2)]])
    expect(onAcknowledged.mock.calls).toEqual(inputs.map((input, index) => [input, index, null]))
    expect(yieldBetweenGroups).toHaveBeenCalledTimes(2)
  })

  it('does no work for no chunks and persists an all-empty wave once', async () => {
    const persistGroup = vi.fn().mockResolvedValue(undefined)
    const onAcknowledged = vi.fn()
    const yieldBetweenGroups = vi.fn().mockResolvedValue(undefined)
    const options = { persistGroup, onAcknowledged, yieldBetweenGroups }
    await expect(persistHistoryChunkGroups({ ...options, inputs: [] })).resolves.toEqual([])
    expect(persistGroup).not.toHaveBeenCalled()
    const inputs = [chunk('a', 0), chunk('b', 0)]
    await persistHistoryChunkGroups({ ...options, inputs })
    expect(persistGroup).toHaveBeenCalledExactlyOnceWith(inputs)
    expect(onAcknowledged).toHaveBeenCalledTimes(2)
    expect(yieldBetweenGroups).not.toHaveBeenCalled()
  })

  it('falls back in parallel only within the failed group and retains results by original index', async () => {
    const inputs = [chunk('a', 900), chunk('b', 450), chunk('c', 450), chunk('d', 225)]
    const firstFallback = deferred()
    const failure = new Error('one chunk rejected')
    const persistGroup = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('group rejected')).mockResolvedValue(undefined)
    const persistChunk = vi.fn((input: TrackingHistoryChunkPersistenceInput) => input === inputs[1]
      ? firstFallback.promise.then(() => ({ changed: true }))
      : Promise.reject(failure))
    const onAcknowledged = vi.fn()
    const operation = persistHistoryChunkGroups({ inputs, persistGroup, persistChunk, onAcknowledged,
      yieldBetweenGroups: async () => undefined })
    await vi.waitFor(() => expect(persistChunk).toHaveBeenCalledTimes(2))
    expect(persistChunk.mock.calls).toEqual([[inputs[1]], [inputs[2]]])
    expect(persistGroup).toHaveBeenCalledTimes(2)
    firstFallback.resolve()
    await expect(operation).resolves.toEqual([
      { status: 'fulfilled', value: undefined }, { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: failure }, { status: 'fulfilled', value: undefined },
    ])
    expect(onAcknowledged.mock.calls).toEqual([
      [inputs[0], 0, null], [inputs[1], 1, { changed: true }], [inputs[3], 3, null],
    ])
    expect(persistGroup).toHaveBeenCalledTimes(3)
  })

  it('uses singleton batch fallback only for a failed multi-chunk group without a singular hook', async () => {
    const inputs = [chunk('a', 450), chunk('b', 450), chunk('c', 1025)]
    const failure = new Error('singleton rejected')
    const persistGroup = vi.fn().mockRejectedValueOnce(new Error('group rejected'))
      .mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure).mockRejectedValueOnce(failure)
    const onAcknowledged = vi.fn()
    const results = await persistHistoryChunkGroups({ inputs, persistGroup, onAcknowledged,
      yieldBetweenGroups: async () => undefined })
    expect(persistGroup.mock.calls).toEqual([[inputs.slice(0, 2)], [[inputs[0]]], [[inputs[1]]], [[inputs[2]]]])
    expect(results).toEqual([{ status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: failure }, { status: 'rejected', reason: failure }])
    expect(onAcknowledged).toHaveBeenCalledExactlyOnceWith(inputs[0], 0, null)
  })

  it('does not repeat durable writes when acknowledgement publication throws', async () => {
    const inputs = [chunk('a', 1), chunk('b', 1)]
    const failure = new Error('publication failed')
    const persistGroup = vi.fn().mockResolvedValue(undefined)
    const persistChunk = vi.fn()
    const onAcknowledged = vi.fn().mockImplementationOnce(() => { throw failure })
    await expect(persistHistoryChunkGroups({ inputs, persistGroup, persistChunk, onAcknowledged,
      yieldBetweenGroups: async () => undefined })).resolves.toEqual([
      { status: 'rejected', reason: failure }, { status: 'fulfilled', value: undefined },
    ])
    expect(persistGroup).toHaveBeenCalledOnce()
    expect(persistChunk).not.toHaveBeenCalled()
    expect(onAcknowledged).toHaveBeenCalledTimes(2)
  })
})
