import { proxyTraccarRequest } from '../api-lib/traccar-proxy.js'

/**
 * @param {import('node:http').IncomingMessage} request
 * @param {import('node:http').ServerResponse} response
 */
export default async function handler(request, response) {
  await proxyTraccarRequest(request, response, {
    endpoint: '/api/positions',
    allowedMethods: ['GET'],
  })
}
