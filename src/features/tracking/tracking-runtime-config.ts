import type { TrackingRuntimeConfig } from './start-tracking-runtime'

/**
 * Reads Traccar runtime configuration from the Vite environment.
 */
export function readTrackingRuntimeConfig(): TrackingRuntimeConfig | null {
  const baseUrl = import.meta.env.VITE_TRACCAR_BASE_URL

  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    return null
  }

  const email = readOptionalEnv('VITE_TRACCAR_EMAIL')
  const password = readOptionalEnv('VITE_TRACCAR_PASSWORD')
  const token = readOptionalEnv('VITE_TRACCAR_TOKEN')

  return {
    baseUrl,
    ...(email !== undefined ? { email } : {}),
    ...(password !== undefined ? { password } : {}),
    ...(token !== undefined ? { token } : {}),
  }
}

function readOptionalEnv(key: 'VITE_TRACCAR_EMAIL' | 'VITE_TRACCAR_PASSWORD' | 'VITE_TRACCAR_TOKEN'): string | undefined {
  const value = import.meta.env[key]
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined
  }

  return value
}
