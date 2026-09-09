import { createServer } from 'node:http'

const SESSION_COOKIE = 'JSESSIONID=archive-lifecycle-liveness'
const DEVICE_ID = 991
const POSITION_ID_BASE = 9_910_000
const MAX_CURRENT_FIX_LEDGER_ENTRIES = 128
const LIVENESS_PHASES = new Set(['create', 'verify', 'restore', 'cleanup'])

/**
 * Starts the loopback Traccar boundary used by the packaged archive watchdog.
 *
 * Each current-position request creates one new upstream identity. Its request
 * and response-source clocks are captured here, outside Electron, so renderer
 * latency cannot be manufactured by a renderer-side self report.
 */
export async function startArchiveLifecycleLivenessMockTraccarServer(options = {}) {
  const now = options.now ?? Date.now
  if (typeof now !== 'function') {
    throw new Error('Archive-lifecycle liveness mock clock must be a function.')
  }
  const currentFixLedger = []
  let activePhase = null
  let currentFixSequence = 0
  let currentFixLedgerOverflowCount = 0
  let closed = false

  const server = createServer((request, response) => {
    const requestStartedAtMs = readClock(now, 'request')
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'POST' && requestUrl.pathname === '/api/session') {
        response.writeHead(200, {
          'content-type': 'application/json',
          'set-cookie': `${SESSION_COOKIE}; Path=/; HttpOnly`,
        })
        response.end('{}')
        return
      }

      if (!isAuthorized(request.headers)) {
        sendJson(response, 401, { error: 'synthetic authentication required' })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/groups') {
        sendJson(response, 200, [])
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/devices') {
        const lastUpdate = new Date(requestStartedAtMs).toISOString()
        sendJson(response, 200, [{
          id: DEVICE_ID,
          name: 'Archive Liveness Tracker',
          uniqueId: 'archive-liveness-tracker',
          status: 'online',
          lastUpdate,
          positionId: POSITION_ID_BASE + currentFixSequence,
          disabled: false,
          groupId: 0,
          category: 'person',
          attributes: {},
        }])
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/positions') {
        if (requestUrl.searchParams.has('deviceId')) {
          sendJson(response, 200, [])
          return
        }
        currentFixSequence += 1
        const sourcePositionId = String(POSITION_ID_BASE + currentFixSequence)
        const emittedAtMs = readClock(now, 'source emission')
        const fixTime = new Date(emittedAtMs).toISOString()
        if (activePhase !== null) {
          currentFixLedger.push({
            sequence: currentFixSequence,
            phase: activePhase,
            sourcePositionId,
            sourceTimestamp: fixTime,
            requestStartedAtMs,
            emittedAtMs,
          })
          if (currentFixLedger.length > MAX_CURRENT_FIX_LEDGER_ENTRIES) {
            const overflowCount = currentFixLedger.length - MAX_CURRENT_FIX_LEDGER_ENTRIES
            currentFixLedger.splice(0, overflowCount)
            currentFixLedgerOverflowCount += overflowCount
          }
        }
        sendJson(response, 200, [{
          id: Number(sourcePositionId),
          deviceId: DEVICE_ID,
          latitude: 52.2407 + currentFixSequence / 10_000_000,
          longitude: -9.5807 - currentFixSequence / 10_000_000,
          altitude: 120,
          speed: 1.5,
          accuracy: 5,
          fixTime,
          serverTime: fixTime,
          deviceTime: fixTime,
          attributes: { batteryLevel: 80 },
          valid: true,
          protocol: 'osmand',
        }])
        return
      }

      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.name : 'UnknownError',
      })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('Archive-lifecycle liveness mock did not receive a TCP port.')
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    deviceId: DEVICE_ID,
    setPhase: async (phase) => {
      if (phase !== null && !LIVENESS_PHASES.has(phase)) {
        throw new Error('Archive-lifecycle liveness phase is invalid.')
      }
      activePhase = phase
    },
    readCurrentFixLedger: (afterSequence = 0) => currentFixLedger
      .filter((entry) => entry.sequence > afterSequence)
      .map((entry) => ({ ...entry })),
    readCurrentFixSequence: () => currentFixSequence,
    drainCurrentFixLedger: () => {
      const entries = currentFixLedger.splice(0, currentFixLedger.length)
        .map((entry) => ({ ...entry }))
      const overflowCount = currentFixLedgerOverflowCount
      currentFixLedgerOverflowCount = 0
      return { entries, overflowCount }
    },
    snapshot: () => ({
      activePhase,
      currentFixRequestCount: currentFixSequence,
      currentFixLedgerOverflowCount,
      currentFixLedger: currentFixLedger.map((entry) => ({ ...entry })),
    }),
    close: async () => {
      if (closed) return
      closed = true
      await new Promise((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error))
      })
    },
  }
}

/** Reads one finite integral wall clock without trusting implicit coercion. */
function readClock(now, label) {
  const value = now()
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Archive-lifecycle liveness ${label} clock is invalid.`)
  }
  return value
}

/** Accepts either the synthetic session cookie or the production Basic header. */
function isAuthorized(headers) {
  return typeof headers.authorization === 'string'
    || String(headers.cookie ?? '').includes(SESSION_COOKIE)
}

/** Sends one bounded JSON response. */
function sendJson(response, status, value) {
  if (response.headersSent) {
    response.end()
    return
  }
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}
