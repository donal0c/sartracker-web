const SHA1 = /^[a-f0-9]{40}$/u
const SHA256 = /^[a-f0-9]{64}$/u
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/u

/** The only proof tier this receipt can establish. */
export const IPC_PROBE_PROOF_MODE = 'packaged-electron-ipc-containment'

/** Describes the bounded C23 producer and its independent evidence boundary. */
export const IPC_PROBE_DESCRIPTOR = Object.freeze({
  contractId: 'C23',
  proofMode: IPC_PROBE_PROOF_MODE,
  schema: 'sartracker-c23-ipc-containment-v1',
  cli: Object.freeze({
    required: Object.freeze(['--app', '--evidence', '--expected-head']),
    repeatable: Object.freeze(['--app-arg']),
  }),
  claims: Object.freeze([
    'packaged renderer webPreferences enable context isolation, sandboxing and disable node integration',
    'the renderer receives only the reviewed preload capability bridge',
    'invalid sender and payload requests are rejected before privileged work',
    'the probe uses no operational mission data or network contact',
  ]),
})

/**
 * Validate one raw packaged C23 probe report independently of any producer flag.
 *
 * @param {unknown} report raw probe output
 * @param {unknown} expected controller-owned app and source identity
 * @returns {object} immutable recomputed receipt
 */
export function validateIpcContainmentReceipt(report, expected) {
  const failures = []
  const binding = validateExpected(expected, failures)
  const predicates = {
    sourceIdentity: false,
    appIdentity: false,
    secureWebPreferences: false,
    rendererIsolation: false,
    invalidSenderDenied: false,
    invalidPayloadDenied: false,
    capabilityBoundary: false,
    noOperationalData: false,
  }
  if (!isRecord(report)) {
    failures.push('C23 IPC containment report is missing or is not an object.')
    return makeResult(predicates, failures)
  }
  if (report.schema !== IPC_PROBE_DESCRIPTOR.schema || report.contractId !== 'C23'
      || report.proofMode !== IPC_PROBE_PROOF_MODE) {
    failures.push('C23 IPC containment report schema or contract identity is invalid.')
  }
  predicates.sourceIdentity = validateSourceIdentity(report.source, binding, failures)
  predicates.appIdentity = validateAppIdentity(report.app, binding, failures)
  predicates.secureWebPreferences = validateWebPreferences(report.runtime?.webPreferences, failures)
  predicates.rendererIsolation = validateRenderer(report.runtime?.renderer, failures)
  predicates.invalidSenderDenied = validateInvalidSender(report.probes?.invalidSender, failures)
  predicates.invalidPayloadDenied = validateInvalidPayload(report.probes?.invalidPayload, failures)
  predicates.capabilityBoundary = validateCapability(report.probes?.capability, failures)
  predicates.noOperationalData = validateCustody(report.custody, failures)
  validateCleanup(report.cleanup, failures)
  const passed = failures.length === 0 && Object.values(predicates).every(Boolean)
  return makeResult(predicates, failures, passed ? 'PASS' : 'INVALID_EVIDENCE')
}

/** Validate the controller-owned identity binding. */
function validateExpected(expected, failures) {
  if (!isRecord(expected) || expected.proofMode !== IPC_PROBE_PROOF_MODE
      || !isRecord(expected.source) || !SHA1.test(expected.source.expectedHead)
      || !isRecord(expected.app) || !isAbsolutePath(expected.app.suppliedPath)
      || (expected.app.executableSha256 !== undefined && !SHA256.test(expected.app.executableSha256))) {
    failures.push('C23 expected binding requires proof mode, source head and supplied app identity.')
    return null
  }
  return expected
}

/** Validate exact source head and clean checkout identity. */
function validateSourceIdentity(source, expected, failures) {
  if (expected === null || !isRecord(source) || source.head !== expected.source.expectedHead
      || source.expectedHead !== expected.source.expectedHead || source.dirty !== false) {
    failures.push('C23 source HEAD does not match the expected clean source identity.')
    return false
  }
  return true
}

