import { describe, expect, it } from 'vitest'

import { describeTrackingWarningForDiagnostics } from '../../src/features/tracking/tracking-status-diagnostics'

/**
 * DON-321: status breadcrumbs name the problem with fixed identifiers, never
 * free text. A device list shrinking during catch-up is one problem, and a
 * device name (which may contain any character) never reaches a report.
 */
describe('describeTrackingWarningForDiagnostics [DON-321]', () => {
  it('identifies a history catch-up the same way whatever devices remain', () => {
    const first = describeTrackingWarningForDiagnostics(
      'Breadcrumb history is reconciling for Walker 1, Walker 2, Walker 3; current fixes remain live.',
    )
    const later = describeTrackingWarningForDiagnostics(
      'Breadcrumb history is reconciling for Walker 3; current fixes remain live.',
    )
    expect(first).toEqual({ warning: 'history_reconciling' })
    expect(later).toEqual(first)
  })

  it('never carries device names, even names containing separators', () => {
    const described = describeTrackingWarningForDiagnostics(
      'Breadcrumb history incomplete for Radio; Alice Smith, Bob Jones; retrying while current fixes remain live.',
    )
    expect(described).toEqual({ warning: 'history_incomplete' })
    expect(JSON.stringify(described)).not.toMatch(/Alice|Bob|Radio/u)
  })

  it('does not take a device name for a problem (Codex review)', () => {
    expect(describeTrackingWarningForDiagnostics(
      'Breadcrumb history is reconciling for CONNECTION RESTORED, OFFLINE MODE — showing last known positions; current fixes remain live.',
    )).toEqual({ warning: 'history_reconciling' })
    expect(describeTrackingWarningForDiagnostics(
      'CONNECTION RESTORED Breadcrumb history incomplete for POSITION DATA REJECTED; retrying while current fixes remain live.',
    )).toEqual({ warning: 'connection_restored+history_incomplete' })
  })

  it('lists every problem in a combined warning, so a change in any of them is new', () => {
    const combined = [
      'DEVICE ROSTER UNAVAILABLE — current fixes are using last-known device details.',
      'POSITION DATA REJECTED — showing the last accepted fix where no valid replacement was available.',
      'BREADCRUMB EVIDENCE WARNING — the latest affected history response rejected 12 source rows.',
    ].join(' ')
    expect(describeTrackingWarningForDiagnostics(`${combined} Breadcrumb history is reconciling for A; current fixes remain live.`))
      .toEqual({ warning: 'history_reconciling+history_rows_rejected+positions_rejected+roster_unavailable' })
    expect(describeTrackingWarningForDiagnostics(`${combined} BREADCRUMB HISTORY REFRESH FAILED — current fixes remain live; exact history will retry.`))
      .toEqual({ warning: 'history_refresh_failed+history_rows_rejected+positions_rejected+roster_unavailable' })
  })

  it('identifies an unrecognised warning by a digest, not its text', () => {
    const one = describeTrackingWarningForDiagnostics('Something new went wrong for Alice.')
    const two = describeTrackingWarningForDiagnostics('Something else went wrong.')
    expect(one?.warning).toBe('unclassified')
    expect(one?.warningDigest).toMatch(/^[0-9a-f]{8}$/u)
    expect(two?.warningDigest).not.toBe(one?.warningDigest)
    expect(JSON.stringify(one)).not.toContain('Alice')
    expect(describeTrackingWarningForDiagnostics(null)).toBeNull()
  })
})
