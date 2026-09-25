import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { assertRegularFileOrAbsent } = require('../../electron/regular-file-guard.cjs') as {
  readonly assertRegularFileOrAbsent: (
    filePath: string,
    fileSystem?: { readonly lstat: (path: string) => Promise<{ readonly isFile: () => boolean }> },
  ) => Promise<boolean>
}

describe('startup storage file type guard', () => {
  it('accepts regular files and reports absent files without opening them', async () => {
    const regularFileSystem = { lstat: vi.fn(async () => ({ isFile: () => true })) }
    await expect(assertRegularFileOrAbsent('/profile/log.json', regularFileSystem)).resolves.toBe(true)
    expect(regularFileSystem.lstat).toHaveBeenCalledWith('/profile/log.json')

    const absentFileSystem = {
      lstat: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }),
    }
    await expect(assertRegularFileOrAbsent('/profile/log.json', absentFileSystem)).resolves.toBe(false)
  })

  it('rejects non-regular paths before a read can block on a FIFO', async () => {
    const nonRegularFileSystem = { lstat: vi.fn(async () => ({ isFile: () => false })) }

    await expect(assertRegularFileOrAbsent('/profile/log.json', nonRegularFileSystem))
      .rejects.toMatchObject({
        code: 'ERR_SARTRACKER_NON_REGULAR_FILE',
        message: 'Startup storage evidence path is not a regular file.',
      })
    expect(nonRegularFileSystem.lstat).toHaveBeenCalledOnce()
  })
})
