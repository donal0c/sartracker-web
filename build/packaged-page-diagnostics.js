import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { sanitizeDiagnosticText } = require('../electron/diagnostic-sanitizer.cjs')

/** Captures renderer events without guessing which subsystem caused an error. */
export function attachPackagedPageDiagnostics(page, append, sanitize) {
  page.on('console', (message) => {
    const location = message.location()
    const entry = {
      message: sanitize(message.text()),
      url: sanitize(location.url ?? ''),
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null,
    }
    if (message.type() === 'error') append('consoleErrors', entry, 'console.error', 'renderer-console')
    else if (message.type() === 'warning') append('consoleWarnings', entry, 'console.warning', 'renderer-console')
  })
  page.on('pageerror', (error) => {
    append('pageErrors', {
      message: sanitize(error.message),
      name: sanitize(error.name),
      stack: sanitize(error.stack ?? ''),
      pageUrl: sanitize(page.url()),
    }, 'pageerror', 'renderer-page')
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()
    if (failure !== null) {
      append('networkFailures', {
        message: sanitize(failure.errorText),
        errorText: sanitize(failure.errorText),
        url: sanitize(request.url()),
        resourceType: request.resourceType(),
        method: request.method(),
        pageUrl: sanitize(page.url()),
      }, 'requestfailed', 'renderer-network')
    }
  })
}

/** Uses the application's canonical secret/identity sanitizer before bounding output. */
export function sanitizePackagedDiagnosticText(value) {
  return sanitizeDiagnosticText(value).slice(0, 2_000)
}

/** Assembles bounded raw lines before redaction so chunk boundaries cannot expose secrets. */
export function createPackagedStderrCollector(append) {
  const decoder = new TextDecoder('utf-8')
  let pending = ''
  let oversized = false
  const consume = (text) => {
    for (const character of text) {
      if (character === '\n') finish()
      else if (!oversized) {
        if (pending.length + character.length > 8_192) {
          pending = ''
          oversized = true
        } else pending += character
      }
    }
  }
  const finish = () => {
    if (oversized) append('Diagnostic stderr line exceeded 8192 characters; content omitted')
    else if (pending !== '') append(sanitizePackagedDiagnosticText(pending.replace(/\r$/u, '')))
    pending = ''
    oversized = false
  }
  return {
    write(chunk) {
      const bytes = typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.isBuffer(chunk) ? chunk
          : ArrayBuffer.isView(chunk)
            ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)
            : Buffer.from(String(chunk), 'utf8')
      consume(decoder.decode(bytes, { stream: true }))
    },
    flush() {
      consume(decoder.decode())
      finish()
    },
  }
}

/** Waits for a present stderr stream to finish before terminal validation. */
export function waitForPackagedStderrDrain(stream, timeoutMs) {
  if (stream === null || typeof stream !== 'object') return Promise.resolve(false)
  if (stream.errored !== null && stream.errored !== undefined) return Promise.resolve(false)
  if (stream.readableEnded === true) return Promise.resolve(true)
  if (stream.destroyed === true) return Promise.resolve(false)
  if (typeof stream.once !== 'function' || typeof stream.off !== 'function') return Promise.resolve(false)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.resolve(false)
  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      stream.off('end', onEnd)
      stream.off('close', onClose)
      stream.off('error', onError)
      resolve(value)
    }
    const onEnd = () => finish(true)
    const onClose = () => finish(stream.readableEnded === true)
    const onError = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    stream.once('end', onEnd)
    stream.once('close', onClose)
    stream.once('error', onError)
  })
}
