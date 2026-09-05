const SECRET_KEY_SOURCE = String.raw`(?:password|secret|token|credential|api[-_]?key|authorization|pass[-_]?phrase|recovery[-_]?code)`
const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_SOURCE, 'i')
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
function sanitizeDiagnosticText(input) {
  let sanitized = String(input)
    .replace(SECRET_JSON_KEY_PATTERN, '$1"[redacted]"')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[redacted]')
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')

  for (const [pattern, replacement] of HOME_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  return sanitized
}

/**
 * Recursively redacts diagnostic values before writing them to app-owned logs.
 */
function sanitizeDiagnosticValue(value, key = '') {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (typeof value === 'string') {
    return sanitizeDiagnosticText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item))
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeDiagnosticFields(value)
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

  const sanitized = {}
  for (const [key, value] of Object.entries(fields)) {
    if (reservedKeys.has(key)) {
      continue
    }
    sanitized[key] = sanitizeDiagnosticValue(value, key)
  }
  return sanitized
}

module.exports = {
  sanitizeDiagnosticFields,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
}
