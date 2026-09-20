import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { streamCommandToFile } from '../../scripts/qualification/release-transfer.mjs'

let temporaryRoot: string | undefined

/** Run a synthetic Node stdout producer without shell interpolation. */
function nodeProducer(source: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ['-e', source] }
}

/** Hash bytes used by an exact transfer assertion. */
function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('bounded release transfer', () => {
  it('streams exact bytes into an exclusive file and returns its hash', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-transfer-'))
    const destination = path.join(temporaryRoot, 'asset.bin')
    const result = await streamCommandToFile({
      ...nodeProducer("process.stdout.write('synthetic-release-bytes')"),
      destination,
      expectedBytes: 23,
    })
    expect(result).toMatchObject({ bytes: 23, sha256: sha256('synthetic-release-bytes'), zeroDescendantsAfterRun: true })
    expect(await readFile(destination, 'utf8')).toBe('synthetic-release-bytes')
  })

  it('rejects short and oversized output and removes the partial destination', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-transfer-'))
    const short = path.join(temporaryRoot, 'short.bin')
    await expect(streamCommandToFile({
      ...nodeProducer("process.stdout.write('short')"),
      destination: short,
      expectedBytes: 10,
    })).rejects.toThrow(/bytes|expected/iu)
    await expect(access(short)).rejects.toMatchObject({ code: 'ENOENT' })

    const oversized = path.join(temporaryRoot, 'oversized.bin')
    await expect(streamCommandToFile({
      ...nodeProducer("process.stdout.write('oversized')"),
      destination: oversized,
      expectedBytes: 4,
    })).rejects.toThrow(/bound|bytes|large/iu)
    await expect(access(oversized)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('terminates a TERM-ignoring producer process group on timeout and reaps descendants', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-transfer-'))
    const destination = path.join(temporaryRoot, 'hung.bin')
    const producer = nodeProducer([
      "const { spawn } = require('node:child_process')",
      "spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
      "process.on('SIGTERM', () => {})",
      "setInterval(() => process.stdout.write('x'), 10)",
    ].join(';'))
    await expect(streamCommandToFile({
      ...producer,
      destination,
      expectedBytes: 1024 * 1024,
      timeoutMs: 100,
      terminationGraceMs: 50,
      cleanupTimeoutMs: 1000,
    })).rejects.toThrow(/deadline|timeout|bound/iu)
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite a pre-existing destination before starting a producer', async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-release-transfer-'))
    const destination = path.join(temporaryRoot, 'existing.bin')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(destination, 'existing')
    await expect(streamCommandToFile({
      ...nodeProducer("process.stdout.write('replacement')"),
      destination,
      expectedBytes: 10,
    })).rejects.toThrow(/exists|exclusive/iu)
    expect(await readFile(destination, 'utf8')).toBe('existing')
  })
})
