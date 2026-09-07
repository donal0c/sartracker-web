import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const { createResponsiveMissionWriter } = require('../../electron/responsive-mission-writer.cjs') as {
  createResponsiveMissionWriter: (database: unknown) => {
    run: <T>(callback: () => T, options?: { signal?: AbortSignal }) => Promise<T>
    close: () => Promise<void>
    readonly pendingCount: number
  }
}
afterEach(() => vi.useRealTimers())

it('rolls back the complete attempt, restores SQLite configuration and preserves admitted write order', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  const order: string[] = []
  let attempts = 0
  try {
    const first = writer.run(() => {
      expect(db.pragma('busy_timeout', { simple: true })).toBe(0)
      db.prepare('INSERT INTO evidence VALUES (?)').run('older')
      if (++attempts === 1) throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY_SNAPSHOT' })
      order.push('older')
    })
    const second = writer.run(() => {
      order.push('newer')
      db.prepare('INSERT INTO evidence VALUES (?)').run('newer')
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(writer.pendingCount).toBe(2)
    await vi.runAllTimersAsync()
    await Promise.all([first, second])
    expect(order).toEqual(['older', 'newer'])
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([{ value: 'older' }, { value: 'newer' }])
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    expect(writer.pendingCount).toBe(0)
  } finally { await writer.close(); db.close() }
})

it.each(['cancel', 'close'] as const)('stops a sleeping attempt on %s and never admits a later stale callback', async (action) => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  const writer = createResponsiveMissionWriter(db)
  const controller = new AbortController()
  const callback = vi.fn(() => { throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' }) })
  try {
    const pending = writer.run(callback, { signal: controller.signal })
    const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    if (action === 'cancel') controller.abort()
    else await writer.close()
    await rejection
    await vi.runAllTimersAsync()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
    if (action === 'close') await expect(writer.run(() => 1)).rejects.toMatchObject({ name: 'AbortError' })
  } finally { await writer.close(); db.close() }
})

it('stops at a finite busy retry budget without committing partial evidence', async () => {
  vi.useFakeTimers()
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  const callback = vi.fn(() => {
    db.prepare('INSERT INTO evidence VALUES (?)').run('partial')
    throw Object.assign(new Error('busy'), { code: 'SQLITE_BUSY' })
  })
  try {
    const pending = writer.run(callback)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SQLITE_BUSY' })
    await vi.runAllTimersAsync()
    await rejection
    expect(callback).toHaveBeenCalledTimes(241)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})

it('does not retry non-busy failures or enter an existing transaction', async () => {
  const db = new Database(':memory:')
  const writer = createResponsiveMissionWriter(db)
  const failure = Object.assign(new Error('invalid evidence'), { code: 'SQLITE_CONSTRAINT' })
  const callback = vi.fn(() => { throw failure })
  try {
    await expect(writer.run(callback)).rejects.toBe(failure)
    expect(callback).toHaveBeenCalledTimes(1)
    db.exec('BEGIN')
    await expect(writer.run(() => 1)).rejects.toThrow(/transaction/)
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})

it('rejects asynchronous callbacks and rolls back a thenable returned by a synchronous callback', async () => {
  const db = new Database(':memory:')
  db.exec('CREATE TABLE evidence (value TEXT)')
  const writer = createResponsiveMissionWriter(db)
  let asynchronousCalled = false
  /** Represents an invalid asynchronous database callback without a mock wrapper. */
  async function asynchronous() { asynchronousCalled = true; return 1 }
  try {
    await expect(writer.run(asynchronous)).rejects.toThrow(/synchronous/)
    expect(asynchronousCalled).toBe(false)
    await expect(writer.run(() => {
      db.prepare('INSERT INTO evidence VALUES (?)').run('partial')
      return Promise.resolve(1)
    })).rejects.toThrow(/synchronous/)
    expect(db.prepare('SELECT * FROM evidence').all()).toEqual([])
    expect(db.inTransaction).toBe(false)
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000)
  } finally { await writer.close(); db.close() }
})
