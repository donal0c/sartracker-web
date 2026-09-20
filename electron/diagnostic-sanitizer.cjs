const SECRET_KEY_SOURCE = String.raw`(?:password|secret|token|credential|api[-_]?key|authorization|pass[-_]?phrase|recovery[-_]?code)`
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
const HOME_PATH_PATTERNS = Object.freeze([
  [/(\/(?:home|Users)\/)[^/\s:"]+/g, '$1[redacted]'],
  [/([A-Za-z]:\\Users\\)[^\\\s:"]+/g, '$1[redacted]'],
])

/**
 * Redacts secrets and private local identity from free-form diagnostics text.
 */
function sanitizeDiagnosticText(input, sensitiveValues = new Set()) {
  const structured = parseStructuredDiagnosticText(input)
  if (structured !== null) {
    const structuredSensitiveValues = collectSensitiveValues(structured, '', sensitiveValues)
    return JSON.stringify(sanitizeDiagnosticValue(structured, '', structuredSensitiveValues))
  }

  let sanitized = String(input)
    .replace(SECRET_JSON_KEY_PATTERN, '$1"[redacted]"')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')

  for (const [pattern, replacement] of HOME_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  return redactSensitiveValues(sanitized, sensitiveValues)
}

/**
 * Recursively redacts diagnostic values before writing them to app-owned logs.
 */
function sanitizeDiagnosticValue(value, key = '', sensitiveValues = new Set()) {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (COORDINATE_KEY_PATTERN.test(key)) {
    return '[coordinate-redacted]'
  }
  if (typeof value === 'string') {
    return sanitizeDiagnosticText(value, sensitiveValues)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, '', sensitiveValues))
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeDiagnosticFieldsWithContext(value, new Set(), sensitiveValues)
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

  return sanitizeDiagnosticFieldsWithContext(fields, reservedKeys, collectSensitiveValues(fields))
}

/** Sanitizes structured diagnostics while carrying known secret values through arrays. */
function sanitizeDiagnosticFieldsWithContext(fields, reservedKeys, sensitiveValues) {
  const sanitized = {}
  for (const [key, value] of Object.entries(fields)) {
    if (reservedKeys.has(key)) {
      continue
    }
    sanitized[key] = sanitizeDiagnosticValue(value, key, sensitiveValues)
  }
  return sanitized
}

/** Collects string values held by secret-bearing keys for repeated-value redaction. */
function collectSensitiveValues(value, key = '', sensitiveValues = new Set()) {
  if (SECRET_KEY_PATTERN.test(key)) {
    collectStringValues(value, sensitiveValues)
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
function collectStringValues(value, sensitiveValues) {
  if (typeof value === 'string' && value !== '') {
    sensitiveValues.add(value)
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

/** Parses an encoded structured diagnostic value without treating ordinary text as JSON. */
function parseStructuredDiagnosticText(input) {
  const text = String(input).trim()
  if (!text.startsWith('{') && !text.startsWith('[')) {
    return null
  }
  try {
    const parsed = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Replaces known secret values wherever they were repeated in a diagnostic string. */
function redactSensitiveValues(input, sensitiveValues) {
  let redacted = input
  for (const value of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (value !== '') {
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
