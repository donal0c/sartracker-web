import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createRuntimeLog } = require('../../electron/runtime-log.cjs') as {
  readonly createRuntimeLog: (options: {
    readonly userDataPath: string
    readonly maxBytes?: number
    readonly now?: () => string
  }) => RuntimeLog
}

type RuntimeLogEntry = {
  readonly ts: string
  readonly level: string
  readonly event: string
  readonly [key: string]: unknown
}

type RuntimeLog = {
  readonly append: (input: {
    readonly level: string
    readonly event: string
    readonly fields?: Record<string, unknown>
  }) => Promise<void>
  readonly readRecent: (limit?: number) => Promise<readonly RuntimeLogEntry[]>
  readonly logFilePath: string
}

describe('electron runtime log', () => {
  let userDataPath: string | null = null

  afterEach(async () => {
    if (userDataPath !== null) {
      await rm(userDataPath, { recursive: true, force: true })
      userDataPath = null
    }
  })

  it('appends structured JSON-line entries with timestamp and level', async () => {
    const log = await createLog()
    await log.append({ level: 'info', event: 'app_start', fields: { version: '0.1.0' } })
    await log.append({ level: 'warn', event: 'tracking_disconnected' })

    const entries = await log.readRecent()
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ level: 'info', event: 'app_start', version: '0.1.0' })
    expect(entries[1]).toMatchObject({ level: 'warn', event: 'tracking_disconnected' })
    expect(typeof entries[0]?.ts).toBe('string')
  })

  it('redacts secret-bearing fields and usernames in file-system paths', async () => {
    const log = await createLog()
    await log.append({
      level: 'info',
      event: 'settings_saved',
      fields: {
        token: 'super-secret-value',
        apiPassword: 'hunter2',
        databasePath: '/home/eoc/.config/sartracker-web/mission-store.sqlite',
      },
    })

    const entries = await log.readRecent()
    const entry = entries[0]!
    expect(entry.token).toBe('[redacted]')
    expect(entry.apiPassword).toBe('[redacted]')
    expect(String(entry.databasePath)).not.toContain('eoc')
    expect(String(entry.databasePath)).toContain('[redacted]')
  })

  it('recursively redacts nested secrets, auth headers, and URL credentials [DON-237]', async () => {
    const log = await createLog()
    await log.append({
      level: 'warn',
      event: 'support_bundle_requested',
      fields: {
        request: {
          headers: {
            Authorization: 'Bearer bearer-secret',
          },
          url: 'https://operator:field-secret@kmrtsar.eu/api/devices',
          nested: [{ password: 'nested-secret' }],
        },
      },
    })

    const [entry] = await log.readRecent()
    const serialized = JSON.stringify(entry)
    expect(serialized).not.toContain('bearer-secret')
    expect(serialized).not.toContain('field-secret')
    expect(serialized).not.toContain('nested-secret')
    expect(serialized).toContain('[redacted]')
  })

  it('rotates the log when it exceeds the size cap and keeps recent entries readable', async () => {
    const log = await createLog({ maxBytes: 512 })
    for (let index = 0; index < 100; index += 1) {
      await log.append({ level: 'info', event: 'tick', fields: { index } })
    }

    // The live log file must stay bounded near the cap (plus one backup).
    const liveSize = (await stat(log.logFilePath)).size
    expect(liveSize).toBeLessThanOrEqual(512 * 2)

    // Most recent events survive rotation.
    const entries = await log.readRecent(5)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.at(-1)).toMatchObject({ event: 'tick', index: 99 })
  })

  it('returns an empty list when no log file exists yet', async () => {
    const log = await createLog()
    await expect(log.readRecent()).resolves.toEqual([])
  })

  async function createLog(
    overrides: { readonly maxBytes?: number } = {},
  ): Promise<RuntimeLog> {
    userDataPath = await mkdtemp(path.join(tmpdir(), 'sartracker-runtime-log-'))
    let counter = 0
    return createRuntimeLog({
      userDataPath,
      maxBytes: overrides.maxBytes,
      // Deterministic, monotonically increasing timestamps for ordering assertions.
      now: () => {
        counter += 1
        return new Date(Date.UTC(2026, 0, 1, 0, 0, counter)).toISOString()
      },
    })
  }

  it('writes entries under a logs/ subdirectory of userData', async () => {
    const log = await createLog()
    await log.append({ level: 'info', event: 'app_start' })
    expect(log.logFilePath.includes(`${path.sep}logs${path.sep}`)).toBe(true)
    await expect(readFile(log.logFilePath, 'utf8')).resolves.toContain('app_start')
  })
})
