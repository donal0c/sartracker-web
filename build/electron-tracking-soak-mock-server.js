import { createServer } from 'node:http'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const SESSION_COOKIE = 'JSESSIONID=tracking-soak'
const BASE_TIME_MS = Date.parse('2026-01-01T00:00:00.000Z')

/** Starts the deterministic local-only Traccar server used by packaged soaks. */
export async function startTrackingSoakMockServer(options) {
  validateOptions(options)
  const pauseCheckpoints = new Set(options.pauseCheckpoints ?? [])
  const consumedPauseCheckpoints = new Set()
  const state = {
    completedBatches: 0,
    deviceRequests: 0,
    paused: false,
  }
  let persistChain = Promise.resolve()

  const persistState = () => {
    const durable = {
      ...state,
      maximumBatches: options.maximumBatches,
      productionPollsPerBatch: options.productionPollsPerBatch,
    }
    const run = persistChain.then(async () => {
      await mkdir(path.dirname(options.statePath), { recursive: true })
      const temporaryPath = `${options.statePath}.tmp`
      await writeFile(temporaryPath, `${JSON.stringify(durable, null, 2)}\n`, 'utf8')
      await rename(temporaryPath, options.statePath)
    })
    persistChain = run.catch(() => undefined)
    return run
  }

  const server = createServer(async (request, response) => {
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

      if (request.method === 'GET' && requestUrl.pathname === '/api/devices') {
        state.deviceRequests += 1
        if (!state.paused && state.completedBatches < options.maximumBatches) {
          state.completedBatches += 1
          if (
            pauseCheckpoints.has(state.completedBatches) &&
            !consumedPauseCheckpoints.has(state.completedBatches)
          ) {
            state.paused = true
          }
        }
        await persistState()
        sendJson(response, 200, buildDevices(options, state.completedBatches))
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/api/positions') {
        const deviceId = requestUrl.searchParams.get('deviceId')
        const positions =
          deviceId === null
            ? buildStationaryCurrentPositions(options)
            : buildBreadcrumbPositions(options, state.completedBatches, Number(deviceId))
        sendJson(response, 200, positions)
        return
      }

      sendJson(response, 404, { error: 'not found' })
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
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
    throw new Error('Tracking soak mock server did not receive a TCP port.')
  }
  await persistState()

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    snapshot: () => ({ ...state }),
    resume: async () => {
      consumedPauseCheckpoints.add(state.completedBatches)
      state.paused = false
      await persistState()
    },
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

function buildDevices(options, batch) {
  return Array.from({ length: options.deviceCount }, (_, index) => {
    const deviceId = index + 1
    return {
      id: deviceId,
      name: `Synthetic Team ${String(deviceId).padStart(2, '0')}`,
      uniqueId: `synthetic-${String(deviceId).padStart(2, '0')}`,
      status: 'online',
      lastUpdate: timestampFor(
        options,
        batch,
        Math.max(0, options.productionPollsPerBatch - 1),
      ),
      positionId: positionId(batch, deviceId, options.productionPollsPerBatch - 1),
      disabled: false,
      groupId: 0,
      category: 'person',
      attributes: {},
    }
  })
}

function buildStationaryCurrentPositions(options) {
  return Array.from(
    { length: options.deviceCount - options.movingDeviceCount },
    (_, index) => createPosition(options, 0, options.movingDeviceCount + index + 1, 0),
  )
}

function buildBreadcrumbPositions(options, batch, deviceId) {
  if (
    !Number.isInteger(deviceId) ||
    deviceId < 1 ||
    deviceId > options.movingDeviceCount ||
    batch < 1
  ) {
    return []
  }
  return Array.from({ length: options.productionPollsPerBatch }, (_, index) =>
    createPosition(options, batch, deviceId, index),
  )
}

function createPosition(options, batch, deviceId, offset) {
  const timestamp = timestampFor(options, batch, offset)
  return {
    id: positionId(batch, deviceId, offset),
    deviceId,
    latitude: 52 + deviceId * 0.0001 + batch * 0.000001 + offset * 0.00000001,
    longitude: -9 - deviceId * 0.0001 - batch * 0.000001 - offset * 0.00000001,
    altitude: 100 + deviceId,
    speed: 1.5,
    accuracy: 5,
    fixTime: timestamp,
    serverTime: timestamp,
    deviceTime: timestamp,
    attributes: { batteryLevel: 80 },
    valid: true,
    protocol: 'osmand',
  }
}

function timestampFor(options, batch, offset) {
  const productionPollIndex =
    Math.max(0, batch - 1) * options.productionPollsPerBatch + offset
  return new Date(BASE_TIME_MS + productionPollIndex * 5_000).toISOString()
}

function positionId(batch, deviceId, offset) {
  return batch * 1_000_000 + deviceId * 1_000 + offset
}

function isAuthorized(headers) {
  return (
    typeof headers.authorization === 'string' ||
    String(headers.cookie ?? '').includes(SESSION_COOKIE)
  )
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  })
  response.end(body)
}

function validateOptions(options) {
  for (const key of [
    'deviceCount',
    'movingDeviceCount',
    'productionPollsPerBatch',
    'maximumBatches',
  ]) {
    if (!Number.isInteger(options[key]) || options[key] <= 0) {
      throw new Error(`Tracking soak mock server requires a positive integer ${key}.`)
    }
  }
  if (options.movingDeviceCount > options.deviceCount) {
    throw new Error('Moving device count cannot exceed total device count.')
  }
  if (typeof options.statePath !== 'string' || options.statePath.trim() === '') {
    throw new Error('Tracking soak mock server requires a durable state path.')
  }
}
