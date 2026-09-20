const SECRET_KEY_SOURCE = String.raw`(?:password|secret|token|credential|api[-_]?key|authorization|pass[-_]?phrase|recovery[-_]?code)`
const MAX_STRUCTURED_DIAGNOSTIC_BYTES = 32 * 1024
const MAX_STRUCTURED_DIAGNOSTIC_DEPTH = 12
const MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS = 512
const STRUCTURED_DIAGNOSTIC_LIMIT_MARKER = '[redacted-structured-value-too-large]'
const SENSITIVE_VALUES_INCOMPLETE_MARKER = '__diagnostic_sensitive_values_incomplete__'
const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_SOURCE, 'i')
const COORDINATE_KEY_PATTERN = /^(?:lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i
const SECRET_JSON_KEY_PATTERN = new RegExp(
  `("${SECRET_KEY_SOURCE}"\\s*:\\s*)"(?:\\\\.|[^"\\\\])*"`,
  'gi',
)
const SECRET_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${SECRET_KEY_SOURCE}\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'[^'\\r\\n]*'|[^\\r\\n]+)`,
  'gi',
)
const AUTH_HEADER_PATTERN = /\b(Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+/gi
const AUTH_TOKEN_PATTERN = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi
const URL_CREDENTIALS_PATTERN = /\b(https?:\/\/)[^/\s@]+@/gi
const URL_QUERY_CREDENTIALS_PATTERN = /([?&](?:session|password|pass[-_]?phrase|secret|token|credential|api[-_]?key|authorization|recovery[-_]?code)=)[^&#\s]+/gi
const HOME_PATH_PATTERNS = Object.freeze([
  [/(\/(?:home|Users)\/)[^/\s:"]+/g, '$1[redacted]'],
  [/([A-Za-z]:\\Users\\)[^\\\s:"]+/g, '$1[redacted]'],
])

/**
 * Redacts secrets and private local identity from free-form diagnostics text.
 */
function sanitizeDiagnosticText(input, sensitiveValues = new Set()) {
  if (sensitiveValues.has(SENSITIVE_VALUES_INCOMPLETE_MARKER)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  const structured = parseStructuredDiagnosticText(input)
  if (structured === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (structured !== null) {
    const structuredSensitiveValues = collectSensitiveValues(structured, '', sensitiveValues)
    return boundDiagnosticText(JSON.stringify(
      sanitizeDiagnosticValue(structured, '', structuredSensitiveValues, createDiagnosticTraversalBudget()),
    ))
  }

  let sanitized = String(input)
    .replace(SECRET_JSON_KEY_PATTERN, '$1"[redacted]"')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')
    .replace(URL_QUERY_CREDENTIALS_PATTERN, '$1[redacted]')

  for (const [pattern, replacement] of HOME_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  return boundDiagnosticText(redactSensitiveValues(sanitized, sensitiveValues))
}

/**
 * Recursively redacts diagnostic values before writing them to app-owned logs.
 */
function sanitizeDiagnosticValue(
  value,
  key = '',
  sensitiveValues,
  budget = createDiagnosticTraversalBudget(),
  depth = 0,
) {
  const knownSensitiveValues = sensitiveValues ?? collectSensitiveValues(value, key)
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (knownSensitiveValues.has(SENSITIVE_VALUES_INCOMPLETE_MARKER)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (COORDINATE_KEY_PATTERN.test(key)) {
    return '[coordinate-redacted]'
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticText(value)
    if (structured === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    if (structured !== null) {
      const encodedSensitiveValues = collectSensitiveValues(structured, '', new Set(knownSensitiveValues))
      return sanitizeDiagnosticValue(structured, '', encodedSensitiveValues, budget, depth + 1)
    }
    return sanitizeDiagnosticText(value, knownSensitiveValues)
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return value.map((item) => sanitizeDiagnosticValue(item, '', knownSensitiveValues, budget, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeDiagnosticFieldsWithContext(value, new Set(), knownSensitiveValues, budget, depth)
  }
  return value
}

/**
 * Returns a recursive sanitized copy of an object-like diagnostics payload.
 */
function sanitizeDiagnosticFields(fields, reservedKeys = new Set()) {
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    return {}
  }

  return sanitizeDiagnosticFieldsWithContext(
    fields,
    reservedKeys,
    collectSensitiveValues(fields),
    createDiagnosticTraversalBudget(),
    0,
  )
}

/** Sanitizes structured diagnostics while carrying known secret values through arrays. */
function sanitizeDiagnosticFieldsWithContext(fields, reservedKeys, sensitiveValues, budget, depth) {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  const entries = Object.entries(fields)
  if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  const sanitized = {}
  for (const [key, value] of entries) {
    if (reservedKeys.has(key)) {
      continue
    }
    sanitized[key] = sanitizeDiagnosticValue(value, key, sensitiveValues, budget, depth + 1)
  }
  return boundStructuredDiagnosticValue(sanitized)
}

/** Collects string values held by secret-bearing keys for repeated-value redaction. */
function collectSensitiveValues(
  value,
  key = '',
  sensitiveValues = new Set(),
  budget = createDiagnosticTraversalBudget(),
  depth = 0,
) {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
    return sensitiveValues
  }
  if (SECRET_KEY_PATTERN.test(key)) {
    collectStringValues(value, sensitiveValues, budget, depth + 1)
    return sensitiveValues
  }
  if (typeof value === 'string') {
    const structured = parseStructuredDiagnosticText(value)
    if (structured !== null && structured !== STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
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
function collectStringValues(value, sensitiveValues, budget, depth) {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    sensitiveValues.add(SENSITIVE_VALUES_INCOMPLETE_MARKER)
    return
  }
  if (typeof value === 'string' && value !== '') {
    sensitiveValues.add(value)
    const structured = parseStructuredDiagnosticText(value)
    if (structured !== null && structured !== STRUCTURED_DIAGNOSTIC_LIMIT_MARKER) {
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

/** Parses an encoded structured diagnostic value without treating ordinary text as JSON. */
function parseStructuredDiagnosticText(input) {
  const text = String(input).trim()
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_STRUCTURED_DIAGNOSTIC_BYTES) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Bounds free-form diagnostic text after redaction while retaining a visible failure marker. */
function boundDiagnosticText(value) {
  return Buffer.byteLength(value, 'utf8') > MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : value
}

/** Bounds structured diagnostic output after recursive redaction. */
function boundStructuredDiagnosticValue(value) {
  return boundDiagnosticText(JSON.stringify(value)) === STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : value
}

/** Creates a per-field budget for recursive diagnostic collection and sanitization. */
function createDiagnosticTraversalBudget() {
  return { elements: 0 }
}

/** Enforces bounded recursive diagnostic traversal before visiting another value. */
function consumeDiagnosticTraversalNode(budget, depth) {
  if (depth > MAX_STRUCTURED_DIAGNOSTIC_DEPTH || budget.elements >= MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS) {
    return false
  }
  budget.elements += 1
  return true
}

/** Replaces known secret values wherever they were repeated in a diagnostic string. */
function redactSensitiveValues(input, sensitiveValues) {
  let redacted = input
  for (const value of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (value !== '' && value !== SENSITIVE_VALUES_INCOMPLETE_MARKER) {
      redacted = redacted.replaceAll(value, '[redacted]')
    }
  }
  return redacted
}

module.exports = {
  sanitizeDiagnosticFields,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
}
