import { createRequire } from 'node:module'
import { open, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { closeTransferredFileHandle } = require('../../electron/transferred-file-handle-cleanup.cjs') as {
  closeTransferredFileHandle: (handle: { readonly fd: number; close: () => Promise<void> }) => Promise<void>
}

it('does not treat a detached wrapper as proof that its original descriptor closed', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'handle-cleanup-'))
  const handle = await open(path.join(root, 'private.sqlite'), 'w+')
  let fd = handle.fd
  try {
    await expect(closeTransferredFileHandle({ get fd() { return fd }, close: async () => {
      fd = -1
      throw new Error('injected close failure')
    } })).rejects.toMatchObject({ code: 'ARCHIVE_REVIEW_DESCRIPTOR_CLEANUP_FAILED' })
    expect((await handle.stat()).isFile()).toBe(true)
  } finally { await handle.close(); await rm(root, { recursive: true, force: true }) }
})

it('retries a transient close failure while preserving the original owner', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'handle-cleanup-'))
  const handle = await open(path.join(root, 'private.sqlite'), 'w+')
  const close = vi.fn().mockRejectedValueOnce(new Error('transient')).mockImplementation(() => handle.close())
  try {
    await closeTransferredFileHandle({ get fd() { return handle.fd }, close })
    expect(close).toHaveBeenCalledTimes(2)
    expect(handle.fd).toBe(-1)
  } finally { await handle.close(); await rm(root, { recursive: true, force: true }) }
})
