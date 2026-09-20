import { describe, expect, it, vi } from 'vitest'

import {
  createArchiveReviewReadinessTimeoutError,
  waitForArchiveReviewReady,
} from '../../scripts/qualification/marker-attachment-probe.mjs'

describe('C12 marker attachment probe readiness', () => {
  it('identifies a renderer that remains pending inside openAttachment', () => {
    const error = createArchiveReviewReadinessTimeoutError({
      phase: 'openAttachment',
      startedAt: 10_000,
      referenceKind: 'marker_version',
      referenceId: 'marker-version-c12',
    }, 25_000)

    expect(error.message).toContain('openAttachment remained pending')
    expect(error.message).toContain('marker_version/marker-version-c12')
    expect(error.message).toContain('15000ms')
  })

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
