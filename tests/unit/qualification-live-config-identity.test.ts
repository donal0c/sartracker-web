import { mkdtemp, mkdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { hashLiveConfigDirectory } from '../../scripts/qualification/live-config-identity.mjs'

let temporaryRoot: string | undefined

/** Create the exact two-file synthetic live config shape without real credentials. */
async function createConfig() {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sartracker-live-config-'))
  const directory = path.join(temporaryRoot, 'config')
  await mkdir(directory)
  await writeFile(path.join(directory, 'settings.json'), '{"trackingPollIntervalMs":1000}\n')
  await writeFile(path.join(directory, 'credentials.json'), '{"token":"synthetic-marker"}\n')
  return directory
}

afterEach(async () => {
  if (temporaryRoot !== undefined) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = undefined
})

describe('bounded live config directory identity', () => {
  it('returns a canonical directory digest with only safe file metadata', async () => {
    const directory = await createConfig()
    const identity = await hashLiveConfigDirectory(directory)
    expect(identity.path).toBe(path.resolve(directory))
    expect(identity.bytes).toBeGreaterThan(0)
    expect(identity.sha256).toMatch(/^[a-f0-9]{64}$/u)
    expect(identity.files).toEqual([
      expect.objectContaining({ name: 'credentials.json', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
      expect.objectContaining({ name: 'settings.json', bytes: expect.any(Number), sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) }),
    ])
    expect(Object.keys(identity).sort()).toEqual(['bytes', 'files', 'path', 'sha256'])
  })

  it('detects changed member bytes through the canonical digest', async () => {
    const directory = await createConfig()
    const before = await hashLiveConfigDirectory(directory)
    await writeFile(path.join(directory, 'settings.json'), '{"trackingPollIntervalMs":2000}\n')
    const after = await hashLiveConfigDirectory(directory)
    expect(after.sha256).not.toBe(before.sha256)
  })

  it.each([
    ['an extra file', async (directory: string) => writeFile(path.join(directory, 'unexpected.json'), '{}')],
    ['a symlinked member', async (directory: string) => {
      await unlink(path.join(directory, 'credentials.json'))
      await symlink('settings.json', path.join(directory, 'credentials.json'))
    }],
  ])('rejects %s', async (_label, mutate) => {
    const directory = await createConfig()
    await mutate(directory)
    await expect(hashLiveConfigDirectory(directory)).rejects.toThrow(/exact|extra|symlink|config/iu)
  })

  it('rejects a file larger than the bounded JSON input limit before reading it', async () => {
    const directory = await createConfig()
    await writeFile(path.join(directory, 'credentials.json'), `{"marker":"${'x'.repeat(1024 * 1024)}"}`)
    await expect(hashLiveConfigDirectory(directory)).rejects.toThrow(/size|bounded|1.?MiB|large/iu)
  })
})
