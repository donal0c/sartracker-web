import {
  normalizeTraccarBreadcrumbPosition,
  normalizeTraccarDevice,
  normalizeTraccarGroup,
  normalizeTraccarPosition,
} from './traccar-normalization'
import type {
  NormalizedTrackingDevice,
  NormalizedTrackingPosition,
  NormalizedTraccarGroup,
} from './tracking-types'
import {
  classifyTrackingFailure,
  type TrackingRequestAttemptEntry,
  type TrackingPollPhase,
} from '../diagnostics/tracking-poll-ledger'
import type {
  CurrentPositionRejection,
  CurrentPositionRejectionReason,
} from './ingest-health'
import {
  createRejectedPositionAnomalyKey,
  createRejectedPositionEvidence,
} from './rejected-position-evidence'

export type TraccarFetch = (url: string, init?: RequestInit) => Promise<Response>

type RawDeviceInput = Parameters<typeof normalizeTraccarDevice>[0]
type RawPositionInput = Parameters<typeof normalizeTraccarPosition>[0]
type RawGroupInput = Parameters<typeof normalizeTraccarGroup>[0]

type TraccarClientConfig = {
  readonly baseUrl: string
  readonly email?: string
  readonly password?: string
  readonly token?: string
  readonly timeoutMs?: number
  readonly maxRetries?: number
  readonly retryBaseMs?: number
  readonly logger?: TraccarClientLogger
  readonly recordRequestDiagnostic?: (entry: TrackingRequestAttemptEntry) => void
}

export type CurrentPositionNormalizationResult = {
  readonly accepted: readonly NormalizedTrackingPosition[]
  readonly rejected: readonly CurrentPositionRejection[]
}

export type DeviceRosterNormalizationResult = {
  readonly accepted: readonly NormalizedTrackingDevice[]
  /** False when any server row was rejected during normalization. */
  readonly complete: boolean
}

type TraccarClient = {
  readonly authenticate: () => Promise<void>
  readonly getDevices: () => Promise<readonly NormalizedTrackingDevice[]>
  readonly getDevicesWithReport: () => Promise<DeviceRosterNormalizationResult>
  readonly getGroups: () => Promise<readonly NormalizedTraccarGroup[]>
  readonly getCurrentPositions: () => Promise<readonly NormalizedTrackingPosition[]>
  readonly getCurrentPositionsWithReport: () => Promise<CurrentPositionNormalizationResult>
  readonly getBreadcrumbs: (
    deviceId: string,
    from: Date,
    to: Date,
  ) => Promise<readonly NormalizedTrackingPosition[]>
}

type TraccarClientLogger = {
  readonly warn: (message: string, context: Record<string, unknown>) => void
}

export class TraccarAuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TraccarAuthenticationError'
  }
}

type TraccarRowContext = {
  readonly endpoint: string
  readonly rowIndex: number
  readonly deviceId?: string
}

