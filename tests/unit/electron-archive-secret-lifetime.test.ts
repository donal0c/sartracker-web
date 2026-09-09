import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../electron')

function source(fileName: string): string {
  return readFileSync(path.join(ROOT, fileName), 'utf8')
}

describe('archive credential lifetime boundaries [DON-248 / BCP-14]', () => {
  it('does not rebuild immutable credential strings inside archive workers', () => {
    const workerSources = [
      source('mission-archive-worker.cjs'),
      source('archive-verify.cjs'),
      source('archive-restore.cjs'),
      source('archive-cleanup-credential.cjs'),
    ]

    for (const worker of workerSources) {
      expect(worker).not.toMatch(/(?:passphraseBytes|recoveryCodeBytes|secretBytes)\.toString\(['"]utf8['"]\)/u)
    }
  })

  it('scrubs credentials immediately after their final KDF or unwrap use', () => {
    const createWorker = source('mission-archive-worker.cjs')
    const verify = source('archive-verify.cjs')
    const restore = source('archive-restore.cjs')

    expect(createWorker).toMatch(
      /const passphraseSlot = await wrapMissionArchiveKey\([\s\S]{0,1200}?zeroBuffer\(passphraseBytes\)/u,
    )
    expect(createWorker).toMatch(
      /(?:const|let) recoverySlot(?: = undefined)?[\s\S]{0,1200}?await wrapMissionArchiveKey\([\s\S]{0,1200}?zeroBuffer\(recoveryCodeBytes\)/u,
    )
    expect(verify).toMatch(
      /missionArchiveKey = await unwrapBothSlots\([\s\S]{0,500}?zeroBuffer\(passphraseBytes\)[\s\S]{0,120}?zeroBuffer\(recoveryCodeBytes\)/u,
    )
    expect(restore).toMatch(
      /archiveKey = await unwrapReviewSlot\([\s\S]{0,300}?zeroBuffer\(secretBytes\)/u,
    )
  })
})
