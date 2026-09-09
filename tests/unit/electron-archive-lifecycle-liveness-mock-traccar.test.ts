import { describe, expect, it } from 'vitest'

import {
  startArchiveLifecycleLivenessMockTraccarServer,
} from '../../build/electron-archive-lifecycle-liveness-mock-traccar.js'

describe('packaged archive-lifecycle liveness mock Traccar [DON-252 / BCP-15]', () => {
  it('emits unique current fixes with an external request/source timing ledger', async () => {
    let nowMs = Date.parse('2026-09-04T08:00:00.000Z')
    const server = await startArchiveLifecycleLivenessMockTraccarServer({
      now: () => {
        nowMs += 1
        return nowMs
      },
    })

    try {
      const session = await fetch(`${server.baseUrl}/api/session`, { method: 'POST' })
      expect(session.status).toBe(200)
      const cookie = session.headers.get('set-cookie')
      expect(cookie).toContain('JSESSIONID=archive-lifecycle-liveness')
      const headers = { Cookie: cookie ?? '' }

      await server.setPhase('create')
      expect(server.readCurrentFixSequence()).toBe(0)
      const first = await fetch(`${server.baseUrl}/api/positions`, { headers })
        .then((response) => response.json()) as Array<Record<string, unknown>>
      const second = await fetch(`${server.baseUrl}/api/positions`, { headers })
        .then((response) => response.json()) as Array<Record<string, unknown>>

      expect(first).toHaveLength(1)
      expect(second).toHaveLength(1)
      expect(first[0]?.id).not.toBe(second[0]?.id)
      expect(first[0]).toMatchObject({
        deviceId: server.deviceId,
        valid: true,
        protocol: 'osmand',
      })

      const snapshot = server.snapshot()
      expect(snapshot.currentFixLedger).toHaveLength(2)
      expect(snapshot.currentFixLedger.map((entry) => entry.sourcePositionId)).toEqual([
        String(first[0]?.id),
        String(second[0]?.id),
      ])
      expect(snapshot.currentFixLedger.every((entry) =>
        entry.phase === 'create'
        && entry.emittedAtMs >= entry.requestStartedAtMs
        && entry.sourceTimestamp === new Date(entry.emittedAtMs).toISOString(),
      )).toBe(true)
      expect(server.readCurrentFixLedger(1)).toEqual([snapshot.currentFixLedger[1]])
      expect(server.readCurrentFixSequence()).toBe(2)

      snapshot.currentFixLedger[0]!.phase = 'cleanup'
      expect(server.snapshot().currentFixLedger[0]?.phase).toBe('create')
      snapshot.currentFixLedger[0]!.phase = 'create'

      expect(server.drainCurrentFixLedger()).toEqual({
        entries: snapshot.currentFixLedger,
        overflowCount: 0,
      })
      expect(server.snapshot().currentFixLedger).toEqual([])
    } finally {
      await server.close()
      await server.close()
    }
  })

  it('bounds an undrained ledger and reports any identity loss fail-closed', async () => {
    const server = await startArchiveLifecycleLivenessMockTraccarServer()
    const headers = { Authorization: 'Basic synthetic' }

    try {
      await server.setPhase('create')
      for (let index = 0; index < 130; index += 1) {
        const response = await fetch(`${server.baseUrl}/api/positions`, { headers })
        expect(response.status).toBe(200)
      }

      const snapshot = server.snapshot()
      expect(snapshot.currentFixRequestCount).toBe(130)
      expect(snapshot.currentFixLedger).toHaveLength(128)
      expect(snapshot.currentFixLedgerOverflowCount).toBe(2)
      const drained = server.drainCurrentFixLedger()
      expect(drained.entries).toHaveLength(128)
      expect(drained.overflowCount).toBe(2)
      expect(server.drainCurrentFixLedger()).toEqual({ entries: [], overflowCount: 0 })
    } finally {
      await server.close()
    }
  })

  it('supports the complete production HTTP shape without treating history as current fixes', async () => {
    const server = await startArchiveLifecycleLivenessMockTraccarServer()
    const headers = { Authorization: 'Basic synthetic' }

    try {
      const unauthorized = await fetch(`${server.baseUrl}/api/devices`)
      expect(unauthorized.status).toBe(401)
      await expect(fetch(`${server.baseUrl}/api/groups`, { headers })
        .then((response) => response.json())).resolves.toEqual([])
      await expect(fetch(`${server.baseUrl}/api/devices`, { headers })
        .then((response) => response.json())).resolves.toEqual([
        expect.objectContaining({ id: server.deviceId, status: 'online' }),
      ])
      await expect(fetch(
        `${server.baseUrl}/api/positions?deviceId=${server.deviceId}&from=2026-09-04T07%3A00%3A00.000Z&to=2026-09-04T08%3A00%3A00.000Z`,
        { headers },
      ).then((response) => response.json())).resolves.toEqual([])
      await expect(fetch(`${server.baseUrl}/api/positions`, { headers })
        .then((response) => response.json())).resolves.toHaveLength(1)
      expect(server.snapshot().currentFixLedger).toEqual([])

      await expect(server.setPhase('invalid')).rejects.toThrow(/liveness phase/iu)
    } finally {
      await server.close()
    }
  })
})
