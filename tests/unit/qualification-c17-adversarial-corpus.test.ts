// @vitest-environment jsdom

import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

import {
  C17_ADVERSARIAL_CASE_IDS,
  C17_ADVERSARIAL_CONTROL_PREFIX,
  C17_ADVERSARIAL_OUTPUT_LIMIT_BYTES,
  C17_ADVERSARIAL_RENDERER_LIMIT_BYTES,
  C17_ADVERSARIAL_SOURCE_TEST_NAME,
  C17_STRUCTURED_LIMIT_MARKER,
  C17_UNSUPPORTED_MARKER,
  createC17AdversarialCorpus,
} from '../fixtures/c17-adversarial-corpus.mjs'
import { formatDiagnosticEvents, readDiagnosticEvents, recordDiagnosticEvent } from '../../src/features/diagnostics/diagnostic-event-log'

const require = createRequire(import.meta.url)
const { sanitizeDiagnosticFields } = require('../../electron/diagnostic-sanitizer.cjs') as {
  readonly sanitizeDiagnosticFields: (fields: Record<string, unknown>) => Record<string, unknown>
}

/** Confirm the serialized sanitizer result retains controls and no forbidden value. */
function expectSafeCorpusOutput(serialized: string, forbiddenValues: readonly string[]): void {
  for (const forbidden of forbiddenValues) {
    expect(serialized).not.toContain(forbidden)
  }
  for (const caseId of C17_ADVERSARIAL_CASE_IDS) {
    expect(serialized).toContain(`${C17_ADVERSARIAL_CONTROL_PREFIX}${caseId}`)
  }
  expect(serialized).toContain(C17_STRUCTURED_LIMIT_MARKER)
  expect(serialized).toContain(C17_UNSUPPORTED_MARKER)
  expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(C17_ADVERSARIAL_RENDERER_LIMIT_BYTES)
}

describe('C17 adversarial sanitizer corpus [DON-254]', () => {
  it(C17_ADVERSARIAL_SOURCE_TEST_NAME, async () => {
    window.sessionStorage.clear()

    const rendererCorpus = createC17AdversarialCorpus()
    await recordDiagnosticEvent({
      ts: '2026-09-23T00:00:00.000Z',
      level: 'error',
      category: 'runtime',
      event: 'c17_source_adversarial_corpus',
      fields: rendererCorpus.fields,
    })
    const rendererEvents = readDiagnosticEvents()
    const rendererOutput = `${JSON.stringify(rendererEvents)}\n${formatDiagnosticEvents(rendererEvents)}`
    expectSafeCorpusOutput(rendererOutput, rendererCorpus.forbiddenValues)
    expect(rendererCorpus.hookCalls).toEqual({ getter: 0, toJSONGetter: 0, toJSON: 0 })

    const electronCorpus = createC17AdversarialCorpus()
    const electronOutput = JSON.stringify(sanitizeDiagnosticFields(electronCorpus.fields))
    expectSafeCorpusOutput(electronOutput, electronCorpus.forbiddenValues)
    expect(electronCorpus.hookCalls).toEqual({ getter: 0, toJSONGetter: 0, toJSON: 0 })
    expect(new TextEncoder().encode(electronOutput).byteLength).toBeLessThanOrEqual(C17_ADVERSARIAL_OUTPUT_LIMIT_BYTES)
  })
})
