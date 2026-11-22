// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createAttentionScenario, startAttentionServer } from '../../scripts/qualification/attention-server.mjs'
import { validateAttentionSurface } from '../../scripts/qualification/attention-receipts.mjs'
import type { MissionRuntimePhase } from '../../src/features/mission/mission-store'
import type { TrackingWarningCode } from '../../src/features/tracking/tracking-warnings'
import type { TrackingConnectionStatus } from '../../src/features/tracking/tracking-types'
import { describeTrackingHeadline } from '../../src/features/workspace/tracking-headline'
import { labelTrackingWarning } from '../../src/features/workspace/tracking-problem-labels'

/** A recovery reading that is right in every way except the words under test. */
const ATTENTION_RECOVERY = { recoveredCondition: 'attention', recovered: '1 position out of date. Open tracking details', recoveredWords: '1 stale' }

/** The attention facts with a healthy recovery, for the receipt's agreement checks. */
function topBarFacts() {
  return { source: createAttentionScenario(1800000000000), attention: 'Stationary Attention',
    acknowledged: 'Attention Acknowledged', stale: 'offline',
    disconnected: 'TRACKING LOST. Open tracking details', disconnectedCondition: 'lost', disconnectedWords: 'TRACKING LOST',
    recovered: 'Tracking OK. Open tracking details', recoveredCondition: 'ok', recoveredWords: 'Tracking OK',
    cleared: true, currentVisible: true, renderedCurrent: { coordinates: [-9.7, 52.00101], attention: false },
    evidenceBeforeAck: 'a'.repeat(64), evidenceAfterAck: 'a'.repeat(64) }
}

/** Expects the receipt to reject a recovery whose label or visible words were changed. */
function expectRecoveryRejected(change: Record<string, unknown>) {
  expect(() => validateAttentionSurface({ ...topBarFacts(), ...ATTENTION_RECOVERY, ...change }))
    .toThrow(/tracking-recovery transition failed/)
}

/** The app's own headline for one tracking state, with nothing else wrong. */
function appHeadline(status: Partial<TrackingConnectionStatus>, phase: MissionRuntimePhase, evidenceState = 'healthy') {
  return describeTrackingHeadline({
    status: { mode: 'online', consecutiveFailures: 0, recovered: false, lastSuccessAt: null, warning: null, ...status },
    phase, positions: [], ingestRejected: 0, evidenceState, evidenceLossAcknowledged: false, conflictCount: 0,
    stationaryCount: 0, notedCount: 0, coverageStatus: 'complete', hiddenLocationCount: 0, allLocationsHidden: false,
  })
}

