import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('breadcrumb PR-3 operator manual [DON-275]', () => {
  it('documents honest coverage, independent live positions, and exact inspection', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')

    for (const required of [
      'Mission History Coverage',
      'All mission history shown',
      'All selected history shown',
      'Outside outings',
      'Progress can go backwards honestly',
      'History incomplete — showing loaded coverage',
      'Inspect exact fixes',
      'does not hide Alpha Team\'s current marker',
    ]) {
      expect(manual).toContain(required)
    }
    for (const asset of [
      'mission-history-coverage-status.png',
      'mission-history-evidence-pending.png',
      'mission-history-live-independent.png',
    ]) {
      expect(existsSync(`public/manual/assets/${asset}`)).toBe(true)
      expect(manual).toContain(`assets/${asset}`)
    }
  })
})
