import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const consumerFiles = [
  'archive-custody-journal.cjs',
  'archive-scratch.cjs',
  'archive-verify.cjs',
  'archive-rehydrate.cjs',
  'archive-correction-worker.cjs',
  'mission-review-read-query.cjs',
] as const

/** Reads one production Electron module from the repository root. */
function readElectronModule(fileName: (typeof consumerFiles)[number]): string {
  return readFileSync(path.resolve('electron', fileName), 'utf8')
}

describe('current finalization boundary consumers [DON-253]', () => {
  it.each(consumerFiles)('%s does not scan a mission event history for its latest finalization', (fileName) => {
    const source = readElectronModule(fileName)

    expect(source).not.toMatch(
      /FROM\s+mission_events\s+WHERE\s+mission_id\s*=\s*\?\s+AND\s+event_type\s*=\s*'mission_finalized'\s+ORDER\s+BY\s+rowid\s+DESC\s+LIMIT\s+1/iu,
    )
  })

  it.each(consumerFiles)('%s resolves its v2 boundary through the shared helper', (fileName) => {
    const source = readElectronModule(fileName)

    expect(source).toContain("require('./mission-finalization-boundary.cjs')")
  })

  it('defers evidence-loss acknowledgement lookup until the outbox finds acknowledgeable loss', () => {
    const source = readFileSync(path.resolve('electron', 'mission-store.cjs'), 'utf8')

    expect(source).not.toMatch(
      /const\s+acknowledgedLossToken\s*=\s*readAcknowledgedEvidenceLossToken/gu,
    )
    expect(source.match(/readAcknowledgedLossToken:\s*\(\)\s*=>/gu)).toHaveLength(2)
  })
})
