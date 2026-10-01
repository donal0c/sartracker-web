import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('breadcrumb PR-3 operator manual [DON-275]', () => {
  it('documents honest coverage, independent live positions, and exact inspection', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')

    for (const required of [
      'Mission history coverage',
      'All mission history shown',
      'All selected history shown',
      'Outside outings',
      'A lower number is safer than a false 100%',
      'History incomplete — showing loaded coverage',
      'Loaded history is shown, but completeness is not yet verified',
      'Participant history is still being added',
      'Inspect exact fixes',
      'does not hide anyone\'s live marker',
    ]) {
      expect(manual.replace(/\s+/gu, ' ')).toContain(required)
    }
    expect(existsSync('public/manual/assets/mission-history-coverage.png')).toBe(true)
    expect(manual).toContain('assets/mission-history-coverage.png')
  })

  it('documents the refused-Finish, evidence-gap and safe-close rules volunteers meet', () => {
    const manual = readFileSync('public/manual/index.html', 'utf8')
    const normalizedManual = manual.replace(/\s+/gu, ' ')

    for (const required of [
      'Finish can be refused',
      'Mission cannot be finished while 2 participant history backfill',
      'Complete</strong> or <strong>100%',
      'Record Gap &amp; Allow Archive',
      'Open Admin Roster Settings',
      'Settings → Mission Defaults → Admin roster',
      'A lost recovery code cannot be recovered',
      'Verified encrypted archive',
      'SAR Tracker could not restart safely',
      'could not close safely',
      'do not edit or delete the profile',
    ]) {
      expect(normalizedManual).toContain(required)
    }
    for (const asset of [
      'evidence-gap-no-admin.png',
      'evidence-gap-acknowledge.png',
      'archive-custody-dialog.png',
    ]) {
      expect(existsSync(`public/manual/assets/${asset}`)).toBe(true)
      expect(manual).toContain(`assets/${asset}`)
    }
  })
})
