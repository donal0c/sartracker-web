import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
// @ts-expect-error JavaScript smoke helper is exercised through its runtime contract.
import { attachPackagedPageDiagnostics, sanitizePackagedDiagnosticText, createPackagedStderrCollector } from '../../build/packaged-page-diagnostics.js'

describe('streamed stderr privacy', () => {
  it('sanitizes complete lines and the final partial line across arbitrary chunks', () => {
    const lines: string[] = []
    const collector = createPackagedStderrCollector((line: string) => lines.push(line))
    collector.write('pass')
    collector.write('word=synthetic-secret\nhttps://synthetic-user:')
    collector.write('synthetic-password@example.test/path')
    collector.flush()
    expect(lines).toHaveLength(2)
    expect(lines.join('\n')).not.toContain('synthetic-')
    expect(lines[1]).toContain('example.test/path')
  })
  it('omits oversized lines visibly, recovers at newline and bounds normal output', () => {
    const lines: string[] = []
    const collector = createPackagedStderrCollector((line: string) => lines.push(line))
    for (let index = 0; index < 100; index++) collector.write('x'.repeat(1_000))
    collector.write('\nsafe\n' + 'y'.repeat(3_000) + '\n')
    collector.flush()
    expect(lines).toEqual(['Diagnostic stderr line exceeded 8192 characters; content omitted', 'safe', 'y'.repeat(2_000)])
  })
})

describe('packaged renderer diagnostic custody [DON-254]', () => {
  it('redacts credentials and local identity from retained stacks and URLs', () => {
    const raw = 'at https://synthetic-user:synthetic-password@example.test/script.js\n'
      + 'at /Users/synthetic-operator/app/script.js\nAuthorization: Bearer synthetic-bearer\napi-key=synthetic-key'
    const sanitized = sanitizePackagedDiagnosticText(raw)
    for (const secret of ['synthetic-user', 'synthetic-password', 'synthetic-operator', 'synthetic-bearer', 'synthetic-key']) {
      expect(sanitized).not.toContain(secret)
    }
    expect(sanitized).toContain('example.test/script.js')
    expect(sanitizePackagedDiagnosticText('x'.repeat(3_000))).toHaveLength(2_000)
  })
  it('retains error identity, frame context and request type without inferring a script cause', () => {
    const page = Object.assign(new EventEmitter(), { url: () => 'file:///app/index.html' })
    const events: { field: string; entry: Record<string, unknown>; type: string; source: string }[] = []
    attachPackagedPageDiagnostics(page, (field: string, entry: Record<string, unknown>, type: string, source: string) => {
      events.push({ field, entry, type, source })
    }, (value: unknown) => String(value))
    const error = Object.assign(new Error('An unknown error occurred when fetching the script.'), {
      name: 'NetworkError', stack: 'NetworkError: unknown script\n at file:///app/assets/main.js:12:4',
    })
    page.emit('pageerror', error)
    page.emit('requestfailed', {
      failure: () => ({ errorText: 'net::ERR_ABORTED' }),
      url: () => 'file:///app/assets/worker.js', resourceType: () => 'script', method: () => 'GET',
    })
    expect(events[0]).toMatchObject({ field: 'pageErrors', source: 'renderer-page', entry: {
      name: 'NetworkError', stack: error.stack, pageUrl: 'file:///app/index.html',
      message: error.message,
    } })
    expect(events[0].entry.url).toBeUndefined()
    expect(events[1].entry).toMatchObject({ resourceType: 'script', method: 'GET', url: 'file:///app/assets/worker.js' })
  })
})
