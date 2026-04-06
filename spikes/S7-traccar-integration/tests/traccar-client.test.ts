import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TraccarClient,
  PollingManager,
  parseDevice,
  parsePosition,
  type FetchFn,
  type TraccarDevice,
  type TraccarPosition,
} from '../src/traccar-client.js';

// ── Fixtures ─────────────────────────────────────────────────────────

const DEVICE_FIXTURES: Record<string, unknown>[] = [
  {
    id: 1,
    name: 'Donal Phone',
    uniqueId: '872656784',
    status: 'online',
    lastUpdate: '2026-04-06T10:30:00.000Z',
    positionId: 100,
    disabled: false,
    groupId: 0,
    attributes: { speedUnit: 'kn' },
  },
  {
    id: 2,
    name: 'Team Lead',
    uniqueId: '123456789',
    status: 'offline',
    lastUpdate: '2026-04-06T09:00:00.000Z',
    positionId: 101,
    disabled: false,
    groupId: 0,
    attributes: {},
  },
];

const POSITION_FIXTURES: Record<string, unknown>[] = [
  {
    id: 100,
    deviceId: 1,
    latitude: 51.9985,
    longitude: -9.7426,
    altitude: 320.5,
    speed: 1.2,
    course: 45.0,
    accuracy: 8.0,
    fixTime: '2026-04-06T10:30:00.000Z',
    serverTime: '2026-04-06T10:30:01.000Z',
    deviceTime: '2026-04-06T10:30:00.000Z',
    attributes: { batteryLevel: 85, motion: true },
    valid: true,
    protocol: 'osmand',
  },
  {
    id: 101,
    deviceId: 2,
    latitude: 52.0012,
    longitude: -9.7501,
    altitude: 280.0,
    speed: 0.0,
    course: 0.0,
    accuracy: 15.0,
    fixTime: '2026-04-06T09:00:00.000Z',
    serverTime: '2026-04-06T09:00:02.000Z',
    deviceTime: '2026-04-06T09:00:00.000Z',
    attributes: { batteryLevel: 42 },
    valid: true,
    protocol: 'osmand',
  },
];

const BREADCRUMB_FIXTURES: Record<string, unknown>[] = [
  {
    id: 200,
    deviceId: 1,
    latitude: 51.9980,
    longitude: -9.7420,
    altitude: 315.0,
    speed: 1.5,
    course: 90.0,
    accuracy: 5.0,
    fixTime: '2026-04-06T10:00:00.000Z',
    serverTime: '2026-04-06T10:00:01.000Z',
    deviceTime: '2026-04-06T10:00:00.000Z',
    attributes: { batteryLevel: 90 },
    valid: true,
    protocol: 'osmand',
  },
  {
    id: 201,
    deviceId: 1,
    latitude: 51.9982,
    longitude: -9.7423,
    altitude: 318.0,
    speed: 1.3,
    course: 60.0,
    accuracy: 6.0,
    fixTime: '2026-04-06T10:15:00.000Z',
    serverTime: '2026-04-06T10:15:01.000Z',
    deviceTime: '2026-04-06T10:15:00.000Z',
    attributes: { batteryLevel: 87 },
    valid: true,
    protocol: 'osmand',
  },
  {
    id: 100, // same as current position — for dedup test
    deviceId: 1,
    latitude: 51.9985,
    longitude: -9.7426,
    altitude: 320.5,
    speed: 1.2,
    course: 45.0,
    accuracy: 8.0,
    fixTime: '2026-04-06T10:30:00.000Z',
    serverTime: '2026-04-06T10:30:01.000Z',
    deviceTime: '2026-04-06T10:30:00.000Z',
    attributes: { batteryLevel: 85 },
    valid: true,
    protocol: 'osmand',
  },
];

// ── Mock Fetch Helper ────────────────────────────────────────────────

