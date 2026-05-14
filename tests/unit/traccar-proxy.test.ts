import { EventEmitter } from 'node:events'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { proxyTraccarRequest } from '../../api-lib/traccar-proxy.js'

describe('Traccar Vercel proxy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    delete process.env.TRACCAR_UPSTREAM_URL
  })

  it('forwards session form posts to the configured HTTP upstream without exposing an open proxy', async () => {
    process.env.TRACCAR_UPSTREAM_URL = 'http://tracker.internal:8082/'
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 4, email: 'apiuser' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Set-Cookie': 'JSESSIONID=secret',
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const response = createResponse()
    await proxyTraccarRequest(
      createRequest({
        method: 'POST',
        url: '/api/session?ignored=https://evil.example/api/devices',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'email=apiuser&password=apiuser',
      }),
      response,
      { endpoint: '/api/session', allowedMethods: ['POST'] },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://tracker.internal:8082/api/session?ignored=https://evil.example/api/devices',
      expect.objectContaining({
        method: 'POST',
        body: Buffer.from('email=apiuser&password=apiuser'),
      }),
    )
    const sessionHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(sessionHeaders.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('application/json')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body).toBe(JSON.stringify({ id: 4, email: 'apiuser' }))
  })

  it('forwards authorization for devices and preserves query parameters for positions', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await proxyTraccarRequest(
      createRequest({
        method: 'GET',
        url: '/api/positions?deviceId=1&from=2026-05-14T10%3A00%3A00.000Z',
        headers: { authorization: 'Basic abc123' },
      }),
      createResponse(),
      { endpoint: '/api/positions', allowedMethods: ['GET'] },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://kmrtsar.ddns.net:8082/api/positions?deviceId=1&from=2026-05-14T10%3A00%3A00.000Z',
      expect.objectContaining({ method: 'GET' }),
    )
    const positionHeaders = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Headers
    expect(positionHeaders.get('authorization')).toBe('Basic abc123')
  })

  it('rejects unsupported methods before contacting Traccar', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const response = createResponse()

    await proxyTraccarRequest(
      createRequest({ method: 'DELETE', url: '/api/devices' }),
      response,
      { endpoint: '/api/devices', allowedMethods: ['GET'] },
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.statusCode).toBe(405)
    expect(response.body).toBe(JSON.stringify({ error: 'Method not allowed.' }))
  })
})

function createRequest(input: {
  readonly method: string
  readonly url: string
  readonly headers?: IncomingHttpHeaders
  readonly body?: string
}): IncomingMessage {
  const request = new EventEmitter() as IncomingMessage
  Object.assign(request, {
    method: input.method,
    url: input.url,
    headers: input.headers ?? {},
  })

  queueMicrotask(() => {
    if (input.body !== undefined) {
      request.emit('data', Buffer.from(input.body))
    }
    request.emit('end')
  })

  return request
}

function createResponse(): ServerResponse & {
  readonly headers: Record<string, number | string | string[]>
  readonly body: string
} {
  const headers: Record<string, number | string | string[]> = {}
  let body = ''
  const response = {
    statusCode: 200,
    setHeader: (key: string, value: number | string | string[]) => {
      headers[key.toLowerCase()] = value
      return response
    },
    writeHead: (statusCode: number) => {
      response.statusCode = statusCode
      return response
    },
    end: (chunk?: string | Buffer) => {
      if (chunk !== undefined) {
        body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk
      }
      return response
    },
    get headers() {
      return headers
    },
    get body() {
      return body
    },
  }

  return response as ServerResponse & {
    readonly headers: Record<string, number | string | string[]>
    readonly body: string
  }
}
