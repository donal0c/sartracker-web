/**
 * Traccar API Client for SAR Tracker.
 *
 * Implements HTTP polling against the Traccar REST API with:
 * - Session-based authentication (POST /api/session)
 * - Device listing and position fetching
 * - Incremental breadcrumb fetching
 * - Polling manager with configurable intervals
 * - Retry with exponential backoff
 * - Last-good cache for offline resilience
 * - Stale-device detection
 * - Position deduplication
 */

// ── Data Models ──────────────────────────────────────────────────────

export interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;           // 'online' | 'offline' | 'unknown'
  lastUpdate: string | null; // ISO8601
  positionId: number;
  disabled: boolean;
  groupId: number;
  attributes: Record<string, unknown>;
}

export interface TraccarPosition {
  id: number;
  deviceId: number;
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;            // knots
  course: number;           // degrees
  accuracy: number;         // metres
  fixTime: string;          // ISO8601 — GPS fix time
  serverTime: string;       // ISO8601 — when server received it
  deviceTime: string;       // ISO8601 — device clock time
  attributes: Record<string, unknown>; // batteryLevel, motion, etc.
  valid: boolean;
  protocol: string;
}

export interface TraccarServerInfo {
  id: number;
  version: string;
  registration: boolean;
  readonly: boolean;
  map: string;
  attributes: Record<string, unknown>;
}

// ── Configuration ────────────────────────────────────────────────────

export interface TraccarClientConfig {
  baseUrl: string;
  email?: string;
  password?: string;
  token?: string;            // Bearer token alternative
  timeoutMs?: number;        // default 10_000
  maxRetries?: number;       // default 3
  retryBaseMs?: number;      // default 1_000
}

export interface PollingConfig {
  intervalMs?: number;           // default 30_000
  staleThresholdMs?: number;     // default 300_000 (5 minutes)
  onPositionUpdate?: (positions: TraccarPosition[]) => void;
  onDeviceUpdate?: (devices: TraccarDevice[]) => void;
  onError?: (error: Error) => void;
  onStaleDevices?: (devices: TraccarDevice[]) => void;
}

// ── Fetch Abstraction ────────────────────────────────────────────────