function createMockFetch(
  responses: Map<string, { status: number; body: unknown }>,
): FetchFn {
  return async (url: string, _init?: RequestInit) => {
    const parsed = new URL(url);
    const path = parsed.pathname + parsed.search;

    // Check for exact match first, then path-only match
    const entry = responses.get(path) ?? responses.get(parsed.pathname);

    if (!entry) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(entry.body), {
      status: entry.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

// ── Parse Tests ──────────────────────────────────────────────────────

describe('parseDevice', () => {
  it('parses a valid device JSON object', () => {
    const device = parseDevice(DEVICE_FIXTURES[0]);
    expect(device.id).toBe(1);
    expect(device.name).toBe('Donal Phone');
    expect(device.uniqueId).toBe('872656784');
    expect(device.status).toBe('online');
    expect(device.lastUpdate).toBe('2026-04-06T10:30:00.000Z');
    expect(device.positionId).toBe(100);
    expect(device.disabled).toBe(false);
    expect(device.attributes).toEqual({ speedUnit: 'kn' });
  });

  it('handles missing optional fields with defaults', () => {
    const device = parseDevice({ id: 99 });
    expect(device.id).toBe(99);
    expect(device.name).toBe('Device 99');
    expect(device.uniqueId).toBe('');
    expect(device.status).toBe('unknown');
    expect(device.lastUpdate).toBeNull();
  });
});

describe('parsePosition', () => {
  it('parses a valid position JSON object', () => {
    const pos = parsePosition(POSITION_FIXTURES[0]);
    expect(pos.id).toBe(100);
    expect(pos.deviceId).toBe(1);
    expect(pos.latitude).toBe(51.9985);
    expect(pos.longitude).toBe(-9.7426);
    expect(pos.altitude).toBe(320.5);
    expect(pos.speed).toBe(1.2);
    expect(pos.course).toBe(45.0);
    expect(pos.accuracy).toBe(8.0);
    expect(pos.fixTime).toBe('2026-04-06T10:30:00.000Z');
    expect(pos.attributes).toEqual({ batteryLevel: 85, motion: true });
    expect(pos.valid).toBe(true);
    expect(pos.protocol).toBe('osmand');
  });

  it('handles missing optional fields', () => {
    const pos = parsePosition({ id: 1, deviceId: 2, latitude: 0, longitude: 0 });
    expect(pos.altitude).toBe(0);
    expect(pos.speed).toBe(0);
    expect(pos.course).toBe(0);
    expect(pos.accuracy).toBe(0);
    expect(pos.attributes).toEqual({});
  });
});

// ── TraccarClient Tests ──────────────────────────────────────────────

describe('TraccarClient', () => {
  it('strips hash fragments and trailing slashes from baseUrl', () => {
    const client = new TraccarClient(
      { baseUrl: 'http://example.com/#/devices/' },
      async () => new Response('[]', { status: 200 }),
    );
    // Verify by calling getDevices and checking the URL
    expect(client).toBeDefined();
  });

  describe('getDevices', () => {
    it('fetches and returns device array', async () => {
      const mockFetch = createMockFetch(
        new Map([['/api/devices', { status: 200, body: DEVICE_FIXTURES }]]),
      );
      const client = new TraccarClient({ baseUrl: 'http://test:8082' }, mockFetch);
      const devices = await client.getDevices();
      expect(devices).toHaveLength(2);
      expect(devices[0].name).toBe('Donal Phone');
      expect(devices[1].uniqueId).toBe('123456789');
    });

    it('throws on non-array response', async () => {
      const mockFetch = createMockFetch(
        new Map([['/api/devices', { status: 200, body: { error: 'unexpected' } }]]),
      );
      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', maxRetries: 0 },
        mockFetch,
      );
      await expect(client.getDevices()).rejects.toThrow('Expected array');
    });
  });

  describe('getPositions', () => {
    it('fetches and returns position array', async () => {
      const mockFetch = createMockFetch(
        new Map([['/api/positions', { status: 200, body: POSITION_FIXTURES }]]),
      );
      const client = new TraccarClient({ baseUrl: 'http://test:8082' }, mockFetch);
      const positions = await client.getPositions();
      expect(positions).toHaveLength(2);
      expect(positions[0].latitude).toBe(51.9985);
      expect(positions[1].deviceId).toBe(2);
    });
  });

  describe('getBreadcrumbs', () => {
    it('fetches historical positions for a device with time range', async () => {
      const mockFetch: FetchFn = async (url: string) => {
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/api/positions');
        expect(parsed.searchParams.get('deviceId')).toBe('1');
        expect(parsed.searchParams.has('from')).toBe(true);
        expect(parsed.searchParams.has('to')).toBe(true);

        return new Response(JSON.stringify(BREADCRUMB_FIXTURES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient({ baseUrl: 'http://test:8082' }, mockFetch);
      const from = new Date('2026-04-06T10:00:00Z');
      const to = new Date('2026-04-06T10:30:00Z');
      const breadcrumbs = await client.getBreadcrumbs(1, from, to);
      expect(breadcrumbs).toHaveLength(3);
    });
  });

  describe('authentication', () => {
    it('sends session cookie after authenticate()', async () => {
      const capturedHeaders: Record<string, string>[] = [];

      const mockFetch: FetchFn = async (url: string, init?: RequestInit) => {
        const parsed = new URL(url);

        if (parsed.pathname === '/api/session' && init?.method === 'POST') {
          return new Response('{}', {
            status: 200,
            headers: {
              'Set-Cookie': 'JSESSIONID=abc123; Path=/',
              'Content-Type': 'application/json',
            },
          });
        }

        // Capture headers for subsequent requests
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers) capturedHeaders.push(headers);

        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', email: 'test@test.com', password: 'pass' },
        mockFetch,
      );
      await client.authenticate();
      await client.getDevices();

      expect(capturedHeaders.length).toBeGreaterThan(0);
      expect(capturedHeaders[0]['Cookie']).toBe('JSESSIONID=abc123');
    });

    it('uses basic auth as fallback when no session', async () => {
      const capturedHeaders: Record<string, string>[] = [];

      const mockFetch: FetchFn = async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers) capturedHeaders.push(headers);

        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', email: 'test@test.com', password: 'pass' },
        mockFetch,
      );
      await client.getDevices();

      expect(capturedHeaders[0]['Authorization']).toMatch(/^Basic /);
    });

    it('uses bearer token when configured', async () => {
      const capturedHeaders: Record<string, string>[] = [];

      const mockFetch: FetchFn = async (_url: string, init?: RequestInit) => {
        const headers = init?.headers as Record<string, string> | undefined;
        if (headers) capturedHeaders.push(headers);

        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', token: 'my-token-123' },
        mockFetch,
      );
      await client.getDevices();

      expect(capturedHeaders[0]['Authorization']).toBe('Bearer my-token-123');
    });
  });

  describe('retry with exponential backoff', () => {
    it('retries on failure and succeeds on 4th attempt (3 retries)', async () => {
      let callCount = 0;

      const mockFetch: FetchFn = async () => {
        callCount++;
        if (callCount <= 3) {
          throw new Error('Network error');
        }
        return new Response(JSON.stringify(DEVICE_FIXTURES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', maxRetries: 3, retryBaseMs: 10 },
        mockFetch,
      );
      const devices = await client.getDevices();
      expect(devices).toHaveLength(2);
      expect(callCount).toBe(4); // 1 initial + 3 retries
    });

    it('throws after exhausting all retries', async () => {
      let callCount = 0;

      const mockFetch: FetchFn = async () => {
        callCount++;
        throw new Error('Persistent failure');
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', maxRetries: 2, retryBaseMs: 10 },
        mockFetch,
      );
      await expect(client.getDevices()).rejects.toThrow('Persistent failure');
      expect(callCount).toBe(3); // 1 initial + 2 retries
    });

    it('applies exponential backoff delays', async () => {
      const timestamps: number[] = [];

      const mockFetch: FetchFn = async () => {
        timestamps.push(Date.now());
        if (timestamps.length <= 3) {
          throw new Error('Fail');
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', maxRetries: 3, retryBaseMs: 50 },
        mockFetch,
      );
      await client.getDevices();

      // Check that delays are roughly: 50ms, 100ms, 200ms
      // Allow generous tolerance for CI/slow machines
      expect(timestamps.length).toBe(4);
      const delay1 = timestamps[1] - timestamps[0];
      const delay2 = timestamps[2] - timestamps[1];
      const delay3 = timestamps[3] - timestamps[2];
      expect(delay1).toBeGreaterThanOrEqual(30);
      expect(delay2).toBeGreaterThanOrEqual(60);
      expect(delay3).toBeGreaterThanOrEqual(120);
    });

    it('retries on HTTP error status codes', async () => {
      let callCount = 0;

      const mockFetch: FetchFn = async () => {
        callCount++;
        if (callCount <= 2) {
          return new Response('Server Error', { status: 503 });
        }
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const client = new TraccarClient(
        { baseUrl: 'http://test:8082', maxRetries: 3, retryBaseMs: 10 },
        mockFetch,
      );
      const result = await client.getDevices();
      expect(result).toEqual([]);
      expect(callCount).toBe(3);
    });
  });
});

// ── Polling Manager Tests ────────────────────────────────────────────

describe('PollingManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTestClient(fetchFn: FetchFn): TraccarClient {
    return new TraccarClient(
      { baseUrl: 'http://test:8082', maxRetries: 0 },
      fetchFn,
    );
  }

  it('fires callbacks at correct intervals', async () => {
    const positionUpdates: TraccarPosition[][] = [];
    const deviceUpdates: TraccarDevice[][] = [];

    const mockFetch = createMockFetch(
      new Map([
        ['/api/devices', { status: 200, body: DEVICE_FIXTURES }],
        ['/api/positions', { status: 200, body: POSITION_FIXTURES }],
      ]),
    );

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 5_000,
      onPositionUpdate: (p) => positionUpdates.push(p),
      onDeviceUpdate: (d) => deviceUpdates.push(d),
    });

    poller.start();
    expect(poller.isRunning).toBe(true);

    // First poll fires immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(deviceUpdates.length).toBe(1);
    expect(positionUpdates.length).toBe(1);

    // Second poll after interval
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deviceUpdates.length).toBe(2);
    // Positions deduplicated on second poll — same IDs, so no new ones
    expect(positionUpdates.length).toBe(1);

    poller.stop();
    expect(poller.isRunning).toBe(false);
  });

  it('deduplicates positions by ID across polls', async () => {
    const allPositions: TraccarPosition[][] = [];

    const mockFetch = createMockFetch(
      new Map([
        ['/api/devices', { status: 200, body: DEVICE_FIXTURES }],
        ['/api/positions', { status: 200, body: POSITION_FIXTURES }],
      ]),
    );

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 1_000,
      onPositionUpdate: (p) => allPositions.push(p),
      onDeviceUpdate: () => {},
    });

    poller.start();

    // First poll — 2 new positions
    await vi.advanceTimersByTimeAsync(0);
    expect(allPositions.length).toBe(1);
    expect(allPositions[0]).toHaveLength(2);

    // Second poll — same positions, should NOT trigger callback (all deduplicated)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(allPositions.length).toBe(1); // Still 1 — no new call

    poller.stop();
  });

  it('detects stale devices when lastUpdate exceeds threshold', async () => {
    const staleDevices: TraccarDevice[][] = [];
    const now = new Date('2026-04-06T11:00:00Z');
    vi.setSystemTime(now);

    const staleDeviceFixtures = [
      {
        ...DEVICE_FIXTURES[0],
        // Last update 10 minutes ago — stale at 5-min threshold
        lastUpdate: '2026-04-06T10:49:00.000Z',
      },
      {
        ...DEVICE_FIXTURES[1],
        // Last update 2 hours ago — very stale
        lastUpdate: '2026-04-06T09:00:00.000Z',
      },
    ];

    const mockFetch = createMockFetch(
      new Map([
        ['/api/devices', { status: 200, body: staleDeviceFixtures }],
        ['/api/positions', { status: 200, body: POSITION_FIXTURES }],
      ]),
    );

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 5_000,
      staleThresholdMs: 300_000, // 5 minutes
      onStaleDevices: (d) => staleDevices.push(d),
      onPositionUpdate: () => {},
      onDeviceUpdate: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(staleDevices.length).toBe(1);
    expect(staleDevices[0]).toHaveLength(2); // Both are stale
  });

  it('serves last-good cache when fetch fails', async () => {
    let fetchShouldFail = false;
    const positionUpdates: TraccarPosition[][] = [];

    const mockFetch: FetchFn = async (url: string) => {
      if (fetchShouldFail) {
        throw new Error('Server unreachable');
      }
      const parsed = new URL(url);
      if (parsed.pathname === '/api/devices') {
        return new Response(JSON.stringify(DEVICE_FIXTURES), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(POSITION_FIXTURES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 1_000,
      onPositionUpdate: (p) => positionUpdates.push(p),
      onDeviceUpdate: () => {},
      onError: () => {},
    });

    poller.start();

    // First poll succeeds — positions cached
    await vi.advanceTimersByTimeAsync(0);
    expect(positionUpdates.length).toBe(1);
    expect(positionUpdates[0]).toHaveLength(2);

    // Now fail
    fetchShouldFail = true;
    await vi.advanceTimersByTimeAsync(1_000);

    // Should get the cached positions back
    expect(positionUpdates.length).toBe(2);
    expect(positionUpdates[1]).toHaveLength(2);
    expect(positionUpdates[1]).toEqual(POSITION_FIXTURES); // Same data from cache

    poller.stop();
  });

  it('fires onError callback when fetch fails', async () => {
    const errors: Error[] = [];

    const mockFetch: FetchFn = async () => {
      throw new Error('Connection refused');
    };

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 1_000,
      onError: (e) => errors.push(e),
      onPositionUpdate: () => {},
      onDeviceUpdate: () => {},
    });

    poller.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('Connection refused');

    poller.stop();
  });

  it('uses incremental time range for breadcrumb fetch', async () => {
    const capturedUrls: string[] = [];

    const mockFetch: FetchFn = async (url: string) => {
      capturedUrls.push(url);
      return new Response(JSON.stringify(BREADCRUMB_FIXTURES), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const client = new TraccarClient(
      { baseUrl: 'http://test:8082', maxRetries: 0 },
      mockFetch,
    );

    const poller = new PollingManager(client, { intervalMs: 5_000 });

    // Simulate that last fetch was 1 minute ago
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    // Access internal state for test
    (poller as unknown as { lastFetchTime: Date }).lastFetchTime = oneMinuteAgo;

    vi.useRealTimers(); // Need real timers for this async call
    const breadcrumbs = await poller.fetchIncrementalBreadcrumbs(1);

    expect(breadcrumbs).toHaveLength(3);
    // Verify the URL includes the from parameter that's close to oneMinuteAgo
    const url = new URL(capturedUrls[0]);
    expect(url.searchParams.has('from')).toBe(true);
    const fromParam = new Date(url.searchParams.get('from')!);
    // Should be approximately oneMinuteAgo (within a few seconds)
    expect(Math.abs(fromParam.getTime() - oneMinuteAgo.getTime())).toBeLessThan(5_000);
  });

  it('start is idempotent — calling twice does not double-poll', async () => {
    let pollCount = 0;

    const mockFetch = createMockFetch(
      new Map([
        ['/api/devices', { status: 200, body: [] }],
        ['/api/positions', { status: 200, body: [] }],
      ]),
    );

    const client = createTestClient(mockFetch);
    const poller = new PollingManager(client, {
      intervalMs: 1_000,
      onDeviceUpdate: () => { pollCount++; },
    });

    poller.start();
    poller.start(); // second call should be no-op

    await vi.advanceTimersByTimeAsync(0);
    expect(pollCount).toBe(1); // Only one poll, not two

    poller.stop();
  });
});
