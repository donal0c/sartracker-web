import path from 'node:path'
import { createRequire } from 'node:module'

import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { removeFileDurably, writeFileDurably } = require('../../electron/durable-file.cjs') as {
  readonly removeFileDurably: (
    filePath: string,
    options: DurableFileOptions,
  ) => Promise<void>
  readonly writeFileDurably: (
    filePath: string,
    contents: string,
    options: DurableFileOptions,
  ) => Promise<void>
}

type DurableFileHandle = {
  readonly writeFile: ReturnType<typeof vi.fn>
  readonly sync: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
}

type DurableFileSystem = {
  readonly open: ReturnType<typeof vi.fn>
  readonly rename: ReturnType<typeof vi.fn>
  readonly rm: ReturnType<typeof vi.fn>
}

type DurableFileOptions = {
  readonly fileSystem: DurableFileSystem
  readonly platform: string
  readonly createTemporarySuffix: () => string
}

describe('durable file operations', () => {
  it('fsyncs file contents and the containing directory around atomic replacement [DON-276]', async () => {
    const fileHandle = createHandle()
    const directoryHandle = createHandle()
    const fileSystem = createFileSystem(fileHandle, directoryHandle)
    const filePath = '/profile/crashes/active-session'

    await writeFileDurably(filePath, 'session-start', {
      fileSystem,
      platform: 'linux',
      createTemporarySuffix: () => 'test-write',
    })

    const temporaryPath = `${filePath}.test-write.tmp`
    expect(fileSystem.open).toHaveBeenNthCalledWith(1, temporaryPath, 'wx', 0o600)
    expect(fileHandle.writeFile).toHaveBeenCalledWith('session-start', 'utf8')
    expect(fileHandle.sync).toHaveBeenCalledOnce()
    expect(fileHandle.close).toHaveBeenCalledOnce()
    expect(fileSystem.rename).toHaveBeenCalledWith(temporaryPath, filePath)
    expect(fileSystem.open).toHaveBeenNthCalledWith(2, path.dirname(filePath), 'r')
    expect(directoryHandle.sync).toHaveBeenCalledOnce()
    expect(directoryHandle.close).toHaveBeenCalledOnce()
  })

  it('fsyncs the containing directory after durable removal [DON-276]', async () => {
    const directoryHandle = createHandle()
    const fileSystem = createFileSystem(directoryHandle)
    const filePath = '/profile/crashes/active-session'

    await removeFileDurably(filePath, {
      fileSystem,
      platform: 'linux',
      createTemporarySuffix: () => 'unused',
    })

    expect(fileSystem.rm).toHaveBeenCalledWith(filePath, { force: true })
    expect(fileSystem.open).toHaveBeenCalledWith(path.dirname(filePath), 'r')
    expect(directoryHandle.sync).toHaveBeenCalledOnce()
    expect(directoryHandle.close).toHaveBeenCalledOnce()
  })
})

function createHandle(): DurableFileHandle {
  return {
    writeFile: vi.fn(async () => undefined),
    sync: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  }
}

function createFileSystem(...handles: DurableFileHandle[]): DurableFileSystem {
  return {
    open: vi.fn(async () => handles.shift() ?? createHandle()),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
  }
}
