import {
  C01_HELD_GATE_PRODUCT_EXIT_TIMEOUT_MS,
  C01_HELD_GATE_TIMEOUT_MS,
} from './startup-receipts.mjs'

/** Check bounded fault mechanics while explicitly preserving a negative product observation. */
export function inspectHeldGateDevelopment(report, gateKind) {
  const scenario = report?.scenario
  const failures = []
  if (!['diagnostics', 'crash', 'store'].includes(gateKind)
      || report?.schema !== 'sartracker-c01-startup-held-gate-development-v1'
      || report.proofMode !== 'development-electron-held-gate-calibration'
      || report.gateKind !== gateKind || report.qualification?.eligible !== false
      || scenario?.profileKind !== `held-${gateKind}-gate`) failures.push('Development held-gate identity differs.')
  if (scenario?.gate?.kind !== gateKind || scenario.gate.held !== true
      || scenario.gate.synthetic !== false || scenario.gate.bounded !== true
      || scenario.gate.timeoutMs !== C01_HELD_GATE_TIMEOUT_MS) failures.push('Real bounded startup dependency hold was not observed.')
  if (!Number.isSafeInteger(scenario?.process?.pid) || scenario.process.pid <= 0
      || scenario.process.closed !== true) failures.push('Owned startup process was not observed closed.')
  if (scenario?.observationFailure !== undefined
      || (scenario?.process?.dialogObserved === true && scenario.process.dialogDismissed !== true)) {
    failures.push('Held-gate dialog dismissal or post-dialog observation failed.')
  }
  if (gateKind === 'store'
    ? scenario?.gate?.lockHolder?.closed !== true || scenario?.cleanup?.lockHolderClosed !== true
    : scenario?.cleanup?.heldPathRemoved !== true) failures.push('Held dependency cleanup was not observed.')
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
  const negative = scenario?.observed === 'bounded-timeout-no-action'
    && typeof scenario.productGap === 'string' && scenario.productGap.length > 0
    && ['SIGTERM', 'SIGKILL'].includes(scenario.process?.signal)
  if (!actionable && !negative && !productFailedToExit) failures.push('Neither bounded actionable response nor explicit timeout negative was observed.')
  return Object.freeze({ infrastructurePassed: failures.length === 0,
    observedPredicateStatus: failures.length ? 'INVALID_EVIDENCE' : actionable ? 'PASS' : 'FAIL',
    producerCheckPassed: failures.length === 0 && actionable,
    qualificationExecuted: false, releaseEligible: false, failures: Object.freeze(failures),
    productGap: negative || productFailedToExit ? scenario.productGap : null,
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
