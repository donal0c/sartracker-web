import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  MAX_GPX_SOURCE_BYTES,
  readBoundedGpxSource,
} = require('../../electron/gpx-source-reader.cjs') as {
  readonly MAX_GPX_SOURCE_BYTES: number
  readonly readBoundedGpxSource: (sourcePath: string) => Promise<Buffer>
}

describe('bounded exact GPX source reads [DON-274]', () => {
  let root: string | null = null

  afterEach(async () => {
    if (root !== null) await rm(root, { recursive: true, force: true })
    root = null
  })

  it('accepts the exact engineering ceiling and rejects the next byte without an unbounded read', async () => {
    root = await mkdtemp(path.join(tmpdir(), 'sartracker-gpx-source-bound-'))
    const acceptedPath = path.join(root, 'accepted.gpx')
    const rejectedPath = path.join(root, 'rejected.gpx')
    await writeFile(acceptedPath, Buffer.alloc(MAX_GPX_SOURCE_BYTES, 0x61))
    await writeFile(rejectedPath, Buffer.alloc(MAX_GPX_SOURCE_BYTES + 1, 0x61))

    await expect(readBoundedGpxSource(acceptedPath)).resolves.toHaveLength(MAX_GPX_SOURCE_BYTES)
    await expect(readBoundedGpxSource(rejectedPath)).rejects.toThrow(/8 MiB.*safety limit/i)
  })
})
