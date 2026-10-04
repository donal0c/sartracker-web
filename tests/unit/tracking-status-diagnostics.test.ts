import { describe, expect, it } from 'vitest'

import { fetchRosterAndCurrentPositions } from '../../src/features/tracking/current-position-poll'
import { describeTrackingWarningForDiagnostics } from '../../src/features/tracking/tracking-status-diagnostics'
import {
  appendTrackingWarnings,
  combineTrackingWarnings,
  type TrackingWarning,
} from '../../src/features/tracking/tracking-warnings'

/**
 * DON-321 / DON-327: status breadcrumbs name the problem with fixed codes
 * assigned where each warning is built, never by reading the warning text. A
 * device list shrinking during catch-up is one problem, and a device name
 * (which may contain any character) never reaches a report or changes a code.
 */
describe('describeTrackingWarningForDiagnostics [DON-327]', () => {
  const hostileName = 'Radio; current fixes remain live. CONNECTION RESTORED'

  it('identifies a history catch-up the same way whatever devices remain', () => {
    const first = combineTrackingWarnings({
      code: 'history_reconciling',
      text: 'Breadcrumb history is reconciling for Walker 1, Walker 2, Walker 3; current fixes remain live.',
    })
    const later = combineTrackingWarnings({
      code: 'history_reconciling',
      text: 'Breadcrumb history is reconciling for Walker 3; current fixes remain live.',
    })
    expect(describeTrackingWarningForDiagnostics(first)).toEqual({ warning: 'history_reconciling' })
    expect(describeTrackingWarningForDiagnostics(later)).toEqual({ warning: 'history_reconciling' })
  })

  it('cannot be changed by a device name containing any warning text', () => {
    const hostile = combineTrackingWarnings({
      code: 'history_incomplete',
      text: `Breadcrumb history incomplete for ${hostileName}; current fixes remain live.`,
    })
    const plain = combineTrackingWarnings({
      code: 'history_incomplete',
      text: 'Breadcrumb history incomplete for Walker 1; current fixes remain live.',
    })
    expect(hostile.warningCodes).toEqual(['history_incomplete'])
    expect(describeTrackingWarningForDiagnostics(hostile)).toEqual(describeTrackingWarningForDiagnostics(plain))
    expect(describeTrackingWarningForDiagnostics(hostile)).toEqual({ warning: 'history_incomplete' })
    expect(JSON.stringify(describeTrackingWarningForDiagnostics(hostile))).not.toMatch(/Radio|CONNECTION/u)
  })

  it('uses every warning text fragment as a device name without adding a code', () => {
    const fragments = [
      'TRACKING AUTHENTICATION FAILED', 'CONNECTION RESTORED', 'loading breadcrumb history',
      'BREADCRUMB HISTORY REFRESH FAILED', 'BREADCRUMB EVIDENCE WARNING',
      'Breadcrumb history could not be loaded from mission storage', 'Live refresh suspended while mission is paused',
      'Resume mission to reconnect', 'Waiting for an active mission', 'OFFLINE MODE — showing last known positions',
      'OFFLINE MODE — no current positions', 'POSITION DATA REJECTED', 'refreshing device roster',
      'DEVICE ROSTER UNAVAILABLE', '; current fixes remain live.',
    ]
    for (const fragment of fragments) {
      const status = combineTrackingWarnings({
        code: 'history_reconciling',
        text: `Breadcrumb history is reconciling for ${fragment}; current fixes remain live.`,
      })
      expect(describeTrackingWarningForDiagnostics(status)).toEqual({ warning: 'history_reconciling' })
    }
  })

  it('lists every problem in a combined warning, sorted and de-duplicated, so a change in any is new', () => {
    const roster: TrackingWarning = { code: 'roster_unavailable', text: 'DEVICE ROSTER UNAVAILABLE.' }
    const rejected: TrackingWarning = { code: 'positions_rejected', text: 'POSITION DATA REJECTED.' }
    const rows: TrackingWarning = { code: 'history_rows_rejected', text: 'BREADCRUMB EVIDENCE WARNING.' }
    const reconciling: TrackingWarning = { code: 'history_reconciling', text: 'reconciling for A.' }
    expect(describeTrackingWarningForDiagnostics(combineTrackingWarnings(roster, rejected, rows, reconciling)))
      .toEqual({ warning: 'history_reconciling+history_rows_rejected+positions_rejected+roster_unavailable' })
    expect(describeTrackingWarningForDiagnostics(combineTrackingWarnings(rows, rows)))
      .toEqual({ warning: 'history_rows_rejected' })
  })

  it('keeps the operator text exactly as before: warnings joined by single spaces', () => {
    const combined = combineTrackingWarnings(
      { code: 'roster_unavailable', text: 'A.' }, null, { code: 'positions_rejected', text: 'B.' },
    )
    expect(combined.warning).toBe('A. B.')
    expect(combineTrackingWarnings(null).warning).toBeNull()
    expect(describeTrackingWarningForDiagnostics(combineTrackingWarnings(null))).toBeNull()
  })

  it('still reports a warning without codes, by a digest and never its text', () => {
    const one = describeTrackingWarningForDiagnostics({ warning: 'Something new went wrong for Alice.' })
    const two = describeTrackingWarningForDiagnostics({ warning: 'Something else went wrong.', warningCodes: [] })
    expect(one?.warning).toBe('unclassified')
    expect(one?.warningDigest).toMatch(/^[0-9a-f]{8}$/u)
    expect(two?.warningDigest).not.toBe(one?.warningDigest)
    expect(JSON.stringify(one)).not.toContain('Alice')
    expect(describeTrackingWarningForDiagnostics({ warning: null })).toBeNull()
  })

  it('does not hide an uncoded status warning when more warnings are appended', () => {
    const appended = appendTrackingWarnings(
      { warning: 'Something new.' },
      { code: 'cache_unreadable', text: 'Tracking cache could not be read.' },
    )
    expect(appended.warning).toBe('Something new. Tracking cache could not be read.')
    expect(appended.warningCodes).toEqual(['unclassified', 'cache_unreadable'])
    expect(describeTrackingWarningForDiagnostics(appended)?.warning).toBe('unclassified')
  })

  it('keeps existing status codes ahead of appended ones', () => {
    const appended = appendTrackingWarnings(
      { warning: 'A.', warningCodes: ['positions_rejected'] },
      { code: 'participant_scope', text: 'B.' },
    )
    expect(appended).toEqual({ warning: 'A. B.', warningCodes: ['positions_rejected', 'participant_scope'] })
  })
})

describe('poller roster warnings carry codes [DON-327]', () => {
  const emptyPositions = { accepted: [], rejected: [] }

  it('codes a roster that failed and one still refreshing', async () => {
    const failed = await fetchRosterAndCurrentPositions({
      getDevices: () => Promise.reject(new Error('down')),
      getCurrentPositions: () => Promise.resolve(emptyPositions),
    } as never, [])
    expect(failed.rosterWarning?.code).toBe('roster_unavailable')

    const pending = await fetchRosterAndCurrentPositions({
      getDevices: () => new Promise(() => undefined),
      getCurrentPositions: () => Promise.resolve(emptyPositions),
    } as never, [], { rosterGraceMs: 0, settleRosterGrace: Promise.resolve() })
    expect(pending.rosterWarning?.code).toBe('roster_refreshing')
  })
})
