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
    ['DON-300 short top-bar labels', '<strong>DIAG</strong>'],
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
  })
})
