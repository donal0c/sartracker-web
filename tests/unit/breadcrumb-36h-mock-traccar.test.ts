import { createHash } from 'node:crypto'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildBreadcrumb36HourTruthEvidence,
  createBreadcrumb36HourProfile,
  createBreadcrumb36HourSourceDatabase,
  createBreadcrumbPositionDigest,
  startBreadcrumb36HourMockTraccarServer,
} from '../../build/breadcrumb-36h-mock-traccar.js'

describe('deterministic 36-hour mock Traccar', () => {
  const closeServers: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.all(closeServers.splice(0).map((close) => close()))
  })

  it('defines a stable 33-device field profile and streams exact source truth', () => {
    const profile = createBreadcrumb36HourProfile()

    expect(profile).toMatchObject({
      sourceNow: '2026-08-09T12:00:00.000Z',
      sourceFrom: '2026-08-08T00:00:00.000Z',
      lookbackHours: 36,
      deviceCount: 33,
      onlineDeviceCount: 32,
    })
    expect(profile.devices.filter((device) => device.cadenceMs === 5_000)).toHaveLength(8)
    expect(profile.devices.filter((device) => device.cadenceMs === 30_000)).toHaveLength(16)
    expect(profile.devices.filter((device) => device.cadenceMs === 300_000)).toHaveLength(8)
    expect(profile.devices.filter((device) => device.status === 'offline')).toHaveLength(1)

    const first = buildBreadcrumb36HourTruthEvidence(profile)
    const second = buildBreadcrumb36HourTruthEvidence(createBreadcrumb36HourProfile())

    expect(first.totalPositionCount).toBe(279_968)
    expect(first.missingOrDuplicateIdentityCount).toBe(0)
    expect(first).toEqual(second)
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('streams exact truth for the mission-owned sub-window without materializing it', () => {
    const profile = createBreadcrumb36HourProfile()
    const evidence = buildBreadcrumb36HourTruthEvidence(profile, {
      from: '2026-08-08T00:00:01.000Z',
      to: '2026-08-08T00:00:10.000Z',
    })

    expect(evidence).toMatchObject({
      from: '2026-08-08T00:00:01.000Z',
      to: '2026-08-08T00:00:10.000Z',
      totalPositionCount: 16,
    })
    expect(evidence.devices.slice(0, 8).every((device) => device.positionCount === 2)).toBe(true)
    expect(evidence.devices.slice(8, 32).every((device) => device.positionCount === 0)).toBe(true)
    expect(evidence.devices[32]?.positionCount).toBe(0)
  })

  it('exposes a bounded database adapter for the production breadcrumb selector', () => {
    const database = createBreadcrumb36HourSourceDatabase(
      createBreadcrumb36HourProfile(),
      {
        from: '2026-08-08T00:00:01.000Z',
        to: '2026-08-08T00:00:10.000Z',
      },
    )
    const totals = database.prepare('GROUP BY device_id').all('source-truth')
    const positions = [...database
      .prepare('WHERE mission_id = ? AND device_id = ?')
      .iterate('source-truth', '1')]

    expect(totals).toHaveLength(8)
    expect(totals[0]).toEqual({ device_id: '1', total: 2 })
    expect(positions).toEqual([
      expect.objectContaining({
        device_id: '1',
        source_position_id: '1000001',
        timestamp: '2026-08-08T00:00:05.000Z',
      }),
      expect.objectContaining({
        device_id: '1',
        source_position_id: '1000002',
        timestamp: '2026-08-08T00:00:10.000Z',
      }),
    ])
  })

  it('serves inclusive from/to history with globally stable identities and digests', async () => {
    const server = await startBreadcrumb36HourMockTraccarServer()
    closeServers.push(server.close)
    const headers = { Authorization: 'Basic synthetic' }

    const rosterResponse = await fetch(`${server.baseUrl}/api/devices`, { headers })
    const roster = await rosterResponse.json() as readonly {
      readonly id: number
      readonly status: string
    }[]
    expect(roster).toHaveLength(33)
    expect(roster.at(-1)).toMatchObject({ id: 33, status: 'offline' })

    const url = new URL('/api/positions', server.baseUrl)
    url.searchParams.set('deviceId', '1')
    url.searchParams.set('from', '2026-08-08T00:00:00.000Z')
    url.searchParams.set('to', '2026-08-08T00:00:10.000Z')
    const firstResponse = await fetch(url, { headers })
    const first = await firstResponse.json() as readonly {
      readonly id: number
      readonly deviceId: number
      readonly fixTime: string
      readonly latitude: number
      readonly longitude: number
    }[]
    const second = await fetch(url, { headers }).then((response) => response.json())

    expect(first.map((position) => position.fixTime)).toEqual([
      '2026-08-08T00:00:00.000Z',
      '2026-08-08T00:00:05.000Z',
      '2026-08-08T00:00:10.000Z',
    ])
    expect(new Set(first.map((position) => position.id)).size).toBe(3)
    expect(first).toEqual(second)
    expect(createBreadcrumbPositionDigest(first)).toEqual(
      createHash('sha256')
        .update(first.map(toCanonicalPositionLine).join(''))
        .digest('hex'),
    )

    const historyEntries = server.snapshot().requestLedger.filter(
      (entry) => entry.kind === 'history',
    )
    expect(historyEntries).toHaveLength(2)
    expect(historyEntries[0]).toMatchObject({
      deviceId: 1,
      from: '2026-08-08T00:00:00.000Z',
      to: '2026-08-08T00:00:10.000Z',
      outcome: 'success',
      httpStatus: 200,
      returnedCount: 3,
      returnedIdentityDigest: createBreadcrumbPositionDigest(first),
    })
  })

  it('applies deterministic latency and one-shot faults while recording concurrency', async () => {
    const server = await startBreadcrumb36HourMockTraccarServer({
      latencyMs: 25,
      faults: [
        {
          kind: 'history',
          deviceId: 1,
          occurrence: 1,
          status: 503,
        },
      ],
    })
    closeServers.push(server.close)
    const headers = { Authorization: 'Basic synthetic' }
    const historyUrl = (deviceId: number) => {
      const url = new URL('/api/positions', server.baseUrl)
      url.searchParams.set('deviceId', String(deviceId))
      url.searchParams.set('from', '2026-08-08T00:00:00.000Z')
      url.searchParams.set('to', '2026-08-08T02:00:00.000Z')
      return url
    }

    const [failed, healthy] = await Promise.all([
      fetch(historyUrl(1), { headers }),
      fetch(historyUrl(2), { headers }),
    ])
    const retry = await fetch(historyUrl(1), { headers })

    expect(failed.status).toBe(503)
    expect(healthy.status).toBe(200)
    expect(retry.status).toBe(200)
    const snapshot = server.snapshot()
    expect(snapshot.activeRequests).toBe(0)
    expect(snapshot.maximumConcurrentRequests).toBe(2)
    expect(snapshot.activeHistoryRequests).toBe(0)
    expect(snapshot.maximumConcurrentHistoryRequests).toBe(2)
    expect(snapshot.requestLedger.map((entry) => entry.outcome)).toEqual([
      'failure',
      'success',
      'success',
    ])
    expect(snapshot.requestLedger[0]).toMatchObject({
      kind: 'history',
      deviceId: 1,
      httpStatus: 503,
      returnedCount: 0,
      returnedIdentityDigest: null,
      concurrencyAtStart: 1,
      historyConcurrencyAtStart: 1,
    })
    expect(snapshot.requestLedger[1]?.concurrencyAtStart).toBe(2)
    expect(snapshot.requestLedger[1]?.historyConcurrencyAtStart).toBe(2)
    expect(snapshot.requestLedger.every((entry) => entry.durationMs >= 20)).toBe(true)
  })
})

function toCanonicalPositionLine(position: {
  readonly id: number
  readonly deviceId: number
  readonly fixTime: string
  readonly latitude: number
  readonly longitude: number
}): string {
  return [
    position.id,
    position.deviceId,
    position.fixTime,
    position.latitude.toFixed(7),
    position.longitude.toFixed(7),
  ].join('|') + '\n'
}
