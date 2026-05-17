import { invoke } from '@tauri-apps/api/core'

import { createTraccarClient, type TraccarFetch } from '../../features/tracking/traccar-client'
import type { TrackingRuntimeConfig } from '../../features/tracking/start-tracking-runtime'

type TauriTraccarFetchOptions = {
  readonly timeoutMs?: number
}

type TauriTraccarHttpResponse = {
  readonly status: number
  readonly statusText: string
  readonly headers: Record<string, string>
  readonly body: string
}

/**
 * Creates a fetch-compatible transport that delegates Traccar HTTP to Rust.
 */
export function createTauriTraccarFetch(options: TauriTraccarFetchOptions = {}): TraccarFetch {
  return async (url, init = {}) => {
    const response = await invoke<TauriTraccarHttpResponse>('traccar_http_request', {
      input: {
        url,
        method: init.method ?? 'GET',
        headers: normalizeHeaders(init.headers),
        body: await normalizeBody(init.body),
        timeoutMs: options.timeoutMs ?? null,
      },
    })

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

/**
 * Creates the desktop Traccar client, routing HTTP through reqwest instead of WKWebView fetch.
 */
export function createTauriTraccarClient(config: TrackingRuntimeConfig): unknown {
  return createTraccarClient(
    config,
    createTauriTraccarFetch({ timeoutMs: 10_000 }),
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

  throw new Error('Tauri Traccar transport only supports string request bodies.')
}
