import { describe, expect, it, vi } from 'vitest'

import { waitForArchiveReviewReady } from '../../scripts/qualification/marker-attachment-probe.mjs'

describe('C12 marker attachment probe readiness', () => {
  it('surfaces a seeded renderer failure before waiting for the readiness timeout', async () => {
    const failure = new Error('archive attachment opener failed')
    const page = { evaluate: vi.fn() }

    await expect(waitForArchiveReviewReady(page, () => failure)).rejects.toBe(failure)
    expect(page.evaluate).not.toHaveBeenCalled()
  })

  it('returns the bounded readiness envelope after the renderer publishes it', async () => {
    const ready = {
      sessionId: 'session-c12',
      archivePath: '/profile/archives/c12.sararch',
      storedPaths: ['/profile/attachments/original.txt'],
      target: { referenceKind: 'marker_version' },
    }
    const page = { evaluate: vi.fn().mockResolvedValue(ready) }

    await expect(waitForArchiveReviewReady(page)).resolves.toEqual(ready)
    expect(page.evaluate).toHaveBeenCalledOnce()
  })
})
