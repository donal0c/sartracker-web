import type { SupportBundleTimeFrame } from '../../types/electron-bridge'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'

const DIAGNOSTIC_EVENTS_STORAGE_KEY = 'sartracker:diagnostic-events'
const MAX_DIAGNOSTIC_EVENTS = 500
const MAX_STRUCTURED_DIAGNOSTIC_BYTES = 32 * 1024
const MAX_STRUCTURED_DIAGNOSTIC_DEPTH = 12
const MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS = 512
const STRUCTURED_DIAGNOSTIC_LIMIT_MARKER = '[redacted-structured-value-too-large]'
const SENSITIVE_VALUES_INCOMPLETE_MARKER = '__diagnostic_sensitive_values_incomplete__'
const SECRET_KEY_SOURCE = '(?:password|secret|token|credential|api[-_]?key|authorization|pass[-_]?phrase|recovery[-_]?code)'
const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_SOURCE, 'i')
const COORDINATE_KEY_PATTERN = /^(lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i
const SECRET_JSON_KEY_PATTERN = new RegExp(`("${SECRET_KEY_SOURCE}\\s*:\\s*")(?:\\\\.|[^"\\\\])*"`, 'gi')
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${SECRET_KEY_SOURCE}\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'[^'\\r\\n]*'|[^\\r\\n]+)`,
  'gi',
)
const AUTH_HEADER_PATTERN = /\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/gi
const AUTH_TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS_PATTERN = /\b(https?:\/\/)[^/\s@]+@/gi
const URL_QUERY_CREDENTIALS_PATTERN = /([?&](?:session|password|pass[-_]?phrase|secret|token|credential|api[-_]?key|authorization|recovery[-_]?code)=)[^&#\s]+/gi

type SensitiveDiagnosticValues = Set<string>
type StructuredDiagnosticValue = Record<string, unknown> | unknown[]
type DiagnosticTraversalBudget = { elements: number }

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
    return Array.isArray(parsed)
      ? parsed.filter(isDiagnosticEvent).map((event) => sanitizeDiagnosticEvent(event))
      : []
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
    .map((event) => sanitizeDiagnosticEvent(event))
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
    if (sensitiveValues.has(SENSITIVE_VALUES_INCOMPLETE_MARKER)) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    const structured = parseStructuredDiagnosticValue(value)
    if (structured === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(sensitiveValues))
      return JSON.stringify(
        sanitizeNestedValue(structured, '', encodedSensitiveValues, createDiagnosticTraversalBudget()),
      ).slice(0, 240)
    }
    return sanitizeDiagnosticString(value, sensitiveValues).slice(0, 240)
  }
  return JSON.stringify(
    sanitizeNestedValue(value, '', sensitiveValues, createDiagnosticTraversalBudget()),
  ).slice(0, 240)
}

function sanitizeNestedValue(
  value: unknown,
  key = '',
  sensitiveValues: SensitiveDiagnosticValues,
  budget: DiagnosticTraversalBudget,
  depth = 0,
): unknown {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (sensitiveValues.has(SENSITIVE_VALUES_INCOMPLETE_MARKER)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (COORDINATE_KEY_PATTERN.test(key)) {
    return '[coordinate-redacted]'
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(sensitiveValues))
      return sanitizeNestedValue(structured, '', encodedSensitiveValues, budget, depth + 1)
    }
    return sanitizeDiagnosticString(value, sensitiveValues)
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return value.map((item) => sanitizeNestedValue(item, '', sensitiveValues, budget, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return Object.fromEntries(
      entries.map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeNestedValue(nestedValue, nestedKey, sensitiveValues, budget, depth + 1),
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
  budget: DiagnosticTraversalBudget = createDiagnosticTraversalBudget(),
  depth = 0,
): SensitiveDiagnosticValues {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
    return sensitiveValues
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    collectStringValues(value, sensitiveValues, budget, depth + 1)
    return sensitiveValues
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      collectSensitiveValues(structured, '', sensitiveValues, budget, depth + 1)
    }
    return sensitiveValues
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
      return sensitiveValues
    }
    for (const item of value) {
      collectSensitiveValues(item, '', sensitiveValues, budget, depth + 1)
    }
    return sensitiveValues
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
    if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
      return sensitiveValues
    }
    for (const [nestedKey, nestedValue] of entries) {
      collectSensitiveValues(nestedValue, nestedKey, sensitiveValues, budget, depth + 1)
    }
  }
  return sensitiveValues
}

/** Collects non-empty string leaves from a secret-bearing structured value. */
function collectStringValues(
  value: unknown,
  sensitiveValues: SensitiveDiagnosticValues,
  budget: DiagnosticTraversalBudget,
  depth: number,
): void {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
    return
  }
  if (typeof value === 'string' && value !== '') {
    sensitiveValues.add(value)
    const structured = parseStructuredDiagnosticValue(value)
    if (structured !== null) {
      collectSensitiveValues(structured, '', sensitiveValues, budget, depth + 1)
    }
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
      return
    }
    for (const item of value) {
      collectStringValues(item, sensitiveValues, budget, depth + 1)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const values = Object.values(value)
    if (values.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
      return
    }
    for (const nestedValue of values) {
      collectStringValues(nestedValue, sensitiveValues, budget, depth + 1)
    }
  }
}

/** Parses a JSON-encoded object or array supplied as a diagnostic field. */
function parseStructuredDiagnosticValue(input: string): StructuredDiagnosticValue | typeof STRUCTURED_DIAGNOSTIC_LIMIT_MARKER | null {
  const text = input.trim()
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null
  }
  if (new TextEncoder().encode(text).byteLength > MAX_STRUCTURED_DIAGNOSTIC_BYTES) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as StructuredDiagnosticValue)
      : null
  } catch {
    return null
  }
}

/** Creates a per-field budget for recursive diagnostic collection and sanitization. */
function createDiagnosticTraversalBudget(): DiagnosticTraversalBudget {
  return { elements: 0 }
}

/** Enforces bounded recursive diagnostic traversal before visiting another value. */
function consumeDiagnosticTraversalNode(budget: DiagnosticTraversalBudget, depth: number): boolean {
  if (depth > MAX_STRUCTURED_DIAGNOSTIC_DEPTH || budget.elements >= MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
    return false
  }
  budget.elements += 1
  return true
}

/** Replaces known secret values wherever they were repeated in a diagnostic string. */
function redactSensitiveValues(input: string, sensitiveValues: SensitiveDiagnosticValues): string {
  let redacted = input
  for (const value of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (value !== '' && value !== SENSITIVE_VALUES_INCOMPLETE_MARKER) {
      redacted = redacted.replaceAll(value, '[redacted]')
    }
  }
  return redacted
}

/** Redacts free-form secret, credential, and URL patterns before storage or copy. */
function sanitizeDiagnosticString(input: string, sensitiveValues: SensitiveDiagnosticValues): string {
  const sanitized = input
    .replace(SECRET_JSON_KEY_PATTERN, '$1[redacted]"')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')
    .replace(URL_QUERY_CREDENTIALS_PATTERN, '$1[redacted]')
  const redacted = redactSensitiveValues(anonymizePath(sanitized), sensitiveValues)
  return new TextEncoder().encode(redacted).byteLength > MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : redacted
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
