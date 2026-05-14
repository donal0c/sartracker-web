const DEFAULT_TRACCAR_UPSTREAM_URL = 'http://kmrtsar.ddns.net:8082'

/**
 * Proxies the small Traccar HTTP surface needed by SAR Tracker Web.
 *
 * @param {import('node:http').IncomingMessage & { method?: string, url?: string }} request
 * @param {import('node:http').ServerResponse} response
 * @param {{ endpoint: '/api/session' | '/api/devices' | '/api/positions', allowedMethods: readonly ('GET' | 'POST')[] }} options
 */
export async function proxyTraccarRequest(request, response, options) {
  const method = request.method?.toUpperCase() ?? 'GET'
  applyCorsHeaders(response)

  if (method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (!options.allowedMethods.includes(method)) {
    writeJson(response, 405, { error: 'Method not allowed.' })
    return
  }

  try {
    const upstreamUrl = buildUpstreamUrl(request.url ?? options.endpoint, options.endpoint)
    const upstreamResponse = await fetch(upstreamUrl, {
      method,
      headers: buildUpstreamHeaders(request.headers),
      body: method === 'POST' ? await readRequestBody(request) : undefined,
    })

    response.statusCode = upstreamResponse.status
    copyResponseHeaders(upstreamResponse.headers, response)
    response.end(Buffer.from(await upstreamResponse.arrayBuffer()))
  } catch {
    writeJson(response, 502, { error: 'Traccar proxy request failed.' })
  }
}

/**
 * @param {string} requestUrl
 * @param {'/api/session' | '/api/devices' | '/api/positions'} endpoint
 */
function buildUpstreamUrl(requestUrl, endpoint) {
  const upstreamBaseUrl = (process.env.TRACCAR_UPSTREAM_URL ?? DEFAULT_TRACCAR_UPSTREAM_URL)
    .trim()
    .replace(/\/+$/, '')
  const parsedRequestUrl = new URL(requestUrl, 'https://sartracker-web.local')
  const upstreamUrl = new URL(endpoint, `${upstreamBaseUrl}/`)
  upstreamUrl.search = parsedRequestUrl.search
  return upstreamUrl.toString()
}

/**
 * @param {import('node:http').IncomingHttpHeaders} headers
 */
function buildUpstreamHeaders(headers) {
  const upstreamHeaders = new Headers()
  const accept = readHeader(headers.accept)
  const contentType = readHeader(headers['content-type'])
  const authorization = readHeader(headers.authorization)

  upstreamHeaders.set('Accept', accept ?? 'application/json')
  if (contentType !== null) {
    upstreamHeaders.set('Content-Type', contentType)
  }
  if (authorization !== null) {
    upstreamHeaders.set('Authorization', authorization)
  }

  return upstreamHeaders
}

/**
 * @param {Headers} headers
 * @param {import('node:http').ServerResponse} response
 */
function copyResponseHeaders(headers, response) {
  const contentType = headers.get('content-type')
  if (contentType !== null) {
    response.setHeader('Content-Type', contentType)
  }
}

/**
 * @param {string | string[] | undefined} value
 */
function readHeader(value) {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

/**
 * @param {import('node:http').ServerResponse} response
 */
function applyCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'authorization,content-type,accept')
}

/**
 * @param {import('node:http').ServerResponse} response
 * @param {number} statusCode
 * @param {Record<string, string>} body
 */
function writeJson(response, statusCode, body) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

/**
 * @param {import('node:http').IncomingMessage} request
 */
function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      resolve(Buffer.concat(chunks))
    })
    request.on('error', reject)
  })
}
