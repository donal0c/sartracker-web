import type { SupportBundleTimeFrame } from '../../types/electron-bridge'
import { isElectronRuntimeAvailable } from '../../lib/desktop-runtime'

const DIAGNOSTIC_EVENTS_STORAGE_KEY = 'sartracker:diagnostic-events'
const MAX_DIAGNOSTIC_EVENTS = 500
const MAX_STRUCTURED_DIAGNOSTIC_BYTES = 32 * 1024
const MAX_STRUCTURED_DIAGNOSTIC_DEPTH = 12
const MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS = 4_096
const MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS = 512
const MAX_RENDERER_FIELD_BYTES = 240
const STRUCTURED_DIAGNOSTIC_LIMIT_MARKER = '[redacted-structured-value-too-large]'
const UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER = '[redacted-unsupported-value]'
const SECRET_KEY_SOURCE = '(?:auth(?:entication|orization)?|password|secret|token|credential|api[-_]?key|pass[-_]?phrase|recovery[-_]?code)'
const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_SOURCE, 'i')
const QUERY_CREDENTIAL_KEY_SOURCE = `(?:session|${SECRET_KEY_SOURCE})`
const COORDINATE_KEY_PATTERN = /^(lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i
const SECRET_JSON_KEY_PATTERN = new RegExp(
  `("(?:[^"\\\\]*${SECRET_KEY_SOURCE}[^"\\\\]*)"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
  'gi',
)
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `\\b([A-Za-z0-9_.-]+\\s*[:=]\\s*)`,
  'gi',
)
const AUTH_HEADER_PATTERN = /\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/gi
const AUTH_TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS_PATTERN = /\b(https?:\/\/)[^/\s@]+@/gi
const URL_QUERY_CREDENTIALS_PATTERN = new RegExp(
  `([?&][A-Za-z0-9_.-]*${QUERY_CREDENTIAL_KEY_SOURCE}[A-Za-z0-9_.-]*=)[^&#\\s]+`,
  'gi',
)

type SensitiveDiagnosticValue = string | number | bigint
type SensitiveDiagnosticValues = Set<SensitiveDiagnosticValue>
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
  try {
    const event = sanitizeDiagnosticEvent(input)
    writeBrowserDiagnosticEvent(event)

    if (!isElectronRuntimeAvailable()) {
      return
    }
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
    category: normalizeCategory(input.category),
    event: sanitizeToken(input.event, 'unknown'),
    fields: sanitizeFields(input.fields),
  }
}

function sanitizeFields(input: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> {
  if (input === undefined) {
    return {}
  }
  const entries = readOwnEnumerableDataEntries(input)
  if (entries === null || entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
    return { diagnosticFields: STRUCTURED_DIAGNOSTIC_LIMIT_MARKER }
  }
  const sensitiveValues = collectSensitiveValues(input)
  const sanitized: Record<string, string | number | boolean | null> = {}
  for (const [key, value] of entries) {
    const safeKey = sanitizeToken(key, 'field')
    if (SECRET_KEY_PATTERN.test(key) || SECRET_KEY_PATTERN.test(safeKey)) {
      sanitized[safeKey] = '[redacted]'
      continue
    }
    if (COORDINATE_KEY_PATTERN.test(safeKey)) {
      sanitized[safeKey] = '[coordinate-redacted]'
      continue
    }
    sanitized[safeKey] = sanitizeValue(value, sensitiveValues)
  }
  return new TextEncoder().encode(JSON.stringify(sanitized)).byteLength > MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? { diagnosticFields: STRUCTURED_DIAGNOSTIC_LIMIT_MARKER }
    : sanitized
}

function sanitizeValue(value: unknown, sensitiveValues: SensitiveDiagnosticValues): string | number | boolean | null {
  if (sensitiveValues.has(value as SensitiveDiagnosticValue)) {
    return '[redacted]'
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticValue(value)
    if (structured === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(sensitiveValues))
      const encoded = JSON.stringify(
        sanitizeNestedValue(structured, '', encodedSensitiveValues, createDiagnosticTraversalBudget()),
      )
      return encoded === undefined ? UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER : boundRendererField(encoded)
    }
    return boundRendererField(sanitizeDiagnosticString(value, sensitiveValues))
  }
  if (typeof value === 'bigint') {
    return UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER
  }
  const encoded = JSON.stringify(
    sanitizeNestedValue(value, '', sensitiveValues, createDiagnosticTraversalBudget()),
  )
  return encoded === undefined ? UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER : boundRendererField(encoded)
}

function boundRendererField(value: string): string {
  return new TextEncoder().encode(value).byteLength > MAX_RENDERER_FIELD_BYTES
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : value
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
  if (sensitiveValues.has(value as SensitiveDiagnosticValue)) {
    return '[redacted]'
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
    const values = readOwnArrayDataValues(value)
    if (values === null) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return values.map((item) => sanitizeNestedValue(item, '', sensitiveValues, budget, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    const entries = readOwnEnumerableDataEntries(value)
    if (entries === null) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return Object.fromEntries(
      entries
        .filter(([nestedKey]) => nestedKey !== 'toJSON')
        .map(([nestedKey, nestedValue]) => [
        nestedKey,
        sanitizeNestedValue(nestedValue, nestedKey, sensitiveValues, budget, depth + 1),
        ]),
    )
  }
  if (typeof value === 'bigint') {
    return UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER
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
    const values = readOwnArrayDataValues(value)
    if (values === null) {
      return sensitiveValues
    }
    for (const item of values) {
      collectSensitiveValues(item, '', sensitiveValues, budget, depth + 1)
    }
    return sensitiveValues
  }
  if (value !== null && typeof value === 'object') {
    const entries = readOwnEnumerableDataEntries(value)
    if (entries === null) return sensitiveValues
    if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
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
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') {
    sensitiveValues.add(value)
    return
  }
  if (Array.isArray(value)) {
    const values = readOwnArrayDataValues(value)
    if (values === null) {
      return
    }
    for (const item of values) {
      collectStringValues(item, sensitiveValues, budget, depth + 1)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const entries = readOwnEnumerableDataEntries(value)
    if (entries === null || entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) return
    for (const [, nestedValue] of entries) {
      collectStringValues(nestedValue, sensitiveValues, budget, depth + 1)
    }
  }
}

/** Read enumerable own data properties without executing caller-provided getters. */
function readOwnEnumerableDataEntries(value: object): [string, unknown][] | null {
  let keys: string[]
  try {
    keys = Object.keys(value)
  } catch {
    return null
  }
  if (keys.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) return null

  const entries: [string, unknown][] = []
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key)
    } catch {
      return null
    }
    if (descriptor === undefined || descriptor.enumerable !== true) continue
    entries.push([
      key,
      Object.hasOwn(descriptor, 'value') ? descriptor.value : UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER,
    ])
  }
  return entries
}

/** Read bounded array elements through descriptors so accessors are never invoked. */
function readOwnArrayDataValues(value: unknown[]): unknown[] | null {
  if (value.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) return null
  const values: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    } catch {
      return null
    }
    if (descriptor === undefined) {
      values.push(undefined)
    } else if (descriptor.enumerable !== true) {
      values.push(undefined)
    } else {
      values.push(Object.hasOwn(descriptor, 'value') ? descriptor.value : UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER)
    }
  }
  return values
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
  for (const value of [...sensitiveValues].sort((left, right) => String(right).length - String(left).length)) {
    redacted = redactSensitiveValueOccurrences(redacted, value)
  }
  return redacted
}

