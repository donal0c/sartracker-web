import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearTrackingPollLedger,
  flushTrackingPollLedger,
  readTrackingPollLedger,
  recordTrackingPollLedgerEntry,
  TRACKING_POLL_LEDGER_FLUSH_DELAY_MS,
  TRACKING_POLL_LEDGER_MAX_ENTRIES,
  type TrackingPollLedgerEntry,
} from '../../src/features/diagnostics/tracking-poll-ledger'

// DON-367: in the packaged soak's second launch the renderer spent about 60%
// of its CPU after minute 6 inside recordTrackingPollLedgerEntry. Every poll
// and re-check diagnostic re-read the whole session ledger, re-validated every
// retained entry including each re-check backlog range, and wrote it all back.
// Once the 5-minute re-check started, each reconciliation entry carried a range
// per device, the ledger grew to megabytes, and the history transport starved.
// These tests pin the two properties that keep a diagnostic write cheap.

const DEVICE_COUNT = 32

function reconciliationEntry(index: number): TrackingPollLedgerEntry {
  const ts = new Date(Date.UTC(2026, 10, 22, 9, 0, 0, index * 250)).toISOString()
  return {
    ts,
    kind: 'breadcrumb_reconciliation',
    outcome: 'progress',
    reconciliationPhase: 'anti_entropy',
    targetFrom: '2026-11-21T02:14:52.954Z',
    targetTo: ts,
    totalDeviceCount: DEVICE_COUNT,
    completedDeviceCount: 4,
    totalChunkCount: 12,
    completedChunkCount: 3,
    pendingDeviceCount: DEVICE_COUNT - 4,
    failedDeviceCount: 0,
    elapsedMs: index * 250,
    recheckBacklog: Array.from({ length: DEVICE_COUNT }, (_, device) => ({
      deviceId: String(device + 1),
      from: '2026-11-21T02:14:52.954Z',
      to: '2026-11-22T03:15:00.000Z',
    })),
  }
}

function fillLedgerWithRecheckEntries(): void {
  for (let index = 0; index < TRACKING_POLL_LEDGER_MAX_ENTRIES; index += 1) {
    recordTrackingPollLedgerEntry(reconciliationEntry(index))
  }
}

describe('tracking poll ledger write cost under the 5-minute re-check [DON-367]', () => {
  beforeEach(() => {
    clearTrackingPollLedger()
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    clearTrackingPollLedger()
  })

  it('does not re-read and re-validate the stored ledger on every write', () => {
    fillLedgerWithRecheckEntries()
    const getItem = vi.spyOn(Storage.prototype, 'getItem')

    for (let index = 0; index < 100; index += 1) {
      recordTrackingPollLedgerEntry(reconciliationEntry(TRACKING_POLL_LEDGER_MAX_ENTRIES + index))
    }

    expect(getItem).not.toHaveBeenCalled()
  })

  it('keeps a full ledger of re-check entries small, and says how many backlog ranges it left out', () => {
    fillLedgerWithRecheckEntries()

    const stored = readTrackingPollLedger()
    const bytes = JSON.stringify(stored).length
    expect(stored).toHaveLength(TRACKING_POLL_LEDGER_MAX_ENTRIES)
    expect(bytes).toBeLessThanOrEqual(512 * 1024)

    const latest = stored.at(-1)
    expect(latest?.kind).toBe('breadcrumb_reconciliation')
    if (latest?.kind !== 'breadcrumb_reconciliation') return
    // The whole backlog is still described truthfully: how many devices and
    // ranges were behind, which ranges are kept, and how many were left out.
    expect(latest.recheckBacklogDeviceCount).toBe(DEVICE_COUNT)
    expect(latest.recheckBacklogRangeCount).toBe(DEVICE_COUNT)
    expect((latest.recheckBacklog?.length ?? 0) + (latest.recheckBacklogOmittedRangeCount ?? 0)).toBe(DEVICE_COUNT)
  })

  it('writes session storage at most once per flush window, and the written ledger reloads intact', async () => {
    vi.useFakeTimers()
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    for (let index = 0; index < 100; index += 1) {
      recordTrackingPollLedgerEntry(reconciliationEntry(index))
    }
    expect(setItem).not.toHaveBeenCalled()

    vi.advanceTimersByTime(TRACKING_POLL_LEDGER_FLUSH_DELAY_MS)
    expect(setItem).toHaveBeenCalledTimes(1)
    const recorded = readTrackingPollLedger()

    // A renderer reload starts with an empty module and reads storage once.
    vi.resetModules()
    const reloaded = await import('../../src/features/diagnostics/tracking-poll-ledger')
    expect(reloaded.readTrackingPollLedger()).toEqual(recorded)
    const latest = recorded.at(-1)
    expect(latest).toMatchObject({
      recheckBacklogDeviceCount: DEVICE_COUNT,
      recheckBacklogRangeCount: DEVICE_COUNT,
    })
  })

  it('writes what is pending as soon as it is flushed, for example when the page is hidden', () => {
    vi.useFakeTimers()
    recordTrackingPollLedgerEntry(reconciliationEntry(0))
    expect(window.sessionStorage.getItem('sartracker:tracking-poll-ledger')).toBeNull()

    window.dispatchEvent(new Event('pagehide'))

    const stored = JSON.parse(window.sessionStorage.getItem('sartracker:tracking-poll-ledger') ?? '[]') as unknown[]
    expect(stored).toHaveLength(1)
    flushTrackingPollLedger()
  })
})
