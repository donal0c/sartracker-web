import { describe, expect, it } from 'vitest'

import { parseIpcProbeArgs } from '../../scripts/qualification/ipc-probe.mjs'
import {
  IPC_PROBE_PROOF_MODE,
  validateIpcContainmentReceipt,
} from '../../scripts/qualification/ipc-receipts.mjs'

const HEAD = 'a'.repeat(40)
const APP_PATH = '/tmp/SARTracker.AppImage'
const APP_SHA256 = 'b'.repeat(64)

const expected = {
  proofMode: IPC_PROBE_PROOF_MODE,
  source: { expectedHead: HEAD },
  app: { suppliedPath: APP_PATH, executableSha256: APP_SHA256 },
}

/** Build complete raw C23 observations; the producer result is intentionally irrelevant. */
function report(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'sartracker-c23-ipc-containment-v1',
    contractId: 'C23',
    proofMode: IPC_PROBE_PROOF_MODE,
    source: { head: HEAD, expectedHead: HEAD, dirty: false },
    app: {
      suppliedPath: APP_PATH,
      executableSha256: APP_SHA256,
      isPackaged: true,
      appPath: '/tmp/SARTracker.AppImage/resources/app.asar',
    },
    runtime: {
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
      renderer: {
        protocol: 'file:',
        bridgeAvailable: true,
        directNodeGlobalsAbsent: true,
        rawIpcCapabilityAbsent: true,
      },
    },
    probes: {
      invalidSender: {
        attempted: true,
        blocked: true,
        error: 'Blocked Electron IPC request from unexpected renderer: data:',
      },
      invalidPayload: {
        attempted: true,
        blocked: true,
        error: 'Tracking cache contents must be a string.',
      },
      capability: {
        safeReadAvailable: true,
        safeReadCompleted: true,
        unknownCapabilityAbsent: true,
      },
    },
    custody: {
      operationalDataUsed: false,
      rawPayloadRetained: false,
      networkContactAttempted: false,
    },
    cleanup: { appClosed: true, profileRemoved: true },
    result: 'pass',
    passed: true,
    ...overrides,
  }
}

describe('C23 packaged IPC containment receipt validation', () => {
  it('parses an exact app/evidence/head invocation and preserves app args', () => {
    expect(parseIpcProbeArgs([
      '--app', APP_PATH,
      '--evidence', '/tmp/c23-evidence',
      '--expected-head', HEAD,
      '--app-arg', '--no-sandbox',
      '--', '--ozone-platform=x11',
    ])).toEqual({
      appPath: APP_PATH,
      evidenceDir: '/tmp/c23-evidence',
      expectedHead: HEAD,
      extraArgs: ['--no-sandbox', '--ozone-platform=x11'],
    })
  })

  it.each([
    [['--evidence', '/tmp/e', '--expected-head', HEAD], /--app/iu],
    [['--app', 'relative', '--evidence', '/tmp/e', '--expected-head', HEAD], /absolute/iu],
    [['--app', APP_PATH, '--evidence', '/tmp/e', '--expected-head', 'main'], /expected-head/iu],
    [['--app', APP_PATH, '--evidence', '/tmp/e', '--expected-head', HEAD, '--unknown'], /unknown/iu],
  ])('rejects unsafe invocation %j', (argv, error) => {
    expect(() => parseIpcProbeArgs(argv as string[])).toThrow(error)
  })

  it('recomputes every raw containment predicate and ignores producer passed flags', () => {
    const result = validateIpcContainmentReceipt({ ...report(), result: 'fail', passed: false }, expected)

    expect(result).toMatchObject({
      contractId: 'C23',
      status: 'PASS',
      valid: true,
      passed: true,
      releaseEligible: false,
      proofMode: IPC_PROBE_PROOF_MODE,
    })
    expect(result.recomputedPredicates).toEqual({
      sourceIdentity: true,
      appIdentity: true,
      secureWebPreferences: true,
      rendererIsolation: true,
      invalidSenderDenied: true,
      invalidPayloadDenied: true,
      capabilityBoundary: true,
      noOperationalData: true,
    })
  })

  it.each([
    ['producer-only pass', { runtime: undefined, probes: undefined }],
    ['context isolation disabled', { runtime: { ...report().runtime, webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: true } } }],
    ['direct Node globals exposed', { runtime: { ...report().runtime, renderer: { ...report().runtime.renderer, directNodeGlobalsAbsent: false } } }],
    ['invalid sender accepted', { probes: { ...report().probes, invalidSender: { attempted: true, blocked: false, error: null } } }],
    ['invalid payload accepted', { probes: { ...report().probes, invalidPayload: { attempted: true, blocked: false, error: null } } }],
    ['operational data used', { custody: { ...report().custody, operationalDataUsed: true } }],
  ])('rejects %s from raw observations', (_label, overrides) => {
    const result = validateIpcContainmentReceipt({ ...report(), ...overrides }, expected)

    expect(result.valid).toBe(false)
    expect(result.status).toBe('INVALID_EVIDENCE')
    expect(result.releaseEligible).toBe(false)
    expect(result.failureReasons.length).toBeGreaterThan(0)
  })

  it('rejects source and supplied-app identity drift', () => {
    const result = validateIpcContainmentReceipt({
      ...report(),
      source: { head: 'c'.repeat(40), dirty: false },
      app: { ...report().app, suppliedPath: '/tmp/other-app' },
    }, expected)

    expect(result.valid).toBe(false)
    expect(result.failureReasons.join(' ')).toMatch(/source|app/iu)
  })
})