describe('packaged attention independent source and UI oracle', () => {
  it('serves fixed source fixes, explicit outages and recovery on loopback only', async () => {
    const source = createAttentionScenario(1800000000000)
    expect(Date.parse(source.stationary[1].fixTime) - Date.parse(source.stationary[0].fixTime)).toBe(1200000)
    const server = await startAttentionServer(source)
    try {
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/)
      expect((await (await fetch(server.url + '/api/positions?deviceId=1')).json()).length).toBe(2)
      server.setStage('disconnected')
      expect((await fetch(server.url + '/api/devices')).status).toBe(503)
      server.setStage('moving')
      expect((await (await fetch(server.url + '/api/positions?deviceId=1')).json()).length).toBe(4)
      expect(() => server.setStage('unknown')).toThrow()
    } finally { await server.close() }
  })

  it('rejects missing UI transitions, altered evidence and source movement mutants', () => {
    const facts = { source: createAttentionScenario(1800000000000), attention: 'Stationary Attention',
      acknowledged: 'Attention Acknowledged', stale: 'offline', disconnected: 'offline', recovered: 'online',
      cleared: true, currentVisible: true, renderedCurrent: { coordinates: [-9.7, 52.00101], attention: false },
      evidenceBeforeAck: 'a'.repeat(64), evidenceAfterAck: 'a'.repeat(64) }
    expect(validateAttentionSurface(facts).passed).toBe(true)
    for (const key of ['attention', 'acknowledged', 'stale', 'disconnected', 'recovered']) {
      expect(() => validateAttentionSurface({ ...facts, [key]: '' })).toThrow()
    }
    expect(() => validateAttentionSurface({ ...facts, evidenceAfterAck: 'b'.repeat(64) })).toThrow()
    expect(() => validateAttentionSurface({ ...facts, cleared: false })).toThrow()
    const changed = structuredClone(facts)
    changed.source.stationary[1].latitude = 53
    expect(() => validateAttentionSurface(changed)).toThrow()
  })

  it('accepts the new top bar only when its condition, label and visible words agree [DON-353]', () => {
    // The new layout (DON-341) has no mode chip: the top bar shows short problem
    // words ("TRACKING LOST", "Tracking OK") and carries the condition the advice
    // is chosen by. The label is the full sentence for screen readers.
    const facts = { source: createAttentionScenario(1800000000000), attention: 'Stationary Attention',
      acknowledged: 'Attention Acknowledged', stale: 'offline',
      disconnected: 'TRACKING LOST. Open tracking details', disconnectedCondition: 'lost', disconnectedWords: 'TRACKING LOST',
      recovered: 'Tracking OK. Open tracking details', recoveredCondition: 'ok', recoveredWords: 'Tracking OK',
      cleared: true, currentVisible: true, renderedCurrent: { coordinates: [-9.7, 52.00101], attention: false },
      evidenceBeforeAck: 'a'.repeat(64), evidenceAfterAck: 'a'.repeat(64) }
    expect(validateAttentionSurface(facts).passed).toBe(true)
    expect(validateAttentionSurface({ ...facts, disconnectedCondition: 'disconnected',
      disconnected: 'Tracking not connected. Open tracking details', disconnectedWords: 'Tracking not connected' }).passed).toBe(true)
    expect(validateAttentionSurface({ ...facts, recoveredCondition: 'attention',
      recovered: '1 position out of date. Open tracking details', recoveredWords: '1 stale' }).passed).toBe(true)

    const lossFails = (change: Record<string, unknown>) =>
      expect(() => validateAttentionSurface({ ...facts, ...change })).toThrow(/tracking-loss transition failed/)
    lossFails({ disconnectedCondition: 'ok' })
    lossFails({ disconnectedCondition: 'paused' })
    lossFails({ disconnected: 'Tracking OK. Open tracking details' })
    lossFails({ disconnectedWords: '' })
    lossFails({ disconnectedWords: undefined })
    lossFails({ disconnectedWords: 'Tracking OK' })
    lossFails({ disconnectedCondition: 'disconnected', disconnectedWords: 'Tracking OK' })

    const recoveryFails = (change: Record<string, unknown>) =>
      expect(() => validateAttentionSurface({ ...facts, ...change })).toThrow(/tracking-recovery transition failed/)
    recoveryFails({ recoveredCondition: 'lost' })
    recoveryFails({ recoveredCondition: 'paused' })
    recoveryFails({ recovered: '' })
    recoveryFails({ recoveredWords: '' })
    recoveryFails({ recoveredWords: undefined })
    recoveryFails({ recovered: 'MISSION PAUSED. Open tracking details' })
    recoveryFails({ recoveredWords: 'MISSION PAUSED' })
    recoveryFails({ recoveredWords: 'TRACKING LOST' })
    recoveryFails({ recovered: 'Tracking not connected. Open tracking details' })
    // An attention headline with the label and words otherwise matching, so only
    // the guard under test can catch each one.
    const attention = { recoveredCondition: 'attention', recovered: '1 position out of date. Open tracking details', recoveredWords: '1 stale' }
    recoveryFails({ ...attention, recoveredWords: 'Tracking not connected' })
    recoveryFails({ ...attention, recoveredWords: 'Offline' })
    recoveryFails({ ...attention, recoveredWords: 'MISSION PAUSED' })
    recoveryFails({ ...attention, recovered: 'Tracking not connected. Open tracking details' })
    recoveryFails({ ...attention, recoveredWords: '' })
    recoveryFails({ ...attention, recoveredWords: '   ' })
    recoveryFails({ ...attention, recovered: '' })
    recoveryFails({ recoveredCondition: 'attention', recovered: 'Tracking OK. Open tracking details' })
    recoveryFails({ recoveredWords: '1 stale' })

    // A failure names the transition and quotes what was seen.
    expect(() => validateAttentionSurface({ ...facts, recoveredWords: 'MISSION PAUSED' })).toThrow(/"MISSION PAUSED"/)
  })

  // Each wording the recovery check rejects, in the label and in the visible
  // words on their own, so dropping any one alternative fails its own case.
  it.each([
    ['offline', 'Offline'],
    ['disconnected', 'Tracker disconnected'],
    ['not connected', 'Tracking not connected'],
    ['lost', 'TRACKING LOST'],
    ['paused', 'MISSION PAUSED'],
    ['needs resuming', 'Mission needs resuming'],
    ['not fully saved', 'Mission record not fully saved'],
    ['not saved', 'Record not saved'],
    ['login failed', 'Tracking login failed'],
    ['reconnect', 'Reconnect failed'],
    ['not configured', 'Not configured'],
  ])('rejects a recovery whose label or words say %s [DON-353]', (_keyword, words) => {
    expectRecoveryRejected({ recovered: `${words}. Open tracking details` })
    expectRecoveryRejected({ recoveredWords: words })
  })

  it('rejects every non-live headline the app itself builds, even under condition attention [DON-353]', () => {
    // The receipt's words are typed by hand in an .mjs probe; this builds the
    // app's real headline and problem words for each state that is not live
    // tracking, so a change of wording in the app fails here.
    const states = {
      paused: appHeadline({}, 'paused'),
      lost: appHeadline({ mode: 'offline' }, 'active'),
      record: appHeadline({}, 'active', 'failed'),
      recovery: appHeadline({}, 'recovery'),
      disconnected: appHeadline({ mode: 'idle' }, 'active'),
    }
    for (const [condition, headline] of Object.entries(states)) {
      expect(headline.condition).toBe(condition)
      expectRecoveryRejected({ recovered: `${headline.text}. Open tracking details` })
      expectRecoveryRejected({ recoveredWords: headline.problems.join(' · ') })
      for (const issue of headline.issues) expectRecoveryRejected({ recovered: `${issue}. Open tracking details` })
    }
    const notLiveCodes: TrackingWarningCode[] = ['auth_failed', 'offline_last_known', 'offline_no_positions',
      'tracking_not_configured', 'tracking_reconnecting', 'tracking_reconnect_failed',
      'mission_storage_failed', 'mission_storage_rows_rejected', 'history_storage_failed']
    for (const code of notLiveCodes) {
      const [word] = labelTrackingWarning('warning', [code])
      expect(word, code).toBeDefined()
      expectRecoveryRejected({ recoveredWords: word })
      expectRecoveryRejected({ recovered: `${word}. Open tracking details` })
    }
    // A live-tracking problem the app builds still passes as attention.
    const stale = labelTrackingWarning('warning', ['positions_rejected'])[0]
    expect(validateAttentionSurface({ ...topBarFacts(), ...ATTENTION_RECOVERY, recoveredWords: stale }).passed).toBe(true)
  })
})
