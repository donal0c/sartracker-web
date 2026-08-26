import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('breadcrumb PR-3 operator manual [DON-275]', () => {
  it('documents honest coverage, independent live positions, and exact inspection', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')

    for (const required of [
      'enabled by default in packaged and release builds',
      'explicit build override',
      '25 August 2026',
      'Mission History Coverage',
      'All mission history shown',
      'All selected history shown',
      'Outside outings',
      'Progress can go backwards honestly',
      'History incomplete — showing loaded coverage',
      'Loaded history is shown, but completeness is not yet verified',
      'withholds the full bar until the final database completeness claim also succeeds',
      'SAR Tracker makes one automatic recovery attempt',
      'Applying the selected history filter to the map',
      'Inspect exact fixes',
      'does not hide Alpha Team\'s current marker',
    ]) {
      expect(manual).toContain(required)
    }
    expect(manual).not.toContain('disabled in normal packaged and release builds')
    expect(manual).not.toContain('Do not expect them in the current team beta')
    expect(manual).not.toContain('internal mission model')
    for (const asset of [
      'mission-history-coverage-status.png',
      'mission-history-claim-unverified.png',
      'mission-history-evidence-pending.png',
      'mission-history-filter-pending.png',
      'mission-history-live-independent.png',
    ]) {
      expect(existsSync(`public/manual/assets/${asset}`)).toBe(true)
      expect(manual).toContain(`assets/${asset}`)
    }
  })

  it('documents the fail-closed desktop teardown boundary', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const normalizedManual = manual.replace(/\s+/gu, ' ')

    for (const required of [
      'keeps the renderer alive until the drain acknowledges',
      'Finish closes the mission-evidence cutoff before the durable status transition',
      'retries the durable capacity-loss marker before Finish, finalization, or shutdown may proceed',
      'every unfinalized mission, including a finished mission',
      'unexpected renderer crash is fenced immediately',
      'fatal main-process fault fences mission evidence before relaunch',
      'After any unclean shutdown, SAR Tracker blocks every unfinalized mission before the operator window opens',
      'SAR Tracker could not restart safely',
      'SAR Tracker could not close safely',
      'preserve the profile',
    ]) {
      expect(normalizedManual).toContain(required)
    }
    expect(existsSync('public/manual/assets/tracking-shutdown-evidence-loss.png')).toBe(true)
    expect(manual).toContain('assets/tracking-shutdown-evidence-loss.png')
  })
})
