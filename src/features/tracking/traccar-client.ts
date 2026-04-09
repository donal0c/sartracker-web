import {
  normalizeTraccarDevice,
  normalizeTraccarPosition,
} from './traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
} from './tracking-types'

export type TraccarFetch = (url: string, init?: RequestInit) => Promise<Response>

type TraccarClientConfig = {
  readonly baseUrl: string
  readonly email?: string
  readonly password?: string
  readonly token?: string
  readonly timeoutMs?: number
  readonly maxRetries?: number
  readonly retryBaseMs?: number
}

type TraccarClient = {
  readonly authenticate: () => Promise<void>
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getCurrentPositions: () => Promise<readonly NormalizedTrackingPosition[]>
  readonly getBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
}

/**
 * Creates the Traccar HTTP client used for tracking polling.
 */
export function createTraccarClient(
  config: TraccarClientConfig,
  fetchFn: TraccarFetch = globalThis.fetch.bind(globalThis),
): TraccarClient {
  const baseUrl = config.baseUrl.replace(/#.*$/, '').replace(/\/+$/, '')
  const timeoutMs = config.timeoutMs ?? 10_000
  const maxRetries = config.maxRetries ?? 3
  const retryBaseMs = config.retryBaseMs ?? 1_000
  let sessionCookie: string | null = null

  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }

    if (config.token) {
      headers.Authorization = `Bearer ${config.token}`
      return headers
    }

    if (sessionCookie !== null) {
      headers.Cookie = `JSESSIONID=${sessionCookie}`
      return headers
    }

    if (config.email && config.password) {
      headers.Authorization = `Basic ${btoa(`${config.email}:${config.password}`)}`
    }

    return headers
  }

  const fetchJson = async (
    path: string,
    params?: Record<string, string>,
  ): Promise<unknown> => {
    const url = new URL(path, `${baseUrl}/`)
    if (params !== undefined) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value)
      }
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await sleep(retryBaseMs * 2 ** (attempt - 1))
      }

      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
        const response = await fetchFn(url.toString(), {
          headers: buildHeaders(),
          signal: controller.signal,
        })
        window.clearTimeout(timeout)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        return await response.json()
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error('Traccar request failed unexpectedly.')
      }
    }

    throw lastError ?? new Error('Traccar request failed unexpectedly.')
  }

  return {
    authenticate: async () => {
      if (config.token || sessionCookie !== null) {
        return
      }

      if (!config.email || !config.password) {
        return
      }

      const body = new URLSearchParams({
        email: config.email,
        password: config.password,
      })

      const response = await fetchFn(`${baseUrl}/api/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      if (!response.ok) {
        throw new Error(`Authentication failed: ${response.status} ${response.statusText}`)
      }

      const setCookie = response.headers.get('set-cookie')
      const match = setCookie?.match(/JSESSIONID=([^;]+)/)
      sessionCookie = match?.[1] ?? null
    },
    getDevices: async () => {
      const data = await fetchJson('/api/devices')
      if (!Array.isArray(data)) {
        throw new Error('Expected an array from /api/devices.')
      }

      return data.map((device) => normalizeTraccarDevice(device))
    },
    getCurrentPositions: async () => {
      const data = await fetchJson('/api/positions')
      if (!Array.isArray(data)) {
        throw new Error('Expected an array from /api/positions.')
      }

      return data.map((position) => normalizeTraccarPosition(position, 'live'))
    },
    getBreadcrumbs: async (deviceId, from, to) => {
      const data = await fetchJson('/api/positions', {
        deviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      })
      if (!Array.isArray(data)) {
        throw new Error('Expected an array from breadcrumb positions.')
      }

      return data.map((position) => normalizeTraccarPosition(position, 'live'))
    },
  }
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}
