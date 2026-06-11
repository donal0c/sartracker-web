import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createCrashLog } = require('../../electron/crash-log.cjs') as {
  readonly createCrashLog: (options: {
    readonly userDataPath: string
    readonly maxEntries?: number
    readonly now?: () => string
  }) => CrashLog
}

type CrashEntry = {
  readonly ts: string
  readonly kind: string
  readonly summary: string
  readonly detail?: string
}

type CrashLog = {
  readonly record: (input: {
    readonly kind: string
    readonly summary: string
    readonly detail?: string
  }) => Promise<void>
  readonly readRecent: (limit?: number) => Promise<readonly CrashEntry[]>
  readonly markCleanExit: () => Promise<void>
  readonly hadUncleanShutdown: () => Promise<boolean>
}

describe('electron crash log', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('records structured crash entries and reads them most-recent-last', async () => {
    const log = await createLog()
    await log.record({ kind: 'uncaughtException', summary: 'TypeError: boom' })
    await log.record({ kind: 'render-process-gone', summary: 'crashed (exit 139)' })

    const entries = await log.readRecent()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ kind: 'uncaughtException', summary: 'TypeError: boom' })
    expect(entries[1]).toMatchObject({ kind: 'render-process-gone' })
  })

  it('caps stored crash entries to the most recent N', async () => {
    const log = await createLog({ maxEntries: 3 })
    for (let index = 0; index < 10; index += 1) {
      await log.record({ kind: 'uncaughtException', summary: `crash ${index}` })
    }

    const entries = await log.readRecent()
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.summary)).toEqual(['crash 7', 'crash 8', 'crash 9'])
  })

  it('redacts secrets and home paths in crash detail', async () => {
    const log = await createLog()
    await log.record({
      kind: 'uncaughtException',
      summary: 'Error opening mission',
      detail: 'at /home/eoc/.config/sartracker-web/mission-store.sqlite token=abc123',
    })

    const entry = (await log.readRecent())[0]!
    expect(String(entry.detail)).not.toContain('eoc')
    expect(String(entry.detail)).toContain('[redacted]')
    expect(String(entry.detail)).not.toContain('abc123')
  })

  it('detects an unclean shutdown until a clean exit is marked', async () => {
    const log = await createLog()
    // A fresh install with no recorded exit is treated as clean (no false alarm).
    await expect(log.hadUncleanShutdown()).resolves.toBe(false)

    await log.markCleanExit()
    await expect(log.hadUncleanShutdown()).resolves.toBe(false)

    // A crash recorded after the last clean exit marks the next start as unclean.
    await log.record({ kind: 'render-process-gone', summary: 'crashed' })
    await expect(log.hadUncleanShutdown()).resolves.toBe(true)

    // Marking a clean exit clears the flag again.
    await log.markCleanExit()
    await expect(log.hadUncleanShutdown()).resolves.toBe(false)
  })

  async function createLog(
    overrides: { readonly maxEntries?: number } = {},
  ): Promise<CrashLog> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-crash-log-'))
    let counter = 0
    return createCrashLog({
      userDataPath,
      maxEntries: overrides.maxEntries,
      now: () => {
        counter += 1
        return new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString()
      },
    })
  }
})
