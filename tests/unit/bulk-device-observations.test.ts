import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createBulkDeviceObservationWriter } = require('../../electron/bulk-device-observations.cjs') as {
  createBulkDeviceObservationWriter: (write: (deviceId: string, timestamp: string) => void) => {
    record: (deviceId: string, timestamp: string) => void
    flush: () => void
  }
}

describe('transaction-local device observations [DON-254]', () => {
  it('defers writes and retains the newest normalized timestamp independently per device', () => {
    const write = vi.fn()
    const writer = createBulkDeviceObservationWriter(write)
    writer.record('a', '2026-08-08T12:00:00.000Z')
    writer.record('b', '2026-08-08T08:00:00.000Z')
    writer.record('a', '2026-08-08T10:00:00.000Z')
    writer.record('a', '2026-08-08T12:00:00.000Z')
    writer.record('b', '2026-08-08T09:00:00.000Z')
    expect(write).not.toHaveBeenCalled()
    writer.flush()
    expect(write.mock.calls).toEqual([
      ['a', '2026-08-08T12:00:00.000Z'], ['b', '2026-08-08T09:00:00.000Z'],
    ])
    writer.flush()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('preserves per-device write order around dates outside SQLite four-digit years', () => {
    const write = vi.fn()
    const writer = createBulkDeviceObservationWriter(write)
    writer.record('a', '9999-12-31T23:59:59.999Z')
    writer.record('a', '+010000-01-01T00:00:00.000Z')
    writer.record('a', '2026-08-08T10:00:00.000Z')
    writer.record('b', '-000001-12-31T23:00:00.000Z')
    writer.flush()
    expect(write.mock.calls).toEqual([
      ['a', '9999-12-31T23:59:59.999Z'],
      ['a', '+010000-01-01T00:00:00.000Z'],
      ['b', '-000001-12-31T23:00:00.000Z'],
      ['a', '2026-08-08T10:00:00.000Z'],
    ])
  })
})
