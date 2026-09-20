import type { SupportBundleTimeFrame } from '../../types/electron-bridge'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'

const DIAGNOSTIC_EVENTS_STORAGE_KEY = 'sartracker:diagnostic-events'
const MAX_DIAGNOSTIC_EVENTS = 500
const SECRET_KEY_PATTERN = /(password|secret|token|credential|api[-_]?key|authorization)/i
const COORDINATE_KEY_PATTERN = /^(lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i

type SensitiveDiagnosticValues = Set<string>

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
  const sensitiveValues = collectSensitiveValues(input)
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
    sanitized[safeKey] = sanitizeValue(value, sensitiveValues)
  }
  return sanitized
}

function sanitizeValue(value: unknown, sensitiveValues: SensitiveDiagnosticValues): string | number | boolean | null {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(sensitiveValues))
      return JSON.stringify(sanitizeNestedValue(structured, '', encodedSensitiveValues)).slice(0, 240)
    }
    return redactSensitiveValues(anonymizePath(value), sensitiveValues).slice(0, 240)
  }
  return JSON.stringify(sanitizeNestedValue(value, '', sensitiveValues)).slice(0, 240)
}

function sanitizeNestedValue(value: unknown, key = '', sensitiveValues: SensitiveDiagnosticValues): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (COORDINATE_KEY_PATTERN.test(key)) {
    return '[coordinate-redacted]'
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(sensitiveValues))
      return sanitizeNestedValue(structured, '', encodedSensitiveValues)
    }
    return redactSensitiveValues(anonymizePath(value), sensitiveValues)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeNestedValue(item, '', sensitiveValues))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeNestedValue(nestedValue, nestedKey, sensitiveValues),
      ]),
    )
  }
  return value
}

/** Collects string values held by secret-bearing keys for repeated-value redaction. */
function collectSensitiveValues(
  value: unknown,
  key = '',
  sensitiveValues: SensitiveDiagnosticValues = new Set(),
): SensitiveDiagnosticValues {
  if (SECRET_KEY_PATTERN.test(key)) {
    collectStringValues(value, sensitiveValues)
    return sensitiveValues
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      collectSensitiveValues(structured, '', sensitiveValues)
    }
    return sensitiveValues
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSensitiveValues(item, '', sensitiveValues)
    }
    return sensitiveValues
  }
  if (value !== null && typeof value === 'object') {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      collectSensitiveValues(nestedValue, nestedKey, sensitiveValues)
    }
  }
  return sensitiveValues
}

/** Collects non-empty string leaves from a secret-bearing structured value. */
function collectStringValues(value: unknown, sensitiveValues: SensitiveDiagnosticValues): void {
  if (typeof value === 'string' && value !== '') {
    sensitiveValues.add(value)
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      collectSensitiveValues(structured, '', sensitiveValues)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, sensitiveValues)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const nestedValue of Object.values(value)) {
      collectStringValues(nestedValue, sensitiveValues)
    }
  }
}

/** Parses a JSON-encoded object or array supplied as a diagnostic field. */
function parseStructuredDiagnosticValue(input: string): Record<string, unknown> | unknown[] | null {
  const text = input.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown> | unknown[])
      : null
  } catch {
    return null
  }
}

/** Replaces known secret values wherever they were repeated in a diagnostic string. */
function redactSensitiveValues(input: string, sensitiveValues: SensitiveDiagnosticValues): string {
  let redacted = input
  for (const value of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (value !== '') {
      redacted = redacted.replaceAll(value, '[redacted]')
    }
  }
  return redacted
}

function anonymizePath(value: string): string {
  return value
    .replace(/(\/(?:home|Users)\/)[^/\s:"]+(?:\/[^\s:"]*)?/g, '$1[redacted]')
    .replace(/(\/(?:private|tmp|var)\/)[^/\s:"]+(?:\/[^\s:"]*)?/g, '$1[redacted]')
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
