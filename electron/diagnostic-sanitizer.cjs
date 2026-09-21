const SECRET_KEY_SOURCE = String.raw`(?:auth(?:entication|orization)?|password|secret|token|credential|api[-_]?key|pass[-_]?phrase|recovery[-_]?code)`
const MAX_STRUCTURED_DIAGNOSTIC_BYTES = 32 * 1024
const MAX_STRUCTURED_DIAGNOSTIC_DEPTH = 12
const MAX_STRUCTURED_DIAGNOSTIC_ELEMENTS = 4_096
const MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS = 512
const STRUCTURED_DIAGNOSTIC_LIMIT_MARKER = '[redacted-structured-value-too-large]'
const UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER = '[redacted-unsupported-value]'
const SECRET_KEY_PATTERN = new RegExp(SECRET_KEY_SOURCE, 'i')
const QUERY_CREDENTIAL_KEY_SOURCE = String.raw`(?:session|${SECRET_KEY_SOURCE})`
const COORDINATE_KEY_PATTERN = /^(?:lat|lon|lng|latitude|longitude|coordinate|coordinates|bounds)$/i
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
const HOME_PATH_PATTERNS = Object.freeze([
  [/(\/(?:home|Users)\/)[^/\s\\"]+/g, '$1[redacted]'],
  [/([A-Za-z]:\\Users\\)[^\\\s"]+/g, '$1[redacted]'],
])
const PRIVATE_SYSTEM_PATH_PATTERNS = Object.freeze([
  [/(\/(?:private|tmp|var)\/)[^\s\\\\"]+/g, '$1[redacted]'],
])

function diagnosticByteLength(value) {
  return new TextEncoder().encode(value).byteLength
}

/**
 * Redacts secrets and private local identity from free-form diagnostics text.
 */
function sanitizeDiagnosticText(input, sensitiveValues = new Set()) {
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
    .replace(AUTH_HEADER_PATTERN, '$1[redacted]')
    .replace(AUTH_TOKEN_PATTERN, '[redacted]')
    .replace(URL_CREDENTIALS_PATTERN, '$1[redacted]@')
    .replace(URL_QUERY_CREDENTIALS_PATTERN, '$1[redacted]')

  sanitized = redactSecretAssignments(sanitized)

  for (const [pattern, replacement] of HOME_PATH_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }
  for (const [pattern, replacement] of PRIVATE_SYSTEM_PATH_PATTERNS) {
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
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[redacted]'
  }
  if (knownSensitiveValues.has(value)) {
    return '[redacted]'
  }
  if (COORDINATE_KEY_PATTERN.test(key)) {
    return '[coordinate-redacted]'
  }
  if (typeof value === 'string') {
    if (knownSensitiveValues.has(value)) {
      return '[redacted]'
    }
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
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
      return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    }
    return value.map((item) => sanitizeDiagnosticValue(item, '', knownSensitiveValues, budget, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    return sanitizeDiagnosticFieldsWithContext(value, new Set(), knownSensitiveValues, budget, depth)
  }
  if (typeof value === 'bigint') {
    return UNSUPPORTED_DIAGNOSTIC_VALUE_MARKER
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
    reservedKeys.size === 0,
  )
}

/** Sanitizes structured diagnostics while carrying known secret values through arrays. */
function sanitizeDiagnosticFieldsWithContext(fields, reservedKeys, sensitiveValues, budget, depth, compactOversized = true) {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  let entries
  try {
    entries = Object.entries(fields)
  } catch {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  const sanitized = Object.create(null)
  for (const [key, value] of entries) {
    if (reservedKeys.has(key) || key === 'toJSON') {
      continue
    }
    sanitized[key] = sanitizeDiagnosticValue(value, key, sensitiveValues, budget, depth + 1)
  }
  return boundStructuredDiagnosticValue(sanitized, compactOversized)
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
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
      return sensitiveValues
    }
    for (const item of value) {
      collectSensitiveValues(item, '', sensitiveValues, budget, depth + 1)
    }
    return sensitiveValues
  }
  if (value !== null && typeof value === 'object') {
    let entries
    try {
      entries = Object.entries(value)
    } catch {
      return sensitiveValues
    }
    if (entries.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
      return sensitiveValues
    }
    for (const [nestedKey, nestedValue] of entries) {
      collectSensitiveValues(nestedValue, nestedKey, sensitiveValues, budget, depth + 1)
    }
  }
  return sensitiveValues
}

/** Collects primitive leaves from a secret-bearing structured value. */
function collectStringValues(value, sensitiveValues, budget, depth) {
  if (!consumeDiagnosticTraversalNode(budget, depth)) {
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
  if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint') {
    sensitiveValues.add(value)
    return
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
      return
    }
    for (const item of value) {
      collectStringValues(item, sensitiveValues, budget, depth + 1)
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const values = Object.values(value)
    if (values.length > MAX_STRUCTURED_DIAGNOSTIC_CONTAINER_ELEMENTS) {
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
  if (diagnosticByteLength(text) > MAX_STRUCTURED_DIAGNOSTIC_BYTES) {
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
  return diagnosticByteLength(value) > MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
    : value
}

/** Bounds structured diagnostic output after recursive redaction. */
function boundStructuredDiagnosticValue(value, compactOversized = true) {
  const serialized = safeJsonStringify(value)
  if (serialized === null || diagnosticByteLength(serialized) <= MAX_STRUCTURED_DIAGNOSTIC_BYTES) {
    return serialized === null ? STRUCTURED_DIAGNOSTIC_LIMIT_MARKER : value
  }
  if (!compactOversized) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  if (Array.isArray(value)) {
    return STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }

  const compact = Object.assign(Object.create(null), value)
  const candidates = Object.keys(compact)
    .filter((key) => compact[key] !== STRUCTURED_DIAGNOSTIC_LIMIT_MARKER)
    .sort((left, right) => {
      const leftValue = compact[left]
      const rightValue = compact[right]
      const leftComplexity = leftValue !== null && typeof leftValue === 'object' ? 1 : 0
      const rightComplexity = rightValue !== null && typeof rightValue === 'object' ? 1 : 0
      if (leftComplexity !== rightComplexity) return rightComplexity - leftComplexity
      return (safeJsonStringify(rightValue)?.length ?? 0) - (safeJsonStringify(leftValue)?.length ?? 0)
    })
  for (const key of candidates) {
    if (safeJsonStringify(compact) !== null
      && diagnosticByteLength(safeJsonStringify(compact)) <= MAX_STRUCTURED_DIAGNOSTIC_BYTES) break
    compact[key] = STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
  }
  const compactJson = safeJsonStringify(compact)
  return compactJson !== null && diagnosticByteLength(compactJson) <= MAX_STRUCTURED_DIAGNOSTIC_BYTES
    ? compact
    : STRUCTURED_DIAGNOSTIC_LIMIT_MARKER
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
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
  for (const value of [...sensitiveValues].sort((left, right) => String(right).length - String(left).length)) {
    redacted = redactSensitiveValueOccurrences(redacted, value)
  }
  return redacted
}

function redactSensitiveValueOccurrences(input, value) {
  const needle = String(value)
  if (needle === '') return input
  if (needle.length >= 4) return input.replaceAll(needle, '[redacted]')
  let result = ''
  let cursor = 0
  while (cursor < input.length) {
    const matchIndex = input.indexOf(needle, cursor)
    if (matchIndex < 0) return result + input.slice(cursor)
    const before = matchIndex === 0 ? '' : input[matchIndex - 1]
    const after = input[matchIndex + needle.length] ?? ''
    const boundary = !/[A-Za-z0-9]/.test(before) && !/[A-Za-z0-9]/.test(after)
    result += input.slice(cursor, matchIndex)
    result += boundary ? '[redacted]' : needle
    cursor = matchIndex + needle.length
  }
  return result
}

function redactSecretAssignments(input) {
  return String(input).split('\n').map((line) => {
    SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
    let redacted = ''
    let cursor = 0
    let match
    while ((match = SECRET_ASSIGNMENT_PATTERN.exec(line)) !== null) {
      const key = match[1].replace(/\s*[:=]\s*$/, '')
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

function findDiagnosticAssignmentValueEnd(line, start) {
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

module.exports = {
  sanitizeDiagnosticFields,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue,
}