/** Minimal fetch interface so we can inject mocks in tests. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ── TraccarClient ────────────────────────────────────────────────────

export class TraccarClient {
  private baseUrl: string;
  private email?: string;
  private password?: string;
  private token?: string;
  private timeoutMs: number;
  private maxRetries: number;
  private retryBaseMs: number;
  private sessionCookie: string | null = null;
  private fetchFn: FetchFn;

  constructor(config: TraccarClientConfig, fetchFn?: FetchFn) {
    this.baseUrl = config.baseUrl.replace(/#.*$/, '').replace(/\/+$/, '');
    this.email = config.email;
    this.password = config.password;
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 1_000;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  // ── Authentication ───────────────────────────────────────────────

  /** Authenticate via POST /api/session and store session cookie. */
  async authenticate(): Promise<void> {
    if (this.token) return; // Bearer token doesn't need session auth

    if (!this.email || !this.password) {
      throw new Error('Email and password required for session authentication');
    }

    const body = new URLSearchParams({
      email: this.email,
      password: this.password,
    });

    const res = await this.fetchFn(`${this.baseUrl}/api/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Authentication failed: ${res.status} ${res.statusText}`);
    }

    // Extract JSESSIONID cookie from Set-Cookie header
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/JSESSIONID=([^;]+)/);
      if (match) {
        this.sessionCookie = match[1];
      }
    }
  }

  // ── Internal Helpers ─────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    } else if (this.sessionCookie) {
      headers['Cookie'] = `JSESSIONID=${this.sessionCookie}`;
    } else if (this.email && this.password) {
      // Fallback: basic auth
      const encoded = btoa(`${this.email}:${this.password}`);
      headers['Authorization'] = `Basic ${encoded}`;
    }

    return headers;
  }

  /** GET with retry + exponential backoff. */
  async fetchWithRetry(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.retryBaseMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        const res = await this.fetchFn(url.toString(), {
          headers: this.buildHeaders(),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        return await res.json();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('Request failed after retries');
  }

  // ── API Methods ──────────────────────────────────────────────────

  /** GET /api/server — public endpoint, no auth required on most Traccar setups. */
  async getServerInfo(): Promise<TraccarServerInfo> {
    return (await this.fetchWithRetry('/api/server')) as TraccarServerInfo;
  }

  /** GET /api/devices — list all devices visible to the authenticated user. */
  async getDevices(): Promise<TraccarDevice[]> {
    const data = await this.fetchWithRetry('/api/devices');
    if (!Array.isArray(data)) {
      throw new Error(`Expected array from /api/devices, got ${typeof data}`);
    }
    return data as TraccarDevice[];
  }

  /** GET /api/positions — current position for all devices. */
  async getPositions(): Promise<TraccarPosition[]> {
    const data = await this.fetchWithRetry('/api/positions');
    if (!Array.isArray(data)) {
      throw new Error(`Expected array from /api/positions, got ${typeof data}`);
    }
    return data as TraccarPosition[];
  }

  /**
   * GET /api/positions?deviceId=X&from=ISO&to=ISO — historical breadcrumbs.
   * Returns positions for a specific device within a time range.
   */
  async getBreadcrumbs(
    deviceId: number,
    from: Date,
    to: Date,
  ): Promise<TraccarPosition[]> {
    const data = await this.fetchWithRetry('/api/positions', {
      deviceId: String(deviceId),
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (!Array.isArray(data)) {
      throw new Error(`Expected array from /api/positions breadcrumbs, got ${typeof data}`);
    }
    return data as TraccarPosition[];
  }
}

// ── Polling Manager ──────────────────────────────────────────────────

export class PollingManager {
  private client: TraccarClient;
  private config: Required<PollingConfig>;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastFetchTime: Date | null = null;
  private lastGoodPositions: TraccarPosition[] = [];
  private lastGoodDevices: TraccarDevice[] = [];
  private emittedPositionIds = new Set<number>();

  constructor(client: TraccarClient, config: PollingConfig = {}) {
    this.client = client;
    this.config = {
      intervalMs: config.intervalMs ?? 30_000,
      staleThresholdMs: config.staleThresholdMs ?? 300_000,
      onPositionUpdate: config.onPositionUpdate ?? (() => {}),
      onDeviceUpdate: config.onDeviceUpdate ?? (() => {}),
      onError: config.onError ?? (() => {}),
      onStaleDevices: config.onStaleDevices ?? (() => {}),
    };
  }

  get isRunning(): boolean {
    return this.running;
  }

  get lastPositions(): TraccarPosition[] {
    return this.lastGoodPositions;
  }

  get lastDevices(): TraccarDevice[] {
    return this.lastGoodDevices;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    // Fire immediately, then on interval
    this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Single poll cycle — fetch devices + positions, detect stale, deduplicate. */
  async poll(): Promise<void> {
    try {
      const [devices, positions] = await Promise.all([
        this.client.getDevices(),
        this.client.getPositions(),
      ]);

      // Update last-good cache
      this.lastGoodDevices = devices;
      this.lastGoodPositions = positions;
      this.lastFetchTime = new Date();

      // Deduplicate: only emit positions not seen before
      const newPositions = positions.filter(p => !this.emittedPositionIds.has(p.id));
      for (const p of positions) {
        this.emittedPositionIds.add(p.id);
      }

      // Stale device detection
      const now = new Date();
      const staleDevices = devices.filter(d => {
        if (!d.lastUpdate) return true;
        const lastUpdate = new Date(d.lastUpdate);
        return now.getTime() - lastUpdate.getTime() > this.config.staleThresholdMs;
      });

      this.config.onDeviceUpdate(devices);

      if (newPositions.length > 0) {
        this.config.onPositionUpdate(newPositions);
      }

      if (staleDevices.length > 0) {
        this.config.onStaleDevices(staleDevices);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.config.onError(error);

      // Serve last-good cache on failure
      if (this.lastGoodPositions.length > 0) {
        this.config.onPositionUpdate(this.lastGoodPositions);
        this.config.onDeviceUpdate(this.lastGoodDevices);
      }
    }
  }

  /**
   * Incremental breadcrumb fetch — only fetches positions since the last fetch time.
   * Returns all breadcrumbs for a device from the last fetch time to now.
   */
  async fetchIncrementalBreadcrumbs(deviceId: number): Promise<TraccarPosition[]> {
    const from = this.lastFetchTime ?? new Date(Date.now() - 3 * 60 * 60 * 1000); // default 3h
    const to = new Date();
    const breadcrumbs = await this.client.getBreadcrumbs(deviceId, from, to);
    this.lastFetchTime = to;
    return breadcrumbs;
  }
}

// ── Utilities ────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Parsing Helpers (for test fixtures) ──────────────────────────────

export function parseDevice(raw: Record<string, unknown>): TraccarDevice {
  return {
    id: Number(raw.id),
    name: String(raw.name ?? `Device ${raw.id}`),
    uniqueId: String(raw.uniqueId ?? ''),
    status: String(raw.status ?? 'unknown'),
    lastUpdate: raw.lastUpdate ? String(raw.lastUpdate) : null,
    positionId: Number(raw.positionId ?? 0),
    disabled: Boolean(raw.disabled),
    groupId: Number(raw.groupId ?? 0),
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
  };
}

export function parsePosition(raw: Record<string, unknown>): TraccarPosition {
  return {
    id: Number(raw.id),
    deviceId: Number(raw.deviceId),
    latitude: Number(raw.latitude),
    longitude: Number(raw.longitude),
    altitude: Number(raw.altitude ?? 0),
    speed: Number(raw.speed ?? 0),
    course: Number(raw.course ?? 0),
    accuracy: Number(raw.accuracy ?? 0),
    fixTime: String(raw.fixTime ?? ''),
    serverTime: String(raw.serverTime ?? ''),
    deviceTime: String(raw.deviceTime ?? ''),
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
    valid: Boolean(raw.valid ?? true),
    protocol: String(raw.protocol ?? ''),
  };
}
