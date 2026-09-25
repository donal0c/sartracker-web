import {
  C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
  C01_HELD_GATE_TIMEOUT_MS,
  C01_STARTUP_RESPONSE_TIMEOUT_MS,
} from './startup-receipts.mjs'

/** Check bounded fault mechanics while explicitly preserving a negative product observation. */
export function inspectHeldGateDevelopment(report, gateKind) {
  const scenario = report?.scenario
  const failures = []
  const profileKind = gateKind === 'crash'
    ? 'non-regular-crash-evidence'
    : `held-${gateKind === 'crash-write' ? 'crash' : gateKind}-gate`
  const mode = {
    diagnostics: 'post-readiness-watchdog-timeout',
    crash: 'non-regular-evidence-rejection',
    'crash-write': 'crash-log-write-hold',
    store: 'sqlite-lock-contention',
  }[gateKind]
  const held = gateKind !== 'crash'
  const scenarioGateKind = gateKind === 'crash-write' ? 'crash' : gateKind
  if (!['diagnostics', 'crash', 'crash-write', 'store'].includes(gateKind)
      || report?.schema !== 'sartracker-c01-startup-held-gate-development-v1'
      || report.proofMode !== 'development-electron-held-gate-calibration'
      || report.gateKind !== gateKind || report.qualification?.eligible !== false
      || scenario?.profileKind !== profileKind) failures.push('Development startup-fault identity differs.')
  if (scenario?.gate?.kind !== scenarioGateKind || scenario.gate.mode !== mode || scenario.gate.held !== held
      || scenario.gate.synthetic !== false || scenario.gate.bounded !== true
      || scenario.gate.timeoutMs !== C01_HELD_GATE_TIMEOUT_MS) failures.push('Declared bounded startup-fault mode was not observed.')
  // The probe records the fault-shell time and crash summary only for an
  // actionable observation; a bounded timeout negative carries neither.
  if (gateKind === 'diagnostics' && scenario?.gate?.startupTimeoutMs !== C01_STARTUP_RESPONSE_TIMEOUT_MS) {
    failures.push('Post-readiness diagnostics watchdog timeout was not identified in crash evidence.')
  } else if (gateKind === 'diagnostics' && scenario?.observed === 'actionable-fault'
      && (!Number.isSafeInteger(scenario?.process?.faultShellAtMs)
        || scenario.process.faultShellAtMs < C01_STARTUP_RESPONSE_TIMEOUT_MS
        || !scenario?.startupLogs?.startupFailureSummaries?.some((summary) =>
          typeof summary === 'string'
          && summary.includes(`StartupTimeoutError: The ${C01_STARTUP_RESPONSE_TIMEOUT_MS} ms startup deadline`)
          && summary.includes('storage diagnostics initialization')))) {
    failures.push('Post-readiness diagnostics watchdog timeout was not identified in crash evidence.')
  }
  if (gateKind === 'crash'
      && !scenario?.startupLogs?.startupFailures?.some((entry) =>
        entry?.code === 'ERR_SARTRACKER_NON_REGULAR_FILE')) {
    failures.push('Non-regular crash evidence rejection code was not recorded.')
  }
  // The durable-completion proof applies once the product has exited after
  // dismissal; a product that never reached that point is already a FAIL.
  if (gateKind === 'crash-write' && scenario?.process?.dialogDismissed === true
      && Number.isSafeInteger(scenario.process.productExitCode)) {
    const hold = scenario?.gate?.hold
    if (hold?.markerObserved !== true || hold?.releasedAfterDialogDismissal !== true
        || hold?.writeCompleted !== true || hold?.temporaryFilesRemaining !== false
        || !scenario?.startupLogs?.startupFailureSummaries?.some((summary) =>
          typeof summary === 'string' && summary.includes('newer mission store schema'))) {
      failures.push('Held crash-log fsync did not resume after dismissal and complete the startup failure record.')
    }
  }
  if (!Number.isSafeInteger(scenario?.process?.pid) || scenario.process.pid <= 0
      || scenario.process.closed !== true) failures.push('Owned startup process was not observed closed.')
  // A product that closes its own fault window before the controller can
  // dismiss it is a product observation, not a failed X11 dismissal.
  const exitedBeforeDismissal = scenario?.process?.exitedBeforeDismissal === true
  if (scenario?.observationFailure !== undefined
      || (scenario?.process?.dialogObserved === true && scenario.process.dialogDismissed !== true
        && !exitedBeforeDismissal)) {
    failures.push('Held-gate dialog dismissal or post-dialog observation failed.')
  }
  const cleanupObserved = gateKind === 'store'
    ? scenario?.gate?.lockHolder?.closed === true && scenario?.cleanup?.lockHolderClosed === true
    : gateKind === 'crash-write'
      // Leftover temporary files are product evidence, checked by the hold
      // proof above; controller cleanup is releasing the hold.
      ? scenario?.cleanup?.holdReleased === true
      : scenario?.cleanup?.heldPathRemoved === true
  if (!cleanupObserved) failures.push('Held dependency cleanup was not observed.')
  const before = scenario?.originalFiles?.before
  const after = scenario?.originalFiles?.after
  for (const name of new Set(['mission-store.sqlite', 'settings.json', ...Object.keys(before ?? {})])) {
    if (!/^[a-f0-9]{64}$/u.test(before?.[name]?.sha256 ?? '') || before[name].bytes <= 0
        || after?.[name]?.sha256 !== before[name].sha256 || after[name].bytes !== before[name].bytes) {
      failures.push(`Original ${name} custody differs.`)
    }
  }
  const actionable = scenario?.observed === 'actionable-fault' && typeof scenario.gate?.action === 'string'
    && scenario.gate.action.length > 0
    && scenario.gate.response === 'startup-fault-window'
    && scenario.gate.dialogObserved === true
    && scenario.process.dialogObserved === true
    && scenario.process.timedOut === false
    && Number.isSafeInteger(scenario.process.dialogObservedAtMs)
    && scenario.process.dialogObservedAtMs >= 0
    && scenario.process.dialogObservedAtMs <= C01_HELD_GATE_TIMEOUT_MS
    && Number.isFinite(scenario.process?.faultShellAtMs)
    && scenario.process.faultShellAtMs >= 0 && scenario.process.faultShellAtMs <= C01_HELD_GATE_TIMEOUT_MS
    && scenario.process.dialogDismissed === true
    && scenario.process.productExitCode === 1
    && scenario.process.productExitSignal === null
    && scenario.process.exitCode === 1
    && scenario.process.signal === null
    && scenario.process.forcedKill === false
    && Number.isSafeInteger(scenario.process.exitAfterDialogMs)
    && scenario.process.exitAfterDialogMs >= 0
    && scenario.process.exitAfterDialogMs <= C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS
  const productExitMismatch = scenario?.process?.productExitCode !== 1
    || scenario?.process?.productExitSignal !== null
    || scenario?.process?.exitCode !== 1
    || scenario?.process?.signal !== null
    || scenario?.process?.forcedKill !== false
  const productOwnExitFailed = scenario?.process !== undefined
    && (Number.isSafeInteger(scenario.process.productExitCode)
      || typeof scenario.process.productExitSignal === 'string')
    && scenario.process.exitCode === scenario.process.productExitCode
    && scenario.process.signal === scenario.process.productExitSignal
    && scenario.process.forcedKill === false
    && scenario.process.closed === true
  const harnessCleanupAfterExitWait = scenario?.process?.productExitCode === null
    && scenario.process.productExitSignal === null
    && scenario.process.exitCode === null
    && ['SIGTERM', 'SIGKILL'].includes(scenario.process.signal)
    && scenario.process.forcedKill === (scenario.process.signal === 'SIGKILL')
    && scenario.process.closed === true
  const productFailedToExit = scenario?.observed === 'actionable-fault'
    && scenario.gate?.response === 'startup-fault-window'
    && scenario.gate.dialogObserved === true
    && scenario.process?.dialogObserved === true
    && scenario.process?.timedOut === false
    && Number.isSafeInteger(scenario.process?.dialogObservedAtMs)
    && scenario.process.dialogObservedAtMs >= 0
    && scenario.process.dialogObservedAtMs <= C01_HELD_GATE_TIMEOUT_MS
    && scenario.process?.dialogDismissed === true
    && typeof scenario.productGap === 'string'
    && productExitMismatch
    && (productOwnExitFailed || harnessCleanupAfterExitWait)
  const productExitedBeforeDismissal = scenario?.observed === 'actionable-fault'
    && scenario.gate?.response === 'startup-fault-window'
    && scenario.gate.dialogObserved === true
    && scenario.process?.dialogObserved === true
    && exitedBeforeDismissal
    && scenario.process.dialogDismissed === false
    && scenario.process.forcedKill === false
    && scenario.process.closed === true
    && typeof scenario.productGap === 'string' && scenario.productGap.length > 0
  // The timeout itself is the product negative. The process may then be
  // stopped by the controller or exit on its own after a late dialog; either
  // way it must be observed closed.
  const negative = scenario?.observed === 'bounded-timeout-no-action'
    && typeof scenario.productGap === 'string' && scenario.productGap.length > 0
    && scenario.process?.closed === true
    && (['SIGTERM', 'SIGKILL'].includes(scenario.process.signal)
      || (Number.isSafeInteger(scenario.process.exitCode) && scenario.process.signal === null
        && scenario.process.forcedKill === false))
  if (!actionable && !negative && !productFailedToExit && !productExitedBeforeDismissal) failures.push('Neither bounded actionable response nor explicit timeout negative was observed.')
  return Object.freeze({ infrastructurePassed: failures.length === 0,
    observedPredicateStatus: failures.length ? 'INVALID_EVIDENCE' : actionable ? 'PASS' : 'FAIL',
    producerCheckPassed: failures.length === 0 && actionable,
    qualificationExecuted: false, releaseEligible: false, failures: Object.freeze(failures),
    productGap: negative || productFailedToExit || productExitedBeforeDismissal ? scenario.productGap : null,
  })
}

/** Keep the observed product predicate separate from child-process infrastructure. */
export function inspectHeldGateExecution(execution) {
  const { exitCode, timedOut, processError, zeroDescendantsAfterRun, mechanics } = execution
  const productCheckPassed = mechanics?.producerCheckPassed === true
  const productFailureExit = exitCode === 2
    && mechanics?.infrastructurePassed === true
    && mechanics?.producerCheckPassed === false
  const processCompleted = exitCode === 0 || productFailureExit
  return Object.freeze({
    infrastructurePassed: processCompleted
      && timedOut === false
      && processError === null
      && zeroDescendantsAfterRun === true
      && mechanics?.infrastructurePassed === true,
    productCheckPassed,
  })
}
