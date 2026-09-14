import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { assertNoUnexpectedDiagnostics, appendBoundedDiagnostic, createDiagnosticState } from '../../build/electron-repair-train-d-smoke-lib.js'
// @ts-expect-error JavaScript smoke helper is exercised through its runtime contract.
import {
  attachPackagedPageDiagnostics,
  createPackagedStderrCollector,
  sanitizePackagedDiagnosticText,
  waitForPackagedStderrDrain,
} from '../../build/packaged-page-diagnostics.js'

describe('streamed stderr privacy', () => {
  it('preserves a UTF-8 code point split across Buffer chunks', () => {
    const lines: string[] = []
    const collector = createPackagedStderrCollector((line: string) => lines.push(line))
    const encoded = Buffer.from('rescue\u00e9\n', 'utf8')
    collector.write(encoded.subarray(0, encoded.length - 2))
    collector.write(encoded.subarray(encoded.length - 2, encoded.length - 1))
    collector.write(encoded.subarray(encoded.length - 1))
    collector.flush()
    expect(lines).toEqual(['rescue\u00e9'])
  })

  it('fails closed when the owned process has no stderr stream', async () => {
    await expect(waitForPackagedStderrDrain(undefined, 100)).resolves.toBe(false)
  })

  it('fails closed when stderr was destroyed by an error before drain starts', async () => {
    const stream = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: true,
      errored: new Error('stderr pipe failed'),
    })
    await expect(waitForPackagedStderrDrain(stream, 100)).resolves.toBe(false)
  })

  it('fails closed when stderr closes before its readable end', async () => {
    const stream = Object.assign(new EventEmitter(), {
      readableEnded: false,
      destroyed: false,
      errored: null,
    })
    const draining = waitForPackagedStderrDrain(stream, 100)
    stream.emit('close')
    await expect(draining).resolves.toBe(false)
  })

  it('waits for the stream terminal event before flushing late fatal stderr', async () => {
    const lines: string[] = []
    const diagnostics = createDiagnosticState()
    const collector = createPackagedStderrCollector((line: string) => lines.push(line))
    const stream = new EventEmitter() as EventEmitter & {
      readableEnded: boolean
      destroyed: boolean
    }
    stream.readableEnded = false
    stream.destroyed = false
    collector.write('safe\n')
    const drained = waitForPackagedStderrDrain(stream, 100)
    collector.write('fatal after child exit')
    stream.readableEnded = true
    stream.emit('end')
    stream.emit('close')
    await expect(drained).resolves.toBe(true)
    collector.flush()
    expect(lines).toEqual(['safe', 'fatal after child exit'])
    appendBoundedDiagnostic(diagnostics, 'processStderr', { message: lines[1] }, {
      phase: 'close', type: 'stderr', source: 'main-process-stderr',
    })
    expect(() => assertNoUnexpectedDiagnostics(diagnostics)).toThrow(/unexpected packaged diagnostics/i)
  })

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
