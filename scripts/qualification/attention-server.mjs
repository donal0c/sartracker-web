import { createServer } from 'node:http'

/** Fixed independent twenty-minute stationary episode followed by corroborated movement. */
export function createAttentionScenario(now) {
  if (!Number.isSafeInteger(now)) throw new Error('Attention source requires a fixed millisecond clock.')
  const base = now - 21 * 60_000
  const position = (id, deviceId, seconds, latitude) => ({ id, deviceId, protocol: 'osmand',
    serverTime: new Date(base + seconds * 1000 + 9 * 60_000).toISOString(), deviceTime: new Date(base + seconds * 1000 + 7 * 60_000).toISOString(),
    fixTime: new Date(base + seconds * 1000).toISOString(), valid: true, latitude, longitude: -9.7,
    altitude: 20, speed: 0, course: 0, accuracy: 4, attributes: { batteryLevel: 90 } })
  return { stationary: [position(101, 1, 0, 52), position(102, 1, 1200, 52.00001)],
    moving: [position(103, 1, 1210, 52.001), position(104, 1, 1220, 52.00101)],
    stale: position(201, 2, 0, 52.002) }
}

/** Serve synthetic provider data on an ephemeral loopback listener, with explicit stage control. */
export async function startAttentionServer(source) {
  let stage = 'stationary'
  const requests = []
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (requests.length < 1000) requests.push({ stage, method: request.method, path: url.pathname })
    response.setHeader('content-type', 'application/json')
    if (stage === 'disconnected') { response.writeHead(503); response.end('{}'); return }
    const fixes = stage === 'moving' ? [...source.stationary, ...source.moving] : source.stationary
    let body
    if (url.pathname === '/api/session' && request.method === 'POST') {
      response.setHeader('set-cookie', 'JSESSIONID=attention-synthetic; Path=/; HttpOnly')
      body = {}
    } else if (request.method !== 'GET') { response.writeHead(405); body = {} }
    else if (url.pathname === '/api/groups') body = [{ id: 101, name: 'Attention synthetic team', groupId: 0 }]
    else if (url.pathname === '/api/devices') body = [
      { id: 1, name: 'Stationary team', uniqueId: 'attention-1', status: 'online', lastUpdate: fixes.at(-1).fixTime, positionId: fixes.at(-1).id, groupId: 101, disabled: false },
      { id: 2, name: 'Stale team', uniqueId: 'attention-2', status: 'offline', lastUpdate: source.stale.fixTime, positionId: 201, groupId: 101, disabled: false },
    ]
    else if (url.pathname === '/api/positions') {
      const device = url.searchParams.get('deviceId')
      body = device === '1' ? fixes : device === '2' ? [source.stale] : [fixes.at(-1), source.stale]
    } else { response.writeHead(404); body = {} }
    response.end(JSON.stringify(body))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  return { url: `http://127.0.0.1:${server.address().port}`, requests,
    setStage(value) { if (!['stationary', 'disconnected', 'moving'].includes(value)) throw new Error('Unreviewed attention stage.'); stage = value },
    close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections() }) }
}
