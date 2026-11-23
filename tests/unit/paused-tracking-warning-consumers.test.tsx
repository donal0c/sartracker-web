import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TrackingDetails, WorkspaceTopBar } from '../../src/components/workspace/workspace-chrome'
import { describeTrackingHeadline } from '../../src/features/workspace/tracking-headline'
import type { TrackingConnectionStatus } from '../../src/features/tracking/tracking-types'

// Audit M-34 follow-up: while a mission is paused, the routine pause notice is
// left out of the warnings, but any other warning sent with it must still reach
// the top bar and Tracking details.

const PAUSE_NOTICE = 'Live refresh suspended while mission is paused.'
const HISTORY_WARNING =
  'PARTICIPANT HISTORY UNAVAILABLE — Traccar device 3 has no saved record in this mission, so earlier history cannot be downloaded and Finish stays blocked.'

const BASE = {
  positions: [], ingestRejected: 0, evidenceState: 'healthy', evidenceLossAcknowledged: false, conflictCount: 0,
  stationaryCount: 0, notedCount: 0, coverageStatus: 'complete', hiddenLocationCount: 0, allLocationsHidden: false, mapUpdateFailed: false,
} as const

function pausedHeadline(warning: string, warningCodes: TrackingConnectionStatus['warningCodes']) {
  return describeTrackingHeadline({
    ...BASE,
    phase: 'paused',
    status: { mode: 'idle', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning, warningCodes },
  })
}

function happenedSection(markup: string): string {
  const match = /<dd data-testid="ws-tracking-happened">([\s\S]*?)<\/dd>/u.exec(markup)
  expect(match).not.toBeNull()
  return match![1]!
}

const noop = () => undefined

describe('paused mission keeps unrelated tracking warnings visible [M-34]', () => {
  it('shows the history warning in the top bar and Tracking details, without the pause notice', () => {
    const headline = pausedHeadline(`${PAUSE_NOTICE} ${HISTORY_WARNING}`, ['mission_paused', 'participant_history_unavailable'])

    expect(headline.condition).toBe('paused')
    expect(headline.problems).toEqual(['MISSION PAUSED', 'History unavailable'])
    expect(headline.issues).toEqual([HISTORY_WARNING])

    const topBar = renderToStaticMarkup(
      <WorkspaceTopBar
        headline={headline}
        missionAttention={false}
        missionOpen={false}
        onOpenTracking={noop}
        onToggleMission={noop}
        panelButtons={null}
        weather={null}
      />,
    )
    expect(topBar).toContain('MISSION PAUSED')
    expect(topBar).toContain('History unavailable')

    const happened = happenedSection(renderToStaticMarkup(<TrackingDetails headline={headline} onClose={noop} />))
    expect(happened).toContain('PARTICIPANT HISTORY UNAVAILABLE')
    expect(happened).not.toContain('Live refresh suspended')
  })

  it('keeps the record-not-saving warning, which also says live refresh is suspended', () => {
    const backpressure = 'LIVE REFRESH SUSPENDED — new positions are not being saved to the mission record, so the map is no longer updating. Treat team positions as old until this clears.'
    const headline = pausedHeadline(`${PAUSE_NOTICE} ${backpressure}`, ['mission_paused', 'evidence_backpressure'])

    expect(headline.issues).toEqual([backpressure])
    expect(headline.problems).toEqual(['MISSION PAUSED', 'Record behind'])
    const happened = happenedSection(renderToStaticMarkup(<TrackingDetails headline={headline} onClose={noop} />))
    expect(happened).toContain('new positions are not being saved')
  })

  it('still leaves a pause notice on its own out of the warnings', () => {
    const headline = pausedHeadline(PAUSE_NOTICE, ['mission_paused'])

    expect(headline.problems).toEqual(['MISSION PAUSED'])
    expect(headline.issues).toEqual([])
    const happened = happenedSection(renderToStaticMarkup(<TrackingDetails headline={headline} onClose={noop} />))
    expect(happened).not.toContain('<li>')
  })
})