/** Validate the exact supplied executable identity reported by the probe. */
function validateAppIdentity(app, expected, failures) {
  if (expected === null || !isRecord(app) || app.suppliedPath !== expected.app.suppliedPath
      || !isAbsolutePath(app.appPath) || app.isPackaged !== true
      || !SHA256.test(app.executableSha256)
      || (expected.app.executableSha256 !== undefined && app.executableSha256 !== expected.app.executableSha256)) {
    failures.push('C23 packaged app identity is missing, untrusted or differs from the expected app.')
    return false
  }
  return true
}

/** Validate hardened Electron webPreferences observed from the main process. */
function validateWebPreferences(webPreferences, failures) {
  if (!isRecord(webPreferences) || webPreferences.contextIsolation !== true
      || webPreferences.nodeIntegration !== false || webPreferences.sandbox !== true) {
    failures.push('C23 packaged webPreferences do not prove context isolation, sandboxing and disabled node integration.')
    return false
  }
  return true
}

/** Validate renderer observations without retaining direct Node capability. */
function validateRenderer(renderer, failures) {
  if (!isRecord(renderer) || renderer.protocol !== 'file:' || renderer.bridgeAvailable !== true
      || renderer.directNodeGlobalsAbsent !== true || renderer.rawIpcCapabilityAbsent !== true) {
    failures.push('C23 renderer isolation evidence is incomplete or exposes a direct Node capability.')
    return false
  }
  return true
}

/** Validate that an invalid sender was rejected by the actual main boundary. */
function validateInvalidSender(probe, failures) {
  if (!isRecord(probe) || probe.attempted !== true || probe.blocked !== true
      || typeof probe.error !== 'string' || !/Blocked Electron IPC request/iu.test(probe.error)) {
    failures.push('C23 invalid sender was not independently rejected by the IPC sender guard.')
    return false
  }
  return true
}

/** Validate that an invalid payload was rejected before privileged work. */
function validateInvalidPayload(probe, failures) {
  if (!isRecord(probe) || probe.attempted !== true || probe.blocked !== true
      || probe.error !== 'Tracking cache contents must be a string.') {
    failures.push('C23 invalid payload was not independently rejected by the IPC payload guard.')
    return false
  }
  return true
}

/** Validate both a safe exposed capability and the absence of an unknown one. */
function validateCapability(probe, failures) {
  if (!isRecord(probe) || probe.safeReadAvailable !== true || probe.safeReadCompleted !== true
      || probe.unknownCapabilityAbsent !== true) {
    failures.push('C23 capability evidence does not prove the reviewed bridge boundary.')
    return false
  }
  return true
}

/** Validate that the probe never used operational data or network contact. */
function validateCustody(custody, failures) {
  if (!isRecord(custody) || custody.operationalDataUsed !== false
      || custody.rawPayloadRetained !== false || custody.networkContactAttempted !== false) {
    failures.push('C23 probe custody records operational data or network contact.')
    return false
  }
  return true
}

/** Ensure the probe joined the app and removed its disposable profile. */
function validateCleanup(cleanup, failures) {
  if (!isRecord(cleanup) || cleanup.appClosed !== true || cleanup.profileRemoved !== true) {
    failures.push('C23 probe cleanup did not close the owned app and remove the disposable profile.')
  }
}

/** Build one immutable result whose status comes only from recomputed predicates. */
function makeResult(predicates, failures, status = 'INVALID_EVIDENCE') {
  const uniqueFailures = [...new Set(failures)]
  return Object.freeze({
    contractId: 'C23',
    proofMode: IPC_PROBE_PROOF_MODE,
    status: uniqueFailures.length === 0 && status === 'PASS' ? 'PASS' : 'INVALID_EVIDENCE',
    valid: uniqueFailures.length === 0 && status === 'PASS',
    passed: uniqueFailures.length === 0 && status === 'PASS',
    releaseEligible: false,
    recomputedPredicates: Object.freeze({ ...predicates }),
    failureReasons: Object.freeze(uniqueFailures),
  })
}

/** Return whether a value is a non-array object. */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Return whether a value is an absolute path accepted by the probe contract. */
function isAbsolutePath(value) {
  return typeof value === 'string' && ABSOLUTE_PATH.test(value)
}