const DEFAULT_LOGGER: TraccarClientLogger = {
  warn: (message, context) => {
    console.warn(message, context)
  },
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
  const logger = config.logger ?? DEFAULT_LOGGER
  const recordRequestDiagnostic = config.recordRequestDiagnostic
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
    const phase = classifyRequestPhase(path, params)
    const maxAttempts = maxRetries + 1

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0) {
        await sleep(retryBaseMs * 2 ** (attempt - 1))
      }

      const attemptStartedAt = Date.now()
      try {
        const response = await fetchWithTimeout(url.toString(), {
          headers: buildHeaders(),
        })

        if (isAuthenticationResponse(response)) {
          return await retryAfterAuthenticationFailure(url.toString())
        }

        if (!response.ok) {
          throw createHttpError(response)
        }

        const payload = await response.json()
        if (attempt > 0 && lastError !== null) {
          recordRequestDiagnostic?.({
            ts: new Date().toISOString(),
            kind: 'request_attempt',
            outcome: 'recovered',
            phase,
            durationMs: Math.max(0, Date.now() - attemptStartedAt),
            attempt: attempt + 1,
            maxAttempts,
            failureKind: classifyTrackingFailure(lastError),
            httpStatus: response.status,
          })
        }
        return payload
      } catch (error) {
        lastError =
          error instanceof Error ? error : new Error('Traccar request failed unexpectedly.')
        recordRequestDiagnostic?.({
          ts: new Date().toISOString(),
          kind: 'request_attempt',
          outcome: 'failure',
          phase,
          durationMs: Math.max(0, Date.now() - attemptStartedAt),
          attempt: attempt + 1,
          maxAttempts,
          failureKind: classifyTrackingFailure(error),
          httpStatus: readHttpStatus(error),
        })
      }
    }

    throw lastError ?? new Error('Traccar request failed unexpectedly.')
  }

  const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await fetchFn(url, {
        ...init,
        signal: controller.signal,
      })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const retryAfterAuthenticationFailure = async (url: string): Promise<unknown> => {
    sessionCookie = null

    if (config.token) {
      throw new TraccarAuthenticationError('Traccar bearer token was rejected by the server.')
    }

    if (!config.email || !config.password) {
      throw new TraccarAuthenticationError('Traccar request was rejected and no credentials are configured.')
    }

    await authenticateWithCredentials()
    const response = await fetchWithTimeout(url, {
      headers: buildHeaders(),
    })

    if (isAuthenticationResponse(response)) {
      sessionCookie = null
      throw new TraccarAuthenticationError(
        `Traccar authentication failed after session refresh: ${response.status} ${response.statusText}`,
      )
    }

    if (!response.ok) {
      throw createHttpError(response)
    }

    return response.json()
  }

  const authenticateWithCredentials = async (): Promise<void> => {
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
      sessionCookie = null
      throw new TraccarAuthenticationError(
        `Authentication failed: ${response.status} ${response.statusText}`,
      )
    }

    const setCookie = response.headers.get('set-cookie')
    const match = setCookie?.match(/JSESSIONID=([^;]+)/)
    sessionCookie = match?.[1] ?? null
  }

  const getCurrentPositionsWithReport = async (): Promise<CurrentPositionNormalizationResult> => {
    const data = await fetchJson('/api/positions')
    if (!Array.isArray(data)) {
      throw new Error('Expected an array from /api/positions.')
    }

    const result = normalizeTraccarRows({
      endpoint: '/api/positions',
      rows: data,
      emptyMessage: 'No valid Traccar position rows were returned from /api/positions.',
      warningMessage: 'Dropped malformed Traccar position row.',
      logger,
      includeStructuredRejections: true,
      allowAllRejected: true,
      normalize: (position) => normalizeTraccarPosition(position as RawPositionInput, 'live'),
    })
    return { accepted: result.accepted, rejected: result.rejected }
  }

  const getDevicesWithReport = async (): Promise<DeviceRosterNormalizationResult> => {
    const data = await fetchJson('/api/devices')
    if (!Array.isArray(data)) {
      throw new Error('Expected an array from /api/devices.')
    }
    const result = normalizeTraccarRows({
      endpoint: '/api/devices',
      rows: data,
      emptyMessage: 'No valid Traccar device rows were returned from /api/devices.',
      warningMessage: 'Dropped malformed Traccar device row.',
      logger,
      normalize: (device) => normalizeTraccarDevice(device as RawDeviceInput),
    })
    return { accepted: result.accepted, complete: result.droppedCount === 0 }
  }

  return {
    authenticate: async () => {
      if (config.token || sessionCookie !== null) {
        return
      }

      if (!config.email || !config.password) {
        return
      }

      await authenticateWithCredentials()
    },
    getDevices: async () => (await getDevicesWithReport()).accepted,
    getDevicesWithReport,
    getGroups: async () => {
      const data = await fetchJson('/api/groups')
      if (!Array.isArray(data)) {
        throw new Error('Expected an array from /api/groups.')
      }

      return normalizeTraccarRows({
        endpoint: '/api/groups',
        rows: data,
        emptyMessage: 'No valid Traccar group rows were returned from /api/groups.',
        warningMessage: 'Dropped malformed Traccar group row.',
        logger,
        normalize: (group) => normalizeTraccarGroup(group as RawGroupInput),
      }).accepted
    },
    getCurrentPositions: async () => {
      const result = await getCurrentPositionsWithReport()
      if (result.accepted.length === 0 && result.rejected.length > 0) {
        throw new Error('No valid Traccar position rows were returned from /api/positions.')
      }
      return result.accepted
    },
    getCurrentPositionsWithReport,
    getBreadcrumbs: async (deviceId, from, to) => {
      const data = await fetchJson('/api/positions', {
        deviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      })
      if (!Array.isArray(data)) {
        throw new Error('Expected an array from breadcrumb positions.')
      }

      return normalizeTraccarRows({
        endpoint: '/api/positions',
        rows: data,
        deviceId,
        emptyMessage: `No valid Traccar breadcrumb rows were returned for device ${deviceId}.`,
        warningMessage: 'Dropped malformed Traccar breadcrumb row.',
        logger,
        normalize: (position) => normalizeTraccarBreadcrumbPosition(
          position as RawPositionInput,
          'live',
        ),
      }).accepted
    },
  }
}

