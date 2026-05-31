import { createTraccarClient, type TraccarFetch } from '../../features/tracking/traccar-client'
import type { TrackingRuntimeConfig } from '../../features/tracking/start-tracking-runtime'

type ElectronTraccarFetchOptions = {
  readonly timeoutMs?: number
}

/**
 * Creates a fetch-compatible transport that delegates Traccar HTTP to Electron main.
 */
export function createElectronTraccarFetch(
  options: ElectronTraccarFetchOptions = {},
): TraccarFetch {
  return async (url, init = {}) => {
    const bridge = window.sartrackerElectron
    if (bridge === undefined) {
      throw new Error('Electron Traccar bridge is not available.')
    }

    const response = await bridge.traccarHttpRequest({
      url,
      method: init.method ?? 'GET',
      headers: normalizeHeaders(init.headers),
      body: await normalizeBody(init.body),
      timeoutMs: options.timeoutMs ?? null,
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

/**
 * Creates the Electron desktop Traccar client, routing HTTP through the preload bridge.
 */
export function createElectronTraccarClient(config: TrackingRuntimeConfig): unknown {
  return createTraccarClient(
    config,
    createElectronTraccarFetch({ timeoutMs: 10_000 }),
  )
}

function normalizeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  if (headers === undefined) {
    return {}
  }

  return Object.fromEntries(new Headers(headers).entries())
}

async function normalizeBody(body: BodyInit | null | undefined): Promise<string | null> {
  if (body === null || body === undefined) {
    return null
  }

  if (typeof body === 'string') {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  throw new Error('Electron Traccar transport only supports string request bodies.')
}
