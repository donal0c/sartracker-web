import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import devicesFixture from '../fixtures/traccar-devices.json'
import positionsFixture from '../fixtures/traccar-positions.json'
import breadcrumbsFixture from '../fixtures/traccar-breadcrumbs.json'
import { createTraccarClient, type TraccarFetch } from '../../src/features/tracking/traccar-client'

function createJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    ...init,
  })
}

describe('traccar client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('authenticates via session and reuses the session cookie', async () => {
    const capturedHeaders: Record<string, string>[] = []
    const fetchFn: TraccarFetch = vi.fn(async (url, init) => {
      const parsed = new URL(url)

      if (parsed.pathname === '/api/session') {
        return createJsonResponse({}, {
          headers: {
            'Set-Cookie': 'JSESSIONID=session-123; Path=/',
          },
        })
      }

      capturedHeaders.push(init?.headers as Record<string, string>)
      return createJsonResponse(devicesFixture)
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082/',
        email: 'test@example.com',
        password: 'secret',
      },
      fetchFn,
    )

    await client.authenticate()
    await client.getDevices()

    expect(fetchFn).toHaveBeenCalledWith(
      'http://test:8082/api/session',
      expect.objectContaining({
        method: 'POST',
      }),
    )
    expect(capturedHeaders[0].Cookie).toBe('JSESSIONID=session-123')
  })

  it('reauthenticates with a fresh session when the stored session cookie expires [DON-234]', async () => {
    const capturedHeaders: Record<string, string>[] = []
    let sessionAttempt = 0
    const fetchFn: TraccarFetch = vi.fn(async (url, init) => {
      const parsed = new URL(url)

      if (parsed.pathname === '/api/session') {
        sessionAttempt += 1
        return createJsonResponse({}, {
          headers: {
            'Set-Cookie': `JSESSIONID=session-${sessionAttempt}; Path=/`,
          },
        })
      }

      capturedHeaders.push(init?.headers as Record<string, string>)
      if (capturedHeaders.length === 1) {
        return createJsonResponse({ error: 'expired' }, { status: 401, statusText: 'Unauthorized' })
      }

      return createJsonResponse(devicesFixture)
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082/',
        email: 'test@example.com',
        password: 'secret',
        maxRetries: 0,
      },
      fetchFn,
    )

    await client.authenticate()
    await expect(client.getDevices()).resolves.toHaveLength(2)

    expect(fetchFn).toHaveBeenCalledWith('http://test:8082/api/session', expect.objectContaining({
      method: 'POST',
    }))
    expect(capturedHeaders.map((headers) => headers.Cookie)).toEqual([
      'JSESSIONID=session-1',
      'JSESSIONID=session-2',
    ])
  })

  it('clears request timeout handles when fetch rejects [DON-234]', async () => {
    const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout')
    const fetchFn: TraccarFetch = vi.fn(async () => {
      throw new Error('network down')
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082',
        maxRetries: 0,
      },
      fetchFn,
    )

    await expect(client.getDevices()).rejects.toThrow(/network down/)
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to basic auth when no session is present', async () => {
    const capturedHeaders: Record<string, string>[] = []
    const fetchFn: TraccarFetch = vi.fn(async (_url, init) => {
      capturedHeaders.push(init?.headers as Record<string, string>)
      return createJsonResponse(devicesFixture)
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082',
        email: 'test@example.com',
        password: 'secret',
      },
      fetchFn,
    )

    await client.getDevices()

    expect(capturedHeaders[0].Authorization).toMatch(/^Basic /)
  })

  it('uses bearer auth when a token is configured', async () => {
    const capturedHeaders: Record<string, string>[] = []
    const fetchFn: TraccarFetch = vi.fn(async (_url, init) => {
      capturedHeaders.push(init?.headers as Record<string, string>)
      return createJsonResponse(devicesFixture)
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082',
        token: 'token-123',
      },
      fetchFn,
    )

    await client.getDevices()

    expect(capturedHeaders[0].Authorization).toBe('Bearer token-123')
  })

  it('normalizes devices and current positions', async () => {
    const fetchFn: TraccarFetch = vi.fn(async (url) => {
      const parsed = new URL(url)
      if (parsed.pathname === '/api/devices') {
        return createJsonResponse(devicesFixture)
      }

      return createJsonResponse(positionsFixture)
    })

    const client = createTraccarClient({ baseUrl: 'http://test:8082' }, fetchFn)
    const devices = await client.getDevices()
    const positions = await client.getCurrentPositions()

    expect(devices[0].device_id).toBe('1')
    expect(positions[0].device_id).toBe('1')
    expect(positions[0].battery).toBe(85)
  })

  it('loads and normalizes the Traccar group roster [DON-271]', async () => {
    const fetchFn: TraccarFetch = vi.fn(async (url) => {
      expect(new URL(url).pathname).toBe('/api/groups')
      return createJsonResponse([
        { id: 12, name: 'Kerry MRT', groupId: 4 },
        { id: 'broken', name: 'Malformed' },
      ])
    })
    const logger = { warn: vi.fn() }
    const client = createTraccarClient({ baseUrl: 'http://test:8082', logger }, fetchFn)

    await expect(client.getGroups()).resolves.toEqual([
      { group_id: '12', name: 'Kerry MRT', parent_group_id: '4' },
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar group row.',
      expect.objectContaining({ endpoint: '/api/groups', rowIndex: 1 }),
    )
  })

  it('preserves valid devices while warning about malformed device rows [DON-206]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        devicesFixture[0],
        {
          ...devicesFixture[1],
          id: 'not-a-device-id',
        },
      ]),
    )

    const config = { baseUrl: 'http://test:8082', logger }
    const client = createTraccarClient(config, fetchFn)

    await expect(client.getDevices()).resolves.toEqual([
      expect.objectContaining({ device_id: '1' }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar device row.',
      expect.objectContaining({
        endpoint: '/api/devices',
        rowIndex: 1,
        reason: expect.stringMatching(/device id/i),
      }),
    )
  })

  it('marks a normalized roster incomplete when any Traccar device row is rejected [DON-271]', async () => {
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        devicesFixture[0],
        { ...devicesFixture[1], id: 'not-a-device-id' },
      ]),
    )
    const client = createTraccarClient({ baseUrl: 'http://test:8082' }, fetchFn)

    await expect(client.getDevicesWithReport()).resolves.toEqual({
      accepted: [expect.objectContaining({ device_id: '1' })],
      complete: false,
    })
  })

  it('preserves valid current positions while warning about malformed rows [DON-206]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        positionsFixture[0],
        {
          ...positionsFixture[1],
          latitude: 200,
        },
      ]),
    )

    const config = { baseUrl: 'http://test:8082', logger }
    const client = createTraccarClient(config, fetchFn)

    await expect(client.getCurrentPositions()).resolves.toEqual([
      expect.objectContaining({ device_id: '1' }),
    ])
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar position row.',
      expect.objectContaining({
        endpoint: '/api/positions',
        rowIndex: 1,
        reason: expect.stringMatching(/latitude/i),
      }),
    )
  })

  it('returns structured per-device rejections without withholding valid current fixes [DON-267]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        positionsFixture[0],
        {
          ...positionsFixture[1],
          latitude: 200,
        },
        {
          ...positionsFixture[1],
          id: 9_999,
          deviceId: null,
        },
      ]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger },
      fetchFn,
    )

    await expect(client.getCurrentPositionsWithReport()).resolves.toEqual({
      accepted: [expect.objectContaining({ device_id: '1' })],
      rejected: [
        expect.objectContaining({
          deviceId: '2',
          reason: 'invalid_coordinates',
          rowIndex: 1,
          anomalyKey: expect.stringMatching(/^source:/u),
          sourcePositionId: expect.any(String),
          canonicalEvidence: expect.objectContaining({
            device_id: '2',
            latitude: 200,
          }),
        }),
        expect.objectContaining({
          deviceId: null,
          reason: 'invalid_identity',
          rowIndex: 2,
          anomalyKey: expect.stringMatching(
            /^source:9999:reason:invalid_identity:content:[a-f0-9]{16}$/u,
          ),
          sourcePositionId: '9999',
          canonicalEvidence: expect.objectContaining({
            source_position_id: '9999',
            device_id: null,
          }),
        }),
      ],
    })
  })

  it('fails current positions explicitly when every returned row is malformed [DON-206]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        {
          ...positionsFixture[0],
          latitude: 200,
        },
      ]),
    )

    const config = { baseUrl: 'http://test:8082', logger }
    const client = createTraccarClient(config, fetchFn)

    await expect(client.getCurrentPositions()).rejects.toThrow(
      /No valid Traccar position rows were returned from \/api\/positions/,
    )
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar position row.',
      expect.objectContaining({
        endpoint: '/api/positions',
        rowIndex: 0,
      }),
    )
  })

  it('returns every structured rejection when no valid current fix exists [DON-268]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        {
          ...positionsFixture[0],
          latitude: 200,
        },
      ]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger },
      fetchFn,
    )

    await expect(client.getCurrentPositionsWithReport()).resolves.toEqual({
      accepted: [],
      rejected: [
        expect.objectContaining({
          deviceId: '1',
          reason: 'invalid_coordinates',
          rowIndex: 0,
          anomalyKey: expect.stringMatching(/^source:/u),
        }),
      ],
    })
  })

  it('fetches breadcrumbs with from/to query parameters', async () => {
    const fetchFn: TraccarFetch = vi.fn(async (url) => {
      const parsed = new URL(url)
      expect(parsed.pathname).toBe('/api/positions')
      expect(parsed.searchParams.get('deviceId')).toBe('1')
      expect(parsed.searchParams.get('from')).toBe('2026-04-06T10:00:00.000Z')
      expect(parsed.searchParams.get('to')).toBe('2026-04-06T10:30:00.000Z')

      return createJsonResponse(breadcrumbsFixture)
    })

    const client = createTraccarClient({ baseUrl: 'http://test:8082' }, fetchFn)
    const breadcrumbs = await client.getBreadcrumbs(
      '1',
      new Date('2026-04-06T10:00:00.000Z'),
      new Date('2026-04-06T10:30:00.000Z'),
    )

    expect(breadcrumbs).toHaveLength(3)
  })

  it('cancels an obsolete breadcrumb transport without retrying it [DON-267]', async () => {
    const fetchFn: TraccarFetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new DOMException('Aborted.', 'AbortError'))
      }, { once: true })
    }))
    const client = createTraccarClient({
      baseUrl: 'http://test:8082',
      maxRetries: 3,
    }, fetchFn)
    const controller = new AbortController()

    const request = client.getBreadcrumbs(
      '1',
      new Date('2026-08-27T08:00:00.000Z'),
      new Date('2026-08-27T09:00:00.000Z'),
      controller.signal,
    )
    controller.abort(new DOMException('Mission superseded.', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('preserves valid breadcrumbs while warning about malformed breadcrumb rows [DON-206]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        breadcrumbsFixture[0],
        {
          ...breadcrumbsFixture[1],
          fixTime: 'not-a-date',
        },
      ]),
    )

    const config = { baseUrl: 'http://test:8082', logger }
    const client = createTraccarClient(config, fetchFn)
    const breadcrumbs = await client.getBreadcrumbs(
      '1',
      new Date('2026-04-06T10:00:00.000Z'),
      new Date('2026-04-06T10:30:00.000Z'),
    )

    expect(breadcrumbs).toEqual([expect.objectContaining({ id: '200' })])
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar breadcrumb row.',
      expect.objectContaining({
        endpoint: '/api/positions',
        deviceId: '1',
        rowIndex: 1,
        reason: expect.stringMatching(/fixTime/i),
      }),
    )
  })

  it('rejects device/server-time substitution from exact breadcrumb history [DON-267] [SAR-QA-021]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        breadcrumbsFixture[0],
        {
          ...breadcrumbsFixture[1],
          fixTime: undefined,
          deviceTime: '2026-04-06T10:15:00.000Z',
          serverTime: '2026-04-06T10:15:01.000Z',
        },
      ]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger },
      fetchFn,
    )

    await expect(client.getBreadcrumbsWithReport(
      '1',
      new Date('2026-04-06T10:00:00.000Z'),
      new Date('2026-04-06T10:30:00.000Z'),
    )).resolves.toEqual({
      accepted: [expect.objectContaining({ id: '200', timestamp_source: 'fix' })],
      rejected: [expect.objectContaining({
        deviceId: '1',
        reason: 'invalid_timestamp',
        rowIndex: 1,
        anomalyKey: expect.stringMatching(/^source:/u),
      })],
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'Dropped malformed Traccar breadcrumb row.',
      expect.objectContaining({
        deviceId: '1',
        rowIndex: 1,
        reason: expect.stringMatching(/fixTime.*required/i),
      }),
    )
  })

  it('rejects a row returned for a different device than the scoped history request [DON-267]', async () => {
    const requestedDeviceRow = { ...breadcrumbsFixture[0], deviceId: 1 }
    const wrongDeviceRow = { ...breadcrumbsFixture[1], deviceId: 2 }
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger: { warn: vi.fn() } },
      vi.fn(async () => createJsonResponse([requestedDeviceRow, wrongDeviceRow])),
    )

    await expect(client.getBreadcrumbsWithReport(
      '1',
      new Date('2026-04-06T10:00:00.000Z'),
      new Date('2026-04-06T10:30:00.000Z'),
    )).resolves.toEqual({
      accepted: [expect.objectContaining({ id: String(requestedDeviceRow.id), device_id: '1' })],
      rejected: [expect.objectContaining({
        deviceId: '2',
        reason: 'invalid_identity',
        rowIndex: 1,
      })],
    })
  })

  it('fails a device breadcrumb window when every returned row is malformed [DON-260]', async () => {
    const logger = { warn: vi.fn() }
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([
        {
          ...breadcrumbsFixture[0],
          latitude: null,
        },
      ]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger },
      fetchFn,
    )

    await expect(
      client.getBreadcrumbs(
        '1',
        new Date('2026-04-06T10:00:00.000Z'),
        new Date('2026-04-06T10:30:00.000Z'),
      ),
    ).rejects.toThrow(/1 source row was rejected.*invalid coordinates/i)
  })

  it('bounds malformed-row diagnostics while reporting the full drop count [DON-260]', async () => {
    const logger = { warn: vi.fn() }
    const malformedRows = Array.from({ length: 10 }, (_, index) => ({
      ...positionsFixture[0],
      id: 10_000 + index,
      latitude: 200,
    }))
    const fetchFn: TraccarFetch = vi.fn(async () =>
      createJsonResponse([positionsFixture[0], ...malformedRows]),
    )
    const client = createTraccarClient(
      { baseUrl: 'http://test:8082', logger },
      fetchFn,
    )

    await expect(client.getCurrentPositions()).resolves.toHaveLength(1)

    expect(logger.warn).toHaveBeenCalledTimes(4)
    expect(logger.warn).toHaveBeenLastCalledWith(
      'Dropped additional malformed Traccar rows.',
      {
        endpoint: '/api/positions',
        droppedCount: 10,
        detailedWarningCount: 3,
      },
    )
  })

  it('retries with exponential backoff on transport failure', async () => {
    let attempts = 0
    const recordRequestDiagnostic = vi.fn()
    const fetchFn: TraccarFetch = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) {
        throw new Error('network down')
      }

      return createJsonResponse(devicesFixture)
    })

    const client = createTraccarClient(
      {
        baseUrl: 'http://test:8082',
        maxRetries: 2,
        retryBaseMs: 1_000,
        recordRequestDiagnostic,
      },
      fetchFn,
    )

    const promise = client.getDevices()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toHaveLength(2)
    expect(attempts).toBe(3)
    expect(recordRequestDiagnostic).toHaveBeenCalledTimes(3)
    expect(recordRequestDiagnostic).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'request_attempt',
        outcome: 'failure',
        phase: 'devices',
        attempt: 1,
        maxAttempts: 3,
        failureKind: 'network',
      }),
    )
    expect(recordRequestDiagnostic).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'request_attempt',
        outcome: 'recovered',
        phase: 'devices',
        attempt: 3,
        failureKind: 'network',
      }),
    )
  })
})
