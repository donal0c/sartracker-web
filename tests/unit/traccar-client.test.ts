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

  it('retries with exponential backoff on transport failure', async () => {
    let attempts = 0
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
      },
      fetchFn,
    )

    const promise = client.getDevices()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toHaveLength(2)
    expect(attempts).toBe(3)
  })
})
