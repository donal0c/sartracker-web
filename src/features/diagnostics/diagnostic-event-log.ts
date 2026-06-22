import type { SupportBundleTimeFrame } from '../../types/electron-bridge'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'

const DIAGNOSTIC_EVENTS_STORAGE_KEY = 'sartracker:diagnostic-events'
const MAX_DIAGNOSTIC_EVENTS = 500
const SECRET_KEY_PATTERN = /(password|secret|token|credential|api[-_]?key|authorization)/i
const COORDINATE_KEY_PATTERN = /^(lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i

export type DiagnosticEventLevel = 'info' | 'warn' | 'error'
export type DiagnosticEventCategory =
  | 'map'
  | 'tracking'
  | 'marker'
  | 'drawing'
  | 'measurement'
  | 'gpx'
  | 'layer'
  | 'runtime'

export type DiagnosticEvent = {
  readonly ts: string
  readonly level: DiagnosticEventLevel
  readonly category: DiagnosticEventCategory
  readonly event: string
  readonly fields?: Record<string, string | number | boolean | null>
}

export type DiagnosticEventInput = Omit<DiagnosticEvent, 'ts'> & {
  readonly ts?: string
  readonly fields?: Record<string, unknown>
}

/**
 * Records a sanitized operator-visible diagnostic breadcrumb without blocking app flow.
 */
export async function recordDiagnosticEvent(input: DiagnosticEventInput): Promise<void> {
  const event = sanitizeDiagnosticEvent(input)
  writeBrowserDiagnosticEvent(event)

  if (!isElectronRuntimeAvailable()) {
    return
  }

  try {
    await window.sartrackerElectron?.recordDiagnosticEvent?.(event)
  } catch {
    // Diagnostics are best-effort only; app operation must never depend on logging.
  }
}

/**
 * Reads the bounded browser/renderer diagnostic breadcrumb history.
 */
export function readDiagnosticEvents(): readonly DiagnosticEvent[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.sessionStorage.getItem(DIAGNOSTIC_EVENTS_STORAGE_KEY)
    if (raw === null) {
      return []
    }
    const parsed = JSON.parse(raw) as readonly DiagnosticEvent[]
    return Array.isArray(parsed) ? parsed.filter(isDiagnosticEvent) : []
  } catch {
    return []
  }
}

/**
 * Clears renderer diagnostic breadcrumbs. Intended for tests and validation harness resets.
 */
export function clearDiagnosticEvents(): void {
  if (typeof window === 'undefined') {
    return
  }
  window.sessionStorage.removeItem(DIAGNOSTIC_EVENTS_STORAGE_KEY)
}

/**
 * Formats diagnostic breadcrumbs for support reports, optionally scoped to an incident window.
 */
export function formatDiagnosticEvents(
  events: readonly DiagnosticEvent[],
  timeFrame?: SupportBundleTimeFrame,
): string {
  const scopedEvents = filterDiagnosticEventsByTimeFrame(events, timeFrame)
  const lines = ['[diagnostic-breadcrumbs]', `event count: ${scopedEvents.length}`]
  if (scopedEvents.length === 0) {
    lines.push('no diagnostic breadcrumbs recorded')
    return lines.join('\n')
  }
  for (const event of scopedEvents) {
    lines.push(JSON.stringify(event))
  }
  return lines.join('\n')
}

/**
 * Returns diagnostic breadcrumbs inside a support-bundle time frame.
 */
export function filterDiagnosticEventsByTimeFrame(
  events: readonly DiagnosticEvent[],
  timeFrame?: SupportBundleTimeFrame,
): readonly DiagnosticEvent[] {
  if (timeFrame === undefined) {
    return events
  }
  const incidentMs = Date.parse(timeFrame.incidentAt)
  if (!Number.isFinite(incidentMs)) {
    return events
  }
  const beforeMinutes = Number.isFinite(timeFrame.beforeMinutes) ? timeFrame.beforeMinutes : 30
  const afterMinutes = Number.isFinite(timeFrame.afterMinutes) ? timeFrame.afterMinutes : 30
  const startMs = incidentMs - Math.max(0, beforeMinutes) * 60_000
  const endMs = incidentMs + Math.max(0, afterMinutes) * 60_000
  return events.filter((event) => {
    const timestampMs = Date.parse(event.ts)
    return Number.isFinite(timestampMs) && timestampMs >= startMs && timestampMs <= endMs
  })
}

function writeBrowserDiagnosticEvent(event: DiagnosticEvent): void {
  if (typeof window === 'undefined') {
    return
  }

  const current = readDiagnosticEvents()
  const next = [...current, event].slice(-MAX_DIAGNOSTIC_EVENTS)
  try {
    window.sessionStorage.setItem(DIAGNOSTIC_EVENTS_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage quota or private-mode failures must never block operator actions.
  }
}

function sanitizeDiagnosticEvent(input: DiagnosticEventInput): DiagnosticEvent {
  return {
    ts: normalizeTimestamp(input.ts),
    level: normalizeLevel(input.level),
    category: input.category,
    event: sanitizeToken(input.event, 'unknown'),
    fields: sanitizeFields(input.fields),
  }
}

function sanitizeFields(input: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (input === undefined) {
    return {}
  }
  const sanitized: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of Object.entries(input)) {
    const safeKey = sanitizeToken(key, 'field')
    if (SECRET_KEY_PATTERN.test(safeKey)) {
      sanitized[safeKey] = '[redacted]'
      continue
    }
    if (COORDINATE_KEY_PATTERN.test(safeKey)) {
      sanitized[safeKey] = '[coordinate-redacted]'
      continue
    }
    sanitized[safeKey] = sanitizeValue(value)
  }
  return sanitized
}

function sanitizeValue(value: unknown): string | number | boolean | null {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return anonymizePath(value).slice(0, 240)
  }
  return JSON.stringify(value).slice(0, 240)
}

function anonymizePath(value: string): string {
  return value
    .replace(/(\/(?:home|Users)\/)[^/\s:"]+(?:\/[^\s:"]*)?/g, '$1[redacted]')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s:"]+(?:\\[^\s:"]*)?/g, '$1[redacted]')
}

function sanitizeToken(input: string, fallback: string): string {
  const trimmed = input.trim().replace(/[^a-zA-Z0-9_.:-]/g, '_')
  return trimmed === '' ? fallback : trimmed.slice(0, 80)
}

function normalizeTimestamp(input: string | undefined): string {
  if (input !== undefined && Number.isFinite(Date.parse(input))) {
    return new Date(input).toISOString()
  }
  return new Date().toISOString()
}

function normalizeLevel(input: DiagnosticEventLevel): DiagnosticEventLevel {
  return input === 'error' || input === 'warn' ? input : 'info'
}

function isDiagnosticEvent(input: unknown): input is DiagnosticEvent {
  if (typeof input !== 'object' || input === null) {
    return false
  }
  const candidate = input as Partial<DiagnosticEvent>
  return (
    typeof candidate.ts === 'string' &&
    typeof candidate.level === 'string' &&
    typeof candidate.category === 'string' &&
    typeof candidate.event === 'string'
  )
}
