import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * The rewritten operator manual (DON-301) must keep every user-visible change
 * that landed on master after the rewrite began. One line per change.
 */
describe('operator manual describes current behaviour [DON-301]', () => {
  const manual = readFileSync('public/manual/index.html', 'utf8').replace(/\s+/gu, ' ')

  it.each([
    ['DON-296 team default group', 'Team default group'],
    ['DON-305 late uploads', 'appears on the map within about five minutes'],
    ['DON-304 remembered map', 'SAR Tracker remembers the map you chose'],
    ['DON-314 Replay uses Discovery', 'The Replay map uses the map you chose'],
    ['DON-288 no WebGL', 'Restart with software rendering'],
    ['DON-285 unwritable profile', 'cannot write to its data folder'],
    ['DON-309 restore a retired track', 'Bring a retired track back'],
    ['DON-320 retired file in watched folder', 'A watched folder never brings a retired track back'],
    ['DON-308 version in reports', 'Every report and bundle starts with the SAR Tracker version'],
    ['DON-318 evidence wording', 'may have been lost when the app closed unexpectedly'],
    ['SAR-QA-025 typical mission', 'A typical mission, the way the team runs it'],
    ['DON-319 GPX hidden on map', 'Hidden on map'],
    // DON-300's short labels belonged to the old top bar; DON-341 moved Diagnostics into More.
    ['DON-341 top bar names where Diagnostics went', '<strong>More</strong> (Review and replay, Diagnostics, Help, Theme)'],
    ['DON-338 history gap warning', 'could not be loaded from the tracking server and is <strong>missing from the map</strong>'],
    ['DON-338 unreadable roster rows', 'DEVICE ROSTER INCOMPLETE'],
    ['DON-338 refused fixes', 'MISSION STORAGE REFUSED FIXES'],
    ['DON-338 reused position ids', 'TRACKING SERVER REUSED POSITION IDS'],
    ['DON-338 history line updating', 'Updating — the newest positions are being added to the history line'],
    ['DON-338 history warning on every tab', '<strong>MISSION HISTORY</strong> warning appears in the strip under the top bar'],
    ['DON-338 history gap warning while paused', '<em>retries resume when live tracking resumes</em>'],
    ['DON-338 history gap across a clock change', '<em>01:50 (UTC+1)–01:10 (UTC+0)</em>'],
    ['DON-338 history builder out of memory', '<strong>Reason: the history builder ran out of memory</strong>'],
    ['DON-338 history re-check running behind', '<strong>Breadcrumb history re-check is running behind for</strong> a named device, with times'],
    ['DON-338 history line stalled', '<strong>History line stalled</strong> message means the line has not changed'],
    ['DON-338 lone fix', 'is drawn as a small circle in the device\'s colour'],
    ['DON-376 plain Finish refusal', "Can't finish yet. SAR Tracker is still fetching earlier tracks for 2 people."],
    ['DON-376 Try again', '<strong>Try again</strong> never finishes the mission.'],
  ])('%s', (_change, text) => {
    expect(manual).toContain(text)
  })

  it.each([
    ['repairable evidence blocks; only a known loss can be acknowledged', 'An admin <em>cannot</em> wave this through'],
    ['a later loss invalidates the acknowledgement', 'the earlier record no longer counts'],
    ['first accepted fix on a source conflict', 'keeps the first accepted fix'],
    ['legacy roster recovery', 'Resolve legacy roster'],
    ['every share is reviewed and redacted', 'a person must look through it first'],
    ['correction epoch exception for Search Passes', 'until the corrected archive is finalized'],
  ])('keeps safety guidance: %s', (_rule, text) => {
    expect(manual).toContain(text)
  })

  it('no longer uses wording the app has dropped', () => {
    expect(manual).not.toContain('was lost during runtime shutdown')
    expect(manual).not.toContain('Nothing is selected automatically. Starting')
    expect(manual).not.toContain('participant history backfill checkpoint(s) are incomplete')
  })

  it('checks readiness on the new top bar, not the removed classic mast [DON-353]', () => {
    expect(manual).not.toContain('<strong>FIX</strong> and <strong>STALE</strong> in the top bar')
    expect(manual).not.toContain('Browser test / Session storage only')
    expect(manual).not.toContain('Check the chip says <strong>ACTIVE</strong>')
    expect(manual).toContain('Green <strong>Tracking OK</strong>')
    expect(manual).toContain('<strong>Mission · Running</strong>')
    expect(manual).toContain('amber <strong>Browser testing mode</strong> banner under the top bar')
  })

  it('describes the tracking status and alarm, not the removed chips [DON-353]', () => {
    expect(manual).not.toMatch(/OFFLINE<\/strong> chip|ONLINE<\/strong> chip/u)
    expect(manual).not.toContain('Mission paused · live refresh suspended')
    expect(manual).not.toContain('Tracking not live · cached positions')
    expect(manual).toContain('<strong>TRACKING LOST: positions on the map may not be current</strong>')
    expect(manual).toContain('<strong>MISSION PAUSED: positions are not updating</strong>')
    expect(manual).toContain('Grey <strong>Tracking not connected</strong>')
    expect(manual).toContain('a missing stale count does not prove positions are fresh')
  })

  it('says a running mission without tracking is red, and only the no-mission case is grey [DON-375]', () => {
    expect(manual).toContain('<strong>TRACKING NOT CONNECTED: positions on the map are not updating; connect in Settings → Tracking sources</strong>')
    expect(manual).toContain('Grey <strong>Tracking not connected</strong>, with no mission running')
  })
})