function classifyRequestPhase(
  path: string,
  params: Record<string, string> | undefined,
): TrackingPollPhase {
  if (path === '/api/session') {
    return 'authentication'
  }
  if (path === '/api/devices') {
    return 'devices'
  }
  if (path === '/api/groups') {
    return 'devices'
  }
  if (path === '/api/positions' && params !== undefined && 'deviceId' in params) {
    return 'breadcrumbs'
  }
  return 'current_positions'
}

function readHttpStatus(error: unknown): number | null {
  if (!(error instanceof Error)) {
    return null
  }
  const match = error.message.match(/(?:HTTP|status)\s+(\d{3})/iu)
  return match?.[1] === undefined ? null : Number(match[1])
}

/**
 * Normalizes Traccar list responses one row at a time so a single malformed
 * upstream row cannot erase valid live tracking data.
 */
function normalizeTraccarRows<T>(input: {
  readonly endpoint: string
  readonly rows: readonly unknown[]
  readonly emptyMessage: string
  readonly warningMessage: string
  readonly logger: TraccarClientLogger
  readonly normalize: (row: unknown) => T
  readonly deviceId?: string
  readonly includeStructuredRejections?: boolean
  readonly allowAllRejected?: boolean
}): {
  readonly accepted: readonly T[]
  readonly rejected: readonly CurrentPositionRejection[]
  readonly droppedCount: number
} {
  const maxDetailedWarnings = 3
  const accepted: T[] = []
  const rejected: CurrentPositionRejection[] = []
  let droppedCount = 0
  for (let rowIndex = 0; rowIndex < input.rows.length; rowIndex += 1) {
    const row = input.rows[rowIndex]
    try {
      accepted.push(input.normalize(row))
    } catch (error) {
      droppedCount += 1
      if (input.includeStructuredRejections === true) {
        const evidence = createRejectedPositionEvidence(row)
        const reason = classifyRejectionReason(error)
        rejected.push({
          deviceId: readRejectedDeviceId(row),
          reason,
          rowIndex,
          anomalyKey: createRejectedPositionAnomalyKey(evidence, reason),
          sourcePositionId: evidence.sourcePositionId,
          canonicalEvidence: evidence.canonicalEvidence,
        })
      }
      if (droppedCount <= maxDetailedWarnings) {
        input.logger.warn(input.warningMessage, {
          ...createRowContext(input, rowIndex),
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  if (droppedCount > maxDetailedWarnings) {
    input.logger.warn('Dropped additional malformed Traccar rows.', {
      endpoint: input.endpoint,
      ...(input.deviceId === undefined ? {} : { deviceId: input.deviceId }),
      droppedCount,
      detailedWarningCount: maxDetailedWarnings,
    })
  }

  if (
    accepted.length === 0 &&
    input.rows.length > 0 &&
    input.allowAllRejected !== true
  ) {
    throw new Error(input.emptyMessage)
  }

  return { accepted, rejected, droppedCount }
}

/**
 * Extracts a device identity from a rejected row without retaining its payload.
 */
function readRejectedDeviceId(row: unknown): string | null {
  if (row == null || typeof row !== 'object' || Array.isArray(row)) {
    return null
  }
  const value = (row as Record<string, unknown>).deviceId
  const parsed = typeof value === 'number' || typeof value === 'string'
    ? Number(value)
    : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null
}

/**
 * Maps internal validation text to a bounded, non-sensitive operator reason.
 */
function classifyRejectionReason(error: unknown): CurrentPositionRejectionReason {
  const message = error instanceof Error ? error.message : String(error)
  if (/latitude|longitude/iu.test(message)) {
    return 'invalid_coordinates'
  }
  if (/\bid\b|deviceId/iu.test(message)) {
    return 'invalid_identity'
  }
  if (/fixTime|deviceTime|serverTime|timestamp/iu.test(message)) {
    return 'invalid_timestamp'
  }
  if (/validity|marked invalid/iu.test(message)) {
    return 'invalid_validity'
  }
  if (/finite number|batteryLevel|numeric field/iu.test(message)) {
    return 'invalid_numeric_field'
  }
  if (/text field/iu.test(message)) {
    return 'invalid_text_field'
  }
  return 'unknown'
}

/**
 * Builds the warning context without including raw upstream row payloads.
 */
function createRowContext(
  input: Pick<TraccarRowContext, 'endpoint' | 'deviceId'>,
  rowIndex: number,
): TraccarRowContext {
  return input.deviceId === undefined
    ? { endpoint: input.endpoint, rowIndex }
    : { endpoint: input.endpoint, rowIndex, deviceId: input.deviceId }
}

function isAuthenticationResponse(response: Response): boolean {
  return response.status === 401 || response.status === 403
}

function createHttpError(response: Response): Error {
  return new Error(`HTTP ${response.status}: ${response.statusText}`)
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs)
  })
}
