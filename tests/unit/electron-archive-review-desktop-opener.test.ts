import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)

const { createArchiveReviewDesktopOpener } = require(
  '../../electron/archive-review-desktop-opener.cjs',
) as {
  readonly createArchiveReviewDesktopOpener: (input: {
    readonly platform: NodeJS.Platform
    readonly shell: {
      readonly openExternal: (url: string) => Promise<void>
      readonly openPath: (filePath: string) => Promise<string>
    }
  }) => (stagePath: string) => Promise<string>
}

describe('archive review desktop opener [DON-254]', () => {
  it('uses the external URL handoff on Linux and acknowledges a settled launch request', async () => {
    const shell = {
      openExternal: vi.fn(async () => undefined),
      openPath: vi.fn(async () => ''),
    }
    const opener = createArchiveReviewDesktopOpener({ platform: 'linux', shell })
    const stagePath = '/tmp/sartracker/archive-review/briefing.pdf'

    await expect(opener(stagePath)).resolves.toBe('')
    expect(shell.openExternal).toHaveBeenCalledWith(pathToFileURL(stagePath).href)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('surfaces a Linux desktop-launch rejection instead of reporting a false success', async () => {
    const failure = new Error('desktop launch rejected')
    const shell = {
      openExternal: vi.fn(async () => { throw failure }),
      openPath: vi.fn(async () => ''),
    }
    const opener = createArchiveReviewDesktopOpener({ platform: 'linux', shell })

    await expect(opener('/tmp/sartracker/archive-review/briefing.pdf')).rejects.toBe(failure)
  })

  it('keeps the existing path handoff on non-Linux platforms', async () => {
    const shell = {
      openExternal: vi.fn(async () => undefined),
      openPath: vi.fn(async () => 'viewer unavailable'),
    }
    const opener = createArchiveReviewDesktopOpener({ platform: 'darwin', shell })
    const stagePath = '/tmp/sartracker/archive-review/briefing.pdf'

    await expect(opener(stagePath)).resolves.toBe('viewer unavailable')
    expect(shell.openPath).toHaveBeenCalledWith(stagePath)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})
