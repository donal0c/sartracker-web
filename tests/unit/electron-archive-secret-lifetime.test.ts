import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../electron')

function source(fileName: string): string {
  return readFileSync(path.join(ROOT, fileName), 'utf8')
}

describe('archive credential lifetime boundaries [DON-248 / BCP-14]', () => {
  it('does not rebuild immutable credential strings inside archive workers', () => {
    const createWorker = source('mission-archive-worker.cjs')
    const verifyWorker = source('archive-verify-worker.cjs')

    expect(createWorker).toContain('const request = workerData.request')
    expect(verifyWorker).toContain('const request = workerData.request')
    expect(createWorker).not.toContain('credentials.passphraseBytes.toString(\'utf8\')')
    expect(createWorker).not.toContain('credentials.recoveryCodeBytes.toString(\'utf8\')')
    expect(verifyWorker).not.toContain('credentials.passphraseBytes.toString(\'utf8\')')
    expect(verifyWorker).not.toContain('credentials.recoveryCodeBytes.toString(\'utf8\')')
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