function redactSensitiveValueOccurrences(input: string, value: SensitiveDiagnosticValue): string {
  const needle = String(value)
  if (needle === '') return input
  if (needle.length >= 4) return input.replaceAll(needle, '[redacted]')
  let result = ''
  let cursor = 0
  while (cursor < input.length) {
    const matchIndex = input.indexOf(needle, cursor)
    if (matchIndex < 0) return result + input.slice(cursor)
    const before = matchIndex === 0 ? '' : input[matchIndex - 1] ?? ''
    const after = input[matchIndex + needle.length] ?? ''
    const boundary = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)
    result += input.slice(cursor, matchIndex)
    result += boundary ? '[redacted]' : needle
    cursor = matchIndex + needle.length
  }
  return result
}

function redactSecretAssignments(input: string): string {
  return String(input).split('\n').map((line) => {
    SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
    let redacted = ''
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = SECRET_ASSIGNMENT_PATTERN.exec(line)) !== null) {
      const key = (match[1] ?? '').replace(/\s*[:=]\s*$/u, '')
      if (SECRET_KEY_PATTERN.test(key)) {
        const valueStart = match.index + match[0].length
        const valueEnd = findDiagnosticAssignmentValueEnd(line, valueStart)
        redacted += line.slice(cursor, valueStart)
        redacted += '[redacted]'
        cursor = valueEnd
        SECRET_ASSIGNMENT_PATTERN.lastIndex = valueEnd
      }
    }
    return redacted + line.slice(cursor)
  }).join('\n')
}

function findDiagnosticAssignmentValueEnd(line: string, start: number): number {
  const quote = line[start]
  if (quote === '"' || quote === "'") {
    let escaped = false
    for (let index = start + 1; index < line.length; index += 1) {
      const character = line[index]
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === quote) {
        return index + 1
      }
    }
    return line.length
  }
  const whitespace = line.slice(start).search(/\s/u)
  return whitespace < 0 ? line.length : start + whitespace
}

/** Redacts free-form secret, credential, and URL patterns before storage or copy. */
function sanitizeDiagnosticString(input: string, sensitiveValues: SensitiveDiagnosticValues): string {
  const sanitized = input
    .replace(SECRET_JSON_KEY_PATTERN, '$1[redacted]"')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')
    .replace(URL_QUERY_CREDENTIALS_PATTERN, '$1[redacted]')
  const redacted = redactSensitiveValues(anonymizePath(redactSecretAssignments(sanitized)), sensitiveValues)
  return new TextEncoder().encode(redacted).byteLength > MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : redacted
}

function anonymizePath(value: string): string {
  return value
    .replace(/(\/(?:home|Users)\/)[^/\s\\"]+(?:\/[^\s\\"]*)?/g, '$1[redacted]')
    .replace(/(\/(?:private|tmp|var)\/)[^/\s\\"]+(?:\/[^\s\\"]*)?/g, '$1[redacted]')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"]+(?:\\[^\s"]*)?/g, '$1[redacted]')
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

function normalizeCategory(input: DiagnosticEventCategory): DiagnosticEventCategory {
  return input === 'map' || input === 'tracking' || input === 'marker' || input === 'drawing'
    || input === 'measurement' || input === 'gpx' || input === 'layer' || input === 'runtime'
    ? input
    : 'runtime'
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
