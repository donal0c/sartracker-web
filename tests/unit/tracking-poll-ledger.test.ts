import { beforeEach, describe, expect, it } from 'vitest'

import {
  clearTrackingPollLedger,
  formatTrackingPollLedger,
  readTrackingPollLedger,
  recordTrackingPollLedgerEntry,
  TRACKING_POLL_LEDGER_MAX_ENTRIES,
} from '../../src/features/diagnostics/tracking-poll-ledger'

describe('tracking poll ledger', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('retains a bounded chronological ledger', () => {
    for (let index = 0; index < TRACKING_POLL_LEDGER_MAX_ENTRIES + 5; index += 1) {
      recordTrackingPollLedgerEntry({
        ts: new Date(Date.UTC(2026, 6, 12, 9, 0, index)).toISOString(),
        kind: 'poll_cycle',
        outcome: 'success',
        phase: 'breadcrumbs',
        durationMs: 25,
        consecutiveFailures: 0,
        retryDelayMs: 0,
        deviceCount: 32,
        currentPositionCount: 7,
        breadcrumbRequestedDeviceCount: 1,
        breadcrumbReturnedCount: 4,
        breadcrumbAcceptedCount: 4,
        breadcrumbDuplicateCount: 0,
        breadcrumbFailedDeviceCount: 0,
      })
    }

    const entries = readTrackingPollLedger()

    expect(entries).toHaveLength(TRACKING_POLL_LEDGER_MAX_ENTRIES)
    expect(entries[0]?.ts).toBe('2026-07-12T09:00:05.000Z')
    expect(entries.at(-1)?.kind).toBe('poll_cycle')
  })

  it('formats safe failure and recovery evidence without operational identity', () => {
    recordTrackingPollLedgerEntry({
      ts: '2026-07-12T09:52:01.431Z',
      kind: 'request_attempt',
      outcome: 'failure',
      phase: 'current_positions',
      durationMs: 10_001,
      attempt: 4,
      maxAttempts: 4,
      failureKind: 'timeout',
      httpStatus: null,
    })
    recordTrackingPollLedgerEntry({
      ts: '2026-07-12T09:54:37.597Z',
      kind: 'poll_cycle',
      outcome: 'recovered',
      phase: 'breadcrumbs',
      durationMs: 211,
      consecutiveFailures: 0,
      retryDelayMs: 0,
      outageDurationMs: 156_166,
      deviceCount: 32,
      currentPositionCount: 7,
      breadcrumbRequestedDeviceCount: 1,
      breadcrumbReturnedCount: 4,
      breadcrumbAcceptedCount: 4,
      breadcrumbDuplicateCount: 0,
      breadcrumbFailedDeviceCount: 0,
      breadcrumbWindow: {
        previousCursorEarliest: '2026-07-12T09:54:30.000Z',
        previousCursorLatest: '2026-07-12T09:54:30.000Z',
        requestedFromEarliest: '2026-07-12T09:49:30.000Z',
        requestedFromLatest: '2026-07-12T09:49:30.000Z',
        requestedTo: '2026-07-12T09:54:37.000Z',
        newestReturnedEarliest: '2026-07-12T09:54:36.500Z',
        newestReturnedLatest: '2026-07-12T09:54:36.500Z',
      },
    })

    const report = formatTrackingPollLedger(readTrackingPollLedger())

    expect(report).toContain('[tracking-poll-ledger]')
    expect(report).toContain('retained entry count: 2')
    expect(report).toContain('"failureKind":"timeout"')
    expect(report).toContain('"outageDurationMs":156166')
    expect(report).toContain('"requestedFromEarliest":"2026-07-12T09:49:30.000Z"')
    expect(report).toContain('"previousCursorEarliest":"2026-07-12T09:54:30.000Z"')
    expect(report).not.toMatch(/password|token|authorization|latitude|longitude|deviceId/u)
  })

  it('drops unknown fields instead of trusting injected session data', () => {
    recordTrackingPollLedgerEntry({
      ts: '2026-07-12T09:52:01.431Z',
      kind: 'request_attempt',
      outcome: 'failure',
      phase: 'current_positions',
      durationMs: 10_001,
      attempt: 1,
      maxAttempts: 4,
      failureKind: 'timeout',
      httpStatus: null,
      password: 'field-secret',
      latitude: 52.0599,
    } as Parameters<typeof recordTrackingPollLedgerEntry>[0])

    const serialized = JSON.stringify(readTrackingPollLedger())

    expect(serialized).not.toContain('field-secret')
    expect(serialized).not.toContain('52.0599')
    expect(serialized).not.toContain('password')
    expect(serialized).not.toContain('latitude')
  })

  it('reports when an incident falls outside retained ledger coverage', () => {
    recordTrackingPollLedgerEntry({
      ts: '2026-07-12T09:52:01.431Z',
      kind: 'request_attempt',
      outcome: 'failure',
      phase: 'current_positions',
      durationMs: 10_001,
      attempt: 4,
      maxAttempts: 4,
      failureKind: 'network',
      httpStatus: null,
    })

    const report = formatTrackingPollLedger(readTrackingPollLedger(), {
      incidentAt: '2026-07-12T20:00:00.000Z',
      beforeMinutes: 30,
      afterMinutes: 30,
    })

    expect(report).toContain('incident coverage: outside retained range')
    expect(report).toContain('scoped entry count: 0')
  })

  it('clears retained entries', () => {
    recordTrackingPollLedgerEntry({
      ts: '2026-07-12T09:52:01.431Z',
      kind: 'request_attempt',
      outcome: 'failure',
      phase: 'devices',
      durationMs: 10_001,
      attempt: 1,
      maxAttempts: 4,
      failureKind: 'timeout',
      httpStatus: null,
    })

    clearTrackingPollLedger()

    expect(readTrackingPollLedger()).toEqual([])
  })
})
